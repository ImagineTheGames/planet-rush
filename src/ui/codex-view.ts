/**
 * src/ui/codex-view.ts — the Pixi view for the CODEX screen.
 * OWNER: Gameplay Engineer (brief c1-codex-screen).
 *
 * The drawing half of {@link ./codex}. Every value lives in the model and every
 * rect in {@link ./codex} `codexLayout`; this file turns them into Graphics and
 * Text and owns nothing but which child is which, plus the two things a static
 * model cannot hold: the entry rail's and the detail body's **scroll offsets**,
 * because a fourteen-entry tab (SYSTEMS) and a long body both overflow the short
 * landscape-locked viewport. Both are clipped to their pane with a mask and
 * shifted by their offset; the rail's offset is fed back into
 * {@link codexHitTest} so a tap on a scrolled title lands right.
 *
 * The frozen contract, where it could only be broken here (style-guide §2, §7):
 *  - Audiowide for the heading, the tab labels and the entry titles (words);
 *    Oxanium for the body and the fact numerals.
 *  - Plasma marks the one active tab and the one selected entry; everything else
 *    is steel. No signal yellow (ore) and no threat red (danger) appear — the
 *    codex is neither.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_BODY, FONT_HEADING, TEXT_DIM, TEXT_PRIMARY } from './typography';
import { buttonStyle } from './button-theme';
import {
  CODEX_ID,
  codexHitTest,
  codexLayout,
  codexRailContentHeight,
} from './codex';
import type { CodexDetailView, CodexLayout, CodexModel, CodexTarget } from './codex';
import type { Insets } from './menu-geometry';

export const CODEX_ANCHOR: AnchorSpec = { region: 'full' };

/** Inner padding inside the detail pane. */
const DETAIL_PAD = 14;
/** Gap between stacked detail blocks. */
const BLOCK_GAP = 10;

interface TabNodes {
  readonly body: Graphics;
  readonly label: Text;
}
interface EntryNodes {
  readonly body: Graphics;
  readonly label: Text;
}
interface FactNodes {
  readonly value: Text;
  readonly label: Text;
}

/**
 * The codex screen. Add once, {@link resize} on every viewport change,
 * {@link update} each frame with a {@link CodexModel}; hide it on BACK. Route a
 * tap through {@link hitTest} and a wheel/drag through {@link scrollRail} /
 * {@link scrollDetail}.
 */
export class CodexView extends Container {
  private readonly backdrop = new Graphics();
  private readonly heading: Text;
  private readonly sectionLabel: Text;
  private readonly backBody = new Graphics();
  private readonly backLabel: Text;
  private readonly tabNodes: TabNodes[] = [];

  // The entry rail: a masked, scrollable list.
  private readonly railClip = new Container();
  private readonly railMask = new Graphics();
  private readonly railBg = new Graphics();
  private readonly entryNodes: EntryNodes[] = [];
  private railScroll = 0;

  // The detail pane: a masked, scrollable block flow.
  private readonly detailClip = new Container();
  private readonly detailMask = new Graphics();
  private readonly detailTitle: Text;
  private readonly detailBadges: Text;
  private readonly detailSummary: Text;
  private readonly detailBody: Text;
  private readonly detailFactsHead: Text;
  private readonly factNodes: FactNodes[] = [];
  private readonly detailSeeAlso: Text;
  private readonly detailEmpty: Text;
  private detailScroll = 0;
  private detailContentHeight = 0;

  private layout: CodexLayout;
  private width0: number;
  private height0: number;
  private isTouch0: boolean;
  private insets0: Insets | undefined;
  // Reset scroll when the shown content changes (a new tab or a new entry).
  private lastSection = '';
  private lastDetailTitle = '';

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.width0 = screenWidth;
    this.height0 = screenHeight;
    this.isTouch0 = isTouch;
    this.insets0 = insets;
    this.layout = codexLayout({ width: screenWidth, height: screenHeight }, 0, opts(isTouch, insets));

    this.heading = makeText('CODEX', FONT_HEADING, 26, TEXT_PRIMARY);
    this.heading.anchor.set(0, 0.5);
    this.sectionLabel = makeText('', FONT_BODY, 12, TEXT_DIM);
    this.sectionLabel.anchor.set(0, 0.5);
    this.backLabel = makeText('BACK', FONT_HEADING, 15, TEXT_PRIMARY);
    this.backLabel.anchor.set(0.5, 0.5);

