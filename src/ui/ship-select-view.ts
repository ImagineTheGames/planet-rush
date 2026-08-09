/**
 * src/ui/ship-select-view.ts — the Pixi view for SHIP SELECT. OWNER: UI Engineer.
 *
 * The drawing half of {@link ./ship-select}. Every decision lives in that pure,
 * unit-tested model and every rect in its co-located layout; this file turns them
 * into Graphics and Text and owns nothing but which child is which — the same
 * shape as {@link ./lobby-view} and {@link ./hangar-view}.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE (u7-03), AND THE ONE THING THAT COULD ONLY BREAK HERE
 * ---------------------------------------------------------------------------
 * Framed like every other screen in the set: a header beam carrying the heading
 * and its eyebrow, a footer beam carrying BACK, and one band between them. Every
 * bevel, rule, band and tone comes from `../art/materials`; nothing is hand-rolled.
 *
 * **BACK is this screen's one bright plate** (`./gantry` `singlePrimary`), and the
 * four tiles are `secondary` where the hull is the pick and `inert` where it is
 * not. That is deliberately the same pair the lobby drew them in: the hull tile is
 * one control, drawn by one renderer ({@link ./class-tile-view}), and the *only*
 * thing this screen changes about it is how much room it gets.
 *
 * The tiles are not redrawn here. That is the point of the split — two screens
 * showing the same six figures and the same five-pip bars must not be two drawings
 * of them, or the u4 guarantee (*the figure and the pips are two renderings of one
 * value*) becomes a thing two files have to agree about.
 */

import { Container, Graphics, Text } from 'pixi.js';
import {
  BONE,
  DISPLAY_TRACKING,
  MATERIAL_SHADES,
  PLATE_SCALES,
  TRACKING,
  drawBeam,
  drawPlate,
  platePadX,
  plateTypeSize,
  trackingPx,
  typeSize,
} from '../art/materials';
import type { FrameMetrics } from '../art/materials';
import type { AnchorSpec, LayoutEntry, Viewport } from '@platform/layout-registry';
import { PALETTE } from '@render/index';
import { SHIP_SELECT_ID, shipSelectHitTest, shipSelectLayout } from './ship-select';
import type { ShipSelectLayout, ShipSelectModel, ShipSelectTarget } from './ship-select';
import type { Insets } from './menu-geometry';
import { createClassTileNodes, drawClassTile, hideClassTile } from './class-tile-view';
import type { ClassTileNodes } from './class-tile-view';
import { FONT_BODY, FONT_HEADING } from './typography';
import { ScreenCache } from './screen-cache';

/** The screen's declared anchor: while it is up, it owns the display. */
export const SHIP_SELECT_ANCHOR: AnchorSpec = { region: 'full' };

/** The heading in the header beam, its eyebrow, the hint under it, and BACK — the
 *  same reference sizes the lobby uses for the same jobs, so the two screens are
 *  visibly one set. */
const HEADING_PX = 22;
const EYEBROW_PX = 12;
const HINT_PX = 12;
const ACTION_PX = 20;

/**
 * The SHIP SELECT screen. Add once, {@link resize} on every viewport change,
 * {@link update} each frame with a {@link ShipSelectModel}. Hidden — and costing
 * one boolean a frame — whenever the lobby is on its roster.
 */
export class ShipSelectView extends Container {
  private readonly backdrop = new Graphics();
  private readonly beams = new Graphics();
  private readonly heading: Text;
  private readonly eyebrow: Text;
  private readonly hint: Text;
  private readonly actions = new Graphics();
  private readonly backText: Text;
  private readonly tiles: ClassTileNodes[] = [];
  /**
   * The same argument {@link ./lobby-view} makes: the Gantry material is ~56
   * translucent polygons per plate and this screen draws four tiles, two beams and
   * a footer plate. It is static between state changes, so it is rasterised once
   * (./screen-cache) rather than re-composited sixty times a second.
   */
  private readonly cache = new ScreenCache(this);

  private layout: ShipSelectLayout;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = shipSelectLayout({ width: screenWidth, height: screenHeight }, opts(isTouch, insets));

    this.heading = makeText('', FONT_HEADING, HEADING_PX, MATERIAL_SHADES.bone);
    this.heading.anchor.set(0, 0.5);
    this.eyebrow = makeText('', FONT_BODY, EYEBROW_PX, MATERIAL_SHADES.boneLo);
    this.eyebrow.anchor.set(1, 0.5);
    this.hint = makeText('', FONT_BODY, HINT_PX, MATERIAL_SHADES.boneLo);
    this.hint.anchor.set(0, 0.5);
    this.backText = makeText('', FONT_HEADING, ACTION_PX, BONE.hi);
    this.backText.anchor.set(0.5, 0.5);

