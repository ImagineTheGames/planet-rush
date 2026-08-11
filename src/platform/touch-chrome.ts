/**
 * src/platform/touch-chrome.ts — Gantry/Bone, stated on a circle. OWNER:
 * Platform Engineer (a0-23).
 *
 * The theme audit (`docs/theme-coverage.md` §6, trap 1) found the gap this file
 * fills:
 *
 * > *"There is no round primitive in the Bone vocabulary. `src/ui/instrument.ts`
 * > gives you a tick, a rule, a scrim, a track and a `gantryPoly` — all
 * > rectilinear. The touch controls are rings and knobs … Budget the vocabulary
 * > before the recolour."*
 *
 * So this is the vocabulary, and {@link ./touch-visuals} is the recolour. It is
 * the same translation `src/ui/instrument.ts` performs for the rectangular HUD —
 * *the direction cannot be copied onto glass, it has to be translated* — carried
 * out one shape further:
 *
 *   | Gantry/Bone on a plate      | on the glass, on a circle          |
 *   |-----------------------------|------------------------------------|
 *   | the plate's face            | a **scrim** — an absence of world   |
 *   | the bezel's lit top edge    | the **top arc** of the rim          |
 *   | the bezel's shadowed under  | the **bottom arc** of the rim       |
 *   | "the primary is brightest"  | a brighter rim, and a pool of void  |
 *   | rivets                      | nothing (they were plate hardware)  |
 *
 * ── WHY BRIGHTNESS AND NOT HUE ───────────────────────────────────────────────
 * Bone spends no colour, which is what leaves plasma free to mean *energy* in a
 * match — shields, the mining torch, weapon fire. Until a0-23 the player's own
 * thumb furniture was drawn in that same blue, so the controls under your hands
 * were the colour of the shield standing in front of an enemy reactor. Every
 * tone below is a step on the Bone ramp declared in `src/art/materials.ts`;
 * nothing here can smuggle a hue onto the glass.
 *
 * ── WHY IT IS ITS OWN FILE ───────────────────────────────────────────────────
 * `touch-visuals.ts` is a Pixi view: it owns *where* things are and *when* they
 * are visible. What a Bone ring actually paints is a separate question, it is
 * pure, and it is the part a headless test can hold to the direction — so it
 * lives here behind {@link RoundCanvas}, the structural slice of `Graphics`
 * these primitives need (the same trick `src/art/materials.ts` plays with
 * `PlateCanvas`). Pixi's `Graphics` satisfies it as-is; the test drives a
 * recorder and asserts the tones, so "the FIRE button went back to plasma" fails
 * a unit test rather than a screenshot.
 *
 * Imports `../art/materials` and nothing from `src/ui/` — the ratified tones are
 * art's, and `src/platform/wheel-input.ts` already reaches for them the same way.
 */

import { BONE, MATERIAL_SHADES } from '../art/materials';
import { PALETTE } from '@render/index';

// ---------------------------------------------------------------------------
// The canvas slice
// ---------------------------------------------------------------------------

/**
 * The three-and-two-method structural slice of PixiJS `Graphics` these
 * primitives use. Every method returns the canvas so calls chain, exactly as
 * `Graphics` does.
 *
 * **`fill`/`stroke` must consume `style` synchronously.** These primitives hand
 * the same mutable scratch object to every call so a draw allocates no styles;
 * `GraphicsContext` converts its input into a fresh style immediately, which is
 * what makes that safe. A test recorder must COPY the object rather than retain
 * it — retaining it records the last draw N times (the trap `PlateCanvas`
 * documents in `src/art/materials.ts`, found the hard way in u7-01).
 */
export interface RoundCanvas {
  circle(x: number, y: number, radius: number): RoundCanvas;
  moveTo(x: number, y: number): RoundCanvas;
  arc(x: number, y: number, radius: number, start: number, end: number, ccw?: boolean): RoundCanvas;
  fill(style: { color: number; alpha: number }): RoundCanvas;
  stroke(style: { width: number; color: number; alpha: number }): RoundCanvas;
}

// ---------------------------------------------------------------------------
// 1. The tones — every one a step on the Bone ramp
// ---------------------------------------------------------------------------

/**
 * What a touch control is painted in, by the role the paint plays. The sibling
 * of `WHEEL_CHROME` in `src/ui/instrument.ts`: the SAME ramp, named by the role
 * a thumb control has and nothing more, so there is no parallel answer to
 * "what colour is a control".
 */
