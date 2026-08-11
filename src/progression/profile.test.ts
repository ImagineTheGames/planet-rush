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
  MIGRATABLE_VERSIONS,
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
import { levelForXp, xpToReach } from './curve';

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
    // A CONSISTENT pair: `level` is a cache of `xp`, so a fixture that pairs
    // 4211 XP with level 5 is not a profile this game can produce — the reader
    // rebuilds the cache and the round trip would fail on the fixture's own
    // arithmetic rather than on anything the module did wrong.
    const xp = xpToReach(5);
    const profile: Profile = { v: 1, xp, level: 5, matches: 12 };
    expect(levelForXp(xp)).toBe(5);
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

  it('carries the onboarding record, and omits it on a career with nothing taught', () => {
    // u15-01: GDD §2.10's "never appear again after each is completed once" is a
    // claim about a PLAYER, so it is stored with the player. Optional and
    // additive, which is why `v` stays 1 — an older career simply has none.
    const store = memoryStorage();
    const profile: Profile = {
      v: 1,
      xp: 10,
      level: 1,
      matches: 1,
      onboarded: ['mine', 'haul-home'],
    };
    saveProfile(store, profile);
    expect(loadProfile(store)).toEqual(profile);

    const bare = memoryStorage();
    saveProfile(bare, freshProfile());
    expect('onboarded' in loadProfile(bare)).toBe(false);
  });

  it('drops a junk onboarding id rather than the whole career', () => {
    // The same rule `unlocked` gets, for the same reason: a bad id must never
    // cost a profile that cannot be reset. The player is re-taught one prompt.
    const store = memoryStorage({
      [PROFILE_KEY]: JSON.stringify({
        v: 1,
        xp: 900,
        level: 2,
        matches: 4,
        onboarded: ['mine', 3, null, ''],
      }),
    });
    expect(loadProfile(store)).toEqual({
      v: 1,
      xp: 900,
      level: 2,
      matches: 4,
      onboarded: ['mine'],
    });
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
    const xp = xpToReach(3);
    const store = memoryStorage({
      [PROFILE_KEY]: JSON.stringify({ v: 0, xp, level: 3, matches: 5 }),
    });
    // Not a fold: the numbers survive the version bump.
    expect(loadProfile(store)).toEqual({ v: 1, xp, level: 3, matches: 5 });
    // …and nothing was backed up, because nothing was lost.
    expect(store.map.has(PROFILE_BACKUP_KEY)).toBe(false);
  });

  it('has no gaps in the ladder — a rung for every version below the current one', () => {
    // The guard on the whole seam. Bumping PROFILE_VERSION to 2 without adding a
    // `1` rung makes this red, instead of shipping a build where every v:0 and
    // v:1 profile in the world folds to a fresh career on first boot.
    for (let v = 0; v < PROFILE_VERSION; v++) {
      expect(MIGRATABLE_VERSIONS, `no migration rung for v:${v}`).toContain(v);
    }
    // And every rung is a rung, not a leap: none claims a version at or above
    // the current one, which is what makes the walk single-stepped.
    for (const v of MIGRATABLE_VERSIONS) expect(v).toBeLessThan(PROFILE_VERSION);
  });

  it('walks EVERY rung, so the oldest profile still arrives — not just the newest', () => {
    // Today the ladder is one rung, so this is the same as the case above. It
    // stops being the same the day v:2 ships, and that is the day it matters:
    // the oldest blobs are the ones with the longest careers in them.
    const oldest = Math.min(...MIGRATABLE_VERSIONS);
    const xp = xpToReach(4);
    const migrated = migrate({ v: oldest, xp, level: 4, matches: 9 });
    expect(migrated).not.toBeNull();
    expect(migrated?.v).toBe(PROFILE_VERSION);
    expect(migrated?.xp).toBe(xp);
    expect(migrated?.matches).toBe(9);
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

describe('the write is guarded by the reader', () => {
  /** The invariant: `saveProfile` never writes a blob `loadProfile` would reject.
   *  Stated once, checked against every adversarial profile below. */
  function neverWritesUnreadable(profile: Profile): void {
    const store = memoryStorage();
    const good: Profile = { v: 1, xp: xpToReach(3), level: 3, matches: 7 };
    saveProfile(store, good);

    const written = saveProfile(store, profile);
    const onDisk = store.map.get(PROFILE_KEY) as string;
    if (written) {
      // If it claimed to write, the reader must accept what it wrote.
      expect(validateProfile(JSON.parse(onDisk)), JSON.stringify(profile)).not.toBeNull();
    } else {
      // If it refused, the career that was already there is untouched.
      expect(JSON.parse(onDisk), JSON.stringify(profile)).toEqual(good);
    }
  }

  it('refuses a non-finite xp rather than writing JSON `null` over a career', () => {
    // The failure this guard exists for. `JSON.stringify({xp: NaN})` is
    // `{"xp":null}` — no throw, no warning — and the loss only surfaces on the
    // NEXT boot, when the reader folds a blob it cannot accept. pr-04 is the
    // single write site and it computes `xp += gain`; one non-finite `gain` is
    // all it takes.
    const store = memoryStorage();
    const good: Profile = { v: 1, xp: xpToReach(6), level: 6, matches: 20 };
    saveProfile(store, good);

    const broken = { ...good, xp: Number.NaN } as Profile;
    expect(saveProfile(store, broken)).toBe(false);

    // Nothing was written, so the career reads back whole — not folded, and not
    // merely recoverable from the backup key.
    expect(loadProfile(store)).toEqual(good);
    expect(store.map.has(PROFILE_BACKUP_KEY)).toBe(false);
  });

  it('holds the invariant across every shape an accrual bug can produce', () => {
    const adversarial: Profile[] = [
      { v: 1, xp: Number.NaN, level: 3, matches: 7 },
      { v: 1, xp: Number.POSITIVE_INFINITY, level: 3, matches: 7 },
      { v: 1, xp: -1, level: 3, matches: 7 },
      { v: 1, xp: 100, level: Number.NaN, matches: 7 },
      { v: 1, xp: 100, level: 3, matches: Number.NaN },
      { v: 1, xp: 100, level: 3, matches: -2 },
      { v: 2 as 1, xp: 100, level: 3, matches: 7 },
      { v: 1, xp: 100.5, level: 3, matches: 7.5 },
      { v: 1, xp: 0, level: 1, matches: 0 },
    ];
    for (const profile of adversarial) neverWritesUnreadable(profile);
  });

  it('writes a good profile and says so', () => {
    const store = memoryStorage();
    expect(saveProfile(store, freshProfile())).toBe(true);
    expect(store.map.has(PROFILE_KEY)).toBe(true);
  });
});

describe('validateProfile', () => {
  it('never returns a level below 1', () => {
    expect(validateProfile({ v: 1, xp: 0, level: 0, matches: 0 })?.level).toBe(1);
  });

  it('rebuilds a level that disagrees with xp — the cache never outranks its source', () => {
    // No reset ships, so a level written wrong once is wrong forever unless the
    // reader repairs it. Both directions: a level too high (a tampered or
    // buggy write) and one left behind (a curve QA re-tuned under a stored
    // profile) come back to what the xp actually buys.
    const xp = xpToReach(4);
    expect(validateProfile({ v: 1, xp, level: 99, matches: 3 })?.level).toBe(4);
    expect(validateProfile({ v: 1, xp, level: 1, matches: 3 })?.level).toBe(4);
    expect(validateProfile({ v: 1, xp, level: 4, matches: 3 })?.level).toBe(4);
  });

  it('folds a MALFORMED level rather than repairing it — the blob is not trusted', () => {
    // The line between the two: a well-formed cache that drifted is repaired; a
    // blob whose fields are the wrong types is not a payload to mine a career
    // out of, and folds (and is backed up) like any other corrupt one.
    expect(validateProfile({ v: 1, xp: 100, level: null, matches: 2 })).toBeNull();
    expect(validateProfile({ v: 1, xp: 100, level: '4', matches: 2 })).toBeNull();
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
