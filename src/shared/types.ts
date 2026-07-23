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
 * The abstract action union (GDD §2.4). Six verbs: thrust, aim, fire, build,
 * boost, ping. This is the contract every input device targets and the
 * simulation consumes.
 */
export type Action =
  | ThrustAction
  | AimAction
  | FireAction
  | BuildAction
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
