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
 * A player always senses **their own SIDE's** live entities and stations (cockpit
 * / home knowledge, the same rule the bot perception uses for its own ship and
 * station — GDD §2.2). Enemies and neutral bodies are fog-gated.
 *
 * **In TEAMS the fog lifts under a teammate's coverage as if it were your own**
 * (GDD §2.2, amended 2026-08-13; a0-42). The developer: *"when playing on a team
 * the fog of war should lift where your team mates are it should be like as if
 * you were there."* So the read model's coverage is the union over everyone on
 * the viewer's side ({@link teamSensorSources}), and the remembered geography is
 * the union of their memories too ({@link teamRememberedStationMask},
 * {@link teamRememberedOreIds}) — a teammate's disc buys the viewer the live dots
 * under it AND the field it has already flown over, because half of that would
 * not be "as if you were there". **FFA is unchanged, by construction rather than
 * by a mode check:** `createWorld` defaults every player's `team` to their own id,
 * so the union over `sameSide` (`./allegiance`) collapses to "self" and every
 * team function is its per-player counterpart, field for field.
 *
 * The union is **read-side only**. {@link updateSensory} still writes each
 * player's memory from that player's own coverage, so a stored record stays "who
 * actually saw it", one player's memory never depends on another player's tick,
 * and the replay hash does not move. Nor is any of this a wire change: snapshots
 * already stream every ship and projectile to every client, and fog is a
 * client-side read over the replicated world — **fog is not an anti-cheat
 * boundary today**, and widening a read costs no bytes.
 *
 * **Station HEALTH is not part of that fog** (GDD §2.2, amended 2026-08-07;
 * a0-05). Presence and health are two different questions and this module now
 * answers both: coverage decides whether a station is on your *map*,
 * {@link stationHealthVisible} decides whether its damage ring tells the truth,
 * and the answer to the second is always yes. The two were never the same gate —
 * the retired `SENSOR_RANGE` was a third, much smaller radius that only the ring
 * ever used.
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
import { sameSide } from './allegiance';
import { SATELLITE, SHIP_SENSOR_RANGE, STATION_SENSOR_RANGE } from './constants';
import type { MiningStation, Ship, World } from './state';

// ---------------------------------------------------------------------------
// Station health — always visible (GDD §2.2, amended 2026-08-07; a0-05)
// ---------------------------------------------------------------------------

/**
 * Whether `viewer` may read `station`'s health — **always true**, at every range,
 * for every station, living or wrecked.
 *
 * The developer, 2026-08-07, verbatim: *"you can see other stations healths only
 * when you are near, it should always show the health regardless of proximity or
 * else it looks like a glitch approaching and getting far it looks like its full
 * health even if its damaged."* GDD §2.2's *"enemy station health is scouted, not
 * broadcast"* is withdrawn, and the `SENSOR_RANGE` constant that enforced it is
 * retired (`./constants`).
 *
 * **The bug was worse than the design retraction.** Out of the old 180-unit
 * radius no ring was drawn at all — but the owner-colour beacon ring underneath
 * it *is* always drawn, so a station with a quarter of its core left read exactly
 * like a station at full health. The unknown state was indistinguishable from the
 * healthy state (LESSONS §20), which is the direction a display must never fail
 * in: the player cannot tell they are being lied to, because "no red" is what
 * "fine" looks like.
 *
 * **This is a predicate, not a distance, and that is deliberate.** Returning a
 * range would invite someone to tune it back down; there is no number to tune,
 * because there is no gate. The only thing still standing between a player and a
 * rival's health is whether that station is on their screen at all, and that is a
 * viewport question the sim does not own and must not guess at. Every consumer
 * that already has an "am I drawing this" test uses that test and nothing
 * narrower — `src/render` draws the ring for every station it draws, the bot
 * perception layer reads a station's numbers at its own `visualRange` (the
 * on-screen test it already applies to hull bars and turret counts, so bots and
 * humans learn the same things at the same moment — GDD §2.9), and the server
 * sends every client every station's health because it cannot know their
 * viewport.
 *
 * The parameters are unused and stay in the signature on purpose: they are the
 * two things a health-visibility rule could ever legitimately depend on, so a
 * future rule has somewhere to land, and every call site already reads as a
 * question rather than an assumption.
 *
 * What did NOT change: **ship** hull is still an on-screen-only read, enemy cargo
 * and bank are still drawn nowhere at any range, and the ring grammar is
 * untouched — owner colour whole is health remaining, threat red fills it
 * clockwise from twelve, red is only ever the damage (GDD §2.2, §5.4). This
 * changes *when* the ring is drawn, never *what* it means.
 */
