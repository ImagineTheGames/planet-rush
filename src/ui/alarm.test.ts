/**
 * Under-attack alarm tests (GDD §2.2 — a *mechanic, not polish*). The
 * load-bearing contract, quoted from the design:
 *
 *   "When your core, shield, or turrets take **sustained damage** (not a single
 *    stray shot — a taunt-tap must not trigger it), you get an unmistakable
 *    alarm plus a screen-edge arrow pointing home."
 *
 * So: the threshold must fire on a real siege and must NOT fire on a tap, and
 * the arrow must point home from anywhere on the map. These are the day-2 DoD
 * tests: alarm threshold.
 */
import { describe, it, expect } from 'vitest';
import {
  UnderAttackAlarm,
  homeArrow,
  ALARM_DRAIN_HP_PER_S,
  ALARM_HOLD_S,
  ALARM_THRESHOLD_HP,
  ARROW_EDGE_INSET,
} from './alarm';
import { WEAPON_DPS_CORE, TICK_DT } from '../sim/constants';

/** Run `seconds` of sim ticks, dealing `dps` damage per second. */
function fire(alarm: UnderAttackAlarm, seconds: number, dps: number): boolean {
  let firing = false;
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) firing = alarm.update(TICK_DT, dps * TICK_DT);
  return firing;
}

/** Run `seconds` of quiet ticks. */
function quiet(alarm: UnderAttackAlarm, seconds: number): boolean {
  return fire(alarm, seconds, 0);
}

describe('the trigger — sustained damage, not a stray shot (GDD §2.2)', () => {
  it('stays silent through a single stray hit', () => {
    const alarm = new UnderAttackAlarm();
    // One turret-grade shot's worth of damage, then nothing.
    expect(alarm.update(TICK_DT, 2)).toBe(false);
    expect(quiet(alarm, 3)).toBe(false);
    expect(alarm.active).toBe(false);
  });

  it('stays silent through a taunt-tap: a graze, a pause, another graze', () => {
    const alarm = new UnderAttackAlarm();
    for (let i = 0; i < 6; i++) {
      // Half a second of fire on the core, then two seconds of nothing.
      expect(fire(alarm, 0.5, WEAPON_DPS_CORE)).toBe(false);
      expect(quiet(alarm, 2)).toBe(false);
    }
    expect(alarm.active).toBe(false);
  });

  it('fires under a real siege — fire held on the core', () => {
    const alarm = new UnderAttackAlarm();
    // GDD §2.8's baseline weapon-vs-core DPS. It must trip the alarm quickly
    // enough to be worth flying home for — inside a couple of seconds.
    expect(fire(alarm, 2.5, WEAPON_DPS_CORE)).toBe(true);
    expect(alarm.active).toBe(true);
  });

  it('needs the damage to out-pace the drain — anything slower is noise', () => {
    const alarm = new UnderAttackAlarm();
    // Exactly at the drain rate: pressure never builds, however long it runs.
    expect(fire(alarm, 30, ALARM_DRAIN_HP_PER_S)).toBe(false);
    // A hair above it does build, given long enough.
    const faster = new UnderAttackAlarm();
    expect(fire(faster, 30, ALARM_DRAIN_HP_PER_S * 2)).toBe(true);
  });

  it('counts damage to shields and turrets the same as damage to the core', () => {
    // The trigger takes one number — HP lost off the planet this tick — because
    // "your core, shield, or turrets" are all the same event to a defender.
    const alarm = new UnderAttackAlarm();
    expect(fire(alarm, 2, 10)).toBe(true);
  });
});

describe('the latch — an alarm that flickers is one players learn to ignore', () => {
  it('holds after the attacker stops, then falls silent', () => {
    const alarm = new UnderAttackAlarm();
    expect(fire(alarm, 3, WEAPON_DPS_CORE)).toBe(true);
    // Still sounding a moment after the last hit...
    expect(quiet(alarm, ALARM_HOLD_S * 0.5)).toBe(true);
    // ...and silent once the hold runs out.
    expect(quiet(alarm, ALARM_HOLD_S)).toBe(false);
  });

  it('stays up continuously through the gaps in an attacker\'s pressure', () => {
    const alarm = new UnderAttackAlarm();
    expect(fire(alarm, 3, WEAPON_DPS_CORE)).toBe(true);
    for (let i = 0; i < 5; i++) {
      // Attacker circles for a second, comes back — the alarm never drops.
      expect(quiet(alarm, 1)).toBe(true);
      expect(fire(alarm, 1, WEAPON_DPS_CORE)).toBe(true);
    }
  });

  it('clears the same interval after the last hit, however long the siege ran', () => {
    // The bucket is capped at the threshold, so a 30-second siege leaves no
    // longer a tail than a 3-second one — the alarm always means "right now".
    const long = new UnderAttackAlarm();
    expect(fire(long, 30, WEAPON_DPS_CORE)).toBe(true);
    expect(quiet(long, ALARM_HOLD_S * 0.8)).toBe(true);
    expect(quiet(long, ALARM_HOLD_S)).toBe(false);
  });

  it('starts the next siege from silence, not from leftover pressure', () => {
    const alarm = new UnderAttackAlarm();
    fire(alarm, 3, WEAPON_DPS_CORE);
    quiet(alarm, ALARM_HOLD_S + 1);
    expect(alarm.active).toBe(false);
    expect(alarm.pressure).toBe(0);
    // A single tap right after must not re-fire on residue.
    expect(alarm.update(TICK_DT, 2)).toBe(false);
  });

  it('resets completely on demand (fresh match, or a planet that just died)', () => {
    const alarm = new UnderAttackAlarm();
    fire(alarm, 3, WEAPON_DPS_CORE);
    expect(alarm.active).toBe(true);
    alarm.reset();
    expect(alarm.active).toBe(false);
    expect(alarm.pressure).toBe(0);
  });
});

