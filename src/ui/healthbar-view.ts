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
import type { PlayerId } from '@shared/types';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import {
  HEALTHBAR_GAP,
  HEALTHBAR_HEIGHT,
  HEALTHBAR_LOCAL_HEIGHT,
  HEALTHBAR_LOCAL_WIDTH,
  HEALTHBAR_WIDTH,
} from './healthbar';
import type { HealthBar } from './healthbar';

/** Layout-registry id for the health-bar layer (one entry, the union of bars). */
export const HEALTHBAR_ID = 'healthbars';
/** Bars float over the world anywhere on screen — `full`, like the alarm arrow. */
export const HEALTHBAR_ANCHOR: AnchorSpec = { region: 'full' };

/** Alpha of the empty track behind the fill — present so a missing chunk reads
 *  as absence, not as nothing drawn. Steel, never a material colour of its own. */
const TRACK_ALPHA = 0.28;

/**
 * One bar the layer actually drew this frame (post-cull), captured only when
 * {@link HealthBarView.enableDebugCapture} has been called — the ?debug=1
 * live-stage seam behind {@link HealthBarView.debugBars}. It exists because the
 * enemy bars shipped dead twice: the model was green but nothing on a real boot
 * proved a *drawn* bar tracked a damaged enemy. This lets a Playwright test read
 * that out of the running client. Never allocated or written in a normal build.
 */
export interface DrawnHealthBar {
  owner: PlayerId;
  fraction: number;
  /** Bar centre-x in screen space, CSS px (the entity the bar tracks). */
  x: number;
  /** Bar-top y in screen space, CSS px. */
  y: number;
  /** True for the local player's own-ship bar (drawn in the distinct style) —
   *  so a live-stage test can assert the own ship's bar is the one styled mine. */
  local: boolean;
}

export class HealthBarView extends Container {
  private readonly bars: Graphics[] = [];
  /** Union of the rects drawn this frame, or null when nothing drew — what the
   *  registry records (only what is actually on screen). */
  private drawnBounds: Rect | null = null;

  // --- ?debug=1 live-stage capture (off in every normal build) -------------
  /** When true, each drawn bar is recorded into {@link debugDrawn} for the
   *  live-stage harness. Left false unless {@link enableDebugCapture} is called. */
  private debugCapture = false;
  /** Pooled drawn-bar snapshots (grows to fit, never shrinks) and the count that
   *  drew last frame — read back by {@link debugBars}. */
  private readonly debugDrawn: DrawnHealthBar[] = [];
  private debugCount = 0;

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
      // The local (own-ship) bar is drawn slightly larger so it reads as "mine"
      // at a glance (field request v0.1.1); everyone else keeps the narrow bar.
      const width = bar.local ? HEALTHBAR_LOCAL_WIDTH : HEALTHBAR_WIDTH;
      const height = bar.local ? HEALTHBAR_LOCAL_HEIGHT : HEALTHBAR_HEIGHT;
      const left = bar.x - width / 2;
      const bottom = bar.y - bar.radius - HEALTHBAR_GAP;
      const top = bottom - height;

      // Cull anything that would spill off the canvas: an edge enemy is barely
      // visible anyway, and a partial bar would break the `full` contract.
      if (left < 0 || top < 0 || left + width > viewportWidth || top + height > viewportHeight) {
        continue;
      }

      if (this.debugCapture) this.recordDebug(drawn, bar, top);
      const g = this.slot(drawn++);
      g.clear();
      // Track first, then the owner-colour fill over its left portion.
      g.roundRect(left, top, width, height, 1).fill({
        color: PALETTE.hullSteel,
        alpha: TRACK_ALPHA,
      });
      const fillW = width * bar.fraction;
      if (fillW > 0) {
        g.roundRect(left, top, fillW, height, 1).fill({ color: bar.color, alpha: 0.95 });
      }
      // The own ship's bar carries an identity-colour outline — the second half
      // of "reads as mine" (larger + framed), so it stands out from the field of
      // enemy bars without borrowing a reserved colour (style-guide §2 / §3).
      if (bar.local) {
        g.roundRect(left, top, width, height, 1).stroke({ width: 1, color: bar.color, alpha: 0.9 });
      }

      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (left + width > maxX) maxX = left + width;
      if (top + height > maxY) maxY = top + height;
    }

    this.hideFrom(drawn);
    this.drawnBounds =
      drawn > 0 ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
    this.debugCount = this.debugCapture ? drawn : 0;
  }

  // --- ?debug=1 live-stage seam --------------------------------------------

  /** Turn on capture of the drawn bars so {@link debugBars} reports them. The
   *  live-stage harness (main.ts, only under ?debug=1) calls this once; a normal
   *  build never does, so the record path stays cold. Idempotent. */
  enableDebugCapture(): void {
    this.debugCapture = true;
  }

  /** The bars that actually drew last frame (post-cull) — owner, fill fraction,
   *  and screen position of each — for a live-stage test to assert a real bar
   *  tracks a damaged enemy. Empty unless {@link enableDebugCapture} was called. */
  debugBars(): DrawnHealthBar[] {
    return this.debugDrawn.slice(0, this.debugCount);
  }

  /** Record one drawn bar into the reusable pool at `i` (grows to fit). Only
   *  reached under {@link debugCapture}, so it costs nothing in a normal build. */
  private recordDebug(i: number, bar: HealthBar, top: number): void {
    let d = this.debugDrawn[i];
    if (!d) {
      d = { owner: bar.owner, fraction: bar.fraction, x: bar.x, y: top, local: bar.local };
      this.debugDrawn[i] = d;
      return;
    }
    d.owner = bar.owner;
    d.fraction = bar.fraction;
    d.x = bar.x;
    d.y = top;
    d.local = bar.local;
  }

  /**
   * The layer's registry entry — the union of the bars that drew, or nothing
   * when the field is clean (every enemy full and idle).
   *
   * The bounds are reported in GLOBAL (physical) space via {@link getBounds}, the
   * same discipline the HUD's other elements use through `Hud.describeLayout`'s
   * `push` helper: the layout host reads a `describeLayout` seam as physical Pixi
   * bounds and un-rotates them into the logical viewport itself
   * (`physicalBoundsToLogical` in main.ts). The bars draw as children of the
   * rotating game root, so their on-screen union IS `getBounds()`. Returning the
   * layer's own-space `drawnBounds` (already logical) would double-count the
   * landscape lock's 90° rotation and register a portrait-held bar off-screen —
   * the same space mismatch PR #93 fixed for the nameplate layer, which this
   * mirrors exactly. `drawnBounds` stays the "did any bar draw" sentinel. (In the
   * frozen-scene layout contract no enemy is on screen and no own-ship bar draws,
   * so this path never registered under rotation before — the bug was latent.)
   */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible || !this.drawnBounds) return [];
    const b = this.getBounds();
    return [{ id: HEALTHBAR_ID, anchor: HEALTHBAR_ANCHOR, bounds: { x: b.x, y: b.y, width: b.width, height: b.height } }];
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
