/**
 * src/ui/nameplates-view.ts — the pooled Pixi layer that draws the name labels.
 * OWNER: UI Engineer (field request v0.2.1).
 *
 * The drawing half of {@link ./nameplates}. It takes the labels the pure model
 * decided and paints each as a small tinted {@link Text}, floating above its
 * entity in **screen space** (the model already projected world → screen), so the
 * labels are a fixed size regardless of camera zoom (field request rule 3) — the
 * same discipline as the over-ship health bars ({@link ./healthbar-view}).
 *
 * **The stack (field request rule 1).** A ship's three status marks read as one
 * unit: the **name** on top, the **health bar** below it, the **ship** under that.
 * So a ship label is floated clear of the health-bar cluster — above the bar's own
 * top, using the same bar geometry the bar layer draws with ({@link ./healthbar}
 * `HEALTHBAR_*`), so the name can *never* cover the bar (rule 3). A planet label
 * sits above the planet, clear of its HP pin / damage ring, by the planet's own
 * screen radius plus a gap.
 *
 * **Pooling (GDD §4.3, risk 5).** Text objects are allocated once and reused: a
 * frame with N labels touches the first N pooled Texts (set text/tint/position —
 * a Text re-rasterises only when its *string* changes, which is rare in a stable
 * scene) and hides the rest. Colour is applied as a cheap GPU {@link Text.tint}
 * over a white glyph, so re-tinting a slot to a new owner costs no re-raster.
 *
 * **Registered under `full`.** Labels appear wherever their entities are, so like
 * the health bars and the alarm's edge arrow they claim the whole viewport as
 * their zone ([[layout-registry]]). A label whose rect would leave the viewport is
 * culled this frame; the registered bounds are the union of what actually drew, so
 * it always sits inside `full`.
 *
 * Typography: **Oxanium** (style-guide §5.6 — the HUD body face, "designed for
 * game interfaces, holds up at 12px"), the legibility pick over the wider display
 * Audiowide for a compact name floating over a 24px ship. Never signal yellow /
 * threat red — those are RESERVED (style-guide §2); the tint is the player's
 * identity colour, which the model already resolved.
 */

import { Container, Text } from 'pixi.js';
import type { PlayerId } from '@shared/types';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { HEALTHBAR_GAP, HEALTHBAR_HEIGHT, HEALTHBAR_LOCAL_HEIGHT } from './healthbar';
import type { Nameplate, NameplateKind } from './nameplates';

/** Layout-registry id for the nameplate layer (one entry, the union of labels). */
export const NAMEPLATE_ID = 'nameplates';
/** Labels float over the world anywhere on screen — `full`, like the health bars. */
export const NAMEPLATE_ANCHOR: AnchorSpec = { region: 'full' };

/** Oxanium — the HUD body face (style-guide §5.6). Fallback until it self-hosts. */
const FONT_NAME = 'Oxanium, "DejaVu Sans Mono", monospace';
/** Label size, CSS px — small chrome over the world, legible at thumb-scale. */
const FONT_SIZE = 12;

/** Clearance above a ship's health-bar cluster to the label's baseline, CSS px —
 *  so name, bar and ship stack as one unit without touching. */
export const NAMEPLATE_SHIP_GAP = 3;
/** Clearance above a planet's screen radius (its HP pin) to the label, CSS px. */
export const NAMEPLATE_PLANET_GAP = 8;

/**
 * One label the layer actually drew this frame (post-cull), captured only when
 * {@link NameplateView.enableDebugCapture} has been called — the ?debug=1
 * live-stage seam behind {@link NameplateView.debugPlates}. It lets a Playwright
 * test read back that a *drawn* label, with the lobby's text and the owner's
 * colour, tracks a given ship/planet on a real boot (the same discipline the
 * health bars needed after shipping dead twice). Never written in a normal build.
 */
export interface DrawnNameplate {
  owner: PlayerId;
  kind: NameplateKind;
  /** The text drawn. */
  text: string;
  /** The tint (owner identity colour) applied. */
  color: number;
  /** Label centre-x in screen space, CSS px (the entity it tracks). */
  x: number;
  /** Label-top y in screen space, CSS px. */
  y: number;
  /** True for the local player's own-ship label. */
  local: boolean;
}

export class NameplateView extends Container {
  private readonly labels: Text[] = [];
  /** Union of the rects drawn this frame, or null when nothing drew. */
  private drawnBounds: Rect | null = null;

