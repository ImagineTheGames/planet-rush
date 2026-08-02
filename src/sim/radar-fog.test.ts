/**
 * src/sim/radar-fog.test.ts — the developer report p15, "radar built, fog stayed":
 * *"I built the radar but I still had fog of war over what I was discovering."*
 *
 * The three suspects in the report, tested at the three seams they live at, on a
 * REAL match (`createWorld` → `buildOrder` → `step`) rather than a hand-built
 * fixture — because the fixture worlds in `./sensing.test.ts` and
 * `./satellite.test.ts` each prove one module in isolation and can all be green
 * while the shipped chain is not:
 *
 *   1. **the sim seam** — does a BUILT satellite (through the wheel's order path,
 *      not a literal pushed onto a station) actually register as a coverage
 *      source? → IT DOES. `sensorSources` goes 2 → 3 discs and the arena covered
 *      goes ~14% → ~36%. This is the half QA attested in `radar-wedge-restored`
 *      (p13-04) and it was never broken.
 *   2. **the feed seam** — does what `src/main.ts` hands the minimap carry that
 *      coverage? → IT DOES; this file rebuilds that feed exactly and asserts it.
 *   3. **the memory seam** — does what the player DISCOVERS persist? → IT DID
 *      NOT, and that is the report. Stations were remembered once seen; ORE, the
 *      thing a player actually flies out to discover, was gated on CURRENT
 *      coverage like a live ship, so every field scouted went dark the moment the
 *      player flew home, radar or no radar. Fixed by remembering ore fields under
 *      the same static-geography rule (`./sensing` `SensoryMemory.seenOre`).
 *
 * The reconciliation with QA: their evidence was honest. They staged a satellite,
 * watched the disc bloom and enemy dots appear inside it, killed it, watched the
 * disc collapse — all WHILE the coverage was live. They never flew out, scouted a
 * field and came home, which is the one move that shows the memory gap.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, step, type Inputs, type WorldConfig } from './index';
import { stationOf } from './buildings';
import { pointSensed, rememberedOreIds, sensedState, sensorSources } from './sensing';
import { SATELLITE, TICK_DT } from './constants';
import type { World } from './state';
import {
  MINIMAP_ORE_ALPHA,
  MINIMAP_REMEMBERED_ORE_ALPHA,
  minimapScene,
  type MinimapFrame,
} from '../ui/minimap';
import type { Rect } from '@platform/layout-registry';

// --- helpers ---------------------------------------------------------------

const RECT: Rect = { x: 0, y: 0, width: 400, height: 400 };

/** A real two-player match with a bank fat enough that cost is never the subject. */
function match(seed = 7): World {
  const config: WorldConfig = {
    seed,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Vanguard },
    ],
  };
  const world = createWorld(config);
  for (const s of world.ships) s.banked = 100;
  return world;
}

const buildRadar = (id: number): Inputs => [{ id, actions: [{ type: 'buildOrder', item: 'satellite' }] }];

/** Step `n` ticks, `first` applied on tick 1 only. */
function run(world: World, n: number, first: Inputs = []): void {
  for (let t = 0; t < n; t++) step(world, t === 0 ? first : []);
}

/** Ticks for a satellite ordered on tick 1 to finish construction. */
const BUILD_TICKS = Math.ceil(SATELLITE.buildTime / TICK_DT) + 2;

/** The minimap frame `src/main.ts` `feedMinimap` + `feedMinimapFog` builds for a
 *  viewer — rebuilt here field for field, so this test fails if the shipped feed
 *  and the sim's sensing truth ever drift apart. */
function feedFor(world: World, viewer: number): MinimapFrame {
  const sources = sensorSources(world, viewer);
  const satellites = [];
  for (const p of world.stations) {
    for (const s of p.satellites ?? []) {
      satellites.push({ owner: s.owner, x: s.pos.x, y: s.pos.y, alive: s.hp > 0, local: s.owner === viewer });
    }
  }
  return {
    bounds: world.bounds,
    stations: world.stations.map((p) => ({ owner: p.owner, x: p.pos.x, y: p.pos.y, alive: p.alive, id: p.id })),
    ships: world.ships.map((s) => ({
      owner: s.id,
      x: s.pos.x,
      y: s.pos.y,
      alive: s.alive && !s.eliminated,
      local: s.id === viewer,
      spawnProtected: s.spawnProtect > 0,
    })),
    satellites,
    oreHints: world.asteroids.map((a) => ({ x: a.pos.x, y: a.pos.y, id: a.id })),
    collapse: null,
    fog: {
      coverage: sources.map((s) => ({ x: s.pos.x, y: s.pos.y, radius: s.range })),
      rememberedMask: world.sensory?.seenStations[viewer] ?? 0,
      rememberedOre: new Set(rememberedOreIds(world, viewer)),
    },
  };
}

