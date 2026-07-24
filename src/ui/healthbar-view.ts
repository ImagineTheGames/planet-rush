/**
 * src/ui/healthbar-view.ts — the pooled Pixi layer that draws the health bars.
 * OWNER: UI Engineer.
 *
 * The drawing half of {@link ./healthbar}. It takes the bars the pure model
 * decided and paints each as a short two-part rectangle — a dim steel track with
 * the owner-colour fill over it — floating just above its entity, in **screen
 * space** (the model already projected world → screen), so the bars are a fixed
 * size regardless of camera zoom (GDD field report).
 *
 * **Pooling, the sprite-atlas discipline (GDD §4.3, risk 5).** Graphics are
 * allocated once and reused: a frame with N bars touches the first N pooled
 * objects (clear + redraw — no new geometry object per bar) and hides the rest.
 * A brawl with a dozen enemies allocates nothing per frame after warm-up, the
 * same rule the renderer's pools hold to.
 *
 * **Registered under `full`.** Bars appear wherever their entities are, so like
 * the alarm's screen-edge arrow they claim the whole viewport as their zone
 * ([[layout-registry]]). To keep that honest — and to avoid drawing a bar half
 * off the canvas — a bar whose rect would leave the viewport is culled this
 * frame; the registered bounds are the union of what actually drew, so it always
 * sits inside `full`.
 */

import { Container, Graphics } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { HEALTHBAR_GAP, HEALTHBAR_HEIGHT, HEALTHBAR_WIDTH } from './healthbar';
import type { HealthBar } from './healthbar';

/** Layout-registry id for the health-bar layer (one entry, the union of bars). */
export const HEALTHBAR_ID = 'healthbars';
/** Bars float over the world anywhere on screen — `full`, like the alarm arrow. */
export const HEALTHBAR_ANCHOR: AnchorSpec = { region: 'full' };

/** Alpha of the empty track behind the fill — present so a missing chunk reads
 *  as absence, not as nothing drawn. Steel, never a material colour of its own. */
const TRACK_ALPHA = 0.28;

export class HealthBarView extends Container {
  private readonly bars: Graphics[] = [];
  /** Union of the rects drawn this frame, or null when nothing drew — what the
   *  registry records (only what is actually on screen). */
  private drawnBounds: Rect | null = null;

  /**
   * Draw one frame of bars into the given viewport. `bars` come from
   * {@link healthBarModel}; each is centred on its entity and floated above it.
   */
  update(bars: readonly HealthBar[], viewportWidth: number, viewportHeight: number): void {
    let drawn = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const bar of bars) {
      const left = bar.x - HEALTHBAR_WIDTH / 2;
      const bottom = bar.y - bar.radius - HEALTHBAR_GAP;
      const top = bottom - HEALTHBAR_HEIGHT;

      // Cull anything that would spill off the canvas: an edge enemy is barely
      // visible anyway, and a partial bar would break the `full` contract.
      if (left < 0 || top < 0 || left + HEALTHBAR_WIDTH > viewportWidth || top + HEALTHBAR_HEIGHT > viewportHeight) {
        continue;
      }

      const g = this.slot(drawn++);
      g.clear();
      // Track first, then the owner-colour fill over its left portion.
      g.roundRect(left, top, HEALTHBAR_WIDTH, HEALTHBAR_HEIGHT, 1).fill({
        color: PALETTE.hullSteel,
        alpha: TRACK_ALPHA,
      });
      const fillW = HEALTHBAR_WIDTH * bar.fraction;
      if (fillW > 0) {
        g.roundRect(left, top, fillW, HEALTHBAR_HEIGHT, 1).fill({ color: bar.color, alpha: 0.95 });
      }

      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (left + HEALTHBAR_WIDTH > maxX) maxX = left + HEALTHBAR_WIDTH;
      if (top + HEALTHBAR_HEIGHT > maxY) maxY = top + HEALTHBAR_HEIGHT;
    }

    this.hideFrom(drawn);
    this.drawnBounds =
      drawn > 0 ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
  }

  /** The layer's registry entry — the union of the bars that drew, or nothing
   *  when the field is clean (every enemy full and idle). */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible || !this.drawnBounds) return [];
    return [{ id: HEALTHBAR_ID, anchor: HEALTHBAR_ANCHOR, bounds: { ...this.drawnBounds } }];
  }

  private slot(i: number): Graphics {
    let g = this.bars[i];
    if (!g) {
      g = new Graphics();
      this.bars[i] = g;
      this.addChild(g);
    }
    g.visible = true;
    return g;
  }

  private hideFrom(count: number): void {
    for (let i = count; i < this.bars.length; i++) {
      const g = this.bars[i];
      if (g) g.visible = false;
    }
  }
}
