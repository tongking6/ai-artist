# AI Artist

AI Artist is an AI-assisted creative product agent for turning user-owned photos, themes, and memories into sellable digital creative goods: sticker sheets, postcards, posters, listing mockups, and marketplace-ready copy.

The project starts from a product idea rather than a finished implementation. The first milestone should prove one complete creator workflow before expanding into marketplaces, print-on-demand, or NFT publishing.

Repository: https://github.com/tongking6/ai-artist

## Product Thesis

AI Artist is not just an image generator. It is a creative product operator:

> From a user's photo or memory, generate a coherent product pack that can be downloaded, printed, listed, and tested for commercial demand.

The core value is not a single pretty image. The core value is repeatable productization:

- consistent visual style
- product-specific layouts
- print and marketplace export formats
- listing copy and buyer instructions
- risk checks for IP, likeness, AI disclosure, and platform limits

## Inspiration

This product direction came from two Xiaohongshu examples discussed before project setup:

- A Codex/image skill experiment that produced a vintage paper, fine-line, postcard/poster-like city style.
- A `travel-memory-sticker-card` example that transforms travel photos into a memory card with sticker motifs and shareable collectible energy.

The useful signal is that users respond to reusable style systems and memory-based creative artifacts, not only raw AI-generated images.

## M1: Memory Product Pack Agent

The recommended first milestone core is:

> User uploads 1 to 5 photos they own or have permission to use. The website/API creates a cohesive travel memory product pack with a sticker sheet, postcard, poster, and social preview.

M1 should optimize for one niche first:

**Travel memory cards**

Why this first:

- simple user input: travel, city walk, or lifestyle photos
- naturally supports sticker, postcard, and poster outputs
- lower IP risk than fan art, celebrities, brands, or fictional characters
- easy to validate on social platforms and Etsy-style digital listings

## Expected M1 Core Outputs

- `sticker_sheet`
  - printable PNG or PDF
  - optional transparent PNG sticker exports

- `postcard`
  - 4x6 or 5x7 front design
  - exportable PNG or PDF

- `poster`
  - common ratios such as 2:3, 3:4, and 4:5
  - high-resolution PNG or PDF

- `social_preview`
  - shareable preview image
  - product-pack cover image

- `quality_report`
  - output dimensions
  - readable text check
  - watermark/signature check
  - print suitability notes
  - IP/trademark/likeness checklist

## Follow-Up Outputs

These are useful for the broader product vision but are not core M1 deliverables:

- `listing_preview`
- `listing_kit`
- `buyer_usage_note`

## Agent Modules

AI Artist can be designed as a multi-step agent system:

- `Intake Agent`: collects product goal, source rights, photos, style preference, and target channel.
- `Art Director Agent`: converts user input into a reusable style recipe.
- `Product Designer Agent`: adapts the style into sticker, postcard, poster, and mockup layouts.
- `Listing Agent`: writes marketplace-ready copy, tags, buyer notes, and file names.
- `Compliance Agent`: flags IP, trademark, likeness, AI disclosure, and platform risks.
- `Publisher Agent`: later creates marketplace drafts only after explicit user confirmation.

M1 core should generate downloadable art assets. Listing drafts can follow after the core generation loop works. It should not automatically publish to Etsy, Shopify, print-on-demand, or NFT platforms.

## Channel Strategy

Start with digital product packs. Treat marketplace publishing as a later integration.

- Etsy first: best early validation channel for printable and digital downloads.
- Print-on-demand second: useful for sticker, poster, and postcard fulfillment after product quality is stable.
- Own store later: Shopify or similar storefronts make sense when there is an audience or brand.
- NFT optional: only after the style has collector demand, brand story, scarcity, and utility.

## Product Guardrails

- Only use user-owned, user-created, licensed, or clearly public-domain source material.
- Avoid celebrity, fan, trademark, logo, copyrighted character, and third-party artwork workflows in M1.
- Clearly disclose AI usage when a target platform requires it.
- Do not claim legal advice; present compliance as a risk checklist.
- Do not auto-publish products or mint NFTs without explicit user approval.
- Keep output file names clear because marketplace buyers may see them directly.

## Suggested Repository Shape

The repo is currently documentation-first. A likely future structure is:

```text
docs/
  product/
  research/
  operations/
src/
  agents/
  pipelines/
  exporters/
  quality/
examples/
  inputs/
  outputs/
```

Do not create this full structure until the implementation direction is confirmed.

## Current Docs

- [SETUP.md](./SETUP.md): required project, environment, marketplace, and quality settings.
- [AGENTS.md](./AGENTS.md): instructions for future agent work in this repository.
- [Milestone 1 PRFAQ](./docs/prfaq/milestone-1-scope.md): M1 customer promise, scope, pricing, success metrics, and launch assumptions.
- [Milestone 1 HLD](./docs/hld/milestone-1-high-level-design.md): high-level product and technical design for the website, serverless AWS runtime, automated generation, QA, packaging, and delivery model.

## Sources

- Xiaohongshu example 1: https://www.xiaohongshu.com/discovery/item/6a79fc4b0000000025000dc9
- Xiaohongshu example 2: https://www.xiaohongshu.com/discovery/item/6a8186860000000005030018
- `travel-memory-sticker-card`: https://github.com/carolinaaafy/travel-memory-sticker-card
- Etsy digital listings: https://help.etsy.com/hc/en-us/articles/115015628347-How-to-Manage-Your-Digital-Listings
- Etsy creativity standards: https://www.etsy.com/legal/creativity/
- Etsy IP policy: https://www.etsy.com/legal/ip/
- Shopify Digital Downloads: https://help.shopify.com/en/manual/products/digital-service-product/digital-downloads
- OpenSea NFT creation: https://support.opensea.io/en/articles/8867023-how-do-i-create-an-nft
