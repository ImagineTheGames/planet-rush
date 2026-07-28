/**
 * src/ui/press-feedback.test.ts — the shared press/confirm feedback, headless.
 * OWNER: UI Engineer (field report v0.2.2).
 *
 * Covers the two tells the report asked for and the derivation that fires the
 * second one: the pressed pulse (scale + glow), the rejected shake/flash, the
 * confirm pulse/shimmer/cost-float, and — the load-bearing bit —
 * `detectConfirmations`, which turns a before/after slice of sim state into the
 * confirmations to celebrate, so a repair that heals the core lights the wedge
 * without any "I pressed the button" flag.
 */
import { describe, expect, it } from 'vitest';
import {
  PressFeedback,
  buildSegmentIndex,
  confirmPulse,
  detectConfirmations,
  pressPulse,
  rejectPulse,
  CONFIRM_REPEAT_GAP,
  CONFIRM_SECONDS,
  PRESS_FLASH_SECONDS,
  PRESS_GLOW,
  PRESS_SCALE,
  REJECT_SECONDS,
  NEUTRAL_FEEDBACK,
} from './press-feedback';
import type { WheelSnapshot } from './press-feedback';
import type { UiCue } from './sfx';
import { REPAIR_ENTRY_ORE } from './build-wheel';
import { STOCK_TIERS, UPGRADE_LADDER, UpgradeTrack, upgradeWheelSlots } from './upgrade-wheel';
import { SHIELD, TURRET } from '../sim/constants';

const REPAIR = buildSegmentIndex('repair');
const TURRET_I = buildSegmentIndex('turret');
const SHIELD_I = buildSegmentIndex('shield');

/** A neutral base snapshot; each test perturbs one number. */
function snap(over: Partial<WheelSnapshot> = {}): WheelSnapshot {
  return {
    coreHp: 50,
    banked: 10,
    cargo: 0,
    turrets: 0,
    shields: 0,
    tiers: { ...STOCK_TIERS },
    ...over,
  };
}

describe('pressPulse — the pressed tell (scale-down + glow)', () => {
  it('is fully pressed at the instant of the press', () => {
    const p = pressPulse(0);
    expect(p.active).toBe(true);
    expect(p.scale).toBeCloseTo(PRESS_SCALE, 5);
    expect(p.glow).toBeCloseTo(PRESS_GLOW, 5);
  });

  it('springs back to neutral by the end of the flash', () => {
    const mid = pressPulse(PRESS_FLASH_SECONDS / 2);
    expect(mid.scale).toBeGreaterThan(PRESS_SCALE);
    expect(mid.scale).toBeLessThan(1);
    const done = pressPulse(PRESS_FLASH_SECONDS + 0.001);
    expect(done).toEqual({ active: false, scale: 1, glow: 0 });
  });

  it('treats a negative/NaN elapsed as neutral, never a scale > or < bounds', () => {
    expect(pressPulse(-1).active).toBe(false);
    expect(pressPulse(Number.NaN).active).toBe(false);
  });
});

describe('rejectPulse — the disabled tell (shake + red flash)', () => {
  it('flashes at the start and shakes as time advances, then decays out', () => {
    const start = rejectPulse(0);
    expect(start.active).toBe(true);
    expect(start.flash).toBeGreaterThan(0);
    expect(start.offsetX).toBeCloseTo(0, 5); // sin(0) — the shake starts from centre

    const shaking = rejectPulse(REJECT_SECONDS * 0.1);
    expect(Math.abs(shaking.offsetX)).toBeGreaterThan(0);

    const done = rejectPulse(REJECT_SECONDS + 0.001);
    expect(done).toEqual({ active: false, offsetX: 0, flash: 0 });
  });

  it('flash amplitude bleeds out monotonically', () => {
    expect(rejectPulse(0).flash).toBeGreaterThan(rejectPulse(REJECT_SECONDS * 0.9).flash);
  });
});

describe('confirmPulse — the action tell (pulse + shimmer)', () => {
  it('swells to a crest at the midpoint and settles by the end', () => {
    expect(confirmPulse(0).scale).toBeCloseTo(1, 5);
    const crest = confirmPulse(CONFIRM_SECONDS / 2);
    expect(crest.scale).toBeGreaterThan(1);
    const end = confirmPulse(CONFIRM_SECONDS + 0.001);
    expect(end).toEqual({ active: false, scale: 1, shimmer: 0 });
  });

  it('shimmer is brightest at the moment of confirm and fades', () => {
    expect(confirmPulse(0).shimmer).toBeGreaterThan(confirmPulse(CONFIRM_SECONDS * 0.8).shimmer);
  });
});

