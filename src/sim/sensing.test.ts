/**
 * src/sim/sensing.test.ts — the minimap fog-of-war sensed-set (RATIFIED feature
 * f1: "the minimap should be a fog-of-war thing, until players build a radar
 * satellite … and can be attacked").
 *
 * The contract checks from the brief:
 *   1. sensed-set math per source — coverage is the union of the ship's LOCAL
 *      sensor, the station's SHORT one, and each ALIVE satellite's LARGE one;
 *   2. remembered-vs-live split — static geography (stations) is remembered once
 *      seen and persists; live entities (ships, satellites, projectiles) show
 *      only under CURRENT coverage;
 *   3. coverage collapse on satellite death — a satellite's death removes its
 *      disc the same tick, so anything only it covered drops off at once;
 *   4. own entities are always sensed (cockpit / home knowledge);
 *   5. determinism — the memory fold reproduces exactly.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  pointSensed,
  rememberedOreIds,
  rememberedStationMask,
  sensedState,
  sensorSources,
  updateSensory,
} from './sensing';
import { SATELLITE, SHIP_SENSOR_RANGE, STATION_SENSOR_RANGE, CORE_HP, STATION, SHIP_RADIUS, SHIELD } from './constants';
import { stockTiers } from './upgrades';
import type { Asteroid, MiningStation, RadarSatellite, Ship, SensoryMemory, World } from './state';

// --- builders (hand-built worlds, station-relative so geometry reads direct) --

function makeShip(id: number, pos: { x: number; y: number }, alive = true): Ship {
  return {
    id,
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

function makeStation(id: number, owner: number, pos: { x: number; y: number }, alive = true): MiningStation {
  return {
    id,
    owner,
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

/** A rock at a point — static geography, so the memory pass should remember it. */
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
    bounds: { width: 8000, height: 8000 },
    fieldRadius: 600,
    asteroidsPerWave: 0,
    match: { phase: 'live', wavesSpawned: 0, collapseTime: -1, eliminated: [], winner: null, endTime: -1 },
    ...(sensory ? { sensory } : {}),
  };
}

// --- 1. sensed-set math per source -----------------------------------------

describe('sensor sources — the union of ship + station + alive satellites (f1)', () => {
  it('a live ship and station each cast one disc, at their named ranges', () => {
    const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [makeStation(0, 0, { x: 0, y: 0 })]);
    const sources = sensorSources(world, 0);
    expect(sources).toHaveLength(2);
    const ship = sources.find((s) => s.kind === 'ship')!;
    const station = sources.find((s) => s.kind === 'station')!;
    expect(ship.range).toBe(SHIP_SENSOR_RANGE);
    expect(station.range).toBe(STATION_SENSOR_RANGE);
  });

  it('an ALIVE satellite adds its LARGE disc; a dead one contributes nothing', () => {
    const station = makeStation(0, 0, { x: 0, y: 0 });
    station.satellites = [makeSat(50, 0, { x: 114, y: 0 })];
    const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [station]);

    let sources = sensorSources(world, 0);
    expect(sources).toHaveLength(3);
    expect(sources.find((s) => s.kind === 'satellite')!.range).toBe(SATELLITE.sensorRange);

    station.satellites![0]!.hp = 0; // killed — coverage collapses
    sources = sensorSources(world, 0);
    expect(sources).toHaveLength(2);
    expect(sources.some((s) => s.kind === 'satellite')).toBe(false);
  });

  it('a wrecked own station and a dead own ship cast nothing', () => {
    const world = makeWorld([makeShip(0, { x: 0, y: 0 }, false)], [makeStation(0, 0, { x: 0, y: 0 }, false)]);
    expect(sensorSources(world, 0)).toHaveLength(0);
  });

  it('pointSensed is the union test, surface-aware for a sized body', () => {
    const world = makeWorld([makeShip(0, { x: 0, y: 0 })], []);
    const sources = sensorSources(world, 0);
    expect(pointSensed(sources, { x: SHIP_SENSOR_RANGE - 1, y: 0 })).toBe(true);
    expect(pointSensed(sources, { x: SHIP_SENSOR_RANGE + 10, y: 0 })).toBe(false);
    // A 20-radius body whose centre is just outside still counts (surface inside).
    expect(pointSensed(sources, { x: SHIP_SENSOR_RANGE + 10, y: 0 }, 20)).toBe(true);
  });
});

