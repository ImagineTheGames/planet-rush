/**
 * src/bots/fog-honesty.test.ts — **the decisions do not change when the hidden
 * state does.**
 *
 * `./perception.test.ts` proves the *view* is fog-honest: an unscouted core
 * reads `null`, an out-of-range ship is not in the list, enemy cargo is never
 * there at all. This file proves the thing that actually matters about it —
 * that the **trees** cannot see past it — and it proves it the only way that
 * survives future edits: by scrambling everything a bot is not allowed to know
 * and asserting that all three difficulties emit the *byte-identical* action
 * stream they emitted against the truth.
 *
 * The scrambler (below) rewrites, on a clone of a real mid-match world:
 *
 *   - the core and shield HP of every planet outside sensor range;
 *   - the turret count of every planet outside visual range;
 *   - every rival's held ore, banked ore and upgrade tiers — numbers the game
 *     never draws for anyone (GDD §2.2);
 *   - the hull, facing and velocity of every ship outside visual range;
 *   - the ore left inside every asteroid (a bot may only *estimate* it from size
 *     and crack stage — GDD §5.5);
 *   - the world's RNG state, so a tree cannot be reading the future either.
 *
 * If any tree ever starts peeking — through a new view field, a `World` handed
 * in by a well-meaning refactor, or a memory that remembers something it never
 * saw — one of these assertions fails, and it fails for every difficulty and
 * every character at once.
 *
 * The last test guards the guard: it asserts the scrambler really did change
 * facts a cheating bot would have noticed, so this file can never pass by
 * scrambling nothing.
 */

import { describe, it, expect } from 'vitest';
import { mulberry32, type Rng } from '@shared/types';
import { SENSOR_RANGE, createWorld, type World } from '../sim';
import { createBot } from './bot';
import { botLobby, createBots, fillEmptySlots, runHeadlessMatch } from './harness';
import { DEFAULT_PERCEPTION, perceive } from './perception';
import { ROSTER } from './personalities';

/** A full offline match, mid-flight: eight planets, the whole cast. */
function match(seed: number): { world: World; bots: ReturnType<typeof createBots> } {
  const seats = fillEmptySlots();
  const world = createWorld({ seed, players: botLobby(seats) });
  return { world, bots: createBots(seats, { seed }) };
}

/** Plain-data world, plain-data clone. */
function clone(world: World): World {
  return JSON.parse(JSON.stringify(world)) as World;
}

/** A number a bot must not be able to tell from the real one. */
function noise(rng: Rng, scale: number): number {
  return rng.next() * scale;
}

/**
 * Rewrite everything slot `id` is not entitled to know. Deliberately aggressive:
 * every hidden field gets a *different* value, not a jittered one, so a tree that
 * reads any of them decides differently and the comparison fails loudly.
 */
function scrambleHidden(world: World, id: number, rng: Rng): void {
  const me = world.ships.find((s) => s.id === id)!;
  const eye = me.pos;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

  for (const planet of world.planets) {
    if (planet.owner === id) continue;
    const surface = Math.max(0, dist(eye, planet.pos) - planet.radius);
    if (surface > SENSOR_RANGE) {
      // Not scouted: the numbers are invisible, so they may be anything.
      planet.coreHp = 1 + noise(rng, planet.maxCoreHp - 1);
      planet.sinceDamage = noise(rng, 30);
      planet.repairing = rng.next() < 0.5;
      for (const shield of planet.shields) shield.hp = noise(rng, shield.maxHp);
    }
    if (surface > DEFAULT_PERCEPTION.visualRange && planet.turrets.length > 0) {
      // Too far to count barrels: drop them all.
      planet.turrets = [];
    }
  }

  for (const ship of world.ships) {
    if (ship.id === id) continue;
    // Never drawn for anyone, at any range (GDD §2.2).
    ship.cargo = noise(rng, ship.cargoCap);
    ship.banked = noise(rng, 50);
    ship.tiers = { power: 3, engine: 3, cargo: 0, hull: 0 };
    if (dist(eye, ship.pos) > DEFAULT_PERCEPTION.visualRange) {
      // Off screen: even the hull bar is gone.
      ship.hull = 1 + noise(rng, ship.maxHull - 1);
      ship.angle = noise(rng, Math.PI * 2);
      ship.vel = { x: noise(rng, 200) - 100, y: noise(rng, 200) - 100 };
    }
  }

  // A rock's payout is estimated from size and crack stage, never read.
  for (const rock of world.asteroids) {
    rock.ore = noise(rng, rock.maxOre);
    rock.mineBuffer = noise(rng, 0.9);
  }

  // Chunk velocity is not drawn; the chunk itself is.
  for (const chunk of world.chunks) chunk.vel = { x: noise(rng, 80) - 40, y: noise(rng, 80) - 40 };

  // Nobody reads the future.
  world.rngState = (world.rngState ^ 0x5bf0_3635) >>> 0;
  world.nextEntityId += 1000;
}

