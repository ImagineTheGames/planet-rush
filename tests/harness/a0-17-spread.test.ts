/**
 * tests/harness/a0-17-spread.test.ts — the widened abundance interval spread.
 * OWNER: QA Agent (GDD §2.8, §3.8).
 *
 * a0-17 widened the SCARCE↔RICH wave-interval spread on the developer's report
 * that 37.5 seconds "is not a big change". Three things are worth a test rather
 * than a report line, because a report cannot fail CI:
 *
 *  1. **The spread does not quietly shrink back.** The whole brief was that the
 *     difference must be felt; a later tuning pass that narrows it should have to
 *     say so out loud.
 *  2. **The rails the spread was argued against still hold** — the collapse
 *     deadline stays on its pre-p11 anchor at every level, and all five waves
 *     land before collapse can open at every level. These are the two claims the
 *     report's headline rests on.
 *  3. **The instrument that measured it is exact.** `waveIntervalOverride`
 *     (`harness/match.ts`) is what let QA price a candidate `respawnInterval`
 *     without editing the constants table between runs. If it perturbed the world
 *     in any other way, every number in `tests/reports/abundance-spread-a0-17.md`
 *     would be measuring something the shipped game does not do.
 *
 * Nothing here pins a literal multiplier: the table is QA's to tune (GDD §2.8).
 * What is pinned is the *shape* — wider than p11 ever was, ordered lean→rich, and
 * inside the rails.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  ABUNDANCE,
  WAVE_COUNT,
  WAVE_INTERVAL_S,
  collapseDeadline,
  createWorld,
  isCollapsed,
  resolveEconomy,
  step,
  waveIntervalOf,
} from '../../src/sim';
import type { Abundance } from '../../src/sim';
import {
  LEVELS,
  deadlineFor,
  intervalOf,
  lastWaveTime,
  maxIntervalHoldingAnchor,
  maxIntervalInsideRail,
  shippedSpread,
  worstCaseEnd,
} from '../../harness/abundance';
import { buildWorld, mirrorLineup } from '../../harness/match';

/** The spread p11 shipped, in seconds — the thing a0-17 was filed to beat. */
const P11_SPREAD_S = 165 - 127.5;

