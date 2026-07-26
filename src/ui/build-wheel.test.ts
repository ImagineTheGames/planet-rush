/**
 * Build & Upgrade wheel model tests (GDD §2.5). The load-bearing contracts:
 *  - **four** segments, each naming its target, in the order the GDD names them
 *    (the manual BANK segment is gone — ore auto-deposits in the atmosphere);
 *  - **the only number on a segment is its cost** — and the costs are the sim's;
 *  - affordability, caps, and no-op presses are shown honestly, so the wheel
 *    never dangles a segment `placeOrder` would refuse;
 *  - the wheel opens **at your own planet and nowhere else**.
 * These are the day-2 DoD tests: wheel affordability states.
 */
import { describe, it, expect } from 'vitest';
import {
  buildWheelModel,
  canOpenWheel,
  segmentAtDirection,
  segmentAngle,
  segmentCost,
  segmentState,
  spendableOre,
  REPAIR_ENTRY_ORE,
  SEGMENT_ARC,
  WHEEL_ORDER,
} from './build-wheel';
import type { BuildWheelSignals, WheelSegmentId } from './build-wheel';
import { SHIELD, TURRET } from '../sim/constants';

/** A docked player at a healthy planet with `ore` banked, plus overrides. */
function sig(over: Partial<BuildWheelSignals> = {}): BuildWheelSignals {
  return {
    requested: true,
    docked: true,
    shipAlive: true,
    planetAlive: true,
    cargo: 0,
    banked: 0,
    turrets: 0,
    shields: 0,
    coreHp: 100,
    maxCoreHp: 100,
    ...over,
  };
}

/** The state of one segment under a given signal frame. */
function stateOf(id: WheelSegmentId, over: Partial<BuildWheelSignals> = {}) {
  return segmentState(id, sig(over));
}

describe('the wheel itself (GDD §2.5 — four segments, words + target)', () => {
  it('has exactly four segments, in the order the GDD names them', () => {
    expect(WHEEL_ORDER).toEqual(['turret', 'shield', 'repair', 'upgrade']);
    expect(buildWheelModel(sig()).segments).toHaveLength(4);
  });

  it('no longer carries a manual BANK segment (ore auto-deposits — p4-11)', () => {
    const ids = buildWheelModel(sig()).segments.map((s) => s.id);
    expect(ids).not.toContain('bank');
  });

  it('labels every segment in words, and names which target it spends on', () => {
    const byId = new Map(buildWheelModel(sig()).segments.map((s) => [s.id, s]));
    expect(byId.get('turret')?.label).toBe('TURRET');
    expect(byId.get('shield')?.label).toBe('SHIELD');
    // Named in full — it repairs the planet's core, never the ship (GDD §2.5).
    expect(byId.get('repair')?.label).toBe('REPAIR CORE');
    expect(byId.get('upgrade')?.label).toBe('UPGRADE SHIP');

    // "Three spend on your planet, one on your ship" (GDD §2.5).
    const planetSegments = buildWheelModel(sig()).segments.filter((s) => s.target === 'planet');
    const shipSegments = buildWheelModel(sig()).segments.filter((s) => s.target === 'ship');
    expect(planetSegments).toHaveLength(3);
    expect(shipSegments).toHaveLength(1);
    expect(shipSegments[0]?.id).toBe('upgrade');
  });

  it('marks UPGRADE SHIP — and only it — as the segment that opens a screen', () => {
    const opening = buildWheelModel(sig()).segments.filter((s) => s.opensPanel);
    expect(opening.map((s) => s.id)).toEqual(['upgrade']);
  });
});

