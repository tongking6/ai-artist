from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from typing import Literal, cast

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ai_artist.adapters.object_store import ObjectStore
from ai_artist.config import Settings
from ai_artist.errors import DomainError, task_not_found
from ai_artist.ids import new_id
from ai_artist.models import Artifact, Asset, Attempt, Task, TaskStatus
from ai_artist.schemas import (
    ArtifactView,
    AttemptListView,
    AttemptSummaryView,
    AttemptView,
    CreateAttemptInput,
    CreateTaskView,
    DownloadView,
    PhotoView,
    TaskListView,
    TaskSummaryView,
    TaskView,
    UpdateTaskInput,
    UploadConstraintsView,
    UploadSlotsInput,
    UploadSlotsView,
    UploadSlotView,
    UploadSummaryView,
)

MAX_PHOTOS = 5
MAX_PHOTO_BYTES = 20 * 1024 * 1024
POSTCARD_STYLES = {
    "warm_handmade",
    "manga_zine",
    "impressionist_light",
    "fauvist_expressive",
    "childlike_crayon",
}


def utcnow() -> datetime:
    return datetime.now(UTC)


def create_task(session: Session) -> CreateTaskView:
    now = utcnow()
    task = Task(task_id=new_id("task"), status="draft", created_at=now, updated_at=now)
    session.add(task)
    session.commit()
    return CreateTaskView(task_id=task.task_id, status="draft")


def get_task(session: Session, task_id: str) -> TaskView:
    task = session.get(Task, task_id)
    if task is None:
        raise task_not_found()
    _expire_stale_assets(session, task)
    session.commit()
    return _task_view(session, task)


def list_tasks(
    session: Session,
    *,
    limit: int,
    cursor: str | None,
) -> TaskListView:
    now = utcnow()
    with session.begin():
        _expire_stale_assets_for_collection(session, now)
        session.flush()
        statement = select(Task).order_by(Task.updated_at.desc(), Task.task_id.desc())
        if cursor:
            cursor_time, cursor_id = _decode_cursor(cursor)
            statement = statement.where(
                or_(
                    Task.updated_at < cursor_time,
                    and_(Task.updated_at == cursor_time, Task.task_id < cursor_id),
                )
            )
        tasks = list(session.scalars(statement.limit(limit + 1)))
        has_more = len(tasks) > limit
        tasks = tasks[:limit]
        summaries = [_task_summary_view(session, task) for task in tasks]
        next_cursor = _encode_cursor(tasks[-1]) if has_more and tasks else None
    return TaskListView(tasks=summaries, next_cursor=next_cursor)


def update_task(
    session: Session,
    task_id: str,
    body: UpdateTaskInput,
) -> TaskView:
    with session.begin():
        task = _locked_task(session, task_id)
        _expire_stale_assets(session, task)
        attempt_count = session.scalar(
            select(func.count()).select_from(Attempt).where(Attempt.task_id == task_id)
        )
        if task.status == "ready" or (attempt_count or 0) > 0:
            raise DomainError(409, "task_immutable", "Task inputs are immutable.")

        for field in body.model_fields_set:
            value = getattr(body, field)
            if value is None:
                raise DomainError(
                    400,
                    "invalid_task_metadata",
                    "Task metadata fields cannot be null.",
                )
            normalized = value.strip() if isinstance(value, str) else value
            if field == "title" and not 1 <= len(normalized) <= 120:
                raise _invalid_task_metadata()
            if field == "note" and not 1 <= len(normalized) <= 1000:
                raise _invalid_task_metadata()
            if field == "style" and normalized not in POSTCARD_STYLES:
                raise _invalid_task_metadata()
            setattr(task, field, normalized)

        task.updated_at = utcnow()
    return _task_view(session, task)


