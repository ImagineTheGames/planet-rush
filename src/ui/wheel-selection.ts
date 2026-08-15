/**
 * src/ui/wheel-selection.ts — the wheel's SELECTION, and the sweep between
 * wedges. OWNER: UI Engineer.
 *
 * ── WHY THIS FILE EXISTS (u16-01, answering a0-20's Q2) ─────────────────────
 * The developer asked whether the build wheel is *"FULLY theme compliant like how
 * the design for it was made"*. `docs/theme-coverage.md` measured it clause by
 * clause and answered: on material, geometry, type and palette, yes — and then
 * named the half that was never built at all.
 *
 * > *"The design specifies a highlighted wedge, a 140 ms sweep between wedges, a
 * > brighter and larger name on the selected one, and a detent note as the thumb
 * > crosses a boundary. We ship none of it, and on desktop the wheel has no hover
 * > at all."*
 *
 * Screen 5a keys five separate tells off one variable, `sel`, and transitions
 * three of them on `transform 140ms cubic-bezier(.2,.7,.2,1)`. That transition
 * has been sitting in the repo as {@link PLATE_MOTION} `wheelMs` since the
 * Gantry/Bone pass with **no consumer** (a0-20 §1b). This module is its consumer,
 * and it is the whole of the wheel's selection motion.
 *
 * ── WHAT IS HERE AND WHAT IS NOT ────────────────────────────────────────────
 * The *target* — which wedge is selected right now — is model state and lives on
 * {@link ../ui/build-wheel.BuildWheelModel}, fed from a device-neutral signal, for
 * the reason a0-20 §6.4 gives: every decision on this wheel is made in the pure,
 * headless-tested model and the view only paints, and a `selected` flag stashed in
 * `BuildWheelView` would be the one piece of wheel state no test can reach.
 *
 * What is HERE is the *motion* between two targets — the same relationship
 * {@link ./wheel-toggle} has to the model's `open`: a pure, PixiJS-free, clamped
 * driver the view reads an angle and an alpha off. It holds no opinion about
 * which wedge should be selected and cannot make one, so it cannot disagree with
 * the model.
 *
 * ── THE NUMBER IS 140 ms, EXACTLY ───────────────────────────────────────────
 * Not "about an eighth of a second", and not rounded to a frame count. It is read
 * from `PLATE_MOTION.wheelMs`, which is read from the handoff, so there is one
 * copy of it in the repo and the sweep this module runs is the sweep the design
 * specifies. `wheel-selection.test.ts` measures the driver against that constant
 * rather than asserting the constant back at itself.
 */

import { PLATE_MOTION } from '../art/materials';
import { clampSelection, wedgeAngle, WHEEL_TOP } from './wheel-geometry';

// ---------------------------------------------------------------------------
// The design's own numbers
// ---------------------------------------------------------------------------

/** How long the highlight takes to sweep from one wedge to the next, seconds —
 *  the handoff's `140ms`, read from the one place it is written down. */
export const SELECTION_SWEEP_SECONDS = PLATE_MOTION.wheelMs / 1000;

/** The handoff's `cubic-bezier(.2,.7,.2,1)` control points. Front-loaded: the
 *  highlight leaves the old wedge fast and settles onto the new one, which is
 *  what makes a 140 ms move read as a *detent* rather than as a slide. */
export const SELECTION_EASING = PLATE_MOTION.wheelEasing;

/**
 * How much larger the selected wedge's name is drawn — the design's **19 px from
 * 17 px** (`5a` script `wedge(i)`: `['f' + i]: sel === i ? 19 : 17`), stated as a
 * ratio rather than as a pair of pixel sizes so it survives the phone profile,
 * where the name is 12 px and a hard-coded 19 would be a 58 % jump.
 *
 * `hud-geometry.test.ts` holds the ENLARGED name to the same arc-fit budget as
 * the resting one, at every profile — the wedge does not get wider when its name
 * does, and the 390 px phone is where that stops being obvious.
 */
export const SELECTION_NAME_SCALE = 19 / 17;

// ---------------------------------------------------------------------------
// The easing curve
// ---------------------------------------------------------------------------

function bezier(t: number, a: number, b: number): number {
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}

function bezierSlope(t: number, a: number, b: number): number {
  const u = 1 - t;
  return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
}

/**
 * The handoff's `cubic-bezier(.2,.7,.2,1)`, solved the way a browser solves it:
 * find the curve parameter whose x is the elapsed fraction, then read its y.
 *
 * Newton-Raphson from a sensible seed, with a bisection fallback for the flat
 * stretches where the derivative is small — the same belt-and-braces every CSS
 * engine uses, because a slope of zero turns one Newton step into a wild jump and
 * a wild jump in an easing curve is a visible stutter.
 */
