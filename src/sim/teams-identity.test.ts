/**
 * src/sim/teams-identity.test.ts — TEAMS honours team identity everywhere the
 * intercept/priority ladder runs (developer report p14 "TEAMS doesn't feel like
 * teams"). OWNER: Gameplay Engineer.
 *
 * Teams landed as economy/elimination (n1-04) with the one `areEnemies`
 * predicate, but the developer reported it still played like a free-for-all:
 * "I can't tell who my teammates are and I seem to be attacking everyone and
 * vice versa. We should also spawn close together if we are teams." Four sim
 * guarantees are pinned here so it can never silently regress:
 *
 *  1. The allegiance gate (`areEnemies`/`canDamage`) reads TEAM, not just self.
 *  2. Targeting never LOCKS a teammate — auto-aim and turrets alike.
 *  3. NO FRIENDLY FIRE (ratified default): a teammate's shot does zero damage to
 *     an ally, and a shot through an ally still bites the enemy behind it.
 *  4. Teammates SPAWN TOGETHER — same-team homes are adjacent on every map, and
 *     the clusters stay equidistant across teams on the symmetric layouts.
 *
 * Bot targeting and the Tap Commander pilot live in other lanes (`src/bots`,
 * `src/platform`); they consume this same `areEnemies` contract, so the gate
 * itself is pinned here and their integration is proven in their own suites.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  createWorld,
  configToPlayers,
  ffaConfig,
  fireShipProjectile,
  step,
  areEnemies,
  canDamage,
  teamOf,
  FRIENDLY_FIRE,
  MAPS,
  getMap,
  type Inputs,
  type MiningStation,
  type PlayerSpec,
  type Ship,
  type Turret,
  type World,
} from './index';
import { CORE_HP, STATION, SHIELD, SHIP_RADIUS, TURRET } from './constants';
import { shipCargoCap, shipMaxHull, stockTiers } from './upgrades';
import { normalize } from './vec';

// --- compact self-contained fixtures (no ring layout, no asteroids) --------

function makeShip(over: Partial<Ship> & Pick<Ship, 'id'>): Ship {
  const cls = over.shipClass ?? ShipClass.Vanguard;
  const loadout = { shipClass: cls, tiers: over.tiers ?? stockTiers() };
  return {
    id: over.id,
    shipClass: cls,
    team: over.team ?? over.id,
    tiers: loadout.tiers,
    pos: over.pos ?? { x: 0, y: 0 },
    vel: over.vel ?? { x: 0, y: 0 },
    home: over.home ?? { x: 0, y: 0 },
    angle: over.angle ?? 0,
    hull: over.hull ?? shipMaxHull(loadout),
    maxHull: over.maxHull ?? shipMaxHull(loadout),
    cargo: over.cargo ?? 0,
    cargoCap: over.cargoCap ?? shipCargoCap(loadout),
    banked: over.banked ?? 0,
    alive: over.alive ?? true,
    respawnTimer: over.respawnTimer ?? 0,
    spawnProtect: over.spawnProtect ?? 0,
    eliminated: over.eliminated ?? false,
    radius: over.radius ?? SHIP_RADIUS,
    firing: over.firing ?? false,
    weaponCooldown: over.weaponCooldown ?? 0,
  };
}

function makeTurret(over: Partial<Turret> & Pick<Turret, 'id' | 'owner' | 'pos'>): Turret {
  return {
    id: over.id,
    owner: over.owner,
    slot: over.slot ?? 0,
    pos: over.pos,
    radius: over.radius ?? TURRET.radius,
    hp: over.hp ?? TURRET.hp,
    maxHp: over.maxHp ?? TURRET.hp,
    angle: over.angle ?? 0,
    cooldown: over.cooldown ?? 0,
    targetId: over.targetId ?? null,
    muzzle: over.muzzle ?? null,
  };
}

function makeStation(over: Partial<MiningStation> & Pick<MiningStation, 'id' | 'owner' | 'pos'>): MiningStation {
  return {
    id: over.id,
    owner: over.owner,
    team: over.team ?? over.owner,
    pos: over.pos,
    radius: over.radius ?? STATION.radius,
    coreHp: over.coreHp ?? CORE_HP,
    maxCoreHp: over.maxCoreHp ?? CORE_HP,
    alive: over.alive ?? true,
    deathTime: over.deathTime ?? -1,
    spawnProtect: over.spawnProtect ?? 0,
    angle: over.angle ?? 0,
    sinceDamage: over.sinceDamage ?? SHIELD.regenDelay,
    repairing: over.repairing ?? false,
    repairCooldown: over.repairCooldown ?? 0,
    repairGate: over.repairGate ?? 0,
    turrets: over.turrets ?? [],
    shields: over.shields ?? [],
    satellites: over.satellites ?? [],
    builds: over.builds ?? [],
  };
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    time: 0,
    tick: 0,
    rngState: 1,
    nextEntityId: 1000,
    ships: over.ships ?? [],
    asteroids: over.asteroids ?? [],
    chunks: over.chunks ?? [],
    stations: over.stations ?? [],
    projectiles: over.projectiles ?? [],
    bounds: over.bounds ?? { width: 4000, height: 4000 },
    fieldRadius: over.fieldRadius ?? 600,
    asteroidsPerWave: over.asteroidsPerWave ?? 0,
    match: over.match ?? {
      phase: 'live',
      wavesSpawned: 0,
      collapseTime: -1,
      eliminated: [],
      winner: null,
      endTime: -1,
    },
  };
}

/** A 2v2 roster whose SLOTS interleave the two sides (A,B,A,B) — the exact case a
 *  naive "player i → home i" placement would scatter across the board. Team 0 is
 *  {0,2}, team 1 is {1,3}. */
