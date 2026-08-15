/**
 * src/art/vfx/shots.ts — the PIERCE laser bolt. OWNER: Art & Audio Agent.
 *
 * A shot used to be two concentric circles. A round projectile carries **no
 * direction**: a still frame could not say which way a shot was travelling or
 * who loosed it, and the player had to watch it move to find out. This file is
 * the developer's own pick out of `assets/preview/laser-lab.html` — four shapes ×
 * bloom × length × thickness × core, 432 combinations, each drawn at the
 * projectile's real 4-unit collision radius beside a 12-unit ship across three
 * skies — and the combination that came back was **PIERCE**: *"i like the white
 * tip from tracer, but i like the lines from beam"*.
 *
 * `tools/make-laser-tiers.ts` is the definition; this is that function ported,
 * not re-derived. It went through six rounds of review in one session and each
 * round rejected something specific, so the reasoning is recorded here rather
 * than left to be walked back by someone re-tuning from the numbers alone.
 *
 * ## 1. Colour is the SIDE, never the tier
 *
 * *"all friendlies should have that same blue and all enemies red... even in team
 * mode... in ffa its all red obviously"*. A teammate's fire is friendly fire and
 * reads as yours, in Teams and in FFA alike. This **retires the four-shade
 * per-rung ladder** that used to live here (`SHOT_TIER_COLORS`, gone with this
 * change; its shades stay declared in `../palette` and are documented there as
 * retired from the shot body). One colour per side, flat, at every rung.
 *
 * ## 2. The rung is GIRTH at the head and LENGTH at the tail
 *
 * *"add some girth that comes from the tip... so mk iv looks like almost like a
 * ball with a trail"* + *"make the trails length also be influenced by the mk's,
 * mk iv uses what it has now and we decrease down to mk 1"*.
 *
 * | rung | head half-width | tail length |
 * |---|---|---|
 * | Mk I | 0.377 | 3.41 |
 * | Mk II | 0.641 | 4.64 |
 * | Mk III | 0.980 | 5.73 |
 * | Mk IV | 1.470 | 6.83 |
 *
 * Only the **tail** scales — {@link BOLT_FWD} never moves — so a bolt grows
 * backwards out of its own tip instead of sliding along the firing line. The
 * body's half-thickness is {@link BOLT_BODY_HALF_WIDTH} at *every* rung; if the
 * body thickens, the trail stops being a trail. Two channels carry the rung
 * deliberately: the head is what you see in a close firefight, the trail is what
 * you see in a burst strung across the screen.
 *
 * ## 3. The head is a taper, not a capsule and not a spindle
 *
 * Two shapes were rejected on the way here, and both are the obvious thing to
 * write:
 *
 *  - **capsule** (constant width, round at both ends) — *"it looks like pill"*.
 *    Two identical ends read as an OBJECT threaded onto the line.
 *  - **spindle** (swells in the middle, points at the front) — the point at the
 *    leading edge reads as a dart, not a bolt.
 *
 * What was approved is a blunt round cap at the FRONT, tapering BACKWARD until it
 * meets the trail's half-width **exactly**, smoothstepped so there is no shoulder
 * at the join. That last equality is the point, and it is why {@link taperedHead}
 * takes `hwBack = hw`. At Mk IV the profile runs, front to back:
 *
 *     1.470 → 1.257 → 0.787 → 0.317 → 0.104
 *
 * and 0.104 is {@link BOLT_BODY_HALF_WIDTH}. (The ruling's own table reads
 * `1.470 → 1.251 → 0.769 → 0.287 → 0.068` — the same curve with the back width
 * multiplied by the `Thin` knob a second time, which lands the taper *under* the
 * trail rather than on it and contradicts the ruling's own "0.104 at every rung".
 * `make-laser-tiers.ts` passes `hwBack = hw` and is the definition, so that is
 * what is ported; the difference is 0.036 of a collision radius at the join.)
 *
 * ## 4. A white core, inside a coloured sheath, composited additively
 *
 * Every laser-bolt reference builds it the same way: a near-white hot core
 * running the full length, a saturated coloured sheath around it, added rather
 * than painted. Earlier attempts coloured the body and tinted only the tip, which
 * is why they read as a coloured object rather than as light. The renderer sets
 * `blendMode = 'add'` on the shot layer for exactly this reason (`../../render`);
 * the SVG preview could only approximate it with alpha, so the game should look
 * **better** than the preview, not worse.
 *
 * ## How it stays free (GDD §4.3)
 *
 * Each (family, tier) is still one baked {@link SpriteDef}, pooled by
 * `${family}:${tier}` and swapped into a slot only when that slot's shot changes
 * side or rung — the draw-call count does not move. What did move is the quad:
 * the sprite's extent went from 1.48 to {@link SHOT_SPRITE_EXTENT}, so the bloom
 * is a much larger transparent rectangle. `evidence/a0-46-pierce-laser-shot/`
 * carries the before/after fill measurement on the §4.3 scene.
 */

