/**
 * src/bots/match-endgame.test.ts — the seed of the QA harness (GDD §3.8).
 *
 * **A headless eight-slot match of do-nothing bots reaches a win state.** That
 * is the day-2 claim, and it is a bigger claim than it sounds: it says the
 * ending is *structural* — waves land, the field closes, collapse arrives, and
 * a winner is declared — rather than something the players have to do to each
 * other. Eight bots that never touch a control are the strongest possible test
 * of that, because they contribute nothing at all.
 *
 * ### Why the constants are mocked
 *
 * At the shipped baseline a match of do-nothing bots **cannot** end, and that is
 * deliberate: `COLLAPSE_CORE_DECAY` is `0`, because GDD §2.3 spells collapse out
 * as exactly three rules — no shield regeneration, no repair, no new ore — and a
 * fourth is a design decision, not a tuning one. The sim implements the decay
 * mechanism and leaves the knob at zero precisely so someone can falsify the
 * stalemate hypothesis by raising it (see `src/sim/constants.ts`).
 *
 * This file is that someone. It runs the real simulation, the real harness, and
 * the real bots against an **accelerated tuning** — one wave, a two-second
 * collapse grace, entropy switched on — so a full match resolves in a few
 * hundred milliseconds of a unit-test run. Nothing in `src/sim/` is edited; the
 * constants table is QA's from M2 onward, and mocking it here is how this agent
 * asks a question of it without touching it.
 *
 * The bots' side of the loop is completely unaccelerated: same perception, same
 * cadence, same action stream.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../sim/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sim/constants')>();
  return {
    ...actual,
    /** One wave, so the metronome finishes immediately. */
    WAVE_COUNT: 1,
    /** Nobody mines it out, so collapse comes from the backstop — two seconds
     *  after the last wave instead of `WAVE_INTERVAL_S`. */
    COLLAPSE_GRACE_S: 2,
    /** Entropy, switched on: "entropy finishes whoever the players don't"
     *  (GDD §1). 40 HP/s eats a 100 HP core in 2.5 s. */
    COLLAPSE_CORE_DECAY: 40,
    /** Spawn protection out of the way of a seconds-long match. */
    SPAWN_PROTECTION_S: 1,
  };
});

import { createWorld, type World } from '../sim';
import { botLobby, fillEmptySlots, runHeadlessMatch } from './harness';
import { createDoNothingBot, type Bot } from './bot';

/**
 * The offline match a solo player gets: eight planets, a full cast, no humans
 * (GDD §3.3) — with a small field, because nobody is going to mine it.
 *
 * **The cast runs the do-nothing baseline on purpose** (`./bot`). Day 4 gave the
 * seven characters real Easy/Medium/Hard trees, and a match of those ends too
 * (`./trees.test.ts` asserts it) — but it ends partly because the bots did
 * something to each other, which is a *weaker* claim than the one this file
 * makes. Eight players who never touch a control are the strongest possible test
 * that the ending is structural: waves land, the field closes, collapse arrives,
 * a winner is declared, and none of it needed a player.
 */
function accelerated(seed = 42): { world: World; bots: Bot[] } {
  const seats = fillEmptySlots();
  const world = createWorld({ seed, players: botLobby(seats), asteroidCount: 6 });
  return { world, bots: seats.map((seat) => createDoNothingBot(seat, { seed })) };
}

describe('an eight-slot bot match reaches a win state', () => {
  it('runs to a winner with a survivor, and nobody ever touched a control', () => {
    const { world, bots } = accelerated();
    expect(world.planets).toHaveLength(8);
    expect(bots).toHaveLength(8);

    // One home built to outlast the collapse, so the match ends the ordinary
    // way — seven eliminations and a survivor — rather than in a mutual
    // extinction resolved by the tiebreak (that is the next test).
    const tough = world.planets[3]!;
    tough.coreHp = 400;
    tough.maxCoreHp = 400;

    const spawn = world.ships.map((s) => ({ ...s.pos }));
    const result = runHeadlessMatch(world, bots, { maxSeconds: 120 });

    expect(result.timedOut).toBe(false);
    expect(result.ended).toBe(true);
    expect(result.world.match.phase).toBe('ended');
    expect(result.winner).toBe(tough.owner);
    expect(result.world.match.endTime).toBeGreaterThan(0);
    expect(result.ticks).toBeGreaterThan(0);

    // The ending was structural: the field ran out, collapse arrived, and
    // entropy did the rest. No bot moved a single unit to make it happen.
    expect(result.world.match.collapseTime).toBeGreaterThanOrEqual(0);
    expect(result.world.match.eliminated).toHaveLength(7);
    expect(world.ships.map((s) => ({ ...s.pos }))).toEqual(spawn);
  });

  it('resolves a mutual extinction by last-to-die (GDD §1)', () => {
    const { world, bots } = accelerated(7);
    const result = runHeadlessMatch(world, bots, { maxSeconds: 120 });

    expect(result.ended).toBe(true);
    expect(result.timedOut).toBe(false);
    // Eight identical cores under identical entropy die in the same tick, so
    // there is no survivor to crown and the tiebreak decides.
    const order = result.world.match.eliminated;
    expect(order).toHaveLength(8);
    expect(result.winner).toBe(order[order.length - 1]);
    expect(world.ships.every((s) => s.eliminated)).toBe(true);
  });

  it('lands inside the timeout with room to spare — no hung harness', () => {
    const { world, bots } = accelerated(3);
    const result = runHeadlessMatch(world, bots, { maxSeconds: 120 });
    expect(result.seconds).toBeLessThan(60);
  });

  it('replays identically: same seed, same match, same winner', () => {
    const run = () => {
      const { world, bots } = accelerated(21);
      return runHeadlessMatch(world, bots, { maxSeconds: 120 });
    };
    const a = run();
    const b = run();
    expect(a.winner).toBe(b.winner);
    expect(a.ticks).toBe(b.ticks);
    expect(JSON.stringify(a.world)).toEqual(JSON.stringify(b.world));
  });
});
