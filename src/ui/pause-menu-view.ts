/**
 * src/ui/pause-menu-view.ts — the Pixi view for the pause menu. OWNER: UI Engineer.
 *
 * The drawing half of {@link ./pause-menu}. The words and the buttons come from
 * the model, the rects from `pauseLayout`; this file only colours them. It draws
 * two independent things:
 *
 *  - **The overlay** — a full-viewport backdrop, a header beam naming the screen,
 *    the actions as plates in the band, and a footer beam. Up on the `menu` and
 *    `confirm` screens (the `settings` screen is drawn by the real
 *    {@link ./settings-view}, which the pause wiring shows in its place).
 *  - **The corner pause button** — the touch-only way in, a chip plate with the
 *    universal two-bar pause glyph, shown while the match owns the screen.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE (u7-05)
 * ---------------------------------------------------------------------------
 * Every bevel, rivet, band, beam and tone comes from {@link ../art/materials} —
 * nothing is hand-rolled here, so this screen speaks the same dialect as the
 * title, the settings screen, the doors and the CODEX rather than a sixth one.
 *
 * The one rule this file has to keep on its own: **Bone spends no colour, so the
 * primary action is simply the brightest plate — and it must never share a screen
 * with a second bright plate.** RESUME is `primary` on the menu and STAY is on
 * the confirm; everything else is `secondary` steel, fully active and never the
 * greyed-out costume. The plasma that used to fill RESUME and STAY is gone: it
 * was doing the job brightness does here, and Cold Vacuum would rather keep the
 * hue for the match. No threat red on LEAVE — red is damage, never a menu's
 * destructive action (style-guide §2), which was true before this pass and is
 * true after it.
 *
 * The backdrop is **near-opaque and covers the whole viewport**. Both halves of
 * that are deliberate: the plate material is a stack of translucent bands solved
 * against Vacuum, so a live match showing through it changes the material's own
 * read; and the old backdrop covered the *content box* — inset by the page margin
 * — which left a bright frame of running match around all four edges.
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
import type { LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_BODY, FONT_HEADING } from './typography';
import {
  PAUSE_ANCHOR,
  PAUSE_BUTTON_ANCHOR,
  PAUSE_BUTTON_ID,
  PAUSE_ID,
  pauseButtonRect,
  pauseHitTest,
  pauseLayout,
} from './pause-menu';
import type {
  PauseButton,
  PauseButtonView,
  PauseLayout,
  PauseMenuModel,
  PauseTarget,
} from './pause-menu';
import type { Insets } from './menu-geometry';
import { ScreenCache } from './screen-cache';

export { PAUSE_ANCHOR, PAUSE_BUTTON_ANCHOR };

/** Reference type sizes, read off the handoff's screens (the settings heading,
 *  the title screen's two plate-label sizes and its sub-line). */
const HEADING_PX = 22;
const SUB_PX = 13;
const LABEL_PX = { primary: 27, secondary: 21 } as const;
/** Gap between a plate's accent tick and its label (handoff 24). */
const TICK_GAP = 24;

/** How opaque the backdrop is over a running match. The settings screen — which
 *  the pause menu swaps to and back from — uses the same value, so stepping
 *  between the two never flashes the match brighter or darker. */
const BACKDROP_ALPHA = 0.96;

/** The buttons the overlay lays out before it has ever seen a model — the menu's
 *  own three, so a resize before the first frame is laid out at the right shape. */
const DEFAULT_BUTTONS: readonly PauseButton[] = ['resume', 'settings', 'exit'];

interface ButtonNodes {
  readonly body: Graphics;
  readonly label: Text;
}

/**
 * The pause menu view. Add once, {@link resize} on viewport changes,
 * {@link update} each frame with a {@link PauseMenuModel}, and {@link updateButton}
 * with whether the touch corner affordance should be drawn.
 */
export class PauseMenuView extends Container {
  private readonly backdrop = new Graphics();
  private readonly beams = new Graphics();
  private readonly overlay = new Container();
  private readonly headline: Text;
  private readonly subhead: Text;
  private readonly buttonNodes: ButtonNodes[] = [];
  /**
   * The overlay is static between state changes but `update()` is called every
   * rendered frame (`syncPause`), and a Gantry plate is ~56 translucent polygons.
   * Cached on the OVERLAY rather than on the whole view, so the corner button —
   * which comes and goes on its own schedule — is not inside the texture.
   */
  private readonly cache = new ScreenCache(this.overlay);

