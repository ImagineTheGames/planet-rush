/**
 * src/ui/controls-strip.ts — the device-aware controls strip model. OWNER: UI.
 *
 * A strip along the bottom edge listing the active device's bindings (GDD §2.2,
 * §2.4). It reads its labels from the same action map that drives the sim
 * ({@link describeBindings}) "so it can never drift out of sync with the real
 * bindings" (GDD §2.4). It swaps automatically when the player picks up a pad.
 *
 * **Desktop-only.** On touch the strip is NOT shown — the visible virtual sticks
 * *are* the binding legend (GDD §2.2, §2.4). So the visibility rule lives here,
 * pure and tested, and the Pixi view only draws the strip when this says to.
 *
 * STYLE NOTE — a deliberate, documented reconciliation: GDD §2.4 prose says the
 * strip renders "keys in signal yellow." The FROZEN style-guide §2 overrides
 * that: signal yellow `#F2D24B` is RESERVED for ore/danger and is "forbidden …
 * as a UI accent." The style-guide is a contract changeable only through the
 * Director, and this agent's brief reaffirms "signal yellow = ore only." So keys
 * render in **plasma** `#4DC3FF` and actions in hull-steel grey — not yellow.
 * The strip stays perfectly legible and the RESERVED rule stays intact.
 */

import { describeBindings } from '@platform/actions';
import type { BindingLabel, DeviceKind, FireMode } from '@platform/actions';

/**
 * The controls strip is shown only on non-touch devices (GDD §2.2, §2.4): on
 * touch the visible controls replace it entirely.
 */
export function showControlsStrip(isTouch: boolean): boolean {
  return !isTouch;
}

/**
 * The rows to render on the strip for the active device and fire mode — a thin,
 * intention-revealing pass-through of {@link describeBindings} so the HUD reads
 * bindings from the one map that drives the sim (GDD §2.4). Returns `[]` for
 * touch, where the strip is not drawn ({@link showControlsStrip}).
 */
export function controlsStripRows(
  device: DeviceKind,
  mode: FireMode,
  isTouch: boolean,
): readonly BindingLabel[] {
  if (isTouch) return [];
  return describeBindings(device, mode);
}

/**
 * The away-from-planet hint for the Build & Upgrade row: the legend must never
 * promise a key that does nothing (field report v0.2.2 — "'E to build' shows
 * always"). Named in full (never just "BUILD" — GDD §2.5) and worded like the
 * touch affordance, which simply isn't there until you're home (build-button.ts).
 */
export const BUILD_AWAY_HINT = 'Build & Upgrade — get closer to your planet';

/** One rendered strip row: an action, its label, the key to print (or `null`
 *  when the action is contextually unavailable and has no live key to promise),
 *  and whether it draws dimmed (present, but not usable right now). */
export interface StripRow {
  readonly action: BindingLabel['action'];
  readonly label: string;
  /** The key glyph to print, or `null` for "no live key" — a dimmed hint row. */
  readonly binding: string | null;
  /** Draw dimmed: an affordance the player can see but not use this frame. */
  readonly dimmed: boolean;
}

/**
 * The strip rows to DRAW, with the Build & Upgrade row made **contextual on
 * docking** — the desktop twin of the touch BUILD button, which only appears at
 * your own planet (build-button.ts, GDD §2.2, §2.4). The wheel opens "near your
 * own planet and nowhere else" (GDD §2.5), so a legend that always advertises the
 * key promises an action the player mostly cannot take (field report v0.2.2).
 *
 *  - **Docked** — the row is live: its real key ("E") and its full name.
 *  - **Away**  — the row dims and drops its key entirely (no dead "E"), replaced
 *    by {@link BUILD_AWAY_HINT} so the player learns *why* it is dark and how to
 *    light it, matching the touch language.
 *
 * Every other row is a straight pass-through of {@link describeBindings}. Returns
 * `[]` for touch, where the strip is not drawn.
 */
export function controlsStripView(
  device: DeviceKind,
  mode: FireMode,
  isTouch: boolean,
  docked: boolean,
): readonly StripRow[] {
  if (isTouch) return [];
  return describeBindings(device, mode).map((row) => {
    if (row.action === 'build' && !docked) {
      return { action: 'build', label: BUILD_AWAY_HINT, binding: null, dimmed: true };
    }
    return { action: row.action, label: row.label, binding: row.binding, dimmed: false };
  });
}
