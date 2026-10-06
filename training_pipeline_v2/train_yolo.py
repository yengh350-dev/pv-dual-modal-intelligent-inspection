from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from ultralytics import YOLO


def scalar(value):
    if hasattr(value, "item"):
        return float(value.item())
    return float(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=("defect", "distributed_pv", "panel_segmentation"), required=True)
    parser.add_argument("--prepared", type=Path, default=Path(__file__).parent / "prepared")
    parser.add_argument("--runs", type=Path, default=Path(__file__).parent / "runs")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--imgsz", type=int, default=416)
    parser.add_argument("--batch", type=int, default=0, help="0 使用任务默认值")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    is_segment = args.task == "panel_segmentation"
    model = YOLO("yolo11n-seg.pt" if is_segment else "yolo11n.pt")
    run_name = f"{args.task}_yolo11n_v1"
    model.train(
        data=str(args.prepared / args.task / "dataset.yaml"),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch or (32 if is_segment else 64),
        patience=10,
        optimizer="AdamW",
        seed=20260922,
        deterministic=True,
        device="cpu",
        workers=args.workers,
        project=str(args.runs),
        name=run_name,
        exist_ok=True,
        plots=True,
        verbose=True,
    )
    best = args.runs / run_name / "weights" / "best.pt"
    evaluated = YOLO(str(best)).val(
        data=str(args.prepared / args.task / "dataset.yaml"),
        split="test",
        imgsz=args.imgsz,
        batch=32,
        device="cpu",
        project=str(args.runs),
        name=f"{run_name}_test",
        exist_ok=True,
        plots=True,
    )
    box = evaluated.box
    metrics = {
        "precision": scalar(box.mp),
        "recall": scalar(box.mr),
        "map50": scalar(box.map50),
        "map50_95": scalar(box.map),
        "per_class_map50_95": [scalar(value) for value in box.maps],
    }
    if is_segment and evaluated.seg is not None:
        metrics["segmentation"] = {
            "precision": scalar(evaluated.seg.mp),
            "recall": scalar(evaluated.seg.mr),
            "map50": scalar(evaluated.seg.map50),
            "map50_95": scalar(evaluated.seg.map),
        }
    artifact = Path(__file__).parent / "artifacts" / run_name
    artifact.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, artifact / "best.pt")
    card = {
        "model_id": run_name,
        "task": "segmentation" if is_segment else "detection",
        "architecture": "YOLO11n-seg" if is_segment else "YOLO11n",
        "image_size": args.imgsz,
        "epochs_requested": args.epochs,
        "batch_size": args.batch or (32 if is_segment else 64),
        "metrics": metrics,
        "class_names": ["solar-panel"] if args.task != "defect" else ["Crack", "Grid", "Spot"],
        "seed": 20260922,
        "boundary": (
            "航拍组件轮廓分割研究基线；跨场站使用前需验证航高、视角、组件类型和背景变化。"
            if is_segment else
            "可见光图像研究基线；检测框是候选目标，不能替代人工复核或电气安全结论。"
        ),
    }
    (artifact / "model_card.json").write_text(json.dumps(card, indent=2), encoding="utf-8")
    shutil.copy2(args.prepared / args.task / "dataset_report.json", artifact / "dataset_report.json")
    print(json.dumps(card, indent=2))


if __name__ == "__main__":
    main()
