from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated

import uvicorn
from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.responses import Response

from ai_artist.adapters.object_store import S3ObjectStore
from ai_artist.config import get_settings
from ai_artist.database import get_session
from ai_artist.errors import DomainError
from ai_artist.schemas import (
    AttemptListView,
    AttemptView,
    CreateAttemptInput,
    CreateTaskView,
    DownloadView,
    ErrorView,
    PhotoView,
    TaskListView,
    TaskView,
    UpdateTaskInput,
    UploadSlotsInput,
    UploadSlotsView,
)
from ai_artist.service import (
    complete_asset,
    complete_intake,
    create_attempt,
    create_download,
    create_task,
    create_upload_slots,
    get_task,
    list_attempts,
    list_tasks,
    update_task,
)

settings = get_settings()
object_store = S3ObjectStore(settings)
SessionDependency = Annotated[Session, Depends(get_session)]


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    object_store.ensure_bucket()
    yield


app = FastAPI(
    title="AI Artist M1 API",
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def private_response_headers(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    response = await call_next(request)
    if request.url.path.startswith("/v1/") or request.url.path == "/v1/tasks":
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.exception_handler(DomainError)
async def handle_domain_error(_: Request, error: DomainError) -> JSONResponse:
    body = ErrorView(
        code=error.code,
        message=error.message,
        retryable=error.retryable,
    )
    return JSONResponse(status_code=error.status_code, content=body.model_dump(mode="json"))


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, _: RequestValidationError) -> JSONResponse:
    code = "invalid_request"
    message = "Request body or parameters are invalid."
    if request.url.path.endswith("/upload-slots"):
        code = "invalid_upload_manifest"
        message = "Upload manifest is invalid."
    elif request.method == "PATCH" and request.url.path.startswith("/v1/tasks/"):
        code = "invalid_task_metadata"
        message = "Task metadata is invalid."
    elif request.url.path.endswith("/attempts") and request.method == "POST":
        code = "invalid_refinement_note"
        message = "Refinement note is invalid."
    body = ErrorView(code=code, message=message, retryable=False)
    return JSONResponse(status_code=400, content=body.model_dump(mode="json"))


@app.get("/healthz")
def health(session: SessionDependency) -> dict[str, str]:
    session.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post("/v1/tasks", response_model=CreateTaskView, status_code=201)
def create_task_endpoint(session: SessionDependency) -> CreateTaskView:
    return create_task(session)


@app.get("/v1/tasks", response_model=TaskListView)
def list_tasks_endpoint(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    cursor: str | None = None,
) -> TaskListView:
    return list_tasks(session, limit=limit, cursor=cursor)


@app.get("/v1/tasks/{task_id}", response_model=TaskView)
def get_task_endpoint(task_id: str, session: SessionDependency) -> TaskView:
    return get_task(session, task_id)


@app.patch("/v1/tasks/{task_id}", response_model=TaskView)
def update_task_endpoint(
    task_id: str,
    body: UpdateTaskInput,
    session: SessionDependency,
) -> TaskView:
    return update_task(session, task_id, body)


@app.post("/v1/tasks/{task_id}/upload-slots", response_model=UploadSlotsView)
def create_upload_slots_endpoint(
    task_id: str,
    body: UploadSlotsInput,
    session: SessionDependency,
) -> UploadSlotsView:
    return create_upload_slots(session, object_store, settings, task_id, body)


@app.post("/v1/tasks/{task_id}/assets/{asset_id}/complete", response_model=PhotoView)
def complete_asset_endpoint(
    task_id: str,
    asset_id: str,
    session: SessionDependency,
) -> PhotoView:
    return complete_asset(session, object_store, task_id, asset_id)


@app.post("/v1/tasks/{task_id}/complete-intake", response_model=TaskView)
def complete_intake_endpoint(task_id: str, session: SessionDependency) -> TaskView:
    return complete_intake(session, task_id)


@app.post("/v1/tasks/{task_id}/attempts", response_model=AttemptView, status_code=202)
def create_attempt_endpoint(
    task_id: str,
    body: CreateAttemptInput,
    session: SessionDependency,
) -> AttemptView:
    return create_attempt(session, settings, task_id, body)


@app.get("/v1/tasks/{task_id}/attempts", response_model=AttemptListView)
def list_attempts_endpoint(task_id: str, session: SessionDependency) -> AttemptListView:
    return list_attempts(session, task_id)


@app.post(
    "/v1/tasks/{task_id}/artifacts/{artifact_id}/download",
    response_model=DownloadView,
)
def create_download_endpoint(
    task_id: str,
    artifact_id: str,
    session: SessionDependency,
) -> DownloadView:
    return create_download(session, object_store, settings, task_id, artifact_id)


def run() -> None:
    uvicorn.run("ai_artist.app:app", host="0.0.0.0", port=8000)
