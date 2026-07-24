/**
 * src/sim/buildings.ts — the planet economy. OWNER: Gameplay Engineer.
 *
 * Everything the Build & Upgrade wheel spends on and everything a planet does
 * with it (GDD §2.5, §2.6):
 *
 *  - **Orders** — TURRET (3), SHIELD (5), REPAIR CORE, BANK. Validated by the
 *    sim, never trusted from the sender: own planet, docked, alive, affordable,
 *    under cap. Ore is spent the moment the order lands; construction is time.
 *  - **Construction timers** — a turret assembles over 10 s, a shield over 15,
 *    so defenses are bought *before* the attack, not during it (GDD §2.5).
 *  - **Shields** — a 40 HP bubble that stacks to two, regenerating 2 HP/s only
 *    after 8 undamaged seconds.
 *  - **The repair channel** — planet core only, 2 HP/s, 1 ore per 5 HP, held by
 *    a docked ship and interrupted by *any* core or shield damage.
 *  - **Turrets** — auto-fire at enemy ships in range with pooled projectiles at
 *    a design DPS of 4.
 *  - **UPGRADE SHIP** — the fifth segment, and the only one that spends on the
 *    *ship* instead of the planet (GDD §2.5). It lands here because the wheel and
 *    the panel behind its arrow are one purchase point at your own planet, so a
 *    row press gets the same validation a wheel order does; the tier ladder and
 *    every stat it derives live in `./upgrades`.
 *
 * The two halves of GDD §2.6's "pressure beats regeneration" are one field:
 * `planet.sinceDamage`. A hit zeroes it, which both closes the shield-regen
 * window and drops the repair channel — so a defender cannot out-heal an
 * attacker who keeps shooting, they have to drive them off first.
 *
 * Determinism (GDD §4.8): fixed iteration order (planets, then their turrets,
 * then the projectile pool), no RNG, every rate `* dt`.
 */

import type { PlayerId, BuildItem, UpgradeTrack } from '@shared/types';
import {
  PLANET,
  PROJECTILE,
  REPAIR,
  SHIELD,
  TURRET,
} from './constants';
import { damageShip } from './damage';
import { destroyCore, isCollapsed } from './match';
import type { Planet, Projectile, Ship, Shield, Turret, World } from './state';
import { applyPurchasedStats, nextUpgradeCost } from './upgrades';
import { dist2, turnToward } from './vec';

// ---------------------------------------------------------------------------
// Lookups and the ore wallet
// ---------------------------------------------------------------------------

/** A player's home planet, or null if they have none (eliminated / no slot). */
export function planetOf(world: World, owner: PlayerId): Planet | null {
  for (const p of world.planets) {
    if (p.owner === owner) return p;
  }
  return null;
}

/** A player's ship, or null. */
export function shipOf(world: World, owner: PlayerId): Ship | null {
  for (const s of world.ships) {
    if (s.id === owner) return s;
  }
  return null;
}

/** True while a ship is close enough to its planet to use the wheel
 *  (GDD §2.5: "opened at your own planet"). Centre-to-centre. */
export function isDocked(ship: Ship, planet: Planet): boolean {
  return ship.alive && dist2(ship.pos, planet.pos) <= PLANET.dockRange * PLANET.dockRange;
}

/** Ore a player can actually spend: what's in the hold plus what's banked. */
export function spendableOre(ship: Ship): number {
  return ship.cargo + ship.banked;
}

/**
 * Pay `cost` ore, **hold first, then the bank**. Held ore is the ore with five
 * competing uses (GDD §2.5), so spending burns it before touching the safe
 * total — banking then remains a real decision rather than a free upgrade.
 * Returns false and charges nothing if the player cannot afford it.
 */
export function spendOre(ship: Ship, cost: number): boolean {
  if (cost <= 0) return true;
  if (spendableOre(ship) + 1e-9 < cost) return false;
  const fromHold = Math.min(ship.cargo, cost);
  ship.cargo -= fromHold;
  ship.banked -= cost - fromHold;
  if (ship.cargo < 1e-9) ship.cargo = 0;
  if (ship.banked < 1e-9) ship.banked = 0;
  return true;
}

// ---------------------------------------------------------------------------
// Per-planet caps (GDD §2.5 — "design rules, not renderer limits")
// ---------------------------------------------------------------------------

/** Turrets that exist or are being built — queued jobs count against the cap,
 *  so a player cannot buy their way past 4 by ordering them all at once. */
export function turretCount(planet: Planet): number {
  let n = planet.turrets.length;
  for (const b of planet.builds) if (b.kind === 'turret') n++;
  return n;
}