/** Decide one tick with a *fresh* mind, so the comparison is view-vs-view and
 *  never memory-vs-memory. */
function decideFresh(world: World, id: number, personality: (typeof ROSTER)[number]) {
  const bot = createBot({ id, personality }, { seed: 4242 });
  return bot.decide(perceive(world, id));
}

/** Sample a running match at a spread of ticks — opening, mid-field, and deep
 *  into the fight — rather than at one convenient instant. */
function sampleTicks(seed: number, everyTicks: number, seconds: number, visit: (w: World) => void): void {
  const { world, bots } = match(seed);
  runHeadlessMatch(world, bots, {
    maxSeconds: seconds,
    onTick: (w, tick) => {
      if (tick % everyTicks === 0) visit(w);
    },
  });
}

describe('fog-honesty — the trees decide on the view, and only the view', () => {
  it('emits identical actions when every hidden number is scrambled, all match long', () => {
    const rng = mulberry32(0xf0_9d);
    let compared = 0;

    sampleTicks(17, 600, 240, (world) => {
      const scrambledFor = new Map<number, World>();
      for (const seat of fillEmptySlots()) {
        if (!world.ships.find((s) => s.id === seat.id)?.alive) continue;
        const lied = clone(world);
        scrambleHidden(lied, seat.id, rng);
        scrambledFor.set(seat.id, lied);
      }

      for (const seat of fillEmptySlots()) {
        const lied = scrambledFor.get(seat.id);
        if (!lied) continue;
        const honest = decideFresh(world, seat.id, seat.personality);
        const fogged = decideFresh(lied, seat.id, seat.personality);
        expect(fogged).toEqual(honest);
        compared++;
      }
    });

    // The sampling actually happened — a silent zero would pass vacuously.
    expect(compared).toBeGreaterThan(50);
  });

  it('holds for every character at every difficulty, including a wounded one', () => {
    const rng = mulberry32(7);
    const { world, bots } = match(23);
    runHeadlessMatch(world, bots, { maxSeconds: 90 });

    // Hurt everyone: the retreat, defend and opportunity branches all become
    // live, so the comparison covers the parts of each tree that read HP.
    for (const ship of world.ships) ship.hull = ship.maxHull * 0.3;
    for (const planet of world.planets) planet.coreHp = planet.maxCoreHp * 0.4;

    for (const personality of ROSTER) {
      for (const id of [0, 3, 6]) {
        if (!world.ships.find((s) => s.id === id)?.alive) continue;
        const lied = clone(world);
        scrambleHidden(lied, id, rng);
        expect(decideFresh(lied, id, personality)).toEqual(decideFresh(world, id, personality));
      }
    }
  });

  it('scrambles something a cheat would have noticed — the guard on the guard', () => {
    const { world, bots } = match(5);
    runHeadlessMatch(world, bots, { maxSeconds: 120 });

    const lied = clone(world);
    scrambleHidden(lied, 0, mulberry32(99));

    const changed = (pick: (w: World) => number): boolean => pick(world) !== pick(lied);
    // Enemy holds, enemy banks, and the ore inside the rocks all moved.
    expect(changed((w) => w.ships.reduce((sum, s) => sum + (s.id === 0 ? 0 : s.cargo + s.banked), 0))).toBe(true);
    expect(changed((w) => w.asteroids.reduce((sum, a) => sum + a.ore, 0))).toBe(true);
    // And at least one unscouted core is now telling a different story.
    const cores = (w: World): number[] => w.planets.filter((p) => p.owner !== 0).map((p) => p.coreHp);
    expect(cores(lied)).not.toEqual(cores(world));

    // Meanwhile the view a bot is *given* is unchanged — which is the whole
    // point: the lie lives entirely in the half of the world it cannot see.
    expect(perceive(lied, 0)).toEqual(perceive(world, 0));
  });
});
