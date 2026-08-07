# a3-01 — the rock family against the boards

OWNER: Art Agent · brief `a3-01-rock-palette-vs-board` · branch
`agent/art/a3-rock-palette-vs-board`

a2-08's `art-vs-board-scene` failed on two measured pixels. This directory is what
the fix was judged on: the same frozen world shot from **two builds** — `main`
(`369d7a6`) and this branch — plus the readback that turns "looks darker" into a
number.

## What is here

| | |
|---|---|
| `capture-rock-field.mjs` | shoots the frozen arena from a running preview, segments the rocks out of the frame, crops each at 6×, and reports luma + WCAG contrast per rock |
| `before/`, `after/` | its output for the two builds — full frames at desktop 1280×800 and phone landscape 844×390 dpr3, per-rock 6× crops, `readback.json` |
| `palette-readback-rock.json` | the ROCK regions of the QA Manager's `evidence/probe-art-palette.mjs`, run against this branch |
| `playwright.a3.config.ts` | the golden suite on a port this lane owns — see "the shared-port trap" |
| `verify-served-build.mjs` | asserts a preview port is serving THIS tree before anything is shot against it |

## The numbers

Exact fills, `evidence/images/live/scene-field-crop.png` vs
`docs/art-direction/scene-gallery.html` (the mining-run scene), RGB distance:

| | live before | live after | board | distance after |
|---|---|---|---|---|
| body | `#939BA5` L154 | `#484E57` L77 | `#454E59` L77 | **4** |
| facet | `#5A626B` L97 | `#40474F` L70 | `#3E4750` L69 | **2** |
| ink | `#2D3239` L49 | `#272C32` L43 | `#262C34` L43 | **2** |

The probe reads the ink back as two values, `#24292F` (L40) and `#2A2F36` (L46),
which bracket the board's L43. That is not drift: the rim is stroked at alpha 0.9, and
those two hexes are *exactly* `#272C32` composited over Vacuum and over the body. The
board strokes at full opacity and so sits between them.

What the darkening buys, and what it costs, both measured on the rock's own pixels:

| | before | after | board |
|---|---|---|---|
| body vs Vacuum (WCAG) | 6.78 | **2.27** | 2.26 |
| signal yellow vs body | 1.89 | **5.63** | 5.67 |

The rock gives up contrast against space — down to the board's own figure, by
construction — and the ORE more than triples its contrast against the rock. That is the
trade the boards make, and it is the right way round: a player judges a payout before
committing fire (style-guide §6), and the thing that has to read is the yellow.

## Running it

```
npx vite build
npx vite preview --port 4287 --strictPort &
A3_PREVIEW_PORT=4287 node evidence/a3-rock-palette/verify-served-build.mjs
EVIDENCE_BASE_URL=http://localhost:4287 OUT=after node evidence/a3-rock-palette/capture-rock-field.mjs
```

`before/` was produced the same way from a `main` build served on its own port.

## The shared-port trap

`playwright.config.ts` pins the preview to **4173** with `reuseExistingServer: !CI`,
and in this studio container that port is shared with the other lanes. A build-wheel
golden re-shot during this brief came back byte-identical to its old baseline because
**lane-3's** `vite preview` held 4173 and Playwright reused it — the frame was a
different branch's build, and nothing in the run said so.

`playwright.a3.config.ts` is the same suite (same `testDir`, same project names, so
the same snapshot files) on port 4287 with `reuseExistingServer: false`;
`verify-served-build.mjs` reads the served bundle back and asserts the new `rockBody`
integer is in it and the old one is not. Anyone re-shooting a golden in a shared
container should run that check first.

Second trap, same area: `--update-snapshots` only rewrites a baseline whose diff
EXCEEDS `maxDiffPixelRatio`. The two desktop BUILD WHEEL goldens show the rock field at
0.71% of the frame against a 1% tolerance, so they passed and kept a stale pale-rock
baseline. They had to be deleted and regenerated. A sweep for the old `#939BA5` fill
across all 31 baselines is what found them.
