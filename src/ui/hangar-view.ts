/**
 * src/ui/hangar-view.ts — the Pixi view for the hangar. OWNER: UI Engineer.
 *
 * The drawing half of {@link ./hangar}. Every value lives in the model and every
 * rect in `hangarLayout`; this file turns them into Graphics and Text and owns
 * nothing but which child is which.
 *
 * ---------------------------------------------------------------------------
 * THE SHIP IS THE REAL ONE
 * ---------------------------------------------------------------------------
 * The bay draws `shipSprite` from {@link ../art/ships} — the same generator the
 * match renders with (`src/render/index.ts`), through the same
 * {@link ../art/textures} `drawSprite` — scaled to fill the bay. Not a picture
 * of a ship, and not a second drawing of one: if a hull changes shape, the
 * hangar shows the change without anybody remembering to update it, which is the
 * only way a preview stays honest.
 *
 * It is drawn at **slot 0's colour**, deliberately: player colour is the
 * roster's, assigned by seat in the lobby, so the hangar showing "your colour"
 * would be showing a colour the next lobby may not give you.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE
 * ---------------------------------------------------------------------------
 * Same material as the title and settings screens: a header beam carrying
 * HANGAR, a footer beam carrying BACK, and `inert` panels in between — surfaces
 * that hold content rather than plates that stand off the screen. BACK is this
 * screen's one bright plate, which is the whole of what Bone has for saying
 * "this is the action". No hue is spent anywhere: the XP bar is chalk metal on
 * shaded metal, exactly like the settings screen's volume pips, so signal yellow
 * keeps meaning ore and threat red keeps meaning danger (style-guide §1–§2).
 */

import { Container, Graphics, Text } from 'pixi.js';
import {
  BONE,
  DISPLAY_TRACKING,
  MATERIAL_SHADES,
  ROW,
  TRACKING,
  drawBeam,
  drawPlate,
  plateTypeSize,
  trackingPx,
  typeSize,
} from '../art/materials';
import type { FrameMetrics } from '../art/materials';
import { PALETTE } from '@render/index';
import { shipSprite } from '../art/ships';
import { drawSprite } from '../art/textures';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_BODY, FONT_HEADING } from './typography';
import { HANGAR_BAY_PLATE, HANGAR_ID, hangarHitTest, hangarLayout } from './hangar';
import type { HangarLayout, HangarModel, HangarRowView, HangarTarget } from './hangar';
import type { Insets } from './menu-geometry';
import { ScreenCache } from './screen-cache';

export const HANGAR_ANCHOR: AnchorSpec = { region: 'full' };

/** Reference type sizes, read off the handoff's settings screen so the two
 *  secondary screens are set at the same sizes. */
const HEADING_PX = 22;
const EYEBROW_PX = 12;
const BACK_PX = 22;
const SHIP_NAME_PX = 20;
const SHIP_HULL_PX = 13;
const SHIP_BLURB_PX = 12;
const LEVEL_PX = 34;
const XP_PX = 13;
const ROW_NAME_PX = 15;
const ROW_SLOT_PX = 11;
const ROW_ACTION_PX = 13;
const EMPTY_PX = 13;

/** How much of the bay the ship may claim, leaving room for its name below and
 *  air around it. A ship pinned to the walls of its own bay reads as clipped. */
const SHIP_FILL = 0.7;
/** The share of the bay's height the caption block (name / hull / blurb) takes. */
const CAPTION_SHARE = 0.34;

interface RowNodes {
  readonly body: Graphics;
  readonly name: Text;
  readonly slot: Text;
  readonly action: Text;
}

/**
 * The hangar. Add once, {@link resize} on every viewport change, {@link update}
 * each frame with a {@link HangarModel}; hide it when the flow leaves.
 */
export class HangarView extends Container {
  private readonly backdrop = new Graphics();
  /** Whether the shell has put the real void behind this screen (a0-79). */
  private voidBehind = false;
  private readonly beams = new Graphics();
  private readonly panels = new Graphics();
  private readonly heading: Text;
  private readonly eyebrow: Text;
  /** The real generated hull, redrawn only when the class or the bay changes. */
  private readonly shipArt = new Graphics();
  private readonly shipName: Text;
  private readonly shipHull: Text;
  private readonly shipBlurb: Text;
  private readonly levelLabel: Text;
  private readonly xpLabel: Text;
  private readonly nextLabel: Text;
  private readonly matchesLabel: Text;
  private readonly emptyLine: Text;
  private readonly rowNodes: RowNodes[] = [];
  private readonly backBody = new Graphics();
  private readonly backLabel: Text;
  /** The hangar is static between state changes — see ./screen-cache. */
  private readonly cache = new ScreenCache(this);

