/**
 * tools/explosion-lab/candidates.ts — the nineteen, as data. OWNER: Art Agent.
 *
 * a0-63 put nineteen candidate deaths on one page as filmstrips. a0-69 makes
 * them *play*, and a live candidate has to be emitted in the browser rather than
 * in node — so the candidate set moved here, to the one module both ends import:
 *
 *  - `../make-explosion-lab.ts` runs it under node to bake the filmstrips and
 *    write the page;
 *  - `./runtime.ts` runs it in the browser, against the same real
 *    {@link ParticlePool}, to play them.
 *
 * There is exactly one copy of every candidate because a lab whose live panel
 * and whose stills could disagree is worse than either alone — that is precisely
 * how `sky-preview`'s "game today" panel drifted from the shipped client.
 *
 * ## The rules the set is built under (unchanged from a0-63)
 *
 * 1. **The game's own particle system.** Every candidate writes into a real
 *    {@link ParticlePool} through the real `emit`, using the real `PARTICLE`
 *    kinds and their `particleKind` colours, and is stepped by the real
 *    `pool.update`. Today's three effects are literally `explosion()`,
 *    `stationDeath()` and `asteroidBurst()` imported from `src/art/vfx/emitters`
 *    — not re-typed. A candidate that could not be written this way is not a
 *    candidate, because porting it would be a rewrite rather than a tuning.
 * 2. **Deterministic.** Seeded `mulberry32` (the ratified RNG, `@shared/types`),
 *    one fresh stream per candidate off the same {@link SEED} so the families are
 *    comparable, stepped at the fixed `VFX_SHOWCASE_DT` — never the wall clock.
 *    Both ends obey it: the stills bake identically on every run, and a live
 *    replay is frame-for-frame the viewing before it.
 * 3. **True scale.** Each family is drawn in WORLD UNITS against the shipped
 *    sprite at its shipped radius, on the game's own Floor. A station's shockwave
 *    is 288 units wide and the frame is the size it has to be to hold it.
 *
 * ## Two deliberate deviations, stated rather than hidden
 *
 * - **The ship reference is 16 units, not 12.** The a0-63 brief said a 12-unit
 *   ship; `SHIP_RADIUS` is 16 and `field.ts` unpacks the explosion magnitude
 *   against `SHIP_RADIUS_REF = 16`. The 12 is stale (`make-laser-lab.ts` carries
 *   the same stale copy). True scale beats a quoted number, so this imports the
 *   constant.
 * - **`budget` / `between` / `spread` are copied, not imported.** They are
 *   module-private in `emitters.ts`, and exporting them for a tool would add
 *   three exports with no production caller — exactly the shape
 *   `npm run dark-matter:check` gates on in CI. They are three lines each and are
 *   reproduced below VERBATIM; the port will use the originals.
 *
 * ## a0-86 — every candidate is now TWO options, and the difference is colour
 *
 * The developer asked why an explosion in this game is only ever blue. It is a
 * fair question with a real answer for yellow (ore) and no answer at all for red
 * (danger, which is what an explosion is), so each of the nineteen now appears
 * twice: `<id>-C` in the cold register it was authored in, and `<id>-R` in the
 * ember register. **The candidate list below did not change** — not one number,
 * not one particle. A red twin is the SAME `emit` function, off the SAME seed,
 * run into a `HeatPool` (`./heat`) that moves the colour column as it passes.
 * That is what makes the board's variable colour ALONE: motion cannot drift
 * between two twins, because there is only one copy of it.
 */

import { ShipClass, mulberry32, type Rng } from '@shared/types';
import { asteroidSprite } from '../../src/art/asteroids';
import { shipSprite } from '../../src/art/ships';
import { stationSprite } from '../../src/art/stations';
import type { SpriteDef } from '../../src/art/shapes';
import { asteroidBurst, explosion, ring, stationDeath } from '../../src/art/vfx/emitters';
import { PARTICLE, particleKind } from '../../src/art/vfx/kinds';
import { ParticlePool } from '../../src/art/vfx/particles';
import { HeatPool, heatDiffers } from './heat';
import { VFX_SHOWCASE_DT } from '../../src/art/vfx/showcase';
import { ASTEROID, SHIP_RADIUS, STATION } from '../../src/sim/constants';

/** The field's own default scatter seed — one fresh stream per candidate. */
export const SEED = 0x5f3759df;

/** The frame times on the strip, seconds. Stated on the page as well. */
export const FRAME_TIMES = [0.05, 0.15, 0.35, 0.6, 1.0, 1.5] as const;

/** Frame indices at the fixed timestep — 3, 9, 21, 36, 60, 90. */
export const FRAME_STEPS = FRAME_TIMES.map((t) => Math.round(t / VFX_SHOWCASE_DT));

/** Below this composited alpha a particle contributes nothing but bytes. */
export const ALPHA_FLOOR = 0.005;

