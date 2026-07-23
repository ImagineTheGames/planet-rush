/**
 * src/sim/step.ts — the deterministic fixed-timestep step. OWNER: Gameplay
 * Engineer. This is the sim: `step(world, inputs, dt)` advances the match one
 * tick, identically in the browser, the match server, and the QA harness
 * (GDD §4.1). No PixiJS, no DOM, no timers, no `Math.random`, no `Date.now` —
 * randomness is the seeded RNG in the world tree, and every rate is `* dt`.
 *
 * Day-1 scope (GDD §2.3, §2.8): ship Euler integration with drag, the shared
 * beam as a segment-vs-circle raycast that both mines asteroids and damages
 * ships (one beam, one stat), asteroids that crack and burst into ore chunks,
 * proximity-tractor collection into a capped hold, and ship-vs-asteroid
 * reflection — all over a uniform-grid spatial-hash broad phase. Planets,
 * turrets, shields, repair, win/loss and waves land day 2+.
 *
 * Subsystem order is fixed and documented; it is part of the determinism
 * contract (GDD §4.8 — same inputs, same final state hash).
 */

import type { Action, PlayerId, Vec2 } from '@shared/types';
import {
  ASTEROID,
  BASE_ACCEL,
  BASE_SPEED,
  BASE_TURN_RATE,
  BEAM_RANGE,
  BOOST_MULTIPLIER,
  CHUNK,
  DEATH_ORE_DROP_FRACTION,
  DRAG,
  HASH_CELL_SIZE,
  RESPAWN_S,
  SHIP_ASTEROID_RESTITUTION,
  SHIP_STATS,
  SPAWN_PROTECTION_S,
  TICK_DT,
  TRACTOR,
  beamShipDps,
  miningRate,
} from './constants';
import { SpatialHash } from './spatial-hash';
import type { Asteroid, Ship, World } from './state';
import { dist2, normalize } from './vec';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One player's ordered actions for this tick (GDD §2.4 abstract actions). */
export interface PlayerInput {
  readonly id: PlayerId;
  readonly actions: readonly Action[];
}

/** All players' inputs for the tick. The sim never sees a device (GDD §2.4). */
export type Inputs = readonly PlayerInput[];

/** The resolved control state for one ship after collapsing its `Action[]`. */
interface Intent {
  thrust: Vec2;
  /** Manual aim direction, or null to hold current facing. */
  aim: Vec2 | null;
  fire: boolean;
  auto: boolean;
  boost: boolean;
}

const NO_INTENT: Intent = { thrust: { x: 0, y: 0 }, aim: null, fire: false, auto: false, boost: false };

/** Collapse a tick's actions into one intent (last write wins per verb). */
function resolveIntent(actions: readonly Action[]): Intent {
  const intent: Intent = { thrust: { x: 0, y: 0 }, aim: null, fire: false, auto: false, boost: false };
  for (const a of actions) {
    switch (a.type) {
      case 'thrust':
        intent.thrust = clampMag(a.dir, 1);
        break;
      case 'aim':
        intent.aim = { x: a.dir.x, y: a.dir.y };
        break;
      case 'fire':
        intent.fire = a.active;
        intent.auto = a.auto;
        break;
      case 'boost':
        intent.boost = a.active;
        break;
      case 'build':
      case 'ping':
        // Not simulated on day 1 (planets/UI land day 2+).
        break;
    }
  }
  return intent;
}

