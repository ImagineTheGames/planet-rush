/**
 * Debug-instrument tests (debug-hook.ts — the QA centring contract). The gate:
 * `?debug=1` installs a read-only `window.__planetRush` that reports the local
 * ship's screen position in visual-viewport space, the viewport size, and fps,
 * updated per frame; anything else installs nothing and does no work. QA asserts
 * centring against this shape, so its stability is itself under test.
 */
import { describe, it, expect } from 'vitest';
import { installDebugHook, isDebugEnabled, DEBUG_GLOBAL_KEY, type DebugState } from './debug-hook';
import type { BuildInfo } from './build-info';

/** A known build stamp, so the shape assertion doesn't depend on the real git
 *  state of the checkout the suite happens to run in. */
const STAMP: BuildInfo = { sha: 'a1b2c3d', time: '2026-07-24T09:07:42.000Z', dirty: false };

/** A fresh window-like attach target per test. */
function fakeWindow(): Record<string, unknown> {
  return {};
}

/** Read the installed instrument back off a target, typed. */
function read(target: Record<string, unknown>): DebugState | undefined {
  return target[DEBUG_GLOBAL_KEY] as DebugState | undefined;
}

describe('isDebugEnabled — URL opt-in', () => {
  it('is on only for ?debug=1', () => {
    expect(isDebugEnabled('?debug=1')).toBe(true);
    expect(isDebugEnabled('?foo=bar&debug=1')).toBe(true);
    expect(isDebugEnabled('')).toBe(false);
    expect(isDebugEnabled('?debug=0')).toBe(false);
    expect(isDebugEnabled('?debug')).toBe(false);
    expect(isDebugEnabled('?debugx=1')).toBe(false);
  });
});

describe('installDebugHook — off path (no ?debug=1)', () => {
  it('installs nothing on the target and returns an inert hook', () => {
    const win = fakeWindow();
    const hook = installDebugHook('', win);
    expect(hook.enabled).toBe(false);
    expect(DEBUG_GLOBAL_KEY in win).toBe(false);
    // update is a safe no-op.
    expect(() => hook.update(1, 2, 3, 4, 5, 6, 100, 7)).not.toThrow();
    expect(DEBUG_GLOBAL_KEY in win).toBe(false);
  });
});

describe('installDebugHook — armed path (?debug=1)', () => {
  it('exposes the contract shape and updates it in place per frame', () => {
    const win = fakeWindow();
    const hook = installDebugHook('?debug=1', win, STAMP);
    expect(hook.enabled).toBe(true);

    const state = read(win);
    expect(state).toBeDefined();
    expect(state).toEqual({
      shipScreen: { x: 0, y: 0 },
      shipWorld: { x: 0, y: 0 },
      viewport: { w: 0, h: 0, width: 0, height: 0 },
      fps: 0,
      build: STAMP,
      ticks: 0,
    });

    hook.update(195, 422, 390, 844, 1500, 2600, 1000, 42);
    expect(state!.shipScreen).toEqual({ x: 195, y: 422 });
    expect(state!.shipWorld).toEqual({ x: 1500, y: 2600 });
    // Both spellings, one source: the layout-registry co-tenant reads
    // {width,height} off this same shared object (see the module contract).
    expect(state!.viewport).toEqual({ w: 390, h: 844, width: 390, height: 844 });

    // Same object mutated in place — no per-frame reallocation of the handle.
    const before = read(win);
    hook.update(10, 20, 30, 40, 50, 60, 1016, 43);
    expect(read(win)).toBe(before);
    expect(before!.shipScreen).toEqual({ x: 10, y: 20 });
    expect(before!.shipWorld).toEqual({ x: 50, y: 60 });
  });

  it('reports the viewport under both spellings (shared-handle co-tenancy)', () => {
    // window.__planetRush is shared with the layout registry, whose readers
    // speak {width,height}; this module's own contract is {w,h}. One object
    // answers both, so neither reader sees `undefined` (see debug-hook.ts).
    const win = fakeWindow();
    const hook = installDebugHook('?debug=1', win, STAMP);
    hook.update(0, 0, 844, 390, 0, 0, 1000, 0);
    const vp = read(win)!.viewport;
    expect(vp.w).toBe(844);
    expect(vp.width).toBe(844);
    expect(vp.h).toBe(390);
    expect(vp.height).toBe(390);
  });

  it('reports which build it is, frozen and stable across frames', () => {
    const win = fakeWindow();
    const hook = installDebugHook('?debug=1', win, STAMP);
    const state = read(win);
    expect(state!.build).toEqual(STAMP);
    expect(Object.isFrozen(state!.build)).toBe(true);
    hook.update(1, 2, 3, 4, 5, 6, 1000, 0);
    expect(state!.build).toEqual(STAMP);
  });

  it('reports the sim tick count verbatim — the render-independent time base', () => {
    const win = fakeWindow();
    const hook = installDebugHook('?debug=1', win);
    const state = read(win)!;

    // The whole point of `ticks`: it tracks SIM steps, not frames. One slow frame
    // that catches up 15 steps must report 15 — that is what makes "movement per
    // tick" invariant when the host's frame rate collapses (see the module doc).
    hook.update(0, 0, 100, 100, 0, 0, 1000, 0);
    expect(state.ticks).toBe(0);
    hook.update(0, 0, 100, 100, 0, 0, 2000, 15); // one 1 fps frame, 15 catch-up steps
    expect(state.ticks).toBe(15);
    hook.update(0, 0, 100, 100, 0, 0, 2016, 16); // one 60 fps frame, 1 step
    expect(state.ticks).toBe(16);
  });

  it('installs a read-only handle that cannot be reassigned', () => {
    const win = fakeWindow();
    installDebugHook('?debug=1', win);
    const state = read(win);
    expect(() => {
      // Non-writable, non-configurable: silently ignored in sloppy mode, throws in
      // strict (this module is ESM → strict). Either way the handle must survive.
      try {
        (win as Record<string, unknown>)[DEBUG_GLOBAL_KEY] = { hijacked: true };
      } catch {
        /* strict-mode TypeError is acceptable — the point is it doesn't swap */
      }
    }).not.toThrow();
    expect(read(win)).toBe(state);
  });

  it('reports fps only once two timestamps are seen, smoothed and positive', () => {
    const win = fakeWindow();
    const hook = installDebugHook('?debug=1', win);
    const state = read(win)!;

    // First frame: no prior timestamp, fps stays 0.
    hook.update(0, 0, 100, 100, 0, 0, 0, 0);
    expect(state.fps).toBe(0);

    // ~60fps: 16ms steps.
    for (let t = 16; t <= 16 * 30; t += 16) hook.update(0, 0, 100, 100, 0, 0, t, t / 16);
    expect(state.fps).toBeGreaterThan(55);
    expect(state.fps).toBeLessThan(65);
  });

  it('ignores non-advancing timestamps (no divide-by-zero, no NaN)', () => {
    const win = fakeWindow();
    const hook = installDebugHook('?debug=1', win);
    const state = read(win)!;
    hook.update(0, 0, 10, 10, 0, 0, 500, 1);
    hook.update(0, 0, 10, 10, 0, 0, 500, 2); // dt == 0 → skipped
    hook.update(0, 0, 10, 10, 0, 0, 400, 3); // dt < 0 → skipped
    expect(Number.isNaN(state.fps)).toBe(false);
    expect(state.fps).toBe(0);
  });
});
