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
