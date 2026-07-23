/**
 * Portrait-handling tests (GDD §2.4, §4.9, mobile amendment §2; milestone-1 gap
 * #2). The pure overlay decision on dimension flips, the ROTATE overlay's
 * show/hide + resize, and the first-gesture landscape request being best-effort
 * (fullscreen → lock, never throwing).
 */
import { describe, it, expect } from 'vitest';
import { shouldShowRotateOverlay, requestLandscape, RotateOverlay } from './orientation';
import type { Platform } from './platform';

function fakePlatform(over: Partial<Platform>): Platform {
  return {
    setFullscreen: () => Promise.resolve(),
    requestFullscreen: () => Promise.resolve(),
    vibrate: () => {},
    storage: { get: () => null, set: () => {} },
    lockOrientation: () => Promise.resolve(),
    canLockOrientation: () => false,
    ...over,
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('shouldShowRotateOverlay — the dimension-flip decision', () => {
  it('never shows where orientation lock is available (Android locks instead)', () => {
    expect(shouldShowRotateOverlay(400, 800, /* canLock */ true)).toBe(false); // portrait
    expect(shouldShowRotateOverlay(800, 400, true)).toBe(false); // landscape
  });

  it('shows in portrait where lock is unsupported (iOS Safari)', () => {
    expect(shouldShowRotateOverlay(400, 800, false)).toBe(true);
  });

  it('hides in landscape where lock is unsupported', () => {
    expect(shouldShowRotateOverlay(800, 400, false)).toBe(false);
  });

  it('treats square as landscape-enough (not blocked)', () => {
    expect(shouldShowRotateOverlay(500, 500, false)).toBe(false);
  });

  it('dismisses automatically on the portrait→landscape flip', () => {
    // Same device, no-lock; only the dimensions flip.
    expect(shouldShowRotateOverlay(400, 800, false)).toBe(true); // held portrait
    expect(shouldShowRotateOverlay(800, 400, false)).toBe(false); // turned landscape
  });
});

describe('RotateOverlay — the Pixi overlay', () => {
  it('is hidden on construction (never flashes on desktop / landscape)', () => {
    const overlay = new RotateOverlay(800, 400);
    expect(overlay.visible).toBe(false);
  });

  it('setShown toggles visibility', () => {
    const overlay = new RotateOverlay(400, 800);
    overlay.setShown(true);
    expect(overlay.visible).toBe(true);
    overlay.setShown(false);
    expect(overlay.visible).toBe(false);
  });

  it('re-layouts on resize without throwing (orientationchange path)', () => {
    const overlay = new RotateOverlay(400, 800);
    expect(() => overlay.resize(800, 400)).not.toThrow();
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
