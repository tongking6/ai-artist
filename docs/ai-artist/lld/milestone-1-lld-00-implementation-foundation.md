# AI Artist M1 LLD-00: Implementation Foundation

## Document Control

| Field | Value |
| --- | --- |
| LLD | LLD-00 |
| Product milestone | M1: `Memory Postcard Studio` |
| Primary source | [M1 HLD](../hld/milestone-1-high-level-design.md) |
| Status | Foundation implemented; OpenAI provider adapter pending |
| Scope owner | Repository layout, application stack, process boundaries, and baseline verification |

## Purpose

LLD-00 fixes the implementation foundation shared by the active M1 LLDs. It does not add product scope or replace the field-level contracts owned by LLD-01, LLD-02, LLD-03, and LLD-05.

## Fixed Technology Decisions

| Surface | M1 decision |
| --- | --- |
| Website | Next.js App Router, React, and TypeScript |
| Backend language | Python |
| Customer API | FastAPI with Pydantic request/response models |
| Generation Worker | Python process using the same backend package and domain models as the API |
| Persistence | PostgreSQL through SQLAlchemy 2; Alembic owns schema migrations |
| Object storage | S3-compatible adapter using `boto3`; MinIO is the Phase 1 runtime |
| AI provider client | Current: deterministic fake provider; target: official OpenAI Python SDK with `max_retries=0` behind `GenerationProvider` |
| Image decoding and normalization | Pillow |
| Frontend tests | Vitest and React Testing Library |
| Backend tests | pytest |
| End-to-end tests | Playwright against the fake provider |
| Packaging | One frontend container image and one backend container image; API and Worker use different commands from the backend image |

Dependency versions are pinned by the implementation lockfiles when the scaffold is created. This design fixes the frameworks and boundaries, not floating version numbers.

## Repository Shape

```text
ui/                            # Existing Next.js + React + TypeScript application
services/
  backend/
    pyproject.toml
    src/ai_artist/
      api/                     # FastAPI routes and customer API schemas
      domain/                  # Task, Asset, Attempt, Artifact, queue rules
      worker/                  # Queued-Attempt consumer
      adapters/
        database/              # SQLAlchemy repositories
        object_store/          # S3-compatible ObjectStore
        generation/            # OpenAI and deterministic fake providers
    migrations/                # Alembic migrations
infra/
  kubernetes/
    base/                      # Shared application and data-service manifests
    overlays/
      home/                    # Native K3s and Tailscale-facing profile
tests/
  e2e/                         # Browser workflow against the fake provider
```

The scaffold may add framework-generated support files, but it must preserve these ownership boundaries. Shared Task/Attempt models live in the backend domain package rather than being duplicated between the API and Worker.

The existing `ui/` directory remains the Website source root. Implementation must not create a competing `apps/web/` copy or move the verified Website solely to satisfy an older proposed repository shape.

### Integration Environment

Integration testing runs on the approved Linux server's native single-node K3s cluster. The first deployment uses `AI_ARTIST_GENERATION_PROVIDER=fake` and the real Website, API, PostgreSQL, MinIO, and Worker path before any OpenAI credential is introduced. macOS remains a unit, component, and mocked-browser test environment only.

## Process Boundaries

### Website

- Next.js renders the tailnet-only customer experience defined by LLD-01.
- Browser code calls the FastAPI customer API and uploads/downloads through backend-issued short-lived object-store instructions.
- The frontend receives no database, object-store, or OpenAI credentials.
- M1 does not require Next.js server actions or a second application API layer; FastAPI is the customer API authority.

### Backend API

- FastAPI owns the LLD-02 routes and OpenAPI schema.
- Pydantic models implement request and response validation at the HTTP boundary.
- SQLAlchemy repositories hide PostgreSQL details from domain logic.
- Attempt creation and `tasks.current_attempt_id` update share one database transaction.
- The API process never calls the image-generation provider.

### Generation Worker

- The Worker imports the same Python domain and adapter interfaces as the API.
- It claims the PostgreSQL Attempt defined by LLD-02/05, calls the configured LLD-03 provider, normalizes and verifies the image through Pillow, and finalizes the Attempt.
- The current fake-provider runtime receives no provider credential. A future `OPENAI_API_KEY` may be supplied only to the Worker after the OpenAI adapter is implemented.
- API and Worker use the same backend image but separate Kubernetes Deployments and entry commands.

## Contract Ownership

| Contract | Owning document |
| --- | --- |
| Screens and upload/status/download UX | LLD-01 |
| HTTP payloads, Task/Asset/Attempt/Artifact models | LLD-02 |
| OpenAI request, output normalization, and minimum verification | LLD-03 |
| K3s, PostgreSQL Attempt queue, MinIO, Secrets, Tailscale boundary | LLD-05 |

FastAPI's generated OpenAPI document may be used to generate or validate TypeScript client types. It must not become a competing hand-written contract.

## Baseline Verification

Implementation is not foundation-complete until:

- The Next.js application passes TypeScript checking, linting, and component tests.
- The Python package passes linting/type checks selected by the scaffold and `pytest`.
- Alembic can migrate an empty PostgreSQL database to the current schema.
- API and Worker containers build from a clean checkout.
- The fake-provider Playwright flow against the Linux server covers create Task -> upload -> complete intake -> create Attempt -> ready -> download.
- Kubernetes manifests render or validate without embedding Secret values.

## Deferred Decisions

- Public hosting, CDN, public DNS, and AWS services.
- Multi-node Kubernetes and HA.
- Anthropic or other generation adapters.
- A separate frontend backend-for-frontend layer.
- A broad shared package or agent framework.

These deferred choices must not block the Phase 1 scaffold.

## Acceptance Checks

- Frontend implementation uses Next.js, React, and TypeScript.
- Backend API and Generation Worker use Python.
- FastAPI is the sole customer API layer.
- API and Worker share domain models but run as separate processes.
- Provider-specific code remains under a small adapter boundary.
- The Website and Backend API receive no OpenAI API key.
- No AWS SDK type, ARN, or managed-service assumption enters a domain or customer API contract.