/** Clamp a vector's magnitude to at most `max` (keyboard corners → unit disc). */
function clampMag(v: Vec2, max: number): Vec2 {
  const m2 = v.x * v.x + v.y * v.y;
  if (m2 <= max * max) return { x: v.x, y: v.y };
  const s = max / Math.sqrt(m2);
  return { x: v.x * s, y: v.y * s };
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/**
 * Advance `world` one fixed tick and return it (mutated in place — the sim
 * favors zero per-frame allocation, GDD §4.3). `dt` defaults to the canonical
 * 60 Hz tick; callers that step at another rate pass their own.
 */
export function step(world: World, inputs: Inputs, dt: number = TICK_DT): World {
  world.tick += 1;
  world.time += dt;

  // 1. Timers: spawn protection countdown and respawn revival (GDD §2.1, §2.7).
  for (const ship of world.ships) {
    if (ship.alive) {
      if (ship.spawnProtect > 0) ship.spawnProtect = Math.max(0, ship.spawnProtect - dt);
    } else {
      ship.respawnTimer -= dt;
      if (ship.respawnTimer <= 0) respawn(ship);
    }
  }

  // 2. Resolve intents once, indexed to ships by id.
  const intents = world.ships.map((s) => intentFor(s.id, inputs));

  // 3. Movement — Euler integration with drag (GDD §4.1).
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    if (ship.alive) integrate(ship, intents[i]!, dt, world.bounds);
  }

  // 4. Broad phase over the (static) asteroid field, reused by collision + beam.
  const hash = SpatialHash.from(world.asteroids.map((a) => a.pos), HASH_CELL_SIZE);

  // 5. Ship-vs-asteroid reflection (GDD §4.1).
  for (const ship of world.ships) {
    if (ship.alive) reflectOffAsteroids(ship, world.asteroids, hash);
  }

  // 6. Beam — mine asteroids / damage ships (one beam, one stat; GDD §2.3).
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    if (ship.alive) fireBeam(world, ship, intents[i]!, hash, dt);
  }

  // 7. Chunk drift + proximity tractor collection (GDD §2.3).
  updateChunks(world, dt);

  // 8. Remove depleted asteroids (any that a burst flushed to ~0 ore).
  world.asteroids = world.asteroids.filter((a) => a.ore > 1e-9);

  return world;
}