// --- 2. live entities under current coverage; own always sensed ------------

describe('live entities — visible only under current coverage; own always (f1)', () => {
  it('an enemy ship in range is sensed; out of range it is not', () => {
    const near = makeWorld(
      [makeShip(0, { x: 0, y: 0 }), makeShip(1, { x: SHIP_SENSOR_RANGE - 50, y: 0 })],
      [makeStation(0, 0, { x: 0, y: 0 })],
    );
    expect(sensedState(near, 0).ships).toContain(1);

    const far = makeWorld(
      [makeShip(0, { x: 0, y: 0 }), makeShip(1, { x: 3000, y: 0 })],
      [makeStation(0, 0, { x: 0, y: 0 })],
    );
    expect(sensedState(far, 0).ships).not.toContain(1);
    expect(sensedState(far, 0).ships).toContain(0); // own ship always sensed
  });

  it("own station and own satellite are always in the viewer's sensed-set", () => {
    const station = makeStation(0, 0, { x: 0, y: 0 });
    station.satellites = [makeSat(50, 0, { x: 114, y: 0 })];
    const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [station]);
    const sensed = sensedState(world, 0);
    expect(sensed.rememberedStations).toContain(0);
    expect(sensed.satellites).toContain(50);
  });
});

// --- 3. coverage collapse on satellite death (the headline) ----------------

describe('coverage collapse on satellite death (f1, item 2)', () => {
  it('an enemy ship seen ONLY through a satellite drops off the instant it dies', () => {
    const station = makeStation(0, 0, { x: 0, y: 0 });
    const sat = makeSat(50, 0, { x: 114, y: 0 });
    station.satellites = [sat];
    // Enemy ship at 900,0: out of the ship (520) and station (300) discs, but
    // inside the satellite's 900 disc (dist from the sat ≈ 786).
    const world = makeWorld(
      [makeShip(0, { x: 0, y: 0 }), makeShip(1, { x: 900, y: 0 })],
      [station],
    );
    expect(sensedState(world, 0).ships).toContain(1);

    sat.hp = 0; // the satellite is destroyed
    expect(sensedState(world, 0).ships).not.toContain(1); // coverage gone, same read
  });
});

// --- 4. remembered-vs-live split, and persistence --------------------------

describe('remembered static geography vs live entities (f1, item 1)', () => {
  it('a station is remembered once its coverage is seen, and stays remembered after', () => {
    const own = makeStation(0, 0, { x: 0, y: 0 });
    const enemy = makeStation(1, 1, { x: 900, y: 0 });
    const sensory: SensoryMemory = { seenStations: [0] };
    const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [own, enemy], sensory);

    // Before any coverage reaches it: the far enemy home is NOT remembered.
    updateSensory(world);
    expect(rememberedStationMask(world, 0) & (1 << 1)).toBe(0);
    expect(sensedState(world, 0).rememberedStations).not.toContain(1);
    expect(sensedState(world, 0).rememberedStations).toContain(0); // own, always

    // Build a satellite whose LARGE disc reaches the enemy home, and fold memory.
    own.satellites = [makeSat(50, 0, { x: 114, y: 0 })];
    updateSensory(world);
    expect(rememberedStationMask(world, 0) & (1 << 1)).not.toBe(0);
    expect(sensedState(world, 0).rememberedStations).toContain(1);

    // Kill the satellite: LIVE coverage of the enemy home collapses, but the
    // REMEMBERED bit persists — a scouted home stays on the minimap.
    own.satellites![0]!.hp = 0;
    updateSensory(world); // monotonic: never un-remembers
    expect(sensedState(world, 0).rememberedStations).toContain(1);
    // …and yet a live entity there is no longer sensed once its cover is gone.
    const withEnemyShip = makeWorld(
      [makeShip(0, { x: 0, y: 0 }), makeShip(1, { x: 900, y: 0 })],
      [own, enemy],
      sensory,
    );
    expect(sensedState(withEnemyShip, 0).ships).not.toContain(1);
    expect(sensedState(withEnemyShip, 0).rememberedStations).toContain(1);
  });

  it('sensedState degrades gracefully with no stored memory (currently-covered + own)', () => {
    const own = makeStation(0, 0, { x: 0, y: 0 });
    const enemyClose = makeStation(1, 1, { x: STATION_SENSOR_RANGE - 10, y: 0 });
    const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [own, enemyClose]); // no sensory
    const sensed = sensedState(world, 0);
    expect(sensed.rememberedStations).toContain(0); // own
    expect(sensed.rememberedStations).toContain(1); // currently covered by the station disc
  });
});

