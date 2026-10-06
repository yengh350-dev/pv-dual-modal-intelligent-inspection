import io
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from PIL import Image

from app.multimodel_runtime import model_catalog, predict_cell_image, predict_power, predict_fault_csv, _window_features
from app.schemas import PowerPredictionRequest


class MultiModelRuntimeTests(unittest.TestCase):
    def test_catalog_exposes_registered_artifacts(self):
        catalog = model_catalog()
        ids = {model["model_id"] for model in catalog["models"]}
        self.assertIn("cell_anomaly_cnn_v1", ids)
        self.assertIn("grid_fault_rf_v1", ids)
        self.assertIn("pv_power_hgb_v1", ids)
        self.assertIn("panel_segmentation_yolo11n_v1", ids)
        self.assertTrue(all(model["artifactReady"] for model in catalog["models"]))

    def test_power_prediction_maps_api_fields_to_training_columns(self):
        result = predict_power({
            "ambient_temperature": 25,
            "irradiance": 800,
            "module_temperature": 46,
            "inclination_angle": 30,
            "humidity": 55,
            "hour": 12,
        })
        self.assertGreaterEqual(result["predictedPower"], 0)
        self.assertEqual(result["modelId"], "pv_power_hgb_v1")
        self.assertTrue(result["reviewRequired"])

    def test_cell_prediction_rejects_non_image_bytes(self):
        with self.assertRaisesRegex(ValueError, "无法解析图像"):
            predict_cell_image(b"not-an-image")

    def test_cell_prediction_returns_all_labels(self):
        image = Image.new("L", (300, 300), color=128)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        result = predict_cell_image(buffer.getvalue())
        self.assertEqual(len(result["predictions"]), 3)
        self.assertTrue(result["reviewRequired"])

    def test_power_schema_features_match_runtime_contract(self):
        payload = PowerPredictionRequest(ambientTemperature=25, irradiance=800, moduleTemperature=46,
                                         inclinationAngle=30, humidity=55, hour=12)
        result = predict_power(payload.as_model_features())
        self.assertGreaterEqual(result["predictedPower"], 0)

    def test_power_rejects_nonfinite_values_instead_of_silent_zero(self):
        features = {"ambient_temperature": float("nan"), "irradiance": 800,
                    "module_temperature": 46, "inclination_angle": 30, "humidity": 55, "hour": 12}
        with self.assertRaisesRegex(ValueError, "有限"):
            predict_power(features)

    def waveform(self, rows=1024):
        columns = ["Ipv", "Vpv", "Vdc", "ia", "ib", "ic", "va", "vb", "vc", "Iabc", "If", "Vabc", "Vf"]
        return pd.DataFrame({"Time": np.arange(rows) * .0001, **{c: np.ones(rows) for c in columns}})

    def test_fractional_hour_matches_training_whole_hour_encoding(self):
        with patch("app.multimodel_runtime._load_joblib") as load:
            model = load.return_value["model"]
            model.predict.return_value = [12.0]
            load.return_value = {"model": model, "features": ["hour_sin", "hour_cos"]}
            predict_power({"ambient_temperature": 25, "irradiance": 800, "module_temperature": 46,
                           "inclination_angle": 30, "humidity": 55, "hour": 12.75})
            features = model.predict.call_args[0][0]
            self.assertAlmostEqual(features["hour_sin"].iloc[0], 0)
            self.assertAlmostEqual(features["hour_cos"].iloc[0], -1)

    def test_waveform_rejects_nan_bad_time_and_missing_samples_before_model(self):
        for kind in ("nan", "duplicate", "gap", "text"):
            frame = self.waveform()
            if kind == "nan":
                frame.loc[5, "Vpv"] = float("nan")
            elif kind == "duplicate":
                frame.loc[5, "Time"] = frame.loc[4, "Time"]
            elif kind == "gap":
                frame.loc[512:, "Time"] += 1
            else:
                frame["Vpv"] = "bad"
            with patch("app.multimodel_runtime._load_joblib") as load:
                with self.assertRaises(ValueError):
                    predict_fault_csv(frame.to_csv(index=False).encode())
                load.assert_not_called()

    def test_waveform_exposes_transient_window_and_unused_tail(self):
        frame = self.waveform(rows=1030)
        _, names = _window_features(frame)
        frame["operator_note"] = "ignored metadata"
        with patch("app.multimodel_runtime._load_joblib") as load:
            model = load.return_value["model"]
            model.predict_proba.return_value = np.array([[.99, .01], [.1, .9]])
            model.classes_ = np.array(["normal", "fault"])
            load.return_value = {"model": model, "features": names}
            result = predict_fault_csv(frame.to_csv(index=False).encode())
        self.assertEqual(result["dominantClass"], "normal")
        self.assertEqual(result["windowPredictions"][1]["className"], "fault")
        self.assertEqual(result["windowPredictions"][1]["startSample"], 512)
        self.assertEqual(result["discardedSamples"], 6)
        self.assertAlmostEqual(result["medianTimeStep"], .0001)


if __name__ == "__main__":
    unittest.main()
