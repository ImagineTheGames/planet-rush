/**
 * src/sim/team-sensing.test.ts — SHARED TEAM VISION (a0-42, ratified 2026-08-13).
 *
 * The developer, verbatim: *"when playing on a team the fog of war should lift
 * where your team mates are it should be like as if you were there…."*
 *
 * *"As if you were there"* is the standard this file measures against, and it has
 * two halves — a teammate's coverage must hand the viewer what their own coverage
 * would hand them in the same spot:
 *
 *   1. the **live dots** under it (ships, satellites, shots), and
 *   2. the **remembered geography** it uncovered (scouted homes and ore fields).
 *
 * A version that shared only the first would be the half-ship this file exists to
 * catch: the ally's disc would reveal the enemy standing in it and forget the ore
 * field the ally flew over to get there.
 *
 * The contract checks:
 *   1. **FFA IDENTITY** — in a teams-of-one world (which is every FFA world, by
 *      construction) `sensedState` is field-for-field the PER-PLAYER answer it
 *      gave before shared vision existed. The reference is a verbatim copy of the
 *      pre-change function, kept in this file, so the comparison is against the
 *      old code rather than against the new code's own opinion of itself.
 *   2. an ally's coverage reveals an enemy SHIP the viewer cannot see themselves;
 *   3. an ally's scouted STATION and ORE reach the viewer's remembered sets;
 *   4. a DEAD ally contributes nothing — coverage collapses the same tick;
 *   5. the merged ore ids come back ASCENDING and DEDUPED (the callers rely on
 *      the order: `sensedState` binary-searches it, the minimap fills a set).
 *
 * There is no `mode === 'teams'` check anywhere in `./sensing`, and there must
 * never be one: every union runs over `sameSide` (`./allegiance`), and FFA is
 * teams-of-one, so the FFA identity above is a property of the construction and
 * not a special case someone remembered to write.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { PlayerId } from '@shared/types';
import {
  pointSensed,
  rememberedOreIds,
  rememberedStationMask,
  sensedState,
  sensorSources,
  teamMembers,
  teamSensorSources,
  updateSensory,
  type SensedState,
} from './sensing';
import { SATELLITE, SHIP_SENSOR_RANGE, STATION_SENSOR_RANGE, CORE_HP, SHIP_RADIUS, SHIELD, STATION } from './constants';
import { stockTiers } from './upgrades';
import type {
  Asteroid,
  MiningStation,
  Projectile,
  RadarSatellite,
  Ship,
  SensoryMemory,
  World,
} from './state';

// --- builders (hand-built worlds; `team` is the only thing FFA and TEAMS differ
//     in, so every fixture below is the same world twice with one table changed) -

function makeShip(id: number, team: number | undefined, pos: { x: number; y: number }, alive = true): Ship {
  return {
    id,
    // Omitted entirely when absent, not set to `undefined` — that is what a
    // pre-Teams fixture looks like, and `exactOptionalPropertyTypes` is strict.
    ...(team === undefined ? {} : { team }),
    shipClass: ShipClass.Vanguard,
    tiers: stockTiers(),
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    home: { ...pos },
    angle: 0,
    hull: 50,
    maxHull: 50,
    cargo: 0,
    cargoCap: 2,
    banked: 0,
    alive,
    respawnTimer: 0,
    spawnProtect: 0,
    eliminated: false,
    radius: SHIP_RADIUS,
    firing: false,
  };
}

function makeStation(
  id: number,
  owner: number,
  team: number | undefined,
  pos: { x: number; y: number },
  alive = true,
): MiningStation {
  return {
    id,
    owner,
    ...(team === undefined ? {} : { team }),
    pos: { ...pos },
    radius: STATION.radius,
    coreHp: alive ? CORE_HP : 0,
    maxCoreHp: CORE_HP,
    alive,
    deathTime: alive ? -1 : 0,
    spawnProtect: 0,
    angle: 0,
    sinceDamage: SHIELD.regenDelay,
    repairing: false,
    turrets: [],
    shields: [],
    satellites: [],
    builds: [],
  };
}

function makeSat(id: number, owner: number, pos: { x: number; y: number }, hp = SATELLITE.hp): RadarSatellite {
  return { id, owner, pos: { ...pos }, radius: SATELLITE.radius, hp, maxHp: SATELLITE.hp, orbitAngle: 0 };
}

function makeRock(id: number, pos: { x: number; y: number }, radius = 30): Asteroid {
  return { id, pos: { ...pos }, radius, ore: 3, maxOre: 3, crackStage: 0, mineBuffer: 0, home: null };
}

function makeShot(id: number, owner: number, pos: { x: number; y: number }): Projectile {
  return {
    id,
    active: true,
    owner,
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    damage: 5,
    radius: 3,
    life: 1,
    kind: 'ship',
  };
}

function makeWorld(
  ships: Ship[],
  stations: MiningStation[],
  sensory?: SensoryMemory,
  asteroids: Asteroid[] = [],
  projectiles: Projectile[] = [],
): World {
  return {
    time: 0,
    tick: 0,
    rngState: 1,
    nextEntityId: 1000,
    ships,
    asteroids,
    chunks: [],
    stations,
    projectiles,
    bounds: { width: 12000, height: 12000 },
    fieldRadius: 600,
    asteroidsPerWave: 0,
    match: { phase: 'live', wavesSpawned: 0, collapseTime: -1, eliminated: [], winner: null, endTime: -1 },
    ...(sensory ? { sensory } : {}),
  };
}

/**
 * A 2v2 board wide enough that **no disc of one side overlaps the other's**:
 * players 0 and 2 sit far left, players 1 and 3 far right, the largest disc in
 * the game (`SATELLITE.sensorRange`) nowhere near reaching across. Teams are the
 * argument, so the same geometry is played FFA (teams-of-one) or as 0+2 vs 1+3
 * simply by handing it a different table — which is the whole point of
 * `./allegiance`.
 */
