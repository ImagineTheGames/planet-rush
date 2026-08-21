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
import { DERIVED, PALETTE } from './palette';

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
 * **The design's spike peak alpha**: `0.22 × intensity`, **absolute** — the
 * cross's stroke, `ctx.strokeStyle = starColor(s.temp, 0.22 * inten)`, alongside
 * `ctx.lineWidth = 0.7`.
 *
 * It is the *sibling* of {@link haloPeakAlphaOf}, and the pair is the whole of
 * a0-45's first half. `0.22` against `0.42` means the design's cross is **0.52 of
 * its own halo** — a faint flare *inside* a glow. a0-44 made the halo absolute
 * and left the spike on the fraction-of-the-star formula one line below it, so
 * the build drew the cross at `starAlpha(mag) × 0.55`: measured over one
 * screenful of `main`, **α 0.2427–0.2728 inside a halo of 0.2016 — 1.20× to 1.35×
 * brighter than the glow it sits in, and 2.30–2.58× the design**
 * (`evidence/a0-45-star-temperature-colour/spike-main.txt`). The bloom was being
 * drawn correctly and then buried under its own spikes, which is why the
 * developer still reported *"stars have no noticeable bloom"* on the frame after
 * a0-44 landed.
 *
 * The a0-45 brief prices the same defect at 5.2× and spike : halo 2.72. That is
 * this arithmetic with the star at α 1.0, which no star reaches — `alpha.max` is
 * 0.5 — so the numbers above are the field's own and smaller. The defect, its
 * direction and its fix are unchanged by that.
 */
