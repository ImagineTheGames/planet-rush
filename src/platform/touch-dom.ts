/**
 * src/platform/touch-dom.ts — the DOM edge for touch. OWNER: Platform Engineer.
 *
 * The one place raw pointer events become the device-neutral pointer samples the
 * {@link TouchController} consumes. It is deliberately thin — filter, decode,
 * route — but it is exactly the seam where touch input can silently fail to
 * cross into the sim, so it is factored out of `main.ts`'s `boot()` closure to be
 * unit-testable headless (the twin-stick geometry in `touch.ts` already is; this
 * makes its DOM wiring so too).
 *
 * Three things it must get right, each a real bug we have paid for:
 *
 *  1. **Pointer type filter.** We bind `pointer*` (not `touch*`) events because
 *     one code path then serves mouse, pen and touch — but only `touch` pointers
 *     drive the virtual sticks; mouse/pen are the keyboard-mouse source's job.
 *     A `pointerType !== 'touch'` guard on every handler keeps them separate.
 *     (Playwright's `hasTouch` CDP emulation surfaces synthetic drags as
 *     `pointerType:'touch'`, so the emulation suite exercises this exact path.)
 *  2. **Coordinate space.** Samples are CSS pixels (`clientX/Y`), the same space
 *     the controller's half-split (`screenWidth`) lives in — which is Pixi's
 *     `app.screen.width` under `autoDensity`, *not* the device-pixel backing
 *     store. Mixing the two would misplace the left/right split by the device
 *     pixel ratio (3× on the test iPhone). We pass `clientX/Y` straight through.
 *  3. **Implicit pointer capture / release.** Touch pointers capture to the
 *     `pointerdown` target, so `pointermove`/`up` arrive on the canvas even if
 *     the thumb slides off it; `pointercancel` (gesture stolen by the browser)
 *     and window `blur` (tab/app switch) both release, so nothing sticks down.
 */

import type { TouchController } from './touch';

/**
 * The structural subset of `PointerEvent` this edge reads. Narrowing to these
 * four fields lets the wiring be driven by plain objects in a unit test — no DOM
 * — while a real `PointerEvent` satisfies it unchanged.
 */
export interface PointerLike {
  readonly pointerType: string;
  readonly pointerId: number;
  /** CSS pixels, origin top-left, y-down — same space as the stick geometry. */
  readonly clientX: number;
  readonly clientY: number;
}

/** A target we can attach pointer handlers to (a canvas in production, a fake in
 *  tests). Structurally satisfied by any `EventTarget`. */
export interface PointerTarget {
  addEventListener(type: string, listener: (e: PointerLike) => void): void;
  removeEventListener(type: string, listener: (e: PointerLike) => void): void;
}

/** A target we can attach a `blur` handler to (a window in production). */
export interface BlurTarget {
  addEventListener(type: 'blur', listener: () => void): void;
  removeEventListener(type: 'blur', listener: () => void): void;
}

/**
 * Route a canvas's touch pointer events into the twin-stick controller. Returns
 * a disposer that detaches every listener (symmetry with `InputSource.dispose`).
 *
 * @param canvas  the element the sticks own the gestures on (its `touchAction`
 *                should be `none` so the browser never steals the drag).
 * @param touch   the controller to feed device-neutral samples into.
 * @param blurSrc where a focus-loss "release everything" comes from (window).
 */
export function bindTouchControls(
  canvas: PointerTarget,
  touch: TouchController,
  blurSrc: BlurTarget,
): () => void {
  const down = (e: PointerLike): void => {
    if (e.pointerType !== 'touch') return;
    touch.onPointerDown({ id: e.pointerId, x: e.clientX, y: e.clientY });
  };
  const move = (e: PointerLike): void => {
    if (e.pointerType !== 'touch') return;
    touch.onPointerMove({ id: e.pointerId, x: e.clientX, y: e.clientY });
  };
  const up = (e: PointerLike): void => {
    if (e.pointerType !== 'touch') return;
    touch.onPointerUp(e.pointerId);
  };
  const clear = (): void => touch.clear();

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  blurSrc.addEventListener('blur', clear);

  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    blurSrc.removeEventListener('blur', clear);
  };
}
