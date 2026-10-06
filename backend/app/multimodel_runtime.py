from __future__ import annotations

import io
import json
import math
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock
from time import perf_counter
from typing import Any

import numpy as np
from PIL import Image

from .vision_geometry import normalize_polygon, open_raster, serialize_detections, validate_visual_input


MODELS_ROOT = Path(__file__).resolve().parents[1] / "models"
_vision_lock = Lock()


class MultiModelRuntimeUnavailable(RuntimeError):
    pass


def _card(model_id: str) -> dict[str, Any]:
    path = MODELS_ROOT / model_id / "model_card.json"
    if not path.exists():
        raise MultiModelRuntimeUnavailable(f"模型卡不存在：{model_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def model_catalog() -> dict[str, Any]:
    models = []
    for path in sorted(MODELS_ROOT.glob("*/model_card.json")):
        card = json.loads(path.read_text(encoding="utf-8"))
        artifacts = [item.name for item in path.parent.iterdir() if item.is_file() and item.name != "model_card.json"]
        models.append({**card, "artifactReady": any(name.endswith((".pt", ".joblib")) for name in artifacts), "artifacts": artifacts})
    return {"models": models, "count": len(models), "policy": "按数据模态路由到专用模型，不把不同任务的分数直接横向比较。"}


@lru_cache(maxsize=4)
def _load_joblib(model_id: str):
    try:
        import joblib
    except ImportError as exc:
        raise MultiModelRuntimeUnavailable("缺少 joblib/scikit-learn 推理依赖") from exc
    path = MODELS_ROOT / model_id / "model.joblib"
    if not path.exists():
        raise MultiModelRuntimeUnavailable(f"模型产物不存在：{model_id}")
    return joblib.load(path)


@lru_cache(maxsize=1)
def _load_cell_model():
    try:
        import torch
    except ImportError as exc:
        raise MultiModelRuntimeUnavailable("缺少 PyTorch 推理依赖") from exc
    path = MODELS_ROOT / "cell_anomaly_cnn_v1" / "model.torchscript.pt"
    if not path.exists():
        raise MultiModelRuntimeUnavailable("电池片分类模型产物不存在")
    model = torch.jit.load(str(path), map_location="cpu")
    model.eval()
    return model


@lru_cache(maxsize=3)
def _load_vision_model(model_id: str):
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise MultiModelRuntimeUnavailable("缺少 ultralytics 推理依赖") from exc
    path = MODELS_ROOT / model_id / "best.pt"
    if not path.exists():
        raise MultiModelRuntimeUnavailable(f"视觉模型产物不存在：{model_id}")
    return YOLO(str(path))


def predict_cell_image(content: bytes) -> dict[str, Any]:
    try:
        import torch
    except ImportError as exc:
        raise MultiModelRuntimeUnavailable("缺少 PyTorch 推理依赖") from exc
    started = perf_counter()
    try:
        with open_raster(content) as source:
            if source.width * source.height > 16_000_000:
                raise ValueError("图像超过 1600 万像素，请缩小后上传")
            source.verify()
        with open_raster(content) as source:
            image = source.convert("L").resize((128, 128))
    except (Image.UnidentifiedImageError, SyntaxError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("无法解析图像，请上传有效的 JPEG 或 PNG 文件") from exc
    array = (np.asarray(image, dtype=np.float32) / 255.0 - 0.5) / 0.5
    tensor = torch.from_numpy(array).unsqueeze(0).unsqueeze(0)
    with torch.no_grad():
        probabilities = _load_cell_model()(tensor).sigmoid()[0].cpu().tolist()
    classes = _card("cell_anomaly_cnn_v1")["classes"]
    if len(probabilities) != len(classes) or not all(math.isfinite(p) and 0 <= p <= 1 for p in probabilities):
        raise ValueError("电池片模型返回无效分类结果")
    return {
        "modelId": "cell_anomaly_cnn_v1",
        "modality": "ELECTROLUMINESCENCE_CELL",
        "predictions": [
            {"className": name, "probability": round(float(probability), 6), "positive": probability >= 0.5}
            for name, probability in zip(classes, probabilities)
        ],
        "reviewRequired": True,
        "elapsedMs": round((perf_counter() - started) * 1000, 2),
        "boundary": "仅适用于单片电致发光图像，不适用于无人机 RGB 或热红外影像。",
    }


def predict_visible_defect(content: bytes, suffix: str, confidence: float = 0.25, iou: float = 0.70, *, profile: str = "baseline") -> dict[str, Any]:
    from .inference_profiles import inference_profile
    started = perf_counter()
    validate_visual_input(content, suffix, confidence, iou)
    model_id = "defect_yolo11n_v1"
    card = _card(model_id)
    policy = inference_profile(profile, int(card.get("image_size", 416)))
    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary.write(content)
            temporary_path = Path(temporary.name)
        with _vision_lock:
            result = _load_vision_model(model_id).predict(
                source=str(temporary_path), **policy,
                conf=confidence, iou=iou, device="cpu", verbose=False,
            )[0]
        height, width = map(int, result.orig_shape)
        names = card.get("class_names", [])
        detections, rejected = serialize_detections(result, names)
        return {
            "modelId": model_id, "weightsSha256": card.get("weights_sha256"), "modality": "VISIBLE_RGB", "image": {"width": width, "height": height},
            "parameters": {"confidence": confidence, "iou": iou, "profile": profile, **policy}, "detections": detections,
            "count": len(detections), "elapsedMs": round((perf_counter() - started) * 1000, 2),
            "rejectedDetections": rejected,
            "reviewRequired": True,
            "boundary": "仅识别可见光裂纹、栅线与斑点候选，不提供温度信息，也不能单独确认热斑。",
        }
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def predict_panel_segmentation(content: bytes, suffix: str, confidence: float = 0.25, iou: float = 0.70) -> dict[str, Any]:
    started = perf_counter()
    validate_visual_input(content, suffix, confidence, iou)
    model_id = "panel_segmentation_yolo11n_v1"
    card = _card(model_id)
    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary.write(content)
            temporary_path = Path(temporary.name)
        with _vision_lock:
            result = _load_vision_model(model_id).predict(
                source=str(temporary_path), imgsz=int(card.get("image_size", 256)),
                conf=confidence, iou=iou, device="cpu", verbose=False,
            )[0]
        height, width = map(int, result.orig_shape)
        instances = []
        polygons = result.masks.xyn if result.masks is not None else []
        scores = result.boxes.conf.cpu().tolist() if result.boxes is not None else []
        for index, polygon in enumerate(polygons):
            points = normalize_polygon(polygon.tolist())
            if not points or index >= len(scores) or not math.isfinite(scores[index]) or not 0 <= scores[index] <= 1:
                continue
            instances.append({
                "className": "solar-panel",
                "confidence": round(float(scores[index]), 6),
                "polygonNormalized": points,
            })
        return {
            "modelId": model_id, "modality": "AERIAL_RGB", "image": {"width": width, "height": height},
            "parameters": {"confidence": confidence, "iou": iou}, "instances": instances,
            "count": len(instances), "elapsedMs": round((perf_counter() - started) * 1000, 2),
            "reviewRequired": True,
            "boundary": card.get("boundary", "航拍组件轮廓研究基线，跨场站使用前必须复核。"),
        }
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def predict_power(features: dict[str, float]) -> dict[str, Any]:
    started = perf_counter()
    artifact = _load_joblib("pv_power_hgb_v1")
    try:
        import pandas as pd
    except ImportError as exc:
        raise MultiModelRuntimeUnavailable("缺少 pandas 推理依赖") from exc
    hour = float(features["hour"])
    if not math.isfinite(hour) or not 0 <= hour < 24:
        raise ValueError("小时必须为 0 到 24 之间的有限数值")
    # Training encoded pandas dt.hour, not fractional-hour time.
    model_hour = math.floor(hour)
    row = {
        "AmbiTemp": float(features["ambient_temperature"]),
        "Irradiance": float(features["irradiance"]),
        "ModuleTemp": float(features["module_temperature"]),
        "InclAngle": float(features["inclination_angle"]),
        "Humidity": float(features["humidity"]),
        "hour_sin": float(np.sin(2 * np.pi * model_hour / 24)),
        "hour_cos": float(np.cos(2 * np.pi * model_hour / 24)),
    }
    if not all(math.isfinite(value) for value in [hour, *row.values()]):
        raise ValueError("功率预测输入必须为有限数值")
    frame = pd.DataFrame([[row[name] for name in artifact["features"]]], columns=artifact["features"])
    raw_prediction = float(artifact["model"].predict(frame)[0])
    if not math.isfinite(raw_prediction):
        raise ValueError("功率模型返回无效数值，请检查输入范围和权重")
    prediction = max(0.0, raw_prediction)
    return {
        "modelId": "pv_power_hgb_v1", "predictedPower": round(prediction, 4), "unit": "dataset power unit",
        "elapsedMs": round((perf_counter() - started) * 1000, 2), "reviewRequired": True,
        "boundary": "本输出是样本数据域回归值；未经场站标定时不能用作发电量结算或故障定责。",
    }


def _window_features(frame, window: int = 512):
    columns = [column for column in frame.columns if column != "Time"]
    values = frame[columns].to_numpy(dtype=np.float32)
    rows = []
    for start in range(0, len(values) - window + 1, window):
        block = values[start : start + window]
        with np.errstate(over="ignore", invalid="ignore"):
            row = np.concatenate([block.mean(0), block.std(0), block.min(0), block.max(0), np.sqrt((block ** 2).mean(0))])
        if not np.isfinite(row).all():
            raise ValueError("波形超出模型数值范围，请先完成信号量程映射")
        rows.append(row)
    names = [f"{stat}_{column}" for stat in ("mean", "std", "min", "max", "rms") for column in columns]
    return rows, names


def predict_fault_csv(content: bytes) -> dict[str, Any]:
    started = perf_counter()
    try:
        import pandas as pd
    except ImportError as exc:
        raise MultiModelRuntimeUnavailable("缺少 pandas 推理依赖") from exc
    try:
        frame = pd.read_csv(io.BytesIO(content))
    except (pd.errors.ParserError, pd.errors.EmptyDataError, UnicodeDecodeError) as exc:
        raise ValueError("无法解析 CSV 波形") from exc
    required = ["Time", "Ipv", "Vpv", "Vdc", "ia", "ib", "ic", "va", "vb", "vc", "Iabc", "If", "Vabc", "Vf"]
    missing = sorted(set(required) - set(frame.columns))
    if missing:
        raise ValueError(f"缺少字段：{', '.join(missing)}")
    if len(frame) < 512:
        raise ValueError("至少需要 512 行连续波形")
    try:
        frame = frame[required].apply(pd.to_numeric, errors="raise")
    except (ValueError, TypeError) as exc:
        raise ValueError("时间和波形字段必须为数值") from exc
    if not np.isfinite(frame.to_numpy(dtype=np.float64)).all():
        raise ValueError("波形不能包含空值、NaN 或无穷值")
    with np.errstate(over="ignore", invalid="ignore"):
        steps = np.diff(frame["Time"].to_numpy(dtype=np.float64))
    if not np.isfinite(steps).all():
        raise ValueError("时间间隔超出有效数值范围")
    median_step = float(np.median(steps))
    if (steps <= 0).any():
        raise ValueError("时间必须严格递增，不能包含重复或倒序采样")
    if ((steps > median_step * 1.5) | (steps < median_step * .5)).any():
        raise ValueError("波形采样不连续，请分段或在量程和采样率校验后重采样")
    rows, names = _window_features(frame)
    artifact = _load_joblib("grid_fault_rf_v1")
    feature_frame = pd.DataFrame(rows, columns=names)[artifact["features"]]
    probabilities = artifact["model"].predict_proba(feature_frame)
    if not np.isfinite(probabilities).all():
        raise ValueError("波形模型返回无效概率")
    classes = artifact["model"].classes_
    ranked = sorted(zip(classes, probabilities.mean(axis=0)), key=lambda item: item[1], reverse=True)
    window_predictions = []
    for index, scores in enumerate(probabilities):
        class_index = int(np.argmax(scores))
        start, end = index * 512, (index + 1) * 512 - 1
        window_predictions.append({"index": index, "startSample": start, "endSample": end,
            "startTime": float(frame["Time"].iloc[start]), "endTime": float(frame["Time"].iloc[end]),
            "className": str(classes[class_index]), "probability": round(float(scores[class_index]), 6)})
    return {
        "modelId": "grid_fault_rf_v1", "windows": len(rows), "dominantClass": ranked[0][0],
        "classProbabilities": [{"className": name, "probability": round(float(score), 6)} for name, score in ranked[:5]],
        "windowPredictions": window_predictions,
        "discardedSamples": len(frame) - len(rows) * 512,
        "medianTimeStep": median_step,
        "elapsedMs": round((perf_counter() - started) * 1000, 2), "reviewRequired": True,
        "boundary": "训练数据来自仿真波形；真实逆变器接入前必须完成信号量程、频率和类别编码映射。",
    }
