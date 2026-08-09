/**
 * src/ui/summary-sequence.test.ts — the choreographed summary, headless.
 *
 * The four rules of plan §6.4 are the spine of this file, in its order:
 *
 *  1. **skipping lands on exactly the same numbers as watching** — asserted the
 *     way the plan asks for it, with a skip injected at every 100 ms mark and the
 *     final models compared BYTE for byte (`JSON.stringify`), not field by field;
 *  2. **the animation never computes a number** — every final value is fixed by
 *     `buildSummary` before a frame exists, and no frame ever shows more than it;
 *  3. **reduced motion is the end state**, level-up included;
 *  4. the phone size is `end-of-match.test.ts`'s (the layout half), and the two
 *     cases that look like bugs — several levels in one match, and almost no XP
 *     at all — are here.
 */

import { describe, it, expect } from 'vitest';
import { Difficulty } from '../bots';
import { zeroByTier, type MatchAccrual } from '../progression/accrual';
import { levelForXp, xpToNext, xpToReach } from '../progression/curve';
import { xpForMatch } from '../progression/xp';
import {
  SUMMARY_MAX_LEVEL_UPS,
  SUMMARY_ROW_ORDER,
  SUMMARY_TIMING,
  buildSummary,
  summaryFrame,
} from './summary-sequence';
import type { SummaryInput, SummarySequence } from './summary-sequence';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A blank seat's match — every count zero, nobody outlasted, no win. */
function blankAccrual(over: Partial<MatchAccrual> = {}): MatchAccrual {
  return {
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
    placement: 8,
    won: false,
    seconds: 0,
    damageDealt: zeroByTier(),
    shipKills: zeroByTier(),
    stationKills: zeroByTier(),
    ...over,
  };
}

/** A played match: ore in the hold, damage on Medium hulls, two kills, and the
 *  flavour rows the developer asked for by name. */
function playedAccrual(over: Partial<MatchAccrual> = {}): MatchAccrual {
  return blankAccrual({
    oreMined: 42,
    oreBanked: 30,
    oreUsed: 18,
    distance: 61_819,
    shipsUsed: 3,
    structures: 4,
    upgrades: 2,
    repairs: 1,
    wavesSurvived: 5,
    placement: 2,
    seconds: 252,
    damageDealt: { ...zeroByTier(), [Difficulty.Medium]: 1240 },
    shipKills: { ...zeroByTier(), [Difficulty.Medium]: 2 },
    ...over,
  });
}

function sequenceFor(over: Partial<SummaryInput> = {}): SummarySequence {
  const accrual = over.accrual ?? playedAccrual();
  return buildSummary({ accrual, xp: xpForMatch(accrual), startXp: 0, ...over });
}

/** Every 100 ms mark from before the first frame to past the last one — the
 *  plan's own skip grid. */
function skipMarks(seq: SummarySequence): number[] {
  const marks: number[] = [];
  for (let t = 0; t <= seq.duration + 1; t += 0.1) marks.push(Math.round(t * 1000) / 1000);
  return marks;
}

// ---------------------------------------------------------------------------
// The rows — plan §6.2
// ---------------------------------------------------------------------------

