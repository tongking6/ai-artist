"""Create the four-table M1 schema.

Revision ID: 0001_m1_schema
Revises:
Create Date: 2026-08-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_m1_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("task_id", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="draft", nullable=False),
        sa.Column("title", sa.String(length=120), nullable=True),
        sa.Column("note", sa.String(length=1000), nullable=True),
        sa.Column("style", sa.String(length=64), nullable=True),
        sa.Column("current_attempt_id", sa.String(length=40), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("status IN ('draft', 'uploading', 'ready')", name="tasks_status_ck"),
        sa.CheckConstraint(
            "title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 120",
            name="tasks_title_ck",
        ),
        sa.CheckConstraint(
            "note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 1000",
            name="tasks_note_ck",
        ),
        sa.CheckConstraint(
            "style IS NULL OR char_length(btrim(style)) BETWEEN 1 AND 64",
            name="tasks_style_ck",
        ),
        sa.CheckConstraint(
            "status <> 'ready' OR (title IS NOT NULL AND note IS NOT NULL AND style IS NOT NULL)",
            name="tasks_ready_input_ck",
        ),
        sa.CheckConstraint("updated_at >= created_at", name="tasks_updated_at_ck"),
        sa.PrimaryKeyConstraint("task_id"),
    )
    op.create_index(
        "tasks_activity_idx", "tasks", [sa.text("updated_at DESC"), sa.text("task_id DESC")]
    )

    op.create_table(
        "assets",
        sa.Column("asset_id", sa.String(length=40), nullable=False),
        sa.Column("task_id", sa.String(length=40), nullable=False),
        sa.Column("client_file_id", sa.String(length=128), nullable=False),
        sa.Column("upload_batch_key", sa.String(length=128), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("media_type", sa.String(length=16), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("upload_status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("upload_url_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "media_type IN ('image/jpeg', 'image/png')", name="assets_media_type_ck"
        ),
        sa.CheckConstraint("size_bytes BETWEEN 1 AND 20971520", name="assets_size_ck"),
        sa.CheckConstraint(
            "upload_status IN ('pending', 'uploaded', 'expired')", name="assets_upload_status_ck"
        ),
        sa.CheckConstraint(
            "char_length(btrim(filename)) BETWEEN 1 AND 255", name="assets_filename_ck"
        ),
        sa.CheckConstraint("upload_url_expires_at > created_at", name="assets_expiry_ck"),
        sa.CheckConstraint("updated_at >= created_at", name="assets_updated_at_ck"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.task_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("asset_id"),
        sa.UniqueConstraint(
            "task_id", "upload_batch_key", "client_file_id", name="assets_batch_file_uq"
        ),
        sa.UniqueConstraint("storage_key", name="assets_storage_key_uq"),
    )
    op.create_index("assets_task_status_idx", "assets", ["task_id", "upload_status"])
    op.create_index(
        "assets_pending_expiry_idx",
        "assets",
        ["upload_url_expires_at"],
        postgresql_where=sa.text("upload_status = 'pending'"),
    )

    op.create_table(
        "attempts",
        sa.Column("attempt_id", sa.String(length=40), nullable=False),
        sa.Column("task_id", sa.String(length=40), nullable=False),
        sa.Column("attempt_number", sa.SmallInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="queued", nullable=False),
        sa.Column("refinement_note", sa.String(length=1000), nullable=True),
        sa.Column("input_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("provider_id", sa.String(length=32), nullable=False),
        sa.Column("provider_model", sa.String(length=128), nullable=False),
        sa.Column("provider_request_id", sa.String(length=255), nullable=True),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("lease_token", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("attempt_number >= 1", name="attempts_number_ck"),
        sa.CheckConstraint(
            "status IN ('queued', 'generating', 'ready', 'failed')", name="attempts_status_ck"
        ),
        sa.CheckConstraint("jsonb_typeof(input_snapshot) = 'object'", name="attempts_snapshot_ck"),
        sa.CheckConstraint(
            "(provider_id = 'openai' AND provider_model = 'gpt-image-2-2026-04-21') OR "
            "(provider_id = 'fake' AND provider_model = 'fake-v1')",
            name="attempts_provider_ck",
        ),
        sa.CheckConstraint(
            "(attempt_number = 1 AND refinement_note IS NULL) OR "
            "(attempt_number > 1 AND refinement_note IS NOT NULL "
            "AND char_length(btrim(refinement_note)) BETWEEN 1 AND 1000)",
            name="attempts_refinement_ck",
        ),
        sa.CheckConstraint(
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
        sa.CheckConstraint(
            "started_at IS NULL OR started_at >= created_at", name="attempts_started_ck"
        ),
        sa.CheckConstraint(
            "completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at)",
            name="attempts_completed_ck",
        ),
        sa.CheckConstraint(
            "lease_expires_at IS NULL OR "
            "(started_at IS NOT NULL AND lease_expires_at > started_at)",
            name="attempts_lease_ck",
        ),
        sa.CheckConstraint("updated_at >= created_at", name="attempts_updated_at_ck"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.task_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("attempt_id"),
        sa.UniqueConstraint("attempt_id", "task_id", name="attempts_identity_task_uq"),
        sa.UniqueConstraint("task_id", "attempt_number", name="attempts_task_number_uq"),
    )
    op.create_index(
        "attempts_one_active_per_task_idx",
        "attempts",
        ["task_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued', 'generating')"),
    )
    op.create_index(
        "attempts_queue_idx",
        "attempts",
        ["created_at", "attempt_id"],
        postgresql_where=sa.text("status = 'queued'"),
    )
    op.create_index(
        "attempts_expired_lease_idx",
        "attempts",
        ["lease_expires_at"],
        postgresql_where=sa.text("status = 'generating'"),
    )
    op.create_index(
        "attempts_task_history_idx", "attempts", ["task_id", sa.text("attempt_number DESC")]
    )
    op.create_index(
        "attempts_provider_request_idx",
        "attempts",
        ["provider_request_id"],
        postgresql_where=sa.text("provider_request_id IS NOT NULL"),
    )

    op.create_foreign_key(
        "tasks_current_attempt_fk",
        "tasks",
        "attempts",
        ["current_attempt_id", "task_id"],
        ["attempt_id", "task_id"],
        ondelete="RESTRICT",
        deferrable=True,
        initially="DEFERRED",
    )

    op.create_table(
        "artifacts",
        sa.Column("artifact_id", sa.String(length=40), nullable=False),
        sa.Column("task_id", sa.String(length=40), nullable=False),
        sa.Column("attempt_id", sa.String(length=40), nullable=False),
        sa.Column("artifact_type", sa.String(length=32), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.LargeBinary(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("artifact_type = 'postcard'", name="artifacts_type_ck"),
        sa.CheckConstraint("mime_type = 'image/png'", name="artifacts_mime_ck"),
        sa.CheckConstraint("size_bytes BETWEEN 1 AND 20971520", name="artifacts_size_ck"),
        sa.CheckConstraint("octet_length(sha256) = 32", name="artifacts_sha256_ck"),
        sa.CheckConstraint(
            "char_length(btrim(filename)) BETWEEN 1 AND 255", name="artifacts_filename_ck"
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.task_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["attempt_id", "task_id"],
            ["attempts.attempt_id", "attempts.task_id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("artifact_id"),
        sa.UniqueConstraint("attempt_id", name="artifacts_attempt_uq"),
        sa.UniqueConstraint("storage_key", name="artifacts_storage_key_uq"),
    )
    op.create_index(
        "artifacts_task_created_idx",
        "artifacts",
        ["task_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_table("artifacts")
    op.drop_constraint("tasks_current_attempt_fk", "tasks", type_="foreignkey")
    op.drop_table("attempts")
    op.drop_table("assets")
    op.drop_table("tasks")
