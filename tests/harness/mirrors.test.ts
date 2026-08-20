/**
 * tests/harness/mirrors.test.ts — the a0-112 sweep's own tests. OWNER: QA Agent.
 *
 * `harness/mirrors.ts` produced the numbers in `tests/reports/a0-112-balance.md`,
 * and a report is only worth its instrument. Two classes of claim are tested
 * here, and they are the two the report leans on:
 *
 *  1. **The lineups are fair.** A win rate is attributable to a character only if
 *     seat order and the doubled eighth seat cancel. That is a property of the
 *     rotation, provable without running a match, so it is proved here rather
 *     than asserted in prose.
 *  2. **The statistics say what the table headings say.** Length excludes the
 *     undecided, deaths-per-match and deaths-per-bot are different numbers, and
 *     the fair share is derived from seats held rather than assumed to be 1/N.
 *
 * All of it runs on synthetic rows: the arithmetic must not need a match, and a
 * test that needed 900 of them would not be in the unit suite.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { MATCH_SLOTS, PERSONALITIES, ROSTER, rosterAt } from '../../src/bots';
import { Difficulty } from '../../src/bots';
import {
  FIGHT_LEAF,
  TIERS,
  deathsOf,
  leafShare,
  lengthOf,
  mirrorLineup,
  mmss,
  poolByTier,
  rosterContestLineup,
  rosterRotations,
  seatsByCharacter,
  seatsByTier,
  sumByTier,
  tierOf,
  winSE,
  winsBy,
} from '../../harness/mirrors';
import type { MatchRow } from '../../harness/mirrors';

// ---------------------------------------------------------------------------
// The lineups
// ---------------------------------------------------------------------------

describe('the mirror lineup', () => {
  it('is eight of one character in one hull — nothing to attribute a win to', () => {
    for (const p of ROSTER) {
      const lineup = mirrorLineup(p);
      expect(lineup).toHaveLength(MATCH_SLOTS);
      expect(new Set(lineup.map((s) => s.personality))).toEqual(new Set([p]));
      expect(new Set(lineup.map((s) => s.shipClass))).toEqual(new Set([PERSONALITIES[p].shipClass]));
      expect(lineup.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });
});

describe('the roster contest lineup', () => {
  it('seats every character, and one of them twice — the shipped lobby’s shape', () => {
    const counts = new Map<string, number>();
    for (const slot of rosterContestLineup(0)) counts.set(slot.personality, (counts.get(slot.personality) ?? 0) + 1);
    expect(counts.size).toBe(ROSTER.length);
    expect([...counts.values()].filter((n) => n === 2)).toHaveLength(MATCH_SLOTS - ROSTER.length);
  });

  it('over a full set of rotations every character holds every seat exactly once', () => {
    const seatOf = new Map<string, number[]>(ROSTER.map((p) => [p, []]));
    for (let rot = 0; rot < rosterRotations(); rot++) {
      for (const slot of rosterContestLineup(rot)) seatOf.get(slot.personality)!.push(slot.id);
    }
    for (const p of ROSTER) {
      // Eight seats × seven rotations = 56 seat-slots over seven characters, so
      // each gets eight — and they are eight *different* seats: every chair on
      // the board exactly once. Seat order cannot favour anyone.
      expect(seatOf.get(p)!).toHaveLength(MATCH_SLOTS);
      expect(new Set(seatOf.get(p)!)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
    }
  });

  it('gives every character the doubled seat exactly once', () => {
    const doubled = new Map<string, number>();
    for (let rot = 0; rot < rosterRotations(); rot++) {
      const counts = new Map<string, number>();
      for (const slot of rosterContestLineup(rot)) counts.set(slot.personality, (counts.get(slot.personality) ?? 0) + 1);
      for (const [p, n] of counts) if (n === 2) doubled.set(p, (doubled.get(p) ?? 0) + 1);
    }
    expect([...doubled.values()]).toEqual(ROSTER.map(() => 1));
  });

  it('flies each character in its own hull (GDD §2.9 — a character is a tree and a silhouette)', () => {
    for (const slot of rosterContestLineup(3)) {
      expect(slot.shipClass).toBe(PERSONALITIES[slot.personality].shipClass);
    }
  });
});

describe('the tier axis', () => {
  it('covers the whole roster with no character in two tiers', () => {
    const seen = TIERS.flatMap((t) => rosterAt(t));
    expect(new Set(seen)).toEqual(new Set(ROSTER));
    expect(seen).toHaveLength(ROSTER.length);
  });

  it('agrees with the personality table it is folded from', () => {
    for (const p of ROSTER) expect(tierOf(p)).toBe(PERSONALITIES[p].difficulty);
  });
});

// ---------------------------------------------------------------------------
// The statistics
// ---------------------------------------------------------------------------

/** A synthetic match row — the arithmetic must not depend on running a match. */
function row(over: Partial<MatchRow> = {}): MatchRow {
  return {
    seed: 1,
    lineup: 'mirror:rusty',
    ok: true,
    failure: null,
    seconds: 12 * 60,
    winner: 'rusty',
    winnerClass: ShipClass.Hauler,
    winnerTier: Difficulty.Easy,
    seats: { rusty: 8 },
    deaths: { rusty: 16 },
    leaves: { mine: 900, [FIGHT_LEAF]: 100 },
    decisions: 1000,
    ...over,
  };
}