def create_upload_slots(
    session: Session,
    object_store: ObjectStore,
    settings: Settings,
    task_id: str,
    body: UploadSlotsInput,
) -> UploadSlotsView:
    now = utcnow()
    with session.begin():
        task = _locked_task(session, task_id)
        if task.status == "ready" or task.current_attempt_id is not None:
            raise DomainError(409, "task_immutable", "Task inputs are immutable.")
        _expire_stale_assets(session, task, now=now)

        existing = list(
            session.scalars(
                select(Asset)
                .where(
                    Asset.task_id == task_id,
                    Asset.upload_batch_key == body.idempotency_key,
                )
                .order_by(Asset.client_file_id)
            )
        )
        requested_manifest = sorted(
            (
                item.client_file_id,
                item.filename,
                item.media_type,
                item.size_bytes,
            )
            for item in body.files
        )
        if existing:
            existing_manifest = sorted(
                (
                    asset.client_file_id,
                    asset.filename,
                    asset.media_type,
                    asset.size_bytes,
                )
                for asset in existing
            )
            if existing_manifest != requested_manifest:
                raise DomainError(
                    409,
                    "upload_batch_mismatch",
                    "Upload batch does not match its original manifest.",
                )
            pending_existing = [
                asset
                for asset in existing
                if asset.upload_status == "pending" and asset.upload_url_expires_at > now
            ]
            if not pending_existing and all(
                asset.upload_status == "uploaded" for asset in existing
            ):
                return UploadSlotsView(slots=[])
            if not pending_existing:
                raise DomainError(
                    409,
                    "upload_batch_expired",
                    "Upload batch expired.",
                )
            assets = pending_existing
        else:
            active_count = session.scalar(
                select(func.count())
                .select_from(Asset)
                .where(
                    Asset.task_id == task_id,
                    or_(
                        Asset.upload_status == "uploaded",
                        and_(
                            Asset.upload_status == "pending",
                            Asset.upload_url_expires_at > now,
                        ),
                    ),
                )
            )
            if (active_count or 0) + len(body.files) > MAX_PHOTOS:
                raise DomainError(
                    400,
                    "invalid_upload_manifest",
                    "Upload manifest exceeds the five-photo limit.",
                )
            expires_at = now + timedelta(seconds=settings.upload_url_ttl_seconds)
            assets = []
            for item in body.files:
                asset_id = new_id("asset")
                extension = "jpg" if item.media_type == "image/jpeg" else "png"
                asset = Asset(
                    asset_id=asset_id,
                    task_id=task_id,
                    client_file_id=item.client_file_id,
                    upload_batch_key=body.idempotency_key,
                    filename=item.filename,
                    media_type=item.media_type,
                    size_bytes=item.size_bytes,
                    upload_status="pending",
                    storage_key=f"tasks/{task_id}/uploads/{asset_id}.{extension}",
                    upload_url_expires_at=expires_at,
                    created_at=now,
                    updated_at=now,
                )
                session.add(asset)
                assets.append(asset)
            task.status = "uploading"
            task.updated_at = now
            session.flush()

        slots = [_upload_slot(object_store, settings, asset, now) for asset in assets]
    return UploadSlotsView(slots=slots)


def complete_asset(
    session: Session,
    object_store: ObjectStore,
    task_id: str,
    asset_id: str,
) -> PhotoView:
    now = utcnow()
    expired = False
    completed_photo: PhotoView | None = None
    with session.begin():
        task = _locked_task(session, task_id)
        asset = session.scalar(
            select(Asset)
            .where(Asset.asset_id == asset_id, Asset.task_id == task_id)
            .with_for_update()
        )
        if asset is None:
            raise DomainError(404, "asset_not_found", "Asset not found.")
        if asset.upload_status == "uploaded":
            return _photo_view(asset)
        if asset.upload_status == "expired" or asset.upload_url_expires_at <= now:
            asset.upload_status = "expired"
            asset.updated_at = now
            task.updated_at = now
            _recalculate_task_input_status(session, task, now)
            expired = True
        else:
            upload_key = asset.storage_key
            stored = object_store.inspect(upload_key)
            if (
                stored is None
                or stored.size_bytes != asset.size_bytes
                or stored.media_type != asset.media_type
            ):
                raise DomainError(
                    422,
                    "uploaded_asset_invalid",
                    "Uploaded asset failed validation.",
                )
            extension = "jpg" if asset.media_type == "image/jpeg" else "png"
            immutable_key = (
                f"tasks/{task_id}/assets/{asset.asset_id}/source.{extension}"
            )
            object_store.copy(upload_key, immutable_key)
            finalized = object_store.inspect(immutable_key)
            if (
                finalized is None
                or finalized.size_bytes != asset.size_bytes
                or finalized.media_type != asset.media_type
            ):
                raise DomainError(
                    422,
                    "uploaded_asset_invalid",
                    "Finalized asset failed validation.",
                )
            asset.storage_key = immutable_key
            asset.upload_status = "uploaded"
            asset.updated_at = now
            task.status = "uploading"
            task.updated_at = now
            completed_photo = _photo_view(asset)
    if expired:
        raise DomainError(409, "upload_slot_expired", "Upload slot expired.")
    if completed_photo is None:
        raise RuntimeError("Asset completion produced no result")
    return completed_photo


