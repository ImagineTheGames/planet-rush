/**
 * src/ui/end-of-match-view.ts — the Pixi view for the summary. OWNER: UI Engineer.
 *
 * The drawing half of {@link ./end-of-match}. The words and the buttons come from
 * the model, the rects from {@link ./end-of-match} `endOfMatchLayout`; this file
 * only colours them.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE, AND THE ONE SCREEN THAT CARRIES THE ACHE (u7-05)
 * ---------------------------------------------------------------------------
 * The summary is now made of the same material as every other screen — beams from
 * {@link ../art/materials}, plates from `drawPlate`, one tracking scale — and of
 * nothing else. What it says is untouched: the same four headlines, the same
 * cause-and-placement line, the same two buttons.
 *
 * The tone contract (GDD §4.7) protects the station-death beat, and s7-01's clean
 * sci-fi register does not soften it: *"a clean palette makes it land harder, not
 * softer."* So this screen gets **material and restraint**, not a treatment of its
 * own. Concretely, the three colour decisions and why each survived a re-skin
 * whose whole rule is that Bone spends no hue:
 *
 *  - **The result is metal, not colour.** VICTORY is the brightest step of the
 *    Bone ramp, DEFEAT one step down, DRAW one further. A win is not a hue here;
 *    it is the brightest thing on a cold screen.
 *  - **Identity is a 4px rule, never lettering.** The winner's player colour is
 *    the one colour on the screen and it lives where this direction puts identity
 *    — a bar, "never as a background wash — that was making identity read as
 *    chrome" (a5-01). The screen still names the victor in words directly under it.
 *  - **ELIMINATED keeps threat red, and it is the only red on either screen.**
 *    Your reactor was destroyed; that is damage, which is the one thing style-guide
 *    §2 reserves red for. It is a *word*, not chrome: no plate here is ever red,
 *    and a losing result — DEFEAT, DRAW — is not damage and stays in the ramp.
 *
 * The backdrop is **opaque and covers the whole viewport**. The old one was 92%
 * over the *content box*, which left a bright frame of live match around all four
 * edges and shimmered a running scene through a material whose bands are solved
 * against Vacuum. A filed result does not flicker.
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
import { END_OF_MATCH_ID, endOfMatchHitTest, endOfMatchLayout } from './end-of-match';
import type {
  EndButton,
  EndButtonView,
  EndKind,
  EndOfMatchLayout,
  EndOfMatchModel,
  EndTarget,
} from './end-of-match';
import type { Insets } from './menu-geometry';
import { ScreenCache } from './screen-cache';

export const END_OF_MATCH_ANCHOR: AnchorSpec = { region: 'full' };

/** Reference type sizes. The result keeps the 48px it has always been set at. */
const HEADLINE_PX = 48;
const SUB_PX = 15;
const EYEBROW_PX = 12;
const LABEL_PX = { primary: 27, secondary: 21 } as const;
/** Gap between a plate's accent tick and its label (handoff 24). */
const TICK_GAP = 24;

/** The buttons the summary lays out before it has seen a model. */
const DEFAULT_BUTTONS: readonly EndButton[] = ['rematch', 'menu'];

interface ButtonNodes {
  readonly body: Graphics;
  readonly label: Text;
}

/**
 * The end-of-match summary. Add once, {@link resize} on viewport changes,
 * {@link update} each frame with an {@link EndOfMatchModel}; show it when the
 * flow reaches its `end` screen and hide it on rematch or spectate.
 */
export class EndOfMatchView extends Container {
  private readonly backdrop = new Graphics();
  private readonly beams = new Graphics();
  private readonly rule = new Graphics();
  private readonly eyebrow: Text;
  private readonly headline: Text;
  private readonly subhead: Text;
  private readonly buttonNodes: ButtonNodes[] = [];
  /** The summary is static between state changes but `update()` runs per frame —
   *  and a Gantry plate is ~56 translucent polygons (./screen-cache). */
  private readonly cache = new ScreenCache(this);

