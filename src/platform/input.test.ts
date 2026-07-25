/**
 * Device input-source tests (GDD §2.4). Each device folds its raw state into the
 * device-neutral {@link ControlState}; the sim never sees a device, and neither
 * do these tests — the gamepad pad array and the keyboard/mouse event target are
 * both injected, so the mapping is verified headless.
 *
 * The gamepad path is the brief's end-to-end target: standard-mapping axes and
 * buttons → thrust / aim / fire / boost / build, with the analog deadzone and
 * trigger threshold that keep a resting stick from creeping (GDD §2.4).
 */
import { describe, it, expect } from 'vitest';
import { GamepadSource, KeyboardMouseSource } from './input';
import type { GamepadProvider, ScreenCenterFn } from './input';
import { createControlState } from './actions';

// ---------------------------------------------------------------------------
// Gamepad fakes — a minimal standard-mapping pad (17 buttons, 4 axes).
// ---------------------------------------------------------------------------

interface FakePadInit {
  axes?: number[];
  /** button index → value in [0,1]; pressed is derived as value > 0.5. */
  buttons?: Record<number, number>;
  connected?: boolean;
}

function fakePad(init: FakePadInit = {}): Gamepad {
  const axes = [0, 0, 0, 0];
  (init.axes ?? []).forEach((v, i) => (axes[i] = v));
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = init.buttons?.[i] ?? 0;
    return { value, pressed: value > 0.5, touched: value > 0 };
  });
  return {
    axes,
    buttons,
    connected: init.connected ?? true,
    id: 'fake-standard',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

/** A pad provider returning a fixed snapshot each poll. */
function pads(...list: (Gamepad | null)[]): GamepadProvider {
  return () => list;
}

// Standard-mapping button indices used below (GDD §2.4 gamepad column).
const BTN_Y = 3;
const BTN_LT = 6;
const BTN_RT = 7;

describe('GamepadSource — folds a standard pad into ControlState (GDD §2.4)', () => {
  it('maps the left stick to thrust and the right stick to aim', () => {
    const src = new GamepadSource(pads(fakePad({ axes: [0.8, -0.6, -1, 0.5] })));
    const state = createControlState();
    src.update(state);
    expect(state.thrust).toEqual({ x: 0.8, y: -0.6 });
    expect(state.aim).toEqual({ x: -1, y: 0.5 });
  });

  it('applies the deadzone so a resting/creeping stick reads as neutral', () => {
    const src = new GamepadSource(pads(fakePad({ axes: [0.1, -0.15, 0.05, 0.19] })));
    const state = createControlState();
    src.update(state);
    expect(state.thrust).toEqual({ x: 0, y: 0 });
    // Right stick inside the deadzone on both axes → not aiming this frame.
    expect(state.aim).toBeNull();
  });

  it('fires on the right trigger past threshold, boosts on the left', () => {
    const state = createControlState();
    new GamepadSource(pads(fakePad({ buttons: { [BTN_RT]: 0.5, [BTN_LT]: 0.6 } }))).update(state);
    expect(state.fire).toBe(true);
    expect(state.boost).toBe(true);
  });

  it('leaves fire off when the trigger is only feathered below threshold', () => {
    const state = createControlState();
    new GamepadSource(pads(fakePad({ buttons: { [BTN_RT]: 0.3 } }))).update(state);
    expect(state.fire).toBe(false);
  });

  it('opens Build & Upgrade on Y / Triangle', () => {
    const state = createControlState();
    new GamepadSource(pads(fakePad({ buttons: { [BTN_Y]: 1 } }))).update(state);
    expect(state.build).toBe(true);
  });

  it('leaves the state untouched when no pad is connected (inert poll)', () => {
    const state = createControlState();
    state.thrust.x = 0.42; // pretend another device wrote this first
    new GamepadSource(pads(null, null)).update(state);
    expect(state.thrust.x).toBe(0.42);
  });

  it('scans past empty slots to the first connected pad (index is not assumed 0)', () => {
    // Real browsers hand a pad a non-zero index; slot 0 stays null.
    const src = new GamepadSource(pads(null, fakePad({ axes: [1, 0] })));
    const state = createControlState();
    src.update(state);
    expect(state.thrust).toEqual({ x: 1, y: 0 });
  });

  it('ignores a present-but-disconnected pad', () => {
    const src = new GamepadSource(pads(fakePad({ axes: [1, 0], connected: false })));
    const state = createControlState();
    src.update(state);
    expect(state.thrust).toEqual({ x: 0, y: 0 });
  });

  it('honours a pinned preferredIndex over the scan', () => {
    const src = new GamepadSource(
      pads(fakePad({ axes: [1, 0] }), fakePad({ axes: [-1, 0] })),
      /* preferredIndex */ 1,
    );
    const state = createControlState();
    src.update(state);
    expect(state.thrust).toEqual({ x: -1, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// Keyboard + mouse — a fake event target captures listeners so key/mouse events
// can be driven without a DOM.
// ---------------------------------------------------------------------------

interface FakeTarget {
  addEventListener(type: string, cb: (e: unknown) => void): void;
  removeEventListener(type: string, cb: (e: unknown) => void): void;
  fire(type: string, e: unknown): void;
  count(type: string): number;
}

function fakeTarget(): FakeTarget {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  return {
    addEventListener(type, cb) {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(cb);
    },
    removeEventListener(type, cb) {
      listeners.get(type)?.delete(cb);
    },
    fire(type, e) {
      for (const cb of listeners.get(type) ?? []) cb(e);
    },
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

const CENTER: ScreenCenterFn = () => ({ x: 400, y: 300 });

describe('KeyboardMouseSource — folds keys/mouse into ControlState (GDD §2.4)', () => {
  it('maps WASD to thrust (screen space, y-down)', () => {
    const t = fakeTarget();
    const src = new KeyboardMouseSource(CENTER, t as unknown as Window);
    // D alone → +x. (A diagonal would normalize; single-axis stays unit.)
    t.fire('keydown', { code: 'KeyD' });
    const state = createControlState();
    src.update(state);
    expect(state.thrust).toEqual({ x: 1, y: 0 });
    // Release D, hold W → -y (up is negative in screen space).
    t.fire('keyup', { code: 'KeyD' });
    t.fire('keydown', { code: 'KeyW' });
    src.update(state);
    expect(state.thrust).toEqual({ x: 0, y: -1 });
  });

  it('normalizes a diagonal so it never exceeds the analog disc', () => {
    const t = fakeTarget();
    const src = new KeyboardMouseSource(CENTER, t as unknown as Window);
    t.fire('keydown', { code: 'KeyD' });
    t.fire('keydown', { code: 'KeyS' });
    const state = createControlState();
    src.update(state);
    const mag = Math.hypot(state.thrust.x, state.thrust.y);
    expect(mag).toBeCloseTo(1, 6);
  });

  it('aims from the ship centre toward the mouse, fires on the left button', () => {
    const t = fakeTarget();
    const src = new KeyboardMouseSource(CENTER, t as unknown as Window);
    t.fire('mousemove', { clientX: 500, clientY: 300 });
    t.fire('mousedown', { button: 0 });
    const state = createControlState();
    src.update(state);
    expect(state.aim).toEqual({ x: 100, y: 0 }); // 500-400, 300-300
    expect(state.fire).toBe(true);

    t.fire('mouseup', { button: 0 });
    src.update(state);
    expect(state.fire).toBe(false);
  });

  it('requests a ping on middle click, consumed once', () => {
    const t = fakeTarget();
    const src = new KeyboardMouseSource(CENTER, t as unknown as Window);
    t.fire('mousedown', { button: 1, clientX: 12, clientY: 34 });
    const state = createControlState();
    src.update(state);
    expect(state.ping).toEqual({ x: 12, y: 34 });
    // Cleared after the frame that consumed it — not a sticky ping.
    const next = createControlState();
    src.update(next);
    expect(next.ping).toBeNull();
  });

  it('clears held keys and fire on blur (focus loss must not stick thrust on)', () => {
    const t = fakeTarget();
    const src = new KeyboardMouseSource(CENTER, t as unknown as Window);
    t.fire('keydown', { code: 'KeyW' });
    t.fire('mousedown', { button: 0 });
    t.fire('blur', {});
    const state = createControlState();
    src.update(state);
    expect(state.thrust).toEqual({ x: 0, y: 0 });
    expect(state.fire).toBe(false);
  });

  it('detaches every listener on dispose', () => {
    const t = fakeTarget();
    const src = new KeyboardMouseSource(CENTER, t as unknown as Window);
    expect(t.count('keydown')).toBe(1);
    src.dispose();
    expect(t.count('keydown')).toBe(0);
    expect(t.count('mousemove')).toBe(0);
    expect(t.count('blur')).toBe(0);
  });
});
