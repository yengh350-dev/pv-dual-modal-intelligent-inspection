#!/usr/bin/env python3
"""Validate a Sentinel RGBT mission package manifest without external dependencies."""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


REQUIRED_TOP_LEVEL = ("schemaVersion", "missionId", "site", "aircraft", "payload", "timezone", "crs", "frames")
REQUIRED_FRAME_FIELDS = ("pairId", "modality", "path", "timestamp", "latitude", "longitude", "altitudeM")


def validate(manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors = []
    warnings = []

    for field in REQUIRED_TOP_LEVEL:
        if field not in manifest:
            errors.append(f"缺少顶层字段: {field}")

    frames = manifest.get("frames", [])
    if not isinstance(frames, list) or not frames:
        errors.append("frames 必须是非空数组")
        frames = []

    pairs = defaultdict(set)
    modalities = Counter()
    referenced_files = 0
    for index, frame in enumerate(frames):
        if not isinstance(frame, dict):
            errors.append(f"frames[{index}] 必须是对象")
            continue
        missing = [field for field in REQUIRED_FRAME_FIELDS if frame.get(field) in (None, "")]
        if missing:
            errors.append(f"frames[{index}] 缺少字段: {', '.join(missing)}")
        modality = str(frame.get("modality", "")).upper()
        if modality not in {"RGB", "THERMAL"}:
            errors.append(f"frames[{index}].modality 必须是 RGB 或 THERMAL")
        else:
            modalities[modality] += 1
            pairs[str(frame.get("pairId", ""))].add(modality)
        relative_path = frame.get("path")
        if relative_path:
            referenced_files += 1
            if not (manifest_path.parent / relative_path).exists():
                warnings.append(f"引用文件尚不可见: {relative_path}")

    for modality in ("RGB", "THERMAL"):
        if modalities[modality] == 0:
            errors.append(f"任务包缺少 {modality} 帧")

    incomplete_pairs = sorted(pair_id for pair_id, values in pairs.items() if values != {"RGB", "THERMAL"})
    if incomplete_pairs:
        errors.append(f"存在 {len(incomplete_pairs)} 个不完整双模态配对: {', '.join(incomplete_pairs[:8])}")

    result = {
        "status": "ready" if not errors else "blocked",
        "missionId": manifest.get("missionId"),
        "counts": {
            "frames": len(frames),
            "rgb": modalities["RGB"],
            "thermal": modalities["THERMAL"],
            "completePairs": sum(1 for values in pairs.values() if values == {"RGB", "THERMAL"}),
            "referencedFiles": referenced_files,
        },
        "errors": errors,
        "warnings": warnings,
        "scope": "结构校验通过不代表影像质量、温度标定、检测结论或飞行安全有效。",
    }
    return result


def main() -> int:
    if len(sys.argv) != 2:
        print("用法: validate_manifest.py <manifest.json>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1]).expanduser().resolve()
    try:
        result = validate(path)
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "blocked", "errors": [str(exc)]}, ensure_ascii=False, indent=2))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
