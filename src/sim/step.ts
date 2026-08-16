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
 * Day-2 scope (GDD §2.1, §2.5, §2.6): home stations and their cores in the ring
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
  AUTO_AIM_ARC,
  WEAPON_RANGE,
  CHUNK,
  DEPOSIT,
  DRAG,
  FACE_VELOCITY_MIN_SPEED,
  HASH_CELL_SIZE,
  STATION,
  SHIP_ASTEROID_RESTITUTION,
  SHIP_WEAPON,
  SPAWN_PROTECTION_S,
  TICK_DT,
  TRACTOR,
  WEDGE_ESCAPE_PROGRESS,
  WEDGE_SLIDE_KICK,
  WEDGE_SLIDE_RUN_S,
  WEDGE_CONTACT_S,
} from './constants';
import {
  buyUpgrade,
  inAtmosphere,
  placeOrder,
  stationOf,
  stationTargetRadius,
  sweepDeadSatellites,
  sweepDeadTurrets,
  updateSatellites,
  updateStations,
  updateTurrets,
} from './buildings';
import { areEnemies } from './allegiance';
import { fireShipProjectile, leadAim, updateProjectiles } from './projectiles';
import { updateMatch } from './match';
import { updateSensory } from './sensing';
import { ledgerAdd } from './ore-ledger';
import { journalOre } from './ore-journal';
import { SpatialHash } from './spatial-hash';
import type { Asteroid, OreChunk, MiningStation, Ship, World } from './state';
import {
  refreshDerivedStats,
  shipAccel,
  shipProjectileSpeed,
  shipTopSpeed,
  shipTurnRate,
} from './upgrades';
import { dist2, len, normalize } from './vec';
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
        // Opening the wheel is UI-side; the sim acts only on the confirmed
        // order (`buildOrder`).
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

  // 1b. Stations: core spawn protection, the undamaged clock, construction
  //     timers, shield regen, and the repair channel (GDD §2.5, §2.6). Ahead of
  //     this tick's damage, so a hit landing now is felt next tick — never
  //     retroactively cancelling a repair that already ticked.
  updateStations(world, dt);

  // 2. Resolve intents once, indexed to ships by id.
  const intents = world.ships.map((s) => intentFor(s.id, inputs));

  // 2b. Wheel orders — validated and paid for here, so a job ordered this tick
  //     starts its clock next tick and a 10 s turret takes exactly 10 s. Then the
  //     upgrade panel's row presses, from the same wallet: a tick carrying both
  //     spends on the station first and the ship second, which is arbitrary but
  //     fixed, and part of the determinism contract (GDD §4.8). In practice they
  //     are one-shot presses on two different screens, so a tick carries one.
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    const intent = intents[i]!;
    if (!ship.alive) continue;
    for (const item of intent.orders) placeOrder(world, ship, item);
    for (const track of intent.upgrades) buyUpgrade(world, ship, track);
  }

  // 3. Movement — Euler integration with drag (GDD §4.1). The throttle tell is
  //    published here, from the same intent `integrate` is about to spend, so the
  //    engine the renderer draws and the acceleration the ship got are one number
  //    (a0-47 — see `Ship.thrust`). Every ship, every tick, dead ones included:
  //    a tell that is only written sometimes is a tell that goes stale.
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    const intent = intents[i]!;
    ship.thrust = ship.alive ? len(intent.thrust) : 0;
    if (ship.alive) integrate(ship, intent, dt, world.bounds);
  }

  // 4. Broad phase over the (static) asteroid field, reused by collision + shots.
  const hash = SpatialHash.from(world.asteroids.map((a) => a.pos), HASH_CELL_SIZE);

  // 5. Ship-vs-asteroid and ship-vs-station reflection (GDD §4.1), then the
  //    persistent-grind escape hatch (developer report p14): a hull pressed into
  //    a body and held near-still by it accrues grind-time; once it crosses
  //    `WEDGE_CONTACT_S` it is slid off the rim so it can never stay pinned. The
  //    contact accumulator is reused across ships to keep the loop allocation-free.
  const contact: WedgeContact = { pressedIn: false, nx: 0, ny: 0 };
  for (const ship of world.ships) {
    if (!ship.alive) continue;
    contact.pressedIn = false;
    reflectOffAsteroids(ship, world.asteroids, hash, contact);
    reflectOffStations(ship, world, contact);
    updateWedgeEscape(ship, contact, dt);
  }

  // 6. Facing — one priority ladder per ship, always turn-rate-limited. The
  //    auto-aim target is acquired here (positions are final for the tick) and
  //    handed to the weapon so acquisition happens exactly once.
  const autoTargets: (AimTarget | null)[] = world.ships.map(() => null);
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    if (!ship.alive) continue;
    const intent = intents[i]!;
    if (intent.fire && intent.auto) autoTargets[i] = acquireAimTarget(world, ship);
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
  //    alike — then flies and lands to chip a rock or bite a hull (GDD §2.6).
  //    After the ship fire step, so a turret killed this tick does not also get a
  //    shot off, and a ship shot fired this tick advances and can strike this
  //    tick. The asteroid broad phase (`hash`) narrows each shot's rock test.
  updateTurrets(world, dt);
  // 8a. Radar satellites orbit their stations (feature f1) — advanced here, with
  //     the other station bodies and before the projectile sweep, so a shot this
  //     tick collides with each satellite at its fresh orbit position.
  updateSatellites(world, dt);
  updateProjectiles(world, hash, dt);

  // 8b. Auto-deposit: a ship docked at its own station drains its hold into the
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
  // Drop radar satellites killed this tick (feature f1); their coverage already
  // collapsed the tick their HP hit zero (`./sensing` reads only hp > 0).
  sweepDeadSatellites(world);

  // 11. The match itself: enter collapse when the field is spent, and resolve a
  //     winner when one home is left standing (GDD §1, §2.3). Last, so a core
  //     that died anywhere in this tick is counted in this tick's result.
  updateMatch(world, dt);

  // 12. Fold this tick's sensor coverage into the per-player "remembered
  //     geography" memory (feature f1) — the minimap fog's persistent half. Last,
  //     after every body (including a core `updateMatch` just took) has its final
  //     tick position/liveness, so what a player remembers matches what they could
  //     see this tick. A pure read-model fold: it writes only `world.sensory`.
  updateSensory(world);

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
  const accel = shipAccel(ship);
  const maxSpeed = shipTopSpeed(ship);

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

