/**
 * harness/hash.ts — the final state hash. OWNER: QA Agent (GDD §3.8, §4.8).
 *
 * The determinism contract is one sentence — "same inputs, same final state
 * hash" (GDD §4.1, §4.8) — and this file is the second half of it. A hash is
 * only as strong as the state it covers, so this one covers **the whole world
 * tree**: every ship field, every asteroid, every chunk, every planet with its
 * turrets, shields and build jobs, every live projectile, and the match clock
 * itself.
 *
 * That is deliberately a superset of `@platform/freeze`'s `hashWorld`, which
 * fingerprints only the *placement-relevant* fields a screenshot depends on.
 * Both are correct for their jobs; this one is the one a replay failure must not
 * be able to slip past. A drift in a turret's cooldown, a shield's HP, or the
 * elimination order is exactly the kind of desync that would surface online as
 * "the server thinks I'm dead" — so it is in here.
 *
 * Algorithm: FNV-1a over a canonical field order, with every float folded
 * through `Math.round(n * 1e6)` first. That quantisation is the one deliberate
 * blind spot: it absorbs last-bit float noise (which no engine guarantees away)
 * while still catching any divergence larger than a micro-unit — and a sim that
 * diverges only in the seventh decimal has not diverged in any way a match can
 * observe. {@link stateDigest} is the debugging counterpart: when a hash does
 * differ, it says *where* without dumping a megabyte of world.
 *
 * Pure, allocation-light, and DOM-free. It consumes the sim's public surface
 * only — this file never edits `src/sim/`.
 */

import type { Planet, Projectile, Ship, World } from '../src/sim';

/** Quantisation applied to every float before hashing (see the module note). */
const MICRO = 1e6;

/** FNV-1a 32-bit accumulator over the canonical field stream. */
class Fnv {
  private h = 0x811c9dc5; // FNV-1a offset basis

  /** Fold one number in: quantise to a micro-unit, then mix four bytes. */
  num(n: number): void {
    let x = Math.round(n * MICRO) | 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= x & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
      x >>>= 8;
    }
  }

  /** Fold a flag in. Booleans are 1/0 so the stream stays numeric. */
  flag(b: boolean): void {
    this.num(b ? 1 : 0);
  }

  /** Fold a string in, byte by byte — enum values (ship class, phase) are
   *  strings in this codebase and they are part of the state. */
  str(s: string): void {
    for (let i = 0; i < s.length; i++) {
      this.h ^= s.charCodeAt(i) & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
    }
  }

  /** The 8-hex-digit fingerprint. */
  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}

/** Fold one ship's complete state (GDD §2.5, §2.11 — tiers are match state). */
function mixShip(f: Fnv, s: Ship): void {
  f.num(s.id);
  f.str(s.shipClass);
  f.num(s.tiers.power);
  f.num(s.tiers.engine);
  f.num(s.tiers.cargo);
  f.num(s.tiers.hull);
  f.num(s.pos.x);
  f.num(s.pos.y);
  f.num(s.vel.x);
  f.num(s.vel.y);
  f.num(s.angle);
  f.num(s.hull);
  f.num(s.maxHull);
  f.num(s.cargo);
  f.num(s.cargoCap);
  f.num(s.banked);
  f.flag(s.alive);
  f.num(s.respawnTimer);
  f.num(s.spawnProtect);
  f.flag(s.eliminated);
  // The firing tell is per-tick, but it is *state the renderer and the snapshot
  // both read*, so a replay that fires on a different tick must fail.
  f.flag(s.firing);
}

/** Fold one planet, its defenses, and everything under construction. */
function mixPlanet(f: Fnv, p: Planet): void {
  f.num(p.id);
  f.num(p.owner);
  f.num(p.pos.x);
  f.num(p.pos.y);
  f.num(p.coreHp);
  f.num(p.maxCoreHp);
  f.flag(p.alive);
  f.num(p.deathTime);
  f.num(p.spawnProtect);
  f.num(p.sinceDamage);
  f.flag(p.repairing);
  f.num(p.turrets.length);
  for (const t of p.turrets) {
    f.num(t.id);
    f.num(t.slot);
    f.num(t.hp);
    f.num(t.angle);
    f.num(t.cooldown);
    f.num(t.targetId ?? -1);
  }
  f.num(p.shields.length);
  for (const s of p.shields) {
    f.num(s.id);
    f.num(s.hp);
    f.num(s.maxHp);
  }
  f.num(p.builds.length);
  for (const b of p.builds) {
    f.num(b.id);
    f.str(b.kind);
    f.num(b.slot);
    f.num(b.remaining);
  }
}

/** Fold one projectile. The pool is dense with sparse liveness (sim/state.ts),
 *  so the `active` flag is hashed for every slot — a shot that despawned one
 *  tick early is a divergence. */
function mixProjectile(f: Fnv, p: Projectile): void {
  f.num(p.id);
  f.flag(p.active);
  if (!p.active) return;
  f.num(p.owner);
  f.num(p.pos.x);
  f.num(p.pos.y);
  f.num(p.vel.x);
  f.num(p.vel.y);
  f.num(p.damage);
  f.num(p.life);
}

