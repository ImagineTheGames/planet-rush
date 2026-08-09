/**
 * src/progression/xp.test.ts — the §1.3d table, pinned as literals. OWNER: UI
 * Engineer (p1-04; `docs/briefs/pr-04-accrual-and-xp.md`,
 * `docs/progression-plan.md` §1.3a–d).
 *
 * The weights are asserted as the NUMBERS THE PLAN PUBLISHES, never as
 * `XP_PER_ORE_MINED * n` — a test written against the constant would restate the
 * implementation and stay green through a re-tune, which is the one thing the
 * table lock exists to catch. When the developer moves a dial these go red, and
 * that is the point: the doc and the code disagree, and somebody must say which
 * one moved (the same discipline as `./curve.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { Difficulty } from '../bots';
import { zeroByTier, type MatchAccrual } from './accrual';
import {
  DAMAGE_HP_PER_UNIT,
  HUMAN_TIER,
  TIER_MULTIPLIER,
  xpForMatch,
  type XpRowKey,
} from './xp';

/** An accrual that earned nothing at all — the base every row below is added to,
 *  so each assertion prices exactly one row. */
const nothing = (over: Partial<MatchAccrual> = {}): MatchAccrual => ({
  slot: 0,
  slots: 8,
  oreMined: 0,
  oreBanked: 0,
  oreUsed: 0,
  distance: 0,
  shipsUsed: 1,
  structures: 0,
  upgrades: 0,
  repairs: 0,
  wavesSurvived: 0,
  placement: 8, // first out: no rungs, so placement pays nothing by default
  won: false,
  seconds: 0,
  damageDealt: zeroByTier(),
  shipKills: zeroByTier(),
  stationKills: zeroByTier(),
  ...over,
});

const tier = (t: Difficulty, n: number): Record<Difficulty, number> => ({ ...zeroByTier(), [t]: n });
const xpOf = (a: MatchAccrual): number => xpForMatch(a).total;
const rowOf = (a: MatchAccrual, key: XpRowKey) => xpForMatch(a).rows.find((r) => r.key === key)!;

describe('the ratified four (plan §1.3d rows 1-4)', () => {
  it('pays 1 XP per ore mined, and never multiplies it — ore has no opponent', () => {
    expect(xpOf(nothing({ oreMined: 40 }))).toBe(40);
    expect(rowOf(nothing({ oreMined: 40 }), 'oreMined').tierScaled).toBe(false);
  });

  it('pays 2 XP per 25 HP of damage dealt', () => {
    expect(DAMAGE_HP_PER_UNIT).toBe(25);
    // 500 HP against Medium = 20 units × 2 XP.
    expect(xpOf(nothing({ damageDealt: tier(Difficulty.Medium, 500) }))).toBe(40);
  });

  it('pays 5 XP per ship destroyed and 10 XP per station destroyed', () => {
    expect(xpOf(nothing({ shipKills: tier(Difficulty.Medium, 6) }))).toBe(30);
    expect(xpOf(nothing({ stationKills: tier(Difficulty.Medium, 3) }))).toBe(30);
  });
});

describe("s4's participation rows (plan §1.3d rows 5-11, Question A)", () => {
  it('pays the published weight for each, and multiplies none of them', () => {
    expect(xpOf(nothing({ oreBanked: 10 }))).toBe(20); // 2 / ore
    expect(xpOf(nothing({ structures: 4 }))).toBe(48); // 12 each
    expect(xpOf(nothing({ upgrades: 3 }))).toBe(60); // 20 / tier
    expect(xpOf(nothing({ repairs: 7 }))).toBe(21); // 3 / patch
    expect(xpOf(nothing({ wavesSurvived: 5 }))).toBe(75); // 15 / wave
    expect(xpOf(nothing({ slots: 8, placement: 1 }))).toBe(140); // 20 × 7 rungs
    expect(xpOf(nothing({ won: true }))).toBe(200); // flat

    for (const key of ['oreBanked', 'structures', 'upgrades', 'repairs', 'waves', 'placement', 'win'] as const) {
      expect(rowOf(nothing(), key).tierScaled).toBe(false);
    }
  });

  it('counts a rung per player outlasted — none for the first one out', () => {
    expect(rowOf(nothing({ slots: 8, placement: 3 }), 'placement').count).toBe(5);
    expect(rowOf(nothing({ slots: 8, placement: 8 }), 'placement').count).toBe(0);
  });
});