const FAR_LEFT = -4000;
const FAR_RIGHT = 4000;

function makeTwoVsTwo(teams: readonly [number, number, number, number]): World {
  const ships = [
    makeShip(0, teams[0], { x: FAR_LEFT, y: 0 }),
    makeShip(1, teams[1], { x: FAR_RIGHT, y: 0 }),
    makeShip(2, teams[2], { x: FAR_LEFT, y: 2000 }),
    makeShip(3, teams[3], { x: FAR_RIGHT, y: 2000 }),
  ];
  const stations = [
    makeStation(0, 0, teams[0], { x: FAR_LEFT, y: 0 }),
    makeStation(1, 1, teams[1], { x: FAR_RIGHT, y: 0 }),
    makeStation(2, 2, teams[2], { x: FAR_LEFT, y: 2000 }),
    makeStation(3, 3, teams[3], { x: FAR_RIGHT, y: 2000 }),
  ];
  return makeWorld(ships, stations, { seenStations: [0, 0, 0, 0], seenOre: [[], [], [], []] });
}

/** FFA: every player is their own team (what `createWorld` defaults to). */
const FFA = [0, 1, 2, 3] as const;
/** TEAMS: 0 and 2 on side A, 1 and 3 on side B. */
const TEAMS = [0, 1, 0, 1] as const;

// ---------------------------------------------------------------------------
// 1. FFA IDENTITY — the union must be invisible in a teams-of-one world
// ---------------------------------------------------------------------------
//
// The reference below is the PRE-CHANGE `sensedState`, copied verbatim from the
// commit before shared vision: per-player `sensorSources`, `station.owner ===
// viewer`, `sat.owner === viewer`, `p.owner === viewer`, and the two raw
// per-player memory reads. It is deliberately NOT written in terms of the new
// helpers — a reference expressed in the code under test proves nothing.

/** `sensedState` as it stood before shared team vision (a0-42). */
function perPlayerSensedState(world: World, viewer: PlayerId): SensedState {
  const sources = sensorSources(world, viewer);

  const ships: PlayerId[] = [];
  for (const s of world.ships) {
    if (!s.alive) continue;
    if (s.id === viewer || pointSensed(sources, s.pos)) ships.push(s.id);
  }

  const satellites: number[] = [];
  const projectiles: number[] = [];
  const rememberedStations: number[] = [];

  const rememberedMask = world.sensory?.seenStations[viewer] ?? 0;
  for (const station of world.stations) {
    const owned = station.owner === viewer;
    const rememberedBit = (rememberedMask & (1 << station.id)) !== 0;
    if (owned || rememberedBit || pointSensed(sources, station.pos, station.radius)) {
      rememberedStations.push(station.id);
    }
    if (station.satellites) {
      for (const sat of station.satellites) {
        if (sat.hp <= 0) continue;
        if (sat.owner === viewer || pointSensed(sources, sat.pos)) satellites.push(sat.id);
      }
    }
  }

  for (const p of world.projectiles) {
    if (!p.active) continue;
    if (p.owner === viewer || pointSensed(sources, p.pos)) projectiles.push(p.id);
  }

  const oreMemory = world.sensory?.seenOre?.[viewer];
  const rememberedOre: number[] = [];
  for (const a of world.asteroids) {
    if ((oreMemory ?? []).includes(a.id) || pointSensed(sources, a.pos, a.radius)) {
      rememberedOre.push(a.id);
    }
  }

  return { viewer, sources, ships, satellites, projectiles, rememberedStations, rememberedOre };
}

