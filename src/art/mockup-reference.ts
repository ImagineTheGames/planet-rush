/**
 * src/art/mockup-reference.ts — **the design's own numbers, committed as data.**
 * OWNER: Art Agent. *(a0-40)*
 *
 * ## Read this before you change anything in it
 *
 * **This file is the design. Nothing here may be "tuned."** A change to a number
 * below is a change to the backdrop the developer ratified, and it needs the
 * developer — not a measurement, not a ceiling, and not an art opinion. Every
 * other file in `src/art/` that touches the void reads *from* here; nothing
 * writes back.
 *
 * That sentence is the whole point of the file, and it exists because of what
 * happened without it.
 *
 * ## Why it exists
 *
 * Six reports on one subject — *"bloom orbs gone"*, *"bloom moving with the
 * camera"*, *"no stars in them"*, *"nothing like the nebula concepts"*, *"all of
 * the nebula backgrounds are wrong"*, and finally, with the two rendered side by
 * side, *"the mockup still looks a million times better"*. The first five were
 * each treated as a rendering bug. None of them was.
 *
 * `sky-preview.ts` settled it by putting three full backdrops next to each other,
 * each from its real source: the mockup's own numbers; the shipping
 * {@link VoidBackdrop} through its real API on the real Pixi path; and the
 * mockup's numbers emitted as the game's own `Shape`s and painted by the game's
 * own `drawSprite`. Luma, 320×180 sample, `lift` = mean above each panel's own
 * ground:
 *
 * ```
 *   sky            mockup lift   game today   ported
 *   Coalsack           4.55         0.02       5.12
 *   Iron Veil          5.03         0.81       3.20
 *   Patina Drift       6.94         0.92       5.42
 *   Plasma Reef        9.97         0.53       9.20
 *   Deep Ember         3.80         0.91       1.57
 * ```
 *
 * **The third column is the finding.** The shipping renderer, handed the mockup's
 * numbers, reproduces the mockup. The ramp texture was never the problem, the
 * blend modes were never the problem, and the falloff curve was never the
 * problem. *The numbers drifted, and no gate ever compared the output to the
 * design.* Five briefs tuned the parameters further from the design while proving
 * the renderer worked, because the only things CI could see were the ceilings —
 * `peakLuma`, `overdraw`, `SKY_ALPHA_MAX` — and every one of those rewards a
 * darker sky. Nothing anywhere pulled the other way.
 *
 * So the design is now a committed artefact with a test against it
 * (`backdrop.test.ts`, `MOCKUP_REFERENCE`), and the ceilings are derived *from*
 * it rather than the art being derived from the ceilings.
 *
 * ## The three divergences it closes, which compound
 *
 * ```
 *                    mockup      game before a0-40
 *   ground luma        9.1            1.9        ← 4.8× darker
 *   star peak (p99)    46–53          7–9        ← ~6× dimmer, and 16× too few stars
 *   nebula lift        3.8–10.0       0.02–0.92  ← fainter again, on top of both
 * ```
 *
 * The whole stack was ~5× darker than the design, which is why the developer's
 * third report said *"these are all 1 color, there are no stars in them"*. The
 * stars were drawn. Nothing in the backdrop got above luma 9.
 *
 * ## What is measured here and what is derived
 *
 * Honest bookkeeping matters more in this file than anywhere else in the art, so
 * each number says which it is:
 *
 *  - **Measured off the design preview** (and therefore frozen): every sky's
 *    element count, radius range, alpha range and `dust` flag; the ground hex;
 *    the star count; the bloom rule, its threshold and its intensity; and each
 *    sky's target `lift`.
 *  - **Derived, and stated as derived**: the *placement* of elements within a
 *    field (the measurement counted and sized blobs, it did not record where they
 *    sat), each sky's hue pair, and the star magnitude/alpha curve — recovered by
 *    fitting the design's own stated `p99` on the design's own instrument. Each
 *    of those carries a note saying so at its declaration.
 *
 * ## The panel these numbers are in
 *
 * Everything is quoted against the design preview's own panel — {@link
 * MOCKUP_PANEL}, 640×360 — and radii are stated as a fraction of its **width**,
 * because that is the fit that comes out round on all three structures
 * (`0.18/0.38`, `0.10/0.26`, `0.16/0.26`; against a short-side fit that comes out
 * at `0.3194/0.6750` and friends). The game is landscape-locked (GDD §4.6), so
 * "the viewport's width" is always the long side and the mapping is unambiguous.
 * Sizes are per **screenful**, never per arena — see `NebulaSpec.build` for why
 * that distinction once put an evidence frame on record with no reef in it.
 */

import { mulberry32 } from '@shared/types';
import { DERIVED, PALETTE, WHITE } from './palette';

// ---------------------------------------------------------------------------
// The panel and the ground
// ---------------------------------------------------------------------------

