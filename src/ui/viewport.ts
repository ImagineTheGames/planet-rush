/**
 * src/ui/viewport.ts — how much screen the HUD is allowed to use, and how much
 * world the camera shows. OWNER: UI Engineer (a0-74).
 *
 * Pure, DOM-free and unit-tested. Two answers live here because they are one
 * question — *the screen you get depends on the screen you have, and nobody
 * decided that* — arriving from three developer reports in a single session:
 *
 * > *"on pc i have the entire screen but im on mobile im confined to a very small
 * > portion of the world … what i'd probably prefer is add a zoom out button on
 * > mobile"*
 * > *"on pc we also need a way to handle UI locations because i have an ultra wide
 * > and all that UI goes to the edges of the screens"*
 *
 * ── 1. THE CONTENT BOX ───────────────────────────────────────────────────────
 *
 * {@link contentBox} is the centred region of the viewport the HUD anchors to.
 * The world still renders **full-bleed** behind it; only the chrome is bound. On
 * a 16:9 display it is the whole viewport and nothing moves at all.
 *
 * **Why 16:9 is the cap.** It is not a taste: `./instrument` scales every HUD
 * metric from `HUD_REFERENCE = 1280×720`, which is 16:9 exactly. Binding the HUD
 * to that aspect gives an ultrawide the HUD *as it was authored*, scaled — rather
 * than the same HUD pulled apart until the build wheel and the hold pips are a
 * head-turn away from each other. Anything wider is world, which is what an
 * ultrawide is for.
 *
 * **Why there is also a floor, and why it is not optional.** A bare aspect cap
 * gets phones badly wrong. A 844×390 landscape phone is aspect **2.16** — already
 * wider than 16:9 — so a pure cap would inset the one device with no horizontal
 * room to give away. {@link CONTENT_MIN_WIDTH} is therefore the width under which
 * nothing is ever inset, and it is `HUD_REFERENCE.width` rather than a new number:
 * below the frame the HUD was drawn for, every pixel is already spoken for.
 *
 * **Height is never capped.** All three reports are horizontal, and an ultrawide
 * is short rather than tall — capping the height would invent an inset nobody
 * asked for and would cost a 32:9 display the little vertical room it has.
 *
 * ── 2. THE VIEW ZOOM ─────────────────────────────────────────────────────────
 *
 * The camera is translate-only (`@platform/camera`), so **one world unit is one
 * CSS pixel** and the view is exactly `viewportWidth` world units wide. That is
 * the whole of the first report, stated as arithmetic: a 1707 px desktop sees
 * 1707 units of a 2400-unit arena (71 %); a 798 px phone sees 798 (33 %). Nobody
 * chose that ratio; it fell out of the pixel size of the glass.
 *
 * {@link VIEW_ZOOM_STEPS} is the ladder that closes it — **view-width
 * multipliers**, so `2` means "twice as much world across the same screen" and
 * the camera scale the renderer applies is `1 / step` ({@link cameraScale}).
 * Because a world unit is a CSS pixel at the shipped camera, the world-units-wide
 * a screen shows is just `viewportWidth × step`; there is no helper for that
 * product on purpose, since the only thing that should ever *report* the view
 * width is the renderer's own `visibleWorld` (the box the cull culls against),
 * which is what `evidence/a0-74-viewport` reads. It
 * is a short cycle rather than a slider because the developer asked for a
 * *button*, and it is touch-only because they explicitly did **not** choose the
 * other option they named (confining the desktop view).
 */

import { HUD_REFERENCE } from './instrument';
import type { Rect, Viewport } from '@platform/layout-registry';

// ---------------------------------------------------------------------------
// 1. The content box
// ---------------------------------------------------------------------------

/**
 * The widest the HUD's content box is allowed to get, as `width / height` — the
 * aspect of {@link HUD_REFERENCE}, derived rather than typed, so the cap cannot
 * drift from the frame every HUD metric is scaled off.
 */
export const CONTENT_MAX_ASPECT = HUD_REFERENCE.width / HUD_REFERENCE.height;

/**
 * The viewport width under which the content box is always the whole viewport,
 * CSS px — see the header. `HUD_REFERENCE.width`, because below the frame the HUD
 * was authored at there is no spare width to inset.
 */
export const CONTENT_MIN_WIDTH = HUD_REFERENCE.width;

