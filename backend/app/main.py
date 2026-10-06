from contextlib import asynccontextmanager
from collections import defaultdict
from datetime import datetime, timezone
import logging
from time import perf_counter
from typing import Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import get_settings
from .ai_gateway import ProviderUnavailable, chat_with_provider, default_provider_id, public_provider_catalog
from .database import Base, SessionLocal, engine, get_db
from .decision_engine import evaluate_evidence, evaluate_mission_quality
from .models import Anomaly, AuditLog, Mission, User, WorkOrder, WorkOrderWorkflow
from .work_order_workflow import default_details, validate_update
from .model_runtime import ModelRuntimeUnavailable, model_manifest, predict_image
from .multimodel_runtime import MultiModelRuntimeUnavailable, model_catalog, predict_cell_image, predict_fault_csv, predict_panel_segmentation, predict_power, predict_visible_defect
from .schemas import AnomalyStatus, ChatRequest, EvidenceEvaluationRequest, LoginRequest, MissionCreate, MissionManifest, MissionStatus, PowerPredictionRequest, RefreshRequest, Severity, WorkOrderCreate, WorkOrderUpdate
from .security import create_token, current_user, decode_token, require_roles, verify_password
from .seed import seed_database
from .live_inspection import router as live_router
from .workspace import router as workspace_router
from .analysis_api import router as analysis_router
from .analysis_worker import AnalysisWorker

settings = get_settings()
limiter = Limiter(key_func=get_remote_address)
logger = logging.getLogger("sentinel-rgbt")


