/**
 * src/platform/touch-buttons.ts — the contextual touch buttons. OWNER: Platform
 * Engineer.
 *
 * `touch.ts` owns the twin dynamic sticks (thrust, aim/fire) — the always-present
 * movement surface. This owns the two *pressable* touch controls that close the
 * v0.2.2 input-parity gaps (docs/input-parity.md): the **BOOST** button (a
 * discoverable alternative to the left-stick double-tap-and-hold) and the **PING**
 * button (tap pings your position, drag pings a direction). The wheel's own
 * BUILD button lives with the wheel (`wheel-input.ts` / `main.ts`); these two are
 * held/gesture affordances that need pointer tracking of their own.
 *
 * Like the sticks, this is **pure geometry and state**: it consumes device-neutral
 * pointer samples (`{ id, x, y }`) against per-frame button rects the view hands
 * it, and it writes nothing device- or sim-specific. It does not know the ship's
 * world position, the camera, or the fire mode — a PING gesture leaves here as a
 * device-neutral {@link PingRequest} (tap, or a unit drag direction), and `main.ts`
 * anchors it on the local ship to produce the world-space `ping` action the sim
 * consumes. That keeps this module headless-testable and the sim seam clean (the
 * sim never sees a device; neither does this).
 *
 * BOOST is a **hold**: down engages, up releases. PING is a **tap-or-drag resolved
 * on release**: a press that barely moves pings your own position; a press dragged
 * past {@link PING_TAP_MAX_PX} pings the drag direction. Both are one-pointer
 * controls — a second touch on the same button while it is held is ignored.
 */

import type { PointerSample } from './touch';
import type { Rect } from './layout-registry';

/** Below this drag distance (CSS px) a PING press is a *tap* — ping your own
 *  position — rather than a *direction* drag. Generous, so a thumb that wobbles on
 *  a tap still reads as "ping here". TUNABLE. */
export const PING_TAP_MAX_PX = 16;

/**
 * What a resolved PING gesture asks for, device- and sim-neutral. `main.ts` turns
 * it into the `ping` action's world-space `at` by anchoring on the local ship:
 * a tap pings the ship's own position, a drag pings a point offset from the ship
 * in `dir` (the alarm-arrow language in reverse, GDD §2.4).
 */
export interface PingRequest {
  /** Whether the gesture was a bare tap (ping own position) rather than a drag. */
  readonly tap: boolean;
  /** Unit drag direction (screen space, y-down — matches world y-down), or the
   *  zero vector for a tap. Consumed by `main.ts`, never by the sim. */
  readonly dir: { x: number; y: number };
}

/** Whether a point (CSS px) is inside a rect — local so this module needs nothing
 *  from `main.ts`, which has its own copy for the wheel/BUILD hit tests. */
function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

/**
 * The contextual touch buttons' pointer state. Feed it the button rects each frame
 * ({@link setRects}) and route pointer events through {@link tryPress} /
 * {@link onMove} / {@link onUp}; read {@link boostHeld} once per frame and drain
 * {@link takePing} for a one-shot ping.
 */
export class TouchButtons {
  private boostRect: Rect | null = null;
  private pingRect: Rect | null = null;

  private boostPointer: number | null = null;

  private pingPointer: number | null = null;
  private readonly pingOrigin = { x: 0, y: 0 };
  private readonly pingCurrent = { x: 0, y: 0 };
  /** A ping resolved on release, awaiting a single drain by {@link takePing}. */
  private pendingPing: PingRequest | null = null;

  /**
   * Set the buttons' hit rects for this frame — the very rects the view draws
   * ({@link ./touch-visuals}), so a press can only land on a button that is
   * actually on screen. `null` hides a button (and makes it un-pressable).
   */
  setRects(boost: Rect | null, ping: Rect | null): void {
    this.boostRect = boost;
    this.pingRect = ping;
  }

  /** Whether the BOOST button is currently held. Folded into `ControlState.boost`
   *  by `main.ts` (OR-ed with the left-stick double-tap-and-hold). */
  get boostHeld(): boolean {
    return this.boostPointer !== null;
  }

  /** Whether the PING button has a live press on it (for the view's pressed state). */
  get pingPressed(): boolean {
    return this.pingPointer !== null;
  }

  /**
   * Try to claim a fresh touch for a button. Returns which button it landed on, or
   * `null` if it hit neither — in which case `main.ts` lets the twin sticks have
   * it. A button already holding a pointer ignores a second touch (returns `null`
   * so the sticks still can't have it *there* either — but there is no stick under
   * a button, so this is simply "one pointer per button").
   */
  tryPress(sample: PointerSample): 'boost' | 'ping' | null {
    if (this.boostRect && this.boostPointer === null && inRect(sample.x, sample.y, this.boostRect)) {
      this.boostPointer = sample.id;
      return 'boost';
    }
    if (this.pingRect && this.pingPointer === null && inRect(sample.x, sample.y, this.pingRect)) {
      this.pingPointer = sample.id;
      this.pingOrigin.x = sample.x;
      this.pingOrigin.y = sample.y;
      this.pingCurrent.x = sample.x;
      this.pingCurrent.y = sample.y;
      return 'ping';
    }
    return null;
  }

  /** Track a moving pointer. Only the PING drag cares where the thumb goes; BOOST
   *  is a pure hold. Ignores pointers that aren't the one driving the PING press. */
  onMove(sample: PointerSample): void {
    if (sample.id === this.pingPointer) {
      this.pingCurrent.x = sample.x;
      this.pingCurrent.y = sample.y;
    }
  }

  /**
   * A pointer lifted. BOOST releases (hold ends). A PING press resolves here — into
   * a tap (barely moved) or a direction drag — and is queued one-shot for
   * {@link takePing}. Ignores ids that aren't driving either button.
   */
  onUp(id: number): void {
    if (id === this.boostPointer) this.boostPointer = null;
    if (id === this.pingPointer) {
      this.pendingPing = this.resolvePing();
      this.pingPointer = null;
    }
  }

  /** Drop all presses (blur / visibility loss) so nothing sticks. Any half-made
   *  ping gesture is discarded rather than fired — a blur is not a commit. */
  clear(): void {
    this.boostPointer = null;
    this.pingPointer = null;
    this.pendingPing = null;
  }

  /** Drain the ping resolved this frame, if any (one-shot). */
  takePing(): PingRequest | null {
    const p = this.pendingPing;
    this.pendingPing = null;
    return p;
  }

  /** Resolve the current PING press into a tap or a unit-direction drag. */
  private resolvePing(): PingRequest {
    const dx = this.pingCurrent.x - this.pingOrigin.x;
    const dy = this.pingCurrent.y - this.pingOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < PING_TAP_MAX_PX || dist < 1e-9) {
      return { tap: true, dir: { x: 0, y: 0 } };
    }
    return { tap: false, dir: { x: dx / dist, y: dy / dist } };
  }
}
