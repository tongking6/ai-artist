from __future__ import annotations

import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from ai_artist import service, worker
from ai_artist.adapters.object_store import PresignedPost, StoredObject
from ai_artist.config import Settings
from ai_artist.errors import DomainError
from ai_artist.models import Artifact, Asset, Attempt, Base, Task
from ai_artist.schemas import UploadSlotsInput

TEST_DATABASE_URL = os.environ.get("AI_ARTIST_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    TEST_DATABASE_URL is None,
    reason="AI_ARTIST_TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


class MemoryObjectStore:
    def __init__(self, objects: dict[str, tuple[bytes, str]]) -> None:
        self.objects = dict(objects)
        self.upload_keys: list[str] = []

    def ensure_bucket(self) -> None:
        return None

    def create_upload(
        self,
        key: str,
        media_type: str,
        max_bytes: int,
        ttl_seconds: int,
    ) -> PresignedPost:
        del media_type, max_bytes
        self.upload_keys.append(key)
        return PresignedPost(
            url="https://uploads.invalid",
            fields={},
            expires_at=datetime.now(UTC) + timedelta(seconds=ttl_seconds),
        )

    def inspect(self, key: str) -> StoredObject | None:
        stored = self.objects.get(key)
        if stored is None:
            return None
        body, media_type = stored
        return StoredObject(size_bytes=len(body), media_type=media_type)

    def copy(self, source_key: str, destination_key: str) -> None:
        self.objects[destination_key] = self.objects[source_key]

    def get(self, key: str) -> bytes:
        return self.objects[key][0]

    def put(self, key: str, body: bytes, media_type: str) -> None:
        self.objects[key] = (body, media_type)

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    def create_download(self, key: str, ttl_seconds: int) -> tuple[str, datetime]:
        del key
        return "https://downloads.invalid", datetime.now(UTC) + timedelta(seconds=ttl_seconds)


@pytest.fixture(scope="module")
def postgres_engine() -> Iterator[Engine]:
    assert TEST_DATABASE_URL is not None
    database_name = make_url(TEST_DATABASE_URL).database or ""
    if not database_name.endswith("_test"):
        pytest.fail("AI_ARTIST_TEST_DATABASE_URL must target a database ending in _test")
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(autouse=True)
def clean_database(postgres_engine: Engine) -> None:
    with postgres_engine.begin() as connection:
        connection.execute(text("TRUNCATE artifacts, attempts, assets, tasks CASCADE"))


@pytest.fixture
def sessions(postgres_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=postgres_engine, autoflush=False, expire_on_commit=False)


def test_expired_asset_transition_commits_before_domain_error(
    sessions: sessionmaker[Session],
) -> None:
    now = datetime.now(UTC)
    task_id = "task_expiration"
    asset_id = "asset_expiration"
    with sessions.begin() as session:
        session.add(
            Task(
                task_id=task_id,
                status="uploading",
                created_at=now - timedelta(hours=2),
                updated_at=now - timedelta(hours=2),
            )
        )
        session.add(
            Asset(
                asset_id=asset_id,
                task_id=task_id,
                client_file_id="file_expiration",
                upload_batch_key="batch_expiration",
                filename="expired.png",
                media_type="image/png",
                size_bytes=4,
                upload_status="pending",
                storage_key=f"tasks/{task_id}/uploads/{asset_id}.png",
                upload_url_expires_at=now - timedelta(hours=1),
                created_at=now - timedelta(hours=2),
                updated_at=now - timedelta(hours=2),
            )
        )

    with sessions() as session, pytest.raises(DomainError) as error:
        service.complete_asset(session, MemoryObjectStore({}), task_id, asset_id)
    assert error.value.code == "upload_slot_expired"

    with sessions() as session:
        assert session.get(Asset, asset_id).upload_status == "expired"  # type: ignore[union-attr]
        task = session.get(Task, task_id)
        assert task is not None
        assert task.status == "draft"
        assert task.updated_at > now - timedelta(hours=2)


def test_uploaded_asset_is_promoted_to_an_immutable_key(
    sessions: sessionmaker[Session],
) -> None:
    now = datetime.now(UTC)
    task_id = "task_immutable"
    asset_id = "asset_immutable"
    upload_key = f"tasks/{task_id}/uploads/{asset_id}.png"
    original = b"original-photo"
    store = MemoryObjectStore({upload_key: (original, "image/png")})
    with sessions.begin() as session:
        session.add(
            Task(task_id=task_id, status="uploading", created_at=now, updated_at=now)
        )
        session.add(
            Asset(
                asset_id=asset_id,
                task_id=task_id,
                client_file_id="file_immutable",
                upload_batch_key="batch_immutable",
                filename="photo.png",
                media_type="image/png",
                size_bytes=len(original),
                upload_status="pending",
                storage_key=upload_key,
                upload_url_expires_at=now + timedelta(minutes=15),
                created_at=now,
                updated_at=now,
            )
        )

    with sessions() as session:
        photo = service.complete_asset(session, store, task_id, asset_id)
    assert photo.upload_status == "uploaded"

    with sessions() as session:
        asset = session.get(Asset, asset_id)
        assert asset is not None
        immutable_key = asset.storage_key
    assert immutable_key == f"tasks/{task_id}/assets/{asset_id}/source.png"
    assert store.get(immutable_key) == original

    store.objects[upload_key] = (b"overwritten-after-complete", "image/png")
    assert store.get(immutable_key) == original

    manifest = UploadSlotsInput.model_validate(
        {
            "files": [
                {
                    "client_file_id": "file_immutable",
                    "filename": "photo.png",
                    "media_type": "image/png",
                    "size_bytes": len(original),
                }
            ],
            "idempotency_key": "batch_immutable",
        }
    )
    with sessions() as session:
        retry = service.create_upload_slots(session, store, Settings(), task_id, manifest)
    assert retry.slots == []
    assert store.upload_keys == []


def test_concurrent_workers_claim_an_attempt_once(
    sessions: sessionmaker[Session],
) -> None:
    now = datetime.now(UTC)
    task_id = "task_claim"
    with sessions.begin() as session:
        session.add(
            Task(
                task_id=task_id,
                status="ready",
                title="Claim",
                note="Claim once",
                style="warm_handmade",
                created_at=now,
                updated_at=now,
            )
        )
        session.add(
            Attempt(
                attempt_id="att_claim",
                task_id=task_id,
                attempt_number=1,
                status="queued",
                input_snapshot={"schema_version": "m1.attempt_input.v1"},
                provider_id="fake",
                provider_model="fake-v1",
                created_at=now,
                updated_at=now,
            )
        )

    def claim() -> worker.ClaimedAttempt | None:
        with sessions() as session:
            return worker.claim_attempt(session, Settings())

    with ThreadPoolExecutor(max_workers=2) as executor:
        claims = list(executor.map(lambda _: claim(), range(2)))
    assert sum(claimed is not None for claimed in claims) == 1


def test_expired_lease_fences_late_finalization(
    sessions: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime.now(UTC)
    lease_token = uuid4()
    task_id = "task_fenced"
    attempt_id = "att_fenced"
    with sessions.begin() as session:
        session.add(
            Task(
                task_id=task_id,
                status="ready",
                title="Fence",
                note="Fence late completion",
                style="warm_handmade",
                created_at=now - timedelta(minutes=20),
                updated_at=now - timedelta(minutes=20),
            )
        )
        session.add(
            Attempt(
                attempt_id=attempt_id,
                task_id=task_id,
                attempt_number=1,
                status="generating",
                input_snapshot={"title": "Fence"},
                provider_id="fake",
                provider_model="fake-v1",
                lease_token=lease_token,
                lease_expires_at=now - timedelta(minutes=1),
                created_at=now - timedelta(minutes=20),
                started_at=now - timedelta(minutes=10),
                updated_at=now - timedelta(minutes=10),
            )
        )

    with sessions() as session:
        assert worker.reconcile_expired_attempts(session) == 1

    monkeypatch.setattr(worker, "SessionLocal", sessions)
    claimed = worker.ClaimedAttempt(
        attempt_id=attempt_id,
        task_id=task_id,
        lease_token=lease_token,
        lease_expires_at=now - timedelta(minutes=1),
        input_snapshot={"title": "Fence"},
        provider_id="fake",
        provider_model="fake-v1",
    )
    with pytest.raises(RuntimeError, match="lease is no longer eligible"):
        worker.finalize_ready(
            claimed,
            provider_request_id="fake-request",
            output_key="output.png",
            output_bytes=b"png",
            checksum=b"0" * 32,
        )

    with sessions() as session:
        attempt = session.get(Attempt, attempt_id)
        assert attempt is not None
        assert attempt.status == "failed"
        assert session.scalar(select(func.count()).select_from(Artifact)) == 0