async def rate_limit_error(request: Request, _: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": "60"},
        content={"error": {"code": "RATE_LIMITED", "message": "请求过于频繁，请稍后重试"}, "requestId": getattr(request.state, "request_id", None)},
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    if settings.app_env.lower() not in {"production", "prod"}:
        with SessionLocal() as db:
            seed_database(db)
    worker = AnalysisWorker(SessionLocal)
    worker.start()
    try:
        yield
    finally:
        worker.close()


app = FastAPI(
    title="Sentinel RGBT API",
    version="1.0.0",
    description="RGB-Thermal 光伏无人机巡检参考后端。演示接口不直接控制飞行器。",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.include_router(live_router)
app.include_router(workspace_router)
app.include_router(analysis_router)
app.add_exception_handler(RateLimitExceeded, rate_limit_error)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    provided_id = request.headers.get("X-Request-ID", "")
    request_id = provided_id if 0 < len(provided_id) <= 80 and all(c.isalnum() or c in "-_." for c in provided_id) and provided_id.isascii() else str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content=jsonable_encoder({"error": {"code": "VALIDATION_ERROR", "message": "请求参数不符合接口约定", "details": exc.errors()}, "requestId": getattr(request.state, "request_id", None)}))


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    code = {
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        422: "UNPROCESSABLE_ENTITY",
        502: "UPSTREAM_UNAVAILABLE",
    }.get(exc.status_code, "REQUEST_FAILED")
    return JSONResponse(
        status_code=exc.status_code,
        headers=exc.headers,
        content={"error": {"code": code, "message": str(exc.detail)}, "requestId": getattr(request.state, "request_id", None)},
    )


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    logger.exception("Unhandled request error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "系统暂时无法完成请求"}, "requestId": getattr(request.state, "request_id", None)},
    )


def envelope(data, **meta):
    return {"data": data, "meta": meta or None}


def audit(db: Session, user: Optional[User], action: str, resource_type: str, resource_id: Optional[str] = None, detail: str = "", request_id: Optional[str] = None):
    db.add(AuditLog(actor_id=user.id if user else None, action=action, resource_type=resource_type, resource_id=resource_id, detail=detail, request_id=request_id))
    db.commit()


def resource_id(prefix: str) -> str:
    return f"{prefix}-{datetime.now():%y%m%d}-{uuid4().hex[:6].upper()}"


ANOMALY_TRANSITIONS = {
    "待复核": {"已确认", "已排除", "需复飞", "已转工单"},
    "已确认": {"已转工单", "需复飞", "已排除"},
    "需复飞": {"待复核", "已排除"},
    "已转工单": {"已确认"},
    "已排除": {"待复核"},
}
WORK_ORDER_TRANSITIONS = {
    "待排程": {"已派发", "已取消"},
    "已派发": {"处理中", "已取消"},
    "处理中": {"待验收", "已取消"},
    "待验收": {"处理中", "已关闭"},
    "已关闭": set(),
    "已取消": set(),
}

# Demo quality summaries mirror the replay fixtures used by the frontend. In a
# production adapter these fields must be computed from timestamped telemetry,
# camera events and immutable media manifests rather than accepted from clients.
MISSION_QUALITY = {
    "MSN-240905-042": {
        "crossTrackP95M": 0.32, "crossTrackMaxM": 0.84,
        "crossTrackSeriesM": [0.18, 0.22, 0.28, 0.31, 0.26, 0.19, 0.24, 0.37, 0.29, 0.32, 0.21, 0.27, 0.34, 0.25, 0.20, 0.23],
        "rtkFixRatePct": 99.4, "altitudeP95M": 0.9, "geotagP95M": 0.11,
        "rgbThermalPairRatePct": 98.2, "pairTimeSkewP95Ms": 42, "minimumViewAngleDeg": 72,
        "sampleCount": 4286, "source": "演示任务日志重放", "computedAt": "2024-09-05T10:24:18+08:00",
    },
    "MSN-240904-041": {
        "crossTrackP95M": 0.18, "crossTrackMaxM": 0.49,
        "crossTrackSeriesM": [0.11, 0.14, 0.16, 0.12, 0.18, 0.15, 0.13, 0.17, 0.20, 0.16, 0.12, 0.14, 0.19, 0.15, 0.13, 0.12],
        "rtkFixRatePct": 99.8, "altitudeP95M": 0.7, "geotagP95M": 0.09,
        "rgbThermalPairRatePct": 99.1, "pairTimeSkewP95Ms": 28, "minimumViewAngleDeg": 69,
        "sampleCount": 3180, "source": "演示复飞任务日志重放", "computedAt": "2024-09-04T15:02:31+08:00",
    },
    "MSN-240903-040": {
        "crossTrackP95M": 1.82, "crossTrackMaxM": 4.60,
        "crossTrackSeriesM": [0.42, 0.55, 0.72, 1.18, 1.64, 2.08, 1.72, 2.35, 1.88, 2.74, 1.92, 1.46, 2.12, 1.70, 1.28, 0.96],
        "rtkFixRatePct": 63.4, "altitudeP95M": 1.9, "geotagP95M": 1.60,
        "rgbThermalPairRatePct": 92.8, "pairTimeSkewP95Ms": 86, "minimumViewAngleDeg": 56,
        "sampleCount": 2954, "source": "演示雨后专项任务日志重放", "computedAt": "2024-09-03T11:06:42+08:00",
    },
    "MSN-240902-038": {
        "crossTrackP95M": 0.46, "crossTrackMaxM": 1.34,
        "crossTrackSeriesM": [0.22, 0.31, 0.38, 0.42, 0.35, 0.48, 0.44, 0.39, 0.51, 0.46, 0.41, 0.36, 0.45, 0.43, 0.34, 0.29],
        "rtkFixRatePct": 96.8, "altitudeP95M": 1.5, "geotagP95M": 0.15,
        "rgbThermalPairRatePct": 97.6, "pairTimeSkewP95Ms": 51, "minimumViewAngleDeg": 64,
        "sampleCount": 1864, "source": "演示山地任务日志重放", "computedAt": "2024-09-02T10:41:09+08:00",
    },
}


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.app_env, "time": datetime.now(timezone.utc).isoformat()}


@app.post("/api/v1/auth/login")
@limiter.limit("10/minute")
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash) or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邮箱或密码不正确")
    audit(db, user, "auth.login", "user", user.id, request_id=request.state.request_id)
    return envelope({
        "accessToken": create_token(user, "access"),
        "refreshToken": create_token(user, "refresh"),
        "tokenType": "bearer",
        "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role},
    })


