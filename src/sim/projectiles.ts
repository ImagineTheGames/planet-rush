/**
 * src/sim/projectiles.ts — the ONE weapon system. OWNER: Gameplay Engineer.
 *
 * Ratified amendment v0.3 (`docs/design-amendments.md`): **"the mining laser
 * should go away, it should be a projectile as well… that way we don't have
 * laser + projectile, just projectile."** There is now one pooled shot for
 * everything a ship or turret fires. A ship's shot carries two payloads and what
 * it strikes first decides which applies:
 *  - it hits an **asteroid** ⇒ it chips ore chunks (`mineYield`), and the tractor
 *    rules (GDD §2.3) collect them exactly as before — only the way a rock is
 *    chipped changed, the laser is gone;
 *  - it hits an enemy **ship / turret / shield / core** ⇒ it deals `damage`
 *    (GDD §2.4 target list).
 * Because collision decides, "you cannot shoot through things" is free: a rock
 * between you and an enemy eats the shot (and gets mined). A `'turret'` shot is
 * unchanged from p1-14 — it hits only enemy ships, never rock or structures.
 *
 * Pooled (GDD §4.3): `world.projectiles` is a dense array of reusable slots and
 * `active` marks a live shot, so a firefight allocates nothing per frame beyond
 * the one-time pool growth. Consumers (renderer, snapshot encoder) skip
 * `active === false` slots.
 *
 * Determinism (GDD §4.8): fixed iteration order (pool order for the update;
 * ships, then asteroids, then turrets, then cores for collision), no RNG, every
 * rate `* dt`, one sqrt only where a true magnitude is needed (the lead solve).
 *
 * A shot never hits its owner's own fleet (`owner` exclusion), and it passes
 * *over* anything under spawn protection rather than dying on it (GDD §2.1) —
 * asteroids have no owner and no protection, so any ship shot mines any rock.
 */

import type { PlayerId, Vec2 } from '@shared/types';
import { canDamage } from './allegiance';
import {
  ASTEROID,
  CHUNK,
  PROJECTILE,
  PROJECTILE_CORE_FACTOR,
  SHIP_WEAPON,
  TURRET,
  clampToMargin,
  turretTierShotDamage,
} from './constants';
import {
  damageSatellite,
  damageStation,
  damageTurret,
  stationTargetRadius,
  turretRange,
  turretTier,
} from './buildings';
import { damageShip } from './damage';
import { ledgerAdd } from './ore-ledger';
import type { SpatialHash } from './spatial-hash';
import type { Asteroid, Projectile, Ship, Turret, World } from './state';
import { shipMineYield, shipProjectileLife, shipProjectileSpeed, shipWeaponDamage } from './upgrades';
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
    mineYield: 0,
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
 * Loose one **ship weapon** projectile along the unit vector `dir` — the single
 * shot that both mines and fights (ratified amendment v0.3). Speed, damage,
 * mining yield and lifetime all read from the ship's upgrade state through
 * `./upgrades` — one weapon, one stat (GDD §2.5): the power ladder that speeds
 * mining also speeds and hardens the shot ("make them faster, stronger"). Born
 * at the hull's surface so the muzzle sits on the ship, not inside it. `dir` must
 * be unit length; the callers (`./step`) normalise.
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
  slot.mineYield = shipMineYield(ship);
  slot.radius = SHIP_WEAPON.radius;
  slot.life = shipProjectileLife(ship);
  slot.kind = 'ship';
  slot.active = true;
}

/**
 * Loose one **turret** projectile along bearing `aim` (radians). Relocated from
 * the p1-14 turret gun so it shares the pool and the per-tick update with the ship weapon;
 * since the parity field report (v0.2.2) its bite and reach read from the
 * turret's *tier* rather than the flat `PROJECTILE` constants — a Mk III shot
 * hits harder (`turretTierShotDamage`) and flies the turret's longer tier range
 * (`turretRange`). Muzzle speed stays `TURRET.projectileSpeed` across tiers (the
 * ladder buys damage/rate/reach, not velocity), and a Mk I turret is byte-for-
 * byte the pre-ladder gun: `turretTierShotDamage(0)` = `PROJECTILE.damage`, and
 * `turretRange(Mk I)/speed` = `PROJECTILE.life`.
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
  slot.damage = turretTierShotDamage(turretTier(turret));
  // A turret does not mine; zero the recycled slot's yield so a reused ship-shot
  // slot never carries a stale chip value (turret shots never reach a rock, but
  // the field is part of the serialized/hashed state — keep it clean).
  slot.mineYield = 0;
  slot.radius = PROJECTILE.radius;
  // Lifetime is exactly this turret's tier reach — a shot dies at the edge of the
  // range that acquired the target, so a turret can never out-reach its own
  // engagement, at any Mk (`PROJECTILE.life` is the Mk I value of this).
  slot.life = turretRange(turret) / TURRET.projectileSpeed;
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
 * pool. The shot moves *then* tests, so a point-blank shot still lands the tick
 * it is fired. `hash` is the tick's asteroid broad phase (`./step`), reused here
 * so a ship shot narrows its rock candidates instead of scanning the whole field.
 */
