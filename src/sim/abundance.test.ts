/**
 * src/sim/abundance.test.ts — ore scarcity: the abundance multiplier system.
 * OWNER: Gameplay Engineer (ratified developer p11).
 *
 * The ratified checklist (p11, item 5): multiplier math per level, the respawn
 * interval honored by the spawner, fairness at every level, the config default =
 * SCARCE, and determinism. Each is one section below. The *balance* of SCARCE
 * (ore-per-minute down ~40%, matches still resolve, repair/turtle green) is
 * measured with the harness and lives in the p11 scarcity report, not here — this
 * file pins the mechanism, not the tuning.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  ABUNDANCE,
  DEFAULT_ABUNDANCE,
  FIELD_YIELD,
  RESOURCE_FIELD,
  WAVE,
  WAVE_COUNT,
  WAVE_INTERVAL_S,
  type Abundance,
  abundanceMultipliers,
  collapseDeadline,
  createWorld,
  homeFieldOreFor,
  isCollapsed,
  matchAbundance,
  resolveEconomy,
  step,
  waveOreFor,
} from './index';
import { ffaConfig, type MatchConfig } from './match-config';

const LEVELS: readonly Abundance[] = ['scarce', 'standard', 'rich'];

/** Every unit of ore loose in the world — unmined rock plus its mine buffer plus
 *  loose chunks. The same quantity the fairness/yield tests measure. */
function oreInWorld(world: ReturnType<typeof createWorld>): number {
  let ore = 0;
  for (const a of world.asteroids) ore += a.ore + a.mineBuffer;
  for (const c of world.chunks) if (!c.deposit) ore += c.amount;
  return ore;
}

/** A fresh two-player world at a given abundance (or the bare default). */
function world(abundance?: Abundance, seed = 7) {
  return createWorld({
    seed,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Vanguard },
    ],
    ...(abundance ? { abundance } : {}),
  });
}

/** Local ore per home: sum of a planet's own home-field rocks (`home === owner`).
 *  All `N` must be equal — the fairness invariant, at any abundance. */
function homeTotals(w: ReturnType<typeof createWorld>): number[] {
  return w.planets
    .filter((p) => !p.derelict)
    .map((p) => w.asteroids.filter((a) => a.home === p.owner).reduce((s, a) => s + a.ore, 0));
}

describe('abundance — multiplier math per level', () => {
  it('STANDARD is the pre-p11 baseline: every multiplier is exactly 1', () => {
    expect(ABUNDANCE.standard).toEqual({ totalOre: 1, density: 1, respawnInterval: 1 });
  });

  it('is ordered lean→rich on ore and density, and inverted on respawn interval', () => {
    // More ore and more rocks as you climb; a longer WAIT (bigger interval) as you
    // descend — SCARCE respawns are a real wait, RICH a quick refill.
    expect(ABUNDANCE.scarce.totalOre).toBeLessThan(ABUNDANCE.standard.totalOre);
    expect(ABUNDANCE.standard.totalOre).toBeLessThan(ABUNDANCE.rich.totalOre);
    expect(ABUNDANCE.scarce.density).toBeLessThan(ABUNDANCE.standard.density);
    expect(ABUNDANCE.standard.density).toBeLessThan(ABUNDANCE.rich.density);
    expect(ABUNDANCE.scarce.respawnInterval).toBeGreaterThan(1);
    expect(ABUNDANCE.rich.respawnInterval).toBeLessThan(1);
  });

  it('SCARCE cuts total ore meaningfully — the developer target (30–50% below)', () => {
    const cut = 1 - ABUNDANCE.scarce.totalOre;
    expect(cut).toBeGreaterThanOrEqual(0.3);
    expect(cut).toBeLessThanOrEqual(0.5);
  });

  it('resolveEconomy applies the table: yield, counts (≥1, rounded), interval', () => {
    for (const level of LEVELS) {
      const m = abundanceMultipliers(level);
      const e = resolveEconomy(level);
      expect(e.abundance).toBe(level);
      expect(e.fieldYield).toBeCloseTo(FIELD_YIELD * m.totalOre, 9);
      expect(e.homeCount).toBe(Math.max(1, Math.round(RESOURCE_FIELD.homeCount * m.density)));
      expect(e.asteroidsPerWave).toBe(Math.max(1, Math.round(WAVE.asteroidsPerWave * m.density)));
      expect(e.waveInterval).toBeCloseTo(WAVE_INTERVAL_S * m.respawnInterval, 9);
    }
  });

  it('resolveEconomy defaults to STANDARD (the legacy-safe primitive default)', () => {
    expect(resolveEconomy()).toEqual(resolveEconomy('standard'));
  });

  it('an asteroidCount override wins over the density-scaled per-wave count', () => {
    expect(resolveEconomy('scarce', 33).asteroidsPerWave).toBe(33);
    expect(resolveEconomy('rich', 1).asteroidsPerWave).toBe(1);
  });

  it('the commons/home ore split stays exact under the yield multiplier', () => {
    for (const level of LEVELS) {
      const e = resolveEconomy(level);
      // commons (all WAVE_COUNT waves) + homes (all N) === the whole yield.
      const commons = waveOreFor(e.fieldYield) * WAVE_COUNT;
      const homes = homeFieldOreFor(e.fieldYield, 4) * 4;
      expect(commons + homes).toBeCloseTo(e.fieldYield, 6);
    }
  });
});

