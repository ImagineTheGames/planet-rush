/**
 * src/sim/step.ts — the deterministic fixed-timestep step. OWNER: Gameplay
 * Engineer. This is the sim: `step(world, inputs, dt)` advances the match one
 * tick, identically in the browser, the match server, and the QA harness
 * (GDD §4.1). No PixiJS, no DOM, no timers, no `Math.random`, no `Date.now` —
 * randomness is the seeded RNG in the world tree, and every rate is `* dt`.
 *
 * Day-1 scope (GDD §2.3, §2.8): ship Euler integration with drag, the one
 * weapon system as a pooled projectile that both mines asteroids and damages
 * ships (one weapon, one stat — ratified amendment v0.3, the mining laser retired),
 * asteroids that crack and burst into ore chunks, proximity-tractor collection
 * into a capped hold, turn-rate-limited facing (aim input → auto-aim target →
 * velocity → hold), and ship-vs-asteroid reflection — all over a uniform-grid
 * spatial-hash broad phase.
 *
 * Day-2 scope (GDD §2.1, §2.5, §2.6): home planets and their cores in the ring
 * layout, the Build & Upgrade orders (turret, shield, repair channel, bank),
 * construction timers, shield regeneration, turret auto-fire with pooled
 * projectiles, and the ship weapon's full target list — turrets, shields and
 * cores (GDD §2.4).
 *
 * Day-2 endgame (GDD §1, §2.3, §2.7): the five asteroid waves on their
 * metronome, each landing closer to centre than the last (`./waves`); core
 * destruction, elimination, the wreck and its scavengeable debris; the collapse
 * phase; and win/loss with the last-to-die tiebreak (`./match`).
 *
 * Day-4 scope (GDD §2.5, §2.11): **ship classes take effect.** Every stat the
 * step reads — acceleration, top speed, turn rate, weapon damage, core damage,
 * mining rate, hull, hold — now comes from `./upgrades`, which resolves the
 * §2.11 class base against the §2.5 tier ladder the player has been buying with
 * ore. Tiers are bought through the action stream (`upgradeOrder`), persist
 * through respawn, and *multiply* the class base, so the hull a player picked in
 * the lobby still decides who they are at every tier.
 *
 * Subsystem order is fixed and documented; it is part of the determinism
 * contract (GDD §4.8 — same inputs, same final state hash).
 */

import type { Action, BuildItem, PlayerId, UpgradeTrack, Vec2 } from '@shared/types';
import {
  ASTEROID,
  WEAPON_RANGE,
  BOOST_MULTIPLIER,
  CHUNK,
  DEPOSIT,
  DRAG,
  FACE_VELOCITY_MIN_SPEED,
  HASH_CELL_SIZE,
  PLANET,
  SHIP_ASTEROID_RESTITUTION,
  SHIP_WEAPON,
  SPAWN_PROTECTION_S,
  TICK_DT,
  TRACTOR,
} from './constants';
import {
  buyUpgrade,
  inAtmosphere,
  placeOrder,
  planetOf,
  sweepDeadTurrets,
  updatePlanets,
  updateTurrets,
} from './buildings';
import { areEnemies } from './allegiance';
import { fireShipProjectile, leadAim, updateProjectiles } from './projectiles';
import { updateMatch } from './match';
import { SpatialHash } from './spatial-hash';
import type { Asteroid, OreChunk, Planet, Ship, World } from './state';
import {
  refreshDerivedStats,
  shipAccel,
  shipProjectileSpeed,
  shipTopSpeed,
  shipTurnRate,
} from './upgrades';
import { dist2, normalize } from './vec';
import { spawnDueWaves } from './waves';

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
  /** Upgrade-panel row presses this tick, same terms as `orders` (GDD §2.5). */
  upgrades: UpgradeTrack[];
}

const NO_ORDERS: BuildItem[] = [];
const NO_UPGRADES: UpgradeTrack[] = [];
const NO_INTENT: Intent = {
  thrust: { x: 0, y: 0 },
  aim: null,
  fire: false,
  auto: false,
  boost: false,
  orders: NO_ORDERS,
  upgrades: NO_UPGRADES,
};

/** Collapse a tick's actions into one intent (last write wins per verb; wheel
 *  orders and panel presses accumulate). */
