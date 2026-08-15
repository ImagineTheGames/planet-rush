# a0-45 — the spike is too bright, and the colour comes from the wrong property

Branch `agent/art/a0-45-star-temperature-colour`. Working note; not evidence.

## BUILT

**`4c70f2e` — the colour half.** `starTemperature(rand)` + `starColorFor(temp)`,
the design's two lines verbatim. `MOCKUP_STARS.ramp` and `starRampColor`
**deleted** (`minMagnitude: 0.45` with them). The point, the halo and the cross
all take the star's own colour. `BLOOM_TINTS` removed as redundant, and with it
`StarInk`, `starInkFor` and `StarLayerSpec.inks` — a layer is a depth, never a
palette. `compliance.ts` learned `STAR_TEMPERATURE_COLORS` and the rule
`star-only`. `peakP99` 46–53 → 42–48, re-derived over seeds.

**`dbd9fdd` — the spike half.** `spikePeakAlphaOf(intensity)` = `0.22 ×
intensity` beside `haloPeakAlphaOf`; `starSpikeAlpha()` beside
`starHaloAlpha()`, and `backdrop.ts` uses it, so `alpha * SPIKE.intensity` is
gone and `spike.intensity` deleted with it. `spike.width` 0.5 → **0.7**. Two
named gates in `backdrop.test.ts` (the constants, and the shapes the field
emits), each with its refusal of `main`'s own numbers.

**`6ee36bd` — evidence.** `spike-on-main.ts` reads the cross off
`starFieldSprite`'s output and runs unchanged on both trees; `shoot.ts` →
`before/`/`after/`, six panels per tree plus three single-star lenses that are
the *same* star on both; `audit.ts`, `p99-over-seeds.ts`, `p99-sensitivity.ts`,
`golden-delta.mjs`.

**`1fe3554` — the contract, and a boot cost.** `style-guide.md` **§1.2** writes
the carve-out down where §1 lives: the rule, the four hard limits, the two
Director questions with their numbers. And `STAR_TEMPERATURE_COLORS` stopped
being a 1e-5 sweep — 105k calls at module load, in the *shipped* bundle
(verified in `dist/assets/main-*.js`), for a set only the audit reads. Now
enumerated from the channels' own rounding breakpoints: ~200 evaluations,
exhaustive by construction, identical 117 colours against a 1e-6 reference.

**Merged `origin/main`** (a0-47 thruster trail, a0-48 ambient bed) before
re-baselining, so the goldens capture the merged render and not a stale one.

## DECISIONS

- **`starTemperature(rand)` takes the random source, not one uniform.** The
  design's line calls `r()` twice; one shared draw would cap the hot branch at
  0.901 and confine the cool branch to k ≥ 0.868, so neither endpoint the design
  paints would ever be drawn.
- **The brief's spike multipliers are 2× high, and the measured ones ship.** The
  brief says α 0.55, 5.2× too bright, spike : halo 2.72. That is `α × 0.55` with
  the star at α 1.0; `alpha.max` is 0.5, so `main` actually draws 0.2427–0.2728 —
  **2.30–2.58× the design, 1.20–1.35× its own halo.** Read off `main`'s own
  generator (`spike-main.txt`), not off the formula. The defect, its direction
  and its fix are exactly as briefed; only the multiplier is smaller, and the
  inversion (cross brighter than glow) is real.
- **The p99 instrument is blind to the cross.** `sampleMockup`/`sampleShapes`
  composite fills only, and a spike is a stroke — so re-deriving `peakP99` after
  the spike change gives byte-identical numbers, and the spike's gate had to be a
  relationship assertion rather than a luma one. Recorded on `peakP99`.
- **`peakP99` moved DOWN because the deleted ramp's top band was WHITE.** Nothing
  in the design's sky is white (its stars are Y′ 186–205), so painting the field
  the design's own colours takes luma off the panel. 46–53 is what a white-topped
  ramp measures. Not absorbed by re-fitting a derived knob: priced in
  `p99-sensitivity.ts` (`alpha.max` 0.5 → 1.0 moves it 0.83 of a luma), so only
  the *measured* halo alpha could, at `0.42 × 0.624` against the preview's stated
  0.48. That contradiction is the Director's and is in the PR.
