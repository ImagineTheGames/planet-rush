/**
 * tools/explosion-lab/heat.ts — the red treatment, as one map. OWNER: Art Agent.
 *
 * The developer, 2026-08-18, on the a0-69 board: *"they all lack explosion
 * colors like yellow, and red, is there a reason they dont have that? is space
 * explosions only blue, whats the thought process there?"* — and, when the
 * RESERVED rule was put to them: *"what about red. we already use red for
 * enemies and red can also mean death aka explosion 💥"*.
 *
 * They are right and the code agrees with them. `threatRed` is not a roster
 * identity colour, it is a STATE colour meaning danger — `shotEnemy1/2/3` are
 * *"unmistakably threat red"*, danger fills, warning rings — and a ship coming
 * apart is a danger event. Red on an explosion is not a second meaning smuggled
 * into a reserved hue; it is the meaning the hue already carries.
 *
 * The objection that produced an all-cold effect set applies to **yellow alone**,
 * and that gate is untouched: `signalYellow` is ore, ore is what a player scans
 * the field for continuously, and `kinds.ts` says so in as many words.
 *
 * ## The whole treatment is two colours
 *
 * This module exists so that the red twin of a candidate differs from the cold
 * one by **colour and nothing else** — not by one more ember, not by a longer
 * ttl, not by a different fade curve. The candidate's `emit` function is run
 * VERBATIM, off the same seed, into a {@link HeatPool}; every number it writes
 * is the number the cold twin wrote. The only thing that moves is the packed
 * colour column, and the baked look that column tints.
 *
 * {@link HEAT} is the entire map:
 *
 * ```
 *   PALETTE.plasma      →  PALETTE.threatRed     both the base of their register
 *   DERIVED.plasmaHot   →  DERIVED.shotEnemy3    both base + 0.45 toward WHITE
 * ```
 *
 * That second row is the one worth staring at. `plasmaHot` is *"the hot centre
 * of a torch/muzzle flare"* — plasma mixed 45% toward white. `shotEnemy3` is
 * *"the fiercest incoming shot: bright, still red"* — threat red mixed 45%
 * toward white. **Same base-relative position on the same ramp, in the other
 * register.** {@link assertHeatMap} checks that against `DERIVED_RECIPES` at
 * module load rather than leaving it as a claim in a comment: if either recipe
 * is ever retuned, the generator fails instead of quietly shifting the red twin
 * to a different heat than the cold one it is being compared against.
 *
 * ## The trap, which is real and which this map is shaped to avoid
 *
 * `palette.ts` runs red hot toward WHITE, *"never yellow"*. A red explosion that
 * brightens by sliding toward orange lands on ORE's colour at the exact moment
 * it is brightest and largest — the moment a player is most likely to read it as
 * a payout. Everything in {@link HEAT}'s right-hand column is on the red axis,
 * where `G === B` exactly (threat red is `0xB2**3A3A**`, and mixing toward white
 * adds the same amount to both), and a colour with `G === B` cannot be yellow at
 * any brightness — yellow needs green far above blue. `src/art/vfx/kinds.test.ts`
 * holds that for the whole register and for every point of every ramp between
 * them; here it is asserted again over the actual sprites the board draws.
 *
 * ## What is deliberately NOT warmed
 *
 * The map is keyed on **colour, not on kind**, and that is what keeps it honest:
 * it warms the cold-energy register wherever it appears and it cannot reach
 * anything else. Rock (`chip`), hull (`shard`), dust and ash (`smoke`), the
 * repair channel (`mote`), the ore payout (`oreBit`), damage spatter (`fleck`,
 * already red) and the thruster (`trail`, a roster colour) carry none of those
 * two colours, so they come through untouched — no rule needed, no allow-list to
 * keep in sync. Debris is not on fire, and rock dust is not on fire, because
 * neither is made of light.
 *
 * A visible consequence, and it is the argument the asteroid family was asked
 * for: five of the seven asteroid candidates contain **no light at all**, so
 * their red twin is particle-for-particle identical to their cold one. The map
 * has nothing to warm in a cloud of rock. See {@link heatDiffers}.
 */

