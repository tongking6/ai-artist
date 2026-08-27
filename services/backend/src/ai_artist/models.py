from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


TaskStatus = Literal["draft", "uploading", "ready"]
AttemptStatus = Literal["queued", "generating", "ready", "failed"]
MediaType = Literal["image/jpeg", "image/png"]
UploadStatus = Literal["pending", "uploaded", "expired"]
Style = Literal["warm_handmade"]


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["current_attempt_id", "task_id"],
            ["attempts.attempt_id", "attempts.task_id"],
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
            name="tasks_current_attempt_fk",
        ),
        CheckConstraint("status IN ('draft', 'uploading', 'ready')", name="tasks_status_ck"),
        CheckConstraint(
            "title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 120",
            name="tasks_title_ck",
        ),
        CheckConstraint(
            "note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 1000",
            name="tasks_note_ck",
        ),
        CheckConstraint(
            "style IS NULL OR char_length(btrim(style)) BETWEEN 1 AND 64",
            name="tasks_style_ck",
        ),
        CheckConstraint(
            "status <> 'ready' OR (title IS NOT NULL AND note IS NOT NULL AND style IS NOT NULL)",
            name="tasks_ready_input_ck",
        ),
        CheckConstraint("updated_at >= created_at", name="tasks_updated_at_ck"),
        Index("tasks_activity_idx", text("updated_at DESC"), text("task_id DESC")),
    )

    task_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    status: Mapped[TaskStatus] = mapped_column(String(16), nullable=False, server_default="draft")
    title: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(String(1000))
    style: Mapped[Style | None] = mapped_column(String(64))
    current_attempt_id: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    assets: Mapped[list[Asset]] = relationship(back_populates="task")
    attempts: Mapped[list[Attempt]] = relationship(
        back_populates="task", foreign_keys="Attempt.task_id"
    )
    current_attempt: Mapped[Attempt | None] = relationship(
        foreign_keys=[current_attempt_id], post_update=True
    )


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        UniqueConstraint(
            "task_id", "upload_batch_key", "client_file_id", name="assets_batch_file_uq"
        ),
        UniqueConstraint("storage_key", name="assets_storage_key_uq"),
        CheckConstraint("media_type IN ('image/jpeg', 'image/png')", name="assets_media_type_ck"),
        CheckConstraint("size_bytes BETWEEN 1 AND 20971520", name="assets_size_ck"),
        CheckConstraint(
            "upload_status IN ('pending', 'uploaded', 'expired')",
            name="assets_upload_status_ck",
        ),
        CheckConstraint(
            "char_length(btrim(filename)) BETWEEN 1 AND 255", name="assets_filename_ck"
        ),
        CheckConstraint("upload_url_expires_at > created_at", name="assets_expiry_ck"),
        CheckConstraint("updated_at >= created_at", name="assets_updated_at_ck"),
        Index("assets_task_status_idx", "task_id", "upload_status"),
        Index(
            "assets_pending_expiry_idx",
            "upload_url_expires_at",
            postgresql_where=text("upload_status = 'pending'"),
        ),
    )

    asset_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    task_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("tasks.task_id", ondelete="RESTRICT"), nullable=False
    )
    client_file_id: Mapped[str] = mapped_column(String(128), nullable=False)
    upload_batch_key: Mapped[str] = mapped_column(String(128), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[MediaType] = mapped_column(String(16), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    upload_status: Mapped[UploadStatus] = mapped_column(
        String(16), nullable=False, server_default="pending"
    )
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    upload_url_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    task: Mapped[Task] = relationship(back_populates="assets")


class Attempt(Base):
    __tablename__ = "attempts"
    __table_args__ = (
        UniqueConstraint("attempt_id", "task_id", name="attempts_identity_task_uq"),
        UniqueConstraint("task_id", "attempt_number", name="attempts_task_number_uq"),
        CheckConstraint("attempt_number >= 1", name="attempts_number_ck"),
        CheckConstraint(
            "status IN ('queued', 'generating', 'ready', 'failed')", name="attempts_status_ck"
        ),
        CheckConstraint("jsonb_typeof(input_snapshot) = 'object'", name="attempts_snapshot_ck"),
        CheckConstraint(
            "(provider_id = 'openai' AND provider_model = 'gpt-image-2-2026-04-21') "
            "OR (provider_id = 'fake' AND provider_model = 'fake-v1')",
            name="attempts_provider_ck",
        ),
        CheckConstraint(
            "(attempt_number = 1 AND refinement_note IS NULL) OR "
            "(attempt_number > 1 AND refinement_note IS NOT NULL "
            "AND char_length(btrim(refinement_note)) BETWEEN 1 AND 1000)",
            name="attempts_refinement_ck",
        ),
        CheckConstraint(
            "(status = 'queued' AND lease_token IS NULL AND lease_expires_at IS NULL "
            "AND started_at IS NULL AND completed_at IS NULL AND failure_code IS NULL) OR "
            "(status = 'generating' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL "
            "AND started_at IS NOT NULL AND completed_at IS NULL AND failure_code IS NULL) OR "
            "(status = 'ready' AND lease_token IS NULL AND lease_expires_at IS NULL "
            "AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL) OR "
            "(status = 'failed' AND lease_token IS NULL AND lease_expires_at IS NULL "
            "AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NOT NULL)",
            name="attempts_status_fields_ck",
        ),
        CheckConstraint(
            "started_at IS NULL OR started_at >= created_at", name="attempts_started_ck"
        ),
        CheckConstraint(
            "completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at)",
            name="attempts_completed_ck",
        ),
        CheckConstraint(
            "lease_expires_at IS NULL OR "
            "(started_at IS NOT NULL AND lease_expires_at > started_at)",
            name="attempts_lease_ck",
        ),
        CheckConstraint("updated_at >= created_at", name="attempts_updated_at_ck"),
        Index(
            "attempts_one_active_per_task_idx",
            "task_id",
            unique=True,
            postgresql_where=text("status IN ('queued', 'generating')"),
        ),
        Index(
            "attempts_queue_idx",
            "created_at",
            "attempt_id",
            postgresql_where=text("status = 'queued'"),
        ),
        Index(
            "attempts_expired_lease_idx",
            "lease_expires_at",
            postgresql_where=text("status = 'generating'"),
        ),
        Index("attempts_task_history_idx", "task_id", text("attempt_number DESC")),
        Index(
            "attempts_provider_request_idx",
            "provider_request_id",
            postgresql_where=text("provider_request_id IS NOT NULL"),
        ),
    )

    attempt_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    task_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("tasks.task_id", ondelete="RESTRICT"), nullable=False
    )
    attempt_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[AttemptStatus] = mapped_column(
        String(16), nullable=False, server_default="queued"
    )
    refinement_note: Mapped[str | None] = mapped_column(String(1000))
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_model: Mapped[str] = mapped_column(String(128), nullable=False)
    provider_request_id: Mapped[str | None] = mapped_column(String(255))
    failure_code: Mapped[str | None] = mapped_column(String(64))
    lease_token: Mapped[UUID | None] = mapped_column(PostgreSQLUUID(as_uuid=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    task: Mapped[Task] = relationship(back_populates="attempts", foreign_keys=[task_id])
    artifact: Mapped[Artifact | None] = relationship(
        back_populates="attempt", uselist=False, foreign_keys="Artifact.attempt_id"
    )


class Artifact(Base):
    __tablename__ = "artifacts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["attempt_id", "task_id"],
            ["attempts.attempt_id", "attempts.task_id"],
            ondelete="RESTRICT",
        ),
        UniqueConstraint("attempt_id", name="artifacts_attempt_uq"),
        UniqueConstraint("storage_key", name="artifacts_storage_key_uq"),
        CheckConstraint("artifact_type = 'postcard'", name="artifacts_type_ck"),
        CheckConstraint("mime_type = 'image/png'", name="artifacts_mime_ck"),
        CheckConstraint("size_bytes BETWEEN 1 AND 20971520", name="artifacts_size_ck"),
        CheckConstraint("octet_length(sha256) = 32", name="artifacts_sha256_ck"),
        CheckConstraint(
            "char_length(btrim(filename)) BETWEEN 1 AND 255", name="artifacts_filename_ck"
        ),
        Index("artifacts_task_created_idx", "task_id", text("created_at DESC")),
    )

    artifact_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    task_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("tasks.task_id", ondelete="RESTRICT"), nullable=False
    )
    attempt_id: Mapped[str] = mapped_column(String(40), nullable=False)
    artifact_type: Mapped[str] = mapped_column(String(32), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    attempt: Mapped[Attempt] = relationship(back_populates="artifact", foreign_keys=[attempt_id])
