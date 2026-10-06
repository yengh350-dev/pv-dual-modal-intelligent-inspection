"""Validate fixed runtime profiles without training or changing activation."""
import argparse
import json
from pathlib import Path
from benchmark_thermal_inference import evaluate, digest, snapshot_dataset


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    card = json.loads((args.model_dir / "model_card.json").read_text())
    weights, data = args.model_dir / "best.pt", Path(card["dataset"])
    args.output.mkdir(parents=True, exist_ok=False)
    report = {"weightsSha256": digest(weights), "dataset": snapshot_dataset(data), "validation": [],
              "policy": "Select resolution on validation only; freeze choice before test. Never change weights. No cross-site claim."}
    configs = [{"id": "native_416", "imageSize": 416, "augment": False, "iou": .7},
               {"id": "preview_320", "imageSize": 320, "augment": False, "iou": .7},
               {"id": "precision_640", "imageSize": 640, "augment": False, "iou": .7}]
    for config in configs:
        report["validation"].append(evaluate(weights, data, args.output, "val", config))
    baseline, _, candidate = report["validation"]
    eligible = (candidate["map50_95"] >= baseline["map50_95"] and candidate["map50"] >= baseline["map50"] and
                all(candidate["perClass"][c]["map50_95"] >= row["map50_95"] for c, row in baseline["perClass"].items()) and
                candidate["speedMs"]["inference"] <= baseline["speedMs"]["inference"] * 4)
    chosen = configs[2] if eligible else configs[0]
    report["frozenPrecisionSelection"] = chosen
    report["test"] = [evaluate(weights, data, args.output, "test", configs[0])]
    if eligible:
        report["test"].append(evaluate(weights, data, args.output, "test", chosen))
        before, after = report["test"]
        eligible = after["map50_95"] >= before["map50_95"] and all(
            after["perClass"][c]["map50_95"] >= row["map50_95"] for c, row in before["perClass"].items())
    report["recommendedPrecisionSize"] = 640 if eligible else 416
    report["boundary"] = "320 为临时预览；640 不通过逐类不回退门控时正式检测保留 416。不得用本测试调参。"
    (args.output / "profile-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"recommendedPrecisionSize": report["recommendedPrecisionSize"], "validation": [
        {"id": r["id"], "map50": r["map50"], "map50_95": r["map50_95"], "inferenceMs": r["speedMs"]["inference"]} for r in report["validation"]]}), flush=True)


if __name__ == "__main__":
    main()