/** Every kind of body this module can sense, on one FFA board — so the identity
 *  check below compares populated sets, not four empty arrays agreeing. */
function makeBusyFfaWorld(): World {
  const world = makeTwoVsTwo(FFA);
  // Satellites on two homes, so a large disc reaches things a ship cannot.
  world.stations[0]!.satellites = [makeSat(50, 0, { x: FAR_LEFT + 114, y: 0 })];
  world.stations[1]!.satellites = [makeSat(51, 1, { x: FAR_RIGHT + 114, y: 0 }), makeSat(52, 1, { x: FAR_RIGHT, y: 114 })];
  // A dead player still holds a station (their coverage is the home's, not the
  // ship's) — the case where "own entities are always sensed" and "a dead ship
  // casts nothing" are both live at once.
  world.ships[3]!.alive = false;
  // Rocks: one under each side's cover, one nobody reaches, one grazing an edge.
  world.asteroids = [
    makeRock(300, { x: FAR_LEFT + 100, y: 0 }),
    makeRock(301, { x: FAR_RIGHT + 100, y: 0 }),
    makeRock(302, { x: 0, y: 6000 }),
    makeRock(303, { x: FAR_LEFT + SHIP_SENSOR_RANGE + 20, y: 0 }, 40),
  ];
  world.projectiles = [
    makeShot(900, 0, { x: FAR_LEFT + 60, y: 0 }),
    makeShot(901, 1, { x: FAR_RIGHT + 60, y: 0 }),
    makeShot(902, 2, { x: 0, y: 0 }), // mid-board: in nobody's disc
    { ...makeShot(903, 3, { x: FAR_LEFT + 40, y: 0 }), active: false }, // spent
  ];
  updateSensory(world); // give every player a real, differing memory
  // …and move a ship after the fold, so REMEMBERED and CURRENT genuinely differ.
  world.ships[2]!.pos = { x: 0, y: 3000 };
  return world;
}

describe('FFA is untouched — a team of one is a team of one (a0-42)', () => {
  it('sensedState is field-for-field the PRE-CHANGE per-player answer, for every viewer', () => {
    const world = makeBusyFfaWorld();
    for (const viewer of [0, 1, 2, 3]) {
      expect(sensedState(world, viewer), `viewer ${viewer}`).toEqual(perPlayerSensedState(world, viewer));
    }
  });

  it('the sources a player projects are the sources their side projects', () => {
    const world = makeBusyFfaWorld();
    for (const viewer of [0, 1, 2, 3]) {
      expect(teamSensorSources(world, viewer)).toEqual(sensorSources(world, viewer));
      expect(teamMembers(world, viewer)).toEqual([viewer]);
    }
  });

  it('the remembered reads are the raw per-player memory, unchanged', () => {
    const world = makeBusyFfaWorld();
    for (const viewer of [0, 1, 2, 3]) {
      expect(rememberedStationMask(world, viewer)).toBe(world.sensory!.seenStations[viewer]);
      expect(rememberedOreIds(world, viewer)).toEqual(world.sensory!.seenOre![viewer]);
    }
  });

  it('a world with no team table at all reads as FFA (the pre-Teams fixtures)', () => {
    // No `team` on any body — `teamOf` falls back to the player's own id, so the
    // union still collapses to self. This is the shape every older test builds.
    const bare = makeWorld(
      [makeShip(0, undefined, { x: 0, y: 0 }), makeShip(1, undefined, { x: 6000, y: 0 })],
      [
        makeStation(0, 0, undefined, { x: 0, y: 0 }),
        makeStation(1, 1, undefined, { x: 6000, y: 0 }),
      ],
    );
    expect(teamMembers(bare, 0)).toEqual([0]);
    expect(sensedState(bare, 0)).toEqual(perPlayerSensedState(bare, 0));
    expect(sensedState(bare, 0).ships).not.toContain(1);
  });
});