import { DERIVED, PALETTE } from '../palette';
import { circle, fill, poly, softFill, sprite, type PaintRole, type Shape, type SpriteDef } from '../shapes';

/**
 * Whose shot this is, from the viewer's seat: `own` fire (the viewer's, and any
 * ally's) is plasma; `enemy` fire is threat red. A renderer resolves this per
 * shot (`areEnemies`), never the art.
 */
export type ShotFamily = 'own' | 'enemy';

/** Both families, for the catalogue and any exhaustive walk. */
export const SHOT_FAMILIES: readonly ShotFamily[] = ['own', 'enemy'];

/**
 * **Colour is the side.** The whole ruling, in two entries: every friendly bolt
 * is plasma and every hostile bolt is threat red, in FFA and in Teams alike, at
 * every DAMAGE rung. What separates the rungs is girth and length, below.
 */
export const SHOT_SIDE_COLOR: Readonly<Record<ShotFamily, number>> = {
  own: PALETTE.plasma,
  enemy: PALETTE.threatRed,
};

/** The paint role each family wears — so the compliance audit keeps enemy fire
 *  on `danger` (threat red is reserved for it) and own fire on `energy`. */
const SHOT_ROLE: Readonly<Record<ShotFamily, PaintRole>> = { own: 'energy', enemy: 'danger' };

/**
 * The head's half-width multiplier per rung — *"add some girth that comes from
 * the tip"*. The BODY never thickens; only the head swells, so Mk I is a needle
 * and Mk IV is a ball dragging a line. At Mk IV the head is ~14× the body's
 * half-thickness, which is the ratio that reads as "ball with a trail" rather
 * than "slightly fatter laser".
 */
export const SHOT_TIER_GIRTH: readonly number[] = [1.0, 1.7, 2.6, 3.9];

/**
 * The **tail**'s length multiplier per rung. Mk IV is 1.0 — exactly what was
 * approved — and the rungs below it are shorter. The head's position is untouched
 * by this, so the bolt grows backwards out of its own tip.
 */
export const SHOT_TIER_TRAIL: readonly number[] = [0.5, 0.68, 0.84, 1.0];

/** The top rung index — a tier past this reads as the fiercest shot. */
export const SHOT_MAX_TIER: number = SHOT_TIER_GIRTH.length - 1;

/** All tier indices, for the catalogue and tests. */
export const SHOT_TIERS: readonly number[] = SHOT_TIER_GIRTH.map((_, i) => i);

// ---------------------------------------------------------------------------
// The locked pick — Pierce · Intense · Short · Thin · Hot
// ---------------------------------------------------------------------------

/** The lab's raw pick, before the length and thickness knobs are applied. */
const LAB_BACK = -10.5;
const LAB_FWD = 2.2;
const LAB_BODY_HW = 0.16;
const LAB_HEAD_HW = 0.58;
/** The picked `Short` length knob and `Thin` thickness knob. */
const LEN = 0.65;
const THICK = 0.65;

/** How far ahead of the projectile's centre the bolt's tip sits, in collision
 *  radii. **Fixed at every rung** — the tail grows backwards out of it. */
export const BOLT_FWD: number = LAB_FWD * LEN;

/**
 * The trail's half-thickness, in collision radii, **at every rung**. This number
 * not moving is the whole reason the bolt reads as a trail and not as a fat
 * lozenge; a ramp that thickens the body is the failure mode `shots.test.ts`
 * guards against by name.
 */
export const BOLT_BODY_HALF_WIDTH: number = LAB_BODY_HW * THICK;

const BLOOM_ALPHA = 0.62;
const BLOOM_MULT = 1.6;
/** The core's alpha through the head taper, and along the body behind it. */
const CORE_HEAD_ALPHA = 0.9;
const CORE_BODY_ALPHA = 0.75;

/** A tier clamped into the ramp — a missing/`NaN`/over-max tier reads as the
 *  nearest rung, the same clamp the sim uses on `Turret.tier` / an upgrade tier.
 *  So an untagged or wire-decoded shot is never a crash, just tier 0. */
export function clampShotTier(tier: number): number {
  if (!Number.isFinite(tier)) return 0;
  return Math.max(0, Math.min(Math.floor(tier), SHOT_MAX_TIER));
}

/** The bolt's measurements at a rung, in collision radii — the two channels that
 *  carry the DAMAGE tier, plus the one that must never move. */
