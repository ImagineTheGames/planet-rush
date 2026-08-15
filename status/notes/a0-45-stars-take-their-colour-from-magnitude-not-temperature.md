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

## NEXT

- **Resumed 2026-08-15.** The lane's local branch pointer was sitting on `main`
  (`12303a0`) while all nine commits of work were already on `origin`; reset to
  the remote branch rather than rebuilding anything. Nothing was lost — the six
  "local-only" commits were main's own.
- **Merged `origin/main` again** (a0-49, sound-only: `src/art/audio/`,
  `sound-review/`, `docs/`). Clean, and it touches nothing that renders, so the
  43 re-baselined goldens still describe this tree.
- `npx tsc --noEmit` green on the merged tree. Full `npm test -- --run` running.
- Then: push and open the PR with the two Director questions:
  **(1)** blue-white starlight vs the beacon ring `#4dc3ff` — ΔE 39.0 on the
  composited pixel, 16.5 on the raw ink, against the studio's ΔE 40 floor;
  **(2)** `peakP99` 46–53 is exactly what a white-topped ramp measures, so either
  the design's field was measured before `starColor` was applied or its bloom is
  brighter than the `0.42 × 0.48` a0-44 read off it.
  (A third, raised by §1.2 rather than the brief: the amber 22% comes within
  ΔE 25.6 of `oreDeep`, the closest the backdrop has come to RESERVED yellow.)
