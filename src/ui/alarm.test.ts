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
import type { AlarmCause, AlarmDamage } from './alarm';
import { WEAPON_DPS_CORE, TICK_DT, COLLAPSE_CORE_DECAY } from '../sim/constants';

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
    // The trigger takes one number — HP lost off the station this tick — because
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

  it('resets completely on demand (fresh match, or a station that just died)', () => {
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

  it('never exceeds 1, however hard the station is hit', () => {
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

describe('only YOUR station, and not the collapse (the phantom-alarm field report)', () => {
  it('a bot war three stations away never rings your alarm', () => {
    // The alarm is fed ONLY the local player's own-station damage; another
    // station's fight is simply never handed to it. Encode that: a long run of
    // quiet ticks (no own damage) is silence, forever.
    const alarm = new UnderAttackAlarm();
    expect(quiet(alarm, 120)).toBe(false);
    expect(alarm.active).toBe(false);
    expect(alarm.cause.reason).toBe('quiet');
    expect(alarm.cause.damage).toBe(0);
  });

  it('collapse core-decay alone is entropy, not an attack — it never rings', () => {
    // The endgame decays every core at COLLAPSE_CORE_DECAY HP/s. The HUD
    // subtracts that expected bleed before feeding the alarm, so the residual it
    // sees during a quiet collapse is 0 — nothing to ring.
    const alarm = new UnderAttackAlarm();
    const ticks = Math.round(100 / TICK_DT); // a full 100 s collapse
    let firing = false;
    for (let i = 0; i < ticks; i++) {
      const raw = COLLAPSE_CORE_DECAY * TICK_DT;
      const residual = Math.max(0, raw - COLLAPSE_CORE_DECAY * TICK_DT); // == 0
      firing = alarm.update(TICK_DT, { core: residual });
    }
    expect(firing).toBe(false);
    expect(alarm.active).toBe(false);
  });

  it('an attacker firing DURING collapse still rings it — decay is not cover', () => {
    // Real fire lands on top of the decay: after the HUD subtracts the expected
    // bleed, weapon damage still exceeds it and reaches the threshold.
    const alarm = new UnderAttackAlarm();
    const ticks = Math.round(2.5 / TICK_DT);
    let firing = false;
    for (let i = 0; i < ticks; i++) {
      const raw = (WEAPON_DPS_CORE + COLLAPSE_CORE_DECAY) * TICK_DT;
      const residual = Math.max(0, raw - COLLAPSE_CORE_DECAY * TICK_DT);
      firing = alarm.update(TICK_DT, { core: residual });
    }
    expect(firing).toBe(true);
  });

  it('an attack that ends clears the alarm — and it STAYS cleared', () => {
    const alarm = new UnderAttackAlarm();
    expect(fire(alarm, 3, WEAPON_DPS_CORE)).toBe(true);
    // The attacker leaves for good.
    expect(quiet(alarm, ALARM_HOLD_S + 1)).toBe(false);
    // Minutes pass with nothing landing: it must not re-arm on its own.
    expect(quiet(alarm, 300)).toBe(false);
    expect(alarm.active).toBe(false);
    expect(alarm.pressure).toBe(0);
  });
});

describe('the cause — a phantom is diagnosed from a value, not a hunt', () => {
  it('names which of your core, shields, or turrets took the damage', () => {
    const core = new UnderAttackAlarm();
    core.update(TICK_DT, { core: 1 });
    expect(core.cause.source).toBe('core');

    const shield = new UnderAttackAlarm();
    shield.update(TICK_DT, { shield: 1 });
    expect(shield.cause.source).toBe('shield');

    const turret = new UnderAttackAlarm();
    turret.update(TICK_DT, { turret: 1 });
    expect(turret.cause.source).toBe('turret');
  });

  it('counts core, shield, and turret damage into one bucket, blaming the largest', () => {
    // A shield taking the brunt while the core is grazed: the alarm still fires
    // on the sum, and the cause fingers the shield.
    const alarm = new UnderAttackAlarm();
    let firing = false;
    for (let i = 0; i < Math.round(2 / TICK_DT); i++) {
      firing = alarm.update(TICK_DT, { core: 1 * TICK_DT, shield: 5 * TICK_DT });
    }
    expect(firing).toBe(true);
    expect(alarm.cause.source).toBe('shield');
    expect(alarm.cause.reason).toBe('sustained');
  });

  it('walks reason quiet → building → sustained → holding → released', () => {
    const alarm = new UnderAttackAlarm();
    const seen = new Set<AlarmCause['reason']>();
    // 'released' lives on a single tick before reverting to 'quiet', so record
    // the reason on EVERY tick, not just at the end of each phase.
    const step = (damage: number): void => {
      alarm.update(TICK_DT, damage);
      seen.add(alarm.cause.reason);
    };
    step(0); // quiet
    for (let i = 0; i < Math.round(3 / TICK_DT); i++) step(WEAPON_DPS_CORE * TICK_DT); // building→sustained
    for (let i = 0; i < Math.round(0.5 / TICK_DT); i++) step(0); // holding
    for (let i = 0; i < Math.round((ALARM_HOLD_S + 1) / TICK_DT); i++) step(0); // released→quiet
    expect(seen.has('quiet')).toBe(true);
    expect(seen.has('building')).toBe(true);
    expect(seen.has('sustained')).toBe(true);
    expect(seen.has('holding')).toBe(true);
    expect(seen.has('released')).toBe(true);
  });

  it('a stale latch is visible: firing while nothing lands reads as damage 0', () => {
    // The signature of the phantom the field report chased — sound with no cause.
    const alarm = new UnderAttackAlarm();
    fire(alarm, 3, WEAPON_DPS_CORE);
    alarm.update(TICK_DT, 0); // a quiet tick mid-hold
    expect(alarm.cause.firing).toBe(true);
    expect(alarm.cause.reason).toBe('holding');
    expect(alarm.cause.damage).toBe(0);
  });

  it('logs the cause on the ignition and the all-clear, and nowhere between', () => {
    const alarm = new UnderAttackAlarm();
    const log: AlarmCause[] = [];
    alarm.onCause((c) => log.push(c));
    fire(alarm, 3, WEAPON_DPS_CORE); // one rising edge
    expect(log.length).toBe(1);
    expect(log[0]!.firing).toBe(true);
    expect(log[0]!.reason).toBe('sustained');
    quiet(alarm, ALARM_HOLD_S + 1); // one falling edge
    expect(log.length).toBe(2);
    expect(log[1]!.firing).toBe(false);
    expect(log[1]!.reason).toBe('released');
  });

  it('reset wipes the cause back to quiet', () => {
    const alarm = new UnderAttackAlarm();
    fire(alarm, 3, WEAPON_DPS_CORE);
    alarm.reset();
    expect(alarm.cause.firing).toBe(false);
    expect(alarm.cause.reason).toBe('quiet');
    expect(alarm.cause.damage).toBe(0);
  });
});

describe('determinism — the one predicate replays identically', () => {
  it('two alarms fed the same component sequence agree tick for tick', () => {
    const a = new UnderAttackAlarm();
    const b = new UnderAttackAlarm();
    // A varied siege: shield, then turret, then core, with gaps.
    const script: AlarmDamage[] = [];
    for (let i = 0; i < 400; i++) {
      const phase = i % 40;
      if (phase < 10) script.push({ shield: 4 * TICK_DT });
      else if (phase < 20) script.push({});
      else if (phase < 30) script.push({ turret: 6 * TICK_DT, core: 1 * TICK_DT });
      else script.push({ core: WEAPON_DPS_CORE * TICK_DT });
    }
    for (const d of script) {
      const fa = a.update(TICK_DT, d);
      const fb = b.update(TICK_DT, d);
      expect(fa).toBe(fb);
      expect(a.cause.reason).toBe(b.cause.reason);
      expect(a.cause.source).toBe(b.cause.source);
      expect(a.pressure).toBe(b.pressure);
    }
  });

  it('a scalar total and an equivalent core-only split ring the same', () => {
    const scalar = new UnderAttackAlarm();
    const split = new UnderAttackAlarm();
    for (let i = 0; i < Math.round(2.5 / TICK_DT); i++) {
      const d = WEAPON_DPS_CORE * TICK_DT;
      expect(scalar.update(TICK_DT, d)).toBe(split.update(TICK_DT, { core: d }));
    }
    expect(scalar.active).toBe(split.active);
  });
});

// ---------------------------------------------------------------------------
// The screen-edge arrow
// ---------------------------------------------------------------------------

const VP = { width: 800, height: 600 };

describe('the screen-edge arrow home (GDD §2.2)', () => {
  it('hides itself when home is already on screen — the station is the tell', () => {
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

  it('degrades safely when the ship is standing on its own station', () => {
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