describe('match length', () => {
  it('is measured over the decided matches only', () => {
    const l = lengthOf([
      row({ seconds: 11 * 60 }),
      row({ seconds: 13 * 60 }),
      row({ ok: false, failure: 'sim-timeout', seconds: 20 * 60, winner: null }),
    ]);
    // Folding the ceiling in would launder a termination failure into a length.
    expect(l.n).toBe(2);
    expect(l.max).toBe(13 * 60);
    expect(l.mean).toBe(12 * 60);
    expect(l.insideFraction).toBe(1);
  });

  it('counts the 10–15 minute window as the target names it (GDD §1)', () => {
    const l = lengthOf([row({ seconds: 9 * 60 }), row({ seconds: 12 * 60 }), row({ seconds: 16 * 60 })]);
    expect(l.insideFraction).toBeCloseTo(1 / 3, 10);
    expect(l.median).toBe(12 * 60);
  });

  it('is empty rather than wrong when nothing decided', () => {
    const l = lengthOf([row({ ok: false, failure: 'stalled', winner: null })]);
    expect(l).toMatchObject({ n: 0, median: 0, insideFraction: 0 });
  });

  it('formats as m:ss', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(61)).toBe('1:01');
    expect(mmss(13 * 60 + 42)).toBe('13:42');
  });
});

