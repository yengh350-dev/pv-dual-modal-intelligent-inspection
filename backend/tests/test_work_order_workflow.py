import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.main import app
from app.models import Anomaly, AuditLog, Mission, User
from app.security import current_user


class WorkOrderWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(id="test-admin", name="测试管理员", email="test@example.com", password_hash="test-only", role="admin")
        self.db.add(self.user)
        self.db.add(Mission(id="MSN-TEST", name="测试任务", site="测试场站", aircraft="测试设备", payload="RGBT", status="已完成"))
        self.db.flush()
        self.db.add(Anomaly(id="EVT-TEST", mission_id="MSN-TEST", type="异常候选", severity="high",
                            array_code="A-01", module_code="01-01", delta_t=12, confidence=.8, alignment=.9, status="已确认"))
        self.db.commit()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[current_user] = lambda: self.user
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()

    def create(self, **extra):
        response = self.client.post("/api/v1/work-orders", json={
            "title": "检查真实现场异常", "owner": "执行人员", "reviewer": "验收人员", "priority": "高",
            "initial_status": "待排程", **extra,
        })
        self.assertEqual(response.status_code, 201, response.text)
        return self.client.get("/api/v1/work-orders/" + response.json()["data"]["id"]).json()["data"]

    def patch(self, order, **fields):
        return self.client.patch("/api/v1/work-orders/" + order["id"], json={"expected_revision": order["revision"], **fields})

    def test_creation_preserves_form_and_initial_stage(self):
        order = self.create(requirements="现场复测并记录电参数", due_at="2026-12-01T09:00:00Z")
        self.assertEqual(order["status"], "待排程")
        self.assertEqual(order["owner"], "执行人员")
        self.assertEqual(order["reviewer"], "验收人员")
        self.assertEqual(order["requirements"], "现场复测并记录电参数")
        self.assertEqual(order["revision"], 1)
        self.assertEqual(order["dueAt"], "2026-12-01T09:00:00+00:00")
        self.assertTrue(order["history"])
        self.assertFalse(any(item["done"] for item in order["checklist"]))

    def test_due_date_preserves_local_offset_as_utc(self):
        order = self.create(due_at="2026-12-01T17:00:00+08:00")
        self.assertEqual(order["dueAt"], "2026-12-01T09:00:00+00:00")

    def test_notes_persist_and_stale_revision_is_rejected(self):
        order = self.create()
        response = self.patch(order, notes="现场电压 37.2 V", resolution="需进一步复测")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["revision"], 2)
        stale = self.patch(order, notes="不应覆盖的新内容")
        self.assertEqual(stale.status_code, 409)
        saved = self.client.get("/api/v1/work-orders/" + order["id"]).json()["data"]
        self.assertEqual(saved["notes"], "现场电压 37.2 V")

    def test_cannot_skip_stages_or_create_in_terminal_state(self):
        order = self.create()
        self.assertEqual(self.patch(order, status="已关闭", resolution="直接关闭").status_code, 409)
        response = self.client.post("/api/v1/work-orders", json={"title": "违规状态测试", "owner": "测试人员", "initial_status": "已关闭"})
        self.assertEqual(response.status_code, 422)

    def test_acceptance_requires_checklist_resolution_and_separate_reviewer(self):
        order = self.create(initial_status="已派发")
        response = self.patch(order, status="处理中")
        order = response.json()["data"]
        self.assertEqual(self.patch(order, status="待验收").status_code, 422)
        checklist = [{**item, "done": True} for item in order["checklist"]]
        self.assertEqual(self.patch(order, checklist=checklist, resolution="测量符合要求", reviewer=order["owner"], status="待验收").status_code, 422)
        response = self.patch(order, checklist=checklist, resolution="测量符合要求", status="待验收")
        self.assertEqual(response.status_code, 200, response.text)
        response = self.patch(response.json()["data"], status="已关闭")
        self.assertEqual(response.status_code, 200, response.text)
        closed = response.json()["data"]
        self.assertEqual(self.patch(closed, notes="关闭后修改").status_code, 409)

    def test_cannot_remove_checklist_to_bypass_gate(self):
        order = self.create()
        self.assertEqual(self.patch(order, checklist=order["checklist"][:1]).status_code, 422)
        self.assertEqual(self.patch(order, checklist=[order["checklist"][0], order["checklist"][0]]).status_code, 422)

    def test_duplicate_and_unreviewed_events_do_not_create_orders(self):
        self.create(anomaly_id="EVT-TEST")
        response = self.client.post("/api/v1/work-orders", json={"title": "重复处置工单", "owner": "执行人员", "anomaly_id": "EVT-TEST"})
        self.assertEqual(response.status_code, 409)
        event = self.db.get(Anomaly, "EVT-TEST")
        event.status = "待复核"
        self.db.commit()
        response = self.client.post("/api/v1/work-orders", json={"title": "未确认事件工单", "owner": "执行人员", "anomaly_id": "EVT-TEST"})
        self.assertEqual(response.status_code, 409)

    def test_cancel_requires_reason_and_is_audited(self):
        order = self.create()
        self.assertEqual(self.patch(order, status="已取消").status_code, 422)
        response = self.patch(order, status="已取消", resolution="现场停机，计划另行安排")
        self.assertEqual(response.status_code, 200)
        log = self.db.scalars(select(AuditLog).where(AuditLog.resource_id == order["id"])).all()
        self.assertEqual(len(log), 2)

    def test_viewer_cannot_write_work_orders(self):
        self.user.role = "viewer"
        response = self.client.post("/api/v1/work-orders", json={"title": "权限测试工单", "owner": "执行人员"})
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
