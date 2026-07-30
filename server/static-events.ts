/**
 * server/static-events.ts — the half of the world that does not stream.
 * OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * Only ships and projectiles ride the 30 Hz binary snapshot (`src/net/snapshot`).
 * Asteroids, stations, turrets, shields and wrecks are **events, sent on join and
 * on change** (GDD §4.2) — they change a few times a minute, not sixty times a
 * second, and streaming them every tick would cost more than the entire ship
 * stream to say nothing new.
 *
 * Two producers live here, and the split between them is a design rule rather
 * than an optimization:
 *
 *  - {@link StaticEntityTracker} — **structure, broadcast to everyone.** What
 *    exists and where: a rock spawned by a wave, a rock mined out, a turret
 *    finished building, a shield popped, a station becoming a wreck. All of it is
 *    plainly visible on the map to anyone who flies past, so all of it is public.
 *
 *  - {@link FogTracker} — **health, sent only to eyes that earned it.** "Enemy
 *    station health is scouted, not broadcast" (GDD §2.2), and the honest place to
 *    enforce that is the wire, not the HUD: a client that is never sent a rival's
 *    core HP cannot draw it, cannot leak it to a modified client, and cannot
 *    free-ride on someone else's siege. You always get your own station's numbers;
 *    you get a rival's only while your ship is inside sensor range of it.
 *
 * Both trackers hold their own last-known state and emit only differences, so an
 * idle match costs nothing per tick. Neither ever writes the world.
 */

import type { PlayerId } from '@shared/types';
import type {
  AsteroidEventData,
  SatelliteEventData,
  StationEventData,
  StationHealthData,
  ShieldEventData,
  TurretEventData,
} from '../src/net/entity-events';
import type { EntityEventMessage, Tick } from '../src/net/transport';
import { SENSOR_RANGE } from '../src/sim';
import type { MiningStation, World } from '../src/sim';

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------
//
// The shapes themselves live in `src/net/entity-events.ts`, next to the client
// applier that consumes them — one file owns both ends of the contract, the same
// way `src/net/wire.ts` owns both ends of the framing. This module is the
// producer: it decides *what* to say and *who* may hear it.

// ---------------------------------------------------------------------------
// Full state — what a client gets on join, and on reclaim
// ---------------------------------------------------------------------------

function stationEvent(station: MiningStation, tick: Tick, op: 'spawn' | 'update'): EntityEventMessage {
  const data: StationEventData = {
    id: station.id,
    owner: station.owner,
    x: station.pos.x,
    y: station.pos.y,
    radius: station.radius,
    alive: station.alive,
    deathTime: station.deathTime,
  };
  return { type: 'entityEvent', tick, kind: station.alive ? 'station' : 'wreck', op, data };
}

function asteroidEvent(
  a: World['asteroids'][number],
  tick: Tick,
  op: 'spawn' | 'update',
): EntityEventMessage {
  const data: AsteroidEventData = {
    id: a.id,
    x: a.pos.x,
    y: a.pos.y,
    radius: a.radius,
    ore: a.ore,
    maxOre: a.maxOre,
    crackStage: a.crackStage,
  };
  return { type: 'entityEvent', tick, kind: 'asteroid', op, data };
}

function turretEvent(
  turret: MiningStation['turrets'][number],
  tick: Tick,
  op: 'spawn' | 'update',
): EntityEventMessage {
  const data: TurretEventData = {
    id: turret.id,
    owner: turret.owner,
    slot: turret.slot,
    x: turret.pos.x,
    y: turret.pos.y,
    radius: turret.radius,
    maxHp: turret.maxHp,
  };
  return { type: 'entityEvent', tick, kind: 'turret', op, data };
}

function shieldEvent(
  shield: MiningStation['shields'][number],
  owner: PlayerId,
  tick: Tick,
  op: 'spawn' | 'update',
): EntityEventMessage {
  const data: ShieldEventData = {
    id: shield.id,
    owner,
    radius: shield.radius,
    maxHp: shield.maxHp,
  };
  return { type: 'entityEvent', tick, kind: 'shield', op, data };
}

function satelliteEvent(
  satellite: NonNullable<MiningStation['satellites']>[number],
  owner: PlayerId,
  tick: Tick,
  op: 'spawn' | 'update',
): EntityEventMessage {
  const data: SatelliteEventData = {
    id: satellite.id,
    owner,
    x: satellite.pos.x,
    y: satellite.pos.y,
    radius: satellite.radius,
    maxHp: satellite.maxHp,
    orbitAngle: satellite.orbitAngle,
  };
  return { type: 'entityEvent', tick, kind: 'satellite', op, data };
}