function resolveIntent(actions: readonly Action[]): Intent {
  const intent: Intent = {
    thrust: { x: 0, y: 0 },
    aim: null,
    fire: false,
    auto: false,
    boost: false,
    orders: NO_ORDERS,
    upgrades: NO_UPGRADES,
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
      case 'upgradeOrder':
        if (intent.upgrades === NO_UPGRADES) intent.upgrades = [];
        intent.upgrades.push(a.track);
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
  //    An eliminated player's ship is not on a clock — their home is a wreck and
  //    their match is over (GDD §2.7).
  for (const ship of world.ships) {
    if (ship.alive) {
      if (ship.spawnProtect > 0) ship.spawnProtect = Math.max(0, ship.spawnProtect - dt);
      // Weapon reload recovers every tick, firing or not, so the first shot of an
      // engagement is instant and the cadence is `SHIP_WEAPON.fireInterval`
      // thereafter (design amendment v0.2). `?? 0` — an untagged fixture ship
      // reads as ready (see `Ship.weaponCooldown`).
      const cd = ship.weaponCooldown ?? 0;
      if (cd > 0) ship.weaponCooldown = Math.max(0, cd - dt);
    } else if (!ship.eliminated) {
      ship.respawnTimer -= dt;
      if (ship.respawnTimer <= 0) respawn(ship);
    }
  }

  // 1a. Asteroid waves: whatever the metronome owes by now, each landing closer
  //     to centre than the last (GDD §2.3). Before movement and the broad phase,
  //     so a rock that arrives this tick is collidable and minable this tick.
  spawnDueWaves(world);

  // 1b. Planets: core spawn protection, the undamaged clock, construction
  //     timers, shield regen, and the repair channel (GDD §2.5, §2.6). Ahead of
  //     this tick's damage, so a hit landing now is felt next tick — never
  //     retroactively cancelling a repair that already ticked.
  updatePlanets(world, dt);

  // 2. Resolve intents once, indexed to ships by id.
  const intents = world.ships.map((s) => intentFor(s.id, inputs));

  // 2b. Wheel orders — validated and paid for here, so a job ordered this tick
  //     starts its clock next tick and a 10 s turret takes exactly 10 s. Then the
  //     upgrade panel's row presses, from the same wallet: a tick carrying both
  //     spends on the planet first and the ship second, which is arbitrary but
  //     fixed, and part of the determinism contract (GDD §4.8). In practice they
  //     are one-shot presses on two different screens, so a tick carries one.
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    const intent = intents[i]!;
    if (!ship.alive) continue;
    for (const item of intent.orders) placeOrder(world, ship, item);
    for (const track of intent.upgrades) buyUpgrade(world, ship, track);
  }

  // 3. Movement — Euler integration with drag (GDD §4.1).
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    if (ship.alive) integrate(ship, intents[i]!, dt, world.bounds);
  }

  // 4. Broad phase over the (static) asteroid field, reused by collision + shots.
  const hash = SpatialHash.from(world.asteroids.map((a) => a.pos), HASH_CELL_SIZE);

  // 5. Ship-vs-asteroid and ship-vs-planet reflection (GDD §4.1).
  for (const ship of world.ships) {
    if (!ship.alive) continue;
    reflectOffAsteroids(ship, world.asteroids, hash);
    reflectOffPlanets(ship, world);
  }

  // 6. Facing — one priority ladder per ship, always turn-rate-limited. The
  //    auto-aim target is acquired here (positions are final for the tick) and
  //    handed to the weapon so acquisition happens exactly once.
  const autoTargets: (AimTarget | null)[] = world.ships.map(() => null);
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    if (!ship.alive) continue;
    const intent = intents[i]!;
    if (intent.fire && intent.auto) autoTargets[i] = acquireNearest(world, ship);
    resolveFacing(world, ship, intent, autoTargets[i]!, dt);
  }

  // 7. Fire — one weapon system (ratified amendment v0.3). Holding fire looses a
  //    pooled projectile on the weapon cadence; what it strikes first decides its
  //    effect — a rock is chipped for ore, a ship or structure is damaged. Still
  //    one trigger and one power stat: mine and fight with the same verb.
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    if (ship.alive) fireShip(world, ship, intents[i]!, autoTargets[i]!);
  }

  // 8. Turrets acquire, track, and fire; every shot — ship weapon and turret
  //    alike — then flies and lands, chipping a rock or biting a hull (GDD §2.6).
  //    After the ship fire step, so a turret killed this tick does not also get a
  //    shot off, and a ship shot fired this tick advances and can strike this
  //    tick. The asteroid broad phase (`hash`) narrows each shot's rock test.
  updateTurrets(world, dt);
  updateProjectiles(world, hash, dt);

  // 8b. Auto-deposit: a ship docked at its own planet drains its hold into the
  //     safe bank at a steady rate and spins off the ore-flight chunks that show
  //     it (field report v0.1.2; GDD §2.3, §2.5). Before the chunk update, so a
  //     courier emitted this tick starts its flight home this tick.
  updateDeposits(world, dt);

  // 9. Chunk drift + proximity tractor collection (GDD §2.3), and the homing of
  //    deposit couriers spun off just above.
  updateChunks(world, dt);

  // 10. End-of-tick cleanup: depleted asteroids and turrets killed this tick.
  //     Both are removed only here so every shot resolved this tick indexed a
  //     stable array (GDD §4.8).
  world.asteroids = world.asteroids.filter((a) => a.ore > 1e-9);
  sweepDeadTurrets(world);

  // 11. The match itself: enter collapse when the field is spent, and resolve a
  //     winner when one home is left standing (GDD §1, §2.3). Last, so a core
  //     that died anywhere in this tick is counted in this tick's result.
  updateMatch(world, dt);

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
  // Class base × engine tier (GDD §2.11, §2.5) — resolved in `./upgrades`, so the
  // hull a player picked and the ore they spent on it arrive as one number.
  const boost = intent.boost ? BOOST_MULTIPLIER : 1;
  const accel = shipAccel(ship) * boost;
  const maxSpeed = shipTopSpeed(ship) * boost;

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
 *  2. **Auto-aim's engaged target** — the nose follows what the weapon engaged.
 *  3. **Velocity** — with nothing aimed, the nose follows travel so motion
 *     reads naturally, once speed clears `FACE_VELOCITY_MIN_SPEED`.
 *  4. **Hold** — a stationary, unaimed ship keeps the facing it had.
 *
 * Rotation is *always* turn-rate limited, including toward an auto-aim target:
 * a hull never snaps. (Auto-aim's *engagement* is still the full 360° with no
 * front arc, per GDD §2.4 — a shot reaches its target while the hull is
 * still swinging around; see `fireShip`.)
 */
