/**
 * src/sim/projectiles.ts — pooled combat projectiles. OWNER: Gameplay Engineer.
 *
 * The ratified design amendment v0.2 (`docs/design-amendments.md`) splits the
 * one shared beam: **mining stays a beam** (segment-vs-circle raycast vs
 * asteroids, untouched in `./step`), but **ship-vs-ship and ship-vs-structure
 * combat is a projectile** — "if we switch to a projectile there's a chance to
 * dodge and it becomes a lot funner." Turrets already fired projectiles (GDD
 * §2.6, §4.1); this module is the single pooled system both shooters now share,
 * so a ship shot and a turret shot fly, expire, collide and snapshot the same
 * way.
 *
 * Pooled (GDD §4.3): `world.projectiles` is a dense array of reusable slots and
 * `active` marks a live shot, so a firefight allocates nothing per frame beyond
 * the one-time pool growth. Consumers (renderer, snapshot encoder) skip
 * `active === false` slots.
 *
 * Determinism (GDD §4.8): fixed iteration order (pool order for stepping;
 * ships, then planets' turrets, then cores for collision), no RNG, every rate
 * `* dt`, one sqrt only where a true magnitude is needed (the lead solve).
 *
 * The target list is the shot's `kind`:
 *  - a `'ship'` weapon shot is siege-capable — it collides with enemy ships,
 *    turrets, shields and cores (GDD §2.4 target list, minus asteroids: shots
 *    fly over rock, mining is the beam's job);
 *  - a `'turret'` shot hits only enemy ships, keeping p1-14's turret behaviour
 *    exactly as it was.
 * A shot never hits its owner's own fleet (`owner` exclusion), and it passes
 * *over* anything under spawn protection rather than dying on it (GDD §2.1) —
 * the same "not a target, so the shot continues" rule the beam used.
 */

import type { PlayerId, Vec2 } from '@shared/types';
import {
  PROJECTILE,
  PROJECTILE_CORE_FACTOR,
  SHIP_WEAPON,
  TURRET,
} from './constants';
import { damagePlanet, damageTurret, planetTargetRadius } from './buildings';
import { damageShip } from './damage';
import type { Projectile, Ship, Turret, World } from './state';
import { shipProjectileLife, shipProjectileSpeed, shipWeaponDamage } from './upgrades';
import { dist2, normalize } from './vec';

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

/**
 * Take a dead slot from the pool, or grow it once. Growth is the only allocation
 * the projectile system ever does, and it stops as soon as the pool reaches the
 * match's peak concurrent shots (GDD §4.3: no per-frame allocation). The slot is
 * returned inactive; the caller fills it and sets `active`.
 */
