import hashlib
import io
import logging
from datetime import timedelta, timezone
from threading import Event, Lock, Thread
from time import perf_counter
from uuid import uuid4

from PIL import ImageOps
from sqlalchemy import select, update

from .database import SessionLocal
from .models import AnalysisTask, AuditLog, EvidenceFrame, EvidencePair, LiveObservation, utcnow
from .model_runtime import predict_image
from .multimodel_runtime import predict_visible_defect
from .vision_geometry import open_raster
from .evidence_fusion import associate_evidence, capture_datetime

logger = logging.getLogger(__name__)
inference_slot = Lock()
MAX_ATTEMPTS = 3
LEASE_SECONDS = 120


def canonical_image(content: bytes) -> tuple[bytes, int, int]:
    with open_raster(content) as image:
        if image.width * image.height > 16_000_000:
            raise ValueError("图像超过 1600 万像素")
        image.load()
        image = ImageOps.exif_transpose(image).convert("RGB")
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue(), image.width, image.height


def predict_frame(frame, confidence, profile):
    content, _, _ = canonical_image(frame.image)
    predictor = predict_image if frame.modality == "THERMAL" else predict_visible_defect
    return content, predictor(content, ".png", confidence, .7, profile=profile)


class AnalysisWorker:
    """Single CPU worker. Database leases fence late results across processes."""
    def __init__(self, session_factory=SessionLocal):
        self.sessions = session_factory
        self.stop = Event()
        self.thread = None

    def start(self):
        self.thread = Thread(target=self.run, name="analysis-worker", daemon=True)
        self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=5)

    def run(self):
        while not self.stop.is_set():
            try:
                if not self.run_one():
                    self.stop.wait(.5)
            except Exception:
                logger.exception("Analysis scheduler failed")
                self.stop.wait(2)

    def recover(self, db):
        now = utcnow()
        expired = AnalysisTask.lease_until < now
        db.execute(update(AnalysisTask).where(AnalysisTask.state == "cancel_requested", expired).values(
            state="cancelled", completed_at=now, lease_token=None, lease_until=None))
        db.execute(update(AnalysisTask).where(AnalysisTask.state == "running", expired,
                    AnalysisTask.attempts < MAX_ATTEMPTS).values(state="queued", lease_token=None, lease_until=None))
        db.execute(update(AnalysisTask).where(AnalysisTask.state == "running", expired,
                    AnalysisTask.attempts >= MAX_ATTEMPTS).values(state="failed", error="WORKER_RESTART_LIMIT",
                        completed_at=now, lease_token=None, lease_until=None))
        db.commit()

    def heartbeat(self, task_id, token, done):
        while not done.wait(20):
            with self.sessions() as db:
                db.execute(update(AnalysisTask).where(AnalysisTask.id == task_id,
                    AnalysisTask.lease_token == token, AnalysisTask.state.in_(["running", "cancel_requested"])).values(
                    lease_until=utcnow() + timedelta(seconds=LEASE_SECONDS)))
                db.commit()

    def run_one(self):
        if not inference_slot.acquire(blocking=False):
            return False
        done = Event()
        pulse = None
        try:
            with self.sessions() as db:
                self.recover(db)
                task = db.scalar(select(AnalysisTask).where(AnalysisTask.state == "queued")
                                 .order_by(AnalysisTask.created_at, AnalysisTask.id).limit(1))
                if task is None:
                    return False
                token = str(uuid4())
                now = utcnow()
                claimed = db.execute(update(AnalysisTask).where(AnalysisTask.id == task.id,
                    AnalysisTask.state == "queued").values(state="running", lease_token=token,
                    lease_until=now + timedelta(seconds=LEASE_SECONDS), started_at=now,
                    attempts=AnalysisTask.attempts + 1, error=None))
                db.commit()
                if claimed.rowcount != 1:
                    return False
                db.refresh(task)
                pulse = Thread(target=self.heartbeat, args=(task.id, token, done), daemon=True)
                pulse.start()
                started = perf_counter()
                predictions, images, failures = {}, {}, {}
                primary = db.get(EvidenceFrame, task.frame_id)
                pair = db.get(EvidencePair, task.pair_id) if task.pair_id else None
                frames = [primary]
                if pair:
                    frames = [db.get(EvidenceFrame, pair.thermal_frame_id), db.get(EvidenceFrame, pair.rgb_frame_id)]
                for frame in frames:
                    db.expire(task)
                    if task.state != "running" or task.lease_token != token:
                        break
                    try:
                        images[frame.modality], predictions[frame.modality] = predict_frame(frame, task.config["confidence"], "precision")
                    except Exception:
                        logger.exception("Modality inference unavailable: %s", frame.modality)
                        failures[frame.modality] = "MODEL_OR_INPUT_UNAVAILABLE"
                fusion = {"state": "single_modality", "reasons": ["PAIR_NOT_PROVIDED"], "matches": []}
                if pair and len(predictions) == 2:
                    fusion = associate_evidence(predictions["RGB"], predictions["THERMAL"],
                        frames[1].metadata_json, frames[0].metadata_json, pair.registration)
                elif pair:
                    fusion = {"state": "degraded", "reasons": ["MODALITY_UNAVAILABLE"], "matches": []}
                result = {"schemaVersion": "analysis-result-1.0", "profile": "precision", "reviewRequired": True,
                    "predictions": predictions, "fusion": fusion, "failures": failures,
                    "lineage": [{"frameId": f.id, "modality": f.modality, "sha256": f.sha256,
                                 "width": f.width, "height": f.height, "coordinateFrame": "exif_transposed_rgb",
                                 "metadata": f.metadata_json} for f in frames],
                    "timing": {"queueWaitMs": round((now - task.created_at.replace(tzinfo=timezone.utc)).total_seconds() * 1000, 2) if task.attempts == 1 else None,
                               "submissionToAttemptStartMs": round((now - task.created_at.replace(tzinfo=timezone.utc)).total_seconds() * 1000, 2),
                               "processingMs": round((perf_counter() - started) * 1000, 2)},
                    "boundary": "正式检测使用已验证的模型原生分辨率；空间关联不是故障确认，须人工复核，不自动派单。"}
                self.finish(db, task.id, token, result, frames, images)
                return True
        finally:
            done.set()
            if pulse:
                pulse.join(timeout=2)
            inference_slot.release()

    def finish(self, db, task_id, token, result, frames, images):
        # Compare-and-set first: cancellation or an expired lease cannot publish a late result.
        task = db.get(AnalysisTask, task_id)
        db.refresh(task)
        if task.lease_token != token:
            return
        if task.state == "cancel_requested":
            db.execute(update(AnalysisTask).where(AnalysisTask.id == task_id, AnalysisTask.lease_token == token,
                AnalysisTask.state == "cancel_requested").values(state="cancelled", completed_at=utcnow(),
                lease_token=None, lease_until=None))
            db.commit()
            return
        prediction = result["predictions"]
        state = "succeeded" if prediction else "failed"
        changed = db.execute(update(AnalysisTask).where(AnalysisTask.id == task_id,
            AnalysisTask.lease_token == token, AnalysisTask.lease_until > utcnow(), AnalysisTask.state == "running").values(
            state=state, result=result, error=None if prediction else "ALL_MODALITIES_UNAVAILABLE",
            completed_at=utcnow(), lease_token=None, lease_until=None).execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            db.rollback()
            return
        if prediction:
            modality = "THERMAL" if "THERMAL" in prediction else "RGB"
            frame = next(f for f in frames if f.modality == modality)
            metadata = frame.metadata_json
            captured = metadata.get("captured_at")
            observation = LiveObservation(id="OBS-" + uuid4().hex[:20], actor_id=task.actor_id,
                mission_id=task.mission_id, source_kind=metadata["source_kind"], source_name=metadata["source_name"],
                modality=modality, media_time=metadata["media_time"],
                captured_at=capture_datetime(captured) if captured else task.created_at,
                image=images[modality], image_hash=hashlib.sha256(images[modality]).hexdigest(),
                prediction={**prediction[modality], "analysisTaskId": task_id, "fusion": result["fusion"]})
            db.add(observation)
            db.flush()
            db.execute(update(AnalysisTask).where(AnalysisTask.id == task_id).values(observation_id=observation.id))
        db.add(AuditLog(actor_id=task.actor_id, action="analysis." + state, resource_type="analysis_task",
                        resource_id=task_id, detail="版本化结果；需人工复核"))
        db.commit()