describe('the opponent-tier multiplier (plan §1.3b)', () => {
  it('is 0.75 / 1.0 / 1.25, with a human scored at the top tier', () => {
    expect(TIER_MULTIPLIER[Difficulty.Easy]).toBe(0.75);
    expect(TIER_MULTIPLIER[Difficulty.Medium]).toBe(1.0);
    expect(TIER_MULTIPLIER[Difficulty.Hard]).toBe(1.25);
    // A decision, not a measurement: contesting a person is the point of the mode.
    expect(HUMAN_TIER).toBe(Difficulty.Hard);
    expect(TIER_MULTIPLIER[HUMAN_TIER]).toBe(1.25);
  });

  it('applies to the three opponent-facing rows and to no others', () => {
    // Two lobbies, identical accrual, different opposition.
    const common: Partial<MatchAccrual> = {
      oreMined: 100,
      oreBanked: 50,
      structures: 2,
      upgrades: 1,
      repairs: 2,
      wavesSurvived: 4,
      slots: 8,
      placement: 2,
      won: false,
    };
    const easy = xpForMatch(nothing({
      ...common,
      damageDealt: tier(Difficulty.Easy, 400),
      shipKills: tier(Difficulty.Easy, 8),
      stationKills: tier(Difficulty.Easy, 1),
    }));
    const hard = xpForMatch(nothing({
      ...common,
      damageDealt: tier(Difficulty.Hard, 400),
      shipKills: tier(Difficulty.Hard, 8),
      stationKills: tier(Difficulty.Hard, 1),
    }));

    const differ = easy.rows.filter((r, i) => r.xp !== hard.rows[i]!.xp).map((r) => r.key);
    expect(differ).toEqual(['damage', 'shipKills', 'stationKills']);
    for (const key of ['damage', 'shipKills', 'stationKills'] as const) {
      expect(rowOf(nothing(), key).tierScaled).toBe(true);
    }
    // …and by exactly the published ratio.
    expect(rowOf(nothing({ shipKills: tier(Difficulty.Easy, 8) }), 'shipKills').xp).toBe(30); // 8 × 5 × 0.75
    expect(rowOf(nothing({ shipKills: tier(Difficulty.Hard, 8) }), 'shipKills').xp).toBe(50); // 8 × 5 × 1.25
    expect(rowOf(nothing({ stationKills: tier(Difficulty.Easy, 4) }), 'stationKills').xp).toBe(30);
    expect(rowOf(nothing({ damageDealt: tier(Difficulty.Hard, 500) }), 'damage').xp).toBe(50);
  });

  it('sums a mixed lobby tier by tier', () => {
    const mixed = nothing({
      shipKills: { [Difficulty.Easy]: 4, [Difficulty.Medium]: 4, [Difficulty.Hard]: 4 },
    });
    // 4×5×0.75 + 4×5×1.0 + 4×5×1.25 = 15 + 20 + 25
    expect(rowOf(mixed, 'shipKills').xp).toBe(60);
  });
});

describe('the shape the summary sequence depends on (plan §6.3)', () => {
  it('is eleven rows, in a fixed order, whatever the match did', () => {
    const order: XpRowKey[] = [
      'oreMined',
      'damage',
      'shipKills',
      'stationKills',
      'oreBanked',
      'structures',
      'upgrades',
      'repairs',
      'waves',
      'placement',
      'win',
    ];
    expect(xpForMatch(nothing()).rows.map((r) => r.key)).toEqual(order);
    expect(xpForMatch(nothing({ oreMined: 9, won: true })).rows.map((r) => r.key)).toEqual(order);
  });

  it('makes the rows sum to the total, exactly', () => {
    const a = nothing({
      oreMined: 37,
      oreBanked: 19,
      structures: 3,
      upgrades: 2,
      repairs: 1.6666,
      wavesSurvived: 5,
      slots: 8,
      placement: 1,
      won: true,
      damageDealt: { [Difficulty.Easy]: 133, [Difficulty.Medium]: 47, [Difficulty.Hard]: 991 },
      shipKills: { [Difficulty.Easy]: 3, [Difficulty.Medium]: 1, [Difficulty.Hard]: 7 },
      stationKills: tier(Difficulty.Hard, 1),
    });
    const priced = xpForMatch(a);
    expect(priced.rows.reduce((sum, r) => sum + r.xp, 0)).toBe(priced.total);
    for (const r of priced.rows) expect(Number.isInteger(r.xp)).toBe(true);
    expect(Number.isInteger(priced.total)).toBe(true);
  });

  it('is pure, and independent of the order the tier keys were written in', () => {
    const forwards = nothing({ damageDealt: { easy: 40, medium: 60, hard: 80 } as Record<Difficulty, number> });
    const backwards = nothing({ damageDealt: { hard: 80, medium: 60, easy: 40 } as Record<Difficulty, number> });
    expect(xpForMatch(forwards)).toEqual(xpForMatch(backwards));
    expect(xpForMatch(forwards)).toEqual(xpForMatch(forwards));
  });

  it('folds junk to zero rather than into a level bar', () => {
    expect(xpOf(nothing({ oreMined: Number.NaN }))).toBe(0);
    expect(xpOf(nothing({ oreMined: -50 }))).toBe(0);
    expect(xpOf(nothing({ repairs: Number.POSITIVE_INFINITY }))).toBe(0);
  });
});
