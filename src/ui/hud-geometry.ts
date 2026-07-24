/**
 * src/ui/hud-geometry.ts — the M2 HUD's screen geometry. OWNER: UI Engineer.
 *
 * Pure, PixiJS-free, and unit-tested: every rect the day-2 elements occupy on
 * screen is computed here, and the views ({@link ./hud}, {@link ./build-wheel-view})
 * only draw what these functions return.
 *
 * **Why this file exists.** Every positioned element registers its declared
 * anchor and its *actual* rendered rect with the layout registry
 * (`@platform/layout-registry`), and QA's layout contract asserts the second
 * sits inside the first. But that contract can only see elements the frozen
 * golden scene actually draws — the wheel opens at your planet, the alarm fires
 * under sustained damage, and neither is happening in a screenshot of a ship two
 * seconds into a match. Keeping the geometry pure means the placement of those
 * elements is still asserted, headless, against the registry's own resolver, at
 * every device profile in both orientations (see ./hud-geometry.test.ts) —
 * rather than being trusted until someone opens a build wheel on a phone.
 *
 * All geometry is **screen space, CSS pixels, origin top-left, y-down** — the
 * same convention the registry, the touch layer and the camera speak.
 */

import type { Rect } from '@platform/layout-registry';
import type { HomeArrow } from './alarm';

// ---------------------------------------------------------------------------
// The Build & Upgrade wheel (GDD §2.5)
// ---------------------------------------------------------------------------

/** Reference wheel size as a fraction of the smaller viewport dimension. Big
 *  enough to hit with a thumb, small enough to leave the field readable behind
 *  it — the wheel is opened *at* your planet, so the world under it is calm. */
export const WHEEL_SCALE = 0.36;
/** Clamp so the wheel is neither unreadable on a small phone nor absurd on a
 *  4K desktop. CSS px radius of the outer ring. */
export const WHEEL_MIN_RADIUS = 120;
export const WHEEL_MAX_RADIUS = 230;

/**
 * Outer-ring radius of the wheel for a viewport, CSS px — thumb-scale on a
 * phone, sane on a desktop (GDD §2.4 makes the wheel a touch target first).
 */
export function wheelRadius(viewportWidth: number, viewportHeight: number): number {
  return clamp(
    Math.min(viewportWidth, viewportHeight) * WHEEL_SCALE,
    WHEEL_MIN_RADIUS,
    WHEEL_MAX_RADIUS,
  );
}

/**
 * The wheel's drawn footprint: a `2r` square centred on the screen. The follow
 * camera keeps the local ship — and so the planet it is docked at — at the
 * viewport centre, which is what GDD §2.2's "the wheel when near your own
 * planet" resolves to in screen space.
 */
export function wheelBounds(viewportWidth: number, viewportHeight: number): Rect {
  const r = wheelRadius(viewportWidth, viewportHeight);
  return { x: viewportWidth / 2 - r, y: viewportHeight / 2 - r, width: 2 * r, height: 2 * r };
}

// ---------------------------------------------------------------------------
// The upgrade panel (GDD §2.5 — the only place ship stats appear)
// ---------------------------------------------------------------------------

/** Widest the upgrade panel ever gets, CSS px — past this the four rows stop
 *  reading as a table and start reading as scattered columns. */
export const PANEL_MAX_WIDTH = 360;
/** Clearance the panel keeps from the screen edges on a narrow phone. */
export const PANEL_EDGE_PAD = 12;
/** Panel chrome above and below the rows (title, column headers, ore hint). */
export const PANEL_CHROME_HEIGHT = 92;
/** One upgrade row's height, CSS px. */
export const PANEL_ROW_HEIGHT = 30;

/**
 * The upgrade panel's drawn size for a viewport and row count, CSS px.
 *
 * The width is clamped to the **viewport**, not only to {@link PANEL_MAX_WIDTH}:
 * a fixed 360 px table runs off the side of any phone narrower than that, and a
 * stat row the player cannot read is a spending decision they cannot make
 * (GDD §2.5, style-guide §9).
 */
export function panelSize(
  viewportWidth: number,
  viewportHeight: number,
  rowCount: number,
): { width: number; height: number } {
  const radius = wheelRadius(viewportWidth, viewportHeight);
  const width = Math.max(
    0,
    Math.min(PANEL_MAX_WIDTH, radius * 3, viewportWidth - 2 * PANEL_EDGE_PAD),
  );
  return { width, height: PANEL_CHROME_HEIGHT + rowCount * PANEL_ROW_HEIGHT };
}

/** The panel's drawn footprint — centred on the screen, behind the wheel's
 *  UPGRADE SHIP arrow (GDD §2.5). */
