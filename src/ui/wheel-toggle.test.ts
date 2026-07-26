/**
 * Shared wheel open/close transition tests (the field bug: "opened and closed a
 * few times, then it wouldn't open anymore").
 *
 * The load-bearing property is the one the latch violated: **no sequence of
 * opens and closes, at any speed, can leave the wheel unable to re-open.** The
 * cycle test below is the exact reproduction — mash the target 15× — turned into
 * a headless assertion, so a regression to a stuck guard goes red here before it
 * ever reaches a player.
 */
import { describe, it, expect } from 'vitest';
import { WheelToggle, WHEEL_TRANSITION_SECONDS } from './wheel-toggle';

/** A dt that fully completes a transition in one step — for driving the machine
 *  to a settled open/closed state without simulating many frames. */
const FULL = WHEEL_TRANSITION_SECONDS;
/** A dt that only partially advances a transition — for catching a mid-animation
 *  re-open, which is the window the field bug lived in. */
const PART = WHEEL_TRANSITION_SECONDS / 3;

describe('WheelToggle', () => {
  it('starts closed, invisible and non-interactive', () => {
    const t = new WheelToggle();
    expect(t.progress).toBe(0);
    expect(t.visible).toBe(false);
    expect(t.interactive).toBe(false);
    expect(t.phase).toBe('closed');
  });

  it('opens toward full and settles at open', () => {
    const t = new WheelToggle();
    t.update(true, PART);
    expect(t.progress).toBeGreaterThan(0);
    expect(t.progress).toBeLessThan(1);
    expect(t.phase).toBe('opening');
    expect(t.visible).toBe(true);
    // Interactive the instant it is asked for — not only once the pop finishes.
    expect(t.interactive).toBe(true);

    t.update(true, FULL);
    expect(t.progress).toBe(1);
    expect(t.phase).toBe('open');
  });

  it('stays visible through the close tail, then goes invisible', () => {
    const t = new WheelToggle();
    t.update(true, FULL); // open
    t.update(false, PART); // begin closing
    expect(t.phase).toBe('closing');
    expect(t.visible).toBe(true); // the pop-shut is still on screen
    expect(t.interactive).toBe(false); // but no longer accepts input
    t.update(false, FULL); // finish closing
    expect(t.progress).toBe(0);
    expect(t.phase).toBe('closed');
    expect(t.visible).toBe(false);
  });

  it('re-opens mid-close instead of latching shut (the field bug)', () => {
    const t = new WheelToggle();
    t.update(true, FULL); // fully open
    t.update(false, PART); // start closing — the window the latch lived in
    const midway = t.progress;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);

    // Re-open while the close is still animating. A latched guard would ignore
    // this; the shared machine just flips the target and climbs back.
    t.update(true, PART);
    expect(t.progress).toBeGreaterThan(midway);
    expect(t.interactive).toBe(true);
    t.update(true, FULL);
    expect(t.phase).toBe('open');
  });

  it('survives 15 rapid open/close cycles and still opens (the exact field bug)', () => {
    const t = new WheelToggle();
    for (let i = 0; i < 15; i++) {
      // Only partially advance each toggle, so every cycle catches the machine
      // mid-animation — the precise condition that wedged the old menu.
      t.update(true, PART);
      t.update(false, PART);
    }
    // After all that mashing, one more open must still work.
    t.update(true, FULL);
    expect(t.interactive).toBe(true);
    expect(t.visible).toBe(true);
    expect(t.progress).toBe(1);
    expect(t.phase).toBe('open');
  });

  it('a huge dt (backgrounded tab) snaps rather than overshooting', () => {
    const t = new WheelToggle();
    t.update(true, 100);
    expect(t.progress).toBe(1); // clamped, not 800-something
    t.update(false, 100);
    expect(t.progress).toBe(0);
  });

  it('ignores a non-finite or negative dt without moving the wrong way', () => {
    const t = new WheelToggle();
    t.update(true, Number.NaN);
    expect(t.progress).toBe(0);
    t.update(true, -5);
    expect(t.progress).toBe(0);
  });

  it('reset() forces a clean, re-openable closed state', () => {
    const t = new WheelToggle();
    t.update(true, FULL);
    t.reset();
    expect(t.progress).toBe(0);
    expect(t.visible).toBe(false);
    expect(t.interactive).toBe(false);
    // …and it still opens afterward.
    t.update(true, FULL);
    expect(t.phase).toBe('open');
  });
});