function twoVsTwo(): PlayerSpec[] {
  return [
    { id: 0, shipClass: ShipClass.Vanguard, team: 0 },
    { id: 1, shipClass: ShipClass.Vanguard, team: 1 },
    { id: 2, shipClass: ShipClass.Vanguard, team: 0 },
    { id: 3, shipClass: ShipClass.Vanguard, team: 1 },
  ];
}

// ---------------------------------------------------------------------------
// 1. The allegiance gate reads team, not just self
// ---------------------------------------------------------------------------

describe('allegiance — the gate reads team, not just not-self', () => {
  const world = makeWorld({
    ships: [
      makeShip({ id: 0, team: 0 }),
      makeShip({ id: 2, team: 0 }), // teammate of 0
      makeShip({ id: 1, team: 1 }), // opponent
    ],
  });

  it('teammates are not enemies; opponents are; nobody is their own enemy', () => {
    expect(teamOf(world, 0)).toBe(teamOf(world, 2));
    expect(areEnemies(world, 0, 2)).toBe(false); // same side
    expect(areEnemies(world, 0, 1)).toBe(true); // other side
    expect(areEnemies(world, 0, 0)).toBe(false); // self
  });

  it('FFA is teams-of-one — every distinct player is an enemy', () => {
    const ffa = makeWorld({ ships: [makeShip({ id: 0 }), makeShip({ id: 1 })] }); // no team → id
    expect(areEnemies(ffa, 0, 1)).toBe(true);
    expect(areEnemies(ffa, 0, 0)).toBe(false);
  });

  it('canDamage is a strictly looser gate: enemy yes, self never, ally only under FRIENDLY_FIRE', () => {
    expect(canDamage(world, 0, 1)).toBe(true); // an enemy is always damageable
    expect(canDamage(world, 0, 0)).toBe(false); // a shot always flies over its owner
    // An ally follows the flag exactly, so the two agree at its ratified value.
    expect(canDamage(world, 0, 2)).toBe(FRIENDLY_FIRE);
  });

  it('friendly fire is OFF by ratified default', () => {
    expect(FRIENDLY_FIRE).toBe(false);
    expect(canDamage(world, 0, 2)).toBe(false); // ally eats nothing
  });
});

// ---------------------------------------------------------------------------
// 2. Targeting never locks a teammate (auto-aim + turret)
// ---------------------------------------------------------------------------