export function updateProjectiles(world: World, hash: SpatialHash, dt: number): void {
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

    if (resolveHit(world, hash, p)) p.active = false;
  }
}

/**
 * The first body a shot strikes this tick, applying its effect, or `false` if it
 * passed cleanly. Ships first (every shot can hit a hull), then — for a ship
 * weapon shot only — **asteroids** (chip ore, mining is shooting now, amendment
 * v0.3), then enemy turrets, shields and cores. A turret shot hits only ships, so
 * p1-14's turret behaviour is untouched (it never reaches the rock or structure
 * branches). Spawn-protected bodies and the shot owner's own fleet are skipped
 * (the shot flies over them, GDD §2.1); a rock has neither, so any ship shot
 * mines any rock — and a rock in the line eats a shot bound for an enemy behind
 * it, which is "you cannot shoot through things" for free.
 */
function resolveHit(world: World, hash: SpatialHash, p: Projectile): boolean {
  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i]!;
    if (!ship.alive || !canDamage(world, p.owner, ship.id) || ship.spawnProtect > 0) continue;
    const rr = ship.radius + p.radius;
    if (dist2(p.pos, ship.pos) > rr * rr) continue;
    // `p.owner` is the attribution the credit ledger needs, and it is already
    // here — it must be, to have asked `canDamage` above. For a turret shot it is
    // the *station owner*, so a turret's kill belongs to the player who bought
    // the deterrent (progression-plan §1.5 trap 3). Nothing is inferred.
    damageShip(world, ship, p.damage, p.owner);
    if (p.kind === 'ship') forfeitProtection(world, p.owner);
    return true;
  }

  // Only a ship weapon shot mines rock or besieges structures.
  if (p.kind !== 'ship') return false;

  // Asteroids: a ship shot chips any rock it reaches (mining is shooting).
  for (const idx of hash.query(p.pos, p.radius + ASTEROID.maxRadius)) {
    const a = world.asteroids[idx];
    if (!a) continue;
    const rr = a.radius + p.radius;
    if (dist2(p.pos, a.pos) > rr * rr) continue;
    chipAsteroid(world, a, ownerShip(world, p.owner), p.mineYield ?? 0);
    return true;
  }

  for (let pi = 0; pi < world.stations.length; pi++) {
    const station = world.stations[pi]!;
    if (!canDamage(world, p.owner, station.owner)) continue; // never your own home; an ally's only under FRIENDLY_FIRE
    for (let ti = 0; ti < station.turrets.length; ti++) {
      const turret = station.turrets[ti]!;
      if (turret.hp <= 0) continue;
      const rr = turret.radius + p.radius;
      if (dist2(p.pos, turret.pos) > rr * rr) continue;
      damageTurret(turret, p.damage, p.owner, world);
      forfeitProtection(world, p.owner);
      return true;
    }
    // Radar satellites are attackable structures (feature f1): a ship weapon shot
    // bites an enemy's orbiting sensor exactly as it does a turret. Killing it
    // collapses that coverage (`./sensing` reads only alive satellites).
    if (station.satellites) {
      for (let si = 0; si < station.satellites.length; si++) {
        const sat = station.satellites[si]!;
        if (sat.hp <= 0) continue;
        const rr = sat.radius + p.radius;
        if (dist2(p.pos, sat.pos) > rr * rr) continue;
        damageSatellite(sat, p.damage, p.owner, world);
        forfeitProtection(world, p.owner);
        return true;
      }
    }
    // A dead or spawn-protected core is not a target — the shot flies over it
    // (GDD §2.1). `damageStation` guards this too, but omitting it here keeps the
    // shot alive to hit something real behind it.
    if (!station.alive || station.spawnProtect > 0) continue;
    const targetR = stationTargetRadius(station);
    const rr = targetR + p.radius;
    if (dist2(p.pos, station.pos) > rr * rr) continue;
    // Shields and cores take the core rate, not the hull rate (GDD §2.8): the
    // projectile carries its ship-damage, scaled down here the way the weapon's
    // core DPS was scaled from its ship DPS.
    damageStation(world, station, p.damage * PROJECTILE_CORE_FACTOR, p.owner);
    forfeitProtection(world, p.owner);
    return true;
  }

  return false;
}

