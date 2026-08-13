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
 * The device-aware controls strip (GDD §2.4) and the onboarding prompts (§2.10)
 * both read their labels from {@link describeBindings} below, so neither can drift
 * out of sync with the real bindings — they are generated from the same map that
 * drives the sim. That map takes the seated {@link ControlScheme} as well as the
 * device and the fire mode (a0-37): Tap Commander replaces the sticks outright, so
 * the scheme decides which bindings are live at all.
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
 * aim stick) and the weapon fires along that facing; in Auto-aim the weapon engages
 * the nearest valid target across the full 360° and the player only decides
 * *when* to fire.
 */
export enum FireMode {
  Manual = 'manual',
  AutoAim = 'auto-aim',
}

/**
 * The first-run default, and it is the SAME on every platform: **Auto-aim**
 * *(GDD §2.4, amended 2026-08-12 — a0-30, ratified: "is tap commander and auto
 * aim default on all platforms it should be" … "I already said BOTH")*.
 *
 * This supersedes the per-platform split this function used to encode (Manual on
 * desktop and gamepad, Auto-aim on touch). Manual is untouched as a *choice* —
 * still reachable from settings and the pause menu on every device, still the mode
 * that emits the `aim` action (`mapActions` below), still half of the parity table
 * (`input-parity.test.ts`). What moved is the mode a player who has never chosen
 * one starts in.
 *
 * Deliberately zero-argument: a `isTouch` parameter the answer no longer depends
 * on is a signature that invites the split back in. The *stored* preference is
 * resolved by {@link readStoredFireMode}, which is what any boot path should call
 * — read before you default.
 */
export const DEFAULT_FIRE_MODE = FireMode.AutoAim;

/** The first-run fire mode on every platform — see {@link DEFAULT_FIRE_MODE}. */
export function defaultFireMode(): FireMode {
  return DEFAULT_FIRE_MODE;
}

/**
 * Resolve a persisted fire-mode string to the mode it seats — **a saved
 * preference always wins** (a0-30 item 2).
 *
 * Only the two strings the enum itself writes count as a preference; an absent
 * key, a stale one, or a hand-edited save falls to {@link defaultFireMode}. That
 * is the whole of "this moves the default for a player with nothing stored, not
 * everyone's setting": anyone who has already chosen Manual re-boots into Manual.
 */
export function readStoredFireMode(stored: string | null | undefined): FireMode {
  if (stored === FireMode.Manual || stored === FireMode.AutoAim) return stored;
  return defaultFireMode();
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
  /** Fire / Mine held (GDD §2.3 — one weapon mines and shoots). */
  fire: boolean;
  /** Build & Upgrade wheel requested near own station (GDD §2.5). */
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
}

/** A fresh, neutral control state (all inputs released). */
export function createControlState(): ControlState {
  return {
    thrust: { x: 0, y: 0 },
    aim: null,
    fire: false,
    build: false,
    order: null,
    upgrade: null,
  };
}

/** Reset a control state to neutral in place (no allocation). */
export function resetControlState(state: ControlState): void {
  state.thrust.x = 0;
  state.thrust.y = 0;
  state.aim = null;
  state.fire = false;
  state.build = false;
  state.order = null;
  state.upgrade = null;
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
 * Every device produces the same verbs — thrust, fire, build, and the two
 * one-shot purchases, plus aim in Manual mode; nothing downstream can tell which
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
  actions.push({ type: 'build', active: state.build });

  // The two purchases (GDD §2.5). They ride the same funnel every other verb
  // does — the sim cannot tell a thumb's tap on a wedge from a mouse click on
  // one from a bot's decision — and they appear only on the tick they were
  // confirmed, because `order`/`upgrade` are one-shot fields.
  if (state.order) actions.push({ type: 'buildOrder', item: state.order });
  if (state.upgrade) actions.push({ type: 'upgradeOrder', track: state.upgrade });

  return actions;
}

// ---------------------------------------------------------------------------
// Controls strip — labels generated from the map (GDD §2.4)
// ---------------------------------------------------------------------------

/** The input devices Planet Rush maps from (GDD §2.4). */
export type DeviceKind = 'keyboard' | 'gamepad' | 'touch';

/**
 * How the player drives the ship (GDD §2.4). `'sticks'` is the twin-stick /
 * keyboard+mouse scheme; `'tap'` is **Tap Commander**, where a tap places a move
 * or a lock and the local pilot (`./tap-pilot`) flies and fires the ship.
 *
 * It lives *here*, next to the map it changes, because a0-37 made it part of the
 * binding contract: the scheme decides which bindings are live at all, so a
 * binding table that cannot see it can only describe one scheme and be wrong in
 * the other. The UI's ratified `ControlScheme` (`@ui/settings`) is now an alias
 * of this one — the same two strings, one definition, so the strip, the prompts
 * and the CONTROLS row can never disagree about what a scheme is. The *stored*
 * strings stay the UI's to own (`CONTROL_SCHEME_STORAGE`); this is the value, not
 * its serialisation.
 */
export type ControlScheme = 'sticks' | 'tap';

