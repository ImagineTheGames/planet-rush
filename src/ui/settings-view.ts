/**
 * src/ui/settings-view.ts — the Pixi view for the settings screen.
 * OWNER: UI Engineer.
 *
 * The drawing half of {@link ./settings}. Every value lives in the model and
 * every rect in {@link ./settings} `settingsLayout`; this file turns them into
 * Graphics and Text and owns nothing but which child is which.
 *
 * The frozen contract, where it could only be broken here (style-guide §2, §7):
 *  - Audiowide for the title and the labels; the values ride the same face
 *    because they are words (`AUTO-AIM`, `ON`), not numerals.
 *  - Plasma marks the one *engaged* state per toggle; an off toggle and the inert
 *    volume chrome are steel. No yellow (reserved for ore) and no red (reserved
 *    for danger) appear on a screen where nothing is either.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_HEADING, TEXT_DIM, TEXT_PRIMARY } from './typography';
import { buttonStyle } from './button-theme';
import {
  SETTINGS_ID,
  VOLUME_STEPS,
  settingsHitTest,
  settingsLayout,
  volumeButtons,
} from './settings';
import type { SettingsLayout, SettingsModel, SettingsRowView, SettingsTarget } from './settings';
import type { Insets } from './menu-geometry';

export const SETTINGS_ANCHOR: AnchorSpec = { region: 'full' };

interface RowNodes {
  readonly body: Graphics;
  readonly label: Text;
  readonly value: Text;
  readonly minus: Text;
  readonly plus: Text;
}

/**
 * The settings screen. Add once, {@link resize} on every viewport change,
 * {@link update} each frame with a {@link SettingsModel}; hide it when the flow
 * leaves the settings screen.
 */
export class SettingsView extends Container {
  private readonly backdrop = new Graphics();
  private readonly heading: Text;
  private readonly rowNodes: RowNodes[] = [];
  private readonly backBody = new Graphics();
  private readonly backLabel: Text;

