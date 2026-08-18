/**
 * src/art/vfx/kinds.test.ts — the ore law, at explosion scale. OWNER: Art Agent.
 *
 * a0-86. The developer, looking at the explosion lab: *"they all lack explosion
 * colors like yellow, and red, is there a reason they dont have that?"* — and
 * then, on being shown the RESERVED rule: *"what about red. we already use red
 * for enemies and red can also mean death aka explosion 💥"*.
 *
 * They are right about red and the code agrees with them. `threatRed` is not a
 * roster identity colour; it is a STATE colour meaning danger, which is what
 * `shotEnemy1/2/3` ("unmistakably threat red"), the damage fills and the alarm
 * rings all are. A ship coming apart is a danger event, so **destruction may
 * burn red**.
 *
 * **Nothing may burn ore-yellow**, and that is the half this file exists for.
 * `kinds.ts` puts the reason plainly: *"a spark that quietly went signal yellow
 * fails CI rather than teaching a player that yellow means something other than
 * ore"*. A player scans a chaotic field for yellow all match long, and every
 * misuse spends that trust (style-guide §2).
 *
 * ## The trap this file is shaped around, because it is a real one
 *
 * `palette.ts` runs red hot **toward WHITE**, and says so twice — *"threat red
 * climbing toward white-hot, never yellow"*. The reason is that the obvious way
 * to make a red explosion brighter is to slide it toward orange, and orange is
 * one mix step from ore. A red that brightens through orange lands on ore's
 * colour at the exact moment the effect is biggest and brightest — the moment a
 * player is most likely to read it as a payout — and **it will look fine to
 * whoever writes it**. That is why the check below is not "is this colour signal
 * yellow", which nobody would fail, but "how far along the road to ore is it",
 * which is what an author actually gets wrong.
 *
 * ## What is measured, and why in two different ways
 *
 * `../compliance` already exports the two families as sets, and both gates are
 * driven off those sets rather than off a hand-typed hex list:
 *
 *  - **{@link oreward} — direction.** Where GREEN sits between BLUE and RED, as a
 *    fraction. The whole `YELLOW_FAMILY` sits at 0.807–0.812; the whole
 *    `RED_FAMILY` sits at exactly **0.000**, because threat red is `0xB2`**`3A3A`**
 *    and mixing toward white adds the same amount to G and to B. So a colour that
 *    keeps `G === B` is on the red axis and cannot be yellow at any brightness,
 *    and a colour drifting off it is measurably on its way. The ceiling is a
 *    third of the ore family's own reading, derived from the set.
 *  - **{@link deltaE} — distance.** CIE76 against every member of the yellow
 *    family, floored well above "a different colour". This catches the near-miss
 *    hex that the direction test would let past.
 *
 * Neither alone is enough, and the roster's orange is the proof: `#ff8a3d` is
 * ΔE **46** from the nearest ore shade — comfortably clear on distance — and
 * `oreward` **0.40**, which is halfway to ore. Distance says "not yellow";
 * direction says "on the road to it". An explosion may be neither.
 *
 * ## What is checked
 *
 * 1. Every particle the shipped **destruction** emitters actually emit — its
 *    tint, every baked ink of its look, and the PRODUCT of the two (which is
 *    what the GPU shows, since `layer.ts` sets `sprite.tint` and Pixi multiplies)
 *    — at every point of its brightening ramp toward white.
 * 2. The **ember register** a red explosion would be built from: the whole
 *    `RED_FAMILY` and every point of every ramp between it and white. The lab's
 *    red treatment (`tools/explosion-lab/heat.ts`) draws only from that set, so
 *    gating the register gates the board and gates the port that follows it.
 * 3. The ore payout, asserted **positively** to still be ore — an exemption that
 *    only says what may be skipped is an exemption that quietly grows.
 * 4. The recipe shape: every declared shade of threat red climbs toward `white`.
 *    This is the mechanical form of "never toward yellow": there is no way to
 *    author a warm endpoint through `DERIVED_RECIPES` without failing here.
 */

import { describe, expect, it } from 'vitest';

import { mulberry32, type Rng } from '@shared/types';
import { RED_FAMILY, YELLOW_FAMILY } from '../compliance';
import { DERIVED, DERIVED_RECIPES, PALETTE, WHITE, hex, mix, type DerivedKey } from '../palette';
import {
  asteroidBurst,
  collapsePulse,
  explosion,
  stationDeath,
  turretDown,
} from './emitters';
import { PARTICLE, particleKind, particleSprite } from './kinds';
import { ParticlePool } from './particles';

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