describe('detectConfirmations — sim change → what to celebrate', () => {
  it('returns nothing when nothing changed', () => {
    expect(detectConfirmations(snap(), snap())).toEqual([]);
  });

  it('reads a rising core as a repair, and shimmers the core', () => {
    const out = detectConfirmations(snap({ coreHp: 50 }), snap({ coreHp: 52 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ surface: 'build', index: REPAIR, core: true, amount: REPAIR_ENTRY_ORE });
  });

  it('reads a queued turret and a queued shield off their counts', () => {
    const t = detectConfirmations(snap({ turrets: 0 }), snap({ turrets: 1 }));
    expect(t[0]).toMatchObject({ index: TURRET_I, amount: TURRET.cost, core: false });
    const s = detectConfirmations(snap({ shields: 0 }), snap({ shields: 1 }));
    expect(s[0]).toMatchObject({ index: SHIELD_I, amount: SHIELD.cost });
  });

  it('does not celebrate a deposit — banking is ambient in the atmosphere now', () => {
    // Bank up while the hold falls is exactly an auto-deposit (p4-11). It has no
    // wheel wedge to launch a float from and is told by the atmosphere halo, not
    // the wheel — so `detectConfirmations` stays silent on it.
    const deposited = detectConfirmations(snap({ banked: 10, cargo: 3 }), snap({ banked: 13, cargo: 0 }));
    expect(deposited).toEqual([]);
    // And a spend (bank falling) was never a deposit either.
    const spent = detectConfirmations(snap({ banked: 10, cargo: 0 }), snap({ banked: 7, cargo: 0 }));
    expect(spent).toEqual([]);
  });

  it('floats a main-wheel tier off its drawn wedge', () => {
    // CARGO is drawn on the main wheel at slot 2 (WEAPON, ENGINE, CARGO, HULL).
    const cargo = UpgradeTrack.Cargo;
    const before = snap({ tiers: { ...STOCK_TIERS } });
    const after = snap({ tiers: { ...STOCK_TIERS, [cargo]: 1 } });
    const out = detectConfirmations(before, after);
    expect(out).toHaveLength(1);
    expect(out[0]!.surface).toBe('upgrade');
    const slots = upgradeWheelSlots(false);
    expect(out[0]!.index).toBe(slots.findIndex((s) => s.kind === 'track' && s.track === cargo));
    expect(out[0]!.amount).toBe(UPGRADE_LADDER[cargo].costs[0]);
    expect(out[0]!.deposit).toBe(false);
  });

  it('floats a weapon-track tier off its sub-wheel wedge (weaponOpen)', () => {
    // A weapon track is only bought with the sub-wheel drilled in; the float must
    // land on the DAMAGE/SPEED wedge that is actually on screen, not a fixed slot.
    const power = UpgradeTrack.Power;
    const before = snap({ tiers: { ...STOCK_TIERS }, weaponOpen: true });
    const after = snap({ tiers: { ...STOCK_TIERS, [power]: 1 }, weaponOpen: true });
    const out = detectConfirmations(before, after);
    expect(out).toHaveLength(1);
    const slots = upgradeWheelSlots(true);
    expect(out[0]!.index).toBe(slots.findIndex((s) => s.kind === 'track' && s.track === power));
    expect(out[0]!.amount).toBe(UPGRADE_LADDER[power].costs[0]);
  });

  it('does not float a weapon-track buy while the main wheel is showing', () => {
    // Its wedge isn't drawn (it's collapsed into WEAPON), so there is nowhere to
    // float it — better silent than on the wrong wedge.
    const power = UpgradeTrack.Power;
    const before = snap({ tiers: { ...STOCK_TIERS }, weaponOpen: false });
    const after = snap({ tiers: { ...STOCK_TIERS, [power]: 1 }, weaponOpen: false });
    expect(detectConfirmations(before, after)).toEqual([]);
  });
});

describe('PressFeedback — the per-view driver', () => {
  it('a press glows and scales down the pressed wedge only', () => {
    const fb = new PressFeedback();
    fb.press('build', TURRET_I, true, 0);
    const pressed = fb.feedback('build', TURRET_I, 0);
    expect(pressed.scale).toBeLessThan(1);
    expect(pressed.glow).toBeGreaterThan(0);
    expect(pressed.reject).toBe(0);
    // A different wedge is untouched.
    expect(fb.feedback('build', SHIELD_I, 0)).toBe(NEUTRAL_FEEDBACK);
    // And the upgrade surface never collides with the build surface.
    expect(fb.feedback('upgrade', TURRET_I, 0)).toBe(NEUTRAL_FEEDBACK);
  });

  it('a disabled press shakes and red-flashes instead of glowing', () => {
    const fb = new PressFeedback();
    fb.press('build', REPAIR, false, 0);
    const rejected = fb.feedback('build', REPAIR, 0.05);
    expect(rejected.reject).toBeGreaterThan(0);
    expect(Math.abs(rejected.shakeX)).toBeGreaterThan(0);
    expect(rejected.glow).toBe(0);
  });

  it('a confirmation pulses, shimmers, floats a cost, and (for repair) shimmers the core', () => {
    const fb = new PressFeedback();
    fb.confirm({ surface: 'build', index: REPAIR, amount: REPAIR_ENTRY_ORE, deposit: false, core: true }, 0);
    const f = fb.feedback('build', REPAIR, 0.01);
    expect(f.scale).toBeGreaterThan(1);
    expect(f.shimmer).toBeGreaterThan(0);

    const floats = fb.floats(0.01);
    expect(floats).toHaveLength(1);
    expect(floats[0]).toMatchObject({ surface: 'build', index: REPAIR, amount: REPAIR_ENTRY_ORE, deposit: false });
    expect(floats[0]!.alpha).toBeGreaterThan(0);

    expect(fb.coreShimmer(0.01)).toBeGreaterThan(0);
  });

  it('throttles a repeated same-wedge confirmation so repair ticks, not sprays', () => {
    const fb = new PressFeedback();
    fb.confirm({ surface: 'build', index: REPAIR, amount: 1, deposit: false, core: true }, 0);
    // A second confirm inside the repeat gap is ignored — one float, not two.
    fb.confirm({ surface: 'build', index: REPAIR, amount: 1, deposit: false, core: true }, CONFIRM_REPEAT_GAP / 2);
    expect(fb.floats(CONFIRM_REPEAT_GAP / 2)).toHaveLength(1);
    // Past the gap it ticks again.
    fb.confirm({ surface: 'build', index: REPAIR, amount: 1, deposit: false, core: true }, CONFIRM_REPEAT_GAP + 0.01);
    expect(fb.floats(CONFIRM_REPEAT_GAP + 0.01).length).toBeGreaterThanOrEqual(1);
  });

  it('everything prunes once it has fully elapsed', () => {
    const fb = new PressFeedback();
    fb.press('build', TURRET_I, true, 0);
    fb.confirm({ surface: 'build', index: TURRET_I, amount: 3, deposit: false, core: false }, 0);
    // Well past both the press flash and the confirm window.
    const late = Math.max(PRESS_FLASH_SECONDS, REJECT_SECONDS, CONFIRM_SECONDS) + 1;
    expect(fb.feedback('build', TURRET_I, late)).toBe(NEUTRAL_FEEDBACK);
    expect(fb.floats(late)).toEqual([]);
    expect(fb.active(late)).toBe(false);
  });

  it('reset drops the live press and confirmations', () => {
    const fb = new PressFeedback();
    fb.press('build', TURRET_I, true, 0);
    fb.confirm({ surface: 'build', index: TURRET_I, amount: 3, deposit: false, core: false }, 0);
    fb.reset();
    expect(fb.active(0)).toBe(false);
    expect(fb.feedback('build', TURRET_I, 0)).toBe(NEUTRAL_FEEDBACK);
  });
});

describe('PressFeedback — the UI sound seam (field report v0.2.4+)', () => {
  it('a live press ticks, a disabled press buzzes — the same state that drives the tell', () => {
    const cues: UiCue[] = [];
    const fb = new PressFeedback((c) => cues.push(c));
    fb.press('build', TURRET_I, true, 0); // ready → the press tick
    fb.press('build', REPAIR, false, 0.2); // disabled → the buzzer
    expect(cues).toEqual(['press', 'reject']);
  });

  it('a fresh confirmation chimes; a throttled repeat is silent', () => {
    const cues: UiCue[] = [];
    const fb = new PressFeedback((c) => cues.push(c));
    // A repair heals every frame; only the first inside the gap should chime.
    fb.confirm({ surface: 'build', index: REPAIR, amount: 1, deposit: false, core: true }, 0);
    fb.confirm({ surface: 'build', index: REPAIR, amount: 1, deposit: false, core: true }, CONFIRM_REPEAT_GAP / 2);
    expect(cues).toEqual(['confirm']); // the throttled repeat made no sound
    // Past the gap it chimes again, matching the float that ticks.
    fb.confirm({ surface: 'build', index: REPAIR, amount: 1, deposit: false, core: true }, CONFIRM_REPEAT_GAP + 0.01);
    expect(cues).toEqual(['confirm', 'confirm']);
  });

  it('confirm() reports whether it registered, so a caller can gate its own sound', () => {
    const fb = new PressFeedback();
    expect(fb.confirm({ surface: 'build', index: TURRET_I, amount: 3, deposit: false, core: false }, 0)).toBe(true);
    // A same-wedge repeat inside the gap is throttled — and says so.
    expect(
      fb.confirm({ surface: 'build', index: TURRET_I, amount: 3, deposit: false, core: false }, CONFIRM_REPEAT_GAP / 2),
    ).toBe(false);
  });

  it('defaults to silent, so a headless view (Node, the QA harness) makes no sound', () => {
    // No seam passed: press/confirm must not throw and must be a no-op audibly —
    // the visual tell still works, which the driver tests above cover.
    const fb = new PressFeedback();
    expect(() => {
      fb.press('build', TURRET_I, true, 0);
      fb.confirm({ surface: 'build', index: TURRET_I, amount: 3, deposit: false, core: false }, 0);
    }).not.toThrow();
  });
});
