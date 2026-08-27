# Setup And Project Settings

This document records settings that are implemented by the current AI Artist M1 codebase. Future provider and product ideas are labeled separately and must not be treated as runnable configuration.

## Current Runtime Status

The implemented server path is a deterministic fake-provider vertical slice:

```text
Browser -> FastAPI -> PostgreSQL/MinIO -> Generation Worker -> postcard.png
```

It exercises the real Task, Asset, Attempt, Artifact, upload, generation, and download lifecycle without sending photos to an external AI provider.

The OpenAI Image API contract is designed in LLD-03, but the production adapter and OpenAI SDK dependency are not implemented. The current code accepts only:

```bash
AI_ARTIST_GENERATION_PROVIDER=fake
```

Do not configure `openai` or create `OPENAI_API_KEY` until the adapter, tests, workload Secret boundary, and owned-fixture readiness check are implemented.

## Phase 1 Access Boundary

Phase 1 targets a home Linux server with a single-node K3s cluster.

- Access is limited to approved devices in the owner's Tailscale tailnet; home devices use the same canonical tailnet URL.
- Use `https://tongjin-server.tail910d5f.ts.net` through persistent Tailscale Serve; never enable Tailscale Funnel.
- Do not configure router port forwarding, UPnP exposure, public DNS, a public tunnel, or an Internet-facing load balancer.
- K3s ServiceLB is disabled; bundled Traefik is reachable only through loopback `NodePort 30080`, behind Tailscale Serve.
- High availability and automatic failover are not required.
- Phase 1 has no application login or Task token; approved tailnet access is the application boundary.
- Keep original photos outside AI Artist and back up PostgreSQL and private object storage before relying on the system for irreplaceable household photos.

AWS remains a possible later deployment target. Current application contracts must not depend on AWS SDK types or AWS resource identifiers.

## Local UI Demo

Use Node.js 20.9 or newer:

```bash
cd ui
npm ci
npm run dev
```

The committed `ui/public/app-config.js` enables browser-local demo mode. It stores synthetic project metadata in browser storage, simulates upload/generation, and never calls FastAPI or an image provider.

Run frontend verification with:

```bash
cd ui
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run test:e2e` builds and starts the production Next.js server on `127.0.0.1:3100`, then runs the mocked desktop/mobile workflow.

## Linux K3s Environment

Integration testing and Phase 1 deployment run directly on the approved home Linux server. macOS remains suitable for UI and unit tests, but it is not a Kubernetes integration environment.

The server must have Docker, native K3s, `openssl`, `curl`, `findmnt`, `git`, and `sudo`. The 1 TB SSD must be mounted at `/data`. Configure K3s before deployment:

```yaml
# /etc/rancher/k3s/config.yaml
disable:
  - servicelb
kube-proxy-arg:
  - nodeport-addresses=127.0.0.0/8
default-local-storage-path: /data/ai-artist/k3s-storage
```

Restart K3s after changing the host-owned file, then deploy from a clean named Git commit on the Linux server:

```bash
./scripts/linux-k3s.sh deploy
```

The command:

- derives immutable Website and Backend image tags from the 12-character commit SHA;
- builds the images and imports them into native K3s containerd;
- creates random PostgreSQL/MinIO credentials only when the Kubernetes Secret is absent;
- applies the `home` overlay and waits for every workload;
- verifies PVC placement, running image tags, and the loopback ingress;
- never writes credential values to the repository.

The `ai-artist-local-path` StorageClass pins both application PVCs to `/data/ai-artist/k3s-storage`. Each provisioned directory includes the PV name. With reclaim policy `Retain`, recreating a same-named PVC creates a new directory; recovery requires explicitly rebinding the retained PV. The deployment refuses to delete or silently reuse legacy PVC data.

After the loopback smoke check passes, explicitly enable persistent tailnet-only HTTPS:

```bash
./scripts/linux-k3s.sh configure-serve
```

This proxies Tailscale Serve to `http://127.0.0.1:30080` in background mode without enabling Funnel. Use `status`, `logs`, and `smoke` for diagnostics.

