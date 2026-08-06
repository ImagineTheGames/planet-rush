/**
 * src/ui/main-menu-view.ts — the Pixi view for the main menu.
 * OWNER: UI Engineer.
 *
 * The drawing half of {@link ./main-menu}. Every value lives in the model and
 * every rect in {@link ./main-menu} `mainMenuLayout`; this file turns them into
 * Graphics and Text and owns nothing but which child is which — the same shape as
 * {@link ./settings-view}.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE (u7-01, ratified 2026-08-05 — "the theme and looks is what we
 * want"; spec `docs/design/gantry-bone-handoff.html`)
 * ---------------------------------------------------------------------------
 * The screen used to be 1px hairlines on black, which reads as a wireframe rather
 * than a product. It is now *material*: a header and footer beam with a lit top
 * edge, a Bone accent rule and rivets; plates with a bevel, a cast shadow, an
 * inner sheen and the gantry corner cut. **None of that is drawn here.** Every
 * bevel, rivet, band and tone comes from {@link ../art/materials}, so this screen
 * and the four that follow it speak one dialect of the direction instead of five.
 *
 * The one rule this file has to keep on its own: **Bone spends no colour, so the
 * primary action is simply the brightest plate — and it must never share a screen
 * with a second bright plate.** PLAY is `primary`; CODEX and SETTINGS are
 * `secondary`. {@link ./gantry} `singlePrimary` states it and
 * `main-menu.test.ts` holds the screen to it.
 *
 * The frozen contract, where it could only be broken here (style-guide §1, §5.6):
 *  - Audiowide for the wordmark and the plate labels; Oxanium for the eyebrow
 *    cluster and the sub-lines (they are body text, not headings).
 *  - No signal yellow (reserved: ore) and no threat red (reserved: danger)
 *    appear on a screen where nothing is either — and under Bone, no hue at all.
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
  plateFamily,
  plateMaterial,
  platePadX,
  plateTypeSize,
  trackingPx,
  typeSize,
} from '../art/materials';
import type { FrameMetrics } from '../art/materials';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_BODY, FONT_HEADING } from './typography';
import { MAIN_MENU_ID, MAIN_MENU_TITLE, mainMenuHitTest, mainMenuLayout } from './main-menu';
import type {
  MainMenuButtonView,
  MainMenuLayout,
  MainMenuModel,
  MainMenuOption,
} from './main-menu';
import type { Insets } from './menu-geometry';
import { ScreenCache } from './screen-cache';

export const MAIN_MENU_ANCHOR: AnchorSpec = { region: 'full' };

/** The wordmark's reference size, 46px Audiowide in the handoff's header beam. */
const WORDMARK_PX = 46;
/** A primary plate's label (27px) and a secondary's (21px), per the handoff. */
const LABEL_PX = { primary: 27, secondary: 21 } as const;
/** The sub-line under a plate label, and the beam's two eyebrow lines. */
const SUB_PX = 13;
const EYEBROW_PX = 12;
/** Gap between the accent tick and the label block inside a plate (handoff 24). */
const TICK_GAP = 24;
/** Vertical gap between a plate's label and its sub-line (handoff 3). */
const LABEL_GAP = 3;
/** Vertical gap between the beam's two eyebrow lines (handoff 4). */
const EYEBROW_GAP = 4;

interface ButtonNodes {
  readonly body: Graphics;
  readonly label: Text;
  readonly sub: Text;
}

/**
 * The main menu screen. Add once, {@link resize} on every viewport change,
 * {@link update} each frame with a {@link MainMenuModel}; hide it when the player
 * presses PLAY.
 */
export class MainMenuView extends Container {
  private readonly backdrop = new Graphics();
  private readonly beams = new Graphics();
  private readonly heading: Text;
  private readonly eyebrow: Text;
  private readonly status: Text;
  private readonly buttonNodes: ButtonNodes[] = [];
  /** A title screen is static between state changes — see ./screen-cache. */
  private readonly cache = new ScreenCache(this);

