/**
 * src/sim/constants.ts — the baseline constants table. OWNER: Gameplay Engineer.
 *
 * This is the ENTIRE GDD §2.8 table (plus the §2.11 ship-class stats, the §2.5
 * ship-upgrade ladder, and the derived physics constants the sim needs to move a
 * ship), written out on day 1
 * so design numbers are typed, not invented, and so QA has a hypothesis to
 * falsify (GDD §2.8: "starting values, not commitments").
 *
 * **Every value here is `TUNABLE`** — annotated inline with the `TUNABLE` marker
 * so a grep finds the whole tuning surface. From day 2 onward QA owns this file
 * (GDD §2.8); the Gameplay Engineer hands it over intact.
 *
 * Units: distance is world units, time is seconds, angles are radians. Rates
 * are per second and always multiplied by `dt` in the sim — never assume a tick
 * length here.
 */

import { ShipClass, UpgradeTrack } from '@shared/types';

/** Marks a value as a day-1 hypothesis QA may retune (GDD §2.8). Documentation
 *  only — it is the literal string every tunable constant is tagged with so the
 *  tuning surface is greppable. */
export type Tunable<T> = T;

// ---------------------------------------------------------------------------
// The simulation clock
// ---------------------------------------------------------------------------

/**
 * Fixed simulation timestep — 60 Hz, the one true tick (GDD §4.1). The sim is
 * dt-parametric (every rate is `* dt`), but this is the canonical value the
 * loop, the server, and the QA harness all step at. Mirrors
 * `@platform/loop`'s `FIXED_DT`; kept here so the sim is self-contained.
 * TUNABLE
 */
export const TICK_DT: Tunable<number> = 1 / 60;

// ---------------------------------------------------------------------------
// GDD §2.8 — Baseline constants (the table, verbatim)
// ---------------------------------------------------------------------------

/** Core HP. Naked-core kill time = 100 ÷ 5 ≈ 20 s of sustained fire. TUNABLE */
export const CORE_HP: Tunable<number> = 100;

/** Weapon-vs-core DPS — the constant the whole match balances on (GDD §2.8).
 *  This is the Vanguard baseline; a class's actual core DPS scales by its power
 *  stat (see `classCoreDps`). TUNABLE */
export const WEAPON_DPS_CORE: Tunable<number> = 5;

/** Weapon-vs-ships/turrets DPS, Vanguard baseline (GDD §2.8). A class's actual
 *  weapon DPS is its power stat directly (Vanguard power = 10). TUNABLE */
export const WEAPON_DPS_SHIP: Tunable<number> = 10;

/** Mining rate: ore per second of fire-on-asteroid, Vanguard baseline
 *  (GDD §2.8). Scales by power stat for other classes (see `miningRate`). The
 *  day-1 test pins the Vanguard at exactly this. TUNABLE */
export const MINING_RATE: Tunable<number> = 0.5;

/** Ship hull, base (Vanguard); per-class values live in `SHIP_STATS`. Upgradable
 *  (GDD §2.5). TUNABLE */
export const SHIP_HULL: Tunable<number> = 50;

/** Starting ore — one meaningful opening choice (GDD §2.1, §2.8). TUNABLE */
export const STARTING_ORE: Tunable<number> = 3;

/** Spawn protection on ship and core at match start (GDD §2.1, §2.8), seconds. TUNABLE */
export const SPAWN_PROTECTION_S: Tunable<number> = 10;

/** Cargo hold, base slots (GDD §2.8). Class overrides in `SHIP_STATS`. TUNABLE */
export const CARGO_BASE: Tunable<number> = 2;

/** Cargo added per upgrade tier (GDD §2.5, §2.8). TUNABLE */
export const CARGO_PER_TIER: Tunable<number> = 2;

/** Cargo hold hard cap across all upgrades (GDD §2.8). TUNABLE */
export const CARGO_CAP_MAX: Tunable<number> = 8;

/** Turret (GDD §2.8): cost · HP · DPS · build time (s) · per-planet cap, plus
 *  the geometry and rate of fire the sim needs to actually shoot. `dps` stays
 *  the single balance number: per-shot damage is *derived* (`dps *
 *  fireInterval`), so retuning DPS retunes the turret and nothing else drifts.
 *  TUNABLE */
export const TURRET = {
  cost: 3,
  hp: 30,
  dps: 4,
  buildTime: 10,
  capPerPlanet: 4,
  /** Engagement radius (world units). Deliberately *under* `WEAPON_RANGE` (260):
   *  GDD §2.6 — "a patient attacker can pick off turrets from the edge of their
   *  range." That only exists as a skill if the ship out-ranges the turret. */
  range: 240,
  /** Seconds between shots. Per-shot damage = `dps * fireInterval` = 2. */
  fireInterval: 0.5,
  /** Projectile muzzle speed (units/s) — fast enough that lead is small at
   *  `range`, slow enough that a fast ship can outrun a stale shot. */
  projectileSpeed: 700,
  /** Turret collision radius (it is a shot target — GDD §2.6 "turrets deter"). */
  radius: 12,
  /** Mount height above the planet surface; turret slots ring the planet. */
  mountOffset: 12,
  /** Rotation rate (rad/s) tracking its target — the "telegraph its threat while
   *  spinning" read (style-guide §5.5). Aim never gates the shot; DPS is DPS. */
  turnRate: 3.0,
  /**
   * How fast a turret *slides around its planet's rim* toward the point whose
   * outward surface normal faces its target (field report P1). This is the whole
   * turret moving, not just the barrel (`turnRate`), so it is deliberately slower:
   * the turret **glides**, it never teleports. Because the target bearing is
   * measured from the planet centre it does not depend on where the turret
   * currently sits, so `turnToward` converges monotonically and then *stops* —
   * the cap is what guarantees a glide with no oscillation (rad/s). TUNABLE
   */
  orbitSpeed: 1.2,
  /**
   * Minimum angular gap held between two turrets sliding toward the *same* target
   * so they fan out around its facing-normal instead of stacking on one rim point
   * (field report P1, §3). Turrets sharing a target are spread symmetrically about
   * the bearing in steps of this size (radians). TUNABLE
   */
  orbitSeparation: 0.42,
  /**
   * Target stickiness (field report P1, §2). A turret keeps its current target
   * until it dies, leaves range, or another enemy is closer by this factor — a
   * newcomer must be within `hysteresis ×` the current target's distance (≈25%
   * closer at 0.75) before the turret will switch, so equidistant enemies never
   * make it flap. Unitless, in (0, 1]. TUNABLE
   */
  targetHysteresis: 0.75,
  /**
   * Length (world units) of the muzzle *flash* — a short flare off the barrel
   * tip, NOT a line to the target. Since the laser retired to a projectile
   * (design amendment v0.3) a turret's shot is the pooled projectile; the
   * muzzle record is only the fire *tell*, a burst at the muzzle. This stub is
   * kept short — a flare, not a beam — so a renderer never strokes a line
   * reaching the ship it fired at (v0.2.2 field report: "turrets still flash a
   * mining laser at me"). A hair past the barrel radius so the flare clears the
   * mount. TUNABLE
   */
  muzzleFlashLength: 16,
} as const;

/** Turret projectile (GDD §4.1 "pooled projectiles, same circle test"). TUNABLE */
export const PROJECTILE = {
  /** Damage per shot — derived from the turret's design DPS, never typed twice. */
  damage: TURRET.dps * TURRET.fireInterval,
  /** Collision radius (world units). */
  radius: 4,
  /** Seconds a shot lives before it despawns — exactly its flight time to the
   *  edge of turret range, so a turret can never out-reach its own engagement. */
  life: TURRET.range / TURRET.projectileSpeed,
} as const;

