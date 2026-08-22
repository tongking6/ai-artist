# AI Artist M1 Low Level Designs

## Document Control

| Field | Value |
| --- | --- |
| Product milestone | M1: `Memory Product Pack Agent` |
| Primary source | [M1 HLD](../hld/milestone-1-high-level-design.md) |
| Status | Tech Lead signed off |
| Last review | Reviewer reconfirm completed |
| Scope | Implementation-ready LLD set for the website-triggered M1 artifact-generation loop |

## LLD Set

M1 is split into five LLDs.

| LLD | Title | Primary ownership | Reviewer reconfirm |
| --- | --- | --- | --- |
| [LLD-01](./milestone-1-lld-01-website-intake-status-delivery.md) | Website Intake, Status, and Delivery UX | Customer website flow and customer-safe copy | `SIGNOFF` |
| [LLD-02](./milestone-1-lld-02-backend-api-lifecycle.md) | Backend API, Request Lifecycle, Upload/Download Links, and Request Metadata Contracts | Request lifecycle, tokens, upload/download contracts, `project.json`, attempt metadata | `SIGNOFF` |
| [LLD-03](./milestone-1-lld-03-generation-worker.md) | Internal Generation API and Async Generation Worker | Generation command consumption, generated artifacts, `generation_manifest.json`, QA handoff | `SIGNOFF` |
| [LLD-04](./milestone-1-lld-04-qa-packaging-delivery.md) | Automated QA, Packaging, Manifest, and Delivery Flow | QA gates, package `manifest.json`, `quality_report.json`, final ZIP, delivery metadata | `SIGNOFF` |
| [LLD-05](./milestone-1-lld-05-runtime-security-ops.md) | AWS Runtime, Privacy/Security, Observability, Retention, and Demo Verification Fixtures | AWS runtime, canonical storage prefixes, security, observability, retention, demo fixtures | `SIGNOFF` |

## Cross-LLD Signoff Contracts

These contracts are mandatory for M1 implementation.

### Scope Boundary

M1 core includes:

- Website/API-triggered automated generation.
- 1 to 5 user-owned or user-permitted travel, city-walk, or lifestyle photos.
- `travel_memory_cards` as the only product niche.
- Generated customer artifacts:
  - `sticker_sheet.png`
  - `sticker_sheet.pdf`
  - `postcard.png`
  - `postcard.pdf`
  - `poster.png`
  - `poster.pdf`
  - `social_preview.png`
- Automated QA and packaging.
- Private delivery of `final_download_pack.zip`.

M1 core excludes:

- Payment, checkout, pricing tiers, subscriptions, or usage credits.
- Accounts, dashboards, public galleries, or broad SaaS platform features.
- Required operator review or manual production gate.
- Etsy, Shopify, POD, NFT, fulfillment, buyer messaging, or auto-publishing integrations.
- `listing_kit`, listing previews, buyer notes, marketplace copy, POD mockups, and NFT metadata.

### Identity And Freshness

| Field | Owner | Rule |
| --- | --- | --- |
| `request_id` | LLD-02 | Identifies the customer request. |
| `project_id` | LLD-02 | Identifies the generated project contract. |
| `generation_version` | LLD-02 | Identifies the customer-visible generation version and appears in storage paths. |
| `attempt_id` | LLD-02 | Opaque immutable generation attempt ID. LLD-03/04/05 consume it but do not create it. |
| `latest_eligible_attempt_id` | LLD-02/05 | Runtime freshness authority for QA, packaging, delivery, stale rejection, and observability. |
| `generation_job_id` | LLD-03 | Runtime worker execution ID only. It is not the packaging authority. |

LLD-04 must reject stale work unless:

```text
request.latest_eligible_attempt_id == event.attempt_id
request.generation_version == event.generation_version
```

### Canonical Runtime Prefix

LLD-05 owns the runtime S3 prefix contract.

```text
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/
```

Only these child directories are canonical for attempt artifacts:

```text
customer/
internal/
qa/
package/
```

Required canonical paths:

```text
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/customer/sticker_sheet.png
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/customer/sticker_sheet.pdf
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/customer/postcard.png
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/customer/postcard.pdf
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/customer/poster.png
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/customer/poster.pdf
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/customer/social_preview.png
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/internal/generation_manifest.json
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/qa/quality_report.json
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/package/manifest.json
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/package/final_download_pack.zip
```

The following layouts are not accepted for M1:

```text
requests/{request_id}/generated/attempt-{attempt_id}/...
requests/{request_id}/qa/attempt-{attempt_id}/...
requests/{request_id}/deliverables/attempt-{attempt_id}/...
```

### Artifact Ownership

| Artifact | Owner | Customer-visible |
| --- | --- | --- |
| `project.json` | LLD-02 | No |
| `rights_checklist.json` | LLD-02 | No |
| `generation_manifest.json` | LLD-03 | No |
| `prompt_log.json` | LLD-03 | No |
| `generation_notes.md` | LLD-03 | No |
| `style_recipe.json` | LLD-03 | No |
| `layout_plan.json` | LLD-03 | No |
| `quality_report.json` | LLD-04 | No |
| `manifest.json` | LLD-04 | No |
| `final_download_pack.zip` | LLD-04, exposed by LLD-02 download link | Yes |

### ZIP Contract

`final_download_pack.zip` must contain exactly:

```text
ai_artist_travel_memory_pack/sticker_sheet/sticker_sheet.png
ai_artist_travel_memory_pack/sticker_sheet/sticker_sheet.pdf
ai_artist_travel_memory_pack/postcard/postcard.png
ai_artist_travel_memory_pack/postcard/postcard.pdf
ai_artist_travel_memory_pack/poster/poster.png
ai_artist_travel_memory_pack/poster/poster.pdf
ai_artist_travel_memory_pack/previews/social_preview.png
```

The ZIP must not contain:

- Source photos.
- `generation_manifest.json`.
- `manifest.json`.
- `quality_report.json`.
- `rights_checklist.json`.
- Prompt logs.
- Generation notes.
- Listing, marketplace, POD, NFT, or buyer-note artifacts.

### Request-Link Security

M1 uses bearer request links without accounts.

Required transport:

```text
https://app.example.com/request/{request_id}#access_token={token}
```

The browser sends API calls with:

```http
Authorization: Bearer <request_access_token>
```

Prohibited token transport:

- Query string.
- URL path.
- Cookies.
- `localStorage`.
- Analytics events.
- Logs.

LLD-02 stores only a token hash or HMAC. LLD-01 displays only customer-safe status and download actions. LLD-05 requires redaction in API Gateway, Lambda, CloudFront, and operational logs.

## Implementation Order

Recommended implementation sequence:

1. LLD-02 request lifecycle, token model, upload slots, `project.json`, and attempt metadata.
2. LLD-05 minimal AWS runtime, private buckets, DynamoDB table, runtime config, and fake/demo mode.
3. LLD-01 website intake, upload, status, and delivery UX wired to LLD-02 contracts.
4. LLD-03 deterministic fake-provider generation worker.
5. LLD-04 automated QA/package worker and `final_download_pack.zip`.
6. End-to-end demo fixture verification across delivered, failed, blocked, needs-input, stale-attempt, and incompatible-prefix cases.

## Reviewer Reconfirm Summary

All reviewer reconfirm checks completed with `SIGNOFF`.

Notable issue closed during reconfirm:

- LLD-03 now requires `GenerationCompleted.project_json_ref` to carry the unchanged LLD-02 `StartGenerationCommand.project_json_ref`, allowing LLD-04 to compare it against active request metadata before QA/packaging.
