/**
 * src/ui/instrument.ts — Gantry/Bone for the screen you play on. OWNER: UI Engineer (u7-07).
 *
 * {@link ./gantry} is the menus' half of the ratified direction: a header beam, a
 * footer beam, a page margin, and plates stacked between them. This is the other
 * half, and it exists because the direction cannot be applied to the match HUD by
 * copying it.
 *
 * ---------------------------------------------------------------------------
 * THE RULE — the menus are made of metal; the HUD is instruments ON GLASS
 * ---------------------------------------------------------------------------
 * The handoff diagnoses the menus in one line — *"1px hairlines on black, which
 * reads as a wireframe rather than a product; the fix is material"* — and fixes
 * them with plates: a lit top edge, a shadowed under-line, a cast shadow, an
 * inner sheen, rivets where plates meet. Every one of those is an **opaque
 * surface**, and every one of them is correct on a screen whose entire job is to
 * hold controls.
 *
 * The match HUD's job is the opposite. It sits over a fight the player is
 * reading through it: the asteroid they are chipping, the hull sliding into
 * their weapon's reach, the station they left undefended. Applying the plate
 * literally here would put furniture on top of the fight — a bezelled, shadowed,
 * rivetted panel behind the ore total is not the direction arriving on the HUD,
 * it is the direction being obeyed to the letter and the game getting worse.
 *
 * So: **same material logic, same tracking scale, same restraint — expressed as
 * edges, weights and spacing rather than as opaque panels.** Concretely, what
 * survives the crossing and what does not:
 *
 * | Gantry/Bone element | On the HUD | Why |
 * |---|---|---|
 * | The one tracking scale ({@link ../art/materials} `TRACKING`) | **Kept, verbatim** | Tracking costs no pixels of the world. The HUD is where the six drifted values still live (a flat `letterSpacing: 0.5` in every element), so this is the single biggest carry-over and the one a player reads first. |
 * | Bone — brightness, not hue | **Kept, and it earns more here** | Bone spends no colour on chrome, which is exactly what leaves signal yellow meaning ore, threat red meaning danger and plasma meaning energy *during a match* (style-guide §2). The menu version of this argument is aesthetic; the HUD version is a mechanic. |
 * | The 2px Bone accent rule under a beam | **Kept, as {@link drawEdgeRule}** | A rule is an edge, not a surface. It says "a readout ends here" with one line of pixels and occludes nothing. |
 * | The 3px accent tick inside a plate | **Kept, as {@link INSTRUMENT_TICK}** | Same argument: 3px wide, and it is what marks the head of a line of HUD copy. |
 * | The plate: bezel + face + inner sheen | **Dropped** | An opaque control surface over the fight. |
 * | The cast shadow | **Re-expressed as {@link drawScrim}** | The *reason* for the shadow — lift the thing off what is behind it — is real on the HUD too, because 11px Oxanium over a lit asteroid is unreadable. So the shadow keeps its job and loses its geometry: a scrim is the beam's own gradient with the beam's body removed, fading to **nothing** at every edge, so the world reads through it. |
 * | Rivets | **Dropped** | A fastener says two pieces of hardware are bolted together. Nothing on the glass is bolted to anything. |
 *
 * Pure numbers plus four draw primitives that speak {@link PlateCanvas} — the same
 * three-method structural slice of Pixi `Graphics` the material vocabulary uses —
 * so this module imports no PixiJS and unit-tests headless with a recorder, like
 * the rest of the decision layer in this directory.
 */

import { BONE, MATERIAL_SHADES, TRACKING, trackingPx, TYPE_MIN } from '../art/materials';
import type { PlateCanvas } from '../art/materials';
import { PALETTE } from '../art/palette';
import type { Rect } from '@platform/layout-registry';

// ---------------------------------------------------------------------------
// 1. Metrics — the same "the look is ratified, the metrics adapt" rule
// ---------------------------------------------------------------------------

/** The viewport the handoff's numbers were drawn at, mirrored from
 *  {@link ../art/materials} `REFERENCE_VIEWPORT` so the two frames agree. */
export const HUD_REFERENCE = { width: 1280, height: 720 } as const;

/**
 * How far HUD chrome may scale down. **Much higher than the menus' 0.25**, and
 * the difference is the point:
 *
 * A menu plate that shrinks is still a plate — its own floors ({@link
 * ../art/materials} `TOUCH_MIN`) catch it before it stops being pressable. A HUD
 * readout that shrinks is a number a player has to read *while being shot at*,
 * and style-guide §7 puts a hard floor under that ("Oxanium must remain legible
 * at 12px — verify at the mobile thumb-scale layout, not just desktop"). So the
 * HUD gives up a quarter of its chrome size and no more; past that the honest
 * answers are shorter copy or a different layout, not smaller type.
 */