function unpack(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/**
 * How far along the road from red to ore a colour has travelled, 0 → 1.
 *
 * Green's position between blue and red. Pure red axis (`G === B`) is 0; ore is
 * 0.81; orange is about halfway, which is exactly the point — "orange" is not a
 * separate hue to ban, it is *partly yellow*, and this measures how partly.
 * Colours with `R ≤ B` are cold and score 0: the road runs one way.
 */
function oreward(color: number): number {
  const [r, g, b] = unpack(color);
  return r > b ? (g - b) / (r - b) : 0;
}

const lin = (v: number): number => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** sRGB → CIELAB (D65). Same transform `backdrop.test.ts` measures skies with. */
function lab(color: number): [number, number, number] {
  const [r, g, b] = unpack(color).map(lin) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference. 2.3 is "just noticeable"; 40+ is "a different colour". */
function deltaE(a: number, b: number): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Distance to the NEAREST ore shade — the number that has to stay large. */
function oreDistance(color: number): number {
  let closest = Infinity;
  for (const y of YELLOW_FAMILY) closest = Math.min(closest, deltaE(color, y));
  return closest;
}

/**
 * The ceiling on {@link oreward}, taken from the ore family's own reading rather
 * than chosen. A third of the way to ore is already orange, and orange is the
 * shape this mistake takes in practice.
 */
const ORE_DIRECTION = Math.min(...[...YELLOW_FAMILY].map(oreward));
const OREWARD_MAX = ORE_DIRECTION / 3;

/**
 * The floor on ΔE to the nearest ore shade. Every colour a destruction effect
 * emits today measures 44 or better across its whole ramp, so this is a wide
 * margin and not a line the current art is leaning on.
 */
const ORE_DISTANCE_MIN = 25;

/** The brightening ramp: `color` mixed toward WHITE, sampled every 1%. */
function ramp(color: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 100; i++) out.push(mix(color, WHITE, i / 100));
  return out;
}

/** Per-channel multiply — what `layer.ts`'s `sprite.tint` does to a baked ink. */
function modulate(tint: number, ink: number): number {
  const [tr, tg, tb] = unpack(tint);
  const [ir, ig, ib] = unpack(ink);
  return (
    (Math.round((tr * ir) / 255) << 16) |
    (Math.round((tg * ig) / 255) << 8) |
    Math.round((tb * ib) / 255)
  );
}

/** Assert one colour, and every point of its brightening ramp, is clear of ore. */
function expectClearOfOre(color: number, what: string): void {
  for (const step of ramp(color)) {
    const why = `${what}: ${hex(color)} brightens to ${hex(step)}`;
    expect(YELLOW_FAMILY.has(step), `${why}, which IS an ore shade`).toBe(false);
    expect(oreward(step), `${why}, ${(oreward(step) * 100).toFixed(0)}% of the way to ore`).toBeLessThan(
      OREWARD_MAX,
    );
    expect(oreDistance(step), `${why}, ΔE ${oreDistance(step).toFixed(1)} from ore`).toBeGreaterThan(
      ORE_DISTANCE_MIN,
    );
  }
}

// ---------------------------------------------------------------------------
// The emissions under test
// ---------------------------------------------------------------------------

/** One emitted particle, reduced to what a colour audit needs. */
interface Emitted {
  readonly effect: string;
  readonly kind: number;
  readonly tint: number;
  /** How many particles wore this exact (kind, tint) — the population audited. */
  readonly count: number;
}

/**
 * Everything the game destroys, and the emitter that draws it coming apart.
 * `asteroidBurst` is in the list precisely BECAUSE it is the awkward one: it is
 * the only destruction effect that legitimately throws yellow, and an audit that
 * left it out would never be tested against its own exemption.
 */
const DESTRUCTION: ReadonlyArray<readonly [string, (pool: ParticlePool, rng: Rng) => void]> = [
  ['explosion (a ship)', (pool, rng) => explosion(pool, rng, 0, 0, 1, 1)],
  ['turretDown', (pool, rng) => turretDown(pool, rng, 0, 0, 1)],
  ['stationDeath', (pool, rng) => stationDeath(pool, rng, 0, 0, 96, 1)],
  ['collapsePulse', (pool) => collapsePulse(pool, 0, 0, 400)],
  ['asteroidBurst', (pool, rng) => asteroidBurst(pool, rng, 0, 0, 24, 1)],
];

/**
 * Emit every destruction effect and read the colour columns back, one entry per
 * DISTINCT (effect, kind, tint).
 *
 * The particles number in the thousands and carry a dozen distinct colours
 * between them; auditing each of those colours across a 101-step ramp against
 * three ore shades is worth doing once per colour and not once per spark.
 * {@link Emitted.count} keeps the population visible so a collapse to nothing
 * cannot pass as a clean audit.
 */
function emitAll(): Emitted[] {
  const seen = new Map<string, Emitted & { count: number }>();
  for (const [effect, fire] of DESTRUCTION) {
    const pool = new ParticlePool(4096);
    // Several seeds: the counts are `budget`ed and the scatter is random, but
    // the COLOURS are not, so this is cheap insurance against a branch that
    // paints differently on an unlucky draw.
    for (const seed of [1, 7, 0x5f3759df]) fire(pool, mulberry32(seed));
    for (let i = 0; i < pool.count; i++) {
      const kind = pool.kind[i]!;
      const tint = pool.color[i]!;
      const key = `${effect}:${kind}:${tint}`;
      const hit = seen.get(key);
      if (hit) hit.count++;
      else seen.set(key, { effect, kind, tint, count: 1 });
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------

describe('particle kinds — destruction may burn red, nothing may burn ore', () => {
  it('no explosion particle lands on ore yellow', () => {
    const emitted = emitAll();
    // Twelve or so distinct (effect, kind, tint) triples over a few thousand
    // particles. Both numbers are asserted: a refactor that emitted nothing
    // would otherwise pass every colour check in the file.
    expect(emitted.length).toBeGreaterThan(8);
    expect(emitted.reduce((n, p) => n + p.count, 0)).toBeGreaterThan(300);

    let payouts = 0;
    for (const p of emitted) {
      const spec = particleKind(p.kind);
      const where = `${p.effect} → ${spec.name}`;

      // The one deliberate yellow in the whole set, and the reason the rule is
      // worth this much trouble: a burst rock PAYS OUT, and the payout is ore.
      // It is exempted by KIND and then asserted to actually be ore, so the
      // exemption cannot quietly cover anything else.
      if (p.kind === PARTICLE.oreBit) {
        payouts += p.count;
        expect(p.tint, `${where}: the payout must be signal yellow`).toBe(PALETTE.signalYellow);
        expect(YELLOW_FAMILY.has(p.tint)).toBe(true);
        continue;
      }

      // The tint the emitter wrote into the pool.
      expectClearOfOre(p.tint, `${where} tint`);

      // Every baked ink of the look it will be drawn with, and the product of
      // the two — `layer.ts` sets `sprite.tint` and the GPU multiplies, so the
      // product is the colour that actually reaches the player's eye.
      for (const shape of particleSprite(spec.kind).shapes) {
        for (const ink of [shape.fill, shape.stroke]) {
          if (!ink) continue;
          expectClearOfOre(ink.color, `${where} ink`);
          expectClearOfOre(modulate(p.tint, ink.color), `${where} tint × ink`);
        }
      }
    }
    // The awkward case was actually exercised, rather than the loop having
    // quietly stopped covering it.
    expect(payouts, 'asteroidBurst still pays out ore glints').toBeGreaterThan(0);
  });

  it('the ember register a red explosion is built from stays on the red axis', () => {
    // a0-86 sanctions destruction in threat red and its shades — the `ember`
    // material's own bases. The lab's red treatment maps plasma → threatRed and
    // plasmaHot → shotEnemy3 and takes its colours from nowhere else, so this
    // gates the board, and it gates the port that follows a verdict.
    expect(RED_FAMILY.size).toBeGreaterThan(1);
    for (const red of RED_FAMILY) {
      expectClearOfOre(red, 'the ember register');
      for (const step of ramp(red)) {
        const [, g, b] = unpack(step);
        // The structural half of the argument: threat red brightens by adding
        // equally to green and blue, so the whole ramp keeps G === B. Yellow
        // needs green far above blue. A ramp that stays on this axis cannot
        // arrive at ore however hot it gets.
        expect(g, `${hex(red)} → ${hex(step)} left the red axis`).toBe(b);
      }
    }
  });

  it('every declared shade of threat red climbs toward white, never toward a hue', () => {
    const reds = (Object.keys(DERIVED_RECIPES) as DerivedKey[]).filter(
      (key) => DERIVED_RECIPES[key].base === 'threatRed',
    );
    expect(reds.length).toBeGreaterThan(0);
    for (const key of reds) {
      // `toward` is typed 'vacuum' | 'white', so this cannot be a hand-mixed
      // orange — but the assertion is what makes the ramp's direction a stated
      // contract rather than a property of today's type.
      expect(DERIVED_RECIPES[key].toward, `${key} must brighten toward white`).toBe('white');
      expect(DERIVED[key]).toBe(mix(PALETTE.threatRed, WHITE, DERIVED_RECIPES[key].t));
    }
  });

  it('measures ore direction the way the palette itself reads', () => {
    // The two constants above are derived from the ore family, so this is the
    // check that they were derived from what they claim to be.
    for (const y of YELLOW_FAMILY) expect(oreward(y)).toBeGreaterThan(0.75);
    for (const r of RED_FAMILY) expect(oreward(r)).toBe(0);
    expect(OREWARD_MAX).toBeGreaterThan(0.2);
    expect(OREWARD_MAX).toBeLessThan(0.3);
    // The roster's orange: far from ore by distance, halfway there by direction.
    // It is the reason both gates exist, and it fails the one that matters.
    const orange = 0xff8a3d;
    expect(oreDistance(orange)).toBeGreaterThan(ORE_DISTANCE_MIN);
    expect(oreward(orange)).toBeGreaterThan(OREWARD_MAX);
  });
});
