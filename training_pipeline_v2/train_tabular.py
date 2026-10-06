from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


SEED = 20260922


def train_power(source: Path, artifact_root: Path) -> dict:
    frame = pd.read_csv(source / "光伏模组功率预测数据集" / "PV_data_sample.csv")
    frame["t"] = pd.to_datetime(frame["t"])
    frame["hour_sin"] = np.sin(2 * np.pi * frame["t"].dt.hour / 24)
    frame["hour_cos"] = np.cos(2 * np.pi * frame["t"].dt.hour / 24)
    features = ["AmbiTemp", "Irradiance", "ModuleTemp", "InclAngle", "Humidity", "hour_sin", "hour_cos"]
    n = len(frame); train_end = int(n * 0.7); val_end = int(n * 0.85)
    model = HistGradientBoostingRegressor(
        learning_rate=0.06, max_iter=300, max_leaf_nodes=31, l2_regularization=0.1, random_state=SEED
    )
    model.fit(frame.loc[: train_end - 1, features], frame.loc[: train_end - 1, "TruePower"])
    metrics = {}
    for split, start, end in (("val", train_end, val_end), ("test", val_end, n)):
        prediction = model.predict(frame.loc[start : end - 1, features])
        truth = frame.loc[start : end - 1, "TruePower"]
        metrics[split] = {
            "samples": len(truth),
            "mae": float(mean_absolute_error(truth, prediction)),
            "rmse": float(mean_squared_error(truth, prediction) ** 0.5),
            "r2": float(r2_score(truth, prediction)),
        }
    artifact = artifact_root / "pv_power_hgb_v1"; artifact.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": features}, artifact / "model.joblib")
    card = {
        "model_id": "pv_power_hgb_v1", "task": "power_regression", "algorithm": "HistGradientBoostingRegressor",
        "split_policy": "chronological 70/15/15", "metrics": metrics, "features": features,
        "boundary": "样本数据验证模型；跨场站使用前需用真实辐照、组件温度和功率数据重新标定。",
    }
    (artifact / "model_card.json").write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    return card


def window_features(frame: pd.DataFrame, window: int = 512, stride: int = 512) -> pd.DataFrame:
    columns = [column for column in frame.columns if column != "Time"]
    values = frame[columns].to_numpy(dtype=np.float32)
    rows = []
    for start in range(0, len(values) - window + 1, stride):
        block = values[start : start + window]
        feature = np.concatenate([block.mean(0), block.std(0), block.min(0), block.max(0), np.sqrt((block ** 2).mean(0))])
        rows.append(feature)
    return pd.DataFrame(rows, columns=[f"{stat}_{column}" for stat in ("mean", "std", "min", "max", "rms") for column in columns])


def train_fault(source: Path, artifact_root: Path) -> dict:
    root = source / "并网光伏系统故障诊断数据集" / "n76t439f65-1" / "CSV_Files"
    splits = {"train": [], "val": [], "test": []}; labels = {key: [] for key in splits}
    for path in sorted(root.glob("*.csv")):
        frame = pd.read_csv(path)
        features = window_features(frame)
        n = len(features); a = int(n * 0.6); b = int(n * 0.8)
        label = path.stem
        for split, part in (("train", features.iloc[:a]), ("val", features.iloc[a:b]), ("test", features.iloc[b:])):
            splits[split].append(part); labels[split].extend([label] * len(part))
    x = {key: pd.concat(value, ignore_index=True) for key, value in splits.items()}
    model = Pipeline([
        ("scale", StandardScaler()),
        ("classifier", RandomForestClassifier(n_estimators=240, max_features="sqrt", class_weight="balanced", n_jobs=-1, random_state=SEED)),
    ])
    model.fit(x["train"], labels["train"])
    metrics = {}
    for split in ("val", "test"):
        prediction = model.predict(x[split])
        report = classification_report(labels[split], prediction, output_dict=True, zero_division=0)
        metrics[split] = {
            "windows": len(prediction), "accuracy": float(accuracy_score(labels[split], prediction)),
            "macro_f1": float(report["macro avg"]["f1-score"]),
        }
    artifact = artifact_root / "grid_fault_rf_v1"; artifact.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": list(x["train"].columns), "window": 512}, artifact / "model.joblib")
    card = {
        "model_id": "grid_fault_rf_v1", "task": "grid_fault_classification", "algorithm": "StandardScaler + RandomForest",
        "classes": sorted(set(labels["train"])), "split_policy": "each operating trace chronological 60/20/20",
        "metrics": metrics,
        "boundary": "同一仿真来源内的时间外推评估，不代表跨逆变器、跨电站泛化；现场部署前必须采集真实电气波形验证。",
    }
    (artifact / "model_card.json").write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    return card


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, default=Path(__file__).parent / "artifacts")
    args = parser.parse_args(); args.artifacts.mkdir(parents=True, exist_ok=True)
    result = {"power": train_power(args.source, args.artifacts), "fault": train_fault(args.source, args.artifacts)}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
