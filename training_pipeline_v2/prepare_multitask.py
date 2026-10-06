from __future__ import annotations

import argparse
import csv
import json
import os
import random
import shutil
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path


SEED = 20260922
CLASS_NAMES = ["Crack", "Grid", "Spot"]


def link(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        destination.unlink()
    os.symlink(source, destination)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def prepare_defect(source: Path, output: Path) -> dict:
    root = source / "光伏电池板缺陷检测数据集" / "panel-2"
    groups: dict[str, list[tuple[Path, Path]]] = defaultdict(list)
    for image in sorted((root / "train" / "images").glob("*.jpg")):
        groups[image.stem.rsplit("_", 1)[-1]].append(
            (image, root / "train" / "labels" / f"{image.stem}.txt")
        )
    group_ids = sorted(groups, key=int)
    random.Random(SEED).shuffle(group_ids)
    validation_groups = set(group_ids[: round(len(group_ids) * 0.2)])
    splits = {"train": [], "val": [], "test": []}
    for group_id, samples in groups.items():
        splits["val" if group_id in validation_groups else "train"].extend(samples)
    for image in sorted((root / "valid" / "images").glob("*.jpg")):
        splits["test"].append((image, root / "valid" / "labels" / f"{image.stem}.txt"))

    report = {"task": "visible_defect_detection", "seed": SEED, "classes": CLASS_NAMES, "splits": {}}
    for split, samples in splits.items():
        counts = Counter()
        for image, label in samples:
            link(image, output / "defect" / "images" / split / image.name)
            link(label, output / "defect" / "labels" / split / label.name)
            for row in label.read_text(encoding="utf-8").splitlines():
                if row.strip():
                    counts[int(row.split()[0])] += 1
        report["splits"][split] = {
            "images": len(samples),
            "boxes": sum(counts.values()),
            "class_boxes": {CLASS_NAMES[key]: counts[key] for key in range(len(CLASS_NAMES))},
        }
    yaml = (
        f"path: {output / 'defect'}\n"
        "train: images/train\nval: images/val\ntest: images/test\n"
        "names:\n  0: Crack\n  1: Grid\n  2: Spot\n"
    )
    (output / "defect" / "dataset.yaml").write_text(yaml, encoding="utf-8")
    write_json(output / "defect" / "dataset_report.json", report)
    return report


def parse_pascal(source: Path, segmentation: bool) -> tuple[int, int, list[list[float]]]:
    root = ET.parse(source).getroot()
    width = int(root.findtext("size/width", "0"))
    height = int(root.findtext("size/height", "0"))
    annotations: list[list[float]] = []
    for obj in root.findall("object"):
        if segmentation:
            polygon = obj.find("polygon")
            if polygon is None:
                continue
            points = []
            index = 1
            while polygon.find(f"x{index}") is not None:
                x = min(max(float(polygon.findtext(f"x{index}", "0")) / width, 0.0), 1.0)
                y = min(max(float(polygon.findtext(f"y{index}", "0")) / height, 0.0), 1.0)
                points.extend([x, y])
                index += 1
            if len(points) >= 6:
                annotations.append([0.0, *points])
        else:
            box = obj.find("bndbox")
            if box is None:
                continue
            xmin = float(box.findtext("xmin", "0")); xmax = float(box.findtext("xmax", "0"))
            ymin = float(box.findtext("ymin", "0")); ymax = float(box.findtext("ymax", "0"))
            annotations.append([
                0.0,
                ((xmin + xmax) / 2) / width,
                ((ymin + ymax) / 2) / height,
                (xmax - xmin) / width,
                (ymax - ymin) / height,
            ])
    return width, height, annotations


def prepare_xml_dataset(
    source: Path,
    output: Path,
    source_name: str,
    target_name: str,
    segmentation: bool,
    regroup: bool,
) -> dict:
    root = source / source_name
    samples: list[tuple[str, Path, Path]] = []
    for original_split in ("train", "valid", "test"):
        for image in sorted((root / original_split).glob("*.jpg")):
            samples.append((original_split, image, image.with_suffix(".xml")))

    split_map: dict[str, str] = {}
    if regroup:
        group_ids = sorted({image.stem.split("_jpg.rf.")[0] for _, image, _ in samples})
        random.Random(SEED).shuffle(group_ids)
        n_test = round(len(group_ids) * 0.1)
        n_val = round(len(group_ids) * 0.1)
        for index, group_id in enumerate(group_ids):
            split_map[group_id] = "test" if index < n_test else "val" if index < n_test + n_val else "train"

    counts = Counter()
    groups_by_split: dict[str, set[str]] = defaultdict(set)
    for original_split, image, xml in samples:
        group_id = image.stem.split("_jpg.rf.")[0]
        split = split_map.get(group_id, "val" if original_split == "valid" else original_split)
        _, _, annotations = parse_pascal(xml, segmentation)
        link(image, output / target_name / "images" / split / image.name)
        label = output / target_name / "labels" / split / f"{image.stem}.txt"
        label.parent.mkdir(parents=True, exist_ok=True)
        content = "\n".join(
            " ".join([str(int(row[0])), *[f"{value:.8f}" for value in row[1:]]])
            for row in annotations
        )
        label.write_text(f"{content}\n" if content else "", encoding="utf-8")
        counts[(split, "images")] += 1
        counts[(split, "objects")] += len(annotations)
        groups_by_split[split].add(group_id)

    report = {
        "task": "solar_panel_segmentation" if segmentation else "distributed_pv_detection",
        "seed": SEED,
        "split_policy": "source-grouped" if regroup else "publisher-provided",
        "splits": {
            split: {
                "images": counts[(split, "images")],
                "objects": counts[(split, "objects")],
                "source_groups": len(groups_by_split[split]),
            }
            for split in ("train", "val", "test")
        },
    }
    yaml = (
        f"path: {output / target_name}\n"
        "train: images/train\nval: images/val\ntest: images/test\n"
        "names:\n  0: solar-panel\n"
    )
    (output / target_name / "dataset.yaml").write_text(yaml, encoding="utf-8")
    write_json(output / target_name / "dataset_report.json", report)
    return report


def prepare_cell_classification(source: Path, output: Path) -> dict:
    root = source / "光伏电池异常检测数据集" / "光伏电池异常检测"
    with (root / "train.csv").open(encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle, delimiter=";"))
    by_label: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        key = f"{row['poly_wafer']}{row['crack']}{row['inactive']}"
        by_label[key].append(row)
    rng = random.Random(SEED)
    prepared: list[dict[str, object]] = []
    split_counts = Counter()
    for key, group in sorted(by_label.items()):
        rng.shuffle(group)
        n_test = max(1, round(len(group) * 0.15))
        n_val = max(1, round(len(group) * 0.15))
        for index, row in enumerate(group):
            split = "test" if index < n_test else "val" if index < n_test + n_val else "train"
            source_image = root / row["filename"]
            destination = output / "cell_anomaly" / "images" / split / source_image.name
            link(source_image, destination)
            prepared.append({
                "filename": str(destination),
                "split": split,
                "poly_wafer": int(row["poly_wafer"]),
                "crack": int(row["crack"]),
                "inactive": int(row["inactive"]),
            })
            split_counts[split] += 1
    manifest = output / "cell_anomaly" / "labels.csv"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with manifest.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(prepared[0]))
        writer.writeheader(); writer.writerows(prepared)
    report = {
        "task": "cell_multilabel_classification",
        "seed": SEED,
        "classes": ["poly_wafer", "crack", "inactive"],
        "splits": dict(split_counts),
    }
    write_json(output / "cell_anomaly" / "dataset_report.json", report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "prepared")
    args = parser.parse_args()
    if args.output.exists():
        shutil.rmtree(args.output)
    args.output.mkdir(parents=True)
    reports = {
        "defect": prepare_defect(args.source, args.output),
        "segmentation": prepare_xml_dataset(
            args.source, args.output, "光伏电池板语义分割数据集", "panel_segmentation", True, True
        ),
        "distributed": prepare_xml_dataset(
            args.source, args.output, "分布式光伏目标检测数据集", "distributed_pv", False, False
        ),
        "cell_anomaly": prepare_cell_classification(args.source, args.output),
    }
    write_json(args.output / "multitask_report.json", reports)
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
