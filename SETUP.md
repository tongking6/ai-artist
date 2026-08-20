# Setup And Project Settings

This document records the settings AI Artist will likely need as it moves from product vision to implementation.

The repo is currently documentation-first. Treat these as required decisions and configuration placeholders, not as proof that an integration already exists.

## GitHub

Intended repository:

```bash
git remote add origin https://github.com/tongking6/ai-artist.git
git branch -M main
git push -u origin main
```

Only run these after confirming the local repo should be connected to that GitHub remote.

## Local Environment

Recommended local env file once implementation begins:

```bash
# Required for AI generation
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=
OPENAI_IMAGE_MODEL=

# Local output paths
AI_ARTIST_OUTPUT_DIR=./outputs
AI_ARTIST_ASSET_CACHE_DIR=./.cache/assets

# Product defaults
AI_ARTIST_DEFAULT_STYLE=travel-memory-card
AI_ARTIST_DEFAULT_CHANNEL=etsy-digital-download
AI_ARTIST_DEFAULT_CURRENCY=USD

# Optional marketplace integrations, draft-only until approved
ETSY_CLIENT_ID=
ETSY_CLIENT_SECRET=
SHOPIFY_STORE_DOMAIN=
SHOPIFY_ADMIN_ACCESS_TOKEN=
PRINTFUL_API_KEY=
PRINTIFY_API_KEY=

# Optional NFT integrations, not M1 core
NFT_WALLET_ADDRESS=
NFT_NETWORK=
OPENSEA_API_KEY=
```

Do not commit real `.env` files. Keep secrets in local env vars or a secret manager when a backend exists.

## M1 Product Settings

Recommended defaults:

- `product_niche`: `travel_memory_cards`
- `source_count`: `1-5 photos`
- `style`: `travel-memory-card`
- `channels`: `etsy_digital_download`, `social_preview`
- `publish_mode`: `draft_only`
- `auto_publish`: `false`
- `nft_enabled`: `false`

M1 output pack:

- `sticker_sheet`
- `postcard`
- `poster`
- `mockups`
- `listing_kit`
- `quality_report`

## Output File Settings

Recommended early export formats:

- sticker sheet: `PNG`, `PDF`
- individual stickers: `PNG` with transparent background when quality is acceptable
- postcard: `PNG`, `PDF`
- poster: `PNG`, `PDF`
- listing previews: `JPG` or `PNG`
- listing kit: `Markdown`, `JSON`

Recommended file naming pattern:

```text
{project_slug}_{product_type}_{ratio_or_size}_{version}.{ext}
```

Example:

```text
kyoto_memory_sticker_sheet_a4_v1.pdf
kyoto_memory_postcard_4x6_v1.png
kyoto_memory_listing_kit_v1.md
```

## Etsy Digital Listing Constraints

Before Etsy-facing implementation, verify the current official Etsy docs.

As of this setup draft:

- digital listings can be instant downloads or made-to-order downloads
- instant digital listings support up to 5 files
- each uploaded file can be up to 20MB
- digital item file names are visible to buyers
- digital listings do not support variations
- digital items must be made and/or designed by the seller
- seller-prompted AI creations require disclosure in the listing description

Source docs:

- https://help.etsy.com/hc/en-us/articles/115015628347-How-to-Manage-Your-Digital-Listings
- https://www.etsy.com/legal/creativity/
- https://www.etsy.com/legal/ip/

## POD Settings

POD is not M1 core. If enabled later, require these decisions first:

- provider: `Printful`, `Printify`, or other
- product types: stickers, posters, postcards, cards, apparel, or home goods
- production partner disclosure
- shipping region and currency
- cost, margin, and refund rules
- safe area, bleed, and color requirements
- mockup source and accuracy expectations

Never create live POD products without explicit user approval.

## NFT Settings

NFT is optional and should not be part of M1 by default.

Only revisit NFT after answering:

- What is collectible about the style or artist brand?
- What is scarce or limited?
- What utility does ownership provide?
- Which chain and wallet are used?
- Who pays gas and platform fees?
- What metadata and license terms are attached?
- What user approval is required before minting?

Never mint NFTs or connect a wallet automatically.

## Compliance Checklist

Each commercial output should record:

- Did the user create or license the source photo?
- Does the source contain recognizable people?
- Does it include children?
- Does it include logos, trademarks, signage, branded products, or copyrighted artwork?
- Does it resemble a celebrity, fictional character, franchise, or living artist style too closely?
- Is AI usage disclosed where required?
- Is the output marked `personal`, `commercial`, `draft`, or `blocked`?

## Quality Checklist

Each output pack should record:

- dimensions
- aspect ratio
- file size
- export format
- readable text check
- transparent background check where applicable
- print-readiness status
- visible artifacts
- watermark/signature status
- marketplace limit status

## Launch Checklist

Before any real sale:

- verify current marketplace policies
- verify all source rights
- inspect final exported files manually
- test download package names and file sizes
- write clear buyer instructions
- add AI disclosure where required
- confirm refund/support expectations
- keep a record of product source, prompts, edits, and publication date
