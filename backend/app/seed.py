from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Anomaly, Mission, User, WorkOrder
from .security import hash_password


def seed_database(db: Session) -> None:
    if not db.scalar(select(User.id).limit(1)):
        db.add(User(name="张工", email="admin@sentinel-rgbt.com", password_hash=hash_password("Sentinel123!"), role="admin"))

    if not db.scalar(select(Mission.id).limit(1)):
        missions = [
            Mission(id="MSN-240905-042", name="盐城一期 A/B 区例行巡检", site="盐城一期光伏场", aircraft="Mavic 3T", payload="RGB + Thermal", status="待复核", coverage=94.7, quality=98.2, frames=4286),
            Mission(id="MSN-240904-041", name="盐城一期 C 区复飞", site="盐城一期光伏场", aircraft="Mavic 3T", payload="RGB + Thermal", status="已完成", coverage=91.2, quality=95.8, frames=3180),
            Mission(id="MSN-240903-040", name="东台二期雨后专项", site="东台二期光伏场", aircraft="Matrice 350 RTK", payload="H20T", status="需复飞", coverage=76.4, quality=71.4, frames=2954),
        ]
        db.add_all(missions)
        db.flush()
        anomalies = [
            Anomaly(id="EVT-240905-018", mission_id="MSN-240905-042", type="组件热斑", severity="critical", array_code="A-03", module_code="18-07", delta_t=18.6, confidence=.94, alignment=.97, status="已转工单"),
            Anomaly(id="EVT-240905-021", mission_id="MSN-240905-042", type="连接器过热", severity="high", array_code="B-07", module_code="04-12", delta_t=11.2, confidence=.88, alignment=.93, status="已转工单"),
            Anomaly(id="EVT-240905-027", mission_id="MSN-240905-042", type="表面污染", severity="medium", array_code="B-02", module_code="11-03", delta_t=5.4, confidence=.79, alignment=.89, status="待复核"),
        ]
        db.add_all(anomalies)
        db.flush()
        db.add_all([
            WorkOrder(id="WO-240905-018", anomaly_id="EVT-240905-018", title="复核 A-03 组件热斑", owner="李工", priority="紧急", status="处理中"),
            WorkOrder(id="WO-240905-014", anomaly_id="EVT-240905-021", title="更换 B-07 连接器", owner="王强", priority="高", status="已派发"),
        ])
    if not db.get(Mission, "MSN-240902-038"):
        db.add(Mission(id="MSN-240902-038", name="山地研究验证场阶梯阵列巡检", site="山地研究验证场", aircraft="EVO Max 4T", payload="RGB + Radiometric Thermal", status="执行中", coverage=42.1, quality=100.0, frames=1864))
    db.flush()
    open_orders = db.scalars(select(WorkOrder).where(WorkOrder.anomaly_id.is_not(None), WorkOrder.status.not_in(["已关闭", "已取消"]))).all()
    for order in open_orders:
        anomaly = db.get(Anomaly, order.anomaly_id)
        if anomaly and anomaly.status != "已转工单":
            anomaly.status = "已转工单"
    db.commit()
