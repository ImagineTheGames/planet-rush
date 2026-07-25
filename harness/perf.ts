/**
 * harness/perf.ts — the entity-count stress scene and frame-time capture.
 * OWNER: QA Agent (GDD §4.3, §4.6 M5).
 *
 * GDD §4.3 states the performance budget as a scene, not a feeling:
 *
 * > "8 ships, up to 32 turrets (design cap 4 × 8 planets), ~200 asteroids, hundreds
 * > of projectiles at 60 fps on integrated graphics … **Mobile gate:** 60 fps on the
 * > developer's own phone … with a 30 fps floor on a 3-year-old mid-range Android."
 *
 * And GDD §4.3b risk 5 says the quiet part out loud: those numbers are "a claim,
 * not a result". This file turns the claim into a measurement in two halves.
 *
 * **This half — the simulation.** {@link stressWorld} builds the §4.3 scene at
 * full entity counts and {@link captureFrameTimes} steps it, timing every tick.
 * That isolates the sim's share of the frame: it runs identically in the browser,
 * the match server, and here (GDD §4.1), so a sim regression is measurable
 * without a GPU, in CI, on any machine.
 *
 * **The other half — the renderer.** Frame time on real hardware belongs to a
 * real browser; it lives in `tests/perf/frame-time.spec.ts`, which samples
 * `requestAnimationFrame` deltas from the shipped bundle. A software-WebGL CI
 * runner cannot answer the 60 fps question, so that spec *measures* everywhere
 * and *gates* only when `PERF_GATE=1` says the host is real hardware.
 *
 * **The budget split.** A frame is 16.67 ms at 60 fps. The sim does not get all
 * of it — the renderer, the HUD, and the browser's own compositing need the rest.
 * QA's working split is {@link SIM_FRAME_SHARE}: the sim may spend a quarter of
 * the frame, and the gate below is stated against that share rather than against
 * the whole frame, so a "passing" sim can never quietly eat the renderer's budget.
 */

import { ShipClass } from '@shared/types';
import type { Projectile, World } from '../src/sim';
import {
  CHUNK,
  PROJECTILE,
  SHIELD,
  TURRET,
  createWorld,
  step,
  turretMountPos,
} from '../src/sim';
import type { Inputs } from '../src/sim';

// ---------------------------------------------------------------------------
// The budget (GDD §4.3)
// ---------------------------------------------------------------------------

/** Desktop gate: 60 fps ⇒ 16.67 ms per frame. */
export const FRAME_BUDGET_60_MS = 1000 / 60;

/** Mobile floor: "a 30 fps floor on a 3-year-old mid-range Android" ⇒ 33.3 ms. */
export const FRAME_BUDGET_30_MS = 1000 / 30;

/**
 * The share of a frame the *simulation* may spend. The renderer, HUD, input and
 * compositing own the rest. A quarter is QA's stated working split, not a GDD
 * number — it is written here so the gate has a documented basis instead of a
 * round number someone picked. TUNABLE
 */
export const SIM_FRAME_SHARE = 0.25;

/** The sim's per-tick ceiling on the desktop gate: 4.17 ms. */
export const SIM_BUDGET_60_MS = FRAME_BUDGET_60_MS * SIM_FRAME_SHARE;

/** The sim's per-tick ceiling on the mobile floor: 8.33 ms. */
export const SIM_BUDGET_30_MS = FRAME_BUDGET_30_MS * SIM_FRAME_SHARE;

/** The GDD §4.3 scene, as numbers. Entity counts are unchanged for mobile —
 *  "the same pooling and batching disciplines are what make the phone target
 *  feasible" (GDD §4.3). */
export const STRESS_SCENE = {
  ships: 8,
  /** 4 turrets × 8 planets — the design cap, all of it built. */
  turrets: TURRET.capPerPlanet * 8,
  /** 2 shields × 8 planets — the design cap, all of it built. */
  shields: SHIELD.capPerPlanet * 8,
  asteroids: 200,
  /**
   * "Hundreds of projectiles" is a budget line, not a reachable state: 32
   * turrets firing every `fireInterval` with a `life` of `range / speed` put
   * only ~22 shots in the air at once. The scene therefore *seeds* the pool to
   * the budget number, so the profile answers the question GDD §4.3 actually
   * asks — "can we afford hundreds?" — rather than the easier one the caps
   * happen to allow.
   */
  projectiles: 300,
  /** Loose ore chunks drifting under tractor influence. */
  chunks: 120,
} as const;

// ---------------------------------------------------------------------------
// The stress scene
// ---------------------------------------------------------------------------

/** Knobs for a scene that is deliberately heavier or lighter than the budget. */
export interface StressOptions {
  readonly seed?: number;
  readonly asteroids?: number;
  readonly projectiles?: number;
  readonly chunks?: number;
  /** Build the full turret/shield caps on every planet. Default true. */
  readonly maxDefenses?: boolean;
}

