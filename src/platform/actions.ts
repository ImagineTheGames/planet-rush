/**
 * src/platform/actions.ts — the input→action funnel. OWNER: Platform Engineer.
 *
 * The single place every device passes through on its way into the sim. The
 * load-bearing rule of the whole codebase is that **the simulation never sees a
 * device** (GDD §2.4, `@shared/types` header): keyboard/mouse, gamepad, and
 * touch each write a device-neutral {@link ControlState}, and {@link mapActions}
 * turns that one state into the abstract `Action[]` the sim consumes. Fire mode
 * (Manual / Auto-aim) is resolved *here* — the morph that swaps the right-side
 * bindings (GDD §2.4 fire modes) is a property of this map, not of any device.
 *
 * The device-aware controls strip (GDD §2.4) reads its labels from
 * {@link describeBindings} below, so the legend can never drift out of sync with
 * the real bindings — it is generated from the same map that drives the sim.
 *
 * This module is pure and DOM-free so it unit-tests headless (the sim never sees
 * a device; neither does this funnel's core).
 */

import type { Action, BuildItem, UpgradeTrack, Vec2 } from '@shared/types';

// ---------------------------------------------------------------------------
// Fire mode (GDD §2.4)
// ---------------------------------------------------------------------------

/**
 * Manual or Auto-aim — a player setting on every platform, not a touch-only
 * concession (GDD §2.4). In Manual the player aims (mouse / right stick / touch
 * aim stick) and the beam fires along that facing; in Auto-aim the beam engages
 * the nearest valid target across the full 360° and the player only decides
 * *when* to fire.
 */
export enum FireMode {
  Manual = 'manual',
  AutoAim = 'auto-aim',
}

/**
 * The best first-run default differs by platform (GDD §2.4): Manual on desktop
 * and gamepad, Auto-aim on touch — changeable any time from settings.
 */
export function defaultFireMode(isTouch: boolean): FireMode {
  return isTouch ? FireMode.AutoAim : FireMode.Manual;
}

// ---------------------------------------------------------------------------
// Device-neutral control state
// ---------------------------------------------------------------------------

/**
 * The one mutable snapshot a device writes each frame and the mapper reads. It
 * is deliberately *not* the `Action` union: it is the union of everything any
 * device can express, from which `mapActions` derives the device-agnostic
 * actions given the current fire mode. Reused frame to frame (zero per-frame
 * allocation, GDD §4.3) — devices overwrite fields in place.
 */
export interface ControlState {
  /** Thrust / steer, analog [-1, 1] per axis (GDD §2.4). */
  thrust: Vec2;
  /** Manual aim direction, or `null` when the player isn't aiming this frame.
   *  Ignored by the mapper in Auto-aim. */
  aim: Vec2 | null;
  /** Fire / Mine held (GDD §2.3 — one beam mines and shoots). */
  fire: boolean;
  /** Boost held (GDD §2.4). */
  boost: boolean;
  /** Build & Upgrade wheel requested near own planet (GDD §2.5). */
  build: boolean;
  /**
   * A **confirmed** wheel segment this frame — the press that spends, as opposed
   * to `build`, which only asks for the wheel (GDD §2.5). One-shot: written by
   * whichever device confirmed, read once by {@link mapActions}, and cleared by
   * {@link resetControlState} on the next frame, so a wheel press can never latch
   * and double-charge. `null` on every other frame, which is nearly all of them.
   */
  order: BuildItem | null;
  /** A confirmed upgrade-panel row — the fifth segment's purchase, which names a
   *  track rather than an item (GDD §2.5). One-shot on the same terms as
   *  {@link ControlState.order}. */
  upgrade: UpgradeTrack | null;
  /** Minimap ping target in map space, consumed once then cleared, or `null`. */
  ping: Vec2 | null;
}

/** A fresh, neutral control state (all inputs released). */
export function createControlState(): ControlState {
  return {
    thrust: { x: 0, y: 0 },
    aim: null,
    fire: false,
    boost: false,
    build: false,
    order: null,
    upgrade: null,
    ping: null,
  };
}

/** Reset a control state to neutral in place (no allocation). */
export function resetControlState(state: ControlState): void {
  state.thrust.x = 0;
  state.thrust.y = 0;
  state.aim = null;
  state.fire = false;
  state.boost = false;
  state.build = false;
  state.order = null;
  state.upgrade = null;
  state.ping = null;
}

// ---------------------------------------------------------------------------
// The funnel: ControlState + FireMode → Action[]
// ---------------------------------------------------------------------------