/**
 * **The design preview's panel.** Every radius fraction and every element count
 * below is per one of these. 16:9, which is the shape the game plays in.
 */
export const MOCKUP_PANEL = { w: 640, h: 360 } as const;

/**
 * **The ground: `#070910`** — measured, frozen.
 *
 * Luma Y′ **9.08**. The shipped ground was Floor `#010204` at Y′ 1.9, and the
 * gap is the first of the three divergences: everything composited over a ground
 * five times too dark arrives five times too quiet, whatever else it does right.
 *
 * It is still not a seventh hue and still not a replacement for Vacuum — the
 * same cool blue-black, at a value between Floor and Vacuum (15.7). `./tokens`
 * `FLOOR` carries it and `./compliance` still refuses it on any role but `sky`,
 * so the one rule about the ground ("the ground is the backdrop's alone") is
 * untouched by the value moving.
 */
export const MOCKUP_GROUND = 0x070910;

// ---------------------------------------------------------------------------
// The five skies
// ---------------------------------------------------------------------------

/** The five skies that have geometry. (`none` is the ground and the stars.) */
export type MockupSkyId = 'coalsack' | 'ironVeil' | 'patinaDrift' | 'plasmaReef' | 'deepEmber';

/**
 * How a sky's elements are laid out over the field. **Derived, not measured** —
 * the instrument counted and sized blobs; it could not say where they sat. Each
 * sky keeps the layout its ratified blurb describes, so porting the numbers does
 * not silently discard a decision that was made for a different reason:
 *
 *  - `lane` — the elements walk one line, thinning at both ends. Coalsack: *"a
 *    dust lane in front of the field"* (a0-07). A lane, not a scatter.
 *  - `band` — staggered across one tilted stratum. Iron Veil: *"laminated rather
 *    than clouded"*, and the one sky whose numbers never drifted.
 *  - `drift` — scattered on a shared bearing. Patina Drift and Deep Ember.
 *  - `clots` — scattered, large, and free to overlap. Plasma Reef: *"clotted
 *    cyan"*, and the sky the port changes most.
 */
export type SkyStructure = 'lane' | 'band' | 'drift' | 'clots';

/** An inclusive numeric range, sampled uniformly. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/** One sky, exactly as the design preview draws it. */
export interface SkyReference {
  readonly id: MockupSkyId;
  /** Derived — see {@link SkyStructure}. */
  readonly structure: SkyStructure;
  /** **Measured.** Elements per screenful. */
  readonly count: number;
  /** **Measured.** Element radius, as a fraction of the panel's width. */
  readonly radius: Range;
  /** **Measured.** Peak alpha per element (the centre of its falloff). */
  readonly alpha: Range;
  /**
   * Minor/major axis ratio; `1` is round, and above 1 is taller than long across
   * the sky's own bearing.
   *
   * **Derived, and it is the one number fitted rather than copied.** The design's
   * instrument reported *one* radius per blob, so it says nothing about how round
   * a blob is — but it does report {@link lift}, and with count, radius, alpha and
   * hue all frozen, aspect is the only free parameter left that moves it. Each
   * sky's range is therefore solved for its own measured lift (`sky-preview.ts`
   * `previewTable` is the solver's oracle and CI's), and the fit lands every sky
   * within 2% of the design. That every one of them comes out near-round is a
   * result, not an assumption: the design's blobs really are blobs.
   */
  readonly aspect: Range;
  /**
   * The bearing the structure runs along, radians. Derived, as above; carried
   * here so a sky's whole geometry is stated in one place.
   */
  readonly bearing: number;
  /**
   * **The hue pair.** Derived: colour is the one axis of the backdrop the
   * developer has *never* reported, so four of the five pairs are the sky's own
   * shipped ink set reduced to the two the build leans on — the port moves size,
   * count, alpha and ground, and moves no hue. **Coalsack is the exception and
   * had to be**: it painted the ground colour, which cannot lift a panel at any
   * parameters. See its entry.
   */
  readonly hues: readonly [number, number];
  /**
   * The sky's own seed salt. Bookkeeping rather than design — but it lives here
   * rather than in `./backdrop` so the design preview and the game place their
   * elements in the *same* places, which is what makes the two panels of
   * `sky-preview.ts` comparable blob for blob and not merely statistically.
   */
  readonly seedSalt: number;
  /**
   * **Measured.** True for a sky drawn *over* the star field, so stars go missing
   * behind it. Only Coalsack; everything else is light and sits behind.
   */
  readonly dust: boolean;
  /** **Measured.** True for an additive layer. Only Plasma Reef. */
  readonly additive: boolean;
  /**
   * **Measured.** The mean luma this sky lifts its panel above its own ground, on
   * the design's instrument (`sky-preview.ts` `measure` / `previewTable`, a
   * 320×180 point-sample grid over the panel). This is the number
   * the whole brief is about, and `sky-preview` reports the port against it.
   */
  readonly lift: number;
}

