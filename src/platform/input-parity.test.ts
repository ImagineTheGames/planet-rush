/**
 * src/platform/input-parity.test.ts — the parity table, as a test (field report
 * v0.2.2; docs/input-parity.md). Input parity is a contract: every abstract
 * `Action` the sim accepts must be reachable from EVERY input source. This test
 * drives the real source modules headlessly and asserts each device can produce
 * every action — so a future PC-only control (the "some controls only exist on
 * PC" class of bug) fails CI here instead of reaching the developer's thumbs.
 *
 * The rows are pinned to the `Action` union by an exhaustive `Record<ActionType>`
 * ({@link EXPECTED}); adding a new action type to `@shared/types` without teaching
 * this table how each device produces it fails to compile. The columns are the
 * three sources — keyboard/mouse, gamepad, touch — each computed by exercising the
 * actual production code (`input.ts`, `touch.ts`, `wheel-input.ts`,
 * `touch-visuals.ts`), never a hand-maintained restatement of it.
 */
import { describe, it, expect } from 'vitest';
import type { Action, ActionType } from '@shared/types';
import { UpgradeTrack } from '@shared/types';
import { FireMode, createControlState, mapActions, defaultFireMode } from './actions';
import { GamepadSource, KeyboardMouseSource } from './input';
import type { GamepadProvider } from './input';
import { TouchController } from './touch';
import { WheelInput, writeWheelOrders } from './wheel-input';
import { buildButtonRect } from './touch-visuals';

// ---------------------------------------------------------------------------
// The rows: every action type, exhaustively (a new one fails to compile here).
// ---------------------------------------------------------------------------

const EXPECTED: Record<ActionType, true> = {
  thrust: true,
  aim: true,
  fire: true,
  build: true,
  buildOrder: true,
  upgradeOrder: true,
};
const ACTION_TYPES = Object.keys(EXPECTED) as ActionType[];

/** Fold every *meaningfully active* action from a control state into `got`. Held
 *  actions (fire/build) count only when active; thrust only when non-zero;
 *  aim/orders only when actually emitted. This is "the device did the thing",
 *  not "the funnel always mentions the verb". */
function addActive(got: Set<ActionType>, actions: readonly Action[]): void {
  for (const a of actions) {
    switch (a.type) {
      case 'thrust':
        if (a.dir.x !== 0 || a.dir.y !== 0) got.add('thrust');
        break;
      case 'fire':
        if (a.active) got.add('fire');
        break;
      case 'build':
        if (a.active) got.add('build');
        break;
      case 'aim':
      case 'buildOrder':
      case 'upgradeOrder':
        got.add(a.type);
        break;
    }
  }
}

/** The Build & Upgrade wheel is device-agnostic (`wheel-input.ts`): every device
 *  reaches `buildOrder`/`upgradeOrder` by opening the wheel (its own affordance)
 *  and pressing it (mouse click / gamepad confirm / thumb tap). Drive the shared
 *  wheel to confirm both orders reach the control state, and fold them in. */
function addWheelOrders(got: Set<ActionType>): void {
  const wheel = new WheelInput();
  const wLayout = { centerX: 500, centerY: 300, radius: 200, segments: 5 };
  const pLayout = { centerX: 500, centerY: 300, width: 300, height: 300, rowHeight: 40, rows: 4 };
  const segments = ['turret', 'shield', 'repair', 'bank', 'upgrade'] as const;
  const tracks = Object.values(UpgradeTrack);

  // A build order: open the wheel, press a segment at twelve o'clock (index 0,
  // which is not the UPGRADE segment 4).
  wheel.toggle();
  wheel.press(500, 300 - 150, wLayout, pLayout, 4);
  const s1 = createControlState();
  writeWheelOrders(wheel, s1, segments, tracks);
  addActive(got, mapActions(s1, FireMode.Manual));

  // An upgrade order: open the wheel, raise the panel, press a row.
  wheel.close();
  wheel.toggle();
  wheel.openPanel();
  wheel.press(500, 234, wLayout, pLayout, 4); // 150 (top) + 64 (rows top) + 20 → row 0
  const s2 = createControlState();
  writeWheelOrders(wheel, s2, segments, tracks);
  addActive(got, mapActions(s2, FireMode.Manual));
}

// ---------------------------------------------------------------------------
// Gamepad fakes (a minimal standard-mapping pad, mirrors input.test.ts).
// ---------------------------------------------------------------------------

function fakePad(init: { axes?: number[]; buttons?: Record<number, number> } = {}): Gamepad {
  const axes = [0, 0, 0, 0];
  (init.axes ?? []).forEach((v, i) => (axes[i] = v));
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    value: init.buttons?.[i] ?? 0,
    pressed: (init.buttons?.[i] ?? 0) > 0.5,
    touched: false,
  }));
  return { axes, buttons, connected: true, mapping: 'standard', index: 0 } as unknown as Gamepad;
}
const pads =
  (...list: (Gamepad | null)[]): GamepadProvider =>
  () =>
    list;

