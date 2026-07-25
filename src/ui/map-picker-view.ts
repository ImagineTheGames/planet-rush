/**
 * src/ui/map-picker-view.ts — the Pixi view for the map picker. OWNER: UI Engineer.
 *
 * The drawing half of {@link ./map-picker}. Every word lives in the model and
 * every rect in {@link ./map-picker} `mapPickerLayout`; this file turns them into
 * Graphics and Text and owns nothing but which child is which — the same shape as
 * {@link ./main-menu-view}.
 *
 * The frozen contract, where it could only be broken here (style-guide §1, §2):
 *  - Names in Audiowide (words), blurbs in Oxanium (body) — never crossed (§7).
 *  - The selected card is marked in **plasma** (energy/selection); an unselected
 *    one is steel. No **signal yellow** anywhere — a map card is neither ore nor
 *    danger, and the reserved rule is the one that carries the most weight (§2).
 *  - The mini preview draws each home planet as a **patina** disc, the planet's
 *    own body colour (§5), inside a steel arena frame. The picture is
 *    `map.planets(...)` normalised into the box, so it is the board the sim will
 *    build — it cannot drift from the registry.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_BODY, FONT_HEADING, TEXT_DIM, TEXT_PRIMARY } from './typography';
import { MAP_PICKER_ID, mapPickerHitTest } from './map-picker';
import type { MapCardModel, MapPickerLayout, MapPickerModel, MapPreview } from './map-picker';

/** The picker sits in the vertical middle of the menu, between the wordmark and
 *  the buttons (`main.ts` reserves the band). */
export const MAP_PICKER_ANCHOR: AnchorSpec = { region: 'center' };

/** Card inner padding. */
const CARD_PAD = 8;
/** Fraction of a card's height the preview box takes off the top. */
const PREVIEW_FRACTION = 0.5;
/** Below this card height the blurb is dropped rather than clipped — the same
 *  "protect the read, drop the detail" rule the lobby tiles keep. */
const BLURB_MIN_CARD_HEIGHT = 116;

interface CardNodes {
  readonly body: Graphics;
  readonly preview: Graphics;
  readonly name: Text;
  readonly blurb: Text;
  readonly veteran: Text;
  readonly veteranBg: Graphics;
}

/**
 * The map picker overlay. Add once to the menu root, {@link setLayout} whenever the
 * reserved band changes (a resize), {@link update} each frame with a
 * {@link MapPickerModel}; hide it when the menu leaves the screen (settings, PLAY).
 */
export class MapPickerView extends Container {
  private readonly cardNodes: CardNodes[] = [];
  private layout: MapPickerLayout = { band: zeroRect(), cards: [], columns: 0, shape: 'row' };

  /** Adopt a freshly computed layout (the band the menu reserved, divided into
   *  card rects). The next {@link update} draws against it. */
  setLayout(layout: MapPickerLayout): void {
    this.layout = layout;
  }

