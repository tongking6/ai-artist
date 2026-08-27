from __future__ import annotations

import hashlib
import io
import logging
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Event, Thread
from uuid import UUID, uuid4

from PIL import Image
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from ai_artist.adapters.generation import (
    FakeGenerationProvider,
    GeneratePostcardInput,
    GenerationProvider,
    OpenAIGenerationProvider,
)
from ai_artist.adapters.object_store import ObjectStore, S3ObjectStore
from ai_artist.config import Settings, get_settings
from ai_artist.database import SessionLocal, engine
from ai_artist.ids import new_id
from ai_artist.models import Artifact, Asset, Attempt, Task

logger = logging.getLogger("ai_artist.worker")


class FinalizationFenceError(RuntimeError):
    pass


@dataclass(frozen=True)
class ClaimedAttempt:
    attempt_id: str
    task_id: str
    lease_token: UUID
    lease_expires_at: datetime
    input_snapshot: dict[str, object]
    provider_id: str
    provider_model: str


def utcnow() -> datetime:
    return datetime.now(UTC)


def claim_attempt(session: Session, settings: Settings) -> ClaimedAttempt | None:
    now = utcnow()
    with session.begin():
        attempt = session.scalar(
            select(Attempt)
            .where(Attempt.status == "queued")
            .order_by(Attempt.created_at, Attempt.attempt_id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if attempt is None:
            return None
        lease_token = uuid4()
        lease_expires_at = now + timedelta(seconds=settings.attempt_lease_seconds)
        attempt.status = "generating"
        attempt.lease_token = lease_token
        attempt.lease_expires_at = lease_expires_at
        attempt.started_at = now
        attempt.updated_at = now
        task = session.get(Task, attempt.task_id)
        if task is None:
            raise RuntimeError("Attempt references a missing Task")
        task.updated_at = now
        return ClaimedAttempt(
            attempt_id=attempt.attempt_id,
            task_id=attempt.task_id,
            lease_token=lease_token,
            lease_expires_at=lease_expires_at,
            input_snapshot=dict(attempt.input_snapshot),
            provider_id=attempt.provider_id,
            provider_model=attempt.provider_model,
        )


def reconcile_expired_attempts(session: Session) -> int:
    now = utcnow()
    with session.begin():
        attempts = list(
            session.scalars(
                select(Attempt)
                .where(
                    Attempt.status == "generating",
                    Attempt.lease_expires_at <= now,
                )
                .with_for_update(skip_locked=True)
            )
        )
        for attempt in attempts:
            attempt.status = "failed"
            attempt.failure_code = "generation_failed"
            attempt.lease_token = None
            attempt.lease_expires_at = None
            attempt.completed_at = now
            attempt.updated_at = now
            task = session.get(Task, attempt.task_id)
            if task is not None:
                task.updated_at = now
        return len(attempts)


def process_claimed_attempt(
    claimed: ClaimedAttempt,
    *,
    settings: Settings,
    object_store: ObjectStore,
    provider: GenerationProvider,
) -> None:
    output_key = f"tasks/{claimed.task_id}/attempts/{claimed.attempt_id}/postcard.png"
    stored_output = False
    finalization_started = False
    try:
        if (
            provider.provider_id != claimed.provider_id
            or provider.provider_model != claimed.provider_model
        ):
            raise RuntimeError("Attempt provider does not match the configured provider")
        photo_ids = claimed.input_snapshot.get("photo_asset_ids")
        if not isinstance(photo_ids, list) or not 1 <= len(photo_ids) <= 5:
            raise RuntimeError("Attempt input snapshot has invalid photo references")
        if claimed.input_snapshot.get("prompt_recipe_version") != "m1.postcard_prompt.v1":
            raise RuntimeError("Attempt input snapshot has an unsupported prompt recipe")

        with SessionLocal() as session:
            assets = list(
                session.scalars(
                    select(Asset).where(
                        Asset.task_id == claimed.task_id,
                        Asset.asset_id.in_([str(asset_id) for asset_id in photo_ids]),
                        Asset.upload_status == "uploaded",
                    )
                )
            )
        assets_by_id = {asset.asset_id: asset for asset in assets}
        if set(assets_by_id) != {str(asset_id) for asset_id in photo_ids}:
            raise RuntimeError("Attempt source assets are unavailable")

        source_photos: list[bytes] = []
        for asset_id in photo_ids:
            source = object_store.get(assets_by_id[str(asset_id)].storage_key)
            with Image.open(io.BytesIO(source)) as image:
                image.verify()
            source_photos.append(source)

        generated = provider.generate_postcard(
            GeneratePostcardInput(
                snapshot=claimed.input_snapshot,
                source_photos=tuple(source_photos),
            )
        )
        normalized = normalize_postcard(generated.png_bytes)
        checksum = hashlib.sha256(normalized).digest()
        object_store.put(output_key, normalized, "image/png")
        stored_output = True
        stored = object_store.inspect(output_key)
        if (
            stored is None
            or stored.media_type != "image/png"
            or stored.size_bytes != len(normalized)
        ):
            raise RuntimeError("Stored postcard failed verification")
        finalization_started = True
        try:
            finalize_ready(
                claimed,
                provider_request_id=generated.provider_request_id,
                output_key=output_key,
                output_bytes=normalized,
                checksum=checksum,
            )
        except FinalizationFenceError:
            object_store.delete(output_key)
            stored_output = False
            raise
    except Exception:
        logger.exception(
            "Attempt generation failed",
            extra={"task_id": claimed.task_id, "attempt_id": claimed.attempt_id},
        )
        if stored_output and not finalization_started:
            object_store.delete(output_key)
        elif stored_output:
            logger.warning(
                "Preserving attempt output because database finalization is uncertain",
                extra={"task_id": claimed.task_id, "attempt_id": claimed.attempt_id},
            )
        finalize_failed(claimed)


def normalize_postcard(provider_png: bytes) -> bytes:
    with Image.open(io.BytesIO(provider_png)) as image:
        if image.format != "PNG" or image.size != (1808, 1200):
            raise RuntimeError("Provider output is not the required 1808x1200 PNG")
        normalized = image.convert("RGB").crop((4, 0, 1804, 1200))
        output = io.BytesIO()
        normalized.save(output, format="PNG", optimize=False)
    png_bytes = output.getvalue()
    if not 1 <= len(png_bytes) <= 20 * 1024 * 1024:
        raise RuntimeError("Normalized postcard has an invalid size")
    with Image.open(io.BytesIO(png_bytes)) as verified:
        if verified.format != "PNG" or verified.size != (1800, 1200):
            raise RuntimeError("Normalized postcard failed verification")
    return png_bytes


def finalize_ready(
    claimed: ClaimedAttempt,
    *,
    provider_request_id: str | None,
    output_key: str,
    output_bytes: bytes,
    checksum: bytes,
) -> None:
    now = utcnow()
    with SessionLocal() as session, session.begin():
        attempt = session.scalar(
            select(Attempt)
            .where(
                Attempt.attempt_id == claimed.attempt_id,
                Attempt.status == "generating",
                Attempt.lease_token == claimed.lease_token,
                Attempt.lease_expires_at > now,
            )
            .with_for_update()
        )
        if attempt is None:
            raise FinalizationFenceError("Attempt lease is no longer eligible for finalization")
        artifact = Artifact(
            artifact_id=new_id("artifact"),
            task_id=claimed.task_id,
            attempt_id=claimed.attempt_id,
            artifact_type="postcard",
            filename=f"{_filename_slug(claimed.input_snapshot)}.png",
            mime_type="image/png",
            size_bytes=len(output_bytes),
            sha256=checksum,
            storage_key=output_key,
            created_at=now,
        )
        session.add(artifact)
        attempt.status = "ready"
        attempt.provider_request_id = provider_request_id
        attempt.lease_token = None
        attempt.lease_expires_at = None
        attempt.completed_at = now
        attempt.updated_at = now
        task = session.get(Task, claimed.task_id)
        if task is None:
            raise RuntimeError("Attempt references a missing Task")
        task.updated_at = now


def finalize_failed(claimed: ClaimedAttempt) -> None:
    now = utcnow()
    with SessionLocal() as session, session.begin():
        attempt = session.scalar(
            select(Attempt)
            .where(
                Attempt.attempt_id == claimed.attempt_id,
                Attempt.status == "generating",
                Attempt.lease_token == claimed.lease_token,
                Attempt.lease_expires_at > now,
            )
            .with_for_update()
        )
        if attempt is None:
            return
        attempt.status = "failed"
        attempt.failure_code = "generation_failed"
        attempt.lease_token = None
        attempt.lease_expires_at = None
        attempt.completed_at = now
        attempt.updated_at = now
        task = session.get(Task, claimed.task_id)
        if task is not None:
            task.updated_at = now


def _reconcile_once() -> None:
    with SessionLocal() as session:
        reconciled = reconcile_expired_attempts(session)
    if reconciled:
        logger.info("Reconciled expired attempts", extra={"attempt_count": reconciled})


def _reconcile_loop(settings: Settings, stop_event: Event) -> None:
    while not stop_event.is_set():
        try:
            _reconcile_once()
        except Exception:
            logger.exception("Expired attempt reconciliation failed")
        if stop_event.wait(settings.attempt_reconcile_interval_seconds):
            return


def run_once(settings: Settings, object_store: ObjectStore) -> bool:
    with SessionLocal() as session:
        claimed = claim_attempt(session, settings)
    if claimed is None:
        return False
    process_claimed_attempt(
        claimed,
        settings=settings,
        object_store=object_store,
        provider=_provider_for(settings),
    )
    return True


def _provider_for(settings: Settings) -> GenerationProvider:
    if settings.generation_provider == "openai":
        return OpenAIGenerationProvider()
    return FakeGenerationProvider()


def wait_for_dependencies(
    object_store: ObjectStore,
    *,
    timeout_seconds: float = 180,
    poll_seconds: float = 1,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            if inspect(engine).has_table("attempts"):
                object_store.ensure_bucket()
                return
        except Exception:
            logger.info("Waiting for PostgreSQL schema and object storage")
        if time.monotonic() >= deadline:
            raise RuntimeError("Worker dependencies did not become ready in time")
        time.sleep(poll_seconds)


def run() -> None:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    object_store = S3ObjectStore(settings)
    wait_for_dependencies(object_store)
    logger.info("AI Artist worker started", extra={"provider": settings.generation_provider})
    stop_event = Event()
    reconciler = Thread(
        target=_reconcile_loop,
        args=(settings, stop_event),
        name="attempt-reconciler",
        daemon=True,
    )
    reconciler.start()
    try:
        while True:
            processed = run_once(settings, object_store)
            if not processed:
                time.sleep(settings.worker_poll_seconds)
    finally:
        stop_event.set()
        reconciler.join(timeout=5)


def _filename_slug(snapshot: dict[str, object]) -> str:
    title = str(snapshot.get("title") or "memory-postcard")
    normalized = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug[:80] or "memory-postcard"


if __name__ == "__main__":
    run()
