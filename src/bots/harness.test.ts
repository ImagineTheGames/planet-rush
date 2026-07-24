/**
 * src/bots/harness.test.ts — bots fill the slots and speak the action stream.
 *
 * The day-2 harness contract (GDD §2.9, §4.2):
 *
 *   1. **Empty slots get a cast**, deterministically, in roster order, around
 *      whichever slots humans already hold.
 *   2. Each character brings its **hull** to the lobby row the sim builds from.
 *   3. Bots emit the **same `Action` stream a human does** — no bot branch
 *      inside the simulation.
 *   4. **Reaction cadence** is real: a bot holds its stream between decisions.
 *   5. An **eliminated** bot stops sending anything (GDD §2.7).
 *   6. The **do-nothing baseline does nothing** — a match of them is perfectly
 *      still, which is what makes it a baseline.
 *   7. The match loop **always terminates**: a hung match is a reported failure,
 *      not a hung harness (GDD §3.8).
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, TICK_DT, type World } from '../sim';
import { IDLE_ACTIONS, NO_ACTIONS, createBot, createDoNothingBot, doNothing } from './bot';
import {
  MATCH_SLOTS,
  botInputs,
  botLobby,
  createBots,
  fillEmptySlots,
  runHeadlessMatch,
  thinkOnce,
} from './harness';
import { Difficulty, PERSONALITIES, ROSTER } from './personalities';

/** The full offline match: eight slots, all bots (GDD §3.3). */
function allBotMatch(seed = 11): { world: World; bots: ReturnType<typeof createBots> } {
  const seats = fillEmptySlots();
  const world = createWorld({ seed, players: botLobby(seats) });
  return { world, bots: createBots(seats, { seed }) };
}

