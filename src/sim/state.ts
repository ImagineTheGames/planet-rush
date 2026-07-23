/**
 * src/sim/state.ts — the simulation's world state. OWNER: Gameplay Engineer.
 *
 * Everything here is **plain serializable data**: numbers, strings, and arrays
 * of the same. No class instances, no functions, no `Date`, no `Map` live in
 * the state tree. That is load-bearing for two reasons (GDD §4.1, §4.8):
 *
 *  1. **Determinism replay** — two runs from the same world + same inputs must
 *     `deepEqual`. Plain data compares cleanly; a closure or a `Map` would not.
 *  2. **Netcode snapshots** — the server encodes ships and projectiles from
 *     this tree; a plain shape serializes without a bespoke codec.
 *
 * The seeded RNG is stored as a bare 32-bit `rngState` number (not an `Rng`
 * closure) so the whole tree stays serializable and hashable. `advanceRng`
 * below steps it with the ratified mulberry32 algorithm (`@shared/types`).
 */

import type { Beam, PlayerId, Vec2 } from '@shared/types';
import { ShipClass, mulberry32 } from '@shared/types';
import {
  ASTEROID,
  CARGO_BASE,
  SHIP_RADIUS,
  SHIP_STATS,
  SPAWN_PROTECTION_S,
  STARTING_ORE,
} from './constants';

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** A player's ship. One per slot (GDD §2.1); humans and bots share the shape. */
export interface Ship {
  readonly id: PlayerId;
  readonly shipClass: ShipClass;
  pos: Vec2;
  vel: Vec2;
  /** Home spawn point — where the player's planet sits; respawn returns here
   *  (GDD §2.7). Day 1 has no planets, so this is just the ring spawn. */
  home: Vec2;
  /** Facing, radians. The beam fires along this; auto-aim overwrites it. */
  angle: number;
  /** Current hull HP. Ships are cheap and not repairable (GDD §2.5). */
  hull: number;
  /** Max hull for this class+upgrades; respawn restores to it. */
  maxHull: number;
  /** Ore currently held. Lost (half) on death; capped by `cargoCap` (GDD §2.3). */
  cargo: number;
  /** Hold capacity in ore. Base 2, +2 per upgrade tier (GDD §2.8). */
  cargoCap: number;
  /** Banked ore — safe, never lost to ship death (GDD §2.3). */
  banked: number;
  /** false while dead and waiting to respawn. */
  alive: boolean;
  /** Seconds until respawn (0 when alive). */
  respawnTimer: number;
  /** Seconds of spawn protection remaining (GDD §2.1). */
  spawnProtect: number;
  /** Collision radius. */
  radius: number;
  /** Public beam geometry for the tick it is firing, else `null` (GDD §4.1).
   *  The sim's raycast already finds the nearest hit for damage/mining; this
   *  exposes it so the renderer stops the beam at what it strikes. */
  beam: Beam | null;
}

/** A minable asteroid — the economy (GDD §2.3, §5.5). */
export interface Asteroid {
  readonly id: number;
  pos: Vec2;
  radius: number;
  /** Ore remaining inside; mining draws this down to 0, then it bursts. */
  ore: number;
  /** Ore the asteroid held when spawned; crack stage is a fraction of this. */
  maxOre: number;
  /** Visible crack stage 0..2 (GDD §5.5, three stages). Art reads this. */
  crackStage: number;
  /** Fractional ore mined but not yet emitted as a whole chunk. */
  mineBuffer: number;
}

