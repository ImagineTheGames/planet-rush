/**
 * tests/harness/p1-08-pay.test.ts — the instrument behind
 * `docs/progression-balance-p1-08.md`. OWNER: QA Agent (GDD §3.8, §4.8).
 *
 * The report re-baselines the XP economy across map, lobby size and abundance.
 * Every number in it comes out of `harness/pay.ts`, so what is worth a test —
 * rather than a report line, because a report cannot fail CI — is the
 * instrument, and the three claims the report's headline actually rests on:
 *
 *  1. **Measuring must not change what is measured.** The accrual observer is a
 *     spectator (`src/progression/accrual.ts`, the `src/sim/ore-ledger.ts`
 *     discipline). If feeding it moved the world by one float, every number in
 *     the report would be describing a game nobody plays — and the determinism
 *     replay (GDD §4.8) would be the next thing to break.
 *  2. **The damage rows are the LEDGER's.** a0-13's spike reconstructed damage
 *     attribution from projectile geometry and published a residual; this rig
 *     reads `world.credit`. The brief is explicit that where the two disagree
 *     the ledger is right, so the test pins that the rig never quietly grew a
 *     reconstruction of its own.
 *  3. **A hung match is a failed MEASUREMENT.** Not a hung harness, and not a
 *     partial match silently pooled into a median (GDD §3.8).
 *
 * The pay numbers themselves are deliberately NOT asserted here: they are QA's
 * to re-measure, and a test that pinned them would have to be edited by every
 * bot-tree change — which is the report's whole finding about who owns them. The
 * one exception is the level-2 hook, pinned at the measured pay the report
 * recommends from, because *that* is the claim the level curve is fitted to.
 */

import { describe, it, expect } from 'vitest';
import { Difficulty, PERSONALITIES, botInputs, createBots, fillEmptySlots } from '../../src/bots';
import { TICK_DT, createWorld, isOver, step } from '../../src/sim';
import type { PlayerSpec } from '../../src/sim';
import { totalByTier } from '../../src/progression/accrual';
import { XP_CURVE_BASE, xpToNext, xpToReach } from '../../src/progression/curve';
import { DAMAGE_HP_PER_UNIT, XP_PER_ORE_MINED } from '../../src/progression/xp';
import { hashState } from '../../harness/hash';
import {
  CURVE_MILESTONES,
  FFA_MAP_IDS,
  LOBBIES,
  MIXED_ROSTER,
  RATIFIED_FOUR,
  XP_ROW_KEYS,
  baseForLevel2In,
  buildPayWorld,
  floorCandidate,
  matchesToLevel,
  medianPlayerMatch,
  payStats,
  percentile,
  playerMatches,
  rowCount,
  runPayMatch,
  seeds,
  summaryCost,
} from '../../harness/pay';
import type { PaySetup } from '../../harness/pay';

/** Long enough for ore, damage, kills and builds to all have happened; short
 *  enough that a whole spec file is seconds, not minutes. Every match below is
 *  therefore *unfinished* on purpose — which is also the harsher test, because a
 *  cut-off match is where an observer's window bookkeeping goes wrong. */
const PROBE_SECONDS = 120;

const setup = (over: Partial<PaySetup> = {}): PaySetup => ({
  seed: 3,
  slots: 8,
  roster: MIXED_ROSTER,
  abundance: 'scarce',
  ...over,
});

/** The same match, stepped with nobody watching — the control for claim 1. */
function unobservedHash(s: PaySetup, seconds: number): string {
  const seats = fillEmptySlots([], s.slots, s.roster);
  const players: PlayerSpec[] = seats.map((seat) => ({
    id: seat.id,
    shipClass: PERSONALITIES[seat.personality].shipClass,
  }));
  const world = createWorld({
    seed: s.seed,
    players,
    mapId: s.mapId ?? 'octagon',
    ...(s.abundance !== undefined ? { abundance: s.abundance } : {}),
  });
  const bots = createBots(seats, { seed: s.seed });
  while (!isOver(world) && world.time < seconds) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
  }
  return hashState(world);
}

describe('p1-08 — measuring the pay does not change the game', () => {
  it('an observed match finishes on the same state hash as an unobserved one', () => {
    // The accrual observer is write-only over its own tally and never touches
    // `World`; if that ever stops being true, this is the test that says so
    // before the determinism replay does.
    const s = setup();
    const observed = runPayMatch(s, { maxSeconds: PROBE_SECONDS });
    expect(observed.hash).toBe(unobservedHash(s, PROBE_SECONDS));
  });

  it('the same setup measures identically twice — same hash, same XP, same rows', () => {
    const s = setup({ seed: 5 });
    const a = runPayMatch(s, { maxSeconds: PROBE_SECONDS });
    const b = runPayMatch(s, { maxSeconds: PROBE_SECONDS });
    expect(b.hash).toBe(a.hash);
    expect(b.xp.map((x) => x.total)).toEqual(a.xp.map((x) => x.total));
    expect(b.accruals).toEqual(a.accruals);
  });
});