/** One row of the device-aware controls strip: an action and its binding. */
export interface BindingLabel {
  /**
   * The abstract verb this row explains.
   *
   * `'command'` is Tap Commander's own (a0-37): a single order that is *both*
   * move and attack ("click anywhere to move or attack"), which is exactly how
   * the scheme works — `TapPilot.resolveTap` takes one tap and turns it into a
   * waypoint or a lock, and the pilot then writes thrust, aim AND fire from it.
   * Splitting it into a thrust row and a fire row would describe two presses the
   * player does not make.
   */
  readonly action: 'thrust' | 'aim' | 'fire' | 'build' | 'command';
  /** Player-facing name of the action (never just "BUILD" — see GDD §2.5). */
  readonly label: string;
  /** The active device's binding, e.g. "WASD", "Right stick", "Right side". */
  readonly binding: string;
}

/**
 * The **pointer verb**, per device — the word for placing an order in Tap
 * Commander (a0-37). §2.4's 2026-08-06 amendment settled that a control row must
 * name what is in front of the player (`KEYBOARD + MOUSE` / `TWIN STICKS` /
 * `STICKS` — `@ui/settings` `STICKS_LABELS`), and the verb obeys the same rule: a
 * developer on a PC is told to **click**, a player on glass to **tap**.
 *
 * `gamepad` reads *click* deliberately. Tap Commander's orders are placed by
 * `pointerdown` on the canvas (`src/main.ts`), and no pad button places one — a
 * pad seated in this scheme still orders with the mouse next to it (and still
 * opens the wheel with `Y / △`, which the scheme leaves live). Naming a pad
 * button here would advertise a control that does not exist, which is the rule
 * `actions.test.ts` calls "no phantom labels". That the pad cannot place an
 * order at all is a genuine §2.4 parity gap in the *input* layer, not something
 * the legend may paper over: a0-37 reports it rather than lying about it.
 */
const POINTER_VERB: Record<DeviceKind, string> = {
  keyboard: 'Click',
  gamepad: 'Click',
  touch: 'Tap',
};

/**
 * The controls strip's rows for the seated device, fire mode **and control
 * scheme**. UI renders these; the *labels come from here* so the legend is
 * generated from the same map that drives the sim and can never drift (GDD §2.4).
 * On touch the strip is not shown (the visible sticks are the legend, GDD §2.2),
 * so this returns the touch bindings for onboarding/settings copy rather than a
 * bottom strip.
 *
 * **`scheme` closes the hole a0-30 flagged and a0-37 fixed.** Tap Commander
 * replaces the sticks outright — `src/main.ts` `sampleInput` zeroes `merged.thrust`,
 * `merged.aim` and `merged.fire` and lets `TapPilot` write all three from the
 * standing order — so a strip that listed `WASD Thrust` and `Left mouse Fire / Mine`
 * to a player on the a0-30 defaults named three bindings, of which none moved or
 * fired the ship (the developer's frame, build `75ec737`). The scheme is therefore
 * a REQUIRED argument, on a0-33's reasoning: the default moved under this table
 * once already, and a caller that could forget the scheme would go on quietly
 * describing whichever one this file guessed.
 *
 * What each scheme returns, and why:
 *
 *  - **`'tap'`** — one `command` row, *first*, because it is the whole scheme:
 *    `Click anywhere · Move or attack`. Then Build & Upgrade, whose key survives
 *    the scheme untouched (`merged.build` is left exactly as the devices wrote
 *    it, so `E` / `Y / △` / `BUILD` really does open the wheel here — as does
 *    tapping your own station in range). No thrust row: WASD is *not* live in
 *    this scheme, measured, so naming it would be the same lie in a smaller font.
 *    No fire row: the pilot presses the trigger, not the player.
 *  - **`'sticks'` + Manual** — GDD §2.4's own table, to the letter, untouched.
 *  - **`'sticks'` + Auto-aim** — the aim row folds away (it always did) and the
 *    fire row stops describing an aim the player no longer makes: the key is the
 *    same, the *label* now says when to hold it and who is aiming.
 */
export function describeBindings(
  device: DeviceKind,
  mode: FireMode,
  scheme: ControlScheme,
): BindingLabel[] {
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

  // Tap Commander: one order does both jobs, and the fire mode has nothing left
  // to say about it — on a lock the pilot aims at what you locked, with no lock
  // it auto-engages (main.ts `tapMode`), and either way the player only taps.
  if (scheme === 'tap') {
    rows.push({
      action: 'command',
      label: 'Move or attack',
      binding: `${POINTER_VERB[device]} anywhere`,
    });
    rows.push({ action: 'build', label: 'Build & Upgrade', binding: build[device] });
    return rows;
  }

  rows.push({ action: 'thrust', label: 'Thrust', binding: thrust[device] });
  // In Auto-aim the aim binding folds away — the right side becomes fire only.
  if (!auto) rows.push({ action: 'aim', label: 'Aim', binding: aim[device] });
  rows.push({
    action: 'fire',
    // Auto-aim engages the nearest valid target across the full 360° and leaves
    // the player only the decision of *when* (see `mapActions` above), so the row
    // teaches the hold and hands the aiming to the weapon — the same correction
    // a0-33 made to the MINE prompt's auto-aim wording, in the strip's register.
    label: auto ? 'Hold to fire / mine — auto-aim picks the target' : 'Fire / Mine',
    binding: (auto ? fireAuto : fireManual)[device],
  });
  rows.push({ action: 'build', label: 'Build & Upgrade', binding: build[device] });

  return rows;
}