  private readonly cornerButton = new Container();
  private readonly cornerBody = new Graphics();
  private readonly cornerBars = new Graphics();
  private cornerRect: Rect;

  private layout: PauseLayout;
  private buttonIds: PauseButton[] = [];
  private viewport: Viewport;
  private isTouch: boolean;
  private insets: Insets | undefined;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.viewport = { width: screenWidth, height: screenHeight };
    this.isTouch = isTouch;
    this.insets = insets;
    this.layout = this.relayout(DEFAULT_BUTTONS);

    this.headline = makeText('', FONT_HEADING, HEADING_PX, MATERIAL_SHADES.bone);
    this.headline.anchor.set(0, 0.5);
    this.subhead = makeText('', FONT_BODY, SUB_PX, MATERIAL_SHADES.boneLo);
    this.subhead.anchor.set(1, 0.5);
    this.overlay.addChild(this.backdrop, this.beams, this.headline, this.subhead);
    this.overlay.visible = false;
    this.addChild(this.overlay);

    this.cornerRect = pauseButtonRect(this.viewport);
    this.cornerButton.addChild(this.cornerBody, this.cornerBars);
    this.cornerButton.visible = false;
    this.addChild(this.cornerButton);
    this.drawCornerButton();
  }

  resize(width: number, height: number, isTouch = this.isTouch, insets = this.insets): void {
    this.viewport = { width, height };
    this.isTouch = isTouch;
    this.insets = insets;
    this.layout = this.relayout(this.buttonIds.length > 0 ? this.buttonIds : DEFAULT_BUTTONS);
    this.cornerRect = pauseButtonRect(this.viewport);
    this.drawCornerButton();
    // The cached texture is the size the OLD viewport rasterised to; refreshing
    // it in place would blit a stale-sized screen, so drop it (./screen-cache).
    this.cache.invalidate();
  }

  private relayout(buttonIds: readonly PauseButton[]): PauseLayout {
    return pauseLayout(this.viewport, buttonIds, opts(this.isTouch, this.insets));
  }

  /** The overlay button a tap hit, or `null`. Only meaningful while the overlay
   *  is up; the corner button is hit-tested separately by the wiring via
   *  {@link pauseButtonRect}, exactly as the BUILD button is. */
  hitTest(x: number, y: number): PauseTarget | null {
    if (!this.overlay.visible) return null;
    return pauseHitTest(this.layout, x, y, this.buttonIds);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    const entries: LayoutEntry[] = [];
    if (this.overlay.visible) {
      entries.push({ id: PAUSE_ID, anchor: PAUSE_ANCHOR, bounds: { ...this.layout.content } });
    }
    if (this.cornerButton.visible) {
      entries.push({ id: PAUSE_BUTTON_ID, anchor: PAUSE_BUTTON_ANCHOR, bounds: { ...this.cornerRect } });
    }
    return entries;
  }

  /** Draw the overlay for a model. A `closed`/`settings` model has no buttons and
   *  no headline — the overlay hides itself and the frame belongs to the match or
   *  the settings screen. */
  update(model: PauseMenuModel): void {
    const ids = model.buttons.map((b) => b.id);
    // The plate SCALES change with the screen, not just the count (the menu leads
    // with a hero, the confirm ends with one), so the layout follows the ids. A
    // *closed* model carries none and leaves the last screen's layout standing,
    // rather than dropping the cached texture every time the overlay is dismissed.
    if (ids.length > 0 && !sameIds(ids, this.buttonIds)) {
      this.buttonIds = ids;
      this.layout = this.relayout(ids);
      this.cache.invalidate();
    }

    const visible = ids.length > 0;
    this.overlay.visible = visible;
    if (!visible) return;
    // An unchanged frame costs a string compare rather than ~170 polygons and a
    // render-to-texture — this runs per FRAME while the overlay is up.
    const signature = JSON.stringify(model);
    if (this.cache.unchanged(signature)) return;

    const { header, footer, title, buttons, metrics } = this.layout;

    // The whole viewport, not the content box: the material is composited onto
    // Vacuum, and the old inset backdrop left a bright frame of running match
    // around all four edges.
    this.backdrop.clear();
    this.backdrop
      .rect(0, 0, this.viewport.width, this.viewport.height)
      .fill({ color: PALETTE.vacuum, alpha: BACKDROP_ALPHA });

    this.beams.clear();
    // Beams paint the height the FRAME reserved, not a flat 92 (u7-04).
    if (header.height > 0) drawBeam(this.beams, header.x, header.y, header.width, 'header', true, header.height);
    if (footer.height > 0) drawBeam(this.beams, footer.x, footer.y, footer.width, 'footer', true, footer.height);

    this.drawHeader(model, title, metrics);

    for (let i = 0; i < buttons.length; i++) {
      const rect = buttons[i];
      const button = model.buttons[i];
      if (!rect || !button) continue;
      this.drawButton(this.buttonSlot(i), button, rect, metrics);
    }
    for (let i = buttons.length; i < this.buttonNodes.length; i++) {
      const nodes = this.buttonNodes[i];
      if (nodes) setVisible(false, nodes.body, nodes.label);
    }
    this.cache.refresh(signature);
  }

  /** Show or hide the touch corner pause button (the wiring decides visibility via
   *  `pauseButtonVisible`). Its geometry is static, so this only flips visibility. */
  updateButton(visible: boolean): void {
    this.cornerButton.visible = visible;
  }

  /**
   * The header beam: the screen's own name hard left, its one line hard right —
   * the settings screen's construction, so the two overlays a paused player steps
   * between are framed identically.
   */
  private drawHeader(model: PauseMenuModel, title: Rect, m: FrameMetrics): void {
    const visible = title.height > 0 && model.headline.length > 0;
    this.headline.visible = visible;
    this.subhead.visible = false;
    if (!visible) return;

    const headingPx = typeSize(HEADING_PX, m);
    this.headline.text = model.headline;
    this.headline.style.fontSize = headingPx;
    this.headline.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, headingPx);
    this.headline.x = title.x;
    this.headline.y = title.y + title.height / 2;

    if (model.subhead.length === 0) return;
    const subPx = typeSize(SUB_PX, m);
    this.subhead.text = model.subhead;
    this.subhead.style.fontSize = subPx;
    this.subhead.style.letterSpacing = trackingPx(TRACKING.label, subPx);
    this.subhead.x = title.x + title.width;
    this.subhead.y = title.y + title.height / 2;
    // On a narrow beam the line gives way to the name: the name says which screen
    // this is, and the line only describes it.
    this.subhead.visible = this.headline.width + this.subhead.width + m.gutter <= title.width;
  }

  /**
   * One plate: the material (bevel, sheen, cast shadow, gantry cut, accent tick)
   * from {@link ../art/materials} `drawPlate`, then the label hung off the tick.
   * The press offset is inside `drawPlate`, so the label is nudged by the same
   * amount here to keep the two pieces of one plate together.
   */
  private drawButton(nodes: ButtonNodes, button: PauseButtonView, rect: Rect, m: FrameMetrics): void {
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
    this.overlay.addChild(body, label);
    const nodes: ButtonNodes = { body, label };
    this.buttonNodes[index] = nodes;
    return nodes;
  }

  /**
   * Redraw the corner button — a chip plate carrying the universal two-bar pause
   * glyph in the brightest step of the Bone ramp. A chip, not a plate: at 48px
   * square there is no room for the gantry cut or a 2px bezel, which is exactly
   * the case `chip` is the handoff's answer to. Static geometry, so this runs only
   * on construction and resize.
   */
  private drawCornerButton(): void {
    const r = this.cornerRect;
    this.cornerBody.clear();
    drawPlate(this.cornerBody, r.x, r.y, r.width, r.height, 'secondary', 'chip');

    const barW = Math.max(3, r.width * 0.12);
    const barH = r.height * 0.42;
    const gap = barW * 1.4;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    this.cornerBars.clear();
    this.cornerBars
      .rect(cx - gap / 2 - barW, cy - barH / 2, barW, barH)
      .rect(cx + gap / 2, cy - barH / 2, barW, barH)
      .fill({ color: BONE.hi, alpha: 0.92 });
  }
}

function sameIds(a: readonly PauseButton[], b: readonly PauseButton[]): boolean {
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
