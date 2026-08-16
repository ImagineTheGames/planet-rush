/**
 * src/net/playtest-log-store.test.ts — the storage that must never break the game
 * (`./playtest-log-store`, a0-56).
 *
 * Two properties, and the second one is the one that matters at 2 a.m. on a phone:
 * the store carries a string across a page reload, and **nothing it does can throw
 * into the client**. Private mode denies storage, a full quota throws on write, and
 * some WebViews throw on the property access itself — every one of those is a log
 * that forgets, never a log that crashes.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  PLAYTEST_LOG_STORAGE_KEY,
  browserPlaytestLogStore,
  memoryPlaytestLogStore,
  playtestLogStore,
} from './playtest-log-store';
import type { StorageLike } from './playtest-log-store';

/** A working `Storage`, as a plain object — the DOM is not needed to test this. */
function fakeStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (key): string | null => map.get(key) ?? null,
    setItem: (key, value): void => void map.set(key, value),
    removeItem: (key): void => void map.delete(key),
  };
}

describe('playtestLogStore', () => {
  it('round-trips under the one namespaced key', () => {
    const storage = fakeStorage();
    const store = playtestLogStore(storage);

    expect(store.read()).toBeNull();
    expect(store.write('{"events":[]}')).toBe(true);
    expect(store.read()).toBe('{"events":[]}');
    expect([...storage.map.keys()]).toEqual([PLAYTEST_LOG_STORAGE_KEY]);
  });

  it('keeps ONE key however many times it is written', () => {
    // The blob is versioned, not the key: a stale-schema log is read and rejected
    // rather than accumulating an orphan per deploy.
    const storage = fakeStorage();
    const store = playtestLogStore(storage);
    for (let i = 0; i < 20; i++) store.write(`{"n":${i}}`);
    expect(storage.map.size).toBe(1);
    expect(store.read()).toBe('{"n":19}');
  });

  it('reports a refused write instead of throwing it (quota, private mode)', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    const store = playtestLogStore(storage);
    expect(() => store.write('anything')).not.toThrow();
    expect(store.write('anything')).toBe(false);
  });

  it('drops the stored log when it can no longer replace it', () => {
    // A log that could not be UPDATED no longer describes this session, and a next
    // page load adopting a stale half-session it believes is whole is the a0-56
    // failure in a new coat. Better to restore nothing.
    const storage = fakeStorage({ [PLAYTEST_LOG_STORAGE_KEY]: '{"old":true}' });
    const removed = vi.fn(storage.removeItem);
    const store = playtestLogStore({
      ...storage,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: removed,
    });

    expect(store.write('{"new":true}')).toBe(false);
    expect(removed).toHaveBeenCalledWith(PLAYTEST_LOG_STORAGE_KEY);
    expect(storage.map.size).toBe(0);
  });

  it('survives a storage whose every method throws', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const store = playtestLogStore(hostile);
    expect(store.read()).toBeNull();
    expect(store.write('x')).toBe(false);
  });
});

describe('browserPlaytestLogStore', () => {
  it('is null where there is no sessionStorage, so the log stays memory-only', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(browserPlaytestLogStore()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('is null when the property access itself throws (some WebViews)', () => {
    const scope = globalThis as Record<string, unknown>;
    const had = Object.getOwnPropertyDescriptor(scope, 'sessionStorage');
    Object.defineProperty(scope, 'sessionStorage', {
      configurable: true,
      get(): never {
        throw new Error('SecurityError: storage is disabled');
      },
    });
    try {
      expect(browserPlaytestLogStore()).toBeNull();
    } finally {
      if (had) Object.defineProperty(scope, 'sessionStorage', had);
      else delete scope['sessionStorage'];
    }
  });

  it('is null for an object that is not a Storage at all', () => {
    vi.stubGlobal('sessionStorage', { nope: true });
    expect(browserPlaytestLogStore()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('wraps a real-shaped sessionStorage', () => {
    vi.stubGlobal('sessionStorage', fakeStorage());
    const store = browserPlaytestLogStore()!;
    expect(store).not.toBeNull();
    expect(store.write('{"a":1}')).toBe(true);
    expect(store.read()).toBe('{"a":1}');
    vi.unstubAllGlobals();
  });
});

describe('memoryPlaytestLogStore', () => {
  it('holds a string across a simulated reload, with no DOM anywhere', () => {
    const store = memoryPlaytestLogStore();
    store.write('one');
    expect(store.read()).toBe('one');
    store.write('two');
    expect(store.read()).toBe('two');
  });

  it('can be seeded with what a previous page load left', () => {
    expect(memoryPlaytestLogStore('{"seed":true}').read()).toBe('{"seed":true}');
  });
});