/** Shields that exist or are being built (same rule as {@link turretCount}). */
export function shieldCount(planet: Planet): number {
  let n = planet.shields.length;
  for (const b of planet.builds) if (b.kind === 'shield') n++;
  return n;
}

/** The lowest turret mount slot not held by a live turret or a queued job, or
 *  -1 when the ring is full. Slots are re-used, so a rebuilt turret fills the
 *  hole a dead one left instead of stacking on a survivor. */
function freeTurretSlot(planet: Planet): number {
  for (let slot = 0; slot < TURRET.capPerPlanet; slot++) {
    let taken = false;
    for (const t of planet.turrets) if (t.slot === slot) taken = true;
    for (const b of planet.builds) if (b.kind === 'turret' && b.slot === slot) taken = true;
    if (!taken) return slot;
  }
  return -1;
}

/** Where a turret in `slot` sits: on the planet's surface ring, starting from
 *  the planet's outward angle so slot 0 always faces away from the field. */
export function turretMountPos(planet: Planet, slot: number): { x: number; y: number } {
  const theta = planet.angle + (2 * Math.PI * slot) / TURRET.capPerPlanet;
  const r = planet.radius + TURRET.mountOffset + TURRET.radius;
  return { x: planet.pos.x + Math.cos(theta) * r, y: planet.pos.y + Math.sin(theta) * r };
}

// ---------------------------------------------------------------------------
// Orders (one wheel press = one order; never held, never latched)
// ---------------------------------------------------------------------------

/**
 * Why an order was refused — the sim's answer to a wheel press. `ok` is the
 * only success. Returned rather than thrown so the UI can say *why* nothing
 * happened, and so tests can assert refusal instead of inferring it.
 */
export type OrderResult =
  | 'ok'
  | 'no-planet'
  | 'planet-dead'
  | 'not-docked'
  | 'cap-reached'
  | 'cannot-afford'
  | 'core-full'
  | 'nothing-to-bank'
  /** Repair only: the collapse phase has shut it off for good (GDD §2.3). */
  | 'collapsed';

/** Ore cost of a wheel segment. Repair and bank are not flat purchases. */
export function orderCost(item: BuildItem): number {
  switch (item) {
    case 'turret':
      return TURRET.cost;
    case 'shield':
      return SHIELD.cost;
    case 'repair':
    case 'bank':
      return 0;
  }
}

/**
 * Act on one wheel press for `ship`. Validates ownership, docking, caps and
 * cost, then spends immediately (GDD §2.5: "four segments spend immediately").
 * Pure state mutation — no allocation beyond the job/entity it creates.
 */
export function placeOrder(world: World, ship: Ship, item: BuildItem): OrderResult {
  const planet = planetOf(world, ship.id);
  if (!planet) return 'no-planet';
  if (!planet.alive) return 'planet-dead';
  if (!isDocked(ship, planet)) return 'not-docked';

  switch (item) {
    case 'bank': {
      if (ship.cargo <= 1e-9) return 'nothing-to-bank';
      ship.banked += ship.cargo;
      ship.cargo = 0;
      return 'ok';
    }
    case 'repair': {
      // Collapse shuts repair off entirely (GDD §2.3): from here on, damage to a
      // core is permanent and the only defence left is the ship in front of it.
      if (isCollapsed(world)) return 'collapsed';
      if (planet.coreHp >= planet.maxCoreHp - 1e-9) return 'core-full';
      if (spendableOre(ship) <= 1e-9) return 'cannot-afford';
      // The channel opens now and runs until the core is full, the ore runs
      // out, the ship leaves — or anything at all hits the planet (GDD §2.5).
      planet.repairing = true;
      return 'ok';
    }
    case 'turret': {
      if (turretCount(planet) >= TURRET.capPerPlanet) return 'cap-reached';
      const slot = freeTurretSlot(planet);
      if (slot < 0) return 'cap-reached';
      if (!spendOre(ship, TURRET.cost)) return 'cannot-afford';
      planet.builds.push({
        id: world.nextEntityId++,
        kind: 'turret',
        slot,
        remaining: TURRET.buildTime,
        total: TURRET.buildTime,
      });
      return 'ok';
    }
    case 'shield': {
      if (shieldCount(planet) >= SHIELD.capPerPlanet) return 'cap-reached';
      if (!spendOre(ship, SHIELD.cost)) return 'cannot-afford';
      planet.builds.push({
        id: world.nextEntityId++,
        kind: 'shield',
        slot: 0,
        remaining: SHIELD.buildTime,
        total: SHIELD.buildTime,
      });
      return 'ok';
    }
  }
}