describe('targeting never locks a teammate', () => {
  it('player auto-aim fires at NOTHING when only a teammate is in range', () => {
    const shooter = makeShip({ id: 0, team: 0, pos: { x: 1000, y: 1000 } });
    const ally = makeShip({ id: 1, team: 0, pos: { x: 1000 + 150, y: 1000 } }); // point-blank ally
    const world = makeWorld({ ships: [shooter, ally] });

    const before = ally.hull;
    const hold: Inputs = [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }];
    for (let t = 0; t < 120; t++) step(world, hold);

    expect(ally.hull).toBe(before); // never targeted
    expect(world.projectiles.some((p) => p.active)).toBe(false); // no shot was even acquired
  });

  it('auto-aim picks the enemy and leaves the teammate beside it untouched', () => {
    const shooter = makeShip({ id: 0, team: 0, pos: { x: 1000, y: 1000 } });
    const ally = makeShip({ id: 1, team: 0, pos: { x: 1000, y: 1000 - 150 } }); // in range, other bearing
    const enemy = makeShip({ id: 2, team: 1, pos: { x: 1000 + 150, y: 1000 } });
    const world = makeWorld({ ships: [shooter, ally, enemy] });

    const allyBefore = ally.hull;
    const enemyBefore = enemy.hull;
    const hold: Inputs = [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }];
    for (let t = 0; t < 120; t++) step(world, hold);

    expect(enemy.hull).toBeLessThan(enemyBefore); // the enemy is the pick
    expect(ally.hull).toBe(allyBefore); // the teammate never is
  });

  it('a turret fires on an enemy ship but never on a teammate ship', () => {
    const station = { x: 1000, y: 1000 };
    const withTurret = () =>
      makeStation({
        id: 0,
        owner: 0,
        team: 0,
        pos: station,
        turrets: [makeTurret({ id: 100, owner: 0, pos: station })],
      });

    // Enemy in range: the turret engages it.
    const enemy = makeShip({ id: 1, team: 1, pos: { x: 1000 + 140, y: 1000 } });
    const wEnemy = makeWorld({ ships: [makeShip({ id: 0, team: 0, pos: { x: 100, y: 100 } }), enemy], stations: [withTurret()] });
    const enemyBefore = enemy.hull;
    for (let t = 0; t < 120; t++) step(wEnemy, []);
    expect(enemy.hull).toBeLessThan(enemyBefore);

    // Teammate in the very same spot: the turret must ignore it forever.
    const ally = makeShip({ id: 1, team: 0, pos: { x: 1000 + 140, y: 1000 } });
    const wAlly = makeWorld({ ships: [makeShip({ id: 0, team: 0, pos: { x: 100, y: 100 } }), ally], stations: [withTurret()] });
    const allyBefore = ally.hull;
    for (let t = 0; t < 120; t++) step(wAlly, []);
    expect(ally.hull).toBe(allyBefore);
  });
});

// ---------------------------------------------------------------------------
// 3. No friendly fire — an ally eats nothing; the shot reaches the enemy behind
// ---------------------------------------------------------------------------

describe('no friendly fire (ratified default)', () => {
  it('a teammate ship in the line of fire takes zero damage and passes the shot through to the enemy behind', () => {
    const shooter = makeShip({ id: 0, team: 0, pos: { x: 0, y: 0 } });
    const ally = makeShip({ id: 1, team: 0, pos: { x: 90, y: 0 } }); // directly in the muzzle line
    const enemy = makeShip({ id: 2, team: 1, pos: { x: 180, y: 0 } }); // behind the ally
    const world = makeWorld({ ships: [shooter, ally, enemy] });

    const allyBefore = ally.hull;
    const enemyBefore = enemy.hull;
    // One manual shot straight down +x, through the ally, at the enemy.
    fireShipProjectile(world, shooter, normalize({ x: 1, y: 0 }));
    for (let t = 0; t < 30; t++) step(world, []);

    expect(ally.hull).toBe(allyBefore); // the ally never eats a friendly round
    expect(enemy.hull).toBeLessThan(enemyBefore); // the shot carried through to the enemy
  });

  it("a shot cannot besiege an ally's station or its turrets", () => {
    const shooter = makeShip({ id: 0, team: 0, pos: { x: 0, y: 0 } });
    const allyStation = makeStation({
      id: 1,
      owner: 1,
      team: 0, // same side as the shooter
      pos: { x: 200, y: 0 },
      spawnProtect: 0,
      turrets: [makeTurret({ id: 100, owner: 1, pos: { x: 200, y: 0 } })],
    });
    const world = makeWorld({ ships: [shooter], stations: [allyStation] });

    const coreBefore = allyStation.coreHp;
    const turretBefore = allyStation.turrets[0]!.hp;
    for (let t = 0; t < 30; t++) {
      fireShipProjectile(world, shooter, normalize({ x: 1, y: 0 }));
      step(world, []);
    }

    expect(allyStation.coreHp).toBe(coreBefore); // an ally's reactor is safe
    expect(allyStation.turrets[0]!.hp).toBe(turretBefore); // and its defenses
  });

  it('the enemy version of the same shot DOES bite — the immunity is team, not a dead weapon', () => {
    const shooter = makeShip({ id: 0, team: 0, pos: { x: 0, y: 0 } });
    const enemyStation = makeStation({ id: 1, owner: 1, team: 1, pos: { x: 200, y: 0 }, spawnProtect: 0 });
    const world = makeWorld({ ships: [shooter], stations: [enemyStation] });

    const before = enemyStation.coreHp;
    for (let t = 0; t < 30; t++) {
      fireShipProjectile(world, shooter, normalize({ x: 1, y: 0 }));
      step(world, []);
    }
    expect(enemyStation.coreHp).toBeLessThan(before);
  });
});

// ---------------------------------------------------------------------------
// 4. Spawn together — teammates cluster; teams stay equidistant
// ---------------------------------------------------------------------------