function destroyEvent(
  kind: EntityEventMessage['kind'],
  id: number,
  tick: Tick,
): EntityEventMessage {
  return { type: 'entityEvent', tick, kind, op: 'destroy', data: { id } };
}

/**
 * Every static entity in the world, as spawn events. This is what a client
 * receives when it joins a running match — and what a reconnecting player
 * receives on reclaim, because sixty seconds of grace is long enough for the
 * field to have changed underneath them (GDD §4.2).
 */
export function fullEntityState(world: World): EntityEventMessage[] {
  const tick = world.tick;
  const events: EntityEventMessage[] = [];
  for (const station of world.stations) {
    events.push(stationEvent(station, tick, 'spawn'));
    for (const turret of station.turrets) events.push(turretEvent(turret, tick, 'spawn'));
    for (const shield of station.shields) {
      events.push(shieldEvent(shield, station.owner, tick, 'spawn'));
    }
    for (const satellite of station.satellites ?? []) {
      events.push(satelliteEvent(satellite, station.owner, tick, 'spawn'));
    }
  }
  for (const asteroid of world.asteroids) events.push(asteroidEvent(asteroid, tick, 'spawn'));
  return events;
}

// ---------------------------------------------------------------------------
// Structure — public, broadcast on change
// ---------------------------------------------------------------------------

/**
 * How far a satellite's orbit may drift from the angle last announced before the
 * tracker re-announces it (radians).
 *
 * A satellite is the one static entity that *moves*, and its angle is integrated
 * per tick rather than derived from the clock, so a client's replayed ticks
 * advance its copy twice and it runs ahead (`src/net/entity-events`
 * `SatelliteEventData`). This is the correction, and the threshold is what keeps
 * it an event: the server's own orbit crosses it at a fixed rate, so at
 * `SATELLITE.orbitSpeed` (0.35 rad/s) one satellite costs about **two updates a
 * second**, not the ten a naive per-diff announcement would. An eighth of a
 * radian is also under what reads as a jump at orbit radius (~114 u → ~14 u of
 * arc), so the correction lands before the eye has anything to catch. TUNABLE
 */
const ORBIT_ANNOUNCE_RADIANS = 0.125;

/**
 * Diffs the world's static entities against what it last announced and emits
 * the difference. Sampled by the room a few times a second rather than every
 * tick: a turret takes ten seconds to build and a wave lands every two and a
 * half minutes, so 10 Hz is already far finer than anything it reports.
 */
export class StaticEntityTracker {
  private readonly asteroids = new Set<number>();
  private readonly turrets = new Set<number>();
  private readonly shields = new Set<number>();
  private readonly satellites = new Set<number>();
  private readonly wrecked = new Set<number>();
  /** Crack stage last announced per asteroid — the one *update* worth sending,
   *  because it is a sprite swap the player reads a payout off (GDD §5.5). */
  private readonly crack = new Map<number, number>();
  /** Orbit angle last announced per satellite, for the same reason: the one
   *  *update* worth sending, throttled by {@link ORBIT_ANNOUNCE_RADIANS}. */
  private readonly orbit = new Map<number, number>();

  /** Prime the tracker with a world it has already fully described (the state a
   *  fresh client got from {@link fullEntityState}), so the first diff after a
   *  join reports changes rather than re-announcing the map. */
  prime(world: World): void {
    this.diff(world);
  }

