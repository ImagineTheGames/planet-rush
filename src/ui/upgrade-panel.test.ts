/**
 * Upgrade panel tests (GDD §2.5, §2.2). The load-bearing contracts:
 *  - **every row gives current value → next tier → ore cost** — that triple is
 *    what makes upgrading an explicit trade against turrets and repair;
 *  - this is the **only** place ship stats appear, so all four tracks are
 *    present at every tier, including finished ones;
 *  - **upgrades multiply the class base** (GDD §2.5, §2.11), so a maxed
 *    Interceptor is still the fastest thing on the map;
 *  - cargo obeys the ratified "+2 per tier, cap 8" (GDD §2.8).
 * These are the day-2 DoD tests: panel rows.
 */
import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  upgradePanelModel,
  trackBase,
  trackValue,
  formatTrackValue,
  UpgradeTrack,
  TRACK_ORDER,
  STOCK_TIERS,
  UPGRADE_LADDER,
} from './upgrade-panel';
import type { UpgradePanelSignals, UpgradeTiers } from './upgrade-panel';
import { CARGO_CAP_MAX, SHIP_STATS } from '../sim/constants';

function tiers(over: Partial<Record<UpgradeTrack, number>> = {}): UpgradeTiers {
  return { ...STOCK_TIERS, ...over };
}

function sig(over: Partial<UpgradePanelSignals> = {}): UpgradePanelSignals {
  return {
    open: true,
    shipClass: ShipClass.Vanguard,
    tiers: STOCK_TIERS,
    ore: 0,
    ...over,
  };
}

/** The row for one track. */
function rowOf(track: UpgradeTrack, over: Partial<UpgradePanelSignals> = {}) {
  const row = upgradePanelModel(sig(over)).rows.find((r) => r.track === track);
  expect(row).toBeDefined();
  return row!;
}

describe('the panel is the one place ship stats appear (GDD §2.2, §2.5)', () => {
  it('shows a row for each of the four upgrade tracks', () => {
    const rows = upgradePanelModel(sig()).rows;
    expect(rows.map((r) => r.track)).toEqual([...TRACK_ORDER]);
    expect(rows.map((r) => r.label)).toEqual(['BEAM', 'ENGINE', 'CARGO', 'HULL']);
  });

  it('names the hull being upgraded — locked at the lobby (GDD §2.11)', () => {
    expect(upgradePanelModel(sig({ shipClass: ShipClass.Hauler })).className).toBe('HAULER');
    expect(upgradePanelModel(sig({ shipClass: ShipClass.Interceptor })).className).toBe(
      'INTERCEPTOR',
    );
  });

  it('opens only when asked — it lives behind the wheel\'s arrow', () => {
    expect(upgradePanelModel(sig({ open: false })).open).toBe(false);
    expect(upgradePanelModel(sig({ open: true })).open).toBe(true);
  });

  it('keeps beam as ONE track: mining speed and weapon damage are one stat', () => {
    // GDD §2.5 — "beam power (mining speed and weapon damage — one beam, one
    // stat)". Two rows here would be two stats, and the inversion the game
    // turns on would stop reading.
    const beamRows = upgradePanelModel(sig()).rows.filter((r) => r.track === UpgradeTrack.Beam);
    expect(beamRows).toHaveLength(1);
  });
});

describe('every row gives current → next → cost (GDD §2.5)', () => {
  it('prints the stock value as "current" on a fresh ship', () => {
    // The Vanguard is the balance reference: beam 10, hull 50, cargo 2, 100%.
    expect(rowOf(UpgradeTrack.Beam).current).toBe('10');
    expect(rowOf(UpgradeTrack.Hull).current).toBe('50');
    expect(rowOf(UpgradeTrack.Cargo).current).toBe('2');
    expect(rowOf(UpgradeTrack.Engine).current).toBe('100%');
  });

  it('prints the next tier\'s value, not the delta', () => {
    const beam = rowOf(UpgradeTrack.Beam);
    // Base 10 × the first step (1.25) = 13 (rounded) — the value the player
    // will have, so the trade is legible without arithmetic.
    expect(beam.next).toBe('13');
    expect(rowOf(UpgradeTrack.Cargo).next).toBe('4'); // +2 per tier (GDD §2.8)
  });

  it('prints an ore cost on every buyable row, and the costs escalate', () => {
    for (const track of TRACK_ORDER) {
      const row = rowOf(track);
      expect(row.cost).not.toBeNull();
      expect(row.cost).toBeGreaterThan(0);
    }
    // "Escalating cost" (GDD §2.5) — each tier costs strictly more than the last.
    for (const spec of Object.values(UPGRADE_LADDER)) {
      for (let i = 1; i < spec.costs.length; i++) {
        expect(spec.costs[i]!).toBeGreaterThan(spec.costs[i - 1]!);
      }
    }
  });

  it('advances current and next together as tiers are bought', () => {
    const t1 = rowOf(UpgradeTrack.Cargo, { tiers: tiers({ [UpgradeTrack.Cargo]: 1 }) });
    expect(t1.tier).toBe(1);
    expect(t1.current).toBe('4');
    expect(t1.next).toBe('6');
    expect(t1.cost).toBe(UPGRADE_LADDER[UpgradeTrack.Cargo].costs[1]);
  });
});

