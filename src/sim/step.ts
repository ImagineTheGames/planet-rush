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
 * proximity-tractor collection into a capped hold, turn-rate-limited facing
 * (aim input → auto-aim target → velocity → hold), and ship-vs-asteroid
 * reflection — all over a uniform-grid spatial-hash broad phase.
 *
 * Day-2 scope (GDD §2.1, §2.5, §2.6): home planets and their cores in the ring
 * layout, the Build & Upgrade orders (turret, shield, repair channel, bank),
 * construction timers, shield regeneration, turret auto-fire with pooled
 * projectiles, and the beam extended to the rest of the target list — turrets,
 * shields and cores (GDD §2.4). Win/loss, waves and collapse land next.
 *
 * Subsystem order is fixed and documented; it is part of the determinism
 * contract (GDD §4.8 — same inputs, same final state hash).
 */

import type { Action, BuildItem, PlayerId, Vec2 } from '@shared/types';
import {
  ASTEROID,
  BASE_ACCEL,
  BASE_SPEED,
  BASE_TURN_RATE,
  BEAM_RANGE,
  BOOST_MULTIPLIER,
  CHUNK,
  DRAG,
  FACE_VELOCITY_MIN_SPEED,
  HASH_CELL_SIZE,
  SHIP_ASTEROID_RESTITUTION,
  SHIP_STATS,
  SPAWN_PROTECTION_S,
  TICK_DT,
  TRACTOR,
  beamCoreDps,
  beamShipDps,
  miningRate,
} from './constants';
import {
  damagePlanet,
  damageTurret,
  placeOrder,
  planetTargetRadius,
  sweepDeadTurrets,
  updatePlanets,
  updateProjectiles,
  updateTurrets,
} from './buildings';
import { damageShip } from './damage';
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
  /** Wheel presses this tick, in the order they arrived. Unlike the held verbs
   *  these accumulate: two presses in one tick are two orders (GDD §2.5). */
  orders: BuildItem[];
}

const NO_ORDERS: BuildItem[] = [];
const NO_INTENT: Intent = {
  thrust: { x: 0, y: 0 },
  aim: null,
  fire: false,
  auto: false,
  boost: false,
  orders: NO_ORDERS,
};

/** Collapse a tick's actions into one intent (last write wins per verb; wheel
 *  orders accumulate). */
function resolveIntent(actions: readonly Action[]): Intent {
  const intent: Intent = {
    thrust: { x: 0, y: 0 },
    aim: null,
    fire: false,
    auto: false,
    boost: false,
    orders: NO_ORDERS,
  };
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
      case 'buildOrder':
        // Allocate the list only for the rare tick that carries an order.
        if (intent.orders === NO_ORDERS) intent.orders = [];
        intent.orders.push(a.item);
        break;
      case 'build':
      case 'ping':
        // Opening the wheel and pinging the minimap are UI-side; the sim acts
        // only on the confirmed order (`buildOrder`).
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

  // 1b. Planets: core spawn protection, the undamaged clock, construction
  //     timers, shield regen, and the repair channel (GDD §2.5, §2.6). Ahead of
  //     this tick's damage, so a hit landing now is felt next tick — never
  //     retroactively cancelling a repair that already ticked.
  updatePlanets(world, dt);

  // 2. Resolve intents once, indexed to ships by id.
  const intents = world.ships.map((s) => intentFor(s.id, inputs));

  // 2b. Wheel orders — validated and paid for here, so a job ordered this tick
  //     starts its clock next tick and a 10 s turret takes exactly 10 s.
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    const orders = intents[i]!.orders;
    if (!ship.alive || orders.length === 0) continue;
    for (const item of orders) placeOrder(world, ship, item);
  }

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

  // 6. Facing — one priority ladder per ship, always turn-rate-limited. The
  //    auto-aim target is acquired here (positions are final for the tick) and
  //    handed to the beam so acquisition happens exactly once.
  const autoTargets: (BeamHit | null)[] = world.ships.map(() => null);
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    if (!ship.alive) continue;
    const intent = intents[i]!;
    if (intent.fire && intent.auto) autoTargets[i] = acquireNearest(world, ship);
    resolveFacing(world, ship, intent, autoTargets[i]!, dt);
  }

  // 7. Beam — mine asteroids / damage ships (one beam, one stat; GDD §2.3).
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    if (ship.alive) fireBeam(world, ship, intents[i]!, autoTargets[i]!, hash, dt);
  }

  // 8. Turrets acquire, track, and fire; their shots fly and land (GDD §2.6).
  //    After the beam, so a turret killed this tick does not also get a shot
  //    off — the attacker's kill is worth the tick it cost them.
  updateTurrets(world, dt);
  updateProjectiles(world, dt);

  // 9. Chunk drift + proximity tractor collection (GDD §2.3).
  updateChunks(world, dt);

  // 10. End-of-tick cleanup: depleted asteroids and turrets killed this tick.
  //     Both are removed only here so every beam resolved this tick indexed a
  //     stable array (GDD §4.8).
  world.asteroids = world.asteroids.filter((a) => a.ore > 1e-9);
  sweepDeadTurrets(world);

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

  // Facing is resolved in its own phase after collisions (see `resolveFacing`),
  // so the nose can follow the ship's *post-bounce* travel direction.

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