/** The grind a ship suffered against a body this tick, filled by the reflection
 *  pass for the escape hatch (`updateWedgeEscape`): whether it pressed *into* a
 *  body (`vn < 0` on some contact) and the outward normal of that contact. One
 *  instance is reused per tick, so the collision path allocates nothing. */
interface WedgeContact {
  pressedIn: boolean;
  /** Outward contact normal of the pressed-into body (unit). */
  nx: number;
  ny: number;
}

function reflectOffAsteroids(ship: Ship, asteroids: Asteroid[], hash: SpatialHash, contact: WedgeContact): void {
  const candidates = hash.query(ship.pos, ship.radius + ASTEROID.maxRadius);
  for (const idx of candidates) {
    const a = asteroids[idx];
    if (!a) continue;
    reflectOffCircle(ship, a.pos, a.radius, contact);
  }
}

/** Stations are solid bodies too — you dock *at* your world, you do not fly
 *  through it. Same contact response as a rock (GDD §4.1: every colliding body
 *  is a circle); the shield bubble is energy and is not a collider. */
function reflectOffStations(ship: Ship, world: World, contact: WedgeContact): void {
  for (const station of world.stations) {
    reflectOffCircle(ship, station.pos, station.radius, contact);
  }
}

/** Push a ship out of an intersecting circle and reflect the normal component of
 *  its velocity. No sqrt until a contact is confirmed. Records an inward press
 *  into `contact` for the persistent-grind escape hatch (`updateWedgeEscape`,
 *  developer report p14) — this function no longer touches velocity beyond the
 *  reflection, so a momentary touch is byte-for-byte the pre-p14 response. */
function reflectOffCircle(ship: Ship, center: Vec2, radius: number, contact: WedgeContact): void {
  const rr = ship.radius + radius;
  const d2 = dist2(ship.pos, center);
  if (d2 >= rr * rr) return;

  // Intersecting: separate along the contact normal and reflect velocity.
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
    // Pressed *into* this body — the grind that, if it persists, wedges the hull.
    // Record it (and its normal) for the escape hatch; the last pressed-into body
    // this tick wins, which for the single-body pin the report photographed is
    // exactly that body.
    contact.pressedIn = true;
    contact.nx = nx;
    contact.ny = ny;
  }
}

/**
 * The in-sim wedge escape hatch (developer report p14). A ship whose steering
 * keeps aiming *through* a body — an arrival point at or inside its collision
 * radius — presses in every tick and the reflection kills that push, so it is
 * ground to near-stillness against the surface and, with no tangential velocity
 * for a pure radial press to preserve, stays there. The bot-side net-progress
 * detector cannot see it (a home-bound bot decelerating onto its station reports
 * a low throttle it reads as arrival), so the guarantee is made here, off the
 * sim's own ground truth, for EVERY ship against EVERY solid body.
 *
 * It gates on *persistent* grind, not any contact: while a ship is both pressing
 * into a body and held below `WEDGE_SLIDE_SPEED` by it, `wedgeContactS` counts up;
 * any tick it breaks contact or gets moving, it resets. Only past `WEDGE_CONTACT_S`
 * — a genuine pin, not a bounce — does it earn a deterministic tangential slide
 * along the surface (counter-clockwise about the outward normal, fixed handedness:
 * no RNG, no clock). The slide walks the pinned hull off the rim; the pilot's
 * steering then re-approaches from open space. The kick RAMPS to zero as speed
 * nears the threshold, so it self-limits and reads as a slide, not a launch, and
 * drag bleeds it the instant the press stops. Leaving a momentary touch on the
 * pre-p14 path (no shove) is what keeps the netcode's snapshot-quantized
 * prediction convergent (`src/net/prediction`; `WEDGE_CONTACT_S`).
 */
