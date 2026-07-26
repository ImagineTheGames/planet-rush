/**
 * Upgrade WHEEL tests (GDD §2.5, §2.2). The load-bearing contracts:
 *  - **every wedge gives current value → next tier → ore cost** — that triple is
 *    what makes upgrading an explicit trade against turrets and repair;
 *  - this is the **only** place ship stats appear, so all four tracks are
 *    present at every tier, including finished ones;
 *  - **upgrades multiply the class base** (GDD §2.5, §2.11), so a maxed
 *    Interceptor is still the fastest thing on the map;
 *  - cargo obeys the ratified "+2 per tier, cap 8" (GDD §2.8);
 *  - the wedges lay out clockwise from twelve o'clock, and the wheel is
 *    data-driven off the ladder so a longer ladder grows the wheel for free.
 */
import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  upgradeWheelModel,
  upgradeWedgeAngle,
  trackBase,
  trackValue,
  formatTrackValue,
  UpgradeTrack,
  UPGRADE_WHEEL_ORDER,
  TRACK_ORDER,
  STOCK_TIERS,
  UPGRADE_LADDER,
} from './upgrade-wheel';
import type { UpgradeWheelSignals, UpgradeTiers, UpgradeLadder } from './upgrade-wheel';
import { CARGO_CAP_MAX, SHIP_STATS } from '../sim/constants';

function tiers(over: Partial<Record<UpgradeTrack, number>> = {}): UpgradeTiers {
  return { ...STOCK_TIERS, ...over };
}

function sig(over: Partial<UpgradeWheelSignals> = {}): UpgradeWheelSignals {
  return {
    open: true,
    shipClass: ShipClass.Vanguard,
    tiers: STOCK_TIERS,
    ore: 0,
    ...over,
  };
}

/** The wedge for one track. */
function wedgeOf(track: UpgradeTrack, over: Partial<UpgradeWheelSignals> = {}) {
  const wedge = upgradeWheelModel(sig(over)).wedges.find((w) => w.track === track);
  expect(wedge).toBeDefined();
  return wedge!;
}

describe('the wheel is the one place ship stats appear (GDD §2.2, §2.5)', () => {
  it('shows a wedge for each of the four upgrade tracks', () => {
    const wedges = upgradeWheelModel(sig()).wedges;
    expect(wedges.map((w) => w.track)).toEqual([...TRACK_ORDER]);
    expect(wedges.map((w) => w.label)).toEqual(['BEAM', 'ENGINE', 'CARGO', 'HULL']);
  });

  it('names the hull being upgraded — locked at the lobby (GDD §2.11)', () => {
    expect(upgradeWheelModel(sig({ shipClass: ShipClass.Hauler })).className).toBe('HAULER');
    expect(upgradeWheelModel(sig({ shipClass: ShipClass.Interceptor })).className).toBe(
      'INTERCEPTOR',
    );
  });

  it('opens only when asked — it lives behind the Build wheel\'s arrow', () => {
    expect(upgradeWheelModel(sig({ open: false })).open).toBe(false);
    expect(upgradeWheelModel(sig({ open: true })).open).toBe(true);
  });

  it('keeps beam as ONE track: mining speed and weapon damage are one stat', () => {
    // GDD §2.5 — "beam power (mining speed and weapon damage — one beam, one
    // stat)". Two wedges here would be two stats, and the inversion the game
    // turns on would stop reading.
    const beamWedges = upgradeWheelModel(sig()).wedges.filter((w) => w.track === UpgradeTrack.Beam);
    expect(beamWedges).toHaveLength(1);
  });
});

describe('the wedges lay out as a wheel, clockwise from the top (field report)', () => {
  it('places wedge 0 at twelve o\'clock and runs clockwise', () => {
    const wedges = upgradeWheelModel(sig()).wedges;
    const count = wedges.length;
    // Twelve o'clock is -π/2 in y-down screen space, exactly the Build wheel.
    expect(wedges[0]!.angle).toBeCloseTo(-Math.PI / 2, 6);
    for (let i = 0; i < count; i++) {
      expect(wedges[i]!.angle).toBeCloseTo(upgradeWedgeAngle(i, count), 6);
    }
    // Evenly spaced by the full arc / count.
    const arc = (2 * Math.PI) / count;
    expect(wedges[1]!.angle - wedges[0]!.angle).toBeCloseTo(arc, 6);
  });

  it('is data-driven: a longer ladder lays out more wedges for free (p2-03)', () => {
    // Simulate p2-03 landing a projectile track by extending the order the wheel
    // walks — no change to the model, just a longer order and ladder.
    const extraTrack = UpgradeTrack.Beam; // reuse a real spec so the ladder resolves
    const longer = [...UPGRADE_WHEEL_ORDER, extraTrack];
    const model = upgradeWheelModel(sig(), UPGRADE_LADDER as UpgradeLadder, longer);
    expect(model.wedges).toHaveLength(longer.length);
    // The wheel re-spaced itself around the new count.
    const arc = (2 * Math.PI) / longer.length;
    expect(model.wedges[1]!.angle - model.wedges[0]!.angle).toBeCloseTo(arc, 6);
  });
});

