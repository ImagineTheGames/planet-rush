/**
 * src/sim/team-sensing.test.ts — SHARED TEAM VISION (a0-42). OWNER: Gameplay
 * Engineer.
 *
 * The developer, 2026-08-13, verbatim: *"when playing on a team the fog of war
 * should lift where your team mates are it should be like as if you were
 * there...."* — and *"as if you were there"* is the standard this file tests to:
 * a teammate's coverage must give the viewer **what their own coverage would give
 * them in the same spot**, which is the live dots under it AND the remembered
 * geography it uncovers. Half of that would be a dimmer, second-class version of
 * the ratified feature.
 *
 * What is pinned here:
 *
 *  1. **FFA does not move, field for field.** The pre-change per-player read model
 *     is reimplemented below as an oracle (`perPlayerSensedState`) and compared
 *     against the shipped `sensedState` over a real FFA match, for every viewer,
 *     across ticks. FFA is teams-of-one by construction (`createWorld` defaults
 *     `team` to the player's own id), so if this fails, the union is leaking.
 *  2. **An ally's disc reveals live entities** — an enemy ship under a teammate's
 *     coverage is in your sensed-set, and an ally's radar satellite is one of the
 *     coverage discs the minimap draws.
 *  3. **An ally's memory reaches you** — a home and an ore field only the teammate
 *     has ever flown over are in your remembered sets…
 *  4. **…without the WRITE widening.** `updateSensory` still folds each player's
 *     own coverage into that player's own record: the scout's per-player memory
 *     grows, the viewer's does not, and the sharing happens at read time. That is
 *     what keeps one player's memory from depending on another player's tick, and
 *     the replay hash where it was.
 *  5. **A dead ally contributes nothing** — the live/remembered split holds across
 *     the union: their disc is gone the same tick and everything only under it
 *     drops, exactly as a killed radar satellite collapses its own coverage
 *     (feature f1, item 2). A teammate's coverage is never remembered as live dots.
 *  6. **The merged ore ids stay ASCENDING and deduped** — the callers rely on the
 *     order (`sensedState` binary-searches it; `src/main.ts` refills a set from it).
 *
 * Allegiance is `sameSide` throughout (`./allegiance`) — no `team` number is read
 * in the module under test and there is no mode check in it, which is exactly why
 * (1) can be an identity assertion rather than a hope.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, step, type Inputs, type WorldConfig } from './index';
import {
  pointSensed,
  rememberedOreIds,
  rememberedStationMask,
  sensedState,
  sensorSources,
  teamMembers,
  teamRememberedOreIds,
  teamRememberedStationMask,
  teamSensorSources,
  updateSensory,
  type SensedState,
} from './sensing';
import { SATELLITE, SHIP_SENSOR_RANGE, STATION_SENSOR_RANGE, CORE_HP, SHIP_RADIUS, SHIELD, STATION } from './constants';
import { stockTiers } from './upgrades';
import type { Asteroid, MiningStation, RadarSatellite, Ship, SensoryMemory, World } from './state';
import type { PlayerId } from '@shared/types';

// --- builders (hand-built worlds, mirroring ./sensing.test.ts plus a side) ---

function makeShip(id: number, team: number, pos: { x: number; y: number }, alive = true): Ship {
  return {
    id,
    team,
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

function makeStation(id: number, owner: number, team: number, pos: { x: number; y: number }): MiningStation {
  return {
    id,
    owner,
    team,
    pos: { ...pos },
    radius: STATION.radius,
    coreHp: CORE_HP,
    maxCoreHp: CORE_HP,
    alive: true,
    deathTime: -1,
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

function makeSat(id: number, owner: number, pos: { x: number; y: number }): RadarSatellite {
  return { id, owner, pos: { ...pos }, radius: SATELLITE.radius, hp: SATELLITE.hp, maxHp: SATELLITE.hp, orbitAngle: 0 };
}

function makeRock(id: number, pos: { x: number; y: number }, radius = 30): Asteroid {
  return { id, pos: { ...pos }, radius, ore: 3, maxOre: 3, crackStage: 0, mineBuffer: 0, home: null };
}

function makeWorld(
  ships: Ship[],
  stations: MiningStation[],
  sensory?: SensoryMemory,
  asteroids: Asteroid[] = [],
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
    projectiles: [],
    bounds: { width: 20000, height: 20000 },
    fieldRadius: 600,
    asteroidsPerWave: 0,
    match: { phase: 'live', wavesSpawned: 0, collapseTime: -1, eliminated: [], winner: null, endTime: -1 },
    ...(sensory ? { sensory } : {}),
  };
}

/**
 * A 2v2 board with the two sides' halves far apart, and the two ALLIES far apart
 * from each other — the geometry the whole feature turns on. Player 0 (viewer)
 * and player 2 (ally) share team 0; players 1 and 3 share team 1.
 *
 * Nothing of the viewer's reaches the ally's half: the separation is 12 000 units
 * against the largest disc in the game (`SATELLITE.sensorRange`), so anything the
 * viewer senses over there is the ally's coverage and can be nothing else.
 */
