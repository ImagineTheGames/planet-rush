/**
 * src/ui/wheel-selection.test.ts — the selection state, measured (u16-01).
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The developer asked whether the build wheel is *"FULLY theme compliant like how
 * the design for it was made"*, and `docs/theme-coverage.md` answered: yes on
 * material, geometry, type and palette — and then named the half that had never
 * been built, *"a highlighted wedge, a 140 ms sweep between wedges, a brighter
 * and larger name on the selected one, and a detent note as the thumb crosses a
 * boundary."*
 *
 * Three of those four are motion and sound, which a golden cannot see: a
 * screenshot proves the highlight EXISTS, and says nothing at all about how long
 * it took to get there or whether it took the short way round. That is what this
 * suite is for.
 *
 * The brief's own instruction is *"state the measured sweep duration rather than
 * asserting 140 ms"*, so the tests below drive the real driver frame by frame and
 * MEASURE when it arrives, rather than reading the constant back at itself.
 */
import { describe, it, expect } from 'vitest';
import { PLATE_MOTION } from '../art/materials';
import { SEGMENT_ARC, WHEEL_ORDER, clampSelection, segmentAngle } from './build-wheel';
import type { SegmentState } from './build-wheel';
import {
  SELECTION_NAME_SCALE,
  SELECTION_SWEEP_SECONDS,
  WheelSelection,
  detentOnSelection,
  sweepEase,
} from './wheel-selection';

const COUNT = WHEEL_ORDER.length;
/** A 60 fps frame, the clock the driver is actually fed in the game. */
const FRAME = 1 / 60;

/** Smallest signed angular difference, radians — so a comparison of two wheel
 *  angles is never fooled by one of them having wrapped. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Drive a fresh driver to a settled selection on `index`. */
function settledOn(index: number): WheelSelection {
  const s = new WheelSelection();
  s.update(index, COUNT, FRAME);
  s.settle();
  return s;
}

describe('the sweep is the design\'s 140 ms, measured rather than asserted', () => {
  it('takes 140 ms of clock to finish moving to the next wedge', () => {
    const s = settledOn(0);

    // Advance a millisecond at a time and record when the highlight STOPS —
    // the last millisecond on which the angle still changes. Measuring in
    // MILLISECONDS rather than frames is the point: a frame count would pass at
    // 60 fps and quietly mean something else at 30.
    const target = segmentAngle(1);
    let elapsedMs = 0;
    let settledAt = -1;
    let withinATenthOfADegree = -1;
    let prev = s.angle;
    while (elapsedMs < 1000) {
      s.update(1, COUNT, 0.001);
      elapsedMs += 1;
      if (withinATenthOfADegree < 0 && Math.abs(angleDelta(s.angle, target)) < 0.1 * (Math.PI / 180)) {
        withinATenthOfADegree = elapsedMs;
      }
      if (s.angle !== prev) settledAt = elapsedMs;
      prev = s.angle;
    }

    expect(settledAt).toBe(140);
    // …and the number it landed on is the handoff's, read from the one place it
    // is written down rather than typed a second time here.
    expect(settledAt).toBe(PLATE_MOTION.wheelMs);
    expect(SELECTION_SWEEP_SECONDS).toBeCloseTo(0.14, 10);

    // The second number, stated because it is the one an eye actually reads and
    // it is NOT 140: `cubic-bezier(.2,.7,.2,1)` settles asymptotically, so the
    // highlight is within a tenth of a degree of the new wedge at ~128 ms and
    // spends the last ~12 ms closing a gap nobody can see. That is the
    // curve's job — a move that arrives visually early and stops cleanly late is
    // what "detent" feels like — and it is why this test measures the END of the
    // motion rather than the moment it looks finished.
    expect(withinATenthOfADegree).toBe(128);
  });

  it('is still moving at half the duration — it is a sweep, not a jump', () => {
    // The failure this catches is a "sweep" that snaps on the first frame and
    // then sits there for 139 ms, which measures the same at both ends.
    const s = settledOn(0);
    s.update(1, COUNT, 0.07);
    const half = angleDelta(s.angle, segmentAngle(0)) / SEGMENT_ARC;
    expect(half).toBeGreaterThan(0.05);
    expect(half).toBeLessThan(0.99);
  });

  it('runs the handoff\'s own easing curve, front-loaded', () => {
    expect(sweepEase(0)).toBe(0);
    expect(sweepEase(1)).toBe(1);
    // cubic-bezier(.2,.7,.2,1) leaves fast and settles: past halfway by the time
    // a third of the clock has run. This is what makes 140 ms read as a detent
    // landing rather than as a slide.
    expect(sweepEase(1 / 3)).toBeGreaterThan(0.5);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const y = sweepEase(i / 20);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    // The control points really are the handoff's, not a hand-tuned lookalike.
    expect([...PLATE_MOTION.wheelEasing]).toEqual([0.2, 0.7, 0.2, 1]);
  });

  it('had no consumer at all before this — the constant was decoration', () => {
    // a0-20 §1b: "`PLATE_MOTION` … is declared and imported by nothing". The
    // whole point of this module is to be its consumer, so the two are pinned
    // together rather than each drifting on its own.
    expect(SELECTION_SWEEP_SECONDS).toBe(PLATE_MOTION.wheelMs / 1000);
  });
});

