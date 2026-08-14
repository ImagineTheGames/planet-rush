# a0-44 — the star bloom is smaller than its own spikes

Branch `agent/art/a0-44-star-bloom-radius`. Working note; not evidence.

## BUILT

- `35903f7` **the fix.** `MOCKUP_STARS.bloom.radius` 4.3 → **11.24**,
  `spike.length` 5.2 → **6.9688**, halo peak alpha → **0.2016 absolute** (was
  `starAlpha × 0.48`). Each number now has the design's own rule beside it in
  `mockup-reference.ts` — `haloRadiusOf`, `haloPeakAlphaOf`, `haloKneeAlphaOf`,
  `spikeLengthOf` — plus `starHaloRadius` / `starHaloAlpha` so the game and the
  design panel share one definition.
  Also: **the falloff shape did not match**, see DECISIONS. `Falloff.curve`
  (`'smooth' | 'halo'`) added to the IR; `inkAlphaAt`, the ramp texture and the
  SVG sheets dispatch on it; the star halo is the only `halo` in the art.
- `d435807` **the gate.** `backdrop.test.ts` asserts *"the halo is wider than
  its own spikes"* by name, refuses main's 4.3/5.2 in the same test, asserts
  every derived number against its RULE, and checks no spike arm escapes its
  halo on the field the game actually builds. `backdrop-bloom.test.ts` had the
  inequality **upside down** and green — inverted, with the reason.
- `e030e60` the sprite contact sheet re-baked (halos r 10.45 → 27.3, 16 stops →
  the design's 3).

## DECISIONS

- **The 0.35 stop is NOT `falloffProfile`, and the p99 is what settles it.**
  Brief step 3 said check rather than assume. Design stops `1 / 13-42 / 0`
  linear; `(1−t²)²` is at 0.77 where the design is at 0.31, and carries **1.85×**
  the light over the disc. On the design's instrument the corrected field drawn
  `smooth` reads p99 **66.9** against the design's stated **46–53**; drawn on the
  design's stops, **47.9**. Rejected: widening `peakP99` (it is measured design
  data, not mine), and an equal-mass halo at 8.26 r (the brief pins 11.24).
- **A second ramp texture, not a re-shaped `falloffProfile`.** The nebulae are
  right — *"the nebulas look good though"* — and a0-39's argument for one smooth
  body curve still holds for bodies. Two 256 KB uploads for the process; no new
  batch, because the halos are already their own `Graphics`.
- **`radius: 11.24` stays a literal in the data file** (the file's convention,
  and the DoD greps it), with the rule stated next to it and the equality
  asserted in CI. A comment cannot fail; the test can.
- **The p99 gate now asserts the design band on the DESIGN's panel** and holds
  the game's panel within 5% of it. All of the 1.96 gap is the a0-22 bloom tint
  (measured: untint the halos and the game reads 47.86). Reported, not absorbed.

## NEXT

- Playwright goldens: browsers are at `/ms-playwright`, so re-baseline **in this
  container** and look at every changed image. Expect the sky panels and the
  frozen scenes to move; nothing else should.
- Evidence plates (a0-40's `plate.ts` approach) + `audit.txt` committed under
  `evidence/a0-44-star-bloom-radius/`.
- PR body: the four moved values, the two CARRIED (`spike.width`,
  `spike.intensity` — the quoted preview states neither), the tint's new cost,
  and the fill-rate note (halo area ×6.8 → ~32% of a screenful).
