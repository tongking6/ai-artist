# AI Artist Historical PRFAQ: Memory Product Pack Agent

Status: Historical product exploration; superseded for the active M1 implementation
Owner: Codex
Target: Possible post-M1 product-pack direction

> **Historical document:** This PRFAQ preserves the original product-pack and marketplace-validation thesis. It is not the current implementation contract, launch promise, pricing plan, or runtime status. The active M1 is the private `Memory Postcard Studio`: 1 to 5 photos, title/note/style, immutable Attempts, and one `1800x1200` PNG per successful Attempt. Product packs, pricing, rights workflow, listing materials, QA packaging, and marketplace features are deferred.
>
> Use the [M1 HLD](../hld/milestone-1-high-level-design.md) and [reconciled LLD set](../lld/README.md) as implementation authority.

## Press Release

### AI Artist Turns Travel Photos Into Sellable Digital Product Packs

For creators, memory keepers, and Etsy-style sellers, AI Artist converts 1 to 5 user-owned travel photos into a polished download pack with printable artwork, social previews, and listing-ready copy.

New York, NY - October 1, 2026 - AI Artist today announced the early-access launch of Memory Product Pack Agent, a guided creative service that helps people turn their own travel memories into cohesive digital product packs. Instead of starting from a blank design canvas or wrestling with generic image generators, users complete a simple guided UI, upload their own photos, choose a visual direction, confirm usage rights, and receive a ready-to-review download pack.

People already take meaningful travel, city walk, and lifestyle photos, but turning those memories into a printable product is still hard. A seller needs consistent visual style, usable file formats, listing images, buyer instructions, and a clear rights checklist. A casual user wants something beautiful enough to gift or share without learning design tools. Existing image generators can produce one-off images, but they do not package the creative output into artifacts a seller or buyer can actually use.

Memory Product Pack Agent solves this by combining a customer-facing guided intake UI with an internal operator workflow. The user sees a complete product experience: style examples, photo upload, rights confirmation, package selection, submission confirmation, and delivery of a polished download pack. Behind the scenes, AI Artist uses a local-first generation pipeline and human QA to produce a sticker sheet, postcard, poster, listing preview, social preview, buyer usage note, and listing kit.

"I had travel photos sitting on my phone for months. AI Artist turned them into a small product collection I could actually print, gift, and test as a digital listing," said an early pilot user.

Memory Product Pack Agent launches with simple pack-based pricing: a low-cost beta option for early testers, a standard pack for personal and social use, and a seller pack for creators who want stronger listing and preview polish. The service does not automatically publish marketplace listings, create print-on-demand products, or mint NFTs. Users stay in control of where and whether they publish.

To get started, users open the AI Artist intake page, choose a travel-memory style, upload 1 to 5 photos they own or have permission to use, answer a short rights checklist, and submit the request. AI Artist reviews the request, generates the pack, checks quality and rights status, and delivers a download package for manual review.

## External FAQ

### What is AI Artist Memory Product Pack Agent?

It is a guided creative service that turns user-owned travel photos into a cohesive digital product pack. M1 focuses on `travel_memory_cards`: sticker sheet, postcard, poster, listing preview, social preview, and listing-ready copy.

### Who is this for?

M1 is for non-technical users who want a polished creative output from their own travel photos, and for early Etsy-style sellers who want to test whether personal memory-based digital products can sell.

### What is the user-facing entry point?

The entry point is a complete guided UI, not a CLI. The UI should show style examples, explain what the user will receive, collect photos and travel notes, ask for usage intent, collect rights confirmation, show package options, and provide submission/delivery status.

### What happens behind the scenes?

The internal team uses an operator workflow and local CLI to transform the submitted request into a structured `project.json`, generate assets, run QA, and package the final deliverables. The CLI is an internal engine, not the customer interface.

### What does the customer receive?

Customer-facing artifacts:

- `final_download_pack.zip`
- `sticker_sheet.png` and `sticker_sheet.pdf`
- `postcard.png` and `postcard.pdf`
- `poster.png` and `poster.pdf`
- `listing_preview.png`
- `social_preview.png`
- `listing_kit.md` or `listing_kit.pdf`
- `buyer_usage_note.md`

The `listing_kit` should include title, description, tags, digital download explanation, file list, print instructions, buyer note, and AI disclosure draft.

### What does AI Artist keep for internal QA?

Internal artifacts:

- `manifest.json`
- `quality_report.json`
- `rights_checklist.json`
- `prompt_log.md` or `prompt_log.json`
- `generation_notes.md`