/** The live (non-derelict) home stations of a built world. */
function liveStations(world: World): MiningStation[] {
  return world.stations.filter((s) => !s.derelict);
}

/** Map each live station to the map's spatial home SLOT it sits on, by matching
 *  its centre to the map's own placement walk (which is emitted in spatial order:
 *  consecutive slots are neighbouring homes). */
function slotOfOwner(world: World, mapId: string, n: number): Map<number, number> {
  const map = getMap(mapId);
  const homes = map.stations(0, n, world.bounds).filter((p) => !p.derelict);
  const out = new Map<number, number>();
  for (const st of liveStations(world)) {
    let bestSlot = -1;
    let bestD = Infinity;
    homes.forEach((h, slot) => {
      const d = Math.hypot(h.station.x - st.pos.x, h.station.y - st.pos.y);
      if (d < bestD) {
        bestD = d;
        bestSlot = slot;
      }
    });
    expect(bestD).toBeLessThan(1e-6); // every live station sits exactly on a home slot
    out.set(st.owner, bestSlot);
  }
  return out;
}

describe('spawn together — same-team homes are adjacent on every map', () => {
  for (const map of MAPS) {
    it(`${map.id}: teammates take contiguous (neighbouring) home slots`, () => {
      const players = twoVsTwo();
      const world = createWorld({ seed: 7, players, mapId: map.id });
      const slotOf = slotOfOwner(world, map.id, players.length);

      // Group slots by team and assert each team's slots are consecutive integers
      // — contiguous slots are neighbouring homes on the arena walk.
      const byTeam = new Map<number, number[]>();
      for (const p of players) {
        const slot = slotOf.get(p.id)!;
        (byTeam.get(p.team!) ?? byTeam.set(p.team!, []).get(p.team!)!).push(slot);
      }
      for (const slots of byTeam.values()) {
        slots.sort((a, b) => a - b);
        expect(slots[slots.length - 1]! - slots[0]!).toBe(slots.length - 1); // no gap
      }
    });
  }

  it('the symmetric maps keep the two clusters equidistant across teams', () => {
    // On a rotationally-symmetric layout (octagon exact, oval to the equal-chord
    // tolerance) a 2v2 puts each side on an opposite arc, so each team's nearest
    // enemy is the same distance away — the "equal spacing ACROSS teams" rule.
    const minCrossTeam = (world: World, team: number): number => {
      const mine = liveStations(world).filter((s) => s.team === team);
      const theirs = liveStations(world).filter((s) => s.team !== team);
      let best = Infinity;
      for (const a of mine)
        for (const b of theirs) best = Math.min(best, Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y));
      return best;
    };

    for (const id of ['octagon', 'oval']) {
      const world = createWorld({ seed: 7, players: twoVsTwo(), mapId: id });
      const a = minCrossTeam(world, 0);
      const b = minCrossTeam(world, 1);
      expect(a).toBeCloseTo(b, id === 'octagon' ? 6 : 1); // symmetric ⇒ equal
    }
  });

  it('FFA is unchanged — clustering is the identity when every player is its own team', () => {
    // An FFA roster places player i on the i-th home slot, exactly as before Teams.
    const cfg = ffaConfig(6, ShipClass.Vanguard);
    const players = configToPlayers(cfg);
    const world = createWorld({ seed: 3, players, mapId: 'octagon' });
    const slotOf = slotOfOwner(world, 'octagon', players.length);
    for (const p of players) expect(slotOf.get(p.id)).toBe(p.id);
  });
});

// ---------------------------------------------------------------------------
// 5. Determinism — a TEAMS world builds and steps identically twice
// ---------------------------------------------------------------------------

describe('determinism — Teams changes a table, never a code path', () => {
  const fingerprint = (world: World): string =>
    JSON.stringify({
      ships: world.ships.map((s) => [s.id, s.team, s.pos.x, s.pos.y, s.hull]),
      stations: world.stations.map((s) => [s.id, s.owner, s.team, s.pos.x, s.pos.y, s.coreHp, s.derelict ?? false]),
    });

  it('two identical TEAMS configs produce byte-identical worlds', () => {
    const cfg = { seed: 42, players: twoVsTwo(), mapId: 'compass' };
    expect(fingerprint(createWorld(cfg))).toBe(fingerprint(createWorld(cfg)));
  });

  it('the same config replays identically after 300 stepped ticks', () => {
    const cfg = { seed: 99, players: twoVsTwo(), mapId: 'diamond' };
    const a = createWorld(cfg);
    const b = createWorld(cfg);
    const fire: Inputs = [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }];
    for (let t = 0; t < 300; t++) {
      step(a, fire);
      step(b, fire);
    }
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});
