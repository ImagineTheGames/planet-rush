/**
 * Fullscreen-lifecycle tests (fullscreen.ts; field request v0.1.1). The whole
 * point of the module is that fullscreen NEVER assumed to stick: it is entered on
 * a gesture, can vanish behind our backs, and the re-enter affordance is offered
 * only in exactly the right window. All of that is decided over the platform seam,
 * so it tests headless against a controllable fake {@link Platform}.
 */
import { describe, it, expect, vi } from 'vitest';
import { FullscreenLifecycle } from './fullscreen';
import type { Platform } from './platform';

/** A fake platform whose fullscreen truth the test drives directly. */
function fakePlatform(over: Partial<Platform> = {}): Platform {
  return {
    setFullscreen: () => Promise.resolve(),
    requestFullscreen: () => Promise.resolve(),
    isFullscreen: () => false,
    canFullscreen: () => true,
    vibrate: () => {},
    storage: { get: () => null, set: () => {} },
    lockOrientation: () => Promise.resolve(),
    canLockOrientation: () => true,
    prefersReducedMotion: () => false,
    ...over,
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const ROOT = { id: 'app' } as unknown as Element;

describe('enter() — the PLAY gesture', () => {
  it('on touch + capable, requests fullscreen on the game root then locks landscape', async () => {
    const order: string[] = [];
    const requestFullscreen = vi.fn((t?: Element) => {
      order.push(`fs:${(t as { id?: string } | undefined)?.id ?? 'none'}`);
      return Promise.resolve();
    });
    const lockOrientation = vi.fn((o: 'landscape' | 'portrait') => {
      order.push(`lock:${o}`);
      return Promise.resolve();
    });
    const fs = new FullscreenLifecycle(fakePlatform({ requestFullscreen, lockOrientation }), true, ROOT);

    fs.enter();
    await flush();

    expect(requestFullscreen).toHaveBeenCalledWith(ROOT);
    // Native lock only after fullscreen — fullscreen is what makes it legal.
    expect(order).toEqual(['fs:app', 'lock:landscape']);
  });

  it('is a no-op on desktop (never auto-fullscreens keyboard/mouse — requirement 3)', async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const fs = new FullscreenLifecycle(fakePlatform({ requestFullscreen }), /* isTouch */ false, ROOT);
    fs.enter();
    await flush();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('is a no-op where fullscreen is unsupported (iPhone Safari)', async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const fs = new FullscreenLifecycle(fakePlatform({ requestFullscreen, canFullscreen: () => false }), true, ROOT);
    fs.enter();
    await flush();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('swallows a rejection — the game proceeds in today’s behaviour (requirement 2)', async () => {
    const fs = new FullscreenLifecycle(
      fakePlatform({ requestFullscreen: () => Promise.reject(new Error('no user gesture')) }),
      true,
      ROOT,
    );
    expect(() => fs.enter()).not.toThrow();
    await flush();
    // Never became fullscreen, so no affordance is nagged onto a working game.
    expect(fs.everEntered).toBe(false);
    expect(fs.affordanceVisible()).toBe(false);
  });
});

describe('affordanceVisible() — offered only after a real exit', () => {
  it('is hidden before the game has ever been fullscreen', () => {
    const fs = new FullscreenLifecycle(fakePlatform({ isFullscreen: () => false }), true, ROOT);
    fs.sync();
    expect(fs.everEntered).toBe(false);
    expect(fs.affordanceVisible()).toBe(false);
  });

  it('is hidden while fullscreen, shown once the user backs out', () => {
    let full = true;
    const fs = new FullscreenLifecycle(fakePlatform({ isFullscreen: () => full }), true, ROOT);

    // In fullscreen: the game has entered, but there is nothing to re-enter.
    fs.sync();
    expect(fs.everEntered).toBe(true);
    expect(fs.affordanceVisible()).toBe(false);

    // System gesture / ESC drops fullscreen — now the affordance is offered.
    full = false;
    fs.sync();
    expect(fs.affordanceVisible()).toBe(true);
  });

  it('never appears on desktop, even after a stint in fullscreen', () => {
    let full = true;
    const fs = new FullscreenLifecycle(fakePlatform({ isFullscreen: () => full }), /* isTouch */ false, ROOT);
    fs.sync();
    full = false;
    fs.sync();
    expect(fs.everEntered).toBe(true);
    expect(fs.affordanceVisible()).toBe(false);
  });

  it('never appears where fullscreen is unsupported', () => {
    const fs = new FullscreenLifecycle(
      fakePlatform({ isFullscreen: () => false, canFullscreen: () => false }),
      true,
      ROOT,
    );
    // Even if some prior state marked it entered, an unsupported platform offers nothing.
    fs.sync();
    expect(fs.affordanceVisible()).toBe(false);
  });
});

describe('live getters mirror the seam', () => {
  it('active/supported read the platform live', () => {
    let full = false;
    const fs = new FullscreenLifecycle(fakePlatform({ isFullscreen: () => full, canFullscreen: () => true }), true, ROOT);
    expect(fs.active).toBe(false);
    expect(fs.supported).toBe(true);
    full = true;
    expect(fs.active).toBe(true);
  });
});