  private layout: MainMenuLayout;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = mainMenuLayout({ width: screenWidth, height: screenHeight }, opts(isTouch, insets));
    // The wordmark reads its own constant rather than a fourth copy of the
    // literal (docs/copy-sweep-industrial-voice.md flags the duplication).
    this.heading = makeText(MAIN_MENU_TITLE, FONT_HEADING, WORDMARK_PX, MATERIAL_SHADES.bone, 0);
    this.heading.anchor.set(0.5, 0.5);
    this.eyebrow = makeText('', FONT_BODY, EYEBROW_PX, BONE.lo, 0);
    this.eyebrow.anchor.set(0, 1);
    this.status = makeText('', FONT_BODY, EYEBROW_PX, MATERIAL_SHADES.boneLo, 0);
    this.status.anchor.set(0, 0);
    this.addChild(this.backdrop, this.beams, this.heading, this.eyebrow, this.status);
  }

  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.layout = mainMenuLayout({ width, height }, opts(isTouch, insets));
    // The cached texture is the size the OLD viewport rasterised to; refreshing
    // it in place would blit a stale-sized screen, so drop it (./screen-cache).
    this.cache.invalidate();
  }

  hitTest(x: number, y: number): MainMenuOption | null {
    return mainMenuHitTest(this.layout, x, y);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: MAIN_MENU_ID, anchor: MAIN_MENU_ANCHOR, bounds: { ...this.layout.content } }];
  }

  update(model: MainMenuModel): void {
    if (!this.visible) return;
    // Redrawing an unchanged screen is ~170 translucent polygons and a
    // render-to-texture for no pixels gained — see ./screen-cache.
    const signature = JSON.stringify(model);
    if (this.cache.unchanged(signature)) return;
    const { header, footer, title, eyebrow, buttons, metrics } = this.layout;

    // Opaque backdrop over the whole viewport — the menu owns the screen; no
    // half-built world shows through behind it (there is none yet, by design).
    // Drawn from the beams outward so the beams' own translucent fill has the
    // void to sit on, exactly as the handoff composites them.
    this.backdrop.clear();
    this.backdrop
      .rect(0, 0, header.x * 2 + header.width, footer.y + footer.height + header.y)
      .fill({ color: PALETTE.vacuum, alpha: 1 });

    this.beams.clear();
    // The beams are drawn at the height the FRAME resolved, not the handoff's
    // 92 — see ../art/materials `drawBeam`.
    if (header.height > 0)
      drawBeam(this.beams, header.x, header.y, header.width, 'header', true, header.height);
    if (footer.height > 0)
      drawBeam(this.beams, footer.x, footer.y, footer.width, 'footer', true, footer.height);

    this.drawHeader(model, header, title, eyebrow, metrics);

    for (let i = 0; i < buttons.length; i++) {
      const rect = buttons[i];
      const button = model.buttons[i];
      if (!rect || !button) continue;
      this.drawButton(this.buttonSlot(i), button, rect, metrics);
    }
    // Everything above is now on the display list; rasterise it once so the
    // frames between state changes cost one blit rather than ~170 translucent
    // polygons (./screen-cache).
    this.cache.refresh(signature);
  }

  /**
   * The header beam's contents: the eyebrow cluster on the left, the wordmark
   * centred across the beam. The wordmark shrinks — never the cluster — when the
   * two would collide, because "which game is this" survives a smaller wordmark
   * and the cluster is already at the type floor.
   */
  private drawHeader(
    model: MainMenuModel,
    header: Rect,
    title: Rect,
    eyebrowRect: Rect,
    m: FrameMetrics,
  ): void {
    const visible = header.height > 0;
    this.heading.visible = visible;
    this.eyebrow.visible = visible;
    this.status.visible = visible;
    if (!visible) return;

    const eyebrowPx = typeSize(EYEBROW_PX, m);
    const gap = Math.max(2, Math.round(EYEBROW_GAP * m.scale));
    this.eyebrow.text = model.eyebrow;
    this.eyebrow.style.fontSize = eyebrowPx;
    this.eyebrow.style.letterSpacing = trackingPx(TRACKING.eyebrow, eyebrowPx);
    this.status.text = model.status;
    this.status.style.fontSize = eyebrowPx;
    this.status.style.letterSpacing = trackingPx(TRACKING.label, eyebrowPx);

    const midY = eyebrowRect.y + eyebrowRect.height / 2;
    this.eyebrow.x = eyebrowRect.x;
    this.eyebrow.y = midY - gap / 2;
    this.status.x = eyebrowRect.x;
    this.status.y = midY + gap / 2;

    const wordPx = typeSize(WORDMARK_PX, m);
    this.heading.text = model.title;
    this.heading.style.fontSize = wordPx;
    this.heading.style.letterSpacing = trackingPx(DISPLAY_TRACKING.wordmark, wordPx);
    this.heading.scale.set(1);
    this.heading.x = title.x + title.width / 2;
    this.heading.y = midY;

    // Two ceilings, and the tighter wins: the beam's own strip, and whatever is
    // left after the eyebrow cluster claims its left-hand share on both sides of
    // centre (the wordmark is centred, so a collision on the left is a collision).
    const clusterW = Math.max(this.eyebrow.width, this.status.width);
    const centreRoom = Math.max(0, title.width - 2 * (clusterW + m.gutter));
    const maxWidth = Math.max(0, Math.min(title.width, centreRoom));
    if (this.heading.width > maxWidth && this.heading.width > 0) {
      this.heading.scale.set(maxWidth / this.heading.width);
    }
  }

  /**
   * One plate: the material (bevel, sheen, cast shadow, gantry cut, accent tick)
   * from {@link ../art/materials} `drawPlate`, then the label and its sub-line
   * hung off the tick. The press offset is inside `drawPlate`, so the text is
   * nudged by the same amount here to keep the two pieces of one plate together.
   */
  private drawButton(
    nodes: ButtonNodes,
    button: MainMenuButtonView,
    rect: Rect,
    m: FrameMetrics,
  ): void {
    nodes.body.clear();
    if (rect.width <= 0 || rect.height <= 0) {
      nodes.label.visible = false;
      nodes.sub.visible = false;
      return;
    }
    nodes.label.visible = true;
    nodes.sub.visible = true;

    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, button.role, button.scale, button.state);

    const padX = platePadX(button.scale, m);
    const tickW = PLATE_SCALES[button.scale].tickWidth;
    const textX = rect.x + padX + tickW + Math.max(8, Math.round(TICK_GAP * m.plateScale));
    // `drawPlate` sinks a pressed plate by its role's own offset; the text rides
    // the same number rather than a second copy of it.
    const sink = plateMaterial(button.role, button.state, plateFamily(button.scale)).offsetY;
    const midY = rect.y + rect.height / 2 + sink;

    const labelPx = plateTypeSize(button.primary ? LABEL_PX.primary : LABEL_PX.secondary, m);
    const subPx = plateTypeSize(SUB_PX, m);
    const gap = Math.max(2, Math.round(LABEL_GAP * m.plateScale));

    nodes.label.text = button.label;
    nodes.label.style.fontSize = labelPx;
    nodes.label.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, labelPx);
    nodes.label.style.fill = button.primary ? BONE.hi : MATERIAL_SHADES.bone;
    nodes.label.x = textX;

    nodes.sub.text = button.sub;
    nodes.sub.style.fontSize = subPx;
    nodes.sub.style.letterSpacing = trackingPx(TRACKING.label, subPx);
    nodes.sub.style.fill = button.primary ? MATERIAL_SHADES.bone : MATERIAL_SHADES.boneLo;
    nodes.sub.x = textX;

    // The two lines share the plate's vertical centre: the label sits above it,
    // the sub-line below, so the block is centred however tall the plate is.
    const block = nodes.label.height + gap + nodes.sub.height;
    // A plate too short for two lines drops the sub-line rather than overflowing
    // its own bevel — the label is the control's name and is never the thing cut.
    const twoLines = block <= rect.height - 8;
    nodes.sub.visible = twoLines;
    if (twoLines) {
      nodes.label.y = midY - block / 2;
      nodes.sub.y = midY - block / 2 + nodes.label.height + gap;
    } else {
      nodes.label.y = midY - nodes.label.height / 2;
    }
  }

  private buttonSlot(index: number): ButtonNodes {
    const existing = this.buttonNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, LABEL_PX.secondary, BONE.hi, 0);
    label.anchor.set(0, 0);
    const sub = makeText('', FONT_BODY, SUB_PX, MATERIAL_SHADES.boneLo, 0);
    sub.anchor.set(0, 0);
    this.addChild(body, label, sub);
    const nodes: ButtonNodes = { body, label, sub };
    this.buttonNodes[index] = nodes;
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
  letterSpacing: number,
): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing } });
}
