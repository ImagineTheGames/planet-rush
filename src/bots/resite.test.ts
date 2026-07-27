/**
 * src/bots/resite.test.ts — threat-aware mining-site selection and the
 * contested-site tabu. OWNER: Bot Engineer (p11 field report).
 *
 * > A low-HP enemy got stuck between going to mine and being scared of my ship
 * > in its path… there were other places to mine… it just kept going back and
 * > forth.
 *
 * That evades both existing guards — it is not a state flip (the flee/fight
 * hysteresis holds; `commitment.test.ts`) and not a wedge (the ship moves;
 * `unstuck.test.ts`). It is re-choosing the same bad *goal* forever. The two
 * fixes are unit-tested here; the standing "it never happens over a whole match"
 * gate is `tests/harness/oscillation.test.ts`.
 *
 *  1. **Threat-aware scoring** — a site whose approach crosses a hostile scores
 *     worse than a clean farther one, so the developer's scenario picks the
 *     other field on the first decision.
 *  2. **Contested-site tabu** — a site whose approach a retreat broke off is
 *     excluded until its cool-down lifts; the bot commits to the next-best
 *     field, and the site returns once the threat (and the clock) have moved on.
 *
 * And the two properties the fix must not have broken: a wounded bot with a
 * threat on it still *retreats* rather than mines (flee outranks the economy,
 * p5-04 untouched), and every read is a pure, deterministic function of the view.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { SPAWN_PROTECTION_S, TICK_DT, WAVE_COUNT, createWorld, step, type Asteroid, type World } from '../sim';
import { perceive } from './perception';
import { PERSONALITIES } from './personalities';
import { bestRock } from './targeting';
import { MINE_STANDOFF, TABU_SECONDS, wantsRetreat } from './behaviors';
import { botInputs, createBots } from './harness';
import { hardTree } from './hard';
import { context, createBrain, runTree } from './tree';
import type { BotCtx } from './tree';

/** A rock at a position, same ore payout for every one unless a radius is given
 *  — so a test isolates *where* a rock is from *how rich* it is. */
function rock(id: number, x: number, y: number, radius = 34): Asteroid {
  return {
    id,
    pos: { x, y },
    radius,
    ore: 10,
    maxOre: 10,
    crackStage: 0,
    mineBuffer: 0,
    home: null,
  };
}

/** A rock-free, spawn-protection-free board with the four homes flung to the
 *  corners, so the only asteroids and the only ships in play are the ones a test
 *  places by hand. */
function board(): World {
  const world = createWorld({
    seed: 5,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Interceptor },
      { id: 2, shipClass: ShipClass.Vanguard },
      { id: 3, shipClass: ShipClass.Vanguard },
    ],
    bounds: { width: 6000, height: 6000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 5;
  for (const ship of world.ships) {
    ship.spawnProtect = 0;
    // Everyone but the two ships a test drives is parked far out of sight, so it
    // neither enters the view nor sits on anybody's approach path.
    if (ship.id >= 2) ship.pos = { x: -3000, y: -3000 };
  }
  for (const planet of world.planets) {
    planet.spawnProtect = 0;
    planet.sinceDamage = 999;
  }
  return world;
}

/** A decision context over this board for slot `id`. */
function ctxOf(world: World, id = 0, personality: keyof typeof PERSONALITIES = 'foreman'): BotCtx {
  const brain = createBrain(PERSONALITIES[personality], { next: () => 0.5 });
  return context(perceive(world, id), brain);
}

describe('threat-aware site scoring (p11 point 1)', () => {
  it('picks a clean farther field over a nearer one with a hostile on the path', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    // A: nearer, due east. B: farther, due west — same ore.
    world.asteroids.push(rock(100, 2500, 2000)); // dA = 500
    world.asteroids.push(rock(200, 1440, 2000)); // dB = 560

    // With the path clear, the bot takes the nearer rock — the plain payout pick.
    expect(bestRock(ctxOf(world))!.id).toBe(100);

    // Now park a hostile deep on the eastward run to A (400 units out, dead on
    // the line), well clear of the westward run to B.
    world.ships[1]!.pos = { x: 2400, y: 2000 };
    expect(bestRock(ctxOf(world))!.id).toBe(200);
  });

  it('leaves the pick unmoved by a hostile that is not on any approach', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.asteroids.push(rock(100, 2500, 2000));
    world.asteroids.push(rock(200, 1440, 2000));
    // A hostile off to the far south — in view, but nowhere near either corridor.
    world.ships[1]!.pos = { x: 2000, y: 2650 };
    expect(bestRock(ctxOf(world))!.id).toBe(100);
  });
});