// --- 4b. ore fields are static geography too (developer report p15) --------
//
// The p15 report: "I built the radar but I still had fog of war over what I was
// discovering." The radar's coverage was never the bug (it grows — section 1);
// the bug was that ORE, the thing a player actually discovers, was gated on
// CURRENT coverage like a live ship, so every field scouted went dark again the
// moment the player flew home. A rock never moves — it only depletes — so it is
// static geography and takes the same remember-once-seen rule a home does.

describe('ore fields are REMEMBERED once scouted (developer report p15)', () => {
  it('a rock under coverage is remembered, and STAYS remembered after coverage leaves', () => {
    const own = makeStation(0, 0, { x: 0, y: 0 });
    const ship = makeShip(0, { x: 0, y: 0 });
    const far = makeRock(300, { x: 5000, y: 0 });
    const sensory: SensoryMemory = { seenStations: [0], seenOre: [[]] };
    const world = makeWorld([ship], [own], sensory, [far]);

    // Home: the distant field is outside every disc — unknown.
    updateSensory(world);
    expect(rememberedOreIds(world, 0)).not.toContain(300);
    expect(sensedState(world, 0).rememberedOre).not.toContain(300);

    // Fly out to it: it enters the ship's own sensor and is written to memory.
    ship.pos.x = 5000;
    updateSensory(world);
    expect(rememberedOreIds(world, 0)).toContain(300);

    // Fly home. THE REGRESSION: before this fix the field went dark again here.
    ship.pos.x = 0;
    updateSensory(world);
    expect(rememberedOreIds(world, 0)).toContain(300); // monotonic — never forgotten
    expect(sensedState(world, 0).rememberedOre).toContain(300);
  });

  it('a radar satellite permanently maps every rock inside its disc', () => {
    const own = makeStation(0, 0, { x: 0, y: 0 });
    const inDisc = makeRock(301, { x: SATELLITE.sensorRange - 50, y: 0 });
    const outside = makeRock(302, { x: SATELLITE.sensorRange + 400, y: 0 });
    const sensory: SensoryMemory = { seenStations: [0], seenOre: [[]] };
    const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [own], sensory, [inDisc, outside]);

    updateSensory(world);
    expect(rememberedOreIds(world, 0)).not.toContain(301); // ship+station don't reach

    own.satellites = [makeSat(50, 0, { x: 114, y: 0 })];
    updateSensory(world);
    expect(rememberedOreIds(world, 0)).toContain(301);
    expect(rememberedOreIds(world, 0)).not.toContain(302); // still beyond the disc

    // The satellite dies: LIVE coverage collapses, but what it mapped is kept —
    // the ore it revealed was bought and paid for.
    own.satellites![0]!.hp = 0;
    updateSensory(world);
    expect(sensorSources(world, 0).some((s) => s.kind === 'satellite')).toBe(false);
    expect(sensedState(world, 0).rememberedOre).toContain(301);
  });

  it('remembers a rock whose SURFACE enters coverage, like a sized station body', () => {
    const own = makeStation(0, 0, { x: 0, y: 0 });
    const grazing = makeRock(303, { x: SHIP_SENSOR_RANGE + 20, y: 0 }, 40); // centre out, edge in
    const sensory: SensoryMemory = { seenStations: [0], seenOre: [[]] };
    const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [own], sensory, [grazing]);
    updateSensory(world);
    expect(rememberedOreIds(world, 0)).toContain(303);
  });

  it('a remembered rock that is mined out of existence stops being reported', () => {
    const own = makeStation(0, 0, { x: 0, y: 0 });
    const rock = makeRock(304, { x: 100, y: 0 });
    const sensory: SensoryMemory = { seenStations: [0], seenOre: [[]] };
    const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [own], sensory, [rock]);
    updateSensory(world);
    expect(sensedState(world, 0).rememberedOre).toContain(304);

    world.asteroids = []; // `step` filters a depleted rock out of the field
    // The raw memory still holds the id, but the resolved read-model does not —
    // so no consumer ever draws a phantom field over empty space.
    expect(rememberedOreIds(world, 0)).toContain(304);
    expect(sensedState(world, 0).rememberedOre).not.toContain(304);
  });

  it('the memory is per-player: one scout does not reveal the field to everyone', () => {
    const own = makeStation(0, 0, { x: 0, y: 0 });
    const theirs = makeStation(1, 1, { x: 6000, y: 0 });
    const rock = makeRock(305, { x: 100, y: 0 });
    const sensory: SensoryMemory = { seenStations: [0, 0], seenOre: [[], []] };
    const world = makeWorld(
      [makeShip(0, { x: 0, y: 0 }), makeShip(1, { x: 6000, y: 0 })],
      [own, theirs],
      sensory,
      [rock],
    );
    updateSensory(world);
    expect(rememberedOreIds(world, 0)).toContain(305);
    expect(rememberedOreIds(world, 1)).not.toContain(305);
  });

  it('degrades gracefully: a memory built without an ore list still folds', () => {
    const own = makeStation(0, 0, { x: 0, y: 0 });
    const rock = makeRock(306, { x: 100, y: 0 });
    const sensory = { seenStations: [0] } as SensoryMemory; // no `seenOre` at all
    const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [own], sensory, [rock]);
    expect(() => updateSensory(world)).not.toThrow();
    expect(rememberedOreIds(world, 0)).toContain(306);

    // …and with NO memory at all, the read model falls back to current coverage.
    const bare = makeWorld([makeShip(0, { x: 0, y: 0 })], [own], undefined, [rock]);
    expect(sensedState(bare, 0).rememberedOre).toContain(306);
  });
});

