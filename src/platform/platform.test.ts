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

// ---------------------------------------------------------------------------
// storage.remove — pr-06, and it is for MIGRATION, not for a reset
// ---------------------------------------------------------------------------

/**
 * A `localStorage` stand-in for one assertion, and take it away after — the same
 * shape {@link withWindow} keeps, for the same reason: the runner is node and
 * there is no browser storage here unless a test makes one.
 *
 * `throws` makes every call reject the way private mode and a full quota do, so
 * the "never throws into game code" rule (this seam's header) is tested rather
 * than assumed.
 */
function withLocalStorage(
  seed: Record<string, string> | 'throws',
  run: (read: () => Record<string, string>) => void,
): void {
  const globals = globalThis as { localStorage?: unknown };
  const had = 'localStorage' in globals;
  const before = globals.localStorage;
  const map = new Map<string, string>(seed === 'throws' ? [] : Object.entries(seed));
  const boom = (): never => {
    throw new Error('storage disabled');
  };
  globals.localStorage =
    seed === 'throws'
      ? { getItem: boom, setItem: boom, removeItem: boom }
      : {
          getItem: (key: string) => map.get(key) ?? null,
          setItem: (key: string, value: string) => void map.set(key, value),
          removeItem: (key: string) => void map.delete(key),
        };
  try {
    run(() => Object.fromEntries(map));
  } finally {
    if (had) globals.localStorage = before;
    else delete globals.localStorage;
  }
}

/**
 * `storage.remove` (brief `docs/briefs/pr-06-lobby-level-badge.md`; plan §2.1).
 *
 * **It exists for migration, and there is no reset button in this chain.**
 * Progression is never wiped (plan §Q4, the developer's *"no."*), so the seam
 * gains this method for the one job `set` cannot do: a migration that must
 * **retire** a key, and the `planet-rush:profile.bak` blob pr-01 preserves,
 * which wants clearing once a profile has been recovered from it. No UI reaches
 * it and none may be added.
 */
describe('storage.remove — the migration tool, not a reset (plan §2.1, §Q4)', () => {
  it('deletes a key, and leaves every other key alone', () => {
    withLocalStorage({ 'planet-rush:profile': '{}', 'planet-rush:fireMode': 'hold' }, (read) => {
      const storage = createBrowserPlatform().storage;
      expect(storage.get('planet-rush:profile')).toBe('{}');
      storage.remove('planet-rush:profile');
      expect(storage.get('planet-rush:profile')).toBeNull();
      expect(read()).toEqual({ 'planet-rush:fireMode': 'hold' });
    });
  });

  it('is a NO-OP on a key that is not there — removing nothing removes nothing', () => {
    withLocalStorage({ 'planet-rush:fireMode': 'hold' }, (read) => {
      const storage = createBrowserPlatform().storage;
      expect(() => storage.remove('planet-rush:profile.bak')).not.toThrow();
      expect(storage.get('planet-rush:profile.bak')).toBeNull();
      expect(read()).toEqual({ 'planet-rush:fireMode': 'hold' });
    });
  });

  it('a removed key can be written again — remove is not a tombstone', () => {
    withLocalStorage({ 'planet-rush:profile.bak': 'salvage me' }, () => {
      const storage = createBrowserPlatform().storage;
      storage.remove('planet-rush:profile.bak');
      storage.set('planet-rush:profile.bak', 'again');
      expect(storage.get('planet-rush:profile.bak')).toBe('again');
    });
  });

  it('degrades to a no-op where storage throws — private mode never reaches game code', () => {
    withLocalStorage('throws', () => {
      const storage = createBrowserPlatform().storage;
      expect(() => storage.remove('planet-rush:profile')).not.toThrow();
    });
  });
});
