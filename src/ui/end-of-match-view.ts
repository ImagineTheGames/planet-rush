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
import { SUMMARY_MATCH_TIME_LABEL } from './summary-sequence';
import type { SummaryFrame } from './summary-sequence';
import { ScreenCache } from './screen-cache';

export const END_OF_MATCH_ANCHOR: AnchorSpec = { region: 'full' };

/** Reference type sizes. The result keeps the 48px it has always been set at. */
const HEADLINE_PX = 48;
const SUB_PX = 15;
const EYEBROW_PX = 12;
const LABEL_PX = { primary: 27, secondary: 21 } as const;
/** Gap between a plate's accent tick and its label (handoff 24). */
const TICK_GAP = 24;

/** The summary sheet's reference type sizes (pr-05). */
const SHEET_PX = {
  matchTime: 13,
  rowLabel: 14,
  rowValue: 17,
  rowXp: 11,
  xpLabel: 13,
  xpValue: 30,
  level: 18,
  progress: 12,
} as const;

/** How far a row rises as it fades in, at the reference. */
const SHEET_RISE = 8;
/** How much of a row's width the value column takes — the XP a row earned hangs
 *  to the LEFT of it, so the two right-aligned numbers never collide. */
const SHEET_VALUE_COLUMN = 0.3;

/** The buttons the summary lays out before it has seen a model. */
const DEFAULT_BUTTONS: readonly EndButton[] = ['rematch', 'menu'];

interface ButtonNodes {
  readonly body: Graphics;
  readonly label: Text;
}

/** The three texts one stat row is made of. */
interface RowNodes {
  readonly label: Text;
  readonly value: Text;
  readonly xp: Text;
}

/**
 * The end-of-match summary. Add once, {@link resize} on viewport changes,
 * {@link update} each frame with an {@link EndOfMatchModel}; show it when the
 * flow reaches its `end` screen and hide it on rematch or spectate.
 */
export class EndOfMatchView extends Container {
  /**
   * The screen's STATIC half — backdrop, beams, the result, the plates.
   *
   * It is its own container because pr-05 hung a five-second animation off this
   * screen, and `ScreenCache` is a rasteriser: a cache that re-renders every frame
   * is strictly worse than no cache at all (./screen-cache), and the plates are
   * the expensive thing in here. So the chrome is cached on the model, exactly as
   * before, and the summary sheet below draws live beside it — a handful of texts
   * and three rectangles, which is what a per-frame layer may cost.
   */
  private readonly chrome = new Container();
  /** The animating half — nothing in here is ever cached. */
  private readonly sheet = new Container();
  private readonly backdrop = new Graphics();
  private readonly beams = new Graphics();
  private readonly rule = new Graphics();
  private readonly bar = new Graphics();
  private readonly eyebrow: Text;
  private readonly headline: Text;
  private readonly subhead: Text;
  private readonly matchTime: Text;
  private readonly xpLabel: Text;
  private readonly xpValue: Text;
  private readonly levelLabel: Text;
  private readonly progress: Text;
  private readonly buttonNodes: ButtonNodes[] = [];
  private readonly rowNodes: RowNodes[] = [];
  /** The chrome is static between state changes but `update()` runs per frame —
   *  and a Gantry plate is ~56 translucent polygons (./screen-cache). */
  private readonly cache = new ScreenCache(this.chrome);

  private layout: EndOfMatchLayout;
  private buttonIds: EndButton[] = [];
  private summaryRows = 0;
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
    this.chrome.addChild(this.backdrop, this.beams, this.rule, this.eyebrow, this.headline, this.subhead);

    // The sheet: the match-time line, the XP total, the level readout and the bar.
    this.matchTime = makeText('', FONT_BODY, SHEET_PX.matchTime, MATERIAL_SHADES.boneLo);
    this.matchTime.anchor.set(0.5, 0.5);
    this.xpLabel = makeText('', FONT_BODY, SHEET_PX.xpLabel, MATERIAL_SHADES.boneLo);
    this.xpLabel.anchor.set(0, 0.5);
    this.xpValue = makeText('', FONT_HEADING, SHEET_PX.xpValue, BONE.hi);
    this.xpValue.anchor.set(1, 0.5);
    this.levelLabel = makeText('', FONT_HEADING, SHEET_PX.level, BONE.hi);
    this.levelLabel.anchor.set(0, 0.5);
    this.progress = makeText('', FONT_BODY, SHEET_PX.progress, MATERIAL_SHADES.boneLo);
    this.progress.anchor.set(1, 0.5);
    this.sheet.addChild(this.matchTime, this.xpLabel, this.xpValue, this.levelLabel, this.progress, this.bar);