def complete_intake(session: Session, task_id: str) -> TaskView:
    now = utcnow()
    with session.begin():
        task = _locked_task(session, task_id)
        if task.status == "ready":
            return _task_view(session, task)
        _expire_stale_assets(session, task, now=now)
        uploaded_count, pending_count = _asset_counts(session, task_id, now)
        if pending_count > 0:
            raise DomainError(
                409,
                "pending_uploads_exist",
                "Uploads are still pending.",
                retryable=True,
            )
        if (
            not task.title
            or not task.note
            or task.style not in POSTCARD_STYLES
            or not 1 <= uploaded_count <= MAX_PHOTOS
        ):
            raise DomainError(409, "intake_not_complete", "Task intake is incomplete.")
        task.status = "ready"
        task.updated_at = now
    return _task_view(session, task)


def create_attempt(
    session: Session,
    settings: Settings,
    task_id: str,
    body: CreateAttemptInput,
) -> AttemptView:
    now = utcnow()
    with session.begin():
        task = _locked_task(session, task_id)
        if task.status != "ready":
            raise DomainError(
                409,
                "task_not_ready",
                "Task is not ready for generation.",
                retryable=True,
            )
        attempts = list(
            session.scalars(
                select(Attempt)
                .where(Attempt.task_id == task_id)
                .order_by(Attempt.attempt_number.desc())
            )
        )
        if attempts and attempts[0].status in {"queued", "generating"}:
            raise DomainError(
                409,
                "attempt_in_progress",
                "An attempt is already in progress.",
                retryable=True,
            )
        attempt_number = len(attempts) + 1
        refinement_note = body.refinement_note
        if attempt_number == 1 and refinement_note is not None:
            raise DomainError(
                400,
                "initial_attempt_refinement_not_allowed",
                "The first attempt cannot include a refinement note.",
            )
        if attempt_number > 1 and refinement_note is None:
            raise DomainError(
                400,
                "refinement_note_required",
                "A refinement note is required.",
            )

        photo_ids = list(
            session.scalars(
                select(Asset.asset_id)
                .where(Asset.task_id == task_id, Asset.upload_status == "uploaded")
                .order_by(Asset.created_at, Asset.asset_id)
            )
        )
        snapshot = {
            "schema_version": "m1.attempt_input.v1",
            "task_id": task_id,
            "photo_asset_ids": photo_ids,
            "title": task.title,
            "note": task.note,
            "style": task.style,
            "prompt_recipe_version": "m1.postcard_prompt.v2",
            "refinement_note": refinement_note,
            "output": {
                "artifact_type": "postcard",
                "format": "png",
                "width": 1800,
                "height": 1200,
            },
        }
        attempt = Attempt(
            attempt_id=new_id("att"),
            task_id=task_id,
            attempt_number=attempt_number,
            status="queued",
            refinement_note=refinement_note,
            input_snapshot=snapshot,
            provider_id=settings.generation_provider,
            provider_model=settings.provider_model,
            created_at=now,
            updated_at=now,
        )
        session.add(attempt)
        session.flush()
        task.current_attempt_id = attempt.attempt_id
        task.updated_at = now
    return _attempt_view(session, attempt)


