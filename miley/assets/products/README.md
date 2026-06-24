# Product mockups

Drop Printify product mockups here, named by catalog key (from `templates/post-formats.json` → `product_catalog_rotation`):

- `unisex_tee.png`
- `pocket_back_graphic_tee.png`
- `snapback_hat.png`
- `trucker_cap.png`
- `boxer_briefs.png`
- `kiss_cut_sticker_1.png`
- `kiss_cut_sticker_2.png`
- `magnet.png`

The Designer agent uses these as the card background for product posts (the post's `product` field → `assets/products/{key}.png`). If a file is missing, the renderer falls back to the content-type gradient palette automatically — so the pipeline always produces an image.

Square (1080×1080) or larger works best; the renderer cover-fits and applies a dark overlay for text legibility.