- **Single-star lens plates instead of a0-44's detail crops.** a0-45 shifts every
  seeded stream by two draws per star, so from the *second* star onward the two
  trees are different fields and no crop is like-for-like. A box that draws
  exactly one star is: x, y and magnitude are the first three draws.
- **The golden re-baseline runs at `maxDiffPixelRatio: 0` on a private port.**
  The shipped tolerance cannot see this change (a0-44 measured its own halo
  correction at 0.000% by Playwright's own rule), so a run at 0.01 would rewrite
  nothing and report success. The tolerance edit is local and reverted; the port
  is 4245 with `reuseExistingServer: false`, because the lanes share this box and
  4173 could be serving another lane's bundle. See
  `evidence/…/goldens-rebaseline.md`.

**`58e6695` / `dcdde68` — the goldens.** 43 of 50 re-baselined at
`maxDiffPixelRatio: 0` on a private port, every frame opened and read, all 43
accounted for in `goldens-rebaseline.md`. Nothing is over the shipped gate (max
0.909% against 1%), which is the point: at 0.01 this change can neither fail a
golden nor re-baseline one. **Three inherited moves are named**: the build-hash
watermark, the CODEX subtitle, and a0-30's settings defaults (MANUAL → AUTO-AIM,
KEYBOARD + MOUSE → TAP COMMANDER) — the last verified in `src/main.ts` as a
device-independent default rather than something this container sniffed. The
baselines are their own commit so they can be dropped alone if CI's renderer
disagrees.

**`58e3b5b` — both gates, failing on `main` on their merits.** The brief requires
it and it had been asserted rather than shown. `gates-on-main.ts` runs the two
assertions against **main's own API** — `starRampColor` paints 3 colours over 6
magnitudes, its one argument IS the magnitude, and main's cross is 1.20–1.35× its
halo where the gate needs < 1. Dropping this branch's `backdrop.test.ts` into a
main worktree also fails, but at `starColorFor is not a function`, which proves
only that the branch added a symbol.

## DECISIONS (continued)

- **The fail-on-main proof is run against main's API, not by porting the test
  file.** A missing-symbol `TypeError` is a pass/fail accident of the import
  graph; the gate is worth something only if the state it refuses is the state
  that shipped. Both are recorded — the `TypeError` verbatim in the README, and
  the substantive failure in `gates-on-main.txt`.

## NEXT

**Everything in the brief is built, committed, pushed and in a PR. What remains
is CI.**

- **Session of 2026-08-15 (third) — the PR is open: [#424](https://github.com/ImagineTheGames/planet-rush/pull/424).**
  The branch was already complete and pushed; this session verified it and
  shipped it.
  - `npx tsc --noEmit` — **clean**.
  - `npm test -- --run` on the merged tree — **294 files, 5380 tests, all
    passing**, 656s. This was the one thing the previous session had left
    unrun.
  - All six code DoD greps **pass against `origin`**, re-checked.
  - The before/after plates re-read with my own eyes: `star-1` is amber with the
    cross now *inside* its glow where `main` drew a hard grey cross over a faint
    one; `star-2` is the blue-white half of the same; `none.png` is a
    two-temperature field against `main`'s grey-and-white one. The change is what
    the brief describes.
  - PR body carries all three Director questions with their numbers, the
    `peakP99` re-derivation, the brief's-multiplier-is-2×-high correction, and
    the golden accounting.
- **Only CI is left.** If a golden fails on CI's renderer, `dcdde68` is the
  baselines alone and can be dropped without touching the fix.
- **Note for a future session:** this file exists twice — tracked in the repo at
  `status/notes/`, and untracked at the absolute `/status/notes/` the brief names.
  Keep both; the repo copy is the one that survives in git.