export interface BoltGeometry {
  /** The tail's far end (negative: behind the projectile). */
  readonly back: number;
  /** The tip. The same at every rung. */
  readonly fwd: number;
  /** How long the tail is — `|back|`. Climbs with the rung. */
  readonly trailLength: number;
  /** The head's half-width at the tip. Climbs with the rung. */
  readonly headHalfWidth: number;
  /** The trail's half-thickness. {@link BOLT_BODY_HALF_WIDTH} at every rung. */
  readonly bodyHalfWidth: number;
}

/** The bolt's geometry at a DAMAGE rung. The tier's whole job, as numbers. */
export function boltGeometry(tier: number): BoltGeometry {
  const t = clampShotTier(tier);
  const trail = SHOT_TIER_TRAIL[t]!;
  const girth = SHOT_TIER_GIRTH[t]!;
  const back = LAB_BACK * LEN * trail;
  return {
    back,
    fwd: BOLT_FWD,
    trailLength: Math.abs(back),
    headHalfWidth: LAB_HEAD_HW * THICK * girth,
    bodyHalfWidth: BOLT_BODY_HALF_WIDTH,
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Quantised to 1e-4, the repo-wide rule for emitted geometry: art is code and
 *  runs in three places that must agree byte for byte (`../generators.test.ts`).
 *  The polygon builders below get this from their own `toFixed(4)`; the head's
 *  bloom is a `circle`, whose radius is a product of the girth ramp and needs it
 *  applied by hand. */
const q4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A capsule along the x axis: constant half-width `hw`, round at both ends. */
function capsule(back: number, fwd: number, hw: number, steps = 8): number[] {
  const p: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI;
    p.push(+(fwd + Math.cos(a) * hw).toFixed(4), +(Math.sin(a) * hw).toFixed(4));
  }
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 2 + (i / steps) * Math.PI;
    p.push(+(back + Math.cos(a) * hw).toFixed(4), +(Math.sin(a) * hw).toFixed(4));
  }
  return p;
}

/**
 * The head: a blunt round cap at `xFront` of radius `hwFront`, tapering BACKWARD
 * to exactly `hwBack` at `xBack`, smoothstepped so the join into the trail has no
 * shoulder.
 *
 * This is the shape that separates "laser" from "pill", and the asymmetry IS the
 * direction. A capsule has two identical ends and reads as an object threaded
 * onto the line; a spindle that comes to a point at the front reads as a dart.
 * Blunt in front, dissolving into the line behind, is what reads as a bolt — and
 * callers pass `hwBack = ` the trail's own half-width so the taper *lands on* the
 * trail rather than meeting it at an edge.
 */
function taperedHead(xBack: number, xFront: number, hwBack: number, hwFront: number, steps = 16): number[] {
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const top: number[] = [];
  const bot: number[] = [];
  for (let i = 0; i <= steps / 2; i++) {
    const a = -Math.PI / 2 + (i / (steps / 2)) * Math.PI;
    top.push(+(xFront + Math.cos(a) * hwFront).toFixed(4), +(Math.sin(a) * hwFront).toFixed(4));
  }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = xFront - (xFront - xBack) * t;
    const w = hwFront + (hwBack - hwFront) * smooth(t);
    bot.push(+x.toFixed(4), +w.toFixed(4));
  }
  const out: number[] = [];
  for (let i = bot.length - 2; i >= 0; i -= 2) out.push(bot[i]!, +(-bot[i + 1]!).toFixed(4));
  out.push(...top);
  for (let i = 0; i < bot.length; i += 2) out.push(bot[i]!, bot[i + 1]!);
  return out;
}

/**
 * The baked bolt for a (family, tier), authored in unit space where radius `1` is
 * the projectile's collision radius and **+x is the direction of travel** — the
 * renderer rotates the sprite onto the shot's velocity (`../../render`
 * `drawShots`), which is the half of this change that makes it a laser rather
 * than a lance always pointing east.
 *
 * Back to front: the trail's elongated bloom, the head's round bloom, the
 * coloured sheath, the head's taper, and the white core through both. One sprite
 * per rung, so the shot pool bakes it once and shares it across every shot of
 * that family and rung.
 */