/** Find a ship's intent for this tick, or a neutral one if it sent nothing. */
function intentFor(id: PlayerId, inputs: Inputs): Intent {
  for (const pi of inputs) {
    if (pi.id === id) return resolveIntent(pi.actions);
  }
  return NO_INTENT;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function integrate(ship: Ship, intent: Intent, dt: number, bounds: World['bounds']): void {
  const stats = SHIP_STATS[ship.shipClass];
  const boost = intent.boost ? BOOST_MULTIPLIER : 1;
  const accel = BASE_ACCEL * stats.accelMul * boost;
  const maxSpeed = BASE_SPEED * stats.speedMul * boost;

  // Thrust adds acceleration in the (analog-scaled) thrust direction.
  ship.vel.x += intent.thrust.x * accel * dt;
  ship.vel.y += intent.thrust.y * accel * dt;

  // Linear drag.
  ship.vel.x -= ship.vel.x * DRAG * dt;
  ship.vel.y -= ship.vel.y * DRAG * dt;

  // Clamp to class top speed (drag alone would also cap it; this pins it).
  const sp2 = ship.vel.x * ship.vel.x + ship.vel.y * ship.vel.y;
  if (sp2 > maxSpeed * maxSpeed) {
    const s = maxSpeed / Math.sqrt(sp2);
    ship.vel.x *= s;
    ship.vel.y *= s;
  }

  // Facing: turn-rate-limited toward manual aim; auto-aim overrides in fireBeam.
  if (intent.aim && (intent.aim.x !== 0 || intent.aim.y !== 0)) {
    const target = Math.atan2(intent.aim.y, intent.aim.x);
    ship.angle = turnToward(ship.angle, target, BASE_TURN_RATE * stats.turnMul * dt);
  }

  // Integrate position.
  ship.pos.x += ship.vel.x * dt;
  ship.pos.y += ship.vel.y * dt;

  // Keep inside the arena; kill the normal velocity component on a wall.
  const r = ship.radius;
  if (ship.pos.x < r) {
    ship.pos.x = r;
    if (ship.vel.x < 0) ship.vel.x = 0;
  } else if (ship.pos.x > bounds.width - r) {
    ship.pos.x = bounds.width - r;
    if (ship.vel.x > 0) ship.vel.x = 0;
  }
  if (ship.pos.y < r) {
    ship.pos.y = r;
    if (ship.vel.y < 0) ship.vel.y = 0;
  } else if (ship.pos.y > bounds.height - r) {
    ship.pos.y = bounds.height - r;
    if (ship.vel.y > 0) ship.vel.y = 0;
  }
}

/** Local copy of vec.turnToward to keep the hot path import-light. */
function turnToward(angle: number, target: number, maxDelta: number): number {
  let diff = (target - angle) % (2 * Math.PI);
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  if (diff > maxDelta) diff = maxDelta;
  if (diff < -maxDelta) diff = -maxDelta;
  return angle + diff;
}

// ---------------------------------------------------------------------------
// Ship-vs-asteroid reflection (narrow phase: dx²+dy² < (r1+r2)², no sqrt until hit)
// ---------------------------------------------------------------------------

function reflectOffAsteroids(ship: Ship, asteroids: Asteroid[], hash: SpatialHash): void {
  const candidates = hash.query(ship.pos, ship.radius + ASTEROID.maxRadius);
  for (const idx of candidates) {
    const a = asteroids[idx];
    if (!a) continue;
    const rr = ship.radius + a.radius;
    const d2 = dist2(ship.pos, a.pos);
    if (d2 >= rr * rr) continue;

    // Overlapping: separate along the contact normal and reflect velocity.
    const d = Math.sqrt(d2);
    const nx = d > 1e-9 ? (ship.pos.x - a.pos.x) / d : 1;
    const ny = d > 1e-9 ? (ship.pos.y - a.pos.y) / d : 0;
    const overlap = rr - d;
    ship.pos.x += nx * overlap;
    ship.pos.y += ny * overlap;

    const vn = ship.vel.x * nx + ship.vel.y * ny;
    if (vn < 0) {
      const j = (1 + SHIP_ASTEROID_RESTITUTION) * vn;
      ship.vel.x -= j * nx;
      ship.vel.y -= j * ny;
    }
  }
}

// ---------------------------------------------------------------------------
// Beam — segment-vs-circle raycast; one beam mines AND damages (GDD §2.3, §4.1)
// ---------------------------------------------------------------------------

type BeamHit =
  | { kind: 'asteroid'; index: number }
  | { kind: 'ship'; index: number };

function fireBeam(world: World, ship: Ship, intent: Intent, hash: SpatialHash, dt: number): void {
  if (!intent.fire) {
    ship.beam = null;
    return;
  }

  let hit: BeamHit | null;
  let hitT: number; // distance along the beam to the first hit (BEAM_RANGE if none)
  if (intent.auto) {
    // Auto-aim: nearest valid target across the full 360°, no front arc
    // (GDD §2.4). Facing snaps to it, then the beam runs to that target's
    // surface — the drawn beam ends on whatever it damages.
    hit = acquireNearest(world, ship);
    if (hit) faceTarget(world, ship, hit);
    hitT = hit ? surfaceDistance(world, ship, hit) : BEAM_RANGE;
  } else {
    // Manual: raycast a segment along current facing, nearest hit wins.
    const cast = raycastBeam(world, ship, hash);
    hit = cast.hit;
    hitT = cast.t;
  }

  // Publish the beam geometry so the renderer stops the beam at the hit
  // (GDD §4.1). `length` clamps to range; `hitPoint` is null on a clean miss.
  const dx = Math.cos(ship.angle);
  const dy = Math.sin(ship.angle);
  const length = Math.min(hitT, BEAM_RANGE);
  ship.beam = {
    origin: { x: ship.pos.x, y: ship.pos.y },
    dir: { x: dx, y: dy },
    hitPoint: hit ? { x: ship.pos.x + dx * length, y: ship.pos.y + dy * length } : null,
    length,
  };

  if (!hit) return;

  if (hit.kind === 'asteroid') {
    mineAsteroid(world, world.asteroids[hit.index]!, ship, dt);
  } else {
    damageShip(world, world.ships[hit.index]!, ship, dt);
  }
}

/** Distance from the ship to the surface of an acquired (auto-aim) target along
 *  the current facing. The beam points at the target center, so the near
 *  intersection is `centerDist - radius`; falls back to range if degenerate. */
function surfaceDistance(world: World, ship: Ship, hit: BeamHit): number {
  const c = hit.kind === 'asteroid' ? world.asteroids[hit.index]! : world.ships[hit.index]!;
  const dx = Math.cos(ship.angle);
  const dy = Math.sin(ship.angle);
  const t = segCircle(ship.pos, dx, dy, c.pos, c.radius);
  return t ?? BEAM_RANGE;
}

/** Nearest asteroid or enemy ship whose center is within beam range. */
function acquireNearest(world: World, ship: Ship): BeamHit | null {
  let best: BeamHit | null = null;
  let bestD2 = BEAM_RANGE * BEAM_RANGE;
  for (let i = 0; i < world.asteroids.length; i++) {
    const a = world.asteroids[i]!;
    const d2 = dist2(ship.pos, a.pos);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { kind: 'asteroid', index: i };
    }
  }
  for (let i = 0; i < world.ships.length; i++) {
    const t = world.ships[i]!;
    if (t.id === ship.id || !t.alive) continue;
    const d2 = dist2(ship.pos, t.pos);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { kind: 'ship', index: i };
    }
  }
  return best;
}