describe('p1-08 — the damage rows are read off the ledger, never reconstructed', () => {
  it('every seat’s measured damage equals `world.credit`, to the HP', () => {
    // pr-02's ledger totals damage by ATTACKER with no victim dimension; the
    // observer splits each attacker's total across the victims the ledger says
    // they hit. So the per-attacker SUM across tiers is the invariant: the
    // apportionment may move HP between tier buckets, it may never invent or
    // lose a single HP.
    const s = setup({ seed: 11 });
    const run = runPayMatch(s, { maxSeconds: PROBE_SECONDS });
    const world = buildPayWorld(s); // shape only — the run's own world is below
    expect(world.credit).toBeDefined();

    const ledger = runLedger(s, PROBE_SECONDS);
    run.accruals.forEach((a, slot) => {
      const measured = totalByTier(a.damageDealt);
      const credited = (ledger.dealtToShips[slot] ?? 0) + (ledger.dealtToStations[slot] ?? 0);
      expect(measured, `slot ${slot}`).toBeCloseTo(credited, 6);
    });
  });

  it('kills are the ledger’s killing blows, counted once each', () => {
    const s = setup({ seed: 11 });
    const run = runPayMatch(s, { maxSeconds: PROBE_SECONDS });
    const ledger = runLedger(s, PROBE_SECONDS);
    run.accruals.forEach((a, slot) => {
      expect(totalByTier(a.shipKills), `ships, slot ${slot}`).toBe(ledger.shipKills[slot] ?? 0);
      expect(totalByTier(a.stationKills), `stations, slot ${slot}`).toBe(ledger.stationKills[slot] ?? 0);
    });
  });

  it('a station the Crush finished credits nobody', () => {
    // Plan §1.3c(2): entropy is not an attacker. Measured at 100% of station
    // deaths in an Easy lobby, so the honest total is zero rather than a guess —
    // and the report's station-kill row has to be readable as that.
    const run = runPayMatch(setup({ roster: LOBBIES[0]!.roster, seed: 2 }), { maxSeconds: PROBE_SECONDS });
    const credited = run.accruals.reduce((sum, a) => sum + totalByTier(a.stationKills), 0);
    const ledger = runLedger(setup({ roster: LOBBIES[0]!.roster, seed: 2 }), PROBE_SECONDS);
    expect(credited).toBe(ledger.stationKills.reduce((sum, n) => sum + n, 0));
  });
});

/** The credit ledger of the same match, run without the observer attached. */
function runLedger(s: PaySetup, seconds: number) {
  const seats = fillEmptySlots([], s.slots, s.roster);
  const players: PlayerSpec[] = seats.map((seat) => ({
    id: seat.id,
    shipClass: PERSONALITIES[seat.personality].shipClass,
  }));
  const world = createWorld({
    seed: s.seed,
    players,
    mapId: s.mapId ?? 'octagon',
    ...(s.abundance !== undefined ? { abundance: s.abundance } : {}),
  });
  const bots = createBots(seats, { seed: s.seed });
  while (!isOver(world) && world.time < seconds) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
  }
  return world.credit!;
}

describe('p1-08 — a hung match is a failed measurement, never a hung harness', () => {
  it('a match that cannot end inside its sim-time ceiling comes back, flagged', () => {
    const run = runPayMatch(setup(), { maxSeconds: 5 });
    expect(run.ok).toBe(false);
    expect(run.failure).toBe('sim-timeout');
    expect(run.winner).toBeNull();
    // …and it still hands back what it measured, so a failed measurement is
    // diagnosable rather than lost.
    expect(run.accruals).toHaveLength(8);
  });

  it('a match that cannot end inside its WALL-CLOCK ceiling comes back, flagged', () => {
    const run = runPayMatch(setup(), { maxWallClockMs: 0 });
    expect(run.ok).toBe(false);
    expect(run.failure).toBe('wall-clock');
  });

  it('failed measurements are excluded from the pay tables, and counted', () => {
    const bad = runPayMatch(setup(), { maxSeconds: 5 });
    const stats = payStats([bad]);
    expect(stats.matches).toBe(1);
    expect(stats.ended).toBe(0);
    expect(stats.samples).toBe(0);
    expect(stats.failures).toEqual(['sim-timeout']);
    expect(playerMatches([bad])).toHaveLength(0);
  });

  it('refuses a nonsense observation cadence rather than measuring one', () => {
    expect(() => runPayMatch(setup(), { observeEveryTicks: 0 })).toThrow(/positive integer/);
    expect(() => runPayMatch(setup(), { dt: 0 })).toThrow(/positive/);
  });
});