/**
 * The **turret tier ladder** (parity field report v0.2.2). The enemy fields
 * turrets; so can the player — and once a turret stands, the player can make it
 * *better* (GDD §2.5 "built at your own planet", §2.6 "turrets deter"). Each
 * `Mk` is a fuller combat profile than the last: tankier (`hp`), harder-hitting
 * (`dps`, and so per-shot `dps × fireInterval`), faster (`fireInterval`), and
 * with a touch more reach (`range`).
 *
 * **Mk I is the baseline turret, byte-for-byte** — it reads the shipped `TURRET`
 * values, so a freshly built (tier-0) turret behaves *exactly* as it did before
 * this ladder existed and every pre-tier turret test is unchanged. Higher tiers
 * are the buyable steps.
 *
 * The one balance rail the ladder must not break: GDD §2.6's pick-off skill —
 * "a patient attacker can pick off turrets from the edge of their range … only
 * exists as a skill if the ship out-ranges the turret." So **every tier's
 * `range` stays under `WEAPON_RANGE` (260)**; the top Mk (250) still leaves a
 * 10-unit band a ship can shoot from and the turret cannot answer, the same
 * skill expression Mk I's 20-unit band gives. Everything here is `TUNABLE` and
 * owned by QA from M2 on (GDD §2.8); a balance pass may widen or flatten the
 * ladder, but the range rail is a design invariant, not a tuning knob.
 *
 * `upgradeCost` is the ore price of advancing *into* this tier from the one below
 * — `null` for Mk I, which is *built* (`TURRET.cost`), never upgraded into.
 * `label` is the art agent's key for a distinct visual tell per tier (its
 * follow-up); the sim only needs it to be a stable per-tier name.
 */
export interface TurretTierSpec {
  /** Standing HP at this tier — the shot target's toughness (GDD §2.6). */
  readonly hp: number;
  /** Design DPS at this tier; per-shot damage is derived (`dps × fireInterval`),
   *  so `dps` stays the single balance number exactly as on the base `TURRET`. */
  readonly dps: number;
  /** Engagement radius — strictly under `WEAPON_RANGE` at every tier (see doc). */
  readonly range: number;
  /** Seconds between shots. Per-shot damage = `dps × fireInterval`. */
  readonly fireInterval: number;
  /** Ore to step into this tier from the one below; `null` for the built base. */
  readonly upgradeCost: number | null;
  /** Stable per-tier name — the art agent's key for a distinct tell. */
  readonly label: string;
}

/**
 * The ladder itself: index `i` is tier `i`, Mk `i+1`. Mk I mirrors `TURRET`
 * (built, `upgradeCost: null`); Mk II and Mk III are the buyable steps. The
 * whole climb of one turret costs `4 + 7 = 11` ore on top of its `3` to build —
 * so a fully-Mk III ring of four is `4 × 14 = 56` ore, most of a player's share
 * of the field (GDD §2.8 ~400 ⁄ 8 ≈ 50), which is the point: a turtle spends the
 * stockpile that collapse then takes (GDD §2.6 "the economy is the siege engine
 * of last resort"). All `TUNABLE`. TUNABLE
 */
export const TURRET_TIERS: readonly TurretTierSpec[] = [
  { hp: TURRET.hp, dps: TURRET.dps, range: TURRET.range, fireInterval: TURRET.fireInterval, upgradeCost: null, label: 'Mk I' },
  { hp: 45, dps: 6, range: 245, fireInterval: 0.45, upgradeCost: 4, label: 'Mk II' },
  { hp: 60, dps: 8, range: 250, fireInterval: 0.4, upgradeCost: 7, label: 'Mk III' },
] as const;

/** Highest turret tier index — the top of the ladder (`Mk III` at length-1). */
export const TURRET_MAX_TIER: number = TURRET_TIERS.length - 1;

/** The tier spec for a tier index, clamped into the ladder — the sim never
 *  trusts a tier it did not write, mirroring `tierOf` for ship upgrades. A
 *  turret with no/`NaN`/out-of-range tier reads as Mk I (tier 0). */
export function turretTierSpec(tier: number): TurretTierSpec {
  if (!Number.isFinite(tier)) return TURRET_TIERS[0]!;
  const i = Math.max(0, Math.min(Math.floor(tier), TURRET_MAX_TIER));
  return TURRET_TIERS[i]!;
}

/** Per-shot turret damage at a tier — `dps × fireInterval`, derived exactly like
 *  `PROJECTILE.damage` derives the Mk I value, so retuning a tier's `dps`
 *  retunes its bite and nothing drifts. */
export function turretTierShotDamage(tier: number): number {
  const s = turretTierSpec(tier);
  return s.dps * s.fireInterval;
}

/**
 * Ship weapon — **everything a ship does with its trigger is a projectile now**
 * (design amendments v0.2 and v0.3, `docs/design-amendments.md`). v0.2 moved
 * ship-vs-ship / ship-vs-structure combat off hitscan; v0.3 finished the job by
 * retiring the mining laser too, so a rock is chipped by the same shot that bites
 * a hull. The reason is the developer's: "It's too easy right now to kill each
 * other and there's no way to dodge. If we switch to a projectile there's a chance
 * to dodge and it becomes a lot funner." Travel time is the mechanic — a ship at
 * combat range strafing at full speed can evade a shot, pinned by a test
 * (`projectiles.test.ts`).
 *
 * "One weapon, one stat" survives the split: per-shot damage is still the power
 * stat (`shipWeaponDamage` = `shipWeaponDps × fireInterval`) and mining still
 * scales off the same power, so mining speed and weapon damage move together
 * exactly as GDD §2.5 requires. What changed is only that the weapon's damage is
 * *delivered* by a pooled projectile that can miss, not by an instant ray that
 * cannot. TUNABLE
 */
export const SHIP_WEAPON = {
  /** Seconds between shots while fire is held. Base weapon DPS (if every shot
   *  lands) equals the pre-projectile DPS: per-shot damage = `shipWeaponDps ×
   *  fireInterval`, so a stock Vanguard still deals `WEAPON_DPS_SHIP` = 10 to a
   *  target it never lets dodge. Missing is the new skill floor. */
  fireInterval: 0.35,
  /**
   * Base muzzle speed (world units/s) at power tier 0 — the design's "chance to
   * dodge" lives in this number against `BASE_SPEED`. At 520 a shot crosses the
   * 260-unit combat range in 0.5 s, in which a Vanguard strafing at full speed
   * (260 u/s) slides ~130 u sideways — far past a ship+shot radius, so the dodge
   * is real (`projectiles.test.ts`). Fast enough that a committed attacker who
   * closes the range still lands hits; slow enough that a fast ship outruns a
   * stale shot. Scaled up by the dedicated SPEED upgrade track
   * (`SHOT_SPEED_STEPS`, read through `shipProjectileSpeed`) — "add upgrades to
   * make them faster, stronger" split into its two ratified tracks: SPEED buys
   * this velocity, DAMAGE buys the bite (v0.2.2 field report). TUNABLE
   */
  projectileSpeed: 520,
  /** How far a base shot travels before it despawns (world units) — the ship's
   *  effective weapon reach, a touch past `WEAPON_RANGE` so the projectile weapon
   *  is not shorter-ranged than the hitscan it replaced. Lifetime is
   *  `range / speed`, and scales with muzzle speed so a faster shot reaches the
   *  same distance (`shipProjectileLife`). */
  range: 300,
  /** Collision radius (world units) — a hair larger than a turret shot so the
   *  ship weapon reads as the heavier gun. */
  radius: 5,
} as const;

