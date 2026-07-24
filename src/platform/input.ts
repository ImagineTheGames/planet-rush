/**
 * src/platform/input.ts — device input sources. OWNER: Platform Engineer.
 *
 * Keyboard/mouse and gamepad each fold their raw state into the device-neutral
 * {@link ControlState} (GDD §2.4), exactly as `touch.ts` does for the virtual
 * sticks. `mapActions` (actions.ts) then turns that one state into the abstract
 * `Action[]` the sim consumes — the sim never sees a device.
 *
 * The DOM listeners live here at the edge; the mapping logic they feed is pure
 * (actions.ts / touch.ts) and headless-testable. This file references browser
 * globals only inside method bodies, so it is import-safe under any tsconfig but
 * is only ever constructed in the browser.
 */

import type { Vec2 } from '@shared/types';
import type { ControlState } from './actions';

/** A device that contributes to the shared control state each frame. */
export interface InputSource {
  /** Fold this device's current state into `state`. Called once per frame. */
  update(state: ControlState): void;
  /** Detach listeners / release resources. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Keyboard + mouse (GDD §2.4: WASD, mouse aim, LMB fire, E build, Space boost)
// ---------------------------------------------------------------------------

/** Provides the ship's current screen position so mouse aim is relative to it.
 *  The camera centers the local ship, so this is the canvas center by default. */
export type ScreenCenterFn = () => Vec2;

export class KeyboardMouseSource implements InputSource {
  private readonly keys = new Set<string>();
  private readonly mouse: Vec2 = { x: 0, y: 0 };
  private firing = false;
  private pingRequest: Vec2 | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.firing = true;
    if (e.button === 1) this.pingRequest = { x: e.clientX, y: e.clientY };
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.firing = false;
  };
  private readonly onBlur = (): void => {
    this.keys.clear();
    this.firing = false;
  };

  constructor(
    private readonly center: ScreenCenterFn,
    private readonly target: Window = window,
  ) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('blur', this.onBlur);
  }

  update(state: ControlState): void {
    // WASD → thrust (screen space, y-down, matching world y-down).
    let tx = 0;
    let ty = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) tx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) tx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ty -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ty += 1;
    // Normalize the diagonal so keyboard corners don't exceed the analog disc.
    if (tx !== 0 && ty !== 0) {
      const inv = 1 / Math.SQRT2;
      tx *= inv;
      ty *= inv;
    }
    state.thrust.x = tx;
    state.thrust.y = ty;

    // Mouse aim relative to the (centered) ship. Manual mode uses it; the mapper
    // drops it in Auto-aim.
    const c = this.center();
    const ax = this.mouse.x - c.x;
    const ay = this.mouse.y - c.y;
    state.aim = ax !== 0 || ay !== 0 ? { x: ax, y: ay } : null;

    state.fire = this.firing;
    state.boost = this.keys.has('Space') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    state.build = this.keys.has('KeyE');

    if (this.pingRequest) {
      state.ping = this.pingRequest;
      this.pingRequest = null;
    }
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    this.target.removeEventListener('mouseup', this.onMouseUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

// ---------------------------------------------------------------------------
// Gamepad (GDD §2.4: left stick, right stick aim, RT fire, LT boost, Y build)
// ---------------------------------------------------------------------------

const STICK_DEADZONE = 0.2;
const TRIGGER_THRESHOLD = 0.4;

/** Snapshot of the connected pads this frame. The browser default reads the live
 *  {@link navigator.getGamepads} array; tests inject a fake so the mapping is
 *  unit-verified headless (the sim never sees a device; neither need the tests). */
export type GamepadProvider = () => readonly (Gamepad | null)[];

const liveGamepads: GamepadProvider = () =>
  typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];

/**
 * Reads the active gamepad via the browser Gamepad API (GDD §2.4 — not on the
 * cut list) and folds it into the shared {@link ControlState}, exactly as the
 * keyboard and touch sources do.
 *
 * It **scans for the first connected pad** rather than assuming slot 0: browsers
 * assign a pad's index lazily on first input and it varies by device and port,
 * so a controller plugged into a later slot still drives the ship. Pass an
 * explicit `preferredIndex` to pin one pad (e.g. a future two-player split).
 */
export class GamepadSource implements InputSource {
  constructor(
    private readonly getPads: GamepadProvider = liveGamepads,
    private readonly preferredIndex: number | null = null,
  ) {}

  /** The active pad: the pinned index if requested, else the first pad the
   *  browser reports as connected. `null` when no pad is present (poll is inert). */
  private pad(): Gamepad | null {
    const pads = this.getPads();
    if (this.preferredIndex !== null) {
      const pinned = pads[this.preferredIndex];
      return pinned && pinned.connected ? pinned : null;
    }
    for (const p of pads) {
      if (p && p.connected) return p;
    }
    return null;
  }

  update(state: ControlState): void {
    const pad = this.pad();
    if (!pad) return;

    const ax = deadzone(pad.axes[0] ?? 0);
    const ay = deadzone(pad.axes[1] ?? 0);
    state.thrust.x = ax;
    state.thrust.y = ay;

    const rx = deadzone(pad.axes[2] ?? 0);
    const ry = deadzone(pad.axes[3] ?? 0);
    state.aim = rx !== 0 || ry !== 0 ? { x: rx, y: ry } : null;

    // Right trigger fires; standard mapping puts triggers on buttons 6 (LT) / 7 (RT).
    state.fire = buttonValue(pad, 7) > TRIGGER_THRESHOLD;
    state.boost = buttonValue(pad, 6) > TRIGGER_THRESHOLD;
    state.build = buttonPressed(pad, 3); // Y / Triangle
  }

  dispose(): void {
    // Stateless polling — nothing to detach.
  }
}

function deadzone(v: number): number {
  return Math.abs(v) < STICK_DEADZONE ? 0 : v;
}

function buttonValue(pad: Gamepad, i: number): number {
  return pad.buttons[i]?.value ?? 0;
}

function buttonPressed(pad: Gamepad, i: number): boolean {
  return pad.buttons[i]?.pressed ?? false;
}