describe('p1-08 — the axes the plan never swept actually reach the world', () => {
  it('lobby size builds exactly that many seats, and moves per-player ore density', () => {
    for (const slots of [3, 4, 5, 6, 8]) {
      const world = buildPayWorld(setup({ slots }));
      expect(world.ships, `N=${slots}`).toHaveLength(slots);
    }
    // The reason N is an axis at all (`homeFieldOre(n)`, plan §1.2): the same
    // finite field split across fewer homes is more ore each.
    const orePerHead = (slots: number): number =>
      buildPayWorld(setup({ slots })).asteroids.reduce((sum, a) => sum + a.ore, 0) / slots;
    expect(orePerHead(3)).toBeGreaterThan(orePerHead(8) * 2);
  });

  it('every FFA map builds, and none of them is the same board', () => {
    const hashes = FFA_MAP_IDS.map((mapId) => hashState(buildPayWorld(setup({ mapId }))));
    expect(new Set(hashes).size).toBe(FFA_MAP_IDS.length);
  });

  it('abundance reaches the resolved economy — and omitting it is NOT the shipped default', () => {
    for (const abundance of ['scarce', 'standard', 'rich'] as const) {
      expect(buildPayWorld(setup({ abundance })).economy?.abundance).toBe(abundance);
    }
    // The trap the report is built around: `createWorld` keeps `standard` for
    // compatibility while the lobby ships `scarce`, so a rig that omits it
    // measures a game nobody plays. a0-13's spike omitted it.
    const s = setup();
    const bare: PaySetup = { seed: s.seed, slots: s.slots, roster: s.roster };
    expect(buildPayWorld(bare).economy?.abundance).toBe('standard');
  });

  it('the cast carries its difficulty tier into the scoring', () => {
    // The tier is what the multiplier reads (plan §1.3b), and it is why this rig
    // seats the real cast instead of `harness/match.ts`'s probes.
    const easy = runPayMatch(setup({ roster: LOBBIES[0]!.roster }), { maxSeconds: 30 });
    expect(new Set(easy.tiers)).toEqual(new Set([Difficulty.Easy]));
    const hard = runPayMatch(setup({ roster: LOBBIES[2]!.roster }), { maxSeconds: 30 });
    expect(new Set(hard.tiers)).toEqual(new Set([Difficulty.Hard]));
  });
});