/**
 * **The five skies, as the design preview draws them.**
 *
 * The measurement that produced the count/radius/alpha columns, side by side with
 * what the game shipped, read off both at runtime on a 640×360 panel:
 *
 * ```
 *   sky            game before a0-40                                mockup
 *   Plasma Reef    39 shapes — 3 washes r≈129 α.0126 + 36 nodes      9 blobs  r 115–243  α .053–.114
 *                  r 8–43 α .039
 *   Coalsack        7 shapes r 67–85  α .68–.98                      9 blobs  r 115–243  α .18–.39
 *   Deep Ember      5 shapes r 79–91  α .052–.058                   22 blobs  r  64–166  α .029–.063
 *   Patina Drift   22 shapes r 37–89  α .041–.051                   22 blobs  r  64–166  α .040–.086
 *   Iron Veil      14 shapes r 100–177 α .047–.093                  14 blobs  r 102–166  α .045–.097
 * ```
 *
 * **Iron Veil is the control.** It is the one sky whose numbers never drifted,
 * and it is the one sky the developer has never complained about. Nothing about
 * it changes here beyond the ground under it and the stars over it — which is
 * exactly the evidence that the other four are a parameter problem and not a
 * renderer problem.
 *
 * Two structural facts fall straight out of the table and are worth naming, since
 * they are what a reader will notice first:
 *
 *  - **Plasma Reef goes from 39 small shapes back to 9 large clots.** The shipped
 *    reef was three broad washes with thirty-six little nodes scattered on top —
 *    an arrangement that spends its fill on smear and never gets a clot bright
 *    enough to see. Nine large blobs at 4–9× the alpha is the design.
 *  - **Deep Ember goes from 5 shapes to 22.** Five bodies at 5% alpha is not a
 *    sparse sky, it is an absent one: measured lift **0.91** against the design's
 *    **3.80**.
 *
 * The radius columns fit three shared structures exactly, which is why they are
 * expressed as fractions rather than as five independent pairs — the design
 * preview plainly had three presets, and the fractions are round in the panel's
 * width: `0.18 + 0.20u`, `0.10 + 0.16u`, `0.16 + 0.10u`.
 *
 * **Alpha is an independent uniform draw**, not a function of radius, and that
 * was checked rather than assumed. `α · rFrac` is beautifully constant for
 * Plasma Reef (0.0201 / 0.0205) and near-constant for Coalsack (0.0684 / 0.0702),
 * which is a tempting rule — *bigger blobs are fainter, at constant optical
 * mass* — but it misses Patina Drift by 21%, Deep Ember by 20% and Iron Veil by
 * 33%. Two of five is a coincidence, so the simpler reading stands.
 */