export const TOUCH_CHROME = {
  /** The top of a rim, on the control you can press *now* — the brightest metal
   *  the layer owns. Bone's whole mechanism: the actionable thing is the bright
   *  thing, and it costs the palette no hue. */
  rimLit: BONE.hi,
  /** The underside of that rim. A rim is a machined lip: it catches the light
   *  along the top and falls into shadow along the bottom, which is the
   *  handoff's own diagnosis ("a lit top edge, a shadowed under-line") stated on
   *  a circle instead of on a rectangle. */
  rimShadow: BONE.lo,
  /** The top of a rim on an *idle hint* — a stick zone nobody's thumb is on. A
   *  step down the same ramp rather than a different material. */
  hintLit: BONE.mid,
  /** That hint's underside. */
  hintShadow: MATERIAL_SHADES.rulePlate,
  /** The lift a face gives over the fight. `BONE.fill` is the ratified "lit end
   *  of a primary plate's face"; over glass it is a lift, never a surface. */
  face: BONE.fill,
  /** What a scrim falls on: vacuum. A scrim is never a *tint*, only an absence
   *  of the world (`src/ui/instrument.ts` SCRIM_COLOR, same reasoning). */
  scrim: PALETTE.vacuum,
  /** A control's own word — `FIRE`, `BUILD`. The brightest step, because the
   *  word IS the affordance. */
  label: BONE.hi,
  /** A sub-line under that word — `& UPGRADE`. Read, not pressed. */
  sub: BONE.mid,
  /** A press. Bone's answer to "this one, now" is luminance: a pressed control
   *  goes BRIGHT, it does not go blue (the same call u11-01 made for a pressed
   *  wheel wedge). */
  press: BONE.hi,
} as const;

/**
 * How much of each tone a control carries, by state. Stated as its own table
 * because these numbers are the whole argument: a translucent ring over a
 * firefight lives or dies on its alphas, and the brief this file was written for
 * is explicit that the read must not get worse than the plasma it replaces.
 *
 * The plasma these replace ran a 3px ring at 0.18 idle / 0.4 live, a 0.5 knob,
 * and a 4px ring at 0.85 on FIRE. Bone's `hi` is the ramp's white endpoint, so
 * the same alpha buys **more** luminance contrast against vacuum than the blue
 * did — the numbers below are equal or higher anyway, and the frames in
 * `evidence/a0-23/` are what actually settle it.
 */
export const TOUCH_ALPHA = {
  /** An idle stick-zone ghost: barely there, but there. */
  hintLit: 0.34,
  hintShadow: 0.24,
  /** A live stick base, under a thumb that has landed. */
  liveLit: 0.75,
  liveShadow: 0.5,
  /** The lift inside a live base ring — the thumb zone reads as a *dish*. */
  liveFace: 0.07,
  /** The knob: the one part of a stick that is a solid object. */
  knobScrim: 0.45,
  knobFace: 0.34,
  knobLit: 0.95,
  knobShadow: 0.7,
  /** A held action button (FIRE): the scrim is what makes a word survive a lit
   *  asteroid passing under it. */
  actionScrim: 0.5,
  actionFace: 0.16,
  actionLit: 0.95,
  actionShadow: 0.72,
  /** The primary — the control that just became available (BUILD & UPGRADE).
   *  Same vocabulary, one step brighter, plus the halo below. */
  primaryScrim: 0.62,
  primaryFace: 0.34,
  primaryLit: 1,
  primaryShadow: 0.85,
  /** The pressed overlay's node alpha. Held at 0 when released, so the press is
   *  an alpha change and never a redraw (GDD §4.3 — the layer draws its geometry
   *  once, in its constructor). */
  press: 0.2,
  /** Peak coverage of the primary's void halo, at the band that hugs the rim. */
  halo: 0.5,
} as const;

/** Rim weights, CSS px. Unchanged from what shipped in plasma — the weights were
 *  never the complaint, the hue was. */
export const TOUCH_RIM = {
  stick: 3,
  knob: 2,
  fire: 4,
  build: 5,
} as const;

/** How far past a primary's rim its halo of void reaches, and in how many bands. */
export const TOUCH_HALO = { reach: 16, bands: 5 } as const;

// ---------------------------------------------------------------------------
// 2. The primitives
// ---------------------------------------------------------------------------

/** One rim: the lit top arc, the shadowed bottom arc, and the weight of both. */
export interface RimSpec {
  readonly width: number;
  readonly lit: number;
  readonly shadow: number;
  readonly litAlpha: number;
  readonly shadowAlpha: number;
}

/** Scratch styles — a draw allocates nothing (see {@link RoundCanvas}). */
const STROKE = { width: 0, color: 0, alpha: 1 };
const FILL = { color: 0, alpha: 1 };

/**
 * Stroke one arc, from a pen that is already on it.
 *
 * The `moveTo` is load-bearing and is the reason this is a function rather than
 * two lines at each call site: a bare `arc()` drags a chord in from wherever the
 * previous primitive left the pen, and that stray rule is exactly the defect
 * a0-21 was called in to remove from the upgrade wheel. Stated once, here.
 */
export function strokeArc(
  g: RoundCanvas,
  radius: number,
  from: number,
  to: number,
  width: number,
  color: number,
  alpha: number,
): void {
  STROKE.width = width;
  STROKE.color = color;
  STROKE.alpha = alpha;
  g.moveTo(Math.cos(from) * radius, Math.sin(from) * radius)
    .arc(0, 0, radius, from, to)
    .stroke(STROKE);
}