export function shotSprite(family: ShotFamily, tier: number): SpriteDef {
  const t = clampShotTier(tier);
  const bodyColor = SHOT_SIDE_COLOR[family];
  const role = SHOT_ROLE[family];
  const girth = SHOT_TIER_GIRTH[t]!;
  const { back, fwd, headHalfWidth: headHw, bodyHalfWidth: hw } = boltGeometry(t);
  const half = (fwd - back) / 2;
  const mid = (fwd + back) / 2;
  const out: Shape[] = [];

  // The trail's bloom — elliptical, along the line. It is the TRAIL, so its
  // shape does not change with the rung; its length follows the tail's.
  const gx = half * BLOOM_MULT + 1.2;
  const gy = Math.max(hw * 3.2, 0.9) * 1.3;
  out.push(
    poly(
      capsule(mid - gx, mid + gx, gy, 12),
      softFill(bodyColor, role, BLOOM_ALPHA, { cx: mid, cy: 0, rx: gx, ry: gy, angle: 0 }),
    ),
  );

  // The head's own bloom, ROUND and scaled by the rung. This is the half that
  // makes a high rung read as a ball: a round glow around a round head, against
  // an elongated glow around the line behind it.
  const hg = q4(headHw * 2.3);
  out.push(
    circle(q4(fwd), 0, hg, softFill(bodyColor, role, 0.28 + 0.14 * (girth - 1), { cx: q4(fwd), cy: 0, rx: hg, ry: hg, angle: 0 })),
  );

  // The coloured sheath: the trail, and the head grown out of it.
  out.push(poly(capsule(back, fwd, hw, 6), fill(bodyColor, role, 0.9)));
  out.push(poly(taperedHead(fwd - headHw * 3.2, fwd, hw, headHw), fill(bodyColor, role, 0.95)));

  // The white core, through the head and then the full length of the body, at
  // half the sheath's width. This is the thing that makes a bolt read as light.
  out.push(
    poly(taperedHead(fwd - headHw * 3.2, fwd, hw * 0.5, headHw * 0.52), fill(DERIVED.boltCore, role, CORE_HEAD_ALPHA)),
  );
  out.push(
    poly(capsule(back * 0.92, fwd - headHw * 0.6, hw * 0.5, 6), fill(DERIVED.boltCore, role, CORE_BODY_ALPHA)),
  );

  return sprite(`vfx:shot:${family}:${t}`, boltExtent(t), out);
}

/**
 * The sprite's authored half-extent at a rung: the furthest any of its five parts
 * actually reaches from the projectile's centre.
 *
 * `make-laser-tiers.ts` declares this as `max(|back| × 1.6, |fwd| + hg) + 1.5`,
 * and that heuristic is **not a bound** — it under-declares the low rungs by up
 * to 0.28 units, because the trail's bloom is a capsule that runs to
 * `mid ± (gx + gy)` and the formula only counts `|back| × 1.6`. In the preview it
 * survived on the SVG's own slack; in the game the extent is the size of the
 * BAKE, so an extent short of the paint clips the tail's bloom against the edge
 * of its own texture. (It would have survived here too, on `BAKE_MARGIN`'s 8% —
 * which exists so a hairline stroke on the boundary is not clipped, not as
 * headroom for art that overshoots its declared box.)
 *
 * So this is the one number in this file derived rather than ported, per the
 * brief's own instruction to re-derive the cull constant from the new extent. It
 * is exact, which also makes it *tighter* than the heuristic at the top rung —
 * 11.67 against 12.42 — and the extent sets the baked quad, so tighter is
 * directly less fill on the layer whose fill this change grows.
 */
function boltExtent(tier: number): number {
  const { back, fwd, headHalfWidth: headHw, bodyHalfWidth: hw } = boltGeometry(tier);
  const half = (fwd - back) / 2;
  const mid = (fwd + back) / 2;
  const gx = half * BLOOM_MULT + 1.2;
  const gy = Math.max(hw * 3.2, 0.9) * 1.3;
  const hg = headHw * 2.3;
  const reach = Math.max(
    Math.abs(mid) + gx + gy, // the trail's bloom, both ends of its capsule
    gy, // ...and across it
    Math.abs(fwd) + hg, // the head's round bloom
    hg,
    Math.abs(back) + hw, // the sheath
    headHw,
  );
  // The paths themselves are emitted at four decimal places, which can round a
  // vertex OUTWARD by up to 5e-5 — enough to put a point a hair outside an
  // otherwise exact extent. Round the bound up past that, so "the extent bounds
  // the paint" is true of the numbers actually in the sprite and not merely of
  // the algebra behind them.
  return Math.ceil(reach * 1e3) / 1e3;
}

/**
 * The widest extent any bolt declares — the top rung's, since the tail's bloom
 * grows with the rung. **11.67, where the round shot it replaces was 1.48.** A
 * bolt whose centre is a dozen radii off screen can still be painting its tail
 * across the window, which is why the cull tests the drawn reach and not the
 * centre (`../../render/cull` `RENDER_EXTENT.shot`).
 */
export const SHOT_SPRITE_EXTENT: number = Math.max(...SHOT_TIERS.map(boltExtent));