describe('pressure — the tell builds instead of snapping on', () => {
  it('reports 0..1 approach to the threshold', () => {
    const alarm = new UnderAttackAlarm();
    expect(alarm.pressure).toBe(0);
    alarm.update(TICK_DT, ALARM_THRESHOLD_HP / 2);
    expect(alarm.pressure).toBeGreaterThan(0.4);
    expect(alarm.pressure).toBeLessThan(0.6);
  });

  it('never exceeds 1, however hard the planet is hit', () => {
    const alarm = new UnderAttackAlarm();
    alarm.update(TICK_DT, ALARM_THRESHOLD_HP * 20);
    expect(alarm.pressure).toBe(1);
  });
});

describe('dt-independence — the threshold means the same at any timestep', () => {
  it('fires on the same total damage whether fed at 60 Hz or 20 Hz', () => {
    const fast = new UnderAttackAlarm();
    const slow = new UnderAttackAlarm();
    expect(fire(fast, 2.5, WEAPON_DPS_CORE)).toBe(true);
    // Server-tick-sized steps (20 Hz), same DPS, same verdict.
    let firing = false;
    for (let i = 0; i < 50; i++) firing = slow.update(0.05, WEAPON_DPS_CORE * 0.05);
    expect(firing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The screen-edge arrow
// ---------------------------------------------------------------------------

const VP = { width: 800, height: 600 };

describe('the screen-edge arrow home (GDD §2.2)', () => {
  it('hides itself when home is already on screen — the planet is the tell', () => {
    const a = homeArrow({ x: 1000, y: 1000 }, { x: 1040, y: 1010 }, VP);
    expect(a.onScreen).toBe(true);
    // Drawn at home's actual screen position: centre plus the world offset.
    expect(a.x).toBeCloseTo(VP.width / 2 + 40);
    expect(a.y).toBeCloseTo(VP.height / 2 + 10);
  });

  it('clamps to the screen edge when home is off screen', () => {
    // Home far to the right: the arrow pins to the right edge, inset.
    const a = homeArrow({ x: 0, y: 0 }, { x: 5000, y: 0 }, VP);
    expect(a.onScreen).toBe(false);
    expect(a.x).toBeCloseTo(VP.width - ARROW_EDGE_INSET);
    expect(a.y).toBeCloseTo(VP.height / 2);
  });

  it('respects the safe-area inset on every edge (notches, thumb sticks)', () => {
    const inset = 60;
    for (const home of [
      { x: -9000, y: 0 },
      { x: 9000, y: 0 },
      { x: 0, y: -9000 },
      { x: 0, y: 9000 },
    ]) {
      const a = homeArrow({ x: 0, y: 0 }, home, VP, inset);
      expect(a.onScreen).toBe(false);
      expect(a.x).toBeGreaterThanOrEqual(inset - 1e-6);
      expect(a.x).toBeLessThanOrEqual(VP.width - inset + 1e-6);
      expect(a.y).toBeGreaterThanOrEqual(inset - 1e-6);
      expect(a.y).toBeLessThanOrEqual(VP.height - inset + 1e-6);
    }
  });

  it('points at home, from any direction', () => {
    // Home up-left of the ship: y-down space, so the angle is in the third
    // quadrant (both components negative).
    const a = homeArrow({ x: 1000, y: 1000 }, { x: 0, y: 0 }, VP);
    expect(Math.cos(a.angle)).toBeLessThan(0);
    expect(Math.sin(a.angle)).toBeLessThan(0);
    // And straight down.
    const b = homeArrow({ x: 0, y: 0 }, { x: 0, y: 9000 }, VP);
    expect(b.angle).toBeCloseTo(Math.PI / 2);
  });

  it('reports the world distance home — the "how far have I drifted" number', () => {
    const a = homeArrow({ x: 0, y: 0 }, { x: 300, y: 400 }, VP);
    expect(a.distance).toBeCloseTo(500);
  });

  it('degrades safely when the ship is standing on its own planet', () => {
    const a = homeArrow({ x: 500, y: 500 }, { x: 500, y: 500 }, VP);
    expect(a.onScreen).toBe(true);
    expect(a.distance).toBe(0);
    expect(Number.isFinite(a.x)).toBe(true);
    expect(Number.isFinite(a.y)).toBe(true);
  });

  it('degrades safely on a viewport smaller than its own inset', () => {
    const tiny = { width: 40, height: 30 };
    const a = homeArrow({ x: 0, y: 0 }, { x: 9000, y: 9000 }, tiny, ARROW_EDGE_INSET);
    expect(Number.isFinite(a.x)).toBe(true);
    expect(Number.isFinite(a.y)).toBe(true);
    expect(a.x).toBeCloseTo(tiny.width / 2);
    expect(a.y).toBeCloseTo(tiny.height / 2);
  });
});