export const HUD_SCALE_FLOOR = 0.75;

/** The HUD frame, resolved for one viewport. */
export interface HudMetrics {
  /** The viewport against the reference, clamped to {@link HUD_SCALE_FLOOR}..1.
   *  Exactly 1 on the desktop control, so the ratified sample survives its own
   *  derivation — the same test the menu frame has to pass. */
  readonly scale: number;
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Resolve {@link HudMetrics} for a viewport.
 *
 * Keyed off the **minimum** of the two axis ratios, like the menu frame and for
 * the same reason: Planet Rush is landscape-locked, so a phone held portrait
 * hands the HUD a wide, short logical viewport (844×390 on the iPhone profile)
 * and the short axis is the binding constraint. At 844×390 the raw ratio is
 * 0.54 and the floor wins at 0.75; at 1280×800 it is 1.
 */
export function hudMetrics(viewportWidth: number, viewportHeight: number): HudMetrics {
  const raw = Math.min(viewportWidth / HUD_REFERENCE.width, viewportHeight / HUD_REFERENCE.height);
  return { scale: clampNum(Number.isFinite(raw) ? raw : 1, HUD_SCALE_FLOOR, 1) };
}

/**
 * A HUD type size at these metrics, CSS px. Never below {@link TYPE_MIN} — the
 * same 11px floor the menus keep, because below it Oxanium stops being small
 * type and starts being a smudge.
 */
export function hudType(referencePx: number, m: HudMetrics): number {
  return Math.max(TYPE_MIN, Math.round(referencePx * m.scale));
}

/** A HUD spacing value at these metrics (a gap, a padding), CSS px. Floored at 2
 *  so a compressed layout still separates its pieces. */
export function hudSpace(referencePx: number, m: HudMetrics): number {
  return Math.max(2, Math.round(referencePx * m.scale));
}

// ---------------------------------------------------------------------------
// 2. Tracking — the ratified scale, applied by the job the text does
// ---------------------------------------------------------------------------

/**
 * The three tiers, re-exported rather than restated so there is exactly one
 * tracking scale in the game and a reader can see that this file did not invent
 * a fourth. Which tier a piece of HUD copy takes is decided by its **job**, never
 * by how the element felt on the day:
 *
 *  - `eyebrow` — the uppercase tag above a readout: `ORE`, `HOME`, `MATCH`.
 *  - `label` — a control's own word, or a line of instruction: a controls-strip
 *    action, an onboarding prompt, `RESPAWNING 3…`.
 *  - `name` — a proper noun or a value: `WAVE 1/5 · Outer Drift`, a player name,
 *    `100/100`, `WASD`, the banked ore total.
 */
export const HUD_TRACKING = TRACKING;

/** A tracking tier as PixiJS pixels at a given size — `TextStyle.letterSpacing`
 *  is px, the handoff speaks `em`. Always spell it this way rather than as a bare
 *  number, so a size change carries its tracking with it. */
export function hudTracking(tier: keyof typeof TRACKING, fontSizePx: number): number {
  return trackingPx(TRACKING[tier], fontSizePx);
}

// ---------------------------------------------------------------------------
// 3. The tones the HUD spends
// ---------------------------------------------------------------------------
//
// All three are steps on the Bone ramp — the value ramp on `hullSteel` that
// `materials.ts` declares and `materials.test.ts` recomputes — so nothing here can
// smuggle a seventh hue onto the glass any more than it can onto a plate.

/**
 * The rule that bounds a readout: the beam's 2px Bone accent rule, at 1px,
 * because on glass there is no beam under it for a second pixel to sit on.
 */
export const INSTRUMENT_RULE = BONE.lo;

/** The 3px accent tick at the head of a line of HUD copy — the plate's own tick,
 *  the one piece of its hardware that costs the world no pixels. */
export const INSTRUMENT_TICK = BONE.hi;

/**
 * The brightest step, for the one word on a HUD row that is the *binding* — a
 * controls-strip key, a wheel's live count.
 *
 * This is where Bone earns its keep in the match rather than in the menu. The
 * strip's keys used to draw in **plasma**, itself a correction of GDD §2.4's
 * "keys in signal yellow" (style-guide §2 forbids yellow as chrome). But plasma
 * is a *material* colour with a job — beams, cockpits, energy — and the HUD was
 * spending it on a keyboard legend, next to a shield overbar where the same hue
 * means "there is energy standing in front of this reactor". Bone says the
 * brightest thing is the important thing without spending a hue at all, so the
 * key goes bright and plasma goes back to meaning energy.
 */
export const INSTRUMENT_KEY = BONE.hi;

/** A readout's own secondary metal — the step between the rule and the tick.
 *  Sub-lines, units, an inert word beside a live one. */
export const INSTRUMENT_MID = BONE.mid;

/** The darkest colour the palette owns, and the colour of what a scrim falls on:
 *  vacuum. A scrim is never a *tint*, only an absence of the world. */
export const SCRIM_COLOR = PALETTE.vacuum;

/** The steel a track (an empty HP bar, a ghost pip) is drawn in. Named here so a
 *  HUD element spends it by role rather than reaching for `hullSteel` directly. */
export const INSTRUMENT_TRACK = MATERIAL_SHADES.rulePlate;

// ---------------------------------------------------------------------------
// 3b. The wheel's chrome — the same ramp, by the role a wheel has (u11-01)
// ---------------------------------------------------------------------------
//
// The Build & Upgrade wheel is the biggest instrument on the glass, and it is the
// last one still spending the pre-Gantry accent: its hub chevron drew in **plasma
// `#4DC3FF`**, its `OPEN ▸` signpost and its index diamond in a hand-picked
// chalk `#DCE3EC`, and its wedge faces and edges in raw `hullSteel`. A developer
// read the result as half-finished — *"the build wheel is halfway there it didn't
// fully implement the color theme correctly"* — and they were reading it right:
// the direction's whole premise is that **the menu spends no colour**, so a hue
// on a wheel's chrome is not a small deviation from it, it is the opposite of it.
//
// These live HERE rather than in `build-wheel-view.ts` for the reason the brief
// gives: there must not be a parallel answer. `INSTRUMENT_KEY` and friends above
// are the in-match vocabulary; the wheel takes the SAME ramp, named by the role a
// wheel has and nothing more. Pinned in `./instrument.test.ts`, which recomputes
// each one against `BONE` / `MATERIAL_SHADES` so a hand-edited hex cannot get in.
//
// What is NOT here, deliberately: the cost numerals and the hub's ore total. They
// are the one carved-out use of a RESERVED colour (style-guide §2.1 — signal
// yellow when payable, threat red when not), they are decided in `./wheel-stack`,
// and they are the only colour the wheel is allowed to spend. Everything below is
// material and brightness.

export const WHEEL_CHROME = {
  /**
   * The wedge you can act on, and the signpost that opens a screen: the brightest
   * metal on the wheel. Bone's own constraint is that the primary reads by
   * BRIGHTNESS rather than by hue, which is exactly what a radial menu needs —
   * every wedge is the same shape and the same size, so brightness is the only
   * channel left that is not already spoken for.
   */
  nameReady: BONE.hi,
  /**
   * A wedge that is pressable but is NOT the one being pointed at, on a wheel
   * where something else is (u16-01). Bone's mid step — the design's own second
   * name tone (`5a` script `wedge(i)`: `#C6CDD6` unselected against `#FFFFFF`
   * selected), taken off the ramp instead of hand-picked.
   *
   * It is a *recede*, not a dim: the wedge is still perfectly pressable and its
   * cost still carries its RESERVED colour. And it only ever applies while a
   * selection exists — with nothing pointed at, every ready name is
   * {@link nameReady} and the wheel is exactly the wheel that shipped before this
   * landed. A resting wheel that dimmed four of its five wedges to advertise a
   * choice nobody had made yet would be spending contrast on nothing.
   */
  nameReceded: BONE.mid,
  /**
   * A wedge that is refused, capped or inert. `tickSteel`, the same step the
   * wheel already paints a *spent* cost numeral in (`costPaint: 'spent'`), so
   * "there is nothing to do here" is one tone across the whole wheel rather than
   * one for a word and another for a number.
   */
  nameInert: MATERIAL_SHADES.tickSteel,
  /**
   * The lines a wedge is READ from rather than acted on — what it spends on, the
   * count over its cap, the hub's `ORE` caption. Bone's low step: the same
   * luminance the wheel already muted these to, sourced from the ramp instead of
   * from a bluer hand-picked grey.
   */
  secondary: BONE.lo,
  /** The hub's BACK word (`CLOSE · ESC`). A step above {@link secondary}, because
   *  it is the one thing in the hub you can press. */
  affordance: BONE.mid,
  /**
   * {@link secondary}, one step up: the read-only lines of the wedge the player
   * is pointing at (u16-01). The design lifts the selected wedge's sub line to
   * `#DCE3EC` from `#7E8894` (`5a` script `wedge(i)`), and this is that lift
   * taken off the ramp — the same step {@link nameReceded} steps a name DOWN to,
   * which is not a coincidence: the selection has exactly one notch of brightness
   * to spend and it spends it in both directions at once.
   */
  secondaryLit: BONE.mid,
  /**
   * A machined mark: the index diamond at twelve o'clock, and the hub's up-chevron.
   * One vocabulary for both — they are the same object (a small solid mark that
   * says "here"), and until u11-01 the diamond was chalk and the chevron was a
   * stroked plasma outline, which is two answers to one question.
   */
  mark: BONE.hi,
  /**
   * The face of a wedge — a *whisper*, not a plate. The wheel's own rule is that
   * the world reads through the disc, so a wedge's brightness is a lift over the
   * glass rather than a surface on top of it; `BONE.fill` is the ratified "lit end
   * of a primary face", and {@link WHEEL_FACE_ALPHA} is what keeps it a lift.
   */
  face: BONE.fill,
  /**
   * The hairline that divides one wedge from the next. Unchanged in value from
   * what shipped — it was already a Gantry tone — and named here so the wheel's
   * chrome is readable in one place.
   */
  divider: MATERIAL_SHADES.hairline,
  /**
   * A press, and a confirmed spend. Bone again: a pressed wedge goes BRIGHT, it
   * does not go blue. (A *rejected* press stays threat red — that is danger, the
   * other half of style-guide §2, and it is a mechanic rather than chrome.)
   */
  press: BONE.hi,
  /**
   * The highlight over the wedge being pointed at, and the two edge lines that
   * bound it (u16-01). Bone's brightest step, because that is the design's own
   * answer: screen 5a paints the selected quadrant in `--acc-tint` and its edges
   * in `--acc-hi`, and under the ratified Bone accent both of those resolve to
   * white. **The selection spends no hue** (u11-01) — it is brightness and scale,
   * on a wheel that opens over a live match where every colour already means
   * something.
   */
  selection: BONE.hi,
} as const;

/**
 * The selected wedge's highlight, in the design's own amounts (u16-01, screen
 * 5a). Every one of these is an ALPHA, which is the point: the highlight is a
 * brightness lift over the disc, never a plate on top of it, so the fight keeps
 * reading through the wheel exactly as {@link WHEEL_FACE_ALPHA} promises.
 *
 * The three layers, and where each number comes from:
 *
 *  - `tint` — `background: conic-gradient(from -45deg, var(--acc-tint,
 *    rgba(220,227,236,.26)) 0deg 90deg, …)` (`5a:55`). One arc of the ring, over
 *    the wedge face the player is pointing at.
 *  - `edge` / `edgeGlowAlpha` / `edgeGlowSpread` — `conic-gradient(from -45.8deg,
 *    var(--acc-hi) 0deg 1.6deg, …)` with `box-shadow: 0 0 26px
 *    rgba(255,255,255,.16)` (`5a:56`). Two bright lines on the wedge's own
 *    boundaries, with a bloom around them. `edgeDegrees` is the design's 1.6°.
 *  - `rim` / `rimFrom` — `radial-gradient(closest-side, transparent 62%,
 *    var(--acc-tint-soft, rgba(255,255,255,.14)) 100%)` masked to the quadrant
 *    (`5a:57`). The wedge brightens toward the rim, which is where the words are.
 *
 * `nameGlow` has no direct pixel equivalent in the markup: the design gives the
 * selected NAME a `text-shadow: 0 0 18px`, and this build has no text-shadow path
 * anywhere in `src/ui` (a blurred glyph raster is also the one thing in this
 * feature that would rasterise differently on a software-GL golden runner). It is
 * drawn instead as a soft bloom in the highlight's own `Graphics`, behind the
 * word — the same light, cast by the layer that is already casting light.
 */
export const WHEEL_SELECTION = {
  /** The accent-tint conic over the selected wedge's face. */
  tint: 0.26,
  /** The two edge lines bounding it. */
  edge: 0.9,
  /** How wide an edge line is, in degrees of arc — the design's 1.6°. */
  edgeDegrees: 1.6,
  /** Peak alpha of the bloom around an edge line. */
  edgeGlowAlpha: 0.16,
  /** How far that bloom reaches, as a multiple of the edge line's own width. */
  edgeGlowSpread: 6,
  /** Peak alpha of the outward glow, at the rim. */
  rim: 0.14,
  /** Where that glow starts, as a fraction of the outer radius. */
  rimFrom: 0.62,
  /** Peak alpha of the bloom behind the selected wedge's name. */
  nameGlow: 0.1,
  /** How many nested bands each of the two soft gradients is stepped into. A
   *  `Graphics` has no gradient fill, so a falloff is a stack of rings; six is
   *  where the banding stops being visible at a desktop radius. */
  bands: 6,
} as const;

/**
 * How much of {@link WHEEL_CHROME.face} a wedge's face carries, by state.
 *
 * Stated as its own number because it is the number that decides whether the
 * wheel is instruments on glass or a stack of plates. Over the disc
 * (`faceShade` at 0.88 over the fight) a ready face lands about eighteen levels
 * above the glass and an inert one about six — a 3× separation a player reads at
 * a glance, from a fill that is still 66% transparent at its strongest.
 *
 * The wedge draws NO outline of its own since u11-01. The ring it sits in is
 * already bounded — the disc rim outside it, the hub ring inside it, a hairline
 * spoke on each side — so an outline per wedge repeats three edges that exist and
 * turns five wedges into five little plates. That is precisely the "1px hairlines
 * on black, which reads as a wireframe rather than a product" the Gantry handoff
 * diagnoses, arriving on the one screen that cannot answer it with a surface.
 */
export const WHEEL_FACE_ALPHA = {
  ready: 0.34,
  inert: 0.12,
} as const;

// ---------------------------------------------------------------------------
// 4. The scrim — the cast shadow, with its geometry taken away
// ---------------------------------------------------------------------------

/**
 * Peak coverage, by what the scrim is under. Every one of these is the *most* the
 * scrim ever reaches, at the single band that hugs its anchored edge; it decays
 * to zero at every other edge, so nothing here draws a boundary a player can see.
 */
export const SCRIM = {
  /** Behind a corner readout — ore TOTAL, HOME, the wave clock. Enough that 11px
   *  Oxanium survives a lit asteroid passing under it, and no more. */
  corner: 0.55,
  /** Behind the desktop controls strip. A hair lighter: the strip is a legend, so
   *  it may lose to the world more readily than a live number may. */
  strip: 0.5,
  /**
   * Behind an onboarding prompt.
   *
   * This is the number that replaces a `PANEL_FILL` at 0.9 — a nearly-opaque
   * rounded panel that, at 844×390, covered the REPAIR REACTOR and RADAR wedges
   * of an open build wheel outright (measured in u7-02, and shot again in this
   * brief's `before-phone-landscape-wheel.png`). At 0.68 the wedge beneath is
   * still there to read, which is the whole rule this file is built on.
   */
  prompt: 0.68,
  /** Behind the respawn countdown. The highest of the four, and the only one with
   *  a licence to be: the local ship has just exploded, so there is nothing under
   *  the centre of the screen to read through. */
  overlay: 0.8,
} as const;

/** Flat bands a scrim's falloff is stepped into. Pixi `Graphics` has no cheap
 *  gradient; a step is invisible in a falloff and free to batch. Eighteen rather
 *  than ten because {@link SCRIM_CORE} packs the same falloff into the outer
 *  fifth of the rect: the bands sit closer together in *space*, so each one's
 *  edge has to move less than a pixel or the falloff stops being a falloff and
 *  starts being the banding GDD §5.4 calls a bug. */
export const SCRIM_BANDS = 18;

/**
 * The fraction of a scrim's extent that holds **full strength** before the
 * falloff starts — the plateau, exactly as {@link RULE_CORE} is the plateau on an
 * edge rule.
 *
 * **This is the number that decides whether a scrim does its job at all**, and
 * the first version of this file did not have it. Without a plateau the bands
 * shrink all the way to `1/SCRIM_BANDS` of the rect, so the stated peak is
 * reached only in a sliver: on the top-left ore cluster (58×54 at the reference)
 * the 0.55 core was 12 px wide and 5 px tall, and the readout it was drawn for
 * sat almost entirely in the fade. Measured on the shipped baseline, `TOTAL` over
 * a lit asteroid kept ~80% of the rock's luminance — the label ghosted, which is
 * the exact failure the scrim replaced the panel to avoid (style-guide §9).
 *
 * With the plateau the strongest band keeps `SCRIM_CORE` of the rect in **both**
 * axes, so the type is under the coverage the constant advertises and only the
 * outer fifth is fade. Flat rects are unaffected where it matters — a
 * 1280×40 strip's taper is still bounded by its own height (below) — so this buys
 * the corner clusters their darkness without turning the strip into a beam.
 */
export const SCRIM_CORE = 0.6;

/**
 * How far a scrim tapers **inward along the long axis** as it strengthens, as a
 * multiple of its own short-axis extent. The taper is what stops the strong core
 * from ending in a visible vertical edge: the faintest band is the full rect and
 * the strongest is inset by this much on both sides, so the darkness reads as a
 * soft blot rather than a box.
 */
export const SCRIM_TAPER = 0.6;

/** Which edge a scrim hangs from — the direction its darkness decays away from. */
export type ScrimAnchor = 'top' | 'bottom' | 'center';

/**
 * How far a scrim's core is inset from its long edges — the taper, solved once
 * so {@link drawScrim}, {@link scrimPlateau} and {@link scrimGround} cannot
 * disagree about where the darkness actually is.
 */
export function scrimTaper(w: number, h: number): number {
  return Math.min(h * SCRIM_TAPER, (w * (1 - SCRIM_CORE)) / 2);
}

/**
 * **The part of a scrim that is actually dark** — the innermost band, where the
 * peak coverage the {@link SCRIM} constant advertises is reached and held.
 *
 * A scrim decays to nothing at every edge, so its rect is not its ground: only
 * this plateau is. That distinction is the whole of a0-102. The top-left ore
 * cluster's scrim was drawn on a rect **coincident with its own type** — same
 * origin, same width — so `ORE` sat at 0.06–0.37 coverage and the banked
 * numeral's leading column at 0.15, against a constant whose doc says 0.55 is
 * the least that survives a lit asteroid. The scrim was there; the ground was
 * not, which is exactly what QA saw and reported as "no plate, scrim or panel".
 *
 * Anchored scrims (`top`/`bottom`) hold their peak against the anchored edge, so
 * the plateau reaches it; a `center` scrim's plateau is inset on both sides.
 */
export function scrimPlateau(rect: Rect, anchor: ScrimAnchor): Rect {
  const taper = scrimTaper(rect.width, rect.height);
  const height = rect.height * SCRIM_CORE;
  const y =
    anchor === 'top'
      ? rect.y
      : anchor === 'bottom'
        ? rect.y + rect.height - height
        : rect.y + (rect.height - height) / 2;
  return { x: rect.x + taper, y, width: Math.max(0, rect.width - taper * 2), height };
}

/**
 * The smallest `center`-anchored scrim rect whose {@link scrimPlateau} covers
 * `ink` — i.e. **the ground a readout has to be given** for every glyph it draws
 * to sit on the coverage its scrim promises, rather than in the falloff.
 *
 * The inflation is `1 / SCRIM_CORE` about the ink's own centre in both axes,
 * which costs a third of the ink's extent as padding on each side. That padding
 * is not decoration: it *is* the falloff, moved off the type and out to where a
 * scrim is allowed to be soft. It also subsumes what {@link
 * ../ui/hud-geometry} `SCRIM_BLEED` was buying by hand — the darkness now starts
 * before the type and ends after the rule by construction.
 *
 * `scrimPlateau(scrimGround(ink))` contains `ink` for every finite ink box: the
 * y solve is exact, and the x taper is `min`'d against the same
 * `(1 - SCRIM_CORE) / 2` fraction this inflates by, so it can only come out
 * smaller — never larger. Asserted in ./instrument.test.ts.
 */
export function scrimGround(ink: Rect): Rect {
  const pad = (1 / SCRIM_CORE - 1) / 2;
  const padX = ink.width * pad;
  const padY = ink.height * pad;
  return {
    x: ink.x - padX,
    y: ink.y - padY,
    width: ink.width + padX * 2,
    height: ink.height + padY * 2,
  };
}

/**
 * Solve the per-band alpha for a set of **nested** translucent bands, given the
 * coverage each band should leave behind it.
 *
 * Band `i` paints over everything bands `0..i-1` already laid down, so its own
 * alpha is the increment that carries the accumulated coverage from the previous
 * target to this one. Painting `peak / count` per band instead is how a stepped
 * falloff ends up looking thin — the same solve {@link ../art/materials} does for
 * a plate's cast shadow, restated here because it is private there.
 */
export function nestedAlphas(targets: readonly number[]): number[] {
  const out: number[] = [];
  let covered = 0;
  for (const target of targets) {
    if (target <= covered || covered >= 1) continue;
    out.push((target - covered) / (1 - covered));
    covered = target;
  }
  return out;
}

/** The coverage targets a scrim's bands ascend through, faintest first. */
export function scrimTargets(peak: number, count: number = SCRIM_BANDS): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((peak * (i + 1)) / count);
  return out;
}