export function spikePeakAlphaOf(intensity: number): number {
  return 0.22 * intensity;
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
 * intensity, radius, peak alpha, knee), {@link spike}, {@link temperature}.
 *
 * **Derived:** the magnitude curve and the radius/alpha it drives, and — since
 * a0-45 — {@link peakP99} itself. The design stated its distribution as an
 * outcome, p99 46–53 on its own instrument, and a0-40 recovered the curve by
 * fitting that outcome; a0-45 found that the outcome and the design's own
 * `starColor` cannot both be right, re-derived the band from the inputs, and put
 * the contradiction to the Director rather than tuning an input to hide it. See
 * {@link peakP99}, which carries all of it.
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
 *                                     (**overruled by a0-123: 0.92, 3.5%** — the
 *                                     measurement stands, the developer does not
 *                                     want the field it produces)
 *   count 560             CONFIRMED   unchanged, and now p99 47.9 ∈ 46–53
 *   magnitudeExponent     CONFIRMED   the fit still holds AFTER the halo moved
 *   radius, alpha         CONFIRMED   likewise — see below, this is the point
 *   spike.width           CARRIED     0.5 px; not stated in the quoted routine
 *   spike.intensity       CARRIED     0.55 of the star's alpha; likewise
 *   ramp                  CARRIED     style-guide §1, never the preview's
 * ```
 *
 * **The three CARRIED values are the honest gap in that audit**, and a0-45 closed
 * all three. Two of them were the cross: the excerpt of the design preview a0-44
 * had draws it with `moveTo/lineTo` and states neither its `lineWidth` nor its
 * stroke alpha, so both kept a0-40's numbers and were labelled *carried* rather
 * than *Measured*. The routine states both.
 *
 * ```
 *   value                 verdict     against what
 *   spike.width           MEASURED    0.5 → 0.7 = the design's `ctx.lineWidth`
 *   spike.peakAlpha       MOVED       α×0.55 (a fraction, .2427–.2728) → 0.1056 ABS
 *   ramp                  DELETED     the design has no ramp — it has a TEMPERATURE
 *   temperature           MEASURED    r()<0.78 ? 0.55+r()*0.45 : -(0.4+r()*0.6)
 *   colour                MOVED       f(magnitude) → f(temperature); see below
 * ```
 *
 * ## a0-45's first half — the spike was the other end of a0-44's own correction
 *
 * See {@link spike}. a0-44 made the halo's alpha absolute and left the spike on
 * the fraction one line below it, so the cross came out **2.30–2.58× the design
 * and 1.20–1.35× its own halo** — the bloom drawn correctly and then buried
 * under its own spikes. {@link spikePeakAlphaOf} is now the halo rule's sibling and
 * `backdrop.test.ts` holds the *relationship* rather than the two values, because
 * a per-value assertion is exactly what could not see this.
 *
 * ## a0-45's second half — the third CARRIED value was the one about colour
 *
 * `ramp` is gone. It was the one value in this file taken from somewhere other
 * than the design, it said so in its own doc comment, and it was the axis the
 * developer's fourth report on the star field is about.
 *
 * The design gives a star a temperature and colours it from that ({@link
 * starTemperature}, {@link starColorFor}): 78% of the field blue-white
 * (`rgb(160,205,255)`…`rgb(178,209,233)`), 22% amber
 * (`rgb(235,201,149)`…`rgb(235,180,95)`), at a luma that barely moves across the
 * whole field (189.6–203.1). The build ramped colour by **magnitude** instead —
 * `hullSteel` / `hullLight` / white — and because magnitude is `u^2.35`, ~78% of
 * the sky sat in the bottom band at Y′ 135. Dim grey where the design is a
 * two-temperature field, with the *same* 78/22 split falling out of the two by
 * coincidence rather than by agreement.
 *
 * **Magnitude no longer touches colour at all**, and a colour ramp is not left
 * standing beside a temperature one for the old behaviour to survive in
 * (LESSONS §14). `backdrop.test.ts` asserts the separation by name, in both
 * directions: same magnitude + different temperature ⇒ different colours, and
 * different magnitude + same temperature ⇒ the same colour.
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
   * **Derived.** Star alpha, linear in magnitude.
   *
   * It used to say *"the top of the range is what sets the 99th percentile, and
   * it is fitted to it"*. That was true when a0-40 fitted it and **has not been
   * true since a0-44**, which made the halo's peak alpha absolute: the p99 is set
   * by the halos, and taking this range's top from 0.5 to 1.0 moves the design
   * panel by 0.83 of a luma (a0-45, `p99-sensitivity.ts`). The fit that produced
   * 0.08–0.5 stands; the sentence explaining what it was fitted to does not, and
   * a stale justification on a derived number is how the next brief re-fits the
   * wrong knob. See {@link peakP99}.
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
   * {@link haloRadiusOf}, {@link haloPeakAlphaOf}, {@link haloKneeAlphaOf},
   * {@link spikeLengthOf} and {@link spikePeakAlphaOf}. Asserting that a constant
   * equals the constant you
   * typed proves nothing about the design, which is how 4.3 and 5.2 passed a
   * gate for a whole release.
   */
  bloom: {
    rule: 'brightest' as const,
    /**
     * **Magnitude above which a star blooms** — and above which it is *eligible*
     * for its spikes ({@link spike}`.chance`; the two used to be one thing).
     *
     * ## a0-123 raised it, and the number is no longer the design's
     *
     * 0.86 was **measured off the design** and it is the value the design draws;
     * everything in this entry above the line was fitted with it. The developer,
     * off the menu backdrop: *"we have too many stars with bloom, can we reduce
     * the number"*. So this is a **ruling**, in the same class as a0-40's on the
     * bloom rule itself, and it is recorded as one rather than relabelled a
     * measurement — the file's whole value is that *Measured* means measured.
     *
     * The rate follows from the curve rather than being typed anywhere: magnitude
     * is `u^`{@link magnitudeExponent} for a uniform `u`, so the blooming
     * population is `1 − threshold^(1/exponent)`.
     *
     * ```
     *   threshold   bloomed share of the field
     *   0.86        6.22%   the design's, and what shipped until a0-123
     *   0.92        3.49%   this
     * ```
     *
     * **Why 0.92 and not further.** Not taste alone — {@link peakP99} is the
     * binding constraint and it is measured on the halos. The design's own panel
     * reads p99 44.78 at 0.86 and drops as the halos leave the frame: 42.04 at
     * 0.92, **41.28 at 0.93 — under the band's own floor of 42**. So 0.92 is
     * very nearly the largest reduction available that leaves the design's luma
     * gate standing, and this brief therefore does not touch `peakP99` at all
     * (`evidence/a0-123-fewer-blooms-loose-crosses/p99.txt`). Anything dimmer is
     * a second ruling — on how bright the sky is, not on how many orbs are in it
     * — and it is the Director's, not Art's.
     */
    threshold: 0.92,
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
   * **Measured.** The diffraction cross on a bloomed star.
   *
   * ## a0-123: the cross is its own draw, and it was the halo's shadow
   *
   * This entry used to open *"the same `magnitude > threshold` population,
   * because a spike and a halo are the same physical event and the design draws
   * them together"* — which is true of the design and is no longer true of the
   * game. The developer: *"make it so not all of them have that cross, that
   * should also be a random thing so some of them with bloom have that others
   * don't"*. So a cross is now an **independent per-star chance among the stars
   * that bloom** ({@link chance}), and the sentence that justified the old rule
   * is deleted rather than left standing beside the rule that replaced it
   * (LESSONS §14) — a comment that outlives its rule is how the next reader gets
   * it wrong.
   *
   * The physics that sentence appealed to is not being denied; it is being
   * outranked. A diffraction cross is an artefact of the *instrument*, not of the
   * star, so "which bright stars flare" is a property the design was free to make
   * uniform and the developer is free to make sparse.
   *
   * The design draws the cross from the **halo**, not from the star:
   * `moveTo(x − halo × 0.62, y)`. So the arm is {@link spikeLengthOf} of the halo
   * radius, and it is inside the glow by construction — which is the property
   * a0-44 restored and `backdrop.test.ts` now asserts by name.
   *
   * ## a0-45 finished it: the cross is DIMMER than the glow, and it was brighter
   *
   * a0-44 read the halo's two alphas off the design and made them absolute, and
   * left the spike — one line below, in the same loop — on the old
   * fraction-of-the-star formula. The two halves of one event ended up on two
   * different rules:
   *
   * ```
   *                design                          the build after a0-44
   *   halo alpha   0.42 × 0.48 = 0.2016  ABS       0.2016              ✓ a0-44
   *   spike alpha  0.22 × 0.48 = 0.1056  ABS       α×0.55 = .2427–.2728 ✗
   *   spike:halo   0.52 — a flare inside a glow    1.20–1.35 — inverted
   *   line width   0.7 px                          0.5 px
   * ```
   *
   * With the cross brighter than the glow it is all the eye gets and the halo is
   * washed out beside it,
   * which is *"stars have no noticeable bloom"* reported on a frame whose bloom
   * measured correct. The fraction is deleted rather than left beside the
   * absolute (LESSONS §14, as with `ramp`): there is no `intensity` here any
   * more, so no star can take its cross from its own alpha again.
   */
  spike: {
    /** Arm length, as a multiple of the star's radius: `haloRadius × 0.62`. */
    length: 6.9688,
    /** **Stroke width, screen px** — the design's own `ctx.lineWidth = 0.7`. */
    width: 0.7,
    /**
     * **Stroke alpha, absolute** — {@link spikePeakAlphaOf} at
     * {@link bloom}`.intensity`, i.e. `0.22 × 0.48`. *Not* a fraction of the
     * star's own alpha, and strictly under {@link bloom}`.peakAlpha`: the cross
     * is the faint part of a bloom, not the bright part.
     */
    peakAlpha: 0.1056,
    /**
     * **The chance a bloomed star wears its cross** (a0-123) — a **ruling**, not
     * a measurement: the design crosses every bloomed star, i.e. this was
     * implicitly `1`.
     *
     * It is a chance *among the bloomed*, so it multiplies rather than replaces
     * {@link bloom}`.threshold`. Over a screenful of 560:
     *
     * ```
     *                       bloomed   crossed
     *   before a0-123        6.22%     6.22%   every bloom, by construction
     *   threshold alone      3.49%     3.49%
     *   and this             3.49%     1.75%   the cross is the rarer mark again
     * ```
     *
     * **Why a half.** The developer asked for *"some … have that others don't"*,
     * which is a statement about the *mix* and is loudest at 0.5 — any other
     * value makes one of the two populations the exception rather than making
     * both ordinary. Picked by eye on the menu backdrop against 0.35 and 0.65
     * (`evidence/a0-123-fewer-blooms-loose-crosses/`), and 0.5 is also the only
     * value on that sweep that cannot be read as a *third* tier of star.
     *
     * It costs nothing on the field: the draw comes from its own stream, so no
     * star's position, magnitude or colour moves — see `../art/backdrop`
     * `starFieldSprite`.
     */
    chance: 0.5,
  },
  /**
   * **Measured, and it is the whole of a0-45.** A star's **temperature**, drawn
   * per star from its own randoms, exactly the way its magnitude is:
   *
   * ```js
   * temp: r()<0.78 ? (0.55+r()*0.45) : -(0.4+r()*0.6)
   * ```
   *
   * Positive is hot and negative is cool, and {@link starColorFor} is the only
   * thing that reads it. **Magnitude drives alpha and radius, and never touches
   * colour** — which is the sentence this whole entry exists to make true, and
   * the one the file got wrong for two releases. See {@link starTemperature} for
   * why it takes the random *source* rather than one uniform.
   */
  temperature: {
    /** The fraction of the field that is hot. 78% blue-white, 22% amber. */
    hotShare: 0.78,
    /** Hot: `0.55 + 0.45u`, so `+0.55…+1`. */
    hot: { min: 0.55, max: 1 } as Range,
    /** Cool, as a magnitude before it is negated: `0.4 + 0.6u`, so `−0.4…−1`. */
    cool: { min: 0.4, max: 1 } as Range,
  },
  /**
   * **The 99th percentile of panel luma the design's star field reaches**, on the
   * design's instrument (`sky-preview.ts`, a 320×180 point-sample grid). The game
   * measured 7–9 before a0-40. This is the assertion `backdrop.test.ts` holds;
   * everything above it is the means.
   *
   * ## a0-45 re-derived it, and the number moved — 46–53 → 42–48
   *
   * The brief's step 4, and it is the one place in this brief where the answer
   * was not the one anybody expected, so all of it is on the record here and in
   * `evidence/a0-45-star-temperature-colour/`.
   *
   * **What the band is now.** With colour taken from the design and every other
   * star value already confirmed against the design's own rules by a0-44, the
   * design's panel *computes* a p99, and over 24 seeds it computes
   * **44.97 ± 3.80**. The band is that mean ±3σ of a 12-seed estimate — the same
   * ±7% relative width the old band carried — and `backdrop.test.ts` asserts it
   * as a mean over seeds rather than on one, for the reason immediately below.
   *
   * **The old band is exactly what a WHITE-topped ramp measures.** The same
   * 24 seeds on `main` — the deleted magnitude ramp, whose top band is `WHITE` —
   * give the design panel **49.62 ± 2.90**, and the old band's midpoint is 49.5.
   * That is not a coincidence to leave unremarked: `peakP99` was labelled
   * *Measured*, and 46–53 is the number a field of white halos produces. Whether
   * the design preview's own field was measured before its `starColor` was
   * applied, or whether the design's bloom is brighter than the `0.42 × 0.48` a0-44
   * read off it, is **the Director's question and not Art's** — it is raised with
   * the arithmetic in the a0-45 PR body rather than settled here. What is
   * measurable is the size of it: to put the coloured field back in 46–53 the
   * halo's peak alpha would have to be **0.2621 (`0.42 × 0.624`)** against the
   * preview's stated `state.intensity` of 0.48.
   *
   * **No derived knob could have absorbed it, and that was checked rather than
   * assumed** (`p99-sensitivity.ts`). Since a0-44 made the halo's alpha
   * *absolute*, the p99 is set by the halos and barely notices the star points:
   * taking `alpha.max` from 0.5 to **1.0** — a field of stars at full opacity —
   * moves the design panel from 40.36 to **41.19**. The note that used to sit on
   * {@link alpha} ("the top of the range is what sets the 99th percentile, and it
   * is fitted to it") was true when it was written and has not been true since
   * a0-44; it is corrected there. The knobs that *do* move it — `radius`,
   * `magnitudeExponent`, `count` — are the three the a0-45 brief puts out of
   * scope as measured correct this cycle.
   *
   * ## Why it is a mean over seeds now, and not one panel
   *
   * Because one panel is a noisy instrument for this and nobody had noticed. The
   * p99 of a 320×180 grid is set by the ~35 halos in the frame — a star point is
   * 2.45 px across and a halo is 26 — so it is really a count statistic with a
   * real spread (σ 3.80, i.e. 8% of the value). On `main` the design panel drew 27
   * halos and the game panel 32 and their p99s agreed **to 0.04%**, which reads
   * like two implementations agreeing and is mostly luck: over 24 seeds the same
   * two panels are **5.51%** apart. a0-45 shifts every stream by the two draws a
   * temperature costs, and on `VOID_SEED` alone the design panel now draws 30
   * halos against the game's 41 and reads 10.4% under it. Over seeds the two
   * agree to **2.29%** — better than `main`, because there is now one colour rule
   * instead of two.
   *
   * ## And the spike moves it by nothing, because the instrument cannot see it
   *
   * a0-45's other half — the cross going from α 0.2427–0.2728 to a flat 0.1056 —
   * re-derives this band to **exactly the same numbers**, and that is a property
   * of the instrument rather than a coincidence worth trusting. `sampleMockup`
   * composites the ground, the sky, the star's point and its halo; `sampleShapes`
   * composites `s.fill` and skips any shape without one. **A diffraction cross is
   * a stroke**, so neither panel has ever drawn one, and the p99 that guards this
   * field has been blind to the spikes for as long as it has existed.
   *
   * That is worth naming rather than filing: it is part of why a cross 2.5× too
   * bright survived a0-44's own re-audit of every other star value. The gate for
   * it therefore cannot be a luma measurement, and is not one — it is
   * `backdrop.test.ts`'s pair of relationship assertions on the constants and on
   * the shapes the field emits. The plates in
   * `evidence/a0-45-star-temperature-colour/` are the only place in the repo the
   * cross is rasterised at all (`plate.ts` strokes polylines; nothing else does).
   */
  peakP99: { min: 42, max: 48 } as Range,
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
 * **The length a radius fraction is a fraction OF**, for a screen of any shape.
 *
 * The design states every radius against {@link MOCKUP_PANEL}'s **width** (see
 * the note at the top of this file: `0.18/0.38` and friends are the fit that
 * comes out round). On a 16:9 screen "the width" and "the panel's width" mean
 * the same thing and this returns exactly `screenW`, so **nothing changes on the
 * shape the game was authored in.** Off 16:9 they stop meaning the same thing,
 * and a0-75 is what that cost.
 *
 * ## What went wrong, in one line of arithmetic (a0-75)
 *
 * Element *size* was `screenW × radius` and element *count* is per screen
 * **area** ({@link mockupCount}). A sky's coverage of the frame is therefore
 * `count × π k² screenW² / (screenW × screenH)` = **`count π k² × W/H`** — it
 * grows with the frame's aspect ratio and nothing bounds it. Measured off the
 * shipped geometry (`evidence/a0-75-fill-rate/overdraw.txt`), Plasma Reef:
 *
 * ```
 *   16:9   (2560×1440)   3.03 ×      ← the design's own shape
 *   21:9   (3440×1440)   4.07 ×      ← +34%, and the developer plays here
 *   32:9   (5120×1440)   6.06 ×      ← +100%
 * ```
 *
 * That is a per-frame fill-rate multiplier on the widest screens in the world,
 * and it is *also* a fidelity drift: at 32:9 a clot is twice the fraction of the
 * frame's height that the design draws it at, so the sky reads coarser and
 * emptier than the compositor board the developer approved. The two are the same
 * error seen from two sides, which is why the fix is one number and not a budget.
 *
 * ## The rule, and why this one
 *
 * The geometric mean of the frame, re-scaled by the design panel's own aspect:
 * `√(W · H · Wp/Hp)`. It is the unique rule that
 *
 *  1. **is the identity at the design's aspect** — put `W/H = Wp/Hp` in and it
 *     returns `W`, so every number the design measured still means what it
 *     measured, and no sky is re-art-directed to buy a millisecond (which is
 *     precisely the drift a0-40 exists to undo); and
 *  2. **holds a blob's share of the FRAME constant at any aspect**, because
 *     area ∝ this², and this² ∝ W·H = the frame. So the overdraw column above
 *     flattens to its 16:9 value everywhere, and the sky keeps the proportions
 *     it was drawn with on a shape it was never drawn on.
 *
 * The rejected alternative is the short side (`min(W, H)`), which is what
 * `thickness` uses one line below. It is scale-invariant too, but it is *not*
 * the identity at 16:9 — it would shrink every blob to 0.5625 of the design's on
 * the very shape the design was measured on. That is re-art-directing the whole
 * set to fix an ultrawide, and it is the wrong way round.
 */
export function featureSpan(screenW: number, screenH: number): number {
  return Math.sqrt(screenW * screenH * (MOCKUP_PANEL.w / MOCKUP_PANEL.h));
}

/**
 * **The design's geometry for one sky**, over a `fieldW`×`fieldH` parallax field
 * seen through a `screenW`×`screenH` viewport.
 *
 * Feature size is a fraction of the **viewport** ({@link featureSpan} — its
 * width exactly, on the 16:9 the design was drawn at) and placement spans the
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
  // The length a radius fraction is a fraction of — `screenW` exactly on the
  // 16:9 the design was drawn at, and the frame's own scale off it (a0-75).
  const span = featureSpan(screenW, screenH);

  for (let i = 0; i < n; i++) {
    const rx = span * pick(rng, sky.radius);
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
 * scatter — see {@link MOCKUP_STARS}`.bloom`.
 *
 * It used to end *"A bloomed star also gets its diffraction cross; they are one
 * event."* **That is no longer the rule** (a0-123): blooming makes a star
 * *eligible* for a cross and {@link starWearsCross} decides. The two functions
 * are deliberately separate rather than one returning a pair, because they take
 * different arguments from different places — this one a magnitude off the
 * field's own stream, that one a uniform off a stream that exists so this
 * decision cannot move the field.
 */
export function starBlooms(mag: number): boolean {
  return mag > MOCKUP_STARS.bloom.threshold;
}

/**
 * **Does this bloomed star wear its diffraction cross?** — one uniform in, at
 * {@link MOCKUP_STARS}`.spike.chance` (a0-123).
 *
 * The developer: *"make it so not all of them have that cross, that should also
 * be a random thing so some of them with bloom have that others don't"*.
 *
 * **It takes a uniform rather than a random source, and that is the whole point
 * of its signature.** {@link starTemperature} takes the *stream* because it needs
 * two draws from it; this needs exactly one, and by not holding the stream it
 * cannot be the thing that decides *which* stream. Its caller decides that, and
 * `../art/backdrop` `starFieldSprite` deliberately does not hand it the field's
 * own — see there for why a fourth draw on the field's stream would have re-rolled
 * every star in the sky.
 *
 * The answer is meaningless for a star that does not bloom; callers gate on
 * {@link starBlooms} first. It is not folded in here because the two live on
 * different streams, and a function that consumed the cross draw only when the
 * magnitude cleared the threshold is precisely the shape that couples them again.
 */
export function starWearsCross(u: number): boolean {
  return u < MOCKUP_STARS.spike.chance;
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

/**
 * **A spike's alpha, and it is the same for every bloomed star** (a0-45) — and it
 * is **less than {@link starHaloAlpha}**, which is the property the whole of this
 * brief's first half is about.
 *
 * It sits here, next to its sibling, deliberately. a0-44 corrected the halo and
 * left the spike one line below it on the old formula, because a per-value
 * assertion cannot see a *relationship*: `starHaloAlpha()` was checked against the
 * design and passed, and nothing anywhere asked whether the cross drawn through
 * it was dimmer than it. `backdrop.test.ts` asks that now, by name, in the same
 * shape as a0-44's `halo is wider than its own spikes` — one test for the size,
 * one for the brightness, and neither is satisfiable by a number that merely
 * equals the number someone typed.
 */
export function starSpikeAlpha(): number {
  return MOCKUP_STARS.spike.peakAlpha;
}

/** Stars per 1e6 px², the unit `StarLayerSpec.density` is stated in. */
export const MOCKUP_STAR_DENSITY =
  (MOCKUP_STARS.count * 1e6) / (MOCKUP_PANEL.w * MOCKUP_PANEL.h);

// ---------------------------------------------------------------------------
// Temperature — where a star's COLOUR comes from (a0-45)
// ---------------------------------------------------------------------------

/**
 * **A star's temperature**, from the field's own random stream. Positive is hot,
 * negative is cool, and it is a *per-star* property drawn exactly the way
 * {@link starMagnitude} is — the design's own line, verbatim:
 *
 * ```js
 * temp: r()<0.78 ? (0.55+r()*0.45) : -(0.4+r()*0.6)
 * ```
 *
 * ## Why this takes the RNG and `starMagnitude` takes a uniform
 *
 * Because the design's line calls `r()` **twice**: once to choose the branch and
 * once for the value inside it. That is not a detail of style — it is what sets
 * the two colour ranges the design actually paints. Sharing one draw between the
 * branch and the value (`r < 0.78 ? 0.55 + 0.45r : −(0.4 + 0.6r)`) correlates
 * them: the hot branch could then only reach `0.55 + 0.45×0.78 = 0.901`, so the
 * bluest star in the design (`rgb(160,205,255)`) would never be drawn, and the
 * cool branch would start at `k = 0.4 + 0.6×0.78 = 0.868`, so every amber star
 * would be one of the deepest and the range `rgb(235,201,149)`…`rgb(235,180,95)`
 * would collapse to its last eighth. Two draws, and the field is the design's.
 *
 * Deterministic in the stream (GDD §4.1); it consumes two of its numbers.
 */
export function starTemperature(rand: { next(): number }): number {
  const t = MOCKUP_STARS.temperature;
  if (rand.next() < t.hotShare) return t.hot.min + rand.next() * (t.hot.max - t.hot.min);
  return -(t.cool.min + rand.next() * (t.cool.max - t.cool.min));
}

/** Pack three 0..255 channels, clamped, into one RGB integer. */
function rgb(r: number, g: number, b: number): number {
  const c = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

/**
 * **The colour of a star at this temperature** — the design's own `starColor`,
 * both branches, verbatim:
 *
 * ```js
 * function starColor(t,a){
 *   if(t>=0) return "rgba("+(200-Math.round(40*t))+","+(215-Math.round(10*t))+","+(205+Math.round(50*t))+","+a+")";
 *   var k=-t; return "rgba(235,"+(215-Math.round(35*k))+","+(185-Math.round(90*k))+","+a+")";
 * }
 * ```
 *
 * Over the domain {@link starTemperature} draws from, that is **blue-white**
 * `rgb(160,205,255)`…`rgb(178,209,233)` for the hot 78% and **amber**
 * `rgb(235,201,149)`…`rgb(235,180,95)` for the cool 22%.
 *
 * It is the star's whole colour: its point, its halo and its diffraction cross
 * are all painted in it (the design's halo gradient is `starColor(s.temp, …)`),
 * so there is exactly one source of a star's hue and nothing to drift out of
 * agreement with. The clamp in {@link rgb} cannot bite inside the design's own
 * domain — `backdrop.test.ts` asserts every channel lands in range untouched —
 * and exists so that a temperature from outside it fails loudly at the
 * allow-list rather than silently as a wrapped byte.
 */
export function starColorFor(temp: number): number {
  if (temp >= 0) {
    return rgb(200 - Math.round(40 * temp), 215 - Math.round(10 * temp), 205 + Math.round(50 * temp));
  }
  const k = -temp;
  return rgb(235, 215 - Math.round(35 * k), 185 - Math.round(90 * k));
}

/**
 * **Every colour the star field can paint** — {@link starColorFor} over the whole
 * of {@link starTemperature}'s domain, enumerated rather than typed.
 *
 * `./compliance` needs this because a temperature colour is not one of the six,
 * not a declared shade of one of the six, and not a roster colour: the design's
 * star field is the one place in the game where a colour is a *continuous
 * function*, and the allow-list is a set. Enumerating it keeps the audit exactly
 * as strict as it was — a hand-edited hex on a star still fails, because it is
 * either a colour this function produces or it is not.
 *
 * **Why this is exhaustive by construction, and not a fine-enough sample.** Each
 * branch is a rounding of a linear function, so the colour is *piecewise
 * constant* in `t` and the pieces are bounded by the channels' own rounding
 * breakpoints — `(n+½)/40`, `(n+½)/10`, `(n+½)/50` for the hot branch, `(n+½)/35`
 * and `(n+½)/90` for the cool. Enumerating those breakpoints and reading the
 * colour at the midpoint of every piece between them therefore visits each piece
 * exactly once and cannot step over one: there is no interval left to step over.
 * (`Math.round` is half-**up**, so the colour *at* a breakpoint is the piece above
 * it, which its own midpoint already carries.)
 *
 * It was a 1e-5 sweep until the boot cost was measured: 105,000 evaluations, in a
 * module `./backdrop` imports, running at load in the shipped bundle for a set
 * only the audit ever reads. This is ~200 evaluations and the same 117 colours —
 * `backdrop.test.ts` holds them against the field the generator actually paints.
 */
export const STAR_TEMPERATURE_COLORS: ReadonlySet<number> = (() => {
  const out = new Set<number>();
  const t = MOCKUP_STARS.temperature;

  /** Every colour `color` takes over `[lo, hi]`, given its breakpoint scales. */
  const pieces = (lo: number, hi: number, scales: readonly number[], color: (x: number) => number) => {
    const cuts = new Set<number>([lo, hi]);
    for (const s of scales) {
      // The breakpoints of `Math.round(s·x)` are at `(n+½)/s`; walk the ones that
      // land strictly inside the domain.
      for (let n = Math.floor(s * lo - 0.5); n <= Math.ceil(s * hi - 0.5); n++) {
        const x = (n + 0.5) / s;
        if (x > lo && x < hi) cuts.add(x);
      }
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) out.add(color((sorted[i]! + sorted[i + 1]!) / 2));
    out.add(color(lo));
    out.add(color(hi));
  };

  pieces(t.hot.min, t.hot.max, [40, 10, 50], (u) => starColorFor(u));
  pieces(t.cool.min, t.cool.max, [35, 90], (k) => starColorFor(-k));
  return out;
})();