describe('abundance — config default is SCARCE', () => {
  it('DEFAULT_ABUNDANCE is scarce ("by default more scarce")', () => {
    expect(DEFAULT_ABUNDANCE).toBe('scarce');
  });

  it('matchAbundance defaults an unset config to SCARCE, honors an explicit one', () => {
    const bare: MatchConfig = ffaConfig(4, ShipClass.Vanguard);
    expect(bare.abundance).toBeUndefined();
    expect(matchAbundance(bare)).toBe('scarce');
    expect(matchAbundance({ ...bare, abundance: 'rich' })).toBe('rich');
    expect(matchAbundance({ ...bare, abundance: 'standard' })).toBe('standard');
  });

  it('a bare createWorld (no abundance) stays the STANDARD baseline — legacy safe', () => {
    const w = world();
    expect(w.economy?.abundance).toBe('standard');
    // Whole field out (nobody mines): loose ore is exactly the baseline yield.
    while (!isCollapsed(w)) step(w, [], 1);
    expect(oreInWorld(w)).toBeCloseTo(FIELD_YIELD, 5);
  });
});

describe('abundance — total ore scales the whole field', () => {
  it('the finished field holds exactly the resolved yield at every level', () => {
    for (const level of LEVELS) {
      const w = world(level);
      expect(w.economy?.fieldYield).toBeCloseTo(FIELD_YIELD * ABUNDANCE[level].totalOre, 6);
      while (!isCollapsed(w)) step(w, [], 1);
      expect(oreInWorld(w), `${level} finished field`).toBeCloseTo(w.economy!.fieldYield, 4);
    }
  });

  it('SCARCE seeds a leaner field than STANDARD, RICH a richer one', () => {
    const scarce = oreInWorld(world('scarce'));
    const standard = oreInWorld(world('standard'));
    const rich = oreInWorld(world('rich'));
    expect(scarce).toBeLessThan(standard);
    expect(standard).toBeLessThan(rich);
  });
});

describe('abundance — respawn interval honored by the spawner', () => {
  it('waves land on the scaled interval, not the baseline', () => {
    // At SCARCE the interval is longer, so wave 2 is genuinely later than the
    // baseline 150 s — the spawner reads world.economy.waveInterval.
    const scarceInterval = resolveEconomy('scarce').waveInterval;
    expect(scarceInterval).toBeGreaterThan(WAVE_INTERVAL_S);

    const w = world('scarce');
    expect(w.match.wavesSpawned).toBe(1); // wave 1 at t0

    // Step to just past the BASELINE interval: a baseline spawner would already
    // have dropped wave 2, but SCARCE has not.
    while (w.time < WAVE_INTERVAL_S + 2) step(w, [], 1);
    expect(w.match.wavesSpawned).toBe(1);

    // Step past the SCALED interval: now wave 2 lands.
    while (w.time < scarceInterval + 2) step(w, [], 1);
    expect(w.match.wavesSpawned).toBe(2);
  });

  it('RICH refills quicker than the baseline', () => {
    const richInterval = resolveEconomy('rich').waveInterval;
    expect(richInterval).toBeLessThan(WAVE_INTERVAL_S);
    const w = world('rich');
    while (w.time < richInterval + 2) step(w, [], 1);
    expect(w.match.wavesSpawned).toBe(2); // already on wave 2 before the baseline would
  });
});

describe('abundance — match length holds (collapse deadline re-anchored)', () => {
  it('every level collapses no later than the baseline deadline', () => {
    const baseline = collapseDeadline(world('standard'));
    for (const level of LEVELS) {
      const w = world(level);
      // The whole schedule fits before the deadline (all waves land in time).
      const lastWave = (WAVE_COUNT - 1) * resolveEconomy(level).waveInterval;
      expect(lastWave).toBeLessThanOrEqual(collapseDeadline(w));
      // The re-anchor keeps the deadline at the baseline — a longer SCARCE
      // interval never lengthens the match past target (GDD §1).
      expect(collapseDeadline(w)).toBeCloseTo(baseline, 6);
    }
  });

  it('a full-turtle field resolves inside the 15-minute target at every level', () => {
    for (const level of LEVELS) {
      const w = world(level);
      let ticks = 0;
      while (w.match.phase !== 'ended' && ticks < 15 * 60 + 5) {
        step(w, [], 1);
        ticks++;
      }
      expect(w.match.phase, `${level} resolves`).toBe('ended');
      expect(w.time, `${level} within 15 min`).toBeLessThanOrEqual(15 * 60);
    }
  });
});

describe('abundance — fairness untouched at every level (p1-09)', () => {
  it('all home fields hold exactly equal ore at each abundance and player count', () => {
    for (const level of LEVELS) {
      for (const n of [2, 3, 5, 8]) {
        const w = createWorld({
          seed: 100 + n,
          players: Array.from({ length: n }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
          abundance: level,
        });
        const totals = homeTotals(w);
        expect(totals.length).toBe(n);
        expect(totals[0]).toBeGreaterThan(0);
        for (const t of totals) expect(t).toBeCloseTo(totals[0]!, 6);
      }
    }
  });

  it('every home carries homeFieldOreFor(yield, N) — the scaled fair share', () => {
    for (const level of LEVELS) {
      const n = 4;
      const w = createWorld({
        seed: 42,
        players: Array.from({ length: n }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
        abundance: level,
      });
      const expected = homeFieldOreFor(w.economy!.fieldYield, n);
      for (const t of homeTotals(w)) expect(t).toBeCloseTo(expected, 5);
    }
  });
});

describe('abundance — determinism', () => {
  it('same seed + same level builds a byte-identical world', () => {
    for (const level of LEVELS) {
      expect(world(level, 5)).toEqual(world(level, 5));
    }
  });

  it('stepping a scarce world twice yields identical state', () => {
    const a = world('scarce', 9);
    const b = world('scarce', 9);
    for (let t = 0; t < 300; t++) {
      step(a, [], 1);
      step(b, [], 1);
    }
    expect(a).toEqual(b);
  });
});
