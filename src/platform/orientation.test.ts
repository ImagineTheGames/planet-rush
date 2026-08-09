/**
 * Landscape-lock tests (field report v0.1.1; GDD §2.4, mobile amendment §2). The
 * pure root-transform geometry that rotates a portrait mobile viewport into a
 * landscape game, the physical↔logical point remap that keeps a tap on target,
 * and the first-gesture native landscape request being best-effort.
 */
import { describe, it, expect } from 'vitest';
import {
  computeRootTransform,
  applyRootTransform,
  physicalToLogical,
  logicalToPhysical,
  requestLandscape,
  type RootTransform,
  type Rotatable,
} from './orientation';
import type { Platform } from './platform';

function fakePlatform(over: Partial<Platform>): Platform {
  return {
    setFullscreen: () => Promise.resolve(),
    requestFullscreen: () => Promise.resolve(),
    isFullscreen: () => false,
    canFullscreen: () => false,
    vibrate: () => {},
    storage: { get: () => null, set: () => {} },
    lockOrientation: () => Promise.resolve(),
    canLockOrientation: () => false,
    prefersReducedMotion: () => false,
    ...over,
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('computeRootTransform — the landscape-lock decision', () => {
  it('does not rotate desktop (non-mobile), even in a tall/portrait aspect', () => {
    const t = computeRootTransform(800, 1200, /* isMobile */ false);
    expect(t.rotated).toBe(false);
    expect(t.logicalWidth).toBe(800);
    expect(t.logicalHeight).toBe(1200);
    expect(t.rotation).toBe(0);
  });

  it('does not rotate a mobile viewport already in landscape', () => {
    const t = computeRootTransform(844, 390, true);
    expect(t.rotated).toBe(false);
    expect(t.logicalWidth).toBe(844);
    expect(t.logicalHeight).toBe(390);
  });

  it('treats square as landscape-enough (not rotated)', () => {
    expect(computeRootTransform(500, 500, true).rotated).toBe(false);
  });

  it('rotates a portrait mobile viewport into a landscape logical viewport', () => {
    const t = computeRootTransform(390, 844, true);
    expect(t.rotated).toBe(true);
    // Logical is landscape: the long edge is width.
    expect(t.logicalWidth).toBe(844);
    expect(t.logicalHeight).toBe(390);
    expect(t.logicalWidth).toBeGreaterThan(t.logicalHeight);
    expect(t.rotation).toBeCloseTo(Math.PI / 2);
    expect(t.x).toBe(390); // translate by physW so the rotated rect tucks onto the canvas
    expect(t.y).toBe(0);
  });
});

describe('applyRootTransform — writes the Pixi container transform', () => {
  it('sets rotation and position from the transform', () => {
    let px = -1;
    let py = -1;
    const root: Rotatable = { rotation: 0, position: { set: (x, y) => ((px = x), (py = y)) } };
    applyRootTransform(root, computeRootTransform(390, 844, true));
    expect(root.rotation).toBeCloseTo(Math.PI / 2);
    expect(px).toBe(390);
    expect(py).toBe(0);
  });

  it('is the identity when not rotated', () => {
    const root: Rotatable = { rotation: 5, position: { set: () => {} } };
    applyRootTransform(root, computeRootTransform(1280, 800, false));
    expect(root.rotation).toBe(0);
  });
});

describe('physicalToLogical / logicalToPhysical — the tap remap', () => {
  const portrait: RootTransform = computeRootTransform(390, 844, true);

  it('is the identity when not rotated', () => {
    const t = computeRootTransform(1280, 800, false);
    expect(physicalToLogical(100, 200, t)).toEqual({ x: 100, y: 200 });
    expect(logicalToPhysical(100, 200, t)).toEqual({ x: 100, y: 200 });
  });

  it('maps the physical corners to the correct logical corners (90° rotation)', () => {
    // Physical top-left → logical bottom-left; physical top-right → logical top-left.
    expect(physicalToLogical(0, 0, portrait)).toEqual({ x: 0, y: 390 });
    expect(physicalToLogical(390, 0, portrait)).toEqual({ x: 0, y: 0 });
    expect(physicalToLogical(390, 844, portrait)).toEqual({ x: 844, y: 0 });
    expect(physicalToLogical(0, 844, portrait)).toEqual({ x: 844, y: 390 });
  });

  it('every mapped logical point sits inside the logical landscape viewport', () => {
    for (const [px, py] of [
      [0, 0],
      [195, 422],
      [389, 843],
      [10, 800],
    ] as const) {
      const l = physicalToLogical(px, py, portrait);
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x).toBeLessThanOrEqual(portrait.logicalWidth);
      expect(l.y).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeLessThanOrEqual(portrait.logicalHeight);
    }
  });

  it('logicalToPhysical round-trips physicalToLogical', () => {
    for (const [px, py] of [
      [0, 0],
      [123, 456],
      [390, 844],
      [37, 811],
    ] as const) {
      const l = physicalToLogical(px, py, portrait);
      const back = logicalToPhysical(l.x, l.y, portrait);
      expect(back.x).toBeCloseTo(px);
      expect(back.y).toBeCloseTo(py);
    }
  });
});

describe('requestLandscape — best-effort first gesture', () => {
  it('requests fullscreen, then locks to landscape', async () => {
    const calls: string[] = [];
    const platform = fakePlatform({
      requestFullscreen: () => {
        calls.push('fullscreen');
        return Promise.resolve();
      },
      lockOrientation: (o) => {
        calls.push(`lock:${o}`);
        return Promise.resolve();
      },
    });

    requestLandscape(platform);
    await flush();
    expect(calls).toEqual(['fullscreen', 'lock:landscape']);
  });

  it('never throws when the platform rejects both calls (iOS Safari)', async () => {
    const platform = fakePlatform({
      requestFullscreen: () => Promise.reject(new Error('no user gesture')),
      lockOrientation: () => Promise.reject(new Error('unsupported')),
    });
    expect(() => requestLandscape(platform)).not.toThrow();
    await flush(); // an unhandled rejection here would fail the test run
  });
});
