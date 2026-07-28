/**
 * src/sim/buildings.ts — the station economy. OWNER: Gameplay Engineer.
 *
 * Everything the Build & Upgrade wheel spends on and everything a station does
 * with it (GDD §2.5, §2.6):
 *
 *  - **Orders** — TURRET (3), SHIELD (5), REPAIR CORE, BANK. Validated by the
 *    sim, never trusted from the sender: own station, docked, alive, affordable,
 *    under cap. Ore is spent the moment the order lands; construction is time.
 *  - **Construction timers** — a turret assembles over 10 s, a shield over 15,
 *    so defenses are bought *before* the attack, not during it (GDD §2.5).
 *  - **Shields** — a 40 HP bubble that stacks to two, regenerating 2 HP/s only
 *    after 8 undamaged seconds.
 *  - **Repair core** — a DISCRETE purchase (developer amendment, 2026-07-26,
 *    supersedes the GDD channel): one docked press spends `REPAIR_ORE_COST` ore
 *    and restores `REPAIR_HP_PER_ORE` core HP, clamped. No channel, no drain.
 *  - **Turrets** — auto-fire at enemy ships in range with pooled projectiles at
 *    a design DPS of 4.
 *  - **UPGRADE SHIP** — the fifth segment, and the only one that spends on the
 *    *ship* instead of the station (GDD §2.5). It lands here because the wheel and
 *    the panel behind its arrow are one purchase point at your own station, so a
 *    row press gets the same validation a wheel order does; the tier ladder and
 *    every stat it derives live in `./upgrades`.
 *
 * GDD §2.6's "pressure beats regeneration" now rides one field for shields only:
 * `station.sinceDamage`. A hit zeroes it, closing the shield-regen window — so a
 * defender cannot out-regen an attacker who keeps shooting, they have to drive
 * them off first. Repair no longer rides this field: it is a discrete ore-for-HP
 * purchase (below), so pressure beats it through the *finite ore pool*, not an
 * interrupt — every HP bought back is an upgrade or a turret not bought.
 *
 * Determinism (GDD §4.8): fixed iteration order (stations, then their turrets,
 * then the projectile pool), every rate `* dt`. The turret aim model's seeded
 * deviance (turret-lead field report v0.2.4) draws from a per-turret, per-tick
 * hash of the ratified mulberry32 (`turretAimError`) — deterministic, and
 * deliberately *not* the shared `world.rngState` stream, so a turret's spread
 * never perturbs wave spawning (`./waves`, the stream's only consumer).
 */

import type { Muzzle, PlayerId, BuildItem, UpgradeTrack, Vec2 } from '@shared/types';
import {
  DEPOSIT_RANGE,
  STATION,
  REPAIR_HP_PER_ORE,
  REPAIR_ORE_COST,
  REPAIR_TELL_HOLD,
  SHIELD,
  TURRET,
  TURRET_MAX_TIER,
  turretTierSpec,
} from './constants';
import { areEnemies } from './allegiance';
import { destroyCore, isCollapsed } from './match';
import { ledgerAdd } from './ore-ledger';
import { fireTurretProjectile, leadAim } from './projectiles';
import { advanceRng } from './rng';
import type { MiningStation, Ship, Shield, Turret, World } from './state';
import { applyPurchasedStats, nextUpgradeCost } from './upgrades';
import { dist2, turnToward } from './vec';

// ---------------------------------------------------------------------------
// Lookups and the ore wallet
// ---------------------------------------------------------------------------

