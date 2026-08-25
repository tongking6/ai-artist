# AI Artist M1 LLD-02: Backend API, Task Lifecycle, Upload/Download Links, and Task Metadata Contracts

## Document Control

| Field | Value |
| --- | --- |
| LLD | LLD-02 |
| Product milestone | M1: `Memory Product Pack Agent` |
| Primary source | [M1 HLD](../hld/milestone-1-high-level-design.md) |
| Status | Implementation-ready; PostgreSQL schema and customer API finalized |
| Scope owner | Backend API, lifecycle, LAN-only access contract, upload/download contracts, attempt input snapshots, and attempt metadata |

## Purpose

LLD-02 defines the backend contract that turns website intake into a durable task, private uploads, immutable generation attempts, task metadata/status, and artifact download-link issuance.

LLD-02 is the source of truth for task lifecycle and attempt metadata.

## In Scope

- Task creation.
- Phase 1 LAN-only application access.
- Upload-slot creation and uploaded asset metadata.
- Input completeness validation.
- Immutable Attempt `input_snapshot` JSONB creation.
- `attempt_id` creation.
- Durable queued-Attempt contract.
- Normative PostgreSQL columns, constraints, indexes, and transaction invariants.
- Task metadata and status APIs.
- Attempt history API.
- Artifact download-link API.

## Out Of Scope

- Website UX details.
- Generation provider implementation.
- QA gate implementation.
- ZIP packaging.
- Runtime deployment topology beyond API needs.
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

## Normative PostgreSQL Schema

M1 uses exactly four application tables:

```text
tasks
assets
attempts
artifacts
```

`attempts` is also the durable PostgreSQL work queue. M1 does not create `generation_jobs`, `upload_slots`, token, provider-response, or status-history tables.

Global rules:

- IDs are application-generated prefixed ULIDs stored as `varchar(40)`.
- Status fields use `varchar` plus `CHECK`, not PostgreSQL enum types.
- All timestamps use PostgreSQL `timestamptz`; database sessions use UTC and customer API responses serialize UTC as RFC3339 with `Z`.
- SHA-256 digests use `bytea` with `octet_length(value) = 32`.
- Foreign keys use `ON DELETE RESTRICT`; Task deletion is not an M1 workflow.
- M1 has no soft-delete columns or automatic application-data cleanup.

### `tasks`

| Column | Type | Null | Default | Purpose |
| --- | --- | --- | --- | --- |
| task_id | `varchar(40)` | no | — | Primary customer Task identity. |
| status | `varchar(16)` | no | `draft` | `draft`, `uploading`, or `ready`. |
| title | `varchar(120)` | yes | — | Immutable after intake completion. |
| note | `varchar(1000)` | yes | — | Immutable after intake completion. |
| style | `varchar(64)` | yes | — | Style ID; M1 initially accepts `warm_handmade`. |
| current_attempt_id | `varchar(40)` | yes | — | Attempt displayed as current for this Task. |
| created_at | `timestamptz` | no | `now()` | Creation time. |
| updated_at | `timestamptz` | no | `now()` | Last Task-row update. |

Constraints and indexes:

```sql
PRIMARY KEY (task_id)
CHECK (status IN ('draft', 'uploading', 'ready'))
CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 120)
CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 1000)
CHECK (style IS NULL OR char_length(btrim(style)) BETWEEN 1 AND 64)
CHECK (status <> 'ready' OR (title IS NOT NULL AND note IS NOT NULL AND style IS NOT NULL))
CHECK (updated_at >= created_at)
```

After `attempts` exists, add this ownership-preserving circular reference:

```sql
FOREIGN KEY (current_attempt_id, task_id)
  REFERENCES attempts (attempt_id, task_id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED
```

Phase 1 stores no Task credential or authentication state. Authentication and authorization require a later schema/API design before public exposure.

### `assets`

| Column | Type | Null | Default | Purpose |
| --- | --- | --- | --- | --- |
| asset_id | `varchar(40)` | no | — | Primary photo Asset identity and upload reservation identity. |
| task_id | `varchar(40)` | no | — | Owning Task. |
| client_file_id | `varchar(128)` | no | — | Stable browser-file mapping within a batch. |
| upload_batch_key | `varchar(128)` | no | — | Upload manifest idempotency key. |
| filename | `varchar(255)` | no | — | Sanitized customer-visible filename. |
| media_type | `varchar(16)` | no | — | `image/jpeg` or `image/png`. |
| size_bytes | `bigint` | no | — | Declared size, verified unchanged on completion. |
| upload_status | `varchar(16)` | no | `pending` | `pending`, `uploaded`, or `expired`. |
| storage_key | `text` | no | — | Real private object reference; never customer-visible. |
| upload_url_expires_at | `timestamptz` | no | — | Expiration of this reservation's presigned upload authorization. |
| created_at | `timestamptz` | no | `now()` | Reservation creation time. |
| updated_at | `timestamptz` | no | `now()` | Last upload-status update. |