const FAR = 12_000;

function teamWorld(): {
  world: World;
  viewer: Ship;
  ally: Ship;
  enemyNear: Ship;
  enemyFar: Ship;
  viewerHome: MiningStation;
  allyHome: MiningStation;
  enemyHome: MiningStation;
} {
  const viewer = makeShip(0, 0, { x: 0, y: 0 });
  const enemyNear = makeShip(1, 1, { x: 4000, y: 0 });
  const ally = makeShip(2, 0, { x: FAR, y: 0 });
  const enemyFar = makeShip(3, 1, { x: FAR + SHIP_SENSOR_RANGE - 40, y: 0 });

  const viewerHome = makeStation(0, 0, 0, { x: 0, y: 0 });
  const enemyHomeNear = makeStation(1, 1, 1, { x: 4000, y: 0 });
  const allyHome = makeStation(2, 2, 0, { x: FAR, y: 0 });
  const enemyHome = makeStation(3, 3, 1, { x: FAR + STATION_SENSOR_RANGE - 40, y: 0 });

  const sensory: SensoryMemory = { seenStations: [0, 0, 0, 0], seenOre: [[], [], [], []] };
  const world = makeWorld(
    [viewer, enemyNear, ally, enemyFar],
    [viewerHome, enemyHomeNear, allyHome, enemyHome],
    sensory,
  );
  return { world, viewer, ally, enemyNear, enemyFar, viewerHome, allyHome, enemyHome };
}

// --- 1. FFA identity --------------------------------------------------------
//
// The oracle: `sensedState` EXACTLY as it read before a0-42 — own entities by id
// equality, one player's coverage, one player's stored memory. Kept verbatim
// rather than paraphrased, because the claim being tested is "FFA is byte-for-byte
// what it was", and a paraphrase would only test the paraphrase.

function sortedHas(list: readonly number[] | undefined, id: number): boolean {
  if (!list) return false;
  for (const v of list) if (v === id) return true;
  return false;
}

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
    if (sortedHas(oreMemory, a.id) || pointSensed(sources, a.pos, a.radius)) rememberedOre.push(a.id);
  }

  return { viewer, sources, ships, satellites, projectiles, rememberedStations, rememberedOre };
}

/** A real FFA match — `createWorld` defaults every `team` to the player's own id,
 *  so this board IS teams-of-one and needs no mode flag to say so. */
function ffaMatch(seed = 11): World {
  const config: WorldConfig = {
    seed,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Interceptor },
      { id: 2, shipClass: ShipClass.Excavator },
      { id: 3, shipClass: ShipClass.Hauler },
    ],
  };
  const world = createWorld(config);
  for (const s of world.ships) s.banked = 100;
  return world;
}

describe('FFA is untouched — teams-of-one collapses the union to self (a0-42)', () => {
  it('sensedState is field-for-field the pre-change per-player read, for every viewer', () => {
    const world = ffaMatch();
    const fly: Inputs = world.ships.map((s) => ({
      id: s.id,
      actions: [{ type: 'fire' as const, active: true, auto: false }],
    }));
    let sawOre = false;
    let sawShot = false;
    for (let t = 0; t < 40; t++) {
      step(world, t % 3 === 0 ? fly : []);
      for (const s of world.ships) {
        const sensed = sensedState(world, s.id);
        expect(sensed).toEqual(perPlayerSensedState(world, s.id));
        sawOre ||= sensed.rememberedOre.length > 0;
        sawShot ||= sensed.projectiles.length > 0;
      }
    }
    // …and the match under test was not a still life: every branch of the read
    // model had something to disagree about.
    expect(sawOre, 'the FFA fixture senses ore').toBe(true);
    expect(sawShot, 'the FFA fixture has shots in flight').toBe(true);
  });

  it('every team read is its per-player counterpart in FFA', () => {
    const world = ffaMatch(23);
    for (let t = 0; t < 20; t++) step(world, []);
    for (const s of world.ships) {
      expect(teamMembers(world, s.id)).toEqual([s.id]);
      expect(teamSensorSources(world, s.id)).toEqual(sensorSources(world, s.id));
      expect(teamRememberedStationMask(world, s.id)).toBe(rememberedStationMask(world, s.id));
      expect(teamRememberedOreIds(world, s.id)).toEqual(rememberedOreIds(world, s.id));
    }
  });

  it('an FFA rival is not a teammate however close their ids are', () => {
    const { world } = teamWorld();
    for (const s of world.ships) s.team = s.id; // the same board, run as FFA
    for (const p of world.stations) p.team = p.owner;
    expect(teamMembers(world, 0)).toEqual([0]);
    expect(sensedState(world, 0).ships).not.toContain(2);
    expect(sensedState(world, 0)).toEqual(perPlayerSensedState(world, 0));
  });
});