// ---------------------------------------------------------------------------
// The fifth segment: UPGRADE SHIP (GDD §2.5)
// ---------------------------------------------------------------------------

/**
 * Why an upgrade purchase was refused. Deliberately the same vocabulary as
 * {@link OrderResult} for the four reasons they share, so the UI can say why a
 * press did nothing without caring which screen it came from.
 */
export type UpgradeResult =
  | 'ok'
  | 'no-planet'
  | 'planet-dead'
  | 'not-docked'
  | 'cannot-afford'
  /** The ladder on that track is finished — there is no next tier to sell. */
  | 'maxed';

/**
 * Buy one tier on one track (GDD §2.5) — the press on a row of the upgrade
 * panel. Validated exactly like a wheel order and for the same reason: the wheel
 * and the panel are one purchase point, "opened at your own planet", and the sim
 * never trusts the sender (GDD §2.5, §2.9).
 *
 * Deliberately **not** blocked by the collapse phase. Collapse is spelled out as
 * exactly three rules — no shield regeneration, no repair, no new ore (GDD §2.3)
 * — so ore already in hand still buys what it always bought. What ends is the
 * supply, which is the whole point: the stockpile a turtle spent on standing
 * still is gone, and the ship that banked instead can still tool up for the last
 * fight (GDD §2.6, "the economy is the siege engine of last resort").
 *
 * Cost is drawn hold-first then bank, like every other purchase ({@link spendOre}),
 * and the derived stats are written back through `./upgrades` so `maxHull` and
 * `cargoCap` can never disagree with the tiers that produced them.
 */
export function buyUpgrade(world: World, ship: Ship, track: UpgradeTrack): UpgradeResult {
  const planet = planetOf(world, ship.id);
  if (!planet) return 'no-planet';
  if (!planet.alive) return 'planet-dead';
  if (!isDocked(ship, planet)) return 'not-docked';

  const cost = nextUpgradeCost(ship, track);
  if (cost === null) return 'maxed';
  if (!spendOre(ship, cost)) return 'cannot-afford';

  ship.tiers[track] += 1;
  applyPurchasedStats(ship);
  return 'ok';
}

// ---------------------------------------------------------------------------
// Per-tick: construction, shields, the repair channel
// ---------------------------------------------------------------------------

/**
 * Advance every planet one tick: spawn protection, the undamaged clock,
 * construction timers, shield regeneration, and the repair channel — in that
 * order, which is part of the determinism contract.
 *
 * Runs *before* this tick's beams and projectiles, so damage dealt now takes
 * effect on the next tick's regen/repair decision, never retroactively.
 *
 * Under collapse, two of those five stop happening for the rest of the match
 * (GDD §2.3) — the phase is read once per tick, not per planet, because it is a
 * property of the match rather than of anyone's home.
 */
export function updatePlanets(world: World, dt: number): void {
  const collapsed = isCollapsed(world);
  for (const planet of world.planets) {
    if (!planet.alive) continue;
    if (planet.spawnProtect > 0) planet.spawnProtect = Math.max(0, planet.spawnProtect - dt);
    planet.sinceDamage += dt;

    advanceConstruction(world, planet, dt);
    // Collapse: shields stop regenerating and repair shuts off (GDD §2.3).
    // Construction still finishes — the ore was already spent, and a turret
    // half-built when the field ran dry is the player's money, not entropy's.
    if (!collapsed) {
      regenShields(planet, dt);
      runRepairChannel(world, planet, dt);
    } else {
      planet.repairing = false;
    }
  }
}

/** Tick construction timers; a job that reaches zero becomes the real thing
 *  (GDD §2.5 — the ore was already spent when the order was placed). */
function advanceConstruction(world: World, planet: Planet, dt: number): void {
  let completed = false;
  for (const job of planet.builds) {
    job.remaining -= dt;
    if (job.remaining <= 0) {
      job.remaining = 0;
      completed = true;
      if (job.kind === 'turret') planet.turrets.push(makeTurret(world, planet, job.slot));
      else planet.shields.push(makeShield(world));
    }
  }
  if (completed) planet.builds = planet.builds.filter((j) => j.remaining > 0);
}

function makeTurret(world: World, planet: Planet, slot: number): Turret {
  const pos = turretMountPos(planet, slot);
  return {
    id: world.nextEntityId++,
    owner: planet.owner,
    slot,
    pos: { x: pos.x, y: pos.y },
    radius: TURRET.radius,
    hp: TURRET.hp,
    maxHp: TURRET.hp,
    // Barrel starts pointing outward, away from the planet it defends.
    angle: planet.angle + (2 * Math.PI * slot) / TURRET.capPerPlanet,
    cooldown: 0,
    targetId: null,
  };
}