export function sweepEase(x: number): number {
  const t0 = x < 0 ? 0 : x > 1 ? 1 : x;
  if (t0 <= 0 || t0 >= 1) return t0;
  const [x1, y1, x2, y2] = SELECTION_EASING as readonly [number, number, number, number];

  let t = t0;
  for (let i = 0; i < 8; i++) {
    const err = bezier(t, x1, x2) - t0;
    if (Math.abs(err) < 1e-7) return bezier(t, y1, y2);
    const slope = bezierSlope(t, x1, x2);
    if (Math.abs(slope) < 1e-6) break;
    t -= err / slope;
  }

  let lo = 0;
  let hi = 1;
  t = t0;
  for (let i = 0; i < 32; i++) {
    const err = bezier(t, x1, x2) - t0;
    if (Math.abs(err) < 1e-7) break;
    if (err > 0) hi = t;
    else lo = t;
    t = (lo + hi) / 2;
  }
  return bezier(t, y1, y2);
}

// ---------------------------------------------------------------------------
// Which wedge, and when a crossing is worth a sound
// ---------------------------------------------------------------------------

/** The only thing the detent asks of a wedge: whether it is pressable right now.
 *  Both wheels' state unions spell that `'ready'` ({@link ./build-wheel.SegmentState},
 *  {@link ./upgrade-wheel.UpgradeWedgeState}), so it is stated structurally here
 *  rather than by importing either wheel into the machine that drives both. */
export interface DetentWedge {
  readonly state: string;
}

/**
 * Whether a change of selection should fire the **detent** cue — the handoff's
 * *"Wedge crossed → detent, one note an octave above the click, **muted while
 * unaffordable**"* (§Audio), which is exactly the prototype's own rule:
 *
 * ```js
 * const pick = (i) => () => {
 *   if (this.state.sel === i) return;
 *   this.setState({ sel: i });
 *   if (affordable(i) && !capped(i)) this.cue('detent');
 * };
 * ```
 *
 * `affordable(i) && !capped(i)` is what this wheel's model already calls
 * `state === 'ready'` — plus the two disabled reasons the prototype has no
 * equivalent of (a full reactor, a cooling one), which mute for the same reason:
 * a tick that fires on a wedge you cannot buy is the sound of the game telling
 * you a lie about a purchase you are about to be refused.
 *
 * Landing on nothing (`next === null`) is silent. It is not a wedge crossing; it
 * is the pointer leaving, and s6-01 rule 1 — one sound per state change — is not
 * a licence to sound the absence of one.
 *
 * The wedges are taken structurally ({@link DetentWedge}) rather than as either
 * wheel's segment type, because the detent asks one question — *is the thing you
 * just crossed onto pressable* — and both wheels answer it with the same word.
 * That is what lets the Upgrade wheel tick on a crossing without this module
 * learning what an upgrade track is (a0-51).
 */
