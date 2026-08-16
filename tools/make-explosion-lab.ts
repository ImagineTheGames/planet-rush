/**
 * make-explosion-lab.ts — nineteen deaths, on one page, for the developer to pick.
 *
 * The developer, 2026-08-16: *"when stations die all audio cuts off you dont hear
 * like an explosion effect, it would also be cool to see an actual explosion
 * effect can you make some prototype ones for us to approve on a web page"* —
 * and then, on scope: *"i want it both for ships and stations... and asteroids
 * should have them as well but more dust based perhaps?"*
 *
 * So this is the laser lab's job on a different subject: put the real candidates
 * on one page so a pick is made by looking, not by reading a description. It
 * produces `docs/art-direction/explosion-lab.html` and **nothing in `src/`
 * changes behaviour**. A follow-up brief ports whichever ids come back.
 *
 * ## The four rules this page is built under
 *
 * 1. **The game's own particle system.** Every candidate below writes into a real
 *    {@link ParticlePool} through the real `emit`, using the real `PARTICLE`
 *    kinds and their `particleKind` colours, and is stepped by the real
 *    `pool.update`. Today's three effects are literally `explosion()`,
 *    `stationDeath()` and `asteroidBurst()` imported from `src/art/vfx/emitters`
 *    — not re-typed. A candidate that could not be written this way is not a
 *    candidate, because porting it would be a rewrite rather than a tuning.
 * 2. **Deterministic.** Seeded `mulberry32` (the ratified RNG, `@shared/types`),
 *    one fresh stream per candidate off the same seed so the families are
 *    comparable, stepped at the fixed {@link VFX_SHOWCASE_DT} — never the wall
 *    clock. The page renders byte-identically on every boot, like `showcase.ts`.
 * 3. **Filmstrips.** An explosion is motion and a single frame cannot be
 *    approved, so each candidate is six frames at 0.05 / 0.15 / 0.35 / 0.6 / 1.0
 *    / 1.5 s (frame indices 3, 9, 21, 36, 60, 90 at 1/60).
 * 4. **True scale.** Each family is drawn in WORLD UNITS — the SVG `viewBox` is
 *    world space — against the shipped sprite at its shipped radius, on the
 *    game's own Floor. `showcase.ts` warns against staging effects "scaled up to
 *    photograph better"; a station's shockwave is 288 units wide and the frame
 *    is the size it has to be to hold it, not the other way round.
 *
 * ## Two deliberate deviations, stated rather than hidden
 *
 * - **The ship reference is 16 units, not 12.** The brief says a 12-unit ship;
 *   `SHIP_RADIUS` is 16 and `field.ts` unpacks the explosion magnitude against
 *   `SHIP_RADIUS_REF = 16`. The 12 is stale (`make-laser-lab.ts` carries the same
 *   stale copy). True scale beats a quoted number, so this imports the constant.
 * - **`budget` / `between` / `spread` are copied, not imported.** They are
 *   module-private in `emitters.ts`, and exporting them for a tool would add
 *   three exports with no production caller — exactly the shape
 *   `npm run dark-matter:check` gates on in CI. They are three lines each and are
 *   reproduced below VERBATIM; the port will use the originals.
 *
 * Run: npx vite-node tools/make-explosion-lab.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mulberry32, ShipClass, type Rng } from '@shared/types';
import { asteroidSprite } from '../src/art/asteroids';
import { hex } from '../src/art/palette';
import { shipSprite } from '../src/art/ships';
import { stationSprite } from '../src/art/stations';
import { shapeToSvg, spriteToGroup } from '../src/art/svg';
import { FLOOR } from '../src/art/tokens';
import type { SpriteDef } from '../src/art/shapes';
import { asteroidBurst, explosion, ring, stationDeath } from '../src/art/vfx/emitters';
import { fadeAt, PARTICLE, PARTICLE_KINDS, particleKind, particleSprite } from '../src/art/vfx/kinds';
import { ParticlePool } from '../src/art/vfx/particles';
import { VFX_SHOWCASE_DT } from '../src/art/vfx/showcase';
import { ASTEROID, SHIP_RADIUS, STATION } from '../src/sim/constants';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where the board lands, and why it lands twice.
 *
 * `docs/art-direction/` is the one that matters and it is not a preference: the
 * studio dashboard's ART page lists `workspace/docs/art-direction/*.html` and
 * nothing else, so a board written only to `assets/preview/` (where
 * `laser-lab.html` lives) never appears there and has to be handed over as a file
 * path. The developer asked directly — *"is it going to show up on the art page
 * for me to see?"* — and an unseen review surface is a review that does not
 * happen.
 *
 * The second copy is written because `assets/preview/` is where every earlier
 * lab lives and someone will look for it there. Both are written by this
 * generator from the same string, so they cannot drift into two boards.
 */
