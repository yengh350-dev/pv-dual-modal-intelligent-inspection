import unittest
import io
import json
import hashlib
import tempfile
from pathlib import Path

from PIL import Image

from app.model_runtime import BASELINE_ID, PRECISION_ID, model_manifest, predict_image, select_active_model


class ModelRuntimeTests(unittest.TestCase):
    def test_manifest_exposes_reproducible_metrics_and_boundary(self):
        manifest = model_manifest()
        self.assertEqual(manifest["model"]["model_id"], "sentinel_thermal_yolo11n_precision_v2")
        self.assertAlmostEqual(manifest["model"]["metrics"]["map50"], 0.6767448976)
        self.assertAlmostEqual(manifest["baselineModel"]["metrics"]["map50"], 0.6604455737)
        self.assertEqual(manifest["dataset"]["splits"]["test"]["images"], 140)
        self.assertEqual(manifest["decisionBoundary"]["modality"], "THERMAL_ONLY")
        self.assertTrue(manifest["decisionBoundary"]["requiresHumanReview"])
        self.assertTrue(manifest["artifact"]["weightsPresent"])

    def test_manifest_does_not_expose_every_split_filename(self):
        manifest = model_manifest()
        self.assertNotIn("files", manifest["dataset"]["splits"]["train"])

    def test_real_model_preserves_original_image_dimensions(self):
        content = io.BytesIO()
        Image.new("RGB", (96, 64), "gray").save(content, format="PNG")
        prediction = predict_image(content.getvalue(), ".png", .25, .7)
        self.assertEqual(prediction["image"], {"width": 96, "height": 64})
        self.assertEqual(prediction["count"], len(prediction["detections"]))
        for detection in prediction["detections"]:
            box = detection["boxNormalized"]
            self.assertLessEqual(box["x"] + box["width"], 1 + 1e-6)
            self.assertLessEqual(box["y"] + box["height"], 1 + 1e-6)

    def test_activation_verifies_weights_and_acceptance_before_switching(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / PRECISION_ID
            directory.mkdir()
            weights = directory / "best.pt"
            weights.write_bytes(b"test-artifact-not-a-real-model")
            digest = hashlib.sha256(weights.read_bytes()).hexdigest()
            (root / "active_thermal.json").write_text(json.dumps({"model_id": PRECISION_ID, "weights_sha256": digest}))
            (directory / "model_card.json").write_text(json.dumps({"model_id": PRECISION_ID, "weights_sha256": digest}))
            evaluation = directory / "evaluation.json"
            evaluation.write_text(json.dumps({"deploymentEligible": True, "candidateWeightsSha256": digest}))
            self.assertEqual(select_active_model(root), (directory, None))
            evaluation.write_text(json.dumps({"deploymentEligible": False, "candidateWeightsSha256": digest}))
            self.assertEqual(select_active_model(root)[0], root / BASELINE_ID)
            evaluation.write_text(json.dumps({"deploymentEligible": True, "candidateWeightsSha256": digest}))
            weights.write_bytes(b"tampered")
            selected, warning = select_active_model(root)
            self.assertEqual(selected, root / BASELINE_ID)
            self.assertIsNotNone(warning)

    def test_activation_rejects_malformed_or_unregistered_config(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for value in ("invalid json", "[]", json.dumps({"model_id": "../../outside"})):
                (root / "active_thermal.json").write_text(value)
                selected, warning = select_active_model(root)
                self.assertEqual(selected, root / BASELINE_ID)
                self.assertIsNotNone(warning)

    def test_explicit_baseline_rollback_is_supported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.assertEqual(select_active_model(root), (root / BASELINE_ID, None))
            (root / "active_thermal.json").write_text(json.dumps({"model_id": BASELINE_ID}))
            self.assertEqual(select_active_model(root), (root / BASELINE_ID, None))


if __name__ == "__main__":
    unittest.main()
