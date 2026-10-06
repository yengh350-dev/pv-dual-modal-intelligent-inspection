import unittest
import asyncio
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Anomaly, AuditLog, Mission, User, WorkOrder
from app.security import current_user, decode_token, settings


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(id="workspace-user", name="执行甲", email="workspace@example.com", password_hash="test", role="admin")
        self.db.add(self.user)
        self.db.add_all([Mission(id="M-A", name="场站甲任务", site="甲", aircraft="测试无人机", payload="RGBT", status="计划中"),
                         Mission(id="M-B", name="场站乙任务", site="乙", aircraft="测试无人机", payload="RGBT", status="已完成")])
        self.db.flush()
        for ident, mission, severity, state in [("E-HIGH", "M-A", "high", "待复核"),
                ("E-CRIT", "M-A", "critical", "待复核"), ("E-LOW", "M-B", "low", "需复飞"),
                ("E-DONE", "M-A", "high", "已排除")]:
            self.db.add(Anomaly(id=ident, mission_id=mission, type="测试候选", severity=severity,
                array_code="A-01", module_code="01-01", delta_t=10, confidence=.8, alignment=.9, status=state))
        self.db.flush()
        now = datetime.now(timezone.utc)
        self.db.add_all([
            WorkOrder(id="W-LATE", anomaly_id="E-HIGH", title="需要及时处置", owner="执行甲", priority="高", status="处理中", due_at=now-timedelta(days=1)),
            WorkOrder(id="W-CLOSED", anomaly_id="E-DONE", title="已经关闭", owner="执行甲", priority="紧急", status="已关闭", due_at=now-timedelta(days=1)),
            WorkOrder(id="W-ACCEPT", anomaly_id="E-LOW", title="等待独立验收", owner="执行乙", priority="高", status="待验收", due_at=now+timedelta(days=1)),
            WorkOrder(id="W-FREE", title="独立工单含100%字样", owner="执行甲", priority="低", status="待排程")])
        self.db.add(AuditLog(actor_id=self.user.id, action="work_order.create", resource_type="work_order", resource_id="W-ACCEPT"))
        self.db.commit()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[current_user] = lambda: self.user
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()

    def read(self, **params):
        result = self.client.get("/api/v1/workspace", params=params)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()["data"]

    def test_counts_and_risk_order_match_site_queue(self):
        data = self.read(site="甲")
        self.assertEqual(data["counts"], {"review": 2, "dispatch": 0, "orders": 1, "acceptance": 0, "overdue": 1, "missions": 1})
        self.assertEqual([item["id"] for item in data["items"]], ["E-CRIT", "E-HIGH"])
        self.assertEqual(data["activity"], [])

    def test_closed_is_not_overdue_and_unlinked_order_only_in_all_sites(self):
        data = self.read(queue="overdue")
        self.assertEqual([item["id"] for item in data["items"]], ["W-LATE"])
        self.assertTrue(data["items"][0]["overdue"])
        self.assertEqual(self.read(queue="orders")["total"], 3)
        self.assertEqual(self.read(queue="orders", site="甲")["total"], 1)

    def test_mine_uses_authenticated_name_not_supplied_identity(self):
        data = self.read(queue="orders", mine=True, owner="执行乙")
        self.assertEqual({item["id"] for item in data["items"]}, {"W-LATE", "W-FREE"})
        self.assertEqual(data["counts"]["acceptance"], 0)
        self.assertEqual(data["counts"]["review"], 3)

    def test_pagination_is_stable_and_out_of_range_is_empty(self):
        first, second = self.read(page_size=1), self.read(page_size=1, page=2)
        self.assertEqual(first["items"][0]["id"], "E-CRIT")
        self.assertEqual(second["items"][0]["id"], "E-HIGH")
        self.assertEqual(first["total"], 3)
        self.assertEqual(self.read(page=999)["items"], [])

    def test_search_literal_wildcards_and_bounded_types(self):
        data = self.client.get("/api/v1/workspace/search", params={"q": "100%", "limit": 1}).json()["data"]
        self.assertEqual([item["id"] for item in data], ["W-FREE"])
        self.assertEqual(self.client.get("/api/v1/workspace/search", params={"q": "%%"}).json()["data"], [])
        self.assertEqual(self.client.get("/api/v1/workspace/search", params={"q": "x"}).status_code, 422)
        self.assertEqual(self.client.get("/api/v1/workspace", params={"page_size": 10000}).status_code, 422)

    def test_read_only_and_auth_required(self):
        self.read(queue="orders")
        self.client.get("/api/v1/workspace/search", params={"q": "测试"})
        self.assertEqual(len(self.db.scalars(select(AuditLog)).all()), 1)
        del app.dependency_overrides[current_user]
        self.assertEqual(self.client.get("/api/v1/workspace").status_code, 401)
        self.assertEqual(self.client.get("/api/v1/workspace/search", params={"q": "测试"}).status_code, 401)

    def test_mission_round_trip_search_and_audit(self):
        response = self.client.post("/api/v1/missions", json={"name": "真实输入新任务", "site": "丙场站", "aircraft": "DJI-TEST", "payload": "红外载荷"})
        self.assertEqual(response.status_code, 201, response.text)
        ident = response.json()["data"]["id"]
        saved = self.client.get("/api/v1/missions/" + ident).json()["data"]
        self.assertEqual(saved["site"], "丙场站")
        self.assertEqual(saved["aircraft"], "DJI-TEST")
        self.assertEqual(saved["frames"], 0)
        result = self.client.get("/api/v1/missions", params={"q": "真实输入", "site": "丙场站"}).json()
        self.assertEqual(result["meta"]["total"], 1)
        self.assertEqual(result["data"][0]["id"], ident)
        self.assertEqual(len(self.db.scalars(select(AuditLog).where(AuditLog.resource_id == ident)).all()), 1)

    def test_invalid_token_claims_do_not_raise_server_error(self):
        from fastapi import HTTPException
        for payload in [{"type": "access"}, {"type": "access", "sub": "", "iat": 1, "exp": 9999999999}]:
            with self.assertRaises(HTTPException) as caught:
                decode_token(jwt.encode(payload, settings.jwt_secret, algorithm="HS256"), "access")
            self.assertEqual(caught.exception.status_code, 401)

    def test_dispatch_excludes_active_orders_but_allows_redispatch_after_cancellation(self):
        for event_id in ("E-HIGH", "E-CRIT"):
            self.db.get(Anomaly, event_id).status = "已确认"
        self.db.commit()
        data = self.read(queue="dispatch", site="甲")
        self.assertEqual([item["id"] for item in data["items"]], ["E-CRIT"])
        self.assertEqual(data["items"][0]["action"], "发起派工")
        self.assertEqual(data["counts"]["review"], 0)
        self.db.get(WorkOrder, "W-LATE").status = "已取消"
        self.db.commit()
        self.assertEqual(self.read(queue="dispatch")["total"], 2)

    def test_terminal_missions_are_not_pending_and_refly_is_filterable(self):
        self.db.get(Mission, "M-A").status = "已取消"
        self.db.commit()
        self.assertEqual(self.read(queue="missions")["total"], 0)
        self.db.get(Mission, "M-A").status = "需复飞"
        self.db.commit()
        self.assertEqual(self.read(queue="missions")["total"], 1)
        response = self.client.get("/api/v1/missions", params={"status": "需复飞"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["meta"]["total"], 1)

    def test_production_startup_does_not_seed_public_demo_accounts(self):
        from app.main import lifespan
        async def start():
            async with lifespan(app):
                pass
        with patch("app.main.settings.app_env", "production"), patch("app.main.Base.metadata.create_all"), patch("app.main.seed_database") as seed, patch("app.main.AnalysisWorker"):
            asyncio.run(start())
            seed.assert_not_called()

    def test_request_identifier_is_bounded_before_header_reflection(self):
        response = self.client.get("/api/v1/workspace", headers={"X-Request-ID": "a" * 300})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.headers["X-Request-ID"]), 36)
        response = self.client.get("/api/v1/workspace", headers={"X-Request-ID": "workspace-test.1"})
        self.assertEqual(response.headers["X-Request-ID"], "workspace-test.1")


if __name__ == "__main__":
    unittest.main()