  private layout: HangarLayout;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = hangarLayout({ width: screenWidth, height: screenHeight }, opts(isTouch, insets));

    this.heading = makeText('', FONT_HEADING, HEADING_PX, MATERIAL_SHADES.bone, 0, 0.5);
    this.eyebrow = makeText('', FONT_BODY, EYEBROW_PX, MATERIAL_SHADES.boneLo, 1, 0.5);
    this.shipName = makeText('', FONT_HEADING, SHIP_NAME_PX, BONE.hi, 0.5, 0.5);
    this.shipHull = makeText('', FONT_BODY, SHIP_HULL_PX, MATERIAL_SHADES.boneLo, 0.5, 0.5);
    this.shipBlurb = makeText('', FONT_BODY, SHIP_BLURB_PX, MATERIAL_SHADES.boneLo, 0.5, 0);
    this.shipBlurb.style.wordWrap = true;
    this.levelLabel = makeText('', FONT_HEADING, LEVEL_PX, BONE.hi, 0, 1);
    this.xpLabel = makeText('', FONT_BODY, XP_PX, MATERIAL_SHADES.bone, 1, 1);
    this.nextLabel = makeText('', FONT_BODY, XP_PX, MATERIAL_SHADES.boneLo, 0, 0);
    this.matchesLabel = makeText('', FONT_BODY, XP_PX, MATERIAL_SHADES.boneLo, 1, 0);
    this.emptyLine = makeText('', FONT_BODY, EMPTY_PX, MATERIAL_SHADES.boneLo, 0.5, 0.5);
    this.emptyLine.style.wordWrap = true;
    this.backLabel = makeText('', FONT_HEADING, BACK_PX, BONE.hi, 0.5, 0.5);

