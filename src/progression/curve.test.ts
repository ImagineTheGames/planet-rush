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

describe("§1.4's published table", () => {
  // The plan's table, transcribed from `docs/progression-plan.md` §1.4 and kept
  // in its own shape: the row labelled level L carries the cost of the step that
  // ARRIVES at L — `xpToNext(L - 1)` — and `cumTotal` is `xpToReach(L)`. Pinning
  // it as literals is the difference between a test and a restatement: asserting
  // `xpToNext(L) === Math.round(300 * L ** 1.6)` (above) re-derives the formula
  // and would stay green through a change to either dial, and until this block
  // existed nothing anywhere pinned a cumulative total at all — `xpToReach` was
  // only ever checked against itself. pr-05's bar reads these cumulative
  // numbers, and QA re-tunes `base`/`exp` from m10; when they do, the doc should
  // go red here rather than quietly re-deriving around them.
  const TABLE = [
    // level, toNext (= xpToNext(level - 1)), cumTotal (= xpToReach(level)), matches @600XP
    [2, 300, 300, 0.5],
    [3, 909, 1209, 2.0],
    [4, 1740, 2949, 4.9],
    [5, 2757, 5706, 9.5],
    [6, 3940, 9646, 16.1],
    [8, 6750, 21670, 36.1],
    [10, 10090, 40117, 66.9],
    [15, 20461, 120594, 201.0],
    [20, 33352, 260633, 434.4],
  ] as const;

  it('reproduces every published row, character for character', () => {
    for (const [level, toNext, cumTotal] of TABLE) {
      expect(xpToNext(level - 1)).toBe(toNext);
      expect(xpToReach(level)).toBe(cumTotal);
    }
  });

  it("holds §1.4's matches-to-level claims at the 600 XP sample rate", () => {
    // The fourth column is what makes the two dials a design decision rather
    // than arithmetic — "level 10 at ~67 matches" is the sentence the developer
    // ratified. One decimal, the precision the doc prints.
    for (const [level, , cumTotal, matches] of TABLE) {
      expect(Number((cumTotal / 600).toFixed(1))).toBe(matches);
      expect(levelForXp(cumTotal)).toBe(level);
    }
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
