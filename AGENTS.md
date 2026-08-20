# AGENTS.md

This repository is for AI Artist, an AI-assisted creative product agent that turns user-owned photos and memories into sellable digital creative goods such as sticker sheets, postcards, posters, mockups, and marketplace listing drafts.

## Language

- Default user-facing responses should be Chinese.
- Keep technical terms, commands, file names, env vars, API names, and marketplace names in English.
- Product docs may use Chinese-English mixed language when it improves clarity for the project owner.

## Product Boundary

- Treat the current source of truth as a discussion-grounded product vision, not a finished technical spec.
- Start from user problems, creative workflow, product outputs, and channel assumptions before implementation details.
- The recommended M1 is `Memory Product Pack Agent` for travel memory cards.
- M1 should generate local assets and marketplace-ready drafts; it should not publish listings, create POD products, or mint NFTs automatically.
- NFT should remain optional and downstream until the product has collector demand, brand story, scarcity, and utility.

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

## Marketplace Guardrails

- Etsy should be treated as the first validation channel for M1 digital product packs.
- Listing drafts should include human-created positioning, AI disclosure where relevant, file names, buyer notes, and usage instructions.
- POD integrations such as Printful or Printify should stay draft-only until production partner, cost, margin, shipping, and mockup accuracy are reviewed.
- Any external publishing, listing creation, buyer communication, order fulfillment, or NFT minting requires explicit user approval.

## Implementation Preferences

- Inspect existing repo structure before editing.
- Prefer minimal, reviewable diffs.
- Match existing project conventions once they exist.
- Do not introduce broad abstractions before the first workflow is working.
- For new code, separate:
  - intake and rights checks
  - style recipe generation
  - product layout generation
  - export packaging
  - listing draft generation
  - quality and compliance checks
- Keep provider-specific image/model code behind a small boundary so model choices can change later.

## Verification

- For docs, verify links, internal references, and Markdown readability.
- For code, run the narrowest meaningful checks before claiming completion.
- For generated visual output, verify image dimensions, text readability, file size, obvious artifacts, and marketplace export constraints.
- For any frontend, perform visual QA on desktop and mobile viewports.

## Git And Repo Setup

- The intended GitHub repository is `https://github.com/tongking6/ai-artist`.
- If `origin` is missing, document or ask before changing Git remote configuration.
- Do not rewrite history or remove user work unless explicitly requested.