describe('harness — filling the lobby', () => {
  it('seats a bot in every empty slot, in roster order', () => {
    const seats = fillEmptySlots();
    expect(seats).toHaveLength(MATCH_SLOTS);
    expect(seats.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Seven characters, eight slots: the cast cycles rather than inventing one.
    expect(seats.map((s) => s.personality)).toEqual([...ROSTER, ROSTER[0]]);
  });

  it('fills around the humans, and is deterministic', () => {
    const seats = fillEmptySlots([0, 3]);
    expect(seats.map((s) => s.id)).toEqual([1, 2, 4, 5, 6, 7]);
    expect(seats).toEqual(fillEmptySlots([0, 3]));
    // A 3-human classroom match is still an 8-planet war (GDD §4.2).
    expect(fillEmptySlots([0, 1, 2])).toHaveLength(5);
  });

  it('gives every character its hull in the lobby row', () => {
    const seats = fillEmptySlots();
    const rows = botLobby(seats);
    expect(rows).toHaveLength(MATCH_SLOTS);
    for (const [i, row] of rows.entries()) {
      expect(row.id).toBe(seats[i]!.id);
      expect(row.shipClass).toBe(PERSONALITIES[seats[i]!.personality].shipClass);
    }
    // The four silhouettes all appear in a full house (style-guide §4).
    expect(new Set(rows.map((r) => r.shipClass)).size).toBe(4);
  });

  it('never claims a slot a human holds, even in a solo lobby', () => {
    expect(fillEmptySlots([7]).some((s) => s.id === 7)).toBe(false);
    expect(fillEmptySlots([], 1)).toEqual([{ id: 0, personality: ROSTER[0] }]);
  });
});

describe('harness — the action stream', () => {
  it('emits one row per bot, in the same shape a human input has', () => {
    const { world, bots } = allBotMatch();
    const inputs = botInputs(world, bots, TICK_DT);

    expect(inputs).toHaveLength(MATCH_SLOTS);
    expect(inputs.map((i) => i.id)).toEqual(bots.map((b) => b.seat.id));
    for (const row of inputs) {
      expect(row.actions).toEqual(IDLE_ACTIONS);
      // The seven abstract verbs and nothing else (GDD §2.4).
      for (const a of row.actions) expect(['thrust', 'aim', 'fire', 'build', 'buildOrder', 'boost', 'ping']).toContain(a.type);
    }
  });

  it('holds its stream between decisions — reaction time, as cadence', () => {
    const bot = createBot({ id: 0, personality: 'rusty' });
    expect(bot.difficulty).toBe(Difficulty.Easy);

    let decisions = 0;
    const tree = bot.decide;
    bot.decide = (view) => {
      decisions++;
      return tree(view);
    };

    const { world } = allBotMatch();
    // One second of 60 Hz ticks at an Easy bot's 6 Hz cadence.
    for (let i = 0; i < 60; i++) thinkOnce(world, bot, TICK_DT);
    expect(decisions).toBeGreaterThanOrEqual(5);
    expect(decisions).toBeLessThanOrEqual(7);
  });

  it('goes quiet when its match is over (GDD §2.7)', () => {
    const { world, bots } = allBotMatch();
    const bot = bots[2]!;
    world.ships[2]!.eliminated = true;
    world.ships[2]!.alive = false;

    // Force a decision this tick rather than waiting out the cadence.
    bot.sinceDecision = bot.reactionInterval;
    expect(thinkOnce(world, bot, TICK_DT)).toBe(NO_ACTIONS);
  });

  it('seeds every bot its own deterministic stream — never Math.random', () => {
    const seats = fillEmptySlots();
    const a = createBots(seats, { seed: 99 });
    const b = createBots(seats, { seed: 99 });
    const c = createBots(seats, { seed: 100 });

    expect(a.map((bot) => bot.rng.next())).toEqual(b.map((bot) => bot.rng.next()));
    expect(a[0]!.rng.next()).not.toBe(a[1]!.rng.next());
    expect(a[0]!.rng.next()).not.toBe(c[0]!.rng.next());
  });
});

describe('harness — the do-nothing baseline', () => {
  it('does nothing: eight bots, five hundred ticks, a perfectly still arena', () => {
    const seats = fillEmptySlots();
    const world = createWorld({ seed: 5, players: botLobby(seats) });
    const bots = seats.map((seat) => createDoNothingBot(seat));

    const before = world.ships.map((s) => ({ ...s.pos }));
    const ore = world.asteroids.reduce((sum, a) => sum + a.ore, 0);

    runHeadlessMatch(world, bots, { maxSeconds: 500 * TICK_DT });

    expect(world.ships.map((s) => ({ ...s.pos }))).toEqual(before);
    expect(world.asteroids.reduce((sum, a) => sum + a.ore, 0)).toBe(ore);
    expect(world.chunks).toHaveLength(0);
    expect(world.match.phase).toBe('live');
    expect(doNothing()).toBe(IDLE_ACTIONS);
  });

  it('runs the same match twice to the same state — bots are deterministic', () => {
    const run = () => {
      const { world, bots } = allBotMatch(3);
      runHeadlessMatch(world, bots, { maxSeconds: 200 * TICK_DT });
      return world;
    };
    expect(JSON.stringify(run())).toEqual(JSON.stringify(run()));
  });
});

describe('harness — the enforced timeout (GDD §3.8)', () => {
  it('stops a match that will not end, and says so', () => {
    const { world, bots } = allBotMatch();
    const result = runHeadlessMatch(world, bots, { maxSeconds: 1 });

    expect(result.timedOut).toBe(true);
    expect(result.ended).toBe(false);
    expect(result.winner).toBeNull();
    expect(result.ticks).toBe(60);
    expect(result.seconds).toBeGreaterThanOrEqual(1);
  });

  it('reports progress every tick for the QA harness to sample', () => {
    const { world, bots } = allBotMatch();
    const seen: number[] = [];
    runHeadlessMatch(world, bots, { maxSeconds: 5 * TICK_DT, onTick: (_, tick) => seen.push(tick) });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('merges caller inputs alongside the bots — one code path for humans', () => {
    const seats = fillEmptySlots([0]);
    const players = [{ id: 0, shipClass: ShipClass.Vanguard }, ...botLobby(seats)];
    const world = createWorld({ seed: 2, players });
    const bots = createBots(seats);

    runHeadlessMatch(world, bots, {
      maxSeconds: 30 * TICK_DT,
      extraInputs: () => [{ id: 0, actions: [{ type: 'thrust', dir: { x: 1, y: 0 } }] }],
    });

    // The human moved; every bot stayed exactly where it spawned.
    expect(world.ships[0]!.pos.x).toBeGreaterThan(world.ships[0]!.home.x);
    for (const ship of world.ships.slice(1)) expect(ship.pos).toEqual(ship.home);
  });
});