/**
 * The pool one candidate is run in, on BOTH ends.
 *
 * Deliberately above the shipped `PARTICLE_CAPACITY` (1600): a full pool starts
 * *stealing* slots, and a lab where the stills were baked in a pool that never
 * stole while the live panel ran in one that did would show two different
 * effects under one name. No candidate here emits more than ~120 particles, so
 * at this capacity neither end ever steals and the two agree by construction.
 */
export const LAB_POOL_CAPACITY = 2048;

/**
 * How visible a reference body is by default. It is a ruler, not part of the
 * effect. The asteroid family overrides it downward: rock dust is the same grey
 * as rock, so a 35% rock under a dust cloud is a ghost you cannot tell from the
 * thing being reviewed.
 */
export const REF_ALPHA = 0.35;

// ---------------------------------------------------------------------------
// The scatter helpers — copied verbatim from src/art/vfx/emitters.ts.
// See the module doc for why these are copied rather than imported.
// ---------------------------------------------------------------------------

/** A number in [-a, a]. */
function spread(rng: Rng, a: number): number {
  return (rng.next() * 2 - 1) * a;
}

/** A number in [lo, hi]. */
function between(rng: Rng, lo: number, hi: number): number {
  return lo + rng.next() * (hi - lo);
}

/** Scale a particle count by quality, never below one. */
function budget(base: number, quality: number): number {
  const q = quality < 0 ? 0 : quality > 1 ? 1 : quality;
  return Math.max(1, Math.round(base * q));
}

/** The colour a kind is painted with when nobody is tinting it. */
const C = (kind: number): number => particleKind(kind).color;

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/** One candidate effect, as it would be ported: pool in, particles out. */
export interface Candidate {
  /** Stable single letter — the ART review manifest records verdicts by this. */
  readonly id: string;
  readonly name: string;
  /** One line of character, in the developer's language. */
  readonly line: string;
  /** True for the shipped effect this family is being compared against. */
  readonly today?: boolean;
  /** True for a candidate that deliberately leaves the ratified stance. */
  readonly departure?: boolean;
  /** Emit the whole effect at the origin. Called once, at t = 0. */
  readonly emit: (pool: ParticlePool, rng: Rng) => void;
}

// --- Ships -----------------------------------------------------------------
// Today is `explosion()`: a flare, a 46-unit ring, 18 embers, 8 shards, 6 smoke.
// The variable being asked about is the balance of flare / sparks / shards /
// smoke, so each candidate moves that balance and nothing else.

