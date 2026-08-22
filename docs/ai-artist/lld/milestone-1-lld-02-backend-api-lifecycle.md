# AI Artist M1 LLD-02: Backend API, Request Lifecycle, Upload/Download Links, and Request Metadata Contracts

## Document Control

| Field | Value |
| --- | --- |
| LLD | LLD-02 |
| Product milestone | M1: `Memory Product Pack Agent` |
| Primary source | [M1 HLD](../hld/milestone-1-high-level-design.md) |
| Status | Reviewer reconfirmed signoff |
| Scope owner | Backend API, lifecycle, token model, upload/download contracts, `project.json`, and attempt metadata |

## Purpose

LLD-02 defines the backend contract that turns website intake into a durable request, private uploads, validated `project.json`, asynchronous generation attempts, request status, and final download-link issuance.

LLD-02 is the source of truth for request lifecycle and attempt metadata.

## In Scope

- Request creation.
- Request-link token creation and validation.
- Upload-slot creation and uploaded asset metadata.
- Submission validation.
- Rights status mapping.
- `project.json` creation.
- `attempt_id` creation.
- `generation_version` and `latest_eligible_attempt_id` tracking.
- `StartGenerationCommand`.
- Status API.
- Delivery-link API.
- Conditional lifecycle updates.

## Out Of Scope

- Website UX details.
- Generation provider implementation.
- QA gate implementation.
- ZIP packaging.
- AWS deployment topology beyond API/runtime needs.
- Customer accounts, payment, marketplace publishing, POD, NFT, or operator review.

## Lifecycle Authority

LLD-02 owns the durable request record.

Required states:

```text
draft
uploading
submitted
validating
needs_customer_input
blocked
generating
qa_checking
packaging
delivered
failed
archived
```

State transitions must be conditional and metadata-driven. The system must not infer lifecycle only from S3 object existence.

## Request Metadata

Recommended request record shape:

```json
{
  "request_id": "req_01J...",
  "project_id": "proj_01J...",
  "project_slug": "kyoto_memory",
  "product_niche": "travel_memory_cards",
  "lifecycle_state": "generating",
  "rights_status": "ready",
  "generation_version": 1,
  "latest_eligible_attempt_id": "att_01J...",
  "attempts": {
    "att_01J...": {
      "attempt_id": "att_01J...",
      "generation_version": 1,
      "attempt_status": "generating",
      "project_json_ref": {
        "bucket": "private-runtime-bucket",
        "key": "requests/req_01J/project/project_v1.json",
        "etag": "\"abc123\"",
        "sha256": "..."
      },
      "attempt_output_prefix": "requests/req_01J/generations/v1/attempts/att_01J/",
      "created_at": "2026-08-22T00:00:00Z"
    }
  },
  "request_token_hash": "hmac-or-hash",
  "created_at": "2026-08-22T00:00:00Z",
  "updated_at": "2026-08-22T00:00:00Z"
}
```

`attempt_id` is execution metadata. It must not be embedded in `project.json` as source truth.

## Request-Link Token Model

The request link is a bearer credential.

Link format:

```text
https://app.example.com/request/{request_id}#access_token={request_access_token}
```

API transport:

```http
Authorization: Bearer <request_access_token>
```

Rules:

- Store only token hash or HMAC.
- Do not accept request tokens in query strings, URL paths, cookies, or request bodies.
- Do not log raw tokens.
- `request_id` alone does not grant access.
- A valid token grants only status lookup and download-link refresh for that request.
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
    "accepted_media_types": ["image/jpeg", "image/png", "image/heic"],
    "max_bytes": 20971520
  }
}
```

Rules:

- The browser never chooses S3 object keys.
- Upload URLs are short-lived.
- Uploaded asset metadata is recorded before submission.
- Uploads must be private.
- Upload metadata must not include raw customer notes or unnecessary PII.

LLD-02/05 own source-upload layout. LLD-04 does not define source-upload paths.

## `project.json` Contract

LLD-02 owns `project.json`.

Normative shape:

```json
{
  "schema_version": "m1.project.v1",
  "request_id": "req_01J...",
  "project_id": "proj_01J...",
  "project_slug": "kyoto_memory",
  "product_niche": "travel_memory_cards",
  "generation_version": 1,
  "created_at": "2026-08-22T00:00:00Z",
  "style": {
    "style_id": "travel-memory-card",
    "style_label": "Travel Memory Card",
    "mood_keywords": ["warm", "handmade", "city-walk"]
  },
  "usage_intent": {
    "primary": "personal_gift",
    "secondary": ["social_share"]
  },
  "travel_notes": {
    "location_label": "Kyoto",
    "memory_notes": "short customer-provided notes",
    "date_or_season": "spring",
    "caption_text": "optional short caption"
  },
  "rights": {
    "status": "ready",
    "checklist_ref": {
      "bucket": "private-runtime-bucket",
      "key": "requests/req_01J/project/rights_checklist.json"
    },
    "flags": []
  },
  "source_assets": [
    {
      "asset_id": "asset_01",
      "kind": "photo",
      "bucket": "private-runtime-bucket",
      "key": "requests/req_01J/uploads/photo_01.jpg",
      "media_type": "image/jpeg",
      "sha256": "...",
      "width": 3024,
      "height": 4032
    }
  ],
  "artifact_target_profiles": {
    "travel_memory_cards_m1_default_v1": {
      "generation_version": 1,
      "targets": {
        "sticker_sheet_png": {
          "artifact_type": "sticker_sheet",
          "required": true,
          "audience": "customer",
          "format": "png",
          "expected_filename": "sticker_sheet.png",
          "package_path": "ai_artist_travel_memory_pack/sticker_sheet/sticker_sheet.png"
        }
      }
    }
  },
  "output_targets": [
    {
      "target": "sticker_sheet_png",
      "artifact_type": "sticker_sheet",
      "format": "png",
      "profile": "travel_memory_cards_m1_default_v1"
    }
  ]
}
```

Rules:

- `project.json` must not contain secrets.
- `attempt_id` is not embedded as project source truth.
- `artifact_target_profiles` is object-shaped metadata.
- `output_targets[*].profile` references a key in `artifact_target_profiles`.
- M1 production delivery must not rely on broad fallback target profiles.

## Attempt Creation

LLD-02 creates `attempt_id` after submission validation succeeds and rights state is `ready`.

Attempt creation must:

- Set `generation_version`.
- Set `latest_eligible_attempt_id`.
- Write immutable `project_json_ref`.
- Compute canonical `attempt_output_prefix`.
- Trigger LLD-03 with `StartGenerationCommand`.

## `StartGenerationCommand`

LLD-02 emits this command to LLD-03.

```json
{
  "command_version": "m1.start_generation.v1",
  "request_id": "req_01J...",
  "project_id": "proj_01J...",
  "generation_version": 1,
  "attempt_id": "att_01J...",
  "project_json_ref": {
    "bucket": "private-runtime-bucket",
    "key": "requests/req_01J/project/project_v1.json",
    "etag": "\"abc123\"",
    "sha256": "..."
  },
  "attempt_output_prefix": "requests/req_01J/generations/v1/attempts/att_01J/",
  "idempotency_key": "req_01J:generation_v1:attempt_att_01J:project_sha256_abcd",
  "requested_by": "backend_api",
  "created_at": "2026-08-22T00:00:00Z"
}
```

LLD-03 must carry `project_json_ref` unchanged into `GenerationCompleted`.

## Status API

Status responses must be customer-safe.

Allowed customer fields:

- Request state.
- Customer-safe reason code.
- Upload progress.
- Whether action is needed.
- Whether download is available.
- Final package name and file list when delivered.

Disallowed customer fields:

- Raw S3 keys.
- Internal artifact refs.
- Stack traces.
- Provider errors.
- Raw prompt text.
- Request token hash.
- Presigned URL internals.

## Download-Link API

When a request is `delivered`, LLD-02 creates a fresh short-lived download URL for:

```text
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/package/final_download_pack.zip
```

Rules:

- The request token must authorize only that request.
- Download URLs are short-lived.
- The API must verify delivery metadata points to the latest eligible delivered attempt.
- Do not issue customer download URLs for source photos or internal artifacts.

## Dependencies

LLD-02 depends on:

- LLD-01 for intake fields and customer-safe state display needs.
- LLD-03 for generation command consumption and completion/failure events.
- LLD-04 for delivery metadata, QA/package results, and final ZIP reference.
- LLD-05 for runtime storage prefix, IAM, retention, token logging constraints, and presigned URL posture.

LLD-02 provides:

- Request lifecycle authority.
- `project.json`.
- Attempt metadata.
- `latest_eligible_attempt_id`.
- Upload/download APIs.
- Token model.

## Acceptance Checks

- Request tokens are hash-only server side and never accepted in query/path/cookie/body.
- Upload slots use server-owned private keys and short TTLs.
- `project.json` uses `m1.project.v1`, object-shaped `artifact_target_profiles`, and `output_targets[*].profile`.
- `attempt_id` is not embedded in `project.json`.
- `StartGenerationCommand` includes `project_json_ref` and canonical attempt output prefix.
- Lifecycle transitions are conditional.
- Download links target only the delivered attempt's `package/final_download_pack.zip`.
- No accounts, payment, marketplace, POD, NFT, public gallery, or operator gate is introduced.

## Open Questions

- Final upload MIME types and byte limits.
- Exact support behavior for failed downloads.
- Whether optional email delivery is enabled for demo.
- Exact conditional update API exposed to workers.
