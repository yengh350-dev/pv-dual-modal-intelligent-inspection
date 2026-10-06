import importlib.util
import unittest
from pathlib import Path


class InferenceSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = Path(__file__).resolve().parents[2] / "training_pipeline_v2/benchmark_thermal_inference.py"
        spec = importlib.util.spec_from_file_location("thermal_benchmark_tests", source)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def row(self, name, map95=.3, map50=.6, hotspot=.2, time=10):
        return {"id": name, "map50_95": map95, "map50": map50,
                "perClass": {"hotspot": {"map50_95": hotspot}}, "speedMs": {"inference": time}}

    def test_candidate_selection_is_validation_only_with_regression_guards(self):
        rows = [self.row("baseline"), self.row("slow", .9, time=41),
                self.row("poor_hotspot", .9, hotspot=.1), self.row("poor_map50", .9, map50=.5),
                self.row("better", .32)]
        self.assertEqual(self.module.select_candidate(rows)["id"], "better")

    def test_keep_baseline_when_all_candidates_regress(self):
        rows = [self.row("baseline"), self.row("bad", .29)]
        self.assertEqual(self.module.select_candidate(rows)["id"], "baseline")


if __name__ == "__main__":
    unittest.main()