describe('costs — the only number on a segment (GDD §2.5)', () => {
  it('prints the sim\'s own prices, so the wheel cannot quote a price it will not honour', () => {
    expect(segmentCost('turret')).toBe(TURRET.cost);
    expect(segmentCost('shield')).toBe(SHIELD.cost);
    expect(TURRET.cost).toBe(3); // GDD §2.8 — "a bare 3 under TURRET"
    expect(SHIELD.cost).toBe(5);
  });

  it('prints a bare 1 under REPAIR CORE, and never the ore-per-HP rate', () => {
    // GDD §2.5 spells this out verbatim: "a bare '1' under REPAIR CORE".
    expect(segmentCost('repair')).toBe(1);
    expect(REPAIR_ENTRY_ORE).toBe(1);
  });

  it('gives UPGRADE SHIP no price at all', () => {
    // UPGRADE SHIP prices its rows in the panel, not on the wheel (GDD §2.5).
    expect(segmentCost('upgrade')).toBeNull();
  });

  it('carries no number on a segment beyond its cost', () => {
    // The shape is the guarantee: a segment has words, a target, a cost, a
    // state and an angle — and no other numeric field to leak a rate into.
    const seg = buildWheelModel(sig()).segments[0]!;
    const numericKeys = Object.entries(seg)
      .filter(([, v]) => typeof v === 'number')
      .map(([k]) => k)
      .sort();
    expect(numericKeys).toEqual(['angle', 'cost']);
  });
});

describe('affordability (GDD §2.5 — hold plus bank, the sim\'s spendableOre)', () => {
  it('counts held ore and banked ore together', () => {
    expect(spendableOre(sig({ cargo: 2, banked: 3 }))).toBe(5);
    // 2 held + 1 banked = 3 = exactly a turret.
    expect(stateOf('turret', { cargo: 2, banked: 1 })).toBe('ready');
  });

  it('dims a segment the player cannot pay for', () => {
    expect(stateOf('turret', { banked: 2 })).toBe('unaffordable');
    expect(stateOf('shield', { banked: 4 })).toBe('unaffordable');
    expect(stateOf('shield', { banked: 5 })).toBe('ready');
  });

  it('affords a cost exactly met, never off by a float', () => {
    expect(stateOf('turret', { cargo: 3 })).toBe('ready');
    // Repair spends fractional ore (1 ore per 5 HP), so a bank can land just shy.
    expect(stateOf('turret', { cargo: 1, banked: 2 - 1e-12 })).toBe('ready');
  });

  it('leaves UPGRADE SHIP pressable even when broke — it spends nothing here', () => {
    // A broke player still deserves to see that upgrades exist (GDD §2.5): the
    // segment opens a screen, it does not buy anything.
    expect(stateOf('upgrade', { cargo: 0, banked: 0 })).toBe('ready');
  });
});

describe('per-planet caps (GDD §2.5 — 4 turrets, 2 shields)', () => {
  it('caps turrets at four and shields at two', () => {
    expect(stateOf('turret', { banked: 99, turrets: TURRET.capPerPlanet - 1 })).toBe('ready');
    expect(stateOf('turret', { banked: 99, turrets: TURRET.capPerPlanet })).toBe('capped');
    expect(stateOf('shield', { banked: 99, shields: SHIELD.capPerPlanet })).toBe('capped');
  });

  it('says "capped" before "unaffordable" — the ring is full, not the wallet', () => {
    expect(stateOf('turret', { banked: 0, turrets: TURRET.capPerPlanet })).toBe('capped');
  });

  it('counts queued construction against the cap (the caller passes the sim count)', () => {
    // turretCount() in the sim counts standing + building, so three standing
    // plus one under construction reads as four here and refuses the fifth.
    expect(stateOf('turret', { banked: 99, turrets: 4 })).toBe('capped');
  });
});