function makeShield(world: World): Shield {
  return { id: world.nextEntityId++, hp: SHIELD.hp, maxHp: SHIELD.hp, radius: SHIELD.radius };
}

/** Shields recover only past `SHIELD.regenDelay` undamaged seconds — the
 *  regeneration half of GDD §2.6. Each generator regenerates its own pool. */
function regenShields(planet: Planet, dt: number): void {
  if (planet.sinceDamage < SHIELD.regenDelay) return;
  for (const shield of planet.shields) {
    if (shield.hp >= shield.maxHp) continue;
    shield.hp = Math.min(shield.maxHp, shield.hp + SHIELD.regenPerSecond * dt);
  }
}

/**
 * Hold the repair channel open for one tick (GDD §2.5): the owner's ship must
 * be alive and docked, the core must be damaged, and ore must be available —
 * 2 HP/s at 1 ore per 5 HP, drawn hold-first. The channel closes the moment any
 * of that stops being true; damage closes it elsewhere, in {@link damagePlanet},
 * which is what makes repair interruptible.
 */
function runRepairChannel(world: World, planet: Planet, dt: number): void {
  if (!planet.repairing) return;

  const ship = shipOf(world, planet.owner);
  if (!ship || !ship.alive || !isDocked(ship, planet)) {
    planet.repairing = false;
    return;
  }

  const missing = planet.maxCoreHp - planet.coreHp;
  if (missing <= 1e-9) {
    planet.repairing = false;
    return;
  }

  const available = spendableOre(ship);
  if (available <= 1e-9) {
    planet.repairing = false;
    return;
  }

  // Heal what the tick, the missing HP, and the ore on hand all allow.
  let hp = Math.min(REPAIR.hpPerSecond * dt, missing, available / REPAIR.orePerHp);
  const cost = hp * REPAIR.orePerHp;
  if (!spendOre(ship, cost)) {
    planet.repairing = false;
    return;
  }
  planet.coreHp = Math.min(planet.maxCoreHp, planet.coreHp + hp);
  if (planet.coreHp >= planet.maxCoreHp - 1e-9 || spendableOre(ship) <= 1e-9) planet.repairing = false;
}

// ---------------------------------------------------------------------------
// Damage routing — shields stand in front of the core
// ---------------------------------------------------------------------------

/** The radius an attacker's beam or shot actually strikes: the shield bubble
 *  while any shield is up, the planet body once they are all down. */
export function planetTargetRadius(planet: Planet): number {
  for (const s of planet.shields) {
    if (s.hp > 1e-9) return s.radius;
  }
  return planet.radius;
}

/** Total shield HP standing over the core right now. */
export function shieldPool(planet: Planet): number {
  let hp = 0;
  for (const s of planet.shields) hp += s.hp;
  return hp;
}

/**
 * Apply `amount` damage to a planet: shields first (in build order, one bubble
 * at a time), then the core. Spawn protection blocks it entirely (GDD §2.1).
 *
 * Any damage that lands zeroes `sinceDamage` and drops the repair channel —
 * the single line of code behind "pressure beats regeneration" (GDD §2.6).
 * Returns true if the hit landed.
 */
export function damagePlanet(world: World, planet: Planet, amount: number): boolean {
  if (!planet.alive || planet.spawnProtect > 0 || amount <= 0) return false;

  let left = amount;
  for (const shield of planet.shields) {
    if (left <= 0) break;
    if (shield.hp <= 0) continue;
    const absorbed = Math.min(shield.hp, left);
    shield.hp -= absorbed;
    left -= absorbed;
  }
  if (left > 0) planet.coreHp -= left;

  planet.sinceDamage = 0;
  planet.repairing = false;

  if (planet.coreHp <= 0) destroyCore(world, planet);
  return true;
}

/**
 * Apply `amount` damage to a turret. A turret at zero HP is *dead but still in
 * the array* until {@link sweepDeadTurrets} runs at the end of the tick: two
 * ships can be beaming the same planet in one tick, and removing an entry
 * mid-tick would shift the indices the other ship's beam already resolved.
 * Same discipline as asteroids, which are also filtered only at end of step.
 */
export function damageTurret(turret: Turret, amount: number): boolean {
  if (amount <= 0 || turret.hp <= 0) return false;
  turret.hp -= amount;
  if (turret.hp < 0) turret.hp = 0;
  return true;
}

/** End-of-tick cleanup: drop turrets killed this tick, freeing their mount
 *  slots for a rebuild. Allocates only on the ticks a turret actually died. */
