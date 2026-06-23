## Real AMT images to drop in here

The draft at `../index.html` currently uses stock Unsplash photos as placeholders
(no real image files were available when this draft was built — they were shared
inline in chat, not as files). Once you upload the real files, save them here
with these names and the noted line in `index.html` will be ready to swap:

| Filename | Source | Used for | Line in index.html |
|---|---|---|---|
| `logo.png` | AMT black-background logo | Nav / footer brand mark | `.nav-biz` block (~line 222) |
| `hero.jpg` | Orange truck, side angle, trees/road | Hero background | `.hero-bg` background-image (~line 56) |
| `gallery-1.jpg` | Orange truck w/ pipe rack | Gallery grid, left | gallery `<img>` (~line 1st in `.gallery-grid`) |
| `gallery-2.jpg` | Excavator + van fleet on dirt lot | Gallery grid, right | gallery `<img>` (~line 2nd in `.gallery-grid`) |

To swap: replace the relevant Unsplash URL with `assets/<filename>` in `index.html`.
