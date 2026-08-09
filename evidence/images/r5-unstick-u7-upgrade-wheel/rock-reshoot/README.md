# r5-01 — the SECOND re-shoot: a3-01's rock palette

The parent directory records the *first* re-shoot of this branch's four
upgrade-wheel goldens, onto a1-01's repaired font constant. This directory
records the second, for a different cause: `a3-01` (PR #308) moved the rock
family to the boards' dark half, and the frozen scene these goldens are shot
against has rocks in it.

## Why a re-shoot was needed at all, when the suite was green

The full mobile suite passed on the merged result — 117 passed, exit 0,
**including all four upgrade-wheel goldens** at the gate's
`maxDiffPixelRatio: 0.01`. That pass was not evidence of freshness. Measured at
ZERO tolerance with the gate's own comparator
(`evidence/measure-golden-diff.mjs`, Playwright's bundled pixelmatch):

| baseline                        | frame    | differing px | of total | gate      |
|---------------------------------|----------|--------------|----------|-----------|
| `desktop-upgrade-wheel`         | 1280×800 | 4,856        | 0.47 %   | passed    |
| `desktop-upgrade-wheel-short`   | 1280×800 | 4,856        | 0.47 %   | passed    |
| `phone-landscape-upgrade-wheel` | 844×390  | 0            | 0.00 %   | unchanged |
| `phone-portrait-upgrade-wheel`  | 390×844  | 0            | 0.00 %   | unchanged |

Both desktop baselines were stale while green, spending ~half the tolerance
budget on a rock colour the code had already changed — leaving that much less
for the regression the gate exists to catch.

`a3-01` re-baselined the seven shared goldens its change showed in, including
`desktop-build-wheel` and `desktop-build-wheel-short`, the frames analogous to
these. It could not re-baseline these four: **they exist only on this branch.**

## Why only two of the four moved

The two desktop frames changed by an identical 4,856 px — they share one frozen
rock field and differ only in banked ore (99 vs 1), which recolours cost text,
not the board.

The two phone frames changed by nothing, and the reason is visible in the
frames: at 390 px the camera sits on the home planet and **no rock is in shot**.
A rock palette cannot move a frame with no rocks in it. Both were nevertheless
genuinely re-captured, not skipped — Playwright logged `A snapshot doesn't exist
… writing actual` for each, because the baselines were deleted first.

## `--update-snapshots` alone would NOT have re-shot these

On Playwright 1.49.1 that flag only rewrites a baseline whose comparison FAILS.
A baseline stale-but-inside-tolerance is, to the flag, correct — so the command
everyone reaches for is a no-op on exactly the staleness that matters. The
baselines were therefore **deleted first**, so Playwright regenerated them as
*missing* rather than diffing them as *matching*.

## What the diffs show

`diff-*.png` marks every differing pixel in red. In both, every red pixel lies on
an asteroid body, facet or ink at the left edge of the frame. Nothing else moved:
the wheel geometry, the four wedge labels, the stat lines (`50 → 60`,
`100% → 115%`), the `cost/held` numerals, the HUD, the onboarding banner and the
controls strip are all pixel-identical. Eyes were put on all six frames here plus
the two unchanged phone frames.

## Provenance and determinism

Shot on an isolated preview port, not the shared 4173 — on this box another lane
held 4173 serving `{"sha":"369d7a6"}`, and the committed config's
`reuseExistingServer` would have skipped this lane's build and shot every frame
against that bundle, silently and green. Provenance proved positively per run:

    $ curl -s http://localhost:4193/version.json  ->  {"sha": "fffb646", ...}
    $ git rev-parse --short HEAD                  ->  fffb646

Then captured a **second** time from a fresh build and compared the two captures
directly: all four **byte-for-byte identical** (sha256 match). A zero-tolerance
re-run only shows the comparator is satisfied; a sha match shows the capture is
deterministic.
