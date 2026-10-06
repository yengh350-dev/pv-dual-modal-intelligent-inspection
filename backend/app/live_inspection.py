import base64
import hashlib
import io
import math
from datetime import datetime, timezone
from threading import Lock
from typing import Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field, ConfigDict
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select, update
from sqlalchemy.orm import Session, defer
from starlette.concurrency import run_in_threadpool

from .database import get_db
from .models import AuditLog, LiveObservation, Mission, User, WorkOrder, WorkOrderWorkflow
from .model_runtime import predict_image, ModelRuntimeUnavailable
from .multimodel_runtime import predict_visible_defect, MultiModelRuntimeUnavailable
from .security import current_user, require_roles
from .work_order_workflow import default_details
from .vision_geometry import open_raster

router = APIRouter(prefix="/api/v1/live", tags=["视频巡检"])
snapshot_lock = Lock()
MAX_IMAGE_BYTES = 2 * 1024 * 1024


def utc_iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat() if value.tzinfo is None else value.astimezone(timezone.utc).isoformat()


def observation_data(row, include_image=False):
    result = {"id": row.id, "missionId": row.mission_id, "sourceKind": row.source_kind,
              "sourceName": row.source_name, "modality": row.modality, "mediaTime": row.media_time,
              "capturedAt": utc_iso(row.captured_at), "createdAt": utc_iso(row.created_at),
              "count": row.prediction.get("count", 0), "modelId": row.prediction.get("modelId"),
              "workOrderId": row.work_order_id, "imageHash": row.image_hash}
    if include_image:
        mime = "image/png" if row.image.startswith(b"\x89PNG") else "image/jpeg"
        result.update(prediction=row.prediction, imageData=f"data:{mime};base64," + base64.b64encode(row.image).decode("ascii"))
    return result


def normalize_frame(content):
    try:
        with open_raster(content) as image:
            if image.width * image.height > 16_000_000:
                raise HTTPException(413, "帧尺寸过大，请缩小到 4096×4096 像素以内")
            image.load()
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((1600, 1600))
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=90)
            return output.getvalue()
    except (UnidentifiedImageError, SyntaxError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(422, "无法解码此帧，请使用有效的 JPEG 或 PNG") from exc


@router.get("/observations")
def list_observations(mission_id: Optional[str] = None, limit: int = Query(30, ge=1, le=100),
                      db: Session = Depends(get_db), _: User = Depends(current_user)):
    query = select(LiveObservation).options(defer(LiveObservation.image))
    if mission_id:
        query = query.where(LiveObservation.mission_id == mission_id)
    rows = db.scalars(query.order_by(LiveObservation.created_at.desc()).limit(limit)).all()
    return {"data": [observation_data(row) for row in rows]}


@router.get("/observations/{observation_id}")
def observation_detail(observation_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    row = db.get(LiveObservation, observation_id)
    if not row:
        raise HTTPException(404, "冻结帧不存在")
    return {"data": observation_data(row, True)}


@router.post("/observations", status_code=201)
async def save_observation(request: Request, image: UploadFile = File(...),
                           mission_id: str = Form(..., max_length=32),
                           source_kind: Literal["recording", "hls"] = Form(...),
                           source_name: str = Form(..., min_length=2, max_length=120),
                           modality: Literal["RGB", "THERMAL"] = Form(...),
                           media_time: float = Form(..., ge=0),
                           captured_at: datetime = Form(...),
                           confidence: float = Form(.4, ge=.05, le=.95),
                           db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "operator"))):
    if not db.get(Mission, mission_id):
        raise HTTPException(404, "请先选择平台内的有效任务")
    if not source_name.strip() or not math.isfinite(media_time):
        raise HTTPException(422, "来源名称或视频时间无效")
    now = datetime.now(timezone.utc)
    if captured_at.tzinfo is None or abs((captured_at.astimezone(timezone.utc) - now).total_seconds()) > 300:
        raise HTTPException(422, "采样时间须包含时区，且须在当前时间前后五分钟内")
    if image.content_type not in {"image/jpeg", "image/png"}:
        raise HTTPException(415, "仅支持 JPEG 或 PNG")
    content = await image.read(MAX_IMAGE_BYTES + 1)
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "冻结帧须为非空且小于 2 MB 的图像")
    if not snapshot_lock.acquire(blocking=False):
        raise HTTPException(429, "另一个冻结帧正在分析，请稍后重试")
    try:
        normalized = await run_in_threadpool(normalize_frame, content)
        predictor = predict_image if modality == "THERMAL" else predict_visible_defect
        try:
            prediction = await run_in_threadpool(predictor, normalized, ".jpg", confidence, .7)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except (ModelRuntimeUnavailable, MultiModelRuntimeUnavailable) as exc:
            raise HTTPException(503, str(exc)) from exc
        row = LiveObservation(id="OBS-" + uuid4().hex[:20], actor_id=user.id,
                              mission_id=mission_id, source_kind=source_kind, source_name=source_name.strip(),
                              modality=modality, media_time=media_time, captured_at=captured_at.astimezone(timezone.utc),
                              image=normalized, image_hash=hashlib.sha256(normalized).hexdigest(), prediction=prediction)
        db.add(row)
        db.add(AuditLog(actor_id=user.id, action="live.snapshot", resource_type="live_observation",
                        resource_id=row.id, detail=f"{mission_id}; {modality}; {prediction['modelId']}",
                        request_id=getattr(request.state, "request_id", None)))
        db.commit()
        return {"data": observation_data(row, True)}
    finally:
        snapshot_lock.release()


