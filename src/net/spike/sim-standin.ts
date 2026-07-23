/**
 * src/net/spike/sim-standin.ts — a representative stand-in sim for the day-0
 * tick-rate benchmark (GDD §4.2 spike; risk 4).
 *
 * This is NOT the real simulation (that is the Gameplay Engineer's, in
 * `src/sim/`). It is a faithful-enough workload so the benchmark measures a
 * realistic per-tick cost rather than an empty loop: the same shapes the real
 * sim will pay for every tick per GDD §4.1 —
 *   • Euler integration with drag for 8 ships and up to 64 projectiles,
 *   • a uniform-grid spatial hash (broad phase, cell ≈ 2× max radius),
 *   • narrow-phase circle tests (dx² + dy² < (r1+r2)², no square roots),
 *   • one segment-vs-circle beam raycast per ship against nearby asteroids,
 *   • turrets firing pooled projectiles at the nearest ship.
 * Entity counts are the GDD budget (§4.3): ~200 asteroids, 8 ships, 32 turrets
 * (4 × 8 planets), 64 projectiles.
 *
 * Deterministic (mulberry32-seeded, no Math.random) so the workload is stable
 * run-to-run. A running checksum defeats dead-code elimination. Pure module,
 * no enums — type-checks strict and runs under `node --experimental-strip-types`.
 */

import type { ShipSnap, ProjSnap } from './snapshot';

export interface SimConfig {
  asteroids: number;
  ships: number;
  turrets: number;
  maxProjectiles: number;
  /** Square map edge length in world units. */
  mapSize: number;
  /** Max collision radius; sets the spatial-hash cell size (≈ 2× this). */
  maxRadius: number;
}

/** GDD §4.3 entity budget. */
export const DEFAULT_SIM: SimConfig = {
  asteroids: 200,
  ships: 8,
  turrets: 32,
  maxProjectiles: 64,
  mapSize: 4000,
  maxRadius: 40,
};

export interface StandInSim {
  /** Advance the simulation by one fixed timestep. */
  step(): void;
  /** Accumulated work checksum — read it so the optimizer can't elide the sim. */
  checksum(): number;
  /** Live ship records for a snapshot, quantized to wire integers. */
  snapshotShips(): ShipSnap[];
  /** Live projectile records for a snapshot, quantized to wire integers. */
  snapshotProjectiles(): ProjSnap[];
}

// Local deterministic PRNG (mirrors @shared mulberry32; inlined to keep this
// file dependency-free and runnable under node --experimental-strip-types).
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 60; // sim integrates at the fixed 60 Hz timestep (GDD §4.1)
const SHIP_RADIUS = 12;
const PROJ_RADIUS = 3;
const PROJ_SPEED = 800;
const BEAM_LEN = 300;