describe('p1-08 — the report’s arithmetic', () => {
  it('matches-to-level reads the SHIPPED curve, so the report cannot quote another one', () => {
    expect(matchesToLevel(xpToReach(5), 5)).toBe(1);
    for (const level of CURVE_MILESTONES) {
      expect(matchesToLevel(300, level)).toBeCloseTo(xpToReach(level) / 300, 9);
    }
    expect(matchesToLevel(0, 2)).toBe(Infinity);
  });

  it('the level-2 hook is exactly `XP_CURVE_BASE ≤ pay`, whatever the exponent is', () => {
    // `xpToNext(1) = base · 1^exp = base`, which is why `base` is the only dial
    // the report recommends moving and why moving it leaves the tail alone.
    expect(xpToNext(1)).toBe(XP_CURVE_BASE);
    expect(baseForLevel2In(437)).toBe(437);
    expect(matchesToLevel(XP_CURVE_BASE, 2)).toBe(1);
  });

  it('the four-only pay is a subset of the full pay, row for row', () => {
    const run = runPayMatch(setup({ seed: 9 }), { maxSeconds: PROBE_SECONDS });
    const stats = payStats([{ ...run, ok: true, failure: null }]);
    expect(stats.fourOnlyMedianXp).toBeLessThanOrEqual(stats.medianXp);
    // The four are the developer's, verbatim, and the other seven are Question A.
    expect([...RATIFIED_FOUR]).toEqual(['oreMined', 'damage', 'shipKills', 'stationKills']);
    expect(XP_ROW_KEYS.slice(0, 4)).toEqual([...RATIFIED_FOUR]);
    expect(XP_ROW_KEYS).toHaveLength(11);
  });

  it('the composition shares sum to 1 over a measured cell', () => {
    const run = runPayMatch(setup({ seed: 9 }), { maxSeconds: PROBE_SECONDS });
    const stats = payStats([{ ...run, ok: true, failure: null }]);
    const total = XP_ROW_KEYS.reduce((sum, k) => sum + stats.composition[k], 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it('a percentile reports a value some seat actually earned', () => {
    // Nearest-rank, no interpolation: "the p25 player earned 255" has to be a
    // sentence about a player, because the report writes it as one.
    const xs = [10, 20, 30, 40];
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 0.25)).toBe(10);
    expect(percentile(xs, 0.5)).toBe(20);
    expect(percentile(xs, 1)).toBe(40);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('a candidate floor is priced against the SAME matches, and the control is the shipped pay', () => {
    // `harness/abundance.ts`'s discipline, applied to XP: two candidates are
    // comparable because they are the same twelve matches re-priced, never a
    // second sweep taken on a different afternoon.
    const run = { ...runPayMatch(setup({ seed: 9 }), { maxSeconds: PROBE_SECONDS }), ok: true, failure: null };
    const control = floorCandidate([run], 'control', () => 0);
    const stats = payStats([run]);
    expect(control.medianXp).toBe(stats.medianXp);
    expect(control.firstOutXp).toBe(stats.firstOutXp);
    expect(control.p25Xp).toBe(stats.p25Xp);

    const flat = floorCandidate([run], 'flat +100', () => 100);
    expect(flat.medianXp).toBe(control.medianXp + 100);
    expect(flat.firstOutL2).toBeLessThanOrEqual(control.firstOutL2);

    // The row-count reader is what a re-weighted candidate is built from.
    const p = medianPlayerMatch([run])!;
    expect(rowCount(p, 'waves')).toBe(p.accrual.wavesSurvived);
    expect(rowCount(p, 'oreMined')).toBe(p.accrual.oreMined);
  });

  it('doubling the placement rung cannot pay the first player out — by construction', () => {
    // The finding that made the report recommend a flat row instead: `rungs =
    // slots − placement`, so the first out clears zero of them and a bigger rung
    // pays them nothing while paying the winner twice.
    const run = { ...runPayMatch(setup({ seed: 9 }), { maxSeconds: PROBE_SECONDS }), ok: true, failure: null };
    const firstOut = playerMatches([run]).filter((p) => p.firstOut);
    expect(firstOut.length).toBeGreaterThan(0);
    for (const p of firstOut) expect(rowCount(p, 'placement')).toBe(0);
  });

  it('the summary sequence cost is read off pr-05, and grows with the level-ups', () => {
    const run = runPayMatch(setup({ seed: 9 }), { maxSeconds: PROBE_SECONDS });
    const p = medianPlayerMatch([{ ...run, ok: true, failure: null }])!;
    const cost = summaryCost(p.accrual, p.xp, 50);
    expect(cost.matches).toBe(50);
    expect(cost.totalSeconds).toBeGreaterThan(0);
    // The first match carries the level-2 beat the whole curve is fitted to, so
    // it is never the cheapest sequence in the career.
    expect(cost.firstMatchSeconds).toBeGreaterThanOrEqual(cost.medianSeconds);
    expect(cost.maxSeconds).toBeGreaterThanOrEqual(cost.firstMatchSeconds);
  });
});

describe('p1-08 — the report’s headline claim, pinned', () => {
  /**
   * The median XP a real match paid, measured over the committed sample
   * (`spikes/progression/measured-p1-08.txt`: MIXED cast, octagon, N=8, SCARCE —
   * the shipped lobby default — seeds 1..12). The report recommends `base`,
   * `exp` and `DAMAGE_HP_PER_UNIT` unchanged **because of this number**, so it is
   * the number a future tuning pass has to argue with.
   *
   * Deliberately a floor rather than the exact reading: the pay is a property of
   * the bot trees and moves whenever the Bot Engineer touches them (plan
   * §1.3c(3)). What must not move silently is the *hook*.
   */
  const MEASURED_MEDIAN_PAY = 500;

  it('level 2 still lands inside a single match at the measured pay', () => {
    expect(matchesToLevel(MEASURED_MEDIAN_PAY, 2)).toBeLessThanOrEqual(1);
  });

  it('the three constants the report recommends keeping are the ones that shipped', () => {
    // A re-tune is QA's to make (GDD §2.8) — but it may not happen by accident
    // while a committed report says these numbers are the measured ones.
    expect(XP_CURVE_BASE).toBe(300);
    expect(DAMAGE_HP_PER_UNIT).toBe(25);
    expect(XP_PER_ORE_MINED).toBe(1);
  });

  it('the sample the report states is the sample the rig runs', () => {
    expect(seeds(12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(LOBBIES.map((l) => l.label)).toEqual([
      'EASY mirror',
      'MEDIUM mirror',
      'HARD mirror',
      'MIXED cast',
    ]);
    expect(FFA_MAP_IDS).toEqual(['octagon', 'compass', 'oval', 'diamond']);
  });
});