/** A drifting ore chunk, tractor-collected by proximity (GDD §2.3). */
export interface OreChunk {
  readonly id: number;
  pos: Vec2;
  vel: Vec2;
  /** Ore value carried. */
  amount: number;
  radius: number;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/** Rectangular play bounds; the ring of planets and the field sit inside. */
export interface Bounds {
  width: number;
  height: number;
}

/** The complete simulation state for one match at one tick. Plain data. */
export interface World {
  /** Elapsed sim time, seconds. */
  time: number;
  /** Integer tick counter (increments once per `step`). */
  tick: number;
  /** mulberry32 state as a bare uint32 — serializable RNG (see module doc). */
  rngState: number;
  /** Monotonic id allocator for spawned entities (chunks, future turrets). */
  nextEntityId: number;
  ships: Ship[];
  asteroids: Asteroid[];
  chunks: OreChunk[];
  bounds: Bounds;
}

// ---------------------------------------------------------------------------
// Seeded RNG over explicit state (ratified mulberry32, @shared/types)
// ---------------------------------------------------------------------------

/**
 * Draw one float in [0, 1) and return it with the advanced state. Pure: the
 * caller threads `state` explicitly so the RNG lives in the serializable world
 * tree instead of a closure. Uses the ratified mulberry32 algorithm by seeding
 * a fresh instance at `state` and reading its next output — identical sequence,
 * no hidden state.
 */
export function advanceRng(state: number): { value: number; state: number } {
  // mulberry32's internal step: state += 0x6d2b79f5, then mix. We reproduce it
  // by advancing the shared implementation one step from `state`.
  const next = (state + 0x6d2b79f5) | 0;
  const value = mulberry32(state).next();
  return { value, state: next >>> 0 };
}

/** Draw an integer in [min, max] inclusive, deterministically. Reserved for
 *  wave spawning (post-day-1, GDD §2.3); exported so it is part of the RNG API. */
export function rngInt(state: number, min: number, max: number): { value: number; state: number } {
  const r = advanceRng(state);
  return { value: min + Math.floor(r.value * (max - min + 1)), state: r.state };
}

/** Draw a float in [min, max), deterministically. */
function rngRange(state: number, min: number, max: number): { value: number; state: number } {
  const r = advanceRng(state);
  return { value: min + r.value * (max - min), state: r.state };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** One player's lobby choice for a fresh match. */
export interface PlayerSpec {
  readonly id: PlayerId;
  readonly shipClass: ShipClass;
}

/** Match-creation parameters. All deterministic given `seed`. */
export interface WorldConfig {
  readonly seed: number;
  readonly players: readonly PlayerSpec[];
  /** Play bounds (world units). */
  readonly bounds?: Bounds;
  /** How many asteroids to place in the opening field (day-1 static field;
   *  timed waves land later). */
  readonly asteroidCount?: number;
}

/** Build a ship at a spawn point with class-derived stats (GDD §2.11, §2.8). */
function makeShip(spec: PlayerSpec, pos: Vec2): Ship {
  const stats = SHIP_STATS[spec.shipClass];
  return {
    id: spec.id,
    shipClass: spec.shipClass,
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    home: { x: pos.x, y: pos.y },
    angle: 0,
    hull: stats.hull,
    maxHull: stats.hull,
    cargo: 0,
    cargoCap: Math.max(CARGO_BASE, stats.cargo),
    banked: STARTING_ORE,
    alive: true,
    respawnTimer: 0,
    spawnProtect: SPAWN_PROTECTION_S,
    radius: SHIP_RADIUS,
    beam: null,
  };
}

/**
 * Construct a fresh, deterministic match world. Ships spawn evenly around a
 * ring (GDD §2.1 "planets placed in a ring"); asteroids scatter in the central
 * field from the seeded RNG. Same config ⇒ byte-identical world.
 */
export function createWorld(config: WorldConfig): World {
  const bounds: Bounds = config.bounds ?? { width: 1920, height: 1920 };
  const cx = bounds.width / 2;
  const cy = bounds.height / 2;
  const ringRadius = Math.min(bounds.width, bounds.height) * 0.42;

  // Ships around the ring, one per lobby slot — deterministic, no RNG.
  const ships: Ship[] = config.players.map((spec, i) => {
    const theta = (2 * Math.PI * i) / Math.max(1, config.players.length);
    const pos = { x: cx + Math.cos(theta) * ringRadius, y: cy + Math.sin(theta) * ringRadius };
    const ship = makeShip(spec, pos);
    // Face inward toward the field so the opening read is legible.
    ship.angle = Math.atan2(cy - pos.y, cx - pos.x);
    return ship;
  });

  // Asteroid field: scatter within the central disc using the seeded RNG.
  const count = config.asteroidCount ?? 60;
  const fieldRadius = ringRadius * 0.7;
  const asteroids: Asteroid[] = [];
  let rng = config.seed >>> 0;
  for (let i = 0; i < count; i++) {
    let r = rngRange(rng, 0, fieldRadius);
    const radius = r.value;
    rng = r.state;
    r = rngRange(rng, 0, 2 * Math.PI);
    const angle = r.value;
    rng = r.state;
    r = rngRange(rng, ASTEROID.minRadius, ASTEROID.maxRadius);
    const rockRadius = r.value;
    rng = r.state;
    const oreDraw = rngRange(rng, ASTEROID.minOre, ASTEROID.maxOre);
    const ore = oreDraw.value;
    rng = oreDraw.state;

    asteroids.push({
      id: i,
      pos: { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius },
      radius: rockRadius,
      ore,
      maxOre: ore,
      crackStage: 0,
      mineBuffer: 0,
    });
  }

  return {
    time: 0,
    tick: 0,
    rngState: rng,
    nextEntityId: count, // asteroid ids used [0, count); chunks continue from here
    ships,
    asteroids,
    chunks: [],
    bounds,
  };
}
