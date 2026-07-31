/**
 * src/net/entity-events.ts — the half of the world that does not stream, and
 * how a client applies it. OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * Only ships and projectiles ride the 30 Hz binary snapshot (`./snapshot`).
 * Asteroids, stations, turrets, shields, radar satellites and wrecks are
 * **events, sent on join and on change** (GDD §4.2) — they change a few times a
 * minute, not sixty times a second. This module owns both ends of that contract:
 * the payload shapes (the server's producer, `server/static-events.ts`, fills
 * them in) and the client's consumer, which writes them into the predicted world.
 *
 * **Why the client needs a consumer at all.** The predicted world is built from
 * the same seed and the same roster the server built its world from, so at
 * RUSH! the two arenas are identical rock for rock. They then drift, and for one
 * reason: this client only knows its *own* input. It cannot predict a rival
 * mining an asteroid down two crack stages, or paying for a turret, or the
 * moment a core finally goes. These events are what stops that drift becoming a
 * lie, and they arrive at 10 Hz because that is already far finer than anything
 * they report (a turret builds over ten seconds; a wave lands every two and a
 * half minutes).
 *
 * **Fog is honored by having nothing to honor** (GDD §2.2): a rival station's
 * health is only *sent* while this client's ship is inside sensor range of it,
 * so a client that never receives the number cannot draw it. The applier below
 * writes whatever health it is given and asks no questions — the wire already
 * did the asking.
 */

import type { PlayerId } from '@shared/types';
import { SPAWN_PROTECTION_S, TICK_DT } from '../sim';
import type { Asteroid, MiningStation, Shield, Ship, Turret, World } from '../sim';
import type { EntityEventMessage, Tick } from './transport';

// ---------------------------------------------------------------------------
// Payload shapes — plain data, one per entity kind
// ---------------------------------------------------------------------------

/** A station's structure: where it is, whose it is, and whether it is a wreck.
 *  Deliberately **no HP** — that is {@link StationHealthData}'s job. */
export interface StationEventData {
  id: number;
  owner: PlayerId;
  x: number;
  y: number;
  radius: number;
  /** false once the core is destroyed: the wreck stays on the map (GDD §2.7). */
  alive: boolean;
  /** Sim time the core died, or -1 while it lives — the death moment's anchor. */
  deathTime: number;
}

/** An asteroid, the economy (GDD §2.3). `ore` and `crackStage` let a client draw
 *  a payout judgement without being told a number every tick. */
export interface AsteroidEventData {
  id: number;
  x: number;
  y: number;
  radius: number;
  ore: number;
  maxOre: number;
  crackStage: number;
}

/** A turret that has finished building (GDD §2.5). `slot` is its mount ring
 *  index, so a client rebuilds the same silhouette the server has. */
export interface TurretEventData {
  id: number;
  owner: PlayerId;
  slot: number;
  x: number;
  y: number;
  radius: number;
  maxHp: number;
}

/** A shield bubble over a core (GDD §2.5). */
export interface ShieldEventData {
  id: number;
  owner: PlayerId;
  radius: number;
  maxHp: number;
}

/**
 * A radar satellite orbiting its owner's station (RATIFIED feature f1).
 *
 * The one static entity whose *position* has to keep arriving, and the reason is
 * in the sim rather than the wire: `orbitAngle` is **integrated** every tick
 * (`sim/buildings.ts` `updateSatellites`), not derived from `world.time`. A
 * reconcile rewinds the clock and replays, and a rewind restores scalars, not
 * structures — so every replayed tick advances the client's orbit a second time
 * and the satellite outruns the server's. `orbitAngle` on an `update` is the
 * correction for that; the producer sends one only once the orbit has moved a
 * legible amount (`server/static-events.ts`), so this stays an event and does not
 * become a stream.
 */
export interface SatelliteEventData {
  id: number;
  owner: PlayerId;
  x: number;
  y: number;
  radius: number;
  maxHp: number;
  /** Angular position around the station rim (radians). */
  orbitAngle: number;
}

/**
 * The scouted half: one station's live health, sent only to a client entitled to
 * see it. Turret and shield HP ride along, because a defender's alarm and a
 * scout's read of a siege are the same information (GDD §2.2, §2.6).
 */
