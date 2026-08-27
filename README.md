# AI Artist

AI Artist is a private, AI-assisted creative studio for turning user-owned photos and memories into finished visual keepsakes.

The current Milestone 1 is a narrow `Memory Postcard Studio`: a user adds 1 to 5 JPEG or PNG photos, a title, a creative note, and the fixed `warm_handmade` style. Each successful generation Attempt produces one downloadable `1800x1200` PNG postcard.

Repository: https://github.com/tongking6/ai-artist

## Current Implementation

The repository contains one end-to-end M1 foundation:

- `ui/`: Next.js, React, and TypeScript customer website with local demo mode.
- `services/backend/`: FastAPI customer API, PostgreSQL lifecycle, MinIO/S3-compatible storage adapter, and Generation Worker.
- `infra/kubernetes/`: single-node home K3s manifests.
- `scripts/linux-k3s.sh`: image build/import, deployment, runtime checks, and Tailscale Serve setup.
- `.github/workflows/ci.yml`: frontend, backend, PostgreSQL lifecycle, and browser verification.

The runnable server path currently uses the deterministic `fake` generation provider. It exercises Browser -> API -> PostgreSQL/MinIO -> Worker -> Artifact -> download without an external AI credential. The OpenAI Image API contract is designed in LLD-03, but its production adapter is not implemented yet; do not configure `AI_ARTIST_GENERATION_PROVIDER=openai` in the current codebase.

Repository code and green CI are not proof that the home server is deployed. Use the deployment and live smoke checks in [SETUP.md](./SETUP.md) before making runtime claims.

## M1 Product Boundary

In scope:

- Private access from approved Tailscale devices.
- Create and list postcard Tasks.
- Upload 1 to 5 user-owned JPEG or PNG photos.
- Save title, note, and the fixed `warm_handmade` style.
- Create immutable Attempts, inspect status/history, refine, and download any ready version.
- Produce one fixed `1800x1200` PNG per successful Attempt.

Not in the active M1 implementation:

- Product packs, sticker sheets, posters, PDFs, ZIP packaging, or listing kits.
- Rights workflow, automated visual QA, or operator review.
- Accounts, payments, pricing, public galleries, or public Internet access.
- Etsy, Shopify, POD, NFT, publishing, fulfillment, or buyer messaging.
- The production OpenAI adapter, high availability, or AWS deployment.

These remain possible future product directions. The older [Memory Product Pack PRFAQ](./docs/ai-artist/prfaq/milestone-1-scope.md) is retained as historical product exploration, not as the current implementation or launch promise.

## Runtime Boundary

Phase 1 targets one home Linux server running a single-node K3s cluster:

- Tailscale Serve HTTPS proxies to loopback-only K3s Traefik `NodePort 30080`.
- Tailscale Funnel, router port forwarding, public tunnels, and direct non-tailnet LAN ingress are prohibited.
- The Website, `/v1` API, and path-style presigned upload/download URLs share one canonical tailnet hostname.
- PostgreSQL stores Task, Asset, Attempt, and Artifact metadata.
- MinIO stores private source photos and postcard artifacts.
- There is no application login or Task token; the trusted household tailnet is the Phase 1 access boundary.

Authentication and authorization are required before any future public or non-tailnet exposure.

## Repository Layout

```text
ui/                            # Next.js customer website and browser tests
services/backend/              # FastAPI API, Worker, migrations, and Python tests
infra/kubernetes/base/         # Shared Kubernetes resources
infra/kubernetes/overlays/home # Home K3s storage and ingress profile
scripts/linux-k3s.sh           # Linux deployment and diagnostic workflow
docs/ai-artist/hld/             # Active high-level design
docs/ai-artist/lld/             # Active implementation contracts
docs/ai-artist/prfaq/           # Historical product exploration
```

## Start Locally

The UI can run without FastAPI by using its in-browser demo adapter:

```bash
cd ui
npm ci
npm run dev
```

Open `http://localhost:3000`. Demo mode stores synthetic project metadata only in browser storage and never calls an image provider.

Run the frontend checks with:

```bash
cd ui
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Backend and home K3s instructions are in [SETUP.md](./SETUP.md). The native K3s integration path runs on the approved Linux server rather than macOS.

## Design Authority

- [Milestone 1 HLD](./docs/ai-artist/hld/milestone-1-high-level-design.md): current product, system, security, and runtime boundaries.
- [Milestone 1 LLD index](./docs/ai-artist/lld/README.md): active implementation contracts and ownership.
- [LLD-00](./docs/ai-artist/lld/milestone-1-lld-00-implementation-foundation.md): repository shape, technology choices, and verification baseline.
- [LLD-01](./docs/ai-artist/lld/milestone-1-lld-01-website-intake-status-delivery.md): customer UI behavior.
- [LLD-02](./docs/ai-artist/lld/milestone-1-lld-02-backend-api-lifecycle.md): database and API lifecycle.
- [LLD-03](./docs/ai-artist/lld/milestone-1-lld-03-generation-worker.md): target generation-provider contract and implemented fake-provider verification path.
- [LLD-05](./docs/ai-artist/lld/milestone-1-lld-05-runtime-security-ops.md): home K3s, Tailscale, storage, secrets, and operations.

Field-level contracts in the reconciled LLDs take precedence over the historical PRFAQ and earlier product-pack language.

## Safety

- Use only user-owned, user-created, licensed, or approved fixture photos.
- Do not commit private photos, generated commercial outputs, credentials, presigned URLs, or Kubernetes Secret values.
- Source photos and creative guidance may leave the home network after a future external provider adapter is enabled.
- Keep original photos outside AI Artist and back up PostgreSQL and object storage before relying on the system for irreplaceable household photos.
- Marketplace, POD, publishing, buyer communication, and NFT actions require explicit user approval and current policy review.