  // --- ?debug=1 live-stage capture (off in every normal build) -------------
  private debugCapture = false;
  private readonly debugDrawn: DrawnNameplate[] = [];
  private debugCount = 0;

  /**
   * Draw one frame of labels into the given viewport. `plates` come from
   * {@link nameplateModel}; each is centred on its entity and floated above the
   * entity's status cluster.
   */
  update(plates: readonly Nameplate[], viewportWidth: number, viewportHeight: number): void {
    let drawn = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const plate of plates) {
      const t = this.slot(drawn);
      // A Text re-rasterises only when its string changes — cheap in a stable
      // scene where slot i keeps tracking the same entity across frames.
      if (t.text !== plate.text) t.text = plate.text;
      t.tint = plate.color;
      t.alpha = plate.alpha;

      // Bottom-centre anchor: position the label's baseline just above the
      // entity's status cluster, so it grows upward and never into the bar/ship.
      const bottom = plate.y - this.clusterClearance(plate);
      const width = t.width;
      const height = t.height;
      const left = plate.x - width / 2;
      const top = bottom - height;

      // Cull anything that would spill off the canvas: a partial label reads worse
      // than none, and a clipped rect would break the `full` contract.
      if (left < 0 || top < 0 || left + width > viewportWidth || top + height > viewportHeight) {
        continue;
      }

      t.visible = true;
      t.position.set(plate.x, bottom);
      if (this.debugCapture) this.recordDebug(drawn, plate, top);
      drawn++;

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

  /** Vertical clearance from the entity centre to the label's bottom edge, so the
   *  label clears the entity's status cluster (a ship's health bar, a planet's HP
   *  pin) and the three stack as one unit (field request rule 1). */
  private clusterClearance(plate: Nameplate): number {
    if (plate.kind === 'planet') return plate.radius + NAMEPLATE_PLANET_GAP;
    // Ship: clear the sprite, the bar gap, and the bar itself, then a hair more.
    const barHeight = plate.local ? HEALTHBAR_LOCAL_HEIGHT : HEALTHBAR_HEIGHT;
    return plate.radius + HEALTHBAR_GAP + barHeight + NAMEPLATE_SHIP_GAP;
  }

  // --- ?debug=1 live-stage seam --------------------------------------------

  /** Turn on capture of the drawn labels so {@link debugPlates} reports them. The
   *  live-stage harness (main.ts, only under ?debug=1) calls this once; a normal
   *  build never does, so the record path stays cold. Idempotent. */
  enableDebugCapture(): void {
    this.debugCapture = true;
  }

  /** The labels that actually drew last frame (post-cull) — owner, text, colour,
   *  kind and screen position — for a live-stage test to assert a real label
   *  tracks a ship/planet. Empty unless {@link enableDebugCapture} was called. */
  debugPlates(): DrawnNameplate[] {
    return this.debugDrawn.slice(0, this.debugCount).map((d) => ({ ...d }));
  }

  /** Record one drawn label into the reusable pool at `i` (grows to fit). Only
   *  reached under {@link debugCapture}, so it costs nothing in a normal build. */
  private recordDebug(i: number, plate: Nameplate, top: number): void {
    let d = this.debugDrawn[i];
    if (!d) {
      d = { owner: plate.owner, kind: plate.kind, text: plate.text, color: plate.color, x: plate.x, y: top, local: plate.local };
      this.debugDrawn[i] = d;
      return;
    }
    d.owner = plate.owner;
    d.kind = plate.kind;
    d.text = plate.text;
    d.color = plate.color;
    d.x = plate.x;
    d.y = top;
    d.local = plate.local;
  }

  /** The layer's registry entry — the union of the labels that drew, or nothing
   *  when no entity is on screen to name. */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible || !this.drawnBounds) return [];
    return [{ id: NAMEPLATE_ID, anchor: NAMEPLATE_ANCHOR, bounds: { ...this.drawnBounds } }];
  }

  private slot(i: number): Text {
    let t = this.labels[i];
    if (!t) {
      t = new Text({
        text: '',
        style: { fontFamily: FONT_NAME, fontSize: FONT_SIZE, fill: 0xffffff, letterSpacing: 0.5 },
      });
      t.anchor.set(0.5, 1); // bottom-centre: grows upward from the entity
      this.labels[i] = t;
      this.addChild(t);
    }
    return t;
  }

  private hideFrom(count: number): void {
    for (let i = count; i < this.labels.length; i++) {
      const t = this.labels[i];
      if (t) t.visible = false;
    }
  }
}
