/**
 * tests/sim/allegiance.test.ts — the ONE friend/foe predicate
 * (docs/variable-slots-plan.md, Task A3). OWNER: Gameplay Engineer.
 *
 * `areEnemies` replaces seven inlined `id === owner` checks across projectiles,
 * buildings, and step (spike §3). Two things are pinned:
 *
 *   1. the predicate itself — `a !== b` in FFA (teams-of-one), and same-team
 *      friends / cross-team foes in a hand-built 2-team world, with a player
 *      never their own enemy;
 *   2. that the routing actually took at a real combat site — friendly fire is
 *      OFF (ratified 2026-07-26), so a shot passes THROUGH an ally and lands on
 *      the enemy behind it, exactly as it always passed over its own hull.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  createWorld,
  configToPlayers,
  areEnemies,
  teamOf,
  fireShipProjectile,
  step,
  ffaConfig,
  SHIP_RADIUS,
  shipCargoCap,
  shipMaxHull,
  stockTiers,
  type Ship,
  type World,
  type MatchConfig,
} from '../../src/sim';
import { normalize } from '../../src/sim/vec';

/** A 2v2 lobby: slots 0,1 on team 0; slots 2,3 on team 1. */
const TWO_V_TWO: MatchConfig = {
  mode: 'teams',
  slots: [0, 0, 1, 1].map((team, index) => ({
    index,
    state: 'open',
    shipClass: ShipClass.Vanguard,
    team,
  })),
};

describe('A3 — areEnemies: FFA is teams-of-one', () => {
  it('every distinct pair is an enemy, and nobody is their own enemy', () => {
    const w = createWorld({ seed: 1, players: configToPlayers(ffaConfig(4, ShipClass.Vanguard)) });
    expect(areEnemies(w, 0, 1)).toBe(true);
    expect(areEnemies(w, 1, 3)).toBe(true);
    expect(areEnemies(w, 2, 0)).toBe(true);
    expect(areEnemies(w, 0, 0)).toBe(false);
    expect(areEnemies(w, 3, 3)).toBe(false);
  });

  it('teamOf is each player\'s own id in FFA', () => {
    const w = createWorld({ seed: 2, players: configToPlayers(ffaConfig(3, ShipClass.Vanguard)) });
    expect([0, 1, 2].map((id) => teamOf(w, id))).toEqual([0, 1, 2]);
  });
});

describe('A3 — areEnemies: TEAMS groups allies', () => {
  it('same-team is friend, cross-team is foe, self is never a foe', () => {
    const w = createWorld({ seed: 3, players: configToPlayers(TWO_V_TWO) });
    // Allies.
    expect(areEnemies(w, 0, 1)).toBe(false);
    expect(areEnemies(w, 2, 3)).toBe(false);
    // Foes.
    expect(areEnemies(w, 0, 2)).toBe(true);
    expect(areEnemies(w, 1, 3)).toBe(true);
    expect(areEnemies(w, 3, 0)).toBe(true);
    // Self.
    expect(areEnemies(w, 1, 1)).toBe(false);
  });

  it('teamOf reads the shared team off each ship', () => {
    const w = createWorld({ seed: 4, players: configToPlayers(TWO_V_TWO) });
    expect([0, 1, 2, 3].map((id) => teamOf(w, id))).toEqual([0, 0, 1, 1]);
  });
});

// --- friendly fire OFF at a real combat site (routing regression) -----------

function makeShip(id: number, team: number, x: number): Ship {
  const loadout = { shipClass: ShipClass.Vanguard, tiers: stockTiers() };
  return {
    id,
    shipClass: ShipClass.Vanguard,
    team,
    tiers: loadout.tiers,
    pos: { x, y: 1000 },
    vel: { x: 0, y: 0 },
    home: { x, y: 1000 },
    angle: 0,
    hull: shipMaxHull(loadout),
    maxHull: shipMaxHull(loadout),
    cargo: 0,
    cargoCap: shipCargoCap(loadout),
    banked: 0,
    alive: true,
    respawnTimer: 0,
    spawnProtect: 0,
    eliminated: false,
    radius: SHIP_RADIUS,
    firing: false,
    weaponCooldown: 0,
  };
}

function emptyWorld(ships: Ship[]): World {
  return {
    time: 0,
    tick: 0,
    rngState: 1,
    nextEntityId: 1000,
    ships,
    asteroids: [],
    chunks: [],
    planets: [],
    projectiles: [],
    bounds: { width: 4000, height: 4000 },
    fieldRadius: 600,
    asteroidsPerWave: 0,
    match: { phase: 'live', wavesSpawned: 0, collapseTime: -1, eliminated: [], winner: null, endTime: -1 },
  };
}

describe('A3 — friendly fire OFF: a ship shot passes through an ally, lands on the foe', () => {
  it('an ally directly in the line of fire is not hit; the enemy behind it is', () => {
    const shooter = makeShip(0, /*team*/ 0, 1000);
    const ally = makeShip(1, /*team*/ 0, 1130); // same team, in the path
    const enemy = makeShip(2, /*team*/ 1, 1250); // foe, just behind the ally
    const world = emptyWorld([shooter, ally, enemy]);

    fireShipProjectile(world, shooter, normalize({ x: 1, y: 0 }));

    const allyBefore = ally.hull;
    const enemyBefore = enemy.hull;
    for (let t = 0; t < 60; t++) step(world, []);

    expect(ally.hull).toBe(allyBefore); // friendly fire is off — the shot flew over the ally
    expect(enemy.hull).toBeLessThan(enemyBefore); // and struck the foe behind it
  });

  it('the same shot DOES hit when the middle ship is an enemy (control)', () => {
    const shooter = makeShip(0, /*team*/ 0, 1000);
    const foe = makeShip(1, /*team*/ 1, 1130); // now a foe — should eat the shot
    const behind = makeShip(2, /*team*/ 1, 1250);
    const world = emptyWorld([shooter, foe, behind]);

    fireShipProjectile(world, shooter, normalize({ x: 1, y: 0 }));

    const foeBefore = foe.hull;
    const behindBefore = behind.hull;
    for (let t = 0; t < 60; t++) step(world, []);

    expect(foe.hull).toBeLessThan(foeBefore); // the nearer foe is hit first
    expect(behind.hull).toBe(behindBefore); // you cannot shoot through a body
  });
});