  hitTest(x: number, y: number): number | null {
    return mapPickerHitTest(this.layout, x, y);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible || this.layout.band.width <= 0 || this.layout.band.height <= 0) return [];
    return [{ id: MAP_PICKER_ID, anchor: MAP_PICKER_ANCHOR, bounds: { ...this.layout.band } }];
  }

  update(model: MapPickerModel): void {
    if (!this.visible) return;
    for (let i = 0; i < this.layout.cards.length; i++) {
      const rect = this.layout.cards[i];
      const card = model.cards[i];
      if (!rect || !card) continue;
      this.drawCard(this.cardSlot(i), card, rect);
    }
    // Any surplus slots from a previous, larger layout draw nothing.
    for (let i = this.layout.cards.length; i < this.cardNodes.length; i++) {
      this.hideCard(this.cardNodes[i]);
    }
  }

  private drawCard(nodes: CardNodes, card: MapCardModel, rect: Rect): void {
    const tint = card.selected ? PALETTE.plasma : PALETTE.hullSteel;

    nodes.body.clear();
    nodes.body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 8)
      .fill({ color: tint, alpha: card.selected ? 0.16 : 0.07 })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 8)
      .stroke({ width: card.selected ? 2 : 1, color: tint, alpha: card.selected ? 0.95 : 0.55 });

    // --- The preview box, off the top of the card -----------------------------
    const previewBox: Rect = {
      x: rect.x + CARD_PAD,
      y: rect.y + CARD_PAD,
      width: Math.max(0, rect.width - 2 * CARD_PAD),
      height: Math.max(0, rect.height * PREVIEW_FRACTION - CARD_PAD),
    };
    this.drawPreview(nodes.preview, card.preview, previewBox);

    // --- Name, then blurb, down the lower half --------------------------------
    const textX = rect.x + rect.width / 2;
    let cursorY = previewBox.y + previewBox.height + 6;
    nodes.name.text = card.name;
    nodes.name.x = textX;
    nodes.name.y = cursorY;
    nodes.name.visible = true;
    // Scale the name down if it runs wider than the card (a long map name on a
    // narrow phone card), never up.
    nodes.name.scale.set(1);
    const nameMax = Math.max(0, rect.width - 2 * CARD_PAD);
    if (nodes.name.width > nameMax && nodes.name.width > 0) nodes.name.scale.set(nameMax / nodes.name.width);
    cursorY += nodes.name.height * nodes.name.scale.y + 4;

    const showBlurb = rect.height >= BLURB_MIN_CARD_HEIGHT;
    nodes.blurb.visible = showBlurb;
    if (showBlurb) {
      nodes.blurb.text = card.blurb;
      nodes.blurb.style.wordWrapWidth = Math.max(0, rect.width - 2 * CARD_PAD);
      nodes.blurb.x = textX;
      nodes.blurb.y = cursorY;
    }

    // --- The VETERAN tag, a small pill in the top-right corner ----------------
    if (card.veteran) {
      nodes.veteran.visible = true;
      nodes.veteranBg.visible = true;
      const padX = 5;
      const padY = 2;
      const tw = nodes.veteran.width + 2 * padX;
      const th = nodes.veteran.height + 2 * padY;
      const tx = rect.x + rect.width - tw - CARD_PAD;
      const ty = rect.y + CARD_PAD;
      nodes.veteranBg.clear();
      nodes.veteranBg
        .roundRect(tx, ty, tw, th, 3)
        .fill({ color: PALETTE.vacuum, alpha: 0.7 })
        .roundRect(tx, ty, tw, th, 3)
        .stroke({ width: 1, color: PALETTE.hullSteel, alpha: 0.8 });
      nodes.veteran.x = tx + padX;
      nodes.veteran.y = ty + padY;
    } else {
      nodes.veteran.visible = false;
      nodes.veteranBg.visible = false;
    }
  }

  /** Draw the arena frame and its home-planet dots, letterboxed to the arena's
   *  aspect inside `box` so a wide map reads wide and a square one square. */
  private drawPreview(g: Graphics, preview: MapPreview, box: Rect): void {
    g.clear();
    if (box.width <= 0 || box.height <= 0) return;

    // Letterbox the arena box into the preview box, preserving aspect.
    const aspect = preview.aspect > 0 ? preview.aspect : 1;
    let drawW = box.width;
    let drawH = drawW / aspect;
    if (drawH > box.height) {
      drawH = box.height;
      drawW = drawH * aspect;
    }
    const drawX = box.x + (box.width - drawW) / 2;
    const drawY = box.y + (box.height - drawH) / 2;

    // The arena frame — steel, the "space with a steel frame" read (maps.ts).
    g.roundRect(drawX, drawY, drawW, drawH, 3)
      .fill({ color: PALETTE.vacuum, alpha: 0.6 })
      .roundRect(drawX, drawY, drawW, drawH, 3)
      .stroke({ width: 1, color: PALETTE.hullSteel, alpha: 0.5 });

    // Each home planet: a patina disc (its body colour), scaled to the box.
    const dotR = Math.max(1.5, Math.min(drawW, drawH) * 0.05);
    for (const p of preview.planets) {
      g.circle(drawX + p.x * drawW, drawY + p.y * drawH, dotR).fill({
        color: PALETTE.patina,
        alpha: 0.95,
      });
    }
  }

  private hideCard(nodes: CardNodes | undefined): void {
    if (!nodes) return;
    nodes.body.clear();
    nodes.preview.clear();
    nodes.veteranBg.clear();
    nodes.name.visible = false;
    nodes.blurb.visible = false;
    nodes.veteran.visible = false;
    nodes.veteranBg.visible = false;
  }

  private cardSlot(index: number): CardNodes {
    const existing = this.cardNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const preview = new Graphics();
    const name = makeText('', FONT_HEADING, 15, TEXT_PRIMARY);
    name.anchor.set(0.5, 0);
    const blurb = new Text({
      text: '',
      style: {
        fontFamily: FONT_BODY,
        fontSize: 11,
        fill: TEXT_DIM,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 120,
        lineHeight: 13,
      },
    });
    blurb.anchor.set(0.5, 0);
    const veteranBg = new Graphics();
    const veteran = makeText('VETERAN', FONT_BODY, 9, TEXT_PRIMARY);
    veteran.anchor.set(0, 0);
    // Draw order: body, preview, text, then the tag on top.
    this.addChild(body, preview, name, blurb, veteranBg, veteran);
    const nodes: CardNodes = { body, preview, name, blurb, veteran, veteranBg };
    this.cardNodes[index] = nodes;
    return nodes;
  }
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0.5 } });
}

function zeroRect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}
