from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from ai_artist import worker
from ai_artist.app import app
from ai_artist.config import Settings
from ai_artist.ids import new_id
from ai_artist.schemas import PhotoView, UpdateTaskInput, UploadSlotsInput


def test_customer_api_exposes_the_ten_lld_operations() -> None:
    operations = {
        (method, route.path)
        for route in app.routes
        for method in getattr(route, "methods", set())
        if route.path.startswith("/v1/") or route.path == "/v1/tasks"
    }
    assert operations == {
        ("POST", "/v1/tasks"),
        ("GET", "/v1/tasks"),
        ("GET", "/v1/tasks/{task_id}"),
        ("PATCH", "/v1/tasks/{task_id}"),
        ("POST", "/v1/tasks/{task_id}/upload-slots"),
        ("POST", "/v1/tasks/{task_id}/assets/{asset_id}/complete"),
        ("POST", "/v1/tasks/{task_id}/complete-intake"),
        ("POST", "/v1/tasks/{task_id}/attempts"),
        ("GET", "/v1/tasks/{task_id}/attempts"),
        ("POST", "/v1/tasks/{task_id}/artifacts/{artifact_id}/download"),
    }


def test_request_models_reject_unknown_and_duplicate_upload_fields() -> None:
    with pytest.raises(ValidationError):
        UpdateTaskInput.model_validate({"title": "Kyoto", "unknown": True})

    manifest = {
        "files": [
            {
                "client_file_id": "file_1",
                "filename": "kyoto.jpg",
                "media_type": "image/jpeg",
                "size_bytes": 12,
            },
            {
                "client_file_id": "file_1",
                "filename": "osaka.jpg",
                "media_type": "image/jpeg",
                "size_bytes": 13,
            },
        ],
        "idempotency_key": "upload_batch_1",
    }
    with pytest.raises(ValidationError):
        UploadSlotsInput.model_validate(manifest)


def test_customer_timestamps_serialize_with_z_suffix() -> None:
    photo = PhotoView(
        asset_id="asset_1",
        client_file_id="file_1",
        filename="kyoto.jpg",
        media_type="image/jpeg",
        size_bytes=12,
        upload_status="uploaded",
        created_at=datetime(2026, 8, 26, 12, 0, tzinfo=UTC),
    )
    assert photo.model_dump(mode="json")["created_at"] == "2026-08-26T12:00:00Z"


def test_ids_are_prefixed_ulids_within_database_limit() -> None:
    task_id = new_id("task")
    assert task_id.startswith("task_")
    assert len(task_id) <= 40


def test_fake_provider_configuration_requires_no_openai_model_override() -> None:
    settings = Settings(generation_provider="fake")
    assert settings.provider_model == "fake-v1"


def test_worker_waits_until_schema_and_storage_are_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    readiness = iter([False, True])
    sleeps: list[float] = []

    class Inspector:
        def has_table(self, table_name: str) -> bool:
            assert table_name == "attempts"
            return next(readiness)

    class ObjectStore:
        def __init__(self) -> None:
            self.ensure_calls = 0

        def ensure_bucket(self) -> None:
            self.ensure_calls += 1

    object_store = ObjectStore()
    monkeypatch.setattr(worker, "inspect", lambda _: Inspector())
    monkeypatch.setattr(worker.time, "sleep", sleeps.append)

    worker.wait_for_dependencies(object_store, timeout_seconds=10, poll_seconds=0.25)  # type: ignore[arg-type]

    assert sleeps == [0.25]
    assert object_store.ensure_calls == 1