export interface StationHealthData {
  id: number;
  coreHp: number;
  shields: { id: number; hp: number }[];
  turrets: { id: number; hp: number }[];
  /** Satellite HP, on the same scouted terms (feature f1 — a satellite is a
   *  legitimate siege target, so its damage is a besieger's earned read too).
   *  Optional: a health payload from before the satellite kind existed simply
   *  carries no satellites, which is also what a station without one sends. */
  satellites?: { id: number; hp: number }[];
}

/** A `destroy` payload: an id, and nothing else worth the bytes. */
export interface DestroyEventData {
  id: number;
}

/**
 * **A ship died, or a ship came back** — the M10 lifecycle wire.
 *
 * The one non-static payload in this file, and it earns its place by carrying the
 * two things a streaming snapshot cannot say. The snapshot spends a single bit on
 * `alive` (`./snapshot` `SHIP_FLAG`) and stops there; the five-second respawn clock
 * behind that bit (GDD §2.7) is `Ship.respawnTimer`, which is not on the wire at
 * all. A predicting client therefore held a dead ship with a **zero** timer, and
 * `step()`'s first act on a dead ship is `respawnTimer -= dt; if (<= 0) respawn()`
 * — so the client revived it on the very next tick, at its home station, and flew
 * it for the whole five seconds authority had it lying at the death site.
 *
 * That is the developer's t=63 s signature exactly: a correction that does not
 * converge because it is not a misprediction at all — the two sims are simulating
 * *different ships*. It reads as `corr` climbing 0.5 → 288 → 509 u with
 * `mispred 1.0` held for five seconds and one snap that does not take, and the same
 * shape shows up a second time at t=38 s in the RXS3 capture. On someone else's
 * hull the same bug is the other half of the report: a dead rival the client has
 * quietly respawned goes on being drawn, so *"dead enemies linger"*.
 *
 * So the lifecycle is **stated**, and the client stops guessing:
 *
 *  - `op: 'destroy'` — the ship died at `tick`, at `x`/`y`, and comes back at
 *    `respawnTick` (or never, when `eliminated`: the home reactor is gone, GDD §2.7).
 *  - `op: 'spawn'` — the ship is flying again as of `tick`, from `x`/`y`.
 *
 * The countdown a client runs is derived from `respawnTick` against **its own**
 * clock, not from a duration handed over a wire whose delay would be baked into it:
 * the two sims number their ticks identically (that is what makes prediction
 * possible at all), so `(respawnTick − world.tick) × dt` is the same countdown on
 * both sides no matter how late the message is. A client that is already past
 * `respawnTick` when the message lands simply respawns on its next tick, which is
 * the right answer and needs no special case.
 */
export interface ShipLifecycleData {
  /** The slot this is about — a ship's id is its player id. */
  id: PlayerId;
  /** True on a respawn, false on a death. */
  alive: boolean;
  /** The authoritative tick it happened at. */
  tick: Tick;
  /** Where the hull was at that tick: the death site, or the respawn point. */
  x: number;
  y: number;
  /** The tick authority will revive this ship at, or **-1** when it will not —
   *  a respawn event, or a death with `eliminated` set. */
  respawnTick: Tick;
  /** This player's home reactor is gone: out of the match, never respawning
   *  (GDD §2.7). The one death that has no countdown behind it. */
  eliminated: boolean;
}

// ---------------------------------------------------------------------------
// The client's consumer
// ---------------------------------------------------------------------------

/**
 * Apply one static-entity event to a client world. Returns true when the world
 * changed, so a caller can tell "nothing to do" from "unreadable message".
 *
 * Every branch is **idempotent and id-keyed**: the client predicts wave spawns
 * from the same seed the server used, so the authoritative spawn for an asteroid
 * it already has must correct that rock rather than deal a second one onto the
 * map. Anything it cannot place — an event for a station that does not exist, a
 * shape it does not recognize — is dropped rather than guessed at.
 */
export function applyEntityEvent(world: World, message: EntityEventMessage): boolean {
  const data = message.data;
  if (!isRecord(data) || typeof data['id'] !== 'number') return false;

  switch (message.kind) {
    case 'asteroid':
      return message.op === 'destroy'
        ? removeAsteroid(world, data['id'])
        : applyAsteroid(world, data as unknown as AsteroidEventData);
    case 'turret':
      return message.op === 'destroy'
        ? removeTurret(world, data['id'])
        : applyTurret(world, data as unknown as TurretEventData);
    case 'shield':
      return message.op === 'destroy'
        ? removeShield(world, data['id'])
        : applyShield(world, data as unknown as ShieldEventData);
    case 'satellite':
      return message.op === 'destroy'
        ? removeSatellite(world, data['id'])
        : applySatellite(world, data as unknown as SatelliteEventData);
    case 'ship':
      return applyShipLifecycle(world, data as unknown as ShipLifecycleData);
    case 'station':
    case 'wreck':
      // One `kind`, two payloads: structure (where the station is, whether it is
      // a wreck) and the scouted health the fog tracker sends. They are told
      // apart by the one field only health carries.
      return 'coreHp' in data
        ? applyStationHealth(world, data as unknown as StationHealthData)
        : applyStation(world, data as unknown as StationEventData);
  }
}