/**
 * Build the GDD §4.3 scene: a full 8-planet ring, every planet at its turret and
 * shield cap, ~200 asteroids, a seeded drift of ore chunks, and a projectile pool
 * filled to the budget.
 *
 * Defenses and projectiles are placed **directly into the world's plain data**
 * rather than bought through the action stream. That is deliberate: this is a
 * profiling scene, and spending twelve minutes of sim time earning 32 turrets
 * would measure the economy rather than the frame. Every entity written here is
 * constructed exactly as the sim constructs it (`turretMountPos` for the mount
 * ring, `PROJECTILE` for shot damage/life), so the step treats the scene as its
 * own.
 */
export function stressWorld(options: StressOptions = {}): World {
  const world = createWorld({
    seed: options.seed ?? 1,
    players: Array.from({ length: STRESS_SCENE.ships }, (_, id) => ({
      id,
      shipClass: ShipClass.Vanguard,
    })),
    asteroidCount: options.asteroids ?? STRESS_SCENE.asteroids,
  });

  if (options.maxDefenses !== false) {
    for (const planet of world.planets) {
      for (let slot = 0; slot < TURRET.capPerPlanet; slot++) {
        const pos = turretMountPos(planet, slot);
        planet.turrets.push({
          id: world.nextEntityId++,
          owner: planet.owner,
          slot,
          pos: { x: pos.x, y: pos.y },
          radius: TURRET.radius,
          hp: TURRET.hp,
          maxHp: TURRET.hp,
          angle: planet.angle,
          cooldown: 0,
          targetId: null,
        });
      }
      for (let i = 0; i < SHIELD.capPerPlanet; i++) {
        planet.shields.push({ id: world.nextEntityId++, hp: SHIELD.hp, maxHp: SHIELD.hp, radius: SHIELD.radius });
      }
      // Spawn protection would make every core untargetable for the first ten
      // seconds, so the turrets would have nothing to shoot at during the
      // profile. The scene starts as a mid-match snapshot.
      planet.spawnProtect = 0;
    }
  }

  for (const ship of world.ships) ship.spawnProtect = 0;

  topUpProjectiles(world, options.projectiles ?? STRESS_SCENE.projectiles);
  topUpChunks(world, options.chunks ?? STRESS_SCENE.chunks);
  return world;
}

/**
 * Bring the shot pool back up to `target` live projectiles, scattered on a
 * deterministic ring around the arena centre and travelling across it — the
 * worst case for the broad phase, because every one of them keeps moving
 * through occupied cells.
 *
 * **Top-up, not one-shot seeding.** Shots expire, hit things, and leave the
 * arena; a pool seeded once is empty within two seconds and the profile would
 * then be measuring an *empty* scene while reporting a full one. Sustaining the
 * count is what makes "hundreds of projectiles at 60 fps" (GDD §4.3) the thing
 * actually measured. Inactive slots are re-used before the array grows, exactly
 * as the sim pools them (GDD §4.3, `sim/state.ts`).
 */
export function topUpProjectiles(world: World, target: number): void {
  const cx = world.bounds.width / 2;
  const cy = world.bounds.height / 2;
  let live = 0;
  for (const p of world.projectiles) if (p.active) live++;

  let slot = 0;
  for (let i = live; i < target; i++) {
    const theta = (2 * Math.PI * i) / Math.max(1, target);
    const r = world.fieldRadius * (0.3 + 0.7 * ((i % 7) / 7));
    const fresh = {
      active: true,
      owner: i % STRESS_SCENE.ships,
      pos: { x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r },
      vel: { x: -Math.cos(theta) * TURRET.projectileSpeed, y: -Math.sin(theta) * TURRET.projectileSpeed },
      damage: PROJECTILE.damage,
      radius: PROJECTILE.radius,
      // Staggered lifetimes. A pool refilled all at once dies all at once, and
      // the scene would then flicker between full and empty every ~20 ticks
      // instead of holding the count the profile claims to be measuring.
      life: PROJECTILE.life * (0.15 + 0.85 * ((i % 11) / 10)),
    };
    while (slot < world.projectiles.length && world.projectiles[slot]!.active) slot++;
    const reused = world.projectiles[slot];
    if (reused) {
      Object.assign(reused, fresh);
      slot++;
    } else {
      world.projectiles.push({ id: world.nextEntityId++, ...fresh } satisfies Projectile);
    }
  }
}

/** Bring the drifting-chunk count back up to `target` — the tractor pass's load
 *  (GDD §2.3). Chunks are collected as ships fly over them, so this sustains the
 *  count for the same reason {@link topUpProjectiles} does. */
export function topUpChunks(world: World, target: number): void {
  const cx = world.bounds.width / 2;
  const cy = world.bounds.height / 2;
  for (let i = world.chunks.length; i < target; i++) {
    const theta = (2 * Math.PI * i) / Math.max(1, target);
    const r = world.fieldRadius * (0.2 + 0.8 * ((i % 5) / 5));
    world.chunks.push({
      id: world.nextEntityId++,
      pos: { x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r },
      vel: { x: Math.cos(theta) * CHUNK.ejectSpeed, y: Math.sin(theta) * CHUNK.ejectSpeed },
      amount: CHUNK.ore,
      radius: CHUNK.radius,
    });
  }
}