export function panelBounds(
  viewportWidth: number,
  viewportHeight: number,
  rowCount: number,
): Rect {
  const { width, height } = panelSize(viewportWidth, viewportHeight, rowCount);
  return {
    x: viewportWidth / 2 - width / 2,
    y: viewportHeight / 2 - height / 2,
    width,
    height,
  };
}

// ---------------------------------------------------------------------------
// Your own planet's HP (GDD §2.2 — top-right, in your player colour)
// ---------------------------------------------------------------------------

/** The HUD's corner margin, CSS px — and the `margin` of the anchors the corner
 *  elements register under, so the two can never drift apart. */
export const HUD_PAD = 16;

/** Own-planet HP bar. Wide enough to read a quarter-core loss at arm's length on
 *  a phone (GDD §2.2). See {@link planetHpBounds} for why 140 is not free. */
export const HP_BAR_WIDTH = 140;
export const HP_BAR_HEIGHT = 10;
/** Thin shield overbar above it — shields stand in front of the core (GDD §2.5). */
export const SHIELD_BAR_HEIGHT = 4;
/** The bar's top edge within the element, below the `HOME` label, CSS px. */
export const HP_BAR_TOP = 16;

/**
 * The own-planet HP element's drawn footprint: the right-aligned `HOME` label
 * stacked over the core bar, hugging the top-right corner (GDD §2.2).
 *
 * Vertical placement does not depend on the viewport height — the element hangs
 * from the top edge — so the height is not a parameter. `labelWidth` is the
 * measured text width of `HOME` / `HOME LOST`; the footprint is the union of the
 * label and the bar, since the registry records what was actually drawn.
 *
 * **The width is not free.** The element registers under `top-right`, whose zone
 * starts at the viewport's half-width line, so the bar must satisfy
 * `HP_BAR_WIDTH ≤ viewportWidth / 2 − HUD_PAD` — a 144 px budget on the 320 px
 * phone the game claims to run on (GDD §4.3). Widening the bar past that puts
 * own-planet HP into the left half of the screen and breaks the anchor;
 * `hud-geometry.test.ts` pins it.
 */
export function planetHpBounds(viewportWidth: number, labelWidth = 0): Rect {
  const width = Math.max(HP_BAR_WIDTH, labelWidth);
  return {
    x: viewportWidth - HUD_PAD - width,
    y: HUD_PAD,
    width,
    height: HP_BAR_TOP + HP_BAR_HEIGHT,
  };
}

// ---------------------------------------------------------------------------
// The under-attack alarm (GDD §2.2 — a mechanic, not polish)
// ---------------------------------------------------------------------------

/** Stroke width of the threat-red screen frame, CSS px. */
export const ALARM_FRAME_STROKE = 4;
/** Inset of the frame's *path* from the viewport edge, CSS px. Half the stroke
 *  sits outside it, which is what puts the drawn frame flush with the screen. */
export const ALARM_FRAME_INSET = 2;

/** The alarm frame's drawn footprint. A centred stroke on a path inset by
 *  {@link ALARM_FRAME_INSET} lands the frame flush with the viewport edges —
 *  which is the point: it frames the *screen*, not a box inside it. */
export function alarmFrameBounds(viewportWidth: number, viewportHeight: number): Rect {
  const half = ALARM_FRAME_STROKE / 2;
  const x = ALARM_FRAME_INSET - half;
  const y = ALARM_FRAME_INSET - half;
  return {
    x,
    y,
    width: viewportWidth - 2 * ALARM_FRAME_INSET + ALARM_FRAME_STROKE,
    height: viewportHeight - 2 * ALARM_FRAME_INSET + ALARM_FRAME_STROKE,
  };
}

/** Screen-edge arrow triangle size, CSS px (tip length from the anchor point). */
export const ARROW_SIZE = 15;

/**
 * The screen-edge arrow's triangle, as a flat `[x0,y0, x1,y1, x2,y2]` polygon —
 * a tip pointing along `arrow.angle` with two swept-back corners behind it.
 * The view draws exactly this; the test measures exactly this.
 */
export function arrowPoly(arrow: HomeArrow, size: number = ARROW_SIZE): number[] {
  const cos = Math.cos(arrow.angle);
  const sin = Math.sin(arrow.angle);
  const tipX = arrow.x + cos * size;
  const tipY = arrow.y + sin * size;
  const backX = arrow.x - cos * size * 0.5;
  const backY = arrow.y - sin * size * 0.5;
  const nx = -sin * size * 0.7;
  const ny = cos * size * 0.7;
  return [tipX, tipY, backX + nx, backY + ny, backX - nx, backY - ny];
}

/** Axis-aligned bounds of a flat `[x,y, x,y, …]` polygon — the rect the arrow
 *  actually occupies, which is what the registry records. */
export function polyBounds(poly: readonly number[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < poly.length; i += 2) {
    const x = poly[i] as number;
    const y = poly[i + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
