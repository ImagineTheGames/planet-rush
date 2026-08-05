/**
 * Build & Upgrade wheel model tests (GDD §2.5). The load-bearing contracts:
 *  - **five** segments, each naming its target, in the order the GDD names them
 *    (the manual BANK segment is gone — ore auto-deposits in the atmosphere — but
 *    RADAR is back, one wedge per player-buildable sim item; p13 regression);
 *  - **the only number on a segment is its cost** — and the costs are the sim's;
 *  - affordability, caps, and no-op presses are shown honestly, so the wheel
 *    never dangles a segment `placeOrder` would refuse;
 *  - **every player-buildable sim item has a wedge** (the guard), so the next
 *    silent `Exclude<>` cut fails the build instead of vanishing a feature;
 *  - the wheel opens **at your own station and nowhere else**.
 * These are the day-2 DoD tests: wheel affordability states.
 */
import { describe, it, expect } from 'vitest';
import {
  buildWheelModel,
  canOpenWheel,
  radarCapLabel,
  segmentAtDirection,
  segmentAngle,
  segmentCost,
  segmentState,
  spendableOre,
  repairWedgeInfo,
  repairCoolingDown,
  repairCooldownSeconds,
  REPAIR_ENTRY_ORE,
  SEGMENT_ARC,
  WHEEL_EXCLUDED_ITEMS,
  WHEEL_ORDER,
} from './build-wheel';
import type { BuildWheelSignals, WheelSegmentId } from './build-wheel';
import type { BuildItem } from '@shared/types';
import { REPAIR_COOLDOWN_SECONDS, REPAIR_HP_PER_ORE, SATELLITE, SHIELD, TURRET } from '../sim/constants';

/** A docked player at a healthy station with `ore` banked, plus overrides. */
function sig(over: Partial<BuildWheelSignals> = {}): BuildWheelSignals {
  return {
    requested: true,
    docked: true,
    shipAlive: true,
    stationAlive: true,
    cargo: 0,
    banked: 0,
    turrets: 0,
    shields: 0,
    satellites: 0,
    coreHp: 100,
    maxCoreHp: 100,
    ...over,
  };
}

/** The state of one segment under a given signal frame. */
function stateOf(id: WheelSegmentId, over: Partial<BuildWheelSignals> = {}) {
  return segmentState(id, sig(over));
}

describe('the wheel itself (GDD §2.5 — five segments, words + target)', () => {
  it('has exactly five segments, in the order the GDD names them', () => {
    expect(WHEEL_ORDER).toEqual(['turret', 'shield', 'satellite', 'repair', 'upgrade']);
    expect(buildWheelModel(sig()).segments).toHaveLength(5);
  });

  it('no longer carries a manual BANK segment (ore auto-deposits — p4-11)', () => {
    const ids = buildWheelModel(sig()).segments.map((s) => s.id);
    expect(ids).not.toContain('bank');
  });

  it('carries the RADAR (satellite) segment again — bots build it, so the player can (p13)', () => {
    // The regression this file guards against: `satellite` was swept out of the
    // wheel alongside `bank` and no test noticed for four versions. It is a
    // player-buildable sim item, so it MUST have a wedge.
    const ids = buildWheelModel(sig()).segments.map((s) => s.id);
    expect(ids).toContain('satellite');
  });

  it('labels every segment in words, and names which target it spends on', () => {
    const byId = new Map(buildWheelModel(sig()).segments.map((s) => [s.id, s]));
    expect(byId.get('turret')?.label).toBe('TURRET');
    expect(byId.get('shield')?.label).toBe('SHIELD');
    expect(byId.get('satellite')?.label).toBe('RADAR');
    // Named in full — it repairs the station's reactor, never the ship (GDD §2.5).
    expect(byId.get('repair')?.label).toBe('REPAIR REACTOR');
    expect(byId.get('upgrade')?.label).toBe('UPGRADE SHIP');

    // "Everything but the ship upgrade spends on your station" (GDD §2.5): four
    // station segments (turret, shield, radar, repair), one on the ship.
    const stationSegments = buildWheelModel(sig()).segments.filter((s) => s.target === 'station');
    const shipSegments = buildWheelModel(sig()).segments.filter((s) => s.target === 'ship');
    expect(stationSegments).toHaveLength(4);
    expect(shipSegments).toHaveLength(1);
    expect(shipSegments[0]?.id).toBe('upgrade');
  });

  it('marks UPGRADE SHIP — and only it — as the segment that opens a screen', () => {
    const opening = buildWheelModel(sig()).segments.filter((s) => s.opensPanel);
    expect(opening.map((s) => s.id)).toEqual(['upgrade']);
  });
});

