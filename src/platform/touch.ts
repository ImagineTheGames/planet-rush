/**
 * src/platform/touch.ts — dynamic twin virtual sticks. OWNER: Platform Engineer.
 *
 * Touch is a first-class input from day 1 (GDD §2.4, mobile amendment §2). Two
 * dynamic virtual sticks — one per screen half — appear under the thumb wherever
 * it lands rather than pinned to a fixed spot:
 *
 *  - **Left half:** always thrust / steer.
 *  - **Right half morphs with the fire-mode setting:**
 *      · **Manual** — an aim stick that *fires while engaged*: aim and fire are
 *        one gesture (your gun is your mining tool, GDD §2.3).
 *      · **Auto-aim** — the aim stick is replaced *entirely* by a hold-to-FIRE
 *        button: any touch on the right half fires, and no aim is sent.
 *
 * This module is pure geometry and state — it consumes abstract pointer samples
 * (`{ id, x, y }`), not DOM events, so it unit-tests headless and the DOM wiring
 * lives at the edge (see `input.ts` / `main.ts`). It writes into the same
 * device-neutral {@link ControlState} every other device does; the sim never
 * sees a device, and never sees a stick.
 */

import type { Vec2 } from '@shared/types';
import type { ControlState } from './actions';
import { FireMode } from './actions';

/** A device-neutral pointer sample (one active touch). */
export interface PointerSample {
  readonly id: number;
  /** Position in CSS pixels, origin top-left, y down (matches world y-down). */
  readonly x: number;
  readonly y: number;
}

/** Tuning for the virtual sticks. All in CSS pixels (except `doubleTapMs`). */
export interface TouchConfig {
  /** Screen width, used to split left/right halves. Update on resize. */
  screenWidth: number;
  /** Full-deflection radius: dragging this far from the origin yields |vec|=1. */
  maxRadius: number;
  /** Dead zone (px from origin) below which the stick reads neutral. */
  deadzone: number;
  /**
   * Milliseconds within which a second left-stick press after a release counts as
   * a **double-tap-and-hold** — the touch BOOST gesture (GDD §2.4, field report
   * v0.2.2): the thumb taps, then re-lands and holds on the same stick to boost,
   * so it never has to leave the movement side. Above this, the second press is
   * just a fresh grab and boost stays off.
   */
  doubleTapMs: number;
}

const DEFAULT_CONFIG: TouchConfig = {
  screenWidth: 1280,
  maxRadius: 64,
  deadzone: 8,
  doubleTapMs: 320,
};

/** Default clock for the double-tap window — `performance.now()` where present
 *  (browser), falling back to `Date.now()`. Injected via the constructor so the
 *  gesture unit-tests headless with a deterministic fake clock. */
const defaultNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/**
 * One dynamic virtual stick. Its origin is wherever the thumb first landed; the
 * output vector is (current − origin) clamped to `maxRadius` and normalized to
 * [-1, 1] per axis, with a dead zone near the origin.
 */
export class VirtualStick {
  /** The pointer currently driving this stick, or `null` when released. */
  pointerId: number | null = null;
  /** Where the thumb landed (stick base). Meaningless while released. */
  readonly origin: Vec2 = { x: 0, y: 0 };
  /** Where the thumb is now. */
  readonly current: Vec2 = { x: 0, y: 0 };

  constructor(private cfg: Pick<TouchConfig, 'maxRadius' | 'deadzone'>) {}

  /** Whether a thumb is on this stick. */
  get engaged(): boolean {
    return this.pointerId !== null;
  }

  press(sample: PointerSample): void {
    this.pointerId = sample.id;
    this.origin.x = sample.x;
    this.origin.y = sample.y;
    this.current.x = sample.x;
    this.current.y = sample.y;
  }

  move(sample: PointerSample): void {
    if (sample.id !== this.pointerId) return;
    this.current.x = sample.x;
    this.current.y = sample.y;
  }

  release(): void {
    this.pointerId = null;
  }

  /**
   * The stick's analog output in [-1, 1] per axis (screen space, y down). Zero
   * inside the dead zone. Magnitude is `min(dist, maxRadius) / maxRadius`, so a
   * light push accelerates less — analog steering, GDD §2.4.
   */
  output(out: Vec2): Vec2 {
    out.x = 0;
    out.y = 0;
    if (this.pointerId === null) return out;

    const dx = this.current.x - this.origin.x;
    const dy = this.current.y - this.origin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < this.cfg.deadzone || dist < 1e-9) return out;

    const clamped = Math.min(dist, this.cfg.maxRadius);
    const mag = clamped / this.cfg.maxRadius;
    out.x = (dx / dist) * mag;
    out.y = (dy / dist) * mag;
    return out;
  }
}

/**
 * Manages the twin dynamic sticks and the right-side fire-mode morph. Feed it
 * pointer events; call {@link writeInto} once per frame to fold touch state into
 * a {@link ControlState}.
 */
export class TouchController {
  readonly left: VirtualStick;
  readonly right: VirtualStick;

  /**
   * In Auto-aim the right half is a hold-to-FIRE *button*, not a stick: we track
   * only whether a pointer is down on the right half, ignoring its vector.
   */
  private rightButtonPointer: number | null = null;