describe('the seven rows', () => {
  it('shows exactly the plan’s seven, in its order', () => {
    expect(SUMMARY_ROW_ORDER).toEqual([
      'oreMined',
      'damage',
      'shipKills',
      'stationKills',
      'distance',
      'shipsUsed',
      'oreUsed',
    ]);
    expect(sequenceFor().rows.map((r) => r.key)).toEqual([...SUMMARY_ROW_ORDER]);
  });

  it('reads its values off the accrual, and damage in HP', () => {
    const rows = sequenceFor().rows;
    const by = (key: string): (typeof rows)[number] => rows.find((r) => r.key === key)!;
    expect(by('oreMined').value).toBe(42);
    expect(by('damage').value).toBe(1240);
    expect(by('damage').unit).toBe(' HP');
    expect(by('shipKills').value).toBe(2);
    expect(by('distance').value).toBe(61_819);
    expect(by('shipsUsed').value).toBe(3);
    expect(by('oreUsed').value).toBe(18);
  });

  it('carries the XP each paying row earned, and no XP on the flavour rows', () => {
    const rows = sequenceFor().rows;
    const by = (key: string): (typeof rows)[number] => rows.find((r) => r.key === key)!;
    expect(by('oreMined').xp).toBe(42);
    expect(by('damage').xp).toBeGreaterThan(0);
    expect(by('distance').xp).toBeNull();
    expect(by('shipsUsed').xp).toBeNull();
    expect(by('oreUsed').xp).toBeNull();
  });

  it('shows a station kill the CRUSH took as —, never as 0 (plan §1.3c)', () => {
    const crushed = sequenceFor({ uncreditedStationDeaths: true });
    const row = crushed.rows.find((r) => r.key === 'stationKills')!;
    expect(row.value).toBeNull();
    expect(summaryFrame(crushed, crushed.duration).rows[3]!.text).toBe('—');
  });

  it('shows a plain 0 when every station death WAS credited to somebody', () => {
    const seq = sequenceFor({ uncreditedStationDeaths: false });
    expect(seq.rows.find((r) => r.key === 'stationKills')!.value).toBe(0);
    expect(summaryFrame(seq, seq.duration).rows[3]!.text).toBe('0');
  });

  it('prints the match time as one line under the headline', () => {
    expect(sequenceFor().matchTime).toBe('04:12');
    expect(sequenceFor({ accrual: playedAccrual({ seconds: 9 }) }).matchTime).toBe('00:09');
    expect(sequenceFor({ accrual: playedAccrual({ seconds: 3725 }) }).matchTime).toBe('1:02:05');
  });

  it('takes the XP TOTAL from the priced match, never from the seven rows', () => {
    const accrual = playedAccrual();
    const priced = xpForMatch(accrual);
    const seq = buildSummary({ accrual, xp: priced, startXp: 0 });
    // The total pays eleven rows (plan §1.3d); the screen draws seven. A total
    // summed from what is DRAWN would be a different, smaller number.
    expect(seq.xpTotal).toBe(priced.total);
    expect(seq.xpTotal).toBeGreaterThan(seq.rows.reduce((s, r) => s + (r.xp ?? 0), 0));
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — the animation never computes a number
// ---------------------------------------------------------------------------

describe('the numbers are fixed before the first frame (rule 2)', () => {
  it('never shows a row above its final value, at any moment', () => {
    const seq = sequenceFor();
    for (let t = 0; t <= seq.duration + 0.5; t += 0.02) {
      const frame = summaryFrame(seq, t);
      frame.rows.forEach((row, i) => {
        const final = seq.rows[i]!.value;
        if (final === null) return;
        expect(row.value).toBeGreaterThanOrEqual(0);
        expect(row.value).toBeLessThanOrEqual(final);
      });
      expect(frame.xpValue).toBeLessThanOrEqual(seq.xpTotal);
    }
  });

  it('is a pure function of (sequence, elapsed): same input, same frame', () => {
    const seq = sequenceFor();
    for (const t of [0, 1.3, 2.4, 3.9, 5.2]) {
      expect(JSON.stringify(summaryFrame(seq, t))).toBe(JSON.stringify(summaryFrame(seq, t)));
    }
  });

  it('lands every row and the total on their exact final values', () => {
    const seq = sequenceFor();
    const end = summaryFrame(seq, seq.duration);
    end.rows.forEach((row, i) => expect(row.value).toBe(seq.rows[i]!.value));
    expect(end.xpValue).toBe(seq.xpTotal);
  });

  it('holds the settled screen still forever — a frame an hour later is the same', () => {
    const seq = sequenceFor();
    expect(JSON.stringify(summaryFrame(seq, seq.duration))).toBe(
      JSON.stringify(summaryFrame(seq, seq.duration + 3600)),
    );
  });
});

// ---------------------------------------------------------------------------
// The timeline — plan §6.3
// ---------------------------------------------------------------------------

describe('the timeline', () => {
  it('lands the RESULT alone first — no row, no total, no bar (beat 0)', () => {
    const seq = sequenceFor();
    const frame = summaryFrame(seq, SUMMARY_TIMING.result - 0.01);
    expect(frame.phase).toBe('result');
    expect(frame.rows.every((r) => r.appear === 0)).toBe(true);
    expect(frame.xpAppear).toBe(0);
    expect(frame.barAppear).toBe(0);
    expect(frame.buttonsLive).toBe(false);
  });

  it('arrives one row at a time, each counting up from 0', () => {
    const seq = sequenceFor();
    const justAfterFirst = summaryFrame(seq, SUMMARY_TIMING.result + 0.01);
    expect(justAfterFirst.rows[0]!.appear).toBeGreaterThan(0);
    expect(justAfterFirst.rows[0]!.value).toBeLessThan(seq.rows[0]!.value!);
    expect(justAfterFirst.rows[1]!.appear).toBe(0);

    const secondRowIn = summaryFrame(seq, SUMMARY_TIMING.result + SUMMARY_TIMING.rowStagger + 0.01);
    expect(secondRowIn.rows[1]!.appear).toBeGreaterThan(0);
  });

  it('counts the XP total after the rows, and the bar after the total', () => {
    const seq = sequenceFor();
    expect(summaryFrame(seq, seq.totalStart + 0.01).phase).toBe('total');
    expect(summaryFrame(seq, seq.barStart + 0.01).phase).toBe('fill');
    expect(seq.barStart).toBeGreaterThan(seq.totalStart);
    expect(seq.totalStart).toBeGreaterThan(SUMMARY_TIMING.result);
  });

  it('gives the buttons the screen only at the settle (the first input skips)', () => {
    const seq = sequenceFor();
    expect(summaryFrame(seq, seq.settleStart - 0.01).buttonsLive).toBe(false);
    expect(summaryFrame(seq, seq.settleStart + 0.01).buttonsLive).toBe(true);
    expect(summaryFrame(seq, seq.duration).done).toBe(true);
  });

  it('starts the bar WHERE THE PLAYER STARTED, not at zero', () => {
    const startXp = 200; // level 1 costs 300, so this is two-thirds of the way in
    const seq = sequenceFor({ startXp });
    const opening = summaryFrame(seq, seq.barStart);
    expect(opening.barFrac).toBeCloseTo(200 / xpToNext(1), 6);
    expect(opening.level).toBe(1);
  });

  it('ticks the count-up monotonically, and stops ticking once the total lands', () => {
    const seq = sequenceFor();
    let last = -1;
    for (let t = 0; t <= seq.duration; t += 0.05) {
      const ticks = summaryFrame(seq, t).ticks;
      expect(ticks).toBeGreaterThanOrEqual(last);
      last = ticks;
    }
    expect(summaryFrame(seq, seq.totalEnd).ticks).toBe(summaryFrame(seq, seq.duration).ticks);
  });
});

// ---------------------------------------------------------------------------
// Rule 1 — skippable, always, onto the same numbers
// ---------------------------------------------------------------------------

describe('skipping (rule 1)', () => {
  it('lands BYTE-IDENTICAL final models from every 100 ms mark', () => {
    for (const seq of [sequenceFor(), sequenceFor({ startXp: 1180 }), sequenceFor({ startXp: 40 })]) {
      const watched = JSON.stringify(summaryFrame(seq, seq.duration));
      for (const mark of skipMarks(seq)) {
        expect(JSON.stringify(summaryFrame(seq, mark, { skipped: true })), `skip at ${mark}s`).toBe(
          watched,
        );
      }
    }
  });

  it('jumps to the settle, with the buttons live and nothing still counting', () => {
    const seq = sequenceFor();
    const skipped = summaryFrame(seq, 0.3, { skipped: true });
    expect(skipped.phase).toBe('settle');
    expect(skipped.done).toBe(true);
    expect(skipped.buttonsLive).toBe(true);
    expect(skipped.barMoving).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — prefers-reduced-motion
// ---------------------------------------------------------------------------

describe('reduced motion (rule 3)', () => {
  it('is the sequence’s own END STATE, byte for byte', () => {
    const seq = sequenceFor({ startXp: 250 }); // crosses a level boundary
    expect(JSON.stringify(summaryFrame(seq, 0, { reducedMotion: true }))).toBe(
      JSON.stringify(summaryFrame(seq, seq.duration)),
    );
  });

  it('still MARKS the level-up rather than silently dropping it', () => {
    const seq = sequenceFor({ startXp: 250 });
    expect(seq.levelUps).toBeGreaterThan(0);
    expect(summaryFrame(seq, 0, { reducedMotion: true }).leveledUp).toBe(true);
    expect(summaryFrame(seq, 0, { reducedMotion: true }).level).toBe(seq.endLevel);
  });

  it('marks nothing when the match earned no level', () => {
    const seq = sequenceFor({ accrual: blankAccrual() });
    expect(seq.levelUps).toBe(0);
    expect(summaryFrame(seq, 0, { reducedMotion: true }).leveledUp).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The two cases that look like bugs (plan §6.4)
// ---------------------------------------------------------------------------

describe('more than one level in a match', () => {
  /** A match that pays enough to cross `levels` boundaries from a fresh profile. */
  const bigMatch = (oreMined: number): SummarySequence =>
    sequenceFor({ accrual: playedAccrual({ oreMined, oreBanked: oreMined }) });

  it('repeats the level-up beat, each subsequent fill capped at 0.5 s', () => {
    const seq = bigMatch(700); // two levels from zero
    expect(seq.levelUps).toBe(2);
    expect(seq.collapsed).toBe(false);
    expect(seq.fills[0]!.seconds).toBe(SUMMARY_TIMING.barFill);
    for (const fill of seq.fills.slice(1)) expect(fill.seconds).toBe(SUMMARY_TIMING.barRefill);
    expect(seq.fills.filter((f) => f.levelUp).length).toBe(2);
  });

  it('ticks the readout up on each one, and empties the bar behind it', () => {
    const seq = bigMatch(700);
    const first = seq.fills[0]!;
    const flash = summaryFrame(seq, first.start + first.seconds + 0.05);
    expect(flash.phase).toBe('levelUp');
    expect(flash.barFrac).toBe(1);
    expect(flash.flash).toBeGreaterThan(0);
    const after = summaryFrame(seq, first.start + first.seconds + SUMMARY_TIMING.levelUp - 0.01);
    expect(after.level).toBe(seq.startLevel + 1);
    expect(after.barFrac).toBe(0);
  });

  it('COLLAPSES past three: one beat, then the final level and LEVEL n (+k)', () => {
    const seq = sequenceFor({ startXp: 0, accrual: playedAccrual({ oreMined: 6000, oreBanked: 6000 }) });
    expect(seq.levelUps).toBeGreaterThan(SUMMARY_MAX_LEVEL_UPS);
    expect(seq.collapsed).toBe(true);
    expect(seq.fills.length).toBe(1);
    const end = summaryFrame(seq, seq.duration);
    expect(end.level).toBe(seq.endLevel);
    expect(end.levelText).toBe(`LEVEL ${seq.endLevel} (+${seq.levelUps})`);
    // …and it is still shorter than watching four bars fill.
    expect(seq.duration).toBeLessThan(
      seq.barStart + SUMMARY_TIMING.barFill + 4 * (SUMMARY_TIMING.levelUp + SUMMARY_TIMING.barRefill),
    );
  });

  it('names the plain level with no suffix when nothing collapsed', () => {
    const seq = sequenceFor();
    expect(summaryFrame(seq, seq.duration).levelText).toBe(`LEVEL ${seq.endLevel}`);
  });
});

describe('almost no XP at all', () => {
  const tiny = (): SummarySequence =>
    sequenceFor({ accrual: blankAccrual({ oreMined: 34, seconds: 40, placement: 8 }), startXp: 0 });

  it('still animates the bar for its FULL beat-3 duration', () => {
    const seq = tiny();
    expect(seq.xpTotal).toBeLessThan(100);
    expect(seq.fills.length).toBe(1);
    expect(seq.fills[0]!.seconds).toBe(SUMMARY_TIMING.barFill);
    expect(summaryFrame(seq, seq.barStart + 0.7).barMoving).toBe(true);
  });

  it('carries the number that DID move in the readout', () => {
    const seq = tiny();
    const end = summaryFrame(seq, seq.duration);
    expect(end.progressText).toBe(`+${seq.xpTotal} XP · ${xpToNext(1) - seq.xpTotal} TO NEXT`);
  });

  it('moves the bar visibly rather than not at all', () => {
    const seq = tiny();
    const before = summaryFrame(seq, seq.barStart).barFrac;
    const after = summaryFrame(seq, seq.duration).barFrac;
    expect(after).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// The profile arithmetic this screen reports
// ---------------------------------------------------------------------------

describe('the level arithmetic is the curve’s, never this module’s', () => {
  it('reads the start and end levels off levelForXp', () => {
    const accrual = playedAccrual();
    const priced = xpForMatch(accrual);
    const startXp = xpToReach(3) + 10;
    const seq = buildSummary({ accrual, xp: priced, startXp });
    expect(seq.startLevel).toBe(levelForXp(startXp));
    expect(seq.endLevel).toBe(levelForXp(startXp + priced.total));
    expect(seq.endXp).toBe(startXp + priced.total);
  });

  it('folds a junk lifetime total rather than propagating it into a bar', () => {
    const accrual = blankAccrual();
    const seq = buildSummary({ accrual, xp: xpForMatch(accrual), startXp: Number.NaN });
    const end = summaryFrame(seq, seq.duration);
    expect(Number.isFinite(end.barFrac)).toBe(true);
    expect(end.barFrac).toBeGreaterThanOrEqual(0);
    expect(end.level).toBeGreaterThanOrEqual(1);
  });
});
