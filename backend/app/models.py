from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, JSON, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return str(uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Mission(Base):
    __tablename__ = "missions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    site: Mapped[str] = mapped_column(String(120))
    aircraft: Mapped[str] = mapped_column(String(80))
    payload: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(32))
    coverage: Mapped[float] = mapped_column(Float, default=0)
    quality: Mapped[float] = mapped_column(Float, default=0)
    frames: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Anomaly(Base):
    __tablename__ = "anomalies"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    type: Mapped[str] = mapped_column(String(80))
    severity: Mapped[str] = mapped_column(String(20), index=True)
    array_code: Mapped[str] = mapped_column(String(32))
    module_code: Mapped[str] = mapped_column(String(32))
    delta_t: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    alignment: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(32), default="待复核")
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    mission: Mapped[Mission] = relationship()


class WorkOrder(Base):
    __tablename__ = "work_orders"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    anomaly_id: Mapped[Optional[str]] = mapped_column(ForeignKey("anomalies.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(180))
    owner: Mapped[str] = mapped_column(String(80))
    priority: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(32))
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WorkOrderWorkflow(Base):
    __tablename__ = "work_order_workflows"
    work_order_id: Mapped[str] = mapped_column(ForeignKey("work_orders.id"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class LiveObservation(Base):
    __tablename__ = "live_observations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    source_kind: Mapped[str] = mapped_column(String(20))
    source_name: Mapped[str] = mapped_column(String(120))
    modality: Mapped[str] = mapped_column(String(20))
    media_time: Mapped[float] = mapped_column(Float)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    image: Mapped[bytes] = mapped_column(LargeBinary)
    image_hash: Mapped[str] = mapped_column(String(64))
    prediction: Mapped[dict] = mapped_column(JSON)
    work_order_id: Mapped[Optional[str]] = mapped_column(ForeignKey("work_orders.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    resource_type: Mapped[str] = mapped_column(String(80))
    resource_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    request_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EvidenceFrame(Base):
    __tablename__ = "evidence_frames"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    modality: Mapped[str] = mapped_column(String(16))
    image: Mapped[bytes] = mapped_column(LargeBinary)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    metadata_json: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EvidencePair(Base):
    __tablename__ = "evidence_pairs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    rgb_frame_id: Mapped[str] = mapped_column(ForeignKey("evidence_frames.id"))
    thermal_frame_id: Mapped[str] = mapped_column(ForeignKey("evidence_frames.id"))
    registration: Mapped[dict] = mapped_column(JSON)


class AnalysisTask(Base):
    __tablename__ = "analysis_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    frame_id: Mapped[str] = mapped_column(ForeignKey("evidence_frames.id"))
    pair_id: Mapped[Optional[str]] = mapped_column(ForeignKey("evidence_pairs.id"), nullable=True)
    idempotency_scope: Mapped[str] = mapped_column(String(120), unique=True)
    input_digest: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    config: Mapped[dict] = mapped_column(JSON)
    result: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(String(240), nullable=True)
    lease_token: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    lease_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    observation_id: Mapped[Optional[str]] = mapped_column(ForeignKey("live_observations.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