def list_attempts(session: Session, task_id: str) -> AttemptListView:
    if session.get(Task, task_id) is None:
        raise task_not_found()
    attempts = list(
        session.scalars(
            select(Attempt)
            .where(Attempt.task_id == task_id)
            .order_by(Attempt.attempt_number.desc())
        )
    )
    return AttemptListView(attempts=[_attempt_view(session, attempt) for attempt in attempts])


def create_download(
    session: Session,
    object_store: ObjectStore,
    settings: Settings,
    task_id: str,
    artifact_id: str,
) -> DownloadView:
    artifact = session.scalar(
        select(Artifact)
        .join(Attempt, Attempt.attempt_id == Artifact.attempt_id)
        .where(
            Artifact.artifact_id == artifact_id,
            Artifact.task_id == task_id,
            Attempt.status == "ready",
        )
    )
    if artifact is None:
        raise DomainError(404, "artifact_not_found", "Artifact not found.")
    url, expires_at = object_store.create_download(
        artifact.storage_key, settings.download_url_ttl_seconds
    )
    return DownloadView(
        artifact_id=artifact.artifact_id,
        download_url=url,
        expires_at=expires_at,
    )


def _locked_task(session: Session, task_id: str) -> Task:
    task = session.scalar(select(Task).where(Task.task_id == task_id).with_for_update())
    if task is None:
        raise task_not_found()
    return task


def _expire_stale_assets(
    session: Session,
    task: Task,
    *,
    now: datetime | None = None,
) -> None:
    now = now or utcnow()
    stale_assets = list(
        session.scalars(
            select(Asset).where(
                Asset.task_id == task.task_id,
                Asset.upload_status == "pending",
                Asset.upload_url_expires_at <= now,
            )
        )
    )
    if not stale_assets:
        return
    for asset in stale_assets:
        asset.upload_status = "expired"
        asset.updated_at = now
    task.updated_at = now
    _recalculate_task_input_status(session, task, now)


def _expire_stale_assets_for_collection(session: Session, now: datetime) -> None:
    stale_task_ids = select(Asset.task_id).where(
        Asset.upload_status == "pending",
        Asset.upload_url_expires_at <= now,
    )
    tasks = list(
        session.scalars(
            select(Task).where(Task.task_id.in_(stale_task_ids)).with_for_update()
        )
    )
    for task in tasks:
        _expire_stale_assets(session, task, now=now)


def _recalculate_task_input_status(session: Session, task: Task, now: datetime) -> None:
    if task.status == "ready":
        return
    uploaded_count, pending_count = _asset_counts(session, task.task_id, now)
    next_status: TaskStatus = "uploading" if uploaded_count or pending_count else "draft"
    if task.status != next_status:
        task.status = next_status
        task.updated_at = now


def _asset_counts(session: Session, task_id: str, now: datetime) -> tuple[int, int]:
    uploaded_count = session.scalar(
        select(func.count())
        .select_from(Asset)
        .where(Asset.task_id == task_id, Asset.upload_status == "uploaded")
    )
    pending_count = session.scalar(
        select(func.count())
        .select_from(Asset)
        .where(
            Asset.task_id == task_id,
            Asset.upload_status == "pending",
            Asset.upload_url_expires_at > now,
        )
    )
    return int(uploaded_count or 0), int(pending_count or 0)


