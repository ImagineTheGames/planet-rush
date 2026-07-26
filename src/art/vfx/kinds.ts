/**
 * src/art/vfx/kinds.ts — what a particle looks like. OWNER: Art & Audio Agent.
 *
 * Eleven stock particles carry the whole VFX set (GDD §3.6). That is on purpose:
 * eleven looks means eleven baked textures for the entire effects layer, which
 * is what keeps hundreds of live particles inside the frame budget (GDD §4.3) —
 * every one of them is a `Sprite` sharing one of those textures, and per frame
 * the draw layer touches position, rotation, scale and alpha only.
 *
 * Each kind is a `SpriteDef` like every other sprite in `src/art/`, so the
 * palette audit walks it exactly like it walks a hull (`../compliance`): a spark
 * that quietly went signal yellow fails CI rather than teaching a player that
 * yellow means something other than ore (style-guide §2).
 *
 * ## The tint policy
 *
 * Particles can be tinted per emission — a thruster trail has to be the pilot's
 * colour. Style-guide §3 is strict about where identity colour may live ("wing
 * tips, cockpit glass, engine flame, weapon tint, planet beacon ring, HP bar"), so
 * each kind declares whether it may take one:
 *
 *  - `fixed`    — the kind's own palette colour, always. A rock chip is rock.
 *  - `identity` — may be tinted with a roster colour, because the thing it
 *                 depicts is on the style guide's list: engine flame, weapon tint.
 *
 * `kinds.test.ts` checks emitters against that policy, so the rule is mechanical
 * rather than remembered.
 */

import { DERIVED, PALETTE, PLAYER_COLORS } from '../palette';
import { annulusPoints, circle, fill, poly, sprite, type SpriteDef } from '../shapes';

// ---------------------------------------------------------------------------
// The eleven
// ---------------------------------------------------------------------------

/** The stock particle looks. Numeric — a particle's kind is a byte column. */
export const PARTICLE = {
  /** Plasma bite: shot impact, the cutting torch throwing sparks. */
  spark: 0,
  /** Firework ember: explosions (GDD §4.7 — "explosions are fireworks"). */
  ember: 1,
  /** Rock debris: the crack stages and the burst. */
  chip: 2,
  /** Ore glint: what a burst rock actually pays out. The only yellow here. */
  oreBit: 3,
  /** A short bright star: muzzle flash, build completion, the spark of a spend. */
  flare: 4,
  /** An expanding ring: shield shimmer, spawn glow, shockwaves. */
  ring: 5,
  /** Slow grey smoke: a burning planet, visible from further than its numbers. */
  smoke: 6,
  /** Hull/crust shard: a dead planet's crust, a turret coming apart. */
  shard: 7,
  /** Engine flame: the thruster trail, in the pilot's colour. */
  trail: 8,
  /** Damage spatter: threat red, and only ever damage. */
  fleck: 9,
  /** Patina mote: the repair channel, which is patina by contract (§1). */
  mote: 10,
} as const;

/** One of the {@link PARTICLE} looks. */
export type ParticleKind = (typeof PARTICLE)[keyof typeof PARTICLE];

/** How a kind's opacity behaves over its lifetime. */
export type Fade =
  /** Even fade out — smoke, trails. */
  | 'linear'
  /** Holds bright, then drops — embers, chips: reads as heat leaving. */
  | 'quad'
  /** Almost instant decay — muzzle flashes, impact sparks. */
  | 'flash'
  /** Fades in and back out — rings and shimmers, which should not pop. */
  | 'bell';

/** Whether a kind may carry a player's identity colour (see module doc). */
export type TintPolicy = 'fixed' | 'identity';

/** Everything the draw layer and the emitters need to know about a look. */
export interface ParticleKindSpec {
  readonly kind: ParticleKind;
  readonly name: string;
  /** The colour used when an emitter does not tint. */
  readonly color: number;
  readonly fade: Fade;
  readonly tint: TintPolicy;
  /** Additive blending — for anything that is light rather than matter. */
  readonly additive: boolean;
  /** Why this look exists, in the language of the design. */
  readonly why: string;
}

// --- Sprites ---------------------------------------------------------------
// Authored in unit space (radius 1, +x forward) like every other sprite here.