export const MOCKUP_REFERENCE: Readonly<Record<MockupSkyId, SkyReference>> = {
  /**
   * **Coalsack** — nine large blobs of dust, walking one lane in front of the
   * star field, at the highest alpha in the set by a factor of three.
   *
   * The one sky whose port needed a colour decision rather than a colour
   * *carried over*, and it is worth stating plainly. The shipped Coalsack painted
   * lobes of the ground colour itself: pure occlusion, adding no light, measured
   * lift **0.02** — and it cannot be anything else, because a blob the colour of
   * the ground is invisible against the ground by construction. The design's
   * Coalsack lifts **4.55**. So the dust has to be *dust*: darker than everything
   * around it, and not nothing. Vacuum (Y′ 15.7) and `hullDark` (Y′ 61.8) are the
   * pair, picked by *landing the measured lift* rather than by taste —
   * `sky-preview.ts` reports the number. Two brighter pairings were rejected on
   * the same measurement: `hullShadow` (Y′ 87.3) reaches 4.55 but peaks at Y′ 60,
   * which would make the dust lane brighter than Plasma Reef and is absurd for a
   * dark nebula; `decalInk` and `wreckBody` only reach it at an aspect near 1.4,
   * i.e. blobs broader across the lane than along it, which is not a lane.
   *
   * It still occludes, which is the whole read: at α up to 0.39 over the star
   * layer, a star behind the lane's core loses most of its value and the faint
   * ones go missing entirely. A dark nebula is dark *against the field*, not
   * against the vacuum, and that is what this now draws.
   */
  coalsack: {
    id: 'coalsack',
    structure: 'lane',
    count: 9,
    radius: { min: 0.18, max: 0.38 },
    alpha: { min: 0.18, max: 0.39 },
    aspect: { min: 0.7, max: 1 },
    bearing: -0.24,
    hues: [PALETTE.vacuum, DERIVED.hullDark],
    seedSalt: 0x0c0a_15ac,
    dust: true,
    additive: false,
    lift: 4.55,
  },

  /**
   * **Iron Veil** — fourteen strata in one band. **The control.** Its shipped
   * numbers (14 sheets, r 100–177, α .047–.093) and the design's (14 blobs,
   * r 102–166, α .045–.097) are the same sky, and it is the one the developer has
   * never reported. Everything it gains here it gains from the ground and the
   * stars, which is precisely the argument that the other four skies were never
   * a rendering defect.
   */
  ironVeil: {
    id: 'ironVeil',
    structure: 'band',
    count: 14,
    radius: { min: 0.16, max: 0.26 },
    alpha: { min: 0.045, max: 0.097 },
    // The extreme aspect is the lamination: a stratum is a streak, not a blob.
    aspect: { min: 0.87, max: 1.12 },
    bearing: -0.38,
    hues: [DERIVED.hullShadow, PALETTE.threatRed],
    seedSalt: 0x1207_e011,
    dust: false,
    additive: false,
    lift: 5.03,
  },

  /**
   * **Patina Drift** — twenty-two teal wisps on one bearing. The count never
   * drifted; the radii and the alphas did, by about a third and about a half.
   */
  patinaDrift: {
    id: 'patinaDrift',
    structure: 'drift',
    count: 22,
    radius: { min: 0.1, max: 0.26 },
    alpha: { min: 0.04, max: 0.086 },
    aspect: { min: 0.92, max: 1.22 },
    bearing: 0.34,
    hues: [PALETTE.patina, DERIVED.continentShade],
    seedSalt: 0x9e37_79b9,
    dust: false,
    additive: false,
    lift: 6.94,
  },

  /**
   * **Plasma Reef** — nine large clots of additive cyan, and the brightest sky in
   * the set (lift 9.97, twice Iron Veil's). The shipped reef was 39 shapes: three
   * near-invisible washes at α 0.0126 and thirty-six nodes at α 0.039 with radii
   * an eighth of the design's. It measured **0.53**, which is the second-darkest
   * sky in the game wearing the name of the brightest.
   */
  plasmaReef: {
    id: 'plasmaReef',
    structure: 'clots',
    count: 9,
    radius: { min: 0.18, max: 0.38 },
    alpha: { min: 0.053, max: 0.114 },
    aspect: { min: 0.63, max: 0.78 },
    bearing: 0.12,
    hues: [PALETTE.plasma, DERIVED.plasmaDim],
    seedSalt: 0x51a5_9aee,
    dust: false,
    additive: true,
    lift: 9.97,
  },

  /**
   * **Deep Ember** — twenty-two dying coals, the quietest sky in the set and
   * still four times what shipped. Five bodies became twenty-two; the alphas
   * barely move (.052–.058 → .029–.063) and the radii halve. It is *sparse* by
   * being small and many, not by being few and faint, and that is the difference
   * between a sky you feel at the edge of the frame and a sky nobody can see.
   */
  deepEmber: {
    id: 'deepEmber',
    structure: 'drift',
    count: 22,
    radius: { min: 0.1, max: 0.26 },
    alpha: { min: 0.029, max: 0.063 },
    aspect: { min: 0.7, max: 0.9 },
    bearing: -0.16,
    hues: [PALETTE.threatRed, DERIVED.hullShadow],
    seedSalt: 0x0dee_e3be,
    dust: false,
    additive: false,
    lift: 3.8,
  },
};

/** The five, in the order the measurement table lists them. */
export const MOCKUP_SKY_IDS: readonly MockupSkyId[] = [
  'coalsack',
  'ironVeil',
  'patinaDrift',
  'plasmaReef',
  'deepEmber',
];

// ---------------------------------------------------------------------------
// The star field
// ---------------------------------------------------------------------------

// The design's own bloom arithmetic, written as the rules it is — so that every
// number in `MOCKUP_STARS.bloom` and `.spike` has something to be asserted
// against that is not itself (a0-44).

/**
 * **The design's halo-radius rule**: `5 + 13 × intensity`, as a multiple of the
 * star's own radius. At the design's `intensity` 0.48 that is **11.24**.
 *
 * Quoted from the design preview:
 * ```js
 * var halo = rad * (5 + 13 * inten);   // inten = state.intensity = 0.48
 * ```
 */
export function haloRadiusOf(intensity: number): number {
  return 5 + 13 * intensity;
}

/**
 * **The design's halo peak alpha**: `0.42 × intensity`, **absolute** — the
 * gradient's first stop, `starColor(s.temp, 0.42 * inten)`. It does not scale
 * with the star's own alpha, which is the second half of what a0-44 corrected.
 */
export function haloPeakAlphaOf(intensity: number): number {
  return 0.42 * intensity;
}

/**
 * **The design's halo knee alpha**: `0.13 × intensity`, the gradient's middle
 * stop at 0.35 of the radius — `g.addColorStop(0.35, starColor(s.temp, 0.13 *
 * inten))`. With {@link haloPeakAlphaOf} it fixes the *shape* of the glow;
 * `./shapes` `haloProfile` is that shape, normalised.
 */
