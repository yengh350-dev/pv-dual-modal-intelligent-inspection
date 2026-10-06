"""Quality-gated spatial evidence association, not a learned fusion classifier."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

timestamp_adapter = TypeAdapter(datetime)


def capture_datetime(value):
    return timestamp_adapter.validate_python(value)


class FrameMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    source_kind: Literal["recording", "hls", "upload"] = "upload"
    source_name: str = Field(default="上传原图", min_length=1, max_length=120)
    captured_at: Optional[datetime] = None
    timestamp_kind: Literal["device_capture", "browser_sample", "unknown"] = "unknown"
    clock_id: Optional[str] = Field(default=None, min_length=1, max_length=80)
    media_time: float = Field(default=0, ge=0)

    @model_validator(mode="after")
    def timezone_required(self):
        if self.captured_at is not None and self.captured_at.tzinfo is None:
            raise ValueError("采样时间必须包含时区")
        if self.timestamp_kind != "unknown" and self.captured_at is None:
            raise ValueError("请提供采样时间")
        if self.timestamp_kind == "device_capture" and not self.clock_id:
            raise ValueError("设备时间必须声明时钟标识")
        return self


class Registration(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    homography: Optional[list[float]] = Field(default=None, min_length=9, max_length=9)
    reference: Optional[str] = Field(default=None, min_length=3, max_length=160)
    rmse_px: Optional[float] = Field(default=None, ge=0, le=1000)


def associate_evidence(rgb: dict, thermal: dict, rgb_meta: dict, thermal_meta: dict, registration: dict) -> dict:
    import cv2
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    reasons = []
    skew = None
    if (rgb_meta.get("timestamp_kind") != "device_capture" or
            thermal_meta.get("timestamp_kind") != "device_capture" or
            not rgb_meta.get("clock_id") or rgb_meta.get("clock_id") != thermal_meta.get("clock_id")):
        reasons.append("CAPTURE_CLOCK_UNVERIFIED")
    else:
        skew = abs((capture_datetime(rgb_meta["captured_at"]) -
                    capture_datetime(thermal_meta["captured_at"])).total_seconds()) * 1000
        if skew > 120:
            reasons.append("CAPTURE_SKEW_EXCEEDED")
    if not registration.get("reference") or registration.get("rmse_px") is None:
        reasons.append("REGISTRATION_UNVERIFIED")
    elif registration["rmse_px"] > 3:
        reasons.append("REGISTRATION_ERROR_EXCEEDED")
    matrix = registration.get("homography")
    if matrix is None:
        reasons.append("MAPPING_MISSING")
    else:
        matrix = np.asarray(matrix, dtype=np.float64).reshape(3, 3)
        scale = np.max(np.abs(matrix))
        if not np.isfinite(matrix).all() or scale == 0:
            reasons.append("MAPPING_DEGENERATE")
        else:
            matrix = matrix / scale
            if np.linalg.cond(matrix) > 1e8:
                reasons.append("MAPPING_DEGENERATE")
            # Check the whole normalized source plane; a pole inside it is invalid.
            corners = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float64)
            denominator = corners @ matrix[2, :2] + matrix[2, 2]
            if denominator.min() <= 1e-8 and denominator.max() >= -1e-8:
                reasons.append("MAPPING_POLE")
    base = {"version": "spatial-association-1.0", "captureSkewMs": skew,
            "registrationRmsePx": registration.get("rmse_px"), "matches": [],
            "reviewRequired": True, "boundary": "仅关联空间位置；不同类别与置信度不合并，不确认故障、温度或地理位置。",
            "registrationSource": "用户声明的标定，非平台独立验证"}
    rd, td = rgb.get("detections", []), thermal.get("detections", [])
    if reasons:
        return {**base, "state": "held", "reasons": reasons,
                "unmatchedRgb": list(range(len(rd))), "unmatchedThermal": list(range(len(td)))}

    def rectangle(item):
        b = item["boxNormalized"]
        x, y, w, h = b["x"], b["y"], b["width"], b["height"]
        return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float32)

    scores = np.zeros((len(rd), len(td)), dtype=np.float64)
    rejected = []
    for i, item in enumerate(rd):
        polygon = cv2.perspectiveTransform(rectangle(item)[None].astype(np.float64), matrix)[0].astype(np.float32)
        if not np.isfinite(polygon).all() or (polygon < 0).any() or (polygon > 1).any() or not cv2.isContourConvex(polygon):
            rejected.append(i)
            continue
        area = abs(cv2.contourArea(polygon))
        for j, other in enumerate(td):
            target = rectangle(other)
            overlap, _ = cv2.intersectConvexConvex(polygon, target)
            union = area + abs(cv2.contourArea(target)) - overlap
            scores[i, j] = max(0., min(1., overlap / union)) if union > 1e-12 else 0.
    # Dummy columns allow unmatched evidence; maximize only admissible matches.
    costs = np.zeros((len(rd), len(td) + len(rd)))
    costs[:, :len(td)] = np.where(scores >= .2, -scores, 1.)
    rows, columns = linear_sum_assignment(costs)
    matches = [{"rgbIndex": int(i), "thermalIndex": int(j), "spatialIoU": round(float(scores[i, j]), 6)}
               for i, j in zip(rows, columns) if j < len(td) and scores[i, j] >= .2]
    return {**base, "state": "associated", "reasons": [], "matches": matches,
            "rejectedMappingRgb": rejected,
            "unmatchedRgb": [i for i in range(len(rd)) if all(m["rgbIndex"] != i for m in matches)],
            "unmatchedThermal": [i for i in range(len(td)) if all(m["thermalIndex"] != i for m in matches)]}