/**
 * Empty a client world of every static entity, ready to be refilled from an
 * authoritative full-state burst.
 *
 * Used on exactly one path: joining a match already in progress — a reconnect
 * inside the grace window (GDD §4.2), where sixty seconds is long enough for the
 * field to have changed underneath the player. The world was rebuilt from
 * `matchStart`'s seed, so it is holding the *opening* field: rocks that have
 * long since been mined out, and no turret anyone built while the client was
 * away. Those rocks would never be corrected, because a server only announces
 * the destruction of things it still believes exist.
 */
export function resetStaticEntities(world: World): void {
  world.asteroids.length = 0;
  world.chunks.length = 0;
  for (const station of world.stations) {
    station.turrets.length = 0;
    station.shields.length = 0;
    station.builds.length = 0;
    // A satellite is refilled from the same burst, and a stale one left standing
    // would go on granting sensor coverage authority stopped granting (GDD §2.2).
    if (station.satellites) station.satellites.length = 0;
  }
}

// --- Asteroids -------------------------------------------------------------

function applyAsteroid(world: World, data: AsteroidEventData): boolean {
  const existing = world.asteroids.find((a) => a.id === data.id);
  if (existing) {
    existing.pos.x = data.x;
    existing.pos.y = data.y;
    existing.radius = data.radius;
    existing.ore = data.ore;
    existing.maxOre = data.maxOre;
    existing.crackStage = data.crackStage;
    return true;
  }
  const asteroid: Asteroid = {
    id: data.id,
    pos: { x: data.x, y: data.y },
    radius: data.radius,
    ore: data.ore,
    maxOre: data.maxOre,
    crackStage: data.crackStage,
    // Fractional mining progress is the server's private arithmetic; a rock the
    // client has just been handed starts on a whole number.
    mineBuffer: 0,
  };
  world.asteroids.push(asteroid);
  // Ids ascend, and the renderer and the spatial hash both prefer a stable
  // order to a churn of appends.
  world.asteroids.sort((a, b) => a.id - b.id);
  return true;
}

function removeAsteroid(world: World, id: number): boolean {
  const index = world.asteroids.findIndex((a) => a.id === id);
  if (index < 0) return false;
  world.asteroids.splice(index, 1);
  return true;
}

// --- Turrets and shields ---------------------------------------------------

function applyTurret(world: World, data: TurretEventData): boolean {
  const station = world.stations.find((p) => p.owner === data.owner);
  if (!station) return false;
  const existing = station.turrets.find((t) => t.id === data.id);
  if (existing) {
    existing.pos.x = data.x;
    existing.pos.y = data.y;
    existing.radius = data.radius;
    existing.maxHp = data.maxHp;
    return true;
  }
  const turret: Turret = {
    id: data.id,
    owner: data.owner,
    slot: data.slot,
    pos: { x: data.x, y: data.y },
    radius: data.radius,
    // Health is scouted, not broadcast (GDD §2.2): a turret arrives at full and
    // is corrected only for a client that has earned the number.
    hp: data.maxHp,
    maxHp: data.maxHp,
    angle: 0,
    cooldown: 0,
    targetId: null,
  };
  station.turrets.push(turret);
  return true;
}

function removeTurret(world: World, id: number): boolean {
  for (const station of world.stations) {
    const index = station.turrets.findIndex((t) => t.id === id);
    if (index >= 0) {
      station.turrets.splice(index, 1);
      return true;
    }
  }
  return false;
}

function applyShield(world: World, data: ShieldEventData): boolean {
  const station = world.stations.find((p) => p.owner === data.owner);
  if (!station) return false;
  const existing = station.shields.find((s) => s.id === data.id);
  if (existing) {
    existing.radius = data.radius;
    existing.maxHp = data.maxHp;
    return true;
  }
  const shield: Shield = { id: data.id, hp: data.maxHp, maxHp: data.maxHp, radius: data.radius };
  station.shields.push(shield);
  return true;
}