/** A four-point star: two crossed spindles, so a flash reads as light. */
function star(long: number, short: number): number[] {
  return [long, 0, short * 0.35, short * 0.35, 0, long, -short * 0.35, short * 0.35,
    -long, 0, -short * 0.35, -short * 0.35, 0, -long, short * 0.35, -short * 0.35];
}

/** An irregular chunk — rock debris and hull shards are both this shape. */
function chunk(): number[] {
  return [1, 0.1, 0.45, 0.85, -0.35, 0.95, -1, 0.2, -0.7, -0.6, 0.1, -1, 0.8, -0.6];
}

const SPRITES: Readonly<Record<ParticleKind, SpriteDef>> = {
  [PARTICLE.spark]: sprite('vfx:spark', 1, [
    circle(0, 0, 1, fill(PALETTE.plasma, 'energy', 0.35)),
    circle(0, 0, 0.45, fill(DERIVED.plasmaHot, 'energy', 0.95)),
  ]),
  [PARTICLE.ember]: sprite('vfx:ember', 1, [
    circle(0, 0, 1, fill(PALETTE.threatRed, 'danger', 0.4)),
    circle(0, 0, 0.55, fill(DERIVED.plasmaHot, 'energy', 0.9)),
  ]),
  [PARTICLE.chip]: sprite('vfx:chip', 1, [
    poly(chunk(), fill(DERIVED.rockBody, 'material')),
    poly([0.4, 0.3, -0.5, 0.5, -0.3, -0.4], fill(DERIVED.rockShadow, 'material')),
  ]),
  [PARTICLE.oreBit]: sprite('vfx:orebit', 1, [
    poly([1, 0, 0, 0.8, -1, 0, 0, -0.8], fill(PALETTE.signalYellow, 'ore')),
    poly([0, 0.8, -1, 0, 0, -0.8], fill(DERIVED.oreDeep, 'ore')),
  ]),
  [PARTICLE.flare]: sprite('vfx:flare', 1, [
    poly(star(1, 0.42), fill(PALETTE.plasma, 'energy', 0.55)),
    circle(0, 0, 0.3, fill(DERIVED.plasmaHot, 'energy')),
  ]),
  // An annulus, not a disc with a hole punched in it: a filled Vacuum centre
  // would paint a black plate over whatever the ring expands across.
  [PARTICLE.ring]: sprite('vfx:ring', 1, [
    poly(annulusPoints(0, 0, 1, 0.84, 0, Math.PI * 2, 32), fill(PALETTE.plasma, 'energy', 0.75)),
    poly(annulusPoints(0, 0, 0.84, 0.72, 0, Math.PI * 2, 32), fill(PALETTE.plasma, 'energy', 0.22)),
  ]),
  [PARTICLE.smoke]: sprite('vfx:smoke', 1, [
    circle(0, 0, 1, fill(DERIVED.wreckBody, 'material', 0.5)),
    circle(-0.2, -0.15, 0.62, fill(DERIVED.wreckCrust, 'material', 0.45)),
  ]),
  [PARTICLE.shard]: sprite('vfx:shard', 1, [
    poly(chunk(), fill(DERIVED.hullShadow, 'material')),
    poly([1, 0.1, 0.45, 0.85, 0.1, 0.1], fill(DERIVED.hullDark, 'material')),
  ]),
  [PARTICLE.trail]: sprite('vfx:trail', 1, [
    // Engine flame: painted in a roster colour because that is what it *is*
    // (style-guide §3 rule 2). Emitters retint it to the flying player's slot.
    circle(0, 0, 1, fill(PLAYER_COLORS[0], 'identity', 0.4)),
    circle(0, 0, 0.5, fill(PLAYER_COLORS[0], 'identity', 0.8)),
  ]),
  [PARTICLE.fleck]: sprite('vfx:fleck', 1, [
    poly([1, 0, 0.1, 0.5, -0.9, 0.15, -0.2, -0.45], fill(PALETTE.threatRed, 'danger')),
  ]),
  [PARTICLE.mote]: sprite('vfx:mote', 1, [
    circle(0, 0, 1, fill(PALETTE.patina, 'material', 0.3)),
    circle(0, 0, 0.4, fill(DERIVED.continentLight, 'material', 0.85)),
  ]),
};