class DispatchObservation(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    detection_index: int = Field(ge=0)
    location: str = Field(min_length=3, max_length=120)
    review_note: str = Field(min_length=5, max_length=2000)
    owner: str = Field(min_length=2, max_length=80)
    reviewer: str = Field(min_length=2, max_length=80)
    priority: Literal["紧急", "高", "中", "低"] = "中"
    due_at: datetime


@router.post("/observations/{observation_id}/dispatch")
def dispatch_observation(request: Request, observation_id: str, payload: DispatchObservation,
                         db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "operator"))):
    row = db.get(LiveObservation, observation_id)
    if not row:
        raise HTTPException(404, "冻结帧不存在")
    if row.work_order_id:
        return {"data": {"id": row.work_order_id, "existing": True}}
    if payload.owner == payload.reviewer:
        raise HTTPException(422, "执行与验收负责人不能相同")
    if payload.due_at.tzinfo is None or payload.due_at <= datetime.now(timezone.utc):
        raise HTTPException(422, "截止时间须包含时区且晚于当前时间")
    detections = row.prediction.get("detections", [])
    if payload.detection_index >= len(detections):
        raise HTTPException(422, "请选择冻结帧上的有效候选框")
    detection = detections[payload.detection_index]
    order_id = "WO-" + datetime.now(timezone.utc).strftime("%y%m%d") + "-" + uuid4().hex[:6].upper()
    db.add(WorkOrder(id=order_id, title=f"现场复核：{payload.location} · {detection['className']}"[:180],
                     owner=payload.owner, priority=payload.priority, status="已派发",
                     due_at=payload.due_at.astimezone(timezone.utc), anomaly_id=None))
    db.flush()
    # Claim this observation atomically, so parallel confirmations create one order.
    claimed = db.execute(update(LiveObservation).where(
        LiveObservation.id == row.id, LiveObservation.work_order_id.is_(None)
    ).values(work_order_id=order_id))
    if claimed.rowcount != 1:
        db.rollback()
        current = db.get(LiveObservation, observation_id)
        return {"data": {"id": current.work_order_id, "existing": True}}
    requirements = (f"视频冻结帧 {row.id}；任务 {row.mission_id}；来源 {row.source_name}（{row.source_kind}）。\n"
                    f"人工定位：{payload.location}；候选：{detection['className']}；模型分数 {detection['confidence']:.3f}。\n"
                    f"复核：{payload.review_note}\n单帧模型候选不构成故障诊断，须现场复测。无辐射测温与自动地理定位。")
    db.add(WorkOrderWorkflow(work_order_id=order_id, revision=1,
        details={**default_details(), "reviewer": payload.reviewer, "requirements": requirements,
                 "liveObservationId": row.id}))
    db.add(AuditLog(actor_id=user.id, action="live.dispatch", resource_type="work_order",
                   resource_id=order_id, detail=f"observation={row.id}; manual_location={payload.location}; detection={payload.detection_index}",
                   request_id=getattr(request.state, "request_id", None)))
    db.commit()
    return {"data": {"id": order_id, "existing": False}}
