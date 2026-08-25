# AI Artist M1 LLD-02: Backend API, Task Lifecycle, Upload/Download Links, and Task Metadata Contracts

## Document Control

| Field | Value |
| --- | --- |
| LLD | LLD-02 |
| Product milestone | M1: `Memory Product Pack Agent` |
| Primary source | [M1 HLD](../hld/milestone-1-high-level-design.md) |
| Status | Implementation-ready draft |
| Scope owner | Backend API, lifecycle, token model, upload/download contracts, attempt input snapshots, and attempt metadata |

## Purpose

LLD-02 defines the backend contract that turns website intake into a durable task, private uploads, immutable generation attempts, task metadata/status, and artifact download-link issuance.

LLD-02 is the source of truth for task lifecycle and attempt metadata.

## In Scope

- Task creation.
- Task-link token creation and validation.
- Upload-slot creation and uploaded asset metadata.
- Input completeness validation.
- Attempt `input.json` creation.
- `attempt_id` creation.
- `StartGenerationCommand`.
- Task metadata and status APIs.
- Attempt history API.
- Artifact download-link API.

## Out Of Scope

- Website UX details.
- Generation provider implementation.
- QA gate implementation.
- ZIP packaging.
- AWS deployment topology beyond API/runtime needs.
- Customer accounts, payment, marketplace publishing, POD, NFT, or operator review.

## Data Model And Status Ownership

LLD-02 owns the durable task record and the customer-facing task metadata.

M1 deliberately separates task input status from generation workflow status.

Task status describes whether the immutable customer input is complete:

```text
draft
uploading
ready
```

Attempt status describes one generation workflow:

```text
queued
generating
ready
failed
```

The task remains `ready` when an attempt fails. A new attempt may be created with a new refinement note after the current attempt reaches `ready` or `failed`.

Only one attempt may be `queued` or `generating` for a task at a time.

## Task Metadata

Recommended task record shape:

```json
{
  "task_id": "task_01J...",
  "status": "ready",
  "current_attempt_id": "att_002",
  "title": "Spring Walk in Kyoto",
  "note": "A quiet spring afternoon",
  "style": "warm_handmade",
  "photos": [
    {
      "asset_id": "asset_01J...",
      "filename": "kyoto.jpg",
      "upload_status": "uploaded"
    }
  ],
  "created_at": "2026-08-24T15:00:00Z",
  "updated_at": "2026-08-24T15:08:00Z"
}
```

Task rules:

- A draft task is created before photo upload so the browser has a task identity.
- The task accepts 1 to 5 photos, one title, one note, and one style.
- The Task status is `ready` only when title, note, style, and 1 to 5 uploaded photos are complete.
- After the task becomes `ready`, these base inputs are immutable.
- After any Attempt exists, these base inputs are immutable.
- Rights, copyright, and amendment workflows are not part of this first version.

## Task-Link Token Model

The task link is a bearer credential.

Link format:

```text
https://app.example.com/task/{task_id}#access_token={task_access_token}
```

API transport:

```http
Authorization: Bearer <task_access_token>
```

Rules:

- Store only token hash or HMAC.
- Do not accept task tokens in query strings, URL paths, cookies, or task bodies.
- Do not log raw tokens.
- `task_id` alone does not grant access.
- A valid token grants access to all task-scoped APIs for that task, including upload, asset completion, generation, status, attempt history, and download-link refresh.
- The token is valid for 30 days from Task creation.
- Lost-link recovery without verified email is not possible.

## Upload Contract

The browser requests upload slots from the Backend API. The backend creates server-owned object keys and returns short-lived upload instructions.

Recommended upload slot shape:

```json
{
  "slot_id": "slot_01J...",
  "asset_id": "asset_01",
  "upload_method": "presigned_post",
  "expires_at": "2026-08-22T00:15:00Z",
  "fields": {
    "key": "server-owned-key",
    "policy": "...",
    "x-amz-signature": "..."
  },
  "constraints": {
    "accepted_media_types": ["image/jpeg", "image/png"],
  "max_bytes": 20971520
  }
}
```

Rules:

- The browser never chooses S3 object keys.
- Upload URLs are short-lived.
- Uploaded asset metadata is recorded before submission.
- Uploads must be private.
- M1 accepts at most 5 photos per Task.
- Upload metadata must not include raw customer notes or unnecessary PII.

LLD-02/05 own source-upload layout. LLD-04 does not define source-upload paths.

## Asset And Attempt Model

Each photo is a task-owned asset. Upload slots are temporary; the uploaded asset metadata is durable.

```json
{
  "asset_id": "asset_01J...",
  "task_id": "task_01J...",
  "filename": "kyoto.jpg",
  "media_type": "image/jpeg",
  "size_bytes": 4821930,
  "upload_status": "uploaded",
  "storage_ref": {
    "bucket": "private-runtime-bucket",
    "key": "tasks/task_01J.../uploads/asset_01J....jpg"
  }
}
```

The browser never receives `storage_ref`.