@app.post("/api/v1/auth/refresh")
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    token = decode_token(payload.refresh_token, "refresh")
    user = db.get(User, token["sub"])
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="刷新凭据不可用")
    return envelope({"accessToken": create_token(user, "access"), "tokenType": "bearer"})


@app.get("/api/v1/auth/me")
def me(user: User = Depends(current_user)):
    return envelope({"id": user.id, "name": user.name, "email": user.email, "role": user.role, "isActive": user.is_active})


@app.get("/api/v1/missions")
def list_missions(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), status_filter: Optional[MissionStatus] = Query(None, alias="status"), q: Optional[str] = Query(None, max_length=100), site: Optional[str] = Query(None, max_length=120), db: Session = Depends(get_db), _: User = Depends(current_user)):
    query = select(Mission)
    count_query = select(func.count()).select_from(Mission)
    if status_filter:
        query = query.where(Mission.status == status_filter)
        count_query = count_query.where(Mission.status == status_filter)
    if site:
        query = query.where(Mission.site == site)
        count_query = count_query.where(Mission.site == site)
    if q and q.strip():
        from sqlalchemy import or_
        predicate = or_(*(field.icontains(q.strip(), autoescape=True) for field in (Mission.id, Mission.name, Mission.site, Mission.aircraft)))
        query = query.where(predicate)
        count_query = count_query.where(predicate)
    total = db.scalar(count_query) or 0
    rows = db.scalars(query.order_by(Mission.started_at.desc(), Mission.id).offset((page - 1) * page_size).limit(page_size)).all()
    data = [{"id": row.id, "name": row.name, "site": row.site, "aircraft": row.aircraft, "payload": row.payload, "status": row.status, "coverage": row.coverage, "quality": row.quality, "frames": row.frames, "startedAt": row.started_at.isoformat()} for row in rows]
    return envelope(data, page=page, pageSize=page_size, total=total)


@app.post("/api/v1/missions", status_code=201)
def create_mission(request: Request, payload: MissionCreate, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "operator", "pilot"))):
    mission_id = resource_id("MSN")
    mission = Mission(id=mission_id, name=payload.name, site=payload.site, aircraft=payload.aircraft, payload=payload.payload, status="计划中", coverage=0, quality=0, frames=0)
    db.add(mission)
    audit(db, user, "mission.create", "mission", mission.id, payload.name, request.state.request_id)
    db.refresh(mission)
    return envelope({"id": mission.id, "status": mission.status})


@app.get("/api/v1/missions/{mission_id}")
def mission_detail(mission_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    row = db.get(Mission, mission_id)
    if not row:
        raise HTTPException(404, "任务不存在")
    return envelope({"id": row.id, "name": row.name, "site": row.site, "aircraft": row.aircraft,
        "payload": row.payload, "status": row.status, "coverage": row.coverage, "quality": row.quality,
        "frames": row.frames, "startedAt": workflow_timestamp(row.started_at)})


@app.get("/api/v1/missions/{mission_id}/quality-gate")
def mission_quality_gate(mission_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    mission = db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="任务不存在")
    quality = MISSION_QUALITY.get(mission_id)
    if not quality:
        raise HTTPException(status_code=404, detail="该任务尚未生成飞行与证据质量摘要")
    return envelope({"missionId": mission_id, **quality, "decision": evaluate_mission_quality(quality)})


@app.get("/api/v1/anomalies")
def list_anomalies(severity: Optional[Severity] = None, state: Optional[AnomalyStatus] = Query(None, alias="status"), db: Session = Depends(get_db), _: User = Depends(current_user)):
    query = select(Anomaly)
    if severity: query = query.where(Anomaly.severity == severity)
    if state: query = query.where(Anomaly.status == state)
    rows = db.scalars(query.order_by(Anomaly.detected_at.desc())).all()
    return envelope([{"id": row.id, "missionId": row.mission_id, "type": row.type, "severity": row.severity, "array": row.array_code, "module": row.module_code, "deltaT": row.delta_t, "confidence": row.confidence, "alignment": row.alignment, "status": row.status, "detectedAt": row.detected_at.isoformat()} for row in rows], total=len(rows))


@app.post("/api/v1/analysis/evaluate")
def evaluate_anomaly_evidence(payload: EvidenceEvaluationRequest, _: User = Depends(current_user)):
    return envelope(evaluate_evidence(payload.model_dump()))


@app.patch("/api/v1/anomalies/{anomaly_id}")
def update_anomaly(request: Request, anomaly_id: str, status_value: AnomalyStatus = Query(..., alias="status"), reason: Optional[str] = Query(None, max_length=2000), db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "operator", "researcher"))):
    row = db.get(Anomaly, anomaly_id)
    if not row: raise HTTPException(status_code=404, detail="异常事件不存在")
    if status_value != row.status and status_value not in ANOMALY_TRANSITIONS.get(row.status, set()):
        raise HTTPException(status_code=409, detail=f"异常状态不能从“{row.status}”直接变更为“{status_value}”")
    row.status = status_value; db.commit()
    audit(db, user, "anomaly.review", "anomaly", row.id, f"{status_value} · {reason}" if reason else status_value, request.state.request_id)
    return envelope({"id": row.id, "status": row.status})