/** Drop any committed escape slide, in place — the zero vector IS "no slide",
 *  so a ship never allocates one per contact (GDD §4.3). */
function clearSlide(ship: Ship): void {
  const slide = ship.wedgeSlide;
  if (slide) {
    slide.x = 0;
    slide.y = 0;
  }
}

function updateWedgeEscape(ship: Ship, contact: WedgeContact, dt: number): void {
  // The anchor is the whole memory of a grind, and it is dropped for EXACTLY one
  // reason: the hull actually went somewhere. Not for a tick without contact — a
  // hull rattling in a pocket loses its press for single ticks all the time, and
  // resetting on that was the loop this hatch was written to break: press in,
  // two futile seconds of slide, one free tick, forget everything, repeat, for
  // the rest of the match.
  const anchor = ship.wedgeAnchor;
  if (!anchor) {
    if (contact.pressedIn) ship.wedgeAnchor = { x: ship.pos.x, y: ship.pos.y };
    ship.wedgeContactS = 0;
    clearSlide(ship);
    return;
  }
  const dx = ship.pos.x - anchor.x;
  const dy = ship.pos.y - anchor.y;
  if (dx * dx + dy * dy >= WEDGE_ESCAPE_PROGRESS * WEDGE_ESCAPE_PROGRESS) {
    // Real headway — sliding along a rim, bouncing off, rounding a station, or a
    // committed escape that worked. Re-anchor here; nothing is pinned.
    anchor.x = ship.pos.x;
    anchor.y = ship.pos.y;
    ship.wedgeContactS = 0;
    clearSlide(ship);
    return;
  }
  // Still inside the ring, but not pressing into anything this tick: hold the
  // commitment (above) and simply do not accrue pin time. A hull drifting free
  // will clear the ring on its own in a fraction of a second.
  if (!contact.pressedIn) return;

  const held = (ship.wedgeContactS ?? 0) + dt;
  ship.wedgeContactS = held;
  if (held < WEDGE_CONTACT_S) return;

  // Commit to ONE slide direction for the whole escape (`Ship.wedgeSlide`): the
  // tangent is taken about the body last pressed into, and a hull in a V presses
  // into a different one every tick, so a freshly-derived tangent flips as fast
  // as the contact does and the two cancel.
  let slide = ship.wedgeSlide;
  // A committed run that has itself gone nowhere for a full window is pushing
  // into the pocket's other wall. Turn it a quarter-turn and try again: the
  // tangent first, then *outward along the contact normal* — back out the way the
  // hull came, which is the only exit from a symmetric notch and the one no
  // tangential slide can ever find — then the other tangent, then inward. Four
  // quarter-turns is the whole neighbourhood of a contact, so the search is
  // bounded, and each is a coordinate swap: deterministic, no RNG, no clock.
  if (slide && (slide.x !== 0 || slide.y !== 0) && held >= WEDGE_CONTACT_S + WEDGE_SLIDE_RUN_S) {
    const { x, y } = slide;
    slide.x = y;
    slide.y = -x;
    ship.wedgeContactS = WEDGE_CONTACT_S;
  } else if (!slide || (slide.x === 0 && slide.y === 0)) {
    // Tangent = outward normal rotated +90° (CCW): (-ny, nx). Fixed handedness,
    // so the response stays deterministic — no RNG, no clock (GDD §4.8).
    if (slide) {
      slide.x = -contact.ny;
      slide.y = contact.nx;
    } else {
      slide = { x: -contact.ny, y: contact.nx };
      ship.wedgeSlide = slide;
    }
  }

  // Bring the along-slide component UP TO the slide speed rather than adding to
  // it every tick: self-limiting by construction, so a pin that lasts a second
  // reads as a slide off the rim and never as a launch, whatever the hull's other
  // velocity is doing.
  const along = ship.vel.x * slide.x + ship.vel.y * slide.y;
  if (along < WEDGE_SLIDE_KICK) {
    const add = WEDGE_SLIDE_KICK - along;
    ship.vel.x += slide.x * add;
    ship.vel.y += slide.y * add;
  }
}

// ---------------------------------------------------------------------------
// Firing — one weapon system (ratified amendment v0.3; GDD §2.3, §2.4)
// ---------------------------------------------------------------------------