/**
 * SPEED upgrade track — projectile muzzle-velocity multipliers over
 * `SHIP_WEAPON.projectileSpeed`, one per tier (`steps[0]` = 1 = stock). The
 * developer's ratified example: **base → +15% → +30%** (v0.2.2 field report,
 * "upgrades to make them faster"). A faster shot is a shot that is harder to
 * dodge, which is the whole counterplay economy the projectile switch created:
 * DAMAGE makes a shot bite harder *if* it lands, SPEED makes it land more often.
 * Only the upgrade multiplier, never the class base — so every hull's stock shot
 * shares the same dodgeable base velocity and this track alone buys "harder to
 * dodge" (class identity stays in DAMAGE, not velocity). These are the named
 * tunables `UPGRADES[UpgradeTrack.Speed].steps` reads from. TUNABLE
 */
export const SHOT_SPEED_STEPS: readonly Tunable<number>[] = [1, 1.15, 1.3];

/**
 * SPEED tier costs — the ore price of each muzzle-velocity step. Deliberately a
 * **tier above DAMAGE** at every rung (DAMAGE costs `[4, 8, 14]`; SPEED starts
 * where DAMAGE's *second* tier does): speed is the stronger buy, because a faster
 * shot beats a stronger one — it lands the DAMAGE you already have more often
 * instead of adding damage to shots that miss. Pricing it up a rung keeps "raw
 * damage first, then learn to make it connect" the natural climb and stops SPEED
 * from being a strictly-dominant first purchase. `costs.length` is
 * `SHOT_SPEED_STEPS.length - 1` (two buyable tiers). TUNABLE
 */
export const SHOT_SPEED_COSTS: readonly Tunable<number>[] = [8, 14];

/**
 * How much of a projectile's ship-damage a shield or core actually takes — the
 * core:ship ratio (`WEAPON_DPS_CORE / WEAPON_DPS_SHIP` = 5:10) the hitscan weapon
 * already applied (`shipCoreDps`). A projectile carries one `damage` number (its
 * ship/turret value); this scales it down when it lands on a shield or a core,
 * so a stock Vanguard shot deals `WEAPON_DPS_SHIP × fireInterval` to a hull and
 * `WEAPON_DPS_CORE × fireInterval` to a core — the §2.8 balance, unchanged by the
 * switch to projectiles. TUNABLE
 */
export const PROJECTILE_CORE_FACTOR: Tunable<number> = WEAPON_DPS_CORE / WEAPON_DPS_SHIP;

/**
 * Ore chipped from an asteroid by ONE weapon projectile that strikes it —
 * **mining is shooting now** (ratified amendment v0.3, `docs/design-amendments.md`:
 * "the mining laser should go away, it should be a projectile as well"). The
 * segment-vs-circle mining laser is gone; a projectile hit chips ore chunks, and
 * the tractor rules (GDD §2.3) are unchanged — only the way a rock is chipped did.
 *
 * This is the Vanguard baseline; a class's actual per-hit yield scales by its
 * power stat (`shipMineYield`), exactly as the old continuous mining rate did —
 * one weapon, one stat (GDD §2.5).
 *
 * Sized so a ship holding fire at the mining face extracts ore at the SAME rate
 * the old laser did. Shots land one `SHIP_WEAPON.fireInterval` apart (the weapon
 * is a pipeline — travel time is a one-off latency, not a rate cap), so ore per
 * second at contact = yield ⁄ fireInterval = `MINING_RATE`. It is *derived* from
 * the two constants it balances between rather than typed loose, so a retune of
 * either keeps the per-hit chip and the continuous rate it targets in lockstep,
 * and total-ore-per-asteroid stays exactly as ratified (each chip draws down the
 * rock's finite `ore`). TUNABLE
 */
export const MINING_YIELD_PER_HIT: Tunable<number> = MINING_RATE * SHIP_WEAPON.fireInterval;

/** Shield generator (GDD §2.8): cost · HP · regen/s · regen delay after last
 *  hit (s) · build time (s) · per-planet cap. Regenerates only after
 *  `regenDelay` undamaged seconds (GDD §2.6 "pressure beats regeneration"). TUNABLE */
export const SHIELD = {
  cost: 5,
  hp: 40,
  regenPerSecond: 2,
  regenDelay: 8,
  buildTime: 15,
  capPerPlanet: 2,
  /** Bubble radius over the core; sensor range is defined as 2× this. TUNABLE */
  radius: 90,
} as const;

/**
 * Repair core — a DISCRETE purchase (developer, 2026-07-26; supersedes the
 * GDD §2.5 channel — see docs/design-amendments.md). One wheel press = one
 * purchase: spend `REPAIR_ORE_COST` ore, restore `REPAIR_HP_PER_ORE` core HP,
 * clamped at the core max. Planet core only, never the ship. No channel, no
 * continuous drain, no stacking — N taps are N independent, individually
 * affordable-checked purchases. A core missing less than `REPAIR_HP_PER_ORE`
 * still costs the full ore and heals to full (the wheel SHOWS the real number,
 * so the choice is informed — p5-08). TUNABLE.
 */
export const REPAIR_HP_PER_ORE: Tunable<number> = 15;
/** Ore spent per repair purchase — the "bare 1 under REPAIR CORE" (GDD §2.5),
 *  now the whole price of one tap rather than a channel's opening unit. TUNABLE */
export const REPAIR_ORE_COST: Tunable<number> = 1;
/**
 * How long (seconds) the `repairing` *tell* holds after a repair purchase before
 * it releases (`maintainRepairTell`). It does NOT gate a human — `placeOrder`
 * always lets a tap buy a discrete repair, so "5 taps = 5 purchases" holds — it
 * only PACES an AI defender, which reads `!repairing` to decide when to buy its
 * next repair. Set to `REPAIR_HP_PER_ORE / 2` so a bot files one 15-HP purchase
 * per hold, i.e. the ~2 HP/s cadence of the retired repair channel — holding bot
 * repair economics (and the collapse-phase balance that hangs off them) steady
 * across the discrete-repair amendment. TUNABLE.
 */
export const REPAIR_TELL_HOLD: Tunable<number> = REPAIR_HP_PER_ORE / 2;

/**
 * Default arena side length (world units). The bounds are a square this big
 * unless `WorldConfig.bounds` overrides them (the QA harness runs cramped
 * worlds on purpose). Grown from the v0.1 1920 (field report P1: at 1920 the
 * 8-planet ring sat hard against the wall) to give the ring generous breathing
 * room — the arena should feel like space, not a box the planets touch. The
 * ring is a *fraction* of the bounds (`PLANET.ringFraction`), so the ring scales
 * with this; `WORLD_EDGE_MARGIN` is what actually guarantees the clearance. TUNABLE
 */
export const WORLD_SIZE: Tunable<number> = 2400;

/**
 * Breathing room between anything the sim spawns and the arena wall (world
 * units). **Nothing** — planet, ship, asteroid, ore chunk, wreck debris — is
 * placed within this distance of the bounds (field report P1). It is the hard
 * clearance guarantee: `createWorld` clamps the planet ring so the outermost
 * planet point clears the wall by this margin, and the spawners
 * (`./waves`, wreck debris in `./match`) clamp every position through
 * `clampToMargin` below. Comfortably larger than any entity's own radius plus a
 * wreck's debris-ring reach (`WRECK.debrisRingOffset` + `CHUNK.radius`), so the
 * clearance holds for debris that rings a home near the edge too. TUNABLE
 */
