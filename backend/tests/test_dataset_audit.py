import importlib.util
import tempfile
import unittest
from pathlib import Path

from PIL import Image
import yaml

spec = importlib.util.spec_from_file_location("dataset_audit", Path(__file__).resolve().parents[2] / "training_pipeline_v2/audit_detection_dataset.py")
audit_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_module)


class DatasetAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for split, color in zip(("train", "val", "test"), ("red", "blue", "green")):
            (self.root / split / "images").mkdir(parents=True)
            (self.root / split / "labels").mkdir()
            Image.new("RGB", (64, 48), color).save(self.root / split / "images/frame.png")
            (self.root / split / "labels/frame.txt").write_text("0 .5 .5 .1 .1\n")
        self.data = self.root / "dataset.yaml"
        self.data.write_text(yaml.safe_dump({"path": str(self.root), "names": ["hotspot"],
            **{s: s + "/images" for s in ("train", "val", "test")}}))

    def tearDown(self):
        self.temp.cleanup()

    def test_clean_structure_does_not_claim_flight_independence(self):
        result = audit_module.audit_dataset(self.data)
        self.assertTrue(result["structuralGatePassed"])
        self.assertFalse(result["captureGroupsVerified"])

    def test_pixel_duplicates_detect_different_encoding(self):
        Image.new("RGB", (64, 48), "red").save(self.root / "test/images/frame.png", compress_level=0)
        result = audit_module.audit_dataset(self.data)
        self.assertFalse(result["structuralGatePassed"])
        self.assertEqual(len(result["crossSplitDuplicates"]), 1)

    def test_group_leakage_and_out_of_bounds_are_blockers(self):
        groups = {s + "/images/frame.png": "same-flight" for s in ("train", "val", "test")}
        result = audit_module.audit_dataset(self.data, groups)
        self.assertFalse(result["structuralGatePassed"])
        self.assertIn("same-flight", result["captureGroupLeakage"])
        (self.root / "train/labels/frame.txt").write_text("0 .99 .5 .2 .2\n")
        result = audit_module.audit_dataset(self.data)
        self.assertEqual(result["errors"][0]["code"], "INVALID_SAMPLE")

    def test_nonfinite_labels_are_rejected_not_repaired(self):
        (self.root / "train/labels/frame.txt").write_text("0 nan .5 .2 .2\n")
        self.assertFalse(audit_module.audit_dataset(self.data)["structuralGatePassed"])