/**
 * A target auto-aim can acquire across the full 360° (GDD §2.4, the arc the
 * `AUTO_AIM_ARC` knob opens — see `withinAimArc`) — the full
 * target list "asteroid, ship, turret, shield, or core". Shield and core are one
 * `station` hit: the bubble stands in front of the core and `damageStation` decides
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
  | { kind: 'turret'; station: number; index: number }
  | { kind: 'satellite'; station: number; index: number }
  | { kind: 'station'; station: number };

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
 * intercept lead on a moving ship (so a strafing *or orbiting* enemy is actually
 * hit, design amendment v0.2 item 5; field report v0.2.4 "I can never hit an
 * enemy orbiting my station"), or a straight shot at a stationary turret or core.
 *
 * This is the **player's** consumer of the shared intercept solver — the third
 * alongside the turrets (`buildings.ts`) and the bots (`bots/steering.ts`), all
 * three calling the ONE {@link leadAim} in `./projectiles`, never a fork. The
 * player's auto-aim (the stick's Auto-aim fire mode, and the Tap Commander pilot
 * once its scheme rides this same Auto path) leads the ladder's current target
 * with a CLEAN solve and no artificial error — it is an assist mode, so the cost
 * of auto-aim is target *choice* (the ladder picks), not induced misses. Manual
 * aim is untouched: leading a shot by hand stays the skill-ceiling option.
 *
 * The solve is a stationary-muzzle intercept because a ship's shot does NOT
 * inherit the shooter's velocity (`fireShipProjectile` sets `vel = dir·speed`),
 * so there is no own-velocity to compound in — `leadAim(origin, targetPos,
 * targetVel, speed)` is exact for our shot and the shared solver needs no
 * ship-side variation.
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
 * The auto-aim target this tick, by the ratified priority ladder (developer, p8:
 * "if I'm near asteroids it should still target the closest enemy in line of
 * sight"). A hittable enemy ALWAYS outranks a rock:
 *
 *   TIER 1 — the closest **hittable enemy** (ship, turret, or core): an enemy per
 *     the same friend/foe + spawn-protection predicates the shot obeys, with a
 *     clear line of sight (a station body or an asteroid across the path eats the
 *     shot, so it is not hittable — GDD §2.4 "you cannot shoot through things").
 *   TIER 2 — only when no enemy is hittable, the closest **asteroid** (mining).
 *
 * "Near a rock with an enemy on screen" therefore always shoots the enemy; a rock
 * is mined only when the field is otherwise empty of reachable foes.
 */
function acquireAimTarget(world: World, ship: Ship): AimTarget | null {
  const enemy = acquireEnemy(world, ship);
  if (enemy) return enemy;
  // A FULL hold drops asteroids out of tier 2 entirely (developer, p9): the
  // chunks a shot would chip have nowhere to go — the tractor leaves a full
  // hold's chunks where they are for anyone (GDD §2.3, `holdFull`) — so auto-aim
  // (stick mode and the tap pilot alike) never wastes a shot on a rock it cannot
  // profit from. Enemies are unaffected: they are tier 1, resolved above. The
  // tick the hold has room again, rocks re-enter the ladder.
  if (holdFull(ship)) return null;
  return acquireAsteroid(world, ship);
}

/**
 * Whether `ship`'s hold has no room left — the single "full hold" predicate the
 * tractor (a full hold exerts no pull, GDD §2.3) and the p9 auto-aim suppression
 * (a full hold stops targeting rocks) both read, so the two can never disagree
 * about when a rock stops being worth mining.
 */
function holdFull(ship: Ship): boolean {
  // FULL MEANS "NO ROOM FOR A WHOLE ORE" (a0-58). Ore arrives in `CHUNK.ore`
  // units and a hold takes them whole or not at all, so a hold with less than one
  // chunk of room can never accept anything again and is full in every sense the
  // player can act on. On the shipped numbers this is the SAME predicate it has
  // always been — cargo and cap are both whole multiples of `CHUNK.ore`, so
  // `room < CHUNK.ore` is exactly `room === 0` — and it only differs on a hold
  // carrying a sub-chunk sliver (the atmosphere drain can leave one), where the
  // old test said "room!" and the tractor then pulled a chunk it could not take.
  return ship.cargoCap - ship.cargo < CHUNK.ore;
}

/** The ratified arc is the whole circle (GDD §2.4, `AUTO_AIM_ARC` = 2π), and at
 *  that value the gate below is skipped outright rather than computed: a target
 *  dead astern must be acquired *identically* to how it was before the knob was
 *  wired, and `cos(π)` compared against a normalized bearing is one rounding
 *  error away from dropping it. Resolved once at module load — `AUTO_AIM_ARC` is
 *  a constant, not per-world state. */
const AIM_ARC_FULL_CIRCLE = AUTO_AIM_ARC >= 2 * Math.PI;
/** Cosine of the half-arc: the bearing test's threshold when an arc *is* set.
 *  Never read on the shipped path (see above). */
const AIM_ARC_COS_HALF = Math.cos(AUTO_AIM_ARC / 2);