/**
 * Draw a scrim over `(x, y, w, h)`: nested vacuum bands that reach `peak`
 * coverage at the anchored edge and decay to nothing at every other one.
 *
 * The bands **nest** — each is drawn over the whole remainder toward the anchor
 * rather than over its own strip — so no two share an edge to antialias a seam
 * along, and their alphas are solved for that stacking ({@link nestedAlphas}).
 * Nothing is drawn outside the given rect, which is what keeps the layout
 * registry's record of a scrimmed element equal to the element itself.
 *
 * Allocates one small array per band and nothing else; call it when the rect
 * changes, not every frame.
 */
export function drawScrim(
  canvas: PlateCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  anchor: ScrimAnchor,
  peak: number,
  bands: number = SCRIM_BANDS,
): void {
  if (w <= 0 || h <= 0 || peak <= 0 || bands <= 0) return;
  const alphas = nestedAlphas(scrimTargets(peak, bands));
  const n = alphas.length;
  if (n === 0) return;
  // How far the innermost band shrinks: to `SCRIM_CORE` of the extent it decays
  // along, so the stated peak lands on a plateau the readout actually sits on
  // rather than on a sliver through the middle of it.
  const shrink = 1 - SCRIM_CORE;
  // The long-axis taper, bounded by the same plateau from the other side, so the
  // core keeps `SCRIM_CORE` of the width however square the rect is — a corner
  // cluster is nearly square, and it was the case the short-axis rule alone left
  // with a 12px-wide core.
  const taper = scrimTaper(w, h);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1); // 0 = outermost/faintest, 1 = core
    const inset = taper * t;
    const bx = x + inset;
    const bw = w - inset * 2;
    const bh = h * (1 - t * shrink);
    const by =
      anchor === 'top' ? y : anchor === 'bottom' ? y + h - bh : y + (h - bh) / 2;
    if (bw <= 0 || bh <= 0) continue;
    canvas.poly([bx, by, bx + bw, by, bx + bw, by + bh, bx, by + bh], true);
    canvas.fill({ color: SCRIM_COLOR, alpha: alphas[i]! });
  }
}