// ---------------------------------------------------------------------------
// Facing (the priority ladder)
// ---------------------------------------------------------------------------

/**
 * Rotate a ship toward the facing it wants this tick, at most one class
 * turn-rate step. Priority (highest first):
 *
 *  1. **Explicit aim input** — mouse-aim delta, right stick, or an engaged
 *     touch aim stick; the sim only ever sees an `aim` action (GDD §2.4).
 *  2. **Auto-aim's engaged target** — the nose follows what the beam engaged.
 *  3. **Velocity** — with nothing aimed, the nose follows travel so motion
 *     reads naturally, once speed clears `FACE_VELOCITY_MIN_SPEED`.
 *  4. **Hold** — a stationary, unaimed ship keeps the facing it had.
 *
 * Rotation is *always* turn-rate limited, including toward an auto-aim target:
 * a hull never snaps. (Auto-aim's *engagement* is still the full 360° with no
 * front arc, per GDD §2.4 — the beam reaches its target while the hull is
 * still swinging around; see `fireBeam`.)
 */
function resolveFacing(world: World, ship: Ship, intent: Intent, autoTarget: BeamHit | null, dt: number): void {
  const desired = desiredFacing(world, ship, intent, autoTarget);
  if (desired === null) return; // priority 4: hold current facing
  const stats = SHIP_STATS[ship.shipClass];
  ship.angle = turnToward(ship.angle, desired, BASE_TURN_RATE * stats.turnMul * dt);
}

