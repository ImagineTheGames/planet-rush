/**
 * The onboarding memory, through the REAL profile store (u15-01 half A).
 *
 * `onboarding.test.ts` proves the state machine honours a memory port; this
 * proves the port the game actually ships is the profile store `p1-01` shipped —
 * one storage scheme, one key, one reader — and that a completed prompt survives
 * the two things §2.10's "never appear again" was failing: **EXIT TO MENU** (a
 * full navigation, so a fresh `Onboarding`) and a **reload** (a fresh everything,
 * off the same `localStorage`).
 */
import { describe, it, expect } from 'vitest';
import { Onboarding, PromptId } from './onboarding';
import { createProfileOnboardingMemory } from './onboarding-memory';
import { PROFILE_KEY, freshProfile, loadProfile, saveProfile } from '../progression/profile';
import type { ProfileStorage } from '../progression/profile';

/** A `localStorage` stand-in: the same string-in/string-out seam `platform.storage`
 *  is, so what survives here is what survives a reload. */
function store(seed: Record<string, string> = {}): ProfileStorage & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
  };
}

/** One page load: build the machine the HUD builds, off this storage. */
function bootOnboarding(storage: ProfileStorage): Onboarding {
  return new Onboarding(createProfileOnboardingMemory(storage));
}

describe('the onboarding memory is the profile store (u15-01, p1-01)', () => {
  it('reads an empty career as "nothing taught yet"', () => {
    const storage = store();
    const ob = bootOnboarding(storage);
    expect(ob.isCompleted(PromptId.Mine)).toBe(false);
    expect(ob.update({ nearAsteroid: true, cargo: 0, cargoCap: 2 })).toBe(PromptId.Mine);
  });

  it('persists a completed prompt into the ONE profile key, not a second one', () => {
    const storage = store();
    const ob = bootOnboarding(storage);
    ob.update({ nearAsteroid: true, cargo: 1, cargoCap: 2 }); // mined — MINE completes
    expect([...storage.map.keys()]).toEqual([PROFILE_KEY]);
    expect(loadProfile(storage).onboarded).toEqual([PromptId.Mine]);
  });

  it('a returning player is taught nothing: EXIT TO MENU, then a reload', () => {
    const storage = store();

    // --- Match 1: the player learns to mine. ---------------------------------
    const first = bootOnboarding(storage);
    expect(first.update({ nearAsteroid: true, cargo: 0, cargoCap: 2 })).toBe(PromptId.Mine);
    first.update({ nearAsteroid: true, cargo: 1, cargoCap: 2 });
    expect(first.isCompleted(PromptId.Mine)).toBe(true);

    // --- EXIT TO MENU → match 2: a full navigation rebuilds the HUD. ---------
    const second = bootOnboarding(storage);
    expect(second.update({ nearAsteroid: true, cargo: 0, cargoCap: 2 })).toBeNull();

    // --- A reload: nothing in memory crosses, only the store. ----------------
    const reloaded = bootOnboarding(store(Object.fromEntries(storage.map)));
    expect(reloaded.isCompleted(PromptId.Mine)).toBe(true);
    expect(reloaded.update({ nearAsteroid: true, cargo: 0, cargoCap: 2 })).toBeNull();
  });

  it('keeps the career it is stored beside — XP, level and matches are untouched', () => {
    const storage = store();
    saveProfile(storage, { ...freshProfile(), xp: 4211, level: 4, matches: 7 });
    const ob = bootOnboarding(storage);
    ob.update({ nearAsteroid: true, cargo: 1, cargoCap: 2 });
    const after = loadProfile(storage);
    expect(after.xp).toBe(4211);
    expect(after.matches).toBe(7);
    expect(after.onboarded).toEqual([PromptId.Mine]);
  });

  it('re-reads the career at the moment it writes, so a mid-match XP bank is not clobbered', () => {
    // The two write sites are `bankMatch` (XP, at the end of a match) and this
    // one (a lesson, mid-match). Neither may hold a copy across the other's
    // write — that is how a career gets rolled back by a tutorial prompt.
    const storage = store();
    const memory = createProfileOnboardingMemory(storage);
    memory.load(); // the front door reads once, at boot…
    saveProfile(storage, { ...freshProfile(), xp: 900, level: 2, matches: 3 }); // …then XP lands
    memory.save([PromptId.Spend]);
    const after = loadProfile(storage);
    expect(after.xp).toBe(900);
    expect(after.matches).toBe(3);
    expect(after.onboarded).toEqual([PromptId.Spend]);
  });

  it('folds a corrupt profile to fresh rather than throwing on the front door', () => {
    // `loadProfile`'s own contract (p1-01): a blob it cannot use is backed up and
    // replaced. Onboarding must inherit that, not add a second failure mode — the
    // cost of the fold is that this player is taught the game once more.
    const storage = store({ [PROFILE_KEY]: '{not json' });
    const ob = bootOnboarding(storage);
    expect(ob.isCompleted(PromptId.Mine)).toBe(false);
    expect(() => ob.update({ nearAsteroid: true, cargo: 1, cargoCap: 2 })).not.toThrow();
    expect(loadProfile(storage).onboarded).toEqual([PromptId.Mine]);
  });
});
