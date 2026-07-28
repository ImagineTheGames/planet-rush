/**
 * Own-station HP tests (GDD §2.2, style-guide §3). The load-bearing contracts:
 *  - the bar is drawn in the **player's identity colour**, from the ratified
 *    8-slot roster — never a colour of its own;
 *  - shields read separately from the core, because shields stand in front of
 *    it (GDD §2.5) and a shielded core is not yet in danger;
 *  - the critical tell is threat red, which style-guide §2 reserves for exactly
 *    this and forbids as a friendly accent.
 */
import { describe, it, expect } from 'vitest';
import { PALETTE, PLAYER_COLORS } from '@render/index';
import {
  stationHpModel,
  stationHpFlashOn,
  coreHpReadout,
  playerColor,
  STATION_CRITICAL_FRACTION,
} from './station-hp';
import { CORE_HP, SHIELD } from '../sim/constants';

describe('player colour (style-guide §3 — HP bars carry identity colour)', () => {
  it('reads the ratified 8-slot roster, so bar and ship trim cannot disagree', () => {
    for (let slot = 0; slot < PLAYER_COLORS.length; slot++) {
      expect(playerColor(slot)).toBe(PLAYER_COLORS[slot]);
    }
    expect(stationHpModel(3, CORE_HP, CORE_HP).color).toBe(PLAYER_COLORS[3]);
  });

  it('never picks signal yellow or threat red for identity (style-guide §3.1)', () => {
    // The roster is chosen to sit clear of ore and danger; a bar that could be
    // mistaken for either would spend the RESERVED rule's trust.
    for (const c of PLAYER_COLORS) {
      expect(c).not.toBe(PALETTE.signalYellow);
      expect(c).not.toBe(PALETTE.threatRed);
    }
  });

  it('degrades an out-of-range slot to steel rather than to undefined', () => {
    // Identity is also carried by the hull decal (style-guide §3 rule 3), so a
    // missing colour is survivable; a missing *value* is a crash.
    expect(playerColor(-1)).toBe(PALETTE.hullSteel);
    expect(playerColor(Number.NaN)).toBe(PALETTE.hullSteel);
    expect(playerColor(PLAYER_COLORS.length)).toBe(PLAYER_COLORS[0]);
  });
});

describe('the core bar (GDD §2.2 — your own station, top right)', () => {
  it('reads full at full HP and empty at zero', () => {
    expect(stationHpModel(0, CORE_HP, CORE_HP).coreFraction).toBe(1);
    expect(stationHpModel(0, 0, CORE_HP).coreFraction).toBe(0);
    expect(stationHpModel(0, CORE_HP / 2, CORE_HP).coreFraction).toBeCloseTo(0.5);
  });

  it('clamps out-of-range and degenerate inputs instead of overdrawing', () => {
    expect(stationHpModel(0, 500, CORE_HP).coreFraction).toBe(1);
    expect(stationHpModel(0, -20, CORE_HP).coreFraction).toBe(0);
    expect(stationHpModel(0, 10, 0).coreFraction).toBe(0);
  });

  it('flags a destroyed core — the station is a wreck now (GDD §2.7)', () => {
    expect(stationHpModel(0, 0, CORE_HP).destroyed).toBe(true);
    expect(stationHpModel(0, 1, CORE_HP).destroyed).toBe(false);
  });
});

describe('the critical tell (threat red — style-guide §2)', () => {
  it('goes critical at or below a quarter core, and not above it', () => {
    expect(stationHpModel(0, CORE_HP * 0.26, CORE_HP).critical).toBe(false);
    expect(stationHpModel(0, CORE_HP * STATION_CRITICAL_FRACTION, CORE_HP).critical).toBe(true);
    expect(stationHpModel(0, CORE_HP * 0.1, CORE_HP).critical).toBe(true);
  });

  it('stops flashing once the core is gone — there is nothing left to warn about', () => {
    const dead = stationHpModel(0, 0, CORE_HP);
    expect(dead.critical).toBe(false);
    expect(stationHpFlashOn(dead, 0)).toBe(false);
  });

  it('uses threat red for the tell and identity colour for everything else', () => {
    const m = stationHpModel(2, CORE_HP * 0.1, CORE_HP);
    expect(m.criticalColor).toBe(PALETTE.threatRed);
    expect(m.color).toBe(PLAYER_COLORS[2]);
  });

  it('blinks deterministically off match time, with no wall clock', () => {
    const m = stationHpModel(0, CORE_HP * 0.1, CORE_HP);
    expect(stationHpFlashOn(m, 0)).toBe(true);
    expect(stationHpFlashOn(m, 1 / 6)).toBe(false);
    expect(stationHpFlashOn(m, 2 / 6)).toBe(true);
    // A healthy core never flashes at all.
    expect(stationHpFlashOn(stationHpModel(0, CORE_HP, CORE_HP), 0)).toBe(false);
  });
});

describe('shields stand in front of the core (GDD §2.5)', () => {
  it('reports no shield when no generator is built', () => {
    const m = stationHpModel(0, CORE_HP, CORE_HP);
    expect(m.hasShield).toBe(false);
    expect(m.shieldFraction).toBe(0);
  });

  it('reports the pooled shield separately from the core', () => {
    // Two generators up, one of them half gone (GDD §2.5 — shields stack to 2).
    const pool = SHIELD.hp * SHIELD.capPerStation;
    const m = stationHpModel(0, CORE_HP, CORE_HP, pool * 0.75, pool);
    expect(m.hasShield).toBe(true);
    expect(m.shieldFraction).toBeCloseTo(0.75);
    expect(m.coreFraction).toBe(1);
  });

  it('does not raise the critical tell while a shield is the thing being shot', () => {
    // The core is what "critical" is about; a full core behind a torn shield is
    // taking pressure, not dying.
    const m = stationHpModel(0, CORE_HP, CORE_HP, 1, SHIELD.hp);
    expect(m.critical).toBe(false);
  });
});

describe('numeric core HP readout (developer request, p5-08 — "75/100")', () => {
  it('reads current/max as whole points', () => {
    expect(coreHpReadout(75, 100)).toBe('75/100');
    expect(coreHpReadout(100, 100)).toBe('100/100');
  });

  it('CEILS a live-siege fractional current — a standing core never reads down', () => {
    expect(coreHpReadout(74.6, 100)).toBe('75/100');
    expect(coreHpReadout(74.2, 100)).toBe('75/100');
  });

  it('reads a barely-alive core as "1", never "0" — zero means the core is gone', () => {
    // A core at 0.4 hp is ALIVE (destroyed is coreHp <= 0), so it must not read
    // "0/100" and lie that the loss condition has already fired. Ceiling gives 1.
    expect(coreHpReadout(0.4, 100)).toBe('1/100');
    expect(coreHpReadout(0.001, 100)).toBe('1/100');
    // Exactly gone is the only 0.
    expect(coreHpReadout(0, 100)).toBe('0/100');
  });

  it('never reads a negative or an over-max current', () => {
    expect(coreHpReadout(-5, 100)).toBe('0/100');
    // A frame that reports HP above max (a stale/racy feed) still clamps to max.
    expect(coreHpReadout(120, 100)).toBe('100/100');
  });

  it('degrades an unwired or NaN core to a safe 0/0 rather than a NaN readout', () => {
    expect(coreHpReadout(Number.NaN, Number.NaN)).toBe('0/0');
    expect(coreHpReadout(0, 0)).toBe('0/0');
  });
});