export function detentOnSelection(
  prev: number | null,
  next: number | null,
  segments: readonly DetentWedge[],
): boolean {
  if (next === null || next === prev) return false;
  return segments[next]?.state === 'ready';
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * The highlight's motion between wedges. One instance per drawn wheel; fed the
 * model's `selected` and the frame's `dt`, exactly as {@link ./wheel-toggle} is
 * fed the model's `open`.
 *
 * Two pieces of stored state and nothing else:
 *
 *  - {@link angle} — where the highlight is drawn *right now*, in the wheel's own
 *    radians (`-π/2` is twelve o'clock, clockwise). It eases toward the selected
 *    wedge's centre across {@link SELECTION_SWEEP_SECONDS}.
 *  - {@link presence} — how lit the highlight is, 0→1, so a selection that
 *    *appears* (the pointer arriving) or *leaves* (the pointer going) fades over
 *    the same 140 ms instead of popping. The design never states this, because
 *    its prototype always has a selection; a live wheel does not, and a highlight
 *    that blinks on and off is the one way this feature could read as a fault.
 *
 * Everything else — the sweep's progress, whether a crossing just happened — is
 * derived, so there is no second copy of the truth to fall out of step with the
 * first.
 *
 * ── THE SWEEP TAKES THE SHORT WAY ROUND, AND THE DESIGN DOES NOT ───────────
 * Screen 5a rotates its conic by `sel * 90` degrees and lets CSS interpolate the
 * number, so its wedge-3 → wedge-0 move spins 270° **backwards** through every
 * other wedge. That is a four-wedge prototype's rounding error, not a decision:
 * the tell it is animating is "the highlight moved one notch", and a notch that
 * takes the long way round says the opposite. Here the target angle is chosen as
 * the nearest rotational equivalent of the selected wedge, so 4 → 0 on a
 * five-wedge wheel sweeps one arc forward. `wheel-selection.test.ts` pins it.
 *
 * ── AND IT SWEEPS TO THE WHEEL IT IS ACTUALLY DRIVING (a0-51) ──────────────
 * Every angle here comes from {@link ./wheel-geometry.wedgeAngle} and the `count`
 * {@link update} is given — the same number the wrap already used. It used to
 * come from the Build wheel's `segmentAngle`, which is 2π/5 per step whatever
 * wheel is on screen, so on the four-wedge Upgrade wheel the highlight landed a
 * further 18° short of its wedge for every index past the first. Index 0 is
 * twelve o'clock at every count, which is why the developer saw *"only the top
 * most one has it"* and why the test walks every index, not the first.
 */
export class WheelSelection {
  /** The wedge the model says is selected, after clamping. */
  private _index: number | null = null;
  /** Where the highlight is drawn, radians. Meaningful only while lit. Starts at
   *  twelve o'clock, which is wedge 0 on a wheel of any size. */
  private _angle = WHEEL_TOP;
  /** Sweep start, and the target it is easing toward (radians, unwrapped so the
   *  difference between them IS the short way round). */
  private _from = WHEEL_TOP;
  private _to = WHEEL_TOP;
  /** 0→1 across one sweep. 1 = settled. */
  private _t = 1;
  /** 0→1 fade of the whole highlight. */
  private _presence = 0;
  /** A wedge boundary was crossed on the most recent {@link update}. */
  private _crossed = false;

  /** The selected wedge index, or `null` when nothing is selected. */
  get index(): number | null {
    return this._index;
  }

  /** Where the highlight is drawn this frame, radians (y-down, `-π/2` = twelve
   *  o'clock) — mid-sweep this is BETWEEN two wedge centres, which is the whole
   *  point of the sweep. */
  get angle(): number {
    return this._angle;
  }

  /** How far through the current sweep, 0→1 eased. 1 when settled. */
  get progress(): number {
    return sweepEase(this._t);
  }

  /** How lit the highlight is, 0→1 — the view multiplies its alphas by this. */
  get presence(): number {
    return this._presence;
  }

  /** Whether the highlight is worth drawing at all this frame. */
  get lit(): boolean {
    return this._presence > 0;
  }

  /** Whether the selection changed to a different wedge on the last
   *  {@link update} — the frame a detent belongs on. Read-only and derived from
   *  that update alone, so reading it twice cannot fire two sounds. */
  get crossed(): boolean {
    return this._crossed;
  }

  /**
   * Advance one frame toward `target`.
   *
   * @param target the model's `selected` — already clamped, or clamped here.
   * @param count  how many wedges the wheel has. It decides BOTH what counts as
   *               an in-range index and where that index sits, so the highlight
   *               lands on the wheel it is drawn over: five wedges on the Build
   *               wheel, four on the Upgrade wheel, two on the WEAPON sub-wheel
   *               (a0-51 — one machine, parameterised, never a second copy).
   * @param dt     seconds since the last frame. A non-finite or negative `dt`
   *               moves nothing; a huge one (the tab was backgrounded) simply
   *               finishes the sweep, because the clamp below cannot overshoot.
   */
  update(target: number | null, count: number, dt: number): void {
    const next = clampSelection(target, count);
    this._crossed = next !== null && next !== this._index;

    if (next !== this._index) {
      if (next !== null && this._presence > 0) {
        // A wedge crossing, with the highlight already lit: sweep. Start from
        // wherever it actually is — a re-target mid-sweep must not snap back to
        // the wedge it was leaving — and aim at the nearest rotational equivalent
        // of the new wedge, so the move is one notch and never four.
        this._from = this._angle;
        this._to = nearestEquivalent(wedgeAngle(next, count), this._angle);
        this._t = 0;
      } else if (next !== null) {
        // Nothing was lit: the highlight ARRIVES on the new wedge and fades up
        // there. Sweeping in from a stale angle would animate a move the player
        // never made.
        this._from = wedgeAngle(next, count);
        this._to = this._from;
        this._angle = this._from;
        this._t = 1;
      }
      // `next === null` leaves the geometry exactly where it is, so the highlight
      // fades out on the wedge it was on rather than sliding off to somewhere.
      this._index = next;
    }

    const step = Number.isFinite(dt) && dt > 0 ? dt / SELECTION_SWEEP_SECONDS : 0;
    this._t = clamp01(this._t + step);
    this._angle = this._from + (this._to - this._from) * sweepEase(this._t);
    this._presence = clamp01(this._presence + (this._index === null ? -step : step));
  }

  /** Land on the current target with no in-between — the frozen-frame case
   *  (`?freeze=1`, where the clock does not advance so `dt` is always 0) and the
   *  goldens that shoot it. Only ever lands ON the target, so it cannot desync. */
  settle(): void {
    this._t = 1;
    this._angle = this._to;
    this._presence = this._index === null ? 0 : 1;
  }

  /** Forget the selection entirely — a hard context change (the wheel closed,
   *  the ship undocked, a rematch). Leaves a clean, re-selectable machine. */
  reset(): void {
    this._index = null;
    this._t = 1;
    this._presence = 0;
    this._crossed = false;
    this._angle = WHEEL_TOP;
    this._from = this._angle;
    this._to = this._angle;
  }
}

/** The rotational equivalent of `angle` nearest to `near` — the same direction on
 *  the wheel, expressed as the number closest to where the highlight already is.
 *  This, and only this, is what makes the wrap sweep one wedge instead of four. */
function nearestEquivalent(angle: number, near: number): number {
  const turn = 2 * Math.PI;
  return angle + Math.round((near - angle) / turn) * turn;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
