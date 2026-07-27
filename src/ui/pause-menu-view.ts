/**
 * src/ui/pause-menu-view.ts — the Pixi view for the pause menu. OWNER: UI Engineer.
 *
 * The drawing half of {@link ./pause-menu}. The words and the buttons come from
 * the model, the rects from `pauseLayout`; this file only colours them. It draws
 * two independent things:
 *
 *  - **The overlay** — a full-screen backdrop, a headline and a button stack, up
 *    on the `menu` and `confirm` screens (the `settings` screen is drawn by the
 *    real {@link ./settings-view}, which the pause wiring shows in its place).
 *  - **The corner pause button** — the touch-only way in, a small square with the
 *    universal two-bar pause glyph, shown while the match owns the screen.
 *
 * Both register with the layout registry so QA's placement suite can assert them
 * mechanically. Colour discipline (style-guide §2): RESUME/STAY are plasma
 * (affirmative), everything else steel — no threat red on LEAVE, because red is
 * reserved for real damage, not a menu's destructive action.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_BODY, FONT_HEADING, TEXT_DIM, TEXT_PRIMARY } from './typography';
import { buttonStyle } from './button-theme';
import {
  PAUSE_ANCHOR,
  PAUSE_BUTTON_ANCHOR,
  PAUSE_BUTTON_ID,
  PAUSE_ID,
  pauseButtonRect,
  pauseHitTest,
  pauseLayout,
} from './pause-menu';
import type { PauseButton, PauseLayout, PauseMenuModel, PauseTarget } from './pause-menu';
import type { Insets } from './menu-geometry';

export { PAUSE_ANCHOR, PAUSE_BUTTON_ANCHOR };

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
  private readonly overlay = new Container();
  private readonly headline: Text;
  private readonly subhead: Text;
  private readonly buttonNodes: ButtonNodes[] = [];

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
    this.layout = this.relayout(3);

    this.headline = makeText('', FONT_HEADING, 44, TEXT_PRIMARY);
    this.headline.anchor.set(0.5, 0.5);
    this.subhead = makeText('', FONT_BODY, 15, TEXT_DIM);
    this.subhead.anchor.set(0.5, 0.5);
    this.overlay.addChild(this.backdrop, this.headline, this.subhead);
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
    this.layout = this.relayout(Math.max(1, this.buttonIds.length || 3));
    this.cornerRect = pauseButtonRect(this.viewport);
    this.drawCornerButton();
  }

  private relayout(buttonCount: number): PauseLayout {
    return pauseLayout(this.viewport, buttonCount, opts(this.isTouch, this.insets));
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
    if (ids.length !== this.buttonIds.length) this.layout = this.relayout(Math.max(1, ids.length));
    this.buttonIds = ids;

    const visible = model.buttons.length > 0;
    this.overlay.visible = visible;
    if (!visible) return;

    const { content, headline, subhead, buttons } = this.layout;
    this.backdrop.clear();
    this.backdrop
      .rect(content.x - 8, content.y - 8, content.width + 16, content.height + 16)
      .fill({ color: PALETTE.vacuum, alpha: 0.92 });

    this.headline.text = model.headline;
    this.headline.x = headline.x + headline.width / 2;
    this.headline.y = headline.y + headline.height / 2;

    this.subhead.text = model.subhead;
    this.subhead.x = subhead.x + subhead.width / 2;
    this.subhead.y = subhead.y + subhead.height / 2;
    this.subhead.visible = subhead.height > 0 && model.subhead.length > 0;

    for (let i = 0; i < buttons.length; i++) {
      const rect = buttons[i];
      const button = model.buttons[i];
      if (!rect || !button) continue;
      this.drawButton(this.buttonSlot(i), rect, button.label, button.primary);
    }
    for (let i = buttons.length; i < this.buttonNodes.length; i++) {
      const nodes = this.buttonNodes[i];
      if (nodes) setVisible(false, nodes.body, nodes.label);
    }
  }

  /** Show or hide the touch corner pause button (the wiring decides visibility via
   *  `pauseButtonVisible`). Its geometry is static, so this only flips visibility. */
  updateButton(visible: boolean): void {
    this.cornerButton.visible = visible;
  }

  private drawButton(nodes: ButtonNodes, rect: Rect, label: string, primary: boolean): void {
    const style = buttonStyle(primary ? 'primary' : 'standard');
    setVisible(true, nodes.body, nodes.label);
    nodes.body.clear();
    nodes.body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: style.fill, alpha: style.fillAlpha })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({ width: style.strokeWidth, color: style.stroke, alpha: style.strokeAlpha });
    nodes.label.text = label;
    nodes.label.style.fill = style.label;
    nodes.label.alpha = style.labelAlpha;
    nodes.label.x = rect.x + rect.width / 2;
    nodes.label.y = rect.y + rect.height / 2;
  }

  private buttonSlot(index: number): ButtonNodes {
    const existing = this.buttonNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, 16, TEXT_PRIMARY);
    label.anchor.set(0.5, 0.5);
    this.overlay.addChild(body, label);
    const nodes: ButtonNodes = { body, label };
    this.buttonNodes[index] = nodes;
    return nodes;
  }

  /** Redraw the corner button — a steel square with the two-bar pause glyph in
   *  plasma. Static geometry, so this runs only on construction and resize. */
  private drawCornerButton(): void {
    const style = buttonStyle('standard');
    const r = this.cornerRect;
    this.cornerBody.clear();
    this.cornerBody
      .roundRect(r.x, r.y, r.width, r.height, 6)
      .fill({ color: style.fill, alpha: style.fillAlpha })
      .roundRect(r.x, r.y, r.width, r.height, 6)
      .stroke({ width: style.strokeWidth, color: style.stroke, alpha: style.strokeAlpha });

    // The universal pause glyph: two vertical bars, centred.
    const barW = Math.max(3, r.width * 0.12);
    const barH = r.height * 0.42;
    const gap = barW * 1.4;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    this.cornerBars.clear();
    this.cornerBars
      .rect(cx - gap / 2 - barW, cy - barH / 2, barW, barH)
      .rect(cx + gap / 2, cy - barH / 2, barW, barH)
      .fill({ color: PALETTE.plasma, alpha: 0.95 });
  }
}

function opts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
}

function setVisible(visible: boolean, ...nodes: Array<Graphics | Text>): void {
  for (const node of nodes) node.visible = visible;
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 1 } });
}
