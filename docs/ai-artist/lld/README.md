# AI Artist M1 Low-Level Designs

## Document Control

| Field | Value |
| --- | --- |
| Product milestone | M1: Memory Product Pack Agent |
| Primary source | [M1 HLD](../hld/milestone-1-high-level-design.md) |
| Status | Simplified M1 design agreed; implementation-ready draft |
| Scope | Website Task intake, postcard generation, minimum runtime, and private artifact download |

## Active LLD Set

| LLD | Title | Status |
| --- | --- | --- |
| [LLD-01](./milestone-1-lld-01-website-intake-status-delivery.md) | Website Task Intake, Status, Refinement, and Delivery UX | Implementation-ready draft |
| [LLD-02](./milestone-1-lld-02-backend-api-lifecycle.md) | Backend API, Task Data Model, Attempts, Upload/Download Links | Implementation-ready draft |
| [LLD-03](./milestone-1-lld-03-generation-worker.md) | Postcard Generation Worker and Minimum Verification | Implementation-ready draft |
| [LLD-05](./milestone-1-lld-05-runtime-security-ops.md) | AWS Runtime, Storage, Security, SQS, and Retention | Implementation-ready draft |

[LLD-04](./milestone-1-lld-04-qa-packaging-delivery.md) is deferred and is not part of the M1 execution path.

## Current M1 Model

M1 contains:

- `Task`: immutable base input with 1 to 5 photos, title, note, style, and Task status.
- `Attempt`: one generation execution with a complete input snapshot, optional refinement note, and Attempt status.
- `Artifact`: one fixed-dimension `1800x1200` postcard PNG owned by an Attempt.

Statuses are separate:

- Task: `draft`, `uploading`, `ready`.
- Attempt: `queued`, `generating`, `ready`, `failed`.

Only one Attempt for a Task may be `queued` or `generating`.

## Cross-LLD Contracts

### Identity

- `task_id` identifies the user Task.
- `attempt_id` identifies one generation execution.
- No `generation_job_id`, `generation_version`, or `latest_eligible_attempt_id` is required in M1.
- Platform invocation IDs are logging details only.

### Input Snapshot

LLD-02 writes:

```text
tasks/{task_id}/attempts/{attempt_id}/input.json
```

The snapshot contains:

- `photo_asset_ids`
- `title`
- `note`
- `style`
- `refinement_note`

LLD-03 reads this immutable snapshot and does not mutate it.

### Storage

LLD-05 owns:

```text
tasks/{task_id}/
  uploads/{asset_id}.{normalized_ext}
  attempts/{attempt_id}/
    input.json
    postcard.png
```

### Generation

- LLD-02 creates the Attempt and sends `StartGenerationCommand` to SQS.
- LLD-03 directly updates Attempt status.
- LLD-03 generates exactly one `1800x1200` PNG.
- LLD-03 performs minimum verification before setting `ready`.
- LLD-04 is not required.

### Customer Access

Task link:

```text
https://app.example.com/task/{task_id}#access_token={task_access_token}
```

The browser sends the token as:

```http
Authorization: Bearer <task_access_token>
```

All task-scoped APIs require this bearer token. The token is valid for 30 days from Task creation.

M1 upload limits are `image/jpeg` or `image/png`, up to 20 MB per photo and 5 photos per Task.

Customer download is a fresh short-lived URL for a ready postcard Artifact only.

## Implementation Order

1. LLD-02 Task/Asset/Attempt persistence and customer API.
2. LLD-05 minimal AWS runtime, private buckets, DynamoDB, SQS, and DLQ retention.
3. LLD-01 website intake, upload, status, refinement, and download UX.
4. LLD-03 deterministic fake-provider generation and minimum verification.
5. End-to-end verification for one-photo, five-photo, refinement, failure, and artifact download flows.

## Deferred Features

- LLD-04 QA gate and packaging.
- PDF and multiple artifact formats.
- Rights/copyright workflow.
- SES, WAF, Cognito, accounts, and payments.
- Marketplace, POD, NFT, and publishing integrations.
- Complex observability and visual quality scoring.