export const WORLD_EDGE_MARGIN: Tunable<number> = 220;

/**
 * Clamp one coordinate of a spawn position so the entity (centre ± `radius`)
 * stays at least `margin` inside a bounds dimension of length `dimension`.
 * Deterministic and RNG-free — the same seed still yields the same world
 * (GDD §4.8): a draw is computed, then clamped, never re-rolled. On a bounds too
 * small to hold the margin on both sides the entity is centred, which only
 * happens on degenerate QA worlds, never the real arena.
 */
export function clampToMargin(
  coord: number,
  radius: number,
  dimension: number,
  margin: number = WORLD_EDGE_MARGIN,
): number {
  const lo = margin + radius;
  const hi = dimension - margin - radius;
  if (hi < lo) return dimension / 2;
  return Math.min(Math.max(coord, lo), hi);
}

/** The home planet (GDD §2.1 ring layout, §2.5 "built at your own planet").
 *  Not a §2.8 table row — the table prices the buildings, not the rock they sit
 *  on — but the sim cannot place a core without it. TUNABLE */
export const PLANET = {
  /** Core body radius: the collision/shot target and the mount ring for turrets. */
  radius: 64,
  /** Ring radius as a fraction of the smaller arena dimension (GDD §2.1: planets
   *  in a ring around the central asteroid field). Lowered from the v0.1 0.42
   *  (field report P1): at 0.42 the ring sat at 0.84×halfMin and, once the
   *  planet radius was added, touched the wall. At 0.32 the ring clears the wall
   *  by more than `WORLD_EDGE_MARGIN` on the default arena while staying outboard
   *  of the ship ring. */
  ringFraction: 0.32,
  /** How far outboard of the ship's spawn point the planet sits — the ship
   *  spawns *orbiting* its home planet, between the planet and the field
   *  (GDD §2.1). */
  orbitOffset: 96,
  /** Ship-to-planet distance inside which the Build & Upgrade wheel is live:
   *  ordering, banking, and holding the repair channel all require it
   *  (GDD §2.5 "your ship must sit at your planet"). Measured centre-to-centre. */
  dockRange: 160,
} as const;

/** Field yield — total ore per match, delivered in 5 asteroid waves each
 *  spawning closer to center (GDD §2.3, §2.8). TUNABLE */
export const FIELD_YIELD: Tunable<number> = 400;

/** Number of asteroid waves the field yield arrives in (GDD §2.3). TUNABLE */
export const WAVE_COUNT: Tunable<number> = 5;

/** Asteroid wave interval — the metronome of the match (GDD §2.8), seconds. TUNABLE */
export const WAVE_INTERVAL_S: Tunable<number> = 150;

/**
 * Asteroid-wave geometry (GDD §2.3: five waves, "each spawning closer to the
 * map center than the last, pulling every surviving player into a smaller and
 * smaller contested space"). The wave *schedule* is `WAVE_INTERVAL_S` and the
 * wave *yield* is `FIELD_YIELD / WAVE_COUNT`; this is where they land. TUNABLE
 */
export const WAVE = {
  /** Asteroids delivered per wave (a target — the spawner rounds it to the
   *  nearest multiple of the player count so the wave is `N`-fold symmetric,
   *  `RESOURCE_FIELD`). `WAVE_COUNT × this` plus the home fields is the whole
   *  match's rock count — roughly 5 × 20 + 3 × N ≈ 124 at 8 players, well under
   *  the ~200-asteroid performance budget (GDD §4.3) even if nobody mines a
   *  thing. Rocks stay small enough that "how full do I run?" is asked often. */
  asteroidsPerWave: 20,
  /** Wave 1's scatter disc, as a fraction of the base field radius. */
  firstRadiusFraction: 1.0,
  /** The final wave's scatter disc, same units. Strictly smaller than the
   *  first: the shrinking ring *is* the mechanic. */
  lastRadiusFraction: 0.25,
} as const;

/**
 * Fair resource layout (developer field rule v0.1.2: "equally located resources
 * for every planet, before the fight begins — with neighbor resources and
 * central ones as well"). Resource placement is a **fairness invariant**, not
 * scatter: the whole asteroid field is invariant under rotation by `2π / N`
 * about the arena centre, where `N` is the player count. See the invariant note
 * in `./waves`. Every value TUNABLE.
 *
 *  - **Home fields** are the per-planet "neighbour resources": one seeded
 *    canonical pattern, stamped around each planet rotated by that planet's ring
 *    angle, so all `N` home fields are IDENTICAL by construction — equal totals
 *    need no tolerance. They sit inboard of the planet (between it and the ring
 *    midline), OUTSIDE turret range, and clear of `WORLD_EDGE_MARGIN`.
 *  - **The commons** is the contested centre: a richer central field delivered
 *    by the asteroid waves, itself `N`-fold symmetric so mid-map favours nobody.
 */