export function haloKneeAlphaOf(intensity: number): number {
  return 0.13 * intensity;
}

/**
 * **The design's spike-arm rule**: `haloRadius × 0.62`. The design measures the
 * cross off the halo — `ctx.moveTo(s.x - halo * 0.62, s.y)` — so the arm is
 * inside the glow by construction, and cannot be otherwise unless someone types
 * the two numbers independently. Someone did.
 */
export function spikeLengthOf(haloRadius: number): number {
  return haloRadius * 0.62;
}

/**
 * **The star field.** *"These are all 1 color, there are no stars in them"* is
 * this block, and the headline number is the count.
 *
 * A 640×360 panel of the design carries **560 stars**. The same panel of the
 * shipped game carried **35** — the three layers' densities (92 + 46 + 13 per
 * 1e6 px²) come to 151 against the design's 2431, a factor of **16**. At 35 stars
 * a screenful the 99th percentile of the frame is still background, which is
 * exactly what the instrument found: p99 **7–9** against the design's **46–53**,
 * on a ground of 1.9. A field that sparse reads as one flat colour with specks in
 * it, and the developer described it as one flat colour with no stars in it.
 *
 * **Measured, frozen:** {@link count}, {@link bloom} (rule, threshold,
 * intensity, radius, peak alpha, knee), {@link spike}, {@link peakP99}.
 *
 * **Derived:** the magnitude curve and the radius/alpha it drives. The design
 * stated its distribution as an outcome — p99 46–53 on its own instrument — not
 * as a formula, so the formula is recovered by fitting that outcome, and
 * `backdrop.test.ts` asserts the outcome rather than the formula. That is the
 * right way round: the p99 is the design, the exponent is bookkeeping.
 *
 * ## The a0-44 re-audit — every value, and what happened to it
 *
 * Two of these were wrong while labelled *Measured*, so the rest could not be
 * trusted until they were re-read. Each one, against the design preview's own
 * star routine (quoted at {@link haloRadiusOf} and its neighbours) and against
 * the design's stated outcome:
 *
 * ```
 *   value                 verdict     against what
 *   bloom.radius          MOVED       4.3 → 11.24 = 5 + 13×intensity
 *   spike.length          MOVED       5.2 → 6.9688 = haloRadius × 0.62
 *   bloom peak alpha      MOVED       α×0.48 (a fraction) → 0.2016 (absolute)
 *   halo falloff shape    MOVED       (1−t²)² → the design's own 3 stops
 *   bloom.intensity       CONFIRMED   the preview's `state.intensity` = 0.48
 *   bloom.rule            CONFIRMED   `magnitude > threshold`, a0-40's ruling
 *   bloom.threshold       CONFIRMED   0.86 — 6.2% of the field blooms, and the
 *                                     field's p99 lands in the design's band
 *   count 560             CONFIRMED   unchanged, and now p99 47.9 ∈ 46–53
 *   magnitudeExponent     CONFIRMED   the fit still holds AFTER the halo moved
 *   radius, alpha         CONFIRMED   likewise — see below, this is the point
 *   spike.width           CARRIED     0.5 px; not stated in the quoted routine
 *   spike.intensity       CARRIED     0.55 of the star's alpha; likewise
 *   ramp                  CARRIED     style-guide §1, never the preview's
 * ```
 *
 * **The two CARRIED values are the honest gap in this audit**: the excerpt of the
 * design preview available to a0-44 draws the cross with `moveTo/lineTo` and
 * states neither its `lineWidth` nor its stroke alpha, so both keep a0-40's
 * numbers and are marked as carried rather than re-labelled *Measured*.
 *
 * **Why CONFIRMED means something for the derived four.** They were fitted to
 * p99 46–53 *with the wrong halo*, so the fit had every reason to fall apart once
 * the halo grew 6.8× in area — the two errors could easily have been
 * compensating. Re-measured after the correction, the design's field reads p99
 * **47.9** (`evidence/a0-44-star-bloom-radius/audit.txt`), comfortably inside the
 * design's own band, so count, exponent, radius and alpha stand unchanged. Note
 * what did *not* survive: the same field with the halo corrected but drawn on
 * `falloffProfile` reads **66.9**, which is how the falloff shape came to be part
 * of this brief at all.
 */