## Implemented Server Configuration

The committed K3s ConfigMap supplies non-secret settings equivalent to:

```bash
AI_ARTIST_STAGE=home
AI_ARTIST_OBJECT_ENDPOINT=http://minio:9000
AI_ARTIST_OBJECT_PRESIGN_ENDPOINT=https://tongjin-server.tail910d5f.ts.net
AI_ARTIST_OBJECT_ADDRESSING_STYLE=path
AI_ARTIST_PRIVATE_BUCKET=ai-artist-private
AI_ARTIST_UPLOAD_URL_TTL_SECONDS=900
AI_ARTIST_DOWNLOAD_URL_TTL_SECONDS=900
AI_ARTIST_ATTEMPT_LEASE_SECONDS=600
AI_ARTIST_ATTEMPT_RECONCILE_INTERVAL_SECONDS=60
AI_ARTIST_GENERATION_PROVIDER=fake
AI_ARTIST_WORKER_POLL_SECONDS=1
AI_ARTIST_LOG_LEVEL=INFO
```

The cluster Secret supplies `AI_ARTIST_DATABASE_URL`, `AI_ARTIST_OBJECT_ACCESS_KEY`, and `AI_ARTIST_OBJECT_SECRET_KEY` to the workloads that need them. Never commit real `.env` files, database credentials, object-store credentials, presigned URLs, or Secret manifests containing values.

The Website receives a browser-safe runtime file mounted from `ai-artist-ui-runtime`:

```js
window.__AI_ARTIST_CONFIG__ = Object.freeze({
  stage: "home",
  apiBaseUrl: "",
  assetBaseUrl: "",
  maxPhotos: 5,
  demoMode: false,
});
```

Empty base URLs use the canonical current origin. Do not place credentials or internal service addresses in browser config.

## Application Foundation

- Website: Next.js App Router, React, and TypeScript.
- Backend API: Python with FastAPI and Pydantic.
- Generation Worker: Python, sharing the backend domain package while running as a separate process.
- Persistence: PostgreSQL with SQLAlchemy 2 and Alembic.
- Object storage: S3-compatible adapter with MinIO in Phase 1.
- Implemented generation provider: deterministic `fake-v1`.
- Image normalization: Pillow, from `1808x1200` provider-format PNG to `1800x1200` artifact PNG.

Both initial generation and refinement use `POST /v1/tasks/{task_id}/attempts`. M1 never automatically retries or requeues a claimed Attempt.

## M1 Product Settings

- Input: 1 to 5 user-owned JPEG or PNG photos.
- Metadata: title, creative note, and fixed style `warm_handmade`.
- Output: one `1800x1200` `postcard.png` for each successful Attempt.
- Access: private household tailnet only.
- Publishing: local download only; no automatic external actions.

## Planned Provider Contract

LLD-03 defines a future OpenAI adapter that will use the official Python SDK, one provider call per Attempt, `max_retries=0`, an 8-minute timeout, and server-side credentials available only to the Generation Worker. Those are target contracts, not current setup steps.

Before enabling that adapter:

1. Add the provider dependency and implementation behind `GenerationProvider`.
2. Add unit tests for request construction, zero retries, response normalization, failures, and late-response fencing.
3. Add `OPENAI_API_KEY` only to the Generation Worker Secret boundary.
4. Use owned or explicitly approved fixture photos for the first real-provider readiness check.
5. Confirm the UI clearly explains that selected photos and creative guidance leave the home network.

## Deferred Product Exploration

Product packs, rights workflow, automated QA, pricing, Etsy/Shopify, POD, listing copy, payment, NFT, and public hosting are not current configuration surfaces. The [historical product-pack PRFAQ](./docs/ai-artist/prfaq/milestone-1-scope.md) preserves that exploration.

Before any future sale or marketplace-facing implementation:

- verify current platform policies from official sources;
- confirm source-photo rights and inspect outputs manually;
- review dimensions, file size, text readability, visible artifacts, watermark/signature status, and print suitability;
- require explicit approval before publishing, buyer communication, fulfillment, POD product creation, or NFT minting.