/**
 * Whether a candidate at (`tx`, `ty`) falls inside the auto-aim arc — the front
 * arc `AUTO_AIM_ARC` opens, centred on the ship's facing (GDD §2.4, explicitly
 * `TUNABLE`: *"checked across the full 360° around the ship, no front-arc
 * restriction"*).
 *
 * **The shipped value is 2π and this returns `true` for everything**, which is
 * the ratified behaviour and byte-for-byte what the acquisition did when no arc
 * check existed at all. The knob is wired so that a *different* value is a real
 * balance change instead of a silent no-op — the trap §2.8 retired `Sensor range`
 * to avoid ("a `0` would still read as tunable").
 *
 * It gates each **candidate**, not the winner: with an arc set, auto-aim engages
 * the nearest target *inside* the arc rather than holding fire because the
 * nearest target overall happened to be behind — "the nearest valid target"
 * (§2.4), where the arc is part of what makes one valid.
 *
 * Deterministic by construction: a dot product against the facing versus a
 * `Math.sqrt` (IEEE-754 exact) of the squared distance, no `atan2`, no branch on
 * anything but geometry.
 */
function withinAimArc(ship: Ship, tx: number, ty: number): boolean {
  if (AIM_ARC_FULL_CIRCLE) return true;
  const dx = tx - ship.pos.x;
  const dy = ty - ship.pos.y;
  const d2 = dx * dx + dy * dy;
  // A body the ship is standing on has no bearing to test; it is in every arc.
  if (d2 <= 0) return true;
  const facing = dx * Math.cos(ship.angle) + dy * Math.sin(ship.angle);
  return facing >= AIM_ARC_COS_HALF * Math.sqrt(d2);
}

/**
 * TIER 1 — the closest enemy ship, turret, radar satellite, or core within
 * engagement range whose line of sight is clear, across the arc `AUTO_AIM_ARC`
 * opens — the full 360° with no front arc at the ratified value
 * (GDD §2.4, `withinAimArc`; the satellite is a f1 target). Your
 * own/allied fleet and home are never targets (`areEnemies`); a spawn-protected
 * ship or core is skipped exactly as a shot passes over it (the projectile
 * collision skips both, GDD §2.1) — acquiring one would aim auto-fire at an
 * invulnerable hull with no tell (field report "some ships would not take damage
 * from me") and lock off a live enemy beside it. An occluded enemy is skipped for
 * the same reason: the shot would die on the rock or station in the way, so the
 * closest *unblocked* enemy is the one the ladder engages.
 *
 * Hittability is not a second rule set: it reuses the collision/protection
 * predicates (`areEnemies`, spawn protection, `stationTargetRadius`) so the aimer
 * and the shot can never disagree about what can be struck.
 */
function acquireEnemy(world: World, ship: Ship): AimTarget | null {
  let best: AimTarget | null = null;
  let bestD2 = WEAPON_RANGE * WEAPON_RANGE;

  for (let i = 0; i < world.ships.length; i++) {
    const t = world.ships[i]!;
    if (!areEnemies(world, ship.id, t.id) || !t.alive || t.spawnProtect > 0) continue;
    const d2 = dist2(ship.pos, t.pos);
    if (d2 >= bestD2) continue;
    if (!withinAimArc(ship, t.pos.x, t.pos.y)) continue;
    if (losBlocked(world, ship.pos, t.pos)) continue;
    bestD2 = d2;
    best = { kind: 'ship', index: i };
  }

  for (let p = 0; p < world.stations.length; p++) {
    const station = world.stations[p]!;
    if (!areEnemies(world, ship.id, station.owner)) continue;
    for (let i = 0; i < station.turrets.length; i++) {
      const turret = station.turrets[i]!;
      if (turret.hp <= 0) continue;
      const d2 = dist2(ship.pos, turret.pos);
      if (d2 >= bestD2) continue;
      if (!withinAimArc(ship, turret.pos.x, turret.pos.y)) continue;
      if (losBlocked(world, ship.pos, turret.pos)) continue;
      bestD2 = d2;
      best = { kind: 'turret', station: p, index: i };
    }
    // Radar satellites are legitimate high-value targets (feature f1, item 2): a
    // besieger can pick off an enemy's sensor the same way it picks off a turret.
    // A structure, so it ranks in tier 1 alongside turrets/core by proximity.
    if (station.satellites) {
      for (let i = 0; i < station.satellites.length; i++) {
        const sat = station.satellites[i]!;
        if (sat.hp <= 0) continue;
        const d2 = dist2(ship.pos, sat.pos);
        if (d2 >= bestD2) continue;
        if (!withinAimArc(ship, sat.pos.x, sat.pos.y)) continue;
        if (losBlocked(world, ship.pos, sat.pos)) continue;
        bestD2 = d2;
        best = { kind: 'satellite', station: p, index: i };
      }
    }
    if (!station.alive || station.spawnProtect > 0) continue;
    const d2 = dist2(ship.pos, station.pos);
    if (d2 >= bestD2) continue;
    if (!withinAimArc(ship, station.pos.x, station.pos.y)) continue;
    if (losBlocked(world, ship.pos, station.pos)) continue;
    bestD2 = d2;
    best = { kind: 'station', station: p };
  }
  return best;
}