const SHIPS: Candidate[] = [
  {
    id: 'A',
    name: 'Today',
    line: 'The shipped `explosion()` — flare, wide ring, 18 embers, 8 shards, 6 smoke.',
    today: true,
    emit: (pool, rng) => explosion(pool, rng, 0, 0, 1, 1),
  },
  {
    id: 'B',
    name: 'Hard snap',
    line: 'One bright frame and gone by 0.3 s — nothing on this candidate outlives 0.3 s.',
    emit: (pool, rng) => {
      pool.emit(PARTICLE.flare, C(PARTICLE.flare), 0, 0, 0, 0, 0.1, 24, 4, 0, 0, 0, 1);
      ring(pool, 0, 0, 6, 42, 0.26, 0.9);
      const embers = budget(14, 1);
      for (let i = 0; i < embers; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 220, 430);
        pool.emit(PARTICLE.ember, C(PARTICLE.ember), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.16, 0.3), between(rng, 2.2, 3.6), 0.4, a, 0, 3.2, 1);
      }
      const sparks = budget(8, 1);
      for (let i = 0; i < sparks; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 260, 480);
        pool.emit(PARTICLE.spark, C(PARTICLE.spark), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.1, 0.2), between(rng, 1.6, 2.6), 0.3, a, 0, 4, 0.95);
      }
      const shards = budget(4, 1);
      for (let i = 0; i < shards; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 90, 220);
        pool.emit(PARTICLE.shard, C(PARTICLE.shard), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.22, 0.3), between(rng, 2, 3), 1, rng.next() * Math.PI * 2, spread(rng, 9), 1.4, 0.9);
      }
      pool.emit(PARTICLE.smoke, C(PARTICLE.smoke), 0, 0, 0, 0, 0.3, 4, 15, 0, 0, 0.9, 0.4);
    },
  },
  {
    id: 'C',
    name: 'Break-up',
    line: 'The hull loses, not the fuel: 18 shards thrown and tumbling, embers as the accent.',
    emit: (pool, rng) => {
      pool.emit(PARTICLE.flare, C(PARTICLE.flare), 0, 0, 0, 0, 0.12, 9, 2, 0, 0, 0, 0.9);
      ring(pool, 0, 0, 4, 30, 0.35, 0.5);
      const shards = budget(18, 1);
      for (let i = 0; i < shards; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 40, 190);
        pool.emit(PARTICLE.shard, C(PARTICLE.shard), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.9, 2), between(rng, 2.2, 4), 1.4, rng.next() * Math.PI * 2, spread(rng, 10), 0.7, 0.95);
      }
      const embers = budget(6, 1);
      for (let i = 0; i < embers; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 60, 180);
        pool.emit(PARTICLE.ember, C(PARTICLE.ember), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.3, 0.7), between(rng, 2, 3.4), 0.5, a, 0, 2, 1);
      }
      const smoke = budget(7, 1);
      for (let i = 0; i < smoke; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 10, 45);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.2, 2), between(rng, 3, 5), between(rng, 12, 18), rng.next() * Math.PI * 2,
          spread(rng, 1), 1, 0.5);
      }
    },
  },
  {
    id: 'D',
    name: 'Fuel burn',
    line: 'A longer ember tail: the flash is over at 0.2 s and it is still burning at 1.5 s.',
    emit: (pool, rng) => {
      pool.emit(PARTICLE.flare, C(PARTICLE.flare), 0, 0, 0, 0, 0.18, 16, 3, 0, 0, 0, 1);
      ring(pool, 0, 0, 4, 44, 0.5, 0.7);
      const fast = budget(16, 1);
      for (let i = 0; i < fast; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 60, 220);
        pool.emit(PARTICLE.ember, C(PARTICLE.ember), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.7, 1.7), between(rng, 2.2, 3.8), 0.6, a, 0, 1.2, 1);
      }
      // The tail: slow embers with almost no drag, still lit a second later.
      const tail = budget(9, 1);
      for (let i = 0; i < tail; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 15, 65);
        pool.emit(PARTICLE.ember, C(PARTICLE.ember), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.3, 2.4), between(rng, 1.6, 2.8), 0.5, a, 0, 0.4, 0.9);
      }
      const shards = budget(5, 1);
      for (let i = 0; i < shards; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 40, 140);
        pool.emit(PARTICLE.shard, C(PARTICLE.shard), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.6, 1.3), between(rng, 1.8, 3.2), 0.9, rng.next() * Math.PI * 2, spread(rng, 8), 1, 0.9);
      }
      const smoke = budget(10, 1);
      for (let i = 0; i < smoke; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 8, 40);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.4, 2.6), between(rng, 3, 6), between(rng, 14, 22), rng.next() * Math.PI * 2,
          spread(rng, 0.8), 0.9, 0.5);
      }
    },
  },
  {
    id: 'E',
    name: 'Compact',
    line: 'The reduced-VFX read: 13 particles, same shape, nothing missing — just fewer.',
    emit: (pool, rng) => {
      pool.emit(PARTICLE.flare, C(PARTICLE.flare), 0, 0, 0, 0, 0.14, 13, 3, 0, 0, 0, 1);
      ring(pool, 0, 0, 4, 38, 0.4, 0.8);
      const embers = budget(6, 1);
      for (let i = 0; i < embers; i++) {
        const a = (i / 6) * Math.PI * 2 + spread(rng, 0.4);
        const speed = between(rng, 80, 240);
        pool.emit(PARTICLE.ember, C(PARTICLE.ember), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.3, 0.6), between(rng, 2.4, 3.8), 0.5, a, 0, 1.8, 1);
      }
      const shards = budget(3, 1);
      for (let i = 0; i < shards; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 50, 150);
        pool.emit(PARTICLE.shard, C(PARTICLE.shard), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.6, 1.2), between(rng, 2, 3.2), 0.9, rng.next() * Math.PI * 2, spread(rng, 9), 1, 0.9);
      }
      const smoke = budget(2, 1);
      for (let i = 0; i < smoke; i++) {
        const a = rng.next() * Math.PI * 2;
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke), 0, 0, Math.cos(a) * 22, Math.sin(a) * 22,
          between(rng, 1, 1.6), 3.5, 14, rng.next() * Math.PI * 2, 0, 0.9, 0.5);
      }
    },
  },
  {
    id: 'F',
    name: 'Cold vent',
    line: 'A pressure failure, not a fire: plasma vents, metal leaves, nothing burns.',
    emit: (pool, rng) => {
      pool.emit(PARTICLE.flare, C(PARTICLE.flare), 0, 0, 0, 0, 0.1, 11, 2, 0, 0, 0, 1);
      ring(pool, 0, 0, 3, 34, 0.32, 0.85); // the snap
      ring(pool, 0, 0, 8, 66, 0.95, 0.3); // and the vent behind it
      const sparks = budget(20, 1);
      for (let i = 0; i < sparks; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 90, 330);
        pool.emit(PARTICLE.spark, C(PARTICLE.spark), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.18, 0.42), between(rng, 1.6, 2.8), 0.4, a, 0, 2.4, 0.95);
      }
      const shards = budget(10, 1);
      for (let i = 0; i < shards; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 50, 170);
        pool.emit(PARTICLE.shard, C(PARTICLE.shard), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.8, 1.8), between(rng, 2, 3.4), 1.1, rng.next() * Math.PI * 2, spread(rng, 7), 0.8, 0.95);
      }
      // Vented gas, not smoke from a fire: pale, thin, and it goes nowhere.
      const gas = budget(4, 1);
      for (let i = 0; i < gas; i++) {
        const a = rng.next() * Math.PI * 2;
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke), 0, 0, Math.cos(a) * between(rng, 20, 55),
          Math.sin(a) * between(rng, 20, 55), between(rng, 0.8, 1.4), 2, between(rng, 10, 16),
          rng.next() * Math.PI * 2, 0, 1.4, 0.24);
      }
    },
  },
];