// ---------------------------------------------------------------------------
// 5. The rule — a beam's accent line, and nothing else of the beam
// ---------------------------------------------------------------------------

/** Segments a faded rule is stepped into, widest (faintest) first. */
export const RULE_STEPS = 16;

/** The fraction of a rule's width that holds full strength before it fades —
 *  the handoff's own plateau on the beam's Bone accent rule (12% each end). */
export const RULE_CORE = 1 - 0.12 * 2;

/** Default opacity of an instrument rule. Solid enough to be an edge, faint
 *  enough that it never competes with the readout it bounds. */
export const RULE_ALPHA = 0.55;

/**
 * Draw a horizontal rule that fades out at both ends — the 2px Bone accent rule
 * a beam carries, reduced to the one line of it that can live on glass.
 *
 * Drawn as nested segments centred on the same line: the outermost spans the full
 * width at the faintest alpha, the innermost spans {@link RULE_CORE} of it at
 * full strength. At 1px, stepped segments read as a fade.
 */
export function drawEdgeRule(
  canvas: PlateCanvas,
  x: number,
  y: number,
  w: number,
  thickness = 1,
  color: number = INSTRUMENT_RULE,
  alpha: number = RULE_ALPHA,
  core: number = RULE_CORE,
): void {
  if (w <= 0 || thickness <= 0 || alpha <= 0) return;
  const alphas = nestedAlphas(scrimTargets(alpha, RULE_STEPS));
  const last = Math.max(1, alphas.length - 1);
  for (let i = 0; i < alphas.length; i++) {
    const segW = w * (1 + (core - 1) * (i / last));
    if (segW <= 0) continue;
    const sx = x + (w - segW) / 2;
    canvas.poly([sx, y, sx + segW, y, sx + segW, y + thickness, sx, y + thickness], true);
    canvas.fill({ color, alpha: alphas[i]! });
  }
}

