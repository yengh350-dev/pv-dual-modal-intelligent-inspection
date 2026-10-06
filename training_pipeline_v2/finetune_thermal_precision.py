"""Non-destructive native-resolution fine tuning with validation deployment gate."""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from ultralytics import YOLO

from benchmark_thermal_inference import digest, evaluate, snapshot_dataset


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--imgsz", type=int, choices=(416, 640), default=640)
    parser.add_argument("--freeze", type=int, choices=(0, 10), default=10)
    parser.add_argument("--learning-rate", type=float, default=.0002)
    args = parser.parse_args()
    args.output = args.output.resolve()
    if not 1 <= args.epochs <= 60 or not 0 < args.learning_rate <= .01:
        parser.error("epochs must be 1..60 and learning-rate must be 0..0.01")
    root = Path(__file__).resolve().parents[1]
    weights = root / "backend/models/sentinel_rgbt_yolo11n_v1/best.pt"
    card = json.loads(weights.with_name("model_card.json").read_text())
    data = Path(card["dataset"])
    args.output.mkdir(parents=True, exist_ok=False)
    report = {"createdAt": datetime.now(timezone.utc).isoformat(), "sourceWeightsSha256": digest(weights),
              "dataset": snapshot_dataset(data), "epochsRequested": args.epochs,
              "trainingSettings": {"imageSize": args.imgsz, "freeze": args.freeze, "lr0": args.learning_rate,
                                   "hsv_h": 0, "hsv_s": 0, "mosaic": 0, "seed": 20261004},
              "policy": "Freeze trained best.pt using validation only. Test baseline/candidate for deployment acceptance, never tune on test. Preserve original weights."}
    report_path = args.output / "comparison.json"
    def save():
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    save()
    model = YOLO(str(weights))
    model.train(data=str(data), epochs=args.epochs, imgsz=args.imgsz, batch=16, device="cpu", workers=0,
                optimizer="AdamW", lr0=args.learning_rate, lrf=.1, warmup_epochs=1, warmup_bias_lr=args.learning_rate, cos_lr=True,
                mosaic=0, mixup=0, hsv_h=0, hsv_s=0, hsv_v=.1, degrees=0,
                scale=.15, translate=.05, fliplr=.5, flipud=0, close_mosaic=0,
                freeze=args.freeze, seed=20261004, deterministic=True, patience=8,
                project=str(args.output), name=f"train_{args.imgsz}", exist_ok=False, plots=False)
    candidate = args.output / "candidate.pt"
    shutil.copy2(model.trainer.best, candidate)
    report["candidateWeightsSha256"] = digest(candidate)
    baseline_config = {"id": "baseline_416", "imageSize": 416, "augment": False, "iou": .7}
    candidate_config = {"id": f"finetuned_{args.imgsz}", "imageSize": args.imgsz, "augment": False, "iou": .7}
    report["validation"] = [evaluate(weights, data, args.output, "val", baseline_config),
                            evaluate(candidate, data, args.output, "val", candidate_config)]
    baseline, new = report["validation"]
    report["validationEligible"] = (new["map50_95"] > baseline["map50_95"] and new["map50"] >= baseline["map50"]
        and new["perClass"]["hotspot"]["map50_95"] >= baseline["perClass"]["hotspot"]["map50_95"]
        and new["speedMs"]["inference"] <= 4 * baseline["speedMs"]["inference"])
    report["frozenCandidate"] = candidate_config
    save()
    report["deploymentEligible"] = False
    if report["validationEligible"]:
        report["test"] = [evaluate(weights, data, args.output, "test", baseline_config),
                          evaluate(candidate, data, args.output, "test", candidate_config)]
        baseline, new = report["test"]
        report["deploymentEligible"] = (new["map50_95"] > baseline["map50_95"] and new["map50"] >= baseline["map50"]
            and new["perClass"]["hotspot"]["map50_95"] >= baseline["perClass"]["hotspot"]["map50_95"])
    save()
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