Constraints and indexes:

```sql
PRIMARY KEY (asset_id)
FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE RESTRICT
UNIQUE (task_id, upload_batch_key, client_file_id)
UNIQUE (storage_key)
CHECK (media_type IN ('image/jpeg', 'image/png'))
CHECK (size_bytes BETWEEN 1 AND 20971520)
CHECK (upload_status IN ('pending', 'uploaded', 'expired'))
CHECK (char_length(btrim(filename)) BETWEEN 1 AND 255)
CHECK (upload_url_expires_at > created_at)
CHECK (updated_at >= created_at)
```

```sql
CREATE INDEX assets_task_status_idx
  ON assets (task_id, upload_status);

CREATE INDEX assets_pending_expiry_idx
  ON assets (upload_url_expires_at)
  WHERE upload_status = 'pending';
```

`upload_url_expires_at` applies only to the short-lived upload authorization. An uploaded Asset and its stored photo do not expire when that timestamp passes. Raw presigned URLs and POST credentials are never stored.

### `attempts`

| Column | Type | Null | Default | Purpose |
| --- | --- | --- | --- | --- |
| attempt_id | `varchar(40)` | no | — | Primary generation execution identity. |
| task_id | `varchar(40)` | no | — | Owning Task. |
| attempt_number | `smallint` | no | — | Monotonic number within one Task. |
| status | `varchar(16)` | no | `queued` | Durable queue and generation lifecycle status. |
| refinement_note | `varchar(1000)` | yes | — | Null for Attempt 1; required for later Attempts. |
| input_snapshot | `jsonb` | no | — | Complete immutable generation input. |
| provider_id | `varchar(32)` | no | — | Fixed at creation: `openai` or `fake`. |
| provider_model | `varchar(128)` | no | — | Fixed model snapshot for this Attempt. |
| provider_request_id | `varchar(255)` | yes | — | Narrow provider correlation ID when available. |
| failure_code | `varchar(64)` | yes | — | Customer-safe terminal failure category. |
| lease_token | `uuid` | yes | — | Fences one active Worker claim. |
| lease_expires_at | `timestamptz` | yes | — | Terminal claim timeout; never causes retry. |
| created_at | `timestamptz` | no | `now()` | Queue time. |
| started_at | `timestamptz` | yes | — | Worker claim time. |
| completed_at | `timestamptz` | yes | — | Ready/failed terminal time. |
| updated_at | `timestamptz` | no | `now()` | Last lifecycle update. |

Constraints and indexes:

```sql
PRIMARY KEY (attempt_id)
FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE RESTRICT
UNIQUE (attempt_id, task_id)
UNIQUE (task_id, attempt_number)
CHECK (attempt_number >= 1)
CHECK (status IN ('queued', 'generating', 'ready', 'failed'))
CHECK (jsonb_typeof(input_snapshot) = 'object')
CHECK (
  (provider_id = 'openai' AND provider_model = 'gpt-image-2-2026-04-21')
  OR
  (provider_id = 'fake' AND provider_model = 'fake-v1')
)
CHECK (
  (attempt_number = 1 AND refinement_note IS NULL)
  OR
  (attempt_number > 1 AND refinement_note IS NOT NULL AND char_length(btrim(refinement_note)) BETWEEN 1 AND 1000)
)
CHECK (
  (status = 'queued'
    AND lease_token IS NULL AND lease_expires_at IS NULL
    AND started_at IS NULL AND completed_at IS NULL AND failure_code IS NULL)
  OR
  (status = 'generating'
    AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
    AND started_at IS NOT NULL AND completed_at IS NULL AND failure_code IS NULL)
  OR
  (status = 'ready'
    AND lease_token IS NULL AND lease_expires_at IS NULL
    AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL)
  OR
  (status = 'failed'
    AND lease_token IS NULL AND lease_expires_at IS NULL
    AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
)
CHECK (started_at IS NULL OR started_at >= created_at)
CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
CHECK (lease_expires_at IS NULL OR (started_at IS NOT NULL AND lease_expires_at > started_at))
CHECK (updated_at >= created_at)
```

These checks enforce the status-field coherence summarized below; repository updates must change the related fields in the same statement:

| Status | Required fields | Required null fields |
| --- | --- | --- |
| queued | provider ID/model | lease token/expiry, started, completed, failure |
| generating | provider ID/model, lease token/expiry, started | completed, failure |
| ready | provider ID/model, started, completed | lease token/expiry, failure |
| failed | provider ID/model, started, completed, failure | lease token/expiry |

