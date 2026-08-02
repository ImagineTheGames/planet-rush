/**
 * src/sim/sensing.ts — the ONE sensing truth. OWNER: Gameplay Engineer.
 *
 * RATIFIED developer feature f1: *"The minimap should be a fog-of-war thing,
 * until players build a radar satellite (it orbits around the mining station) and
 * can be attacked."* This module is the sim's answer to **what does a player
 * currently sense?** — one honest coverage model every consumer reads, so the
 * minimap, the debug hook, and (later) any HUD share a single source of truth
 * instead of each inventing fog.
 *
 * A player's **sensed-set** is the union of three coverage discs (feature f1,
 * item 1):
 *
 *  1. their own **ship**'s local sensor  (`SHIP_SENSOR_RANGE`, a modest baseline);
 *  2. their own living **stations**' short local sensor (`STATION_SENSOR_RANGE`);
 *  3. each ALIVE **radar satellite** they own (`SATELLITE.sensorRange`, LARGE).
 *
 * Two kinds of thing are sensed differently, and the split is the whole mechanic:
 *
 *  - **Static geography** (station positions AND ore fields) is REMEMBERED once
 *    seen — it stays on the minimap after coverage moves off it, because a home
 *    does not move, a wreck stays on the map all match (GDD §2.7), and neither
 *    does a rock: an asteroid never moves, it only depletes. That persistence is
 *    the only stored state here: `world.sensory` (`SensoryMemory`), a per-player
 *    bitmask of station board-ids plus a per-player list of asteroid ids ever
 *    sensed, both grown by {@link updateSensory} each tick.
 *  - **Live entities** (ships, projectiles, satellites) are visible ONLY under
 *    CURRENT coverage — recomputed every read, no memory. So the instant a radar
 *    satellite dies, the large disc it projected is gone and everything that was
 *    only under it drops off the sensed-set the same tick (feature f1, item 2:
 *    "its destruction collapses that coverage immediately").
 *
 * A player always senses **their own** live entities and stations (cockpit /
 * home knowledge, the same rule the bot perception uses for its own ship and
 * station — GDD §2.2). Enemies and neutral bodies are fog-gated.
 *
 * Determinism (GDD §4.8): every coverage test is a squared-distance compare
 * (`dx*dx + dy*dy <= reach*reach`, no sqrt), fixed iteration order, no RNG. The
 * memory is plain integers, derived purely from world state, so a replay
 * reproduces it exactly. The read model ({@link sensedState}) allocates fresh
 * arrays — it is an off-hot-path selector like `muzzleFlashes` (`./combat-view`),
 * not part of the sim's zero-allocation step.
 *
 * This module never writes gameplay state — only `world.sensory` (its own memory)
 * in {@link updateSensory}. It is a lens, not a rule.
 */

import type { PlayerId, Vec2 } from '@shared/types';
import { SATELLITE, SHIP_SENSOR_RANGE, STATION_SENSOR_RANGE } from './constants';
import type { Ship, World } from './state';

// ---------------------------------------------------------------------------
// Coverage sources
// ---------------------------------------------------------------------------

/** One coverage disc a player projects this tick — the "per source" the feature's
 *  sensed-set math is the union of (feature f1, item 1; the tests assert each
 *  source's contribution independently). Plain data, so a debug hook can read it. */
export interface SensorSource {
  /** Which kind of body casts this disc. */
  readonly kind: 'ship' | 'station' | 'satellite';
  /** The casting body's id — the owner's slot for a ship, the board id for a
   *  station, the satellite's own entity id for a satellite. */
  readonly id: number;
  /** Disc centre (the body's position this tick). */
  readonly pos: Vec2;
  /** Disc radius (world units). */
  readonly range: number;
}

/** The ship in a slot, or null. Local so this module keeps a minimal import
 *  surface and no ordering assumptions (mirrors `buildings.shipOf`). */
function shipOf(world: World, id: PlayerId): Ship | null {
  for (const s of world.ships) {
    if (s.id === id) return s;
  }
  return null;
}

/**
 * The coverage discs `viewer` projects this tick — their own ship (while alive),
 * each of their own LIVING stations, and each ALIVE radar satellite on those
 * stations (feature f1, item 1). A dead ship, a wrecked station, and a killed
 * satellite (hp ≤ 0) each contribute nothing — which is exactly how a satellite's
 * death collapses its coverage.
 *
 * Fresh array; call once per read and reuse it (`./sensing` does). Order is fixed
 * (ship, then stations in board order, each station's satellites in array order)
 * for deterministic downstream folds.
 */