// ---------------------------------------------------------------------------
// Frame-time capture
// ---------------------------------------------------------------------------

/** A frame-time distribution, in milliseconds. Percentiles, not just a mean:
 *  60 fps is a promise about the *worst* frames, and a mean hides them. */
export interface FrameTimes {
  readonly samples: number;
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  /** Total wall-clock ms spent stepping. */
  readonly totalMs: number;
  /** Ticks stepped per wall-clock second — how many times real time the sim runs. */
  readonly ticksPerSecond: number;
}

/** Everything one entity-count profile produced. */
export interface PerfProfile {
  readonly label: string;
  readonly counts: {
    readonly ships: number;
    readonly asteroids: number;
    readonly chunks: number;
    readonly turrets: number;
    readonly shields: number;
    readonly liveProjectiles: number;
  };
  readonly frames: FrameTimes;
  /** Sim ms per tick against its share of a 60 fps frame (`SIM_BUDGET_60_MS`). */
  readonly budget60: { readonly p95Ratio: number; readonly pass: boolean };
  /** The same against the 30 fps mobile floor. */
  readonly budget30: { readonly p95Ratio: number; readonly pass: boolean };
}

/** Nearest-rank percentile of a pre-sorted array. */
function pct(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i]!;
}

/**
 * Step `world` `ticks` times with `inputs`, timing every tick individually.
 *
 * The clock is read outside `step`, never inside it — the sim has no wall clock
 * and this file is not about to give it one (GDD §4.1). `warmup` ticks run
 * untimed first so JIT compilation lands in the warm-up rather than in the
 * measurement.
 */
export function captureFrameTimes(
  world: World,
  ticks: number,
  inputs: Inputs = [],
  warmup = 120,
  /** Runs before each step, warm-up included, to hold the scene at its entity
   *  counts (see {@link topUpProjectiles}). Untimed — it is scene maintenance,
   *  not simulation, and must not be charged to the frame. */
  sustain?: (world: World) => void,
): FrameTimes {
  for (let i = 0; i < warmup; i++) {
    sustain?.(world);
    step(world, inputs);
  }

  const samples = new Float64Array(ticks);
  const startedAt = performance.now();
  let maintenanceMs = 0;
  for (let i = 0; i < ticks; i++) {
    if (sustain) {
      const m0 = performance.now();
      sustain(world);
      maintenanceMs += performance.now() - m0;
    }
    const t0 = performance.now();
    step(world, inputs);
    samples[i] = performance.now() - t0;
  }
  const totalMs = performance.now() - startedAt - maintenanceMs;

  const sorted = Array.from(samples).sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    samples: ticks,
    mean: ticks > 0 ? sum / ticks : 0,
    median: pct(sorted, 0.5),
    p95: pct(sorted, 0.95),
    p99: pct(sorted, 0.99),
    max: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
    totalMs,
    ticksPerSecond: totalMs > 0 ? (ticks / totalMs) * 1000 : 0,
  };
}

/** Build the scene, profile it, and score it against both gates. */
export function profile(label: string, ticks = 600, options: StressOptions = {}): PerfProfile {
  const world = stressWorld(options);
  const shots = options.projectiles ?? STRESS_SCENE.projectiles;
  const chunks = options.chunks ?? STRESS_SCENE.chunks;

  // Counted on the scene as *built*, before a single tick. Counting afterwards
  // would report whatever survived the last step — which is the tail of the
  // measurement, not the scene the measurement was taken on.
  let turrets = 0;
  let shields = 0;
  for (const p of world.planets) {
    turrets += p.turrets.length;
    shields += p.shields.length;
  }
  let live = 0;
  for (const p of world.projectiles) if (p.active) live++;
  const asteroids = world.asteroids.length;
  const chunkCount = world.chunks.length;

  const frames = captureFrameTimes(world, ticks, [], 120, (w) => {
    topUpProjectiles(w, shots);
    topUpChunks(w, chunks);
  });

  return {
    label,
    counts: {
      ships: world.ships.length,
      asteroids,
      chunks: chunkCount,
      turrets,
      shields,
      liveProjectiles: live,
    },
    frames,
    budget60: { p95Ratio: frames.p95 / SIM_BUDGET_60_MS, pass: frames.p95 <= SIM_BUDGET_60_MS },
    budget30: { p95Ratio: frames.p95 / SIM_BUDGET_30_MS, pass: frames.p95 <= SIM_BUDGET_30_MS },
  };
}

/** The standard profile set: the budget scene, and two scaling points either
 *  side of it. Three points make a regression legible as a *slope* rather than
 *  as one number that moved. */
export function profileSuite(ticks = 600): PerfProfile[] {
  return [
    profile('half budget', ticks, { asteroids: 100, projectiles: 150, chunks: 60 }),
    profile('GDD §4.3 budget', ticks),
    profile('2× budget', ticks, { asteroids: 400, projectiles: 600, chunks: 240 }),
  ];
}