// --- Stations --------------------------------------------------------------
// Today is `stationDeath()`, whose comment says it is "deliberately not a
// firework" and whose moment GDD §4.7 makes the most serious in the game. So
// four of the five candidates keep that stance and vary the WEIGHT and DURATION
// of the collapse; L is the one departure, and it is labelled as one.

const STATION_R = STATION.radius;

const STATIONS: Candidate[] = [
  {
    id: 'G',
    name: 'Today',
    line: 'The shipped `stationDeath()` — one 4.5× shockwave over 2.4 s, 26 shards, 34 smoke, 8 embers.',
    today: true,
    emit: (pool, rng) => stationDeath(pool, rng, 0, 0, STATION_R, 1),
  },
  {
    id: 'H',
    name: 'Deadweight',
    line: 'The same collapse with more mass in it: a slower, smaller wave and heavier debris.',
    emit: (pool, rng) => {
      ring(pool, 0, 0, STATION_R * 0.8, STATION_R * 3.6, 3.2, 0.42);
      const shards = budget(30, 1);
      for (let i = 0; i < shards; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 18, 80);
        pool.emit(PARTICLE.shard, C(PARTICLE.shard),
          Math.cos(a) * STATION_R * 0.7, Math.sin(a) * STATION_R * 0.7,
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 2.2, 4.2), between(rng, 4, 9), 2.5, rng.next() * Math.PI * 2,
          spread(rng, 2), 0.45, 0.95);
      }
      const smoke = budget(40, 1);
      for (let i = 0; i < smoke; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 6, 34);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          spread(rng, STATION_R * 0.8), spread(rng, STATION_R * 0.8),
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 3, 5.5), between(rng, 8, 18), between(rng, 34, 58),
          rng.next() * Math.PI * 2, spread(rng, 0.5), 0.65, 0.55);
      }
      const embers = budget(4, 1);
      for (let i = 0; i < embers; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 15, 60);
        pool.emit(PARTICLE.ember, C(PARTICLE.ember), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.2, 2.2), between(rng, 2, 4), 0.6, a, 0, 1.1, 0.65);
      }
    },
  },
  {
    id: 'I',
    name: 'Long settle',
    line: 'The same mass over twice the time — the wave is still opening and the smoke still rising at 1.5 s.',
    emit: (pool, rng) => {
      ring(pool, 0, 0, STATION_R * 0.8, STATION_R * 4.5, 4.2, 0.4);
      const shards = budget(24, 1);
      for (let i = 0; i < shards; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 20, 90);
        pool.emit(PARTICLE.shard, C(PARTICLE.shard),
          Math.cos(a) * STATION_R * 0.7, Math.sin(a) * STATION_R * 0.7,
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 3, 6), between(rng, 3.4, 7), 1.4, rng.next() * Math.PI * 2,
          spread(rng, 1.6), 0.4, 0.95);
      }
      const smoke = budget(36, 1);
      for (let i = 0; i < smoke; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 5, 30);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          spread(rng, STATION_R * 0.9), spread(rng, STATION_R * 0.9),
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 5, 9), between(rng, 7, 15), between(rng, 40, 70),
          rng.next() * Math.PI * 2, spread(rng, 0.4), 0.5, 0.5);
      }
      const embers = budget(6, 1);
      for (let i = 0; i < embers; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 12, 55);
        pool.emit(PARTICLE.ember, C(PARTICLE.ember), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 2, 4), between(rng, 2, 3.6), 0.6, a, 0, 0.9, 0.6);
      }
    },
  },
  {
    id: 'J',
    name: 'Implosion',
    line: 'It pulls in before it pushes out, and nothing burns — zero embers, zero heat.',
    emit: (pool, rng) => {
      ring(pool, 0, 0, STATION_R * 1.7, STATION_R * 0.25, 1.1, 0.55); // in
      ring(pool, 0, 0, STATION_R * 0.3, STATION_R * 3.8, 2.8, 0.45); // then out
      const shards = budget(26, 1);
      for (let i = 0; i < shards; i++) {
        const a = rng.next() * Math.PI * 2;
        // Thrown off the rim, but slowly, and half of them fall back inward.
        const speed = between(rng, -30, 70);
        pool.emit(PARTICLE.shard, C(PARTICLE.shard),
          Math.cos(a) * STATION_R * 0.95, Math.sin(a) * STATION_R * 0.95,
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 2, 3.8), between(rng, 3.4, 7.5), 1.8, rng.next() * Math.PI * 2,
          spread(rng, 2.4), 0.55, 0.95);
      }
      const smoke = budget(34, 1);
      for (let i = 0; i < smoke; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 4, 26);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          spread(rng, STATION_R * 0.7), spread(rng, STATION_R * 0.7),
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 2.8, 5), between(rng, 9, 20), between(rng, 30, 52),
          rng.next() * Math.PI * 2, spread(rng, 0.5), 0.7, 0.5);
      }
    },
  },
  {
    id: 'K',
    name: 'Ash',
    line: 'Smoke IS the event: 50 puffs, 14 shards falling out of them, one faint wave, nothing lit.',
    emit: (pool, rng) => {
      ring(pool, 0, 0, STATION_R * 0.7, STATION_R * 2.6, 2.8, 0.3);
      const smoke = budget(50, 1);
      for (let i = 0; i < smoke; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 4, 28);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          spread(rng, STATION_R), spread(rng, STATION_R),
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 3, 7), between(rng, 10, 22), between(rng, 40, 72),
          rng.next() * Math.PI * 2, spread(rng, 0.4), 0.6, 0.5);
      }
      const shards = budget(14, 1);
      for (let i = 0; i < shards; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 12, 55);
        pool.emit(PARTICLE.shard, C(PARTICLE.shard),
          Math.cos(a) * STATION_R * 0.6, Math.sin(a) * STATION_R * 0.6,
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 2.5, 5), between(rng, 3, 6.5), 1.2, rng.next() * Math.PI * 2,
          spread(rng, 1.4), 0.5, 0.9);
      }
    },
  },
  {
    id: 'L',
    name: 'Departure',
    line: 'DEPARTURE — the firework the tone contract declines: a 5.5× wave, a real flare, 26 embers, 14 sparks.',
    departure: true,
    emit: (pool, rng) => {
      pool.emit(PARTICLE.flare, C(PARTICLE.flare), 0, 0, 0, 0, 0.28, 48, 8, 0, 0, 0, 1);
      ring(pool, 0, 0, STATION_R * 0.4, STATION_R * 5.5, 1.6, 0.75);
      ring(pool, 0, 0, STATION_R * 0.2, STATION_R * 2.4, 0.7, 0.6);
      const embers = budget(26, 1);
      for (let i = 0; i < embers; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 80, 380);
        pool.emit(PARTICLE.ember, C(PARTICLE.ember), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.6, 1.6), between(rng, 3, 6), 0.8, a, 0, 1.4, 1);
      }
      const sparks = budget(14, 1);
      for (let i = 0; i < sparks; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 150, 460);
        pool.emit(PARTICLE.spark, C(PARTICLE.spark), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.2, 0.45), between(rng, 2, 3.4), 0.4, a, 0, 2.6, 0.95);
      }
      const shards = budget(30, 1);
      for (let i = 0; i < shards; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 60, 260);
        pool.emit(PARTICLE.shard, C(PARTICLE.shard),
          Math.cos(a) * STATION_R * 0.6, Math.sin(a) * STATION_R * 0.6,
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.2, 2.8), between(rng, 3, 7), 1.4, rng.next() * Math.PI * 2,
          spread(rng, 6), 0.9, 0.95);
      }
      const smoke = budget(30, 1);
      for (let i = 0; i < smoke; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 20, 90);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          spread(rng, STATION_R * 0.6), spread(rng, STATION_R * 0.6),
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.6, 3.2), between(rng, 6, 12), between(rng, 24, 40),
          rng.next() * Math.PI * 2, spread(rng, 0.8), 0.9, 0.5);
      }
    },
  },
];