/**
 * Map a device-neutral control state to the abstract action stream the sim
 * consumes (GDD §2.4). This is where the fire-mode morph lives:
 *
 *  - **Manual:** the aim direction (if any) is emitted, and `fire.auto` is false
 *    — the sim raycasts along the ship's facing.
 *  - **Auto-aim:** no `aim` action is emitted (positioning decides *what* gets
 *    hit), and `fire.auto` is true — the sim acquires the nearest target across
 *    the full 360°.
 *
 * Every device produces the same six verbs; nothing downstream can tell which
 * device — or which fire mode — they came from beyond what the sim is told.
 */
export function mapActions(state: ControlState, mode: FireMode): Action[] {
  const auto = mode === FireMode.AutoAim;
  const actions: Action[] = [
    { type: 'thrust', dir: { x: state.thrust.x, y: state.thrust.y } },
  ];

  // Aim is only meaningful — and only sent — in Manual mode.
  if (!auto && state.aim && (state.aim.x !== 0 || state.aim.y !== 0)) {
    actions.push({ type: 'aim', dir: { x: state.aim.x, y: state.aim.y } });
  }

  actions.push({ type: 'fire', active: state.fire, auto });
  actions.push({ type: 'boost', active: state.boost });
  actions.push({ type: 'build', active: state.build });

  // The two purchases (GDD §2.5). They ride the same funnel every other verb
  // does — the sim cannot tell a thumb's tap on a wedge from a mouse click on
  // one from a bot's decision — and they appear only on the tick they were
  // confirmed, because `order`/`upgrade` are one-shot fields.
  if (state.order) actions.push({ type: 'buildOrder', item: state.order });
  if (state.upgrade) actions.push({ type: 'upgradeOrder', track: state.upgrade });

  if (state.ping) {
    actions.push({ type: 'ping', at: { x: state.ping.x, y: state.ping.y } });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Controls strip — labels generated from the map (GDD §2.4)
// ---------------------------------------------------------------------------

/** The input devices Planet Rush maps from (GDD §2.4). */
export type DeviceKind = 'keyboard' | 'gamepad' | 'touch';

/** One row of the device-aware controls strip: an action and its binding. */
export interface BindingLabel {
  /** The abstract verb this row explains. */
  readonly action: 'thrust' | 'aim' | 'fire' | 'build' | 'boost' | 'ping';
  /** Player-facing name of the action (never just "BUILD" — see GDD §2.5). */
  readonly label: string;
  /** The active device's binding, e.g. "WASD", "Right stick", "Right side". */
  readonly binding: string;
}

/**
 * The controls strip's rows for the active device and fire mode. UI renders
 * these; the *labels come from here* so the legend is generated from the same
 * map that drives the sim and can never drift (GDD §2.4). On touch the strip is
 * not shown (the visible sticks are the legend, GDD §2.2), so this returns the
 * touch bindings for onboarding/settings copy rather than a bottom strip.
 */
export function describeBindings(device: DeviceKind, mode: FireMode): BindingLabel[] {
  const auto = mode === FireMode.AutoAim;
  const rows: BindingLabel[] = [];

  const thrust: Record<DeviceKind, string> = {
    keyboard: 'WASD',
    gamepad: 'Left stick',
    touch: 'Left stick',
  };
  const aim: Record<DeviceKind, string> = {
    keyboard: 'Mouse',
    gamepad: 'Right stick',
    touch: 'Right stick',
  };
  const fireManual: Record<DeviceKind, string> = {
    keyboard: 'Left mouse',
    gamepad: 'Right trigger',
    touch: 'Right stick',
  };
  const fireAuto: Record<DeviceKind, string> = {
    keyboard: 'Left mouse',
    gamepad: 'Right trigger',
    touch: 'FIRE button',
  };
  const build: Record<DeviceKind, string> = {
    keyboard: 'E',
    gamepad: 'Y / △',
    touch: 'BUILD',
  };
  const boost: Record<DeviceKind, string> = {
    keyboard: 'Space / Shift',
    gamepad: 'Left trigger',
    touch: 'Boost',
  };
  const ping: Record<DeviceKind, string> = {
    keyboard: 'Middle click',
    gamepad: 'D-pad',
    touch: 'Tap minimap',
  };

  rows.push({ action: 'thrust', label: 'Thrust', binding: thrust[device] });
  // In Auto-aim the aim binding folds away — the right side becomes fire only.
  if (!auto) rows.push({ action: 'aim', label: 'Aim', binding: aim[device] });
  rows.push({ action: 'fire', label: 'Fire / Mine', binding: (auto ? fireAuto : fireManual)[device] });
  rows.push({ action: 'build', label: 'Build & Upgrade', binding: build[device] });
  rows.push({ action: 'boost', label: 'Boost', binding: boost[device] });
  rows.push({ action: 'ping', label: 'Ping', binding: ping[device] });

  return rows;
}