function removeShield(world: World, id: number): boolean {
  for (const station of world.stations) {
    const index = station.shields.findIndex((s) => s.id === id);
    if (index >= 0) {
      station.shields.splice(index, 1);
      return true;
    }
  }
  return false;
}

// --- Radar satellites (feature f1) ------------------------------------------

function applySatellite(world: World, data: SatelliteEventData): boolean {
  const station = world.stations.find((p) => p.owner === data.owner);
  if (!station) return false;
  if (!station.satellites) station.satellites = [];
  const existing = station.satellites.find((s) => s.id === data.id);
  if (existing) {
    existing.pos.x = data.x;
    existing.pos.y = data.y;
    existing.radius = data.radius;
    existing.maxHp = data.maxHp;
    // The correction this event kind exists for — see {@link SatelliteEventData}.
    existing.orbitAngle = data.orbitAngle;
    return true;
  }
  station.satellites.push({
    id: data.id,
    owner: data.owner,
    pos: { x: data.x, y: data.y },
    radius: data.radius,
    // Health is scouted, not broadcast (GDD §2.2), exactly as for a turret: a
    // satellite arrives at full and is corrected only for a client that has
    // earned the number.
    hp: data.maxHp,
    maxHp: data.maxHp,
    orbitAngle: data.orbitAngle,
  });
  return true;
}

function removeSatellite(world: World, id: number): boolean {
  for (const station of world.stations) {
    if (!station.satellites) continue;
    const index = station.satellites.findIndex((s) => s.id === id);
    if (index >= 0) {
      station.satellites.splice(index, 1);
      return true;
    }
  }
  return false;
}

// --- Ships: death and respawn (M10 lifecycle wire) --------------------------

/**
 * Put one ship's **lifecycle** where authority says it is: dead at the site it
 * died, on the countdown authority is running, or flying again from the point it
 * respawned at ({@link ShipLifecycleData}).
 *
 * Written as the offline flow is written, because it *is* the offline flow: a dead
 * ship is stopped, emptied of its trigger, and given the `respawnTimer` the sim's
 * own death path gives it (`src/sim/damage.ts` `killShip`) — just measured against
 * authority's respawn tick rather than started from a local guess. `step()` then
 * counts it down and revives the ship exactly as it does in a solo match (GDD §2.4,
 * the parity principle: the offline and online sim run the identical code).
 *
 * Hull is deliberately **not** invented on a respawn: it is authority's, and the
 * snapshot on this event's heels carries it (`./prediction` `holdHull`). What is
 * set is what the wire cannot otherwise say — where the hull is, whether it is
 * flying, and how long until it is.
 */
function applyShipLifecycle(world: World, data: ShipLifecycleData): boolean {
  const ship = world.ships.find((s) => s.id === data.id);
  if (!ship) return false;
  ship.pos.x = data.x;
  ship.pos.y = data.y;
  ship.vel.x = 0;
  ship.vel.y = 0;
  if (data.alive) {
    ship.alive = true;
    ship.respawnTimer = 0;
    // A fresh hull at home is under spawn protection (GDD §2.1). The snapshot's
    // flag bit is what ends it; this only makes sure the glow starts.
    if (ship.spawnProtect <= 0) ship.spawnProtect = SPAWN_PROTECTION_S;
    return true;
  }
  ship.alive = false;
  ship.hull = 0;
  ship.firing = false;
  ship.eliminated = data.eliminated;
  ship.respawnTimer = respawnHold(data, world.tick);
  return true;
}

/**
 * Seconds this client should still show on the respawn countdown, from a death
 * event read against the client's own tick. Zero for an elimination (no countdown
 * — the match is over for that player, GDD §2.7) and zero once the deadline has
 * passed, which lets `step()` revive the ship on its next tick rather than holding
 * a corpse a late message left behind.
 */
export function respawnCountdown(data: ShipLifecycleData, tick: Tick, dt: number = TICK_DT): number {
  if (data.alive || data.eliminated || data.respawnTick < 0) return 0;
  return Math.max(0, (data.respawnTick - tick) * dt);
}

/** Read one ship's lifecycle off the world — what the server's differ compares
 *  against, and what a full-state burst states for a ship that is currently dead. */