// --- 2. live entities under an ally's coverage ------------------------------

describe("an ally's coverage is the viewer's coverage (a0-42)", () => {
  it('reveals an enemy ship the viewer has no disc within 12 000 units of', () => {
    const { world, ally, enemyFar } = teamWorld();
    expect(sensedState(world, 0).ships).toContain(3);

    // The control: the same board with the ally moved home is the fog again, so
    // what lifted it was the ally's position and nothing else about the fixture.
    ally.pos.x = 0;
    expect(sensedState(world, 0).ships).not.toContain(3);
    expect(pointSensed(teamSensorSources(world, 0), enemyFar.pos)).toBe(false);
  });

  it("a teammate's own ship and home are never fogged, at any distance", () => {
    const { world } = teamWorld();
    const sensed = sensedState(world, 0);
    expect(sensed.ships).toContain(2); // the ally, 12 000 units away
    expect(sensed.rememberedStations).toContain(2); // and their home
    // …while the enemy home on the far side is known only because the ally's
    // station disc happens to cover it, not because it is "own side".
    expect(sensed.rememberedStations).toContain(3);
  });

  it("an ally's radar satellite is one of the discs the minimap draws", () => {
    const { world, allyHome } = teamWorld();
    const before = teamSensorSources(world, 0).length;
    allyHome.satellites = [makeSat(50, 2, { x: FAR + 114, y: 0 })];

    const sources = teamSensorSources(world, 0);
    expect(sources).toHaveLength(before + 1);
    const sat = sources.find((s) => s.kind === 'satellite')!;
    expect(sat.range).toBe(SATELLITE.sensorRange);
    // A disc bought by the team is a disc on the team's map, and it reveals what
    // it covers: a rival at the far edge of it, 900 units off the ally's home.
    const lurker = makeShip(4, 1, { x: FAR + SATELLITE.sensorRange, y: 0 });
    world.ships.push(lurker);
    expect(sensedState(world, 0).ships).toContain(4);
    expect(sensedState(world, 0).satellites).toContain(50);
  });

  it("an ally's shot in flight is sensed; an enemy's is still fog-gated", () => {
    const { world } = teamWorld();
    world.projectiles = [
      { id: 900, owner: 2, pos: { x: FAR, y: 0 }, vel: { x: 1, y: 0 }, life: 1, active: true, damage: 1, radius: 3 },
      { id: 901, owner: 1, pos: { x: -9000, y: 0 }, vel: { x: 1, y: 0 }, life: 1, active: true, damage: 1, radius: 3 },
    ] as World['projectiles'];
    const sensed = sensedState(world, 0);
    expect(sensed.projectiles).toContain(900); // own side, always
    expect(sensed.projectiles).not.toContain(901); // an enemy's, out in the dark
  });
});

// --- 3. remembered geography unions, 4. the WRITE stays per-player ----------