export function stationHealthVisible(_viewer: PlayerId, _station: MiningStation): boolean {
  return true;
}

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

// ---------------------------------------------------------------------------
// The team union — shared vision (GDD §2.1/§2.2, amended 2026-08-13; a0-42)
// ---------------------------------------------------------------------------

/**
 * Everyone on `viewer`'s side, ascending by player id — the roster every team
 * read below folds over, and the whole of this feature's mode-awareness.
 *
 * Membership is {@link sameSide} and nothing else (`./allegiance`): no `team`
 * number is read here, and there is no `mode === 'teams'` branch anywhere in this
 * module. **FFA is teams-of-one**, so in FFA this returns exactly `[viewer]` and
 * every team function collapses to its per-player counterpart — which is why the
 * FFA behaviour cannot drift as a side effect of a Teams change.
 *
 * The roster is drawn from `world.ships`, the dense player list, and the viewer
 * is always in it even in a hand-built world that gave them no ship. A **derelict**
 * is not a teammate: its `owner`/`team` is a board index `>= N` (`./state`), so it
 * reads as everyone's foe and casts no shared disc. Ascending order is fixed so
 * the concatenated source list is deterministic (GDD §4.8).
 */
export function teamMembers(world: World, viewer: PlayerId): PlayerId[] {
  const out: PlayerId[] = [viewer];
  for (const s of world.ships) {
    if (s.id === viewer) continue;
    if (sameSide(world, viewer, s.id)) out.push(s.id);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * The coverage discs `viewer`'s **whole side** projects this tick — the union of
 * {@link sensorSources} over every ally, the viewer included. This is what the
 * minimap draws and what {@link sensedState} tests against, so an ally's radar
 * disc is a disc on your map: you see what your team's radar buys you, and the
 * reveal is legible rather than magic.
 *
 * A separate function rather than a widening of `sensorSources`, deliberately:
 * the per-player one stays the honest answer to *"what does THIS player project"*
 * — which is what {@link updateSensory} needs, since memory is still written per
 * player — and keeping the two apart is what makes "FFA is identical" a thing a
 * test can state directly.
 *
 * Order: ascending ally id, then each ally's own fixed order (ship, stations in
 * board order, each station's satellites in array order). In FFA this returns
 * `sensorSources(world, viewer)` itself, not a copy of it.
 */
export function teamSensorSources(world: World, viewer: PlayerId): SensorSource[] {
  return sourcesOf(world, teamMembers(world, viewer));
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
 * player's SIDE has ever sensed (plus the ones it senses right now, plus its
 * own), which is why a scouted enemy home stays on the minimap after you fly
 * away.
 *
 * Every set is the viewer's **side's**, not the viewer's alone (a0-42) — see the
 * file header. The live half is still current-coverage only, so a teammate's disc
 * is never *remembered* as live dots: the tick their ship dies, their disc is gone
 * and everything only under it drops, exactly as a killed satellite collapses its
 * own coverage (feature f1, item 2).
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
 * Build `viewer`'s sensed-set for the current tick (feature f1). Own-**side** live
 * entities are always included (cockpit knowledge — a teammate's ship is on your
 * side, so it is never fogged); enemy/neutral ones only under current coverage,
 * which since a0-42 is the SIDE's coverage. Remembered stations come from
 * `world.sensory` (the persistent memory {@link updateSensory} maintains), unioned
 * across the side and with the ones covered right now and the side's own — so the
 * set is correct even on the very first tick, and degrades gracefully to
 * "currently covered + own side" when a foreign world carries no `sensory` memory
 * at all.
 */
export function sensedState(world: World, viewer: PlayerId): SensedState {
  const members = teamMembers(world, viewer);
  const sources = sourcesOf(world, members);

  const ships: PlayerId[] = [];
  for (const s of world.ships) {
    if (!s.alive) continue;
    if (sameSide(world, viewer, s.id) || pointSensed(sources, s.pos)) ships.push(s.id);
  }

  const satellites: number[] = [];
  const projectiles: number[] = [];
  const rememberedStations: number[] = [];

  const rememberedMask = maskOf(world, members);
  for (const station of world.stations) {
    // A station is remembered if the viewer's side owns it, anyone on that side
    // has ever sensed it (the unioned mask), or the side senses it right now
    // (surface-aware — a body has size).
    // `derelict` first: an unowned wreck belongs to no side, and its board-index
    // `owner` must never be mistaken for a teammate's (`./state`).
    const owned = !station.derelict && sameSide(world, viewer, station.owner);
    const rememberedBit = (rememberedMask & (1 << station.id)) !== 0;
    if (owned || rememberedBit || pointSensed(sources, station.pos, station.radius)) {
      rememberedStations.push(station.id);
    }
    if (station.satellites) {
      for (const sat of station.satellites) {
        if (sat.hp <= 0) continue;
        if (sameSide(world, viewer, sat.owner) || pointSensed(sources, sat.pos)) satellites.push(sat.id);
      }
    }
  }

  for (const p of world.projectiles) {
    if (!p.active) continue;
    if (sameSide(world, viewer, p.owner) || pointSensed(sources, p.pos)) projectiles.push(p.id);
  }

  // Ore fields: remembered from the stored list, unioned with the rocks under
  // coverage right now (surface-aware — a rock has size), so the set is correct on
  // the very first tick and degrades to "currently covered" for a foreign world
  // that carries no memory. `world.asteroids` is the iteration order, so the
  // result is ascending by construction (the field list is id-ordered) and holds
  // only rocks that still exist — a mined-out one drops out on its own.
  const oreMemory = oreOf(world, members);
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

// ---------------------------------------------------------------------------
// The team reads (a0-42) — the same three answers, for a whole side
// ---------------------------------------------------------------------------
//
// Sharing the coverage without sharing the memory would half-ship the feature:
// a teammate's disc would show live dots and forget the ore field it flew over,
// which is not "as if you were there". So all three reads union, and a consumer
// that wants shared vision takes all three (`src/main.ts` `feedMinimapFog`).
//
// Read-time union ONLY. Nothing below writes: `updateSensory` keeps folding each
// player's own coverage into that player's own record, so `world.sensory` stays
// the honest log of who actually saw what and no player's memory can ever depend
// on another player's tick.

/** The side's coverage, given an already-resolved roster (the shared body of
 *  {@link teamSensorSources} and {@link sensedState}, so a read resolves the
 *  roster once). */
function sourcesOf(world: World, members: readonly PlayerId[]): SensorSource[] {
  if (members.length === 1) return sensorSources(world, members[0]!);
  const out: SensorSource[] = [];
  for (const member of members) {
    for (const source of sensorSources(world, member)) out.push(source);
  }
  return out;
}

/** The side's remembered-station bits, OR-ed (the body of
 *  {@link teamRememberedStationMask}). */
function maskOf(world: World, members: readonly PlayerId[]): number {
  let mask = 0;
  for (const member of members) mask |= rememberedStationMask(world, member);
  return mask;
}

/** The side's remembered-ore ids, merged (the body of {@link teamRememberedOreIds}). */
function oreOf(world: World, members: readonly PlayerId[]): readonly number[] {
  if (members.length === 1) return rememberedOreIds(world, members[0]!);

  const lists: readonly (readonly number[])[] = members
    .map((m) => rememberedOreIds(world, m))
    .filter((l) => l.length > 0);
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0]!;

  // A k-way merge of ascending lists, not a concat-and-sort: the callers rely on
  // the order (`sensedState` binary-searches it, the minimap feed refills a set
  // from it), and a merge keeps the result ascending and deduped by construction
  // — which also makes it independent of the roster order, so it cannot drift.
  const cursors = new Array<number>(lists.length).fill(0);
  const out: number[] = [];
  for (;;) {
    let best = 0;
    let found = false;
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i]!;
      const c = cursors[i]!;
      if (c >= list.length) continue;
      const v = list[c]!;
      if (!found || v < best) {
        best = v;
        found = true;
      }
    }
    if (!found) break;
    out.push(best);
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i]!;
      while (cursors[i]! < list.length && list[cursors[i]!]! === best) cursors[i]!++;
    }
  }
  return out;
}

/**
 * The remembered-station mask of `viewer`'s whole SIDE — every ally's mask OR-ed
 * together (a0-42). A home one teammate scouted is on the minimap for all of
 * them; in FFA this is `rememberedStationMask(world, viewer)`, bit for bit.
 */
export function teamRememberedStationMask(world: World, viewer: PlayerId): number {
  return maskOf(world, teamMembers(world, viewer));
}

/**
 * The remembered-ore ids of `viewer`'s whole SIDE — every ally's ascending list
 * merged into one ascending, deduped list (a0-42). An ore field a teammate flew
 * over is on your minimap in the remembered dimming, which is the half of "as if
 * you were there" that live dots alone do not buy.
 *
 * In FFA this returns `rememberedOreIds(world, viewer)` itself, not a copy. Like
 * its per-player counterpart it may name rocks since mined out of existence;
 * {@link sensedState} intersects with the live field.
 */
export function teamRememberedOreIds(world: World, viewer: PlayerId): readonly number[] {
  return oreOf(world, teamMembers(world, viewer));
}