/**
 * The centred region of `viewport` the HUD chrome anchors to, CSS px.
 *
 * Equal to the whole viewport whenever the display is 16:9 or narrower, or under
 * {@link CONTENT_MIN_WIDTH} wide — which is every phone, every tablet and every
 * ordinary desktop window, so this is a no-op on all of them. On a 21:9 or 32:9
 * display it is a centred box of reference aspect with the extra width left to the
 * world behind it.
 *
 * Allocates one Rect: this is called on resize and once per frame at most, never
 * per entity.
 */
export function contentBox(viewport: Viewport): Rect {
  const W = Math.max(0, viewport.width);
  const H = Math.max(0, viewport.height);
  const capped = H * CONTENT_MAX_ASPECT;
  // Never wider than the viewport, never narrower than the floor (and the floor
  // itself never wider than the viewport — a 320 px phone keeps all 320).
  const width = Math.min(W, Math.max(capped, Math.min(W, CONTENT_MIN_WIDTH)));
  return { x: (W - width) / 2, y: 0, width, height: H };
}

// ---------------------------------------------------------------------------
// 2. The view zoom
// ---------------------------------------------------------------------------

/**
 * The zoom ladder, as **view-width multipliers** — how many times more world sits
 * across the screen than at the shipped camera. `1` is the shipped view.
 *
 * Why it stops at 2, measured rather than guessed: a phone at 798 CSS px sees 798
 * world units, and 2× buys it 1596 against the 1707 a 1707×898 desktop sees —
 * 93 % of the desktop view, and more than a 1280-wide desktop window gets. The
 * step past it would have to buy the remaining 7 % by drawing a `SHIP_RADIUS = 16`
 * ship at under 8 px across, which is a ship the player can no longer read. The
 * gap closes here; it does not close by going further.
 */
export const VIEW_ZOOM_STEPS: readonly number[] = [1, 1.5, 2];

/** The shipped view — the first rung, and what a player with nothing stored gets
 *  (desktop players never leave it: the control is touch-only). */
export const DEFAULT_VIEW_ZOOM = VIEW_ZOOM_STEPS[0] as number;

/**
 * The camera scale for a view-width multiplier: `1 / step`.
 *
 * The renderer scales its world root by this, so a step of 2 halves the drawn size
 * of everything and doubles the world on screen. Stated as a function rather than
 * left at each call site because the two are easy to invert by accident, and an
 * inverted zoom is a zoom *in* on the device that already sees least.
 */
export function cameraScale(step: number): number {
  const s = normaliseZoom(step);
  return 1 / s;
}

/** The next rung of {@link VIEW_ZOOM_STEPS}, wrapping back to the first. The
 *  whole behaviour of the control: one button, cycled, no slider. */
export function nextViewZoom(step: number): number {
  const steps = VIEW_ZOOM_STEPS;
  const i = steps.indexOf(normaliseZoom(step));
  return steps[(i + 1) % steps.length] as number;
}

/** The label a zoom step wears on the control — `1×`, `1.5×`, `2×`. Trailing
 *  zeroes are dropped so 1.5 does not read as `1.50×`. */
export function viewZoomLabel(step: number): string {
  const s = normaliseZoom(step);
  return `${Number(s.toFixed(2))}×`;
}

/**
 * The storage key the chosen zoom persists under — the same
 * `planet-rush:` family as the fire mode and the control scheme, so a player's
 * view survives the match, the reload and the next match (brief: *"remembered
 * across matches"*).
 */
export const VIEW_ZOOM_STORAGE = 'planet-rush:viewZoom';

/** The string to persist for a step. */
export function storedViewZoom(step: number): string {
  return String(normaliseZoom(step));
}

/**
 * The step a stored value seats. Anything unrecognised — an absent key, a stale
 * one, a hand-edited save, or a rung a future build removes — folds to
 * {@link DEFAULT_VIEW_ZOOM}, so nothing a player ever saved can seat a zoom that
 * is not on the ladder.
 */
export function parseViewZoom(stored: string | null | undefined): number {
  if (typeof stored !== 'string') return DEFAULT_VIEW_ZOOM;
  const n = Number(stored);
  return VIEW_ZOOM_STEPS.includes(n) ? n : DEFAULT_VIEW_ZOOM;
}

/** Snap an arbitrary number onto the ladder — the guard every function above
 *  runs first, so a caller that hand-rolls a step can never produce a camera
 *  scale of 0, NaN or Infinity. */
function normaliseZoom(step: number): number {
  if (!Number.isFinite(step)) return DEFAULT_VIEW_ZOOM;
  return VIEW_ZOOM_STEPS.includes(step) ? step : DEFAULT_VIEW_ZOOM;
}