  /** Everything that appeared, changed shape, or vanished since the last call. */
  diff(world: World): EntityEventMessage[] {
    const tick = world.tick;
    const events: EntityEventMessage[] = [];

    const liveAsteroids = new Set<number>();
    for (const asteroid of world.asteroids) {
      liveAsteroids.add(asteroid.id);
      if (!this.asteroids.has(asteroid.id)) {
        this.asteroids.add(asteroid.id);
        this.crack.set(asteroid.id, asteroid.crackStage);
        events.push(asteroidEvent(asteroid, tick, 'spawn'));
      } else if (this.crack.get(asteroid.id) !== asteroid.crackStage) {
        this.crack.set(asteroid.id, asteroid.crackStage);
        events.push(asteroidEvent(asteroid, tick, 'update'));
      }
    }
    for (const id of this.asteroids) {
      if (liveAsteroids.has(id)) continue;
      this.asteroids.delete(id);
      this.crack.delete(id);
      events.push(destroyEvent('asteroid', id, tick));
    }

    const liveTurrets = new Set<number>();
    const liveShields = new Set<number>();
    const liveSatellites = new Set<number>();
    for (const station of world.stations) {
      for (const turret of station.turrets) {
        liveTurrets.add(turret.id);
        if (this.turrets.has(turret.id)) continue;
        this.turrets.add(turret.id);
        events.push(turretEvent(turret, tick, 'spawn'));
      }
      for (const shield of station.shields) {
        liveShields.add(shield.id);
        if (this.shields.has(shield.id)) continue;
        this.shields.add(shield.id);
        events.push(shieldEvent(shield, station.owner, tick, 'spawn'));
      }
      for (const satellite of station.satellites ?? []) {
        liveSatellites.add(satellite.id);
        const announced = this.orbit.get(satellite.id);
        if (announced === undefined) {
          this.satellites.add(satellite.id);
          this.orbit.set(satellite.id, satellite.orbitAngle);
          events.push(satelliteEvent(satellite, station.owner, tick, 'spawn'));
        } else if (Math.abs(satellite.orbitAngle - announced) >= ORBIT_ANNOUNCE_RADIANS) {
          this.orbit.set(satellite.id, satellite.orbitAngle);
          events.push(satelliteEvent(satellite, station.owner, tick, 'update'));
        }
      }
      // A dead core is announced once, as the wreck it becomes: the wreck stays
      // on the map for the rest of the match (GDD §2.7), so this is the event
      // the death moment and the debris field hang off.
      if (!station.alive && !this.wrecked.has(station.id)) {
        this.wrecked.add(station.id);
        events.push(stationEvent(station, tick, 'update'));
      }
    }
    for (const id of this.turrets) {
      if (liveTurrets.has(id)) continue;
      this.turrets.delete(id);
      events.push(destroyEvent('turret', id, tick));
    }
    for (const id of this.shields) {
      if (liveShields.has(id)) continue;
      this.shields.delete(id);
      events.push(destroyEvent('shield', id, tick));
    }
    for (const id of this.satellites) {
      if (liveSatellites.has(id)) continue;
      this.satellites.delete(id);
      this.orbit.delete(id);
      events.push(destroyEvent('satellite', id, tick));
    }

    return events;
  }
}

// ---------------------------------------------------------------------------
// Health — scouted, never broadcast (GDD §2.2)
// ---------------------------------------------------------------------------

/**
 * Per-client station health. One tracker per connected player: it remembers what
 * that client was last told, and it will only tell them what they are allowed
 * to know.
 *
 * The rule, straight from the GDD: your own station's numbers are always yours;
 * a rival's numbers exist for you only while your ship is within sensor range of
 * their station (§2.2 — "information you *earn* by scouting"). When a scouting
 * ship leaves range, the client keeps its last read and grows stale, exactly
 * like a human's memory of what they saw — the server simply stops updating it.
 */
export class FogTracker {
  private readonly lastSent = new Map<number, string>();

  constructor(
    private readonly viewer: PlayerId,
    private readonly sensorRange: number = SENSOR_RANGE,
  ) {}

  /** Health events this viewer has earned and has not already been told. */
  events(world: World): EntityEventMessage[] {
    const eye = world.ships.find((s) => s.id === this.viewer);
    const looking = eye !== undefined && eye.alive;
    const range2 = this.sensorRange * this.sensorRange;
    const events: EntityEventMessage[] = [];

    for (const station of world.stations) {
      const own = station.owner === this.viewer;
      if (!own) {
        // No ship in the sky, no scouting: a dead or eliminated player's client
        // learns nothing new about anyone else's core.
        if (!looking) continue;
        const dx = station.pos.x - eye.pos.x;
        const dy = station.pos.y - eye.pos.y;
        if (dx * dx + dy * dy > range2) continue;
      }

      const data: StationHealthData = {
        id: station.id,
        coreHp: station.coreHp,
        shields: station.shields.map((s) => ({ id: s.id, hp: s.hp })),
        turrets: station.turrets.map((t) => ({ id: t.id, hp: t.hp })),
        // A satellite is a siege target on the same terms as a turret (feature
        // f1), so its damage is scouted on the same terms too. Omitted entirely
        // when there is none, so a station without one signs the same as before.
        ...(station.satellites?.length
          ? { satellites: station.satellites.map((s) => ({ id: s.id, hp: s.hp })) }
          : {}),
      };
      // Health is continuous and mostly unchanging; a signature keeps a besieged
      // station reporting every sample and a quiet one reporting nothing.
      const signature = JSON.stringify(data);
      if (this.lastSent.get(station.id) === signature) continue;
      this.lastSent.set(station.id, signature);
      events.push({ type: 'entityEvent', tick: world.tick, kind: 'station', op: 'update', data });
    }

    return events;
  }

  /** Forget what this viewer was told — used on reclaim, where the client has
   *  been away and its picture of the map is stale (GDD §4.2). */
  reset(): void {
    this.lastSent.clear();
  }
}