describe('contested-site tabu (p11 point 2)', () => {
  it('excludes a cooled site and commits to the next-best field', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.asteroids.push(rock(100, 2300, 2000)); // nearer
    world.asteroids.push(rock(200, 2000, 2450)); // farther

    const clean = ctxOf(world);
    expect(bestRock(clean)!.id).toBe(100);

    // Book the nearer rock tabu on a fresh brain and it drops out of the running.
    const cooled = ctxOf(world);
    cooled.brain.tabu.set(100, cooled.view.time + TABU_SECONDS);
    expect(bestRock(cooled)!.id).toBe(200);
  });

  it('re-allows the site once the cool-down lifts (threat left, clock moved on)', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.asteroids.push(rock(100, 2300, 2000));
    world.asteroids.push(rock(200, 2000, 2450));

    const brain = createBrain(PERSONALITIES.foreman, { next: () => 0.5 });
    const cooledUntil = world.time + TABU_SECONDS;
    // While the cool-down is live the site is excluded…
    let ctx = context(perceive(world, 0), brain);
    ctx.brain.tabu.set(100, cooledUntil);
    expect(bestRock(ctx)!.id).toBe(200);

    // …and once the sim clock passes it, the next decision prunes the entry and
    // the nearer rock is a candidate again (the same brain across the two ticks).
    world.time = cooledUntil + 0.5;
    ctx = context(perceive(world, 0), brain);
    expect(bestRock(ctx)!.id).toBe(100);
    expect(ctx.brain.tabu.has(100)).toBe(false);
  });

  it('books the site a retreat broke off — and only when it broke off mining', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.ships[0]!.hull = world.ships[0]!.maxHull * 0.05; // under any tier's nerve
    world.asteroids.push(rock(100, 2300, 2000));
    world.asteroids.push(rock(200, 2000, 2450));
    // A live threat right on top of it — inside the break-off band.
    world.ships[1]!.pos = { x: 2150, y: 2000 };
    world.ships[1]!.firing = true;

    const ctx = ctxOf(world);
    // The bot was mining rock 100 last decision when the threat closed.
    ctx.brain.mineSite = 100;
    ctx.brain.lastBehavior = 'mine';

    expect(wantsRetreat(ctx)).toBe(true);
    expect(ctx.brain.tabu.has(100)).toBe(true);
    // And with 100 now cooled, the very next site pick is the other field.
    expect(bestRock(ctx)!.id).toBe(200);
  });

  it('does not tabu a rock when the retreat broke off something else', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.ships[0]!.hull = world.ships[0]!.maxHull * 0.05;
    world.asteroids.push(rock(100, 2300, 2000));
    world.ships[1]!.pos = { x: 2150, y: 2000 };

    const ctx = ctxOf(world);
    // `mineSite` is stale from an earlier errand, but the last thing the bot did
    // was fight, not mine — so a break-off must not cool a rock it wasn't on.
    ctx.brain.mineSite = 100;
    ctx.brain.lastBehavior = 'attack';

    expect(wantsRetreat(ctx)).toBe(true);
    expect(ctx.brain.tabu.has(100)).toBe(false);
  });
});

