/**
 * src/ui/ore-hold-view.ts — the pooled Pixi layer for the under-ship ore-hold
 * indicator. OWNER: UI Engineer.
 *
 * The drawing half of {@link ./ore-hold}. It paints the compact pip row the pure
 * model decided, in **screen space** (the model already projected it relative to
 * the ship's screen position), so the row is a fixed size regardless of camera
 * zoom — the same discipline as the over-ship health bar ({@link ./healthbar-view}).
 *
 * **One Graphics, redrawn (not a per-pip pool).** The row is a single element of
 * at most `cargoCap` (≤ 8) pips, so it is drawn as one cleared-and-redrawn
 * Graphics — the allocation-free idiom the planet-HP / hull bars already use —
 * rather than a pool of per-pip objects. The layer allocates nothing per frame.
 *
 * **Registered under `full`.** The indicator follows the ship anywhere on screen,
 * so like the health-bar layer and the alarm's edge arrow it claims the whole
 * viewport as its zone ([[layout-registry]]). To keep that honest, a row that
 * would leave the viewport is culled this frame; the registered bounds are the
 * row that actually drew, so it always sits inside `full`.
 *
 * Signal yellow is ORE (style-guide §2, RESERVED) — the pips are among the few
 * things allowed to be yellow, and the reason the rule exists is so a glance
 * under the ship can be trusted to mean "this is the ore I'm carrying."
 */

import { Container, Graphics } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { ORE_HOLD_PIP, ORE_HOLD_PIP_GAP, oreHoldBounds, oreHoldRowWidth } from './ore-hold';
import type { OreHold } from './ore-hold';

/** Layout-registry id for the under-ship hold indicator (one entry, the pip row). */
export const ORE_HOLD_ID = 'ore-hold';
/** It floats over the world under the ship, anywhere on screen — `full`, like the
 *  health-bar layer and the alarm arrow. */
export const ORE_HOLD_ANCHOR: AnchorSpec = { region: 'full' };

/** Alpha of an empty (ghost) pip — faint, so unfilled capacity reads as "room to
 *  carry more" without competing with the filled ore. Still yellow: an empty
 *  cargo slot is still an *ore* slot (style-guide §2). */
const GHOST_ALPHA = 0.15;
/** Dim alpha a filled pip drops to on the "off" half of the full-hold flash. */
const FULL_FLASH_DIM = 0.45;

/**
 * The row the layer actually drew this frame (post-cull), read back by the
 * ?debug=1 live-stage seam ({@link OreHoldView.debugHold}). It exists so a
 * Playwright test can prove a *drawn* indicator tracks the ship's screen position
 * with the pip count sim hold implies — the same reason the health-bar layer
 * exposes its drawn bars. Kept as one reused object; cheap in every build.
 */
export interface DrawnOreHold {
  /** Row centre-x in screen space, CSS px (the ship the row tracks). */
  x: number;
  /** Row-top y in screen space, CSS px. */
  y: number;
  /** Total pips drawn (cargo slots). */
  slots: number;
  /** Filled pips drawn (whole ore held). */
  filled: number;
  /** True when the hold is full. */
  full: boolean;
}

export class OreHoldView extends Container {
  private readonly pips = new Graphics();
  /** The rect drawn this frame, or null when nothing drew — what the registry
   *  records (only what is actually on screen). */
  private drawnBounds: Rect | null = null;
  /** The row drawn this frame (position + counts), or null — the live-stage seam
   *  reads this back through {@link debugHold}. */
  private drawn: DrawnOreHold | null = null;

  constructor() {
    super();
    this.addChild(this.pips);
  }

  /**
   * Draw one frame. `hold` comes from {@link oreHoldModel} (`null` ⇒ hide);
   * `flashOn` is {@link oreFlashOn} for this frame, so a full hold blinks in step
   * with the top-left total's own full-flash. The row is centred on the ship's
   * screen x and hung below it, and culled whole if it would spill off the canvas.
   */
  update(hold: OreHold | null, flashOn: boolean, viewportWidth: number, viewportHeight: number): void {
    this.pips.clear();
    if (!hold) {
      this.drawnBounds = null;
      this.drawn = null;
      return;
    }

    const b = oreHoldBounds(hold);
    // Cull anything that would spill off the canvas: a partial row would break the
    // `full` contract, and an indicator half off-screen is worse than none.
    if (b.x < 0 || b.y < 0 || b.x + b.width > viewportWidth || b.y + b.height > viewportHeight) {
      this.drawnBounds = null;
      this.drawn = null;
      return;
    }

    let x = b.x;
    for (let i = 0; i < hold.slots; i++) {
      const filled = i < hold.filled;
      this.pips.roundRect(x, b.y, ORE_HOLD_PIP, ORE_HOLD_PIP, 2);
      if (filled) {
        // Filled ore pip: signal yellow, dimming on the flash's off-beat when full.
        this.pips.fill({ color: PALETTE.signalYellow, alpha: hold.full && !flashOn ? FULL_FLASH_DIM : 1 });
      } else {
        // Ghost pip: faint, so unfilled capacity is visible (upgrades widen it).
        this.pips.fill({ color: PALETTE.signalYellow, alpha: GHOST_ALPHA });
      }
      x += ORE_HOLD_PIP + ORE_HOLD_PIP_GAP;
    }

    this.drawnBounds = b;
    this.drawn = { x: hold.x, y: b.y, slots: hold.slots, filled: hold.filled, full: hold.full };
  }

  /** The layer's registry entry — the pip row that drew, or nothing when the hold
   *  is empty and idle (the indicator is hidden). */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible || !this.drawnBounds) return [];
    return [{ id: ORE_HOLD_ID, anchor: ORE_HOLD_ANCHOR, bounds: { ...this.drawnBounds } }];
  }

  /** The row the layer actually drew last frame (post-cull) — screen position and
   *  pip counts — for the live-stage test, or null when hidden/culled. A fresh
   *  copy so a reader cannot mutate the layer's own state. */
  debugHold(): DrawnOreHold | null {
    return this.drawn ? { ...this.drawn } : null;
  }
}

/** Re-export so a caller sizing the row (a test, the registry) needs one import. */
export { oreHoldRowWidth };