/**
 * A machined rim at `radius`: lit across the top, shadowed across the bottom.
 *
 * Screen space has y pointing down, so the TOP of the circle is the half from
 * π to 2π and the bottom is 0 to π — the same convention (and the same two
 * arcs) as the build wheel's disc rim, which is where this treatment is already
 * ratified in the round.
 */
export function drawRim(g: RoundCanvas, radius: number, spec: RimSpec): void {
  strokeArc(g, radius, Math.PI, 2 * Math.PI, spec.width, spec.lit, spec.litAlpha);
  strokeArc(g, radius, 0, Math.PI, spec.width, spec.shadow, spec.shadowAlpha);
}

/** What one Bone ring is made of. Every part is optional except the rim: a stick
 *  zone is rim only (the fight must read through it), a knob is all three. */
export interface RingSpec {
  readonly rim: RimSpec;
  /** Coverage of {@link TOUCH_CHROME.scrim} inside the rim — an absence of the
   *  world, so a word or a knob has something to be legible against. */
  readonly scrim?: number;
  /** Coverage of {@link TOUCH_CHROME.face} inside the rim — the Bone lift. */
  readonly face?: number;
}

/**
 * Draw one Bone ring — scrim, then face, then rim — centred on the canvas
 * origin. Callers position the node, never the geometry, so this is called once
 * per affordance at construction and never again.
 */
export function drawBoneRing(g: RoundCanvas, radius: number, spec: RingSpec): void {
  if (spec.scrim !== undefined && spec.scrim > 0) {
    FILL.color = TOUCH_CHROME.scrim;
    FILL.alpha = spec.scrim;
    g.circle(0, 0, radius).fill(FILL);
  }
  if (spec.face !== undefined && spec.face > 0) {
    FILL.color = TOUCH_CHROME.face;
    FILL.alpha = spec.face;
    g.circle(0, 0, radius).fill(FILL);
  }
  drawRim(g, radius, spec.rim);
}

/**
 * Per-band alphas for `targets` cumulative coverages, painted outermost-first
 * with each band drawn OVER the last.
 *
 * Nested translucent fills compound — two 0.3 bands read as 0.51, not 0.6 — so a
 * halo whose bands carry their target coverage directly is wrong at every band
 * but the first. Each band therefore carries the *increment* needed to reach its
 * target given what is already under it. (`src/ui/instrument.ts` states the same
 * arithmetic for the rectangular scrim; the wheel's own halo states it a third
 * time. This is the round copy, and it is four lines.)
 */
export function nestedAlphas(targets: readonly number[]): number[] {
  const out: number[] = [];
  let under = 0;
  for (const t of targets) {
    const a = under >= 1 ? 0 : Math.max(0, Math.min(1, (t - under) / (1 - under)));
    out.push(a);
    under = under + a * (1 - under);
  }
  return out;
}

/**
 * The primary's halo: a pool of void outside the rim, deepest where it meets the
 * rim and gone by `radius + reach`.
 *
 * **It darkens, it does not glow.** A white bloom around a button would be the
 * one thing this project has twice removed (a0-18, a0-22) and would spend
 * exactly the brightness the rim needs to be the brightest thing. A pool of
 * vacuum separates the primary from the fight *subtractively* — the same device
 * the build wheel uses to sit over a live match without becoming a panel — so
 * the control gains contrast without the screen gaining light.
 */
export function drawVoidHalo(
  g: RoundCanvas,
  radius: number,
  reach = TOUCH_HALO.reach,
  bands = TOUCH_HALO.bands,
  peak = TOUCH_ALPHA.halo,
): void {
  const targets: number[] = [];
  for (let i = 0; i < bands; i++) {
    // 0 at the outer edge, `peak` at the rim; squared, so the pool has a soft
    // shoulder rather than a linear ramp and never draws an edge of its own.
    const inward = (i + 1) / bands;
    targets.push(peak * inward * inward);
  }
  const alphas = nestedAlphas(targets);
  for (let i = 0; i < bands; i++) {
    const a = alphas[i] ?? 0;
    if (a <= 0) continue;
    FILL.color = TOUCH_CHROME.scrim;
    FILL.alpha = a;
    g.circle(0, 0, radius + reach - (reach * i) / bands).fill(FILL);
  }
}

/**
 * The pressed overlay, drawn at full strength and shown by node alpha.
 *
 * A press must not rebuild geometry — `touch-visuals.ts` draws every affordance
 * once and the frame path only moves things and toggles them (GDD §4.3, zero
 * per-frame allocation; `docs/theme-coverage.md` §6 trap 2 names this as the
 * thing a re-skin breaks). So the bright state is a *child that already exists*
 * at `alpha: 0`, and pressing sets `alpha`. No `clear()` in `update()`.
 */
export function drawPressOverlay(g: RoundCanvas, radius: number, rimWidth: number): void {
  FILL.color = TOUCH_CHROME.press;
  FILL.alpha = 1;
  g.circle(0, 0, radius).fill(FILL);
  STROKE.width = rimWidth;
  STROKE.color = TOUCH_CHROME.press;
  STROKE.alpha = 1;
  g.circle(0, 0, radius).stroke(STROKE);
}