/**
 * The final state hash: a stable 8-hex-digit fingerprint of the *entire* world.
 *
 * Two worlds that are deep-equal hash identically; two that differ anywhere
 * beyond a micro-unit of float noise almost certainly do not. This is the value
 * the CI replay test compares (GDD §4.8).
 */
export function hashState(world: World): string {
  const f = new Fnv();

  f.num(world.tick);
  f.num(world.time);
  f.num(world.rngState);
  f.num(world.nextEntityId);

  f.num(world.ships.length);
  for (const s of world.ships) mixShip(f, s);

  f.num(world.asteroids.length);
  for (const a of world.asteroids) {
    f.num(a.id);
    f.num(a.pos.x);
    f.num(a.pos.y);
    f.num(a.radius);
    f.num(a.ore);
    f.num(a.maxOre);
    f.num(a.crackStage);
    f.num(a.mineBuffer);
  }

  f.num(world.chunks.length);
  for (const c of world.chunks) {
    f.num(c.id);
    f.num(c.pos.x);
    f.num(c.pos.y);
    f.num(c.vel.x);
    f.num(c.vel.y);
    f.num(c.amount);
  }

  f.num(world.planets.length);
  for (const p of world.planets) mixPlanet(f, p);

  f.num(world.projectiles.length);
  for (const p of world.projectiles) mixProjectile(f, p);

  const m = world.match;
  f.str(m.phase);
  f.num(m.wavesSpawned);
  f.num(m.collapseTime);
  f.num(m.eliminated.length);
  for (const id of m.eliminated) f.num(id);
  f.num(m.winner ?? -1);
  f.num(m.endTime);

  return f.hex();
}

/**
 * Per-subsystem hashes plus a few raw counters. When {@link hashState} differs
 * between a run and its replay, this says *which subsystem* moved — the first
 * question a determinism failure asks, and the one a single 32-bit number cannot
 * answer. Printed by the replay test's failure message and by the harness CLI.
 */
export interface StateDigest {
  readonly hash: string;
  readonly tick: number;
  readonly time: number;
  readonly rngState: number;
  readonly ships: string;
  readonly asteroids: string;
  readonly chunks: string;
  readonly planets: string;
  readonly projectiles: string;
  readonly match: string;
  readonly counts: {
    readonly ships: number;
    readonly asteroids: number;
    readonly chunks: number;
    readonly planets: number;
    readonly liveProjectiles: number;
  };
}

/** Hash one subsystem in isolation (same canonical order as {@link hashState}). */
function sub(mix: (f: Fnv) => void): string {
  const f = new Fnv();
  mix(f);
  return f.hex();
}

/** A per-subsystem breakdown of the state hash — see {@link StateDigest}. */
export function stateDigest(world: World): StateDigest {
  let live = 0;
  for (const p of world.projectiles) if (p.active) live++;

  return {
    hash: hashState(world),
    tick: world.tick,
    time: world.time,
    rngState: world.rngState,
    ships: sub((f) => {
      for (const s of world.ships) mixShip(f, s);
    }),
    asteroids: sub((f) => {
      for (const a of world.asteroids) {
        f.num(a.id);
        f.num(a.pos.x);
        f.num(a.pos.y);
        f.num(a.ore);
        f.num(a.crackStage);
        f.num(a.mineBuffer);
      }
    }),
    chunks: sub((f) => {
      for (const c of world.chunks) {
        f.num(c.id);
        f.num(c.pos.x);
        f.num(c.pos.y);
        f.num(c.amount);
      }
    }),
    planets: sub((f) => {
      for (const p of world.planets) mixPlanet(f, p);
    }),
    projectiles: sub((f) => {
      for (const p of world.projectiles) mixProjectile(f, p);
    }),
    match: sub((f) => {
      f.str(world.match.phase);
      f.num(world.match.wavesSpawned);
      f.num(world.match.collapseTime);
      for (const id of world.match.eliminated) f.num(id);
      f.num(world.match.winner ?? -1);
      f.num(world.match.endTime);
    }),
    counts: {
      ships: world.ships.length,
      asteroids: world.asteroids.length,
      chunks: world.chunks.length,
      planets: world.planets.length,
      liveProjectiles: live,
    },
  };
}

/** The fields of two digests that disagree — the replay test's failure message. */
export function digestDiff(a: StateDigest, b: StateDigest): string[] {
  const out: string[] = [];
  const keys = ['ships', 'asteroids', 'chunks', 'planets', 'projectiles', 'match'] as const;
  for (const k of keys) {
    if (a[k] !== b[k]) out.push(`${k}: ${a[k]} != ${b[k]}`);
  }
  if (a.tick !== b.tick) out.push(`tick: ${a.tick} != ${b.tick}`);
  if (a.rngState !== b.rngState) out.push(`rngState: ${a.rngState} != ${b.rngState}`);
  return out;
}
