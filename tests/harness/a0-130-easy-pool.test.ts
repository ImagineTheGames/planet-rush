/**
 * tests/harness/a0-130-easy-pool.test.ts — the two claims a0-130's report is
 * built on, pinned so they fail a test before they mislead a reader.
 * OWNER: Bot Engineer (a0-130).
 *
 * a0-126 §4.5 resolved Bolt at 67.4% of the Easy pool and handed the dial to
 * this lane. a0-130's answer is that the dial is not a dial: the Easy pool's
 * winner is not the bot that fought best, it is the bot whose reactor is
 * highest when the field closes, because **nothing in an Easy match ever
 * destroys a core in play**. Two things have to be true for that reading to
 * stand, and neither is safe to leave as prose:
 *
 *  1. **The instrument agrees with the one it borrows from.** The report reads
 *     its verdicts off a restatement of a0-126's `verdictOf` (their module runs
 *     a CLI at import, so it cannot be imported into a renderer). A copy that
 *     drifts would quietly re-grade every arm in the report.
 *  2. **The mechanism is what the report says it is.** An Easy-pool match runs
 *     to the collapse with every core alive, and the winner is the seat holding
 *     the uniquely highest core when it opens. That is measured by `autopsy.ts`
 *     rather than argued, and it is measured again here on its own seeds.
 *
 * The second case runs real matches and is therefore slow; it is deliberately
 * small (four matches) because the claim it defends is qualitative — *this is
 * how an Easy match is decided* — and the report's own quantitative version of
 * it runs at 128 seeds.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { Difficulty, rosterAt } from '../../src/bots';
import { strategyLineup } from '../../harness/soak';
import { clopper } from '../../evidence/a0-126-the-last-two-points/stats';
import { verdictOf } from '../../evidence/a0-130-bolt-inside-the-band/arms';
import { autopsy } from '../../evidence/a0-130-bolt-inside-the-band/autopsy';

describe('the verdict rule is a0-126’s, unchanged (a0-130 §1)', () => {
  it('grades the three states off the exact interval, at the knife edge', () => {
    // a0-121 §7.5's Bolt: 10 of 12 decided. Wilson's lower bound clears 55% by
    // two tenths of a point and would print OVER; the exact interval does not,
    // and UNRESOLVED is the truth about ten coin flips (a0-126 §2.6).
    const twelve = clopper(10, 12);
    expect(verdictOf(twelve.lo, twelve.hi)).toBe('UNRESOLVED');

    // a0-126 §4.5's Bolt: 64 of 95, the finding this brief was opened on.
    const ninetyFive = clopper(64, 95);
    expect(verdictOf(ninetyFive.lo, ninetyFive.hi)).toBe('OVER');

    // a0-126 §4.2's Warden: 1844 of 3569, the finding that dissolved.
    const deep = clopper(1844, 3569);
    expect(verdictOf(deep.lo, deep.hi)).toBe('INSIDE');

    // And the boundary itself, stated rather than inferred: an interval that
    // touches the ceiling from below is INSIDE, one that starts exactly on it
    // is not yet OVER.
    expect(verdictOf(0.4, 0.55)).toBe('INSIDE');
    expect(verdictOf(0.55, 0.9)).toBe('UNRESOLVED');
    expect(verdictOf(0.5500001, 0.9)).toBe('OVER');
  });
});

describe('how an Easy-pool match is actually decided (a0-130 §2)', () => {
  const pool = rosterAt(Difficulty.Easy);

  it('reaches the collapse with every core alive, and crowns the highest one', () => {
    // Rusty and Bolt, four seats each, one hull — `harness/mirrors` `tierSection`'s
    // own Easy lineup, so this is the contest the 55% target is read off.
    expect(pool).toEqual(['rusty', 'bolt']);

    for (const seed of [1, 2]) {
      for (let rot = 0; rot < pool.length; rot++) {
        const a = autopsy(seed, strategyLineup(pool, ShipClass.Vanguard, rot));

        // Nothing killed a core in play: the match got to the collapse with all
        // eight homes standing. This is the load-bearing fact — it is why the
        // result is a bookkeeping comparison rather than a fight.
        expect(a.collapseTime, `seed ${seed} rot ${rot}`).toBeGreaterThan(0);
        for (const seat of a.seats) {
          expect(seat.atCollapse, `${seat.personality} @ seed ${seed}`).toBeGreaterThan(0);
        }

        // And the winner, when there is one, is the seat holding the uniquely
        // highest reactor at that instant. A tie there is a same-tick wipe and
        // therefore a draw (a0-113) — which is what 81.4% of this pool is.
        const best = Math.max(...a.seats.map((s) => s.atCollapse));
        const top = a.seats.filter((s) => s.atCollapse > best - 1e-9);
        const unique = new Set(top.map((s) => s.personality));
        if (a.winner === null) {
          expect(top.length, `seed ${seed} rot ${rot} drew, so the top must be tied`).toBeGreaterThan(1);
        } else {
          expect([...unique], `seed ${seed} rot ${rot}`).toContain(a.winner);
        }
      }
    }
  });
});