describe('the sweep takes the short way round', () => {
  it('moves ONE wedge from the last to the first, not four backwards', () => {
    // Screen 5a rotates a conic by `sel * 90` and lets CSS interpolate the
    // number, so its 3 → 0 spins 270° backwards through every other wedge. On a
    // five-wedge wheel that would be 288°, through four wedges, to say "you moved
    // one notch". The design is a four-wedge prototype; this is the wheel.
    const s = settledOn(COUNT - 1);
    const from = s.angle;
    s.update(0, COUNT, 0);

    // Sample the whole sweep and check it never strays further than one arc from
    // where it started — a long-way-round would swing a full turn.
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      s.update(0, COUNT, 0.005);
      worst = Math.max(worst, Math.abs(s.angle - from));
    }
    expect(worst).toBeLessThanOrEqual(SEGMENT_ARC + 1e-9);
    expect(Math.abs(angleDelta(s.angle, segmentAngle(0)))).toBeLessThan(1e-6);
  });

  it('moves one wedge the other way too — first to last', () => {
    const s = settledOn(0);
    const from = s.angle;
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      s.update(COUNT - 1, COUNT, 0.005);
      worst = Math.max(worst, Math.abs(s.angle - from));
    }
    expect(worst).toBeLessThanOrEqual(SEGMENT_ARC + 1e-9);
    expect(Math.abs(angleDelta(s.angle, segmentAngle(COUNT - 1)))).toBeLessThan(1e-6);
  });
});

describe('the angles come from the wedge count it is driving (a0-51)', () => {
  /** The Upgrade wheel as the developer photographed it: four tracks, so a wedge
   *  is a QUARTER of a turn where the Build wheel's is a fifth. */
  const UPGRADE_COUNT = 4;

  /** Where wedge `i` of `n` sits, written out longhand rather than imported: the
   *  bug being pinned is that the driver computed this from the wrong `n`, and a
   *  test that asks the same helper the code asks cannot see that. */
  const expected = (i: number, n: number): number => -Math.PI / 2 + (i * (2 * Math.PI)) / n;

  it('lands on EVERY wedge of a four-wedge wheel, not just the top one', () => {
    // The whole report, in one loop. `-π/2` is twelve o'clock at every count, so
    // index 0 is the one index where a fifth-of-a-turn stride and a quarter-turn
    // stride agree — which is exactly why the developer saw *"only the top most
    // one has it"*, and why this walks all four.
    for (let i = 0; i < UPGRADE_COUNT; i++) {
      const s = new WheelSelection();
      s.update(i, UPGRADE_COUNT, FRAME);
      s.settle();
      expect(Math.abs(angleDelta(s.angle, expected(i, UPGRADE_COUNT))), `wedge ${i}`).toBeLessThan(
        1e-9,
      );
    }
  });

  it('is off by a whole quarter-arc on the last wedge if it reads the Build wheel\'s five', () => {
    // The size of the old error, stated so a regression cannot be waved through as
    // rounding: the wheel's own wedge 3 is at 180°, the Build wheel's index 3 at
    // 126° — 54°, well over half a wedge, so the highlight straddled the wedge
    // BEFORE the one being pointed at.
    const s = new WheelSelection();
    s.update(3, UPGRADE_COUNT, FRAME);
    s.settle();
    const drift = angleDelta(s.angle, segmentAngle(3)) * (180 / Math.PI);
    expect(Math.abs(drift)).toBeCloseTo(54, 6);
    expect(Math.abs(angleDelta(s.angle, expected(3, UPGRADE_COUNT)))).toBeLessThan(1e-9);
  });

  it('drives any wheel it is handed — two wedges to eight, every index', () => {
    // The WEAPON sub-wheel is two wedges and the ladder is data (p2-03 adds
    // tracks), so "four" is today's number rather than the rule. The rule is that
    // the machine is parameterised.
    for (let n = 2; n <= 8; n++) {
      for (let i = 0; i < n; i++) {
        const s = new WheelSelection();
        s.update(i, n, FRAME);
        s.settle();
        expect(Math.abs(angleDelta(s.angle, expected(i, n))), `wedge ${i} of ${n}`).toBeLessThan(
          1e-9,
        );
      }
    }
  });

  it('sweeps ONE quarter-arc on a four-wedge wrap, not one fifth and not three', () => {
    // The short-way-round rule, re-measured at a count that is not five: the arc
    // it may never exceed is this wheel's, so a driver that wrapped correctly in
    // fifths would fail here rather than pass by luck.
    const arc = (2 * Math.PI) / UPGRADE_COUNT;
    const s = new WheelSelection();
    s.update(UPGRADE_COUNT - 1, UPGRADE_COUNT, FRAME);
    s.settle();
    const from = s.angle;
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      s.update(0, UPGRADE_COUNT, 0.005);
      worst = Math.max(worst, Math.abs(s.angle - from));
    }
    expect(worst).toBeLessThanOrEqual(arc + 1e-9);
    expect(worst).toBeGreaterThan(arc * 0.9);
    expect(Math.abs(angleDelta(s.angle, expected(0, UPGRADE_COUNT)))).toBeLessThan(1e-9);
  });

  it('re-targets to the new wheel\'s geometry mid-sweep, not the old wheel\'s', () => {
    // One instance is only ever given one wheel's count in the shipped view, but
    // the count is an argument and arguments change: whatever it is given, the
    // wedge it aims at is that wheel's.
    const s = new WheelSelection();
    s.update(1, UPGRADE_COUNT, FRAME);
    s.settle();
    s.update(2, UPGRADE_COUNT, 0.04); // mid-sweep
    s.update(3, UPGRADE_COUNT, 0.2); // …re-aimed, and given time to arrive
    expect(Math.abs(angleDelta(s.angle, expected(3, UPGRADE_COUNT)))).toBeLessThan(1e-9);
  });
});