const OUTPUTS = [
  resolve(HERE, '../docs/art-direction/explosion-lab.html'),
  resolve(HERE, '../assets/preview/explosion-lab.html'),
];

/** The field's own default scatter seed — one fresh stream per candidate. */
const SEED = 0x5f3759df;

/** The frame times on the strip, seconds. Stated on the page as well. */
const FRAME_TIMES = [0.05, 0.15, 0.35, 0.6, 1.0, 1.5] as const;

/** Frame indices at the fixed timestep — 3, 9, 21, 36, 60, 90. */
const FRAME_STEPS = FRAME_TIMES.map((t) => Math.round(t / VFX_SHOWCASE_DT));

/** Below this composited alpha a particle contributes nothing but bytes. */
const ALPHA_FLOOR = 0.005;

/**
 * How visible a reference body is by default. It is a ruler, not part of the
 * effect. The asteroid family overrides it downward: rock dust is the same grey
 * as rock, so a 35% rock under a dust cloud is a ghost you cannot tell from the
 * thing being reviewed.
 */
const REF_ALPHA = 0.35;

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
interface Candidate {
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

interface Family {
  readonly key: string;
  readonly title: string;
  /** What the developer is being asked about this family. */
  readonly ask: string;
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

const FAMILIES: Family[] = [
  {
    key: 'ship',
    title: 'Ships',
    ask:
      'A ship is cheap and respawns free, so this one is allowed to be quick and bright. ' +
      'The variable is the balance of flare, sparks, shards and smoke.',
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
// Simulate — the real pool, the real update loop, a fixed timestep
// ---------------------------------------------------------------------------

/** One particle as it stood on one frame. */
interface Snap {
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly r: number;
  readonly a: number;
}

/** Run one candidate and snapshot it at each of {@link FRAME_STEPS}. */
function filmstrip(candidate: Candidate, half: number): Snap[][] {
  const pool = new ParticlePool(2048);
  const rng = mulberry32(SEED);
  candidate.emit(pool, rng);

  const frames: Snap[][] = [];
  const last = FRAME_STEPS[FRAME_STEPS.length - 1] ?? 0;
  let next = 0;
  for (let step = 0; step <= last; step++) {
    if (step > 0) pool.update(VFX_SHOWCASE_DT);
    while (next < FRAME_STEPS.length && FRAME_STEPS[next] === step) {
      frames.push(capture(pool, half));
      next++;
    }
  }
  return frames;
}

/** The visible particles, exactly as `layer.ts` would hand them to the GPU. */
function capture(pool: ParticlePool, half: number): Snap[] {
  const out: Snap[] = [];
  for (let i = 0; i < pool.count; i++) {
    const kind = pool.kind[i]!;
    const a = pool.alpha[i]! * fadeAt(kind, pool.progress(i));
    if (a < ALPHA_FLOOR) continue;
    const r = pool.radiusAt(i);
    const x = pool.x[i]!;
    const y = pool.y[i]!;
    // Wholly outside the frame: it is honest to drop it, and it is bytes.
    if (Math.abs(x) - r > half || Math.abs(y) - r > half) continue;
    // Every candidate paints kinds in their own palette colour — no emitter here
    // tints — so the SVG sprite's baked fills ARE the tint. Assert it rather than
    // promise it: a tinted particle would silently render the wrong colour.
    if (pool.color[i] !== (particleKind(kind).color >>> 0)) {
      throw new Error(`particle kind ${kind} carries a tint this page cannot draw`);
    }
    out.push({ kind, x, y, rot: pool.rot[i]!, r, a });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Every particle look, once, as a referenceable `<g>` in unit space. */
const kindDefs = PARTICLE_KINDS.map(
  (spec) => `<g id="pk-${spec.name}">${particleSprite(spec.kind).shapes.map(shapeToSvg).join('')}</g>`,
).join('');

const KIND_NAME = new Map<number, string>(PARTICLE_KINDS.map((s) => [s.kind as number, s.name]));

/**
 * Place a sprite so its unit radius is `r` world units, centred on the origin.
 *
 * `spriteToGroup` scales by `size / (extent * 2)`, and a sprite's extent is the
 * fraction of its own unit radius the ART reaches to — 1.95 for a station, whose
 * boom leaves the body. So the size that makes unit radius 1 land on `r` world
 * units is `2 * r * extent`, not `2 * r`.
 */
function refGroup(def: SpriteDef, r: number): string {
  const size = 2 * r * def.extent;
  return spriteToGroup(def, size, -size / 2, -size / 2);
}

/** The three reference bodies, defined once and `<use>`d by all 114 frames. */
const refDefs = (): string =>
  FAMILIES.map((f) => `<g id="ref-${f.key}">${refGroup(f.ref, f.refRadius)}</g>`).join('');

/** One frame, in world coordinates — the viewBox IS world space. */
function frameSvg(family: Family, snaps: Snap[]): string {
  const half = family.half;
  const matter: string[] = [];
  const light: string[] = [];
  for (const s of snaps) {
    const name = KIND_NAME.get(s.kind) ?? 'spark';
    const rot = (s.rot * 180) / Math.PI;
    const t = `translate(${n(s.x)} ${n(s.y)}) rotate(${n(rot)}) scale(${n(s.r)})`;
    const el = `<use href="#pk-${name}" transform="${t}" opacity="${n(s.a)}"/>`;
    (particleKind(s.kind).additive ? light : matter).push(el);
  }
  return (
    `<svg class="fr" viewBox="${n(-half)} ${n(-half)} ${n(half * 2)} ${n(half * 2)}" ` +
    'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">' +
    `<rect x="${n(-half)}" y="${n(-half)}" width="${n(half * 2)}" height="${n(half * 2)}" fill="${hex(FLOOR)}"/>` +
    `<use href="#ref-${family.key}" opacity="${n(family.refAlpha ?? REF_ALPHA)}"/>` +
    // Matter under light, and light composited additively — the same two-container
    // split, in the same order, that `layer.ts` puts on the GPU.
    `<g>${matter.join('')}</g>` +
    `<g class="add">${light.join('')}</g>` +
    '</svg>'
  );
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function candidateRow(family: Family, candidate: Candidate): string {
  const strips = filmstrip(candidate, family.half);
  const peak = strips.reduce((m, f) => Math.max(m, f.length), 0);
  const tags = [
    candidate.today ? '<b class="tag today">TODAY</b>' : '',
    candidate.departure ? '<b class="tag depart">DEPARTURE</b>' : '',
  ].join('');
  const frames = strips
    .map((f, i) => `<figure>${frameSvg(family, f)}<figcaption>${FRAME_TIMES[i]}s</figcaption></figure>`)
    .join('');
  return `<article class="cand" id="c-${candidate.id}">
  <div class="hd"><span class="id">${candidate.id}</span><h3>${esc(candidate.name)}</h3>${tags}
    <span class="peak">${peak} particles at its peak frame</span></div>
  <p class="line">${esc(candidate.line)}</p>
  <div class="strip">${frames}</div>
</article>`;
}

function familySection(family: Family): string {
  const scale = `${n(family.half * 2)} world units across`;
  return `<section class="fam" id="f-${family.key}">
  <h2>${esc(family.title)}</h2>
  <p class="ask">${esc(family.ask)}</p>
  <p class="meta">Frame: <b>${scale}</b>. ${esc(family.refNote)} The body is drawn at ${Math.round(
    (family.refAlpha ?? REF_ALPHA) * 100,
  )}% as a <b>ruler</b> — it is there for scale, not because it is still standing.</p>
  ${family.candidates.map((c) => candidateRow(family, c)).join('\n')}
</section>`;
}

const sections = FAMILIES.map(familySection).join('\n');

const ids = FAMILIES.map(
  (f) => `<b>${esc(f.title)}</b> — ${f.candidates.map((c) => `${c.id} ${esc(c.name)}`).join(' · ')}`,
).join('<br>');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Planet Rush — Explosion lab: ships, stations, asteroids</title>
<!--
  a0-63 · The explosion lab. GENERATED — edit tools/make-explosion-lab.ts and
  re-run \`npx vite-node tools/make-explosion-lab.ts\`, never this file.

  Every frame on this page came out of the game's own particle system: the real
  ParticlePool, the real PARTICLE kinds and their particleKind() colours, the
  real pool.update() loop, stepped at VFX_SHOWCASE_DT (1/60) off a seeded
  mulberry32 — never the wall clock. Today's three effects are the shipped
  explosion(), stationDeath() and asteroidBurst() called directly.

  Nothing in src/ changed. This page is the decision; the port is a follow-up.
-->
<style>
  :root{
    --vacuum:#0D1015; --floor:#070910; --panel:#141A22; --rule:#252D3A; --hair:#1c2430;
    --text:#DCE3EC; --muted:#8B95A5; --steel:#7E8894; --plasma:#4DC3FF;
    --yellow:#F2D24B; --red:#B23A3A; --patina:#4FA08B;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--vacuum);color:var(--text);
    font-family:"Oxanium","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;
    font-size:14px;line-height:1.6}
  header{padding:30px 34px 8px;border-bottom:1px solid var(--rule)}
  h1{margin:0 0 10px;font-family:"Audiowide","Oxanium",system-ui,sans-serif;
     font-size:23px;font-weight:400;letter-spacing:.02em}
  h2{margin:0 0 6px;font-family:"Audiowide","Oxanium",system-ui,sans-serif;
     font-size:17px;font-weight:400;letter-spacing:.04em;color:var(--plasma)}
  h3{margin:0;font-size:15px;font-weight:600;letter-spacing:.01em}
  p{margin:0 0 10px;max-width:104ch}
  .sub{color:var(--muted);font-size:13px}
  code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12px;color:#8fd0e8}
  .fam{padding:26px 34px 10px;border-bottom:1px solid var(--rule)}
  .ask{color:var(--text)}
  .meta{color:var(--muted);font-size:12.5px}
  .cand{margin:18px 0 26px;padding:14px 16px 10px;background:var(--panel);
        border:1px solid var(--hair);border-radius:10px}
  .hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .id{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;
      border:1px solid var(--plasma);border-radius:6px;color:var(--plasma);
      font-family:ui-monospace,monospace;font-size:14px;font-weight:700}
  .tag{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.14em;
       padding:3px 7px;border-radius:4px;font-weight:700}
  .today{background:#1d3243;color:#8fd0e8;border:1px solid #2c5570}
  .depart{background:#3a2020;color:#e0a0a0;border:1px solid #6a3535}
  .peak{margin-left:auto;color:var(--muted);font-size:11.5px;
        font-family:ui-monospace,monospace}
  .line{margin:8px 0 12px;color:var(--muted);font-size:13px;max-width:104ch}
  .strip{display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:6px}
  figure{margin:0;flex:0 0 auto}
  figcaption{margin-top:4px;text-align:center;color:var(--muted);
             font-family:ui-monospace,monospace;font-size:11px}
  svg.fr{display:block;width:232px;height:232px;background:var(--floor);
         border:1px solid var(--hair);border-radius:4px}
  /* Additive light over matter, exactly as layer.ts blends it on the GPU.
     \`screen\` first so a browser without plus-lighter still composites light. */
  svg.fr g.add{mix-blend-mode:screen;mix-blend-mode:plus-lighter}
  .defs{position:absolute;width:0;height:0;overflow:hidden}
  footer{padding:26px 34px 46px;color:var(--muted);font-size:13px;max-width:104ch}
  footer b{color:var(--text)}
  .roster{margin-top:10px;line-height:2}
</style>
</head>
<body>
<svg class="defs" xmlns="http://www.w3.org/2000/svg"><defs>${kindDefs}${refDefs()}</defs></svg>

<header>
  <h1>Explosion lab</h1>
  <p class="sub">
    Nineteen candidates across three families, each one a filmstrip at
    <b>${FRAME_TIMES.map((t) => `${t}s`).join(' · ')}</b> — because an explosion is motion and a single
    frame cannot be approved. In every family the <b>first row is today's effect</b>, labelled
    <b class="tag today">TODAY</b>, so every candidate is read against what ships now.
  </p>
  <p class="sub">
    <b>Everything here is the game's own particle system.</b> Real <code>ParticlePool</code>, real
    <code>PARTICLE</code> kinds in their real colours, the real update loop, at a fixed 1/60 timestep off a
    seeded RNG — the page renders identically on every boot. Today's three rows are literally
    <code>explosion()</code>, <code>stationDeath()</code> and <code>asteroidBurst()</code>. Nothing in
    <code>src/</code> changed: <b>this page is the decision, the port is the follow-up.</b>
  </p>
  <p class="sub">
    <b>Scale is true.</b> Each frame is world space — the ship, the facility and the rock are the shipped
    sprites at their shipped radii, on the game's own Floor <code>#070910</code>, and nothing is scaled up
    to photograph better. That is why the station frames look emptier: a station's shockwave is 288 units
    wide and the frame has to be big enough to hold it.
  </p>
  <p class="sub"><b>Answer with a letter per family</b> — "B, J, N" is a complete answer. Every
    candidate carries a fixed id so the verdict can be recorded against it.</p>
</header>

${sections}

<footer>
  <b>How to read a strip.</b> Left to right: ${FRAME_TIMES.map((t) => `${t}s`).join(', ')}. The particle
  count on the right of each header is the busiest frame, against a pool capacity of 1600 shared with
  everything else on screen — so it is also the cost.
  <br><br>
  <b>What is deliberately not here.</b> No candidate invents a colour, a blend mode or a particle look:
  all nineteen are built from the eleven shipped kinds, which is what makes a pick a tuning rather than a
  rewrite. The ore glints in the asteroid family are signal yellow, which is legal and load-bearing —
  ore is one of the two things that colour is allowed to mean.
  <br><br>
  <b>The station family's stance.</b> G, H, I, J and K all keep the shipped one: no sparkle added, the
  weight and duration of the collapse varied instead. <b>L is a labelled departure</b> — it is what a
  firework at station scale looks like, so that declining it is a decision rather than an omission.
  <div class="roster"><b>The full roster, by id:</b><br>${ids}</div>
</footer>
</body>
</html>
`;

for (const out of OUTPUTS) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}

const total = FAMILIES.reduce((sum, f) => sum + f.candidates.length, 0);
console.log(
  `wrote ${OUTPUTS.length} copies (${(html.length / 1024).toFixed(0)} KB each) — ${total} candidates, ` +
    `${total * FRAME_TIMES.length} frames\n  ${OUTPUTS.join('\n  ')}`,
);