export const RESOURCE_FIELD = {
  /** Share of `FIELD_YIELD` delivered as the contested central commons — the
   *  rest (`1 - commonsShare`) funds the equal home neighbourhoods, split evenly
   *  across the `N` planets. The commons holds this whole share; each home holds
   *  `(1 - commonsShare) / N`, so the commons is richer than any single home
   *  field by construction. TUNABLE */
  commonsShare: 0.6,
  /** The fairness test's floor: the commons must hold at least this fraction of
   *  all world ore, so the centre is always worth fighting for (GDD §2.3). The
   *  actual `commonsShare` sits comfortably above it. TUNABLE */
  commonsMinShare: 0.5,
  /** Commons scatter disc for wave 1, as a fraction of `ringRadius` (waves 2..5
   *  shrink from it, `waveRadiusFraction`). Kept small enough that the commons
   *  core stays clear of every home's measure radius — the two fields never
   *  overlap, which is what lets the home totals be EXACTLY equal. TUNABLE */
  commonsRadiusFraction: 0.4,
  /** The commons is a coned RING: rocks avoid the inner this-fraction of each
   *  wave's disc, leaving a clear central eye — and, crucially, a clear straight
   *  spoke for a ship to launch down (field report P1; see the note in `./waves`).
   *  Each wave is still a shrinking ring closer to the core than the last (GDD
   *  §2.3 "Outer Drift"), so the concentric rings close in over the match. Sized
   *  with `commonsSpokeGap` so the innermost ring rock clears a launching ship's
   *  path by more than a ship+rock radius.
   *
   *  Raised from the v0.1 0.75 (p5-repair-discrete soak): the five shrinking
   *  rings stack near the centre, and at 0.75 the innermost wave's eye
   *  (`0.75 × 0.25 × fieldRadius` ≈ 58 u) was small enough that a ship drawn into
   *  the centre — GDD §2.3's whole "pulled into a smaller and smaller contested
   *  space" — could be **sealed** by a full ring of body-radius rocks it could not
   *  squeeze past (the harness caught a bot rattling >100 s inside one, the
   *  `unstuck` invariant). A bigger eye pushes the innermost ring out to a radius
   *  whose circumference actually admits a ship-wide gap, so the centre still
   *  draws players in but never traps them; the 50-seed soak's worst wedge fell
   *  from ~13 s to ~4 s, back in the honest detect-and-escape band. It is strictly
   *  MORE clearance than 0.75 — the launch-corridor guarantee above only gets
   *  stronger — and costs the fairness invariant nothing (still `N`-fold
   *  symmetric, still the same `WAVE_ORE`). TUNABLE */
  commonsHoleFraction: 0.85,
  /** Angular clearance (radians) kept around every planet spoke WITHIN the
   *  commons: a wave's rocks sit only in `[gap, sectorWidth − gap]` of their
   *  `2π/N` sector, so no rock lands on a launch corridor. Clamped below
   *  `sectorWidth/2` for small lobbies so the band never inverts. TUNABLE */
  commonsSpokeGap: 0.33,
  /** Canonical rocks per home field (before the `N`-fold stamp). TUNABLE */
  homeCount: 3,
  /**
   * Home-field centre-radius band, as fractions of the planet ring radius:
   * inboard of the planet (between it and the ring midline). Pulled in from the
   * v0.1.2 0.52–0.64 (field report P1: at 0.64 the nearest rock sat only ~215 u
   * from the ship's spawn point, so a ship leaving spawn bumped rock — the mobile
   * drag test measured 0.6–0.8 u/tick where open flight is expected). At
   * 0.44–0.47 the field sits well inboard of `SPAWN_CLEAR_POCKET`, and — with the
   * angular cone below — off the launch spoke entirely, so the outermost rock
   * (~473 u from its planet) still clears turret range and the innermost still
   * fits inside the measure radius `R`. TUNABLE
   */
  homeInnerFraction: 0.44,
  homeOuterFraction: 0.47,
  /**
   * The home field is a two-lobe cone straddling its planet's spoke, NOT a blob
   * centred on it: every rock's angular offset from the spoke has magnitude in
   * `[homeConeInner, homeConeOuter]` radians (drawn per side), leaving a clear
   * wedge of half-angle `homeConeInner` along the spoke itself. That wedge is the
   * launch corridor (field report P1): a ship spawns orbiting its planet and, on
   * the drag test, thrusts straight inboard *along its spoke* toward the centre —
   * so a rock sitting ON the spoke is one the launching ship rams. Under a slow
   * renderer (the CI software-WebGL profile) the test's gesture ramp alone flies
   * the ship a few hundred units before the measured window even opens, so the
   * spoke must be clear well past the field, not merely a pocket around the
   * planet. `homeConeInner` is sized so the nearest lobe rock clears the ship's
   * straight path by more than a ship+rock radius at the field's radius
   * (`homeInnerFraction × ring × sin(homeConeInner)` ≈ 75 u > ~62 u). The cone is
   * still symmetric about the spoke, so the field stays equidistant from both
   * neighbours and the fairness invariant is untouched. TUNABLE
   */
  homeConeInner: 0.2,
  homeConeOuter: 0.3,
  /** Radius R around a home within which its local ore is measured for the
   *  fairness invariant, as a fraction of the planet ring radius. Sized to
   *  enclose the whole (now more-inboard, off-spoke) home field yet exclude both
   *  the commons and any neighbour's field, so "ore within R of each home" is
   *  exactly one home field per planet — all `N` equal. The window is (max
   *  home-rock dist ≈ 513 u, min commons dist 557 u, min N=8 neighbour dist
   *  ≈ 539 u); R ≈ 527 u sits inside all three with room. TUNABLE */
  homeMeasureFraction: 0.61,
} as const;

/**
 * SPAWN_CLEAR_POCKET — the launch pocket kept clear around every home planet, as
 * a fraction of the planet ring radius (field report P1). **No asteroid body is
 * stamped within this radius of a planet centre**, so a ship can leave its spawn
 * (which orbits its planet by `PLANET.orbitOffset`) and manoeuvre in open space
 * before it reaches the first rock — the drag test's "open flight," and what a
 * real player feels launching out of a home that is no longer a rock garden.
 *
 * The home field is placed comfortably *beyond* the pocket: its nearest rock's
 * centre sits at `ringRadius × (1 - homeOuterFraction)` ≈ 0.53 of the ring from
 * the planet, well outside this 0.44, so the pocket is empty by construction and
 * `./waves` additionally clamps the field's outer edge to it as a structural
 * floor (the invariant survives a retune of the band fractions). Because the
 * pocket is part of the per-planet stamp — a rigid rotation of one pattern — it
 * is automatically identical for every home, so it costs the fairness invariant
 * nothing (`resource-fairness.test.ts`). TUNABLE
 */
export const SPAWN_CLEAR_POCKET: Tunable<number> = 0.44;

/** Ore delivered by one asteroid wave — the commons, divided evenly across the
 *  `WAVE_COUNT` waves (GDD §2.3). The home neighbourhoods carry the remaining
 *  `1 - commonsShare` of `FIELD_YIELD`, placed at construction, so the whole
 *  match still yields exactly `FIELD_YIELD` (`RESOURCE_FIELD`). */
export const WAVE_ORE: Tunable<number> =
  (FIELD_YIELD * RESOURCE_FIELD.commonsShare) / WAVE_COUNT;

/** Ore in one home neighbourhood — `(1 - commonsShare)` of `FIELD_YIELD`, split
 *  evenly across the `N` planets. All `N` home fields carry exactly this (the
 *  fairness invariant, `RESOURCE_FIELD`). */
export function homeFieldOre(playerCount: number): number {
  const n = Math.max(1, playerCount);
  return (FIELD_YIELD * (1 - RESOURCE_FIELD.commonsShare)) / n;
}

/**
 * Sim time (seconds) at which wave `n` (1-based) arrives. Wave 1 is present at
 * match start and each later wave lands one `WAVE_INTERVAL_S` after the one
 * before it — the same schedule the HUD's wave clock counts down to, so the
 * clock and the spawner can never drift.
 */
export function waveTime(n: number): number {
  return (n - 1) * WAVE_INTERVAL_S;
}

/**
 * Scatter-disc radius of wave `n`, as a fraction of the base field radius —
 * linear from `WAVE.firstRadiusFraction` down to `WAVE.lastRadiusFraction`, so
 * every wave lands strictly closer to the centre than the one before it.
 */
export function waveRadiusFraction(n: number): number {
  if (WAVE_COUNT <= 1) return WAVE.lastRadiusFraction;
  const t = Math.min(Math.max((n - 1) / (WAVE_COUNT - 1), 0), 1);
  return WAVE.firstRadiusFraction + (WAVE.lastRadiusFraction - WAVE.firstRadiusFraction) * t;
}

/**
 * How long after the final wave the collapse phase begins regardless of what is
 * left in the field (GDD §2.3: "the match cannot stalemate; the ruleset
 * guarantees an ending"). Collapse normally starts the moment the field runs
 * dry; this is the backstop for a match where nobody bothers to mine the last
 * rock. Final wave at 600 s + 150 s ⇒ collapse by 12.5 minutes, inside the
 * 10–15 minute target (GDD §1). TUNABLE
 */
export const COLLAPSE_GRACE_S: Tunable<number> = WAVE_INTERVAL_S;