// ---------------------------------------------------------------------------
// 6. The tick
// ---------------------------------------------------------------------------

/** The accent tick's geometry, read off {@link ../art/materials} `PLATE_SCALES` —
 *  3px wide at every scale the handoff draws, because a tick is hardware. */
export const TICK_WIDTH = 3;

/** Draw the accent tick at the head of a line of HUD copy: a 3px bar, centred on
 *  `(x, cy)`, `height` tall. The one piece of the plate that comes across. */
export function drawTick(
  canvas: PlateCanvas,
  x: number,
  cy: number,
  height: number,
  color: number = INSTRUMENT_TICK,
  alpha = 1,
): void {
  if (height <= 0 || alpha <= 0) return;
  const y = cy - height / 2;
  canvas.poly([x, y, x + TICK_WIDTH, y, x + TICK_WIDTH, y + height, x, y + height], true);
  canvas.fill({ color, alpha });
}

// ---------------------------------------------------------------------------
// 7. Corners — a surface is square
// ---------------------------------------------------------------------------

/**
 * The corner radius every bar, pip and track on the glass draws with: **zero**.
 *
 * The handoff's own rule, applied rather than reinterpreted: *"a raised plate is
 * chamfered; a surface is square — the handoff draws every settings row and every
 * ship row with plain corners, and cuts only the plates that stand off the
 * screen"* ({@link ../art/materials} `PlateMaterial.chamfered`). Nothing on the
 * HUD stands off the screen — that is the whole rule of this file — so nothing on
 * the HUD is chamfered, and a 2px round on a 4px-tall HP bar was never anything
 * but a leftover from the pre-Gantry chrome.
 */
