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

import type { Muzzle, PlayerId, BuildItem, UpgradeTrack, Vec2 } from '@shared/types';
import {
  DEPOSIT_RANGE,
  PLANET,
  REPAIR,
  SHIELD,
  TURRET,
  TURRET_MAX_TIER,
  turretTierSpec,
} from './constants';
import { destroyCore, isCollapsed } from './match';
import { fireTurretProjectile } from './projectiles';
import type { Planet, Ship, Shield, Turret, World } from './state';
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

/** True while a ship is inside a planet's atmosphere — the `DEPOSIT_RANGE` halo
 *  within which its hold auto-deposits at its own living planet (ratified p4:
 *  "just be in that atmosphere"). Centre-to-centre, boundary counting as inside.
 *  `DEPOSIT_RANGE > PLANET.dockRange`, so a docked ship is always in-atmosphere.
 *  The caller checks ownership/liveness (see `updateDeposits`); the renderer
 *  draws the halo from the same `DEPOSIT_RANGE` this reads. */
export function inAtmosphere(ship: Ship, planet: Planet): boolean {
  return ship.alive && dist2(ship.pos, planet.pos) <= DEPOSIT_RANGE * DEPOSIT_RANGE;
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

// ---------------------------------------------------------------------------
// Turret tiers — a standing turret's Mk on the ladder (parity field report v0.2.2)
// ---------------------------------------------------------------------------

/** A turret's tier, clamped into the ladder — the sim never trusts a tier it did
 *  not write, and a turret with no `tier` (an other-agent literal) reads as Mk I.
 *  Mirrors `tierOf` for ship upgrades. */
export function turretTier(turret: Turret): number {
  const raw = turret.tier ?? 0;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(Math.floor(raw), TURRET_MAX_TIER));
}

/** Engagement radius of this turret at its tier (`turretTierSpec`). Under
 *  `WEAPON_RANGE` at every tier by design (GDD §2.6 pick-off skill). */
export function turretRange(turret: Turret): number {
  return turretTierSpec(turretTier(turret)).range;
}

/** Seconds between this turret's shots at its tier. */
export function turretFireInterval(turret: Turret): number {
  return turretTierSpec(turretTier(turret)).fireInterval;
}

/**
 * The standing turret a TURRET-wedge *upgrade* press acts on: the lowest-tier
 * live turret not already maxed, ties broken by lowest mount slot — a
 * deterministic "improve your weakest turret first" pick (breadth of Mk before
 * depth, GDD §4.8). `null` when the ring has nothing left to climb (no turret, or
 * every one already Mk III). The UI reads this to know the wedge is in its
 * upgrade state and which turret it targets (parity field report v0.2.2).
 */
export function turretUpgradeTarget(planet: Planet): Turret | null {
  let best: Turret | null = null;
  for (const t of planet.turrets) {
    if (t.hp <= 0 || turretTier(t) >= TURRET_MAX_TIER) continue;
    const tt = turretTier(t);
    if (best === null || tt < turretTier(best) || (tt === turretTier(best) && t.slot < best.slot)) {
      best = t;
    }
  }
  return best;
}

/** Ore price of the next TURRET-wedge upgrade on a planet — stepping its
 *  {@link turretUpgradeTarget} one Mk up — or `null` when nothing can be
 *  upgraded. The UI prices the wedge's upgrade state from this. */
export function turretUpgradeCost(planet: Planet): number | null {
  const target = turretUpgradeTarget(planet);
  if (target === null) return null;
  return turretTierSpec(turretTier(target) + 1).upgradeCost;
}

/**
 * Apply a tier to a standing turret, granting the new plate immediately —
 * mirroring `applyPurchasedStats` for ship hull (`./upgrades`): `maxHp` rises to
 * the tier's HP and the *difference* is added to current `hp`, so an upgrade is
 * new armor, never a heal — a Mk I at 10/30 that reaches Mk II is 25/45, still
 * carrying 20 HP of damage. Damage, fire rate and range are read live from
 * `turretTierSpec(tier)` every tick, so `hp`/`maxHp` are all this writes.
 */
export function applyTurretTier(turret: Turret, tier: number): void {
  const clamped = Math.max(0, Math.min(Math.floor(tier), TURRET_MAX_TIER));
  const before = turret.maxHp;
  turret.tier = clamped;
  turret.maxHp = turretTierSpec(clamped).hp;
  const gained = turret.maxHp - before;
  if (gained > 0) turret.hp += gained;
  if (turret.hp > turret.maxHp) turret.hp = turret.maxHp;
}