export const MOCKUP_STARS = {
  /** **Measured.** Stars per screenful (per {@link MOCKUP_PANEL}). */
  count: 560,
  /**
   * **Derived.** Magnitude `m = u^exponent` for a uniform `u`, so most stars are
   * faint and a few are not. This is what makes a field rather than a texture:
   * at `exponent` 1 every star is the same star, and the frame turns back into
   * the flat colour that was reported.
   */
  magnitudeExponent: 2.35,
  /** **Derived.** Star radius in screen px, linear in magnitude. */
  radius: { min: 0.4, max: 2.45 } as Range,
  /**
   * **Derived.** Star alpha, linear in magnitude. The top of the range is what
   * sets the 99th percentile, and it is fitted to it.
   */
  alpha: { min: 0.08, max: 0.5 } as Range,
  /**
   * **Measured, and it is a rule change.** The design blooms **the brightest**
   * stars — `magnitude > threshold` — where the game blooms a *seeded scatter* at
   * any magnitude (a0-07: *"i think each map should get one of these … (seeded
   * scatter), and subtle"*).
   *
   * The two rules are not cosmetically different and it is worth being straight
   * about which the developer is now asking for. Scatter makes bloom a property
   * of the *star*, so a faint far point can flare; a threshold makes it a
   * property of the *magnitude*, so the field has a bright tier stamped on it —
   * and a bright tier is what an orb *is*. Every one of the six reports asks for
   * the orbs back. The ruling on this brief is *"the game matches the mockup —
   * not close enough, the same"*, so the threshold is what ships, and the trade
   * is recorded here rather than left for the seventh report to rediscover.
   *
   * ## What a0-44 corrected, and how it was found
   *
   * The developer, in a live match: *"the stars look super WEIRD, none of them
   * have the bloom effect, and some of these with the lil crosshair looking
   * things were not in the mockup"* — on the same frame as *"the nebulas look
   * good though"*. That split is the diagnosis: the nebula numbers here were
   * measured off the design, and **two of the star numbers were not**, though
   * both were labelled *Measured* in the file that exists to be the design.
   *
   * ```
   *                     design                       a0-40 shipped
   *   halo radius       5 + 13×0.48 = 11.24 r        4.30 r      2.61× too small
   *   spike arm         halo × 0.62 =  6.97 r        5.20 r
   *   halo peak alpha   0.42×0.48 = 0.2016, ABS      α × 0.48 ⇒ ≈0.24 on a bright star
   * ```
   *
   * **The halo was smaller than the spikes**, so every bloomed star painted its
   * diffraction cross *outside its own glow* — which is exactly "crosshair
   * looking things" on stars with "none of them have the bloom effect". In the
   * design the cross sits well inside a halo 1.6× its length, and reads as a
   * glowing star with a faint flare.
   *
   * The alpha error compounded it. The design's halo is a **wide, faint wash at
   * an absolute peak** — every bloomed star's halo peaks at 0.2016 whatever its
   * own alpha — where the build made it a fraction of the star's, so a bright
   * star painted ~0.24 into a disc a seventh of the intended area. Small and hot
   * instead of wide and soft.
   *
   * ## The rules, so the numbers cannot drift from them again
   *
   * Every number below is a value the design *computes*, and each is asserted
   * against its rule in `backdrop.test.ts` rather than against itself:
   * {@link haloRadiusOf}, {@link haloPeakAlphaOf}, {@link haloKneeAlphaOf} and
   * {@link spikeLengthOf}. Asserting that a constant equals the constant you
   * typed proves nothing about the design, which is how 4.3 and 5.2 passed a
   * gate for a whole release.
   */
  bloom: {
    rule: 'brightest' as const,
    /** Magnitude above which a star blooms — and gets its spikes. */
    threshold: 0.86,
    /**
     * The design's `state.intensity` — the one knob its bloom is stated in, and
     * the multiplier every number below is derived through. Against the shipped
     * **0.16** (a0-07's `subtle` tier).
     */
    intensity: 0.48,
    /**
     * **Halo radius, as a multiple of the star's own** — {@link haloRadiusOf} at
     * `intensity`, i.e. `5 + 13 × 0.48`. It is nearly twice the spike arm, and
     * that inequality is the whole of a0-44.
     */
    radius: 11.24,
    /**
     * **Halo peak alpha, absolute** — {@link haloPeakAlphaOf} at `intensity`,
     * i.e. `0.42 × 0.48`. *Not* a fraction of the star's own alpha: the design
     * gives every bloomed star the same wash and lets the radius carry the
     * star's magnitude.
     */
    peakAlpha: 0.2016,
    /**
     * **The halo's knee** — the design's middle gradient stop, at `0.35` of the
     * radius and `0.13 × intensity` of alpha. It is the *shape* of the glow, and
     * it is not `falloffProfile`'s shape: see `./shapes` `haloProfile`, which
     * carries the measurement that settles which one the design's own p99 wants.
     */
    knee: { at: 0.35, alpha: 0.0624 },
  },
  /**
   * **Measured.** The diffraction cross on a bloomed star — the same
   * `magnitude > threshold` population, because a spike and a halo are the same
   * physical event and the design draws them together.
   *
   * The design draws the cross from the **halo**, not from the star:
   * `moveTo(x − halo × 0.62, y)`. So the arm is {@link spikeLengthOf} of the halo
   * radius, and it is inside the glow by construction — which is the property
   * a0-44 restored and `backdrop.test.ts` now asserts by name.
   */
  spike: {
    /** Arm length, as a multiple of the star's radius: `haloRadius × 0.62`. */
    length: 6.9688,
    /** Stroke width, screen px. */
    width: 0.5,
    /** Stroke alpha, as a fraction of the star's own. */
    intensity: 0.55,
  },
  /**
   * **Derived** (style-guide §1, not the design preview). The value ramp a star's
   * *point* climbs with its magnitude: a faint star is dim steel and a bright one
   * is white, and it never climbs by hue. The design states the distribution and
   * §1 states the colour, so this is where the two meet — and it is shared by
   * `./backdrop`'s three layers and by `sky-preview.ts`'s design panel, so the
   * two cannot disagree about what a magnitude looks like.
   *
   * Listed in ascending magnitude; the last band at or below a star's magnitude
   * wins.
   */
  ramp: [
    { color: PALETTE.hullSteel, minMagnitude: 0 },
    { color: DERIVED.hullLight, minMagnitude: 0.45 },
    { color: WHITE, minMagnitude: 0.8 },
  ] as readonly { readonly color: number; readonly minMagnitude: number }[],
  /**
   * **Measured.** The 99th percentile of panel luma the design's star field
   * reaches, on the design's instrument. The game measured 7–9. This is the
   * assertion `backdrop.test.ts` holds; everything above it is the means.
   */
  peakP99: { min: 46, max: 53 } as Range,
} as const;

