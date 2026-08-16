/**
 * src/net/playtest-log-store.ts — WHERE THE LOG GOES WHEN THE PAGE DOES.
 * OWNER: Platform Engineer (a0-56).
 *
 * The developer sent a log to explain a bug they hit **in a match**, and the file
 * said the session never left the main menu. They were right and the file was
 * wrong: *"because it said i never left the main menu but i was in the pause menu
 * in the middle of a match"*. BACK TO MENU reloads the page, the log lived in a
 * module-level singleton, and the singleton died with the page — so what got
 * exported was the boot sequence of the page that came *after* the match. Worse,
 * the Director believed the log over the developer.
 *
 * This module is the seven lines of browser that fix it, kept out of
 * `./playtest-log` so that module stays DOM-free and its tests keep running in node.
 *
 * ── WHY `sessionStorage` AND NOT `localStorage` ─────────────────────────────
 * The lifetime has to match what a *playtest session* is, and `sessionStorage` is
 * the only one that does: it survives a reload and a same-tab navigation — the two
 * things that were destroying the log — and it dies with the tab, which is what
 * keeps yesterday's session out of today's export. `localStorage` would outlive the
 * tab and quietly staple two unrelated playtests together; a memory-only log
 * outlives nothing at all. (The `./playtest-log` reader has a staleness check on top
 * of that, for the clock rather than for the storage.)
 *
 * ── WHY IT NEVER THROWS ─────────────────────────────────────────────────────
 * A log that crashes the client is worse than a log that forgets. Safari in private
 * mode has historically thrown on `setItem` and some embedded WebViews throw on the
 * mere property access; a full quota throws too. Every path here is wrapped, and a
 * refused write is reported as `false` rather than raised — which is the log's cue
 * to stop trying and file one line saying persistence is unavailable, so a short log
 * still says WHY it is short.
 */

import type { PlaytestLogStore } from './playtest-log';

/**
 * The one key. Namespaced like every other key this client owns, and versioned in
 * the blob rather than in the key so a stale-schema blob is *read and rejected*
 * (and then overwritten) instead of accumulating a second orphaned key per deploy.
 */
export const PLAYTEST_LOG_STORAGE_KEY = 'planet-rush:playtest-log';

/** The slice of `Storage` this needs — structural, so a test passes a plain object
 *  and nothing here depends on the DOM lib's `Storage` being present. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Wrap a `Storage` as a {@link PlaytestLogStore}: total, silent, and never throwing.
 *
 * A failed write drops the key on the way out. A stored log that could not be
 * *replaced* is a log that no longer describes this session, and the next page load
 * adopting a half-session it believes is whole is precisely the a0-56 failure —
 * better to restore nothing than to restore something stale and confident. The
 * removal is itself wrapped, because the same conditions that break `setItem` break
 * `removeItem`.
 */
export function playtestLogStore(storage: StorageLike): PlaytestLogStore {
  return {
    read(): string | null {
      try {
        return storage.getItem(PLAYTEST_LOG_STORAGE_KEY);
      } catch {
        return null; // private mode, a disabled origin, a WebView with no storage
      }
    },
    write(text: string): boolean {
      try {
        storage.setItem(PLAYTEST_LOG_STORAGE_KEY, text);
        return true;
      } catch {
        try {
          storage.removeItem(PLAYTEST_LOG_STORAGE_KEY);
        } catch {
          /* Nothing more to try; the caller is already being told this failed. */
        }
        return false;
      }
    },
  };
}

/**
 * The browser's `sessionStorage` as a {@link PlaytestLogStore}, or `null` where
 * there is none — node, a server-side import, an origin that denies storage
 * outright. `null` is the honest answer and the log takes it as "memory only",
 * which is exactly the behaviour that shipped before a0-56.
 *
 * The property access itself is inside the `try`: on some WebViews *reading*
 * `window.sessionStorage` is what throws, not calling a method on it.
 */
export function browserPlaytestLogStore(): PlaytestLogStore | null {
  try {
    const storage = (globalThis as { sessionStorage?: StorageLike }).sessionStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return null;
    }
    return playtestLogStore(storage);
  } catch {
    return null;
  }
}

/**
 * An in-memory {@link PlaytestLogStore}. For tests that need a reload to be
 * simulable without a DOM: drop the singleton (`resetPlaytestLog()`), keep the store,
 * boot again — which is exactly what a page reload does to the pair of them.
 */
export function memoryPlaytestLogStore(initial: string | null = null): PlaytestLogStore {
  let held = initial;
  return {
    read: (): string | null => held,
    write: (text: string): boolean => {
      held = text;
      return true;
    },
  };
}
