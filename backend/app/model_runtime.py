from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock
from time import perf_counter
from typing import Any

from .vision_geometry import serialize_detections, validate_visual_input
from .inference_profiles import inference_profile

os.environ.setdefault("YOLO_AUTOINSTALL", "false")


MODELS_ROOT = Path(__file__).resolve().parents[1] / "models"
BASELINE_ID = "sentinel_rgbt_yolo11n_v1"
PRECISION_ID = "sentinel_thermal_yolo11n_precision_v2"

_model: Any | None = None
_model_lock = Lock()


class ModelRuntimeUnavailable(RuntimeError):
    pass


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def select_active_model(models_root: Path):
    baseline = models_root / BASELINE_ID
    active_path = models_root / "active_thermal.json"
    if not active_path.exists():
        return baseline, None
    try:
        activation = _read_json(active_path)
        if not isinstance(activation, dict):
            raise ValueError("Invalid activation")
        if activation.get("model_id") == BASELINE_ID:
            return baseline, None
        if activation.get("model_id") != PRECISION_ID:
            raise ValueError("Unregistered thermal model")
        directory = models_root / PRECISION_ID
        card = _read_json(directory / "model_card.json")
        evaluation = _read_json(directory / "evaluation.json")
        weight_hash = hashlib.sha256((directory / "best.pt").read_bytes()).hexdigest()
        if (card.get("model_id") != PRECISION_ID or evaluation.get("deploymentEligible") is not True or
                any(h != weight_hash for h in (activation.get("weights_sha256"),
                     card.get("weights_sha256"), evaluation.get("candidateWeightsSha256")))):
            raise ValueError("Unverified model artifact")
        return directory, None
    except (OSError, ValueError, TypeError, AttributeError):
        return baseline, "Active model verification failed; using preserved baseline."


MODEL_DIR, ACTIVATION_WARNING = select_active_model(MODELS_ROOT)
WEIGHTS_PATH = MODEL_DIR / "best.pt"
MODEL_CARD_PATH = MODEL_DIR / "model_card.json"
DATASET_REPORT_PATH = MODEL_DIR / "dataset_report.json"


def model_manifest() -> dict[str, Any]:
    card = _read_json(MODEL_CARD_PATH)
    dataset = _read_json(DATASET_REPORT_PATH)
    split_summaries = {
        name: {
            "images": value.get("images", 0),
            "boxes": value.get("boxes", 0),
            "classBoxes": value.get("class_boxes", {}),
        }
        for name, value in dataset.get("splits", {}).items()
    }
    runtime_ready = importlib.util.find_spec("ultralytics") is not None and WEIGHTS_PATH.exists()
    return {
        "model": card,
        "baselineModel": _read_json(MODELS_ROOT / BASELINE_ID / "model_card.json"),
        "dataset": {
            "version": "solar-thermal-yolo-v1",
            "sourceImages": dataset.get("raw_image_count", 1430),
            "usableImages": dataset.get("clean_image_count", 1428),
            "duplicatesRemoved": len(dataset.get("duplicate_images", [])),
            "clippedBoxes": dataset.get("corrected_box_count", 85),
            "splits": split_summaries or {
                "train": {"images": 1148, "boxes": 3463},
                "val": {"images": 140, "boxes": 398},
                "test": {"images": 140, "boxes": 426},
            },
            "splitPolicy": "按 10 帧组划分，组内不跨集合；相邻组仍可能相关，不代表独立航次或跨场站泛化",
        },
        "artifact": {
            "weightsPresent": WEIGHTS_PATH.exists(),
            "weightsBytes": WEIGHTS_PATH.stat().st_size if WEIGHTS_PATH.exists() else 0,
            "runtimeReady": runtime_ready,
            "activationWarning": ACTIVATION_WARNING,
        },
        "decisionBoundary": {
            "modality": "THERMAL_ONLY",
            "statement": "该权重仅由热红外数据训练，是平台的热红外缺陷检测基线，不是 RGB-Thermal 双模态融合模型。",
            "requiresHumanReview": True,
            "temperatureWarning": "普通伪彩热图不能替代辐射测温数据，模型置信度也不能直接等同于工程故障概率。",
        },
    }


def _load_model():
    global _model
    if _model is not None:
        return _model
    if not WEIGHTS_PATH.exists():
        raise ModelRuntimeUnavailable("模型权重不存在，请检查 backend/models 目录")
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise ModelRuntimeUnavailable(
            "推理依赖尚未安装，请在 backend 虚拟环境执行 pip install -r requirements-ml.txt"
        ) from exc
    with _model_lock:
        if _model is None:
            _model = YOLO(str(WEIGHTS_PATH))
    return _model


def predict_image(content: bytes, suffix: str, confidence: float, iou: float, *, profile: str = "baseline") -> dict[str, Any]:
    started = perf_counter()
    validate_visual_input(content, suffix, confidence, iou)
    model = _load_model()
    card = _read_json(MODEL_CARD_PATH)
    class_names = card.get("class_names", [])
    policy = inference_profile(profile, int(card.get("image_size", 416)))
    temp_path: Path | None = None
    try:
        with NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary.write(content)
            temp_path = Path(temporary.name)
        with _model_lock:
            result = model.predict(
                source=str(temp_path),
                **policy,
                conf=confidence,
                iou=iou,
                device="cpu",
                verbose=False,
            )[0]
        height, width = map(int, result.orig_shape)
        detections, rejected = serialize_detections(result, class_names)
        return {
            "modelId": card.get("model_id", "sentinel_rgbt_yolo11n_v1"),
            "weightsSha256": card.get("weights_sha256"),
            "modality": "THERMAL_ONLY",
            "image": {"width": width, "height": height},
            "parameters": {"confidence": confidence, "iou": iou, "profile": profile, **policy},
            "detections": detections,
            "count": len(detections),
            "rejectedDetections": rejected,
            "elapsedMs": round((perf_counter() - started) * 1000, 2),
            "reviewRequired": True,
        }
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