// ---------------------------------------------------------------------------
// 2. The team union — the source list, and the live dots under it
// ---------------------------------------------------------------------------

describe('the team source union (a0-42, work item 1)', () => {
  it('is every ally\'s discs, ascending by player id, each ally in the per-player order', () => {
    const world = makeTwoVsTwo(TEAMS);
    world.stations[2]!.satellites = [makeSat(52, 2, { x: FAR_LEFT + 114, y: 2000 })];

    expect(teamMembers(world, 0)).toEqual([0, 2]);
    expect(teamMembers(world, 3)).toEqual([1, 3]);

    // Viewer 0's side: player 0's ship + station, then player 2's ship, station
    // and satellite — the two per-player lists, concatenated in id order.
    expect(teamSensorSources(world, 0)).toEqual([...sensorSources(world, 0), ...sensorSources(world, 2)]);
    // …and the narrower question still gets the narrower answer.
    expect(sensorSources(world, 0)).toHaveLength(2);
    expect(teamSensorSources(world, 0)).toHaveLength(5);
  });

  it('an ally\'s coverage reveals an enemy ship the viewer cannot see themselves', () => {
    const ffa = makeTwoVsTwo(FFA);
    const teams = makeTwoVsTwo(TEAMS);
    for (const world of [ffa, teams]) {
      // Enemy 1 parked beside ALLY 2's home, half a map from viewer 0.
      world.ships[1]!.pos = { x: FAR_LEFT + STATION_SENSOR_RANGE - 20, y: 2000 };
    }
    // FFA: the ally is a rival, so their disc buys the viewer nothing.
    expect(sensedState(ffa, 0).ships).not.toContain(1);
    // TEAMS: the same disc, now on the viewer's side — the enemy is on the map.
    expect(sensedState(teams, 0).ships).toContain(1);
  });

  it('a teammate\'s ship, station, satellite and shots are never fogged', () => {
    const world = makeTwoVsTwo(TEAMS);
    // Move ally 2 clean off the board — no disc of anyone's reaches them.
    world.ships[2]!.pos = { x: 0, y: 5500 };
    world.stations[2]!.satellites = [makeSat(52, 2, { x: FAR_LEFT + 114, y: 2000 })];
    world.projectiles = [makeShot(900, 2, { x: 0, y: 5500 })];

    const sensed = sensedState(world, 0);
    expect(sensed.ships).toContain(2); // own side: cockpit knowledge, at any range
    expect(sensed.rememberedStations).toContain(2);
    expect(sensed.satellites).toContain(52);
    expect(sensed.projectiles).toContain(900);

    // The enemy side gets none of it, at the same distances.
    expect(sensedState(world, 1).ships).not.toContain(2);
    expect(sensedState(world, 1).satellites).not.toContain(52);
    expect(sensedState(world, 1).projectiles).not.toContain(900);
  });
});

// ---------------------------------------------------------------------------
// 3. Remembered geography — the half that would otherwise be forgotten
// ---------------------------------------------------------------------------

