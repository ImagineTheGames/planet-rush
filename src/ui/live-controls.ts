/**
 * src/ui/live-controls.ts — a control that cannot act is not drawn. OWNER: UI
 * Engineer (a0-74).
 *
 * The developer, on a PC, with Tap Commander and Auto-aim seated:
 *
 * > *"theres buttons like Fire, that shouldn't show up since im using tap
 * > commander and auto fire (on pc)"*
 *
 * **"on pc" is not a mistake, and it is the first thing to understand about this
 * file.** `main.ts` seats the touch layer on `'ontouchstart' in window ||
 * navigator.maxTouchPoints > 0`, which is *true* on any touchscreen laptop — so a
 * developer on a PC with a touch display gets the on-glass controls, and the
 * report is about the thumb furniture rather than about the desktop controls
 * strip (that strip has been scheme-aware since a0-37 and already drops its fire
 * row under Tap Commander).
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A control whose verb the **active scheme** cannot deliver is not drawn — on
 * desktop and on touch alike, since the same rule applies wherever the scheme
 * makes a control dead. It is not dimmed: dimming says *"not right now"* (the
 * BUILD row away from your station, `./controls-strip`), and this is *"not in this
 * scheme at all"*, which is a different sentence and deserves a different answer.
 *
 * ── WHAT IS ACTUALLY DEAD, MEASURED FROM THE FUNNEL ─────────────────────────
 *
 * Not guessed from the button's name — read off `main.ts` `sampleInput`, which is
 * the one place a device's `ControlState` becomes the sim's actions. Under
 * `scheme === 'tap'` it does exactly this, every frame:
 *
 *     merged.thrust.x = 0; merged.thrust.y = 0;
 *     merged.aim = null;   merged.fire = false;
 *     // …and `TapPilot` writes all three from the standing order.
 *
 * So under Tap Commander the **left thrust stick**, the **right aim stick** and
 * the **hold-to-FIRE button** are three affordances that consume screen, attention
 * and thumb travel and move nothing: whatever the thumb writes is discarded on the
 * very next line. `merged.build` is deliberately *not* zeroed there, which is why
 * {@link OnGlassControls.build} stays true in every scheme — the BUILD button
 * really does open the wheel under Tap Commander (as does tapping your own station
 * in range), so hiding it would be the same defect pointing the other way.
 *
 * Pure and DOM-free: the decision lives here and is unit-tested, and the layer
 * that draws thumb furniture (`@platform/touch-visuals`) is handed booleans. That
 * seam is deliberate — the platform layer owns *where* a control sits and *what it
 * paints*; whether the seated scheme can use it at all is a UI question, and one
 * this file can answer in a headless test.
 */

import { FireMode } from '@platform/actions';
import type { ControlScheme } from '@platform/actions';

/**
 * Which on-glass controls the active input scheme can actually drive this frame.
 * Every field is "draw it", never "dim it" — see the header.
 */
export interface OnGlassControls {
  /** The left thrust stick — its idle zone ghost and its live base + knob. */
  readonly thrustStick: boolean;
  /** The right-half aim stick (Manual fire mode only). */
  readonly aimStick: boolean;
  /** The persistent hold-to-FIRE button (Auto-aim fire mode only). */
  readonly fireButton: boolean;
  /**
   * The BUILD & UPGRADE button. True in every scheme on touch, contextually on
   * docking — `main.ts` leaves `merged.build` exactly as the devices wrote it, in
   * both schemes, so this control is alive in both.
   */
  readonly build: boolean;
}

/** Nothing on the glass — desktop, where the controls strip is the legend
 *  (GDD §2.2, §2.4) and no thumb furniture is drawn at all. */
const NONE: OnGlassControls = {
  thrustStick: false,
  aimStick: false,
  fireButton: false,
  build: false,
};

/**
 * The on-glass controls that can act, for the seated device, scheme and fire mode.
 *
 * `scheme` is a **required** argument on a0-37's reasoning, restated: the default
 * scheme has already moved under this codebase once (a0-30 made Tap Commander the
 * first-run default on every platform), and a caller that could forget the scheme
 * would go on quietly drawing whichever one this file guessed — which is exactly
 * the defect being fixed.
 */
export function liveOnGlassControls(
  isTouch: boolean,
  scheme: ControlScheme,
  mode: FireMode,
): OnGlassControls {
  if (!isTouch) return NONE;
  if (scheme === 'tap') {
    // Tap Commander: the pilot presses the trigger and steers, not the player.
    // BUILD survives — it is the one verb the scheme leaves on its own affordance.
    return { thrustStick: false, aimStick: false, fireButton: false, build: true };
  }
  return {
    thrustStick: true,
    aimStick: mode === FireMode.Manual,
    fireButton: mode === FireMode.AutoAim,
    build: true,
  };
}

/**
 * Whether the twin-stick furniture (both sticks, both ghosts, the FIRE button) is
 * drawn at all — the single boolean `@platform/touch-visuals` needs to gate its
 * stick/fire half while leaving the BUILD button alone.
 *
 * A convenience over {@link liveOnGlassControls}, not a second rule: it is the
 * disjunction of the three stick/fire fields, so the two can never disagree.
 */
export function showStickFurniture(
  isTouch: boolean,
  scheme: ControlScheme,
  mode: FireMode,
): boolean {
  const live = liveOnGlassControls(isTouch, scheme, mode);
  return live.thrustStick || live.aimStick || live.fireButton;
}