export function sensorSources(world: World, viewer: PlayerId): SensorSource[] {
  const out: SensorSource[] = [];

  const ship = shipOf(world, viewer);
  if (ship && ship.alive) {
    out.push({ kind: 'ship', id: viewer, pos: ship.pos, range: SHIP_SENSOR_RANGE });
  }

  for (const station of world.stations) {
    if (station.owner !== viewer || !station.alive) continue;
    out.push({ kind: 'station', id: station.id, pos: station.pos, range: STATION_SENSOR_RANGE });
    if (station.satellites) {
      for (const sat of station.satellites) {
        if (sat.hp <= 0) continue; // dead satellite: no coverage (the collapse)
        out.push({ kind: 'satellite', id: sat.id, pos: sat.pos, range: SATELLITE.sensorRange });
      }
    }
  }

  return out;
}

/**
 * Whether a point lies inside ANY of `sources` — the union coverage test. A
 * `bodyRadius` lets a body count as sensed when its SURFACE (not just its centre)
 * enters coverage, which matters for large bodies like a station: a shot standing
 * on a home should read it as sensed. Squared throughout (no sqrt), deterministic.
 */
export function pointSensed(sources: readonly SensorSource[], point: Vec2, bodyRadius = 0): boolean {
  for (const s of sources) {
    const dx = s.pos.x - point.x;
    const dy = s.pos.y - point.y;
    const reach = s.range + bodyRadius;
    if (dx * dx + dy * dy <= reach * reach) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The sensed-set read model
// ---------------------------------------------------------------------------

/**
 * Everything `viewer` senses this tick — the render layer's fog seam (feature f1;
 * the minimap consumes it, the debug hook reads it). Plain readonly data, freshly
 * allocated: a selector, never aliasing the world tree.
 *
 * The live sets (`ships`, `satellites`, `projectiles`) are CURRENT-coverage only
 * — recomputed every read, so they vanish the tick their coverage does. The
 * `rememberedStations` set is the REMEMBERED static geography: every station this
 * player has ever sensed (plus the ones they sense right now, plus their own),
 * which is why a scouted enemy home stays on the minimap after you fly away.
 */
export interface SensedState {
  readonly viewer: PlayerId;
  /** The coverage discs this set was computed from (feature f1's "per source"). */
  readonly sources: readonly SensorSource[];
  /** Ship ids currently sensed — the viewer's own (alive) plus any alive ship
   *  under current coverage. */
  readonly ships: readonly PlayerId[];
  /** Radar-satellite ids currently sensed — the viewer's own plus any alive
   *  satellite under current coverage (a high-value thing to spot). */
  readonly satellites: readonly number[];
  /** Live projectile ids currently sensed — the viewer's own plus any active
   *  shot under current coverage. */
  readonly projectiles: readonly number[];
  /** Station board-ids REMEMBERED — seen at least once (or owned, or sensed now).
   *  Static geography persists; a wreck stays remembered all match. */
  readonly rememberedStations: readonly number[];
  /** Asteroid ids REMEMBERED — scouted at least once (or sensed now). The other
   *  half of static geography: an ore field a player has flown over stays on
   *  their minimap after they leave, so scouting a field is worth doing once. Ids
   *  only, so a rock mined out of existence simply stops being drawn — a
   *  remembered field is never a phantom the player can fly to and find empty. */
  readonly rememberedOre: readonly number[];
}

/**
 * Build `viewer`'s sensed-set for the current tick (feature f1). Own live
 * entities are always included (cockpit knowledge); enemy/neutral ones only under
 * current coverage. Remembered stations come from `world.sensory` (the persistent
 * memory {@link updateSensory} maintains) unioned with the ones covered right now
 * and the viewer's own — so the set is correct even on the very first tick, and
 * degrades gracefully to "currently covered + own" when a foreign world carries no
 * `sensory` memory at all.
 */
export function sensedState(world: World, viewer: PlayerId): SensedState {
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
    // A station is remembered if the viewer owns it, has ever sensed it (the
    // stored mask), or senses it right now (surface-aware — a body has size).
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

  // Ore fields: remembered from the stored list, unioned with the rocks under
  // coverage right now (surface-aware — a rock has size), so the set is correct on
  // the very first tick and degrades to "currently covered" for a foreign world
  // that carries no memory. `world.asteroids` is the iteration order, so the
  // result is ascending by construction (the field list is id-ordered) and holds
  // only rocks that still exist — a mined-out one drops out on its own.
  const oreMemory = world.sensory?.seenOre?.[viewer];
  const rememberedOre: number[] = [];
  for (const a of world.asteroids) {
    if (sortedHas(oreMemory, a.id) || pointSensed(sources, a.pos, a.radius)) {
      rememberedOre.push(a.id);
    }
  }

  return { viewer, sources, ships, satellites, projectiles, rememberedStations, rememberedOre };
}

// ---------------------------------------------------------------------------
// The per-tick memory pass
// ---------------------------------------------------------------------------

/** Is `id` in an ASCENDING id list? Binary search, so the fold can skip the disc
 *  test for every rock a player already remembers — the reason the ore pass costs
 *  a lookup per rock rather than a coverage test per rock once a field is known.
 *  A missing list (a foreign memory) remembers nothing. */
function sortedHas(list: readonly number[] | undefined, id: number): boolean {
  if (!list) return false;
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = list[mid]!;
    if (v === id) return true;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** Insert `id` into an ASCENDING id list, keeping it sorted (no-op if present).
 *  Ids come from `nextEntityId`, which only counts up, so this appends far more
 *  often than it splices. Deterministic: the result depends only on the set of
 *  ids inserted, never on the order they arrived. */
function sortedInsert(list: number[], id: number): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]! < id) lo = mid + 1;
    else hi = mid;
  }
  if (list[lo] === id) return;
  list.splice(lo, 0, id);
}