  private layout: SettingsLayout;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = settingsLayout({ width: screenWidth, height: screenHeight }, opts(isTouch, insets));
    this.heading = makeText('SETTINGS', FONT_HEADING, 26, TEXT_PRIMARY);
    this.heading.anchor.set(0.5, 0.5);
    this.backLabel = makeText('DONE', FONT_HEADING, 15, TEXT_PRIMARY);
    this.backLabel.anchor.set(0.5, 0.5);
    this.addChild(this.backdrop, this.heading, this.backBody, this.backLabel);
  }

  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.layout = settingsLayout({ width, height }, opts(isTouch, insets));
  }

  hitTest(x: number, y: number): SettingsTarget | null {
    return settingsHitTest(this.layout, x, y);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: SETTINGS_ID, anchor: SETTINGS_ANCHOR, bounds: { ...this.layout.content } }];
  }

  update(model: SettingsModel): void {
    if (!this.visible) return;
    const { content, title, rows, back } = this.layout;

    this.backdrop.clear();
    this.backdrop
      .rect(content.x - 8, content.y - 8, content.width + 16, content.height + 16)
      .fill({ color: PALETTE.vacuum, alpha: 0.96 });

    this.heading.text = model.title;
    this.heading.x = title.x + title.width / 2;
    this.heading.y = title.y + title.height / 2;

    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i];
      const row = model.rows[i];
      if (!rect || !row) continue;
      this.drawRow(this.rowSlot(i), row, rect);
    }

    this.drawButton(this.backBody, this.backLabel, back, true, true);
  }

  private drawRow(nodes: RowNodes, row: SettingsRowView, rect: Rect): void {
    nodes.body.clear();
    nodes.body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: PALETTE.hullSteel, alpha: 0.08 })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({ width: 1, color: PALETTE.hullSteel, alpha: 0.35 });

    nodes.label.text = row.label;
    nodes.label.x = rect.x + 14;
    nodes.label.y = rect.y + rect.height / 2;

    if (row.kind === 'volume') {
      nodes.value.visible = false;
      this.drawVolume(nodes, row, rect);
    } else {
      nodes.minus.visible = false;
      nodes.plus.visible = false;
      this.drawToggle(nodes, row, rect);
    }
  }

  /** A toggle's value as a pill: plasma when engaged, steel when off. The pill
   *  sizes to its word so a long value ("TAP COMMANDER") reads inside its chrome
   *  rather than spilling past it, while a short one ("ON") stays snug — clamped
   *  to a floor so every toggle on the screen keeps a common minimum width, and to
   *  a share of the row so it can never crowd out the label on a narrow column. */
  private drawToggle(nodes: RowNodes, row: SettingsRowView, rect: Rect): void {
    const tint = row.on ? PALETTE.plasma : PALETTE.hullSteel;
    const pillH = Math.min(28, rect.height - 14);

    // Set the text first so its measured width can drive the pill width.
    nodes.value.visible = true;
    nodes.value.text = row.value;
    nodes.value.style.fill = row.on ? TEXT_PRIMARY : TEXT_DIM;

    const padX = 14;
    const floor = Math.min(96, rect.width * 0.4);
    const ceiling = Math.max(floor, rect.width * 0.62);
    const pillW = Math.min(ceiling, Math.max(floor, nodes.value.width + padX * 2));
    const px = rect.x + rect.width - pillW - 12;
    const py = rect.y + (rect.height - pillH) / 2;
    nodes.body
      .roundRect(px, py, pillW, pillH, pillH / 2)
      .fill({ color: tint, alpha: row.on ? 0.22 : 0.1 })
      .roundRect(px, py, pillW, pillH, pillH / 2)
      .stroke({ width: row.on ? 2 : 1, color: tint, alpha: row.on ? 0.9 : 0.5 });

    nodes.value.x = px + pillW / 2;
    nodes.value.y = py + pillH / 2;
  }

  /** A volume as filled/empty pips between a − and a + button. */
  private drawVolume(nodes: RowNodes, row: SettingsRowView, rect: Rect): void {
    const { minus, plus, bar } = volumeButtons(rect);
    const level = row.level ?? 0;
    const max = row.max ?? VOLUME_STEPS;

    for (const [box, glyph, node] of [
      [minus, '–', nodes.minus],
      [plus, '+', nodes.plus],
    ] as const) {
      nodes.body
        .roundRect(box.x, box.y + 6, box.width, box.height - 12, 5)
        .fill({ color: PALETTE.hullSteel, alpha: 0.14 })
        .roundRect(box.x, box.y + 6, box.width, box.height - 12, 5)
        .stroke({ width: 1, color: PALETTE.hullSteel, alpha: 0.5 });
      node.visible = true;
      node.text = glyph;
      node.x = box.x + box.width / 2;
      node.y = box.y + box.height / 2;
    }

    // The pips, left-aligned in the bar, leaving room after the label.
    const pipsX = bar.x + Math.min(bar.width * 0.5, 160);
    const pipsW = Math.max(0, bar.x + bar.width - pipsX - 8);
    if (pipsW <= 0 || max <= 0) return;
    const gap = 3;
    const pipW = Math.max(0, (pipsW - (max - 1) * gap) / max);
    const pipH = Math.min(12, rect.height - 20);
    const pipY = rect.y + (rect.height - pipH) / 2;
    for (let i = 0; i < max; i++) {
      const filled = i < level;
      nodes.body
        .roundRect(pipsX + i * (pipW + gap), pipY, pipW, pipH, 2)
        .fill({ color: filled ? PALETTE.plasma : PALETTE.hullSteel, alpha: filled ? 0.85 : 0.18 });
    }
  }

  private drawButton(body: Graphics, label: Text, rect: Rect, enabled: boolean, primary: boolean): void {
    // DONE is the screen's confirm — PRIMARY, and always enabled. Routed through
    // the one contract so it can never drift back to a gray-looking button.
    const style = buttonStyle(primary ? 'primary' : 'standard', !enabled);
    body.clear();
    body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: style.fill, alpha: style.fillAlpha })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({ width: style.strokeWidth, color: style.stroke, alpha: style.strokeAlpha });
    label.style.fill = style.label;
    label.alpha = style.labelAlpha;
    label.x = rect.x + rect.width / 2;
    label.y = rect.y + rect.height / 2;
  }

  private rowSlot(index: number): RowNodes {
    const existing = this.rowNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, 14, TEXT_PRIMARY);
    label.anchor.set(0, 0.5);
    const value = makeText('', FONT_HEADING, 13, TEXT_PRIMARY);
    value.anchor.set(0.5, 0.5);
    const minus = makeText('', FONT_HEADING, 20, TEXT_PRIMARY);
    minus.anchor.set(0.5, 0.5);
    const plus = makeText('', FONT_HEADING, 20, TEXT_PRIMARY);
    plus.anchor.set(0.5, 0.5);
    this.addChild(body, label, value, minus, plus);
    const nodes: RowNodes = { body, label, value, minus, plus };
    this.rowNodes[index] = nodes;
    return nodes;
  }
}

function opts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0.5 } });
}