/** The angle a ship wants to face this tick, or null to hold (see ladder). */
function desiredFacing(world: World, ship: Ship, intent: Intent, autoTarget: BeamHit | null): number | null {
  // 1. Explicit aim input this tick.
  if (intent.aim && (intent.aim.x !== 0 || intent.aim.y !== 0)) {
    return Math.atan2(intent.aim.y, intent.aim.x);
  }

  // 2. Auto-aim's engaged target.
  if (autoTarget) {
    const t = targetPos(world, autoTarget);
    const dx = t.x - ship.pos.x;
    const dy = t.y - ship.pos.y;
    if (dx * dx + dy * dy > 1e-18) return Math.atan2(dy, dx);
  }

  // 3. Velocity, above the epsilon — nose follows travel.
  const sp2 = ship.vel.x * ship.vel.x + ship.vel.y * ship.vel.y;
  if (sp2 > FACE_VELOCITY_MIN_SPEED * FACE_VELOCITY_MIN_SPEED) {
    return Math.atan2(ship.vel.y, ship.vel.x);
  }

  // 4. Nothing to face.
  return null;
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

/**
 * What the beam struck. The full GDD §2.4 target list — "asteroid, ship,
 * turret, shield, or core". Shield and core are one `planet` hit: the bubble is
 * what stands in front of the core, and `damagePlanet` decides which pool the
 * damage lands in (GDD §2.6).
 *
 * Indices are into the arrays as they stand *this tick*; nothing is removed
 * from `asteroids` or `turrets` until end of step, so a hit resolved early in
 * the tick is still valid when it is applied.
 */
type BeamHit =
  | { kind: 'asteroid'; index: number }
  | { kind: 'ship'; index: number }
  | { kind: 'turret'; planet: number; index: number }
  | { kind: 'planet'; planet: number };

function fireBeam(
  world: World,
  ship: Ship,
  intent: Intent,
  autoTarget: BeamHit | null,
  hash: SpatialHash,
  dt: number,
): void {
  if (!intent.fire) {
    ship.beam = null;
    return;
  }

  let hit: BeamHit | null;
  let hitT: number; // distance along the beam to the first hit (BEAM_RANGE if none)
  // Beam direction — the ship's facing, except that an auto-aim beam runs to
  // the target it engaged (see below).
  let dx = Math.cos(ship.angle);
  let dy = Math.sin(ship.angle);

  if (intent.auto) {
    // Auto-aim: nearest valid target across the full 360°, no front arc
    // (GDD §2.4). Engagement does not wait for the hull — the beam runs to the
    // acquired target's surface while the nose turns toward it at the class
    // turn rate (`resolveFacing`), so a 360° engagement stays 360°.
    hit = autoTarget;
    if (hit) {
      const t = targetPos(world, hit);
      const aim = normalize({ x: t.x - ship.pos.x, y: t.y - ship.pos.y }, { x: dx, y: dy });
      dx = aim.x;
      dy = aim.y;
      hitT = surfaceDistance(ship, dx, dy, world, hit);
    } else {
      hitT = BEAM_RANGE;
    }
  } else {
    // Manual: raycast a segment along current facing, nearest hit wins.
    const cast = raycastBeam(world, ship, hash);
    hit = cast.hit;
    hitT = cast.t;
  }

  // Publish the beam geometry so the renderer stops the beam at the hit
  // (GDD §4.1). `length` clamps to range; `hitPoint` is null on a clean miss.
  const length = Math.min(hitT, BEAM_RANGE);
  ship.beam = {
    origin: { x: ship.pos.x, y: ship.pos.y },
    dir: { x: dx, y: dy },
    hitPoint: hit ? { x: ship.pos.x + dx * length, y: ship.pos.y + dy * length } : null,
    length,
  };

  if (!hit) return;

  // One beam, one stat — the same emitter mines rock, cuts hulls and turrets at
  // the ship rate, and cuts shields and cores at the core rate (GDD §2.8).
  switch (hit.kind) {
    case 'asteroid':
      mineAsteroid(world, world.asteroids[hit.index]!, ship, dt);
      break;
    case 'ship':
      damageShip(world, world.ships[hit.index]!, beamShipDps(ship.shipClass) * dt);
      break;
    case 'turret':
      damageTurret(world.planets[hit.planet]!.turrets[hit.index]!, beamShipDps(ship.shipClass) * dt);
      break;
    case 'planet':
      damagePlanet(world, world.planets[hit.planet]!, beamCoreDps(ship.shipClass) * dt);
      break;
  }
}

/** Distance from the ship to the surface of an acquired (auto-aim) target along
 *  the beam direction. The beam points at the target center, so the near
 *  intersection is `centerDist - radius`; falls back to range if degenerate. */
function surfaceDistance(ship: Ship, dx: number, dy: number, world: World, hit: BeamHit): number {
  const t = segCircle(ship.pos, dx, dy, targetPos(world, hit), targetRadius(world, hit));
  return t ?? BEAM_RANGE;
}

/**
 * Nearest valid target whose center is within beam range — asteroid, enemy
 * ship, enemy turret, or enemy planet, checked across the full 360° with no
 * front arc (GDD §2.4). Your own planet and your own turrets are never targets:
 * the beam passes over your home.
 */
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
  for (let p = 0; p < world.planets.length; p++) {
    const planet = world.planets[p]!;
    if (planet.owner === ship.id) continue;
    for (let i = 0; i < planet.turrets.length; i++) {
      const turret = planet.turrets[i]!;
      if (turret.hp <= 0) continue;
      const d2 = dist2(ship.pos, turret.pos);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { kind: 'turret', planet: p, index: i };
      }
    }
    if (!planet.alive || planet.spawnProtect > 0) continue;
    const d2 = dist2(ship.pos, planet.pos);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { kind: 'planet', planet: p };
    }
  }
  return best;
}

