/**
 * Upgrade WHEEL tests (GDD §2.5, §2.2). The load-bearing contracts:
 *  - the main wheel is about the SHIP — HULL, ENGINE, CARGO and a WEAPON wedge
 *    that OPENS a nested weapon sub-wheel (RATIFIED v0.2.2), so a bare SPEED
 *    wedge never reads as ship speed next to ENGINE;
 *  - the WEAPON sub-wheel renders every ladder track with `group: 'weapon'`
 *    (DAMAGE, SPEED today, more for free) plus a BACK wedge home;
 *  - the WEAPON wedge summarises its tracks as tier pips, so the main wheel still
 *    says the weapon tiers at a glance;
 *  - **every track wedge gives current value → next tier → ore cost** — that
 *    triple is what makes upgrading an explicit trade against turrets and repair;
 *  - this is the **only** place ship stats appear, so a finished track still shows
 *    what it finished at;
 *  - **upgrades multiply the class base** (GDD §2.5, §2.11), so a maxed
 *    Interceptor is still the fastest thing on the map;
 *  - cargo obeys the ratified "+2 per tier, cap 8" (GDD §2.8);
 *  - the wedges lay out clockwise from twelve o'clock, data-driven off the ladder.
 */
import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  upgradeWheelModel,
  upgradeWheelSlots,
  weaponSummary,
  upgradeWedgeAngle,
  trackBase,
  trackValue,
  formatTrackValue,
  UpgradeTrack,
  UPGRADE_WHEEL_ORDER,
  WHEEL_TRACK_ORDER,
  WEAPON_GROUP,
  TRACK_ORDER,
  STOCK_TIERS,
  UPGRADE_LADDER,
} from './upgrade-wheel';
import type { UpgradeWheelSignals, UpgradeTiers } from './upgrade-wheel';
import { CARGO_CAP_MAX, SHIP_STATS } from '../sim/constants';

function tiers(over: Partial<Record<UpgradeTrack, number>> = {}): UpgradeTiers {
  return { ...STOCK_TIERS, ...over };
}

function sig(over: Partial<UpgradeWheelSignals> = {}): UpgradeWheelSignals {
  return {
    open: true,
    weaponOpen: false,
    shipClass: ShipClass.Vanguard,
    tiers: STOCK_TIERS,
    ore: 0,
    ...over,
  };
}

/** The wedge carrying `label` on whichever level `over` selects. */
function wedgeOf(label: string, over: Partial<UpgradeWheelSignals> = {}) {
  const wedge = upgradeWheelModel(sig(over)).wedges.find((w) => w.label === label);
  expect(wedge, `a ${label} wedge is drawn`).toBeDefined();
  return wedge!;
}

