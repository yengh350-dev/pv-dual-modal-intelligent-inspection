import unittest

from app.decision_engine import evaluate_evidence, evaluate_mission_quality


def valid_payload():
    return {
        "alignment_quality": 0.94,
        "registration_error_px": 1.7,
        "sync_offset_ms": 24,
        "localization_accuracy_m": 1.8,
        "persistent_frames": 6,
        "persistent_seconds": 4.2,
        "radiometric_calibrated": True,
        "environment_complete": True,
        "temperature_delta_c": 18.6,
        "model_confidence": 0.92,
        "irradiance_w_m2": 784,
        "temperature_uncertainty_c": 1.2,
        "reflection_risk": 0.08,
        "occlusion_ratio": 0.04,
        "repeat_observations": 3,
        "asset_criticality": 0.8,
    }


class DecisionEngineTests(unittest.TestCase):
    def test_strong_evidence_is_prioritized_but_not_auto_diagnosed(self):
        result = evaluate_evidence(valid_payload())
        self.assertEqual(result["gateStatus"], "pass")
        self.assertEqual(result["priority"], "critical_review")
        self.assertFalse(result["automaticFaultConclusion"])
        self.assertGreaterEqual(result["qualityScore"], 85)
        self.assertGreaterEqual(result["reviewPriorityScore"], 75)
        self.assertTrue(result["actionEligibility"]["canCreateWorkOrder"])

    def test_missing_calibration_blocks_engineering_classification(self):
        payload = valid_payload()
        payload["radiometric_calibrated"] = False
        result = evaluate_evidence(payload)
        self.assertEqual(result["gateStatus"], "blocked")
        self.assertEqual(result["priority"], "unrated")
        self.assertTrue(any("标定" in item for item in result["blockers"]))

    def test_single_frame_and_bad_registration_require_recollection(self):
        payload = valid_payload()
        payload["persistent_frames"] = 1
        payload["registration_error_px"] = 6.2
        result = evaluate_evidence(payload)
        self.assertEqual(result["gateStatus"], "blocked")
        self.assertGreaterEqual(len(result["blockers"]), 2)

    def test_high_confidence_cannot_bypass_low_quality_evidence(self):
        payload = valid_payload()
        payload.update({"model_confidence": 0.99, "temperature_delta_c": 35, "alignment_quality": 0.72})
        result = evaluate_evidence(payload)
        self.assertEqual(result["gateStatus"], "blocked")
        self.assertEqual(result["reviewPriorityScore"], 0)
        self.assertFalse(result["actionEligibility"]["canCreateWorkOrder"])

    def test_reflection_and_occlusion_reduce_reliability_and_priority(self):
        clean = evaluate_evidence(valid_payload())
        noisy_payload = valid_payload()
        noisy_payload.update({"reflection_risk": 0.50, "occlusion_ratio": 0.30})
        noisy = evaluate_evidence(noisy_payload)
        self.assertLess(noisy["reliabilityScore"], clean["reliabilityScore"])
        self.assertLess(noisy["reviewPriorityScore"], clean["reviewPriorityScore"])
        self.assertEqual(noisy["gateStatus"], "review")

    def test_low_irradiance_requires_reflight(self):
        payload = valid_payload()
        payload["irradiance_w_m2"] = 180
        result = evaluate_evidence(payload)
        self.assertEqual(result["gateStatus"], "blocked")
        self.assertTrue(result["actionEligibility"]["requiresReflight"])

    def test_mission_quality_blocks_bad_localization_chain(self):
        result = evaluate_mission_quality({
            "crossTrackP95M": 1.82, "rtkFixRatePct": 63.4, "altitudeP95M": 1.9,
            "geotagP95M": 1.6, "rgbThermalPairRatePct": 92.8,
            "pairTimeSkewP95Ms": 86, "minimumViewAngleDeg": 56,
        })
        self.assertEqual(result["status"], "blocked")
        self.assertFalse(result["analysisAllowed"])
        self.assertTrue(any("RTK" in item for item in result["blockers"]))

    def test_mission_quality_passes_traceable_batch(self):
        result = evaluate_mission_quality({
            "crossTrackP95M": 0.32, "rtkFixRatePct": 99.4, "altitudeP95M": 0.9,
            "geotagP95M": 0.11, "rgbThermalPairRatePct": 98.2,
            "pairTimeSkewP95Ms": 42, "minimumViewAngleDeg": 72,
        })
        self.assertEqual(result["status"], "pass")
        self.assertTrue(result["analysisAllowed"])
        self.assertGreaterEqual(result["score"], 85)


if __name__ == "__main__":
    unittest.main()