export function takeProjectile(world: World): Projectile {
  for (const p of world.projectiles) {
    if (!p.active) return p;
  }
  const fresh: Projectile = {
    id: 0, // assigned per shot by the fire functions
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

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

/**
 * Loose one **ship weapon** projectile along the unit vector `dir` (design
 * amendment v0.2). Speed, damage and lifetime all read from the ship's upgrade
 * state through `./upgrades` — one beam, one stat (GDD §2.5): the beam ladder
 * that speeds mining also speeds and hardens the shot ("make them faster,
 * stronger"). Born at the hull's surface so the muzzle sits on the ship, not
 * inside it. `dir` must be unit length; the callers (`./step`) normalise.
 */
export function fireShipProjectile(world: World, ship: Ship, dir: Vec2): void {
  const speed = shipProjectileSpeed(ship);
  const slot = takeProjectile(world);
  // A recycled slot gets a fresh id: a renderer or snapshot encoder keying on id
  // must never mistake this shot for the one that used the slot before it.
  slot.id = world.nextEntityId++;
  slot.owner = ship.id;
  slot.pos.x = ship.pos.x + dir.x * ship.radius;
  slot.pos.y = ship.pos.y + dir.y * ship.radius;
  slot.vel.x = dir.x * speed;
  slot.vel.y = dir.y * speed;
  slot.damage = shipWeaponDamage(ship);
  slot.radius = SHIP_WEAPON.radius;
  slot.life = shipProjectileLife(ship);
  slot.kind = 'ship';
  slot.active = true;
}

/**
 * Loose one **turret** projectile along bearing `aim` (radians). Unchanged from
 * the p1-14 turret gun that used to live in `./buildings`, only relocated so it
 * shares the pool and the stepping with the ship weapon: same design DPS, same
 * `TURRET.projectileSpeed`, same short lifetime clamped to turret range.
 */
export function fireTurretProjectile(world: World, turret: Turret, aim: number): void {
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  const slot = takeProjectile(world);
  slot.id = world.nextEntityId++;
  slot.owner = turret.owner;
  slot.pos.x = turret.pos.x + dx * turret.radius;
  slot.pos.y = turret.pos.y + dy * turret.radius;
  slot.vel.x = dx * TURRET.projectileSpeed;
  slot.vel.y = dy * TURRET.projectileSpeed;
  slot.damage = PROJECTILE.damage;
  slot.radius = PROJECTILE.radius;
  slot.life = PROJECTILE.life;
  slot.kind = 'turret';
  slot.active = true;
}

// ---------------------------------------------------------------------------
// Lead / intercept (the aim a moving target must be shot with)
// ---------------------------------------------------------------------------

/**
 * The unit aim direction that intercepts a target at `targetPos` moving at
 * `targetVel` with a shot of muzzle speed `speed` fired from `origin` (design
 * amendment v0.2, item 5). Because the shot now takes *time* to arrive, aiming
 * at where the target *is* misses a strafing ship — the whole point of the
 * switch — so anything that wants to actually hit a mover (the sim's auto-aim,
 * and the bots) aims where it *will be*.
 *
 * Solves |targetPos + targetVel·t − origin| = speed·t for the earliest positive
 * impact time and returns the direction to that intercept point. Falls back to
 * aiming at the target's current position when there is no real forward solution
 * (the target is faster than the shot, or the geometry is degenerate) — a doomed
 * shot still flies straight rather than NaN. Deterministic: pure arithmetic,
 * fixed operation order, a single sqrt.
 */
export function leadAim(origin: Vec2, targetPos: Vec2, targetVel: Vec2, speed: number): Vec2 {
  const rx = targetPos.x - origin.x;
  const ry = targetPos.y - origin.y;
  const direct = normalize({ x: rx, y: ry });

  // Quadratic a t² + b t + c = 0 in the impact time t.
  const a = targetVel.x * targetVel.x + targetVel.y * targetVel.y - speed * speed;
  const b = 2 * (rx * targetVel.x + ry * targetVel.y);
  const c = rx * rx + ry * ry;

  let t = -1;
  if (Math.abs(a) < 1e-9) {
    // Target closing/opening at exactly muzzle speed: linear b t + c = 0.
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      // Earliest strictly-positive root.
      t = t1 > 0 && (t2 <= 0 || t1 < t2) ? t1 : t2;
    }
  }

  if (t > 0) {
    const ix = targetPos.x + targetVel.x * t - origin.x;
    const iy = targetPos.y + targetVel.y * t - origin.y;
    return normalize({ x: ix, y: iy }, direct);
  }
  return direct;
}

// ---------------------------------------------------------------------------
// Per-tick: fly, expire, collide
// ---------------------------------------------------------------------------

/**
 * Fly every live shot, expire it, and test it against its target list — the same
 * circle test as everything else (GDD §4.1). A projectile despawns on the first
 * body it strikes, on expiry, or on leaving the arena; the slot returns to the
 * pool. Runs after the beam so a structure killed by a beam this tick is already
 * gone (`./step` order), and the shot moves *then* tests, so a point-blank shot
 * still lands the tick it is fired.
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

    if (resolveHit(world, p)) p.active = false;
  }
}

/**
 * The first body a shot strikes this tick, applying its damage, or `false` if it
 * passed cleanly. Ships first (every shot can hit a hull), then — for a ship
 * weapon shot only — enemy turrets, shields and cores. A turret shot hits only
 * ships, so p1-14's turret behaviour is untouched. Spawn-protected bodies and
 * the shot owner's own fleet are skipped (the shot flies over them, GDD §2.1).
 */
function resolveHit(world: World, p: Projectile): boolean {
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    if (!ship.alive || ship.id === p.owner || ship.spawnProtect > 0) continue;
    const rr = ship.radius + p.radius;
    if (dist2(p.pos, ship.pos) > rr * rr) continue;
    damageShip(world, ship, p.damage);
    return true;
  }

  // Only a ship weapon shot besieges structures (design amendment v0.2, item 2).
  if (p.kind !== 'ship') return false;

  for (let pi = 0; pi < world.planets.length; pi++) {
    const planet = world.planets[pi]!;
    if (planet.owner === p.owner) continue; // never your own home
    for (let ti = 0; ti < planet.turrets.length; ti++) {
      const turret = planet.turrets[ti]!;
      if (turret.hp <= 0) continue;
      const rr = turret.radius + p.radius;
      if (dist2(p.pos, turret.pos) > rr * rr) continue;
      damageTurret(turret, p.damage);
      return true;
    }
    // A dead or spawn-protected core is not a target — the shot flies over it,
    // exactly as the beam did (GDD §2.1). `damagePlanet` guards this too, but
    // skipping here keeps the shot alive to hit something real behind it.
    if (!planet.alive || planet.spawnProtect > 0) continue;
    const targetR = planetTargetRadius(planet);
    const rr = targetR + p.radius;
    if (dist2(p.pos, planet.pos) > rr * rr) continue;
    // Shields and cores take the core rate, not the hull rate (GDD §2.8): the
    // projectile carries its ship-damage, scaled down here the way the beam's
    // core DPS was scaled from its ship DPS.
    damagePlanet(world, planet, p.damage * PROJECTILE_CORE_FACTOR);
    return true;
  }

  return false;
}

/** Live shots owned by `owner` — a small helper for tests and any read model
 *  that wants a shooter's shots without walking the sparse pool by hand. */
export function activeProjectilesOf(world: World, owner: PlayerId): Projectile[] {
  return world.projectiles.filter((p) => p.active && p.owner === owner);
}