describe('the highlight appears, moves and leaves without lying about any of it', () => {
  it('arrives ON the wedge and fades up, rather than sweeping in from nowhere', () => {
    // Nothing was lit, so there is no move to animate. A sweep here would draw a
    // journey the player never made — the pointer entered the wheel, it did not
    // travel across it.
    const s = new WheelSelection();
    s.update(2, COUNT, FRAME);
    expect(Math.abs(angleDelta(s.angle, segmentAngle(2)))).toBeLessThan(1e-9);
    expect(s.presence).toBeGreaterThan(0);
    expect(s.presence).toBeLessThan(1);
  });

  it('fades out in place when the pointer leaves — it does not slide off', () => {
    const s = settledOn(3);
    s.update(null, COUNT, 0.07);
    expect(s.index).toBeNull();
    expect(Math.abs(angleDelta(s.angle, segmentAngle(3)))).toBeLessThan(1e-9);
    expect(s.presence).toBeGreaterThan(0);
    expect(s.presence).toBeLessThan(1);
    // …and it is fully gone one sweep later, on the same clock as everything else.
    s.update(null, COUNT, 0.07);
    expect(s.presence).toBe(0);
    expect(s.lit).toBe(false);
  });

  it('re-targets from wherever it actually is, mid-sweep', () => {
    // A thumb that changes its mind 40 ms in must not snap back to the wedge it
    // was leaving and start again — that is a visible stutter, and it is the
    // classic bug in a hand-rolled tween that stores its origin once.
    const s = settledOn(0);
    s.update(1, COUNT, 0.04);
    const mid = s.angle;
    expect(Math.abs(angleDelta(mid, segmentAngle(0)))).toBeGreaterThan(1e-6);
    s.update(2, COUNT, 0);
    expect(Math.abs(angleDelta(s.angle, mid))).toBeLessThan(1e-9);
  });

  it('settles onto the target when there is no clock to animate across', () => {
    // The frozen frame (`?freeze=1`) and every golden that shoots it: dt is 0
    // forever, and a highlight stuck at presence 0 would photograph as "not
    // built" for the second time in this feature's life.
    const s = new WheelSelection();
    s.update(1, COUNT, 0);
    s.settle();
    expect(s.presence).toBe(1);
    expect(Math.abs(angleDelta(s.angle, segmentAngle(1)))).toBeLessThan(1e-9);
  });

  it('a huge dt finishes the sweep instead of overshooting it', () => {
    const s = settledOn(0);
    s.update(1, COUNT, 30); // the tab was backgrounded for half a minute
    expect(Math.abs(angleDelta(s.angle, segmentAngle(1)))).toBeLessThan(1e-9);
    expect(s.presence).toBe(1);
  });

  it('a non-finite or negative dt moves nothing', () => {
    const s = settledOn(0);
    s.update(1, COUNT, Number.NaN);
    const after = s.angle;
    s.update(1, COUNT, -5);
    expect(s.angle).toBe(after);
    expect(Math.abs(angleDelta(after, segmentAngle(0)))).toBeLessThan(1e-9);
  });

  it('reset leaves a clean, re-selectable machine', () => {
    const s = settledOn(2);
    s.reset();
    expect(s.index).toBeNull();
    expect(s.presence).toBe(0);
    expect(s.crossed).toBe(false);
    s.update(4, COUNT, FRAME);
    expect(s.index).toBe(4);
  });
});