describe('win rates', () => {
  const rows = [
    row({ lineup: 'roster:rot0', seats: { rusty: 2, bolt: 6 }, winner: 'rusty' }),
    row({ lineup: 'roster:rot1', seats: { rusty: 2, bolt: 6 }, winner: 'bolt' }),
    row({ lineup: 'roster:rot2', seats: { rusty: 2, bolt: 6 }, winner: 'bolt' }),
    row({ lineup: 'roster:rot3', seats: { rusty: 2, bolt: 6 }, ok: false, failure: 'sim-timeout', winner: null }),
  ];

  it('is a share of the decided matches, and the shares sum to one', () => {
    const wins = winsBy(rows, (r) => r.winner, seatsByCharacter);
    expect(wins.every((w) => w.decided === 3)).toBe(true);
    expect(wins.reduce((a, w) => a + w.rate, 0)).toBeCloseTo(1, 10);
  });

  it('derives the fair share from seats actually held, not from 1/N', () => {
    const wins = winsBy(rows, (r) => r.winner, seatsByCharacter);
    const rusty = wins.find((w) => w.key === 'rusty')!;
    const bolt = wins.find((w) => w.key === 'bolt')!;
    // Two seats of eight is a quarter of the board — a flat 1/2 would call a
    // 33% rate "below fair" when it is a third above it.
    expect(rusty.fairShare).toBeCloseTo(0.25, 10);
    expect(bolt.fairShare).toBeCloseTo(0.75, 10);
    expect(rusty.rate).toBeCloseTo(1 / 3, 10);
  });

  it('folds characters up to tiers without double-counting a seat', () => {
    const mixed = [row({ seats: { rusty: 2, bolt: 2, sable: 2, warden: 2 }, winner: 'sable', winnerTier: Difficulty.Hard })];
    const byTier = winsBy(mixed, (r) => r.winnerTier, seatsByTier);
    expect(byTier.find((w) => w.key === Difficulty.Easy)!.fairShare).toBeCloseTo(0.5, 10);
    expect(byTier.find((w) => w.key === Difficulty.Hard)!.rate).toBe(1);
  });

  it('reports a standard error, so a moved number can be told from a still one', () => {
    // a0-107 argued this by hand at 96 matches ("SE ≈ 4.9 points"); the table
    // prints it instead.
    expect(winSE(0.5, 96) * 100).toBeCloseTo(5.1, 1);
    expect(winSE(0.4, 96)).toBeGreaterThan(winSE(0.4, 256));
    expect(winSE(0.4, 0)).toBe(0);
  });
});

describe('deaths', () => {
  it('separates the board’s deaths from one bot’s deaths', () => {
    const d = deathsOf([row({ seats: { rusty: 8 }, deaths: { rusty: 16 }, seconds: 600 })], () => true);
    expect(d.perMatch).toBe(16); // the whole board
    expect(d.perSeatMatch).toBe(2); // one bot
    expect(d.perSeatMinute).toBeCloseTo(2 / 10, 10); // …per minute of it
  });

  it('only counts matches the filtered character was actually in', () => {
    const rows = [
      row({ seats: { rusty: 8 }, deaths: { rusty: 16 } }),
      row({ lineup: 'mirror:bolt', seats: { bolt: 8 }, deaths: { bolt: 40 } }),
    ];
    const rusty = deathsOf(rows, (c) => c === 'rusty');
    expect(rusty.matches).toBe(1);
    expect(rusty.deaths).toBe(16);
    expect(rusty.perMatch).toBe(16);
  });

  it('weights a doubled seat as two seats’ worth of deaths', () => {
    const d = deathsOf([row({ seats: { rusty: 2 }, deaths: { rusty: 6 } })], (c) => c === 'rusty');
    expect(d.seatMatches).toBe(2);
    expect(d.perSeatMatch).toBe(3);
  });

  it('folds to a tier through the personality table', () => {
    expect(sumByTier({ rusty: 4, bolt: 6, sable: 10 })).toEqual({ easy: 10, hard: 10 });
  });
});

describe('the decision census', () => {
  it('is a share of decisions, not of seconds', () => {
    expect(leafShare({ mine: 900, [FIGHT_LEAF]: 100 }, FIGHT_LEAF)).toBeCloseTo(0.1, 10);
    expect(leafShare({}, FIGHT_LEAF)).toBe(0);
    expect(leafShare({ mine: 10 }, FIGHT_LEAF)).toBe(0);
  });

  it('pools per-character censuses up to a tier', () => {
    const pooled = poolByTier({
      rusty: { mine: 10, [FIGHT_LEAF]: 10 },
      bolt: { mine: 30, [FIGHT_LEAF]: 10 },
      sable: { mine: 5, [FIGHT_LEAF]: 5 },
    });
    expect(pooled[Difficulty.Easy]).toEqual({ mine: 40, [FIGHT_LEAF]: 20 });
    expect(leafShare(pooled[Difficulty.Easy]!, FIGHT_LEAF)).toBeCloseTo(1 / 3, 10);
    expect(leafShare(pooled[Difficulty.Hard]!, FIGHT_LEAF)).toBeCloseTo(0.5, 10);
  });
});
