"""Read-only operations workspace. Counts and queues share identical DB filters."""
from datetime import datetime, timezone
from typing import Literal, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .models import Anomaly, AuditLog, Mission, User, WorkOrder
from .security import current_user

router = APIRouter(prefix="/api/v1/workspace", tags=["workspace"])
TERMINAL = ("已关闭", "已取消")
REVIEW = ("待复核", "需复飞")
RISK = case((Anomaly.severity == "critical", 0), (Anomaly.severity == "high", 1),
            (Anomaly.severity == "medium", 2), else_=3)
PRIORITY = case((WorkOrder.priority == "紧急", 0), (WorkOrder.priority == "高", 1),
                (WorkOrder.priority == "中", 2), else_=3)


def timestamp(value):
    if value is None:
        return None
    return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)).isoformat()


def path(route, **params):
    return route + "?" + urlencode(params)


class QueueItem(BaseModel):
    id: str
    kind: Literal["anomaly", "order", "mission"]
    title: str
    site: Optional[str]
    location: str
    status: str
    severity: str
    owner: Optional[str] = None
    dueAt: Optional[str] = None
    overdue: bool = False
    createdAt: Optional[str] = None
    action: str
    path: str


class WorkspaceData(BaseModel):
    checkedAt: str
    environment: str
    counts: dict[str, int]
    sites: list[str]
    items: list[QueueItem]
    page: int
    pageSize: int
    total: int
    activity: list[dict]


class WorkspaceResponse(BaseModel):
    data: WorkspaceData


def queries(site):
    events = select(Anomaly, Mission.site).join(Mission, Anomaly.mission_id == Mission.id)
    orders = select(WorkOrder, Mission.site).outerjoin(Anomaly, WorkOrder.anomaly_id == Anomaly.id).outerjoin(Mission, Anomaly.mission_id == Mission.id)
    missions = select(Mission)
    if site:
        events = events.where(Mission.site == site)
        orders = orders.where(Mission.site == site)
        missions = missions.where(Mission.site == site)
    return events, orders, missions


def count(db, query):
    return db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0