/**
 * TIER 2 — the closest asteroid whose center is within engagement range (mining),
 * taken only when no enemy is hittable. No line-of-sight test: the auto-aim shot
 * aims at the nearest rock, and whatever rock the shot reaches first is the one it
 * mines, so "closest" is always a rock worth firing at.
 */
function acquireAsteroid(world: World, ship: Ship): AimTarget | null {
  let best: AimTarget | null = null;
  let bestD2 = WEAPON_RANGE * WEAPON_RANGE;
  for (let i = 0; i < world.asteroids.length; i++) {
    const rock = world.asteroids[i]!;
    const d2 = dist2(ship.pos, rock.pos);
    if (d2 < bestD2 && withinAimArc(ship, rock.pos.x, rock.pos.y)) {
      bestD2 = d2;
      best = { kind: 'asteroid', index: i };
    }
  }
  return best;
}

/**
 * Whether a straight shot from `from` to `to` is eaten before it arrives — "you
 * cannot shoot through things" (GDD §2.4, amendment v0.3) applied to acquisition,
 * so auto-aim never locks an enemy a shot could not actually reach. A blocker is
 * an **asteroid** or a **station body** (its shield/core surface — the same
 * `stationTargetRadius` the projectile collides against) whose center's closest
 * approach falls strictly *between* the endpoints and within its radius.
 *
 * Enemy ships are never blockers: the ladder already picks the closest enemy, so a
 * nearer enemy never has to hide a farther one. A station the segment ends *on* (an
 * enemy core, whose aim point is the station center) is not self-occluding — its
 * closest approach is the endpoint (t == 1), outside the open interval — so a core
 * stays hittable while a body squarely across the path does not.
 */
function losBlocked(world: World, from: Vec2, to: Vec2): boolean {
  for (const a of world.asteroids) {
    if (segmentCrossesCircle(from, to, a.pos, a.radius)) return true;
  }
  for (const station of world.stations) {
    if (segmentCrossesCircle(from, to, station.pos, stationTargetRadius(station))) return true;
  }
  return false;
}

/**
 * True when circle (`c`, `r`) crosses the open interior of segment `from`→`to` —
 * the analytic form of "a shot fired down this segment strikes the circle before
 * the far endpoint". The closest approach is at parameter `t` along the segment;
 * only a strictly-interior approach (0 < t < 1) within `r` counts, so a body at or
 * beyond either endpoint is not a blocker. Squared throughout, one guarded
 * division (a zero-length segment never blocks) — deterministic, no sqrt.
 */
function segmentCrossesCircle(from: Vec2, to: Vec2, c: Vec2, r: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const seg2 = dx * dx + dy * dy;
  if (seg2 < 1e-9) return false;
  const t = ((c.x - from.x) * dx + (c.y - from.y) * dy) / seg2;
  if (t <= 0 || t >= 1) return false;
  const px = from.x + t * dx - c.x;
  const py = from.y + t * dy - c.y;
  return px * px + py * py <= r * r;
}