describe('a crossing is a change, and reading it twice does not make two', () => {
  it('reports the frame the selection moved, and only that frame', () => {
    const s = settledOn(0);
    s.update(1, COUNT, FRAME);
    expect(s.crossed).toBe(true);
    expect(s.crossed).toBe(true); // derived, not drained — reading is free
    s.update(1, COUNT, FRAME);
    expect(s.crossed).toBe(false);
  });

  it('does not report the pointer LEAVING as a crossing', () => {
    const s = settledOn(1);
    s.update(null, COUNT, FRAME);
    expect(s.crossed).toBe(false);
  });

  it('an out-of-range index is nothing selected, not a neighbour', () => {
    const s = settledOn(1);
    s.update(99, COUNT, FRAME);
    expect(s.index).toBeNull();
  });
});

describe('clampSelection — a highlight on the wrong wedge is worse than none', () => {
  it('passes an in-range index through', () => {
    for (let i = 0; i < COUNT; i++) expect(clampSelection(i, COUNT)).toBe(i);
  });

  it('answers null for every kind of nothing', () => {
    expect(clampSelection(null, COUNT)).toBeNull();
    expect(clampSelection(undefined, COUNT)).toBeNull();
  });

  it('refuses rather than clamping to an end', () => {
    expect(clampSelection(-1, COUNT)).toBeNull();
    expect(clampSelection(COUNT, COUNT)).toBeNull();
    expect(clampSelection(1.5, COUNT)).toBeNull();
    expect(clampSelection(Number.NaN, COUNT)).toBeNull();
  });
});

describe('the detent is muted on a wedge you cannot buy (the handoff\'s own rule)', () => {
  const wedges = (...states: SegmentState[]): { state: SegmentState }[] =>
    states.map((state) => ({ state }));

  it('ticks when the crossed wedge is ready', () => {
    expect(detentOnSelection(0, 1, wedges('ready', 'ready'))).toBe(true);
    expect(detentOnSelection(null, 1, wedges('ready', 'ready'))).toBe(true);
  });

  it('is silent on unaffordable, capped and inert — every reason a press is refused', () => {
    // The handoff: "Wedge crossed → detent … muted while unaffordable". The
    // prototype's own guard is `affordable(i) && !capped(i)`, which is what this
    // wheel's model already calls `ready`; the two extra reasons this game has (a
    // full reactor, a cooling one) mute for the same reason — a tick on a wedge
    // that is about to refuse you is the game telling a lie about a purchase.
    for (const state of ['unaffordable', 'capped', 'inactive'] as const) {
      expect(detentOnSelection(0, 1, wedges('ready', state)), state).toBe(false);
    }
  });

  it('is silent when nothing changed, and when the pointer left', () => {
    expect(detentOnSelection(1, 1, wedges('ready', 'ready'))).toBe(false);
    expect(detentOnSelection(1, null, wedges('ready', 'ready'))).toBe(false);
    expect(detentOnSelection(null, null, wedges('ready'))).toBe(false);
  });

  it('is silent on a wedge that is not there at all', () => {
    expect(detentOnSelection(0, 9, wedges('ready', 'ready'))).toBe(false);
  });
});

describe('the selected name is the design\'s 19 px from 17', () => {
  it('is stated as a ratio, so it survives the phone profile', () => {
    expect(SELECTION_NAME_SCALE).toBeCloseTo(19 / 17, 12);
    // …and it really is a growth, not a rounding: 17 × this is 19 exactly, which
    // is the desktop profile the design states its numbers at.
    expect(17 * SELECTION_NAME_SCALE).toBeCloseTo(19, 12);
  });
});