function resolveFacing(world: World, ship: Ship, intent: Intent, autoTarget: AimTarget | null, dt: number): void {
  const desired = desiredFacing(world, ship, intent, autoTarget);
  if (desired === null) return; // priority 4: hold current facing
  // Turn rate is class-only — no upgrade buys agility (`./upgrades`).
  ship.angle = turnToward(ship.angle, desired, shipTurnRate(ship) * dt);
}

/** The angle a ship wants to face this tick, or null to hold (see ladder). */
function desiredFacing(world: World, ship: Ship, intent: Intent, autoTarget: AimTarget | null): number | null {
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
    reflectOffCircle(ship, a.pos, a.radius);
  }
}

/** Planets are solid bodies too — you dock *at* your world, you do not fly
 *  through it. Same contact response as a rock (GDD §4.1: every colliding body
 *  is a circle); the shield bubble is energy and is not a collider. */
function reflectOffPlanets(ship: Ship, world: World): void {
  for (const planet of world.planets) {
    reflectOffCircle(ship, planet.pos, planet.radius);
  }
}

/** Push a ship out of an overlapping circle and reflect the normal component of
 *  its velocity. No sqrt until a contact is confirmed. */
function reflectOffCircle(ship: Ship, center: Vec2, radius: number): void {
  const rr = ship.radius + radius;
  const d2 = dist2(ship.pos, center);
  if (d2 >= rr * rr) return;

  // Overlapping: separate along the contact normal and reflect velocity.
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? (ship.pos.x - center.x) / d : 1;
  const ny = d > 1e-9 ? (ship.pos.y - center.y) / d : 0;
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

// ---------------------------------------------------------------------------
// Firing — one weapon system (ratified amendment v0.3; GDD §2.3, §2.4)
// ---------------------------------------------------------------------------

/**
 * A target auto-aim can acquire across the full 360° (GDD §2.4) — the full
 * target list "asteroid, ship, turret, shield, or core". Shield and core are one
 * `planet` hit: the bubble stands in front of the core and `damagePlanet` decides
 * which pool takes the damage (GDD §2.6). Used for *facing* and for the auto-aim
 * lead; the actual hit is resolved by the projectile against live geometry.
 *
 * Indices are into the arrays as they stand *this tick*; nothing is removed from
 * `asteroids` or `turrets` until end of step, so a target acquired early in the
 * tick is still valid when the shot is aimed.
 */
type AimTarget =
  | { kind: 'asteroid'; index: number }
  | { kind: 'ship'; index: number }
  | { kind: 'turret'; planet: number; index: number }
  | { kind: 'planet'; planet: number };

/**
 * One trigger, one verb (ratified amendment v0.3 — "projectiles for everything").
 * Holding fire looses a pooled weapon projectile on the fire cadence; the shot
 * chips a rock or damages a hull/structure, whichever it reaches first
 * (`./projectiles`), so mining and fighting are the same act and "you cannot
 * shoot through things" falls out of the collision. Mining rate and weapon damage
 * still ride the one power stat (GDD §2.5).
 *
 *  - **Manual** — the shot fires straight down the barrel (the player's facing is
 *    the aim). If a rock is ahead it is mined; if an enemy is ahead it is hit.
 *  - **Auto-aim** — the nearest valid target acquired in the facing phase is shot,
 *    with an intercept lead on a moving ship so the full-360° engagement lands on
 *    a mover, or a straight shot at a rock, turret or core (GDD §2.4).
 *
 * `ship.firing` is the surviving **firing tell** — true on any tick the trigger
 * is engaged with a shot going out (mining or fighting), `false` otherwise. It is
 * the signal the netcode's "firing" bit (`src/net/snapshot.ts`), the bots' threat
 * read, and the renderer's in-combat glow key off; there is no longer any line
 * geometry, because a ship's shots are drawn from the projectile pool.
 */
function fireShip(world: World, ship: Ship, intent: Intent, autoTarget: AimTarget | null): void {
  ship.firing = false;
  if (!intent.fire) return;

  if (intent.auto) {
    // Auto-aim: the nearest valid target across the full 360°, acquired in the
    // facing phase. Nothing in range ⇒ hold fire.
    if (!autoTarget) return;
    ship.firing = true;
    fireWeapon(world, ship, weaponLead(world, ship, autoTarget));
    return;
  }

  // Manual: the shot goes straight down the barrel and hits whatever it reaches
  // first — a rock ahead is chipped for ore, an enemy ahead is bitten.
  ship.firing = true;
  fireWeapon(world, ship, { x: Math.cos(ship.angle), y: Math.sin(ship.angle) });
}

/** Loose one weapon projectile along unit `dir` if the reload is ready, then
 *  start the reload (design amendment v0.2). Damage, speed and lifetime read from
 *  the ship's power-upgrade state inside `fireShipProjectile`. */
function fireWeapon(world: World, ship: Ship, dir: Vec2): void {
  if ((ship.weaponCooldown ?? 0) > 0) return;
  fireShipProjectile(world, ship, dir);
  ship.weaponCooldown = SHIP_WEAPON.fireInterval;
}

/**
 * The unit aim for an auto-aim weapon shot at a non-asteroid target: an
 * intercept lead on a moving ship (so a strafing enemy is actually hit, design
 * amendment v0.2 item 5), or a straight shot at a stationary turret or core.
 */
function weaponLead(world: World, ship: Ship, hit: AimTarget): Vec2 {
  const t = targetPos(world, hit);
  if (hit.kind === 'ship') {
    return leadAim(ship.pos, t, world.ships[hit.index]!.vel, shipProjectileSpeed(ship));
  }
  return normalize(
    { x: t.x - ship.pos.x, y: t.y - ship.pos.y },
    { x: Math.cos(ship.angle), y: Math.sin(ship.angle) },
  );
}

/**
 * Nearest valid target whose center is within engagement range — asteroid, enemy
 * ship, enemy turret, or enemy planet, checked across the full 360° with no
 * front arc (GDD §2.4). Your own planet and your own turrets are never targets:
 * a shot passes over your home.
 */
function acquireNearest(world: World, ship: Ship): AimTarget | null {
  let best: AimTarget | null = null;
  let bestD2 = WEAPON_RANGE * WEAPON_RANGE;
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
    // A spawn-protected ship is not a target at all — a shot passes over it,
    // exactly as it passes over a spawn-protected core (the projectile collision
    // skips both, GDD §2.1). Acquiring it would aim auto-fire at an invulnerable
    // hull that takes zero damage with no tell (field report: "some ships would
    // not take damage from me"), and worse, auto-aim would lock onto it instead
    // of a live enemy standing right beside it.
    if (!areEnemies(world, ship.id, t.id) || !t.alive || t.spawnProtect > 0) continue;
    const d2 = dist2(ship.pos, t.pos);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { kind: 'ship', index: i };
    }
  }
  for (let p = 0; p < world.planets.length; p++) {
    const planet = world.planets[p]!;
    if (!areEnemies(world, ship.id, planet.owner)) continue;
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

/** Center of whatever a shot's target resolved to. */
function targetPos(world: World, hit: AimTarget): Vec2 {
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

// Mining is shooting now (ratified amendment v0.3): a ship weapon projectile that
// strikes an asteroid chips its ore and spawns the drifting chunks. That logic
// moved to `./projectiles` (`chipAsteroid`), where the shot resolves its hit —
// so mining, combat, and the "you cannot shoot through things" rule all fall out
// of the one collision. Ore chunk drift + the proximity tractor stay below.

// Ship damage, death, and the half-hold ore drop live in `./damage`, shared
// with turret fire (`./buildings`) so both killers agree exactly (GDD §2.7).

// ---------------------------------------------------------------------------
// Chunk drift + proximity tractor (GDD §2.3)
// ---------------------------------------------------------------------------

function updateChunks(world: World, dt: number): void {
  const range2 = TRACTOR.range * TRACTOR.range;
  for (const chunk of world.chunks) {
    // Deposit couriers fly home and are absorbed, and are never tractored or
    // collected — the ore they represent already left the hold for the bank in
    // `updateDeposits`, so grabbing one back would double-count it.
    if (chunk.deposit) {
      updateDepositFlight(chunk, dt);
      continue;
    }
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

  // Drop emptied chunks (collected mines and arrived deposit couriers alike).
  world.chunks = world.chunks.filter((c) => c.amount > 1e-9);
}

// ---------------------------------------------------------------------------
// Auto-deposit inside your own planet's atmosphere
// (field report v0.1.2; GDD §2.3, §2.5; ratified p4)
// ---------------------------------------------------------------------------

/**
 * While a ship is inside its own living planet's atmosphere (`DEPOSIT_RANGE`),
 * drain its hold into the safe banked total at `DEPOSIT.drainRate` and, on a
 * fixed tick cadence, spin off a courier chunk that flies ship→planet to show
 * it. Leave the atmosphere (or empty the hold, or lose the planet) and the drain
 * simply stops the next tick — the transfer is readable and interruptible,
 * exactly as the field report asks. There is no dock or park gate any more
 * (ratified p4: "just be in that atmosphere").
 *
 * The transfer is authoritative here (hold and bank are the truth the HUD ticks
 * off); the couriers are cosmetic and carry no ore, so this can never bank more
 * than the hold held. Deterministic: the cadence is keyed to the integer tick,
 * the courier's heading is pure geometry, and no RNG is drawn.
 */
function updateDeposits(world: World, dt: number): void {
  // Interval → whole ticks on the canonical grid, so the cadence is the same
  // whatever `dt` a caller steps at (part of the determinism contract).
  const flightEvery = Math.max(1, Math.round(DEPOSIT.flightInterval / TICK_DT));
  const emitThisTick = world.tick % flightEvery === 0;
  for (const ship of world.ships) {
    if (!ship.alive || ship.cargo <= 1e-9) continue;
    // Ratified p4: just be in the atmosphere. No dock and no park gate — the
    // drain runs the tick a ship crosses into `DEPOSIT_RANGE` at its own living
    // planet and stops the tick it crosses back out (interruptible as before).
    const planet = planetOf(world, ship.id);
    if (!planet || !planet.alive || !inAtmosphere(ship, planet)) continue;

    // Smooth, authoritative transfer hold → bank (GDD §2.3: banked ore is safe).
    const moved = Math.min(ship.cargo, DEPOSIT.drainRate * dt);
    ship.cargo -= moved;
    ship.banked += moved;
    if (ship.cargo < 1e-9) ship.cargo = 0;

    // The telegraph: a courier chunk leaves the hull for the planet.
    if (emitThisTick) spawnDepositFlight(world, ship, planet);
  }
}

/** Spin off one ore-flight courier from `ship` toward `planet`. Pooled through
 *  the same chunk array (and the same renderer) as mined ore; flagged `deposit`
 *  so it is homed and absorbed rather than tractored (see {@link updateChunks}). */
function spawnDepositFlight(world: World, ship: Ship, planet: Planet): void {
  const dir = normalize({ x: planet.pos.x - ship.pos.x, y: planet.pos.y - ship.pos.y });
  world.chunks.push({
    id: world.nextEntityId++,
    pos: { x: ship.pos.x, y: ship.pos.y },
    vel: { x: dir.x * DEPOSIT.flightSpeed, y: dir.y * DEPOSIT.flightSpeed },
    // Cosmetic: one chunk's worth of sprite, not one chunk's worth of ore — the
    // ore already moved in `updateDeposits`. Zeroed on arrival to be swept.
    amount: CHUNK.ore,
    radius: CHUNK.radius,
    deposit: true,
    homeTo: { x: planet.pos.x, y: planet.pos.y },
  });
}

/** Fly a deposit courier straight at its planet and mark it spent on arrival.
 *  Re-homed every tick because the docked ship it left may still be drifting to
 *  rest, so the stream reads as a clean line into the core. */
function updateDepositFlight(chunk: OreChunk, dt: number): void {
  const home = chunk.homeTo;
  if (!home) {
    chunk.amount = 0; // malformed courier (no target): drop it this sweep
    return;
  }
  const dx = home.x - chunk.pos.x;
  const dy = home.y - chunk.pos.y;
  const d2 = dx * dx + dy * dy;
  // Reached the planet surface: the bank already holds this ore, so the courier
  // is absorbed — zero its amount for the end-of-tick sweep in `updateChunks`.
  if (d2 <= PLANET.radius * PLANET.radius) {
    chunk.amount = 0;
    return;
  }
  const d = Math.sqrt(d2);
  chunk.vel.x = (dx / d) * DEPOSIT.flightSpeed;
  chunk.vel.y = (dy / d) * DEPOSIT.flightSpeed;
  chunk.pos.x += chunk.vel.x * dt;
  chunk.pos.y += chunk.vel.y * dt;
}

// ---------------------------------------------------------------------------
// Respawn (GDD §2.7)
// ---------------------------------------------------------------------------

/**
 * Come back at your home planet, five seconds later, with **everything you
 * bought still on the hull** (GDD §2.7: "free and fast … upgrades intact").
 *
 * Upgrade persistence is *structural*, not a promise that this function happens
 * not to break: `tiers` is the only record of what a player owns, respawn never
 * writes it, and the derived ceilings are re-derived from it here — so a fresh
 * hull is exactly as good as the one that died, and no future edit to this path
 * can quietly cost a player a tier they paid for (GDD §2.5).
 *
 * The bank is never lost to a ship death either, so the cost of dying stays
 * exactly what the design says it is: time, position, and the half-hold already
 * dropped as debris where you exploded (`killShip`).
 */
function respawn(ship: Ship): void {
  ship.alive = true;
  refreshDerivedStats(ship);
  ship.hull = ship.maxHull;
  ship.pos.x = ship.home.x;
  ship.pos.y = ship.home.y;
  ship.vel.x = 0;
  ship.vel.y = 0;
  ship.cargo = 0;
  ship.respawnTimer = 0;
  ship.spawnProtect = SPAWN_PROTECTION_S;
  ship.weaponCooldown = 0;
}