```sql
CREATE UNIQUE INDEX attempts_one_active_per_task_idx
  ON attempts (task_id)
  WHERE status IN ('queued', 'generating');

CREATE INDEX attempts_queue_idx
  ON attempts (created_at, attempt_id)
  WHERE status = 'queued';

CREATE INDEX attempts_expired_lease_idx
  ON attempts (lease_expires_at)
  WHERE status = 'generating';

CREATE INDEX attempts_task_history_idx
  ON attempts (task_id, attempt_number DESC);

CREATE INDEX attempts_provider_request_idx
  ON attempts (provider_request_id)
  WHERE provider_request_id IS NOT NULL;
```

`provider_id` and `provider_model` are fixed when the Attempt is inserted. Normal household generation stores `openai` and `gpt-image-2-2026-04-21`; deterministic tests store `fake` and `fake-v1`. A later configuration change cannot alter an already-created Attempt.

### `artifacts`

| Column | Type | Null | Default | Purpose |
| --- | --- | --- | --- | --- |
| artifact_id | `varchar(40)` | no | — | Customer-facing Artifact identity. |
| task_id | `varchar(40)` | no | — | Direct Task ownership for scoped lookup. |
| attempt_id | `varchar(40)` | no | — | Producing Attempt. |
| artifact_type | `varchar(32)` | no | — | `postcard` in M1. |
| filename | `varchar(255)` | no | — | Customer-visible download filename. |
| mime_type | `varchar(64)` | no | — | `image/png` in M1. |
| size_bytes | `bigint` | no | — | Verified output size. |
| sha256 | `bytea` | no | — | Verified output checksum. |
| storage_key | `text` | no | — | Real private object reference. |
| created_at | `timestamptz` | no | `now()` | Artifact creation time. |

Constraints and indexes:

```sql
PRIMARY KEY (artifact_id)
FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE RESTRICT
FOREIGN KEY (attempt_id, task_id)
  REFERENCES attempts (attempt_id, task_id)
  ON DELETE RESTRICT
UNIQUE (attempt_id)
UNIQUE (storage_key)
CHECK (artifact_type = 'postcard')
CHECK (mime_type = 'image/png')
CHECK (size_bytes BETWEEN 1 AND 20971520)
CHECK (octet_length(sha256) = 32)
CHECK (char_length(btrim(filename)) BETWEEN 1 AND 255)
```

```sql
CREATE INDEX artifacts_task_created_idx
  ON artifacts (task_id, created_at DESC);
```

Artifact rows are inserted only after minimum verification. Row existence means ready; M1 does not store a redundant Artifact status. Width `1800`, height `1200`, and PNG format remain fixed M1 API/output constants rather than database columns.

### Cross-Table Transactions And Locks

- Upload reservation: lock the Task row, expire stale pending Assets, enforce `uploaded + unexpired pending + requested <= 5`, then insert the batch.
- Complete intake: lock the Task row, require complete metadata, 1 to 5 uploaded Assets, and no pending Assets, then set Task `ready`.
- Create Attempt: lock the Task row, insert the queued Attempt with fixed provider/model and immutable `input_snapshot`, and update `tasks.current_attempt_id` in one transaction.
- Snapshot photo order: write uploaded Asset IDs ordered by `(created_at, asset_id)`; M1 has no manual photo reordering.
- Claim Attempt: atomically claim the oldest queued Attempt with `FOR UPDATE SKIP LOCKED`, set `generating`, and assign a lease token/expiry.
- Complete Attempt: condition on `status = generating`, matching lease token, and unexpired lease; insert the Artifact and set the Attempt `ready` in one transaction.
- Fail Attempt: condition on the matching live lease; set the Attempt `failed` with a safe failure code. Expired-lease reconciliation also sets `failed` and never requeues the Attempt.

## Customer Response Models

Customer JSON uses `snake_case`. Nullable fields are present as JSON `null`; response shape does not vary by omission. Request models reject unknown fields.

PostgreSQL stores every lifecycle time as `timestamptz`; SQLAlchemy maps it with `DateTime(timezone=True)`. Database sessions use UTC. The API serializes every customer-visible timestamp as UTC RFC3339 with the canonical `Z` suffix, for example `2026-08-25T14:30:00Z`. Customer requests do not submit lifecycle timestamps.

### `PhotoView`

```json
{
  "asset_id": "asset_01J...",
  "client_file_id": "file_01J...",
  "filename": "kyoto.jpg",
  "media_type": "image/jpeg",
  "size_bytes": 1248290,
  "upload_status": "uploaded",
  "created_at": "2026-08-25T14:00:00Z"
}
```