/** Center of whatever a beam hit resolved to. */
function targetPos(world: World, hit: BeamHit): Vec2 {
  switch (hit.kind) {
    case 'asteroid':
      return world.asteroids[hit.index]!.pos;
    case 'ship':
      return world.ships[hit.index]!.pos;
    case 'turret':
      return world.planets[hit.planet]!.turrets[hit.index]!.pos;
    case 'planet':
      return world.planets[hit.planet]!.pos;
  }
}

/** Collision radius of whatever a beam hit resolved to — for a planet, the
 *  shield bubble while one is up, the core body once they are down. */
function targetRadius(world: World, hit: BeamHit): number {
  switch (hit.kind) {
    case 'asteroid':
      return world.asteroids[hit.index]!.radius;
    case 'ship':
      return world.ships[hit.index]!.radius;
    case 'turret':
      return world.planets[hit.planet]!.turrets[hit.index]!.radius;
    case 'planet':
      return planetTargetRadius(world.planets[hit.planet]!);
  }
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

  // Enemy turrets and planets (≤8 planets × ≤4 turrets — a direct loop beats a
  // hash for that count). Your own home is skipped entirely, so no beam ever
  // stops on your own turret or core.
  for (let p = 0; p < world.planets.length; p++) {
    const planet = world.planets[p]!;
    if (planet.owner === ship.id) continue;
    for (let i = 0; i < planet.turrets.length; i++) {
      const turret = planet.turrets[i]!;
      if (turret.hp <= 0) continue;
      const hitT = segCircle(ship.pos, dx, dy, turret.pos, turret.radius);
      if (hitT !== null && hitT < bestT) {
        bestT = hitT;
        best = { kind: 'turret', planet: p, index: i };
      }
    }
    // A core inside spawn protection is not a target at all — the beam passes
    // over it rather than stopping dead on an invulnerable circle (GDD §2.1).
    if (!planet.alive || planet.spawnProtect > 0) continue;
    const hitT = segCircle(ship.pos, dx, dy, planet.pos, planetTargetRadius(planet));
    if (hitT !== null && hitT < bestT) {
      bestT = hitT;
      best = { kind: 'planet', planet: p };
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

// Ship damage, death, and the half-hold ore drop live in `./damage`, shared
// with turret fire (`./buildings`) so both killers agree exactly (GDD §2.7).

// ---------------------------------------------------------------------------
// Chunk drift + proximity tractor (GDD §2.3)
// ---------------------------------------------------------------------------

function updateChunks(world: World, dt: number): void {
  const range2 = TRACTOR.range * TRACTOR.range;
  for (const chunk of world.chunks) {
    // Nearest alive ship *with room in its hold* within tractor range pulls the
    // chunk in. A full hold never attracts: chunks stay where they are for
    // anyone (GDD §2.3). A chunk in flight toward a ship whose hold fills
    // mid-pull loses its target here and coasts to a stop under drag — dropping
    // back to free-floating, collectable by any ship that still has space.
    let target: Ship | null = null;
    let bestD2 = range2;
    for (const ship of world.ships) {
      if (!ship.alive) continue;
      if (ship.cargoCap - ship.cargo <= 1e-9) continue;
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
