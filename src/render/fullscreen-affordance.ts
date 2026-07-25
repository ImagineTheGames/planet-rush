/**
 * src/render/fullscreen-affordance.ts — the re-enter-fullscreen button. OWNER:
 * Platform Engineer.
 *
 * Field request (v0.1.1): when the player backs out of fullscreen (a system
 * gesture or ESC), the game keeps running and "a small unobtrusive re-enter
 * affordance appears." This is that button — a tiny expand glyph in the top-right
 * corner, drawn only while the game is *not* fullscreen but could be (the
 * {@link FullscreenLifecycle} decides *when*; this layer is the *view*).
 *
 * It is registered in the layout registry ({@link FS_AFFORDANCE_ANCHOR}) so its
 * placement is asserted rather than eyeballed — "no dead corners" (field request
 * requirement 2). Thumb-scale hit target (≥44px) so it is tappable on a phone.
 *
 * Style (style-guide §1/§2): plasma `#4DC3FF` stroke on a faint fill — an
 * interactive/energy affordance, pointedly NOT signal-yellow (RESERVED: ore or
 * danger) nor threat-red. Geometry is drawn once; the frame path only moves it
 * and toggles `visible`, so it makes zero per-frame allocations (GDD §4.3).
 */

import { Container, Graphics } from 'pixi.js';
import type { AnchorSpec, Rect } from '@platform/layout-registry';
import { PALETTE } from './index';

/** Registry id — the layout registry asserts this element's placement. */
export const FS_AFFORDANCE_ID = 'fullscreen-reenter';

/** Inset from the top and right viewport edges, CSS px. */
export const FS_AFFORDANCE_MARGIN = 12;

/** Declared placement (layout-registry vocabulary): the top-right corner, the
 *  conventional home of a fullscreen toggle and clear of the bottom-half sticks. */
export const FS_AFFORDANCE_ANCHOR: AnchorSpec = { region: 'top-right', margin: FS_AFFORDANCE_MARGIN };

/** Button radius — 24px so the 48px hit target clears the thumb-scale minimum. */
export const FS_AFFORDANCE_RADIUS = 24;

/**
 * Where the button's rect sits for a given viewport: hugging the top-right
 * corner, inset by {@link FS_AFFORDANCE_MARGIN}. Pure and allocation-free (writes
 * into `out`) so placement is unit-testable without a canvas.
 */
export function writeAffordanceRect(viewportW: number, viewportH: number, out: Rect): Rect {
  void viewportH;
  const d = 2 * FS_AFFORDANCE_RADIUS;
  out.width = d;
  out.height = d;
  out.x = viewportW - FS_AFFORDANCE_MARGIN - d;
  out.y = FS_AFFORDANCE_MARGIN;
  return out;
}

/** The button's centre for a given viewport (top-right corner). */
function affordanceCenter(viewportW: number): { x: number; y: number } {
  return { x: viewportW - FS_AFFORDANCE_MARGIN - FS_AFFORDANCE_RADIUS, y: FS_AFFORDANCE_MARGIN + FS_AFFORDANCE_RADIUS };
}

/**
 * The re-enter-fullscreen affordance layer. Add once to the game root (so it
 * rides the landscape-lock rotation like every other logical-space element),
 * then call {@link update} each frame with visibility and the viewport size.
 */
export class FullscreenAffordance extends Container {
  /** Reused bounds record; handed to the layout registry, which copies it. */
  private readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor() {
    super();
    this.label = FS_AFFORDANCE_ID;

    const r = FS_AFFORDANCE_RADIUS;
    // Faint rounded backdrop so the glyph reads against a busy field — plasma,
    // low alpha, unobtrusive by design (field request: "small unobtrusive").
    const backdrop = new Graphics();
    backdrop.roundRect(-r, -r, 2 * r, 2 * r, 8).fill({ color: PALETTE.plasma, alpha: 0.12 });
    backdrop.roundRect(-r, -r, 2 * r, 2 * r, 8).stroke({ width: 2, color: PALETTE.plasma, alpha: 0.7 });

    // Expand glyph: four corner brackets pointing outward — the universal
    // "enter fullscreen" mark, drawn once as static geometry.
    const glyph = new Graphics();
    const a = 9; // half-extent of the bracket field
    const t = 5; // bracket arm length
    const corners: ReadonlyArray<readonly [number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [sx, sy] of corners) {
      const cx = sx * a;
      const cy = sy * a;
      glyph.moveTo(cx - sx * t, cy).lineTo(cx, cy).lineTo(cx, cy - sy * t);
    }
    glyph.stroke({ width: 2.5, color: PALETTE.plasma, alpha: 0.95 });

    this.addChild(backdrop, glyph);
    this.visible = false;
  }

  /**
   * Draw one frame. `visible` comes from the {@link FullscreenLifecycle}; `w`/`h`
   * corner the button in the logical (landscape) viewport. Per-frame safe — only
   * a visibility flag and a position write.
   */
  update(visible: boolean, w: number, h: number): void {
    void h; // top-anchored: only the width decides the corner
    this.visible = visible;
    if (!visible) return;
    const c = affordanceCenter(w);
    this.position.set(c.x, c.y);
  }

  /** This frame's actual rendered rect, for the layout registry (screen px). */
  layoutBounds(w: number, h: number): Rect {
    return writeAffordanceRect(w, h, this.rect);
  }

  /** Does a logical-space point land on the button? The re-enter tap test — a
   *  circle test around the button centre, so a corner tap outside the rounded
   *  square doesn't count. Only meaningful while {@link update} last set visible. */
  hitTest(lx: number, ly: number, w: number, h: number): boolean {
    void h;
    const c = affordanceCenter(w);
    const dx = lx - c.x;
    const dy = ly - c.y;
    return dx * dx + dy * dy <= FS_AFFORDANCE_RADIUS * FS_AFFORDANCE_RADIUS;
  }
}