The user clicks `Generate` to create the first attempt. A refinement creates another attempt only after the current attempt is `ready` or `failed`.

Every attempt stores a complete input snapshot:

```json
{
  "attempt_id": "att_002",
  "task_id": "task_01J...",
  "attempt_number": 2,
  "status": "generating",
  "input_snapshot": {
    "photo_asset_ids": ["asset_01J..."],
    "title": "Spring Walk in Kyoto",
    "note": "A quiet spring afternoon",
    "style": "warm_handmade",
    "refinement_note": "Use softer colors and a larger title"
  },
  "created_at": "2026-08-24T15:05:00Z",
  "completed_at": null
}
```

`refinement_note` is `null` for attempt 1. The input snapshot is the generation source of truth; a worker does not need to read mutable task fields.

Each attempt produces one M1 customer artifact: a fixed-dimension postcard PNG.

```json
{
  "artifact_id": "artifact_01J...",
  "attempt_id": "att_002",
  "artifact_type": "postcard",
  "filename": "spring-walk-in-kyoto.png",
  "mime_type": "image/png",
  "width": 1800,
  "height": 1200,
  "size_bytes": 1248290,
  "status": "ready",
  "storage_ref": {
    "bucket": "private-runtime-bucket",
    "key": "tasks/task_01J.../attempts/att_002/postcard.png"
  }
}
```

The browser never receives `storage_ref`, including in task metadata, attempt history, or download-link responses. The download API returns only a short-lived presigned URL.

## Attempt `input.json` Contract

LLD-02 owns the immutable Attempt `input.json` snapshot.

Normative shape:

```json
{
  "schema_version": "m1.attempt_input.v1",
  "task_id": "task_01J...",
  "created_at": "2026-08-22T00:00:00Z",
  "photo_asset_ids": ["asset_01J..."],
  "title": "Spring Walk in Kyoto",
  "note": "A quiet spring afternoon",
  "style": "warm_handmade",
  "refinement_note": "Use softer colors and a larger title",
  "output": {
    "artifact_type": "postcard",
    "format": "png",
    "width": 1800,
    "height": 1200
  }
}
```

Rules:

- `input.json` must not contain secrets.
- `attempt_id` is execution metadata and is not part of the customer input snapshot.
- The attempt input snapshot is immutable once generation starts.
- M1 has one fixed postcard PNG target.

## Attempt Creation

LLD-02 creates `attempt_id` after the user clicks `Generate` and the task status is `ready`.

Attempt creation must:

- Increment `attempt_number`.
- Write the complete immutable input snapshot.
- Persist it at `tasks/{task_id}/attempts/{attempt_id}/input.json` and record its checksum.
- Set the new attempt as `current_attempt_id`.
- Trigger LLD-03 with `StartGenerationCommand`.

LLD-02 must reject creation of a new attempt while another attempt for the task is `queued` or `generating`.

## `StartGenerationCommand`

LLD-02 emits this command to LLD-03.

```json
{
  "command_version": "m1.start_generation.v1",
  "task_id": "task_01J...",
  "attempt_id": "att_01J...",
  "input_snapshot_ref": {
    "bucket": "private-runtime-bucket",
    "key": "tasks/task_01J/attempts/att_01J/input.json",
    "sha256": "..."
  },
  "source_asset_ids": ["asset_01J..."],
  "output_prefix": "tasks/task_01J/attempts/att_01J/",
  "idempotency_key": "task_01J:attempt_att_01J",
  "created_at": "2026-08-22T00:00:00Z"
}
```

LLD-03 directly updates the Attempt status. M1 does not require a `GenerationCompleted` or `GenerationFailed` event handoff to LLD-04.

## Customer API Contract

All task-scoped APIs require the bearer task token. The create-task API is the only response that returns the raw access token.

### Create Task

```http
POST /v1/tasks
```

Creates a `draft` task before any photos are uploaded.

Response includes:

```json
{
  "task_id": "task_01J...",
  "status": "draft",
  "access_token": "returned_once"
}
```

### Update Task Metadata

```http
PATCH /v1/tasks/{task_id}
Authorization: Bearer <task_access_token>
```

Updates the customer-provided Task metadata before generation.

Request body:

```json
{
  "title": "Spring Walk in Kyoto",
  "note": "A quiet spring afternoon",
  "style": "warm_handmade"
}
```

Rules:

- The body may contain only `title`, `note`, and `style`.
- `title` must be 1 to 120 characters.
- `note` must be 1 to 1000 characters.
- `style` must be exactly `warm_handmade`.
- Omitted fields remain unchanged.
- The endpoint is allowed only while the Task is `draft` or `uploading` and before any Attempt exists.
- It returns a conflict once the Task is `ready` or any Attempt exists.
- After the update, the backend recalculates Task status from metadata completeness and uploaded Asset count.

### Upload Slots

```http
POST /v1/tasks/{task_id}/upload-slots
```

Request body:

```json
{
  "photo_count": 3
}
```

`photo_count` is the requested total number of photos for the Task and must be an integer from 1 through 5. The backend creates server-owned short-lived upload slots until the Task has that many uploaded or pending Assets. The browser uploads directly to private S3 and then confirms each uploaded asset through:

```http
POST /v1/tasks/{task_id}/assets/{asset_id}/complete
```

The backend validates the stored object before marking the asset `uploaded`.

Upload-slot rules:

- The endpoint is allowed while the Task is `draft` or `uploading`, before any Attempt exists.
- Repeated requests may be made while intake is incomplete.
- Unexpired pending slots are reused; new slots are created only for the missing count.
- `photo_count` must not be lower than the current uploaded plus pending Asset count. M1 does not cancel surplus pending slots; the user must wait for them to expire before requesting a smaller count.
- The backend rejects any request that would exceed 5 uploaded or pending Assets.
- Once the requested Assets are uploaded and title, note, and style are complete, the Task becomes `ready`.

Asset-complete behavior:

- If the Asset is already `uploaded`, the endpoint returns the existing Asset metadata without revalidating or creating a duplicate record.
- If the object is missing or validation fails, the endpoint returns an explicit error and does not mark the Asset `uploaded`.
- An uploaded Asset is permanently bound to its Task and cannot be completed or attached through another Task.

### Generate And Refine

The first generation is created by:

```http
POST /v1/tasks/{task_id}/generate
```

The task must be `ready`; this creates Attempt 1.

Later attempts are created by:

```http
POST /v1/tasks/{task_id}/attempts
```

The body contains only:

```json
{
  "refinement_note": "Use softer colors and a larger title"
}
```

The backend copies the immutable task inputs into the new attempt snapshot and rejects the call while another attempt is `queued` or `generating`.

### Task Metadata And Status

Status responses must be customer-safe.

`GET /v1/tasks/{task_id}` returns the task input, task status, current attempt status, and current artifacts.

Allowed customer fields:

- Task status: `draft`, `uploading`, or `ready`.
- Task input: title, note, style, photo count, and uploaded photo filenames.
- Current attempt ID and attempt number.
- Current attempt status: `queued`, `generating`, `ready`, or `failed`.
- Current refinement note.
- Customer-safe reason code.
- Upload progress.
- Whether action is needed.
- Artifact metadata: artifact ID, filename, type, dimensions, MIME type, and readiness.

Disallowed customer fields:

- Raw S3 keys.
- Internal artifact refs.
- Stack traces.
- Provider errors.
- Raw prompt text.
- Task token hash.
- Presigned URL internals.

`GET /v1/tasks/{task_id}/attempts` returns attempt history. Each item includes attempt ID, attempt number, status, refinement note, timestamps, and artifact metadata. Old artifacts remain downloadable by artifact ID.

## Download-Link API

`POST /v1/tasks/{task_id}/artifacts/{artifact_id}/download` creates a fresh short-lived download URL for a ready artifact owned by that task.

```text
tasks/{task_id}/attempts/{attempt_id}/postcard.png
```

Rules:

- The task token must authorize only that task.
- Download URLs are short-lived.
- The artifact must belong to the task and have status `ready`.
- Do not issue customer download URLs for source photos or internal artifacts.

## Dependencies

LLD-02 depends on:

- LLD-01 for intake fields and customer-safe state display needs.
- LLD-03 for generation command consumption, artifact readiness metadata, and direct Attempt status updates.
- LLD-05 for runtime storage prefix, IAM, retention, token logging constraints, and presigned URL posture.

LLD-02 provides:

- Task input status authority.
- Attempt `input.json`.
- Attempt metadata.
- Upload/download APIs.
- Token model.

## Acceptance Checks

- Task tokens are hash-only server side and never accepted in query/path/cookie/body.
- `PATCH /v1/tasks/{task_id}` persists only title, note, and style before the Task is ready or any Attempt exists.
- Task metadata validation is `title` 1–120 characters, `note` 1–1000 characters, and `style = warm_handmade`.
- Task status becomes `ready` only when metadata is complete and 1 to 5 Assets are uploaded.
- Upload slots use server-owned private keys and short TTLs.
- `POST /v1/tasks/{task_id}/upload-slots` requires `photo_count` from 1 through 5, reuses unexpired pending slots, and never creates more than 5 uploaded or pending Assets.
- A repeated asset-complete call for an uploaded Asset is idempotent and cannot bind the Asset to another Task.
- Attempt `input.json` contains the complete input snapshot and one fixed postcard PNG target.
- Every attempt has an immutable input snapshot and a refinement note.
- `StartGenerationCommand` includes `attempt_id` and an attempt-scoped output prefix.
- Only one attempt per task can be `queued` or `generating`.
- Download links target only ready postcard artifacts owned by the task.
- No accounts, payment, marketplace, POD, NFT, public gallery, rights workflow, or operator gate is introduced.

## Fixed Error Behavior

- A missing or not-ready artifact returns `409 artifact_not_ready` with `retryable: true`; an artifact that does not belong to the Task returns `404 artifact_not_found` with `retryable: false`.
- API errors use `{ "code": "...", "message": "...", "retryable": true|false }`.