/** A player's home station, or null if they have none (eliminated / no slot). */
export function stationOf(world: World, owner: PlayerId): MiningStation | null {
  for (const p of world.stations) {
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

/** True while a ship is close enough to its station to use the wheel
 *  (GDD §2.5: "opened at your own station"). Centre-to-centre. */
export function isDocked(ship: Ship, station: MiningStation): boolean {
  return ship.alive && dist2(ship.pos, station.pos) <= STATION.dockRange * STATION.dockRange;
}

/** True while a ship is inside a station's atmosphere — the `DEPOSIT_RANGE` halo
 *  within which its hold auto-deposits at its own living station (ratified p4:
 *  "just be in that atmosphere"). Centre-to-centre, boundary counting as inside.
 *  `DEPOSIT_RANGE > STATION.dockRange`, so a docked ship is always in-atmosphere.
 *  The caller checks ownership/liveness (see `updateDeposits`); the renderer
 *  draws the halo from the same `DEPOSIT_RANGE` this reads. */
export function inAtmosphere(ship: Ship, station: MiningStation): boolean {
  return ship.alive && dist2(ship.pos, station.pos) <= DEPOSIT_RANGE * DEPOSIT_RANGE;
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
export function spendOre(world: World, ship: Ship, cost: number): boolean {
  if (cost <= 0) return true;
  if (spendableOre(ship) + 1e-9 < cost) return false;
  const fromHold = Math.min(ship.cargo, cost);
  ship.cargo -= fromHold;
  ship.banked -= cost - fromHold;
  if (ship.cargo < 1e-9) ship.cargo = 0;
  if (ship.banked < 1e-9) ship.banked = 0;
  // Ore paid out of the economy for good — the one sink every purchase funnels
  // through, so the conservation ledger sees all spending in one place
  // (`./ore-ledger`).
  ledgerAdd(world, 'spent', cost);
  return true;
}

// ---------------------------------------------------------------------------
// Per-station caps (GDD §2.5 — "design rules, not renderer limits")
// ---------------------------------------------------------------------------

/** Turrets that exist or are being built — queued jobs count against the cap,
 *  so a player cannot buy their way past 4 by ordering them all at once. */
export function turretCount(station: MiningStation): number {
  let n = station.turrets.length;
  for (const b of station.builds) if (b.kind === 'turret') n++;
  return n;
}

/** Shields that exist or are being built (same rule as {@link turretCount}). */
export function shieldCount(station: MiningStation): number {
  let n = station.shields.length;
  for (const b of station.builds) if (b.kind === 'shield') n++;
  return n;
}

/** The lowest turret mount slot not held by a live turret or a queued job, or
 *  -1 when the ring is full. Slots are re-used, so a rebuilt turret fills the
 *  hole a dead one left instead of stacking on a survivor. */
function freeTurretSlot(station: MiningStation): number {
  for (let slot = 0; slot < TURRET.capPerStation; slot++) {
    let taken = false;
    for (const t of station.turrets) if (t.slot === slot) taken = true;
    for (const b of station.builds) if (b.kind === 'turret' && b.slot === slot) taken = true;
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
export function turretUpgradeTarget(station: MiningStation): Turret | null {
  let best: Turret | null = null;
  for (const t of station.turrets) {
    if (t.hp <= 0 || turretTier(t) >= TURRET_MAX_TIER) continue;
    const tt = turretTier(t);
    if (best === null || tt < turretTier(best) || (tt === turretTier(best) && t.slot < best.slot)) {
      best = t;
    }
  }
  return best;
}

/** Ore price of the next TURRET-wedge upgrade on a station — advancing its
 *  {@link turretUpgradeTarget} one Mk up — or `null` when nothing can be
 *  upgraded. The UI prices the wedge's upgrade state from this. */
export function turretUpgradeCost(station: MiningStation): number | null {
  const target = turretUpgradeTarget(station);
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

/** The rim angle a turret in `slot` mounts at: the station's outward angle plus
 *  an even share of the ring, so slot 0 always starts facing away from the
 *  field. This is the turret's *home* orbit angle — where it is born and where
 *  it slides back to when nothing is in range (field report P1). */
export function turretHomeAngle(station: MiningStation, slot: number): number {
  return station.angle + (2 * Math.PI * slot) / TURRET.capPerStation;
}

/** The world position of a point at rim angle `angle` around a station — the
 *  turret's surface-ring orbit at that angle. A turret slides its `orbitAngle`
 *  and its `pos` is this, recomputed every tick. */
export function turretOrbitPos(station: MiningStation, angle: number): { x: number; y: number } {
  const r = station.radius + TURRET.mountOffset + TURRET.radius;
  return { x: station.pos.x + Math.cos(angle) * r, y: station.pos.y + Math.sin(angle) * r };
}

/** Where a turret in `slot` sits at rest: on the station's surface ring, at its
 *  mount-slot home angle. The build-spot position, and the orbit position of a
 *  turret whose `orbitAngle` still equals its home angle. */
export function turretMountPos(station: MiningStation, slot: number): { x: number; y: number } {
  return turretOrbitPos(station, turretHomeAngle(station, slot));
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
  | 'no-station'
  | 'station-dead'
  | 'not-docked'
  | 'cap-reached'
  | 'cannot-afford'
  | 'core-full'
  | 'nothing-to-bank'
  /** Repair only: the collapse phase has shut it off for good (GDD §2.3). */
  | 'collapsed';

/** Ore cost of a wheel segment. Repair is now a flat 1-ore purchase; bank is
 *  free (it moves ore, never spends it). */
export function orderCost(item: BuildItem): number {
  switch (item) {
    case 'turret':
      return TURRET.cost;
    case 'shield':
      return SHIELD.cost;
    case 'repair':
      return REPAIR_ORE_COST;
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
  const station = stationOf(world, ship.id);
  if (!station) return 'no-station';
  if (!station.alive) return 'station-dead';
  if (!isDocked(ship, station)) return 'not-docked';

  switch (item) {
    case 'bank': {
      if (ship.cargo <= 1e-9) return 'nothing-to-bank';
      // Hold → bank, all at once (the dock-bank order, vs the atmosphere drain).
      // A transfer within the live economy — recorded for the ledger.
      ledgerAdd(world, 'deposited', ship.cargo);
      ship.banked += ship.cargo;
      ship.cargo = 0;
      return 'ok';
    }
    case 'repair': {
      // Collapse shuts repair off entirely (GDD §2.3): from here on, damage to a
      // core is permanent and the only defence left is the ship in front of it.
      if (isCollapsed(world)) return 'collapsed';
      if (station.coreHp >= station.maxCoreHp - 1e-9) return 'core-full';
      // ONE press = ONE purchase (developer, 2026-07-26, supersedes the GDD
      // channel): spend REPAIR_ORE_COST and restore REPAIR_HP_PER_ORE, clamped.
      // No channel, no drain — the affordability check is `spendOre`, so N taps
      // are N independent, individually-checked spends. An empty/short bank is
      // refused loudly, spending nothing (`spendOre` charges only on success).
      if (!spendOre(world, ship, REPAIR_ORE_COST)) return 'cannot-afford';
      // A core missing less than REPAIR_HP_PER_ORE still costs the full ore and
      // heals to full — the wheel SHOWS the real number, so the choice is
      // informed (p5-08). `repairing` is the repair TELL, lit here and held for
      // `REPAIR_TELL_HOLD` seconds (see `maintainRepairTell`): the renderer glows
      // on it and an AI defender paces its next order off it, but it drains
      // nothing and heals nothing beyond this one purchase. It does NOT gate this
      // call — a human taps as fast as they like, one purchase per tap.
      station.coreHp = Math.min(station.maxCoreHp, station.coreHp + REPAIR_HP_PER_ORE);
      station.repairing = true;
      station.repairCooldown = REPAIR_TELL_HOLD;
      return 'ok';
    }
    case 'turret': {
      const slot = freeTurretSlot(station);
      if (slot >= 0) {
        // A mount is free: BUILD a new Mk I turret. Construction takes time, so
        // the defense is bought before the attack, not during it (GDD §2.5).
        if (!spendOre(world, ship, TURRET.cost)) return 'cannot-afford';
        station.builds.push({
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
      const target = turretUpgradeTarget(station);
      if (target === null) return 'cap-reached'; // full ring, every turret maxed
      const cost = turretTierSpec(turretTier(target) + 1).upgradeCost;
      if (cost === null) return 'cap-reached';
      if (!spendOre(world, ship, cost)) return 'cannot-afford';
      applyTurretTier(target, turretTier(target) + 1);
      return 'ok';
    }
    case 'shield': {
      if (shieldCount(station) >= SHIELD.capPerStation) return 'cap-reached';
      if (!spendOre(world, ship, SHIELD.cost)) return 'cannot-afford';
      station.builds.push({
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
   *  live hull takes at its station, and a wreck between lives takes none (GDD
   *  §2.5, §2.7). The refusal is loud (not a misleading `not-docked`) so the
   *  upgrade screen can say "respawning" rather than "fly to your station". The
   *  order is refused, never queued — see the `!ship.alive` decision below. */
  | 'dead'
  | 'no-station'
  | 'station-dead'
  | 'not-docked'
  | 'cannot-afford'
  /** The ladder on that track is finished — there is no next tier to sell. */
  | 'maxed';

/**
 * Buy one tier on one track (GDD §2.5) — the press on a row of the upgrade
 * panel. Validated exactly like a wheel order and for the same reason: the wheel
 * and the panel are one purchase point, "opened at your own station", and the sim
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
 * `ship.id` — a stable {@link PlayerId} — keys the station lookup, and `ship.tiers`
 * is match-lifetime state the respawn path never clears (`./step` `respawn`). So a
 * purchase resolves the same before a death and after a respawn: the same wallet,
 * the same ladder, no reference to a "previous" hull, because the sim mutates one
 * ship in place across a life rather than replacing instances. A fresh track and
 * the next tier of a pre-death track are both buyable the instant the ship is back.
 *
 * The one life-state gate is `alive`: a dead ship (between lives) is refused
 * `'dead'` *before* the docking check, so the reason is the true one — you are a
 * wreck on the respawn clock, not merely out of dock range. The order is refused,
 * never queued: a purchase is a live action, and the ship reaches its station again
 * on respawn to buy for real (`isDocked` also short-circuits on `alive`, but the
 * explicit gate makes the documented precondition legible and refactor-proof).
 */
export function buyUpgrade(world: World, ship: Ship, track: UpgradeTrack): UpgradeResult {
  if (!ship.alive) return 'dead';
  const station = stationOf(world, ship.id);
  if (!station) return 'no-station';
  if (!station.alive) return 'station-dead';
  if (!isDocked(ship, station)) return 'not-docked';

  const cost = nextUpgradeCost(ship, track);
  if (cost === null) return 'maxed';
  if (!spendOre(world, ship, cost)) return 'cannot-afford';

  ship.tiers[track] += 1;
  applyPurchasedStats(ship);
  return 'ok';
}

// ---------------------------------------------------------------------------
// Per-tick: construction, shields, and the repair tell
// ---------------------------------------------------------------------------

/**
 * Advance every station one tick: spawn protection, the undamaged clock,
 * construction timers, shield regeneration, and the repair tell — in that
 * order, which is part of the determinism contract.
 *
 * Runs *before* this tick's orders (`placeOrder`, step 2b) and projectiles, so
 * damage dealt now takes effect on the next tick's regen decision, never
 * retroactively — and a repair purchase this tick lights `repairing` (step 2b,
 * after this pass) which then survives to the post-step snapshot.
 *
 * Under collapse, shield regen stops for the rest of the match (GDD §2.3) — the
 * phase is read once per tick, not per station, because it is a property of the
 * match rather than of anyone's home.
 */
export function updateStations(world: World, dt: number): void {
  const collapsed = isCollapsed(world);
  for (const station of world.stations) {
    if (!station.alive) continue;
    if (station.spawnProtect > 0) station.spawnProtect = Math.max(0, station.spawnProtect - dt);
    station.sinceDamage += dt;

    advanceConstruction(world, station, dt);
    // Collapse: shields stop regenerating (GDD §2.3). Construction still
    // finishes — the ore was already spent, and a turret half-built when the
    // field ran dry is the player's money, not entropy's.
    if (!collapsed) regenShields(station, dt);
    maintainRepairTell(world, station, collapsed, dt);
  }
}

/**
 * Keep the `repairing` tell honest. Repair is a DISCRETE purchase now (developer,
 * 2026-07-26) — the ore-and-HP move resolves in full inside `placeOrder`, so
 * there is NO channel to run here and NO ore drained. This pass only maintains
 * the boolean *tell* and its `repairCooldown`: a purchase lights the tell and
 * arms the cooldown, and this pass ticks the cooldown down and RELEASES the tell
 * when it hits zero.
 *
 * The cooldown is why the tell is held rather than pulsed for one tick: an AI
 * defender reads `!repairing` to decide when to buy its next repair, so holding
 * the tell for `REPAIR_TELL_HOLD` seconds paces a bot to one 15-HP purchase per
 * hold — the retired channel's ~2 HP/s cadence (`REPAIR_HP_PER_ORE / 2`) — rather
 * than 15 HP every tick. It is signalling only and spends nothing, so it is not
 * the "loop" the developer retired, and it never gates a human: `placeOrder` lets
 * a person tap as fast as they like, one purchase per tap.
 *
 * The tell also clears early — cooldown and all — when there is nothing to hold
 * for: the core is full, the owner has left or died, or collapse began.
 */
function maintainRepairTell(world: World, station: MiningStation, collapsed: boolean, dt: number): void {
  if (!station.repairing) return;

  const owner = shipOf(world, station.owner);
  if (
    collapsed ||
    station.coreHp >= station.maxCoreHp - 1e-9 ||
    !owner ||
    !owner.alive ||
    !isDocked(owner, station)
  ) {
    station.repairing = false;
    station.repairCooldown = 0;
    return;
  }

  station.repairCooldown = Math.max(0, (station.repairCooldown ?? 0) - dt);
  // Release the tell only once the pacing cooldown has elapsed AND the core has
  // been quiet for that long — so an AI defender resumes repairing only off the
  // firing line. While hits keep landing, `sinceDamage` stays low and the tell
  // holds, which is "pressure beats regeneration" for repair (GDD §2.6): you
  // drive the attacker off first, exactly as the retired channel demanded.
  if (station.repairCooldown <= 0 && station.sinceDamage >= REPAIR_TELL_HOLD) station.repairing = false;
}

/** Tick construction timers; a job that reaches zero becomes the real thing
 *  (GDD §2.5 — the ore was already spent when the order was placed). */
function advanceConstruction(world: World, station: MiningStation, dt: number): void {
  let completed = false;
  for (const job of station.builds) {
    job.remaining -= dt;
    if (job.remaining <= 0) {
      job.remaining = 0;
      completed = true;
      if (job.kind === 'turret') station.turrets.push(makeTurret(world, station, job.slot));
      else station.shields.push(makeShield(world));
    }
  }
  if (completed) station.builds = station.builds.filter((j) => j.remaining > 0);
}

function makeTurret(world: World, station: MiningStation, slot: number): Turret {
  const home = turretHomeAngle(station, slot);
  const pos = turretOrbitPos(station, home);
  // Built at Mk I. `turretTierSpec(0).hp` is `TURRET.hp` by construction, so a
  // fresh turret is byte-for-byte the pre-ladder turret — the upgrade path is
  // the only thing that ever moves it off tier 0.
  const spec = turretTierSpec(0);
  return {
    id: world.nextEntityId++,
    owner: station.owner,
    slot,
    pos: { x: pos.x, y: pos.y },
    radius: TURRET.radius,
    hp: spec.hp,
    maxHp: spec.hp,
    tier: 0,
    // Barrel starts pointing outward, away from the station it defends.
    angle: home,
    // Born on its mount slot; it slides from here toward the threat (field
    // report P1). Deriving `pos` from this keeps the two in lockstep.
    orbitAngle: home,
    cooldown: 0,
    targetId: null,
    // No committed lead yet — the first fire tick against a target solves it.
    aim: null,
    muzzle: null,
  };
}

function makeShield(world: World): Shield {
  return { id: world.nextEntityId++, hp: SHIELD.hp, maxHp: SHIELD.hp, radius: SHIELD.radius };
}

/** Shields recover only past `SHIELD.regenDelay` undamaged seconds — the
 *  regeneration half of GDD §2.6. Each generator regenerates its own pool. */
function regenShields(station: MiningStation, dt: number): void {
  if (station.sinceDamage < SHIELD.regenDelay) return;
  for (const shield of station.shields) {
    if (shield.hp >= shield.maxHp) continue;
    shield.hp = Math.min(shield.maxHp, shield.hp + SHIELD.regenPerSecond * dt);
  }
}

// Repair is no longer a per-tick channel — a purchase resolves in full inside
// `placeOrder` (spend 1 ore, add REPAIR_HP_PER_ORE, clamp), so there is nothing
// to advance here each tick (developer amendment, 2026-07-26).

// ---------------------------------------------------------------------------
// Damage routing — shields stand in front of the core
// ---------------------------------------------------------------------------

/** The radius an attacker's shot actually strikes: the shield bubble
 *  while any shield is up, the station body once they are all down. */
export function stationTargetRadius(station: MiningStation): number {
  for (const s of station.shields) {
    if (s.hp > 1e-9) return s.radius;
  }
  return station.radius;
}

/** Total shield HP standing over the core right now. */
export function shieldPool(station: MiningStation): number {
  let hp = 0;
  for (const s of station.shields) hp += s.hp;
  return hp;
}

/**
 * Apply `amount` damage to a station: shields first (in build order, one bubble
 * at a time), then the core. Spawn protection blocks it entirely (GDD §2.1).
 *
 * Any damage that lands zeroes `sinceDamage`, closing the shield-regen window
 * (GDD §2.6). That same clock also holds the repair *tell* down while a core is
 * under fire (see {@link maintainRepairTell}) — so "pressure beats regeneration"
 * covers repair too: a besieged defender can buy the odd emergency patch but
 * cannot keep repairing under fire, they have to drive the attacker off first.
 * The discrete heal already applied is never undone — there is no channel to
 * interrupt. Returns true if the hit landed.
 */
export function damageStation(world: World, station: MiningStation, amount: number): boolean {
  if (!station.alive || station.spawnProtect > 0 || amount <= 0) return false;

  let left = amount;
  for (const shield of station.shields) {
    if (left <= 0) break;
    if (shield.hp <= 0) continue;
    const absorbed = Math.min(shield.hp, left);
    shield.hp -= absorbed;
    left -= absorbed;
  }
  if (left > 0) station.coreHp -= left;

  station.sinceDamage = 0;

  if (station.coreHp <= 0) destroyCore(world, station);
  return true;
}

/**
 * Apply `amount` damage to a turret. A turret at zero HP is *dead but still in
 * the array* until {@link sweepDeadTurrets} runs at the end of the tick: two
 * ships can be shooting the same station in one tick, and removing an entry
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
  for (const station of world.stations) {
    let dead = false;
    for (const t of station.turrets) if (t.hp <= 0) dead = true;
    if (dead) station.turrets = station.turrets.filter((t) => t.hp > 0);
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
  for (const station of world.stations) {
    if (!station.alive) continue;

    // 1. Resolve every turret's sticky target first, so the slide can fan
    //    turrets that share one target and the barrel aims at a settled pick.
    for (const turret of station.turrets) {
      if (turret.hp <= 0) continue; // killed this tick, swept at end of step
      // The muzzle tell is a per-tick event: assume not firing, and only the
      // branch that actually looses a shot below sets it. Cleared here so a
      // renderer never draws a stale flash a tick after the shot left.
      turret.muzzle = null;
      const target = acquireTarget(world, station, turret);
      turret.targetId = target ? target.id : null;
    }

    // 1b. Coverage split: never stack two turrets on one threat while another
    //     valid threat goes unengaged (field report P1, §4). A station-level pass
    //     because the split is a property of the *set* of turrets, not any one.
    splitThreats(world, station);

    // 2. Slide each turret along the rim toward its target's facing normal.
    slideTurrets(world, station, dt);

    // 3./4. Track the barrel and fire, from the position the slide left us at.
    for (const turret of station.turrets) {
      if (turret.hp <= 0) continue;
      if (turret.cooldown > 0) turret.cooldown = Math.max(0, turret.cooldown - dt);
      const target = turret.targetId !== null ? shipOf(world, turret.targetId) : null;
      if (!target) continue;

      const aim = turretAimBearing(world, turret, target);
      turret.angle = turnToward(turret.angle, aim, TURRET.turnRate * dt);

      if (turret.cooldown <= 0) {
        fireTurretProjectile(world, turret, aim);
        // Publish the muzzle flash from the same firing decision the projectile
        // rode out on, so the tell can never disagree with the shot (GDD §2.6).
        turret.muzzle = makeMuzzle(turret, aim);
        turret.cooldown = turretFireInterval(turret);
      }
    }
  }
}

/**
 * The bearing (radians) a turret fires at this tick — the lead-and-deviance aim
 * model (turret-lead field report v0.2.4). Two parts, both tier-scaled so a
 * higher Mk shoots straighter (upgrading a turret buys accuracy):
 *
 *  1. **Intercept lead.** Solve where the target *will be* with the shared
 *     {@link leadAim} — the one lead solver the sim's auto-aim and the bots also
 *     use, so no second solver can drift from it — using the committed (delayed)
 *     velocity, not the live one.
 *  2. **Deviance.** Add the committed seeded angular error.
 *
 * The commit ({@link Turret.aim}) is re-solved only every tier `aimLatency`
 * seconds, or the instant the target changes (a fresh threat is read at once).
 * Between re-solves the turret keeps the velocity and error it committed to, so a
 * target that curves or reverses inside the window is led where it *was* going
 * and the shot goes wide — the half of the model that lets a smart orbiter dodge
 * (mirrors the bot `trackAimVelocity`). Mutates `turret.aim`.
 */
function turretAimBearing(world: World, turret: Turret, target: Ship): number {
  const spec = turretTierSpec(turretTier(turret));
  const prev = turret.aim ?? null;
  const reacquired = prev === null || prev.targetId !== target.id;
  if (reacquired || world.time - prev.since >= spec.aimLatency) {
    turret.aim = {
      vel: { x: target.vel.x, y: target.vel.y },
      error: turretAimError(turret, world, spec.aimSpread),
      since: world.time,
      targetId: target.id,
    };
  }
  const commit = turret.aim!;
  const lead = leadAim(turret.pos, target.pos, commit.vel, TURRET.projectileSpeed);
  return Math.atan2(lead.y, lead.x) + commit.error;
}

/**
 * One seeded angular-error draw in `[-spread, +spread]` for this turret's aim
 * deviance (turret-lead field report v0.2.4). Deterministic and seeded from the
 * ratified mulberry32, but keyed on a per-turret, per-tick hash rather than the
 * shared `world.rngState` — so a turret's spread is reproducible for a given
 * match yet never advances (perturbs) the wave-spawn stream, the only consumer
 * of `world.rngState`. `Math.imul` keeps the mix in exact 32-bit integer math;
 * folding in `world.rngState` (read, never written) ties the spread to the match
 * seed so two seeds diverge, without touching the stream.
 */
function turretAimError(turret: Turret, world: World, spread: number): number {
  const seed = (Math.imul(turret.id, 0x9e3779b9) ^ Math.imul(world.tick, 0x85ebca6b) ^ world.rngState) >>> 0;
  return (advanceRng(seed).value * 2 - 1) * spread;
}

/**
 * The far edge of the ring a **sliding** turret can bring a shot onto: the orbit
 * radius plus `TURRET.range` (field report P1, §1). Threat detection is measured
 * from the *station centre*, not the turret's current rim spot — the whole point
 * of orbiting is to slide around and reach a far-side attacker, so a threat this
 * close to the core is engageable even when it sits outside firing range of where
 * the turret happens to be sitting *right now*. Once the turret slides to the
 * facing-normal point it has line of sight and closes to `range` (§2).
 */
export function stationThreatRadius(station: MiningStation): number {
  // The station's overall threat envelope is its *longest-reaching* live turret,
  // so a mixed-tier ring gathers every threat any of its turrets could engage
  // (the per-turret reach still gates each turret's own acquire — `acquireTarget`
  // — and the projectile's finite life caps where a shot actually lands). A ring
  // with nothing standing falls back to the Mk I base reach.
  let range: number = TURRET.range;
  for (const t of station.turrets) {
    if (t.hp > 0) range = Math.max(range, turretRange(t));
  }
  return station.radius + TURRET.mountOffset + TURRET.radius + range;
}

/** The reach of ONE sliding turret from its station's centre — the rim orbit
 *  radius plus this turret's own tier range. A sliding turret is engaged against
 *  a threat inside this even when the threat sits outside firing range of where
 *  it currently sits, because it slides to close the gap (field report P1). */
export function turretThreatRadius(station: MiningStation, turret: Turret): number {
  return station.radius + TURRET.mountOffset + TURRET.radius + turretRange(turret);
}

/**
 * True when `ship` is actively shooting this station — it owns a live weapon
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
function isAttackingStation(world: World, station: MiningStation, ship: Ship): boolean {
  const targetR = stationTargetRadius(station);
  for (const p of world.projectiles) {
    if (!p.active || p.owner !== ship.id || p.kind !== 'ship') continue;
    const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y);
    if (speed < 1e-9) continue;
    const dir = { x: p.vel.x / speed, y: p.vel.y / speed };
    // How far the shot can still travel before it despawns — its remaining reach.
    if (segmentHitsCircle(p.pos, dir, speed * p.life, station.pos, targetR)) return true;
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
 * rule (field report P1, §2), now scanned from the station so far-side threats
 * are visible (§1) and ranked so a core-attacker outranks a loiterer (§3).
 *
 * Detection is station-centric for a sliding turret — a threat inside
 * `stationThreatRadius` is a valid target even outside firing range of the turret's
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
function acquireTarget(world: World, station: MiningStation, turret: Turret): Ship | null {
  // A sliding turret measures threats from the station centre; a fixed one (no
  // `orbitAngle`) from itself, since it cannot slide to close the gap.
  const sliding = turret.orbitAngle !== undefined;
  const ref = sliding ? station.pos : turret.pos;
  // Reach is this turret's own tier range (GDD §2.6): a sliding turret measures
  // it from the station centre (it slides to close), a fixed one from itself.
  const reach = sliding ? turretThreatRadius(station, turret) : turretRange(turret);
  const reach2 = reach * reach;

  // Best valid enemy this tick — attacker-first, then nearest — the switch
  // candidate against the sticky current pick below.
  let best: Ship | null = null;
  let bestAtk = false;
  let bestD2 = Infinity;
  for (const ship of world.ships) {
    if (!ship.alive || !areEnemies(world, station.owner, ship.id) || ship.spawnProtect > 0) continue;
    const d2 = dist2(ref, ship.pos);
    if (d2 > reach2) continue;
    const atk = isAttackingStation(world, station, ship);
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
    areEnemies(world, station.owner, current.id) &&
    current.spawnProtect <= 0 &&
    dist2(ref, current.pos) <= reach2;

  if (!currentValid) return best;
  if (best === null || best.id === current!.id) return current;

  // Priority class trumps distance and hysteresis: switch to an attacker over a
  // loiterer at once, and never abandon an attacker for a merely-closer loiterer.
  const curAtk = isAttackingStation(world, station, current!);
  if (bestAtk !== curAtk) return bestAtk ? best : current;

  // Same class: only defect if the newcomer is meaningfully closer, i.e. within
  // `hysteresis ×` the current target's distance.
  const currentD2 = dist2(ref, current!.pos);
  const h = TURRET.targetHysteresis;
  return bestD2 <= currentD2 * h * h ? best : current;
}

/**
 * Split a station's turrets across distinct threats (field report P1, §4). After
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
function splitThreats(world: World, station: MiningStation): void {
  const turrets = station.turrets;
  const reach2 = stationThreatRadius(station) ** 2;

  const threats: Ship[] = [];
  for (const ship of world.ships) {
    if (!ship.alive || !areEnemies(world, station.owner, ship.id) || ship.spawnProtect > 0) continue;
    if (dist2(station.pos, ship.pos) <= reach2) threats.push(ship);
  }
  if (threats.length < 2) return; // nothing to spread across

  // At most one move per uncovered threat, and each move covers one, so the
  // turret count bounds the passes.
  for (let pass = 0; pass < turrets.length; pass++) {
    let moved = false;
    for (const recip of threats) {
      if (coverCount(turrets, recip.id) > 0) continue; // already engaged

      const bearing = Math.atan2(recip.pos.y - station.pos.y, recip.pos.x - station.pos.x);
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
 * Slide each of a station's turrets one tick toward the rim point whose outward
 * surface normal faces its target (field report P1). The desired rim angle is
 * simply the bearing from the station centre to the target — which does *not*
 * depend on where the turret currently sits, so `turnToward` converges and then
 * halts, a glide with no orbiting. Turrets sharing one target fan out around
 * that bearing so they never stack (§3); a turret with no target drifts back to
 * its mount-slot home angle.
 *
 * Only turrets carrying an `orbitAngle` slide — a hand-built fixture without one
 * keeps its authoritative `pos` (see the field's doc). Zero per-frame allocation:
 * `pos` is written in place (GDD §4.3).
 */
function slideTurrets(world: World, station: MiningStation, dt: number): void {
  const turrets = station.turrets;
  const maxStep = TURRET.orbitSpeed * dt;
  const r = station.radius + TURRET.mountOffset + TURRET.radius;
  for (let i = 0; i < turrets.length; i++) {
    const turret = turrets[i]!;
    if (turret.hp <= 0 || turret.orbitAngle === undefined) continue;
    const desired = desiredOrbitAngle(world, station, turrets, i);
    turret.orbitAngle = turnToward(turret.orbitAngle, desired, maxStep);
    turret.pos.x = station.pos.x + Math.cos(turret.orbitAngle) * r;
    turret.pos.y = station.pos.y + Math.sin(turret.orbitAngle) * r;
  }
}

/**
 * The rim angle turret `i` wants this tick. With a target it is the bearing from
 * the station centre to that ship, plus a symmetric fan offset so turrets sharing
 * the target spread apart instead of stacking (`TURRET.orbitSeparation`, §3).
 * With no target it is the turret's mount-slot home angle. Fan rank is keyed on
 * `slot` (a stable per-turret key), so the spread is deterministic (GDD §4.8).
 */
function desiredOrbitAngle(world: World, station: MiningStation, turrets: Turret[], i: number): number {
  const turret = turrets[i]!;
  if (turret.targetId === null) return turretHomeAngle(station, turret.slot);
  const target = shipOf(world, turret.targetId);
  if (target === null) return turretHomeAngle(station, turret.slot);

  const bearing = Math.atan2(target.pos.y - station.pos.y, target.pos.x - station.pos.x);

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
 * The muzzle-flash geometry for a shot leaving `turret` along `aim` (GDD §2.6,
 * §4.1). A muzzle flash is a FLASH at the barrel — a short flare off the muzzle
 * tip — **never a line to the target**. The turret's damage rides a pooled
 * projectile (design amendment v0.3, the laser retired); this record is only the
 * fire *tell*, so a renderer draws a burst at the muzzle to make enemy turrets
 * visibly shoot. It does not reach the ship and carries no impact point: the
 * projectile owns the shot and its impact.
 *
 * Regression fix (v0.2.2 field report "turrets still flash a mining laser at
 * me"): the flare used to run the full barrel-tip → target-surface distance,
 * with `hitPoint` out at the ship — beam-era geometry the renderer stroked as a
 * line all the way to you. Now `length` is the short `TURRET.muzzleFlashLength`
 * flare and `hitPoint` is `null`, so no primitive is drawn between turret and
 * target. Allocates only on fire ticks, like `spawnChunk` on a mine.
 */
function makeMuzzle(turret: Turret, aim: number): Muzzle {
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  const origin = { x: turret.pos.x + dx * turret.radius, y: turret.pos.y + dy * turret.radius };
  return {
    origin,
    dir: { x: dx, y: dy },
    hitPoint: null, // the projectile owns impact — no glow out at the target
    length: TURRET.muzzleFlashLength, // a flare off the muzzle, not a beam to the ship
  };
}

// Ship and turret projectiles — firing, flight, collision and the pool — live in
// `./projectiles`, the single system both shooters share since the combat model
// became projectiles (design amendment v0.2). `updateTurrets` above calls
// `fireTurretProjectile`; `./step` runs `updateProjectiles` and the ship weapon.
