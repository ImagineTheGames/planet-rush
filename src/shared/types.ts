/**
 * Planet Rush — shared type contract.
 *
 * This file is the ratified interface boundary between agents (GDD §3, §4.1).
 * Everything here is DIRECTOR-RATIFIED: consume it freely; propose changes only
 * as clearly-marked separate commits in a PR; never break it unilaterally.
 *
 * The load-bearing rule of the whole codebase: **the simulation never sees a
 * device.** Keyboard/mouse, gamepad, and touch all resolve to the abstract
 * `Action` union below before input crosses into `src/sim/`. Client, server,
 * and bots all speak these same types (one codebase, one set of types).
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** A 2D vector / point. Plain data so it serializes and hashes cleanly. */
export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Beam state (GDD §2.3, §4.1)
// ---------------------------------------------------------------------------

/**
 * The public geometry of a ship's beam for the tick it is firing. The sim
 * already casts a segment-vs-circle ray to find the nearest hit for damage /
 * mining (GDD §4.1, "immune to tunnelling"); this exposes that same hit so the
 * renderer draws the beam stopping at what it strikes instead of running full
 * length through it.
 *
 * Present (non-null on `Ship.beam`) only on ticks the ship is actually firing;
 * `null` otherwise. Plain data, so it serializes for snapshots and compares
 * cleanly under the determinism replay (GDD §4.8).
 */
