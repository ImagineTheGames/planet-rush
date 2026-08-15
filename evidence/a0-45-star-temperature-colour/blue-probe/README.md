# a0-45 blue-probe — what the 79 pixels were

OWNER: Art Agent. Run:

```sh
PREVIEW_PORT=4246 npx playwright test \
  --config evidence/a0-45-star-temperature-colour/blue-probe/playwright.config.ts
```

## Why

PR #424's CI went red on **both touch profiles** — not on a golden, on a0-23's
negative assertion in QA's `emulation.spec.ts`:

```
[pixel]  shard 2/6   the stick zone no longer wears plasma (a0-23)
                     Expected: < 40   Received: 79
[iphone] shard 3/6   the stick zone no longer wears plasma (a0-23)
                     Expected: < 40   Received: 94
```

The brief asked, in advance, whether *"a blue star at luma ~200 can be confused
with a friendly marker at a glance"*. This is that question, answered by a
machine rather than by eye — and answered **yes**.

## What the pixels are

The probe reproduces the failing sample exactly — same boot (`/?debug=1`), same
screenshot, same `affordanceArcRegion('touch-left-stick')` bounds read from the
app's own layout registry — and prints every match instead of counting them.

```
ARC device px: x 189..290  y 654..681  (101×27)
isBlueGlow matched: 79
isPlasma matched:   0
distinct colours: 24
  68,86,110   ×28   b-r 42  g-r 18
  67,85,108   ×10   b-r 41  g-r 18
  63,80,102   × 6   b-r 39  g-r 17
  ...
rows: y=655 ×1, 656 ×6, 657 ×8, 658 ×9, 659 ×10, 660 ×11, 661 ×10, 662 ×9, 663 ×9, 664 ×6
x span of hits: 251..261 of arc 189..290
```

An 11×10 radially-symmetric disc, brightest in the middle, 11 columns of 101.
**One star.** Solving the composite over vacuum (13,16,21) against the design's
hot star `rgb(160,205,255)` gives alpha **0.374 / 0.370 / 0.380** from the r, g
and b channels independently — three decimals of agreement. It is a bloomed hot
star, and nothing else.

The same probe on a `main` worktree measures **0**.

## Why no predicate can fix it

| | colour | `b - r` |
|---|---|---|
| the faint plasma ring `isBlueGlow` exists to catch | (25,48,63) | **38** |
| a bloomed a0-45 hot star over vacuum | (68,86,110) | **42** |

**The star is the bluer of the two.** Any threshold tightened enough to reject
the star rejects the ring first. They are not separable by colour. That is the
finding, not an obstacle to be tuned around.

## What does separate them, measured

Shape — which is what this band was chosen for in the first place (a0-23 picked
the ring's own top arc because it is *almost entirely ring*).

```
COLUMN COVERAGE across the arc band (width 101):
  isBlueGlow  11/101 = 11%
  isPlasma    0/101 = 0%
  isBoneGhost 101/101 = 100%   <- what a ring covers
```

The Bone ring that is actually drawn there — the same geometry the plasma ring
had — crosses **every column**. A star lights a ninth of them. `STROKE_COLUMN_RATIO
= 0.5` is the midpoint of that gap.

## The negative control, and the thing it caught

A gate that cannot fail is worth nothing, so the probe also measures **a real
plasma stroke**: the desktop controls strip, which still ships in plasma
(GDD §2.2).

```
DESKTOP — what a REAL plasma stroke scores:
  REGION_STRIP_LEFT (width 391):   pixels 538   columns 168/391 = 43%   x-span 96%
  REGION_STRIP_MID  (width 283):   pixels  32   columns  16/283 =  6%   x-span 72%
```

This **overturned the first draft of the fix**, twice, and both reversals are the
point of having run it.

**First:** the intent had been to convert the sibling negative over
`REGION_STRIP_MID` to `columnCoverage` too. But a controls strip is not a stroke
— it is a row of discrete key glyphs — and in that very band a real one covers
**6%** of columns, *below* the 11% a single star scores. That conversion would
have exchanged a guard for one that could not tell a leaked strip from a star at
all. It passed the suite. It was wrong.

**Second, on reverting it to the original pixel count, it went red — at 352.**
That assertion was broken by a0-45 as well; CI never said so because the arc
assertion above it failed first and masked it. Measured in `REGION_STRIP_MID`:

| | `isBlueGlow` px | max `b - r` | max `b` | `isPlasma` |
|---|---|---|---|---|
| **sky alone**, on touch | **352** | **51** | **162** | 0 |
| a **real strip**, on desktop | 32 | 28 | 69 | 0 |

The sky is ten times the strip's pixels in that band, bluer than it, and brighter
than it. The old `< 40` bar is not merely noisy now — it is **inverted**: it
fails on empty sky and would have passed on the drawn strip it is named after.
No threshold and no predicate in `pixels.ts` orders those two rows the right way
round.

So the second assertion moved to the **layout registry**, which is exact where
the pixels are hopeless, and is the instrument the desktop test already uses in
the mirror direction:

```
TOUCH   ids: ship-local, touch-left-stick, touch-fire-button, build-button,
             build-badge, pause-button, ore-hud, banked-total, station-hp,
             onboarding, nameplates, minimap
DESKTOP ids: ship-local, build-badge, ore-hud, banked-total, controls-strip,
             station-hp, onboarding, nameplates, minimap, healthbars
```

`controls-strip` is published by the code that draws it, so a strip reaching
touch announces itself. The usual caveat — a registered element can be invisible,
which is the M1 miss this suite exists for — bites a *presence* check, not an
absence one.

## What is left standing, and is QA's to weigh

Three things this brief did **not** change, stated rather than buried:

1. **The strip check can no longer catch a strip drawn WITHOUT registering.**
   That is what moving to the registry costs. It buys an assertion that is exact
   instead of one that was inverted.
2. **The desktop strip PRESENT check** (`REGION_STRIP_LEFT`, `> 100 px`) can now
   be satisfied by sky. Stars only push a *present* check further past its bar, so
   it is a false-pass risk rather than a false-fail — the opposite failure mode,
   and not this brief's to change.
3. **`isBlueGlow` is no longer a safe predicate over any region that shows sky.**
   Two of its three call sites had to move. The third is the one in (2).