Task responses include effective `pending` and `uploaded` Assets only. Reservations whose `upload_url_expires_at <= now()` are treated as expired and excluded even before lazy status persistence. Photos are ordered by `(created_at, asset_id)`.

### `ArtifactView`

```json
{
  "artifact_id": "artifact_01J...",
  "artifact_type": "postcard",
  "filename": "spring-walk-in-kyoto.png",
  "mime_type": "image/png",
  "width": 1800,
  "height": 1200,
  "size_bytes": 1248290,
  "created_at": "2026-08-25T14:10:00Z"
}
```

Artifact existence means ready. The response does not add a redundant Artifact status and never exposes `storage_key` or `sha256`.

### `AttemptView`

```json
{
  "attempt_id": "att_01J...",
  "attempt_number": 1,
  "status": "ready",
  "refinement_note": null,
  "failure_code": null,
  "artifact": {
    "artifact_id": "artifact_01J...",
    "artifact_type": "postcard",
    "filename": "spring-walk-in-kyoto.png",
    "mime_type": "image/png",
    "width": 1800,
    "height": 1200,
    "size_bytes": 1248290,
    "created_at": "2026-08-25T14:10:00Z"
  },
  "created_at": "2026-08-25T14:02:00Z",
  "started_at": "2026-08-25T14:02:02Z",
  "completed_at": "2026-08-25T14:10:00Z"
}
```

`artifact` is non-null only for a ready Attempt. `failure_code` is non-null only for a failed Attempt and is customer-safe. The API never exposes provider, request-correlation, lease, prompt, or `input_snapshot` fields.

### `TaskView`

```json
{
  "task_id": "task_01J...",
  "status": "ready",
  "title": "Spring Walk in Kyoto",
  "note": "A quiet spring afternoon",
  "style": "warm_handmade",
  "photos": [
    {
      "asset_id": "asset_01J...",
      "client_file_id": "file_01J...",
      "filename": "kyoto.jpg",
      "media_type": "image/jpeg",
      "size_bytes": 1248290,
      "upload_status": "uploaded",
      "created_at": "2026-08-25T14:00:00Z"
    }
  ],
  "upload_summary": {
    "uploaded_count": 1,
    "pending_count": 0,
    "max_count": 5
  },
  "current_attempt": null,
  "created_at": "2026-08-25T13:55:00Z",
  "updated_at": "2026-08-25T14:01:00Z"
}
```

`current_attempt` is either the full `AttemptView` or `null`; Task status remains the intake status and is never overloaded with generation state. `title`, `note`, and `style` may be null before intake completion.

Task rules:

- A draft Task is created before photo upload so the browser has a Task identity.
- The Task accepts 1 to 5 photos, one title, one note, and one style.
- The Task status becomes `ready` only after explicit complete-intake succeeds with title, note, style, 1 to 5 uploaded photos, and no pending slots.
- After the Task becomes `ready`, these base inputs are immutable.
- After any Attempt exists, these base inputs are immutable.
- Rights, copyright, and amendment workflows are not part of this first version.

## Phase 1 LAN Access Model

Task route:

```text
https://ai-artist.home.arpa/tasks/{task_id}
```

Rules:

- Phase 1 has no application-layer login, Task token, or `Authorization` header.
- Any device admitted to the trusted home LAN can call the customer API and open a known Task route.
- `task_id` is a resource identifier, not an authorization credential.
- Nested Asset and Artifact routes still require the resource to belong to the path Task; missing and cross-Task resources both return the same `404` code.
- Authentication and authorization must be designed before any public Internet or future AWS-facing exposure.

## Upload Contract

The browser requests upload slots from the Backend API. The backend creates server-owned object keys and returns short-lived upload instructions.

Each upload slot item has this shape:

```json
{
  "slot_id": "slot_01J...",
  "asset_id": "asset_01",
  "client_file_id": "file_01J...",
  "upload_method": "presigned_post",
  "upload_url": "https://objects.ai-artist.home.arpa/ai-artist-private",
  "expires_at": "2026-08-22T00:15:00Z",
  "fields": {
    "key": "server-owned-key",
    "policy": "...",
    "provider_field_name": "provider-issued-value"
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
      "client_file_id": "file_01J...",
      "upload_method": "presigned_post",
      "upload_url": "https://objects.ai-artist.home.arpa/ai-artist-private",
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

`slot_id` is a response identifier deterministically derived from `asset_id`; it is not a database column. `upload_url` is the LAN-reachable MinIO/S3-compatible target. Presigned POST URLs and fields are generated on demand and never persisted.

Rules:

- The browser never chooses object-store keys.
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
  "client_file_id": "file_01J...",
  "filename": "kyoto.jpg",
  "media_type": "image/jpeg",
  "size_bytes": 1248290,
  "upload_status": "pending",
  "upload_batch_key": "upload_batch_01J...",
  "storage_key": "tasks/task_01J.../uploads/asset_01J....jpg",
  "upload_url_expires_at": "2026-08-25T12:15:00Z",
  "created_at": "2026-08-25T12:00:00Z",
  "updated_at": "2026-08-25T12:00:00Z"
}
```