@router.get("", response_model=WorkspaceResponse)
def workspace(
    site: Optional[str] = Query(None, max_length=120),
    queue: Literal["review", "dispatch", "orders", "acceptance", "overdue", "missions"] = "review",
    mine: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=50),
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    now = datetime.now(timezone.utc)
    events, orders, missions = queries(site)
    # "Mine" is an assignment filter, not an authorization boundary. Existing
    # schema stores assignee names, so identity must come from the server user.
    if mine:
        orders = orders.where(WorkOrder.owner == user.name)
    active = orders.where(WorkOrder.status.not_in(TERMINAL))
    review = events.where(Anomaly.status.in_(REVIEW))
    live_order = select(WorkOrder.id).where(WorkOrder.anomaly_id == Anomaly.id,
        WorkOrder.status.not_in(TERMINAL)).exists()
    dispatch = events.where(Anomaly.status == "已确认", ~live_order)
    acceptance = active.where(WorkOrder.status == "待验收")
    overdue = active.where(WorkOrder.due_at.is_not(None), WorkOrder.due_at < now)
    pending_missions = missions.where(Mission.status.in_(("计划中", "执行中", "处理中", "待复核", "需复飞")))
    counts = {"review": count(db, review), "dispatch": count(db, dispatch), "orders": count(db, active),
              "acceptance": count(db, acceptance), "overdue": count(db, overdue),
              "missions": count(db, pending_missions)}
    offset = (page - 1) * page_size
    items = []
    if queue in ("review", "dispatch"):
        query = dispatch if queue == "dispatch" else review
        rows = db.execute(query.order_by(RISK, Anomaly.detected_at, Anomaly.id).offset(offset).limit(page_size))
        for event, station in rows:
            items.append(QueueItem(id=event.id, kind="anomaly", title=event.type, site=station,
                location=f"{event.array_code} / {event.module_code}", status=event.status,
                severity=event.severity, createdAt=timestamp(event.detected_at),
                action="发起派工" if queue == "dispatch" else "复核证据" if event.status == "待复核" else "安排复飞",
                path=path("/anomalies", event=event.id)))
    elif queue == "missions":
        for mission in db.scalars(pending_missions.order_by(Mission.started_at, Mission.id).offset(offset).limit(page_size)):
            items.append(QueueItem(id=mission.id, kind="mission", title=mission.name, site=mission.site,
                location=mission.aircraft, status=mission.status, severity="info",
                createdAt=timestamp(mission.started_at), action="查看任务",
                path=path("/missions", mission=mission.id)))
    else:
        query = {"orders": active, "acceptance": acceptance, "overdue": overdue}[queue]
        rows = db.execute(query.order_by(case((WorkOrder.due_at < now, 0), else_=1),
            PRIORITY, WorkOrder.due_at.asc().nulls_last(), WorkOrder.created_at, WorkOrder.id).offset(offset).limit(page_size))
        actions = {"待排程": "排程派发", "已派发": "开始处理", "处理中": "继续处置", "待验收": "执行验收"}
        for order, station in rows:
            items.append(QueueItem(id=order.id, kind="order", title=order.title, site=station,
                location=order.anomaly_id or "独立工单 · 未关联场站", status=order.status,
                severity={"紧急": "critical", "高": "high", "中": "medium"}.get(order.priority, "low"),
                owner=order.owner, dueAt=timestamp(order.due_at),
                overdue=bool(order.due_at and timestamp(order.due_at) < now.isoformat()),
                createdAt=timestamp(order.created_at), action=actions.get(order.status, "查看工单"),
                path=path("/work-orders", order=order.id)))
    logs = select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id).limit(8)
    # A selected station only exposes audit records tied to its resources.
    if site:
        event_ids = select(Anomaly.id).join(Mission).where(Mission.site == site)
        order_ids = select(WorkOrder.id).join(Anomaly).join(Mission).where(Mission.site == site)
        logs = logs.where(or_(
            (AuditLog.resource_type == "mission") & AuditLog.resource_id.in_(select(Mission.id).where(Mission.site == site)),
            (AuditLog.resource_type == "anomaly") & AuditLog.resource_id.in_(event_ids),
            (AuditLog.resource_type == "work_order") & AuditLog.resource_id.in_(order_ids)))
    activity = [{"id": log.id, "action": log.action, "resourceId": log.resource_id,
                 "resourceType": log.resource_type, "createdAt": timestamp(log.created_at)} for log in db.scalars(logs)]
    sites = list(db.scalars(select(Mission.site).distinct().order_by(Mission.site)))
    return {"data": WorkspaceData(checkedAt=now.isoformat(), environment=get_settings().app_env,
        counts=counts, sites=sites, items=items, page=page, pageSize=page_size,
        total=counts[queue], activity=activity)}


@router.get("/search")
def search(q: str = Query(..., min_length=2, max_length=100),
           limit: int = Query(8, ge=1, le=20), db: Session = Depends(get_db),
           _: User = Depends(current_user)):
    term = q.strip()
    if len(term) < 2:
        return {"data": []}
    # autoescape keeps percent/underscore user input literal and binds values.
    def matches(*fields):
        return or_(*(field.icontains(term, autoescape=True) for field in fields))
    results = []
    for row in db.scalars(select(WorkOrder).where(matches(WorkOrder.id, WorkOrder.title, WorkOrder.owner))
                          .order_by(WorkOrder.created_at.desc(), WorkOrder.id).limit(limit)):
        results.append({"id": row.id, "kind": "order", "title": row.title, "status": row.status,
                        "path": path("/work-orders", order=row.id)})
    for row in db.scalars(select(Anomaly).where(matches(Anomaly.id, Anomaly.type, Anomaly.array_code, Anomaly.module_code))
                          .order_by(RISK, Anomaly.id).limit(limit)):
        results.append({"id": row.id, "kind": "anomaly", "title": row.type, "status": row.status,
                        "path": path("/anomalies", event=row.id)})
    for row in db.scalars(select(Mission).where(matches(Mission.id, Mission.name, Mission.site))
                          .order_by(Mission.started_at.desc(), Mission.id).limit(limit)):
        results.append({"id": row.id, "kind": "mission", "title": row.name, "status": row.status,
                        "path": path("/missions", mission=row.id)})
    return {"data": results, "meta": {"limitPerType": limit}}
