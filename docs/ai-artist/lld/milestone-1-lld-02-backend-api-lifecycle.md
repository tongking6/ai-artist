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

Task status transitions:

```text
create Task                                      -> draft
upload-slots creates a pending slot              -> uploading
asset complete succeeds while input is incomplete -> uploading
asset validation fails                            -> current Task status unchanged
all pending slots expire with no uploaded Asset  -> draft
all selected Assets uploaded                     -> uploading until complete-intake
complete-intake succeeds                         -> ready
```

An expired pending slot releases capacity but does not change any uploaded Asset. A Task with at least one uploaded Asset remains `uploading` until the user completes intake; a Task with no uploaded or pending Assets is `draft`.

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
- The Task status becomes `ready` only after explicit complete-intake succeeds with title, note, style, 1 to 5 uploaded photos, and no pending slots.
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

Each upload slot item has this shape:

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

The upload-slots endpoint always returns an array envelope:

```json
{
  "slots": [
    {
      "slot_id": "slot_01J...",
      "asset_id": "asset_01J...",
      "upload_method": "presigned_post",
      "expires_at": "2026-08-25T12:15:00Z",
      "fields": {},
      "constraints": {
        "accepted_media_types": ["image/jpeg", "image/png"],
        "max_bytes": 20971520
      }
    }
  ]
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

Each photo reservation is a task-owned `Asset` record. M1 does not introduce a separate `UploadSlot` record; a pending Asset is the durable reservation created for one upload slot.

Pending Asset schema:

```json
{
  "asset_id": "asset_01J...",
  "task_id": "task_01J...",
  "filename": "kyoto.jpg",
  "media_type": "image/jpeg",
  "size_bytes": null,
  "upload_status": "pending",
  "upload_batch_key": "upload_batch_01J...",
  "slot_expires_at": "2026-08-25T12:15:00Z",
  "uploaded_at": null,
  "storage_ref": {
    "bucket": "private-runtime-bucket",
    "key": "tasks/task_01J.../uploads/asset_01J....jpg"
  }
}
```

The server persists the batch idempotency key as `upload_batch_key` on each reservation. After successful S3 validation, the same record is updated with `upload_status = uploaded`, the verified `size_bytes`, and `uploaded_at`. Asset upload status transitions are:

```text
pending -> uploaded
pending -> expired
```

An expired pending Asset is not capacity. The backend may mark it `expired` lazily when reading or mutating the Task; it must treat `slot_expires_at <= now` as expired even before that write. A `complete` call for an expired reservation returns `upload_slot_expired`.

Capacity is derived from Asset records, not a separate Task counter:

```text
uploaded_count = Assets with upload_status = uploaded
pending_count = Assets with upload_status = pending and slot_expires_at > now
available_count = 5 - uploaded_count - pending_count
```

New upload slots are allowed only when `requested_new_slots <= available_count`. `complete-intake` requires 1 to 5 uploaded Assets and `pending_count = 0`.

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
- After the update, the backend recalculates input completeness; the Task remains `uploading` until `complete-intake` succeeds.

### Complete Intake

```http
POST /v1/tasks/{task_id}/complete-intake
Authorization: Bearer <task_access_token>
```

Finalizes the upload step and freezes the Task base inputs.

Rules:

- The endpoint is allowed only while the Task is `draft` or `uploading` and before any Attempt exists.
- It requires complete title, note, and style metadata.
- It requires 1 to 5 uploaded Assets and zero pending upload slots.
- On success, the Task status becomes `ready`.
- If validation fails, the Task remains `uploading` and the response identifies the missing input or pending upload condition.

### Upload Slots

```http
POST /v1/tasks/{task_id}/upload-slots
```

Request body:

```json
{
  "photo_count": 3,
  "idempotency_key": "upload_batch_01J..."
}
```

`photo_count` is the number of newly selected photos for this upload request and must be an integer from 1 through 5. The backend creates that many server-owned short-lived upload slots. The browser uploads directly to private S3 and then confirms each uploaded asset through:

```http
POST /v1/tasks/{task_id}/assets/{asset_id}/complete
```

The backend validates the stored object before marking the asset `uploaded`.

Upload-slot rules:

- The endpoint is allowed while the Task is `draft` or `uploading`, before any Attempt exists.
- Repeated requests may be made while intake is incomplete.
- `idempotency_key` is required, opaque, unique per Task and per Add-photo batch, and reused when the same request is retried.
- A retry with the same Task and `idempotency_key` returns the original `slots` array and creates no new Asset reservations.
- Reusing the same key with a different `photo_count` returns `upload_batch_mismatch`.
- A batch key whose reservations have all expired returns `upload_batch_expired`; the client must use a new key for a new batch.
- Each request reserves slots only for newly selected files; a retry for the same file may reuse its existing pending slot.
- The backend rejects any request where `uploaded_assets + pending_slots + photo_count > 5`.
- M1 does not require a final photo count and does not cancel pending slots. Expired pending slots release their capacity for a later request.
- Creating upload slots or confirming an upload moves a `draft` Task to `uploading`.
- The Task remains `uploading` while the user may add more photos. It becomes `ready` only through `POST /complete-intake` after all selected uploads are complete.

Asset-complete behavior:

- If the Asset is already `uploaded`, the endpoint returns the existing Asset metadata without revalidating or creating a duplicate record.
- If the object is missing or validation fails, the endpoint returns an explicit error and does not mark the Asset `uploaded`.
- If the reservation has expired, the endpoint returns `upload_slot_expired` and does not validate or mark the Asset `uploaded`.
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
- `POST /v1/tasks/{task_id}/complete-intake` requires complete metadata, 1 to 5 uploaded Assets, and zero pending slots before setting Task status to `ready`.
- Upload slots use server-owned private keys and short TTLs.
- `POST /v1/tasks/{task_id}/upload-slots` requires the count of newly selected photos, enforces `uploaded + pending + requested <= 5`, and never creates more than 5 uploaded or pending Assets.
- Upload-slots retries with the same Task and `idempotency_key` return the same `slots` array without creating new reservations.
- A repeated asset-complete call for an uploaded Asset is idempotent and cannot bind the Asset to another Task.
- Pending upload reservations are persisted as Asset records with `pending`, `uploaded`, or `expired` status; capacity counts only unexpired pending reservations.
- Attempt `input.json` contains the complete input snapshot and one fixed postcard PNG target.
- Every attempt has an immutable input snapshot and a refinement note.
- `StartGenerationCommand` includes `attempt_id` and an attempt-scoped output prefix.
- Only one attempt per task can be `queued` or `generating`.
- Download links target only ready postcard artifacts owned by the task.
- No accounts, payment, marketplace, POD, NFT, public gallery, rights workflow, or operator gate is introduced.

## Fixed Error Behavior

- API errors use `{ "code": "...", "message": "...", "retryable": true|false }`.

| Endpoint condition | HTTP status | Error code | Retryable |
| --- | ---: | --- | --- |
| Task metadata violates length/style rules | 400 | `invalid_task_metadata` | false |
| Task is ready or has an Attempt and receives a base-input mutation | 409 | `task_immutable` | false |
| `photo_count` is invalid or exceeds the 5-photo capacity | 400 | `invalid_photo_count` | false |
| Same idempotency key is reused with a different `photo_count` | 409 | `upload_batch_mismatch` | false |
| Same idempotency key refers to fully expired reservations | 409 | `upload_batch_expired` | false |
| Asset ID does not exist for this Task | 404 | `asset_not_found` | false |
| Asset belongs to another Task | 409 | `asset_not_owned_by_task` | false |
| Uploaded object is missing or fails validation | 422 | `uploaded_asset_invalid` | false |
| Upload reservation has expired | 409 | `upload_slot_expired` | false |
| Complete-intake has incomplete metadata or no uploaded Asset | 409 | `intake_not_complete` | false |
| Complete-intake has pending upload slots | 409 | `pending_uploads_exist` | true |
| Artifact is missing or not ready | 409 | `artifact_not_ready` | true |
| Artifact does not belong to the Task | 404 | `artifact_not_found` | false |
