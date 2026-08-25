# AI Artist M1 Low-Level Designs

## Document Control

| Field | Value |
| --- | --- |
| Product milestone | M1: Memory Product Pack Agent |
| Primary source | [M1 HLD](../hld/milestone-1-high-level-design.md) |
| Status | Implementation-ready; active M1 LLD contracts finalized |
| Scope | Website Task intake, postcard generation, minimum runtime, and private artifact download |

## Active LLD Set

| LLD | Title | Status |
| --- | --- | --- |
| [LLD-00](./milestone-1-lld-00-implementation-foundation.md) | Implementation Foundation | Implementation-ready |
| [LLD-01](./milestone-1-lld-01-website-intake-status-delivery.md) | Website Task Intake, Status, Refinement, and Delivery UX | Implementation-ready; UX and access contracts finalized |
| [LLD-02](./milestone-1-lld-02-backend-api-lifecycle.md) | Backend API, Task Data Model, Attempts, Upload/Download Links | Implementation-ready; schema and API finalized |
| [LLD-03](./milestone-1-lld-03-generation-worker.md) | Postcard Generation Worker and Minimum Verification | Implementation-ready; provider and prompt contracts finalized |
| [LLD-05](./milestone-1-lld-05-runtime-security-ops.md) | Home Kubernetes Runtime, Storage, Security, and Attempt Queue | Implementation-ready; home deployment profile finalized |

[LLD-04](./milestone-1-lld-04-qa-packaging-delivery.md) is deferred and is not part of the M1 execution path.

## Current M1 Model

M1 contains:

- `Task`: immutable base input with 1 to 5 photos, title, note, style, and Task status.
- `Attempt`: one generation execution with a complete input snapshot and Attempt status; the refinement note is null for Attempt 1 and required later.
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

LLD-02 writes the immutable PostgreSQL `attempts.input_snapshot` JSONB value.

The snapshot contains:

- `photo_asset_ids`
- `title`
- `note`
- `style`
- `prompt_recipe_version`
- `refinement_note`

LLD-03 reads this immutable row value and does not mutate it.

### Storage

LLD-05 owns:

```text
tasks/{task_id}/
  uploads/{asset_id}.{normalized_ext}
  attempts/{attempt_id}/
    postcard.png
```

### Generation

- LLD-02 creates a queued Attempt and atomically updates `tasks.current_attempt_id`; PostgreSQL contains exactly four application tables.
- Initial generation and later refinement both use `POST /v1/tasks/{task_id}/attempts`; only the request body and existing Attempt history distinguish them.
- LLD-03 claims the oldest queued Attempt directly with lease fencing.
- LLD-03 directly updates Attempt status.
- LLD-03 generates exactly one `1800x1200` PNG.
- LLD-03 performs minimum verification before setting `ready`.
- LLD-03 makes at most one OpenAI Image API call per Attempt using `gpt-image-2-2026-04-21`; the fake provider remains available for deterministic tests.
- LLD-03 uses the versioned `m1.postcard_prompt.v1` recipe: source-photo order has no product meaning; recognizable identity and major scene anchors are preserved; scene-aware creative recomposition is allowed; customer text is visual guidance and is not rendered into the image; refinement guidance supplements the base recipe.
- The OpenAI adapter requests a `1808x1200` PNG and the Worker deterministically center-crops it to the fixed `1800x1200` artifact contract.
- A claimed Attempt is never automatically retried or returned to `queued` in M1.
- LLD-04 is not required.

### Customer Access

Phase 1 canonical Task link:

```text
https://tongjin-server.tail910d5f.ts.net/tasks/{task_id}
```

Phase 1 has no application-layer login or Task token. Approved Tailscale tailnet membership and policy are the access boundary; home and remote clients use the same URL. Tailscale Funnel is disabled. Authentication and authorization must be designed before public or AWS-facing exposure.

M1 upload limits are `image/jpeg` or `image/png`, up to 20 MB per photo and 5 photos per Task.

The user adds photos one at a time or in batches. Each upload-slots request reserves slots for newly selected files; the user never needs to declare the final photo count in advance. A separate complete-intake action changes the Task from `uploading` to `ready` and freezes the base inputs.

Customer download is a fresh short-lived URL for a ready postcard Artifact only.

## Implementation Order

1. LLD-00 Next.js/React/TypeScript frontend and Python backend foundation.
2. LLD-02 Task/Asset/Attempt persistence and customer API.
3. LLD-05 single-node home K3s runtime, Tailscale access, PostgreSQL, private S3-compatible storage, and single-delivery Attempt claiming.
4. LLD-01 website intake, upload, status, refinement, and download UX.
5. LLD-03 OpenAI generation, deterministic fake-provider tests, normalization, and minimum verification.
6. End-to-end verification for one-photo, five-photo, refinement, terminal failure, and artifact download flows.

## Deferred Features

- LLD-04 QA gate and packaging.
- PDF and multiple artifact formats.
- Rights/copyright workflow.
- Public Internet ingress, public DNS, HA, accounts, and payments.
- Marketplace, POD, NFT, and publishing integrations.
- Complex observability and visual quality scoring.
- AWS deployment remains a possible later runtime target, but it is not part of Phase 1.