// --- Asteroids -------------------------------------------------------------
// The developer's own direction: "more dust based perhaps?". Today's
// `asteroidBurst()` is chips and glints with a shockwave ring — a small bomb.
// Every candidate here leads with DUST: slow low-alpha cloud (the `smoke` kind,
// which is the shipped grey), chips as an accent, and the ore glints kept
// because the payout is the reason anyone shot the rock. This is the family with
// the most room, so it gets six candidates instead of five.

/** The radius the burst is drawn at. `field.ts` routes `rockBurst` with
 *  `Math.max(6, mag * 24)` where the observer packs `mag = radius / 24`
 *  clamped to 1 — so 24 is the largest radius ANY rock bursts at today,
 *  however big the rock was. Drawing the reference rock at 24 keeps that
 *  clamp from silently flattering the effect. */
const ROCK_R = 24;

const ASTEROIDS: Candidate[] = [
  {
    id: 'M',
    name: 'Today',
    line: 'The shipped `asteroidBurst()` — 10 chips, 8 ore glints, a 2.2× shockwave ring. No dust at all.',
    today: true,
    emit: (pool, rng) => asteroidBurst(pool, rng, 0, 0, ROCK_R, 1),
  },
  {
    id: 'N',
    name: 'Dust bloom',
    line: 'A slow low cloud that opens where the rock was and hangs there — chips are an accent, no ring.',
    emit: (pool, rng) => {
      const dust = budget(14, 1);
      for (let i = 0; i < dust; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 8, 30);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          Math.cos(a) * ROCK_R * 0.4, Math.sin(a) * ROCK_R * 0.4,
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.6, 2.8), between(rng, ROCK_R * 0.25, ROCK_R * 0.5),
          between(rng, ROCK_R * 1.1, ROCK_R * 1.9), rng.next() * Math.PI * 2,
          spread(rng, 0.5), 1.6, 0.3);
      }
      const chips = budget(4, 1);
      for (let i = 0; i < chips; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 30, 90);
        pool.emit(PARTICLE.chip, C(PARTICLE.chip), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.5, 1), between(rng, 1.4, 2.6), 0.6, rng.next() * Math.PI * 2,
          spread(rng, 5), 1.2, 0.95);
      }
      const ore = budget(4, 1);
      for (let i = 0; i < ore; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 20, 60);
        pool.emit(PARTICLE.oreBit, C(PARTICLE.oreBit), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.8, 1.4), between(rng, 1.2, 2.2), 0.8, rng.next() * Math.PI * 2,
          spread(rng, 4), 1.4, 1);
      }
    },
  },
  {
    id: 'O',
    name: 'Grit',
    line: 'Dust plus a lot of small stone — 18 chips, all of it braking hard and settling.',
    emit: (pool, rng) => {
      const dust = budget(10, 1);
      for (let i = 0; i < dust; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 6, 24);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          spread(rng, ROCK_R * 0.5), spread(rng, ROCK_R * 0.5),
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.4, 2.4), between(rng, ROCK_R * 0.2, ROCK_R * 0.45),
          between(rng, ROCK_R * 0.8, ROCK_R * 1.4), rng.next() * Math.PI * 2,
          spread(rng, 0.5), 2, 0.28);
      }
      const chips = budget(18, 1);
      for (let i = 0; i < chips; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 20, 75);
        pool.emit(PARTICLE.chip, C(PARTICLE.chip),
          Math.cos(a) * ROCK_R * 0.5, Math.sin(a) * ROCK_R * 0.5,
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.6, 1.4), between(rng, 0.9, 1.8), 0.5, rng.next() * Math.PI * 2,
          spread(rng, 7), 1.8, 0.95);
      }
      const ore = budget(5, 1);
      for (let i = 0; i < ore; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 18, 55);
        pool.emit(PARTICLE.oreBit, C(PARTICLE.oreBit), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.9, 1.5), between(rng, 1.2, 2.2), 0.8, rng.next() * Math.PI * 2,
          spread(rng, 4), 1.4, 1);
      }
    },
  },
  {
    id: 'P',
    name: 'Hang',
    line: 'Barely any velocity: the cloud drifts as one body for three seconds. Mass and time, no bang.',
    emit: (pool, rng) => {
      // One shared drift, so the cloud reads as a body of dust moving, rather
      // than as sixteen puffs each going its own way.
      const driftX = 14;
      const driftY = -6;
      const dust = budget(16, 1);
      for (let i = 0; i < dust; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 2, 12);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          spread(rng, ROCK_R * 0.6), spread(rng, ROCK_R * 0.6),
          driftX + Math.cos(a) * speed, driftY + Math.sin(a) * speed,
          between(rng, 2.4, 3.6), between(rng, ROCK_R * 0.3, ROCK_R * 0.55),
          between(rng, ROCK_R * 1.2, ROCK_R * 1.7), rng.next() * Math.PI * 2,
          spread(rng, 0.3), 0.5, 0.26);
      }
      const chips = budget(3, 1);
      for (let i = 0; i < chips; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 25, 60);
        pool.emit(PARTICLE.chip, C(PARTICLE.chip), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.8, 1.6), between(rng, 1.6, 2.8), 0.8, rng.next() * Math.PI * 2,
          spread(rng, 4), 0.9, 0.95);
      }
      const ore = budget(4, 1);
      for (let i = 0; i < ore; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 12, 40);
        pool.emit(PARTICLE.oreBit, C(PARTICLE.oreBit), 0, 0,
          driftX * 0.5 + Math.cos(a) * speed, driftY * 0.5 + Math.sin(a) * speed,
          between(rng, 1.2, 2), between(rng, 1.2, 2.2), 0.9, rng.next() * Math.PI * 2,
          spread(rng, 3), 1, 1);
      }
    },
  },
  {
    id: 'Q',
    name: 'Shell',
    line: 'A dust shell opens off the rim first; the ore arrives out of it, a second later.',
    emit: (pool, rng) => {
      // Not a shockwave — a soft, small, short ring that reads as the rock's own
      // shell letting go. It is inside 2× the rock, where today's is 2.2× and bright.
      ring(pool, 0, 0, ROCK_R * 0.5, ROCK_R * 1.9, 0.55, 0.3);
      const dust = budget(12, 1);
      for (let i = 0; i < dust; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 14, 40);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          Math.cos(a) * ROCK_R * 0.8, Math.sin(a) * ROCK_R * 0.8,
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.6, 2.6), between(rng, ROCK_R * 0.2, ROCK_R * 0.4),
          between(rng, ROCK_R * 0.9, ROCK_R * 1.5), rng.next() * Math.PI * 2,
          spread(rng, 0.4), 1.4, 0.3);
      }
      const chips = budget(6, 1);
      for (let i = 0; i < chips; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 30, 95);
        pool.emit(PARTICLE.chip, C(PARTICLE.chip), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.5, 1.1), between(rng, 1.2, 2.4), 0.6, rng.next() * Math.PI * 2,
          spread(rng, 6), 1.3, 0.95);
      }
      // The payout, deliberately the last thing still on screen.
      const ore = budget(6, 1);
      for (let i = 0; i < ore; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 18, 55);
        pool.emit(PARTICLE.oreBit, C(PARTICLE.oreBit), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.2, 2), between(rng, 1.3, 2.4), 0.9, rng.next() * Math.PI * 2,
          spread(rng, 3), 1, 1);
      }
    },
  },
  {
    id: 'R',
    name: 'No ring',
    line: "Today's burst with the shockwave taken out and dust put in its place — the ring is the bomb.",
    emit: (pool, rng) => {
      const chips = budget(8, 1);
      for (let i = 0; i < chips; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 40, 140);
        pool.emit(PARTICLE.chip, C(PARTICLE.chip), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.4, 0.9), between(rng, 1.6, 3.2), 0.6, rng.next() * Math.PI * 2,
          spread(rng, 7), 1, 1);
      }
      const ore = budget(8, 1);
      for (let i = 0; i < ore; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 25, 85);
        pool.emit(PARTICLE.oreBit, C(PARTICLE.oreBit), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.5, 1.1), between(rng, 1.2, 2.2), 0.8, rng.next() * Math.PI * 2,
          spread(rng, 4), 1.4, 1);
      }
      const dust = budget(12, 1);
      for (let i = 0; i < dust; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 10, 34);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          spread(rng, ROCK_R * 0.4), spread(rng, ROCK_R * 0.4),
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.5, 2.5), between(rng, ROCK_R * 0.25, ROCK_R * 0.45),
          between(rng, ROCK_R * 1, ROCK_R * 1.6), rng.next() * Math.PI * 2,
          spread(rng, 0.5), 1.5, 0.3);
      }
    },
  },
  {
    id: 'S',
    name: 'Compact dust',
    line: 'The reduced-VFX read: 13 particles, and the dust is what survives the budget cut.',
    emit: (pool, rng) => {
      const dust = budget(6, 1);
      for (let i = 0; i < dust; i++) {
        const a = (i / 6) * Math.PI * 2;
        const speed = between(rng, 10, 26);
        pool.emit(PARTICLE.smoke, C(PARTICLE.smoke),
          Math.cos(a) * ROCK_R * 0.3, Math.sin(a) * ROCK_R * 0.3,
          Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 1.6, 2.6), between(rng, ROCK_R * 0.35, ROCK_R * 0.55),
          between(rng, ROCK_R * 1.3, ROCK_R * 1.9), rng.next() * Math.PI * 2,
          spread(rng, 0.4), 1.5, 0.32);
      }
      const chips = budget(3, 1);
      for (let i = 0; i < chips; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 35, 100);
        pool.emit(PARTICLE.chip, C(PARTICLE.chip), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.5, 1), between(rng, 1.6, 2.8), 0.7, rng.next() * Math.PI * 2,
          spread(rng, 6), 1.2, 0.95);
      }
      const ore = budget(4, 1);
      for (let i = 0; i < ore; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = between(rng, 22, 65);
        pool.emit(PARTICLE.oreBit, C(PARTICLE.oreBit), 0, 0, Math.cos(a) * speed, Math.sin(a) * speed,
          between(rng, 0.7, 1.3), between(rng, 1.2, 2.2), 0.8, rng.next() * Math.PI * 2,
          spread(rng, 4), 1.3, 1);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Families — each drawn in its own world extent, at its own true scale
// ---------------------------------------------------------------------------

export interface Family {
  readonly key: string;
  readonly title: string;
  /** What the developer is being asked about this family. */
  readonly ask: string;
  /** What the colour round means for THIS family, in particular (a0-86). */
  readonly heatNote: string;
  /** Half the frame's world extent, world units. */
  readonly half: number;
  /** The reference body's shipped sprite and its shipped radius. */
  readonly ref: SpriteDef;
  readonly refRadius: number;
  readonly refNote: string;
  /** Opacity of the reference body. Defaults to {@link REF_ALPHA}. */
  readonly refAlpha?: number;
  readonly candidates: readonly Candidate[];
}

export const FAMILIES: Family[] = [
  {
    key: 'ship',
    title: 'Ships',
    ask:
      'A ship is cheap and respawns free, so this one is allowed to be quick and bright. ' +
      'The variable is the balance of flare, sparks, shards and smoke.',
    heatNote:
      'Every ship candidate has real light in it — a flare, a shockwave, embers, sparks — so every ' +
      'red twin here is a genuinely different frame. This is the family where the question was ' +
      'asked and it is the family with the most to say back.',
    half: 150,
    ref: shipSprite({ shipClass: ShipClass.Vanguard, playerId: 0 }),
    refRadius: SHIP_RADIUS,
    refNote: `Vanguard hull at its collision radius, ${SHIP_RADIUS} world units (SHIP_RADIUS).`,
    candidates: SHIPS,
  },
  {
    key: 'station',
    title: 'Stations',
    ask:
      'GDD §4.7 makes this the most serious moment in the game — the audio drops out for three seconds ' +
      'and nobody jokes — and the shipped effect says in its own comment that it is "deliberately not a ' +
      'firework". Four of the five candidates keep that stance and vary weight and duration instead. ' +
      'L is the one that does not, and it is here so the departure is something you decline on purpose.',
    heatNote:
      'A station death is mostly mass: shards, smoke and a shockwave. So the red twins of G, H and I ' +
      'move a handful of embers and the wave, and J and K — the two candidates whose whole character ' +
      'is that NOTHING burns — have only their wave to repaint. If red reads as heat, a red wave on ' +
      'an implosion may be exactly the heat those two were written to refuse; that is worth looking ' +
      'at rather than assuming.',
    half: 320,
    ref: stationSprite(1, 0),
    refRadius: STATION_R,
    refNote: `Facility at its shipped body radius, ${STATION_R} world units (STATION.radius).`,
    candidates: STATIONS,
  },
  {
    key: 'asteroid',
    title: 'Asteroids',
    ask:
      'Your direction, verbatim: "more dust based perhaps?". Today is chips and a shockwave — a small bomb. ' +
      'Every candidate here leads with dust: slow, low-alpha cloud that hangs and drifts, chips as an accent, ' +
      'and the ore glints kept, because the payout is why anyone shot the rock. Six candidates, not five — ' +
      'this is the family with the most room in it.',
    heatNote:
      'YOUR DUST DIRECTION IS ABOUT MATERIAL, NOT HEAT, AND THE MAP AGREES WITH IT. A rock is not on ' +
      'fire: there is no fuel and no oxygen, and the thing coming off it is powdered stone. The ' +
      'treatment repaints LIGHT — plasma into threat red — and five of these seven candidates ' +
      'contain no light at all, so their red twin comes back identical, particle for particle. Only ' +
      'M and Q have a shockwave ring, and that ring is the only thing red can reach here. That is ' +
      'the argument, and it is made by the map rather than by this paragraph: if you want warmth in ' +
      'a rock burst it has to come from a new particle, not from a recolour, and the honest place ' +
      'for it would be the hit that broke the rock rather than the dust that followed.',
    half: 100,
    ref: asteroidSprite({ seed: 7, crackStage: 2 }),
    refRadius: ROCK_R,
    refAlpha: 0.2,
    refNote:
      `Rock at stage 2 — one hit from bursting — at radius ${ROCK_R} world units. Rocks run ` +
      `${ASTEROID.minRadius}–${ASTEROID.maxRadius} units, but ${ROCK_R} is the radius EVERY burst is ` +
      'drawn at today however big the rock was: the observer packs magnitude as radius/24 clamped to 1, ' +
      'and the field unpacks it as magnitude×24.',
    candidates: ASTEROIDS,
  },
];

// ---------------------------------------------------------------------------
// Treatments — the colour round (a0-86)
// ---------------------------------------------------------------------------

/**
 * One colour treatment of a candidate. Two of these times nineteen candidates is
 * the thirty-eight options the board now offers.
 *
 * The pair exists because the developer's question was about colour and the
 * board could only answer about motion. Splitting the two apart is the whole
 * design: a red twin is not a new candidate, it is the same candidate with the
 * cold-energy register mapped into the ember register on the way to the GPU
 * (`./heat`). Nothing else can differ, because nothing else has a second copy.
 */
export interface Treatment {
  /** Suffix on the option id — `A-C`, `A-R`. A verdict names one of these. */
  readonly key: 'C' | 'R';
  /** What the panel is labelled. */
  readonly label: string;
  /** One line of why, on the panel itself. */
  readonly line: string;
  /** True for the ember register — the only difference between the two. */
  readonly heat: boolean;
}

export const TREATMENTS: readonly Treatment[] = [
  {
    key: 'C',
    label: 'COLD',
    line: 'Plasma — the register every effect in the game is authored in today.',
    heat: false,
  },
  {
    key: 'R',
    label: 'RED',
    line: 'Threat red, brightening toward WHITE — the same light, in the danger register.',
    heat: true,
  },
];

/** The id a verdict names: the candidate's letter plus its colour suffix. */
export function optionId(candidate: Candidate, treatment: Treatment): string {
  return `${candidate.id}-${treatment.key}`;
}

/** A fresh pool of the right kind for a treatment. The candidate never knows. */
export function poolFor(treatment: Treatment): ParticlePool {
  return treatment.heat ? new HeatPool(LAB_POOL_CAPACITY) : new ParticlePool(LAB_POOL_CAPACITY);
}

/**
 * Particles this candidate's red twin actually repaints.
 *
 * **Zero is a real answer and the board prints it.** Five of the seven asteroid
 * candidates are rock dust, rock chips and ore glints — no light anywhere in
 * them — so the map has nothing to reach and the two panels are identical frame
 * for frame. That is the asteroid family's answer to "can you argue warmth
 * here", arrived at mechanically rather than asserted: rock is not on fire, and
 * a treatment keyed on the colour of LIGHT cannot pretend otherwise.
 */
export function heatMoved(candidate: Candidate): number {
  return heatDiffers((pool) => candidate.emit(pool, mulberry32(SEED)));
}
