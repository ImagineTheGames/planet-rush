/**
 * src/sim/outcome.test.ts — what the sim declares when nobody is left standing
 * (GDD §1, a0-113). OWNER: Gameplay Engineer.
 *
 * ── a0-113: EIGHT DEAD REACTORS AND THE GAME NAMED A WINNER ─────────────────
 * QA set out to photograph all four end-of-match outcomes and could produce
 * three. They killed every seat in one call — eight `damageCore(p, 999)`, drained
 * FIFO inside a single tick — read the core HP back as `0,0,0,0,0,0,0,0`, and the
 * screen over that world said **DEFEAT**, subhead *"Player 8 won."* The last seat
 * in the list. Not the last seat to *fight*: the last seat the debug queue
 * happened to reach.
 *
 * That was `resolveWinner`'s no-survivor branch handing the match to
 * `lastToDie(match.eliminated)` — the final entry of an order appended to as each
 * core hits zero *within* a tick. A fixed-timestep sim has no time inside a tick;
 * that order is projectile-array and station-array index, nothing a player did.
 *
 * The branch fires only when the last two or more teams die on the same tick
 * (`resolveWinner` runs every step and latches, so the surviving-team count can
 * never walk 1 → 0), which makes it the whole of the simultaneous-death case
 * rather than a corner of it. Deaths in the same tick are simultaneous, so the
 * match is a **draw** — `winner === null`, which is the state `endKind` has always
 * read as `DRAW` and which nothing could reach until now.
 *
 * What must NOT change: a survivor, by even one tick, still wins outright — in
 * TEAMS too, where a side lives while any ally's core stands (a0-09).
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, damageStation, step, type World } from './index';
import { COLLAPSE_CORE_DECAY, CORE_HP, TICK_DT } from './constants';

// --- fixtures --------------------------------------------------------------

/** A real world off the shipped map, with spawn protection cleared so a test can
 *  reach the cores on tick one (`damageStation` refuses a protected station). */
function arena(n: number, teamOf?: (i: number) => number): World {
  const players = Array.from({ length: n }, (_, i) => ({
    id: i,
    shipClass: ShipClass.Vanguard,
    ...(teamOf ? { team: teamOf(i) } : {}),
  }));
  const world = createWorld({ seed: 113, players });
  for (const station of world.stations) station.spawnProtect = 0;
  for (const ship of world.ships) ship.spawnProtect = 0;
  return world;
}

/** Zero a core outright, the way QA's `damageCore(p, 999)` does. */
const kill = (world: World, slot: number) => {
  const station = world.stations.find((s) => s.owner === slot)!;
  damageStation(world, station, station.coreHp + station.shields.reduce((n, s) => n + s.hp, 0));
};

// --- the draw --------------------------------------------------------------