describe('affordability — the explicit trade against turrets and repair', () => {
  it('marks a row ready only when the ore is actually there', () => {
    const cost = UPGRADE_LADDER[UpgradeTrack.Beam].costs[0]!;
    expect(rowOf(UpgradeTrack.Beam, { ore: cost - 1 }).state).toBe('unaffordable');
    expect(rowOf(UpgradeTrack.Beam, { ore: cost }).state).toBe('ready');
  });

  it('echoes the same whole-ore total the wheel\'s hub shows', () => {
    expect(upgradePanelModel(sig({ ore: 7.9 })).ore).toBe(7);
    expect(upgradePanelModel(sig({ ore: -3 })).ore).toBe(0);
  });
});

describe('a finished ladder (GDD §2.5 — stats live here, maxed or not)', () => {
  it('still shows the current value at max tier, with no next and no cost', () => {
    const maxTier = UPGRADE_LADDER[UpgradeTrack.Beam].steps.length - 1;
    const row = rowOf(UpgradeTrack.Beam, {
      tiers: tiers({ [UpgradeTrack.Beam]: maxTier }),
      ore: 999,
    });
    expect(row.state).toBe('maxed');
    expect(row.current).toBe('18'); // 10 × 1.8
    expect(row.next).toBeNull();
    expect(row.cost).toBeNull();
  });

  it('clamps a tier beyond the ladder rather than reading past its end', () => {
    const row = rowOf(UpgradeTrack.Hull, { tiers: tiers({ [UpgradeTrack.Hull]: 99 }) });
    expect(row.tier).toBe(row.maxTier);
    expect(row.state).toBe('maxed');
    expect(Number.isFinite(Number(row.current))).toBe(true);
  });
});

describe('upgrades multiply the class base (GDD §2.5, §2.11)', () => {
  it('keeps class identity at every tier — a maxed Hauler is still the toughest', () => {
    const spec = UPGRADE_LADDER[UpgradeTrack.Hull];
    const maxTier = spec.steps.length - 1;
    const hauler = trackValue(ShipClass.Hauler, spec, maxTier);
    const interceptor = trackValue(ShipClass.Interceptor, spec, maxTier);
    expect(hauler).toBeGreaterThan(interceptor);
    // ...and at stock, and at every tier in between.
    for (let t = 0; t <= maxTier; t++) {
      expect(trackValue(ShipClass.Hauler, spec, t)).toBeGreaterThan(
        trackValue(ShipClass.Interceptor, spec, t),
      );
    }
  });

  it('keeps the maxed Interceptor the fastest thing on the map', () => {
    const spec = UPGRADE_LADDER[UpgradeTrack.Engine];
    const maxTier = spec.steps.length - 1;
    for (const other of [ShipClass.Vanguard, ShipClass.Excavator, ShipClass.Hauler]) {
      expect(trackValue(ShipClass.Interceptor, spec, maxTier)).toBeGreaterThan(
        trackValue(other, spec, maxTier),
      );
    }
  });

  it('reads its bases from the ratified class table, never a second copy', () => {
    for (const cls of Object.values(ShipClass)) {
      expect(trackBase(cls, UpgradeTrack.Beam)).toBe(SHIP_STATS[cls].beam);
      expect(trackBase(cls, UpgradeTrack.Hull)).toBe(SHIP_STATS[cls].hull);
      expect(trackBase(cls, UpgradeTrack.Cargo)).toBe(SHIP_STATS[cls].cargo);
      expect(trackBase(cls, UpgradeTrack.Engine)).toBe(SHIP_STATS[cls].speedMul * 100);
    }
  });
});

describe('cargo obeys the ratified table (GDD §2.8 — +2 per tier, cap 8)', () => {
  it('adds two slots per tier from the class base', () => {
    const spec = UPGRADE_LADDER[UpgradeTrack.Cargo];
    expect(trackValue(ShipClass.Vanguard, spec, 0)).toBe(2);
    expect(trackValue(ShipClass.Vanguard, spec, 1)).toBe(4);
    expect(trackValue(ShipClass.Vanguard, spec, 2)).toBe(6);
    expect(trackValue(ShipClass.Vanguard, spec, 3)).toBe(8);
  });

  it('never exceeds the hard cap of 8, even from the Hauler\'s bigger hold', () => {
    const spec = UPGRADE_LADDER[UpgradeTrack.Cargo];
    // The Hauler starts at 3, so an uncapped ladder would put it at 9.
    expect(SHIP_STATS[ShipClass.Hauler].cargo).toBe(3);
    expect(trackValue(ShipClass.Hauler, spec, 3)).toBe(CARGO_CAP_MAX);
  });
});

describe('formatting', () => {
  it('prints engine as a percentage, the way GDD §2.11 states class speed', () => {
    expect(formatTrackValue(130, 'percent')).toBe('130%');
    expect(formatTrackValue(100, 'percent')).toBe('100%');
  });

  it('rounds stat values to whole numbers — a panel is not a spreadsheet', () => {
    expect(formatTrackValue(12.5, 'integer')).toBe('13');
    expect(formatTrackValue(129.999, 'percent')).toBe('130%');
  });
});
