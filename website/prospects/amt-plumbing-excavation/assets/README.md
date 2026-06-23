## Real AMT images to drop in here

The draft at `../index.html` currently uses stock Unsplash photos as placeholders,
and the logo in the nav/footer is a hand-built inline SVG approximation — not the
real file. No real image files were available when this draft was built; they were
shared inline in chat, not as files this session could read from disk. Once you
upload the real files, save them here with these names:

| Filename | Source | Used for | Where in index.html |
|---|---|---|---|
| `logo.png` | AMT "Plumbing, Utilities & Excavation" logo (white bg, Colorado-flag mountain mark) | Nav / footer brand mark | Replace the inline `<svg class="logo-mark">` block with `<img src="assets/logo.png" class="logo-mark" alt="AMT logo" />` |
| `hero.jpg` | Truck or jobsite photo | Hero background | `.hero-bg` background-image |
| `gallery-1.jpg` | Truck w/ pipe rack | Gallery grid, left | first `<img>` in `.gallery-grid` |
| `gallery-2.jpg` | Excavator + van fleet on dirt lot | Gallery grid, right | second `<img>` in `.gallery-grid` |

To swap: replace the relevant Unsplash URL (or the inline SVG, for the logo) with
`assets/<filename>` in `index.html`.
