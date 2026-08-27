# AGENTS.md

This repository implements AI Artist's private `Memory Postcard Studio` M1: a narrow workflow that turns user-owned photos and memories into one downloadable postcard PNG per successful generation Attempt. Broader sellable product packs and marketplace workflows remain possible future product directions, not current implementation scope.

## Language

- Default user-facing responses should be Chinese.
- Keep technical terms, commands, file names, env vars, API names, and marketplace names in English.
- Product docs may use Chinese-English mixed language when it improves clarity for the project owner.

## Product Boundary

- Treat the active M1 source of truth as the repository code plus the current README, HLD, and reconciled LLD set.
- The active M1 is `Memory Postcard Studio`: 1 to 5 user-owned JPEG or PNG photos, title, note, fixed `warm_handmade` style, immutable Attempts, and one `1800x1200` PNG per successful Attempt.
- The current runnable generation provider is deterministic `fake-v1`. The OpenAI adapter is a target contract and must not be advertised or configured as implemented until its adapter, dependency, tests, and Worker-only Secret boundary exist.
- Product packs, sticker sheets, posters, ZIP/PDF packaging, rights workflow, automated QA, listing drafts, pricing, marketplace integrations, POD, NFT, payments, and public hosting are outside active M1 scope.
- Treat the historical product-pack PRFAQ as future product exploration rather than implementation authority.
- Do not add external publishing, listing creation, buyer communication, fulfillment, POD product creation, or NFT minting without explicit user approval.

## Agent Behavior

- Act as a product-minded software engineer unless the task clearly asks for PM, design, research, SRE, or legal-risk framing.
- Keep changes small and directly tied to the requested artifact or workflow.
- Do not expand into a full platform, marketplace, or agent framework unless the user explicitly asks.
- When adding docs, keep open questions in the owning document instead of creating broad catch-all gap files.
- When implementation begins, prefer one testable end-to-end workflow over many speculative modules.

## Safety And Rights

- Never store or expose secrets, API keys, wallet seed phrases, access tokens, customer data, or private photos.
- Do not commit generated user photos or commercial outputs unless the user explicitly asks and confirms rights.
- Assume source images require a rights check before commercial use.
- Flag third-party IP, trademarks, logos, celebrity likeness, fictional characters, copyrighted art, and unclear photo ownership.
- Compliance output is a risk checklist, not legal advice.
- Marketplace policies can change; verify current Etsy, Shopify, POD, and NFT platform rules before launch-facing claims.

## Future Marketplace Guardrails

- If product-pack validation is explicitly brought into scope later, Etsy is the preferred first validation channel for digital product packs.
- Listing drafts should include human-created positioning, AI disclosure where relevant, file names, buyer notes, and usage instructions.
- POD integrations such as Printful or Printify should stay draft-only until production partner, cost, margin, shipping, and mockup accuracy are reviewed.
- Any external publishing, listing creation, buyer communication, order fulfillment, or NFT minting requires explicit user approval.

## Implementation Preferences

- Inspect existing repo structure before editing.
- Prefer minimal, reviewable diffs.
- Match existing project conventions once they exist.
- Do not introduce broad abstractions before the first workflow is working.
- For active M1 code, preserve the existing boundaries between website intake/status/delivery, Task/Asset/Attempt/Artifact lifecycle, object storage, generation providers, and minimum output verification.
- Add product layout variants, export packaging, listing drafts, rights workflow, or broader quality/compliance modules only when that future scope is explicitly requested.
- Keep provider-specific image/model code behind a small boundary so model choices can change later.

## Verification

- For docs, verify links, internal references, and Markdown readability.
- For code, run the narrowest meaningful checks before claiming completion.
- For generated visual output, verify the fixed postcard dimensions, text readability, file size, and obvious artifacts. Verify marketplace export constraints only when marketplace work is explicitly in scope.
- For any frontend, perform visual QA on desktop and mobile viewports.

## Git And Repo Setup

- The intended GitHub repository is `https://github.com/tongking6/ai-artist`.
- If `origin` is missing, document or ask before changing Git remote configuration.
- Do not rewrite history or remove user work unless explicitly requested.
