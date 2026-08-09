/**
 * src/ui/map-select-view.ts — the Pixi view for MAP SELECT. OWNER: UI Engineer.
 *
 * The drawing half of {@link ./map-select}: a Gantry frame around the shared
 * {@link ./map-picker-view} `MapPickerView`, which draws the cards, their registry
 * previews and the VETERAN pill exactly as it has since m8-02.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, HONESTLY
 * ---------------------------------------------------------------------------
 * A frame and two words. The cards were never this brief's problem — they were a
 * good picker being drawn in the 64px strip a lobby column had left for it — so
 * this screen adds a header beam, a footer beam, a hint line and a BACK plate, and
 * hands the whole band to the picker.
 *
 * The one thing it decides for itself is the **guest tell**. A joiner may open this
 * screen and read it; they may not author it (`./lobby` `selectMap` is the host's).
 * So the picker is drawn at a lower alpha and the hint says whose pick it is — the
 * lobby's own honest-refusal rule, which is that a control must LOOK unavailable
 * rather than look live and then refuse.
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
import { MAP_SELECT_ID, mapSelectHitTest, mapSelectLayout } from './map-select';
import type { MapSelectLayout, MapSelectModel, MapSelectTarget } from './map-select';
import type { Insets } from './menu-geometry';
import { MapPickerView } from './map-picker-view';
import { FONT_BODY, FONT_HEADING } from './typography';
import { ScreenCache } from './screen-cache';

/** The screen's declared anchor: while it is up, it owns the display. */
export const MAP_SELECT_ANCHOR: AnchorSpec = { region: 'full' };

/** The same reference sizes {@link ./ship-select-view} uses for the same jobs, so
 *  the two picker screens are visibly one set. */
const HEADING_PX = 22;
const EYEBROW_PX = 12;
const HINT_PX = 12;
const ACTION_PX = 20;

/** How far a card row dims for a client who may read it but not change it — the
 *  same value the lobby's arena card dims by, so "not yours" looks identical on
 *  the summary and on the screen it opens. */
const READ_ONLY_ALPHA = 0.55;

/**
 * The MAP SELECT screen. Add once, {@link resize} on every viewport change,
 * {@link update} each frame with a {@link MapSelectModel}.
 */
export class MapSelectView extends Container {
  private readonly backdrop = new Graphics();
  private readonly beams = new Graphics();
  private readonly heading: Text;
  private readonly eyebrow: Text;
  private readonly hint: Text;
  private readonly actions = new Graphics();
  private readonly backText: Text;
  private readonly picker = new MapPickerView();
  /** Static between state changes and made of ~56 translucent polygons per plate —
   *  rasterised once rather than re-composited every frame (./screen-cache). */
  private readonly cache = new ScreenCache(this);

  private layout: MapSelectLayout;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = mapSelectLayout({ width: screenWidth, height: screenHeight }, opts(isTouch, insets));

    this.heading = makeText('', FONT_HEADING, HEADING_PX, MATERIAL_SHADES.bone);
    this.heading.anchor.set(0, 0.5);
    this.eyebrow = makeText('', FONT_BODY, EYEBROW_PX, MATERIAL_SHADES.boneLo);
    this.eyebrow.anchor.set(1, 0.5);
    this.hint = makeText('', FONT_BODY, HINT_PX, MATERIAL_SHADES.boneLo);
    this.hint.anchor.set(0, 0.5);
    this.backText = makeText('', FONT_HEADING, ACTION_PX, BONE.hi);
    this.backText.anchor.set(0.5, 0.5);

    this.addChild(this.backdrop, this.beams, this.heading, this.eyebrow, this.hint);
    this.addChild(this.picker);
    this.addChild(this.actions, this.backText);
    this.visible = false;
  }

  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.layout = mapSelectLayout({ width, height }, opts(isTouch, insets));
    this.cache.invalidate();
  }

  /** The rects this frame was drawn at — a tap is tested against the geometry that
   *  was drawn, never a second copy. */
  hitTest(x: number, y: number): MapSelectTarget | null {
    return mapSelectHitTest(this.layout, x, y);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: MAP_SELECT_ID, anchor: MAP_SELECT_ANCHOR, bounds: { ...this.layout.content } }];
  }

  /** Show or hide the whole screen, dropping the cached texture on a change. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.cache.invalidate();
    this.visible = visible;
  }

  update(model: MapSelectModel): void {
    if (!this.visible) return;
    const signature = JSON.stringify(model);
    if (this.cache.unchanged(signature)) return;

    const { content, header, footer, metrics } = this.layout;

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

    this.picker.setLayout(this.layout.picker);
    this.picker.visible = true;
    // The guest tell: readable, plainly not pressable (see the file header).
    this.picker.alpha = model.canPick ? 1 : READ_ONLY_ALPHA;
    this.picker.update(model.picker);

    this.drawActions(model, metrics);
    this.cache.refresh(signature);
  }

  private drawHeader(model: MapSelectModel, m: FrameMetrics): void {
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
    fitLabel(this.heading, strip.width);

    const eyebrowPx = typeSize(EYEBROW_PX, m);
    this.eyebrow.text = model.eyebrow;
    this.eyebrow.style.fontSize = eyebrowPx;
    this.eyebrow.style.letterSpacing = trackingPx(TRACKING.eyebrow, eyebrowPx);
    this.eyebrow.x = strip.x + strip.width;
    this.eyebrow.y = strip.y + strip.height / 2;
  }

  /** The one line under the beam — and, for a guest, the whole host rule in words
   *  (`./map-select` MAP_SELECT_GUEST_HINT). Brighter when it is a refusal, because
   *  then it is the thing the player most needs to have read. */
  private drawHint(model: MapSelectModel, m: FrameMetrics): void {
    const strip = this.layout.hint;
    const visible = strip.width > 0 && strip.height > 0;
    this.hint.visible = visible;
    if (!visible) return;
    const px = typeSize(HINT_PX, m);
    this.hint.text = model.hint;
    this.hint.style.fontSize = px;
    this.hint.style.letterSpacing = trackingPx(TRACKING.eyebrow, px);
    this.hint.style.fill = model.canPick ? MATERIAL_SHADES.boneLo : MATERIAL_SHADES.bone;
    this.hint.x = strip.x;
    this.hint.y = strip.y + strip.height / 2;
    fitLabel(this.hint, strip.width);
  }

  /** The footer beam: BACK, this screen's one bright plate — and, for a guest, the
   *  only control on it. */
  private drawActions(model: MapSelectModel, m: FrameMetrics): void {
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
    const lead = platePadX('compact', m) + PLATE_SCALES.compact.tickWidth;
    this.backText.x = back.x + (back.width + lead) / 2;
    this.backText.y = back.y + back.height / 2;
    fitLabel(this.backText, back.width - 2 * platePadX('compact', m));
  }
}

function opts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
}

function fitLabel(label: Text, room: number): void {
  label.scale.set(1);
  const drawn = label.width;
  if (drawn > room && room > 0) label.scale.set(room / drawn);
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0 } });
}