The server persists the batch idempotency key as `upload_batch_key` on each reservation. `client_file_id` is browser-generated, stable for the selected file within this batch, and unique within the request. `filename` is display metadata only; the backend strips path components and chooses the storage extension from the validated media type. After successful object-store validation, the same record is updated with `upload_status = uploaded` and `updated_at`; the stored size must match `size_bytes`. Asset upload status transitions are:

```text
pending -> uploaded
pending -> expired
```

An expired pending Asset is not capacity. The backend may mark it `expired` lazily when reading or mutating the Task; it must treat `upload_url_expires_at <= now` as expired even before that write. A `complete` call for an expired reservation returns `upload_slot_expired`.

Capacity is derived from Asset records, not a separate Task counter:

```text
uploaded_count = Assets with upload_status = uploaded
pending_count = Assets with upload_status = pending and upload_url_expires_at > now
available_count = 5 - uploaded_count - pending_count
```

New upload slots are allowed only when `requested_new_slots <= available_count`. `complete-intake` requires 1 to 5 uploaded Assets and `pending_count = 0`.

The browser never receives `storage_key`.

The user clicks `Generate` to create the first attempt. A refinement creates another attempt only after the current attempt is `ready` or `failed`.

Every attempt stores a complete input snapshot:

```json
{
  "attempt_id": "att_002",
  "task_id": "task_01J...",
  "attempt_number": 2,
  "status": "generating",
  "input_snapshot": {
    "schema_version": "m1.attempt_input.v1",
    "photo_asset_ids": ["asset_01J..."],
    "title": "Spring Walk in Kyoto",
    "note": "A quiet spring afternoon",
    "style": "warm_handmade",
    "refinement_note": "Use softer colors and a larger title"
  },
  "provider_id": "openai",
  "provider_model": "gpt-image-2-2026-04-21",
  "provider_request_id": null,
  "lease_token": "018f0f64-7a3b-7e21-9db8-35d3f2fe91bc",
  "lease_expires_at": "2026-08-24T15:15:00Z",
  "created_at": "2026-08-24T15:05:00Z",
  "completed_at": null
}
```

`refinement_note` is `null` for attempt 1. The input snapshot is the generation source of truth; a worker does not need to read mutable task fields.

