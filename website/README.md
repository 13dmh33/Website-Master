# website/ directory map

| Folder | Purpose | Branding | When to use |
|---|---|---|---|
| `demos/` | Generic per-trade mockups (plumbing, electrical, handyman, roofing) used in cold outreach. Stock photos, no real business name. | Trevo navy/teal | Default demo sent to any lead in that trade |
| `demo/` `for/` | Personalizer/legacy single-page templates rendered dynamically via URL query params (`?b=...&t=...`). | Trevo navy/teal | Auto-generated `demo_url` per lead by `scripts/personalizer.js` |
| `prospects/<lead-slug>/` | One-off custom draft for a **named, not-yet-signed** prospect — their real logo, photos, brand colors, copy. | Prospect's own brand | Building a tailored mockup to close a specific deal |
| `clients/<client-slug>/` | Delivered site for a **paying customer** — same content as their prospect draft, promoted once the deal closes. | Prospect's own brand | Live, hosted site billed at $65/mo |

## Lifecycle

```
lead (Scout) → demos/<trade>/ (generic pitch)
            → prospects/<lead-slug>/ (custom draft, once engaged)
            → clients/<client-slug>/ (deal closed — promote/rename the folder, deploy, start billing)
```

When a deal closes, move the folder: `mv website/prospects/<slug> website/clients/<slug>`, then deploy/point DNS and add the $65/mo hosting line to `config/cost-log.json` tracking.