// --- 5. determinism --------------------------------------------------------

describe('sensory memory — determinism (f1, GDD §4.8)', () => {
  it('the memory fold reproduces exactly from the same world', () => {
    const build = (): SensoryMemory => {
      const own = makeStation(0, 0, { x: 0, y: 0 });
      own.satellites = [makeSat(50, 0, { x: 114, y: 0 })];
      const enemy = makeStation(1, 1, { x: 800, y: 0 });
      const sensory: SensoryMemory = { seenStations: [0] };
      const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [own, enemy], sensory);
      updateSensory(world);
      return world.sensory!;
    };
    expect(build()).toEqual(build());
  });

  it('the remembered-ore list is ASCENDING however the field is ordered', () => {
    const fold = (order: number[]): readonly number[] => {
      const own = makeStation(0, 0, { x: 0, y: 0 });
      const sensory: SensoryMemory = { seenStations: [0], seenOre: [[]] };
      const rocks = order.map((id, i) => makeRock(id, { x: 40 * i, y: 0 }));
      const world = makeWorld([makeShip(0, { x: 0, y: 0 })], [own], sensory, rocks);
      updateSensory(world);
      return rememberedOreIds(world, 0);
    };
    // Same ids, arriving in different field order ⇒ the same stored list, sorted.
    expect(fold([7, 3, 9, 1])).toEqual([1, 3, 7, 9]);
    expect(fold([1, 3, 7, 9])).toEqual([1, 3, 7, 9]);
  });
});
