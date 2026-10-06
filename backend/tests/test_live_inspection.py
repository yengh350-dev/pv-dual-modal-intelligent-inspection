import io
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, event, select, func
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.main import app
from app.models import Mission, User, WorkOrder, LiveObservation, AuditLog
from app.security import current_user


class LiveInspectionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        event.listen(self.engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"))
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(id="live-user", name="测试人员", email="live@example.com", password_hash="test", role="admin")
        self.db.add(self.user)
        self.db.add(Mission(id="MSN-LIVE", name="测试任务", site="测试场站", aircraft="测试设备", payload="RGBT", status="进行中"))
        self.db.commit()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[current_user] = lambda: self.user
        self.client = TestClient(app)
        output = io.BytesIO()
        Image.new("RGB", (64, 48), "gray").save(output, format="PNG")
        self.image = output.getvalue()
        self.prediction = {"modelId":"test-model", "modality":"THERMAL_ONLY", "count":1,
            "image":{"width":64,"height":48}, "elapsedMs":10, "reviewRequired":True,
            "detections":[{"className":"hotspot","confidence":.8,"classId":0,
            "box":{"x1":10,"y1":10,"x2":20,"y2":20},
            "boxNormalized":{"x":.15625,"y":.208333,"width":.15625,"height":.208333}}]}
        self.thermal = patch("app.live_inspection.predict_image", return_value=self.prediction).start()
        self.visible = patch("app.live_inspection.predict_visible_defect", return_value=self.prediction).start()

    def tearDown(self):
        patch.stopall()
        self.client.close()
        app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()

    def snapshot(self, image=None, **values):
        data = {"mission_id":"MSN-LIVE","source_kind":"recording","source_name":"非现场测试录像",
                "modality":"THERMAL","media_time":"12.5","captured_at":datetime.now(timezone.utc).isoformat(), **values}
        return self.client.post("/api/v1/live/observations", data=data, files={"image":("frame.png",self.image if image is None else image,"image/png")})

    def dispatch(self, observation, **fields):
        return self.client.post("/api/v1/live/observations/" + observation["id"] + "/dispatch", json={
            "detection_index":0,"location":"测试场站 A-01 组件 1","review_note":"仅用于测试，不代表现场故障",
            "owner":"执行人员","reviewer":"验收人员","priority":"中",
            "due_at":(datetime.now(timezone.utc)+timedelta(days=1)).isoformat(), **fields})

    def test_snapshot_is_immutable_and_has_exact_server_prediction(self):
        response = self.snapshot()
        self.assertEqual(response.status_code,201,response.text)
        row = response.json()["data"]
        self.assertEqual(row["prediction"],self.prediction)
        self.assertTrue(row["imageData"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(len(row["imageHash"]),64)
        self.assertIsNone(row["workOrderId"])
        saved = self.client.get("/api/v1/live/observations/"+row["id"]).json()["data"]
        self.assertEqual(saved["imageHash"],row["imageHash"])
        listing = self.client.get("/api/v1/live/observations").json()["data"]
        self.assertNotIn("imageData",listing[0])

    def test_rgb_uses_visible_model_only(self):
        self.assertEqual(self.snapshot(modality="RGB").status_code,201)
        self.visible.assert_called_once()
        self.thermal.assert_not_called()

    def test_bad_image_and_size_rejected_before_inference(self):
        self.assertEqual(self.snapshot(image=b"not an image").status_code,422)
        self.assertEqual(self.snapshot(image=b"x"*(2*1024*1024+1)).status_code,413)
        self.thermal.assert_not_called()

    def test_source_mission_and_timestamp_validation(self):
        self.assertEqual(self.snapshot(mission_id="UNKNOWN").status_code,404)
        self.assertEqual(self.snapshot(source_kind="unknown").status_code,422)
        self.assertEqual(self.snapshot(captured_at="2026-01-01T00:00:00").status_code,422)
        self.assertEqual(self.snapshot(captured_at=(datetime.now(timezone.utc)-timedelta(minutes=10)).isoformat()).status_code,422)

    def test_manual_review_gates_and_existing_order_are_idempotent(self):
        snapshot = self.snapshot().json()["data"]
        self.assertEqual(self.dispatch(snapshot,location="").status_code,422)
        self.assertEqual(self.dispatch(snapshot,review_note="").status_code,422)
        self.assertEqual(self.dispatch(snapshot,owner="同一人员",reviewer="同一人员").status_code,422)
        self.assertEqual(self.dispatch(snapshot,detection_index=10).status_code,422)
        self.assertEqual(self.dispatch(snapshot,due_at="2000-01-01T00:00:00Z").status_code,422)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(WorkOrder)),0)
        result = self.dispatch(snapshot)
        self.assertEqual(result.status_code,200,result.text)
        order_id = result.json()["data"]["id"]
        repeated = self.dispatch(snapshot).json()["data"]
        self.assertEqual(repeated,{"id":order_id,"existing":True})
        order = self.client.get("/api/v1/work-orders/"+order_id).json()["data"]
        self.assertEqual(order["liveObservationId"],snapshot["id"])
        self.assertIn("人工定位",order["requirements"])
        self.assertEqual(order["status"],"已派发")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(WorkOrder)),1)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action=="live.dispatch")),1)

    def test_empty_detections_cannot_dispatch(self):
        self.thermal.return_value = {**self.prediction,"count":0,"detections":[]}
        snapshot=self.snapshot().json()["data"]
        self.assertEqual(self.dispatch(snapshot).status_code,422)

    def test_viewer_cannot_save_or_dispatch(self):
        snapshot=self.snapshot().json()["data"]
        self.user.role="viewer"
        self.assertEqual(self.snapshot().status_code,403)
        self.assertEqual(self.dispatch(snapshot).status_code,403)

    def test_model_failure_does_not_leave_partial_records(self):
        from app.model_runtime import ModelRuntimeUnavailable
        self.thermal.side_effect=ModelRuntimeUnavailable("测试模型不可用")
        self.assertEqual(self.snapshot().status_code,503)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(LiveObservation)),0)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(AuditLog)),0)

    def test_power_api_runs_real_model_through_schema_contract(self):
        response = self.client.post("/api/v1/models/power/predict", json={
            "ambientTemperature":25, "irradiance":800, "moduleTemperature":46,
            "inclinationAngle":30, "humidity":55, "hour":12})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertGreaterEqual(response.json()["data"]["predictedPower"], 0)

    def test_thermal_upload_api_uses_verified_v2_and_original_dimensions(self):
        response = self.client.post("/api/v1/models/current/predict",
            files={"image": ("frame.png", self.image, "image/png")})
        self.assertEqual(response.status_code, 200, response.text)
        prediction = response.json()["data"]
        self.assertEqual(prediction["modelId"], "sentinel_thermal_yolo11n_precision_v2")
        self.assertEqual(prediction["image"], {"width": 64, "height": 48})
        self.assertTrue(prediction["reviewRequired"])

    def test_corrupt_visual_upload_returns_422_not_500(self):
        for endpoint in ("current", "visible-defect", "panel-segmentation"):
            response = self.client.post("/api/v1/models/" + endpoint + "/predict",
                files={"image": ("bad.jpg", b"\xff\xd8\xfftruncated", "image/jpeg")})
            self.assertEqual(response.status_code, 422, response.text)

    def test_exif_orientation_is_applied_before_frame_inference(self):
        from app.live_inspection import normalize_frame
        output = io.BytesIO()
        image = Image.new("RGB", (40, 20))
        exif = image.getexif()
        exif[274] = 6
        image.save(output, format="JPEG", exif=exif)
        with Image.open(io.BytesIO(normalize_frame(output.getvalue()))) as normalized:
            self.assertEqual(normalized.size, (20, 40))
            self.assertNotIn(274, normalized.getexif())