export const INSTRUMENT_RADIUS = 0;

/**
 * The fill rect of a **hull bar** — the coloured part — given the track it sits
 * in and the fraction of the pool that is left.
 *
 * ## Which way a bar empties (Director, 2026-08-19, a0-101)
 *
 * a0-99 photographed two hull readouts on one screen draining in opposite
 * directions: the station's `88/100` had its missing twelve per cent as an empty
 * block at the **left** end (fill anchored right), and the ship's `23/50` had its
 * missing part at the **right** (fill anchored left). QA declined to rule, because
 * the station bar sits under a right-aligned `HOME` label and a right anchor there
 * is arguable. The ruling:
 *
 * > **Every hull bar empties rightward: fill anchored left, empty space on the
 * > right.** The ship bar is already correct; the station bar moves.
 *
 * The reason is the ship bar's: it is the one a player reads most often and under
 * the most pressure, and left-anchored is the ordinary convention a player arrives
 * with. A label's text alignment is a typographic choice and is **not** a reason
 * for the quantity beneath it to run the other way — nothing else on the HUD takes
 * its direction from the label above it.
 *
 * It lives here, in the grammar file, next to {@link INSTRUMENT_TRACK} — the steel
 * an *empty* bar is drawn in — because the pair is one idea: a bar is a track plus
 * a fill, the fill starts at the track's left edge, and what is left over is the
 * absence you can see. Every bar that reads a hull or a hull-like pool
 * ({@link ./hud-geometry} `stationCoreBarTrack` / `stationShieldBarTrack`,
 * {@link ./healthbar} `healthBarTrack`) computes its fill through this one
 * function, so a new bar cannot quietly pick the other side — and
 * `hud-geometry.test.ts` (`every hull bar empties in the same direction`) walks
 * the whole enumeration.
 *
 * `fraction` is clamped to `[0, 1]`; a non-finite fraction draws nothing. The
 * caller still owns the "a living thing never renders empty" floor
 * ({@link ./healthbar} `HEALTHBAR_MIN_FILL`) — that is a truth rule about the
 * pool, not a direction rule about the bar.
 */