/** The ten looks, in kind order. */
export const PARTICLE_KINDS: readonly ParticleKindSpec[] = [
  {
    kind: PARTICLE.spark,
    name: 'spark',
    color: PALETTE.plasma,
    fade: 'flash',
    tint: 'identity', // weapon tint is on the style guide's identity list (§3)
    additive: true,
    why: 'Shot impact — the cold plasma cutting torch biting something.',
  },
  {
    kind: PARTICLE.ember,
    name: 'ember',
    color: DERIVED.plasmaHot,
    fade: 'quad',
    tint: 'fixed',
    additive: true,
    why: 'Explosions are fireworks (§4.7): bright, generous, gone quickly.',
  },
  {
    kind: PARTICLE.chip,
    name: 'chip',
    color: DERIVED.rockBody,
    fade: 'quad',
    tint: 'fixed',
    additive: false,
    why: 'Rock coming off an asteroid as it cracks through its three stages.',
  },
  {
    kind: PARTICLE.oreBit,
    name: 'oreBit',
    color: PALETTE.signalYellow,
    fade: 'linear',
    tint: 'fixed',
    additive: false,
    why: 'The payout. Yellow means ore, so this is what a burst rock throws.',
  },
  {
    kind: PARTICLE.flare,
    name: 'flare',
    color: DERIVED.plasmaHot,
    fade: 'flash',
    tint: 'identity',
    additive: true,
    why: 'Muzzle flash and the spark of a completed build — light, not matter.',
  },
  {
    kind: PARTICLE.ring,
    name: 'ring',
    color: PALETTE.plasma,
    fade: 'bell',
    tint: 'fixed',
    additive: true,
    why: 'Shield shimmer, spawn-protection glow, and shockwaves.',
  },
  {
    kind: PARTICLE.smoke,
    name: 'smoke',
    color: DERIVED.wreckBody,
    fade: 'linear',
    tint: 'fixed',
    additive: false,
    why: 'A burning planet reads from further away than its numbers do (§5).',
  },
  {
    kind: PARTICLE.shard,
    name: 'shard',
    color: DERIVED.hullShadow,
    fade: 'linear',
    tint: 'fixed',
    additive: false,
    why: 'Crust and hull coming apart — the slow debris of the death moment.',
  },
  {
    kind: PARTICLE.trail,
    name: 'trail',
    color: PLAYER_COLORS[0],
    fade: 'linear',
    tint: 'identity',
    additive: true,
    why: 'Engine flame: the one part of a ship that wears the pilot’s colour.',
  },
  {
    kind: PARTICLE.fleck,
    name: 'fleck',
    color: PALETTE.threatRed,
    fade: 'quad',
    tint: 'fixed',
    additive: false,
    why: 'Damage spatter. Threat red, never a friendly accent (§2).',
  },
  {
    kind: PARTICLE.mote,
    name: 'mote',
    color: PALETTE.patina,
    fade: 'bell',
    tint: 'fixed',
    additive: true,
    why: 'The repair channel ticking HP back — patina is the repair colour (§1).',
  },
];

/** The sprite for a kind — bake once, share across every particle wearing it. */
export function particleSprite(kind: ParticleKind): SpriteDef {
  return SPRITES[kind];
}

/** Every particle sprite, for the catalogue and the palette audit. */
export const PARTICLE_SPRITES: readonly SpriteDef[] = PARTICLE_KINDS.map((k) => particleSprite(k.kind));

/** The spec for a kind. */
export function particleKind(kind: number): ParticleKindSpec {
  return PARTICLE_KINDS[kind] ?? PARTICLE_KINDS[PARTICLE.spark]!;
}

/**
 * The opacity multiplier for a kind at lifetime progress `p` (0 → 1).
 *
 * Branch-per-curve rather than a function table: the draw layer calls this once
 * per live particle per frame, and a switch over four cases costs nothing while
 * an array of closures is one more thing to keep alive.
 */
export function fadeAt(kind: number, p: number): number {
  const t = p < 0 ? 0 : p > 1 ? 1 : p;
  switch (particleKind(kind).fade) {
    case 'linear':
      return 1 - t;
    case 'quad':
      return (1 - t) * (1 - t);
    case 'flash':
      return (1 - t) * (1 - t) * (1 - t);
    case 'bell':
      // Rises over the first fifth, falls over the rest: rings never pop in.
      return t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
  }
}