@app.get("/api/v1/work-orders")
def list_work_orders(db: Session = Depends(get_db), _: User = Depends(current_user)):
    rows = db.scalars(select(WorkOrder).order_by(WorkOrder.created_at.desc())).all()
    workflows = {item.work_order_id: item for item in db.scalars(select(WorkOrderWorkflow)).all()}
    return envelope([serialize_work_order(row, workflows.get(row.id)) for row in rows], total=len(rows))


def workflow_timestamp(value):
    if value is None:
        return None
    # SQLite strips timezone information; workflow dates are stored in UTC.
    return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)).isoformat()


def serialize_work_order(row, workflow):
    return {
        "id": row.id, "anomalyId": row.anomaly_id, "title": row.title, "owner": row.owner,
        "priority": row.priority, "status": row.status,
        "dueAt": workflow_timestamp(row.due_at),
        "resolution": row.resolution or "", "createdAt": workflow_timestamp(row.created_at),
        "revision": workflow.revision if workflow else 0,
        **(workflow.details if workflow else default_details()),
    }


@app.get("/api/v1/work-orders/{work_order_id}")
def work_order_detail(work_order_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    row = db.get(WorkOrder, work_order_id)
    if not row:
        raise HTTPException(404, "工单不存在")
    history = db.scalars(select(AuditLog).where(
        AuditLog.resource_type == "work_order", AuditLog.resource_id == row.id
    ).order_by(AuditLog.created_at.asc())).all()
    return envelope({**serialize_work_order(row, db.get(WorkOrderWorkflow, row.id)),
                     "history": [{"action": item.action, "detail": item.detail,
                                  "createdAt": workflow_timestamp(item.created_at), "actorId": item.actor_id}
                                 for item in history]})


@app.post("/api/v1/work-orders", status_code=201)
def create_work_order(request: Request, payload: WorkOrderCreate, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "operator"))):
    anomaly = None
    if payload.anomaly_id:
        anomaly = db.get(Anomaly, payload.anomaly_id)
        if not anomaly:
            raise HTTPException(status_code=404, detail="关联的异常事件不存在")
        if anomaly.status == "已排除":
            raise HTTPException(status_code=409, detail="已排除的异常不能直接创建工单，请先恢复为待复核状态")
        if anomaly.status not in {"已确认", "已转工单"}:
            raise HTTPException(status_code=409, detail="异常必须先完成人工复核并确认为有效，才能创建处置工单")
        duplicate = db.scalar(select(WorkOrder).where(WorkOrder.anomaly_id == payload.anomaly_id, WorkOrder.status.not_in(["已关闭", "已取消"])))
        if duplicate:
            raise HTTPException(status_code=409, detail=f"该异常已有未关闭工单 {duplicate.id}")
    values = payload.model_dump(exclude={"reviewer", "requirements", "initial_status"})
    if values.get("due_at") is not None:
        value = values["due_at"]
        values["due_at"] = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    row = WorkOrder(id=resource_id("WO"), status=payload.initial_status, **values)
    if anomaly:
        anomaly.status = "已转工单"
    db.add(row)
    db.flush()
    details = {**default_details(), "reviewer": payload.reviewer, "requirements": payload.requirements}
    db.add(WorkOrderWorkflow(work_order_id=row.id, revision=1, details=details))
    db.add(AuditLog(actor_id=user.id, action="work_order.create", resource_type="work_order",
                    resource_id=row.id, detail=row.title, request_id=request.state.request_id))
    db.commit(); db.refresh(row)
    return envelope({"id": row.id, "status": row.status})