  private layout: EndOfMatchLayout;
  private buttonIds: EndButton[] = [];
  private viewport: Viewport;
  private isTouch: boolean;
  private insets: Insets | undefined;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.viewport = { width: screenWidth, height: screenHeight };
    this.isTouch = isTouch;
    this.insets = insets;
    this.layout = this.relayout(DEFAULT_BUTTONS);
    this.eyebrow = makeText('', FONT_BODY, EYEBROW_PX, BONE.lo);
    this.eyebrow.anchor.set(0, 0.5);
    this.headline = makeText('', FONT_HEADING, HEADLINE_PX, BONE.hi);
    this.headline.anchor.set(0.5, 0.5);
    this.subhead = makeText('', FONT_BODY, SUB_PX, MATERIAL_SHADES.boneLo);
    this.subhead.anchor.set(0.5, 0.5);
    this.addChild(this.backdrop, this.beams, this.rule, this.eyebrow, this.headline, this.subhead);
  }

  resize(width: number, height: number, isTouch = this.isTouch, insets = this.insets): void {
    this.viewport = { width, height };
    this.isTouch = isTouch;
    this.insets = insets;
    this.layout = this.relayout(this.buttonIds.length > 0 ? this.buttonIds : DEFAULT_BUTTONS);
    // The cached texture is the size the OLD viewport rasterised to (./screen-cache).
    this.cache.invalidate();
  }

  /** Re-derive the layout for the current viewport and a given button set. */
  private relayout(buttonIds: readonly EndButton[]): EndOfMatchLayout {
    return endOfMatchLayout(this.viewport, buttonIds, opts(this.isTouch, this.insets));
  }

  hitTest(x: number, y: number): EndTarget | null {
    return endOfMatchHitTest(this.layout, x, y, this.buttonIds);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: END_OF_MATCH_ID, anchor: END_OF_MATCH_ANCHOR, bounds: { ...this.layout.content } }];
  }

  update(model: EndOfMatchModel): void {
    // The button set is part of the model (spectate comes and goes, and the two
    // plates are different SIZES), so the layout is re-derived when it changes — a
    // summary that laid out two buttons and drew one would leave a live rect under
    // nothing.
    const ids = model.buttons.map((b) => b.id);
    if (!sameIds(ids, this.buttonIds)) {
      this.buttonIds = ids;
      this.layout = this.relayout(ids);
      this.cache.invalidate();
    }
    if (!this.visible) return;
    const signature = JSON.stringify(model);
    if (this.cache.unchanged(signature)) return;

    const { header, footer, title, headline, rule, subhead, buttons, metrics } = this.layout;

    // Opaque, over the WHOLE viewport: the result owns the screen.
    this.backdrop.clear();
    this.backdrop
      .rect(0, 0, this.viewport.width, this.viewport.height)
      .fill({ color: PALETTE.vacuum, alpha: 1 });

    this.beams.clear();
    if (header.height > 0) drawBeam(this.beams, header.x, header.y, header.width, 'header', true, header.height);
    if (footer.height > 0) drawBeam(this.beams, footer.x, footer.y, footer.width, 'footer', true, footer.height);

    this.drawResult(model, title, headline, rule, subhead, metrics);

    for (let i = 0; i < buttons.length; i++) {
      const rect = buttons[i];
      const button = model.buttons[i];
      if (!rect || !button) continue;
      this.drawButton(this.buttonSlot(i), button, rect, metrics);
    }
    // Any stale button slots (a spectate button that just vanished) go dark.
    for (let i = buttons.length; i < this.buttonNodes.length; i++) {
      const nodes = this.buttonNodes[i];
      if (nodes) setVisible(false, nodes.body, nodes.label);
    }
    this.cache.refresh(signature);
  }

  /** The authority tag in the beam, then the result: the word, the identity rule,
   *  and the line that says who and how. */
  private drawResult(
    model: EndOfMatchModel,
    title: Rect,
    headline: Rect,
    rule: Rect,
    subhead: Rect,
    m: FrameMetrics,
  ): void {
    this.eyebrow.visible = title.height > 0;
    if (this.eyebrow.visible) {
      const px = typeSize(EYEBROW_PX, m);
      this.eyebrow.text = model.eyebrow;
      this.eyebrow.style.fontSize = px;
      this.eyebrow.style.letterSpacing = trackingPx(TRACKING.eyebrow, px);
      this.eyebrow.x = title.x;
      this.eyebrow.y = title.y + title.height / 2;
    }

    const headlinePx = typeSize(HEADLINE_PX, m);
    this.headline.text = model.headline;
    this.headline.style.fontSize = headlinePx;
    this.headline.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, headlinePx);
    this.headline.style.fill = headlineColor(model.kind);
    this.headline.x = headline.x + headline.width / 2;
    this.headline.y = headline.y + headline.height / 2;
    this.headline.visible = headline.height > 0;

    // The identity rule: the winner's own colour, and the only colour on the
    // screen. Absent on a draw and on an elimination — there is no one to mark.
    this.rule.clear();
    if (model.accent !== null && rule.width > 0 && rule.height > 0) {
      this.rule.rect(rule.x, rule.y, rule.width, rule.height).fill({ color: model.accent, alpha: 1 });
    }

    const subPx = typeSize(SUB_PX, m);
    this.subhead.text = model.subhead;
    this.subhead.style.fontSize = subPx;
    this.subhead.style.letterSpacing = trackingPx(TRACKING.label, subPx);
    this.subhead.x = subhead.x + subhead.width / 2;
    this.subhead.y = subhead.y + subhead.height / 2;
    this.subhead.visible = subhead.height > 0;
  }

  /** One plate, and its label hung off the accent tick — the title screen's own
   *  construction, so a button reads the same wherever a player meets one. */
  private drawButton(nodes: ButtonNodes, button: EndButtonView, rect: Rect, m: FrameMetrics): void {
    nodes.body.clear();
    if (rect.width <= 0 || rect.height <= 0) {
      nodes.label.visible = false;
      return;
    }
    setVisible(true, nodes.body, nodes.label);

    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, button.role, button.scale, button.state);

    const padX = platePadX(button.scale, m);
    const tickW = PLATE_SCALES[button.scale].tickWidth;
    const sink = plateMaterial(button.role, button.state, plateFamily(button.scale)).offsetY;
    const px = plateTypeSize(button.primary ? LABEL_PX.primary : LABEL_PX.secondary, m);

    nodes.label.text = button.label;
    nodes.label.style.fontSize = px;
    nodes.label.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
    nodes.label.style.fill = button.primary ? BONE.hi : MATERIAL_SHADES.bone;
    nodes.label.x = rect.x + padX + tickW + Math.max(8, Math.round(TICK_GAP * m.plateScale));
    nodes.label.y = rect.y + rect.height / 2 + sink;
  }

  private buttonSlot(index: number): ButtonNodes {
    const existing = this.buttonNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, LABEL_PX.secondary, MATERIAL_SHADES.bone);
    label.anchor.set(0, 0.5);
    this.addChild(body, label);
    const nodes: ButtonNodes = { body, label };
    this.buttonNodes[index] = nodes;
    return nodes;
  }
}

/**
 * The result's own tone. Three steps of the Bone ramp for the three outcomes that
 * are not damage — a win is the brightest metal on the screen, a loss one step
 * down, a draw one further — and threat red for the one that is: ELIMINATED means
 * your reactor was destroyed (style-guide §2, damage). No plate is ever red.
 */
function headlineColor(kind: EndKind): number {
  switch (kind) {
    case 'victory':
      return BONE.hi;
    case 'defeat':
      return MATERIAL_SHADES.bone;
    case 'draw':
      return MATERIAL_SHADES.boneLo;
    case 'eliminated':
      return PALETTE.threatRed;
  }
}

function sameIds(a: readonly EndButton[], b: readonly EndButton[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function opts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
}

function setVisible(visible: boolean, ...nodes: Array<Graphics | Text>): void {
  for (const node of nodes) node.visible = visible;
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0 } });
}
