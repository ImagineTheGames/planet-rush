/**
 * src/progression/profile.test.ts — the career profile, headless.
 *
 * Every case runs against an in-memory storage double: no `localStorage`, no
 * `window`. The seam is two methods (`get`/`set`), so the double is honest — it
 * is the whole of what `platform.storage` offers.
 *
 * The case that matters most is the least obvious one: **nothing is destroyed
 * silently.** A blob this reader cannot use is copied to
 * `planet-rush:profile.bak` before a fresh profile replaces it, and since the
 * developer ruled that progression is never wiped (2026-08-07, verbatim: *"no."*)
 * that copy is the only thing standing between a schema bug and a career the
 * player was promised would never be lost.
 */

import { describe, it, expect } from 'vitest';
import {
  PROFILE_BACKUP_KEY,
  PROFILE_KEY,
  PROFILE_VERSION,
  freshProfile,
  loadProfile,
  migrate,
  saveProfile,
  validateProfile,
  type Profile,
  type ProfileStorage,
} from './profile';

/** The seam, in memory. Structurally `platform.storage` and nothing more. */
function memoryStorage(seed: Record<string, string> = {}): ProfileStorage & { readonly map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
  };
}

describe('round trip', () => {
  it('saves and loads back equal to itself', () => {
    const store = memoryStorage();
    const profile: Profile = { v: 1, xp: 4211, level: 5, matches: 12 };
    saveProfile(store, profile);
    expect(loadProfile(store)).toEqual(profile);
  });

  it('carries the phase-2 fields when they are present, and omits them when not', () => {
    const store = memoryStorage();
    const profile: Profile = {
      v: 1,
      xp: 10,
      level: 1,
      matches: 1,
      unlocked: ['livery.ashfield'],
      equipped: { livery: 'livery.ashfield' },
    };
    saveProfile(store, profile);
    expect(loadProfile(store)).toEqual(profile);

    const bare = memoryStorage();
    saveProfile(bare, freshProfile());
    const read = loadProfile(bare);
    expect('unlocked' in read).toBe(false);
    expect('equipped' in read).toBe(false);
  });

  it('writes the version on the FIRST save', () => {
    const store = memoryStorage();
    saveProfile(store, freshProfile());
    expect(JSON.parse(store.map.get(PROFILE_KEY) as string).v).toBe(PROFILE_VERSION);
  });
});

describe('absent', () => {
  it('folds an empty store to a fresh profile', () => {
    expect(loadProfile(memoryStorage())).toEqual({ v: 1, xp: 0, level: 1, matches: 0 });
  });

  it('backs nothing up when there was nothing there — empty is not corrupt', () => {
    const store = memoryStorage();
    loadProfile(store);
    expect(store.map.has(PROFILE_BACKUP_KEY)).toBe(false);
    // And it does not write a profile it was only asked to read.
    expect(store.map.has(PROFILE_KEY)).toBe(false);
  });
});

describe('corrupt', () => {
  it('folds a non-JSON blob', () => {
    const store = memoryStorage({ [PROFILE_KEY]: 'not json at all {{{' });
    expect(loadProfile(store)).toEqual(freshProfile());
  });

  it('folds JSON with the wrong field types — field by field, not a blanket cast', () => {
    // Each of these is shaped like a profile and is not one. A blanket
    // `as Profile` would put every one of them on a progress bar.
    const bad: unknown[] = [
      { v: 1, xp: 'lots', level: 3, matches: 2 },
      { v: 1, xp: 100, level: null, matches: 2 },
      { v: 1, xp: 100, level: 3, matches: [] },
      { v: 1, xp: Number.NaN, level: 3, matches: 2 },
      { v: 1, xp: -50, level: 3, matches: 2 },
      { v: 1, xp: Number.POSITIVE_INFINITY, level: 3, matches: 2 },
      { v: '1', xp: 100, level: 3, matches: 2 },
      { xp: 100, level: 3, matches: 2 },
      [1, 2, 3],
      null,
      'a bare string',
    ];
    for (const blob of bad) {
      const store = memoryStorage({ [PROFILE_KEY]: JSON.stringify(blob) });
      expect(loadProfile(store), JSON.stringify(blob)).toEqual(freshProfile());
    }
  });

  it('drops a junk entry out of unlocked/equipped rather than the whole profile', () => {
    const store = memoryStorage({
      [PROFILE_KEY]: JSON.stringify({
        v: 1,
        xp: 900,
        level: 2,
        matches: 4,
        unlocked: ['livery.ashfield', 7, null, ''],
        equipped: { livery: 'livery.ashfield', decal: 42 },
      }),
    });
    expect(loadProfile(store)).toEqual({
      v: 1,
      xp: 900,
      level: 2,
      matches: 4,
      unlocked: ['livery.ashfield'],
      equipped: { livery: 'livery.ashfield' },
    });
  });
});