describe('THE GUARD — every player-buildable sim item has a wedge (or a named exclusion)', () => {
  // Exhaustive by construction: every `BuildItem` MUST be a key here, or tsc fails
  // on this literal — so a new sim build order forces its way into the guard, which
  // then demands it either get a wheel segment or a ratified entry in
  // WHEEL_EXCLUDED_ITEMS. This is the structural fix for the p13 regression: the
  // wheel can no longer silently drop a buildable item.
  const ALL_BUILD_ITEMS: Record<BuildItem, true> = {
    turret: true,
    shield: true,
    satellite: true,
    repair: true,
    bank: true,
  };

  it('shows, or explicitly excludes, every BuildItem — never neither, never both', () => {
    const shown = new Set<string>(WHEEL_ORDER);
    const excluded = new Set<string>(WHEEL_EXCLUDED_ITEMS);
    for (const item of Object.keys(ALL_BUILD_ITEMS) as BuildItem[]) {
      const hasWedge = shown.has(item);
      const isExcluded = excluded.has(item);
      // Neither = the regression (a buildable item with no way to build it).
      expect(hasWedge || isExcluded, `${item} is neither on the wheel nor in WHEEL_EXCLUDED_ITEMS`).toBe(
        true,
      );
      // Both = a contradiction (excluded yet drawn).
      expect(hasWedge && isExcluded, `${item} is both shown and excluded`).toBe(false);
    }
  });

  it('excludes exactly the ratified set — nothing padded in to silence the guard', () => {
    // The ONE sanctioned cut is BANK (ore auto-deposits, p4-11). If a future cut is
    // made, it belongs here with a name against it — this assertion makes adding one
    // a deliberate, reviewed act, not a silent `Exclude<>`.
    expect([...WHEEL_EXCLUDED_ITEMS]).toEqual(['bank']);
  });
});

describe('RADAR — cost, one-per-station cap, and the "0/1" count (p13)', () => {
  it('prices RADAR at the sim\'s satellite cost', () => {
    expect(segmentCost('satellite')).toBe(SATELLITE.cost);
    expect(SATELLITE.cost).toBe(6); // feature f1 balance — above a shield's 5
  });

  it('is buildable when affordable and none is up yet', () => {
    expect(stateOf('satellite', { banked: SATELLITE.cost, satellites: 0 })).toBe('ready');
    expect(stateOf('satellite', { banked: SATELLITE.cost - 1, satellites: 0 })).toBe('unaffordable');
  });

  it('caps at one per station — a second is refused because coverage exists, not the wallet', () => {
    expect(stateOf('satellite', { banked: 99, satellites: SATELLITE.capPerStation })).toBe('capped');
    // Cap outranks cost, like turret/shield: broke AND at the cap still reads capped.
    expect(stateOf('satellite', { banked: 0, satellites: SATELLITE.capPerStation })).toBe('capped');
  });

  it('shows the u2-02 "0/1" count, and "1/1" at the cap', () => {
    expect(radarCapLabel(sig({ satellites: 0 }))).toBe(`0/${SATELLITE.capPerStation}`);
    expect(radarCapLabel(sig({ satellites: 1 }))).toBe(`1/${SATELLITE.capPerStation}`);
    const seg = buildWheelModel(sig({ satellites: 0 })).segments.find((s) => s.id === 'satellite');
    expect(seg?.capLabel).toBe('0/1');
  });

  it('re-arms after the satellite is shot down — count drops, wedge goes ready again', () => {
    // At the cap: greyed, "1/1". The satellite dies, the sim's count drops to 0, and
    // the wedge is buildable again with "0/1" — the count IS the re-arm tell.
    expect(stateOf('satellite', { banked: 99, satellites: 1 })).toBe('capped');
    expect(stateOf('satellite', { banked: 99, satellites: 0 })).toBe('ready');
    expect(buildWheelModel(sig({ satellites: 1 })).segments.find((s) => s.id === 'satellite')?.capLabel).toBe(
      '1/1',
    );
  });

  it('hangs the "0/1" count on RADAR only — null on every other wedge', () => {
    const byId = new Map(buildWheelModel(sig()).segments.map((s) => [s.id, s]));
    expect(byId.get('satellite')?.capLabel).not.toBeNull();
    expect(byId.get('turret')?.capLabel).toBeNull();
    expect(byId.get('shield')?.capLabel).toBeNull();
    expect(byId.get('repair')?.capLabel).toBeNull();
    expect(byId.get('upgrade')?.capLabel).toBeNull();
  });

  it('reads "0/1" when the caller predates the radar wedge (no satellites field)', () => {
    // Backward-compatible default: an old caller/fixture reads as "none built".
    const legacy: BuildWheelSignals = { ...sig() };
    delete (legacy as { satellites?: number }).satellites;
    expect(radarCapLabel(legacy)).toBe('0/1');
    expect(segmentState('satellite', legacy)).toBe('unaffordable'); // 0 ore, none built
  });
});

