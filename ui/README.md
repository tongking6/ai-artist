# AI Artist M1 UI

The M1 customer website lives entirely in this directory. It implements the reconciled LLD flow:

```text
Start -> My projects -> Task intake -> direct photo upload -> complete intake
                     -> create Attempt -> status/history -> refine or download
```

The current M1 output is one `1800x1200` postcard PNG per ready Attempt. Product packs, pricing, accounts, rights workflows, marketplace publishing, POD, NFT, ZIP/PDF delivery, and operator screens are intentionally absent.

## Run locally

Use Node.js 20.9 or newer:

```bash
npm install
npm run dev
```

The browser calls the LLD-02 FastAPI paths directly. `/tasks` uses the system-level `GET /v1/tasks` collection and loads full Attempt history from the existing per-Task endpoint only when a project is expanded. It never adds an application `Authorization` header and never receives database, object-store, or provider credentials.

The committed `public/app-config.js` sets `demoMode: true`, so the local site uses
an in-browser demo adapter before FastAPI is available. The demo persists only
synthetic project metadata in browser storage, simulates upload/generation, and
never calls an image provider. The K3s ConfigMap replaces this file with
`demoMode: false` to exercise the deployed real backend.

## Run the real Linux stack

Run `scripts/linux-k3s.sh deploy` from a checkout on the Linux server. It builds/imports the Website and Backend images and deploys the Website, FastAPI API, fake Generation Worker, PostgreSQL, and MinIO to native K3s. The browser uses `demoMode: false` and the real LLD-02 API through the canonical Tailscale origin.

The initial server verification uses generated in-cluster PostgreSQL/MinIO Secret values and does not require `OPENAI_API_KEY`. Tailscale Serve remains the customer access boundary.

## Browser-safe runtime config

`public/app-config.js` is the safe local fallback configuration:

```js
window.__AI_ARTIST_CONFIG__ = Object.freeze({
  stage: "home",
  apiBaseUrl: "",
  assetBaseUrl: "",
  maxPhotos: 5,
  demoMode: true,
});
```

An empty `apiBaseUrl` uses the current origin. The Kubernetes
`ai-artist-ui-runtime` ConfigMap mounts the home profile with `demoMode: false`
at the same path. Do not place secrets in either file.

## Verify

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
AI_ARTIST_LIVE_URL=https://tongjin-server.tail910d5f.ts.net npm run test:e2e:live
```

The default Playwright command builds the production Next.js application, starts
it on `127.0.0.1:3100`, and intercepts the fixed LLD-02 contract. This avoids
development-server compilation races between desktop and mobile projects.
`test:e2e:live` runs the same customer workflow against the Linux server's real
fake-provider stack.
