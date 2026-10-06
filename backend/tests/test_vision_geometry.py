import io
import math
import random
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from app.model_runtime import predict_image
from app.vision_geometry import normalize_polygon, serialize_detections, validate_visual_input


class Array:
    def __init__(self, value):
        self.value = value

    def cpu(self):
        return self

    def tolist(self):
        return self.value


def result_for(coords, scores=None, classes=None, shape=(50, 100)):
    return SimpleNamespace(orig_shape=shape, boxes=SimpleNamespace(
        xyxy=Array(coords), conf=Array(scores if scores is not None else [.8] * len(coords)),
        cls=Array(classes if classes is not None else [0] * len(coords))))


class VisionGeometryTests(unittest.TestCase):
    def test_clip_once_for_both_pixel_and_normalized_coordinates(self):
        detections, rejected = serialize_detections(result_for([[-5, 10, 120, 60]]), ["hotspot"])
        self.assertEqual(rejected, 0)
        self.assertEqual(detections[0]["box"], {"x1": 0., "y1": 10, "x2": 100, "y2": 50})
        self.assertEqual(detections[0]["boxNormalized"], {"x": 0., "y": .2, "width": 1., "height": .8})

    def test_reject_inverted_empty_nonfinite_scores_and_unknown_classes(self):
        result = result_for([[20, 10, 10, 20], [1, 1, 1, 2], [math.nan, 1, 2, 3],
                             [1, 1, 2, 3], [1, 1, 2, 3], [1, 1, 2, 3]],
                            [.8, .8, .8, math.inf, .8, .8], [0, 0, 0, 0, -1, .5])
        detections, rejected = serialize_detections(result, ["hotspot"])
        self.assertEqual(detections, [])
        self.assertEqual(rejected, 6)

    def test_normalized_coordinates_reconstruct_original_box_at_any_zoom(self):
        rng = random.Random(20261004)
        for _ in range(100):
            x1, x2 = sorted([rng.uniform(-100, 700), rng.uniform(-100, 700)])
            y1, y2 = sorted([rng.uniform(-100, 600), rng.uniform(-100, 600)])
            detections, _ = serialize_detections(result_for([[x1, y1, x2, y2]], shape=(512, 640)), ["hotspot"])
            for detection in detections:
                normalized, pixel = detection["boxNormalized"], detection["box"]
                for zoom in (.25, 1, 4):
                    self.assertAlmostEqual(normalized["x"] * 640 * zoom, pixel["x1"] * zoom, delta=.03)
                    self.assertAlmostEqual((normalized["y"] + normalized["height"]) * 512 * zoom, pixel["y2"] * zoom, delta=.03)

    def test_polygon_rejects_nonfinite_and_zero_area(self):
        self.assertEqual(normalize_polygon([[0, 0], [1, 1], [2, 2]]), [])
        self.assertEqual(normalize_polygon([[0, 0], [1, 0], [math.nan, 1]]), [])
        self.assertEqual(normalize_polygon([[-.1, -.1], [1.1, 0], [0, 1.1]]), [[0., 0.], [1., 0.], [0., 1.]])

    def test_invalid_image_is_rejected_before_loading_model(self):
        with patch("app.model_runtime._load_model") as load:
            with self.assertRaisesRegex(ValueError, "无法解析"):
                predict_image(b"\xff\xd8\xfftruncated", ".jpg", .25, .7)
            load.assert_not_called()

    def test_input_thresholds_and_pixel_limit(self):
        buffer = io.BytesIO()
        Image.new("RGB", (32, 32)).save(buffer, format="PNG")
        for invalid in (math.nan, math.inf, -.1, 1.1):
            with self.assertRaises(ValueError):
                validate_visual_input(buffer.getvalue(), ".png", invalid, .7)
        with patch("app.vision_geometry.open_raster") as image:
            image.return_value.__enter__.return_value = SimpleNamespace(width=5000, height=5000)
            with self.assertRaisesRegex(ValueError, "1600"):
                validate_visual_input(b"mock", ".png", .25, .7)


if __name__ == "__main__":
    unittest.main()