/**
 * Fold this tick's coverage into the persistent "remembered geography" memory
 * (feature f1, item 1). For every live player, any station whose body their
 * coverage reaches has its board-id bit set in `world.sensory.seenStations`, and
 * any ASTEROID their coverage reaches has its id inserted into
 * `world.sensory.seenOre[player]` — and bits are only ever SET and ids only ever
 * inserted, never cleared, so remembered geography grows monotonically as a match
 * is explored and never un-remembers a home already scouted (a wreck included) or
 * an ore field already found.
 *
 * The ore half is why a scouting run pays off: a player who flies out to a distant
 * field keeps it on their minimap after they fly home, and a radar satellite
 * permanently maps every rock inside its disc rather than lighting them only while
 * it lives (developer report p15 — the fog kept closing over what was discovered).
 * Rocks already remembered skip the coverage test entirely (a binary-search
 * lookup instead), so the pass gets CHEAPER as a field becomes known.
 *
 * A no-op when the world carries no `sensory` memory (a foreign/hand-built world),
 * exactly like `ledgerAdd` — `createWorld` always attaches one. Runs once per
 * `step`, after all bodies have their final positions for the tick, so a station
 * scouted this tick is remembered from this tick. Determinism: squared-distance
 * tests, fixed order, no RNG.
 */
export function updateSensory(world: World): void {
  const mem = world.sensory;
  if (!mem) return;

  for (const ship of world.ships) {
    const viewer = ship.id;
    if (viewer < 0 || viewer >= mem.seenStations.length) continue;
    const sources = sensorSources(world, viewer);
    if (sources.length === 0) continue;
    let mask = mem.seenStations[viewer]!;
    for (const station of world.stations) {
      if (pointSensed(sources, station.pos, station.radius)) mask |= 1 << station.id;
    }
    mem.seenStations[viewer] = mask;

    // Ore fields — the other static geography. Materialise the list for a memory
    // built before ore was remembered, then insert every rock under coverage.
    if (!mem.seenOre) mem.seenOre = [];
    let ore = mem.seenOre[viewer];
    if (!ore) {
      ore = [];
      mem.seenOre[viewer] = ore;
    }
    for (const rock of world.asteroids) {
      if (sortedHas(ore, rock.id)) continue; // already known — skip the disc test
      if (pointSensed(sources, rock.pos, rock.radius)) sortedInsert(ore, rock.id);
    }
  }
}

/** A player's remembered-station mask, or 0 — a small read helper for tests and
 *  any consumer that wants the raw persistent memory rather than the resolved
 *  {@link SensedState}. */
export function rememberedStationMask(world: World, viewer: PlayerId): number {
  return world.sensory?.seenStations[viewer] ?? 0;
}

/** A player's raw remembered-ore list (ascending asteroid ids), or an empty array
 *  — the ore counterpart of {@link rememberedStationMask}. Includes ids of rocks
 *  since mined out of existence; {@link sensedState} intersects with the live
 *  field, which is what a consumer drawing dots wants. */
export function rememberedOreIds(world: World, viewer: PlayerId): readonly number[] {
  return world.sensory?.seenOre?.[viewer] ?? [];
}