export function hullBarFill(track: Rect, fraction: number): Rect {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return { x: track.x, y: track.y, width: track.width * f, height: track.height };
}

/**
 * The gantry corner cut, for the one HUD element that is genuinely a *raised
 * surface* rather than a readout on glass: the minimap's frame.
 *
 * The minimap is opaque by necessity — it is a screen, and dots on a transparent
 * screen are not readable — so it is the only place on the HUD where the world
 * does not read through, and the only place the plate's silhouette is honest. It
 * gets the cut (top-right and bottom-left, never all four) and the Bone rule; it
 * does not get a bezel, a sheen or a cast shadow, because it is set INTO the
 * glass rather than standing off it.
 */
export const MINIMAP_CHAMFER = 14;

/**
 * The gantry silhouette as a flat polygon: a box with the **top-right and
 * bottom-left** corners cut back by `c`, and the other two square. Never all four
 * — the asymmetry is the direction's signature, and a box with four cut corners
 * is an octagon, not a gantry.
 *
 * {@link ../art/materials} `drawPlate` builds the same shape by clipping two
 * half-planes, because it has a full plate's worth of nested bands to run through
 * them. The two HUD surfaces that wear this silhouette draw one outline each, so
 * they take the outline directly.
 */
export function gantryPoly(x: number, y: number, w: number, h: number, chamfer: number): number[] {
  const c = Math.max(0, Math.min(chamfer, Math.min(w, h) / 2));
  if (c === 0) return [x, y, x + w, y, x + w, y + h, x, y + h];
  return [
    x, y,
    x + w - c, y,
    x + w, y + c,
    x + w, y + h,
    x + c, y + h,
    x, y + h - c,
  ];
}
