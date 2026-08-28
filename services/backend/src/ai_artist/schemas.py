from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)

type PostcardStyle = Literal[
    "warm_handmade",
    "manga_zine",
    "impressionist_light",
    "fauvist_expressive",
    "childlike_crayon",
]


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_serializer("*", when_used="json", check_fields=False)
    def serialize_datetime(self, value: object) -> object:
        if isinstance(value, datetime):
            normalized = value.astimezone(UTC)
            return normalized.isoformat(timespec="seconds").replace("+00:00", "Z")
        return value


class ErrorView(ApiModel):
    code: str
    message: str
    retryable: bool


class CreateTaskView(ApiModel):
    task_id: str
    status: Literal["draft"]


class PhotoView(ApiModel):
    asset_id: str
    client_file_id: str
    filename: str
    media_type: Literal["image/jpeg", "image/png"]
    size_bytes: int
    upload_status: Literal["pending", "uploaded"]
    created_at: datetime


class ArtifactView(ApiModel):
    artifact_id: str
    artifact_type: Literal["postcard"] = "postcard"
    filename: str
    mime_type: Literal["image/png"] = "image/png"
    width: Literal[1800] = 1800
    height: Literal[1200] = 1200
    size_bytes: int
    created_at: datetime


class AttemptView(ApiModel):
    attempt_id: str
    attempt_number: int
    status: Literal["queued", "generating", "ready", "failed"]
    refinement_note: str | None
    failure_code: str | None
    artifact: ArtifactView | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class AttemptSummaryView(ApiModel):
    attempt_id: str
    attempt_number: int
    status: Literal["queued", "generating", "ready", "failed"]
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class UploadSummaryView(ApiModel):
    uploaded_count: int
    pending_count: int
    max_count: Literal[5] = 5


class TaskView(ApiModel):
    task_id: str
    status: Literal["draft", "uploading", "ready"]
    title: str | None
    note: str | None
    style: PostcardStyle | None
    photos: list[PhotoView]
    upload_summary: UploadSummaryView
    current_attempt: AttemptView | None
    created_at: datetime
    updated_at: datetime


class TaskSummaryView(ApiModel):
    task_id: str
    status: Literal["draft", "uploading", "ready"]
    title: str | None
    style: PostcardStyle | None
    photo_count: int
    attempt_count: int
    current_attempt: AttemptSummaryView | None
    created_at: datetime
    updated_at: datetime


class TaskListView(ApiModel):
    tasks: list[TaskSummaryView]
    next_cursor: str | None


class UpdateTaskInput(ApiModel):
    title: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    note: Annotated[str, Field(min_length=1, max_length=1000)] | None = None
    style: PostcardStyle | None = None

    @field_validator("title", "note")
    @classmethod
    def trim_nonempty(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("value must not be blank")
        return trimmed

    @model_validator(mode="after")
    def require_one_field(self) -> UpdateTaskInput:
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self


class UploadManifestItem(ApiModel):
    client_file_id: Annotated[str, Field(min_length=1, max_length=128)]
    filename: Annotated[str, Field(min_length=1, max_length=255)]
    media_type: Literal["image/jpeg", "image/png"]
    size_bytes: Annotated[int, Field(ge=1, le=20 * 1024 * 1024)]

    @field_validator("filename")
    @classmethod
    def sanitize_filename(cls, value: str) -> str:
        sanitized = value.replace("\\", "/").rsplit("/", 1)[-1]
        sanitized = "".join(character for character in sanitized if ord(character) >= 32).strip()
        if not sanitized:
            raise ValueError("filename must not be blank")
        return sanitized


class UploadSlotsInput(ApiModel):
    files: Annotated[list[UploadManifestItem], Field(min_length=1, max_length=5)]
    idempotency_key: Annotated[str, Field(min_length=1, max_length=128)]

    @model_validator(mode="after")
    def require_unique_client_file_ids(self) -> UploadSlotsInput:
        identifiers = [item.client_file_id for item in self.files]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("client_file_id values must be unique")
        return self


class UploadConstraintsView(ApiModel):
    accepted_media_types: list[Literal["image/jpeg", "image/png"]]
    max_bytes: Literal[20971520] = 20971520


class UploadSlotView(ApiModel):
    slot_id: str
    asset_id: str
    client_file_id: str
    upload_method: Literal["presigned_post"] = "presigned_post"
    upload_url: str
    expires_at: datetime
    fields: dict[str, str]
    constraints: UploadConstraintsView


class UploadSlotsView(ApiModel):
    slots: list[UploadSlotView]


class CreateAttemptInput(ApiModel):
    refinement_note: Annotated[str, Field(min_length=1, max_length=1000)] | None = None

    @field_validator("refinement_note")
    @classmethod
    def trim_refinement(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("refinement_note must not be blank")
        return trimmed


class AttemptListView(ApiModel):
    attempts: list[AttemptView]


class DownloadView(ApiModel):
    artifact_id: str
    download_url: str
    expires_at: datetime