    this.addChild(this.chrome, this.sheet);
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
    return endOfMatchLayout(this.viewport, buttonIds, {
      ...opts(this.isTouch, this.insets),
      summaryRows: this.summaryRows,
    });
  }

  hitTest(x: number, y: number): EndTarget | null {
    return endOfMatchHitTest(this.layout, x, y, this.buttonIds);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: END_OF_MATCH_ID, anchor: END_OF_MATCH_ANCHOR, bounds: { ...this.layout.content } }];
  }

  /**
   * Draw one frame.
   *
   * `summary` is pr-05's choreographed sequence at this instant — the XP sheet,
   * counted up to wherever the timeline has it. Pass `null` (the default) for a
   * screen that carries none: the DEFEATED overlay, which is shown *during* a live
   * match and where XP may never appear (plan §Q2, Trap 14). With it null this
   * draws exactly what it drew before pr-05.
   */
  update(model: EndOfMatchModel, summary: SummaryFrame | null = null): void {
    // The button set is part of the model (spectate comes and goes, and the two
    // plates are different SIZES), so the layout is re-derived when it changes — a
    // summary that laid out two buttons and drew one would leave a live rect under
    // nothing. The sheet's presence moves the furniture for the same reason.
    const ids = model.buttons.map((b) => b.id);
    const rows = summary ? summary.rows.length : 0;
    if (!sameIds(ids, this.buttonIds) || rows !== this.summaryRows) {
      this.buttonIds = ids;
      this.summaryRows = rows;
      this.layout = this.relayout(ids);
      this.cache.invalidate();
    }
    if (!this.visible) return;
    // The sheet is redrawn every frame it exists; the chrome only when it changes.
    this.sheet.visible = summary !== null;
    if (summary) this.drawSheet(summary, this.layout, this.layout.metrics);
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

  /**
   * The summary sheet: the match-time line, the seven rows, the XP total and the
   * level bar, at this instant of the sequence.
   *
   * Every number here arrives already counted (`./summary-sequence`); this
   * function formats nothing and decides nothing. What it *does* own is the
   * arrival: a row fades in and rises the last few pixels into place, which is the
   * only motion this screen has that the model does not describe in words.
   *
   * No hue anywhere, per the screen's own rule — the bar is chalk metal on the
   * shaded end of the Bone ramp, and the level-up flash is the same ramp's
   * brightest step rather than a colour. The one colour on this screen is still
   * the winner's identity rule.
   */
  private drawSheet(frame: SummaryFrame, layout: EndOfMatchLayout, m: FrameMetrics): void {
    const place = layout.summary;
    const rise = Math.max(2, Math.round(SHEET_RISE * m.scale));

    // The match-time line, under the result.
    const timeRect = layout.matchTime;
    this.matchTime.visible = timeRect.height > 0;
    if (this.matchTime.visible) {
      const px = typeSize(SHEET_PX.matchTime, m);
      this.matchTime.text = `${SUMMARY_MATCH_TIME_LABEL} · ${frame.matchTime}`;
      this.matchTime.style.fontSize = px;
      this.matchTime.style.letterSpacing = trackingPx(TRACKING.label, px);
      this.matchTime.alpha = frame.matchTimeAppear;
      this.matchTime.x = timeRect.x + timeRect.width / 2;
      this.matchTime.y = timeRect.y + timeRect.height / 2 + (1 - frame.matchTimeAppear) * rise;
    }

    if (!place) {
      this.sheet.visible = false;
      return;
    }

    // The rows. Label left, the value hard right, and the XP it earned to the
    // left of the value — two right-aligned numbers that never collide.
    for (let i = 0; i < frame.rows.length; i++) {
      const rect = place.rows[i];
      const row = frame.rows[i];
      const nodes = this.rowSlot(i);
      if (!rect || !row || rect.height <= 0) {
        setVisible(false, nodes.label, nodes.value, nodes.xp);
        continue;
      }
      setVisible(true, nodes.label, nodes.value);
      const cy = rect.y + rect.height / 2 + (1 - row.appear) * rise;
      const labelPx = typeSize(SHEET_PX.rowLabel, m);
      nodes.label.text = row.label;
      nodes.label.style.fontSize = labelPx;
      nodes.label.style.letterSpacing = trackingPx(TRACKING.label, labelPx);
      nodes.label.alpha = row.appear;
      nodes.label.x = rect.x;
      nodes.label.y = cy;

      const valuePx = typeSize(SHEET_PX.rowValue, m);
      nodes.value.text = row.text;
      nodes.value.style.fontSize = valuePx;
      nodes.value.alpha = row.appear;
      nodes.value.x = rect.x + rect.width;
      nodes.value.y = cy;

      nodes.xp.visible = row.xpText !== null;
      if (row.xpText !== null) {
        const xpPx = typeSize(SHEET_PX.rowXp, m);
        nodes.xp.text = row.xpText;
        nodes.xp.style.fontSize = xpPx;
        nodes.xp.style.letterSpacing = trackingPx(TRACKING.label, xpPx);
        nodes.xp.alpha = row.appear;
        nodes.xp.x = rect.x + rect.width - Math.round(rect.width * SHEET_VALUE_COLUMN);
        nodes.xp.y = cy;
      }
    }
    for (let i = frame.rows.length; i < this.rowNodes.length; i++) {
      const nodes = this.rowNodes[i];
      if (nodes) setVisible(false, nodes.label, nodes.value, nodes.xp);
    }

    // The XP total — one number, the summation of everything above it.
    const totalRect = place.xpTotal;
    const totalVisible = totalRect.height > 0;
    setVisible(totalVisible, this.xpLabel, this.xpValue);
    if (totalVisible) {
      const labelPx = typeSize(SHEET_PX.xpLabel, m);
      this.xpLabel.text = 'XP EARNED';
      this.xpLabel.style.fontSize = labelPx;
      this.xpLabel.style.letterSpacing = trackingPx(TRACKING.label, labelPx);
      this.xpLabel.alpha = frame.xpAppear;
      this.xpLabel.x = totalRect.x;
      this.xpLabel.y = totalRect.y + totalRect.height / 2;
      const px = typeSize(SHEET_PX.xpValue, m);
      this.xpValue.text = frame.xpText;
      this.xpValue.style.fontSize = px;
      this.xpValue.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
      this.xpValue.alpha = frame.xpAppear;
      this.xpValue.x = totalRect.x + totalRect.width;
      this.xpValue.y = totalRect.y + totalRect.height / 2;
    }

    // The level readout, the bar, and the line that carries the number that moved.
    const levelRect = place.levelLabel;
    this.levelLabel.visible = levelRect.height > 0;
    if (this.levelLabel.visible) {
      const px = typeSize(SHEET_PX.level, m);
      this.levelLabel.text = frame.levelText;
      this.levelLabel.style.fontSize = px;
      this.levelLabel.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
      this.levelLabel.alpha = frame.barAppear;
      this.levelLabel.x = levelRect.x;
      this.levelLabel.y = levelRect.y + levelRect.height / 2;
    }

    const progressRect = place.progress;
    this.progress.visible = progressRect.height > 0;
    if (this.progress.visible) {
      const px = typeSize(SHEET_PX.progress, m);
      this.progress.text = frame.progressText;
      this.progress.style.fontSize = px;
      this.progress.style.letterSpacing = trackingPx(TRACKING.label, px);
      this.progress.alpha = frame.barAppear;
      this.progress.x = progressRect.x + progressRect.width;
      this.progress.y = progressRect.y + progressRect.height / 2;
    }

    const barRect = place.bar;
    this.bar.clear();
    if (barRect.width > 0 && barRect.height > 0 && frame.barAppear > 0) {
      this.bar.alpha = frame.barAppear;
      this.bar
        .rect(barRect.x, barRect.y, barRect.width, barRect.height)
        .fill({ color: MATERIAL_SHADES.chipFaceLit, alpha: 1 });
      const filled = Math.max(0, Math.min(1, frame.barFrac)) * barRect.width;
      if (filled > 0) {
        this.bar.rect(barRect.x, barRect.y, filled, barRect.height).fill({ color: MATERIAL_SHADES.bone, alpha: 1 });
      }
      // The level-up: the completed bar flashes to the ramp's brightest step and
      // decays. It is the one moment on this screen allowed to be a reward, and
      // it is still made of metal (plan §6.3 beat 4).
      if (frame.flash > 0) {
        this.bar
          .rect(barRect.x, barRect.y, barRect.width, barRect.height)
          .fill({ color: BONE.hi, alpha: frame.flash });
      }
      this.bar
        .rect(barRect.x, barRect.y, barRect.width, barRect.height)
        .stroke({ color: MATERIAL_SHADES.bone, alpha: 0.35, width: 1 });
    }
  }

  /** One stat row's three texts, made on first use. */
  private rowSlot(index: number): RowNodes {
    const existing = this.rowNodes[index];
    if (existing) return existing;
    const label = makeText('', FONT_BODY, SHEET_PX.rowLabel, MATERIAL_SHADES.boneLo);
    label.anchor.set(0, 0.5);
    const value = makeText('', FONT_HEADING, SHEET_PX.rowValue, BONE.hi);
    value.anchor.set(1, 0.5);
    const xp = makeText('', FONT_BODY, SHEET_PX.rowXp, MATERIAL_SHADES.bone);
    xp.anchor.set(1, 0.5);
    this.sheet.addChild(label, value, xp);
    const nodes: RowNodes = { label, value, xp };
    this.rowNodes[index] = nodes;
    return nodes;
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
    this.chrome.addChild(body, label);
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