    // Detail children live inside the masked, scrollable clip container.
    this.detailTitle = makeText('', FONT_HEADING, 20, TEXT_PRIMARY);
    this.detailBadges = makeText('', FONT_BODY, 12, PALETTE.plasma);
    this.detailSummary = makeText('', FONT_BODY, 13, TEXT_PRIMARY);
    this.detailBody = makeText('', FONT_BODY, 14, TEXT_PRIMARY);
    this.detailFactsHead = makeText('', FONT_HEADING, 12, TEXT_DIM);
    this.detailSeeAlso = makeText('', FONT_BODY, 12, TEXT_DIM);
    this.detailEmpty = makeText('', FONT_BODY, 13, TEXT_DIM);
    for (const t of [this.detailTitle, this.detailBadges, this.detailSummary, this.detailBody, this.detailFactsHead, this.detailSeeAlso, this.detailEmpty]) {
      t.anchor.set(0, 0);
    }
    this.detailClip.addChild(
      this.detailTitle,
      this.detailBadges,
      this.detailSummary,
      this.detailBody,
      this.detailFactsHead,
      this.detailSeeAlso,
      this.detailEmpty,
    );
    this.detailClip.mask = this.detailMask;
    this.railClip.mask = this.railMask;

    this.addChild(
      this.backdrop,
      this.heading,
      this.sectionLabel,
      this.backBody,
      this.backLabel,
      this.railBg,
      this.railMask,
      this.railClip,
      this.detailMask,
      this.detailClip,
    );
  }

  resize(width: number, height: number, isTouch = this.isTouch0, insets = this.insets0): void {
    this.width0 = width;
    this.height0 = height;
    this.isTouch0 = isTouch;
    this.insets0 = insets;
    // Layout is recomputed with the live entry count on the next update; recompute
    // now with the last known count so a resize between frames is not stale.
    this.layout = codexLayout({ width, height }, this.layout.railEntries.length, opts(isTouch, insets));
  }

  hitTest(x: number, y: number): CodexTarget | null {
    return codexHitTest(this.layout, x, y, this.railScroll);
  }

  /** Scroll the entry rail by `dy` (wheel notch / drag delta), clamped so it never
   *  scrolls past the last entry or above the first. */
  scrollRail(dy: number): void {
    const max = Math.max(0, codexRailContentHeight(this.layout) - this.layout.rail.height);
    this.railScroll = clamp(this.railScroll + dy, 0, max);
  }

  /** Scroll the detail body by `dy`, clamped to its measured content height. */
  scrollDetail(dy: number): void {
    const max = Math.max(0, this.detailContentHeight - this.layout.detail.height);
    this.detailScroll = clamp(this.detailScroll + dy, 0, max);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: CODEX_ID, anchor: CODEX_ANCHOR, bounds: { ...this.layout.content } }];
  }

  update(model: CodexModel): void {
    if (!this.visible) return;
    // Recompute the layout with the live entry count so the rail sizes to the tab.
    this.layout = codexLayout({ width: this.width0, height: this.height0 }, model.entries.length, opts(this.isTouch0, this.insets0));
    const { content, title, back, tabs, rail, detail } = this.layout;

    // A new tab (section) resets both scrolls; a new entry resets the detail.
    if (model.sectionTitle !== this.lastSection) {
      this.lastSection = model.sectionTitle;
      this.railScroll = 0;
      this.detailScroll = 0;
    }
    if ((model.detail?.title ?? '') !== this.lastDetailTitle) {
      this.lastDetailTitle = model.detail?.title ?? '';
      this.detailScroll = 0;
    }

    this.backdrop.clear();
    this.backdrop
      .rect(content.x - 8, content.y - 8, content.width + 16, content.height + 16)
      .fill({ color: PALETTE.vacuum, alpha: 0.98 });

    // Title band: heading on the left, the file title beneath it, BACK on the right.
    this.heading.text = model.title;
    this.heading.x = title.x + 2;
    this.heading.y = title.y + title.height / 2 - 8;
    this.sectionLabel.text = model.sectionTitle;
    this.sectionLabel.x = title.x + 4;
    this.sectionLabel.y = title.y + title.height / 2 + 12;
    this.drawButton(this.backBody, this.backLabel, back, model.backLabel, false);

    this.drawTabs(model, tabs);
    this.drawRail(model, rail);
    this.drawDetail(model.detail, detail);
  }

  private drawTabs(model: CodexModel, tabs: readonly Rect[]): void {
    for (let i = 0; i < tabs.length; i++) {
      const rect = tabs[i];
      const tab = model.tabs[i];
      if (!rect || !tab) continue;
      this.drawButton(this.tabSlot(i).body, this.tabSlot(i).label, rect, tab.label, tab.active);
    }
  }

  private drawRail(model: CodexModel, rail: Rect): void {
    // The rail background + the fixed clip mask (both in screen space; the clip
    // container is what scrolls, not the mask).
    this.railBg.clear();
    this.railBg.rect(rail.x, rail.y, rail.width, rail.height).fill({ color: PALETTE.hullSteel, alpha: 0.05 });
    this.railMask.clear();
    this.railMask.rect(rail.x, rail.y, rail.width, rail.height).fill({ color: 0xffffff });

    // Re-clamp the scroll (entry count may have shrunk) and apply it.
    this.scrollRail(0);
    this.railClip.y = -this.railScroll;

    for (let i = 0; i < model.entries.length; i++) {
      const rect = this.layout.railEntries[i];
      const entry = model.entries[i];
      if (!rect || !entry) continue;
      const nodes = this.entrySlot(i);
      nodes.body.visible = true;
      nodes.label.visible = true;
      const style = buttonStyle(entry.selected ? 'primary' : 'standard');
      nodes.body.clear();
      nodes.body
        .roundRect(rect.x, rect.y, rect.width, rect.height, 5)
        .fill({ color: style.fill, alpha: entry.selected ? style.fillAlpha : 0.06 })
        .roundRect(rect.x, rect.y, rect.width, rect.height, 5)
        .stroke({ width: entry.selected ? 2 : 1, color: style.stroke, alpha: entry.selected ? style.strokeAlpha : 0.3 });
      nodes.label.text = entry.title;
      nodes.label.style.fill = style.label;
      nodes.label.style.wordWrap = true;
      nodes.label.style.wordWrapWidth = Math.max(20, rect.width - 20);
      nodes.label.x = rect.x + 10;
      nodes.label.y = rect.y + rect.height / 2;
    }
    // Hide pooled rows beyond the current tab's length.
    for (let i = model.entries.length; i < this.entryNodes.length; i++) {
      const nodes = this.entryNodes[i];
      if (nodes) {
        nodes.body.visible = false;
        nodes.label.visible = false;
      }
    }
  }

  private drawDetail(detail: CodexDetailView | null, pane: Rect): void {
    this.detailMask.clear();
    this.detailMask.rect(pane.x, pane.y, pane.width, pane.height).fill({ color: 0xffffff });

    const showEmpty = detail === null;
    this.detailEmpty.visible = showEmpty;
    for (const t of [this.detailTitle, this.detailBadges, this.detailSummary, this.detailBody, this.detailFactsHead, this.detailSeeAlso]) {
      t.visible = !showEmpty;
    }
    if (!detail) {
      this.detailEmpty.text = 'No entries.';
      this.detailEmpty.x = pane.x + DETAIL_PAD;
      this.detailEmpty.y = pane.y + DETAIL_PAD;
      this.detailContentHeight = 0;
      this.detailClip.y = 0;
      return;
    }

    const wrap = Math.max(40, pane.width - 2 * DETAIL_PAD);
    const left = pane.x + DETAIL_PAD;
    let y = pane.y + DETAIL_PAD;

    y = this.placeBlock(this.detailTitle, detail.title, left, y, wrap, true);

    if (detail.badges.length > 0) {
      y += 4;
      y = this.placeBlock(this.detailBadges, detail.badges.join('   ·   '), left, y, wrap, false);
    } else {
      this.detailBadges.visible = false;
    }

    if (detail.summary) {
      y += BLOCK_GAP;
      this.detailSummary.style.fill = TEXT_DIM;
      y = this.placeBlock(this.detailSummary, detail.summary, left, y, wrap, false);
    } else {
      this.detailSummary.visible = false;
    }

    y += BLOCK_GAP;
    y = this.placeBlock(this.detailBody, detail.body, left, y, wrap, false);

    if (detail.facts.length > 0) {
      y += BLOCK_GAP;
      y = this.placeBlock(this.detailFactsHead, 'FIGURES', left, y, wrap, false);
      y += 4;
      for (let i = 0; i < detail.facts.length; i++) {
        const fact = detail.facts[i];
        if (!fact) continue;
        const nodes = this.factSlot(i);
        nodes.value.visible = true;
        nodes.label.visible = true;
        nodes.value.text = fact.value;
        nodes.value.x = left;
        nodes.value.y = y;
        nodes.label.text = fact.label;
        nodes.label.x = left + 84;
        nodes.label.style.wordWrap = true;
        nodes.label.style.wordWrapWidth = Math.max(20, wrap - 84);
        nodes.label.y = y;
        y += Math.max(nodes.value.height, nodes.label.height) + 4;
      }
    } else {
      this.detailFactsHead.visible = false;
    }
    // Hide pooled fact rows beyond this entry's fact count.
    for (let i = detail.facts.length; i < this.factNodes.length; i++) {
      const nodes = this.factNodes[i];
      if (nodes) {
        nodes.value.visible = false;
        nodes.label.visible = false;
      }
    }

    if (detail.seeAlso.length > 0) {
      y += BLOCK_GAP;
      y = this.placeBlock(this.detailSeeAlso, `See also — ${detail.seeAlso.join(', ')}`, left, y, wrap, false);
    } else {
      this.detailSeeAlso.visible = false;
    }

    this.detailContentHeight = y - pane.y + DETAIL_PAD;
    this.scrollDetail(0); // re-clamp against the fresh content height
    this.detailClip.y = -this.detailScroll;
  }

  /** Place a text block at `(x, y)` with word-wrap, returning the y below it. */
  private placeBlock(node: Text, text: string, x: number, y: number, wrapWidth: number, heading: boolean): number {
    node.visible = true;
    node.text = text;
    node.style.wordWrap = true;
    node.style.wordWrapWidth = wrapWidth;
    node.x = x;
    node.y = y;
    return y + node.height + (heading ? 2 : 0);
  }

  private drawButton(body: Graphics, label: Text, rect: Rect, text: string, active: boolean): void {
    // The active tab (and the selected entry) is PRIMARY plasma; everything else
    // is STANDARD steel. No control here is ever disabled, so gray never appears.
    const style = buttonStyle(active ? 'primary' : 'standard');
    body.clear();
    body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: style.fill, alpha: style.fillAlpha })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({ width: style.strokeWidth, color: style.stroke, alpha: style.strokeAlpha });
    label.text = text;
    label.style.fill = style.label;
    label.alpha = style.labelAlpha;
    label.x = rect.x + rect.width / 2;
    label.y = rect.y + rect.height / 2;
  }

  private tabSlot(index: number): TabNodes {
    const existing = this.tabNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, 15, TEXT_PRIMARY);
    label.anchor.set(0.5, 0.5);
    this.addChild(body, label);
    const nodes: TabNodes = { body, label };
    this.tabNodes[index] = nodes;
    return nodes;
  }

  private entrySlot(index: number): EntryNodes {
    const existing = this.entryNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, 12, TEXT_PRIMARY);
    label.anchor.set(0, 0.5);
    // Entry rows scroll with the rail clip, so they are children of it.
    this.railClip.addChild(body, label);
    const nodes: EntryNodes = { body, label };
    this.entryNodes[index] = nodes;
    return nodes;
  }

  private factSlot(index: number): FactNodes {
    const existing = this.factNodes[index];
    if (existing) return existing;
    const value = makeText('', FONT_BODY, 13, PALETTE.plasma);
    value.anchor.set(0, 0);
    const label = makeText('', FONT_BODY, 12, TEXT_DIM);
    label.anchor.set(0, 0);
    this.detailClip.addChild(value, label);
    const nodes: FactNodes = { value, label };
    this.factNodes[index] = nodes;
    return nodes;
  }
}

function opts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0.4 } });
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