These are not default customer deliverables unless the customer is a seller who explicitly wants review traces.

### How much does it cost?

M1 uses pack-based pricing:

- `Beta Pack`: $9 to $15 for early testers, 1 style, 1 to 5 photos, no revision guarantee.
- `Standard Pack`: $19 for a full customer-facing download pack, basic listing kit, and basic social preview.
- `Seller Pack`: $49 for the Standard Pack plus listing polish, social preview polish, and one light revision.

M1 does not use subscription, usage-credit, or commission pricing.

### Why not make it free?

A low paid price validates whether users treat the output as valuable. Free requests can help recruit testers, but free usage alone does not prove willingness to pay for a creative product pack.

### Does AI Artist publish to Etsy or other marketplaces?

No. M1 prepares draft-only listing materials. The user manually decides whether to publish on Etsy, social platforms, Shopify, or anywhere else.

### Can users use photos with logos, celebrities, fictional characters, or unclear ownership?

Not for M1. The rights checklist can mark requests as `needs_review` or `blocked`. AI Artist provides a risk checklist, not legal advice.

### Is this only for Etsy sellers?

No. The pack is useful for personal gifts, social posts, and printable keepsakes. Etsy-style listing materials are included because they create a concrete commercial validation path.

## Internal FAQ

### What is the M1 product bet?

The bet is that users do not only want isolated AI images. They want a packaged creative outcome: consistent style, useful formats, preview images, buyer instructions, and a clear path to manually test demand.

### What is the minimum launchable experience?

A non-technical user can complete the guided UI, submit photos and rights confirmation, choose a package, and receive a polished `final_download_pack.zip`. Internally, the operator can generate the pack through a local CLI and QA checklist.

### Why include a user UI in M1 if the runtime is private and local?

Because the target user is not an engineer. The UI is the Phase 1 product experience even though the home K3s runtime is reachable only through the owner's approved Tailscale tailnet. Deterministic fixtures and the fake provider keep generation repeatable and cheap to debug before any public SaaS deployment exists.

### What is in scope?

- Guided user intake UI.
- 2 to 3 style examples.
- Photo upload and travel-memory notes.
- Usage intent and rights confirmation.
- Pack tier selection.
- Durable Task/Attempt workflow and immutable PostgreSQL `input_snapshot` contract.
- Customer-facing postcard PNG download.
- OpenAI Image API generation with `gpt-image-2-2026-04-21` through a server-side API credential.
- Fake-provider or fixture-based smoke test for repeatable verification.

### What is out of scope?

- Public multi-tenant SaaS, user accounts, shared cloud asset library, public Internet access, or public gallery.
- Native Etsy, Shopify, POD, payment processing, fulfillment, buyer messaging, or marketplace account integration.
- Auto-publishing listings, creating POD products, or minting NFTs.
- Pet, portrait, fan art, celebrity, fictional character, logo-heavy, or unclear-rights workflows.

### What are the riskiest assumptions?

- Users will pay for a personalized creative pack instead of only using free image generators.
- The generated pack can reach a quality bar high enough for gifting, social posting, or manual listing preparation.
- A lightweight UI plus operator workflow is fast enough to satisfy early customers.
- Rights and quality checks can reduce obvious commercial risk without pretending to be legal review.

### Why pack-based pricing?

The customer buys an outcome, not software usage. Pack-based pricing is easier to understand, easier to test, and better aligned with one-off travel memories. Subscription and credit models can be revisited only if repeat seller usage appears.

### What metrics define success?

- 3 to 5 demo packs generated and manually reviewed.
- 3 to 5 non-technical users complete the intake UI without help.
- At least one real user pays for a beta or standard pack.
- Generated files pass naming, dimension, size, and readability checks.
- Every request has visible rights status: `ready`, `needs_review`, or `blocked`.
- At least one seller-style user says the listing kit is sufficient to prepare a manual listing draft.

### What must be verified before marketplace-facing claims?

Current Etsy rules for digital listings, AI disclosure, file limits, buyer-visible file names, digital variations, handmade/creativity standards, and IP policy must be checked against official Etsy documentation before any launch-facing claims or real listing guidance.

### What should we build after this PRFAQ is approved?

1. Intake UI wireframe and copy.
2. `project.json` schema for submitted requests.
3. Internal CLI contract for generating a pack.
4. Sample output pack using fake or owned demo photos.
5. QA checklist and delivery packaging flow.
