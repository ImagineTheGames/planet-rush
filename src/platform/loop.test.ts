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
});
