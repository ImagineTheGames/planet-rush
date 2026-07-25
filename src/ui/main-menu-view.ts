/**
 * src/ui/main-menu-view.ts — the Pixi view for the main menu.
 * OWNER: UI Engineer.
 *
 * The drawing half of {@link ./main-menu}. Every value lives in the model and
 * every rect in {@link ./main-menu} `mainMenuLayout`; this file turns them into
 * Graphics and Text and owns nothing but which child is which — the same shape as
 * {@link ./settings-view}.
 *
 * The frozen contract, where it could only be broken here (style-guide §1, §5.6):
 *  - Audiowide for the wordmark and the button labels (they are words, not
 *    numerals).
 *  - Plasma marks the one primary action (PLAY); the secondary button is steel.
 *    No signal yellow (reserved for ore) and no threat red (reserved for danger)
 *    appear on a screen where nothing is either.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_HEADING, TEXT_PRIMARY } from './typography';
import { MAIN_MENU_ID, mainMenuHitTest, mainMenuLayout } from './main-menu';
import type { MainMenuLayout, MainMenuModel, MainMenuOption } from './main-menu';
import type { Insets } from './menu-geometry';

export const MAIN_MENU_ANCHOR: AnchorSpec = { region: 'full' };

interface ButtonNodes {
  readonly body: Graphics;
  readonly label: Text;
}

/**
 * The main menu screen. Add once, {@link resize} on every viewport change,
 * {@link update} each frame with a {@link MainMenuModel}; hide it when the player
 * presses PLAY.
 */
export class MainMenuView extends Container {
  private readonly backdrop = new Graphics();
  private readonly heading: Text;
  private readonly buttonNodes: ButtonNodes[] = [];

  private layout: MainMenuLayout;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = mainMenuLayout({ width: screenWidth, height: screenHeight }, opts(isTouch, insets));
    this.heading = makeText('PLANET RUSH', FONT_HEADING, 40, TEXT_PRIMARY);
    this.heading.anchor.set(0.5, 0.5);
    this.addChild(this.backdrop, this.heading);
  }

  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.layout = mainMenuLayout({ width, height }, opts(isTouch, insets));
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
    const { content, title, buttons } = this.layout;

    // Opaque backdrop over the whole content box — the menu owns the screen; no
    // half-built world shows through behind it (there is none yet, by design).
    this.backdrop.clear();
    this.backdrop
      .rect(content.x - 8, content.y - 8, content.width + 16, content.height + 16)
      .fill({ color: PALETTE.vacuum, alpha: 1 });

    this.heading.text = model.title;
    this.heading.x = title.x + title.width / 2;
    this.heading.y = title.y + title.height / 2;
    // Scale the wordmark down if the safe title band is too narrow for it (a
    // small phone in portrait), never up — Audiowide is wide.
    this.heading.scale.set(1);
    const maxWidth = Math.max(0, title.width - 24);
    if (this.heading.width > maxWidth && this.heading.width > 0) {
      this.heading.scale.set(maxWidth / this.heading.width);
    }

    for (let i = 0; i < buttons.length; i++) {
      const rect = buttons[i];
      const button = model.buttons[i];
      if (!rect || !button) continue;
      this.drawButton(this.buttonSlot(i), button.label, rect, button.primary);
    }
  }

  private drawButton(nodes: ButtonNodes, label: string, rect: Rect, primary: boolean): void {
    const tint = primary ? PALETTE.plasma : PALETTE.hullSteel;
    nodes.body.clear();
    nodes.body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: tint, alpha: primary ? 0.18 : 0.09 })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({ width: primary ? 2 : 1, color: tint, alpha: 0.8 });

    nodes.label.text = label;
    nodes.label.style.fill = primary ? TEXT_PRIMARY : PALETTE.hullSteel;
    nodes.label.x = rect.x + rect.width / 2;
    nodes.label.y = rect.y + rect.height / 2;
  }

  private buttonSlot(index: number): ButtonNodes {
    const existing = this.buttonNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, 18, TEXT_PRIMARY);
    label.anchor.set(0.5, 0.5);
    this.addChild(body, label);
    const nodes: ButtonNodes = { body, label };
    this.buttonNodes[index] = nodes;
    return nodes;
  }
}

function opts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0.5 } });
}