// ---------------------------------------------------------------------------
// Emission — one placement function, so the panel and the game cannot disagree
// ---------------------------------------------------------------------------

/**
 * One element of a sky, in field coordinates, before it is anything a renderer
 * knows about.
 *
 * This intermediate exists so that **the design preview and the shipping
 * backdrop are the same arithmetic**. `sky-preview.ts` paints these with canvas
 * radial gradients; `./backdrop` turns them into `Shape`s and hands them to the
 * game's `drawSprite`; `backdrop.test.ts` compares the second against the first.
 * If a sky is ever wrong again, exactly one of those three is at fault and the
 * preview says which — which is the gate this whole brief exists to install.
 */
export interface MockupBlob {
  readonly cx: number;
  readonly cy: number;
  /** Semi-major radius, screen px. */
  readonly rx: number;
  /** Semi-minor radius, screen px. */
  readonly ry: number;
  readonly angle: number;
  readonly color: number;
  /** Peak alpha, at the centre. */
  readonly alpha: number;
}

/**
 * **How much a lane's elements thin toward its two ends** — the fraction of its
 * alpha the outermost lobe gives up, so the dust reads as a body with edges
 * rather than as a stripe that stops. Derived with the rest of the placement;
 * exported because `backdrop.test.ts` has to know the allowed alpha range for a
 * lane is `[alpha.min · (1 − LANE_TAPER), alpha.max]` and not the bare declared
 * range.
 */
export const LANE_TAPER = 0.45;

/** Uniform in `[r.min, r.max]`. */
function pick(rng: { next(): number }, r: Range): number {
  return r.min + rng.next() * (r.max - r.min);
}

/**
 * **How many elements a field carries**: the design's per-screenful count, scaled
 * by how many screenfuls of parallax field there are, and thinned by `density`
 * for the auto-reducer. Never below one while a sky is kept — a sky that rounds
 * to zero elements is the defect r9-01 exists to prevent.
 */
export function mockupCount(
  sky: SkyReference,
  fieldW: number,
  fieldH: number,
  density: number,
  screenW: number,
  screenH: number,
): number {
  if (density <= 0) return 0;
  const screens = (fieldW * fieldH) / (screenW * screenH);
  return Math.max(1, Math.round(sky.count * screens * density));
}

/**
 * **The design's geometry for one sky**, over a `fieldW`×`fieldH` parallax field
 * seen through a `screenW`×`screenH` viewport.
 *
 * Feature size is a fraction of the **viewport's width** and placement spans the
 * **field**, which is the per-screenful discipline `NebulaSpec.build` documents:
 * the design's "9 blobs" and "22 blobs" are what a phone sees, not what an arena
 * holds, and sizing to the field instead is what once put nine clots across five
 * screenfuls and produced an evidence frame with no reef in it.
 *
 * Deterministic in every argument (GDD §4.1).
 */