export function sweepDeadTurrets(world: World): void {
  for (const planet of world.planets) {
    let dead = false;
    for (const t of planet.turrets) if (t.hp <= 0) dead = true;
    if (dead) planet.turrets = planet.turrets.filter((t) => t.hp > 0);
  }
}

// ---------------------------------------------------------------------------
// Turret fire and the projectile pool (GDD §2.6, §4.1, §4.3)
// ---------------------------------------------------------------------------

/**
 * Acquire, track, and shoot. Every turret picks the nearest enemy ship inside
 * `TURRET.range` (spawn-protected ships are not valid targets), turns its
 * barrel toward it at `TURRET.turnRate`, and fires every `TURRET.fireInterval`
 * seconds. Alignment deliberately does not gate the shot: `dps` is the design
 * number and a turn-rate-gated turret would quietly under-deliver it.
 */
export function updateTurrets(world: World, dt: number): void {
  for (const planet of world.planets) {
    if (!planet.alive) continue;
    for (const turret of planet.turrets) {
      if (turret.hp <= 0) continue; // killed this tick, swept at end of step
      const target = acquireTarget(world, turret);
      turret.targetId = target ? target.id : null;

      if (turret.cooldown > 0) turret.cooldown = Math.max(0, turret.cooldown - dt);
      if (!target) continue;

      const dx = target.pos.x - turret.pos.x;
      const dy = target.pos.y - turret.pos.y;
      const aim = Math.atan2(dy, dx);
      turret.angle = turnToward(turret.angle, aim, TURRET.turnRate * dt);

      if (turret.cooldown <= 0) {
        fireProjectile(world, turret, aim);
        turret.cooldown = TURRET.fireInterval;
      }
    }
  }
}

/** Nearest enemy ship within turret range: alive, not the owner's, and not
 *  spawn-protected (a turret never wastes its cooldown on an invulnerable
 *  target, and never opens fire on a player who just respawned). */
function acquireTarget(world: World, turret: Turret): Ship | null {
  let best: Ship | null = null;
  let bestD2 = TURRET.range * TURRET.range;
  for (const ship of world.ships) {
    if (!ship.alive || ship.id === turret.owner || ship.spawnProtect > 0) continue;
    const d2 = dist2(turret.pos, ship.pos);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = ship;
    }
  }
  return best;
}

/** Take a slot from the pool, or grow it once. Growth is the only allocation
 *  the projectile system ever does, and it stops as soon as the pool reaches
 *  the match's peak concurrent shots (GDD §4.3: no per-frame allocation). */
function fireProjectile(world: World, turret: Turret, aim: number): void {
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  const slot = takeProjectile(world);
  // A recycled slot gets a *fresh* id: a renderer or snapshot encoder keying on
  // id must never mistake this shot for the one that used the slot before it.
  slot.id = world.nextEntityId++;
  slot.owner = turret.owner;
  slot.pos.x = turret.pos.x + dx * turret.radius;
  slot.pos.y = turret.pos.y + dy * turret.radius;
  slot.vel.x = dx * TURRET.projectileSpeed;
  slot.vel.y = dy * TURRET.projectileSpeed;
  slot.damage = PROJECTILE.damage;
  slot.radius = PROJECTILE.radius;
  slot.life = PROJECTILE.life;
  slot.active = true;
}

function takeProjectile(world: World): Projectile {
  for (const p of world.projectiles) {
    if (!p.active) return p;
  }
  const fresh: Projectile = {
    id: 0, // assigned per shot by `fireProjectile`
    active: false,
    owner: -1,
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    damage: 0,
    radius: PROJECTILE.radius,
    life: 0,
  };
  world.projectiles.push(fresh);
  return fresh;
}

/**
 * Fly every live shot, expire it, and test it against enemy ships — the same
 * circle test as everything else (GDD §4.1). A projectile despawns on hit, on
 * expiry, or on leaving the arena; the slot returns to the pool.
 */
export function updateProjectiles(world: World, dt: number): void {
  for (const p of world.projectiles) {
    if (!p.active) continue;

    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      continue;
    }

    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;

    if (p.pos.x < 0 || p.pos.y < 0 || p.pos.x > world.bounds.width || p.pos.y > world.bounds.height) {
      p.active = false;
      continue;
    }

    for (const ship of world.ships) {
      if (!ship.alive || ship.id === p.owner || ship.spawnProtect > 0) continue;
      const rr = ship.radius + p.radius;
      if (dist2(p.pos, ship.pos) > rr * rr) continue;
      damageShip(world, ship, p.damage);
      p.active = false;
      break;
    }
  }
}
