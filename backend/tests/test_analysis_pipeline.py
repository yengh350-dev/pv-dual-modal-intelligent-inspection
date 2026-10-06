import io
import json
import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import AnalysisTask, EvidenceFrame, LiveObservation, Mission, User, utcnow
from app.security import current_user
from app.analysis_worker import AnalysisWorker, inference_slot, MAX_ATTEMPTS
from app.evidence_fusion import associate_evidence, Registration


def image_bytes(color="gray"):
    output = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(output, "PNG")
    return output.getvalue()


def prediction():
    return {"modelId": "test", "image": {"width": 64, "height": 48}, "elapsedMs": 10,
        "reviewRequired": True, "count": 1, "detections": [{"className": "hotspot", "confidence": .8,
        "box": {"x1": 10, "y1": 10, "x2": 20, "y2": 20},
        "boxNormalized": {"x": .2, "y": .2, "width": .2, "height": .2}}]}


class FusionTests(unittest.TestCase):
    def setUp(self):
        self.meta = {"timestamp_kind": "device_capture", "clock_id": "camera-clock",
                     "captured_at": "2026-10-05T00:00:00+00:00"}
        self.mapping = {"homography": [1, 0, 0, 0, 1, 0, 0, 0, 1], "reference": "calibration-v1", "rmse_px": 1}

    def fuse(self, **changes):
        return associate_evidence(prediction(), prediction(), self.meta, changes.get("meta", self.meta), changes.get("mapping", self.mapping))

    def test_valid_pair_matches_but_does_not_average_confidence(self):
        result = self.fuse()
        self.assertEqual(result["state"], "associated")
        self.assertEqual(result["matches"], [{"rgbIndex": 0, "thermalIndex": 0, "spatialIoU": 1.0}])
        self.assertNotIn("confidence", result["matches"][0])

    def test_unknown_clock_skew_and_registration_are_held(self):
        self.assertEqual(self.fuse(meta={})["state"], "held")
        self.assertIn("CAPTURE_SKEW_EXCEEDED", self.fuse(meta={**self.meta, "captured_at": "2026-10-05T00:00:01+00:00"})["reasons"])
        self.assertEqual(self.fuse(mapping={**self.mapping, "rmse_px": 4})["state"], "held")

    def test_degenerate_and_projective_pole_matrices_are_held(self):
        self.assertIn("MAPPING_DEGENERATE", self.fuse(mapping={**self.mapping, "homography": [0] * 9})["reasons"])
        self.assertIn("MAPPING_POLE", self.fuse(mapping={**self.mapping, "homography": [1, 0, 0, 0, 1, 0, -2, 0, 1]})["reasons"])

    def test_one_to_one_preserves_unmatched_detections(self):
        rgb = prediction()
        rgb["detections"] *= 2
        result = associate_evidence(rgb, prediction(), self.meta, self.meta, self.mapping)
        self.assertEqual(len(result["matches"]), 1)
        self.assertEqual(len(result["unmatchedRgb"]), 1)

    def test_nonfinite_metadata_rejected(self):
        with self.assertRaises(ValueError):
            Registration(homography=[float("nan")] * 9)

    def test_homogeneous_matrix_scale_does_not_change_association(self):
        scaled = {**self.mapping, "homography": [v * 1e-20 for v in self.mapping["homography"]]}
        self.assertEqual(self.fuse(mapping=scaled)["matches"], self.fuse()["matches"])

    def test_browser_utc_suffix_is_supported_by_fusion(self):
        self.assertEqual(self.fuse(meta={**self.meta, "captured_at": "2026-10-05T00:00:00Z"})["state"], "associated")


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine)
        self.db = self.factory()
        self.user = User(id="pipeline-user", name="测试", email="pipeline@example.com", password_hash="test", role="admin")
        self.db.add(self.user)
        self.db.add(Mission(id="MSN-PIPE", name="测试", site="测试", aircraft="未连接", payload="RGBT", status="进行中"))
        self.db.commit()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[current_user] = lambda: self.user
        self.client = TestClient(app)
        self.worker = AnalysisWorker(self.factory)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()

    def submit(self, key="request-0001", pair=False, **fields):
        files = {"image": ("frame.png", image_bytes(), "image/png")}
        if pair:
            files["paired_image"] = ("rgb.png", image_bytes("blue"), "image/png")
        return self.client.post("/api/v1/analysis/tasks", data={"mission_id": "MSN-PIPE", "modality": "THERMAL",
            "idempotency_key": key, **fields}, files=files)

    def test_idempotency_and_conflict_do_not_duplicate_frames(self):
        self.assertEqual(self.submit().status_code, 202)
        self.assertTrue(self.submit().json()["existing"])
        self.assertEqual(self.submit(confidence=".5").status_code, 409)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(EvidenceFrame)), 1)

    def test_success_is_versioned_exact_image_and_review_link(self):
        task = self.submit().json()["data"]
        with patch("app.analysis_worker.predict_image", return_value=prediction()) as model:
            self.assertTrue(self.worker.run_one())
            self.assertEqual(model.call_args.kwargs["profile"], "precision")
        result = self.client.get("/api/v1/analysis/tasks/" + task["id"]).json()["data"]
        self.assertEqual(result["state"], "succeeded")
        self.assertTrue(result["observation"]["imageData"].startswith("data:image/png"))
        self.assertEqual(result["result"]["lineage"][0]["width"], 64)
        self.assertEqual(self.client.get("/api/v1/analysis/tasks/" + task["id"] + "/export").status_code, 200)

    def test_browser_sample_with_utc_suffix_can_publish(self):
        task = self.submit(metadata=json.dumps({"timestamp_kind": "browser_sample", "captured_at": "2026-10-05T00:00:00Z"})).json()["data"]
        with patch("app.analysis_worker.predict_image", return_value=prediction()):
            self.worker.run_one()
        result = self.client.get("/api/v1/analysis/tasks/" + task["id"]).json()["data"]
        self.assertEqual(result["state"], "succeeded")
        self.assertEqual(result["observation"]["capturedAt"], "2026-10-05T00:00:00+00:00")

    def test_pair_with_unknown_metadata_keeps_predictions_but_holds_fusion(self):
        task = self.submit(pair=True).json()["data"]
        with patch("app.analysis_worker.predict_image", return_value=prediction()), patch("app.analysis_worker.predict_visible_defect", return_value=prediction()):
            self.worker.run_one()
        result = self.client.get("/api/v1/analysis/tasks/" + task["id"]).json()["data"]["result"]
        self.assertEqual(len(result["predictions"]), 2)
        self.assertEqual(result["fusion"]["state"], "held")

    def test_missing_modality_degrades_without_losing_other_result(self):
        task = self.submit(pair=True).json()["data"]
        with patch("app.analysis_worker.predict_image", side_effect=ValueError("unavailable")), patch("app.analysis_worker.predict_visible_defect", return_value=prediction()):
            self.worker.run_one()
        result = self.client.get("/api/v1/analysis/tasks/" + task["id"]).json()["data"]
        self.assertEqual(result["state"], "succeeded")
        self.assertEqual(result["result"]["fusion"]["state"], "degraded")
        self.assertEqual(result["observation"]["modality"], "RGB")

    def test_cancel_queued_and_running_results_do_not_publish(self):
        task = self.submit().json()["data"]
        self.assertEqual(self.client.post("/api/v1/analysis/tasks/" + task["id"] + "/cancel").json()["data"]["state"], "cancelled")
        task = self.submit(key="request-0002").json()["data"]
        def cancel(*args, **kwargs):
            self.client.post("/api/v1/analysis/tasks/" + task["id"] + "/cancel")
            return prediction()
        with patch("app.analysis_worker.predict_image", side_effect=cancel):
            self.worker.run_one()
        self.assertEqual(self.client.get("/api/v1/analysis/tasks/" + task["id"]).json()["data"]["state"], "cancelled")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(LiveObservation)), 0)

    def test_expired_lease_recovery_and_attempt_cap(self):
        task = self.db.get(AnalysisTask, self.submit().json()["data"]["id"])
        task.state, task.lease_until, task.attempts = "running", utcnow() - timedelta(seconds=1), 1
        self.db.commit()
        self.worker.recover(self.db)
        self.db.refresh(task)
        self.assertEqual(task.state, "queued")
        task.state, task.attempts = "running", MAX_ATTEMPTS
        task.lease_until = utcnow() - timedelta(seconds=1)
        self.db.commit()
        self.worker.recover(self.db)
        self.db.refresh(task)
        self.assertEqual(task.state, "failed")
        self.assertEqual(self.client.post("/api/v1/analysis/tasks/" + task.id + "/retry").status_code, 409)

    def test_preview_busy_returns_retry_after(self):
        inference_slot.acquire()
        try:
            response = self.client.post("/api/v1/analysis/preview", data={"modality": "THERMAL"},
                files={"image": ("frame.png", image_bytes(), "image/png")})
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.headers["retry-after"], "1")
        finally:
            inference_slot.release()

    def test_expired_or_replaced_lease_cannot_publish_result(self):
        task = self.db.get(AnalysisTask, self.submit().json()["data"]["id"])
        task.state, task.lease_token, task.lease_until = "running", "token", utcnow() - timedelta(seconds=1)
        self.db.commit()
        self.worker.finish(self.db, task.id, "token", {"predictions": {}}, [], {})
        self.db.refresh(task)
        self.assertEqual(task.state, "running")
        self.assertIsNone(task.result)
        self.worker.finish(self.db, task.id, "old-token", {"predictions": {}}, [], {})
        self.db.refresh(task)
        self.assertIsNone(task.result)

    def test_queue_bound_and_invalid_input_do_not_persist(self):
        self.assertEqual(self.submit(metadata='{"timestamp_kind":"browser_sample"}').status_code, 422)
        for i in range(8):
            self.assertEqual(self.submit(key=f"queue-{i:04}").status_code, 202)
        self.assertEqual(self.submit(key="queue-last").status_code, 429)

    def test_viewer_cannot_submit_and_operator_cannot_cancel_peer(self):
        task = self.submit().json()["data"]
        self.user.role = "viewer"
        self.assertEqual(self.submit(key="viewer-key").status_code, 403)
        peer = User(id="peer", name="peer", email="peer@example.com", password_hash="test", role="operator")
        app.dependency_overrides[current_user] = lambda: peer
        self.assertEqual(self.client.post("/api/v1/analysis/tasks/" + task["id"] + "/cancel").status_code, 403)
