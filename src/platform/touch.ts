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

/** Tuning for the virtual sticks. All in CSS pixels. */
export interface TouchConfig {
  /** Screen width, used to split left/right halves. Update on resize. */
  screenWidth: number;
  /** Full-deflection radius: dragging this far from the origin yields |vec|=1. */
  maxRadius: number;
  /** Dead zone (px from origin) below which the stick reads neutral. */
  deadzone: number;
}

const DEFAULT_CONFIG: TouchConfig = {
  screenWidth: 1280,
  maxRadius: 64,
  deadzone: 8,
};

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

  constructor(private cfg: TouchConfig) {}

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

  constructor(config?: Partial<TouchConfig>) {
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

  private isLeftHalf(x: number): boolean {
    return x < this.cfg.screenWidth / 2;
  }

  /** A new touch landed. Assigns it to the left stick, or to the right
   *  stick/FIRE button, by which half it landed in (dynamic — origin = landing
   *  point). A half already holding a pointer ignores a second touch there. */
  onPointerDown(sample: PointerSample): void {
    if (this.isLeftHalf(sample.x)) {
      if (!this.left.engaged) this.left.press(sample);
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
    if (this.left.pointerId === id) this.left.release();
    if (this.right.pointerId === id) this.right.release();
    if (this.rightButtonPointer === id) this.rightButtonPointer = null;
  }

  /** Drop all touches (e.g. on blur / visibility loss) so nothing sticks. */
  clear(): void {
    this.left.release();
    this.right.release();
    this.rightButtonPointer = null;
  }

  /**
   * Fold the current touch state into `state` (GDD §2.4 — same neutral state
   * every device writes). Left stick → thrust; right side → aim+fire (Manual)
   * or fire-only (Auto-aim). Screen space is y-down, matching world y-down, so
   * the stick vector is the thrust/aim direction without a flip.
   */
  writeInto(state: ControlState): void {
    // Left stick → thrust.
    this.left.output(state.thrust);

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
