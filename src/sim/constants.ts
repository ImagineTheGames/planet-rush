/**
 * src/sim/constants.ts — the baseline constants table. OWNER: Gameplay Engineer.
 *
 * This is the ENTIRE GDD §2.8 table (plus the §2.11 ship-class stats and the
 * derived physics constants the sim needs to move a ship), written out on day 1
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

import { ShipClass } from '@shared/types';

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

/** Core HP. Naked-core kill time = 100 ÷ 5 ≈ 20 s of sustained beam. TUNABLE */
export const CORE_HP: Tunable<number> = 100;

/** Beam-vs-core DPS — the constant the whole match balances on (GDD §2.8).
 *  This is the Vanguard baseline; a class's actual core DPS scales by its beam
 *  stat (see `beamCoreDps`). TUNABLE */
export const BEAM_DPS_CORE: Tunable<number> = 5;

/** Beam-vs-ships/turrets DPS, Vanguard baseline (GDD §2.8). A class's actual
 *  weapon DPS is its beam stat directly (Vanguard beam = 10). TUNABLE */
export const BEAM_DPS_SHIP: Tunable<number> = 10;

/** Mining rate: ore per second of beam-on-asteroid, Vanguard baseline
 *  (GDD §2.8). Scales by beam stat for other classes (see `miningRate`). The
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
  /** Engagement radius (world units). Deliberately *under* `BEAM_RANGE` (260):
   *  GDD §2.6 — "a patient attacker can pick off turrets from the edge of their
   *  range." That only exists as a skill if the beam out-ranges the turret. */
  range: 240,
  /** Seconds between shots. Per-shot damage = `dps * fireInterval` = 2. */
  fireInterval: 0.5,
  /** Projectile muzzle speed (units/s) — fast enough that lead is small at
   *  `range`, slow enough that a boosting ship can outrun a stale shot. */
  projectileSpeed: 700,
  /** Turret collision radius (it is a beam target — GDD §2.6 "turrets deter"). */
  radius: 12,
  /** Mount height above the planet surface; turret slots ring the planet. */
  mountOffset: 12,
  /** Rotation rate (rad/s) tracking its target — the "telegraph its threat while
   *  spinning" read (style-guide §5.5). Aim never gates the shot; DPS is DPS. */
  turnRate: 3.0,
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

/** Repair core (GDD §2.8): planet core only, HP/s channel, ore per HP, and the
 *  rule that any core/shield damage interrupts it (GDD §2.5). `orePerHp` =
 *  1 ore ⁄ 5 HP; never printed on the wheel. TUNABLE */
export const REPAIR = {
  hpPerSecond: 2,
  orePerHp: 1 / 5,
  interruptedByDamage: true,
} as const;

/** The home planet (GDD §2.1 ring layout, §2.5 "built at your own planet").
 *  Not a §2.8 table row — the table prices the buildings, not the rock they sit
 *  on — but the sim cannot place a core without it. TUNABLE */
export const PLANET = {
  /** Core body radius: the collision/beam target and the mount ring for turrets. */
  radius: 64,
  /** Ring radius as a fraction of the smaller arena dimension (GDD §2.1: planets
   *  in a ring around the central asteroid field). */
  ringFraction: 0.42,
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

/** Respawn time — free; time is the cost (GDD §2.7, §2.8), seconds. TUNABLE */
export const RESPAWN_S: Tunable<number> = 5;

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
 *  multipliers over the Vanguard base; hull and beam are absolute; beam is also
 *  mining speed (one beam, one stat). Upgrades multiply these bases (GDD §2.5),
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
  /** Beam stat: weapon DPS vs ships/turrets, and mining/core scale (one stat). */
  readonly beam: number;
  /** Base cargo slots for the hull. */
  readonly cargo: number;
}

/** Per-class stats (GDD §2.11 table). All TUNABLE. */
export const SHIP_STATS: Readonly<Record<ShipClass, ShipStats>> = {
  // Quadfin — scout, miner-hunter · 130/120/140 · hull 35 · beam 8 · cargo 2
  [ShipClass.Interceptor]: { speedMul: 1.3, accelMul: 1.2, turnMul: 1.4, hull: 35, beam: 8, cargo: 2 },
  // Anvil — all-rounder, onboarding default · 100/100/100 · hull 50 · beam 10 · cargo 2
  [ShipClass.Vanguard]: { speedMul: 1.0, accelMul: 1.0, turnMul: 1.0, hull: 50, beam: 10, cargo: 2 },
  // Pincer — mining engine, close bruiser · 90/100/80 · hull 55 · beam 13 · cargo 2
  [ShipClass.Excavator]: { speedMul: 0.9, accelMul: 1.0, turnMul: 0.8, hull: 55, beam: 13, cargo: 2 },
  // Hammerhead — logistics, siege tank · 85/80/85 · hull 70 · beam 9 · cargo 3
  [ShipClass.Hauler]: { speedMul: 0.85, accelMul: 0.8, turnMul: 0.85, hull: 70, beam: 9, cargo: 3 },
};

/** The Vanguard is the balance reference: its beam stat is the denominator for
 *  every beam-scaled rate (mining, core DPS). Equals `SHIP_STATS.vanguard.beam`. */
export const VANGUARD_BEAM: Tunable<number> = SHIP_STATS[ShipClass.Vanguard].beam;

/** Weapon DPS a class deals to ships/turrets — the beam stat, directly. */
export function beamShipDps(cls: ShipClass): number {
  return SHIP_STATS[cls].beam;
}

/** Core DPS a class deals — beam scaled to the Vanguard's core:ship ratio
 *  (5:10), so a Vanguard hits the core for `BEAM_DPS_CORE` = 5. */
export function beamCoreDps(cls: ShipClass): number {
  return SHIP_STATS[cls].beam * (BEAM_DPS_CORE / BEAM_DPS_SHIP);
}

/** Mining rate (ore/s) a class extracts — `MINING_RATE` scaled by beam vs the
 *  Vanguard baseline, so a Vanguard mines at exactly `MINING_RATE` = 0.5. */
export function miningRate(cls: ShipClass): number {
  return MINING_RATE * (SHIP_STATS[cls].beam / VANGUARD_BEAM);
}

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

/** Boost multiplier applied to top speed and acceleration while held
 *  (GDD §2.4 boost). TUNABLE */
export const BOOST_MULTIPLIER: Tunable<number> = 1.6;

/** Ship collision radius (world units). TUNABLE */
export const SHIP_RADIUS: Tunable<number> = 16;

/** Restitution (bounciness) of a ship reflecting off an asteroid
 *  (GDD §4.1 "Ship-vs-asteroid reflects"). 0 = dead stop along the normal,
 *  1 = perfectly elastic. TUNABLE */
export const SHIP_ASTEROID_RESTITUTION: Tunable<number> = 0.8;

// ---------------------------------------------------------------------------
// Beam geometry (GDD §4.1 — segment-vs-circle raycast, one beam mine + weapon)
// ---------------------------------------------------------------------------

/** Beam reach (world units). The raycast segment length; also the auto-aim
 *  acquisition radius. TUNABLE */
export const BEAM_RANGE: Tunable<number> = 260;

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

// ---------------------------------------------------------------------------
// Collision broad phase (GDD §4.1 — uniform-grid spatial hash)
// ---------------------------------------------------------------------------

/** Spatial-hash cell size ≈ 2× the largest collider radius (GDD §4.1), so a
 *  body only ever overlaps its own cell and the eight adjacent ones. TUNABLE */
export const HASH_CELL_SIZE: Tunable<number> = 2 * ASTEROID.maxRadius;
