/**
 * src/net/entity-events.ts — the half of the world that does not stream, and
 * how a client applies it. OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * Only ships and projectiles ride the 30 Hz binary snapshot (`./snapshot`).
 * Asteroids, stations, turrets, shields and wrecks are **events, sent on join and
 * on change** (GDD §4.2) — they change a few times a minute, not sixty times a
 * second. This module owns both ends of that contract: the payload shapes (the
 * server's producer, `server/static-events.ts`, fills them in) and the client's
 * consumer, which writes them into the predicted world.
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
import type { Asteroid, MiningStation, Shield, Turret, World } from '../sim';
import type { EntityEventMessage } from './transport';

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
 * The scouted half: one station's live health, sent only to a client entitled to
 * see it. Turret and shield HP ride along, because a defender's alarm and a
 * scout's read of a siege are the same information (GDD §2.2, §2.6).
 */
export interface StationHealthData {
  id: number;
  coreHp: number;
  shields: { id: number; hp: number }[];
  turrets: { id: number; hp: number }[];
}

/** A `destroy` payload: an id, and nothing else worth the bytes. */
export interface DestroyEventData {
  id: number;
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
  return true;
}

function findStation(world: World, id: number): MiningStation | undefined {
  return world.stations.find((p) => p.id === id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
