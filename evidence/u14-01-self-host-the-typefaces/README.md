# u14-01 — the game, in its own typefaces

GDD §5.6 has ratified **Audiowide** (wordmark, headings, menu confirmations) and
**Oxanium** (HUD numerals, body) as "self-hosted in the repo" since the document
was written. There was no `@font-face` anywhere and no font file in the repo, so
**every frame this project has ever drawn — every golden here, every live round —
was in a fallback face.** These pairs are the first time the game has been
photographed in the type it was designed for.

`before-*` is the baseline on `main`. `after-*` is the same shot with the faces
self-hosted and the boot blocked on them. Same scene, same seed, same frozen
tick — the only variable is the type.

| Surface | Before | After |
|---|---|---|
| Menu (desktop) | `before-desktop-menu.png` | `after-desktop-menu.png` |
| Menu (phone, landscape) | `before-phone-menu.png` | `after-phone-menu.png` |
| Lobby (desktop) | `before-desktop-lobby.png` | `after-desktop-lobby.png` |
| Lobby (phone, landscape) | `before-phone-lobby.png` | `after-phone-lobby.png` |
| HUD band (desktop) | `before-desktop-hud-top.png` | `after-desktop-hud-top.png` |
| HUD band (phone, landscape) | `before-phone-hud-top.png` | `after-phone-hud-top.png` |
| Summary (desktop) | `before-desktop-summary.png` | `after-desktop-summary.png` |
| Summary (phone, portrait-held) | `before-phone-summary.png` | `after-phone-summary.png` |
| Ship select (phone, landscape) | `before-phone-ship-select.png` | `after-phone-ship-select.png` |

## The one thing the font swap broke, and the fix

`zoom-1` → `zoom-2` → `zoom-3`, the SHIP · CHANGE tile on `desktop-lobby` at 5×.

1. **`zoom-1-fallback-face-shipped-on-main.png`** — what `main` draws. Liberation
   Mono, pip bar cleanly under each figure.
2. **`zoom-2-real-face-pip-through-figure-BUG.png`** — the real Oxanium loaded,
   before the fix. **Every stat cell draws its pip bar through the bottom of its
   own figure** — six cells, four hulls, on `desktop-lobby` *and*
   `phone-landscape-ship-select`. `STAT_ROW_TEXT` was `10`, annotated "Oxanium 8,
   measured box 10" — but Liberation Mono 9's box **is** 10 and Oxanium 9's is
   **12**, so the constant had been describing the fallback and crediting the
   ratified face. `class-tile-view` puts the bar at `box.y + STAT_ROW_TEXT`, so
   `10` landed it exactly on the baseline.
3. **`zoom-3-after-STAT_ROW_TEXT-fix.png`** — `STAT_ROW_TEXT = 12`. Measured back
   out of the PNG, the separation is now **identical to `main`'s**: text ink on
   rows 305–312, one blank row, pip bar on 314–317 (`main`: 304–310, blank,
   312–315). The fix is the type metric, not the assertion.

## A stale baseline this surfaced, unrelated to the fonts

`before-desktop-hud-top.png` reads **`TOTAL`** in the top-left. The copy was
changed to **`ORE`** by `a0-03` on 2026-08-07 (`src/ui/hud.ts:693`, *"should not
say total, it should say ORE"*) and the band golden was never re-shot — the diff
sat under the 1% `maxDiffPixelRatio` and CI stayed green for four days. The
re-baseline corrects it. **It is not a copy change from this brief.**

## Payload and load behaviour

- **27.5 KB total over the wire**, both faces: `Audiowide-Regular-latin.woff2`
  14,132 B (static, one weight) + `Oxanium-Variable-latin.woff2` 14,044 B
  (variable, `wght` 200–800 — one file serves 400 and 700).
- Subset to Google's `latin` range. `latin-ext` is **cut**: 15,000 B, +53%
  payload, for glyphs no string in this repo uses.
- **Blocked, and preloaded.** `<link rel="preload" … crossorigin>` starts both
  fetches from the first bytes of the HTML; an inline module script then awaits
  `document.fonts.load()` for all three shorthands *before* `src/main.ts` is
  evaluated. Blocking is required, not decorative: Pixi draws into a **canvas**,
  where `font-display` does nothing — `fillText` bakes whatever face is resolved
  at that instant into a texture and never redraws it, so an early frame is
  permanently wrong and a golden is a coin flip between two baselines. Bounded at
  3000 ms so a font that 404s or hangs costs a fallback face and never the game
  (`src/platform/boot-error.ts` — no black screens, ever).
