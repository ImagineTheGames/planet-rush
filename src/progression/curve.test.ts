/**
 * src/progression/curve.test.ts — the level curve, headless and pure.
 *
 * Off-by-one here is a level-up that fires at the wrong moment on a screen built
 * entirely around that moment, so the boundaries are asserted in both directions
 * for every level the tables cover. The junk-input cases are not paranoia: a
 * corrupt-but-parseable profile reaches these functions, and an unbounded walk
 * on `Infinity` is a hung tab on a screen a player cannot leave.
 */

import { describe, it, expect } from 'vitest';
import {
  XP_CURVE_BASE,
  XP_CURVE_EXP,
  XP_MAX_LEVEL,
  levelForXp,
  levelProgress,
  xpToNext,
  xpToReach,
} from './curve';

describe('the dials', () => {
  it('ships the RATIFIED base and exponent (2026-08-07)', () => {
    expect(XP_CURVE_BASE).toBe(300);
    expect(XP_CURVE_EXP).toBe(1.6);
  });
});

describe('xpToNext', () => {
  it('reproduces round(300 · L^1.6) at L = 1…20', () => {
    for (let l = 1; l <= 20; l++) {
      expect(xpToNext(l)).toBe(Math.round(300 * l ** 1.6));
    }
  });

  it('starts at 300 and rises', () => {
    expect(xpToNext(1)).toBe(300);
    for (let l = 1; l < 20; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
  });
});

describe('levelForXp', () => {
  it('is level 1 at 0 XP, and never returns 0 or a negative', () => {
    expect(levelForXp(0)).toBe(1);
    for (const xp of [0, 1, 299, 300, 5000, 1e9]) expect(levelForXp(xp)).toBeGreaterThanOrEqual(1);
  });

  it('lands exactly on the boundary in both directions for n = 2…20', () => {
    for (let n = 2; n <= 20; n++) {
      expect(levelForXp(xpToReach(n))).toBe(n);
      expect(levelForXp(xpToReach(n) - 1)).toBe(n - 1);
    }
  });

  it('reaches level 2 inside a single match — the ratified curve\'s own claim', () => {
    // Plan §1.4: level 2 lands at 0.8 of one match. A match's median pay is not
    // this module's to assert; that the FIRST level costs one match's order of
    // magnitude (300 XP) is.
    expect(xpToReach(2)).toBe(300);
  });
});

describe('junk in', () => {
  it('never loops and never returns nonsense', () => {
    for (const xp of [Number.NaN, -1, -1e9, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 12.5]) {
      const level = levelForXp(xp);
      expect(Number.isInteger(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(XP_MAX_LEVEL);
    }
  });

  it('caps the walk instead of hanging on Infinity', () => {
    expect(levelForXp(Number.POSITIVE_INFINITY)).toBe(XP_MAX_LEVEL);
    expect(levelForXp(Number.MAX_VALUE)).toBe(XP_MAX_LEVEL);
  });

  it('folds junk levels rather than propagating them', () => {
    expect(xpToNext(Number.NaN)).toBe(xpToNext(1));
    expect(xpToNext(0)).toBe(xpToNext(1));
    expect(xpToNext(-4)).toBe(xpToNext(1));
    expect(xpToReach(Number.NaN)).toBe(0);
    expect(xpToReach(1)).toBe(0);
  });

  it('survives a corrupt-but-parseable total on the progress bar', () => {
    for (const xp of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const p = levelProgress(xp);
      expect(p.frac).toBeGreaterThanOrEqual(0);
      expect(p.frac).toBeLessThan(1);
      expect(p.level).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('levelProgress', () => {
  it('is consistent with the other three at every level 1…20', () => {
    for (let n = 1; n <= 20; n++) {
      const at = xpToReach(n);
      for (const offset of [0, 1, Math.floor(xpToNext(n) / 2), xpToNext(n) - 1]) {
        const p = levelProgress(at + offset);
        expect(p.level).toBe(n);
        expect(p.into + p.toNext).toBe(xpToNext(p.level));
        expect(p.frac).toBeGreaterThanOrEqual(0);
        expect(p.frac).toBeLessThan(1);
        expect(p.into).toBe(offset);
      }
    }
  });

  it('starts a fresh career at the bottom of level 1', () => {
    expect(levelProgress(0)).toEqual({ level: 1, into: 0, toNext: 300, frac: 0 });
  });

  it('never draws a FULL bar under the level it has not reached yet', () => {
    // The frame before a level-up: one XP short of the boundary. The bar is very
    // nearly full and the number still says the old level — which is correct, and
    // is exactly the moment the summary screen animates through.
    const p = levelProgress(xpToReach(3) - 1);
    expect(p.level).toBe(2);
    expect(p.toNext).toBe(1);
    expect(p.frac).toBeLessThan(1);
  });
});