import {
  DERIVED,
  DERIVED_RECIPES,
  PALETTE,
  WHITE,
  hex,
  mix,
  type DerivedKey,
} from '../../src/art/palette';
import { RED_FAMILY, YELLOW_FAMILY, assertPaletteCompliance } from '../../src/art/compliance';
import type { Ink, Shape, SpriteDef, StrokeInk } from '../../src/art/shapes';
import { PARTICLE_KINDS, particleKind, particleSprite, type ParticleKind } from '../../src/art/vfx/kinds';
import { ParticlePool } from '../../src/art/vfx/particles';

/**
 * The cold-energy register mapped into the ember register, one colour to one
 * colour, at the same position on the same value ramp. This is the treatment.
 */
export const HEAT: ReadonlyMap<number, number> = new Map<number, number>([
  [PALETTE.plasma, PALETTE.threatRed],
  [DERIVED.plasmaHot, DERIVED.shotEnemy3],
]);

/**
 * Prove the map rather than assert it in prose (see the module doc).
 *
 * Each pair has to be the *same* value operation on the two register bases: the
 * base itself against the base itself, and a shade against a shade with the same
 * `toward` and the same `t`. Anything else and the red twin is being compared at
 * a different heat than the cold one, which would make the board's one variable
 * two.
 */
function assertHeatMap(): void {
  const recipeOf = (color: number): { key: DerivedKey; toward: string; t: number } | null => {
    for (const key of Object.keys(DERIVED_RECIPES) as DerivedKey[]) {
      if (DERIVED[key] === color) {
        const r = DERIVED_RECIPES[key];
        return { key, toward: r.toward, t: r.t };
      }
    }
    return null;
  };
  for (const [cold, warm] of HEAT) {
    const a = recipeOf(cold);
    const b = recipeOf(warm);
    if (a === null && b === null) {
      // Base to base: both must be one of the six, and the warm one threat red.
      if (cold !== PALETTE.plasma || warm !== PALETTE.threatRed) {
        throw new Error(`heat map: ${hex(cold)} → ${hex(warm)} is not the ice base → the ember base`);
      }
      continue;
    }
    if (a === null || b === null || a.toward !== b.toward || a.t !== b.t) {
      throw new Error(
        `heat map: ${hex(cold)} → ${hex(warm)} is not the same point of the ramp ` +
          `(${a ? `${a.key} ${a.toward} ${a.t}` : 'base'} vs ${b ? `${b.key} ${b.toward} ${b.t}` : 'base'})`,
      );
    }
    if (!RED_FAMILY.has(warm)) {
      throw new Error(`heat map: ${hex(warm)} is not threat red or a declared shade of it`);
    }
  }
  // The law this whole brief is fenced by: nothing the map can produce, at any
  // brightness, may land on ore. Checked over the full ramp to white, because a
  // ramp is what an explosion climbs as it gets hot.
  for (const warm of HEAT.values()) {
    for (let i = 0; i <= 100; i++) {
      const c = mix(warm, WHITE, i / 100);
      if (YELLOW_FAMILY.has(c)) throw new Error(`heat map: ${hex(warm)} brightens onto ore ${hex(c)}`);
      const g = (c >> 8) & 0xff;
      const b = c & 0xff;
      if (g !== b) throw new Error(`heat map: ${hex(c)} leaves the red axis (G ${g} ≠ B ${b})`);
    }
  }
}

assertHeatMap();

/** The warm counterpart of a colour, or the colour itself if it is not energy. */
export function heatColor(color: number): number {
  return HEAT.get(color) ?? color;
}

/** True when a colour is the cold-energy register — i.e. the map moves it. */
export function isCold(color: number): boolean {
  return HEAT.has(color);
}

// ---------------------------------------------------------------------------
// The look
// ---------------------------------------------------------------------------