export function mockupBlobs(
  sky: SkyReference,
  seed: number,
  fieldW: number,
  fieldH: number,
  density = 1,
  screenW = fieldW,
  screenH = fieldH,
): MockupBlob[] {
  const rng = mulberry32((seed ^ sky.seedSalt) >>> 0);
  const n = mockupCount(sky, fieldW, fieldH, density, screenW, screenH);
  const out: MockupBlob[] = [];
  const hw = fieldW / 2;
  const hh = fieldH / 2;
  const cos = Math.cos(sky.bearing);
  const sin = Math.sin(sky.bearing);
  // The lane and the band are one continuous thing across the FIELD; their
  // thickness, like every feature size, is the SCREEN's business.
  const reach = Math.max(hw, hh) * 1.12;
  const thickness = Math.min(screenW, screenH) / 2;

  for (let i = 0; i < n; i++) {
    const rx = screenW * pick(rng, sky.radius);
    const ry = rx * pick(rng, sky.aspect);
    // Alpha is drawn before the position so that thinning a sky (fewer elements,
    // same seed) leaves the elements it keeps exactly where they were.
    const alpha = pick(rng, sky.alpha);
    const color = sky.hues[rng.next() < 0.5 ? 0 : 1]!;
    const jitter = (rng.next() - 0.5) * 0.9;

    let cx: number;
    let cy: number;
    let taper = 1;
    switch (sky.structure) {
      case 'lane': {
        // Walk one line, densest through the middle and thinning at both ends —
        // a body with a direction and with edges, which is what a dust lane is.
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const along = t * reach;
        const across = (rng.next() - 0.5) * thickness * 0.9;
        cx = along * cos - across * sin;
        cy = along * sin + across * cos;
        taper = 1 - LANE_TAPER * Math.abs(t);
        break;
      }
      case 'band': {
        // Stagger across the band's thickness, drift along its length.
        const t = n === 1 ? 0.5 : i / (n - 1);
        const across = (t - 0.5) * thickness * 0.86 + (rng.next() - 0.5) * thickness * 0.07;
        const along = (rng.next() - 0.5) * reach * 2;
        cx = along * cos - across * sin;
        cy = along * sin + across * cos;
        break;
      }
      default: {
        // `drift` and `clots`: scattered over the field on a shared bearing.
        cx = (rng.next() - 0.5) * fieldW * 0.94;
        cy = (rng.next() - 0.5) * fieldH * 0.94;
        break;
      }
    }
    out.push({
      cx: Math.round(cx * 10000) / 10000,
      cy: Math.round(cy * 10000) / 10000,
      rx: Math.round(rx * 10000) / 10000,
      ry: Math.round(ry * 10000) / 10000,
      angle: Math.round((sky.bearing + jitter) * 10000) / 10000,
      color,
      alpha: Math.round(alpha * taper * 10000) / 10000,
    });
  }
  return out;
}

/** The magnitude of a star, from one uniform draw. See {@link MOCKUP_STARS}. */
export function starMagnitude(u: number): number {
  return Math.pow(u, MOCKUP_STARS.magnitudeExponent);
}

/** A star's radius in screen px, from its magnitude. */
export function starRadius(mag: number): number {
  const r = MOCKUP_STARS.radius;
  return r.min + (r.max - r.min) * mag;
}

/** A star's alpha, from its magnitude. */
export function starAlpha(mag: number): number {
  const a = MOCKUP_STARS.alpha;
  return a.min + (a.max - a.min) * mag;
}

/**
 * **Does this star bloom?** The design's rule is the *brightest*, not a seeded
 * scatter — see {@link MOCKUP_STARS}`.bloom`. A bloomed star also gets its
 * diffraction cross; they are one event.
 */
export function starBlooms(mag: number): boolean {
  return mag > MOCKUP_STARS.bloom.threshold;
}

/**
 * **A bloomed star's halo radius in screen px** — its own radius times
 * {@link MOCKUP_STARS}`.bloom.radius`. Zero for a star that does not bloom, so a
 * caller can ask without asking twice.
 */
export function starHaloRadius(mag: number): number {
  return starBlooms(mag) ? starRadius(mag) * MOCKUP_STARS.bloom.radius : 0;
}

/**
 * **A halo's peak alpha, and it is the same for every bloomed star** (a0-44).
 *
 * There is a function here rather than a field read because the *shape* of this
 * answer is the correction: it takes no magnitude. The design gives every bloomed
 * star the identical wash and lets the halo's radius carry the star's brightness;
 * the build made the wash a fraction of the star's own alpha and shrank the
 * radius, which is small-and-hot where the design is wide-and-soft.
 */
export function starHaloAlpha(): number {
  return MOCKUP_STARS.bloom.peakAlpha;
}

/** Stars per 1e6 px², the unit `StarLayerSpec.density` is stated in. */
export const MOCKUP_STAR_DENSITY =
  (MOCKUP_STARS.count * 1e6) / (MOCKUP_PANEL.w * MOCKUP_PANEL.h);

/** The value-ramp colour a star of this magnitude paints its point in. */
export function starRampColor(mag: number): number {
  let chosen = MOCKUP_STARS.ramp[0]!.color;
  for (const band of MOCKUP_STARS.ramp) if (mag >= band.minMagnitude) chosen = band.color;
  return chosen;
}
