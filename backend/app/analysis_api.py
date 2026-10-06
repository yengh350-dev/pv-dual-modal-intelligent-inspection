import hashlib
import json
from threading import Lock
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, defer
from starlette.concurrency import run_in_threadpool
from PIL import UnidentifiedImageError, Image

from .database import get_db
from .security import current_user, require_roles
from .models import AnalysisTask, AuditLog, EvidenceFrame, EvidencePair, LiveObservation, Mission, User, new_id, utcnow
from .evidence_fusion import FrameMetadata, Registration
from .analysis_worker import canonical_image, inference_slot, MAX_ATTEMPTS
from .model_runtime import predict_image, ModelRuntimeUnavailable
from .multimodel_runtime import predict_visible_defect, MultiModelRuntimeUnavailable
from .live_inspection import observation_data, utc_iso

router = APIRouter(prefix="/api/v1/analysis", tags=["证据分析任务"])
admission_lock = Lock()
ACTIVE = ["queued", "running", "cancel_requested"]
MAX_BYTES = 8 * 1024 * 1024


def task_data(row, detail=False):
    data = {"id": row.id, "missionId": row.mission_id, "state": row.state, "attempts": row.attempts,
            "createdAt": utc_iso(row.created_at), "startedAt": utc_iso(row.started_at) if row.started_at else None,
            "completedAt": utc_iso(row.completed_at) if row.completed_at else None,
            "observationId": row.observation_id, "error": row.error, "paired": bool(row.pair_id)}
    if detail:
        data.update(config=row.config, result=row.result, inputDigest=row.input_digest)
    return data


async def read_image(image: UploadFile):
    content = await image.read(MAX_BYTES + 1)
    if not content or len(content) > MAX_BYTES:
        raise HTTPException(413, "每张原图须为非空且不超过 8 MB")
    try:
        canonical, width, height = await run_in_threadpool(canonical_image, content)
    except (ValueError, UnidentifiedImageError, Image.DecompressionBombError, SyntaxError, OSError) as exc:
        raise HTTPException(422, "无法解码原图，请使用不超过 1600 万像素的 JPEG / PNG") from exc
    return content, canonical, width, height


@router.post("/preview")
async def preview(image: UploadFile = File(...), modality: Literal["THERMAL", "RGB"] = Form(...),
                  confidence: float = Form(.4, ge=.05, le=.95), _: User = Depends(require_roles("admin", "operator"))):
    if not inference_slot.acquire(blocking=False):
        raise HTTPException(429, "检测服务忙，已跳过本次预览采样", headers={"Retry-After": "1"})
    try:
        _, content, _, _ = await read_image(image)
        predictor = predict_image if modality == "THERMAL" else predict_visible_defect
        try:
            result = await run_in_threadpool(predictor, content, ".png", confidence, .7, profile="preview")
        except (ValueError, ModelRuntimeUnavailable, MultiModelRuntimeUnavailable) as exc:
            raise HTTPException(503, "预览模型暂不可用，请检查权重与推理依赖") from exc
        return {"data": {**result, "provisional": True, "persisted": False}}
    finally:
        inference_slot.release()


@router.post("/tasks", status_code=202)
async def create_task(request: Request, image: UploadFile = File(...), paired_image: Optional[UploadFile] = File(None),
                      mission_id: str = Form(..., max_length=32), modality: Literal["RGB", "THERMAL"] = Form(...),
                      confidence: float = Form(.4, ge=.05, le=.95), idempotency_key: str = Form(..., min_length=8, max_length=64),
                      metadata: str = Form("{}", max_length=4096), paired_metadata: str = Form("{}", max_length=4096),
                      registration: str = Form("{}", max_length=4096), db: Session = Depends(get_db),
                      user: User = Depends(require_roles("admin", "operator"))):
    if not db.get(Mission, mission_id):
        raise HTTPException(404, "请选择平台内的有效任务")
    if not idempotency_key.strip():
        raise HTTPException(422, "请求标识不能为空")
    try:
        meta = FrameMetadata.model_validate_json(metadata).model_dump(mode="json")
        pair_meta = FrameMetadata.model_validate_json(paired_metadata).model_dump(mode="json")
        mapping = Registration.model_validate_json(registration).model_dump(mode="json")
    except ValidationError as exc:
        raise HTTPException(422, "采样或配准元数据无效，请检查时间、时钟和矩阵字段") from exc
    primary, _, width, height = await read_image(image)
    other = await read_image(paired_image) if paired_image else None
    digest = hashlib.sha256(json.dumps({"mission": mission_id, "modality": modality, "confidence": confidence,
        "metadata": meta, "pairedMetadata": pair_meta if other else None, "registration": mapping if other else None,
        "image": hashlib.sha256(primary).hexdigest(),
        "pairedImage": hashlib.sha256(other[0]).hexdigest() if other else None}, sort_keys=True).encode()).hexdigest()
    if other and hashlib.sha256(primary).digest() == hashlib.sha256(other[0]).digest():
        raise HTTPException(422, "配对图像不能是同一张文件；请提供实际对应的 RGB 与热红外图")
    scope = user.id + ":" + idempotency_key

    def existing():
        row = db.scalar(select(AnalysisTask).where(AnalysisTask.idempotency_scope == scope))
        if row:
            if row.input_digest != digest:
                raise HTTPException(409, "同一请求标识已用于不同证据，请重新发起提交")
            return {"data": task_data(row), "existing": True}
        return None

    with admission_lock:
        previous = existing()
        if previous:
            return previous
        active = db.scalar(select(func.count()).select_from(AnalysisTask).where(AnalysisTask.state.in_(ACTIVE)))
        own = db.scalar(select(func.count()).select_from(AnalysisTask).where(AnalysisTask.state.in_(ACTIVE), AnalysisTask.actor_id == user.id))
        if active >= 32 or own >= 8:
            raise HTTPException(429, "分析队列已满，请等待任务完成后重试", headers={"Retry-After": "5"})
        frame = EvidenceFrame(id=new_id(), mission_id=mission_id, modality=modality, image=primary,
            sha256=hashlib.sha256(primary).hexdigest(), width=width, height=height, metadata_json=meta)
        db.add(frame)
        pair = None
        if other:
            second = EvidenceFrame(id=new_id(), mission_id=mission_id, modality="RGB" if modality == "THERMAL" else "THERMAL",
                image=other[0], sha256=hashlib.sha256(other[0]).hexdigest(), width=other[2], height=other[3], metadata_json=pair_meta)
            db.add(second)
            db.flush()
            pair = EvidencePair(id=new_id(), rgb_frame_id=frame.id if modality == "RGB" else second.id,
                thermal_frame_id=frame.id if modality == "THERMAL" else second.id, registration=mapping)
            db.add(pair)
        db.flush()
        row = AnalysisTask(id=new_id(), actor_id=user.id, mission_id=mission_id, frame_id=frame.id,
            pair_id=pair.id if pair else None, idempotency_scope=scope, input_digest=digest,
            config={"profile": "precision", "confidence": confidence, "iou": .7, "resolutionPolicy": "model_native_validated"})
        db.add(row)
        db.add(AuditLog(actor_id=user.id, action="analysis.enqueue", resource_type="analysis_task", resource_id=row.id,
            detail="原图证据；已验证的模型原生配置", request_id=getattr(request.state, "request_id", None)))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            previous = existing()
            if previous:
                return previous
            raise
        return {"data": task_data(row)}


