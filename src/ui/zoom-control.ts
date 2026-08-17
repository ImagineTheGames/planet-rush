/**
 * src/ui/zoom-control.ts — the zoom-out control, on touch. OWNER: UI Engineer
 * (a0-74).
 *
 * The developer, having named both options and chosen one:
 *
 * > *"on pc i have the entire screen but im on mobile im confined to a very small
 * > portion of the world. perhaps we need a way to either confine the screen on pc
 * > or **what i'd probably prefer is add a zoom out button on mobile**"*
 *
 * So this is a *button*, not a slider and not a settings row: one tap widens the
 * view, one more widens it again, one more returns it. The ladder, the persistence
 * and the arithmetic are `./viewport`'s; this file is where the control *is* on
 * screen and what it says. Pure and DOM-free — `./hud` draws exactly what these
 * return, and `hud.zoomTap` hit-tests exactly this rect.
 *
 * ── WHERE IT SITS, MEASURED ─────────────────────────────────────────────────
 *
 * Top-right, directly **under** the own-station HP cluster: the corner that
 * already answers "what am I looking at", nowhere near a thumb (a zoom is set once
 * a match, not held), and clear of everything else in the top band.
 *
 * The alternative was the same row, immediately *left* of HOME, and the numbers
 * killed it. On the 568×320 profile at the 0.75 scale floor the wave clock's strip
 * is ~151 px wide centred on 284 (so it runs to ~360) and the HOME cluster's left
 * edge is at 398 — 38 px of gap for a 64 px control. The top row is genuinely full
 * on the shortest screen the HUD claims to run on (GDD §4.3).
 *
 * Stacking under HOME fits, but only because {@link zoomControlBounds} clamps for
 * it. The `top-right` zone is `y ∈ [PAD, H/3]` — 90 px tall at 320 — and HOME's own
 * chrome takes 39 px of that ({@link stationChromeHeight}), so the preferred gap
 * would push a 48 px control 4 px past the zone's floor. The control therefore
 * takes the gap it can get rather than shrinking: a HUD metric may scale with the
 * frame, a **touch target may not**, because a thumb does not get smaller with the
 * viewport (GDD §2.4). On every other profile the preferred gap fits untouched.
 *
 * ── WHY IT IS TOUCH-ONLY ────────────────────────────────────────────────────
 *
 * Because the report is, and because the developer explicitly did **not** choose
 * the other option they named. Giving desktop a zoom-out would widen the view
 * that is already the wide one, which is the fairness problem pointed the other
 * way; confining desktop is the option that was passed over. Neither is this
 * control's to decide.
 */

import type { Rect } from '@platform/layout-registry';
import type { AnchorSpec } from '@platform/layout-registry';
import { HUD_PAD, TOUCH_TARGET_MIN, stationChromeHeight } from './hud-geometry';
import { hudMetrics, hudSpace } from './instrument';
import { viewZoomLabel } from './viewport';

/** The layout-registry id. Stable — a placement suite asserts against it. */
export const ZOOM_CONTROL_ID = 'zoom-control';

/**
 * Declared placement: `top-right`, the corner GDD §2.2 already gives to own-station
 * HP, with the HUD's own margin. It is a readout-shaped control that answers "how
 * much of the claim am I seeing", so it belongs with the other status instruments
 * rather than down among the thumb furniture.
 */
export const ZOOM_CONTROL_ANCHOR: AnchorSpec = { region: 'top-right', margin: HUD_PAD };

/** The control's drawn width at the reference frame, CSS px — wide enough for
 *  `1.5×` under its `VIEW` eyebrow at every scale the HUD allows. */
export const ZOOM_CONTROL_WIDTH = 64;

/**
 * The control's height, CSS px — the platform touch floor, and **deliberately not
 * scaled down on a phone**. Every other HUD metric shrinks with `hudSpace`; a
 * tappable target may not, because a thumb does not shrink with the viewport
 * (GDD §2.4 makes touch targets a first-class constraint).
 */
export const ZOOM_CONTROL_HEIGHT = TOUCH_TARGET_MIN;

/** Air between this control and the HOME cluster above it, reference px — the
 *  gap it *prefers*; see {@link zoomControlBounds} for when it gets less. */
export const ZOOM_CONTROL_GAP = 8;

/**
 * Shown on touch and nowhere else — see the header. Desktop's view is the wide
 * one already, and confining it is the option the developer passed over.
 */
export function showZoomControl(isTouch: boolean): boolean {
  return isTouch;
}

/**
 * The control's drawn footprint, in **content-box space** (`./viewport`
 * `contentBox`) — the caller adds the box's own x offset, exactly as it does for
 * the other corner chrome. `null` when the control is not shown.
 *
 * Right-aligned on the HUD margin, under the own-station HP cluster, whose chrome
 * depth is read from {@link stationChromeHeight} rather than copied — the same
 * mirror-the-drawing-constant discipline `./minimap` uses for the FIRE column.
 *
 * The vertical placement is a **clamp between two hard bounds**, and both matter:
 *
 *  - it never rides up onto HOME's own chrome (the floor), and
 *  - it never drops below the `top-right` zone (the ceiling), so its declared
 *    anchor stays a promise the layout registry can keep.
 *
 * Between them it takes {@link ZOOM_CONTROL_GAP} of air where there is room and
 * less where there is not. What it never does is shrink: see the header.
 */
export function zoomControlBounds(
  contentWidth: number,
  contentHeight: number,
  isTouch: boolean,
): Rect | null {
  if (!showZoomControl(isTouch)) return null;
  const m = hudMetrics(contentWidth, contentHeight);
  const width = ZOOM_CONTROL_WIDTH;
  const height = ZOOM_CONTROL_HEIGHT;

  const homeBottom = HUD_PAD + stationChromeHeight(m.scale);
  const preferred = homeBottom + hudSpace(ZOOM_CONTROL_GAP, m);
  // The `top-right` band's floor (layout-registry: `top` is y ∈ [0, H/3]).
  const zoneFloor = contentHeight / 3;
  const y = Math.max(homeBottom, Math.min(preferred, zoneFloor - height));

  return {
    x: contentWidth - HUD_PAD - width,
    y,
    width,
    height,
  };
}

/** What the control says: an eyebrow naming what it acts on, and the live rung as
 *  its value — the same eyebrow-over-value grammar the ORE and HOME readouts use,
 *  so it reads as an instrument the player may press rather than a new dialect. */
export function zoomControlLabel(step: number): { caption: string; value: string } {
  return { caption: 'VIEW', value: viewZoomLabel(step) };
}

/** Did a press at `(x, y)` — screen space — land on the control? `rect` is the
 *  drawn rect in the SAME space as the point, so the caller offsets the content
 *  box exactly once and both halves of this agree by construction. */
export function hitZoomControl(x: number, y: number, rect: Rect | null): boolean {
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}
