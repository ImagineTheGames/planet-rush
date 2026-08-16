/**
 * src/art/vfx/death-moment.test.ts — the timings the three seconds are made of.
 * OWNER: Sound Agent (a0-55).
 *
 * `death-moment.ts` opens by saying what it is: not a mixer preference living in
 * the audio engine *"where a later optimisation could quietly disable it"*, but a
 * state machine with a name, its own test, and one number the whole mix
 * multiplies by. This is that test.
 *
 * It exists as a file of its own because a0-55 made the shape of the quiet load
 * bearing for something outside itself. The station-death sting is exempt from
 * the hush by ROUTING (`../audio/graph`'s `sting` node, summed past the duck) —
 * and that fix rests on facts about *this* class:
 *
 *  1. **The cut does not begin before the death it holds.** `gain` is exactly 1
 *     at the instant of `trigger()`, so the fall always starts at full level. If
 *     the quiet ever pre-empted its own cause, the sting would open ducked and
 *     the exemption would be buying a fade-in.
 *  2. **The cut is 0.12 s of shaped fall, not an instant mute** — which is why
 *     the engine's hush gate still lets a few sounds start during it, and why
 *     `engine.test.ts` takes its baselines on the far side of it.
 *  3. **The three numbers are the numbers.** a0-55's brief permitted a fallback
 *     that would have *delayed* the hush by the sting's 1.1 s tail, at the cost
 *     of a ratified duration. That fallback was not taken. These assertions are
 *     what make "unchanged" checkable rather than claimed, so a later pass cannot
 *     restore the old behaviour by moving the cut earlier or trimming the quiet.
 *
 * Pure and headless: the class advances only by the `dt` it is handed, so this
 * runs the same in CI as in a replay (GDD §4.1).
 */

import { describe, expect, it } from 'vitest';
import { DeathMoment, HUSH_CUT_S, HUSH_RETURN_S, HUSH_S } from './death-moment';

describe('the station-death hush — the timings a0-55 rests on', () => {
  it('cut does not begin before the death it holds', () => {
    const death = new DeathMoment();

    // Nothing held: the mix is open, all of it.
    expect(death.active).toBe(false);
    expect(death.gain).toBe(1);

    // The instant of the death. The engine fires the fall on this same frame,
    // and the fall must leave at FULL level — the quiet lands on top of it, it
    // does not start underneath it (GDD §4.7).
    death.trigger();
    expect(death.gain).toBe(1);
    expect(death.since).toBe(0);
    expect(death.silent).toBe(true); // held, and not yet fallen

    // Only time moves it, and a zero-length frame is not time.
    death.update(0);
    expect(death.gain).toBe(1);
    death.update(-1); // a clock that went backwards cannot start the cut either
    expect(death.gain).toBe(1);

    // Now it falls — and it falls, rather than jumping.
    death.update(HUSH_CUT_S / 4);
    const quarter = death.gain;
    expect(quarter).toBeLessThan(1);
    expect(quarter).toBeGreaterThan(0);
    death.update(HUSH_CUT_S / 4);
    expect(death.gain).toBeLessThan(quarter);
    expect(death.gain).toBeGreaterThan(0);

    // Zero only at the end of the cut, not before it.
    death.update(HUSH_CUT_S / 2 - 1e-6);
    expect(death.gain).toBeGreaterThan(0);
    death.update(1e-6);
    expect(death.gain).toBe(0);
  });

  it('holds the three seconds and comes back slowly — the ratified numbers', () => {
    // The tone contract's own figures (GDD §4.7, style-guide §8). a0-55 changed
    // the ROUTING of one sound and not one of these.
    expect(HUSH_S).toBe(3);
    expect(HUSH_CUT_S).toBe(0.12);
    expect(HUSH_RETURN_S).toBe(0.9);
    // Fast down, slow back: the drop reads as intent, the return as a beat ending.
    expect(HUSH_CUT_S).toBeLessThan(HUSH_RETURN_S);

    const death = new DeathMoment();
    death.trigger();
    // Every 10 ms from the end of the cut to the end of the quiet: silent.
    for (let t = HUSH_CUT_S; t < HUSH_S; t += 0.01) {
      const step = new DeathMoment();
      step.trigger();
      step.update(t);
      expect(step.gain, `t=${t.toFixed(3)}`).toBe(0);
      expect(step.silent).toBe(true);
    }

    death.update(HUSH_S);
    expect(death.gain).toBe(0); // the boundary belongs to the quiet
    expect(death.remaining).toBe(0);

    death.update(HUSH_RETURN_S / 2);
    const half = death.gain;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    death.update(HUSH_RETURN_S / 2);
    expect(death.gain).toBe(1);
    expect(death.active).toBe(false); // and it lets go of the mix entirely
  });

  it('refreshes on a second death rather than stacking six seconds of quiet', () => {
    const death = new DeathMoment();
    death.trigger();
    death.update(2);
    expect(death.remaining).toBeCloseTo(1, 6);

    // A second home dying a second before the first one's quiet lifts. The sting
    // for it is exempt (`../audio/engine`), but the QUIET is one quiet.
    death.trigger();
    expect(death.count).toBe(2);
    expect(death.remaining).toBe(HUSH_S);
    death.update(HUSH_S + HUSH_RETURN_S);
    expect(death.active).toBe(false);

    death.reset();
    expect(death.count).toBe(0);
    expect(death.gain).toBe(1);
  });
});