describe('presses that would do nothing (GDD §2.5, the sim\'s refusal reasons)', () => {
  it('marks REPAIR CORE inactive on a full core, whatever the ore', () => {
    expect(stateOf('repair', { banked: 99, coreHp: 100, maxCoreHp: 100 })).toBe('inactive');
    expect(stateOf('repair', { banked: 99, coreHp: 60, maxCoreHp: 100 })).toBe('ready');
  });

  it('needs at least one ore to open the repair channel', () => {
    expect(stateOf('repair', { cargo: 0, banked: 0, coreHp: 10 })).toBe('unaffordable');
    expect(stateOf('repair', { cargo: 1, banked: 0, coreHp: 10 })).toBe('ready');
  });

  it('kills REPAIR CORE once collapse begins (GDD §2.3 — "repair shuts off")', () => {
    // A wounded core and plenty of ore: everything about the press is right
    // except that the match has entered collapse, where `placeOrder` answers
    // `collapsed`. Offering it anyway would be the wheel lying.
    expect(stateOf('repair', { banked: 99, coreHp: 10, collapsed: false })).toBe('ready');
    expect(stateOf('repair', { banked: 99, coreHp: 10, collapsed: true })).toBe('inactive');
  });

  it('leaves turrets and shields buyable under collapse', () => {
    // GDD §2.3 names exactly three collapse rules — no shield regeneration, no
    // repair, no new ore. Buying a shield that will never regenerate is still a
    // legal (and sometimes correct) way to spend a doomed stockpile.
    expect(stateOf('turret', { banked: 99, collapsed: true })).toBe('ready');
    expect(stateOf('shield', { banked: 99, collapsed: true })).toBe('ready');
  });
});

describe('the wheel opens at your own planet and nowhere else (GDD §2.5, §2.4)', () => {
  it('opens when asked for, docked, alive, at a live core', () => {
    expect(canOpenWheel(sig())).toBe(true);
    expect(buildWheelModel(sig()).open).toBe(true);
  });

  it('stays shut away from the planet, however much ore is held', () => {
    expect(canOpenWheel(sig({ docked: false, cargo: 99 }))).toBe(false);
    expect(buildWheelModel(sig({ docked: false })).open).toBe(false);
  });

  it('stays shut when it was not asked for, when dead, and at a wreck', () => {
    expect(canOpenWheel(sig({ requested: false }))).toBe(false);
    expect(canOpenWheel(sig({ shipAlive: false }))).toBe(false);
    // A destroyed planet buys nothing — it is a wreck now (GDD §2.7).
    expect(canOpenWheel(sig({ planetAlive: false }))).toBe(false);
  });

  it('still describes all four segments while closed, so the view pools once', () => {
    const closed = buildWheelModel(sig({ docked: false }));
    expect(closed.open).toBe(false);
    expect(closed.segments).toHaveLength(4);
  });
});

describe('the hub (GDD §2.5 — "your live ore total in the hub")', () => {
  it('shows hold plus bank as whole ore', () => {
    expect(buildWheelModel(sig({ cargo: 2, banked: 7 })).ore).toBe(9);
    // Repair spends fractional ore; the hub floors rather than printing "6.8".
    expect(buildWheelModel(sig({ cargo: 0, banked: 6.8 })).ore).toBe(6);
  });
});

describe('radial layout — device-agnostic selection (GDD §2.4)', () => {
  it('puts segment 0 at twelve o\'clock and runs clockwise', () => {
    expect(segmentAngle(0)).toBeCloseTo(-Math.PI / 2);
    expect(segmentAngle(1)).toBeCloseTo(-Math.PI / 2 + SEGMENT_ARC);
    expect(SEGMENT_ARC).toBeCloseTo((2 * Math.PI) / 4);
  });

  it('selects the segment a stick or pointer direction is aimed at', () => {
    // Straight up (y-down space) → the first segment.
    expect(segmentAtDirection(0, -1)).toBe('turret');
    // A fifth of a turn clockwise from up → the second.
    const a = segmentAngle(1);
    expect(segmentAtDirection(Math.cos(a), Math.sin(a))).toBe('shield');
    const d = segmentAngle(3);
    expect(segmentAtDirection(Math.cos(d), Math.sin(d))).toBe('upgrade');
  });

  it('selects nothing inside the hub deadzone — releasing at centre cancels', () => {
    expect(segmentAtDirection(0, 0)).toBeNull();
    expect(segmentAtDirection(0.1, 0.1)).toBeNull();
  });

  it('covers the whole circle: every direction lands on exactly one segment', () => {
    const seen = new Set<string>();
    for (let deg = 0; deg < 360; deg += 1) {
      const rad = (deg * Math.PI) / 180;
      const id = segmentAtDirection(Math.cos(rad), Math.sin(rad));
      expect(id).not.toBeNull();
      seen.add(id!);
    }
    expect(seen.size).toBe(4);
  });
});