@app.patch("/api/v1/work-orders/{work_order_id}")
def update_work_order(request: Request, work_order_id: str, payload: WorkOrderUpdate, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "operator"))):
    row = db.get(WorkOrder, work_order_id)
    if not row: raise HTTPException(status_code=404, detail="工单不存在")
    if payload.status and payload.status != row.status and payload.status not in WORK_ORDER_TRANSITIONS.get(row.status, set()):
        raise HTTPException(status_code=409, detail=f"工单状态不能从“{row.status}”直接变更为“{payload.status}”")
    workflow = db.get(WorkOrderWorkflow, row.id)
    revision = workflow.revision if workflow else 0
    if payload.expected_revision is not None and payload.expected_revision != revision:
        raise HTTPException(409, "工单已被其他人员更新，请刷新后核对再保存")
    details = validate_update(row, workflow.details if workflow else default_details(), payload)
    if workflow:
        result = db.execute(update(WorkOrderWorkflow).where(
            WorkOrderWorkflow.work_order_id == row.id, WorkOrderWorkflow.revision == revision
        ).values(revision=revision + 1, details=details))
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(409, "工单存在并发更新，请刷新后重试")
    else:
        db.add(WorkOrderWorkflow(work_order_id=row.id, revision=1, details=details))
        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(409, "工单存在并发更新，请刷新后重试") from exc
    for key, value in payload.model_dump(exclude_none=True, include={"status", "owner", "resolution"}).items():
        setattr(row, key, value)
    db.add(AuditLog(actor_id=user.id, action="work_order.update", resource_type="work_order",
                    resource_id=row.id, detail=str(payload.model_dump(exclude_none=True)), request_id=request.state.request_id))
    db.commit()
    return envelope(serialize_work_order(row, db.get(WorkOrderWorkflow, row.id)))


@app.get("/api/v1/audit-logs")
def audit_logs(limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db), _: User = Depends(require_roles("admin", "auditor"))):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)).all()
    return envelope([{"id": row.id, "actorId": row.actor_id, "action": row.action, "resourceType": row.resource_type, "resourceId": row.resource_id, "detail": row.detail, "requestId": row.request_id, "createdAt": row.created_at.isoformat()} for row in rows], total=len(rows))


@app.get("/api/v1/integrations/drone/status")
def drone_integration_status(_: User = Depends(current_user)):
    return envelope({
        "mode": "evidence-ingestion",
        "controlEnabled": False,
        "supportedChannels": ["mission-package", "rest-adapter"],
        "requiredModalities": ["RGB", "THERMAL"],
        "safetyBoundary": "平台接收任务证据与遥测元数据，不直接发送飞控指令。",
    })


