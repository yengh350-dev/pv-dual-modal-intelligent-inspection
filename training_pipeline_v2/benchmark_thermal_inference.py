"""Select inference settings on validation data; compare frozen settings on test.

Does not train, change weights, or install an inference profile automatically.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import numpy as np
import torch
import ultralytics
import yaml
from PIL import Image
from ultralytics import YOLO


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot_dataset(data):
    spec = yaml.safe_load(data.read_text(encoding="utf-8"))
    base = Path(spec["path"])
    fingerprints, image_counts, groups, labels_summary = {}, {}, {}, {}
    for split in ("train", "val", "test"):
        folder = base / spec[split]
        paths = sorted(p for p in folder.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
        if not paths:
            raise ValueError(f"Empty {split} split")
        hashes = []
        groups[split] = set()
        counts = {str(name): 0 for name in spec["names"].values()}
        size_counts = {"smallBelow32Squared": 0, "mediumBelow96Squared": 0, "large": 0}
        for image in paths:
            label = image.parent.parent / "labels" / (image.stem + ".txt")
            if not label.exists():
                raise ValueError(f"Missing label: {label}")
            hashes.append((image.name, digest(image), digest(label)))
            with Image.open(image) as decoded:
                width, height = decoded.size
            for line in label.read_text().splitlines():
                values = [float(value) for value in line.split()]
                if len(values) != 5 or not np.isfinite(values).all():
                    raise ValueError(f"Invalid label: {label}")
                cls, x, y, w, h = values
                if (cls != int(cls) or int(cls) not in spec["names"] or w <= 0 or h <= 0 or
                        min(x - w / 2, y - h / 2) < -1e-5 or max(x + w / 2, y + h / 2) > 1 + 1e-5):
                    raise ValueError(f"Out-of-bounds label: {label}")
                counts[str(spec["names"][int(cls)])] += 1
                area = w * width * h * height
                size_counts["smallBelow32Squared" if area < 32 ** 2 else
                            "mediumBelow96Squared" if area < 96 ** 2 else "large"] += 1
            # This prepared dataset used consecutive groups of ten numbered frames.
            groups[split].add((int(image.stem) - 1) // 10)
        fingerprints[split] = hashes
        image_counts[split] = len(paths)
        labels_summary[split] = {"classBoxes": counts, "boxSizeCounts": size_counts}
    for a, b in (("train", "val"), ("train", "test"), ("val", "test")):
        if groups[a] & groups[b]:
            raise ValueError(f"Frame groups overlap: {a}/{b}")
        if {h[1] for h in fingerprints[a]} & {h[1] for h in fingerprints[b]}:
            raise ValueError(f"Duplicate image content: {a}/{b}")
    adjacent = {f"{a}/{b}": sum(any(abs(g - h) == 1 for h in groups[b]) for g in groups[a])
                for a, b in (("train", "val"), ("train", "test"), ("val", "test"))}
    return {"yamlSha256": digest(data), "splitSha256": {
        k: hashlib.sha256(json.dumps(v).encode()).hexdigest() for k, v in fingerprints.items()
    }, "imageCounts": image_counts, "frameGroupSize": 10, "overlapChecked": True,
            "labels": labels_summary, "adjacentGroupCounts": adjacent,
            "generalizationBoundary": "Frame groups are disjoint, not guaranteed independent flights or sites. Neighboring groups may remain correlated."}


def select_candidate(rows):
    baseline = rows[0]
    eligible = [row for row in rows if
                row["map50"] >= baseline["map50"] and
                row["perClass"]["hotspot"]["map50_95"] >= baseline["perClass"]["hotspot"]["map50_95"] and
                row["speedMs"]["inference"] <= baseline["speedMs"]["inference"] * 4]
    return max(eligible, key=lambda row: (row["map50_95"], -row["speedMs"]["inference"]))


def evaluate(weights, data, output, split, config):
    started = perf_counter()
    metrics = YOLO(str(weights)).val(
        data=str(data), split=split, imgsz=config["imageSize"], augment=config["augment"],
        batch=16, workers=0, device="cpu", conf=.001, iou=config.get("iou", .7), max_det=300,
        rect=False, plots=False, project=str(output), name=f"{split}_{config['id']}",
        exist_ok=False, verbose=False,
    )
    box = metrics.box
    f1_curve = np.asarray(box.f1_curve)
    threshold = float(box.px[int(f1_curve.mean(0).argmax())])
    per_class = {metrics.names[int(c)]: {
        "precision": float(box.p[i]), "recall": float(box.r[i]),
        "map50": float(box.ap50[i]), "map50_95": float(box.ap[i]),
    } for i, c in enumerate(box.ap_class_index)}
    return {**config, "split": split, "precision": float(box.mp), "recall": float(box.mr),
            "map50": float(box.map50), "map50_95": float(box.map), "perClass": per_class,
            "recommendedConfidence": threshold, "speedMs": metrics.speed,
            "elapsedSeconds": round(perf_counter() - started, 2)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--search", choices=("resolution", "nms"), default="resolution")
    args = parser.parse_args()
    args.output = args.output.resolve()
    root = Path(__file__).resolve().parents[1]
    model_dir = root / "backend/models/sentinel_rgbt_yolo11n_v1"
    weights = model_dir / "best.pt"
    card = json.loads((model_dir / "model_card.json").read_text())
    data = Path(card["dataset"])
    args.output.mkdir(parents=True, exist_ok=False)
    report = {"createdAt": datetime.now(timezone.utc).isoformat(),
              "weightsSha256": digest(weights), "dataset": snapshot_dataset(data),
              "runtime": {"python": platform.python_version(), "torch": torch.__version__,
                          "ultralytics": ultralytics.__version__, "device": "cpu"},
              "policy": "Select on validation mAP50-95, guard mAP50/hotspot and 4x latency; test only baseline and frozen selection. Reject deployment on test regression. P/R are max-F1 summaries, not API confidence=.25.",
              "validation": []}
    configs = [{"id": "baseline_416", "imageSize": 416, "augment": False},
               {"id": "native_640", "imageSize": 640, "augment": False},
               {"id": "balanced_512", "imageSize": 512, "augment": False},
               {"id": "tta_416", "imageSize": 416, "augment": True}]
    if args.search == "nms":
        configs = [{"id": "baseline_416", "imageSize": 416, "augment": False, "iou": .7}]
        configs += [{"id": f"nms_416_{int(iou * 100)}", "imageSize": 416,
                     "augment": False, "iou": iou} for iou in (.5, .6, .8, .9)]
        configs += [{"id": f"scale_{size}", "imageSize": size,
                     "augment": False, "iou": .7} for size in (384, 448)]
    report["plannedCandidates"] = configs
    report["search"] = args.search
    report_path = args.output / "benchmark.json"
    def save():
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    save()
    for config in configs:
        row = evaluate(weights, data, args.output, "val", config)
        report["validation"].append(row)
        save()
        print(json.dumps(row), flush=True)
    selected = select_candidate(report["validation"])
    report["frozenSelection"] = {k: selected[k] for k in ("id", "imageSize", "augment", "iou") if k in selected}
    save()
    report["test"] = [evaluate(weights, data, args.output, "test", configs[0])]
    save()
    if selected["id"] != configs[0]["id"]:
        report["test"].append(evaluate(weights, data, args.output, "test", report["frozenSelection"]))
    baseline, candidate = report["test"][0], report["test"][-1]
    report["deploymentEligible"] = (selected["id"] != configs[0]["id"] and
        candidate["map50_95"] > baseline["map50_95"] and candidate["map50"] >= baseline["map50"] and
        candidate["perClass"]["hotspot"]["map50_95"] >= baseline["perClass"]["hotspot"]["map50_95"])
    save()
    print(json.dumps({"frozenSelection": report["frozenSelection"],
                      "deploymentEligible": report["deploymentEligible"], "test": report["test"]}), flush=True)


if __name__ == "__main__":
    main()