export function createStandInSim(
  cfg: SimConfig = DEFAULT_SIM,
  seed = 0x1234abcd,
): StandInSim {
  const rng = makeRng(seed);
  const half = cfg.mapSize / 2;
  const cell = cfg.maxRadius * 2;
  const cols = Math.ceil(cfg.mapSize / cell) + 1;

  // --- Asteroids (mostly static, slow drift) ---
  const na = cfg.asteroids;
  const ax = new Float64Array(na);
  const ay = new Float64Array(na);
  const ar = new Float64Array(na);
  for (let i = 0; i < na; i++) {
    ax[i] = (rng() - 0.5) * cfg.mapSize;
    ay[i] = (rng() - 0.5) * cfg.mapSize;
    ar[i] = 12 + rng() * (cfg.maxRadius - 12);
  }

  // --- Ships ---
  const ns = cfg.ships;
  const sx = new Float64Array(ns);
  const sy = new Float64Array(ns);
  const svx = new Float64Array(ns);
  const svy = new Float64Array(ns);
  const sHeading = new Float64Array(ns);
  const sHull = new Float64Array(ns);
  for (let i = 0; i < ns; i++) {
    const ang = (i / ns) * Math.PI * 2;
    sx[i] = Math.cos(ang) * half * 0.7;
    sy[i] = Math.sin(ang) * half * 0.7;
    svx[i] = 0;
    svy[i] = 0;
    sHeading[i] = ang;
    sHull[i] = 70;
  }

  // --- Turrets (static; 32 = 4 per planet × 8 planets) ---
  const nt = cfg.turrets;
  const tx = new Float64Array(nt);
  const ty = new Float64Array(nt);
  const tCooldown = new Float64Array(nt);
  for (let i = 0; i < nt; i++) {
    tx[i] = (rng() - 0.5) * cfg.mapSize;
    ty[i] = (rng() - 0.5) * cfg.mapSize;
    tCooldown[i] = rng() * 2;
  }

  // --- Projectile pool ---
  const np = cfg.maxProjectiles;
  const px = new Float64Array(np);
  const py = new Float64Array(np);
  const pvx = new Float64Array(np);
  const pvy = new Float64Array(np);
  const pActive = new Uint8Array(np);
  const pOwner = new Uint8Array(np);

  // Spatial hash buckets, reused each tick (zero per-tick allocation intent).
  const grid = new Map<number, number[]>();
  const keyOf = (x: number, y: number): number => {
    const cx = Math.floor((x + half) / cell);
    const cy = Math.floor((y + half) / cell);
    return cy * cols + cx;
  };

  let check = 0;

  function spawnProjectile(fromX: number, fromY: number, tvx: number, tvy: number, owner: number): void {
    for (let j = 0; j < np; j++) {
      if (pActive[j] === 0) {
        px[j] = fromX;
        py[j] = fromY;
        pvx[j] = tvx;
        pvy[j] = tvy;
        pOwner[j] = owner & 0xff;
        pActive[j] = 1;
        return;
      }
    }
  }

  function step(): void {
    // 1) Integrate ships: a deterministic orbiting control input + drag.
    for (let i = 0; i < ns; i++) {
      const h = sHeading[i]! + 0.6 * DT; // slow turn
      sHeading[i] = h;
      const thrust = 220;
      svx[i] = (svx[i]! + Math.cos(h) * thrust * DT) * 0.99;
      svy[i] = (svy[i]! + Math.sin(h) * thrust * DT) * 0.99;
      let nx = sx[i]! + svx[i]! * DT;
      let ny = sy[i]! + svy[i]! * DT;
      if (nx > half || nx < -half) {
        svx[i] = -svx[i]!;
        nx = Math.max(-half, Math.min(half, nx));
      }
      if (ny > half || ny < -half) {
        svy[i] = -svy[i]!;
        ny = Math.max(-half, Math.min(half, ny));
      }
      sx[i] = nx;
      sy[i] = ny;
    }

    // 2) Turrets fire at nearest ship when off cooldown.
    for (let i = 0; i < nt; i++) {
      tCooldown[i] = tCooldown[i]! - DT;
      if (tCooldown[i]! > 0) continue;
      tCooldown[i] = 1.2;
      let best = -1;
      let bestD = Infinity;
      for (let s = 0; s < ns; s++) {
        const dx = sx[s]! - tx[i]!;
        const dy = sy[s]! - ty[i]!;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best >= 0) {
        const dx = sx[best]! - tx[i]!;
        const dy = sy[best]! - ty[i]!;
        const inv = 1 / Math.sqrt(dx * dx + dy * dy || 1);
        spawnProjectile(tx[i]!, ty[i]!, dx * inv * PROJ_SPEED, dy * inv * PROJ_SPEED, best);
      }
    }

    // 3) Integrate projectiles; despawn out of bounds.
    for (let j = 0; j < np; j++) {
      if (pActive[j] === 0) continue;
      px[j] = px[j]! + pvx[j]! * DT;
      py[j] = py[j]! + pvy[j]! * DT;
      if (px[j]! > half || px[j]! < -half || py[j]! > half || py[j]! < -half) {
        pActive[j] = 0;
      }
    }

    // 4) Rebuild spatial hash for asteroids (broad phase).
    for (const list of grid.values()) list.length = 0;
    for (let i = 0; i < na; i++) {
      const k = keyOf(ax[i]!, ay[i]!);
      let list = grid.get(k);
      if (list === undefined) {
        list = [];
        grid.set(k, list);
      }
      list.push(i);
    }

    // 5) Narrow phase: ships & projectiles vs nearby asteroids (3×3 cells).
    for (let s = 0; s < ns; s++) {
      const cx = Math.floor((sx[s]! + half) / cell);
      const cy = Math.floor((sy[s]! + half) / cell);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const list = grid.get((cy + oy) * cols + (cx + ox));
          if (list === undefined) continue;
          for (const ai of list) {
            const dx = sx[s]! - ax[ai]!;
            const dy = sy[s]! - ay[ai]!;
            const rr = SHIP_RADIUS + ar[ai]!;
            if (dx * dx + dy * dy < rr * rr) check += 1;
          }
        }
      }
    }
    for (let j = 0; j < np; j++) {
      if (pActive[j] === 0) continue;
      const cx = Math.floor((px[j]! + half) / cell);
      const cy = Math.floor((py[j]! + half) / cell);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const list = grid.get((cy + oy) * cols + (cx + ox));
          if (list === undefined) continue;
          for (const ai of list) {
            const dx = px[j]! - ax[ai]!;
            const dy = py[j]! - ay[ai]!;
            const rr = PROJ_RADIUS + ar[ai]!;
            if (dx * dx + dy * dy < rr * rr) {
              pActive[j] = 0;
              check += 2;
            }
          }
        }
      }
    }

    // 6) Beam raycast: one segment-vs-circle sweep per ship against nearby
    //    asteroids (exact, immune to tunnelling — GDD §4.1).
    for (let s = 0; s < ns; s++) {
      const bx = Math.cos(sHeading[s]!);
      const by = Math.sin(sHeading[s]!);
      const ex = sx[s]! + bx * BEAM_LEN;
      const ey = sy[s]! + by * BEAM_LEN;
      const cx = Math.floor((sx[s]! + half) / cell);
      const cy = Math.floor((sy[s]! + half) / cell);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const list = grid.get((cy + oy) * cols + (cx + ox));
          if (list === undefined) continue;
          for (const ai of list) {
            // Closest point on segment (start→end) to asteroid centre.
            const abx = ex - sx[s]!;
            const aby = ey - sy[s]!;
            const apx = ax[ai]! - sx[s]!;
            const apy = ay[ai]! - sy[s]!;
            const len2 = abx * abx + aby * aby || 1;
            let t = (apx * abx + apy * aby) / len2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = sx[s]! + abx * t;
            const qy = sy[s]! + aby * t;
            const dx = ax[ai]! - qx;
            const dy = ay[ai]! - qy;
            if (dx * dx + dy * dy < ar[ai]! * ar[ai]!) check += 4;
          }
        }
      }
    }
  }

  function quant(v: number): number {
    // Clamp into int16 range for the wire; the sim keeps full-precision floats.
    const q = v | 0;
    return q > 32767 ? 32767 : q < -32768 ? -32768 : q;
  }

  function snapshotShips(): ShipSnap[] {
    const out: ShipSnap[] = [];
    for (let i = 0; i < ns; i++) {
      out.push({
        id: i,
        posX: quant(sx[i]!),
        posY: quant(sy[i]!),
        velX: quant(svx[i]!),
        velY: quant(svy[i]!),
        heading: Math.floor(((sHeading[i]! % (Math.PI * 2)) / (Math.PI * 2)) * 65535) & 0xffff,
        aim: 0,
        hull: sHull[i]! & 0xff,
        flags: 0b101,
      });
    }
    return out;
  }

  function snapshotProjectiles(): ProjSnap[] {
    const out: ProjSnap[] = [];
    for (let j = 0; j < np; j++) {
      if (pActive[j] === 0) continue;
      out.push({ id: j, posX: quant(px[j]!), posY: quant(py[j]!), meta: pOwner[j]! & 0xff });
    }
    return out;
  }

  return {
    step,
    checksum: () => check,
    snapshotShips,
    snapshotProjectiles,
  };
}