@app.get("/api/v1/system/readiness")
def system_readiness(db: Session = Depends(get_db), _: User = Depends(current_user)):
    checked_at = datetime.now(timezone.utc)
    started = perf_counter()
    database_status = "healthy"
    database_detail = "SQLite 数据库可读写连接正常。" if settings.database_url.startswith("sqlite") else "业务数据库连接正常。"
    try:
        db.execute(select(1))
    except Exception:
        database_status = "degraded"
        database_detail = "数据库连接失败，请检查连接配置和存储权限。"
    database_latency_ms = round((perf_counter() - started) * 1000, 1)
    duplicate_order_groups = []
    if database_status == "healthy":
        duplicate_order_groups = db.execute(
            select(WorkOrder.anomaly_id, func.count(WorkOrder.id))
            .where(WorkOrder.anomaly_id.is_not(None), WorkOrder.status.not_in(["已关闭", "已取消"]))
            .group_by(WorkOrder.anomaly_id)
            .having(func.count(WorkOrder.id) > 1)
        ).all()
    workflow_status = "degraded" if duplicate_order_groups else "healthy"
    workflow_detail = f"发现 {len(duplicate_order_groups)} 个异常关联了多张未关闭工单，请在工单中心合并处置。" if duplicate_order_groups else "异常、复核和工单状态关联一致。"
    vision_manifest = model_manifest()
    vision_ready = vision_manifest["artifact"]["runtimeReady"]
    services = [
        {"id": "database", "name": "业务数据库", "status": database_status, "latencyMs": database_latency_ms, "detail": database_detail},
        {"id": "auth", "name": "身份认证与 RBAC", "status": "healthy", "detail": "JWT 校验、角色权限和接口限流已启用。"},
        {"id": "drone", "name": "无人机证据适配器", "status": "demo", "detail": "支持任务包与 REST 适配；当前为只读演示，不下发飞控指令。"},
        {"id": "vision-model", "name": "热红外检测模型", "status": "healthy" if vision_ready else "degraded", "detail": "Sentinel Thermal YOLO11n v1 权重与推理依赖可用。" if vision_ready else "模型卡可读，但本地推理依赖或权重缺失。"},
        {"id": "ai", "name": "AI 推理服务", "status": "demo" if default_provider_id(settings) == "demo" else "healthy", "detail": "当前使用内置演示解释器。" if default_provider_id(settings) == "demo" else f"默认模型路由：{default_provider_id(settings)}。"},
        {"id": "storage", "name": "证据存储", "status": "demo", "detail": "演示资产可用；生产环境应接入对象存储、校验和与保留策略。"},
        {"id": "workflow", "name": "业务数据一致性", "status": workflow_status, "detail": workflow_detail},
    ]
    return envelope({
        "overall": "degraded" if database_status == "degraded" or workflow_status == "degraded" else "healthy",
        "checkedAt": checked_at.isoformat(),
        "services": services,
        "safetyBoundary": "平台健康不等于飞行器适航。起飞前仍须由飞手在厂商地面站确认电池、GNSS、遥控链路、禁飞区与天气。",
    })


@app.post("/api/v1/ingestion/manifests/validate")
def validate_mission_manifest(payload: MissionManifest, user: User = Depends(require_roles("admin", "operator", "pilot", "researcher"))):
    pairs = defaultdict(set)
    timestamps = defaultdict(dict)
    pair_modality_seen = set()
    duplicate_pair_modalities = []
    paths_seen = set()
    duplicate_paths = []
    for frame in payload.frames:
        pair_modality_key = (frame.pair_id, frame.modality)
        if pair_modality_key in pair_modality_seen:
            duplicate_pair_modalities.append({"pairId": frame.pair_id, "modality": frame.modality})
        pair_modality_seen.add(pair_modality_key)
        if frame.path in paths_seen:
            duplicate_paths.append(frame.path)
        paths_seen.add(frame.path)
        pairs[frame.pair_id].add(frame.modality)
        timestamps[frame.pair_id][frame.modality] = frame.timestamp

    incomplete = sorted(pair_id for pair_id, modalities in pairs.items() if modalities != {"RGB", "THERMAL"})
    drift_warnings = []
    for pair_id, pair_times in timestamps.items():
        if set(pair_times) == {"RGB", "THERMAL"}:
            drift_ms = abs((pair_times["RGB"] - pair_times["THERMAL"]).total_seconds() * 1000)
            if drift_ms > 500:
                drift_warnings.append({"pairId": pair_id, "timestampDriftMs": round(drift_ms, 1)})

    blockers = []
    if incomplete:
        blockers.append({"code": "INCOMPLETE_MODALITY_PAIRS", "pairIds": incomplete[:100]})
    if duplicate_pair_modalities:
        blockers.append({"code": "DUPLICATE_PAIR_MODALITY", "items": duplicate_pair_modalities[:100]})
    if duplicate_paths:
        blockers.append({"code": "DUPLICATE_FRAME_PATH", "paths": sorted(set(duplicate_paths))[:100]})
    result = {
        "missionId": payload.mission_id,
        "status": "ready" if not blockers else "blocked",
        "counts": {
            "frames": len(payload.frames),
            "pairs": len(pairs),
            "completePairs": sum(1 for modalities in pairs.values() if modalities == {"RGB", "THERMAL"}),
        },
        "blockers": blockers,
        "warnings": drift_warnings,
        "scope": "本接口只验证清单结构和配对，不验证像素内容、温度标定或适航性。",
    }
    return envelope(result)


