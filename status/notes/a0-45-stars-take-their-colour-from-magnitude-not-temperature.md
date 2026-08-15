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
- **Note for a future session:** this file exists twice — tracked in the repo at
  `status/notes/`, and untracked at the absolute `/status/notes/` the brief names.
  Keep both; the repo copy is the one that survives in git.

## SESSION OF 2026-08-15 (fourth) — CI answered, and the answer was the Director question

**No golden failed.** What failed is a0-23's negative assertion, on **both touch
profiles** (shards 2/6 `pixel` = 79 px, 3/6 `iphone` = 94 px, bar `< 40`):

```
the stick zone no longer wears plasma (a0-23)
expect(received).toBeLessThan(expected)   Expected: < 40   Received: 79
```

**This is the brief's own question, answered by a machine instead of by eye.**
The brief asked whether *"a blue star at luma ~200 can be confused with a
friendly marker at a glance"*. It can: the repo's own plasma detector cannot tell
them apart, and it is not close.

- `isBlueGlow` is `b - r > 20 && g - r > 8 && b > 38` (`tests/mobile/pixels.ts`).
- The faint plasma ring it exists to catch is (25,48,63) — **`b - r` 38**.
- A bloomed hot star composited over vacuum is (68,86,110) — **`b - r` 42**.
- **The star is the bluer of the two.** No threshold rejects the star without
  first rejecting the ring.

**Proved by reading the pixels, not by reasoning.** `evidence/…/blue-probe/`
reproduces the failing sample exactly (same boot, same screenshot, same
`affordanceArcRegion`) and prints every match. The 79 are **one star**: an
11×10 px radially-symmetric disc, `isPlasma` 0, colours running (34,43,56) →
(107,121,139). Solving the composite against vacuum gives alpha 0.374 / 0.370 /
0.380 from the r/g/b channels independently — three decimals of agreement with
`rgb(160,205,255)`, the design's hot star at t=1. The same probe on a `main`
worktree measures **0**.

## DECISIONS (fourth session)

- **The fix goes in QA's probe, not in the sky.** Precedent is exact and is the
  same brief this assertion is named after: `dfd3304` *"test(a0-23): QA's touch
  probe was keyed on the plasma this brief removes"* changed both `pixels.ts` and
  `emulation.spec.ts` when an art change invalidated the predicate — *"the probe
  encoded the old look, so it had to move with it"* — and landed it as **a commit
  of its own** because they are QA's files. Same shape here. Desaturating the sky
  to satisfy a test is precisely what this brief exists to undo.
- **Assertion 1, the stick arc: shape, not colour — measured, not assumed.** The
  arc band was chosen (a0-23) because it is *almost entirely ring*. So a ring
  crosses it and a star sits in it. Measured in that band on the Bone ring that is
  actually drawn — the same geometry the plasma ring had — coverage is **101/101
  columns**; one bloomed star is **11/101**. `columnCoverage()` in `pixels.ts`,
  threshold `STROKE_COLUMN_RATIO = 0.5`, the midpoint of a 9× gap.
- **Assertion 2, `REGION_STRIP_MID`: the probe reversed me twice, and that is
  why it was run.** First draft converted it to `columnCoverage` too — it passed
  the suite and was **wrong**: a strip is a row of glyphs, not a stroke, and a
  real one covers 16/283 = **6%** of that band's columns, *below* a single star's
  11%. Reverting it to the original pixel count then went **red at 352** — so
  a0-45 had broken this assertion as well, and CI never said so because the arc
  above it failed first and masked it.
- **That band cannot carry a colour assertion at all any more.** Sky alone: 352
  px, max `b-r` 51, max `b` 162. A real strip: 32 px, 28, 69. `isPlasma` is 0 over
  both. The sky is more of it, bluer than it and brighter than it — so the old
  `< 40` bar is not noisy, it is **inverted**: it fails on empty sky and would
  have passed on the drawn strip it names. Moved to the **layout registry**
  (`controls-strip` is published by the code that draws it; present on desktop,
  absent on touch) — exact where the pixels are hopeless, and the same instrument
  the desktop test already uses in the mirror direction. Cost, stated in the PR:
  it can no longer catch a strip drawn *without* registering.
- **The desktop strip PRESENT check was left alone** (`REGION_STRIP_LEFT`,
  `> 100 px`). Stars can only push a *present* check further past its bar, so the
  risk there is a false pass, not a false fail — a real weakness, but the opposite
  failure mode, and not this brief's to change.

## NEXT (fourth session)

- `npx tsc --noEmit` clean; `npm run dark-matter:check` clean; `emulation.spec.ts`
  **7 passed / 5 skipped** on all three profiles (iphone, pixel, desktop) — the
  same counts a0-23 recorded.
- The QA-file change is its own commit (`6eb9dda`), per the a0-23 precedent;
  evidence + note in `a943b7e`.
- **DONE. CI fully green and PR #424 is MERGED** into `main` as `c48a893`
  (2026-08-15 17:40 UTC). All six mobile shards pass — including 2/6 and 3/6,
  the two that were red — plus both perf gates and typecheck/test/build. All six
  code DoD greps re-verified against `origin`.
- Nothing is left open on this brief. The three items handed to QA (a strip drawn
  without registering is no longer caught; `REGION_STRIP_LEFT`'s PRESENT check can
  be satisfied by sky; `isBlueGlow` is unsafe over any region showing sky) are
  recorded in the PR body and in `evidence/…/blue-probe/README.md`, and are theirs
  to weigh — not blockers here.