/** Snap the ship's facing to point at an acquired target. */
function faceTarget(world: World, ship: Ship, hit: BeamHit): void {
  const target = hit.kind === 'asteroid' ? world.asteroids[hit.index]!.pos : world.ships[hit.index]!.pos;
  ship.angle = Math.atan2(target.y - ship.pos.y, target.x - ship.pos.x);
}

/**
 * Cast the beam segment (origin → range along facing) and return the nearest
 * asteroid or enemy ship it strikes together with the distance to it (`t`,
 * = `BEAM_RANGE` on a clean miss). Broad phase narrows asteroid candidates;
 * ships (≤8) are tested directly. Nearest hit wins.
 */
function raycastBeam(world: World, ship: Ship, hash: SpatialHash): { hit: BeamHit | null; t: number } {
  const dx = Math.cos(ship.angle);
  const dy = Math.sin(ship.angle);

  let best: BeamHit | null = null;
  let bestT = BEAM_RANGE;

  // Asteroids: only those in cells the beam's bounding region touches.
  const mid = { x: ship.pos.x + dx * (BEAM_RANGE / 2), y: ship.pos.y + dy * (BEAM_RANGE / 2) };
  for (const idx of hash.query(mid, BEAM_RANGE / 2 + ASTEROID.maxRadius)) {
    const a = world.asteroids[idx];
    if (!a) continue;
    const t = segCircle(ship.pos, dx, dy, a.pos, a.radius);
    if (t !== null && t < bestT) {
      bestT = t;
      best = { kind: 'asteroid', index: idx };
    }
  }

  // Enemy ships.
  for (let i = 0; i < world.ships.length; i++) {
    const t = world.ships[i]!;
    if (t.id === ship.id || !t.alive) continue;
    const hitT = segCircle(ship.pos, dx, dy, t.pos, t.radius);
    if (hitT !== null && hitT < bestT) {
      bestT = hitT;
      best = { kind: 'ship', index: i };
    }
  }
  return { hit: best, t: bestT };
}

/**
 * Distance along a unit ray (`o`, dir `dx,dy`) to the first intersection with
 * circle (`c`, `r`), or null if the ray misses within its length. Exact, and
 * immune to tunnelling — the beam is a raycast, not a projectile (GDD §4.1).
 */
function segCircle(o: Vec2, dx: number, dy: number, c: Vec2, r: number): number | null {
  const fx = o.x - c.x;
  const fy = o.y - c.y;
  const b = fx * dx + fy * dy;
  const cc = fx * fx + fy * fy - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq; // origin inside the circle → take the far root
  if (t < 0 || t > BEAM_RANGE) return null;
  return t;
}

// ---------------------------------------------------------------------------
// Mining and ore chunks (GDD §2.3, §5.5)
// ---------------------------------------------------------------------------

function mineAsteroid(world: World, a: Asteroid, ship: Ship, dt: number): void {
  const amount = Math.min(miningRate(ship.shipClass) * dt, a.ore);
  a.ore -= amount;
  a.mineBuffer += amount;

  // Crack stage tracks ore remaining (three visible stages, GDD §5.5).
  const frac = a.ore / a.maxOre;
  a.crackStage = frac > ASTEROID.crackThresholds[0] ? 0 : frac > ASTEROID.crackThresholds[1] ? 1 : 2;

  // Emit whole chunks as the buffer fills; they drift toward the miner.
  while (a.mineBuffer >= CHUNK.ore) {
    spawnChunk(world, a, ship, CHUNK.ore);
    a.mineBuffer -= CHUNK.ore;
  }

  // Fully mined out: flush the remainder and let cleanup remove the rock.
  if (a.ore <= 1e-9) {
    a.ore = 0;
    if (a.mineBuffer > 1e-9) {
      spawnChunk(world, a, ship, a.mineBuffer);
      a.mineBuffer = 0;
    }
  }
}

