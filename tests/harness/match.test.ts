/**
 * tests/harness/match.test.ts — the harness's own tests. OWNER: QA Agent.
 *
 * The harness is a measuring instrument, so it needs the same scrutiny as the
 * thing it measures. The load-bearing property is the charter's:
 *
 * > "a hung match is a failed test, not a hung harness" — GDD §3.8
 *
 * which is really three claims, each tested below: the loop **stops**, it stops
 * for a **stated reason**, and it **returns the run it stopped** rather than
 * throwing it away. A harness that hangs on a hung match would take the whole CI
 * job with it, and the failure it was built to report would arrive as a
 * six-hour timeout with no result attached.
 *
 * Everything here runs a real eight-slot match. The sim costs ~0.05 ms per tick
 * (`harness/perf.ts`), so a full match is cheap enough to keep in the unit
 * suite — and a harness tested only against toy worlds is not tested.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { MATCH_SLOTS } from '../../src/bots';
import {
  DECISION_TICKS,
  MATCH_TIMEOUT_S,
  mirrorLineup,
  recordMatch,
  replay,
  roundRobinLineup,
  runMatch,
  runSeeds,
  seedRange,
} from '../../harness/match';
import { STRATEGIES, STRATEGY_IDS } from '../../harness/strategies';

const FIELD = [
  { strategy: 'miner', shipClass: ShipClass.Vanguard },
  { strategy: 'turtle', shipClass: ShipClass.Vanguard },
  { strategy: 'rusher', shipClass: ShipClass.Vanguard },
  { strategy: 'raider', shipClass: ShipClass.Vanguard },
] as const;

describe('the enforced timeout (GDD §3.8)', () => {
  it('stops a match that will not end, and says why', () => {
    // Eight passive seats: nobody ever attacks anybody, so nothing can end this
    // match except the ceiling. This is the exact scenario the rule is about.
    const r = runMatch(
      { seed: 1, lineup: mirrorLineup('idle', ShipClass.Vanguard) },
      { maxSeconds: 30 },
    );
    expect(r.ok).toBe(false);
    expect(r.failure).toBe('sim-timeout');
    expect(r.winner).toBeNull();
    // It stopped *at* the ceiling, not somewhere past it.
    expect(r.seconds).toBeGreaterThanOrEqual(30);
    expect(r.seconds).toBeLessThan(31);
  });

  it('returns the timed-out run instead of throwing it away', () => {
    const r = runMatch({ seed: 1, lineup: mirrorLineup('idle', ShipClass.Vanguard) }, { maxSeconds: 20 });
    // Everything a report needs is still there — a failed match is data.
    expect(r.slots).toHaveLength(MATCH_SLOTS);
    expect(r.ticks).toBeGreaterThan(0);
    expect(r.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(r.world.time).toBeCloseTo(r.seconds, 5);
  });

  it('enforces a wall-clock ceiling independently of sim time', () => {
    // A zero-millisecond budget is the degenerate case of "the harness is too
    // slow": it must trip on the first check rather than run to sim-time.
    const r = runMatch(
      { seed: 1, lineup: mirrorLineup('idle', ShipClass.Vanguard) },
      { maxSeconds: MATCH_TIMEOUT_S, maxWallClockMs: 0 },
    );
    expect(r.failure).toBe('wall-clock');
    expect(r.seconds).toBeLessThan(MATCH_TIMEOUT_S);
  });

  it('rejects a non-positive timestep rather than looping forever', () => {
    expect(() => runMatch({ seed: 1, lineup: mirrorLineup('idle', ShipClass.Vanguard) }, { dt: 0 })).toThrow(
      /dt must be positive/,
    );
  });

  it('completes every run inside its own wall-clock ceiling', () => {
    const r = runMatch({ seed: 1, lineup: mirrorLineup('idle', ShipClass.Vanguard) }, { maxSeconds: 60 });
    expect(r.wallClockMs).toBeLessThan(60_000);
  });
});

describe('a full 8-slot match', () => {
  const setup = { seed: 3, lineup: roundRobinLineup(FIELD) };
  const result = runMatch(setup);

  it('runs eight planets and eight ships (GDD §2.1)', () => {
    expect(setup.lineup).toHaveLength(MATCH_SLOTS);
    expect(result.world.planets).toHaveLength(MATCH_SLOTS);
    expect(result.world.ships).toHaveLength(MATCH_SLOTS);
    expect(result.slots).toHaveLength(MATCH_SLOTS);
  });

  it('reaches an ending with exactly one home standing', () => {
    expect(result.failure).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.winner).not.toBeNull();
    expect(result.world.planets.filter((p) => p.alive)).toHaveLength(1);
  });

  it('crowns the survivor, and records the elimination order behind them', () => {
    const survivor = result.world.planets.find((p) => p.alive);
    expect(result.winner).toBe(survivor?.owner);
    expect(result.eliminated).toHaveLength(MATCH_SLOTS - 1);
    expect(new Set(result.eliminated).size).toBe(MATCH_SLOTS - 1);
    expect(result.eliminated).not.toContain(result.winner);
  });

  it('attributes the win to a strategy and a hull', () => {
    expect(STRATEGY_IDS).toContain(result.winnerStrategy);
    expect(result.winnerClass).toBe(ShipClass.Vanguard);
  });

  it('is reproducible: the same setup produces the same hash and the same winner', () => {
    const again = runMatch(setup);
    expect(again.hash).toBe(result.hash);
    expect(again.winner).toBe(result.winner);
    expect(again.ticks).toBe(result.ticks);
  });

  it('produces different matches from different seeds', () => {
    const other = runMatch({ seed: 4, lineup: roundRobinLineup(FIELD) });
    expect(other.hash).not.toBe(result.hash);
  });
});

describe('lineups', () => {
  it('mirrors one contestant across every seat', () => {
    const lineup = mirrorLineup('miner', ShipClass.Hauler);
    expect(lineup).toHaveLength(MATCH_SLOTS);
    expect(lineup.every((s) => s.strategy === 'miner' && s.shipClass === ShipClass.Hauler)).toBe(true);
    expect(lineup.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('deals contestants round-robin, and rotation moves every seat', () => {
    const a = roundRobinLineup(FIELD, 0);
    const b = roundRobinLineup(FIELD, 1);
    expect(a.map((s) => s.strategy)).toEqual(['miner', 'turtle', 'rusher', 'raider', 'miner', 'turtle', 'rusher', 'raider']);
    expect(b[0]!.strategy).toBe('turtle');
    // Equal seats per contestant is what makes a win rate attributable.
    for (const entry of FIELD) {
      expect(a.filter((s) => s.strategy === entry.strategy)).toHaveLength(MATCH_SLOTS / FIELD.length);
    }
  });

  it('refuses an empty lineup rather than producing an unplayable match', () => {
    expect(() => roundRobinLineup([])).toThrow(/no entries/);
  });
});

describe('record and replay', () => {
  const setup = { seed: 11, lineup: roundRobinLineup(FIELD) };

  it('records one input row per seat per tick', () => {
    const run = recordMatch(setup, { maxSeconds: 5 });
    expect(run.recording.inputs).toHaveLength(run.result.ticks);
    expect(run.recording.inputs[0]).toHaveLength(MATCH_SLOTS);
    expect(run.recording.hash).toBe(run.result.hash);
  });

  it('replays a recording to the hash it was recorded at', () => {
    const run = recordMatch(setup, { maxSeconds: 8 });
    expect(replay(run.recording).hash).toBe(run.recording.hash);
  });
});

describe('QA probe strategies', () => {
  it('every probe emits only ratified actions (GDD §2.4)', () => {
    const verbs = new Set(['thrust', 'aim', 'fire', 'build', 'buildOrder', 'upgradeOrder']);
    const seen = new Set<string>();
    for (const id of STRATEGY_IDS) {
      const setup = { seed: 2, lineup: mirrorLineup(id, ShipClass.Vanguard) };
      const run = recordMatch(setup, { maxSeconds: 40 });
      for (const tick of run.recording.inputs) {
        for (const row of tick) {
          for (const action of row.actions) {
            expect(verbs.has(action.type)).toBe(true);
            seen.add(action.type);
          }
        }
      }
    }
    // The probes together must actually exercise the economy, not just fly:
    // a sweep in which nobody ever buys anything measures nothing about ore.
    expect(seen.has('thrust')).toBe(true);
    expect(seen.has('fire')).toBe(true);
    expect(seen.has('buildOrder')).toBe(true);
    expect(seen.has('upgradeOrder')).toBe(true);
  });

  it('every probe is deterministic: the same view stream gives the same match', () => {
    for (const id of STRATEGY_IDS) {
      const setup = { seed: 5, lineup: mirrorLineup(id, ShipClass.Vanguard) };
      const a = runMatch(setup, { maxSeconds: 60 });
      const b = runMatch(setup, { maxSeconds: 60 });
      expect(b.hash).toBe(a.hash);
    }
  });

  it('names a hypothesis for every probe — a probe nobody can read is not a measurement', () => {
    for (const id of STRATEGY_IDS) {
      expect(STRATEGIES[id].hypothesis.length).toBeGreaterThan(20);
    }
  });

  it('the active probes actually mine, build, and kill', () => {
    // The turtle is the probe that touches the most of the ruleset: it mines,
    // banks, builds turrets and shields, and repairs.
    const r = runMatch({ seed: 1, lineup: mirrorLineup('turtle', ShipClass.Vanguard) }, { maxSeconds: 240 });
    const built = r.world.planets.reduce((n, p) => n + p.turrets.length + p.shields.length, 0);
    expect(built).toBeGreaterThan(8);
    // And the field is being worked: the finite yield has gone down.
    expect(r.fieldOreLeft).toBeLessThan(400);
  });

  it('the rusher ends matches — attacking is what produces a result', () => {
    const r = runMatch({ seed: 1, lineup: mirrorLineup('rusher', ShipClass.Vanguard) });
    expect(r.ok).toBe(true);
    expect(r.eliminated.length).toBe(MATCH_SLOTS - 1);
  });
});

describe('sweeps', () => {
  it('runs a stated span of seeds, in order, with no hidden sampling', () => {
    const seeds = seedRange(3, 10);
    expect(seeds).toEqual([10, 11, 12]);
    const results = runSeeds((seed) => ({ seed, lineup: roundRobinLineup(FIELD) }), seeds, { maxSeconds: 30 });
    expect(results.map((r) => r.seed)).toEqual(seeds);
  });
});

describe('decision cadence', () => {
  it('is a fixed number of ticks, so it cannot drift with frame rate', () => {
    expect(Number.isInteger(DECISION_TICKS)).toBe(true);
    expect(DECISION_TICKS).toBeGreaterThan(0);
  });
});
