# a0-44 — the star bloom is smaller than its own spikes

Branch `agent/art/a0-44-star-bloom-radius`. Working note; not evidence.

## BUILT

- `35903f7` **the fix.** `MOCKUP_STARS.bloom.radius` 4.3 → **11.24**,
  `spike.length` 5.2 → **6.9688**, halo peak alpha → **0.2016 absolute** (was
  `starAlpha × 0.48`). Each number now has the design's own rule beside it in
  `mockup-reference.ts` — `haloRadiusOf`, `haloPeakAlphaOf`, `haloKneeAlphaOf`,
  `spikeLengthOf` — plus `starHaloAlpha()` so the game and the design panel share
  one definition. **The falloff did not match either**, see DECISIONS:
  `Falloff.curve` (`'smooth' | 'halo'`) added to the IR; `inkAlphaAt`, the ramp
  texture and the SVG sheets dispatch on it; the star halo is the only `halo`.
- `d435807` **the gate.** `backdrop.test.ts` asserts *"the halo is wider than its
  own spikes"* by name, refuses main's 4.3/5.2 in the same test, asserts every
  derived number against its RULE, and checks no spike arm escapes its halo on
  the field the game actually builds. `backdrop-bloom.test.ts` had the inequality
  **upside down** and green — inverted, with the reason in the comment.
- `e030e60` sprite contact sheet re-baked (halos r 10.45 → 27.3, 16 stops → 3).
- `b7cf22d` dark-matter: the four rules are SURFACE (allowlist + §4.6), same
  shape as a0-40's `MOCKUP_GROUND`.
- `5332ea6` / `545527d` / `da0e51f` evidence: `audit.txt`, 18 plates
  (before from a main worktree), four live 1280×800 golden frames, and
  `gate-against-main.txt` — **main 0/5, this branch 5/5**.

Verified: `npx tsc --noEmit` clean; `npm test -- --run` **293 files / 5335
tests, all passing**; `npm run dark-matter:check` clean; mobile goldens **50/50
green, baselines untouched**.

## DECISIONS

- **The 0.35 stop is NOT `falloffProfile`, and the p99 settles it.** Brief step 3
  said check rather than assume. Design stops `1 / 13-42 / 0` linear; `(1−t²)²`
  is at 0.77 where the design is at 0.31, and carries **1.85×** the light over
  the disc. Corrected field drawn `smooth`: p99 **66.9** against the design's
  **46–53**; drawn on the design's stops: **47.9**. Rejected: widening `peakP99`
  (measured design data, not mine), and an equal-mass halo at 8.26 r (the brief
  pins 11.24).
- **A second ramp texture, not a re-shaped `falloffProfile`.** The nebulae are
  right — *"the nebulas look good though"* — and a0-39's one-smooth-curve
  argument still holds for bodies. Two 256 KB uploads for the process; no new
  batch (halos are already their own `Graphics`).
- **`radius: 11.24` stays a literal in the data file** (the file's convention,
  and the DoD greps it), with the rule stated next to it and the equality
  asserted in CI. A comment cannot fail; the test can.
- **The p99 gate asserts the design band on the DESIGN's panel** and holds the
  game's panel within 5% of it. All of the 1.96 gap is the a0-22 bloom tint
  (untint the halos and the game reads 47.86). Reported, not absorbed.
- **No golden re-baseline.** main vs this branch counts **0.000%** different
  pixels by `toHaveScreenshot`'s own rule (its default `threshold: 0.2` cannot
  see a per-pixel luma difference under 52.8 of 255), so there is nothing to
  re-take. The committed `desktop-frozen` baseline is separately stale — it still
  holds a **pre-a0-40** frame and passes at 0.830% under the 1% ratio. That is
  a0-40's gap; re-baselining it here would fold another brief's drift into this
  PR, so it is reported with the evidence instead.
- **`starHaloRadius` dropped.** Wiring it into `starFieldSprite` would have left
  `BLOOM` itself uncalled by production — one dark export traded for another.

## NEXT

- PR open; nothing outstanding on the brief. Watch CI (unit + mobile shards).
- For the Director, in the PR body: the two CARRIED values (`spike.width`,
  `spike.intensity` — the quoted preview states neither), the tint's new cost,
  the golden-gate blindness, and the fill-rate note (halo area ×6.8 ⇒ ~0.3 of a
  screenful of extra backdrop fill; geometry and draw calls unchanged).
