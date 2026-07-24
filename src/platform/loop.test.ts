/**
 * Fixed-timestep loop unit tests (GDD §4.1). The sim must advance in whole
 * `FIXED_DT` steps regardless of frame timing — that fixed step is what makes
 * the determinism replay test meaningful (GDD §4.8). `advance` is the pure
 * accumulator core; these drive it with explicit elapsed times.
 */
import { describe, it, expect } from 'vitest';
import { GameLoop, FIXED_DT } from './loop';

function counting() {
  const calls = { updates: 0, renders: 0, lastAlpha: -1 };
  const loop = new GameLoop({
    update: () => {
      calls.updates++;
    },
    render: (alpha) => {
      calls.renders++;
      calls.lastAlpha = alpha;
    },
  });
  return { loop, calls };
}

describe('GameLoop.advance — fixed-step accumulation', () => {
  it('runs exactly one step per FIXED_DT of elapsed time', () => {
    const { loop, calls } = counting();
    expect(loop.advance(FIXED_DT)).toBe(1);
    expect(calls.updates).toBe(1);
    expect(calls.renders).toBe(1);
  });

  it('runs multiple catch-up steps for a long frame', () => {
    const { loop, calls } = counting();
    expect(loop.advance(FIXED_DT * 3)).toBe(3);
    expect(calls.updates).toBe(3);
    expect(calls.renders).toBe(1); // render once per frame, whatever the step count
  });

  it('carries leftover time across frames as the render alpha', () => {
    const { loop, calls } = counting();
    loop.advance(FIXED_DT * 1.5); // 1 step, 0.5 left over
    expect(calls.updates).toBe(1);
    expect(calls.lastAlpha).toBeCloseTo(0.5, 5);

    loop.advance(FIXED_DT * 0.5); // accumulates to a full step
    expect(calls.updates).toBe(2);
    expect(calls.lastAlpha).toBeCloseTo(0, 5);
  });

  it('renders without stepping when too little time has passed', () => {
    const { loop, calls } = counting();
    expect(loop.advance(FIXED_DT * 0.4)).toBe(0);
    expect(calls.updates).toBe(0);
    expect(calls.renders).toBe(1);
  });

  it('clamps a huge frame to avoid a catch-up spiral (GDD §4.3)', () => {
    const { loop } = counting();
    // 10 seconds of stall must not queue 600 steps.
    const steps = loop.advance(10);
    expect(steps).toBeLessThanOrEqual(Math.ceil(0.25 / FIXED_DT));
  });

  it('advances SIM time slower than wall clock on a slow host — by design', () => {
    // The consequence of the clamp above, pinned as a contract because tooling
    // now depends on it: on a host rendering ~1 fps, one second of wall clock
    // buys at most 0.25 s of sim and the rest is DROPPED — not banked, the
    // accumulator never sees it. So "hold an input for N real seconds" says
    // nothing fixed about how far the sim advanced, and any assertion on sim
    // progress has to count sim ticks instead (the ?debug=1 `ticks` field exists
    // for exactly this — see debug-hook.ts and the QA touch-drag test, m1-12).
    const { loop } = counting();
    let steps = 0;
    for (let frame = 0; frame < 5; frame++) steps += loop.advance(1.0); // 5 s wall @ 1 fps
    const simSeconds = steps * FIXED_DT;
    expect(simSeconds).toBeLessThanOrEqual(5 * 0.25 + FIXED_DT);
    expect(simSeconds).toBeLessThan(5); // …a 4× dilation, not a rounding error
  });
});