describe('the fix leaves flee priority and determinism intact', () => {
  it('a wounded bot with a threat retreats rather than mines (p5-04 untouched)', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.ships[0]!.hull = world.ships[0]!.maxHull * 0.1;
    // A rich rock right there to tempt it, and a threat on it.
    world.asteroids.push(rock(100, 2200, 2000, 46));
    world.ships[1]!.pos = { x: 2150, y: 2000 };
    world.ships[1]!.firing = true;

    const ctx = ctxOf(world, 0, 'sable');
    runTree(hardTree, ctx);
    expect(ctx.brain.lastBehavior).toBe('retreat');
  });

  it('bestRock is a pure function of the view — same context, same rock', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.ships[1]!.pos = { x: 2400, y: 2000 };
    world.asteroids.push(rock(100, 2500, 2000));
    world.asteroids.push(rock(200, 1440, 2000));

    const a = bestRock(ctxOf(world));
    const b = bestRock(ctxOf(world));
    expect(a!.id).toBe(b!.id);
    // And two reads off the *same* context never disagree either.
    const ctx = ctxOf(world);
    expect(bestRock(ctx)!.id).toBe(bestRock(ctx)!.id);
  });
});

describe('the scenario, driven end to end (p11 point 4)', () => {
  it('re-sites to the clean field and arrives, threat left standing on the near path', () => {
    const world = createWorld({
      seed: 7,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        // The threat flies the tankiest, least-punishable hull and — below —
        // sits on its own doorstep, so it is a genuine hazard on the path but not
        // a target worth abandoning the economy for. The bot mines, it doesn't
        // wheel off to fight it.
        { id: 1, shipClass: ShipClass.Hauler },
      ],
      bounds: { width: 2400, height: 2400 },
      asteroidCount: 0,
    });
    world.time = SPAWN_PROTECTION_S + 5;
    world.match.wavesSpawned = WAVE_COUNT;

    const self = world.ships[0]!;
    const threat = world.ships[1]!;
    self.pos = { x: 1200, y: 1200 };
    self.vel = { x: 0, y: 0 };
    self.hull = self.maxHull * 0.25; // hurt, but above any tier's break-off nerve
    self.spawnProtect = 0;

    // The near field (east) and a same-ore clean field (west), each ~530 out.
    const A = { x: 1730, y: 1200 };
    const B = { x: 670, y: 1200 };
    // The threat parks dead on the eastward run to A — well past the bot's own
    // break-off range, so the bot re-sites rather than flees — and on its own
    // planet, so it reads as defended, not exposed.
    const threatPos = { x: 1680, y: 1200 };
    world.planets[0]!.pos = { x: 220, y: 220 }; // the bot's home, out of the way
    world.planets[1]!.pos = { x: threatPos.x, y: threatPos.y };
    for (const planet of world.planets) {
      planet.spawnProtect = 0;
      planet.sinceDamage = 999;
    }

    const [bot] = createBots([{ id: 0, personality: 'sable' }], { seed: 7 });

    const distTo = (p: { x: number; y: number }): number =>
      Math.sqrt((self.pos.x - p.x) ** 2 + (self.pos.y - p.y) ** 2);
    let closestB = distTo(B);
    let closestA = distTo(A);

    for (let i = 0; i < 500; i++) {
      // Hold the field to exactly the two rocks, both full — no wave lands to
      // muddy the choice, and neither rock empties out from under the bot mid-run.
      world.asteroids.length = 0;
      world.asteroids.push(rock(100, A.x, A.y), rock(200, B.x, B.y));
      // The threat is a fixed hazard: pinned in place, whole, engageable.
      threat.pos = { x: threatPos.x, y: threatPos.y };
      threat.vel = { x: 0, y: 0 };
      threat.hull = threat.maxHull;
      threat.spawnProtect = 0;
      step(world, botInputs(world, [bot!], TICK_DT), TICK_DT);
      closestB = Math.min(closestB, distTo(B));
      closestA = Math.min(closestA, distTo(A));
    }

    // It flew to the clean western field and reached mining range of it (a shade
    // over the standoff a miner parks at), and it never once approached the
    // contested eastern rock — the whole point of the re-site.
    expect(closestB).toBeLessThan(MINE_STANDOFF + 60);
    expect(closestA).toBeGreaterThan(400);
  });
});
