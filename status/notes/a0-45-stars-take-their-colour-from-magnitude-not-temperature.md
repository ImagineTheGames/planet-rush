# a0-45 — the spike is too bright, and the colour comes from the wrong property

Branch `agent/art/a0-45-star-temperature-colour`. Working note; not evidence.

## BUILT

**`4c70f2e` — the colour half** (an earlier session of mine; verified green on
this one, `npx tsc --noEmit` clean and 5365 tests passing before I touched it).

- `starTemperature(rand)` + `starColorFor(temp)`, the design's two lines verbatim.
- `MOCKUP_STARS.ramp` and `starRampColor` **deleted**; `minMagnitude: 0.45` gone.
- The halo and the cross take the star's own colour. `BLOOM_TINTS` removed as
  redundant, and with it `StarInk`, `starInkFor` and `StarLayerSpec.inks`.
- `compliance.ts` learned `STAR_TEMPERATURE_COLORS` (new rule `star-only`).
- `peakP99` 46–53 → 42–48, re-derived over seeds.

**The spike half** (this session, uncommitted at time of writing → see NEXT).

- `spikePeakAlphaOf(intensity)` = `0.22 × intensity`, beside `haloPeakAlphaOf`.
- `starSpikeAlpha()` beside `starHaloAlpha()`; `backdrop.ts` uses it, so
  `alpha * SPIKE.intensity` is gone and `spike.intensity` with it.
- `spike.width` 0.5 → **0.7** (the design's own `ctx.lineWidth`).
- Two gates in `backdrop.test.ts`: the a0-44 size test, plus
  `…spike is dimmer than the halo…` and a field-level sibling.
- `sky-preview.ts`, the contact sheet, `docs/dark-matter-scan.md` and the
  allowlist follow.
- Evidence: `spike-main.txt` / `spike-a0-45.txt`, and `before/` `after/` plates
  including three single-star lenses that ARE the same star on both trees.

## DECISIONS

- **`starTemperature(rand)` takes the random source, not one uniform.** The
  design's line calls `r()` twice; one shared draw would cap the hot branch at
  0.901 and confine the cool branch to k ≥ 0.868, so neither endpoint the design
  paints would ever be drawn.
- **The brief's spike multipliers are 2× high, and the measured ones ship.** The
  brief says α 0.55, 5.2× too bright, spike : halo 2.72. That is `α × 0.55` with
  the star at α 1.0; `alpha.max` is 0.5, so `main` actually draws 0.2427–0.2728 —
  **2.30–2.58× the design, 1.20–1.35× its own halo.** Read off `main`'s own
  generator in a worktree (`spike-main.txt`), not off the formula. The defect,
  its direction and its fix are exactly as briefed; only the multiplier is
  smaller, and the inversion (cross brighter than glow) is real.
- **The p99 instrument is blind to the cross.** `sampleMockup` and `sampleShapes`
  composite fills only, and a spike is a stroke — so re-deriving `peakP99` after
  the spike change gives byte-identical numbers, and the gate for the spike had
  to be a relationship assertion rather than a luma one. Recorded on `peakP99`.
- **Single-star lens plates instead of a0-44's detail crops.** a0-45 shifts every
  seeded stream by two draws per star, so from the *second* star onward the two
  trees are different fields and no crop is like-for-like. A box that draws
  exactly one star is: x, y and magnitude are the first three draws.
- Rejected: re-fitting a derived knob to put the coloured field back in 46–53.
  Priced in `p99-sensitivity.ts` — `alpha.max` 0.5 → 1.0 moves it 0.83 of a luma.
  Only the MEASURED halo alpha could, at `0.42 × 0.624` against the preview's
  stated 0.48. That contradiction is the Director's and goes in the PR.

## NEXT

- Golden suite running (`tests/mobile/goldens.spec.ts`, 50 baselines) — the
  three `desktop-sky-*` goldens are literally this backdrop, so a re-baseline is
  expected. Look at every changed image, then decide re-baseline vs QA hand-off
  (a0-44's precedent: it moved zero pixels by the gate and left the call to QA;
  a colour change will not be so quiet).
- Commit the spike half, write `evidence/…/README.md`, push, open the PR with
  the two Director questions: **(1)** blue-white starlight vs plasma
  `#4dc3ff` — raw ink ΔE 16.5, composited star pixel ΔE 39.0, both under the
  ΔE 40 floor the bloom tints were held to; **(2)** `peakP99` 46–53 is exactly
  what a white-topped ramp measures, so either the design's own field was
  measured before `starColor` was applied or its bloom is brighter than
  `0.42 × 0.48`.
