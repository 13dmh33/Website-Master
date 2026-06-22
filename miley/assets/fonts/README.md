# Brand fonts (optional drop-in)

`visual-config.json` specifies **Bebas Neue** (headlines) + **Inter** (body). These aren't installed server-side, so cards render with the skia-canvas default font until you add the real font files here.

Drop the `.ttf` / `.otf` files into this folder and the renderer picks them up automatically on next run:

- a file matching `*bebas*` (or `*anton*`) → used for headlines
- a file matching `*inter*` (or `*work*`) → used for body text

Both Bebas Neue and Inter are free (Google Fonts / SIL Open Font License). The auto-renderer is a *fallback* — your hero graphics are built in Canva — so this is a nice-to-have for matching the brand kit on generated cards.