/**
 * Core HP lost per second, per planet, during collapse — "entropy finishes
 * whoever the players don't" (GDD §1).
 *
 * **Ratified 1** (Director, M5). The v0.1 release check
 * (`tests/reports/release-check.md` §D.1, first raised in
 * `tests/reports/balance-01.md`) measured a field of non-aggressive bots that
 * NEVER resolves at the old baseline `0`: with no shield regen, no repair, and
 * no new ore but *also no core damage*, a full-turtle field runs to the
 * 20-minute ceiling and "outlast everyone" beats "go get them" — the opposite
 * of the GDD §2.6 intent. QA measured the fix (a naked core dies in
 * `CORE_HP / 1` = 100 s of collapse) and every passive strategy then resolves
 * inside the 10–15 min target (GDD §3.8, §1). The constant's original doc
 * anticipated this: it exists precisely so the stalemate hypothesis could be
 * falsified by raising this number instead of editing the sim. Collapse is now
 * four rules, not three — the design decision the doc flagged, made.
 *
 * At `1` HP/s, decay is intentionally slow: it is the backstop that guarantees
 * an ending (GDD §2.3), not a race — an attacker's fire (`WEAPON_DPS_CORE` = 5)
 * still finishes a home far faster than entropy does. TUNABLE
 *
 * (Written `= 1 as Tunable<number>` rather than the file's usual
 * `: Tunable<number> =` so the shipped value sits directly after the name: the
 * M5 DoD greps `COLLAPSE_CORE_DECAY\s*=\s*(\d+)` to guarantee decay is never
 * silently returned to zero, and the grep must read the real assignment, not a
 * comment.)
 */
export const COLLAPSE_CORE_DECAY = 1 as Tunable<number>;

/** Respawn time — free; time is the cost (GDD §2.7, §2.8), seconds. TUNABLE */
export const RESPAWN_S: Tunable<number> = 5;

/**
 * The wreck a dead planet leaves behind (GDD §2.7): it "persists for the rest of
 * the match, surrounded by ore-laden debris that *anyone* can scavenge." The
 * dead player's *banked* ore is what funds the debris field — the fortune they
 * were saving becomes the thing their killers fight over — plus a floor so a
 * broke player still leaves a contested wreck. TUNABLE
 */
export const WRECK = {
  /** Ore scattered on top of the dead owner's banked total. */
  baseDebrisOre: 8,
  /** How far outboard of the planet surface the debris ring sits. */
  debrisRingOffset: 40,
  /** Hard cap on debris chunks from one wreck — a hoarder's bank cannot flood
   *  the map with collectables (the excess dies with the planet). */
  maxDebrisChunks: 40,
} as const;

/** Fraction of held ore dropped as debris on ship death (GDD §2.3, §2.7). TUNABLE */
export const DEATH_ORE_DROP_FRACTION: Tunable<number> = 0.5;

/** Sensor range: distance at which an enemy planet's damage ring becomes
 *  visible (GDD §2.8) — defined as 2× shield radius. Fog is a mechanic
 *  (GDD §2.2); the sim exposes the range, the UI/bots honor it. TUNABLE */
export const SENSOR_RANGE: Tunable<number> = 2 * SHIELD.radius;

// ---------------------------------------------------------------------------
// GDD §2.4 — Fire mode
// ---------------------------------------------------------------------------

/** Auto-aim engages the nearest valid target across the full 360° with no
 *  front-arc restriction (GDD §2.4, explicitly `TUNABLE`). A value < 2π would
 *  reintroduce a firing arc. TUNABLE */
export const AUTO_AIM_ARC: Tunable<number> = 2 * Math.PI;

// ---------------------------------------------------------------------------
// GDD §2.11 — Ship classes (all five attributes, relative to the Vanguard)
// ---------------------------------------------------------------------------

/** The five locked-at-lobby class attributes (GDD §2.11). Speed/accel/turn are
 *  multipliers over the Vanguard base; hull and power are absolute; power is also
 *  mining speed (one weapon, one stat). Upgrades multiply these bases (GDD §2.5),
 *  so relative class identity is preserved at every tier. */
export interface ShipStats {
  /** Top-speed multiplier over `BASE_SPEED`. */
  readonly speedMul: number;
  /** Acceleration multiplier over `BASE_ACCEL`. */
  readonly accelMul: number;
  /** Turn-rate multiplier over `BASE_TURN_RATE`. */
  readonly turnMul: number;
  /** Absolute hull HP (armor). */
  readonly hull: number;
  /** Power stat: weapon DPS vs ships/turrets, and mining/core scale (one stat). */
  readonly power: number;
  /** Base cargo slots for the hull. */
  readonly cargo: number;
}

/** Per-class stats (GDD §2.11 table). All TUNABLE. */
export const SHIP_STATS: Readonly<Record<ShipClass, ShipStats>> = {
  // Quadfin — scout, miner-hunter · 130/120/140 · hull 35 · power 8 · cargo 2
  [ShipClass.Interceptor]: { speedMul: 1.3, accelMul: 1.2, turnMul: 1.4, hull: 35, power: 8, cargo: 2 },
  // Anvil — all-rounder, onboarding default · 100/100/100 · hull 50 · power 10 · cargo 2
  [ShipClass.Vanguard]: { speedMul: 1.0, accelMul: 1.0, turnMul: 1.0, hull: 50, power: 10, cargo: 2 },
  // Pincer — mining engine, close bruiser · 90/100/80 · hull 55 · power 13 · cargo 2
  [ShipClass.Excavator]: { speedMul: 0.9, accelMul: 1.0, turnMul: 0.8, hull: 55, power: 13, cargo: 2 },
  // Hammerhead — logistics, siege tank · 85/80/85 · hull 70 · power 9 · cargo 3
  [ShipClass.Hauler]: { speedMul: 0.85, accelMul: 0.8, turnMul: 0.85, hull: 70, power: 9, cargo: 3 },
};

/** The Vanguard is the balance reference: its power stat is the denominator for
 *  every power-scaled rate (mining, core DPS). Equals `SHIP_STATS.vanguard.power`. */
export const VANGUARD_POWER: Tunable<number> = SHIP_STATS[ShipClass.Vanguard].power;

/** Weapon DPS a class deals to ships/turrets — the power stat, directly. */
export function classWeaponDps(cls: ShipClass): number {
  return SHIP_STATS[cls].power;
}

/** Core DPS a class deals — power scaled to the Vanguard's core:ship ratio
 *  (5:10), so a Vanguard hits the core for `WEAPON_DPS_CORE` = 5. */
export function classCoreDps(cls: ShipClass): number {
  return SHIP_STATS[cls].power * (WEAPON_DPS_CORE / WEAPON_DPS_SHIP);
}

/** Mining rate (ore/s) a class extracts — `MINING_RATE` scaled by power vs the
 *  Vanguard baseline, so a Vanguard mines at exactly `MINING_RATE` = 0.5. */
export function miningRate(cls: ShipClass): number {
  return MINING_RATE * (SHIP_STATS[cls].power / VANGUARD_POWER);
}

// ---------------------------------------------------------------------------
// GDD §2.5 — Ship upgrades: the ladder, and its escalating costs
// ---------------------------------------------------------------------------
//
// "Ship upgrades (escalating cost): power (mining speed and weapon damage —
// one stat), engine speed, cargo capacity (base hold 2, +2 per tier),
// hull HP. … Upgrades *multiply* the class base stats (2.11), so a maxed
// Interceptor is still the fastest thing on the map and a maxed Hauler still the
// toughest." (GDD §2.5)
//
// That last sentence is why the ladder is one table shared by all four hulls
// rather than four per-class tables: a *multiplier* ladder cannot reorder the
// classes, so class identity is preserved at every tier by construction instead
// of by careful tuning. Cargo is the one additive track, because GDD §2.8 states
// it additively ("+2 per tier, cap 8") — and the cap is what makes the Hauler's
// extra slot a head start rather than a permanent lead.