describe('every wedge gives current → next → cost (GDD §2.5)', () => {
  it('prints the stock value as "current" on a fresh ship', () => {
    // The Vanguard is the balance reference: beam 10, hull 50, cargo 2, 100%.
    expect(wedgeOf(UpgradeTrack.Beam).current).toBe('10');
    expect(wedgeOf(UpgradeTrack.Hull).current).toBe('50');
    expect(wedgeOf(UpgradeTrack.Cargo).current).toBe('2');
    expect(wedgeOf(UpgradeTrack.Engine).current).toBe('100%');
  });

  it('prints the next tier\'s value, not the delta', () => {
    const beam = wedgeOf(UpgradeTrack.Beam);
    // Base 10 × the first step (1.25) = 13 (rounded) — the value the player
    // will have, so the trade is legible without arithmetic.
    expect(beam.next).toBe('13');
    expect(wedgeOf(UpgradeTrack.Cargo).next).toBe('4'); // +2 per tier (GDD §2.8)
  });

  it('prints an ore cost on every buyable wedge, and the costs escalate', () => {
    for (const track of TRACK_ORDER) {
      const wedge = wedgeOf(track);
      expect(wedge.cost).not.toBeNull();
      expect(wedge.cost).toBeGreaterThan(0);
    }
    // "Escalating cost" (GDD §2.5) — each tier costs strictly more than the last.
    for (const spec of Object.values(UPGRADE_LADDER)) {
      for (let i = 1; i < spec.costs.length; i++) {
        expect(spec.costs[i]!).toBeGreaterThan(spec.costs[i - 1]!);
      }
    }
  });

  it('advances current and next together as tiers are bought', () => {
    const t1 = wedgeOf(UpgradeTrack.Cargo, { tiers: tiers({ [UpgradeTrack.Cargo]: 1 }) });
    expect(t1.tier).toBe(1);
    expect(t1.current).toBe('4');
    expect(t1.next).toBe('6');
    expect(t1.cost).toBe(UPGRADE_LADDER[UpgradeTrack.Cargo].costs[1]);
  });
});

describe('affordability — dimmed with a reason (the field report)', () => {
  it('marks a wedge ready only when the ore is actually there', () => {
    const cost = UPGRADE_LADDER[UpgradeTrack.Beam].costs[0]!;
    expect(wedgeOf(UpgradeTrack.Beam, { ore: cost - 1 }).state).toBe('unaffordable');
    expect(wedgeOf(UpgradeTrack.Beam, { ore: cost }).state).toBe('ready');
  });

  it('echoes the same whole-ore total the Build wheel\'s hub shows', () => {
    expect(upgradeWheelModel(sig({ ore: 7.9 })).ore).toBe(7);
    expect(upgradeWheelModel(sig({ ore: -3 })).ore).toBe(0);
  });
});

describe('a finished ladder (GDD §2.5 — stats live here, maxed or not)', () => {
  it('still shows the current value at max tier, with no next and no cost', () => {
    const maxTier = UPGRADE_LADDER[UpgradeTrack.Beam].steps.length - 1;
    const wedge = wedgeOf(UpgradeTrack.Beam, {
      tiers: tiers({ [UpgradeTrack.Beam]: maxTier }),
      ore: 999,
    });
    expect(wedge.state).toBe('maxed');
    expect(wedge.current).toBe('18'); // 10 × 1.8
    expect(wedge.next).toBeNull();
    expect(wedge.cost).toBeNull();
  });

  it('clamps a tier beyond the ladder rather than reading past its end', () => {
    const wedge = wedgeOf(UpgradeTrack.Hull, { tiers: tiers({ [UpgradeTrack.Hull]: 99 }) });
    expect(wedge.tier).toBe(wedge.maxTier);
    expect(wedge.state).toBe('maxed');
    expect(Number.isFinite(Number(wedge.current))).toBe(true);
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

  it('rounds stat values to whole numbers — a wheel is not a spreadsheet', () => {
    expect(formatTrackValue(12.5, 'integer')).toBe('13');
    expect(formatTrackValue(129.999, 'percent')).toBe('130%');
  });
});