export function shipLifecycleOf(ship: Ship, tick: Tick, dt: number = TICK_DT): ShipLifecycleData {
  const respawning = !ship.alive && !ship.eliminated;
  return {
    id: ship.id,
    alive: ship.alive,
    tick,
    x: ship.pos.x,
    y: ship.pos.y,
    respawnTick: respawning ? tick + respawnTicks(ship.respawnTimer, dt) : -1,
    eliminated: ship.eliminated,
  };
}

/** A death that cannot outlast a match: the iteration cap in {@link respawnTicks}. */
const MAX_RESPAWN_TICKS = 60 * 60 * 60;

/**
 * Ticks from now until `step()` revives a ship holding `timer` seconds — the tick the
 * *server's* own countdown lands on, stated so a client can land on the same one.
 *
 * Computed by **running that countdown**, one subtraction at a time, rather than
 * dividing. Division is off by a tick and the arithmetic says why: `step()` revives
 * on the first tick where repeated `timer -= dt` has reached zero or below, and at the
 * only cadence that ships — `dt = 1/60`, which has no exact binary form — three
 * hundred of those subtractions do *not* reach zero from five seconds, while
 * `5 / (1/60)` rounds to exactly 300. So the closed form says the ship comes back on
 * tick 300 and the sim brings it back on 301, the client revives a tick before
 * authority does, and the reconcile that straddles the two reports the whole
 * death-site-to-home distance as a fresh correction: one 15-unit jolt out of a fault
 * that is otherwise entirely fixed.
 *
 * Three hundred subtractions, a handful of times per match, is nothing — and being
 * the same operations in the same order on the same doubles as `src/sim/step.ts`, it
 * is exact by construction rather than by a rounding argument.
 *
 * Never less than one: a corpse whose clock has already run out still spends a tick
 * dead, because the revival happens *in* a tick and there is always a next one.
 */
export function respawnTicks(timer: number, dt: number = TICK_DT): number {
  if (!(dt > 0)) return 1;
  let left = timer;
  let ticks = 0;
  while (left > 0 && ticks < MAX_RESPAWN_TICKS) {
    left -= dt;
    ticks++;
  }
  return Math.max(1, ticks);
}

/**
 * The countdown to *write onto* a dead ship at `tick`, so that `step()`'s own
 * `timer -= dt` expires on the stated respawn tick and on neither of the ticks either
 * side of it.
 *
 * Half a tick short of the honest figure {@link respawnCountdown} reports, and the
 * half tick is the whole point: what the sim asks of this number is only that `k`
 * subtractions take it to zero or below and `k − 1` do not, which makes any value in
 * `((k−1)·dt, k·dt]` correct. The honest figure sits exactly on that interval's edge,
 * where one rounding in the multiplication decides whether the ship comes back on the
 * right tick — so the value written is the middle of the interval instead, and no
 * accumulation of `dt`-sized error can reach either end. Eight milliseconds under
 * five seconds is not a number any player reads; a respawn on the wrong tick is a
 * correction they see.
 */
export function respawnHold(data: ShipLifecycleData, tick: Tick, dt: number = TICK_DT): number {
  if (data.alive || data.eliminated || data.respawnTick < 0) return 0;
  return Math.max(0, (data.respawnTick - tick - 0.5) * dt);
}

// --- Stations ---------------------------------------------------------------

function applyStation(world: World, data: StationEventData): boolean {
  const station = findStation(world, data.id);
  if (!station) return false;
  station.pos.x = data.x;
  station.pos.y = data.y;
  station.radius = data.radius;
  station.deathTime = data.deathTime;
  // The wreck is the station (GDD §2.7) — it keeps its place on the map for the
  // rest of the match, so death is a flag flipping, never an entity leaving.
  station.alive = data.alive;
  return true;
}

function applyStationHealth(world: World, data: StationHealthData): boolean {
  const station = findStation(world, data.id);
  if (!station) return false;
  station.coreHp = data.coreHp;
  for (const row of data.shields) {
    const shield = station.shields.find((s) => s.id === row.id);
    if (shield) shield.hp = row.hp;
  }
  for (const row of data.turrets) {
    const turret = station.turrets.find((t) => t.id === row.id);
    if (turret) turret.hp = row.hp;
  }
  for (const row of data.satellites ?? []) {
    const satellite = station.satellites?.find((s) => s.id === row.id);
    if (satellite) satellite.hp = row.hp;
  }
  return true;
}

function findStation(world: World, id: number): MiningStation | undefined {
  return world.stations.find((p) => p.id === id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