/** Spawn one ore chunk at the asteroid's surface, drifting toward `ship`. */
function spawnChunk(world: World, a: Asteroid, ship: Ship, amount: number): void {
  const dir = normalize({ x: ship.pos.x - a.pos.x, y: ship.pos.y - a.pos.y });
  world.chunks.push({
    id: world.nextEntityId++,
    pos: { x: a.pos.x + dir.x * (a.radius + CHUNK.radius), y: a.pos.y + dir.y * (a.radius + CHUNK.radius) },
    vel: { x: dir.x * CHUNK.ejectSpeed, y: dir.y * CHUNK.ejectSpeed },
    amount,
    radius: CHUNK.radius,
  });
}

/** Apply beam weapon damage to an enemy ship, respecting spawn protection. */
function damageShip(world: World, target: Ship, shooter: Ship, dt: number): void {
  if (target.spawnProtect > 0) return;
  target.hull -= beamShipDps(shooter.shipClass) * dt;
  if (target.hull <= 0) killShip(world, target);
}

/** Destroy a ship: drop half its held ore as debris and start the respawn clock
 *  (GDD §2.3, §2.7). Banked ore is untouched. */
function killShip(world: World, ship: Ship): void {
  ship.alive = false;
  ship.hull = 0;
  ship.respawnTimer = RESPAWN_S;
  ship.vel.x = 0;
  ship.vel.y = 0;
  ship.beam = null;

  const drop = ship.cargo * DEATH_ORE_DROP_FRACTION;
  ship.cargo = 0;
  if (drop <= 1e-9) return;

  // Scatter debris in a deterministic ring (no RNG needed — angle by index).
  const whole = Math.floor(drop);
  const pieces = whole + (drop - whole > 1e-9 ? 1 : 0);
  for (let i = 0; i < pieces; i++) {
    const amount = i < whole ? CHUNK.ore : drop - whole;
    const theta = (2 * Math.PI * i) / Math.max(1, pieces);
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    world.chunks.push({
      id: world.nextEntityId++,
      pos: { x: ship.pos.x + dx * (ship.radius + CHUNK.radius), y: ship.pos.y + dy * (ship.radius + CHUNK.radius) },
      vel: { x: dx * CHUNK.ejectSpeed, y: dy * CHUNK.ejectSpeed },
      amount,
      radius: CHUNK.radius,
    });
  }
}

// ---------------------------------------------------------------------------
// Chunk drift + proximity tractor (GDD §2.3)
// ---------------------------------------------------------------------------

function updateChunks(world: World, dt: number): void {
  const range2 = TRACTOR.range * TRACTOR.range;
  for (const chunk of world.chunks) {
    // Nearest alive ship within tractor range pulls the chunk in.
    let target: Ship | null = null;
    let bestD2 = range2;
    for (const ship of world.ships) {
      if (!ship.alive) continue;
      const d2 = dist2(chunk.pos, ship.pos);
      if (d2 < bestD2) {
        bestD2 = d2;
        target = ship;
      }
    }
    if (target) {
      const dir = normalize({ x: target.pos.x - chunk.pos.x, y: target.pos.y - chunk.pos.y });
      chunk.vel.x += dir.x * TRACTOR.accel * dt;
      chunk.vel.y += dir.y * TRACTOR.accel * dt;
    }

    // Drag, then integrate.
    chunk.vel.x -= chunk.vel.x * CHUNK.drag * dt;
    chunk.vel.y -= chunk.vel.y * CHUNK.drag * dt;
    chunk.pos.x += chunk.vel.x * dt;
    chunk.pos.y += chunk.vel.y * dt;

    // Collect on contact, capped by the hold — a full hold leaves the chunk
    // where it is for anyone (GDD §2.3).
    if (target) {
      const rr = target.radius + chunk.radius;
      if (dist2(chunk.pos, target.pos) <= rr * rr) {
        const room = target.cargoCap - target.cargo;
        if (room > 0) {
          const take = Math.min(chunk.amount, room);
          target.cargo += take;
          chunk.amount -= take;
        }
      }
    }
  }

  // Drop emptied chunks.
  world.chunks = world.chunks.filter((c) => c.amount > 1e-9);
}

// ---------------------------------------------------------------------------
// Respawn (GDD §2.7)
// ---------------------------------------------------------------------------

function respawn(ship: Ship): void {
  ship.alive = true;
  ship.hull = ship.maxHull;
  ship.pos.x = ship.home.x;
  ship.pos.y = ship.home.y;
  ship.vel.x = 0;
  ship.vel.y = 0;
  ship.cargo = 0;
  ship.respawnTimer = 0;
  ship.spawnProtect = SPAWN_PROTECTION_S;
}
