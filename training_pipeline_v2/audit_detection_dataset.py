"""Read-only detection dataset audit. Never edits labels or split membership."""
import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import yaml
from PIL import Image, ImageOps


def audit_dataset(yaml_path, capture_groups=None):
    spec = yaml.safe_load(Path(yaml_path).read_text(encoding="utf-8"))
    names = spec["names"]
    names = dict(enumerate(names)) if isinstance(names, list) else {int(k): v for k, v in names.items()}
    root = Path(spec.get("path", Path(yaml_path).parent))
    if not root.is_absolute():
        root = Path(yaml_path).parent / root
    hashes, groups, rows, errors = defaultdict(list), defaultdict(set), [], []
    summaries = {}
    for split in ("train", "val", "test"):
        folder = root / spec[split]
        files = sorted(p for p in folder.rglob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
        counts, small, empty = Counter(), 0, 0
        if not files:
            errors.append({"code": "EMPTY_SPLIT", "split": split})
        for path in files:
            key = str(path.relative_to(root))
            parts = list(path.parent.parts)
            if "images" not in parts:
                raise ValueError("Dataset must use split/images and split/labels folders")
            parts[len(parts)-1-parts[::-1].index("images")] = "labels"
            label = Path(*parts) / (path.stem + ".txt")
            try:
                with Image.open(path) as decoded:
                    image = ImageOps.exif_transpose(decoded).convert("RGB")
                    width, height = image.size
                    pixel_hash = hashlib.sha256(f"{width}x{height}:".encode() + image.tobytes()).hexdigest()
                raw_hash = hashlib.sha256(path.read_bytes()).hexdigest()
                hashes[pixel_hash].append({"split": split, "path": key})
                group = (capture_groups or {}).get(key)
                if group:
                    groups[str(group)].add(split)
                boxes = label.read_text(encoding="utf-8").splitlines()
                valid = 0
                for index, line in enumerate(boxes):
                    values = [float(v) for v in line.split()]
                    if len(values) != 5 or not all(math.isfinite(v) for v in values):
                        raise ValueError(f"Invalid box at line {index + 1}")
                    cls, x, y, w, h = values
                    if cls != int(cls) or int(cls) not in names or w <= 0 or h <= 0 or min(x-w/2, y-h/2) < -1e-5 or max(x+w/2, y+h/2) > 1+1e-5:
                        raise ValueError(f"Invalid geometry/class at line {index + 1}")
                    counts[names[int(cls)]] += 1
                    small += int(w*width*h*height < 32**2)
                    valid += 1
                empty += int(not valid)
                rows.append({"path": key, "split": split, "sha256": raw_hash, "pixelSha256": pixel_hash,
                             "width": width, "height": height, "boxes": valid, "captureGroup": group})
            except (OSError, ValueError) as exc:
                errors.append({"code": "INVALID_SAMPLE", "path": key, "detail": str(exc)[:240]})
        summaries[split] = {"images": len(files), "classBoxes": dict(counts), "smallBoxesBelow32Squared": small, "emptyLabels": empty}
    duplicates = [items for items in hashes.values() if len(items) > 1]
    leakage = [items for items in duplicates if len({item["split"] for item in items}) > 1]
    group_leakage = {key: sorted(value) for key, value in groups.items() if len(value) > 1}
    return {"schemaVersion": "dataset-audit-1.0", "splits": summaries, "errors": errors,
            "pixelDuplicates": duplicates, "crossSplitDuplicates": leakage, "captureGroupLeakage": group_leakage,
            "captureGroupsVerified": bool(capture_groups) and all(row["captureGroup"] for row in rows),
            "structuralGatePassed": not (errors or leakage or group_leakage), "samples": rows,
            "boundary": "结构通过不代表跨航次泛化或双模态配对成立；空标签须人工确认负样本，近重复与标注语义仍需复核。"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--groups", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    groups = json.loads(args.groups.read_text()) if args.groups else None
    report = audit_dataset(args.data, groups)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in {"samples", "pixelDuplicates"}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