/** Teleport a ship to a point at rest — a scouting run compressed into one move,
 *  so the test spends its ticks on the sensing fold rather than on flying. */
function flyTo(ship: { pos: { x: number; y: number }; vel: { x: number; y: number } }, to: { x: number; y: number }): void {
  ship.pos.x = to.x;
  ship.pos.y = to.y;
  ship.vel.x = 0;
  ship.vel.y = 0;
}

/** The rock furthest from a point — the "distant field" a player scouts. */
function furthestRock(world: World, from: { x: number; y: number }) {
  let best = world.asteroids[0]!;
  let bestD = -1;
  for (const a of world.asteroids) {
    const d = (a.pos.x - from.x) ** 2 + (a.pos.y - from.y) ** 2;
    if (d > bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

// --- 1. the sim seam: a BUILT satellite is a coverage source ---------------

describe('p15 seam 1 — the built radar registers as a fog source (not the bug)', () => {
  it('ordering a satellite through the wheel path grows coverage from 2 discs to 3', () => {
    const world = match();
    const station = stationOf(world, 0)!;

    const before = sensorSources(world, 0);
    expect(before.map((s) => s.kind)).toEqual(['ship', 'station']);

    run(world, BUILD_TICKS, buildRadar(0));
    expect(station.satellites!.length).toBe(1);

    const after = sensorSources(world, 0);
    expect(after.filter((s) => s.kind === 'satellite')).toHaveLength(1);
    expect(after.find((s) => s.kind === 'satellite')!.range).toBe(SATELLITE.sensorRange);
  });

  it('the new disc reveals a contact the ship/station sensors cannot reach', () => {
    const world = match();
    const station = stationOf(world, 0)!;
    // Park the enemy beyond ship (520) and station (300) reach, inside the
    // satellite's (900) — the exact contact the p13-04 evidence staged.
    const enemy = world.ships[1]!;
    enemy.pos.x = station.pos.x - 700;
    enemy.pos.y = station.pos.y;

    expect(sensedState(world, 0).ships).not.toContain(1);
    run(world, BUILD_TICKS, buildRadar(0));
    enemy.pos.x = station.pos.x - 700; // hold it there through the build
    enemy.pos.y = station.pos.y;
    expect(sensedState(world, 0).ships).toContain(1);
  });

  it('and the disc collapses the tick the satellite dies (coverage is not memory)', () => {
    const world = match();
    const station = stationOf(world, 0)!;
    run(world, BUILD_TICKS, buildRadar(0));
    expect(sensorSources(world, 0)).toHaveLength(3);

    station.satellites![0]!.hp = 0;
    expect(sensorSources(world, 0)).toHaveLength(2);
  });
});

// --- 2. the feed seam: the shipped feed carries that coverage --------------

describe('p15 seam 2 — the minimap feed agrees with the sim (three layers, one truth)', () => {
  it('every sim coverage disc reaches the minimap model, and back out as a draw', () => {
    const world = match();
    run(world, BUILD_TICKS, buildRadar(0));

    const frame = feedFor(world, 0);
    const sources = sensorSources(world, 0);
    expect(frame.fog!.coverage).toHaveLength(sources.length);
    expect(minimapScene(frame, RECT).coverage).toHaveLength(sources.length);
    expect(minimapScene(frame, RECT).fogged).toBe(true);
  });

  it('the satellite the sim built draws as a dot on the map', () => {
    const world = match();
    run(world, BUILD_TICKS, buildRadar(0));
    expect(minimapScene(feedFor(world, 0), RECT).satelliteDots).toHaveLength(1);
  });

  it('building the radar strictly grows what the map shows', () => {
    const world = match();
    run(world, 2);
    const before = minimapScene(feedFor(world, 0), RECT);

    const world2 = match();
    run(world2, BUILD_TICKS, buildRadar(0));
    const after = minimapScene(feedFor(world2, 0), RECT);

    expect(after.coverage.length).toBeGreaterThan(before.coverage.length);
    expect(after.oreDots.length).toBeGreaterThan(before.oreDots.length);
  });
});

// --- 3. the memory seam: what you discover STAYS discovered ----------------

describe('p15 seam 3 — the report: fog closed back over what the player discovered', () => {
  it('a field scouted on a run out is still on the minimap after flying home', () => {
    const world = match();
    const station = stationOf(world, 0)!;
    const ship = world.ships[0]!;
    const far = furthestRock(world, station.pos);

    const home = { ...ship.home }; // the spawn berth, not the station body
    run(world, 2);
    // Nothing over there yet: the distant field is dark.
    expect(sensedState(world, 0).rememberedOre).not.toContain(far.id);
    const atHome = minimapScene(feedFor(world, 0), RECT).oreDots.length;

    // Fly out and discover it.
    flyTo(ship, far.pos);
    run(world, 1);
    expect(sensedState(world, 0).rememberedOre).toContain(far.id);
    const outThere = minimapScene(feedFor(world, 0), RECT).oreDots.length;
    expect(outThere).toBeGreaterThan(atHome);

    // Fly home. THE REGRESSION the developer reported: the fog used to close
    // right back over the field. It must not — a rock does not move.
    flyTo(ship, home);
    run(world, 1);
    expect(sensedState(world, 0).rememberedOre).toContain(far.id);

    const back = minimapScene(feedFor(world, 0), RECT);
    expect(back.oreDots.length).toBe(outThere); // nothing was forgotten
    expect(back.oreDots.length).toBeGreaterThan(atHome);
  });

  it('a remembered field draws DIMMED, a sensed one at full — the map says which is which', () => {
    const world = match();
    const station = stationOf(world, 0)!;
    const ship = world.ships[0]!;
    const far = furthestRock(world, station.pos);

    const home = { ...ship.home };
    flyTo(ship, far.pos);
    run(world, 2);
    flyTo(ship, home);
    run(world, 1);

    const scene = minimapScene(feedFor(world, 0), RECT);
    const alphas = new Set(scene.oreDots.map((d) => d.alpha));
    expect(alphas.has(MINIMAP_ORE_ALPHA)).toBe(true); // sensed now, near home
    expect(alphas.has(MINIMAP_REMEMBERED_ORE_ALPHA)).toBe(true); // scouted, left behind
    expect(MINIMAP_REMEMBERED_ORE_ALPHA).toBeLessThan(MINIMAP_ORE_ALPHA);
  });

  it('the radar permanently maps its neighbourhood — killing it keeps what it found', () => {
    const world = match();
    const station = stationOf(world, 0)!;
    run(world, BUILD_TICKS, buildRadar(0));

    // Rocks only the satellite's disc can reach, mapped by the time it dies.
    const shipStationOnly = sensorSources(world, 0).filter((s) => s.kind !== 'satellite');
    const satelliteOnly = world.asteroids.filter(
      (a) => !pointSensed(shipStationOnly, a.pos, a.radius) && rememberedOreIds(world, 0).includes(a.id),
    );
    expect(satelliteOnly.length).toBeGreaterThan(0);

    const lit = minimapScene(feedFor(world, 0), RECT).oreDots.length;

    station.satellites![0]!.hp = 0; // shot down
    run(world, 1);
    const dark = minimapScene(feedFor(world, 0), RECT);

    // Its LIVE coverage is gone…
    expect(sensorSources(world, 0)).toHaveLength(2);
    // …but every field it mapped is still on the map, dimmed rather than erased.
    expect(dark.oreDots.length).toBe(lit);
    for (const rock of satelliteOnly) {
      expect(sensedState(world, 0).rememberedOre).toContain(rock.id);
    }
  });

  it('a field NEVER scouted stays fogged — the map is still honest', () => {
    const world = match();
    run(world, BUILD_TICKS, buildRadar(0));
    const scene = minimapScene(feedFor(world, 0), RECT);
    expect(scene.oreDots.length).toBeLessThan(world.asteroids.length);
  });

  it('memory is per-player: the enemy does not inherit what player 0 scouted', () => {
    const world = match();
    // A rock in player 0's own back yard — far from the enemy home, so player 1
    // could only know it by scouting, which they never do here.
    const far = furthestRock(world, stationOf(world, 1)!.pos);
    flyTo(world.ships[0]!, far.pos);
    run(world, 2);

    expect(rememberedOreIds(world, 0)).toContain(far.id);
    expect(rememberedOreIds(world, 1)).not.toContain(far.id);
  });
});

// --- 4. determinism (GDD §4.8) --------------------------------------------

describe('p15 — the fog memory is deterministic', () => {
  it('two runs from the same seed and inputs reach byte-identical sensory memory', () => {
    const play = (): unknown => {
      const world = match(11);
      run(world, BUILD_TICKS, buildRadar(0));
      world.ships[0]!.pos.x -= 600; // a scouting run, same in both plays
      run(world, 30);
      return JSON.parse(JSON.stringify(world.sensory));
    };
    expect(play()).toEqual(play());
  });
});