Each successful Attempt produces one M1 customer Artifact: a fixed-dimension postcard PNG.

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
  "storage_key": "tasks/task_01J.../attempts/att_002/postcard.png"
}
```

The browser never receives `storage_key`, including in task metadata, attempt history, or download-link responses. Width and height are derived from the fixed M1 output contract. The download API returns only a short-lived presigned URL.

## Attempt `input_snapshot` Contract

LLD-02 owns the immutable PostgreSQL `attempts.input_snapshot` JSONB value. M1 does not duplicate it as object-store `input.json`.

Normative shape:

```json
{
  "schema_version": "m1.attempt_input.v1",
  "task_id": "task_01J...",
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

- `input_snapshot` must not contain secrets.
- `attempt_id` is execution metadata and is not part of the customer input snapshot.
- The Attempt input snapshot is immutable after the Attempt is inserted.
- M1 has one fixed postcard PNG target.

## Attempt Creation

LLD-02 creates `attempt_id` when the user submits the common Attempt endpoint and the Task status is `ready`.

Attempt creation must:

- Increment `attempt_number`.
- Insert the complete immutable `input_snapshot` JSONB value.
- Fix `provider_id` and `provider_model` from the approved runtime configuration.
- Set the new Attempt as `tasks.current_attempt_id` in the same PostgreSQL transaction.

LLD-02 must reject creation of a new attempt while another attempt for the task is `queued` or `generating`.

## Attempt Queue Contract

The queued Attempt row is the complete durable work item. M1 does not create a separate command payload or job row.

```json
{
  "attempt_id": "att_01J...",
  "task_id": "task_01J...",
  "status": "queued",
  "provider_id": "openai",
  "provider_model": "gpt-image-2-2026-04-21",
  "input_snapshot": {}
}
```

LLD-03 claims and directly updates this Attempt row. M1 does not require a `StartGenerationCommand`, `GenerationCompleted`, or `GenerationFailed` event.

## Customer API Contract

Phase 1 exposes nine Backend API operations. None uses application-layer authentication while the application remains inside the trusted home LAN.

| API | Purpose | Success | Response |
| --- | --- | ---: | --- |
| `POST /v1/tasks` | Create a draft Task. | 201 | Create Task response |
| `PATCH /v1/tasks/{task_id}` | Save title, note, and style. | 200 | `TaskView` |
| `POST /v1/tasks/{task_id}/upload-slots` | Reserve Assets and return direct-upload instructions. | 200 | Upload-slots envelope |
| `POST /v1/tasks/{task_id}/assets/{asset_id}/complete` | Validate a stored photo and mark it uploaded. | 200 | `PhotoView` |
| `POST /v1/tasks/{task_id}/complete-intake` | Validate and freeze the Task input. | 200 | `TaskView` |
| `POST /v1/tasks/{task_id}/attempts` | Create Attempt 1 or a later refinement Attempt. | 202 | `AttemptView` |
| `GET /v1/tasks/{task_id}` | Read current intake and generation state. | 200 | `TaskView` |
| `GET /v1/tasks/{task_id}/attempts` | Read Attempt history. | 200 | Attempt-history envelope |
| `POST /v1/tasks/{task_id}/artifacts/{artifact_id}/download` | Create a short-lived Artifact download URL. | 200 | Download response |

### Create Task

```http
POST /v1/tasks
```

Creates a `draft` Task before any photos are uploaded. The request has no body.

Response:

```json
{
  "task_id": "task_01J...",
  "status": "draft"
}
```

### Update Task Metadata

```http
PATCH /v1/tasks/{task_id}
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
- At least one field must be present.
- `title` must be 1 to 120 characters.
- `note` must be 1 to 1000 characters.
- `style` must be exactly `warm_handmade`.
- Omitted fields remain unchanged.
- The endpoint is allowed only while the Task is `draft` or `uploading` and before any Attempt exists.
- It returns a conflict once the Task is `ready` or any Attempt exists.
- After the update, the backend recalculates input completeness; the Task remains `uploading` until `complete-intake` succeeds.
- Success returns the complete `TaskView`.

### Upload Slots

```http
POST /v1/tasks/{task_id}/upload-slots
```

Request body:

```json
{
  "files": [
    {
      "client_file_id": "file_01J...",
      "filename": "kyoto.jpg",
      "media_type": "image/jpeg",
      "size_bytes": 1248290
    },
    {
      "client_file_id": "file_01K...",
      "filename": "osaka.png",
      "media_type": "image/png",
      "size_bytes": 2084000
    }
  ],
  "idempotency_key": "upload_batch_01J..."
}
```

`files` is the complete manifest for the newly selected batch and must contain 1 to 5 items. Every item must include a unique `client_file_id`, a display `filename`, an allowed `media_type`, and the browser-observed `size_bytes`. The backend validates the manifest before creating one server-owned short-lived upload slot per item. The response returns `client_file_id` with its assigned `asset_id`; array order is not a contract.

Manifest rules:

- `client_file_id` is an opaque browser-generated string of 1 to 128 characters and must be unique within the batch.
- `filename` must be 1 to 255 characters after path components and control characters are removed; it is display metadata and is never used to form an object key.
- `media_type` must be `image/jpeg` or `image/png`.
- `size_bytes` must be an integer from 1 through 20 MB inclusive.
- The backend derives `normalized_ext` as `jpg` or `png` from `media_type`.
- On asset completion, the backend verifies the stored media type and actual size; a mismatch with the declared manifest fails validation.
- The response `expires_at` and persisted `upload_url_expires_at` are the same presigned-upload expiration timestamp.

The browser uploads directly to the private S3-compatible object store and then confirms each uploaded asset through:

```http
POST /v1/tasks/{task_id}/assets/{asset_id}/complete
```

The backend validates the stored object before marking the asset `uploaded`.

The direct browser-to-object-store POST is data transfer, not a tenth Backend API. The browser sends only the short-lived presigned POST fields to `upload_url`; it does not send application credentials or receive `storage_key`.

Upload-slot rules:

- The endpoint is allowed while the Task is `draft` or `uploading`, before any Attempt exists.
- Repeated requests may be made while intake is incomplete.
- `idempotency_key` is required, opaque, unique per Task and per Add-photo batch, and reused when the same request is retried.
- A retry with the same Task, `idempotency_key`, and canonical file set returns the same Asset/client-file mappings and creates no new reservations. The backend may regenerate presigned POST fields for the same `storage_key`, but the returned expiration cannot exceed the persisted `upload_url_expires_at`.
- The canonical manifest is sorted by `client_file_id`; changing array order alone is not a mismatch. Reusing the same key with a different file set or changed per-file field returns `upload_batch_mismatch`.
- A batch key whose reservations have all expired returns `upload_batch_expired`; the client must use a new key for a new batch.
- Each request reserves slots only for newly selected files; a retry for the same file may reuse its existing pending slot.
- The backend rejects any request where `uploaded_assets + pending_slots + files.length > 5`.
- M1 does not require a final photo count and does not cancel pending slots. Expired pending slots release their capacity for a later request.
- Creating upload slots or confirming an upload moves a `draft` Task to `uploading`.
- The Task remains `uploading` while the user may add more photos. It becomes `ready` only through `POST /complete-intake` after all selected uploads are complete.

Asset-complete behavior:

- If the Asset is already `uploaded`, the endpoint returns the existing Asset metadata without revalidating or creating a duplicate record.
- If the object is missing or validation fails, the endpoint returns an explicit error and does not mark the Asset `uploaded`.
- If the reservation has expired, the endpoint returns `upload_slot_expired` and does not validate or mark the Asset `uploaded`.
- An uploaded Asset is permanently bound to its Task and cannot be completed or attached through another Task.
- Success returns the `PhotoView` for that Asset.

### Complete Intake

```http
POST /v1/tasks/{task_id}/complete-intake
```

Finalizes the upload step and freezes the Task base inputs. The request has no body.

Rules:

- While the Task is `draft` or `uploading`, the endpoint requires complete title, note, and style metadata, 1 to 5 uploaded Assets, and zero pending upload slots.
- On first success, the Task becomes `ready`.
- Repeating the call for an already-ready Task returns the current `TaskView` with 200 and changes nothing, even if Attempts now exist.
- If validation fails before readiness, the Task remains `uploading` and the response identifies the missing input or pending upload condition.

### Create Attempt

Initial generation and later refinement use the same endpoint:

```http
POST /v1/tasks/{task_id}/attempts
```

Attempt 1 request:

```json
{}
```

Later refinement request:

```json
{
  "refinement_note": "Use softer colors and a larger title"
}
```

Rules:

- The Task must be `ready`.
- When no Attempt exists, the body must be `{}` and the backend creates Attempt 1 with `refinement_note = null`.
- Supplying `refinement_note` for Attempt 1 returns `initial_attempt_refinement_not_allowed`.
- When an Attempt already exists, the current Attempt must be `ready` or `failed` and `refinement_note` is required with 1 to 1000 trimmed characters.
- Omitting the later refinement note returns `refinement_note_required`.
- A current `queued` or `generating` Attempt returns `attempt_in_progress`.
- The backend copies the immutable Task inputs into `input_snapshot`, fixes provider/model, inserts the queued Attempt, and changes `tasks.current_attempt_id` in one transaction.
- Success returns the queued `AttemptView` with HTTP 202.

The frontend does not automatically retry this POST. Before sending, it remembers the current Attempt ID. On an ambiguous transport failure, it calls `GET /v1/tasks/{task_id}`: a changed `current_attempt.attempt_id` means the original request succeeded; an unchanged or null ID permits a user-initiated resubmission.

### Task Metadata And Status

`GET /v1/tasks/{task_id}` returns the complete `TaskView`. It is the browser's primary refresh and polling API and contains only the current Attempt. Responses are customer-safe and never expose internal storage, provider, prompt, lease, or signed-URL fields.

`GET /v1/tasks/{task_id}/attempts` returns all Attempts ordered by `attempt_number DESC`:

```json
{
  "attempts": []
}
```

M1 does not paginate Attempt history. Every item is an `AttemptView`, and previous ready Artifacts remain downloadable by Artifact ID.

## Download-Link API

`POST /v1/tasks/{task_id}/artifacts/{artifact_id}/download` creates a fresh short-lived download URL for a ready artifact owned by that task.

```text
tasks/{task_id}/attempts/{attempt_id}/postcard.png
```

Rules:

- Download URLs are short-lived.
- The artifact must belong to the Task and its Attempt must have status `ready`.
- Do not issue customer download URLs for source photos or internal artifacts.

Response:

```json
{
  "artifact_id": "artifact_01J...",
  "download_url": "https://objects.ai-artist.home.arpa/...",
  "expires_at": "2026-08-25T14:30:00Z"
}
```

The URL and credentials are generated on demand and are not persisted.

## Customer POST Retry Rules

- `POST /v1/tasks` is not automatically retried. If its response is lost, the user may start a new empty Task; an unreachable orphan draft is an accepted Phase 1 tradeoff.
- `PATCH /v1/tasks/{task_id}`, Asset complete, and complete-intake are safe to repeat with the same intent.
- Upload-slot retries require the same `idempotency_key` and canonical manifest.
- Attempt creation is never automatically retried and uses the `GET Task` reconciliation rule above.
- Download-link creation is safe to repeat and returns a newly generated short-lived URL.

## Dependencies

LLD-02 depends on:

- LLD-01 for intake fields and customer-safe state display needs.
- LLD-03 for queued-Attempt claiming, artifact readiness metadata, and direct Attempt status updates.
- LLD-05 for the LAN access boundary, runtime storage prefix, workload access, Attempt lease handling, retention, log-redaction constraints, and presigned URL posture.

LLD-02 provides:

- Task input status authority.
- Attempt `input_snapshot` JSONB.
- Attempt metadata.
- Upload/download APIs.
- Phase 1 LAN-only access contract.

## Acceptance Checks

- Phase 1 stores no Task credential and customer APIs require no application `Authorization` header while LAN-only.
- Customer timestamps map PostgreSQL `timestamptz` to UTC RFC3339 strings with `Z`.
- `PATCH /v1/tasks/{task_id}` persists only title, note, and style before the Task is ready or any Attempt exists.
- Task metadata validation is `title` 1–120 characters, `note` 1–1000 characters, and `style = warm_handmade`.
- `POST /v1/tasks/{task_id}/complete-intake` requires complete metadata, 1 to 5 uploaded Assets, and zero pending slots before setting Task status to `ready`.
- Upload slots use server-owned private keys and short TTLs.
- `POST /v1/tasks/{task_id}/upload-slots` requires a validated per-file manifest, enforces `uploaded + pending + files.length <= 5`, and never creates more than 5 uploaded or pending Assets.
- Upload-slots retries with the same Task, `idempotency_key`, and canonical manifest return the same Asset mappings without creating new reservations.
- Every upload slot echoes `client_file_id` and maps it to one server-assigned `asset_id`.
- A repeated asset-complete call for an uploaded Asset is idempotent and cannot bind the Asset to another Task.
- Pending upload reservations are persisted as Asset records with `pending`, `uploaded`, or `expired` status; capacity counts only unexpired pending reservations.
- Attempt `input_snapshot` contains the complete immutable input and one fixed postcard PNG target.
- Every Attempt has an immutable input snapshot; Attempt 1 has a null refinement note and later Attempts require one.
- Attempt creation and `tasks.current_attempt_id` update commit atomically.
- Initial generation and later refinement both use `POST /v1/tasks/{task_id}/attempts`; Attempt 1 has no refinement note and later Attempts require one.
- The queued Attempt row contains the immutable input snapshot and fixed provider/model; no separate job or command row exists.
- Only one attempt per task can be `queued` or `generating`.
- Download links target only ready postcard artifacts owned by the task.
- No accounts, payment, marketplace, POD, NFT, public gallery, rights workflow, or operator gate is introduced.

## Fixed Error Behavior

- API errors use `{ "code": "...", "message": "...", "retryable": true|false }`.

| Endpoint condition | HTTP status | Error code | Retryable |
| --- | ---: | --- | --- |
| Malformed JSON, unknown fields, or wrong field types | 400 | `invalid_request` | false |
| Task ID does not exist | 404 | `task_not_found` | false |
| Task metadata violates length/style rules | 400 | `invalid_task_metadata` | false |
| Task is ready or has an Attempt and receives a base-input mutation | 409 | `task_immutable` | false |
| The file manifest is malformed, contains unsupported media, declares an invalid size, or exceeds the 5-photo capacity | 400 | `invalid_upload_manifest` | false |
| Same idempotency key is reused with a different canonical file manifest | 409 | `upload_batch_mismatch` | false |
| Same idempotency key refers to fully expired reservations | 409 | `upload_batch_expired` | false |
| Asset does not exist or belongs to another Task | 404 | `asset_not_found` | false |
| Uploaded object is missing or fails validation | 422 | `uploaded_asset_invalid` | false |
| Upload reservation has expired | 409 | `upload_slot_expired` | false |
| Complete-intake has incomplete metadata or no uploaded Asset | 409 | `intake_not_complete` | false |
| Complete-intake has pending upload slots | 409 | `pending_uploads_exist` | true |
| Attempt creation occurs before Task readiness | 409 | `task_not_ready` | true |
| Attempt 1 request contains a refinement note | 400 | `initial_attempt_refinement_not_allowed` | false |
| Later Attempt request omits a refinement note | 400 | `refinement_note_required` | false |
| Refinement note violates length/content rules | 400 | `invalid_refinement_note` | false |
| An Attempt is already queued or generating | 409 | `attempt_in_progress` | true |
| Artifact does not exist or belongs to another Task | 404 | `artifact_not_found` | false |
