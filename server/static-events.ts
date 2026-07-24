/**
 * server/static-events.ts — the half of the world that does not stream.
 * OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * Only ships and projectiles ride the 30 Hz binary snapshot (`src/net/snapshot`).
 * Asteroids, planets, turrets, shields and wrecks are **events, sent on join and
 * on change** (GDD §4.2) — they change a few times a minute, not sixty times a
 * second, and streaming them every tick would cost more than the entire ship
 * stream to say nothing new.
 *
 * Two producers live here, and the split between them is a design rule rather
 * than an optimization:
 *
 *  - {@link StaticEntityTracker} — **structure, broadcast to everyone.** What
 *    exists and where: a rock spawned by a wave, a rock mined out, a turret
 *    finished building, a shield popped, a planet becoming a wreck. All of it is
 *    plainly visible on the map to anyone who flies past, so all of it is public.
 *
 *  - {@link FogTracker} — **health, sent only to eyes that earned it.** "Enemy
 *    planet health is scouted, not broadcast" (GDD §2.2), and the honest place to
 *    enforce that is the wire, not the HUD: a client that is never sent a rival's
 *    core HP cannot draw it, cannot leak it to a modified client, and cannot
 *    free-ride on someone else's siege. You always get your own planet's numbers;
 *    you get a rival's only while your ship is inside sensor range of it.
 *
 * Both trackers hold their own last-known state and emit only differences, so an
 * idle match costs nothing per tick. Neither ever writes the world.
 */

import type { PlayerId } from '@shared/types';
import type { EntityEventMessage, Tick } from '../src/net/transport';
import { SENSOR_RANGE } from '../src/sim';
import type { Planet, World } from '../src/sim';

// ---------------------------------------------------------------------------
// Event payloads — plain data, one shape per entity kind
// ---------------------------------------------------------------------------

/** A planet's structure: where it is, whose it is, and whether it is a wreck.
 *  Deliberately **no HP** — that is {@link PlanetHealthData}'s job. */
export interface PlanetEventData {
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

/** A turret that has finished building (GDD §2.5). */
export interface TurretEventData {
  id: number;
  owner: PlayerId;
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
 * The scouted half: one planet's live health, sent only to a client entitled to
 * see it. Turret and shield HP ride along, because a defender's alarm and a
 * scout's read of a siege are the same information (GDD §2.2, §2.6).
 */
export interface PlanetHealthData {
  id: number;
  coreHp: number;
  shields: { id: number; hp: number }[];
  turrets: { id: number; hp: number }[];
}

// ---------------------------------------------------------------------------
// Full state — what a client gets on join, and on reclaim
// ---------------------------------------------------------------------------

function planetEvent(planet: Planet, tick: Tick, op: 'spawn' | 'update'): EntityEventMessage {
  const data: PlanetEventData = {
    id: planet.id,
    owner: planet.owner,
    x: planet.pos.x,
    y: planet.pos.y,
    radius: planet.radius,
    alive: planet.alive,
    deathTime: planet.deathTime,
  };
  return { type: 'entityEvent', tick, kind: planet.alive ? 'planet' : 'wreck', op, data };
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
  turret: Planet['turrets'][number],
  tick: Tick,
  op: 'spawn' | 'update',
): EntityEventMessage {
  const data: TurretEventData = {
    id: turret.id,
    owner: turret.owner,
    x: turret.pos.x,
    y: turret.pos.y,
    radius: turret.radius,
    maxHp: turret.maxHp,
  };
  return { type: 'entityEvent', tick, kind: 'turret', op, data };
}

function shieldEvent(
  shield: Planet['shields'][number],
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
  for (const planet of world.planets) {
    events.push(planetEvent(planet, tick, 'spawn'));
    for (const turret of planet.turrets) events.push(turretEvent(turret, tick, 'spawn'));
    for (const shield of planet.shields) {
      events.push(shieldEvent(shield, planet.owner, tick, 'spawn'));
    }
  }
  for (const asteroid of world.asteroids) events.push(asteroidEvent(asteroid, tick, 'spawn'));
  return events;
}

// ---------------------------------------------------------------------------
// Structure — public, broadcast on change
// ---------------------------------------------------------------------------

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
  private readonly wrecked = new Set<number>();
  /** Crack stage last announced per asteroid — the one *update* worth sending,
   *  because it is a sprite swap the player reads a payout off (GDD §5.5). */
  private readonly crack = new Map<number, number>();

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
    for (const planet of world.planets) {
      for (const turret of planet.turrets) {
        liveTurrets.add(turret.id);
        if (this.turrets.has(turret.id)) continue;
        this.turrets.add(turret.id);
        events.push(turretEvent(turret, tick, 'spawn'));
      }
      for (const shield of planet.shields) {
        liveShields.add(shield.id);
        if (this.shields.has(shield.id)) continue;
        this.shields.add(shield.id);
        events.push(shieldEvent(shield, planet.owner, tick, 'spawn'));
      }
      // A dead core is announced once, as the wreck it becomes: the wreck stays
      // on the map for the rest of the match (GDD §2.7), so this is the event
      // the death moment and the debris field hang off.
      if (!planet.alive && !this.wrecked.has(planet.id)) {
        this.wrecked.add(planet.id);
        events.push(planetEvent(planet, tick, 'update'));
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

    return events;
  }
}

// ---------------------------------------------------------------------------
// Health — scouted, never broadcast (GDD §2.2)
// ---------------------------------------------------------------------------

/**
 * Per-client planet health. One tracker per connected player: it remembers what
 * that client was last told, and it will only tell them what they are allowed
 * to know.
 *
 * The rule, straight from the GDD: your own planet's numbers are always yours;
 * a rival's numbers exist for you only while your ship is within sensor range of
 * their planet (§2.2 — "information you *earn* by scouting"). When a scouting
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

    for (const planet of world.planets) {
      const own = planet.owner === this.viewer;
      if (!own) {
        // No ship in the sky, no scouting: a dead or eliminated player's client
        // learns nothing new about anyone else's core.
        if (!looking) continue;
        const dx = planet.pos.x - eye.pos.x;
        const dy = planet.pos.y - eye.pos.y;
        if (dx * dx + dy * dy > range2) continue;
      }

      const data: PlanetHealthData = {
        id: planet.id,
        coreHp: planet.coreHp,
        shields: planet.shields.map((s) => ({ id: s.id, hp: s.hp })),
        turrets: planet.turrets.map((t) => ({ id: t.id, hp: t.hp })),
      };
      // Health is continuous and mostly unchanging; a signature keeps a besieged
      // planet reporting every sample and a quiet one reporting nothing.
      const signature = JSON.stringify(data);
      if (this.lastSent.get(planet.id) === signature) continue;
      this.lastSent.set(planet.id, signature);
      events.push({ type: 'entityEvent', tick: world.tick, kind: 'planet', op: 'update', data });
    }

    return events;
  }

  /** Forget what this viewer was told — used on reclaim, where the client has
   *  been away and its picture of the map is stale (GDD §4.2). */
  reset(): void {
    this.lastSent.clear();
  }
}