describe("an ally's remembered geography reaches the viewer (a0-42)", () => {
  it('a home only the ally ever scouted is on the viewer\'s minimap', () => {
    const { world } = teamWorld();
    updateSensory(world);

    // The ally's own memory grew; the viewer's did NOT — the write is per-player.
    expect(rememberedStationMask(world, 2) & (1 << 3)).not.toBe(0);
    expect(rememberedStationMask(world, 0) & (1 << 3)).toBe(0);

    // …and yet the viewer's SIDE remembers it, because the read unions.
    expect(teamRememberedStationMask(world, 0) & (1 << 3)).not.toBe(0);
    expect(sensedState(world, 0).rememberedStations).toContain(3);
  });

  it('an ore field only the ally has flown over is drawn in the remembered dimming', () => {
    const { world, ally } = teamWorld();
    const far = makeRock(300, { x: FAR + 3000, y: 0 });
    world.asteroids = [far];

    updateSensory(world);
    expect(sensedState(world, 0).rememberedOre).not.toContain(300); // nobody has been there

    ally.pos.x = FAR + 3000; // the ally scouts it
    updateSensory(world);
    expect(rememberedOreIds(world, 2)).toContain(300); // written to the SCOUT's memory
    expect(rememberedOreIds(world, 0)).not.toContain(300); // and to nobody else's

    ally.pos.x = FAR; // the ally flies home — static geography persists
    updateSensory(world);
    expect(teamRememberedOreIds(world, 0)).toContain(300);
    expect(sensedState(world, 0).rememberedOre).toContain(300);

    // The remembered half is the half a shared LIVE disc could not buy: no
    // coverage of either player reaches that rock now.
    expect(pointSensed(teamSensorSources(world, 0), far.pos, far.radius)).toBe(false);
  });

  it('an enemy scout shares nothing — the union is a side, not the board', () => {
    const { world, enemyFar } = teamWorld();
    const far = makeRock(301, { x: -9000, y: 0 });
    world.asteroids = [far];
    enemyFar.pos.x = -9000;
    updateSensory(world);

    expect(rememberedOreIds(world, 3)).toContain(301);
    expect(teamRememberedOreIds(world, 0)).not.toContain(301);
    expect(sensedState(world, 0).rememberedOre).not.toContain(301);
  });

  it('updateSensory writes exactly the per-player records it always did', () => {
    const { world } = teamWorld();
    // Fold the memory, then fold a SECOND world whose only difference is that the
    // teams are split — the stored records must be identical, because the write
    // pass has no notion of a side.
    updateSensory(world);
    const teamed = JSON.parse(JSON.stringify(world.sensory)) as SensoryMemory;

    const ffa = teamWorld().world;
    for (const s of ffa.ships) s.team = s.id;
    for (const p of ffa.stations) p.team = p.owner;
    updateSensory(ffa);

    expect(teamed).toEqual(ffa.sensory);
  });
});

// --- 5. a dead ally contributes nothing -------------------------------------

describe('the live/remembered split holds across the union (a0-42)', () => {
  it("a teammate's coverage collapses the tick their ship dies", () => {
    const { world, ally } = teamWorld();
    expect(sensedState(world, 0).ships).toContain(3);

    ally.alive = false; // killed this tick
    const sensed = sensedState(world, 0);
    expect(sensed.ships).not.toContain(3); // everything only under their disc drops
    expect(sensed.ships).not.toContain(2); // the dead ally is not a live dot either
    expect(teamSensorSources(world, 0).some((s) => s.kind === 'ship' && s.id === 2)).toBe(false);
  });

  it('a dead ally still contributes their surviving STATION disc, and nothing more', () => {
    const { world, ally, allyHome } = teamWorld();
    ally.alive = false;
    // Their home is alive, so its short disc stands — the enemy home 260 units
    // off it stays remembered, the enemy SHIP 480 units off it does not.
    expect(sensedState(world, 0).rememberedStations).toContain(3);
    expect(sensedState(world, 0).ships).not.toContain(3);

    allyHome.alive = false; // the home falls too: the side's far coverage is gone
    expect(teamSensorSources(world, 0)).toEqual(sensorSources(world, 0));
  });

  it("a teammate's LIVE coverage is never remembered as live dots", () => {
    const { world, ally } = teamWorld();
    updateSensory(world); // the ally's coverage is folded into geography memory
    ally.alive = false;

    // The enemy home stays (static geography, remembered by the side)…
    expect(sensedState(world, 0).rememberedStations).toContain(3);
    // …but the enemy SHIP that stood in the same place does not.
    expect(sensedState(world, 0).ships).not.toContain(3);
  });
});

// --- 6. the merged ore list: ascending, deduped -----------------------------

