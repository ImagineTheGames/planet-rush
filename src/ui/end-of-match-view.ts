/**
 * src/ui/end-of-match-view.ts — the Pixi view for the summary. OWNER: UI Engineer.
 *
 * The drawing half of {@link ./end-of-match}. The words and the buttons come from
 * the model, the rects from {@link ./end-of-match} `endOfMatchLayout`; this file
 * only colours them.
 *
 * The one colour decision that could only be made here (style-guide §2):
 *  - VICTORY wears the winner's own player colour — the one place colour is a
 *    player, which is exactly what §5.2 reserves it for.
 *  - ELIMINATED is the single screen in the menus where **threat red** is right:
 *    your core is destroyed, and that is damage, not decoration.
 *  - DEFEAT and DRAW stay neutral — a muted result, not a celebration and not an
 *    alarm.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_BODY, FONT_HEADING, TEXT_DIM, TEXT_PRIMARY } from './typography';
import { END_OF_MATCH_ID, endOfMatchHitTest, endOfMatchLayout } from './end-of-match';
import type { EndKind, EndOfMatchLayout, EndOfMatchModel, EndTarget } from './end-of-match';
import type { Insets } from './menu-geometry';

export const END_OF_MATCH_ANCHOR: AnchorSpec = { region: 'full' };

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
  private readonly headline: Text;
  private readonly subhead: Text;
  private readonly buttonNodes: ButtonNodes[] = [];

  private layout: EndOfMatchLayout;
  private buttonIds: EndTarget['kind'][] = [];
  private viewport: Viewport;
  private isTouch: boolean;
  private insets: Insets | undefined;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.viewport = { width: screenWidth, height: screenHeight };
    this.isTouch = isTouch;
    this.insets = insets;
    this.layout = this.relayout(2);
    this.headline = makeText('', FONT_HEADING, 48, TEXT_PRIMARY);
    this.headline.anchor.set(0.5, 0.5);
    this.subhead = makeText('', FONT_BODY, 15, TEXT_DIM);
    this.subhead.anchor.set(0.5, 0.5);
    this.addChild(this.backdrop, this.headline, this.subhead);
  }

  resize(width: number, height: number, isTouch = this.isTouch, insets = this.insets): void {
    this.viewport = { width, height };
    this.isTouch = isTouch;
    this.insets = insets;
    this.layout = this.relayout(Math.max(1, this.buttonIds.length || 2));
  }

  /** Re-derive the layout for the current viewport and a given button count. */
  private relayout(buttonCount: number): EndOfMatchLayout {
    return endOfMatchLayout(this.viewport, buttonCount, opts(this.isTouch, this.insets));
  }

  hitTest(x: number, y: number): EndTarget | null {
    return endOfMatchHitTest(this.layout, x, y, this.buttonIds);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: END_OF_MATCH_ID, anchor: END_OF_MATCH_ANCHOR, bounds: { ...this.layout.content } }];
  }

  update(model: EndOfMatchModel): void {
    // The button count is part of the model (spectate comes and goes), so the
    // layout is re-derived when it changes — a summary that laid out two buttons
    // and drew one would leave a live rect under nothing.
    const ids = model.buttons.map((b) => b.id);
    if (ids.length !== this.buttonIds.length) this.layout = this.relayout(ids.length);
    this.buttonIds = ids;
    if (!this.visible) return;

    const { content, headline, subhead, buttons } = this.layout;
    this.backdrop.clear();
    this.backdrop
      .rect(content.x - 8, content.y - 8, content.width + 16, content.height + 16)
      .fill({ color: PALETTE.vacuum, alpha: 0.92 });

    this.headline.text = model.headline;
    this.headline.style.fill = headlineColor(model.kind, model.accent);
    this.headline.x = headline.x + headline.width / 2;
    this.headline.y = headline.y + headline.height / 2;

    this.subhead.text = model.subhead;
    this.subhead.style.fill = model.accent ?? TEXT_DIM;
    this.subhead.x = subhead.x + subhead.width / 2;
    this.subhead.y = subhead.y + subhead.height / 2;
    this.subhead.visible = subhead.height > 0;

    for (let i = 0; i < buttons.length; i++) {
      const rect = buttons[i];
      const button = model.buttons[i];
      if (!rect || !button) continue;
      this.drawButton(this.buttonSlot(i), rect, button.label, button.primary);
    }
    // Any stale button slots (a spectate button that just vanished) go dark.
    for (let i = buttons.length; i < this.buttonNodes.length; i++) {
      const nodes = this.buttonNodes[i];
      if (nodes) setVisible(false, nodes.body, nodes.label);
    }
  }

  private drawButton(nodes: ButtonNodes, rect: Rect, label: string, primary: boolean): void {
    const tint = primary ? PALETTE.plasma : PALETTE.hullSteel;
    setVisible(true, nodes.body, nodes.label);
    nodes.body.clear();
    nodes.body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: tint, alpha: primary ? 0.18 : 0.09 })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({ width: primary ? 2 : 1, color: tint, alpha: 0.85 });
    nodes.label.text = label;
    nodes.label.style.fill = primary ? TEXT_PRIMARY : TEXT_DIM;
    nodes.label.x = rect.x + rect.width / 2;
    nodes.label.y = rect.y + rect.height / 2;
  }

  private buttonSlot(index: number): ButtonNodes {
    const existing = this.buttonNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, 16, TEXT_PRIMARY);
    label.anchor.set(0.5, 0.5);
    this.addChild(body, label);
    const nodes: ButtonNodes = { body, label };
    this.buttonNodes[index] = nodes;
    return nodes;
  }
}

/** VICTORY in the winner's colour; ELIMINATED in threat red (real damage);
 *  DEFEAT and DRAW neutral. */
function headlineColor(kind: EndKind, accent: number | null): number {
  if (kind === 'victory') return accent ?? PALETTE.plasma;
  if (kind === 'eliminated') return PALETTE.threatRed;
  if (kind === 'defeat') return TEXT_PRIMARY;
  return TEXT_DIM;
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