/**
 * Recolour one ink, and move its ROLE with it.
 *
 * Threat red is legal on role `danger` and nowhere else (`compliance.ts` rule 3),
 * so a warmed `energy` shape has to become a `danger` shape — which is not
 * paperwork, it is the brief's whole argument written into the sprite: the light
 * of a thing being destroyed is a danger tell, not decoration. The audit is then
 * run over the result ({@link heatSprites}) rather than trusted.
 */
function heatInk<T extends Ink | StrokeInk>(ink: T): T {
  const to = HEAT.get(ink.color);
  return to === undefined ? ink : { ...ink, color: to };
}

function heatShape(shape: Shape): Shape {
  const warmed = (shape.fill && HEAT.has(shape.fill.color)) || (shape.stroke && HEAT.has(shape.stroke.color));
  if (!warmed) return shape;
  const next: {
    path: Shape['path'];
    role: Shape['role'];
    fill?: Ink;
    stroke?: StrokeInk;
  } = { path: shape.path, role: 'danger' };
  if (shape.fill) next.fill = heatInk(shape.fill);
  if (shape.stroke) next.stroke = heatInk(shape.stroke);
  return next;
}

/** The warm twin of a sprite. Same paths, same alphas, same order — colour only. */
export function heatSprite(def: SpriteDef): SpriteDef {
  return { name: `${def.name}:heat`, extent: def.extent, shapes: def.shapes.map(heatShape) };
}

/**
 * The warm look for every particle kind, by kind.
 *
 * All eleven are present, not just the four the map touches: the four that carry
 * no cold energy come back byte-identical, which is the point — a red board that
 * quietly restyled rock would be answering a question nobody asked.
 */
export const HEAT_SPRITES: Readonly<Record<number, SpriteDef>> = (() => {
  const out: Record<number, SpriteDef> = {};
  for (const spec of PARTICLE_KINDS) out[spec.kind] = heatSprite(particleSprite(spec.kind));
  // The RESERVED rule, on the warm set, before anything is drawn with it.
  assertPaletteCompliance(Object.values(out));
  return out;
})();

/** The kinds the map actually changes — named on the page, not guessed at. */
export const WARMED_KIND_NAMES: readonly string[] = PARTICLE_KINDS.filter((spec) =>
  particleSprite(spec.kind).shapes.some(
    (s) => (s.fill && isCold(s.fill.color)) || (s.stroke && isCold(s.stroke.color)),
  ),
).map((spec) => spec.name);

/** The warm tint a kind is emitted with, mirroring `particleKind(k).color`. */
export function heatKindColor(kind: ParticleKind): number {
  return heatColor(particleKind(kind).color);
}

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

/**
 * A {@link ParticlePool} that warms every tint written into it.
 *
 * This is why the twins can be trusted as a colour-only comparison: a candidate
 * emits into one of these with its own code, unmodified, and the pool moves the
 * colour column on the way past. Positions, velocities, lifetimes, radii, spins,
 * drags and alphas are whatever the candidate wrote, and the RNG is consumed in
 * exactly the same order, so the two twins are the same motion by construction
 * rather than by two authors keeping two lists in step.
 */
export class HeatPool extends ParticlePool {
  override emit(
    kind: number,
    color: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    ttl: number,
    r0: number,
    r1: number,
    rot = 0,
    spin = 0,
    drag = 0,
    alpha = 1,
  ): number {
    return super.emit(kind, heatColor(color), x, y, vx, vy, ttl, r0, r1, rot, spin, drag, alpha);
  }
}

/**
 * How many of a candidate's particles the treatment actually moves.
 *
 * Zero is a real and useful answer — it is the asteroid family's answer for five
 * of its seven candidates — and the board states it per candidate rather than
 * showing two identical panels and letting the developer wonder whether the page
 * is broken.
 */
export function heatDiffers(emit: (pool: ParticlePool) => void): number {
  const cold = new ParticlePool(4096);
  const warm = new HeatPool(4096);
  emit(cold);
  emit(warm);
  let moved = 0;
  for (let i = 0; i < cold.count; i++) if (cold.color[i] !== warm.color[i]) moved++;
  return moved;
}