    this.addChild(
      this.backdrop,
      this.beams,
      this.panels,
      this.heading,
      this.eyebrow,
      this.shipArt,
      this.shipName,
      this.shipHull,
      this.shipBlurb,
      this.levelLabel,
      this.xpLabel,
      this.nextLabel,
      this.matchesLabel,
      this.emptyLine,
      this.backBody,
      this.backLabel,
    );
  }

  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.layout = hangarLayout({ width, height }, opts(isTouch, insets));
    // The cached texture is the size the OLD viewport rasterised to; refreshing
    // it in place would blit a stale-sized screen, so drop it (./screen-cache).
    this.cache.invalidate();
  }


  /**
   * Tell this screen that **something else already paints the whole viewport
   * behind it** — the real {@link ../art/backdrop} `VoidBackdrop`, put there by
   * the menu shell (a0-79, `./menu-backdrop`).
   *
   * A screen paints its own ground by default, and that default is the safe one:
   * a view shown with nothing behind it still owns its screen. This is how the
   * shell says otherwise, and it is a *statement about the scene graph* rather
   * than a style knob — which is why it is a method the shell calls once and not
   * a colour or an alpha somebody can tune.
   *
   * Invalidates the screen cache, because the cached texture is a rasterisation
   * of the old answer ({@link ./screen-cache}).
   */
  setVoidBehind(on: boolean): void {
    if (on === this.voidBehind) return;
    this.voidBehind = on;
    this.cache.invalidate();
  }

  hitTest(x: number, y: number): HangarTarget | null {
    return hangarHitTest(this.layout, x, y);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: HANGAR_ID, anchor: HANGAR_ANCHOR, bounds: { ...this.layout.content } }];
  }

  update(model: HangarModel): void {
    if (!this.visible) return;
    const signature = JSON.stringify(model);
    if (this.cache.unchanged(signature)) return;
    const { header, footer, title, bay, levelPanel, xpBar, list, rows, back, metrics } = this.layout;

    // Near-opaque over the whole viewport: the hangar is a full screen, not an
    // overlay, and nothing behind it should read through — unless what is behind
    // it is the real void the shell put there (a0-79; see `setVoidBehind`).
    this.backdrop.clear();
    if (!this.voidBehind) {
      this.backdrop
        .rect(0, 0, header.x * 2 + header.width, footer.y + footer.height + header.y)
        .fill({ color: PALETTE.vacuum, alpha: 0.98 });
    }

    this.beams.clear();
    if (header.height > 0) drawBeam(this.beams, header.x, header.y, header.width, 'header', true, header.height);
    if (footer.height > 0) drawBeam(this.beams, footer.x, footer.y, footer.width, 'footer', true, footer.height);

    this.panels.clear();
    this.drawHeader(model, title, metrics);
    this.drawBay(model, bay, metrics);
    this.drawLevel(model, levelPanel, xpBar, metrics);
    this.drawList(model, list, rows, metrics);
    this.drawBack(model, back, metrics);

    this.cache.refresh(signature);
  }

  /** The header beam: HANGAR hard left, the eyebrow hard right. */
  private drawHeader(model: HangarModel, title: Rect, m: FrameMetrics): void {
    const visible = title.height > 0;
    this.heading.visible = visible;
    this.eyebrow.visible = visible;
    if (!visible) return;

    const headingPx = typeSize(HEADING_PX, m);
    this.heading.text = model.title;
    this.heading.style.fontSize = headingPx;
    this.heading.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, headingPx);
    this.heading.x = title.x;
    this.heading.y = title.y + title.height / 2;

    const eyebrowPx = typeSize(EYEBROW_PX, m);
    this.eyebrow.text = model.eyebrow;
    this.eyebrow.style.fontSize = eyebrowPx;
    this.eyebrow.style.letterSpacing = trackingPx(TRACKING.eyebrow, eyebrowPx);
    this.eyebrow.x = title.x + title.width;
    this.eyebrow.y = title.y + title.height / 2;
    // On a narrow beam the eyebrow gives way to the heading — the heading names
    // the screen and the eyebrow only decorates it.
    this.eyebrow.visible = this.heading.width + this.eyebrow.width + m.gutter <= title.width;
  }

  /**
   * The ship bay: the real generated hull, centred, over an `inert` panel, with
   * the lobby's own words under it.
   *
   * The blurb is the block that gives way on a short bay, then the hull
   * nickname — the same priority order the lobby's hull tiles keep (GDD §2.11:
   * a tile gives up its role blurb first and its nickname second). The name and
   * the ship itself never give way: they are what the screen is.
   */
  private drawBay(model: HangarModel, bay: Rect, m: FrameMetrics): void {
    this.shipArt.clear();
    const visible = bay.width > 0 && bay.height > 0;
    this.shipName.visible = visible;
    this.shipHull.visible = visible;
    this.shipBlurb.visible = visible;
    if (!visible) return;

    drawPlate(this.panels, bay.x, bay.y, bay.width, bay.height, HANGAR_BAY_PLATE.role, 'standard', 'rest');

    const captionH = bay.height * CAPTION_SHARE;
    const artBox = { x: bay.x, y: bay.y, width: bay.width, height: Math.max(0, bay.height - captionH) };

    // The real generator, at the real scale. Unit space is [-extent, +extent],
    // so filling `size` pixels across means size / (2 · extent) pixels per unit
    // — the same arithmetic `SpriteTextureCache` does for every sprite in the
    // match, restated here because this one is drawn rather than baked.
    const def = shipSprite({ shipClass: model.ship.shipClass, playerId: 0 });
    const size = Math.min(artBox.width, artBox.height) * SHIP_FILL;
    drawSprite(this.shipArt, def, size / (def.extent * 2));
    this.shipArt.x = artBox.x + artBox.width / 2;
    this.shipArt.y = artBox.y + artBox.height / 2;

    const namePx = plateTypeSize(SHIP_NAME_PX, m);
    this.shipName.text = model.ship.name;
    this.shipName.style.fontSize = namePx;
    this.shipName.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, namePx);
    this.shipName.x = bay.x + bay.width / 2;
    this.shipName.y = bay.y + bay.height - captionH + namePx * 0.7;

    const hullPx = plateTypeSize(SHIP_HULL_PX, m);
    this.shipHull.text = model.ship.hull.toUpperCase();
    this.shipHull.style.fontSize = hullPx;
    this.shipHull.style.letterSpacing = trackingPx(TRACKING.label, hullPx);
    this.shipHull.x = this.shipName.x;
    this.shipHull.y = this.shipName.y + namePx * 1.1;

    const blurbPx = plateTypeSize(SHIP_BLURB_PX, m);
    this.shipBlurb.text = model.ship.blurb;
    this.shipBlurb.style.fontSize = blurbPx;
    this.shipBlurb.style.wordWrapWidth = Math.max(20, bay.width - Math.round(ROW.padX * m.plateScale) * 2);
    this.shipBlurb.x = this.shipName.x;
    this.shipBlurb.y = this.shipHull.y + hullPx * 1.2;

    // What actually fits is a measurement only Pixi can make, so the final say
    // is here: a block that would run out of the bay is dropped whole rather
    // than clipped, and the nickname outlives the blurb.
    const bayBottom = bay.y + bay.height;
    this.shipBlurb.visible = this.shipBlurb.y + this.shipBlurb.height <= bayBottom;
    this.shipHull.visible = this.shipHull.y + hullPx <= bayBottom;
  }

  /**
   * The level block: LEVEL n large, the XP figure beside it, the bar under both,
   * and what is left to the next level under that.
   *
   * These are the numbers the end-of-match summary shows, read from the same
   * profile through the same curve — the hangar computes none of them.
   */
  private drawLevel(model: HangarModel, panel: Rect, bar: Rect, m: FrameMetrics): void {
    const visible = panel.width > 0 && panel.height > 0;
    for (const node of [this.levelLabel, this.xpLabel, this.nextLabel, this.matchesLabel]) node.visible = visible;
    if (!visible) return;

    const levelPx = Math.min(plateTypeSize(LEVEL_PX, m), Math.max(11, panel.height * 0.42));
    this.levelLabel.text = model.level.levelLabel;
    this.levelLabel.style.fontSize = levelPx;
    this.levelLabel.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, levelPx);
    this.levelLabel.x = panel.x;
    this.levelLabel.y = bar.y - Math.max(4, m.rowGap);

    const xpPx = plateTypeSize(XP_PX, m);
    for (const [node, text] of [
      [this.xpLabel, model.level.xpLabel],
      [this.nextLabel, model.level.nextLabel],
      [this.matchesLabel, model.level.matchesLabel],
    ] as const) {
      node.text = text;
      node.style.fontSize = xpPx;
      node.style.letterSpacing = trackingPx(TRACKING.label, xpPx);
    }
    this.xpLabel.x = panel.x + panel.width;
    this.xpLabel.y = this.levelLabel.y;
    this.nextLabel.x = panel.x;
    this.nextLabel.y = bar.y + bar.height + Math.max(4, m.rowGap);
    this.matchesLabel.x = panel.x + panel.width;
    this.matchesLabel.y = this.nextLabel.y;

    // The XP bar: chalk metal on the shaded end of the same ramp. No hue — a
    // progress bar is a level readout, and this direction spends no colour on
    // one (the settings screen's volume pips, same rule).
    if (bar.width <= 0 || bar.height <= 0) return;
    this.panels.rect(bar.x, bar.y, bar.width, bar.height).fill({ color: MATERIAL_SHADES.chipFaceLit, alpha: 1 });
    const filled = Math.max(0, Math.min(1, model.level.frac)) * bar.width;
    if (filled > 0) {
      this.panels.rect(bar.x, bar.y, filled, bar.height).fill({ color: MATERIAL_SHADES.bone, alpha: 1 });
    }
    // A hairline round the whole bar, so an empty one still reads as a bar with
    // nothing in it rather than as a gap in the panel — the LESSONS §20 rule,
    // applied to a single rectangle.
    this.panels.rect(bar.x, bar.y, bar.width, bar.height).stroke({ color: MATERIAL_SHADES.bone, alpha: 0.35, width: 1 });
  }

  /**
   * The unlock list — or, today, the line that says there is nothing in it.
   *
   * The empty case is drawn as a real panel with a real sentence on it, because
   * an empty grid is indistinguishable from a broken one and this screen ships
   * empty (a0-14).
   */
  private drawList(model: HangarModel, list: Rect, rects: readonly Rect[], m: FrameMetrics): void {
    const visible = list.width > 0 && list.height > 0;
    this.emptyLine.visible = visible && model.empty !== null;

    for (let i = 0; i < this.rowNodes.length; i++) {
      const nodes = this.rowNodes[i]!;
      const shown = i < rects.length && i < model.rows.length;
      nodes.body.clear();
      nodes.name.visible = shown;
      nodes.slot.visible = shown;
      nodes.action.visible = shown;
    }
    if (!visible) return;

    if (model.empty !== null) {
      drawPlate(this.panels, list.x, list.y, list.width, list.height, 'inert', 'standard', 'rest');
      const px = plateTypeSize(EMPTY_PX, m);
      this.emptyLine.text = model.empty;
      this.emptyLine.style.fontSize = px;
      this.emptyLine.style.wordWrapWidth = Math.max(20, list.width - Math.round(ROW.padX * m.plateScale) * 2);
      this.emptyLine.x = list.x + list.width / 2;
      this.emptyLine.y = list.y + list.height / 2;
      return;
    }

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      const row = model.rows[i];
      if (!rect || !row) continue;
      this.drawRow(this.rowSlot(i), row, rect, m);
    }
  }

  /** One cosmetic: its name and slot on the left, its action word on the right.
   *  A locked row wears the `inert` surface and a dimmer label — one step down
   *  the same ramp, never a hue and never gray-as-disabled. */
  private drawRow(nodes: RowNodes, row: HangarRowView, rect: Rect, m: FrameMetrics): void {
    nodes.body.clear();
    if (rect.width <= 0 || rect.height <= 0) {
      nodes.name.visible = false;
      nodes.slot.visible = false;
      nodes.action.visible = false;
      return;
    }
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, row.role, 'compact', row.state);

    const padX = Math.max(8, Math.round(ROW.padX * m.plateScale));
    const locked = row.status === 'locked';

    const namePx = plateTypeSize(ROW_NAME_PX, m);
    nodes.name.visible = true;
    nodes.name.text = row.name;
    nodes.name.style.fontSize = namePx;
    nodes.name.style.letterSpacing = trackingPx(TRACKING.name, namePx);
    nodes.name.style.fill = locked ? MATERIAL_SHADES.boneLo : MATERIAL_SHADES.bone;
    nodes.name.x = rect.x + padX;
    nodes.name.y = rect.y + rect.height * 0.38;

    const slotPx = plateTypeSize(ROW_SLOT_PX, m);
    nodes.slot.visible = true;
    nodes.slot.text = row.slotLabel;
    nodes.slot.style.fontSize = slotPx;
    nodes.slot.style.letterSpacing = trackingPx(TRACKING.eyebrow, slotPx);
    nodes.slot.x = nodes.name.x;
    nodes.slot.y = rect.y + rect.height * 0.72;

    const actionPx = plateTypeSize(ROW_ACTION_PX, m);
    nodes.action.visible = true;
    nodes.action.text = row.action;
    nodes.action.style.fontSize = actionPx;
    nodes.action.style.letterSpacing = trackingPx(TRACKING.label, actionPx);
    // EQUIPPED is the brightest word on the row — it is the state the player is
    // looking for. LOCKED reads dimmest; EQUIP sits between them.
    nodes.action.style.fill =
      row.status === 'equipped' ? BONE.hi : locked ? MATERIAL_SHADES.boneLo : MATERIAL_SHADES.bone;
    nodes.action.x = rect.x + rect.width - padX;
    nodes.action.y = rect.y + rect.height / 2;
  }

  /** BACK — the screen's one bright plate, right-aligned in the footer beam. */
  private drawBack(model: HangarModel, rect: Rect, m: FrameMetrics): void {
    this.backBody.clear();
    const visible = rect.width > 0 && rect.height > 0;
    this.backLabel.visible = visible;
    if (!visible) return;

    drawPlate(this.backBody, rect.x, rect.y, rect.width, rect.height, model.backRole, 'compact', model.backState);
    const px = plateTypeSize(BACK_PX, m);
    this.backLabel.text = model.backLabel;
    this.backLabel.style.fontSize = px;
    this.backLabel.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
    this.backLabel.x = rect.x + rect.width / 2;
    this.backLabel.y = rect.y + rect.height / 2 + (model.backState === 'press' ? 2 : 0);
  }

  private rowSlot(index: number): RowNodes {
    const existing = this.rowNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const name = makeText('', FONT_BODY, ROW_NAME_PX, MATERIAL_SHADES.bone, 0, 0.5);
    const slot = makeText('', FONT_BODY, ROW_SLOT_PX, MATERIAL_SHADES.boneLo, 0, 0.5);
    const action = makeText('', FONT_BODY, ROW_ACTION_PX, MATERIAL_SHADES.bone, 1, 0.5);
    this.addChild(body, name, slot, action);
    const nodes: RowNodes = { body, name, slot, action };
    this.rowNodes[index] = nodes;
    return nodes;
  }
}

function opts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
}

function makeText(
  text: string,
  fontFamily: string,
  fontSize: number,
  fill: number,
  anchorX: number,
  anchorY: number,
): Text {
  const node = new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0 } });
  node.anchor.set(anchorX, anchorY);
  return node;
}
