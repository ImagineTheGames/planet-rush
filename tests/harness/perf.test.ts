/**
 * tests/harness/perf.test.ts — the sim's half of the performance gate. OWNER:
 * QA Agent (GDD §4.3, §4.3b risk 5, §4.6 M5).
 *
 * GDD §4.3b risk 5 says the entity-count budget is "a claim, not a result". This
 * file turns the simulation's share of that claim into a CI-enforced result: the
 * GDD §4.3 scene is built at full entity counts and stepped, and the frame time
 * is asserted against the sim's share of a 60 fps frame.
 *
 * What it deliberately does **not** assert: frames per second. That belongs to a
 * browser with a GPU (`tests/perf/frame-time.spec.ts`); asserting it here would
 * be measuring a CI runner's SwiftShader, which is not a thing the game ships on.
 *
 * The headroom is the point of the numbers below. At the time of writing the sim
 * costs ~0.05 ms per tick at the full budget — about 1.5% of its 4.17 ms share —
 * so this gate has roughly 60× of margin. It is set to catch a *regression in
 * kind* (an allocation per frame, a lost spatial hash, an O(n²) pass), not to
 * shave microseconds; a CI runner five or ten times slower than a laptop still
 * clears it comfortably.
 */

import { describe, it, expect } from 'vitest';
import {
  FRAME_BUDGET_30_MS,
  FRAME_BUDGET_60_MS,
  SIM_BUDGET_30_MS,
  SIM_BUDGET_60_MS,
  SIM_FRAME_SHARE,
  STRESS_SCENE,
  captureFrameTimes,
  profile,
  stressWorld,
  topUpProjectiles,
} from '../../harness/perf';

/** Ticks per profile in CI. 300 is five seconds of sim time — enough for a
 *  stable p95, short enough that the suite stays fast. */
const TICKS = 300;

describe('the GDD §4.3 stress scene', () => {
  const world = stressWorld();

  it('is the scene the GDD names: 8 ships, 32 turrets, ~200 asteroids', () => {
    expect(world.ships).toHaveLength(STRESS_SCENE.ships);
    expect(world.planets).toHaveLength(8);
    const turrets = world.planets.reduce((n, p) => n + p.turrets.length, 0);
    const shields = world.planets.reduce((n, p) => n + p.shields.length, 0);
    expect(turrets).toBe(STRESS_SCENE.turrets); // 4 × 8 — the design cap, fully built
    expect(shields).toBe(STRESS_SCENE.shields); // 2 × 8
    expect(world.asteroids).toHaveLength(STRESS_SCENE.asteroids);
  });

  it('carries hundreds of live projectiles and a drift of chunks', () => {
    const live = world.projectiles.filter((p) => p.active).length;
    expect(live).toBe(STRESS_SCENE.projectiles);
    expect(STRESS_SCENE.projectiles).toBeGreaterThanOrEqual(200); // "hundreds"
    expect(world.chunks.length).toBe(STRESS_SCENE.chunks);
  });

  it('starts past spawn protection, so the turrets have something to shoot', () => {
    expect(world.planets.every((p) => p.spawnProtect === 0)).toBe(true);
    expect(world.ships.every((s) => s.spawnProtect === 0)).toBe(true);
  });

  it('re-uses pooled projectile slots instead of growing the array forever', () => {
    const w = stressWorld({ projectiles: 50 });
    const beforeLength = w.projectiles.length;
    for (const p of w.projectiles) p.active = false;
    topUpProjectiles(w, 50);
    expect(w.projectiles.filter((p) => p.active)).toHaveLength(50);
    expect(w.projectiles.length).toBe(beforeLength); // pooled, not appended
  });
});

describe('the budget split', () => {
  it('gives the sim a documented share of the frame, not the whole thing', () => {
    expect(SIM_FRAME_SHARE).toBeGreaterThan(0);
    expect(SIM_FRAME_SHARE).toBeLessThan(1);
    expect(SIM_BUDGET_60_MS).toBeCloseTo(FRAME_BUDGET_60_MS * SIM_FRAME_SHARE, 6);
    expect(SIM_BUDGET_30_MS).toBeCloseTo(FRAME_BUDGET_30_MS * SIM_FRAME_SHARE, 6);
  });
});

describe('sim frame time at the GDD §4.3 entity counts', () => {
  it('holds the sim inside its share of a 60 fps frame', () => {
    const p = profile('GDD §4.3 budget', TICKS);
    // Printed unconditionally: the number is the deliverable, the gate is the
    // backstop. A run that passes silently tells the next reader nothing.
    console.log(
      `[perf] sim @budget: mean ${p.frames.mean.toFixed(3)} ms · p95 ${p.frames.p95.toFixed(3)} ms · ` +
        `p99 ${p.frames.p99.toFixed(3)} ms · ${p.frames.ticksPerSecond.toFixed(0)} ticks/s ` +
        `(${(p.frames.ticksPerSecond / 60).toFixed(1)}× real time) · ` +
        `${(p.budget60.p95Ratio * 100).toFixed(1)}% of the 60 fps sim budget`,
    );
    expect(p.counts.turrets).toBe(STRESS_SCENE.turrets);
    expect(p.counts.liveProjectiles).toBeGreaterThanOrEqual(STRESS_SCENE.projectiles);
    expect(p.frames.p95).toBeLessThanOrEqual(SIM_BUDGET_60_MS);
  });

  it('scales sub-quadratically with entity count — the spatial hash is doing its job', () => {
    // Double every count. A broad phase that had regressed to all-pairs would
    // show ~4×; the grid should stay near linear. 3× is the alarm line, chosen
    // to be well clear of measurement noise on a shared CI runner.
    const base = profile('budget', TICKS);
    const doubled = profile('2× budget', TICKS, {
      asteroids: STRESS_SCENE.asteroids * 2,
      projectiles: STRESS_SCENE.projectiles * 2,
      chunks: STRESS_SCENE.chunks * 2,
    });
    const ratio = doubled.frames.mean / Math.max(1e-6, base.frames.mean);
    console.log(`[perf] 2× entities costs ${ratio.toFixed(2)}× the frame time`);
    expect(ratio).toBeLessThan(3);
  });

  it('allocates no per-frame garbage that grows the world (GDD §4.3 pooling)', () => {
    const world = stressWorld({ projectiles: 0, chunks: 0 });
    const before = world.projectiles.length;
    captureFrameTimes(world, 120, [], 0);
    // With nobody firing, an idle scene must not accumulate pooled entities.
    expect(world.projectiles.length).toBeLessThanOrEqual(before + STRESS_SCENE.turrets);
  });
});
