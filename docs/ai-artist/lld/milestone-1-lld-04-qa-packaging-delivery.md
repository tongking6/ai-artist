# AI Artist M1 LLD-04: Automated QA, Packaging, Manifest, and Delivery Flow

## Document Control

| Field | Value |
| --- | --- |
| LLD | LLD-04 |
| Product milestone | M1: `Memory Product Pack Agent` |
| Primary source | [M1 HLD](../hld/milestone-1-high-level-design.md) |
| Status | Reviewer reconfirmed signoff |
| Scope owner | Automated QA, package manifest, quality report, final ZIP packaging, and delivery metadata |

## Purpose

LLD-04 defines the automated post-generation flow. It validates generated M1 artifacts, writes QA/package metadata, creates `final_download_pack.zip`, and hands delivery metadata to LLD-02.

LLD-04 starts only from LLD-03 `GenerationCompleted`. It does not own or validate any generation-start command.

## In Scope

- Automated QA after generation.
- Stale-attempt and stale-generation-version rejection.
- Target-profile validation.
- `quality_report.json`.
- Canonical package `manifest.json`.
- `final_download_pack.zip`.
- Delivery metadata for the backend.
- Warning/block/fatal gate semantics.
- M1 contract violation handling.

## Out Of Scope

- Generation start command or event.
- Source-upload layout.
- Generation provider implementation.
- Website UX.
- Download-link issuance.
- Manual operator QA.
- Payment, accounts, marketplace publishing, listing kit, POD, NFT, public gallery, or buyer messaging.

## Entry Event

LLD-04 consumes LLD-03 `GenerationCompleted`.

```json
{
  "event_type": "GenerationCompleted",
  "request_id": "req_...",
  "project_id": "proj_...",
  "generation_version": 1,
  "attempt_id": "att_...",
  "project_json_ref": {
    "bucket": "private-runtime-bucket",
    "key": "<LLD-02-owned project json key>",
    "etag": "...",
    "sha256": "..."
  },
  "generation_manifest_ref": {
    "bucket": "private-runtime-bucket",
    "key": "requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/internal/generation_manifest.json",
    "etag": "...",
    "sha256": "..."
  },
  "generated_at": "2026-08-22T00:00:00Z"
}
```

LLD-04 must not consume or validate `StartGenerationCommand`.

## Freshness Authority

LLD-04 uses `latest_eligible_attempt_id` as the normative QA, package, and delivery freshness authority.

Reject unless:

```text
request.latest_eligible_attempt_id == event.attempt_id
request.generation_version == event.generation_version
```

Lifecycle, package, and delivery updates must also condition on:

```text
latest_eligible_attempt_id == attempt_id
```

## Required Lifecycle

Happy path:

```text
generating -> qa_checking -> packaging -> delivered
```

LLD-04 must not skip `packaging`.

Failure outcomes:

| Condition | State |
| --- | --- |
| Customer can fix input | `needs_customer_input` |
| Rights or scope guardrail blocks request | `blocked` |
| Generation, QA, packaging, storage, target-profile, or contract failure | `failed` |

## Canonical Paths

LLD-04 uses LLD-05 attempt-scoped paths.

```text
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/qa/quality_report.json
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/package/manifest.json
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/package/final_download_pack.zip
```

LLD-04 consumes:

```text
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/customer/
requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/internal/generation_manifest.json
```

Source upload paths are owned by LLD-02/LLD-05. LLD-04 does not specify source-upload layout and only ensures source photos are never packaged or exposed through delivery.

## Target Profile Contract

LLD-04 consumes target profiles from LLD-02 `project.json`.

Normative shape:

```json
{
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

- `artifact_target_profiles` is object-shaped.
- `output_targets[*].profile` references a profile key.
- Missing profiles block delivery.
- Hardcoded dimensions are illustrative unless present in the active profile.
- Demo-only profiles must be explicitly marked as demo fixtures and must not be production fallback.

## QA Pipeline

### Stage 1: Event And Attempt Validation

Checks:

- Request exists.
- Event `attempt_id` matches `latest_eligible_attempt_id`.
- Event `generation_version` matches request `generation_version`.
- Request lifecycle permits QA.
- Rights status is `ready`.
- `GenerationCompleted.project_json_ref` exactly matches active LLD-02 request metadata.
- `generation_manifest_ref` belongs to the same request, generation version, and attempt.

### Stage 2: Generation Manifest Intake

LLD-04 reads LLD-03 `generation_manifest.json`.

Checks:

- Manifest is present and readable.
- Manifest `request_id`, `generation_version`, and `attempt_id` match the event.
- Manifest `project_json_ref` matches event `project_json_ref`.
- Artifact refs use canonical attempt prefix.
- Required customer artifacts are listed.
- No disallowed M1 artifacts are present.

### Stage 3: Artifact Validation

For each required customer artifact:

- Object exists under `customer/`.
- `attempt_id == latest_eligible_attempt_id`.
- File is non-empty.
- Format and MIME type match target profile.
- File can be opened.
- Checksum matches manifest or calculated checksum.
- Dimensions or PDF page metadata can be read.
- File name and package path are safe.

### Stage 4: Visual And Readability Heuristics

Automated checks should be conservative:

- Blank or nearly blank image detection.
- Low contrast detection.
- Text readability check when required by profile.
- Watermark/signature detection.
- Severe cropping or visual corruption.
- Duplicate artifact detection.

### Stage 5: Report And Package Manifest

Before packaging, LLD-04 writes:

```text
qa/quality_report.json
package/manifest.json
```

The package manifest includes only QA-approved M1 customer artifacts as package candidates.

### Stage 6: Packaging

Create and verify:

```text
package/final_download_pack.zip
```

Then conditionally transition:

```text
packaging -> delivered
```

## Package Manifest

LLD-04 owns package `manifest.json`.

Required fields include:

- `request_id`
- `attempt_id`
- `latest_eligible_attempt_id`
- `generation_version`
- `project_json_ref`
- `generation_manifest_ref`
- approved customer artifacts
- final ZIP reference
- `quality_report_ref`
- checksums and sizes

The manifest must not include secrets, presigned URLs, raw customer email, source photo binary data, prompt content, listing artifacts, or internal artifacts as package entries.

## Quality Report

LLD-04 owns `quality_report.json`.

Required fields include:

- `request_id`
- `attempt_id`
- `latest_eligible_attempt_id`
- `generation_version`
- overall result
- delivery eligibility
- target profile resolution
- gate summary
- artifact results
- customer-safe reason code where applicable

Allowed results:

```text
pass
pass_with_warnings
needs_customer_input
blocked
failed
```

## ZIP Structure

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

The ZIP must exclude:

- Source photos.
- `generation_manifest.json`.
- `manifest.json`.
- `quality_report.json`.
- `rights_checklist.json`.
- Prompt logs.
- Generation notes.
- Listing, marketplace, POD, NFT, buyer-note artifacts.

## Delivery Metadata

After successful packaging:

```json
{
  "request_id": "req_...",
  "latest_eligible_attempt_id": "att_...",
  "attempt_id": "att_...",
  "generation_version": 1,
  "package": {
    "package_name": "final_download_pack.zip",
    "s3_ref": {
      "bucket": "private-runtime-bucket",
      "key": "requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/package/final_download_pack.zip",
      "etag": "...",
      "sha256": "..."
    },
    "size_bytes": 1234567
  },
  "manifest_ref": {
    "bucket": "private-runtime-bucket",
    "key": "requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/package/manifest.json",
    "etag": "...",
    "sha256": "..."
  },
  "quality_report_ref": {
    "bucket": "private-runtime-bucket",
    "key": "requests/{request_id}/generations/v{generation_version}/attempts/{attempt_id}/qa/quality_report.json",
    "etag": "...",
    "sha256": "..."
  }
}
```

LLD-04 stores package metadata, not public URLs. LLD-02 issues short-lived download links.

## Dependencies

LLD-04 depends on:

- LLD-02 for request metadata, `latest_eligible_attempt_id`, `generation_version`, `project_json_ref`, target profiles, lifecycle update authority, and download API.
- LLD-03 for `GenerationCompleted`, unchanged `project_json_ref`, `generation_manifest_ref`, and generated artifact refs.
- LLD-05 for canonical prefix, private storage, retention, observability, and signed URL posture.

LLD-04 provides:

- QA decision.
- `quality_report.json`.
- Package `manifest.json`.
- Final ZIP.
- Delivery metadata.
- Stale-attempt and stale-generation-version rejection behavior.

## Acceptance Checks

- LLD-04 starts only from `GenerationCompleted`.
- LLD-04 does not define source-upload layout.
- LLD-04 uses `latest_eligible_attempt_id` for freshness.
- `GenerationCompleted.project_json_ref` is compared to active request metadata.
- Target profiles are object-shaped and referenced by `output_targets[*].profile`.
- LLD-03 owns `generation_manifest.json`.
- LLD-04 owns `quality_report.json`, package `manifest.json`, and `final_download_pack.zip`.
- The ZIP contains exactly the seven M1 customer files.
- Source/internal/listing/POD/NFT artifacts are never packaged.
- Stale attempts do not update lifecycle or delivery metadata.
- No operator gate, payment, marketplace, accounts, POD, NFT, or public gallery is introduced.

## Open Questions

- Final target profile keys and dimensions.
- OCR/readability implementation tool.
- PDF parser/renderer.
- Final ZIP hard max.
- Whether warning-only QA summaries are ever shown to customers.