describe('the merged remembered-ore list keeps its order (a0-42)', () => {
  /** Three allies and one enemy, each with a hand-written memory — the merge
   *  under test is over the stored lists, so the board needs no rocks at all. */
  function memoryWorld(lists: number[][]): World {
    const ships = [
      makeShip(0, 0, { x: 0, y: 0 }),
      makeShip(1, 0, { x: 100, y: 0 }),
      makeShip(2, 0, { x: 200, y: 0 }),
      makeShip(3, 1, { x: 300, y: 0 }), // the enemy, whose list must not appear
    ];
    return makeWorld(ships, [], { seenStations: [0, 0, 0, 0], seenOre: lists });
  }

  it('merges ascending and dedupes across allies', () => {
    const world = memoryWorld([
      [1, 5, 9],
      [2, 5, 7],
      [5, 9, 11],
      [4, 6], // the enemy's
    ]);
    expect(teamRememberedOreIds(world, 0)).toEqual([1, 2, 5, 7, 9, 11]);
    // Every ally reads the same merged list — a side has one map, not three.
    expect(teamRememberedOreIds(world, 1)).toEqual([1, 2, 5, 7, 9, 11]);
    expect(teamRememberedOreIds(world, 2)).toEqual([1, 2, 5, 7, 9, 11]);
    expect(teamRememberedOreIds(world, 3)).toEqual([4, 6]);
  });

  it('the order does not depend on which ally is asking, or on empty lists', () => {
    const world = memoryWorld([[], [9, 12], [3], []]);
    expect(teamRememberedOreIds(world, 0)).toEqual([3, 9, 12]);
    expect(teamRememberedOreIds(world, 1)).toEqual([3, 9, 12]);
    expect(teamRememberedOreIds(world, 2)).toEqual([3, 9, 12]);
  });

  it('an identical list on every ally merges to itself, not to three copies', () => {
    const world = memoryWorld([
      [2, 4, 8],
      [2, 4, 8],
      [2, 4, 8],
      [],
    ]);
    expect(teamRememberedOreIds(world, 0)).toEqual([2, 4, 8]);
  });

  it('sensedState reports the merged set in the field order, ascending', () => {
    const world = memoryWorld([[7], [3], [11], []]);
    world.asteroids = [makeRock(11, { x: 40_000, y: 0 }), makeRock(3, { x: 41_000, y: 0 }), makeRock(7, { x: 42_000, y: 0 })];
    // `world.asteroids` is the iteration order and the field list is id-ordered
    // in a real match; here it is deliberately not, which is what makes the
    // assertion about the READ rather than about the fixture.
    expect(sensedState(world, 0).rememberedOre).toEqual([11, 3, 7]);
    expect(teamRememberedOreIds(world, 0)).toEqual([3, 7, 11]);
  });

  it('degrades gracefully: a memory with no ore lists at all', () => {
    const ships = [makeShip(0, 0, { x: 0, y: 0 }), makeShip(1, 0, { x: 100, y: 0 })];
    const bare = makeWorld(ships, [], { seenStations: [0, 0] });
    expect(teamRememberedOreIds(bare, 0)).toEqual([]);
    const none = makeWorld(ships, []); // no `sensory` at all
    expect(teamRememberedOreIds(none, 0)).toEqual([]);
    expect(teamRememberedStationMask(none, 0)).toBe(0);
  });
});

// --- the roster itself ------------------------------------------------------

describe('teamMembers — the roster every team read folds over (a0-42)', () => {
  it('is the viewer plus their allies, ascending, viewer included when they have no ship', () => {
    const { world } = teamWorld();
    expect(teamMembers(world, 0)).toEqual([0, 2]);
    expect(teamMembers(world, 2)).toEqual([0, 2]);
    expect(teamMembers(world, 1)).toEqual([1, 3]);

    // A hand-built world that gave the viewer no ship still lists the viewer, so
    // no read can silently lose the player doing the looking.
    const shipless = makeWorld([makeShip(2, 0, { x: 0, y: 0 })], [makeStation(0, 0, 0, { x: 0, y: 0 })]);
    expect(teamMembers(shipless, 0)).toEqual([0, 2]);
  });

  it('a derelict wreck is nobody\'s teammate', () => {
    const { world } = teamWorld();
    // The derelict-fill maps mark unused board positions as wrecks whose
    // `owner`/`team` is a board index (`./state`); it is on no side.
    const wreck = makeStation(4, 4, 4, { x: 200, y: 0 });
    wreck.derelict = true;
    wreck.alive = false;
    wreck.coreHp = 0;
    world.stations.push(wreck);
    expect(teamMembers(world, 0)).toEqual([0, 2]);
    // It is close enough to be sensed here, so it IS remembered — by coverage,
    // which is the fog rule, not by "own side", which would be the bug.
    expect(sensedState(world, 0).rememberedStations).toContain(4);
    wreck.pos.x = -9000;
    expect(sensedState(world, 0).rememberedStations).not.toContain(4);
  });
});