describe('an ally\'s remembered geography reaches the viewer (a0-42, work item 3)', () => {
  it('a station and an ore field only the ALLY ever scouted are on the viewer\'s map', () => {
    const build = (teams: readonly [number, number, number, number]): World => {
      const world = makeTwoVsTwo(teams);
      // A rock and an enemy home out where only ally 2 will ever fly.
      world.asteroids = [makeRock(400, { x: 0, y: 4000 })];
      world.stations.push(makeStation(4, 4, 4, { x: 300, y: 4000 }));
      world.sensory = { seenStations: [0, 0, 0, 0], seenOre: [[], [], [], []] };
      // Ally 2 flies out, sees both, and flies home again.
      world.ships[2]!.pos = { x: 0, y: 4000 };
      updateSensory(world);
      world.ships[2]!.pos = { x: FAR_LEFT, y: 2000 };
      updateSensory(world);
      return world;
    };

    // The scout's own memory holds it in both worlds — nothing about the WRITE
    // side changed, and this is the line that proves it.
    const ffa = build(FFA);
    const teams = build(TEAMS);
    for (const world of [ffa, teams]) {
      expect(world.sensory!.seenOre![2]).toContain(400);
      expect(world.sensory!.seenStations[2]! & (1 << 4)).not.toBe(0);
      expect(world.sensory!.seenOre![0]).not.toContain(400); // viewer never saw it
      expect(world.sensory!.seenStations[0]! & (1 << 4)).toBe(0);
    }

    // FFA: the viewer's map is their own memory, and it does not hold either.
    expect(rememberedOreIds(ffa, 0)).not.toContain(400);
    expect(sensedState(ffa, 0).rememberedOre).not.toContain(400);
    expect(sensedState(ffa, 0).rememberedStations).not.toContain(4);

    // TEAMS: what the side scouted, the side keeps — live dots AND geography.
    expect(rememberedOreIds(teams, 0)).toContain(400);
    expect(sensedState(teams, 0).rememberedOre).toContain(400);
    expect(rememberedStationMask(teams, 0) & (1 << 4)).not.toBe(0);
    expect(sensedState(teams, 0).rememberedStations).toContain(4);
  });

  it('the union is READ-side only: `updateSensory` still writes one record per player', () => {
    const world = makeTwoVsTwo(TEAMS);
    world.asteroids = [makeRock(401, { x: FAR_LEFT + 100, y: 2000 })]; // ally 2's back yard
    updateSensory(world);
    // Ally 2 wrote it; the viewer's own stored record is untouched, so the
    // determinism hash and the memory pass never learn about the other player.
    expect(world.sensory!.seenOre![2]).toContain(401);
    expect(world.sensory!.seenOre![0]).toEqual([]);
    expect(world.sensory!.seenStations[0]! & (1 << 2)).toBe(0); // never saw ally 2's home
    // …and yet the READ is the side's.
    expect(rememberedOreIds(world, 0)).toContain(401);
  });

  it('a rock mined out of existence is still not a phantom on an ally\'s map', () => {
    const world = makeTwoVsTwo(TEAMS);
    world.asteroids = [makeRock(402, { x: FAR_LEFT + 100, y: 2000 })];
    updateSensory(world);
    expect(sensedState(world, 0).rememberedOre).toContain(402);

    world.asteroids = []; // `step` drops a depleted rock from the field
    expect(rememberedOreIds(world, 0)).toContain(402); // the raw side memory holds it
    expect(sensedState(world, 0).rememberedOre).not.toContain(402); // the read model does not
  });
});

// ---------------------------------------------------------------------------
// 4. The collapse — a dead ally contributes nothing, that same tick
// ---------------------------------------------------------------------------

describe('a dead ally contributes nothing (a0-42; the live/remembered split)', () => {
  it('an enemy seen only through a teammate drops the tick that teammate dies', () => {
    const world = makeTwoVsTwo(TEAMS);
    // Enemy 1 sits inside ALLY 2's SHIP disc and nothing else — not their home's,
    // not the viewer's anything.
    world.ships[1]!.pos = { x: FAR_LEFT + SHIP_SENSOR_RANGE - 20, y: 2000 + STATION_SENSOR_RANGE + 200 };
    world.ships[2]!.pos = { x: FAR_LEFT, y: 2000 + STATION_SENSOR_RANGE + 200 };
    expect(sensedState(world, 0).ships).toContain(1);

    world.ships[2]!.alive = false; // the teammate is killed
    expect(teamSensorSources(world, 0).some((s) => s.kind === 'ship' && s.id === 2)).toBe(false);
    expect(sensedState(world, 0).ships).not.toContain(1); // same read, same tick
    expect(sensedState(world, 0).ships).not.toContain(2); // and the ally is gone too
  });

  it('a wrecked ally home casts nothing, exactly as the viewer\'s own would not', () => {
    const world = makeTwoVsTwo(TEAMS);
    world.ships[2]!.alive = false;
    world.stations[2]!.alive = false;
    expect(sensorSources(world, 2)).toHaveLength(0);
    expect(teamSensorSources(world, 0)).toEqual(sensorSources(world, 0));
  });

  it('but what a dead ally SAW stays on the side\'s map — geography is remembered', () => {
    const world = makeTwoVsTwo(TEAMS);
    world.asteroids = [makeRock(403, { x: FAR_LEFT + 100, y: 2000 })];
    updateSensory(world); // ally 2 maps their own back yard
    world.ships[2]!.alive = false;
    world.stations[2]!.alive = false;
    // The live half collapsed (above); the remembered half is monotonic and does
    // not un-remember, which is the same rule a killed satellite's mapped ore takes.
    expect(rememberedOreIds(world, 0)).toContain(403);
    expect(sensedState(world, 0).rememberedOre).toContain(403);
  });
});

