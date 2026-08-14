# a0-44 — the star bloom is smaller than its own spikes

Evidence for `agent/art/a0-44-star-bloom-radius`. Everything here is reproducible
from the repo; nothing is a screenshot of something that no longer exists.

The developer, in a live match: *"the stars look super WEIRD, none of them have
the bloom effect, and some of these with the lil crosshair looking things were
not in the mockup"* — and, on the same frame, *"the nebulas look good though"*.

## `audit.txt` — the arithmetic, and the number that settles the falloff

```sh
npx vite-node evidence/a0-44-star-bloom-radius/audit.ts
npx vite-node evidence/a0-44-star-bloom-radius/panels.ts
```

`audit.ts` prices every candidate rule on the design's own instrument (a 320×180
point-sample grid over a 640×360 panel, `sky-preview.ts` `measure`). `panels.ts`
puts the design's panel and the game's own next to each other and subtracts the
a0-22 bloom tint, which is where the last two points of p99 go.

The four rows that matter, and the reason the falloff curve is part of this
brief at all:

| rule | p99 | the design says |
|---|---|---|
| shipped — 4.3 r, α×0.48, `falloffProfile` | 49.41 | 46–53 |
| **radius only** — 11.24 r, α×0.48, `falloffProfile` | 70.26 | ✗ |
| radius + absolute alpha, `falloffProfile` | 66.88 | ✗ |
| **the design** — 11.24 r, absolute 0.2016, its own three stops | **47.88** | ✓ |

The shipped row is *in band* with both numbers wrong, which is exactly why a
value assertion never caught this: two compensating errors (a halo a sixth of the
intended area, at 1.2× the intended peak) land near the right total light while
drawing entirely the wrong thing.

## `before/` and `after/` — plates, at the design's own panel size

```sh
npx vite-node evidence/a0-44-star-bloom-radius/shoot.ts after
```

There is no browser on the plain-node side of this container, so the plates go
through a0-40's `plate.ts` — a plain-TS PNG rasterizer over `inkAlphaAt`, the one
definition of "how bright is this ink here" that `backdrop.test.ts` and
`sky-preview.ts` also use. A plate cannot flatter the build.

`before/` is the **same file** run inside a `main` worktree:

```sh
git worktree add /tmp/a044-main main
ln -s "$PWD/node_modules" /tmp/a044-main/node_modules
mkdir -p /tmp/a044-main/evidence/a0-44-star-bloom-radius
cp evidence/a0-44-star-bloom-radius/shoot.ts /tmp/a044-main/evidence/a0-44-star-bloom-radius/
(cd /tmp/a044-main && npx vite-node evidence/a0-44-star-bloom-radius/shoot.ts before)
```

- `<sky>.png` — six full panels, the whole stack in composite order. The skies
  are byte-for-byte the same art in both sets; only the stars over them move.
- `detail-1..3.png` — **5× enlargements of the three widest-haloed stars in the
  panel**, the same three stars in both sets. This is the report, visible:
  *before*, a small tight glow with the diffraction cross sticking out well past
  it — a crosshair with a dot in it. *After*, a wide soft glow with the cross
  contained inside it, which is what the design draws.

| | before (`main`) | after |
|---|---|---|
| halo radius, `detail-1`'s star (r 2.43) | 10.45 px | 27.32 px |
| spike arm | 12.64 px | 16.94 px |
| halo vs spike | **0.83×** — the cross is outside | **1.61×** — inside |
| halo peak alpha | 0.2118–0.24 (per star) | 0.2016 (every star) |
| halo falloff | `(1 − t²)²` | the design's three stops |
| star p99, design panel | 49.41 | 47.88 |

## `goldens/` — the frozen scene in the real game, and why no baseline moved

Four PNGs, all 1280×800, all of the desktop frozen scene (`/?debug=1&freeze=1`),
taken in this container against the real preview build:

| file | what it is |
|---|---|
| `desktop-frozen-live-MAIN.png` | the live game on `main` — a field of sharp four-pointed crosses with no glow on any of them |
| `desktop-frozen-live-a0-44.png` | the same frame on this branch — the same stars, glowing, with the crosses inside the glows |
| `desktop-frozen-ACTUAL-a0-44.png` | what Playwright's own harness captures on this branch |
| `desktop-frozen-COMMITTED-baseline.png` | the baseline `tests/mobile/` holds today |

**The mobile golden suite is green, all 50, with the baselines untouched** — and
the reason is worth stating as a number rather than as a shrug, because it is the
second time this backdrop has run into it (a0-18: *"a golden is the wrong
instrument for this and always was"*).

`toHaveScreenshot` counts a pixel as different when its YIQ delta exceeds
`35215 × threshold²`; at Playwright's default `threshold: 0.2` that is a
**per-pixel luma difference of 52.8 of 255**. Nothing fainter is visible to the
gate at any coverage. Measured on these four frames:

```
  baseline vs main (live)     pixelmatch 0.830%   (>8 luma: 4.24%)
  baseline vs this branch     pixelmatch 0.821%   (>8 luma: 11.83%)
  main vs this branch         pixelmatch 0.000%   (>8 luma: 0.41%)
```

Two things follow, and only one of them is a0-44's:

1. **This change moves no golden.** `main` vs this branch counts **zero**
   different pixels by the gate's own rule, so there is nothing to re-baseline —
   a bloom is a wide, faint wash and every pixel of it is under 52.8.
2. **Reported, not absorbed:** the committed baseline is holding a **pre-a0-40**
   frame — sparse stars on the old near-black ground — and passes at 0.830% only
   because it sits under the 1% ratio. That is a0-40's re-baseline gap, not this
   brief's, and re-baselining it here would fold another brief's drift into this
   PR. `desktop-frozen-live-MAIN.png` is the evidence; the call is QA's.

## What is NOT in these plates

The skies. a0-40's numbers are untouched — *"the nebulas look good though"* — and
the plate pairs are the check on that: the nebula structure in each `before` /
`after` pair is identical.