@app.post("/api/v1/ai/chat")
@limiter.limit("30/minute")
async def ai_chat(request: Request, payload: ChatRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        result = await chat_with_provider(settings, payload.provider, payload.message, payload.context, payload.history)
    except ProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    audit(db=db, user=user, action="AI_CHAT", resource_type="ai_provider", resource_id=result["provider"], detail=f"model={result['model']}; mode={result['mode']}", request_id=getattr(request.state, "request_id", None))
    return envelope(result)


@app.get("/api/v1/ai/providers")
def ai_providers(_: User = Depends(current_user)):
    return envelope({"providers": public_provider_catalog(settings), "defaultProvider": default_provider_id(settings)})


@app.get("/api/v1/models/current")
def current_detection_model(_: User = Depends(current_user)):
    return envelope(model_manifest())


@app.get("/api/v1/models")
def registered_models(_: User = Depends(current_user)):
    return envelope(model_catalog())


@app.post("/api/v1/models/power/predict")
@limiter.limit("30/minute")
def predict_module_power(request: Request, payload: PowerPredictionRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        result = predict_power(payload.as_model_features())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MultiModelRuntimeUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    audit(db, user, "model.predict", "model", result["modelId"], f"elapsedMs={result['elapsedMs']}", request.state.request_id)
    return envelope(result)


@app.post("/api/v1/models/cell-anomaly/predict")
@limiter.limit("20/minute")
async def predict_cell_anomaly(request: Request, image: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    allowed = {"image/jpeg", "image/png"}
    if image.content_type not in allowed:
        raise HTTPException(status_code=415, detail="仅支持 JPEG 或 PNG 电池片图像")
    content = await image.read(10 * 1024 * 1024 + 1)
    if not content or len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413 if content else 422, detail="图像为空或超过 10 MB")
    try:
        result = predict_cell_image(content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (MultiModelRuntimeUnavailable, OSError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    audit(db, user, "model.predict", "model", result["modelId"], f"file={(image.filename or 'unnamed')[-120:]}; elapsedMs={result['elapsedMs']}", request.state.request_id)
    return envelope(result)


@app.post("/api/v1/models/visible-defect/predict")
@limiter.limit("20/minute")
async def predict_visible_image(
    request: Request,
    image: UploadFile = File(...),
    confidence: float = Form(0.25, ge=0.05, le=0.95),
    iou: float = Form(0.70, ge=0.1, le=0.95),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    allowed = {"image/jpeg": ".jpg", "image/png": ".png"}
    suffix = allowed.get(image.content_type or "")
    if not suffix:
        raise HTTPException(status_code=415, detail="仅支持 JPEG 或 PNG 可见光图像")
    content = await image.read(15 * 1024 * 1024 + 1)
    if not content or len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413 if content else 422, detail="图像为空或超过 15 MB")
    try:
        result = await run_in_threadpool(predict_visible_defect, content, suffix, confidence, iou)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MultiModelRuntimeUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    audit(db, user, "model.predict", "model", result["modelId"], f"detections={result['count']}; elapsedMs={result['elapsedMs']}", request.state.request_id)
    return envelope(result)


@app.post("/api/v1/models/panel-segmentation/predict")
@limiter.limit("20/minute")
async def predict_panel_image(
    request: Request,
    image: UploadFile = File(...),
    confidence: float = Form(0.25, ge=0.05, le=0.95),
    iou: float = Form(0.70, ge=0.1, le=0.95),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    allowed = {"image/jpeg": ".jpg", "image/png": ".png"}
    suffix = allowed.get(image.content_type or "")
    if not suffix:
        raise HTTPException(status_code=415, detail="仅支持 JPEG 或 PNG 航拍图像")
    content = await image.read(15 * 1024 * 1024 + 1)
    if not content or len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413 if content else 422, detail="图像为空或超过 15 MB")
    try:
        result = await run_in_threadpool(predict_panel_segmentation, content, suffix, confidence, iou)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MultiModelRuntimeUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    audit(db, user, "model.predict", "model", result["modelId"], f"instances={result['count']}; elapsedMs={result['elapsedMs']}", request.state.request_id)
    return envelope(result)


@app.post("/api/v1/models/grid-fault/predict")
@limiter.limit("10/minute")
async def predict_grid_fault(request: Request, waveform: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    if waveform.content_type not in {"text/csv", "application/vnd.ms-excel", "application/octet-stream"}:
        raise HTTPException(status_code=415, detail="仅支持 CSV 波形文件")
    content = await waveform.read(30 * 1024 * 1024 + 1)
    if not content or len(content) > 30 * 1024 * 1024:
        raise HTTPException(status_code=413 if content else 422, detail="CSV 为空或超过 30 MB")
    try:
        result = predict_fault_csv(content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MultiModelRuntimeUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    audit(db, user, "model.predict", "model", result["modelId"], f"windows={result['windows']}; elapsedMs={result['elapsedMs']}", request.state.request_id)
    return envelope(result)


@app.post("/api/v1/models/current/predict")
@limiter.limit("20/minute")
async def predict_thermal_image(
    request: Request,
    image: UploadFile = File(...),
    confidence: float = Form(0.25, ge=0.05, le=0.95),
    iou: float = Form(0.70, ge=0.1, le=0.95),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    allowed_types = {"image/jpeg": ".jpg", "image/png": ".png"}
    suffix = allowed_types.get(image.content_type or "")
    if not suffix:
        raise HTTPException(status_code=415, detail="仅支持 JPEG 或 PNG 热红外图像")
    content = await image.read(15 * 1024 * 1024 + 1)
    if not content:
        raise HTTPException(status_code=422, detail="上传文件为空")
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="图像不能超过 15 MB")
    signature_valid = (suffix == ".jpg" and content.startswith(b"\xff\xd8\xff")) or (suffix == ".png" and content.startswith(b"\x89PNG\r\n\x1a\n"))
    if not signature_valid:
        raise HTTPException(status_code=422, detail="文件内容与图像格式不匹配")
    try:
        result = await run_in_threadpool(predict_image, content, suffix, confidence, iou)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ModelRuntimeUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    audit(
        db,
        user,
        "model.predict",
        "model",
        result["modelId"],
        f"file={(image.filename or 'unnamed')[-120:]}; detections={result['count']}; elapsedMs={result['elapsedMs']}",
        request.state.request_id,
    )
    return envelope(result)


@app.post("/api/v1/ai/providers/{provider_id}/test")
@limiter.limit("10/minute")
async def test_ai_provider(request: Request, provider_id: str, _: User = Depends(require_roles("admin"))):
    try:
        result = await chat_with_provider(settings, provider_id, "只回复：连接正常", {"purpose": "provider-health-check"}, [])
    except ProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return envelope({"provider": result["provider"], "model": result["model"], "latencyMs": result["latencyMs"], "status": "healthy"})