/** The rim angle a turret in `slot` mounts at: the planet's outward angle plus
 *  an even share of the ring, so slot 0 always starts facing away from the
 *  field. This is the turret's *home* orbit angle — where it is born and where
 *  it slides back to when nothing is in range (field report P1). */
export function turretHomeAngle(planet: Planet, slot: number): number {
  return planet.angle + (2 * Math.PI * slot) / TURRET.capPerPlanet;
}

/** The world position of a point at rim angle `angle` around a planet — the
 *  turret's surface-ring orbit at that angle. A turret slides its `orbitAngle`
 *  and its `pos` is this, recomputed every tick. */
export function turretOrbitPos(planet: Planet, angle: number): { x: number; y: number } {
  const r = planet.radius + TURRET.mountOffset + TURRET.radius;
  return { x: planet.pos.x + Math.cos(angle) * r, y: planet.pos.y + Math.sin(angle) * r };
}

/** Where a turret in `slot` sits at rest: on the planet's surface ring, at its
 *  mount-slot home angle. The build-spot position, and the orbit position of a
 *  turret whose `orbitAngle` still equals its home angle. */
export function turretMountPos(planet: Planet, slot: number): { x: number; y: number } {
  return turretOrbitPos(planet, turretHomeAngle(planet, slot));
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
      const slot = freeTurretSlot(planet);
      if (slot >= 0) {
        // A mount is free: BUILD a new Mk I turret. Construction takes time, so
        // the defense is bought before the attack, not during it (GDD §2.5).
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
      // The ring is full — the TURRET wedge is in its UPGRADE state (parity field
      // report v0.2.2): step the weakest standing turret one Mk up. Instant, like
      // a ship upgrade (`buyUpgrade`): the defense already stands, so the
      // build-time gate — which exists to stop a *new* defense appearing
      // mid-attack — does not apply. Ore is drawn hold-first then bank, as ever.
      const target = turretUpgradeTarget(planet);
      if (target === null) return 'cap-reached'; // full ring, every turret maxed
      const cost = turretTierSpec(turretTier(target) + 1).upgradeCost;
      if (cost === null) return 'cap-reached';
      if (!spendOre(ship, cost)) return 'cannot-afford';
      applyTurretTier(target, turretTier(target) + 1);
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
  /** The ship is dead, waiting on the respawn clock — a purchase is an action a
   *  live hull takes at its planet, and a wreck between lives takes none (GDD
   *  §2.5, §2.7). The refusal is loud (not a misleading `not-docked`) so the
   *  upgrade screen can say "respawning" rather than "fly to your planet". The
   *  order is refused, never queued — see the `!ship.alive` decision below. */
  | 'dead'
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
 *
 * **Upgrades are the player's, not the hull's** (v0.2.2 field report, ratified):
 * `ship.id` — a stable {@link PlayerId} — keys the planet lookup, and `ship.tiers`
 * is match-lifetime state the respawn path never clears (`./step` `respawn`). So a
 * purchase resolves the same before a death and after a respawn: the same wallet,
 * the same ladder, no reference to a "previous" hull, because the sim mutates one
 * ship in place across a life rather than swapping instances. A fresh track and
 * the next tier of a pre-death track are both buyable the instant the ship is back.
 *
 * The one life-state gate is `alive`: a dead ship (between lives) is refused
 * `'dead'` *before* the docking check, so the reason is the true one — you are a
 * wreck on the respawn clock, not merely out of dock range. The order is refused,
 * never queued: a purchase is a live action, and the ship reaches its planet again
 * on respawn to buy for real (`isDocked` also short-circuits on `alive`, but the
 * explicit gate makes the documented precondition legible and refactor-proof).
 */
export function buyUpgrade(world: World, ship: Ship, track: UpgradeTrack): UpgradeResult {
  if (!ship.alive) return 'dead';
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
 * Runs *before* this tick's projectiles, so damage dealt now takes
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
  const home = turretHomeAngle(planet, slot);
  const pos = turretOrbitPos(planet, home);
  // Built at Mk I. `turretTierSpec(0).hp` is `TURRET.hp` by construction, so a
  // fresh turret is byte-for-byte the pre-ladder turret — the upgrade path is
  // the only thing that ever moves it off tier 0.
  const spec = turretTierSpec(0);
  return {
    id: world.nextEntityId++,
    owner: planet.owner,
    slot,
    pos: { x: pos.x, y: pos.y },
    radius: TURRET.radius,
    hp: spec.hp,
    maxHp: spec.hp,
    tier: 0,
    // Barrel starts pointing outward, away from the planet it defends.
    angle: home,
    // Born on its mount slot; it slides from here toward the threat (field
    // report P1). Deriving `pos` from this keeps the two in lockstep.
    orbitAngle: home,
    cooldown: 0,
    targetId: null,
    muzzle: null,
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

/** The radius an attacker's shot actually strikes: the shield bubble
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
 * ships can be shooting the same planet in one tick, and removing an entry
 * mid-tick would shift the indices the other ship's shot already resolved.
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
 * Acquire, track, slide, and shoot. Each tick every turret (field report P1):
 *
 *  1. **picks a target** — its nearest enemy ship in range, but *sticky*: it
 *     keeps the one it has until that ship dies, leaves range, or a newcomer is
 *     `TURRET.targetHysteresis` closer, so it never flaps between equidistant
 *     enemies (`acquireTarget`);
 *  2. **slides around the rim** toward the point whose outward normal faces that
 *     target, capped at `TURRET.orbitSpeed` — a glide, not a teleport
 *     (`slideTurrets`);
 *  3. **turns its barrel** toward the target at `TURRET.turnRate`; and
 *  4. **fires** every `TURRET.fireInterval` seconds.
 *
 * Alignment deliberately does not gate the shot: `dps` is the design number and
 * a turn-rate-gated turret would quietly under-deliver it. The slide runs before
 * the barrel/fire, so both originate from the turret's position *this* tick.
 */
export function updateTurrets(world: World, dt: number): void {
  for (const planet of world.planets) {
    if (!planet.alive) continue;

    // 1. Resolve every turret's sticky target first, so the slide can fan
    //    turrets that share one target and the barrel aims at a settled pick.
    for (const turret of planet.turrets) {
      if (turret.hp <= 0) continue; // killed this tick, swept at end of step
      // The muzzle tell is a per-tick event: assume not firing, and only the
      // branch that actually looses a shot below sets it. Cleared here so a
      // renderer never draws a stale flash a tick after the shot left.
      turret.muzzle = null;
      const target = acquireTarget(world, planet, turret);
      turret.targetId = target ? target.id : null;
    }

    // 1b. Coverage split: never stack two turrets on one threat while another
    //     valid threat goes unengaged (field report P1, §4). A planet-level pass
    //     because the split is a property of the *set* of turrets, not any one.
    splitThreats(world, planet);

    // 2. Slide each turret along the rim toward its target's facing normal.
    slideTurrets(world, planet, dt);

    // 3./4. Track the barrel and fire, from the position the slide left us at.
    for (const turret of planet.turrets) {
      if (turret.hp <= 0) continue;
      if (turret.cooldown > 0) turret.cooldown = Math.max(0, turret.cooldown - dt);
      const target = turret.targetId !== null ? shipOf(world, turret.targetId) : null;
      if (!target) continue;

      const dx = target.pos.x - turret.pos.x;
      const dy = target.pos.y - turret.pos.y;
      const aim = Math.atan2(dy, dx);
      turret.angle = turnToward(turret.angle, aim, TURRET.turnRate * dt);

      if (turret.cooldown <= 0) {
        fireTurretProjectile(world, turret, aim);
        // Publish the muzzle flash from the same firing decision the projectile
        // rode out on, so the tell can never disagree with the shot (GDD §2.6).
        turret.muzzle = makeMuzzle(turret, target, aim);
        turret.cooldown = turretFireInterval(turret);
      }
    }
  }
}

/**
 * The far edge of the ring a **sliding** turret can bring a shot onto: the orbit
 * radius plus `TURRET.range` (field report P1, §1). Threat detection is measured
 * from the *planet centre*, not the turret's current rim spot — the whole point
 * of orbiting is to slide around and reach a far-side attacker, so a threat this
 * close to the core is engageable even when it sits outside firing range of where
 * the turret happens to be sitting *right now*. Once the turret slides to the
 * facing-normal point it has line of sight and closes to `range` (§2).
 */
export function planetThreatRadius(planet: Planet): number {
  // The planet's overall threat envelope is its *longest-reaching* live turret,
  // so a mixed-tier ring gathers every threat any of its turrets could engage
  // (the per-turret reach still gates each turret's own acquire — `acquireTarget`
  // — and the projectile's finite life caps where a shot actually lands). A ring
  // with nothing standing falls back to the Mk I base reach.
  let range: number = TURRET.range;
  for (const t of planet.turrets) {
    if (t.hp > 0) range = Math.max(range, turretRange(t));
  }
  return planet.radius + TURRET.mountOffset + TURRET.radius + range;
}

/** The reach of ONE sliding turret from its planet's centre — the rim orbit
 *  radius plus this turret's own tier range. A sliding turret is engaged against
 *  a threat inside this even when the threat sits outside firing range of where
 *  it currently sits, because it slides to close the gap (field report P1). */
export function turretThreatRadius(planet: Planet, turret: Turret): number {
  return planet.radius + TURRET.mountOffset + TURRET.radius + turretRange(turret);
}

/**
 * True when `ship` is actively shooting this planet — it owns a live weapon
 * projectile whose forward path reaches the shield/core surface (field report
 * P1, §3; design amendment v0.2). This is the signal that ranks an attacker over
 * a mere loiterer: a ship putting shots on the core is a threat to answer even
 * from the far side, ahead of one just drifting close.
 *
 * Read from the projectile pool, not `Ship.firing`: `firing` is only a bare
 * "trigger held" tell with no geometry, so an attacker carving the core is known
 * by the shots it has in flight, not a flag. A shot lives longer than
 * the fire interval, so a continuously-firing attacker always has one in flight,
 * and the detection never blinks between shots. `updateTurrets` runs after the
 * ship fire step, so this tick's fresh shots are already visible here.
 */
function isAttackingPlanet(world: World, planet: Planet, ship: Ship): boolean {
  const targetR = planetTargetRadius(planet);
  for (const p of world.projectiles) {
    if (!p.active || p.owner !== ship.id || p.kind !== 'ship') continue;
    const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y);
    if (speed < 1e-9) continue;
    const dir = { x: p.vel.x / speed, y: p.vel.y / speed };
    // How far the shot can still travel before it despawns — its remaining reach.
    if (segmentHitsCircle(p.pos, dir, speed * p.life, planet.pos, targetR)) return true;
  }
  return false;
}

/** Whether the segment from `o` along unit `dir` for `len` passes within `r` of
 *  `c` — the closest approach of the clamped segment to the circle centre. */
function segmentHitsCircle(o: Vec2, dir: Vec2, len: number, c: Vec2, r: number): boolean {
  let t = (c.x - o.x) * dir.x + (c.y - o.y) * dir.y;
  if (t < 0) t = 0;
  else if (t > len) t = len;
  const px = o.x + dir.x * t - c.x;
  const py = o.y + dir.y * t - c.y;
  return px * px + py * py <= r * r;
}

/**
 * The enemy ship a turret engages this tick — **sticky**, the "don't go crazy"
 * rule (field report P1, §2), now scanned from the planet so far-side threats
 * are visible (§1) and ranked so a core-attacker outranks a loiterer (§3).
 *
 * Detection is planet-centric for a sliding turret — a threat inside
 * `planetThreatRadius` is a valid target even outside firing range of the turret's
 * current rim spot, because the turret slides to reach it. A hand-built turret
 * with no `orbitAngle` can't slide, so it keeps the old turret-centric `range`.
 *
 * The pick, in order: (1) a ship actively shooting the core outranks any loiterer
 * regardless of distance; (2) within the same class the nearest wins; and (3)
 * stickiness holds the current target until a same-class newcomer is closer by
 * the `TURRET.targetHysteresis` factor (≈25%) — so equidistant enemies never
 * make it flap. Priority (1) is not gated by hysteresis: an attacker appearing
 * on the far side is switched to at once, and a nearby loiterer never steals a
 * turret off the ship shooting the core.
 */
function acquireTarget(world: World, planet: Planet, turret: Turret): Ship | null {
  // A sliding turret measures threats from the planet centre; a fixed one (no
  // `orbitAngle`) from itself, since it cannot slide to close the gap.
  const sliding = turret.orbitAngle !== undefined;
  const ref = sliding ? planet.pos : turret.pos;
  // Reach is this turret's own tier range (GDD §2.6): a sliding turret measures
  // it from the planet centre (it slides to close), a fixed one from itself.
  const reach = sliding ? turretThreatRadius(planet, turret) : turretRange(turret);
  const reach2 = reach * reach;

  // Best valid enemy this tick — attacker-first, then nearest — the switch
  // candidate against the sticky current pick below.
  let best: Ship | null = null;
  let bestAtk = false;
  let bestD2 = Infinity;
  for (const ship of world.ships) {
    if (!ship.alive || ship.id === planet.owner || ship.spawnProtect > 0) continue;
    const d2 = dist2(ref, ship.pos);
    if (d2 > reach2) continue;
    const atk = isAttackingPlanet(world, planet, ship);
    if (best === null || (atk && !bestAtk) || (atk === bestAtk && d2 < bestD2)) {
      best = ship;
      bestAtk = atk;
      bestD2 = d2;
    }
  }

  // Is the turret's current pick still a valid target it may keep?
  const current = turret.targetId !== null ? shipOf(world, turret.targetId) : null;
  const currentValid =
    current !== null &&
    current.alive &&
    current.id !== planet.owner &&
    current.spawnProtect <= 0 &&
    dist2(ref, current.pos) <= reach2;

  if (!currentValid) return best;
  if (best === null || best.id === current!.id) return current;

  // Priority class trumps distance and hysteresis: switch to an attacker over a
  // loiterer at once, and never abandon an attacker for a merely-closer loiterer.
  const curAtk = isAttackingPlanet(world, planet, current!);
  if (bestAtk !== curAtk) return bestAtk ? best : current;

  // Same class: only defect if the newcomer is meaningfully closer, i.e. within
  // `hysteresis ×` the current target's distance.
  const currentD2 = dist2(ref, current!.pos);
  const h = TURRET.targetHysteresis;
  return bestD2 <= currentD2 * h * h ? best : current;
}

/**
 * Split a planet's turrets across distinct threats (field report P1, §4). After
 * every turret has made its sticky pick, no two turrets should stack on one
 * attacker while another valid threat goes unengaged — two turrets, two
 * attackers on opposite sides, means one turret each.
 *
 * Deterministic greedy to a fixed point: while some valid threat has no turret
 * on it and another threat carries two or more, move the over-covered turret
 * *nearest by orbit angle* to the unengaged threat (slot breaks a tie) — the
 * cheapest, most natural reassignment, and stable tick to tick because a turret
 * that has slid onto a threat's bearing stays the nearest one for it. Only
 * sliding turrets take part; a fixed turret cannot cover a far threat anyway.
 */
function splitThreats(world: World, planet: Planet): void {
  const turrets = planet.turrets;
  const reach2 = planetThreatRadius(planet) ** 2;

  const threats: Ship[] = [];
  for (const ship of world.ships) {
    if (!ship.alive || ship.id === planet.owner || ship.spawnProtect > 0) continue;
    if (dist2(planet.pos, ship.pos) <= reach2) threats.push(ship);
  }
  if (threats.length < 2) return; // nothing to spread across

  // At most one move per uncovered threat, and each move covers one, so the
  // turret count bounds the passes.
  for (let pass = 0; pass < turrets.length; pass++) {
    let moved = false;
    for (const recip of threats) {
      if (coverCount(turrets, recip.id) > 0) continue; // already engaged

      const bearing = Math.atan2(recip.pos.y - planet.pos.y, recip.pos.x - planet.pos.x);
      let donor: Turret | null = null;
      let donorDelta = Infinity;
      for (const t of turrets) {
        if (t.hp <= 0 || t.orbitAngle === undefined || t.targetId === null) continue;
        if (coverCount(turrets, t.targetId) < 2) continue; // only steal a doubled-up threat
        const delta = Math.abs(shortestAngle(t.orbitAngle, bearing));
        if (delta < donorDelta || (delta === donorDelta && donor !== null && t.slot < donor.slot)) {
          donorDelta = delta;
          donor = t;
        }
      }
      if (donor !== null) {
        donor.targetId = recip.id;
        moved = true;
        break; // recompute coverage from scratch
      }
    }
    if (!moved) break;
  }
}

/** Live sliding turrets on `targetId`. */
function coverCount(turrets: Turret[], targetId: PlayerId | null): number {
  let n = 0;
  for (const t of turrets) {
    if (t.hp > 0 && t.orbitAngle !== undefined && t.targetId === targetId) n++;
  }
  return n;
}

/** Shortest signed angle from `a` to `b`, in (-π, π]. */
function shortestAngle(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Slide each of a planet's turrets one tick toward the rim point whose outward
 * surface normal faces its target (field report P1). The desired rim angle is
 * simply the bearing from the planet centre to the target — which does *not*
 * depend on where the turret currently sits, so `turnToward` converges and then
 * halts, a glide with no orbiting. Turrets sharing one target fan out around
 * that bearing so they never stack (§3); a turret with no target drifts back to
 * its mount-slot home angle.
 *
 * Only turrets carrying an `orbitAngle` slide — a hand-built fixture without one
 * keeps its authoritative `pos` (see the field's doc). Zero per-frame allocation:
 * `pos` is written in place (GDD §4.3).
 */
function slideTurrets(world: World, planet: Planet, dt: number): void {
  const turrets = planet.turrets;
  const maxStep = TURRET.orbitSpeed * dt;
  const r = planet.radius + TURRET.mountOffset + TURRET.radius;
  for (let i = 0; i < turrets.length; i++) {
    const turret = turrets[i]!;
    if (turret.hp <= 0 || turret.orbitAngle === undefined) continue;
    const desired = desiredOrbitAngle(world, planet, turrets, i);
    turret.orbitAngle = turnToward(turret.orbitAngle, desired, maxStep);
    turret.pos.x = planet.pos.x + Math.cos(turret.orbitAngle) * r;
    turret.pos.y = planet.pos.y + Math.sin(turret.orbitAngle) * r;
  }
}

/**
 * The rim angle turret `i` wants this tick. With a target it is the bearing from
 * the planet centre to that ship, plus a symmetric fan offset so turrets sharing
 * the target spread apart instead of stacking (`TURRET.orbitSeparation`, §3).
 * With no target it is the turret's mount-slot home angle. Fan rank is keyed on
 * `slot` (a stable per-turret key), so the spread is deterministic (GDD §4.8).
 */
function desiredOrbitAngle(world: World, planet: Planet, turrets: Turret[], i: number): number {
  const turret = turrets[i]!;
  if (turret.targetId === null) return turretHomeAngle(planet, turret.slot);
  const target = shipOf(world, turret.targetId);
  if (target === null) return turretHomeAngle(planet, turret.slot);

  const bearing = Math.atan2(target.pos.y - planet.pos.y, target.pos.x - planet.pos.x);

  // Rank this turret among the sliders converging on the same target, ordered by
  // slot (index breaks a tie), and offset it symmetrically about the bearing.
  let count = 0;
  let rank = 0;
  for (let j = 0; j < turrets.length; j++) {
    const other = turrets[j]!;
    if (other.hp <= 0 || other.orbitAngle === undefined || other.targetId !== turret.targetId) continue;
    count++;
    if (other.slot < turret.slot || (other.slot === turret.slot && j < i)) rank++;
  }
  const offset = (rank - (count - 1) / 2) * TURRET.orbitSeparation;
  return bearing + offset;
}

/**
 * The muzzle-flash geometry for a shot leaving `turret` at `target` along `aim`
 * (GDD §2.6, §4.1). Origin is the barrel tip — where the projectile is born, so
 * the flash sits on the muzzle — and the segment runs to the tracked ship's
 * near surface, clamped to what it is aimed at. This is the *tell*, not the hit
 * test: the projectile does the damage and can still miss a dodging ship; the
 * flash only reports that the turret fired and where it aimed, which is all a
 * renderer needs to make enemy turrets visibly shoot. Allocates only on fire
 * ticks, like `spawnChunk` on a mine.
 */
function makeMuzzle(turret: Turret, target: Ship, aim: number): Muzzle {
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  const origin = { x: turret.pos.x + dx * turret.radius, y: turret.pos.y + dy * turret.radius };
  const centerDist = Math.sqrt(dist2(turret.pos, target.pos));
  // Barrel tip → target surface: total centre distance less both radii, floored
  // at zero for the degenerate point-blank case.
  const length = Math.max(0, centerDist - target.radius - turret.radius);
  return {
    origin,
    dir: { x: dx, y: dy },
    hitPoint: { x: origin.x + dx * length, y: origin.y + dy * length },
    length,
  };
}

// Ship and turret projectiles — firing, flight, collision and the pool — live in
// `./projectiles`, the single system both shooters share since the combat model
// became projectiles (design amendment v0.2). `updateTurrets` above calls
// `fireTurretProjectile`; `./step` runs `updateProjectiles` and the ship weapon.