describe('costs — the only number on a segment (GDD §2.5)', () => {
  it('prints the sim\'s own prices, so the wheel cannot quote a price it will not honour', () => {
    expect(segmentCost('turret')).toBe(TURRET.cost);
    expect(segmentCost('shield')).toBe(SHIELD.cost);
    expect(TURRET.cost).toBe(3); // GDD §2.8 — "a bare 3 under TURRET"
    expect(SHIELD.cost).toBe(5);
  });

  it('prints a bare 1 under REPAIR REACTOR, and never the ore-per-HP rate', () => {
    // GDD §2.5 spells this out verbatim: "a bare '1' under REPAIR REACTOR".
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

describe('REPAIR REACTOR names its effect — the informed tap (p5-08)', () => {
  it('shows a full tap\'s HP on a comfortably-damaged core', () => {
    // Missing more than a full tap: the wedge shows the whole tap, "+15 HP".
    const info = repairWedgeInfo(sig({ banked: 9, coreHp: 40, maxCoreHp: 100 }));
    expect(info.line).toBe(`+${REPAIR_HP_PER_ORE} HP`);
    expect(info.restoreHp).toBe(REPAIR_HP_PER_ORE);
  });

  it('shows the REAL partial when the core is missing less than a full tap', () => {
    // Missing 7 HP: one ore still heals to full, but only 7 HP — so the wedge says
    // "+7 HP", not "+15 HP", so the near-full tap is an informed choice.
    const info = repairWedgeInfo(sig({ banked: 9, coreHp: 93, maxCoreHp: 100 }));
    expect(info.line).toBe('+7 HP');
    expect(info.restoreHp).toBe(7);
  });

  it('reads REACTOR FULL on a full core, whatever the ore', () => {
    const info = repairWedgeInfo(sig({ banked: 99, coreHp: 100, maxCoreHp: 100 }));
    expect(info.line).toBe('REACTOR FULL');
    expect(info.restoreHp).toBe(0);
  });

  it('names the price when the bank is empty (the empty-bank reason)', () => {
    const info = repairWedgeInfo(sig({ cargo: 0, banked: 0, coreHp: 50, maxCoreHp: 100 }));
    expect(info.line).toBe(`NEED ${REPAIR_ENTRY_ORE} ORE`);
  });

  it('reads NO REPAIR once collapse has shut repair off (GDD §2.3)', () => {
    const info = repairWedgeInfo(sig({ banked: 99, coreHp: 50, maxCoreHp: 100, collapsed: true }));
    expect(info.line).toBe('NO REPAIR');
    expect(info.restoreHp).toBe(0);
  });

  it('the line precedence matches segmentState exactly (never disagree)', () => {
    // Wherever segmentState is not 'ready', the wedge line must be a reason, not a
    // "+HP" deal — the dimmed state and the copy are one decision.
    const frames: Partial<BuildWheelSignals>[] = [
      { coreHp: 100, maxCoreHp: 100, banked: 9 }, // full
      { coreHp: 50, maxCoreHp: 100, banked: 0, cargo: 0 }, // broke
      { coreHp: 50, maxCoreHp: 100, banked: 9, collapsed: true }, // collapsed
      { coreHp: 50, maxCoreHp: 100, banked: 9, repairGate: 8 }, // cooling down
    ];
    for (const f of frames) {
      const s = sig(f);
      const ready = segmentState('repair', s) === 'ready';
      expect(repairWedgeInfo(s).line.startsWith('+')).toBe(ready);
    }
    // And a plain damaged, funded core IS ready and DOES show a "+HP" line.
    const ok = sig({ coreHp: 50, maxCoreHp: 100, banked: 9 });
    expect(segmentState('repair', ok)).toBe('ready');
    expect(repairWedgeInfo(ok).line.startsWith('+')).toBe(true);
  });

  it('hangs the effect line on the repair segment only — never on another wedge', () => {
    const byId = new Map(buildWheelModel(sig({ coreHp: 50 })).segments.map((s) => [s.id, s]));
    expect(byId.get('repair')?.repair).not.toBeNull();
    expect(byId.get('turret')?.repair).toBeNull();
    expect(byId.get('shield')?.repair).toBeNull();
    expect(byId.get('upgrade')?.repair).toBeNull();
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

describe('per-station caps (GDD §2.5 — 4 turrets, 2 shields)', () => {
  it('caps turrets at four and shields at two', () => {
    expect(stateOf('turret', { banked: 99, turrets: TURRET.capPerStation - 1 })).toBe('ready');
    expect(stateOf('turret', { banked: 99, turrets: TURRET.capPerStation })).toBe('capped');
    expect(stateOf('shield', { banked: 99, shields: SHIELD.capPerStation })).toBe('capped');
  });

  it('says "capped" before "unaffordable" — the ring is full, not the wallet', () => {
    expect(stateOf('turret', { banked: 0, turrets: TURRET.capPerStation })).toBe('capped');
  });

  it('counts queued construction against the cap (the caller passes the sim count)', () => {
    // turretCount() in the sim counts standing + building, so three standing
    // plus one under construction reads as four here and refuses the fifth.
    expect(stateOf('turret', { banked: 99, turrets: 4 })).toBe('capped');
  });
});

describe('presses that would do nothing (GDD §2.5, the sim\'s refusal reasons)', () => {
  it('marks REPAIR REACTOR inactive on a full core, whatever the ore', () => {
    expect(stateOf('repair', { banked: 99, coreHp: 100, maxCoreHp: 100 })).toBe('inactive');
    expect(stateOf('repair', { banked: 99, coreHp: 60, maxCoreHp: 100 })).toBe('ready');
  });

  it('needs at least one ore to open the repair channel', () => {
    expect(stateOf('repair', { cargo: 0, banked: 0, coreHp: 10 })).toBe('unaffordable');
    expect(stateOf('repair', { cargo: 1, banked: 0, coreHp: 10 })).toBe('ready');
  });

  it('kills REPAIR REACTOR once collapse begins (GDD §2.3 — "repair shuts off")', () => {
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

describe('the repair COOLDOWN wedge — no ready-looking press that does nothing (the field bug)', () => {
  // A damaged, well-funded core: everything about the press is right EXCEPT that the
  // station is still cooling down from its last repair (the sim's `repairGate`), so
  // `placeOrder` would refuse it `cooling-down` and spend nothing. The wedge must say
  // so — disabled-gray with a live countdown — rather than draw "+15 HP" at full
  // brightness over a press that silently does nothing (evidence: cooldown-countdown-ui).
  const cooling = (repairGate: number, over: Partial<BuildWheelSignals> = {}) =>
    sig({ banked: 99, coreHp: 50, maxCoreHp: 100, repairGate, ...over });

  it('disables the wedge while `repairGate` is live, however much ore is held', () => {
    expect(stateOf('repair', { banked: 99, coreHp: 50, maxCoreHp: 100, repairGate: 8 })).toBe('inactive');
    // A funded, damaged core is refused because it is cooling — not because it is
    // poor: the state is `inactive` (a no-op press), never `ready`.
    expect(segmentState('repair', cooling(REPAIR_COOLDOWN_SECONDS))).toBe('inactive');
  });

  it('counts the cooldown down live in the wedge copy — "REPAIR IN Ns", read off sim state', () => {
    // The copy is the CEILING of the sim's remaining seconds (no UI timer, p4-17),
    // so it never reads 0 while the press is still locked. QA's attested frame: 1.63 s
    // into the cooldown reads "REPAIR IN 2s", not a "+15 HP" deal.
    expect(repairWedgeInfo(cooling(REPAIR_COOLDOWN_SECONDS)).line).toBe(`REPAIR IN ${REPAIR_COOLDOWN_SECONDS}s`);
    expect(repairWedgeInfo(cooling(13.37)).line).toBe('REPAIR IN 14s');
    expect(repairWedgeInfo(cooling(REPAIR_COOLDOWN_SECONDS - 1.63)).line).toBe('REPAIR IN 14s');
    expect(repairWedgeInfo(cooling(1.63)).line).toBe('REPAIR IN 2s');
    // A sub-second sliver still reads "1s" — never a bare "0s" that looks ready.
    expect(repairWedgeInfo(cooling(0.0001)).line).toBe('REPAIR IN 1s');
    expect(repairCooldownSeconds(cooling(0.0001))).toBe(1);
  });

  it('heals nothing while cooling — the disabled wedge restores 0 HP, like every other reason', () => {
    const info = repairWedgeInfo(cooling(5));
    expect(info.restoreHp).toBe(0);
    expect(info.line.startsWith('+')).toBe(false);
  });

  it('re-arms the moment `repairGate` reaches zero — back to the "+15 HP" deal on the expiry frame', () => {
    // The sim ticks `repairGate` down to exactly 0 on the expiry tick; on that frame
    // the wedge must return to full brightness, mirroring the sim re-allowing the order.
    expect(repairCoolingDown(cooling(0))).toBe(false);
    expect(stateOf('repair', { banked: 99, coreHp: 50, maxCoreHp: 100, repairGate: 0 })).toBe('ready');
    expect(repairWedgeInfo(cooling(0)).line).toBe(`+${REPAIR_HP_PER_ORE} HP`);
    // ...and a frame that predates the cooldown (no `repairGate` field at all) reads
    // as not cooling, the backward-compatible default.
    expect(repairCoolingDown(sig({ coreHp: 50 }))).toBe(false);
    expect(stateOf('repair', { banked: 99, coreHp: 50, maxCoreHp: 100 })).toBe('ready');
  });

  it('matches the sim gate exactly — refused on precisely the frames `placeOrder` refuses (1e-9 boundary)', () => {
    // `placeOrder` gates on `(repairGate ?? 0) > 1e-9`; the wedge must disable on the
    // same frames, never one early or late, so the wheel and the sim never disagree.
    expect(repairCoolingDown(cooling(1e-9))).toBe(false); // the sim would allow this
    expect(stateOf('repair', { banked: 99, coreHp: 50, maxCoreHp: 100, repairGate: 1e-9 })).toBe('ready');
    expect(repairCoolingDown(cooling(2e-9))).toBe(true); // and refuse this
    expect(stateOf('repair', { banked: 99, coreHp: 50, maxCoreHp: 100, repairGate: 2e-9 })).toBe('inactive');
  });

  it('yields to a full core and to collapse — cooldown is the lowest-priority reason (sim order)', () => {
    // Precedence mirrors `placeOrder`: collapsed → core-full → cooling-down. A full or
    // collapsed core reads its own reason, not the countdown, even while cooling.
    expect(repairWedgeInfo(cooling(9, { coreHp: 100 })).line).toBe('REACTOR FULL');
    expect(repairWedgeInfo(cooling(9, { collapsed: true })).line).toBe('NO REPAIR');
    // But cooldown DOES outrank affordability: a broke, cooling core reads the
    // countdown (the sim refuses `cooling-down` before it ever checks the bank).
    expect(repairWedgeInfo(cooling(9, { banked: 0, cargo: 0 })).line).toBe('REPAIR IN 9s');
    expect(stateOf('repair', { banked: 0, cargo: 0, coreHp: 50, maxCoreHp: 100, repairGate: 9 })).toBe('inactive');
  });
});

describe('the wheel opens at your own station and nowhere else (GDD §2.5, §2.4)', () => {
  it('opens when asked for, docked, alive, at a live core', () => {
    expect(canOpenWheel(sig())).toBe(true);
    expect(buildWheelModel(sig()).open).toBe(true);
  });

  it('stays shut away from the station, however much ore is held', () => {
    expect(canOpenWheel(sig({ docked: false, cargo: 99 }))).toBe(false);
    expect(buildWheelModel(sig({ docked: false })).open).toBe(false);
  });

  it('stays shut when it was not asked for, when dead, and at a wreck', () => {
    expect(canOpenWheel(sig({ requested: false }))).toBe(false);
    expect(canOpenWheel(sig({ shipAlive: false }))).toBe(false);
    // A destroyed station buys nothing — it is a wreck now (GDD §2.7).
    expect(canOpenWheel(sig({ stationAlive: false }))).toBe(false);
  });

  it('still describes all five segments while closed, so the view pools once', () => {
    const closed = buildWheelModel(sig({ docked: false }));
    expect(closed.open).toBe(false);
    expect(closed.segments).toHaveLength(5);
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
    expect(SEGMENT_ARC).toBeCloseTo((2 * Math.PI) / 5);
  });

  it('selects the segment a stick or pointer direction is aimed at', () => {
    // Straight up (y-down space) → the first segment.
    expect(segmentAtDirection(0, -1)).toBe('turret');
    // A fifth of a turn clockwise from up → the second.
    const a = segmentAngle(1);
    expect(segmentAtDirection(Math.cos(a), Math.sin(a))).toBe('shield');
    // RADAR is the third wedge now; UPGRADE SHIP is the fifth and last.
    const r = segmentAngle(2);
    expect(segmentAtDirection(Math.cos(r), Math.sin(r))).toBe('satellite');
    const d = segmentAngle(WHEEL_ORDER.indexOf('upgrade'));
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
    expect(seen.size).toBe(5);
  });
});