describe('the main wheel is about the SHIP (RATIFIED v0.2.2)', () => {
  it('shows HULL, ENGINE, CARGO and a WEAPON wedge — the weapon group collapsed', () => {
    const wedges = upgradeWheelModel(sig()).wedges;
    expect(wedges.map((w) => w.label)).toEqual(['WEAPON', 'ENGINE', 'CARGO', 'HULL']);
    // The WEAPON wedge opens a screen; the other three buy a track directly.
    expect(wedges[0]!.kind).toBe('weapon');
    expect(wedges[0]!.track).toBeNull();
    expect(wedges.slice(1).map((w) => w.kind)).toEqual(['track', 'track', 'track']);
  });

  it('never shows a bare SPEED or DAMAGE wedge on the main wheel', () => {
    // The whole point of the sub-wheel: a weapon track next to ENGINE would read
    // as ship speed. Neither weapon track appears until WEAPON is pressed.
    const labels = upgradeWheelModel(sig()).wedges.map((w) => w.label);
    expect(labels).not.toContain('SPEED');
    expect(labels).not.toContain('DAMAGE');
  });

  it('summarises the weapon tiers as pips on the WEAPON wedge (item 3)', () => {
    const weapon = wedgeOf('WEAPON', { tiers: tiers({ [UpgradeTrack.Power]: 2, [UpgradeTrack.Speed]: 1 }) });
    expect(weapon.summary).not.toBeNull();
    expect(weapon.summary!.map((p) => p.label)).toEqual(['DAMAGE', 'SPEED']);
    expect(weapon.summary!.map((p) => p.tier)).toEqual([2, 1]);
    // Max tiers come off the ladder (DAMAGE has 3 buyable tiers, SPEED 2).
    expect(weapon.summary!.map((p) => p.maxTier)).toEqual([3, 2]);
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
});

describe('the WEAPON sub-wheel (RATIFIED v0.2.2)', () => {
  it('drills into exactly the group:weapon tracks — BACK is the hub now', () => {
    // Field report v0.2.4: the sub-wheel's back-out moved to the hub, so the
    // wedges are just its weapon tracks (no BACK wedge among them).
    const wedges = upgradeWheelModel(sig({ weaponOpen: true })).wedges;
    expect(wedges.map((w) => w.label)).toEqual(['DAMAGE', 'SPEED']);
    expect(wedges.map((w) => w.kind)).toEqual(['track', 'track']);
    // Both are really the weapon group off the ladder.
    expect(UPGRADE_LADDER[UpgradeTrack.Power].group).toBe(WEAPON_GROUP);
    expect(UPGRADE_LADDER[UpgradeTrack.Speed].group).toBe(WEAPON_GROUP);
  });

  it('keeps DAMAGE (the Power track) a single wedge — mining and damage are one stat', () => {
    // GDD §2.5 — the Power track resolves both, and the wedge reads DAMAGE.
    const damage = upgradeWheelModel(sig({ weaponOpen: true })).wedges.filter(
      (w) => w.track === UpgradeTrack.Power,
    );
    expect(damage).toHaveLength(1);
    expect(damage[0]!.label).toBe('DAMAGE');
  });

  it('carries no BACK wedge — the hub is the back affordance (field report v0.2.4)', () => {
    const wedges = upgradeWheelModel(sig({ weaponOpen: true })).wedges;
    expect(wedges.some((w) => w.label === 'BACK')).toBe(false);
    // The back-out is on the hub: the sub-wheel's hub says BACK and pops a level.
    const hub = upgradeWheelModel(sig({ weaponOpen: true })).hubBack;
    expect(hub).not.toBeNull();
    expect(hub!.label).toBe('BACK');
    expect(hub!.to).toBe('upgrade');
    expect(hub!.closes).toBe(false);
  });

  it('is data-driven: a track tagged weapon appears in the sub-wheel for free', () => {
    // upgradeWheelSlots walks the ladder's group metadata — the sub-wheel is
    // exactly the group:weapon tracks (in order). BACK is the hub, not a slot.
    const weaponTracks = WHEEL_TRACK_ORDER.filter(
      (t) => UPGRADE_LADDER[t].group === WEAPON_GROUP,
    );
    const slots = upgradeWheelSlots(true);
    expect(slots).toEqual(weaponTracks.map((track) => ({ kind: 'track', track })));
  });
});

describe('the hub BACK affordance (field report v0.2.4)', () => {
  it('the main upgrade wheel backs to the Build wheel', () => {
    const hub = upgradeWheelModel(sig({ weaponOpen: false })).hubBack;
    expect(hub).not.toBeNull();
    expect(hub!.label).toBe('BACK');
    expect(hub!.to).toBe('build');
    expect(hub!.closes).toBe(false);
  });

  it('the WEAPON sub-wheel backs to the main upgrade wheel', () => {
    const hub = upgradeWheelModel(sig({ weaponOpen: true })).hubBack;
    expect(hub!.to).toBe('upgrade');
  });

  it('has no hub when the wheel is shut — there is nothing to press', () => {
    expect(upgradeWheelModel(sig({ open: false })).hubBack).toBeNull();
  });
});

describe('the wedges lay out as a wheel, clockwise from the top (field report)', () => {
  it('places wedge 0 at twelve o\'clock and runs clockwise on both levels', () => {
    for (const weaponOpen of [false, true]) {
      const wedges = upgradeWheelModel(sig({ weaponOpen })).wedges;
      const count = wedges.length;
      // Twelve o'clock is -π/2 in y-down screen space, exactly the Build wheel.
      expect(wedges[0]!.angle).toBeCloseTo(-Math.PI / 2, 6);
      for (let i = 0; i < count; i++) {
        expect(wedges[i]!.angle).toBeCloseTo(upgradeWedgeAngle(i, count), 6);
      }
      const arc = (2 * Math.PI) / count;
      expect(wedges[1]!.angle - wedges[0]!.angle).toBeCloseTo(arc, 6);
    }
  });

  it('re-spaces each level around its own wedge count', () => {
    const main = upgradeWheelModel(sig({ weaponOpen: false })).wedges;
    const sub = upgradeWheelModel(sig({ weaponOpen: true })).wedges;
    expect(main).toHaveLength(4); // WEAPON, ENGINE, CARGO, HULL
    expect(sub).toHaveLength(2); // DAMAGE, SPEED (BACK is the hub now — field report v0.2.4)
    expect(main[1]!.angle - main[0]!.angle).toBeCloseTo((2 * Math.PI) / 4, 6);
    expect(sub[1]!.angle - sub[0]!.angle).toBeCloseTo((2 * Math.PI) / 2, 6);
  });
});

describe('every track wedge gives current → next → cost (GDD §2.5)', () => {
  it('prints the stock value as "current" on a fresh ship', () => {
    // The Vanguard is the balance reference: power 10, hull 50, cargo 2, 100%.
    expect(wedgeOf('DAMAGE', { weaponOpen: true }).current).toBe('10');
    expect(wedgeOf('HULL').current).toBe('50');
    expect(wedgeOf('CARGO').current).toBe('2');
    expect(wedgeOf('ENGINE').current).toBe('100%');
    expect(wedgeOf('SPEED', { weaponOpen: true }).current).toBe('100%');
  });

  it('prints the next tier\'s value, not the delta', () => {
    // Base 10 × the first DAMAGE step (1.25) = 13 (rounded) — the value the player
    // will have, so the trade is legible without arithmetic.
    expect(wedgeOf('DAMAGE', { weaponOpen: true }).next).toBe('13');
    expect(wedgeOf('CARGO').next).toBe('4'); // +2 per tier (GDD §2.8)
  });

  it('prints an ore cost on every buyable wedge, and the costs escalate', () => {
    for (const label of ['ENGINE', 'CARGO', 'HULL']) {
      const wedge = wedgeOf(label);
      expect(wedge.cost).not.toBeNull();
      expect(wedge.cost).toBeGreaterThan(0);
    }
    for (const label of ['DAMAGE', 'SPEED']) {
      const wedge = wedgeOf(label, { weaponOpen: true });
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
    const t1 = wedgeOf('CARGO', { tiers: tiers({ [UpgradeTrack.Cargo]: 1 }) });
    expect(t1.tier).toBe(1);
    expect(t1.current).toBe('4');
    expect(t1.next).toBe('6');
    expect(t1.cost).toBe(UPGRADE_LADDER[UpgradeTrack.Cargo].costs[1]);
  });
});

describe('affordability — dimmed with a reason (the field report)', () => {
  it('marks a wedge ready only when the ore is actually there', () => {
    const cost = UPGRADE_LADDER[UpgradeTrack.Speed].costs[0]!;
    expect(wedgeOf('SPEED', { weaponOpen: true, ore: cost - 1 }).state).toBe('unaffordable');
    expect(wedgeOf('SPEED', { weaponOpen: true, ore: cost }).state).toBe('ready');
  });

  it('leaves the WEAPON navigation wedge always pressable — a broke player still explores', () => {
    // WEAPON opens a screen; a broke player must still find the weapon tracks
    // exist (same rule as the Build wheel's UPGRADE SHIP). BACK is the hub now
    // (field report v0.2.4), and the hub is always pressable by construction.
    expect(wedgeOf('WEAPON', { ore: 0 }).state).toBe('ready');
  });

  it('echoes the same whole-ore total the Build wheel\'s hub shows', () => {
    expect(upgradeWheelModel(sig({ ore: 7.9 })).ore).toBe(7);
    expect(upgradeWheelModel(sig({ ore: -3 })).ore).toBe(0);
  });
});

describe('a finished ladder (GDD §2.5 — stats live here, maxed or not)', () => {
  it('still shows the current value at max tier, with no next and no cost', () => {
    const maxTier = UPGRADE_LADDER[UpgradeTrack.Power].steps.length - 1;
    const wedge = wedgeOf('DAMAGE', {
      weaponOpen: true,
      tiers: tiers({ [UpgradeTrack.Power]: maxTier }),
      ore: 999,
    });
    expect(wedge.state).toBe('maxed');
    expect(wedge.current).toBe('18'); // 10 × 1.8
    expect(wedge.next).toBeNull();
    expect(wedge.cost).toBeNull();
  });

  it('clamps a tier beyond the ladder rather than reading past its end', () => {
    const wedge = wedgeOf('HULL', { tiers: tiers({ [UpgradeTrack.Hull]: 99 }) });
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
      expect(trackBase(cls, UpgradeTrack.Power)).toBe(SHIP_STATS[cls].power);
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
    expect(SHIP_STATS[ShipClass.Hauler].cargo).toBe(3);
    expect(trackValue(ShipClass.Hauler, spec, 3)).toBe(CARGO_CAP_MAX);
  });
});

describe('the flat funnel order is unchanged — the platform input contract holds', () => {
  it('TRACK_ORDER stays the four flat tracks (no SPEED — it is a sub-wheel track)', () => {
    // match-boot.test.ts maps panel rows onto exactly these four; SPEED reaches
    // the sim through the weapon sub-wheel, never a flat row.
    expect([...TRACK_ORDER]).toEqual([
      UpgradeTrack.Power,
      UpgradeTrack.Engine,
      UpgradeTrack.Cargo,
      UpgradeTrack.Hull,
    ]);
    expect(TRACK_ORDER).not.toContain(UpgradeTrack.Speed);
  });

  it('the wheel walks the FULL order so SPEED lays out in the sub-wheel', () => {
    expect(UPGRADE_WHEEL_ORDER).toContain(UpgradeTrack.Speed);
    // weaponSummary is derived from the same full order.
    expect(weaponSummary(sig()).map((p) => p.track)).toEqual([
      UpgradeTrack.Power,
      UpgradeTrack.Speed,
    ]);
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