/** Center of whatever a shot's target resolved to. */
function targetPos(world: World, hit: AimTarget): Vec2 {
  switch (hit.kind) {
    case 'asteroid':
      return world.asteroids[hit.index]!.pos;
    case 'ship':
      return world.ships[hit.index]!.pos;
    case 'turret':
      return world.stations[hit.station]!.turrets[hit.index]!.pos;
    case 'satellite':
      return world.stations[hit.station]!.satellites![hit.index]!.pos;
    case 'station':
      return world.stations[hit.station]!.pos;
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
  // The loot tells (a0-08) are decided fresh here every tick and nowhere else —
  // this is the only chunk → cargo path in the sim — so they are cleared for
  // EVERY ship first, dead ones included, and a tell can never outlive the tick
  // that earned it. Write-only signalling: nothing below reads them back.
  for (const ship of world.ships) {
    ship.lootTake = 0;
    ship.lootOffered = 0;
    ship.lootBlocked = false;
  }
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
    // mid-pull loses its target here and coasts to a stop under drag — falling
    // back to free-floating, collectable by any ship that still has space.
    let target: Ship | null = null;
    let bestD2 = range2;
    for (const ship of world.ships) {
      if (!ship.alive) continue;
      const d2 = dist2(chunk.pos, ship.pos);
      if (holdFull(ship)) {
        // The FULL-HOLD TELL (a0-08). A full hold drops out of the tractor here,
        // and until now that was the whole of it: the chunk was never pulled, the
        // contact branch below was never reached, and the player floating over a
        // wreck saw nothing happen and nothing said. Record that this ship is
        // sitting in range of ore it cannot take — same distance test, same loop,
        // no extra work — and the hold pips can say so.
        if (d2 < range2) ship.lootBlocked = true;
        continue;
      }
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
        // Room measured in WHOLE ore (a0-58): a hold accepts `CHUNK.ore` units and
        // never a slice of one, so a hold with 0.4 of a slot free takes nothing
        // and leaves the chunk whole for anyone. Ore is a countable thing on both
        // sides of this line — every mint emits whole chunks (`damage.ts`,
        // `match.ts`, `projectiles.ts`), and this is the only place ore enters a
        // hold, so `cargo` can hold no fraction that a pip cannot show. No epsilon
        // is needed or wanted: cap and cargo are small whole multiples of
        // `CHUNK.ore`, and that subtraction is exact in binary.
        const room = Math.floor((target.cargoCap - target.cargo) / CHUNK.ore) * CHUNK.ore;
        if (room > 0) {
          // What the chunk PUT ON OFFER, read before the take spends it — the
          // number a0-54 found missing. `take` is capped by `room`, so the two
          // differ exactly when the hold could not accept the whole chunk.
          const offered = chunk.amount;
          const take = Math.min(offered, room);
          target.cargo += take;
          chunk.amount -= take;
          // Chunk → hold: the LOOT step. Mined ore, a death drop, wreck debris —
          // all arrive here, so this one counter is every unit a ship ever picks
          // up (`./ore-ledger`), the flow three regressions have lost.
          ledgerAdd(world, 'looted', take);
          // …and one journal line per arrival (a0-52), so a log can answer "where
          // did that ore come from" as well as "where did it go". Chunk-keyed, not
          // tick-keyed: a pickup is an event, not a rate, so this is a handful of
          // lines a minute rather than 60 a second (`./ore-journal`).
          journalOre(world, {
            tick: world.tick,
            player: target.id,
            flow: 'mined',
            item: 'chunk',
            amount: take,
            hold: target.cargo - take,
            bank: target.banked,
            holdAfter: target.cargo,
            bankAfter: target.banked,
          });
          // …and the same `take`, per ship, as the tick's render tell (a0-08): the
          // ore that arrived, not the chunk that was offered, so a PARTIAL take
          // (`room` 1 against a 3-ore chunk) shows as the 1 it was. Accumulated,
          // because two chunks can land in one hold on one tick.
          target.lootTake = (target.lootTake ?? 0) + take;
          // …and, beside it, what was OFFERED (a0-54). The take alone cannot be
          // read: `+1` over a 2-ore chunk and `+1` over a 1-ore chunk are the same
          // tell, and the developer read the first as a miscount. Accumulated on
          // the same terms, so a tick that lands two chunks compares two sums —
          // `lootOffered > lootTake` is the whole partial-take test, and the HUD
          // says so at the ship (`src/ui/loot-tell.ts`).
          target.lootOffered = (target.lootOffered ?? 0) + offered;
        }
      }
    }
  }

  // Drop emptied chunks (collected mines and arrived deposit couriers alike).
  world.chunks = world.chunks.filter((c) => c.amount > 1e-9);
}

// ---------------------------------------------------------------------------
// Auto-deposit inside your own station's atmosphere
// (field report v0.1.2; GDD §2.3, §2.5; ratified p4)
// ---------------------------------------------------------------------------

/**
 * While a ship is inside its own living station's atmosphere (`DEPOSIT_RANGE`),
 * drain its hold into the safe banked total at `DEPOSIT.drainRate` and, for each
 * WHOLE unit of ore that leaves the hold, spin off exactly one courier chunk that
 * flies ship→station to show it. Leave the atmosphere (or empty the hold, or lose
 * the station) and the drain simply stops the next tick — the transfer is readable
 * and interruptible, exactly as the field report asks. There is no dock or park
 * gate any more (ratified p4: "just be in that atmosphere").
 *
 * The transfer is authoritative here (hold and bank are the truth the HUD ticks
 * off) and the couriers CONSERVE it: one flight sprite per unit banked, so the
 * chunks flying home always total the ore that actually moved — never more (field
 * report p8: the atmosphere drain used to spawn couriers on a free-running time
 * cadence, ~3 per ore at `drainRate`, so the developer saw "more ore flying than
 * you hold"). Deterministic: the spawn count is a pure function of the hold's
 * integer boundary crossings, the courier's heading is pure geometry, and no RNG
 * is drawn.
 */
