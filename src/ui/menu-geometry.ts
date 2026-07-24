/**
 * src/ui/menu-geometry.ts — the shared ruler for the flat menu screens.
 * OWNER: UI Engineer.
 *
 * {@link ./lobby-geometry} is the responsive, two-column, keypad-packing layout
 * the lobby and the entry door need. The three screens that came with the Day-7
 * menus — settings, the end-of-match summary, and the connection overlay — are
 * none of those things: each is a title and a short stack of full-width rows,
 * centred in the safe area. This module is the handful of primitives that shape
 * all three, so a settings row and a summary button are placed by the same rule
 * and inset from a notch by the same margin.
 *
 * Pure geometry, PixiJS-free, same discipline as its sibling: space is handed
 * out top-down and every block is *capped* rather than stretched, so nothing can
 * escape the content box on a desktop and nothing is untappable on a phone.
 */

import type { Rect, Viewport } from '@platform/layout-registry';
import type { Insets } from './lobby-geometry';

export type { Insets };

/** The uniform page margin, matching the lobby's `LOBBY_PAD` so a player moving
 *  between screens never sees the content jump inward or outward. */
export const MENU_PAD = 16;

/** Gap between stacked rows / buttons. */
export const MENU_ROW_GAP = 12;

/** A comfortable reading column: menus don't sprawl to a 1080p width — a row of
 *  text 900px wide is a worse control than the same row at 480 centred. */
export const MENU_COLUMN_MAX = 480;

/**
 * The viewport inset by the safe area and then by {@link MENU_PAD}. Never
 * negative — a comically small viewport yields a zero-extent box, not a
 * backwards one — exactly like `./lobby-geometry` `contentBox`, kept in step
 * with it so the two families of screen share one frame.
 */
export function menuContent(viewport: Viewport, insets?: Insets, pad = MENU_PAD): Rect {
  const left = pad + Math.max(0, insets?.left ?? 0);
  const right = pad + Math.max(0, insets?.right ?? 0);
  const top = pad + Math.max(0, insets?.top ?? 0);
  const bottom = pad + Math.max(0, insets?.bottom ?? 0);
  return {
    x: left,
    y: top,
    width: Math.max(0, viewport.width - left - right),
    height: Math.max(0, viewport.height - top - bottom),
  };
}

/**
 * A column of `count` equal rows, each `width` wide and at most `maxRowHeight`
 * tall, centred both ways in `band`. Rows compress before they overflow: on a
 * short landscape phone the stack shrinks to fit rather than running off the
 * bottom edge.
 */
export function centeredColumn(
  band: Rect,
  count: number,
  width: number,
  maxRowHeight: number,
  gap = MENU_ROW_GAP,
): Rect[] {
  if (count <= 0) return [];
  const w = Math.min(width, band.width);
  const available = band.height - (count - 1) * gap;
  const height = Math.max(0, Math.min(maxRowHeight, available / count));
  const total = count * height + (count - 1) * gap;
  const top = band.y + Math.max(0, (band.height - total) / 2);
  const x = band.x + (band.width - w) / 2;
  const rows: Rect[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ x, y: top + i * (height + gap), width: w, height });
  }
  return rows;
}

/**
 * A single panel of at most `width` × `height`, centred in the content box.
 * The connection overlay and any confirm dialog use this: one card, in the
 * middle, never wider than it needs to be.
 */
export function centeredPanel(
  viewport: Viewport,
  width: number,
  height: number,
  insets?: Insets,
): Rect {
  const content = menuContent(viewport, insets);
  const w = Math.min(width, content.width);
  const h = Math.min(height, content.height);
  return {
    x: content.x + (content.width - w) / 2,
    y: content.y + (content.height - h) / 2,
    width: w,
    height: h,
  };
}

/** Whether `(x, y)` falls inside `rect`. Zero-extent rects (a row squeezed to
 *  nothing on a tiny viewport) are never hit, so an invisible control is also an
 *  untappable one — the same rule `./lobby-geometry` keeps. */
export function hitRect(rect: Rect, x: number, y: number): boolean {
  return rect.width > 0 && rect.height > 0 && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Clamp `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
