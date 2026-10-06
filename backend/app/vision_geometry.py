"""Validate visual inputs and preserve a single original-image coordinate system."""
import io
import math

from PIL import Image, JpegImagePlugin, PngImagePlugin, UnidentifiedImageError


def open_raster(content):
    # Explicit codecs avoid the YOLO global Image.open HEIF fallback on corrupt uploads.
    source = io.BytesIO(content)
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return PngImagePlugin.PngImageFile(source)
    if content.startswith(b"\xff\xd8\xff"):
        return JpegImagePlugin.JpegImageFile(source)
    raise UnidentifiedImageError("Only JPEG and PNG are supported")


def validate_visual_input(content, suffix, confidence, iou):
    if suffix.lower() not in {".jpg", ".jpeg", ".png"}:
        raise ValueError("仅支持 JPEG 或 PNG 图像")
    if not all(math.isfinite(v) and 0 <= v <= 1 for v in (confidence, iou)):
        raise ValueError("置信度和 IoU 必须为 0 到 1 的有限数值")
    try:
        with open_raster(content) as image:
            if image.width * image.height > 16_000_000:
                raise ValueError("图像超过 1600 万像素，请缩小后上传")
            if image.format not in {"JPEG", "PNG"}:
                raise ValueError("仅支持 JPEG 或 PNG 图像")
            image.verify()
    except (UnidentifiedImageError, SyntaxError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("无法解析图像，请上传完整的 JPEG 或 PNG") from exc


def serialize_detections(result, names):
    height, width = map(int, result.orig_shape)
    if height <= 0 or width <= 0:
        raise ValueError("模型返回的图像尺寸无效")
    detections, rejected = [], 0
    if result.boxes is None:
        return detections, rejected
    for coords, score, class_value in zip(result.boxes.xyxy.cpu().tolist(),
                                         result.boxes.conf.cpu().tolist(), result.boxes.cls.cpu().tolist()):
        values = [*coords, score, class_value]
        if (len(coords) != 4 or not all(math.isfinite(v) for v in values) or
                not 0 <= score <= 1 or class_value != int(class_value) or not 0 <= class_value < len(names)):
            rejected += 1
            continue
        x1, y1, x2, y2 = coords
        x1, x2 = max(0., min(width, x1)), max(0., min(width, x2))
        y1, y2 = max(0., min(height, y1)), max(0., min(height, y2))
        if x2 <= x1 or y2 <= y1:
            rejected += 1
            continue
        class_id = int(class_value)
        # Derive both representations from the same clipped, unrounded coordinates.
        detections.append({"classId": class_id, "className": names[class_id],
            "confidence": round(float(score), 6),
            "box": {"x1": round(x1, 2), "y1": round(y1, 2), "x2": round(x2, 2), "y2": round(y2, 2)},
            "boxNormalized": {"x": round(x1 / width, 6), "y": round(y1 / height, 6),
                              "width": round((x2 - x1) / width, 6), "height": round((y2 - y1) / height, 6)}})
    return detections, rejected


def normalize_polygon(polygon):
    if len(polygon) < 3 or any(len(p) != 2 or not all(math.isfinite(v) for v in p) for p in polygon):
        return []
    points = [[round(max(0., min(1., float(v))), 6) for v in p] for p in polygon]
    area2 = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1]))
    return points if abs(area2) > 1e-12 else []