/** How a tier applies to the class base: scale it, or add a flat step to it. */
export type UpgradeMode = 'multiply' | 'add';

/** One track's ladder. `steps[0]` is the stock hull, so `steps.length - 1` is
 *  the max tier and `costs` is one shorter than `steps`. */
export interface UpgradeTrackSpec {
  readonly track: UpgradeTrack;
  readonly mode: UpgradeMode;
  /** `steps[tier]`, applied to the class base per `mode`. */
  readonly steps: readonly number[];
  /** `costs[tier]` is the ore price of moving from `tier` to `tier + 1`. */
  readonly costs: readonly number[];
  /** Hard ceiling on the resulting value (GDD §2.8 cargo "cap 8"), or `null`. */
  readonly max: number | null;
  /**
   * The player-facing wedge name (v0.2.2 field report: "every wedge shows WHAT it
   * upgrades unambiguously"). This is where the DAMAGE relabel of the `Power`
   * track lives — the enum key stays `Power`, the wedge reads `label`. The UI's
   * upgrade wheel prints this, so a rename is a data edit here, never UI code.
   */
  readonly label: string;
  /**
   * The unit the wedge's delta is measured in — `'%'` for a multiplier track,
   * `'/hit'` for per-shot damage, `''` for unitless slots or absolute HP. The
   * field report's item 4: a wedge shows "label + delta with units", and the
   * units (`%`, `/hit`) come from here so what a wedge reports is data, not layout.
   */
  readonly unit: string;
  /**
   * Tracks the UI draws together as one nested sub-wheel (RATIFIED v0.2.2: DAMAGE
   * and SPEED are the **WEAPON** group). `undefined` is a standalone wedge. The
   * group is metadata the sim owns; the p4-10 UI renders it, so the group is
   * data, not layout.
   */
  readonly group?: string;
}

/**
 * The upgrade ladder: three buyable tiers per track, costs escalating with the
 * first tier cheap (GDD §2.5 "escalating cost", §2.8 "first tier cheap,
 * escalating").
 *
 * The whole ladder costs 26 + 22 + 20 + 22 = 90 ore, against a field that yields
 * ~400 for eight players (GDD §2.8) — so nobody maxes everything, and every tier
 * bought is a turret, a shield, or a core repair not bought (GDD §2.5: "every ore
 * in the hold has five competing uses"). That is the point of the numbers, and
 * the reason they are all TUNABLE.
 *
 * These values match the provisional ladder the upgrade panel shipped with
 * (`src/ui/upgrade-panel.ts`), which was written as "the UI's own opening
 * hypothesis … the day the Gameplay Engineer lands real upgrade tiers, the
 * wiring passes theirs and no UI code changes." Adopting them makes the panel's
 * printed numbers true on the day the sim starts honouring them, with no drift
 * between what a player is shown and what they are sold. All TUNABLE.
 */
export const UPGRADES: Readonly<Record<UpgradeTrack, UpgradeTrackSpec>> = {
  // DAMAGE (enum key `Power`): mining speed *and* weapon damage-per-hit, one stat
  // (GDD §2.5). Multiplies the class power, so the Excavator stays the mining
  // engine at every tier. Since v0.2.2 it no longer moves projectile *speed* —
  // that split off to its own SPEED track below — so this wedge means exactly one
  // thing to a player: how hard each shot bites (`/hit`). WEAPON group.
  [UpgradeTrack.Power]: {
    track: UpgradeTrack.Power,
    mode: 'multiply',
    steps: [1, 1.25, 1.5, 1.8],
    costs: [4, 8, 14], // TUNABLE
    max: null,
    label: 'DAMAGE',
    unit: '/hit',
    group: 'weapon',
  },
  // SPEED: projectile muzzle velocity only (v0.2.2 field report). Faster shots are
  // harder to dodge — the counterplay the projectile weapon was built for. Priced
  // a tier above DAMAGE (`SHOT_SPEED_COSTS`), because it is the stronger buy: it
  // makes the damage you already have connect, so it must not be the strictly-best
  // first purchase. WEAPON group — drawn with DAMAGE as one nested sub-wheel.
  [UpgradeTrack.Speed]: {
    track: UpgradeTrack.Speed,
    mode: 'multiply',
    steps: SHOT_SPEED_STEPS,
    costs: SHOT_SPEED_COSTS, // TUNABLE — a tier above DAMAGE at each rung
    max: null,
    label: 'SPEED',
    unit: '%',
    group: 'weapon',
  },
  // Engine: top speed *and* acceleration — an engine is thrust, and a hull that
  // gained a ceiling it takes twice as long to reach would feel like a downgrade.
  // Turn rate is deliberately NOT on this ladder: turning is the airframe, so it
  // stays class-only and the Interceptor keeps sole ownership of agility.
  [UpgradeTrack.Engine]: {
    track: UpgradeTrack.Engine,
    mode: 'multiply',
    steps: [1, 1.15, 1.3, 1.45],
    costs: [3, 7, 12], // TUNABLE
    max: null,
    label: 'ENGINE',
    unit: '%',
  },
  // Cargo: "+2 per tier" with a hard cap of 8 — both ratified numbers, read from
  // the table above rather than typed twice (GDD §2.8). The cheapest first tier
  // in the ladder: doubling a 2-slot hold is the upgrade a first-time player
  // feels immediately, and onboarding leans on it (GDD §2.10).
  [UpgradeTrack.Cargo]: {
    track: UpgradeTrack.Cargo,
    mode: 'add',
    steps: [0, CARGO_PER_TIER, CARGO_PER_TIER * 2, CARGO_PER_TIER * 3],
    costs: [2, 6, 12], // TUNABLE
    max: CARGO_CAP_MAX,
    label: 'CARGO',
    unit: '', // slots — a bare count, no unit suffix
  },
  // Hull: ships are cheap, respawn free, and hull is not repairable at all
  // (GDD §2.5) — so this track buys time inside one fight and never a heal.
  [UpgradeTrack.Hull]: {
    track: UpgradeTrack.Hull,
    mode: 'multiply',
    steps: [1, 1.2, 1.4, 1.6],
    costs: [3, 7, 12], // TUNABLE
    max: null,
    label: 'HULL',
    unit: '', // absolute HP — a bare number, no unit suffix
  },
};

/** Iteration order over the tracks. Fixed, because anything that walks them all
 *  inside the sim must walk them in one order (GDD §4.8). DAMAGE leads and SPEED
 *  follows it, so the WEAPON group is contiguous for any consumer that lays out
 *  from this order; the rest keep their historical order. */
export const TRACK_ORDER: readonly UpgradeTrack[] = [
  UpgradeTrack.Power,
  UpgradeTrack.Speed,
  UpgradeTrack.Engine,
  UpgradeTrack.Cargo,
  UpgradeTrack.Hull,
];

// ---------------------------------------------------------------------------
// Derived physics constants (GDD §4.1 — Euler + drag, hand-written circles)
// ---------------------------------------------------------------------------
//
// Not in the §2.8 table, but the sim cannot move a ship without them. All
// TUNABLE and owned by the same handover to QA. Base = Vanguard; the §2.11
// multipliers scale these per class.

/** Vanguard top speed (world units/s). Class `speedMul` scales it. TUNABLE */
export const BASE_SPEED: Tunable<number> = 260;

/** Vanguard acceleration (units/s²) at full thrust. Class `accelMul` scales it. TUNABLE */
export const BASE_ACCEL: Tunable<number> = 900;