    this.addChild(this.backdrop, this.beams, this.heading, this.eyebrow, this.hint);
    for (let i = 0; i < 4; i++) this.tiles.push(createClassTileNodes(this));
    this.addChild(this.actions, this.backText);
    this.visible = false;
  }

  /** Re-lay-out for a new viewport, device or safe area. */
  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.layout = shipSelectLayout({ width, height }, opts(isTouch, insets));
    // The cached texture is the size the OLD viewport rasterised to; refreshing it
    // in place would blit a stale-sized screen, so drop it (./screen-cache).
    this.cache.invalidate();
  }

  /** The rects this frame was drawn at — so a tap is tested against the same
   *  geometry that was drawn, never a second copy (GDD §2.4: menus are taps). */
  hitTest(x: number, y: number): ShipSelectTarget | null {
    return shipSelectHitTest(this.layout, x, y);
  }

  /** The layout-registry seam: while up, this screen owns the display. */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: SHIP_SELECT_ID, anchor: SHIP_SELECT_ANCHOR, bounds: { ...this.layout.content } }];
  }

  /** Show or hide the whole screen. Invalidates the cache on a change, so the
   *  first frame back is drawn rather than blitted from a stale texture. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.cache.invalidate();
    this.visible = visible;
  }

  /** Draw one frame. */
  update(model: ShipSelectModel): void {
    if (!this.visible) return;
    const signature = JSON.stringify(model);
    if (this.cache.unchanged(signature)) return;

    const { content, header, footer, metrics } = this.layout;

    // Opaque over the whole viewport: this screen owns the display while it is up,
    // and the beams' own translucent fill needs the void to sit on.
    this.backdrop.clear();
    this.backdrop
      .rect(0, 0, content.x * 2 + content.width, content.y + content.height + content.y)
      .fill({ color: PALETTE.vacuum, alpha: 1 });

    this.beams.clear();
    if (header.height > 0)
      drawBeam(this.beams, header.x, header.y, header.width, 'header', true, header.height);
    if (footer.height > 0)
      drawBeam(this.beams, footer.x, footer.y, footer.width, 'footer', true, footer.height);

    this.drawHeader(model, metrics);
    this.drawHint(model, metrics);

    for (let i = 0; i < this.tiles.length; i++) {
      const nodes = this.tiles[i]!;
      const tile = model.tiles[i];
      const rect = this.layout.tiles[i];
      if (!tile || !rect) {
        hideClassTile(nodes);
        continue;
      }
      drawClassTile(nodes, tile.option, rect, {
        selected: tile.selected,
        dim: tile.dim,
        role: tile.role,
        state: tile.state,
        metrics,
      });
    }

    this.drawActions(model, metrics);
    // Everything above is now on the display list; rasterise it once so the frames
    // between state changes cost one blit (./screen-cache).
    this.cache.refresh(signature);
  }

  /** The header beam: the heading hard left, its eyebrow hard right — the same
   *  composition the lobby's beam uses for `CREW MUSTER` and the room code, so a
   *  player crossing between them sees one screen family. */
  private drawHeader(model: ShipSelectModel, m: FrameMetrics): void {
    const strip = this.layout.title;
    const visible = strip.height > 0 && strip.width > 0;
    this.heading.visible = visible;
    this.eyebrow.visible = visible;
    if (!visible) return;

    const px = typeSize(HEADING_PX, m);
    this.heading.text = model.title;
    this.heading.style.fontSize = px;
    this.heading.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
    this.heading.x = strip.x;
    this.heading.y = strip.y + strip.height / 2;
    // The heading gives way to nothing here; it is simply fitted to its own strip.
    fitLabel(this.heading, strip.width);

    const eyebrowPx = typeSize(EYEBROW_PX, m);
    this.eyebrow.text = model.eyebrow;
    this.eyebrow.style.fontSize = eyebrowPx;
    this.eyebrow.style.letterSpacing = trackingPx(TRACKING.eyebrow, eyebrowPx);
    this.eyebrow.x = strip.x + strip.width;
    this.eyebrow.y = strip.y + strip.height / 2;
  }

  /**
   * The one line under the beam: what the pips and the numbers are for, or — once
   * the countdown has started — why the tiles are dead.
   *
   * Dropped whole rather than clipped where the band could spare no strip for it,
   * the same ladder every block in this directory keeps.
   */
  private drawHint(model: ShipSelectModel, m: FrameMetrics): void {
    const strip = this.layout.hint;
    const visible = strip.width > 0 && strip.height > 0;
    this.hint.visible = visible;
    if (!visible) return;
    const px = typeSize(HINT_PX, m);
    this.hint.text = model.hint;
    this.hint.style.fontSize = px;
    this.hint.style.letterSpacing = trackingPx(TRACKING.eyebrow, px);
    this.hint.style.fill = model.locked ? MATERIAL_SHADES.bone : MATERIAL_SHADES.boneLo;
    this.hint.x = strip.x;
    this.hint.y = strip.y + strip.height / 2;
    fitLabel(this.hint, strip.width);
  }

  /** The footer beam: BACK, this screen's one bright plate. */
  private drawActions(model: ShipSelectModel, m: FrameMetrics): void {
    const { back } = this.layout;
    this.actions.clear();
    const visible = back.width > 0 && back.height > 0;
    this.backText.visible = visible;
    if (!visible) return;
    drawPlate(this.actions, back.x, back.y, back.width, back.height, model.backRole, 'compact', model.backState);
    const px = plateTypeSize(ACTION_PX, m);
    this.backText.text = model.backLabel;
    this.backText.style.fontSize = px;
    this.backText.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
    // Not the plate's middle: the handoff hangs a label off the accent tick, and a
    // small plate centred on its own box draws the word straight onto the 3px bar.
    const lead = platePadX('compact', m) + PLATE_SCALES.compact.tickWidth;
    this.backText.x = back.x + (back.width + lead) / 2;
    this.backText.y = back.y + back.height / 2;
    fitLabel(this.backText, back.width - 2 * platePadX('compact', m));
  }
}

function opts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
}

/** Scale a label DOWN to fit the control it is drawn in, never up — a word drawn
 *  wider than its own button reads as a bug. */
function fitLabel(label: Text, room: number): void {
  label.scale.set(1);
  const drawn = label.width;
  if (drawn > room && room > 0) label.scale.set(room / drawn);
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0 } });
}