// ---------------------------------------------------------------------------
// Keyboard fake target (captures listeners so key/mouse can be driven headless).
// ---------------------------------------------------------------------------

function fakeWindow(): Window & { fire(type: string, e: unknown): void } {
  const map = new Map<string, ((e: unknown) => void)[]>();
  return {
    addEventListener(type: string, cb: (e: unknown) => void): void {
      (map.get(type) ?? map.set(type, []).get(type)!).push(cb);
    },
    removeEventListener(): void {},
    fire(type: string, e: unknown): void {
      (map.get(type) ?? []).forEach((cb) => cb(e));
    },
  } as unknown as Window & { fire(type: string, e: unknown): void };
}

// ---------------------------------------------------------------------------
// The three columns — each computed by exercising the real production code.
// ---------------------------------------------------------------------------

function keyboardActions(): Set<ActionType> {
  const got = new Set<ActionType>();
  const win = fakeWindow();
  const kb = new KeyboardMouseSource(() => ({ x: 500, y: 300 }), win);
  win.fire('keydown', { code: 'KeyW' }); // thrust
  win.fire('keydown', { code: 'KeyE' }); // build (open wheel)
  win.fire('mousemove', { clientX: 620, clientY: 300 }); // aim (offset from centre)
  win.fire('mousedown', { button: 0 }); // fire
  const s = createControlState();
  kb.update(s);
  addActive(got, mapActions(s, FireMode.Manual));
  addWheelOrders(got);
  return got;
}

function gamepadActions(): Set<ActionType> {
  const got = new Set<ActionType>();
  // thrust + aim + fire + build in one rich frame.
  const rich = fakePad({ axes: [0.8, -0.6, -1, 0.5], buttons: { 7: 1, 3: 1 } });
  const s = createControlState();
  new GamepadSource(pads(rich)).update(s);
  // Both modes, from the SAME pad frame — and that pairing is the point since
  // a0-30 made Auto-aim the default on every platform. Parity is about what a
  // device can REACH, not what it starts in: `aim` is reachable from a pad because
  // Manual is still a mode a pad player can pick (auto-aim everywhere must not
  // become auto-aim only), and the new default still thrusts, fires and builds.
  addActive(got, mapActions(s, FireMode.Manual)); // → aim emitted
  addActive(got, mapActions(s, defaultFireMode())); // the first-run default (Auto-aim)
  addWheelOrders(got);
  return got;
}

function touchActions(): Set<ActionType> {
  const got = new Set<ActionType>();
  const W = 1000;
  const H = 600;

  // thrust — left stick.
  {
    const tc = new TouchController({ screenWidth: W });
    tc.onPointerDown({ id: 1, x: 100, y: 500 });
    tc.onPointerMove({ id: 1, x: 164, y: 500 });
    const s = createControlState();
    tc.writeInto(s);
    addActive(got, mapActions(s, tc.getFireMode()));
  }
  // aim + fire — Manual right stick (one gesture).
  {
    const tc = new TouchController({ screenWidth: W });
    tc.setFireMode(FireMode.Manual);
    tc.onPointerDown({ id: 1, x: 900, y: 500 });
    tc.onPointerMove({ id: 1, x: 964, y: 500 });
    const s = createControlState();
    tc.writeInto(s);
    addActive(got, mapActions(s, FireMode.Manual));
  }
  // fire — Auto-aim hold-to-FIRE button (the touch default).
  {
    const tc = new TouchController({ screenWidth: W });
    tc.onPointerDown({ id: 1, x: 900, y: 500 });
    const s = createControlState();
    tc.writeInto(s);
    addActive(got, mapActions(s, FireMode.AutoAim));
  }
  // build — the touch BUILD button affordance exists at your own station.
  if (buildButtonRect(true, /* docked */ true, W, H)) got.add('build');
  // buildOrder + upgradeOrder — the wheel the BUILD button opens (device-agnostic).
  addWheelOrders(got);

  return got;
}

// ---------------------------------------------------------------------------
// The assertions — every cell of the table is filled.
// ---------------------------------------------------------------------------

const COLUMNS: Record<string, () => Set<ActionType>> = {
  'keyboard/mouse': keyboardActions,
  gamepad: gamepadActions,
  touch: touchActions,
};

describe('input parity — every action is reachable from every device (docs/input-parity.md)', () => {
  for (const [device, produce] of Object.entries(COLUMNS)) {
    it(`${device} can produce every abstract action`, () => {
      const produced = produce();
      const missing = ACTION_TYPES.filter((t) => !produced.has(t));
      // A readable failure names the exact hole — the control that "only exists" elsewhere.
      expect(missing, `${device} is missing: [${missing.join(', ')}]`).toEqual([]);
    });
  }
});
