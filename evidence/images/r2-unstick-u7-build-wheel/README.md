# r2-01 — the four Build-wheel goldens, re-shot against merged main

Why these moved, and why every pixel that moved is text.

## What changed under them

Nothing in `build-wheel-view.ts`'s drawing code. What moved is the **body font
fallback**, which main changed in `a1-01` (`bb054ad`):

    FONT_BODY: 'Oxanium, "DejaVu Sans Mono", monospace'
            -> 'Oxanium, "Liberation Mono", monospace'

Neither ratified face (Oxanium, Audiowide) has ever actually loaded — a1-01
found there is no `@font-face` in `index.html` and no font file in `assets/` —
so every screen in this game draws in the fallback, and the fallback is what
these baselines encode. Confirmed on this container:

    $ fc-match "DejaVu Sans Mono"  ->  wqy-zenhei.ttc: "WenQuanYi Zen Hei Mono"   # NOT present
    $ fc-match "Liberation Mono"   ->  LiberationMono-Regular.ttf                  # present

So the old baselines were shot in WenQuanYi Zen Hei Mono and the new ones in
Liberation Mono — the face a1-01 picked precisely because both gating machines
have it (Playwright installs `fonts-liberation` with its chromium on every Linux
variant, and this container ships it).

## Why they had to be re-shot even though they PASSED

They passed, and that is the problem. Measured with the gate's own comparator at
zero tolerance:

| baseline                      | differing px | of total  | gate      |
|-------------------------------|--------------|-----------|-----------|
| `desktop-build-wheel`         | 2,339        | 0.23 %    | under 1 % |
| `desktop-build-wheel-short`   | 2,330        | 0.23 %    | under 1 % |
| `phone-landscape-build-wheel` | 6,974        | 0.85 %    | under 1 % |
| `phone-portrait-build-wheel`  | 6,807        | 0.83 %    | under 1 % |

Every one sits *just* under `maxDiffPixelRatio: 0.01` — which is the exact trap
a1-01 documented: "screens with a few words of body text stayed inside the 1 %
tolerance and nobody noticed for months", until two text-dense screens blew
through it. Left alone, these four would have gone on encoding a font the code
no longer asks for, spending most of the tolerance budget on a known difference
and leaving almost none for the real regression the gate exists to catch.

(By exact RGB equality — no antialiasing threshold — the same four differ by
2.04 %, 2.02 %, 2.20 % and 2.20 %. Playwright's numbers above are lower because
pixelmatch's default threshold forgives near-identical antialiased pixels. The
`diff-*.png` here are exact-equality, so they show the full glyph raster.)

## What is in here

`before-*.png` — the baseline as committed at `3d1807b`, WenQuanYi.
`after-*.png`  — the baseline as committed now, Liberation Mono. These are the
                 bytes in `tests/mobile/goldens.spec.ts-snapshots/`.
`diff-*.png`   — red where the pixel changed, dimmed grey where it did not.

## Eyes on all four — what I checked and what I found

Read the `diff-*.png` first: **every red pixel is text, and only text.** The
wheel's arcs, ring, hub disc and dividers, the plate fills, the planet, the
asteroids, the FIRE button, the hint banner's background, the minimap and the
HP bar are all grey — unchanged. No control moved, none vanished, none appeared.

Per baseline, against `before-`:

- **desktop-build-wheel** (8 ore banked). All five wedges present and reading:
  TURRET `FULL` / `4 / 4 BUILT`, SHIELD `FULL` / `2 / 2 BUILT`, UPGRADE SHIP
  `OPEN ▸` (the one wedge that opens a screen instead of spending), REPAIR
  REACTOR `REACTOR FULL`, RADAR `6/8` in **signal yellow** — payable at 8 ore.
  Hub reads `8` over `ORE`, `CLOSE · ESC`. Costs are still the only numbers on
  the wheel (GDD §2.5). Body glyphs are wider in Liberation Mono, so the
  four-line stack re-centres by 1–3 px; the heading lines ride that shift, which
  is why some wedge names show red without their font having changed.
- **desktop-build-wheel-short** (4 ore banked). Identical frame except the half
  it exists to prove: RADAR reads `6/4` in **threat red**, hub reads `4`. Both
  sides of the style-guide §2.1 cost-colour carve-out are still visible across
  the pair, which is the whole reason there are two desktop baselines.
- **phone-landscape-build-wheel** (844×390, dpr 3). The compact copy survives:
  `4/4 BUILT` unspaced, `CLOSE` without the `· ESC` desk affordance, and the
  touch FIRE button present with the controls strip correctly absent. The wheel
  still fits its 140 px radius — the derived-metrics claim this baseline exists
  to prove.
- **phone-portrait-build-wheel** (390×844, held portrait, dpr 3). The game root
  is rotated 90° by the landscape lock and the wheel comes through it intact,
  all five wedges legible. This is the PR #93 regression guard and it still
  guards.

The HUD's own numerals (`NEXT 2:28`, `MATCH 0:02`, the `TOTAL` ore, `100/100`)
also show red. That is correct and expected: a1-01 moved `hud.ts` onto the same
shared constant in the same commit, so the HUD and the wheel change face
together — which was the entire point of removing the private copies.

## Stability

Re-shot, then re-run at `maxDiffPixelRatio: 0, maxDiffPixels: 0`: **4 passed**.
The new baselines reproduce byte-for-byte in this container, so they are a real
gate and not a moving target.
