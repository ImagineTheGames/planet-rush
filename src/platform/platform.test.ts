/**
 * src/platform/platform.test.ts — the seam's own defensive reads.
 *
 * Scoped to {@link Platform.prefersReducedMotion}, which pr-05 added: it is the
 * first capability on this interface whose answer comes from a *player
 * preference* rather than from a feature test, and the end-of-match sequence
 * hangs on it. Everything it has to survive is here — no `window` at all (the
 * headless server and this very test runner), a browser with no `matchMedia`, a
 * `matchMedia` that throws, and a preference the player changes mid-session.
 *
 * The rest of the interface is exercised through the modules that consume it
 * (`fullscreen.test.ts`, `orientation.test.ts`), which is why this file is small.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createBrowserPlatform } from './platform';

type MediaWindow = { matchMedia?: (query: string) => { matches: boolean } };

/** Install a fake `window` for one assertion, and take it away after. The test
 *  runner is node — there is no window here unless a test makes one. */
function withWindow(fake: MediaWindow | undefined, run: () => void): void {
  const globals = globalThis as { window?: unknown };
  const had = 'window' in globals;
  const before = globals.window;
  if (fake === undefined) delete globals.window;
  else globals.window = fake;
  try {
    run();
  } finally {
    if (had) globals.window = before;
    else delete globals.window;
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('prefersReducedMotion', () => {
  it('is FALSE with no window at all — the headless case', () => {
    withWindow(undefined, () => {
      expect(createBrowserPlatform().prefersReducedMotion()).toBe(false);
    });
  });

  it('is FALSE where the browser has no matchMedia', () => {
    withWindow({}, () => {
      expect(createBrowserPlatform().prefersReducedMotion()).toBe(false);
    });
  });

  it('is TRUE only when the player actually asked for less motion', () => {
    withWindow({ matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }) }, () => {
      expect(createBrowserPlatform().prefersReducedMotion()).toBe(true);
    });
    withWindow({ matchMedia: () => ({ matches: false }) }, () => {
      expect(createBrowserPlatform().prefersReducedMotion()).toBe(false);
    });
  });

  it('asks the query it says it asks', () => {
    const asked: string[] = [];
    withWindow(
      {
        matchMedia: (q) => {
          asked.push(q);
          return { matches: true };
        },
      },
      () => {
        createBrowserPlatform().prefersReducedMotion();
      },
    );
    expect(asked).toEqual(['(prefers-reduced-motion: reduce)']);
  });

  it('folds a throwing matchMedia to "no preference" rather than into the game', () => {
    withWindow(
      {
        matchMedia: () => {
          throw new Error('blocked');
        },
      },
      () => {
        expect(createBrowserPlatform().prefersReducedMotion()).toBe(false);
      },
    );
  });

  it('re-reads per call — a player may change the setting mid-session', () => {
    let reduce = false;
    withWindow({ matchMedia: () => ({ matches: reduce }) }, () => {
      const platform = createBrowserPlatform();
      expect(platform.prefersReducedMotion()).toBe(false);
      reduce = true;
      expect(platform.prefersReducedMotion()).toBe(true);
    });
  });
});