function updateDeposits(world: World, dt: number): void {
  for (const ship of world.ships) {
    if (!ship.alive || ship.cargo <= 1e-9) continue;
    // Ratified p4: just be in the atmosphere. No dock and no park gate — the
    // drain runs the tick a ship crosses into `DEPOSIT_RANGE` at its own living
    // station and stops the tick it crosses back out (interruptible as before).
    const station = stationOf(world, ship.id);
    if (!station || !station.alive || !inAtmosphere(ship, station)) continue;

    // Authoritative transfer hold → bank (GDD §2.3: banked ore is safe), paid out
    // in WHOLE `CHUNK.ore` (a0-58). The rate is untouched — `DEPOSIT.drainRate`
    // still buys `drainRate` ore every second, accrued in `depositProgress` — but
    // the hold hands over countable ore, never 1/30th of a unit per tick.
    //
    // Why the granularity had to move: a pilot who clips their own atmosphere for
    // a third of a second used to come out holding 1.6 of a 2 slot. That hold shows
    // ONE pip, cannot accept another chunk (there is no whole slot free), and is
    // carrying 0.6 of an ore that no pip, no cost and no wheel numeral in the game
    // can render — the same invisible remainder the death drop used to mint, made
    // by the one path that touches a hold every match. The couriers below were
    // already keyed to whole units, so nothing the player watches changed cadence;
    // what changed is that the hold and the bank now step together.
    //
    // `Math.min(cargo, …)` is what scrubs a legacy sliver out: a hold on 0.6 with a
    // whole unit due banks the 0.6 and lands on exactly 0.
    //
    // The epsilon is not decoration: `drainRate * dt` is 1/30th of an ore and thirty
    // of those sum to 0.9999999999999999, so a bare floor would hold the unit back
    // a whole tick every time and quietly run the ratified rate ~3% slow. It cannot
    // mint — `moved` is capped by the hold, and progress is not ore.
    const cargoBefore = ship.cargo;
    const progress = (ship.depositProgress ?? 0) + DEPOSIT.drainRate * dt;
    const due = Math.floor(progress / CHUNK.ore + 1e-9) * CHUNK.ore;
    const moved = Math.min(ship.cargo, due);
    ship.depositProgress = Math.max(0, progress - moved);
    ship.cargo -= moved;
    ship.banked += moved;
    if (ship.cargo < 1e-9) ship.cargo = 0;
    if (moved <= 0) continue; // nothing whole earned yet: no transfer, no courier, no line.
    // Hold → bank: a transfer within the live economy (conserved), recorded so the
    // ledger can attribute where banked ore came from (`./ore-ledger`).
    ledgerAdd(world, 'deposited', moved);

    // The telegraph, CONSERVED: exactly one courier per whole unit that left the
    // hold this tick. Summed across a drain this equals the whole ore banked — the
    // single unit-keyed spawner that replaces the old rate-based emitter (field
    // report p8). Keyed to the HOLD's integer boundaries (which the terminal
    // `= 0` snaps cleanly) rather than the bank's running total, so float drift in
    // `banked` can never invent or drop a courier at the exact end of a drain.
    const couriers = Math.floor(moved / CHUNK.ore);
    for (let i = 0; i < couriers; i++) spawnDepositFlight(world, ship, station);

    // The journal takes the SAME whole-ore boundary the couriers do (a0-52). The
    // drain moves a sliver every tick and journalling each one would spend the
    // ring in four seconds and tell a reader nothing; one line per whole ore
    // banked is the same rate the player watches fly home, and it keeps the log's
    // banked total exactly the ore that arrived (`./ore-journal`).
    //
    // So `amount` is the whole ore that crossed, while the four balances are this
    // tick's exact live readings — the one place the two are not the same
    // subtraction, called out on `OreEvent.amount`.
    if (couriers > 0) {
      journalOre(world, {
        tick: world.tick,
        player: ship.id,
        flow: 'banked',
        item: 'drain',
        amount: couriers,
        hold: cargoBefore,
        bank: ship.banked - moved,
        holdAfter: ship.cargo,
        bankAfter: ship.banked,
      });
    }
  }
}

/** Spin off one ore-flight courier from `ship` toward `station`. Pooled through
 *  the same chunk array (and the same renderer) as mined ore; flagged `deposit`
 *  so it is homed and absorbed rather than tractored (see {@link updateChunks}). */
function spawnDepositFlight(world: World, ship: Ship, station: MiningStation): void {
  const dir = normalize({ x: station.pos.x - ship.pos.x, y: station.pos.y - ship.pos.y });
  world.chunks.push({
    id: world.nextEntityId++,
    pos: { x: ship.pos.x, y: ship.pos.y },
    vel: { x: dir.x * DEPOSIT.flightSpeed, y: dir.y * DEPOSIT.flightSpeed },
    // Cosmetic: one chunk's worth of sprite, not one chunk's worth of ore — the
    // ore already moved in `updateDeposits`. Zeroed on arrival to be swept.
    amount: CHUNK.ore,
    radius: CHUNK.radius,
    deposit: true,
    homeTo: { x: station.pos.x, y: station.pos.y },
  });
}

/** Fly a deposit courier straight at its station and mark it spent on arrival.
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
  // Reached the station surface: the bank already holds this ore, so the courier
  // is absorbed — zero its amount for the end-of-tick sweep in `updateChunks`.
  if (d2 <= STATION.radius * STATION.radius) {
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
 * Come back at your home station, five seconds later, with **everything you
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
  ship.thrust = 0; // a fresh hull is not under power until its pilot says so.
  ship.cargo = 0;
  ship.respawnTimer = 0;
  ship.spawnProtect = SPAWN_PROTECTION_S;
  ship.weaponCooldown = 0;
  ship.wedgeContactS = 0; // a fresh hull at home is not mid-grind (p14).
  ship.wedgeAnchor = { x: ship.pos.x, y: ship.pos.y };
  clearSlide(ship);
}