describe('forward-compatible', () => {
  it('does not crash a v:1 reader with a v:2 blob — it folds', () => {
    const store = memoryStorage({
      [PROFILE_KEY]: JSON.stringify({ v: 2, xp: 9999, level: 12, matches: 40, prestige: 3 }),
    });
    expect(() => loadProfile(store)).not.toThrow();
    expect(loadProfile(store)).toEqual(freshProfile());
  });

  it('keeps the newer blob — a future build may know what it is', () => {
    const raw = JSON.stringify({ v: 2, xp: 9999, level: 12, matches: 40 });
    const store = memoryStorage({ [PROFILE_KEY]: raw });
    loadProfile(store);
    expect(store.map.get(PROFILE_BACKUP_KEY)).toBe(raw);
  });
});

describe('nothing is destroyed silently', () => {
  it('copies an unparseable blob VERBATIM to the backup key before folding', () => {
    const raw = '{"v":1,"xp":4200,"level":5,"matches":11'; // truncated write
    const store = memoryStorage({ [PROFILE_KEY]: raw });

    // Before: one key, the broken profile. After: the profile reads fresh, and
    // the broken blob is still on disk, character for character.
    expect(store.map.get(PROFILE_KEY)).toBe(raw);
    expect(store.map.has(PROFILE_BACKUP_KEY)).toBe(false);

    expect(loadProfile(store)).toEqual(freshProfile());

    expect(store.map.get(PROFILE_BACKUP_KEY)).toBe(raw);
  });

  it('copies an invalid-but-parseable blob too', () => {
    const raw = JSON.stringify({ v: 1, xp: 'lots', level: 5, matches: 11 });
    const store = memoryStorage({ [PROFILE_KEY]: raw });
    loadProfile(store);
    expect(store.map.get(PROFILE_BACKUP_KEY)).toBe(raw);
  });

  it('exports no way to clear a profile — progression is never wiped', async () => {
    const module = (await import('./profile')) as Record<string, unknown>;
    for (const name of Object.keys(module)) {
      expect(name.toLowerCase()).not.toMatch(/clear|reset|wipe|delete/);
    }
  });
});

describe('the migration seam', () => {
  it('exists, is called for a known older version, and its result is used', () => {
    const store = memoryStorage({
      [PROFILE_KEY]: JSON.stringify({ v: 0, xp: 1200, level: 3, matches: 5 }),
    });
    // Not a fold: the numbers survive the version bump.
    expect(loadProfile(store)).toEqual({ v: 1, xp: 1200, level: 3, matches: 5 });
    // …and nothing was backed up, because nothing was lost.
    expect(store.map.has(PROFILE_BACKUP_KEY)).toBe(false);
  });

  it('routes only KNOWN older versions — current and newer are not migrations', () => {
    expect(migrate({ v: 0, xp: 10, level: 1, matches: 1 })).toEqual({ v: 1, xp: 10, level: 1, matches: 1 });
    expect(migrate({ v: 1, xp: 10, level: 1, matches: 1 })).toBeNull();
    expect(migrate({ v: 2, xp: 10, level: 1, matches: 1 })).toBeNull();
    expect(migrate({ v: -3, xp: 10, level: 1, matches: 1 })).toBeNull();
    expect(migrate({ xp: 10 })).toBeNull();
    expect(migrate(null)).toBeNull();
    expect(migrate('v0')).toBeNull();
  });

  it('refuses to migrate a blob that is still invalid after the bump', () => {
    expect(migrate({ v: 0, xp: 'lots', level: 3, matches: 5 })).toBeNull();
  });
});

describe('validateProfile', () => {
  it('never returns a level below 1', () => {
    expect(validateProfile({ v: 1, xp: 0, level: 0, matches: 0 })?.level).toBe(1);
  });

  it('floors a non-integer count rather than refusing it', () => {
    expect(validateProfile({ v: 1, xp: 10.7, level: 1, matches: 2.9 })).toEqual({
      v: 1,
      xp: 10,
      level: 1,
      matches: 2,
    });
  });
});
