# Setup And Project Settings

This document records settings that are implemented by the current AI Artist M1 codebase. Future provider and product ideas are labeled separately and must not be treated as runnable configuration.

## Current Runtime Status

The implemented server path is a deterministic fake-provider vertical slice:

```text
Browser -> FastAPI -> PostgreSQL/MinIO -> Generation Worker -> postcard.png
```

It exercises the real Task, Asset, Attempt, Artifact, upload, generation, and download lifecycle without sending photos to an external AI provider.

The server defaults to the deterministic provider:

```bash
AI_ARTIST_GENERATION_PROVIDER=fake
```

`openai` is an explicit production mode. It calls `POST /v1/images/edits` with all 1–5 source photos, `gpt-image-2-2026-04-21`, `n=1`, `quality=medium`, `size=1808x1200`, `output_format=png`, zero SDK retries, and a 480-second timeout. The Worker center-crops the resulting PNG to the same `1800x1200` `postcard.png` artifact contract. It never retries a failed Attempt.

## OpenAI Real-photo Smoke (Owner-operated)

Use only photos that the owner has explicitly authorized. Do not add photos, generated PNGs, or API keys to this repository.

On the Linux K3s server, create the secret interactively so the key is never placed in a command line, shell history, manifest, or log:

```bash
sudo k3s kubectl -n ai-artist create secret generic ai-artist-openai --from-file=OPENAI_API_KEY=/dev/stdin
```

Paste the key, press `Ctrl-D`, then deploy OpenAI mode from a clean commit:

```bash
AI_ARTIST_GENERATION_PROVIDER=openai ./scripts/linux-k3s.sh deploy
```

The script verifies that the existing Secret has an `OPENAI_API_KEY` key without reading or printing its value. The `OPENAI_API_KEY` environment variable is referenced only by the `generation-worker` Deployment; Website and backend-api do not receive it.

Open the private tailnet URL, upload one to five owner-approved photos, fill title and note, acknowledge the Create postcard disclosure, and select **Create postcard**. Verify the Attempt transitions `queued` → `generating` → `ready`, Worker logs show one provider request without secret material, and the downloaded PNG is exactly `1800x1200`. If OpenAI rejects or times out, confirm the Attempt becomes terminal `failed`; create a separate refinement Attempt rather than retrying it. Run `./scripts/linux-k3s.sh logs` only for status diagnostics and do not copy provider payloads into issue reports.

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

The server must have Docker, native K3s, `openssl`, `curl`, `findmnt`, `git`, and `sudo`. The repository does not currently pin or preflight an exact K3s patch version; treat the installed version as a host-owned prerequisite and confirm its compatibility before deployment. The 1 TB SSD must be mounted at `/data`. Configure K3s before deployment:

```yaml
# /etc/rancher/k3s/config.yaml
disable:
  - servicelb
kube-proxy-arg:
  - nodeport-addresses=127.0.0.0/8
```

`/etc/rancher/k3s/config.yaml` is host-wide K3s configuration. AI Artist does not require or set `default-local-storage-path`; leave that host-wide policy to the server operator. The repository-owned `home` overlay deploys an AI Artist-only `local-path-provisioner`, then creates `ai-artist-owned-local-path` and explicitly assigns it to the PostgreSQL and MinIO PVCs. Its private allowlist and StorageClass, rather than K3s's default local-storage path or built-in provisioner configuration, pin AI Artist data to `/data/ai-artist/k3s-storage`.

Restart K3s after changing the host-owned file, then deploy from a clean named Git commit on the Linux server:

```bash
./scripts/linux-k3s.sh deploy
```

The command:

- derives immutable Website and Backend image tags from the 12-character commit SHA;
- builds the images and imports them into native K3s containerd;
- creates random PostgreSQL/MinIO credentials only when the Kubernetes Secret is absent;
- applies the `home` overlay and waits for every workload;
- verifies the repo-owned StorageClass, PVC/PV placement, running image tags, and the loopback ingress;
- never writes credential values to the repository.

The `ai-artist-owned-local-path` StorageClass pins both application PVCs to `/data/ai-artist/k3s-storage`, independently of K3s's host-wide default local-storage path and built-in provisioner. Its app-owned provisioner has an allowlist containing only that directory. Each provisioned directory includes the PV name. With reclaim policy `Retain`, recreating a same-named PVC creates a new directory; recovery requires explicitly rebinding the retained PV. The deployment refuses to delete or silently reuse legacy PVC data. It permits a pre-existing, matching `Pending` PVC so a repaired provisioner can bind it, but stops for an incompatible StorageClass, unexpected unbound phase, or incorrect bound PV path.

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
- Generation providers: default deterministic `fake-v1`; explicit OpenAI Images edits mode.
- Image normalization: Pillow, from `1808x1200` provider-format PNG to `1800x1200` artifact PNG.

Both initial generation and refinement use `POST /v1/tasks/{task_id}/attempts`. M1 never automatically retries or requeues a claimed Attempt.

## M1 Product Settings

- Input: 1 to 5 user-owned JPEG or PNG photos.
- Metadata: title, creative note, and fixed style `warm_handmade`.
- Output: one `1800x1200` `postcard.png` for each successful Attempt.
- Access: private household tailnet only.
- Publishing: local download only; no automatic external actions.


## Deferred Product Exploration

Product packs, rights workflow, automated QA, pricing, Etsy/Shopify, POD, listing copy, payment, NFT, and public hosting are not current configuration surfaces. The [historical product-pack PRFAQ](./docs/ai-artist/prfaq/milestone-1-scope.md) preserves that exploration.

Before any future sale or marketplace-facing implementation:

- verify current platform policies from official sources;
- confirm source-photo rights and inspect outputs manually;
- review dimensions, file size, text readability, visible artifacts, watermark/signature status, and print suitability;
- require explicit approval before publishing, buyer communication, fulfillment, POD product creation, or NFT minting.