def _task_view(session: Session, task: Task) -> TaskView:
    now = utcnow()
    assets = list(
        session.scalars(
            select(Asset)
            .where(
                Asset.task_id == task.task_id,
                or_(
                    Asset.upload_status == "uploaded",
                    and_(
                        Asset.upload_status == "pending",
                        Asset.upload_url_expires_at > now,
                    ),
                ),
            )
            .order_by(Asset.created_at, Asset.asset_id)
        )
    )
    uploaded_count = sum(asset.upload_status == "uploaded" for asset in assets)
    pending_count = sum(asset.upload_status == "pending" for asset in assets)
    current_attempt = (
        session.get(Attempt, task.current_attempt_id) if task.current_attempt_id else None
    )
    return TaskView(
        task_id=task.task_id,
        status=task.status,
        title=task.title,
        note=task.note,
        style=task.style,
        photos=[_photo_view(asset) for asset in assets],
        upload_summary=UploadSummaryView(
            uploaded_count=uploaded_count,
            pending_count=pending_count,
        ),
        current_attempt=_attempt_view(session, current_attempt) if current_attempt else None,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _task_summary_view(session: Session, task: Task) -> TaskSummaryView:
    photo_count = session.scalar(
        select(func.count())
        .select_from(Asset)
        .where(Asset.task_id == task.task_id, Asset.upload_status == "uploaded")
    )
    attempt_count = session.scalar(
        select(func.count()).select_from(Attempt).where(Attempt.task_id == task.task_id)
    )
    attempt = session.get(Attempt, task.current_attempt_id) if task.current_attempt_id else None
    attempt_summary = (
        AttemptSummaryView(
            attempt_id=attempt.attempt_id,
            attempt_number=attempt.attempt_number,
            status=attempt.status,
            created_at=attempt.created_at,
            started_at=attempt.started_at,
            completed_at=attempt.completed_at,
        )
        if attempt
        else None
    )
    return TaskSummaryView(
        task_id=task.task_id,
        status=task.status,
        title=task.title,
        style=task.style,
        photo_count=int(photo_count or 0),
        attempt_count=int(attempt_count or 0),
        current_attempt=attempt_summary,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _photo_view(asset: Asset) -> PhotoView:
    return PhotoView(
        asset_id=asset.asset_id,
        client_file_id=asset.client_file_id,
        filename=asset.filename,
        media_type=asset.media_type,
        size_bytes=asset.size_bytes,
        upload_status=cast(Literal["pending", "uploaded"], asset.upload_status),
        created_at=asset.created_at,
    )


def _attempt_view(session: Session, attempt: Attempt) -> AttemptView:
    artifact = session.scalar(select(Artifact).where(Artifact.attempt_id == attempt.attempt_id))
    return AttemptView(
        attempt_id=attempt.attempt_id,
        attempt_number=attempt.attempt_number,
        status=attempt.status,
        refinement_note=attempt.refinement_note,
        failure_code=attempt.failure_code,
        artifact=_artifact_view(artifact) if artifact else None,
        created_at=attempt.created_at,
        started_at=attempt.started_at,
        completed_at=attempt.completed_at,
    )


def _artifact_view(artifact: Artifact) -> ArtifactView:
    return ArtifactView(
        artifact_id=artifact.artifact_id,
        filename=artifact.filename,
        size_bytes=artifact.size_bytes,
        created_at=artifact.created_at,
    )


def _upload_slot(
    object_store: ObjectStore,
    settings: Settings,
    asset: Asset,
    now: datetime,
) -> UploadSlotView:
    remaining_seconds = max(1, int((asset.upload_url_expires_at - now).total_seconds()))
    presigned = object_store.create_upload(
        asset.storage_key,
        asset.media_type,
        asset.size_bytes,
        min(remaining_seconds, settings.upload_url_ttl_seconds),
    )
    return UploadSlotView(
        slot_id=f"slot_{asset.asset_id.removeprefix('asset_')}",
        asset_id=asset.asset_id,
        client_file_id=asset.client_file_id,
        upload_url=presigned.url,
        expires_at=asset.upload_url_expires_at,
        fields=presigned.fields,
        constraints=UploadConstraintsView(accepted_media_types=["image/jpeg", "image/png"]),
    )


def _encode_cursor(task: Task) -> str:
    payload = json.dumps(
        [task.updated_at.astimezone(UTC).isoformat(), task.task_id],
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        padding = "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(cursor + padding))
        if not isinstance(payload, list) or len(payload) != 2:
            raise ValueError
        cursor_time = datetime.fromisoformat(str(payload[0]))
        cursor_id = str(payload[1])
        if cursor_time.tzinfo is None or not cursor_id.startswith("task_"):
            raise ValueError
        return cursor_time, cursor_id
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise DomainError(400, "invalid_cursor", "Task cursor is invalid.") from error


def _invalid_task_metadata() -> DomainError:
    return DomainError(400, "invalid_task_metadata", "Task metadata is invalid.")