/**
 * Spend `owner`'s spawn protection because it just landed an offensive hit
 * (field report v0.2.1). Idempotent and cheap: a shooter that was never
 * protected (the common case) is untouched, and once cleared it stays cleared
 * for the rest of that life. Called only from the enemy-damage branches of
 * {@link resolveHit} for a ship weapon shot — never on a mined rock — so the
 * opening grace survives mining but ends the moment you draw first blood on an
 * enemy ship, turret, or core (GDD §2.1 grace is to fly, not to siege).
 */
function forfeitProtection(world: World, owner: PlayerId): void {
  const ship = ownerShip(world, owner);
  if (ship && ship.spawnProtect > 0) ship.spawnProtect = 0;
}

/** Live shots owned by `owner` — a small helper for tests and any read model
 *  that wants a shooter's shots without walking the sparse pool by hand. */
export function activeProjectilesOf(world: World, owner: PlayerId): Projectile[] {
  return world.projectiles.filter((p) => p.active && p.owner === owner);
}

// ---------------------------------------------------------------------------
// Mining — a shot chips a rock (ratified amendment v0.3)
// ---------------------------------------------------------------------------

/** The ship that fired a shot, so mined chunks can drift toward it (the tractor
 *  then collects them, GDD §2.3). Ships never leave the array, so a shot always
 *  finds its owner even after it died; a `null` guards the degenerate case. */
function ownerShip(world: World, owner: PlayerId): Ship | null {
  for (const s of world.ships) {
    if (s.id === owner) return s;
  }
  return null;
}

/**
 * Chip `yieldAmount` ore out of asteroid `a` — one weapon projectile's mining
 * hit (amendment v0.3). Identical accounting to the retired continuous laser:
 * ore is drawn down (never below zero, so total-ore-per-asteroid is exactly the
 * ratified `ore`), the crack stage advances across its three thresholds
 * (GDD §5.5), and whole chunks are emitted from a fractional buffer, drifting
 * toward the miner. The rock is removed at end of step by `./step` once its ore
 * hits zero — collision indices stay stable within the tick (GDD §4.8).
 */
function chipAsteroid(world: World, a: Asteroid, toward: Ship | null, yieldAmount: number): void {
  const amount = Math.min(yieldAmount, a.ore);
  a.ore -= amount;
  a.mineBuffer += amount;

  const frac = a.ore / a.maxOre;
  a.crackStage = frac > ASTEROID.crackThresholds[0] ? 0 : frac > ASTEROID.crackThresholds[1] ? 1 : 2;

  while (a.mineBuffer >= CHUNK.ore) {
    spawnMinedChunk(world, a, toward, CHUNK.ore);
    a.mineBuffer -= CHUNK.ore;
  }

  if (a.ore <= 1e-9) {
    a.ore = 0;
    if (a.mineBuffer > 1e-9) {
      spawnMinedChunk(world, a, toward, a.mineBuffer);
      a.mineBuffer = 0;
    }
  }
}

/** Spawn one ore chunk at the asteroid's surface, drifting toward the miner
 *  `toward` (or straight out along +x if the owner is somehow gone). Pooled into
 *  the same chunk array (and the same renderer/tractor) mined ore always used;
 *  the drift heading is pure geometry, no RNG (GDD §4.8). */
function spawnMinedChunk(world: World, a: Asteroid, toward: Ship | null, amount: number): void {
  const dir = toward
    ? normalize({ x: toward.pos.x - a.pos.x, y: toward.pos.y - a.pos.y }, { x: 1, y: 0 })
    : { x: 1, y: 0 };
  world.chunks.push({
    id: world.nextEntityId++,
    pos: {
      x: clampToMargin(a.pos.x + dir.x * (a.radius + CHUNK.radius), CHUNK.radius, world.bounds.width),
      y: clampToMargin(a.pos.y + dir.y * (a.radius + CHUNK.radius), CHUNK.radius, world.bounds.height),
    },
    vel: { x: dir.x * CHUNK.ejectSpeed, y: dir.y * CHUNK.ejectSpeed },
    amount,
    radius: CHUNK.radius,
  });
  // Rock → chunk: a transfer within the live economy, recorded so the ledger can
  // attribute every chunk's ore to where it came from (`./ore-ledger`).
  ledgerAdd(world, 'mined', amount);
}