/** Vanguard turn rate (rad/s). Class `turnMul` scales it. TUNABLE */
export const BASE_TURN_RATE: Tunable<number> = 6.5;

/**
 * Speed (units/s) above which a ship with no aim input and no auto-aim target
 * turns its nose toward its velocity, so motion reads naturally. Below it the
 * ship holds its current facing — a drifting, nearly-stopped hull must not
 * spin to chase the direction of a millimetre of residual drift. ≈5% of
 * `BASE_SPEED`. TUNABLE
 */
export const FACE_VELOCITY_MIN_SPEED: Tunable<number> = 12;

/** Linear drag coefficient (per second). `vel -= vel * DRAG * dt`. With
 *  `BASE_ACCEL`/`BASE_SPEED` this also caps terminal velocity; the sim clamps
 *  to top speed as well so drag tuning never changes the ceiling. TUNABLE */
export const DRAG: Tunable<number> = 3.0;

/** Ship collision radius (world units). TUNABLE */
export const SHIP_RADIUS: Tunable<number> = 16;

/** Restitution (bounciness) of a ship reflecting off an asteroid
 *  (GDD §4.1 "Ship-vs-asteroid reflects"). 0 = dead stop along the normal,
 *  1 = perfectly elastic. TUNABLE */
export const SHIP_ASTEROID_RESTITUTION: Tunable<number> = 0.8;

// ---------------------------------------------------------------------------
// Weapon acquisition range (GDD §2.4 — auto-aim engagement radius)
// ---------------------------------------------------------------------------

/**
 * Engagement reach (world units): the radius within which auto-aim acquires the
 * nearest valid target (asteroid, enemy ship, turret, core) across the full 360°
 * (GDD §2.4), and the standoff distance the bots and QA probes mine and fight
 * from. It is the one weapon system's reach, whether the shot lands on rock or
 * hull; the bot behaviour trees, the netcode, and the QA harness all size their
 * standoffs from it. TUNABLE */
export const WEAPON_RANGE: Tunable<number> = 260;

// ---------------------------------------------------------------------------
// Asteroids and ore chunks (GDD §2.3, §5.5)
// ---------------------------------------------------------------------------

/** Asteroid tuning. Rock body is neutral; `ore` is the payout inside. Cracks
 *  across three visible stages at ore-remaining thresholds (GDD §5.5). TUNABLE */
export const ASTEROID = {
  /** Min/max collision radius (world units). */
  minRadius: 22,
  maxRadius: 46,
  /** Min/max ore payout inside one asteroid. */
  minOre: 4,
  maxOre: 12,
  /** Ore-remaining fractions at which the crack sprite advances (GDD §5.5:
   *  three stages). Stage 0 above `[0]`, stage 1 between, stage 2 below `[1]`. */
  crackThresholds: [2 / 3, 1 / 3] as const,
} as const;

/** Ore chunk tuning (GDD §2.3: asteroids "burst into ore chunks that drift
 *  toward nearby ships"). TUNABLE */
export const CHUNK = {
  /** Ore value carried by one chunk; mined ore is emitted in these units. */
  ore: 1,
  /** Collision/collection radius (world units). */
  radius: 6,
  /** Speed a freshly-cracked chunk drifts outward from the asteroid (units/s). */
  ejectSpeed: 40,
  /** Linear drag on a drifting chunk (per second). */
  drag: 1.5,
} as const;

/** Proximity tractor (GDD §2.3: "tractor-collected automatically by proximity").
 *  A chunk within `range` of the nearest ship is pulled toward it; contact
 *  collects it, capped by the hold (GDD §2.3: full hold leaves chunks for
 *  anyone). TUNABLE */
export const TRACTOR = {
  /** Range at which a ship's tractor grabs a chunk (world units). */
  range: 120,
  /** Pull acceleration toward the ship (units/s²). */
  accel: 700,
} as const;

/**
 * DEPOSIT_RANGE — the atmosphere radius (world units, centre-to-centre) inside
 * which a ship auto-deposits its hold at its OWN living planet. Ratified p4
 * (developer): "You shouldn't need to touch your planet to deposit — just be in
 * that atmosphere." A generous **planet-radius multiple** (4× ⇒ 256 u),
 * comfortably larger than `PLANET.dockRange` (160): a ship orbiting its home
 * sits inside the atmosphere without having to close to docking distance, so
 * orbiting comfortably inside it is easy — depositing costs no precision.
 *
 * The drain runs whenever the ship is inside this radius at its own living
 * planet, with **no dock and no park gate** (`updateDeposits`): cross in and it
 * starts the same tick, cross out and it stops — interruptible exactly as
 * before, the boundary counting as inside (`≤`). Docking (`PLANET.dockRange`)
 * still gates the build/upgrade/repair wheel and, being the tighter radius,
 * trivially implies being in the atmosphere. The render layer draws the
 * atmosphere halo from this exact radius (p4-12 asserts the drawn radius equals
 * the sim radius), so the visual tell and the rule can never drift. TUNABLE
 */
export const DEPOSIT_RANGE: Tunable<number> = PLANET.radius * 4;

/**
 * Auto-deposit inside your own planet's atmosphere (field report v0.1.2; GDD
 * §2.3 "fly home and convert ore … or bank it", §2.5; ratified p4).
 *
 * The developer flew home with a full hold and nothing happened: mining fills
 * the hold, but the *only* thing that emptied it into the safe banked total was
 * an explicit BANK wheel press, which a first-time player never finds. The rule:
 * while a ship is inside its own living planet's **atmosphere** (`DEPOSIT_RANGE`),
 * its hold auto-transfers into the bank at a steady, readable, interruptible
 * rate — leave the atmosphere and it stops. Not instant (that is what the BANK
 * segment stays, for a one-tap dump): the drain is a beat the player watches, as
 * ore chunks visibly fly ship→planet.
 *
 * The transfer is authoritative and smooth (`drainRate * dt` every tick, so the
 * HUD hold and bank readouts tick down/up in lockstep); the flying chunks are
 * the *telegraph*, pooled ore sprites emitted **one per whole unit banked** and
 * reabsorbed at the planet — a conserved stream, never more chunks than the ore
 * that moved (field report p8). They reuse the ore chunk the renderer already
 * draws, so the visual needs no new render path.
 *
 * You deposit by **being in the atmosphere**, not by touching down: no dock,
 * no park requirement (ratified p4 — the old dock+park gate is retired). The
 * wheel's instant BANK press still wins the arrival tick for a one-tap dump, but
 * a pilot who simply orbits home unloads without ever having to settle onto the
 * planet. TUNABLE
 */
export const DEPOSIT = {
  /** Ore per second moved hold→bank while inside the atmosphere. At 2/s a base
   *  2-slot hold empties in ~1 s — brisk enough not to be a chore, slow enough
   *  to read the chunks fly and to cut short by pulling away. */
  drainRate: 2,
  /** Speed a deposit-flight chunk travels toward the planet (units/s) — fast
   *  enough to arrive within the drain, so a chunk is a courier, not clutter. */
  flightSpeed: 220,
} as const;

// ---------------------------------------------------------------------------
// Collision broad phase (GDD §4.1 — uniform-grid spatial hash)
// ---------------------------------------------------------------------------

/** Spatial-hash cell size ≈ 2× the largest collider radius (GDD §4.1), so a
 *  body only ever overlaps its own cell and the eight adjacent ones. TUNABLE */
export const HASH_CELL_SIZE: Tunable<number> = 2 * ASTEROID.maxRadius;
