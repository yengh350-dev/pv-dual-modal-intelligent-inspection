from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pydantic.alias_generators import to_camel

AnomalyStatus = Literal["待复核", "已确认", "已转工单", "已排除", "需复飞"]
MissionStatus = Literal["计划中", "执行中", "处理中", "待复核", "需复飞", "已完成", "已取消"]
Priority = Literal["低", "中", "高", "紧急"]
Severity = Literal["low", "medium", "high", "critical"]
WorkOrderStatus = Literal["待排程", "已派发", "处理中", "待验收", "已关闭", "已取消"]


class Envelope(BaseModel):
    data: Any
    meta: Optional[Dict[str, Any]] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(alias="refreshToken")
    model_config = ConfigDict(populate_by_name=True)


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    is_active: bool
    model_config = ConfigDict(from_attributes=True)


class MissionCreate(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    site: str = Field(min_length=2, max_length=120)
    aircraft: str = Field(min_length=2, max_length=80)
    payload: str = Field(default="RGB + Thermal", min_length=2, max_length=80)
    model_config = ConfigDict(str_strip_whitespace=True)


class WorkOrderChecklistItem(BaseModel):
    id: str = Field(min_length=2, max_length=50)
    label: str = Field(min_length=2, max_length=120)
    done: bool = False
    model_config = ConfigDict(str_strip_whitespace=True)


class WorkOrderCreate(BaseModel):
    anomaly_id: Optional[str] = Field(default=None, min_length=3, max_length=80)
    title: str = Field(min_length=3, max_length=180)
    owner: str = Field(min_length=2, max_length=80)
    priority: Priority = "中"
    due_at: Optional[datetime] = None
    reviewer: str = Field(default="", max_length=80)
    requirements: str = Field(default="", max_length=4000)
    initial_status: Literal["待排程", "已派发"] = "已派发"
    model_config = ConfigDict(str_strip_whitespace=True)


class WorkOrderUpdate(BaseModel):
    status: Optional[WorkOrderStatus] = None
    owner: Optional[str] = Field(default=None, min_length=2, max_length=80)
    resolution: Optional[str] = Field(default=None, min_length=2, max_length=4000)
    reviewer: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=8000)
    checklist: Optional[List[WorkOrderChecklistItem]] = Field(default=None, min_length=1, max_length=30)
    expected_revision: Optional[int] = Field(default=None, ge=0)
    model_config = ConfigDict(str_strip_whitespace=True)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    context: Dict[str, Any] = Field(default_factory=dict)
    provider: str = Field(default="auto", min_length=2, max_length=32)
    history: List[ChatMessage] = Field(default_factory=list, max_length=12)


class PowerPredictionRequest(BaseModel):
    ambient_temperature: float = Field(alias="ambientTemperature", ge=-60, le=80)
    irradiance: float = Field(ge=0, le=1600)
    module_temperature: float = Field(alias="moduleTemperature", ge=-60, le=130)
    inclination_angle: float = Field(alias="inclinationAngle", ge=0, le=90)
    humidity: float = Field(ge=0, le=100)
    hour: float = Field(ge=0, lt=24)
    model_config = ConfigDict(populate_by_name=True)

    def as_model_features(self) -> Dict[str, float]:
        return {
            "ambient_temperature": self.ambient_temperature,
            "irradiance": self.irradiance,
            "module_temperature": self.module_temperature,
            "inclination_angle": self.inclination_angle,
            "humidity": self.humidity,
            "hour": self.hour,
        }


class EvidenceEvaluationRequest(BaseModel):
    alignment_quality: float = Field(alias="alignmentQuality", ge=0, le=1)
    registration_error_px: float = Field(alias="registrationErrorPx", ge=0, le=100)
    sync_offset_ms: float = Field(alias="syncOffsetMs", ge=0, le=60000)
    localization_accuracy_m: float = Field(alias="localizationAccuracyM", ge=0, le=1000)
    persistent_frames: int = Field(alias="persistentFrames", ge=0, le=10000)
    persistent_seconds: float = Field(alias="persistentSeconds", ge=0, le=3600)
    radiometric_calibrated: bool = Field(alias="radiometricCalibrated")
    environment_complete: bool = Field(alias="environmentComplete")
    temperature_delta_c: float = Field(alias="temperatureDeltaC", ge=-100, le=300)
    model_confidence: float = Field(alias="modelConfidence", ge=0, le=1)
    irradiance_w_m2: Optional[float] = Field(default=None, alias="irradianceWM2", ge=0, le=1600)
    temperature_uncertainty_c: float = Field(default=2.0, alias="temperatureUncertaintyC", ge=0, le=30)
    reflection_risk: float = Field(default=0, alias="reflectionRisk", ge=0, le=1)
    occlusion_ratio: float = Field(default=0, alias="occlusionRatio", ge=0, le=1)
    repeat_observations: int = Field(default=1, alias="repeatObservations", ge=0, le=100)
    asset_criticality: float = Field(default=0.5, alias="assetCriticality", ge=0, le=1)
    model_config = ConfigDict(populate_by_name=True)


class MissionFrame(BaseModel):
    pair_id: str = Field(min_length=1, max_length=120)
    modality: Literal["RGB", "THERMAL"]
    path: str = Field(min_length=1, max_length=1024)
    timestamp: datetime
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude_m: float = Field(ge=-100, le=10000)
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class MissionManifest(BaseModel):
    schema_version: Literal["1.0"]
    mission_id: str = Field(min_length=3, max_length=80)
    site: str = Field(min_length=2, max_length=160)
    aircraft: str = Field(min_length=2, max_length=120)
    payload: str = Field(min_length=2, max_length=120)
    timezone: str = Field(min_length=1, max_length=64)
    crs: str = Field(min_length=3, max_length=64)
    frames: List[MissionFrame] = Field(min_length=2, max_length=50000)
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