  private mode: FireMode = FireMode.AutoAim; // touch default (GDD §2.4)
  private readonly cfg: TouchConfig;
  private readonly scratch: Vec2 = { x: 0, y: 0 };

  /** When the left stick was last released (clock ms). A fresh left press within
   *  `cfg.doubleTapMs` of this is a double-tap-and-hold → BOOST. `-Infinity` means
   *  "no recent release", so the very first press can never read as a double-tap. */
  private leftReleasedAt = -Infinity;
  /** Whether the current left-stick press is a held BOOST (a double-tap-and-hold).
   *  Set when the second press lands; cleared the moment that press releases, so
   *  boost is exactly the duration of the hold. */
  private leftBoost = false;

  constructor(
    config?: Partial<TouchConfig>,
    private readonly now: () => number = defaultNow,
  ) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.left = new VirtualStick(this.cfg);
    this.right = new VirtualStick(this.cfg);
  }

  /** Update on viewport resize so the half-split stays centered. */
  setScreenWidth(width: number): void {
    this.cfg.screenWidth = width;
  }

  /** Switch fire mode. Releasing any in-flight right-side gesture so the morph
   *  is clean (an aim-stick drag doesn't linger as a held FIRE, or vice versa). */
  setFireMode(mode: FireMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.right.release();
    this.rightButtonPointer = null;
  }

  getFireMode(): FireMode {
    return this.mode;
  }

  /**
   * Whether a thumb is currently holding the Auto-aim hold-to-FIRE button (the
   * right half in Auto-aim mode). Always `false` in Manual mode — there the
   * right side is the aim stick ({@link right}), not a button. The visuals layer
   * reads this to draw the FIRE button's pressed state (touch-visuals.ts).
   */
  get rightButtonEngaged(): boolean {
    return this.rightButtonPointer !== null;
  }

  /**
   * Whether the left stick is currently a held BOOST (double-tap-and-hold, GDD
   * §2.4). True only while the second, quickly-repeated press is down. The visuals
   * layer reads this to light the left stick's boost state (touch-visuals.ts), and
   * it is what {@link writeInto} folds into `ControlState.boost`.
   */
  get boostEngaged(): boolean {
    return this.leftBoost && this.left.engaged;
  }

  private isLeftHalf(x: number): boolean {
    return x < this.cfg.screenWidth / 2;
  }

  /** A new touch landed. Assigns it to the left stick, or to the right
   *  stick/FIRE button, by which half it landed in (dynamic — origin = landing
   *  point). A half already holding a pointer ignores a second touch there. */
  onPointerDown(sample: PointerSample): void {
    if (this.isLeftHalf(sample.x)) {
      if (!this.left.engaged) {
        // A quick re-press of the left stick after a release is the BOOST
        // gesture: double-tap-and-hold, thumb never leaving the movement side.
        this.leftBoost = this.now() - this.leftReleasedAt <= this.cfg.doubleTapMs;
        this.left.press(sample);
      }
      return;
    }
    // Right half.
    if (this.mode === FireMode.Manual) {
      if (!this.right.engaged) this.right.press(sample);
    } else if (this.rightButtonPointer === null) {
      this.rightButtonPointer = sample.id; // hold-to-FIRE
    }
  }

  onPointerMove(sample: PointerSample): void {
    this.left.move(sample);
    if (this.mode === FireMode.Manual) this.right.move(sample);
    // Auto-aim FIRE button has no vector — movement is irrelevant.
  }

  onPointerUp(id: number): void {
    if (this.left.pointerId === id) {
      // Remember when the left stick let go so a fast re-press reads as the BOOST
      // double-tap, and end any boost the held press had engaged.
      this.leftReleasedAt = this.now();
      this.leftBoost = false;
      this.left.release();
    }
    if (this.right.pointerId === id) this.right.release();
    if (this.rightButtonPointer === id) this.rightButtonPointer = null;
  }

  /** Drop all touches (e.g. on blur / visibility loss) so nothing sticks. */
  clear(): void {
    this.left.release();
    this.right.release();
    this.rightButtonPointer = null;
    // A blur is not a deliberate tap, so it must not seed a double-tap: forget the
    // last release and drop any live boost.
    this.leftBoost = false;
    this.leftReleasedAt = -Infinity;
  }

  /**
   * Fold the current touch state into `state` (GDD §2.4 — same neutral state
   * every device writes). Left stick → thrust; right side → aim+fire (Manual)
   * or fire-only (Auto-aim). Screen space is y-down, matching world y-down, so
   * the stick vector is the thrust/aim direction without a flip.
   */
  writeInto(state: ControlState): void {
    // Left stick → thrust, and → boost while it is a held double-tap (the thumb
    // still steers, so a boosting ship keeps flying where it is pointed).
    this.left.output(state.thrust);
    state.boost = this.boostEngaged;

    if (this.mode === FireMode.Manual) {
      // Right stick → aim, and firing while engaged (one gesture).
      const aim = this.right.output(this.scratch);
      if (aim.x !== 0 || aim.y !== 0) {
        state.aim = { x: aim.x, y: aim.y };
        state.fire = true;
      } else {
        state.aim = null;
        state.fire = false;
      }
    } else {
      // Auto-aim: no aim stick; the right half is a hold-to-FIRE button.
      state.aim = null;
      state.fire = this.rightButtonPointer !== null;
    }
  }
}
