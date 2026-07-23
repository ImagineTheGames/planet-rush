/**
 * DOM touch-edge unit tests (GDD §2.4, mobile amendment §2). Guards the wiring
 * that turns raw pointer events into the sim's thrust — the seam the M2
 * "touch-drag truth" investigation isolated: a synthetic drag DID reach the
 * ship; the old test just steered it into empty vacuum. These lock in the three
 * things that edge must never regress, in the fast unit suite (every push), not
 * only the CI-only Playwright pixel test:
 *
 *   1. a `pointerType:'touch'` drag becomes a non-zero thrust action;
 *   2. mouse/pen pointers are ignored (they are the keyboard-mouse source's);
 *   3. `clientX/Y` are passed through as-is (CSS px), so the left/right split
 *      is not misplaced by the device pixel ratio; and release paths clear.
 */
import { describe, it, expect } from 'vitest';
import { bindTouchControls } from './touch-dom';
import type { PointerLike } from './touch-dom';
import { TouchController } from './touch';
import { FireMode, createControlState, mapActions } from './actions';

/** A fake EventTarget that records handlers so the test can dispatch into them,
 *  standing in for the canvas and the window. */
function fakeTarget() {
  const handlers = new Map<string, ((e: never) => void)[]>();
  return {
    addEventListener(type: string, listener: (e: never) => void): void {
      const list = handlers.get(type) ?? [];
      list.push(listener);
      handlers.set(type, list);
    },
    removeEventListener(type: string, listener: (e: never) => void): void {
      const list = handlers.get(type);
      if (list) handlers.set(type, list.filter((l) => l !== listener));
    },
    /** Dispatch a synthetic event to every handler bound for `type`. */
    emit(type: string, e: unknown): void {
      for (const l of handlers.get(type) ?? []) (l as (e: unknown) => void)(e);
    },
    count(type: string): number {
      return (handlers.get(type) ?? []).length;
    },
  };
}

function touchEvt(id: number, x: number, y: number): PointerLike {
  return { pointerType: 'touch', pointerId: id, clientX: x, clientY: y };
}

/** The controller's screen is 400px wide, so the left half is x < 200. */
const SCREEN_WIDTH = 400;

function setup() {
  const canvas = fakeTarget();
  const win = fakeTarget();
  const touch = new TouchController({ screenWidth: SCREEN_WIDTH, maxRadius: 64, deadzone: 8 });
  touch.setFireMode(FireMode.AutoAim); // touch default
  const dispose = bindTouchControls(canvas, touch, win);
  const state = createControlState();
  return { canvas, win, touch, dispose, state };
}

describe('bindTouchControls — pointer events into the twin sticks', () => {
  it('a left-half touch drag produces a non-zero thrust action (input crosses into the sim)', () => {
    const { canvas, touch, state } = setup();

    // Thumb lands in the left half, drags left past the deflection radius.
    canvas.emit('pointerdown', touchEvt(1, 150, 300));
    canvas.emit('pointermove', touchEvt(1, 20, 300)); // −130px in x, well past maxRadius

    touch.writeInto(state);
    const actions = mapActions(state, FireMode.AutoAim);
    const thrust = actions.find((a) => a.type === 'thrust');

    expect(thrust).toBeDefined();
    // Full leftward deflection: −1 on x, ~0 on y — the exact vector the sim
    // integrates into ship velocity (verified end-to-end via ?debug=1).
    expect(thrust && thrust.type === 'thrust' && thrust.dir.x).toBeCloseTo(-1, 6);
    expect(thrust && thrust.type === 'thrust' && thrust.dir.y).toBeCloseTo(0, 6);
    expect(touch.left.engaged).toBe(true);
  });

  it('passes clientX/clientY straight through (CSS px, no dpr scaling of the split)', () => {
    const { canvas, touch } = setup();
    // A touch at x=150 is in the left half (x < 200). Were clientX multiplied by
    // a device pixel ratio (e.g. ×3 → 450), it would land in the right half and
    // drive the FIRE button instead — the dpr coordinate bug this guards against.
    canvas.emit('pointerdown', touchEvt(7, 150, 300));
    expect(touch.left.engaged).toBe(true);
    expect(touch.left.origin).toEqual({ x: 150, y: 300 });
    expect(touch.rightButtonEngaged).toBe(false);
  });

  it('ignores mouse and pen pointers (those are the keyboard-mouse source)', () => {
    const { canvas, touch, state } = setup();

    canvas.emit('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 150, clientY: 300 });
    canvas.emit('pointermove', { pointerType: 'pen', pointerId: 2, clientX: 20, clientY: 300 });

    touch.writeInto(state);
    expect(touch.left.engaged).toBe(false);
    expect(state.thrust).toEqual({ x: 0, y: 0 });
  });

  it('right-half touch in Auto-aim holds FIRE, not thrust', () => {
    const { canvas, touch, state } = setup();
    canvas.emit('pointerdown', touchEvt(1, 300, 500)); // right half (x > 200)
    touch.writeInto(state);
    const fire = mapActions(state, FireMode.AutoAim).find((a) => a.type === 'fire');
    expect(fire && fire.type === 'fire' && fire.active).toBe(true);
    expect(touch.left.engaged).toBe(false);
  });

  it('releases on pointerup and pointercancel so no stick sticks down', () => {
    const { canvas, touch } = setup();

    canvas.emit('pointerdown', touchEvt(1, 150, 300));
    expect(touch.left.engaged).toBe(true);
    canvas.emit('pointerup', touchEvt(1, 20, 300));
    expect(touch.left.engaged).toBe(false);

    canvas.emit('pointerdown', touchEvt(2, 150, 300));
    expect(touch.left.engaged).toBe(true);
    canvas.emit('pointercancel', touchEvt(2, 20, 300));
    expect(touch.left.engaged).toBe(false);
  });

  it('window blur clears every active touch', () => {
    const { canvas, win, touch } = setup();
    canvas.emit('pointerdown', touchEvt(1, 150, 300)); // left stick
    canvas.emit('pointerdown', touchEvt(2, 300, 500)); // right FIRE
    expect(touch.left.engaged).toBe(true);
    expect(touch.rightButtonEngaged).toBe(true);

    win.emit('blur', undefined);
    expect(touch.left.engaged).toBe(false);
    expect(touch.rightButtonEngaged).toBe(false);
  });

  it('dispose detaches every listener', () => {
    const { canvas, win, touch, dispose, state } = setup();
    dispose();

    // Post-dispose events must not reach the controller.
    canvas.emit('pointerdown', touchEvt(1, 150, 300));
    canvas.emit('pointermove', touchEvt(1, 20, 300));
    touch.writeInto(state);
    expect(touch.left.engaged).toBe(false);
    expect(state.thrust).toEqual({ x: 0, y: 0 });
    expect(canvas.count('pointerdown')).toBe(0);
    expect(win.count('blur')).toBe(0);
  });
});