describe('a draw that can occur (GDD §1, a0-113)', () => {
  it('every seat dying on the same tick is a draw', () => {
    // QA's experiment, exactly: eight lethal hits queued in one call, drained
    // inside a single tick, every reactor at zero when the tick ends.
    const world = arena(8);
    for (let slot = 0; slot < 8; slot++) kill(world, slot);
    step(world, []);

    expect(world.stations.map((s) => s.coreHp)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(world.match.eliminated).toHaveLength(8);
    expect(world.match.phase).toBe('ended');
    // Nobody outlived anybody. The screen must not name the last seat in the list.
    expect(world.match.winner).toBeNull();
    expect(world.match.winningTeam).toBeNull();
  });

  it('two seats destroying each other on the same tick is a draw', () => {
    // The real one: a two-seat endgame finishing by mutual destruction — both
    // shots already in the air, both landing on the same tick.
    const world = arena(2);
    kill(world, 1);
    kill(world, 0);
    step(world, []);

    expect(world.match.eliminated).toEqual([1, 0]);
    expect(world.match.phase).toBe('ended');
    expect(world.match.winner).toBeNull();
    expect(world.match.winningTeam).toBeNull();
    expect(world.match.endTime).toBeCloseTo(world.time, 9);
  });

  it('the draw does not depend on which core the tick resolved first', () => {
    // The old rule reversed the result when the deaths reversed; nothing a player
    // did changed between these two worlds, so nothing about the result may either.
    const forward = arena(2);
    kill(forward, 0);
    kill(forward, 1);
    step(forward, []);

    const reversed = arena(2);
    kill(reversed, 1);
    kill(reversed, 0);
    step(reversed, []);

    expect(forward.match.eliminated).toEqual([0, 1]);
    expect(reversed.match.eliminated).toEqual([1, 0]);
    expect(forward.match.winner).toBeNull();
    expect(reversed.match.winner).toBeNull();
  });

  it('collapse taking the last cores together is a draw', () => {
    // The measured case (docs/design-amendments.md §"Balance note"): identical
    // cores enter collapse in lockstep and entropy finishes them on one tick.
    const world = arena(2);
    world.match.collapseTime = world.time;
    world.match.phase = 'collapse';
    for (const station of world.stations) station.coreHp = COLLAPSE_CORE_DECAY * TICK_DT;

    step(world, []);

    expect(world.stations.every((s) => !s.alive)).toBe(true);
    expect(world.match.phase).toBe('ended');
    expect(world.match.winner).toBeNull();
  });

  it('a draw ends the match once and is never re-decided', () => {
    const world = arena(2);
    kill(world, 0);
    kill(world, 1);
    step(world, []);
    const endTime = world.match.endTime;

    for (let t = 0; t < 30; t++) step(world, []);
    expect(world.match.winner).toBeNull();
    expect(world.match.phase).toBe('ended');
    expect(world.match.endTime).toBe(endTime);
  });
});

// --- what a draw must not swallow ------------------------------------------

describe('a survivor still wins outright (GDD §1)', () => {
  it('one tick of life is enough — the seat that outlives the other wins', () => {
    const world = arena(2);
    kill(world, 0);
    step(world, []);

    expect(world.match.phase).toBe('ended');
    expect(world.match.winner).toBe(1);
    expect(world.match.winningTeam).toBe(1);

    // …and the survivor's own core falling afterwards cannot turn it into a draw.
    kill(world, 1);
    step(world, []);
    expect(world.match.winner).toBe(1);
  });

  it('seven of eight down and one core standing is a victory, not a draw', () => {
    const world = arena(8);
    for (let slot = 0; slot < 7; slot++) kill(world, slot);
    step(world, []);

    expect(world.match.phase).toBe('ended');
    expect(world.match.winner).toBe(7);
    expect(world.match.eliminated).toHaveLength(7);
  });
});

// --- TEAMS: the ally path (a0-09, Task D1) ---------------------------------

describe('teams resolve the same way (Task D1)', () => {
  const sides = (i: number) => i % 2;

  it("both sides' last cores dying on one tick is a draw", () => {
    const world = arena(4, sides); // slots 0,2 on side 0; slots 1,3 on side 1
    kill(world, 1);
    kill(world, 3); // side 1 is out…
    kill(world, 0);
    kill(world, 2); // …and side 0 goes with it, same tick
    step(world, []);

    expect(world.match.eliminated).toEqual([1, 3, 0, 2]);
    expect(world.match.phase).toBe('ended');
    expect(world.match.winner).toBeNull();
    expect(world.match.winningTeam).toBeNull();
  });

  it('an ally still holding a core wins the match for its side, draw or no draw', () => {
    const world = arena(4, sides);
    kill(world, 1);
    kill(world, 3); // side 1 is out
    kill(world, 0); // side 0 loses a home but slot 2 still stands
    step(world, []);

    expect(world.match.phase).toBe('ended');
    expect(world.match.winningTeam).toBe(0);
    expect(world.match.winner).toBe(2);
  });
});

// --- the constant the fixtures lean on -------------------------------------

it('a stock core is worth killing in one hit in these fixtures', () => {
  // Guards the `kill` helper: if CORE_HP ever stops being the whole of a fresh
  // core's health the same-tick tests would stop being same-tick.
  const world = arena(2);
  expect(world.stations[0]!.coreHp).toBe(CORE_HP);
});