@router.get("/tasks")
def list_tasks(mission_id: Optional[str] = None, limit: int = Query(50, ge=1, le=100),
               db: Session = Depends(get_db), _: User = Depends(current_user)):
    query = select(AnalysisTask).options(defer(AnalysisTask.result))
    if mission_id:
        query = query.where(AnalysisTask.mission_id == mission_id)
    rows = db.scalars(query.order_by(AnalysisTask.created_at.desc()).limit(limit)).all()
    return {"data": [task_data(row) for row in rows]}


def find_task(db, task_id):
    row = db.get(AnalysisTask, task_id)
    if row is None:
        raise HTTPException(404, "分析任务不存在")
    return row


@router.get("/tasks/{task_id}")
def detail(task_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    row = find_task(db, task_id)
    data = task_data(row, True)
    if row.observation_id:
        observation = db.get(LiveObservation, row.observation_id)
        data["observation"] = observation_data(observation, True)
    return {"data": data}


@router.get("/tasks/{task_id}/export")
def export(task_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    row = find_task(db, task_id)
    if row.state != "succeeded":
        raise HTTPException(409, "仅可导出已完成的分析结果")
    data = task_data(row, True)
    if row.observation_id:
        observation = db.get(LiveObservation, row.observation_id)
        data["review"] = {"observationId": observation.id, "workOrderId": observation.work_order_id}
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="analysis-{row.id}.json"'})


@router.post("/tasks/{task_id}/{action}")
def transition(task_id: str, action: Literal["cancel", "retry"], db: Session = Depends(get_db),
               user: User = Depends(require_roles("admin", "operator"))):
    row = find_task(db, task_id)
    if user.role != "admin" and row.actor_id != user.id:
        raise HTTPException(403, "只能管理本人提交的分析任务")
    if action == "cancel":
        if row.state not in ACTIVE:
            if row.state == "cancelled":
                return {"data": task_data(row)}
            raise HTTPException(409, "此任务已结束，无法取消")
        target = "cancelled" if row.state == "queued" else "cancel_requested"
        values = {"state": target}
        if target == "cancelled":
            values["completed_at"] = utcnow()
    else:
        if row.state != "failed" or row.attempts >= MAX_ATTEMPTS:
            raise HTTPException(409, "仅失败且未达到三次执行上限的任务可重试")
        target = "queued"
        values = {"state": target, "error": None, "result": None, "completed_at": None}
    with admission_lock:
        if action == "retry":
            active = db.scalar(select(func.count()).select_from(AnalysisTask).where(AnalysisTask.state.in_(ACTIVE)))
            own = db.scalar(select(func.count()).select_from(AnalysisTask).where(AnalysisTask.state.in_(ACTIVE), AnalysisTask.actor_id == row.actor_id))
            if active >= 32 or own >= 8:
                raise HTTPException(429, "分析队列已满，请稍后重试", headers={"Retry-After": "5"})
        changed = db.execute(update(AnalysisTask).where(AnalysisTask.id == task_id, AnalysisTask.state == row.state).values(**values))
        if changed.rowcount != 1:
            db.rollback()
            raise HTTPException(409, "任务状态已改变，请刷新")
        db.add(AuditLog(actor_id=user.id, action="analysis." + action, resource_type="analysis_task", resource_id=task_id))
        db.commit()
    db.refresh(row)
    return {"data": task_data(row)}