// ---------------------------------------------------------------------------
// 5. The merged ore list — ascending and deduped, because callers rely on it
// ---------------------------------------------------------------------------

describe('the merged remembered-ore ids (a0-42, work item 3)', () => {
  /** Four allies on one side, so the merge is a genuine k-way fold, not a pair. */
  function fourAllies(memories: readonly number[][]): World {
    const ships = memories.map((_, i) => makeShip(i, 7, { x: i * 200, y: 0 }));
    const stations = memories.map((_, i) => makeStation(i, i, 7, { x: i * 200, y: 0 }));
    const world = makeWorld(ships, stations, {
      seenStations: memories.map(() => 0),
      seenOre: memories.map((m) => [...m]),
    });
    return world;
  }

  it('comes back ASCENDING however the allies\' lists interleave', () => {
    const world = fourAllies([[1, 9], [3, 4, 9], [2], [11, 12]]);
    expect(rememberedOreIds(world, 0)).toEqual([1, 2, 3, 4, 9, 11, 12]);
    // Every member of the side reads the same list — vision is symmetric.
    for (const viewer of [0, 1, 2, 3]) {
      expect(rememberedOreIds(world, viewer)).toEqual([1, 2, 3, 4, 9, 11, 12]);
    }
  });

  it('DEDUPES a rock two allies both scouted', () => {
    const world = fourAllies([[5, 6], [5, 6], [6], []]);
    expect(rememberedOreIds(world, 0)).toEqual([5, 6]);
  });

  it('the order depends on the SET of ids, never on which ally holds them', () => {
    const shuffled = fourAllies([[11, 12], [2], [3, 4, 9], [1, 9]]);
    const straight = fourAllies([[1, 9], [3, 4, 9], [2], [11, 12]]);
    expect(rememberedOreIds(shuffled, 0)).toEqual(rememberedOreIds(straight, 0));
  });

  it('a side where only one ally remembers anything returns that list untouched', () => {
    const world = fourAllies([[], [7, 8], [], []]);
    expect(rememberedOreIds(world, 0)).toBe(world.sensory!.seenOre![1]);
  });

  it('a side that remembers nothing, and a world with no memory at all, are empty', () => {
    expect(rememberedOreIds(fourAllies([[], [], [], []]), 0)).toEqual([]);
    const bare = makeWorld([makeShip(0, 0, { x: 0, y: 0 })], [makeStation(0, 0, 0, { x: 0, y: 0 })]);
    expect(rememberedOreIds(bare, 0)).toEqual([]);
    expect(rememberedStationMask(bare, 0)).toBe(0);
  });

  it('the station mask is the OR of the side\'s masks, and nobody else\'s', () => {
    const world = makeTwoVsTwo(TEAMS);
    world.sensory = { seenStations: [0b0001, 0b0010, 0b0100, 0b1000], seenOre: [[], [], [], []] };
    expect(rememberedStationMask(world, 0)).toBe(0b0101); // players 0 + 2
    expect(rememberedStationMask(world, 1)).toBe(0b1010); // players 1 + 3
  });
});

// ---------------------------------------------------------------------------
// 6. Determinism — the union is a pure read over the same world
// ---------------------------------------------------------------------------

describe('shared vision is deterministic (GDD §4.8)', () => {
  it('the same world read twice gives the same sensed-set, and no write happens', () => {
    const world = makeTwoVsTwo(TEAMS);
    world.asteroids = [makeRock(500, { x: FAR_LEFT + 100, y: 2000 }), makeRock(501, { x: FAR_RIGHT + 100, y: 0 })];
    updateSensory(world);
    const before = JSON.stringify(world.sensory);
    expect(sensedState(world, 0)).toEqual(sensedState(world, 0));
    expect(JSON.stringify(world.sensory)).toBe(before); // a lens, never a rule
  });

  it('a ship list in descending id order still folds ascending', () => {
    const world = makeTwoVsTwo(TEAMS);
    world.ships = [...world.ships].reverse();
    expect(teamMembers(world, 0)).toEqual([0, 2]);
    expect(teamSensorSources(world, 0)).toEqual([...sensorSources(world, 0), ...sensorSources(world, 2)]);
  });
});
