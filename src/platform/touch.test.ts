/**
 * Touch twin-stick unit tests (GDD §2.4, mobile amendment §2). Pure geometry and
 * state — pointer samples in, control state out — so it runs headless. The two
 * load-bearing checks: a touch-stick vector becomes a thrust action, and the
 * fire-mode switch swaps the right-side bindings (aim-stick-that-fires ⇄
 * hold-to-FIRE button).
 */
import { describe, it, expect } from 'vitest';
import { TouchController, VirtualStick } from './touch';
import type { PointerSample } from './touch';
import { FireMode, createControlState, mapActions } from './actions';

const CFG = { screenWidth: 1000, maxRadius: 64, deadzone: 8 };

function down(id: number, x: number, y: number): PointerSample {
  return { id, x, y };
}

describe('VirtualStick — dynamic origin + analog output', () => {
  it('sets its origin where the thumb lands (dynamic, not pinned)', () => {
    const stick = new VirtualStick(CFG);
    stick.press(down(1, 137, 421));
    expect(stick.engaged).toBe(true);
    expect(stick.origin).toEqual({ x: 137, y: 421 });
  });

  it('outputs a full-magnitude unit vector at the deflection radius', () => {
    const stick = new VirtualStick(CFG);
    stick.press(down(1, 100, 300));
    stick.move(down(1, 164, 300)); // +64px in x == maxRadius
    const out = stick.output({ x: 0, y: 0 });
    expect(out.x).toBeCloseTo(1, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });

  it('scales magnitude analog below the radius', () => {
    const stick = new VirtualStick(CFG);
    stick.press(down(1, 100, 300));
    stick.move(down(1, 132, 300)); // +32px == half radius
    const out = stick.output({ x: 0, y: 0 });
    expect(out.x).toBeCloseTo(0.5, 6);
  });

  it('clamps magnitude to 1 past the radius', () => {
    const stick = new VirtualStick(CFG);
    stick.press(down(1, 100, 300));
    stick.move(down(1, 300, 300)); // way past maxRadius
    const out = stick.output({ x: 0, y: 0 });
    expect(out.x).toBeCloseTo(1, 6);
  });

  it('reads neutral inside the dead zone', () => {
    const stick = new VirtualStick(CFG);
    stick.press(down(1, 100, 300));
    stick.move(down(1, 104, 300)); // 4px < 8px deadzone
    expect(stick.output({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('ignores moves from a different pointer id', () => {
    const stick = new VirtualStick(CFG);
    stick.press(down(1, 100, 300));
    stick.move(down(2, 300, 300));
    expect(stick.output({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('TouchController — left half → thrust action (GDD §2.4)', () => {
  it('a left-half stick vector becomes the thrust action', () => {
    const tc = new TouchController(CFG);
    tc.onPointerDown(down(1, 100, 300)); // left half (x < 500)
    tc.onPointerMove(down(1, 164, 364)); // +64,+64

    const state = createControlState();
    tc.writeInto(state);

    // Screen y-down matches world y-down, so the vector maps straight through.
    expect(state.thrust.x).toBeCloseTo(Math.SQRT1_2, 4);
    expect(state.thrust.y).toBeCloseTo(Math.SQRT1_2, 4);

    const actions = mapActions(state, FireMode.AutoAim);
    const thrust = actions.find((a) => a.type === 'thrust');
    expect(thrust).toMatchObject({ type: 'thrust' });
    expect((thrust as { dir: { x: number; y: number } }).dir.x).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('assigns pointers to sticks by which half they land in', () => {
    const tc = new TouchController(CFG);
    tc.setFireMode(FireMode.Manual); // so the right half is a stick
    tc.onPointerDown(down(1, 120, 300)); // left
    tc.onPointerDown(down(2, 880, 300)); // right
    expect(tc.left.pointerId).toBe(1);
    expect(tc.right.pointerId).toBe(2);
  });
});

describe('TouchController — the fire-mode morph (GDD §2.4)', () => {
  it('Manual: the right stick aims and fires while engaged', () => {
    const tc = new TouchController(CFG);
    tc.setFireMode(FireMode.Manual);
    tc.onPointerDown(down(1, 800, 300)); // right half
    tc.onPointerMove(down(1, 800, 236)); // drag up 64px

    const state = createControlState();
    tc.writeInto(state);
    expect(state.fire).toBe(true);
    expect(state.aim).not.toBeNull();
    expect(state.aim?.y).toBeCloseTo(-1, 4);

    // Manual → the aim action is emitted.
    expect(mapActions(state, FireMode.Manual).some((a) => a.type === 'aim')).toBe(true);
  });

  it('Manual: a right-half touch that never leaves the dead zone does NOT fire', () => {
    const tc = new TouchController(CFG);
    tc.setFireMode(FireMode.Manual);
    tc.onPointerDown(down(1, 800, 300)); // pressed, but not dragged

    const state = createControlState();
    tc.writeInto(state);
    expect(state.fire).toBe(false);
    expect(state.aim).toBeNull();
  });

  it('Auto-aim: the right half is a hold-to-FIRE button — a bare touch fires, no aim', () => {
    const tc = new TouchController(CFG);
    tc.setFireMode(FireMode.AutoAim);
    tc.onPointerDown(down(1, 800, 300)); // bare press, no drag

    const state = createControlState();
    tc.writeInto(state);
    expect(state.fire).toBe(true); // fires without any drag — button semantics
    expect(state.aim).toBeNull();

    // Auto-aim → no aim action, fire flagged auto.
    const actions = mapActions(state, FireMode.AutoAim);
    expect(actions.some((a) => a.type === 'aim')).toBe(false);
    expect(actions.find((a) => a.type === 'fire')).toMatchObject({ auto: true });
  });

  it('the same bare right-half touch means nothing in Manual but fires in Auto-aim (the swap)', () => {
    const gesture = down(1, 800, 300);

    const manual = new TouchController(CFG);
    manual.setFireMode(FireMode.Manual);
    manual.onPointerDown(gesture);
    const ms = createControlState();
    manual.writeInto(ms);

    const auto = new TouchController(CFG);
    auto.setFireMode(FireMode.AutoAim);
    auto.onPointerDown(gesture);
    const as = createControlState();
    auto.writeInto(as);

    expect(ms.fire).toBe(false);
    expect(as.fire).toBe(true);
  });

  it('switching mode mid-gesture releases the stale right-side touch', () => {
    const tc = new TouchController(CFG);
    tc.setFireMode(FireMode.Manual);
    tc.onPointerDown(down(1, 800, 300));
    tc.onPointerMove(down(1, 800, 236));
    tc.setFireMode(FireMode.AutoAim); // morph

    const state = createControlState();
    tc.writeInto(state);
    // The old aim-stick pointer must not linger as a held FIRE.
    expect(state.fire).toBe(false);
  });

  it('left thrust is unaffected by the right-side fire mode', () => {
    for (const mode of [FireMode.Manual, FireMode.AutoAim]) {
      const tc = new TouchController(CFG);
      tc.setFireMode(mode);
      tc.onPointerDown(down(1, 100, 300));
      tc.onPointerMove(down(1, 164, 300));
      const state = createControlState();
      tc.writeInto(state);
      expect(state.thrust.x).toBeCloseTo(1, 4);
    }
  });
});

describe('TouchController — release + clear', () => {
  it('releases the correct stick on pointer up', () => {
    const tc = new TouchController(CFG);
    tc.setFireMode(FireMode.Manual);
    tc.onPointerDown(down(1, 120, 300));
    tc.onPointerDown(down(2, 880, 300));
    tc.onPointerUp(1);
    expect(tc.left.engaged).toBe(false);
    expect(tc.right.engaged).toBe(true);
  });

  it('clear() drops all touches so nothing sticks on blur', () => {
    const tc = new TouchController(CFG);
    tc.onPointerDown(down(1, 120, 300));
    tc.onPointerDown(down(2, 880, 300));
    tc.clear();
    const state = createControlState();
    tc.writeInto(state);
    expect(state.thrust).toEqual({ x: 0, y: 0 });
    expect(state.fire).toBe(false);
  });
});