export interface Beam {
  /** Beam emitter — the firing ship's position this tick. */
  origin: Vec2;
  /** Unit direction the beam travels (cos/sin of the ship's facing). */
  dir: Vec2;
  /**
   * World-space point of the first strike (asteroid, ship, and later turret /
   * shield / core), or `null` when the beam reaches its full range unobstructed.
   */
  hitPoint: Vec2 | null;
  /**
   * Distance from `origin` to the first hit, clamped to max beam range. Equals
   * the range when nothing is hit; the nearest of several hits wins.
   */
  length: number;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * A player slot, 0..7. Humans and bots share the same id space — a slot is a
 * slot (GDD §2.1, §4.2). Also indexes the 8-color roster (GDD §5.2).
 */
export type PlayerId = number;

/**
 * The four ship hulls (GDD §2.11). The lobby choice is locked for the match and
 * sets top speed, acceleration, turn rate, hull HP, and beam damage. Four
 * classes ship in week one, and no others.
 */
export enum ShipClass {
  Interceptor = 'interceptor', // Quadfin — scout, miner-hunter
  Vanguard = 'vanguard', // Anvil — all-rounder, onboarding default
  Excavator = 'excavator', // Pincer — mining engine, close bruiser
  Hauler = 'hauler', // Hammerhead — logistics, siege tank
}

// ---------------------------------------------------------------------------
// Ship upgrades (GDD §2.5)
// ---------------------------------------------------------------------------

/**
 * The four things ore can buy on a ship (GDD §2.5): "beam power (mining speed
 * and weapon damage — one beam, one stat), engine speed, cargo capacity …, hull
 * HP."
 *
 * `Beam` is deliberately one track and not two — mining speed and weapon damage
 * are the same number, which is the inversion the whole game turns on. Tiers
 * *multiply* the class base stats (GDD §2.5, §2.11), so a maxed Interceptor is
 * still the fastest thing on the map and a maxed Hauler still the toughest.
 *
 * The ladder itself — steps, escalating costs, max tier — is simulation tuning
 * and lives in `src/sim/constants.ts` (TUNABLE, GDD §2.8). This union is only
 * the *name* of a track, because it crosses the agent boundary: the sim owns the
 * numbers, the UI's upgrade panel labels the rows, and bots buy through the same
 * action a human does.
 */
export enum UpgradeTrack {
  Beam = 'beam',
  Engine = 'engine',
  Cargo = 'cargo',
  Hull = 'hull',
}

// ---------------------------------------------------------------------------
// Abstract actions (GDD §2.4)
// ---------------------------------------------------------------------------
//
// Every input device produces these, and only these. The mapping layer
// (src/platform/) translates keyboard/mouse, gamepad, and touch into this
// union; the simulation consumes it without knowing the source. Fire mode
// (Manual / Auto-aim) is resolved here too — see `AimAction` and `FireAction`.

/**
 * Thrust / steer (GDD §2.4). `dir` is an analog vector in the range [-1, 1] per
 * axis: keyboard WASD yields the unit-ish corners, an analog stick yields the
 * full disc. Magnitude scales acceleration.
 */
export interface ThrustAction {
  type: 'thrust';
  dir: Vec2;
}

/**
 * Aim (GDD §2.4). `dir` is a direction the ship should face/beam toward.
 * Meaningful in Manual fire mode (mouse cursor, right stick, touch aim stick);
 * ignored by the sim in Auto-aim, where positioning decides what gets hit.
 */
export interface AimAction {
  type: 'aim';
  dir: Vec2;
}

/**
 * Fire / Mine (GDD §2.4). The same beam mines asteroids and damages ships —
 * one beam, one stat. `active` is the held state; `auto` marks Auto-aim, where
 * the sim engages the nearest valid target within beam range across the full
 * 360° (GDD §2.4 fire modes; mobile amendment §2).
 */
export interface FireAction {
  type: 'fire';
  active: boolean;
  auto: boolean;
}

/** Open the Build & Upgrade wheel at the player's own planet (GDD §2.5). */
export interface BuildAction {
  type: 'build';
  active: boolean;
}

/**
 * What a Build & Upgrade wheel segment buys **on the spot** (GDD §2.5). Four of
 * the five segments; `UPGRADE SHIP` is deliberately *not* here, and stays out.
 *
 * It is the one segment that "opens a second screen rather than spending on the
 * spot" (GDD §2.5), and the press that actually spends happens on a *row* of
 * that screen — so the order has to name which of the four tracks was bought.
 * A `BuildItem` cannot carry that, so the panel's purchase is its own verb:
 * {@link UpgradeOrderAction}.
 *
 * - `turret` / `shield` — pay the cost now, construction takes time.
 * - `repair`  — open the repair channel on your own core (a channel, not a
 *               purchase: it consumes ore as it ticks and any core/shield
 *               damage interrupts it).
 * - `bank`    — move the ship's held ore into the safe banked total.
 */
export type BuildItem = 'turret' | 'shield' | 'repair' | 'bank';

/**
 * Confirm a Build & Upgrade wheel segment (GDD §2.5). Distinct from
 * {@link BuildAction}, which only *opens* the wheel: this is the press that
 * spends. One-shot — it is acted on for the tick it appears in and never held,
 * so a wheel confirmation can never double-charge by being latched.
 *
 * Bots issue it through the same action interface a human uses (GDD §2.9), and
 * the simulation validates it: it never trusts the sender for ownership,
 * proximity, cost, or per-planet caps.
 */
export interface BuildOrderAction {
  type: 'buildOrder';
  item: BuildItem;
}

/**
 * Buy one tier on one ship-upgrade track (GDD §2.5) — the press on a row of the
 * upgrade panel, the screen behind the wheel's UPGRADE SHIP arrow.
 *
 * A sibling of {@link BuildOrderAction} and one-shot for the same reason: it is
 * acted on for the tick it appears in and never held, so a row press can never
 * double-charge by being latched. The simulation validates it exactly as it
 * validates a wheel order — own planet, docked, alive, affordable, not already
 * at max tier — and never trusts the sender for any of it (GDD §2.9).
 *
 * There is no "sell" and no tier argument: a tier is bought one step at a time,
 * from wherever the player currently is, so the escalating cost is always the
 * cost of the *next* step.
 */
export interface UpgradeOrderAction {
  type: 'upgradeOrder';
  track: UpgradeTrack;
}

/** Boost (GDD §2.4). Held state. */
export interface BoostAction {
  type: 'boost';
  active: boolean;
}

/** Ping the minimap at a map-space position (GDD §2.4). */
export interface PingAction {
  type: 'ping';
  at: Vec2;
}

/**
 * The abstract action union (GDD §2.4). Eight verbs: thrust, aim, fire, build,
 * buildOrder, upgradeOrder, boost, ping. This is the contract every input device
 * targets and the simulation consumes.
 */
export type Action =
  | ThrustAction
  | AimAction
  | FireAction
  | BuildAction
  | BuildOrderAction
  | UpgradeOrderAction
  | BoostAction
  | PingAction;

/** Discriminator helper for exhaustive switches over `Action`. */
export type ActionType = Action['type'];

// ---------------------------------------------------------------------------
// Seeded RNG — mulberry32 (DIRECTOR-RATIFIED)
// ---------------------------------------------------------------------------
//
// Determinism is asserted per build by a CI replay test: same inputs, same
// final state hash (GDD §4.1, §4.8). That requires a single, shared, seeded
// PRNG with no reliance on Math.random(). mulberry32 is chosen for being tiny,
// fast, and deterministic across engines. The sim, bots, and any procedural
// spawn logic MUST draw randomness only from an instance of this.

/** A deterministic random source: returns floats in [0, 1). */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
}

/**
 * mulberry32 — a deterministic 32-bit PRNG.
 *
 * Given the same `seed`, produces the same sequence on every engine. This is
 * the ratified source of all in-sim randomness.
 *
 * @param seed 32-bit unsigned integer seed.
 */
export function mulberry32(seed: number): Rng {
  // Keep state as an unsigned 32-bit integer.
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