function world(abundance?: Abundance, seed = 7) {
  return createWorld({
    seed,
    players: Array.from({ length: 4 }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
    ...(abundance ? { abundance } : {}),
  });
}

describe('a0-17 — the interval spread is actually wide', () => {
  it('SCARCE↔RICH is meaningfully wider than the spread p11 shipped', () => {
    const s = shippedSpread();
    expect(s.spread).toBeGreaterThan(P11_SPREAD_S * 1.5);
  });

  it('a SCARCE wave gap is at least half again a RICH one', () => {
    // The felt read: "a wave every three minutes" against "a wave every two".
    const s = shippedSpread();
    expect(s.scarce / s.rich).toBeGreaterThanOrEqual(1.5);
  });

  it('is still ordered lean → rich, with STANDARD the untouched baseline', () => {
    expect(ABUNDANCE.scarce.respawnInterval).toBeGreaterThan(1);
    expect(ABUNDANCE.standard.respawnInterval).toBe(1);
    expect(ABUNDANCE.rich.respawnInterval).toBeLessThan(1);
  });

  it('leaves totalOre and density exactly where p11 ratified them (rhythm, not richness)', () => {
    expect(ABUNDANCE.scarce.totalOre).toBe(0.55);
    expect(ABUNDANCE.scarce.density).toBe(0.75);
    expect(ABUNDANCE.rich.totalOre).toBe(1.6);
    expect(ABUNDANCE.rich.density).toBe(1.25);
  });
});

describe('a0-17 — the rails the spread was argued against', () => {
  it('every level sits inside the interval band the length rail admits', () => {
    // The band the report is argued from: past `maxIntervalHoldingAnchor` the
    // collapse deadline (and so the match) starts growing with the interval.
    for (const level of LEVELS) {
      const interval = intervalOf({ level });
      expect(interval, `${level} interval`).toBeLessThanOrEqual(maxIntervalHoldingAnchor());
      expect(worstCaseEnd(interval), `${level} worst case`).toBeLessThanOrEqual(15 * 60);
    }
    // …and the anchor bound is the tighter of the two, which is why it is what
    // set the shipped SCARCE value.
    expect(maxIntervalHoldingAnchor()).toBeLessThan(maxIntervalInsideRail());
  });

  it('the harness closed form agrees with the sim, level by level', () => {
    // `deadlineFor` restates `match.ts` `collapseDeadline` so a candidate can be
    // priced without building a world. If they ever drift, the report is wrong.
    for (const level of LEVELS) {
      expect(deadlineFor(intervalOf({ level })), level).toBeCloseTo(collapseDeadline(world(level)), 9);
    }
  });

  it('the collapse deadline stays on its pre-p11 anchor at every level', () => {
    const baseline = collapseDeadline(world('standard'));
    for (const level of LEVELS) {
      expect(collapseDeadline(world(level)), level).toBeCloseTo(baseline, 9);
    }
  });

  it('all five waves land before collapse can open, at every level', () => {
    // The brief's worst outcome — a wave that lands after collapse and therefore
    // never matters. It cannot happen (`enterCollapseIfDue` gates on
    // `allWavesSpawned`), and the schedule also fits inside the deadline, so the
    // final wave is not merely delivered but delivered with grace left to mine it.
    for (const level of LEVELS) {
      const interval = intervalOf({ level });
      expect(lastWaveTime(interval), `${level} last wave`).toBeLessThan(deadlineFor(interval));

      const w = world(level);
      while (!isCollapsed(w)) step(w, [], 1);
      expect(w.match.wavesSpawned, `${level} waves delivered`).toBe(WAVE_COUNT);
    }
  });
});

describe('a0-17 — the measuring instrument is exact', () => {
  const lineup = mirrorLineup('miner', ShipClass.Vanguard, 4);

  it('forcing a level its OWN interval changes nothing about the world', () => {
    // The override's only job is to replace one number. Handed the number the
    // table already resolved to, it must be a no-op — otherwise every candidate
    // reading is measuring the instrument, not the game.
    for (const level of LEVELS) {
      const plain = buildWorld({ seed: 3, lineup, abundance: level });
      const forced = buildWorld({
        seed: 3,
        lineup,
        abundance: level,
        waveIntervalOverride: resolveEconomy(level).waveInterval,
      });
      expect(forced, level).toEqual(plain);
    }
  });

  it('a forced interval is what every consumer reads, and what the spawner uses', () => {
    const forced = 200;
    const w = buildWorld({ seed: 3, lineup, abundance: 'standard', waveIntervalOverride: forced });
    // `waveIntervalOf` is the one accessor the spawner, the collapse deadline,
    // the HUD clock and bot perception share (a0-16).
    expect(waveIntervalOf(w)).toBe(forced);
    expect(collapseDeadline(w)).toBeCloseTo(deadlineFor(forced), 9);

    expect(w.match.wavesSpawned).toBe(1);
    while (w.time < WAVE_INTERVAL_S + 2) step(w, [], 1); // past the BASELINE gap…
    expect(w.match.wavesSpawned).toBe(1); // …and no wave has landed.
    while (w.time < forced + 2) step(w, [], 1);
    expect(w.match.wavesSpawned).toBe(2);
  });

  it('the abundance passthrough reaches createWorld', () => {
    for (const level of LEVELS) {
      expect(buildWorld({ seed: 3, lineup, abundance: level }).economy?.abundance).toBe(level);
    }
    // Omitted stays the legacy-safe baseline, so every pre-a0-17 sweep is unchanged.
    expect(buildWorld({ seed: 3, lineup }).economy?.abundance).toBe('standard');
  });

  it('refuses a nonsense interval rather than measuring one', () => {
    expect(() => buildWorld({ seed: 3, lineup, waveIntervalOverride: 0 })).toThrow(/positive/);
    expect(() => buildWorld({ seed: 3, lineup, waveIntervalOverride: -5 })).toThrow(/positive/);
  });
});
