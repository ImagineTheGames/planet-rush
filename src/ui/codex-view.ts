/**
 * src/ui/codex-view.ts — the Pixi view for the CODEX screen.
 * OWNER: Gameplay Engineer (brief c1-codex-screen); the Gantry/Bone re-skin and
 * the frame it now sits in are the UI Engineer's (u7-04).
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
 * ---------------------------------------------------------------------------
 * GANTRY / BONE (u7-04) — AND THE LINE MATERIAL DOES NOT CROSS
 * ---------------------------------------------------------------------------
 * The handoff named five screens and this was not one of them, so the game's
 * densest text screen was still *"1px hairlines on black"* while the menu in
 * front of it had been re-skinned. It is now the same material as the rest of the
 * set: a header beam, a footer beam, tab CHIPS and rail ROWS — all of it from
 * {@link ../art/materials}, none of it invented here.
 *
 * And then it stops. **The reading pane gets no plate.** It is prose the player is
 * actually reading, and a bevelled panel behind a paragraph is a texture under
 * text; the frozen legibility rule (style-guide §9) outranks the register every
 * time they compete. So the chrome carries the material and the article sits on
 * bare Vacuum, separated from the rail by one hairline — the handoff's own
 * `MATERIAL_SHADES.hairline`, the divider rule it uses between sections.
 *
 * **Two selections, two different marks** — the thing this screen could most
 * easily have got wrong. The active TAB is a mode switch, so it is marked by
 * BRIGHTNESS (the selected chip's brighter metal and its Bone border). The
 * selected ENTRY is a pointer at the pane beside it, so it is marked
 * POSITIONALLY: a Bone bar down the row's leading edge, and the row rising from a
 * surface to a raised plate. Neither is the brightest plate on the screen, because
 * this screen has no headline action at all — zero primaries, which
 * {@link ./gantry} `singlePrimary` allows and a reference screen deserves.
 *
 * The frozen contract, where it could only be broken here (style-guide §2, §7):
 *  - Audiowide for the heading, the tab labels and the entry titles (words);
 *    Oxanium for the body, the fact numerals and the eyebrows.
 *  - **No hue at all.** The plasma that used to mark the active tab, the selected
 *    entry, the badges and the fact values is gone: Bone spends no colour on the
 *    menu, which is what leaves the palette's hues free to mean things in a match.
 *    Signal yellow (ore) and threat red (danger) never appear — the codex is
 *    neither.
 *  - **Prose takes no tracking.** The three tracking tiers are for uppercase tags,
 *    control words and names; running body text set on a tracking tier is a
 *    paragraph with gaps in it. Titles, eyebrows and labels track; the summary,
 *    the body and the see-also line do not.
 */

import { Container, Graphics, Text } from 'pixi.js';
import {
  BONE,
  DISPLAY_TRACKING,
  MATERIAL_SHADES,
  PLATE_SCALES,
  ROW,
  TRACKING,
  drawBeam,
  drawPlate,
  plateMaterial,
  plateTypeSize,
  trackingPx,
  typeSize,
} from '../art/materials';
import type { FrameMetrics } from '../art/materials';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { ScreenCache } from './screen-cache';
import { FONT_BODY, FONT_HEADING } from './typography';
import {
  CODEX_ID,
  codexEntryPlate,
  codexHitTest,
  codexLayout,
  codexRailContentHeight,
  codexTabPlate,
} from './codex';
import type {
  CodexDetailView,
  CodexEntryView,
  CodexLayout,
  CodexModel,
  CodexPlateState,
  CodexTabView,
  CodexTarget,
} from './codex';
import type { Insets } from './menu-geometry';

export const CODEX_ANCHOR: AnchorSpec = { region: 'full' };

// ---------------------------------------------------------------------------
// Reference type sizes — at the handoff's 1280×720
// ---------------------------------------------------------------------------

/** The screen's heading, in the header beam. The settings screen's 22px. */
const HEADING_PX = 22;
/** The section title, hard right in the same beam. */
const EYEBROW_PX = 12;
/** A tab chip's word, and BACK's. */
const TAB_PX = 15;
const BACK_PX = 18;
/** A rail row's entry title, and the plate scale the row itself is. `compact`
 *  rather than `standard`: a row is a list item, and its 18px chamfer is the
 *  gentler of the two cuts. */
const ENTRY_PX = 14;
const ENTRY_SCALE = 'compact' as const;
/** Gap between a row's accent tick and its title (the plates' own 24, tightened —
 *  a rail is 200–360px wide and a door is 800). */
const ENTRY_TICK_GAP = 12;

/** The article pane's own type. Body text is the biggest thing here for a reason:
 *  it is the only thing on this screen a player reads for more than a second. */
const DETAIL_TITLE_PX = 24;
const DETAIL_BADGE_PX = 12;
const DETAIL_SUMMARY_PX = 14;
const DETAIL_BODY_PX = 15;
const DETAIL_FACT_PX = 14;

/** Inner padding inside the detail pane, at the reference. */
const DETAIL_PAD = 20;
/** Gap between stacked detail blocks. */
const DETAIL_BLOCK_GAP = 12;
/** The fact table's value column, at the reference. */
const FACT_VALUE_COLUMN = 96;

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
  private readonly beams = new Graphics();
  private readonly heading: Text;
  private readonly sectionLabel: Text;
  private readonly backBody = new Graphics();
  private readonly backLabel: Text;
  private readonly tabNodes: TabNodes[] = [];

  // The entry rail: a masked, scrollable list.
  private readonly railClip = new Container();
  private readonly railMask = new Graphics();
  private readonly railChrome = new Graphics();
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
  /** The CODEX is static between state changes and scrolls — see ./screen-cache. */
  private readonly cache = new ScreenCache(this);

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.width0 = screenWidth;
    this.height0 = screenHeight;
    this.isTouch0 = isTouch;
    this.insets0 = insets;
    this.layout = codexLayout({ width: screenWidth, height: screenHeight }, 0, opts(isTouch, insets));

    this.heading = makeText('CODEX', FONT_HEADING, HEADING_PX, MATERIAL_SHADES.bone);
    this.heading.anchor.set(0, 0.5);
    this.sectionLabel = makeText('', FONT_BODY, EYEBROW_PX, MATERIAL_SHADES.boneLo);
    this.sectionLabel.anchor.set(1, 0.5);
    this.backLabel = makeText('BACK', FONT_HEADING, BACK_PX, MATERIAL_SHADES.bone);
    this.backLabel.anchor.set(0.5, 0.5);

    // Detail children live inside the masked, scrollable clip container.
    this.detailTitle = makeText('', FONT_HEADING, DETAIL_TITLE_PX, BONE.hi);
    this.detailBadges = makeText('', FONT_BODY, DETAIL_BADGE_PX, MATERIAL_SHADES.bone);
    this.detailSummary = makeText('', FONT_BODY, DETAIL_SUMMARY_PX, MATERIAL_SHADES.bone);
    this.detailBody = makeText('', FONT_BODY, DETAIL_BODY_PX, MATERIAL_SHADES.bone);
    this.detailFactsHead = makeText('', FONT_BODY, EYEBROW_PX, MATERIAL_SHADES.boneLo);
    this.detailSeeAlso = makeText('', FONT_BODY, DETAIL_BADGE_PX, MATERIAL_SHADES.boneLo);
    this.detailEmpty = makeText('', FONT_BODY, DETAIL_SUMMARY_PX, MATERIAL_SHADES.boneLo);
    for (const t of [
      this.detailTitle,
      this.detailBadges,
      this.detailSummary,
      this.detailBody,
      this.detailFactsHead,
      this.detailSeeAlso,
      this.detailEmpty,
    ]) {
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
      this.beams,
      this.heading,
      this.sectionLabel,
      this.backBody,
      this.backLabel,
      this.railChrome,
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
    // The cached texture is the size the OLD viewport rasterised to; refreshing
    // it in place would blit a stale-sized screen, so drop it (./screen-cache).
    this.cache.invalidate();
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
    this.layout = codexLayout(
      { width: this.width0, height: this.height0 },
      model.entries.length,
      opts(this.isTouch0, this.insets0),
    );
    const { header, footer, title, back, tabs, rail, detail, metrics } = this.layout;

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

    // This screen is called per FRAME, and it is the densest one in the set: four
    // tab chips, up to a rail full of row plates, two beams and a BACK plate, every
    // one of them a stack of translucent bands painted at `resolution:
    // devicePixelRatio`. Redraw only when something actually changed; blit the rest
    // of the time (./screen-cache).
    //
    // The two SCROLL offsets ride in the signature because they are the one piece
    // of this screen's state the model does not carry (`scrollRail` / `scrollDetail`
    // are driven straight from the wheel and the drag) — without them a scrolled
    // rail would blit the un-scrolled frame back. The re-clamps inside `drawRail` /
    // `drawDetail` can move an offset mid-draw; that costs one extra redraw on the
    // next frame and then settles, because a clamped offset is a fixed point.
    const signature = `${JSON.stringify(model)}|${this.railScroll}|${this.detailScroll}`;
    if (this.cache.unchanged(signature)) return;

    // Opaque backdrop over the whole viewport, drawn from the beams outward so the
    // beams' translucent fill has the void to sit on.
    this.backdrop.clear();
    this.backdrop
      .rect(0, 0, header.x * 2 + header.width, footer.y + footer.height + header.y)
      .fill({ color: PALETTE.vacuum, alpha: 1 });

    this.beams.clear();
    if (header.height > 0) drawBeam(this.beams, header.x, header.y, header.width, 'header', true, header.height);
    if (footer.height > 0) drawBeam(this.beams, footer.x, footer.y, footer.width, 'footer', true, footer.height);

    this.drawHeader(model, title, metrics);
    this.drawBack(model, back, metrics);
    this.drawTabs(model, tabs, metrics);
    this.drawRail(model, rail, metrics);
    this.drawDetail(model.detail, detail, metrics);

    // Everything above is now on the display list; rasterise it once so the frames
    // between state changes cost one blit rather than the whole screen
    // (./screen-cache).
    this.cache.refresh(signature);
  }

  /** The header beam: the heading hard left, the section title hard right — the
   *  settings screen's construction, because this is a utility screen and its
   *  heading is what names it. The section title gives way on a narrow beam: the
   *  heading says which screen you are on, the section only describes it. */
  private drawHeader(model: CodexModel, title: Rect, m: FrameMetrics): void {
    const visible = title.height > 0;
    this.heading.visible = visible;
    this.sectionLabel.visible = visible;
    if (!visible) return;

    const headingPx = typeSize(HEADING_PX, m);
    this.heading.text = model.title;
    this.heading.style.fontSize = headingPx;
    this.heading.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, headingPx);
    this.heading.x = title.x;
    this.heading.y = title.y + title.height / 2;

    const eyebrowPx = typeSize(EYEBROW_PX, m);
    this.sectionLabel.text = model.sectionTitle;
    this.sectionLabel.style.fontSize = eyebrowPx;
    this.sectionLabel.style.letterSpacing = trackingPx(TRACKING.name, eyebrowPx);
    this.sectionLabel.x = title.x + title.width;
    this.sectionLabel.y = title.y + title.height / 2;
    this.sectionLabel.visible =
      this.heading.width + this.sectionLabel.width + m.gutter <= title.width;
  }

  /** BACK — a `compact` plate bolted to the leading end of the footer beam, the
   *  exit corner every screen in this directory puts its way out in. `secondary`,
   *  never primary: leaving is not this screen's headline action, and the CODEX
   *  deliberately has none. */
  private drawBack(model: CodexModel, rect: Rect, m: FrameMetrics): void {
    this.backBody.clear();
    const visible = rect.width > 0 && rect.height > 0;
    this.backLabel.visible = visible;
    if (!visible) return;

    drawPlate(this.backBody, rect.x, rect.y, rect.width, rect.height, 'secondary', 'compact', model.backState);
    const px = plateTypeSize(BACK_PX, m);
    this.backLabel.text = model.backLabel;
    this.backLabel.style.fontSize = px;
    this.backLabel.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
    this.backLabel.x = rect.x + rect.width / 2;
    this.backLabel.y =
      rect.y + rect.height / 2 + plateMaterial('secondary', model.backState, 'plate').offsetY;
  }

  // --- The tab row ----------------------------------------------------------

  /**
   * The tabs, as chips — five of them since a0-34 put OBJECTIVE at the head of
   * the strip; the row is driven by the model's list, never by a count here.
   *
   * The active one is the `primary` chip: the brightest metal in the chip family
   * behind a Bone border — the same material the settings screen's engaged toggle
   * wears, which is the set's existing word for *this is the current one*. The
   * other three are plain `secondary` chips. Brightness, and nothing else: a tab
   * is a mode switch, and marking it positionally would collide with the rail's
   * selection mark one band below it.
   */
  private drawTabs(model: CodexModel, tabs: readonly Rect[], m: FrameMetrics): void {
    for (let i = 0; i < tabs.length; i++) {
      const rect = tabs[i];
      const tab = model.tabs[i];
      if (!rect || !tab) continue;
      const nodes = this.tabSlot(i);
      this.drawTab(nodes, tab, rect, m);
    }
    for (let i = tabs.length; i < this.tabNodes.length; i++) {
      const nodes = this.tabNodes[i];
      if (nodes) {
        nodes.body.visible = false;
        nodes.label.visible = false;
      }
    }
  }

  private drawTab(nodes: TabNodes, tab: CodexTabView, rect: Rect, m: FrameMetrics): void {
    nodes.body.clear();
    const visible = rect.width > 0 && rect.height > 0;
    nodes.body.visible = visible;
    nodes.label.visible = visible;
    if (!visible) return;

    const role = codexTabPlate(tab);
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, role, 'chip', tab.state);

    const px = plateTypeSize(TAB_PX, m);
    nodes.label.text = tab.label;
    nodes.label.style.fontSize = px;
    nodes.label.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
    nodes.label.style.fill = tab.active ? BONE.hi : MATERIAL_SHADES.bone;
    nodes.label.x = rect.x + rect.width / 2;
    nodes.label.y = rect.y + rect.height / 2 + plateMaterial(role, tab.state, 'chip').offsetY;
    // A tab word that will not fit its chip shrinks rather than spilling over the
    // border drawn round it: STRATEGY on a phone is the case.
    nodes.label.scale.set(1);
    const room = Math.max(0, rect.width - 2 * Math.max(6, Math.round(8 * m.plateScale)));
    if (nodes.label.width > room && nodes.label.width > 0) {
      nodes.label.scale.set(room / nodes.label.width);
    }
  }

  // --- The entry rail -------------------------------------------------------

  /**
   * The scrolling list of entry titles.
   *
   * A row is a `inert` SURFACE by default — held down on the panel rather than
   * standing off it, exactly as a settings row is. The selected one rises to a
   * `secondary` plate and takes a **Bone bar down its leading edge**: the
   * positional mark that points at the pane beside it, which is a different kind
   * of statement from the tab row's brightness one band above.
   */
  private drawRail(model: CodexModel, rail: Rect, m: FrameMetrics): void {
    // The rail's chrome: the fixed clip mask, and the hairline that separates the
    // list from the article. The pane itself carries no plate — see the header.
    this.railChrome.clear();
    if (rail.width > 0 && rail.height > 0) {
      const rule = Math.max(1, Math.round(m.scale));
      this.railChrome
        .rect(rail.x + rail.width + Math.round(m.gutter / 2) - rule, rail.y, rule, rail.height)
        .fill({ color: MATERIAL_SHADES.hairline, alpha: 0.5 });
    }
    this.railMask.clear();
    this.railMask.rect(rail.x, rail.y, rail.width, rail.height).fill({ color: 0xffffff });

    // Re-clamp the scroll (entry count may have shrunk) and apply it.
    this.scrollRail(0);
    this.railClip.y = -this.railScroll;

    // The title column: past the plate's padding and its accent tick, exactly the
    // way a door's label hangs off its own tick on the doors screen.
    const g = PLATE_SCALES[ENTRY_SCALE];
    const padX = Math.max(8, Math.round(ROW.padX * m.plateScale));
    const textX = rail.x + g.bezel + g.padX + g.tickWidth + Math.max(6, Math.round(ENTRY_TICK_GAP * m.plateScale));
    const px = plateTypeSize(ENTRY_PX, m);

    for (let i = 0; i < model.entries.length; i++) {
      const rect = this.layout.railEntries[i];
      const entry = model.entries[i];
      if (!rect || !entry) continue;
      this.drawEntry(this.entrySlot(i), entry, rect, textX, padX, px);
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

  private drawEntry(
    nodes: EntryNodes,
    entry: CodexEntryView,
    rect: Rect,
    textX: number,
    wrapRight: number,
    px: number,
  ): void {
    nodes.body.clear();
    const visible = rect.width > 0 && rect.height > 0;
    nodes.body.visible = visible;
    nodes.label.visible = visible;
    if (!visible) return;

    const role = codexEntryPlate(entry);
    const state: CodexPlateState = entry.state;
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, role, ENTRY_SCALE, state);
    const sink = plateMaterial(role, state, 'plate').offsetY;

    if (entry.selected) {
      // THE SELECTION MARK. A raised (`secondary`) plate carries the vocabulary's
      // own 3px accent tick "at the head of the plate's content" and a surface
      // (`inert`) carries none, so the mark slides in beside the row that is
      // selected and costs no new geometry — it is re-tinted to Bone here for the
      // same reason a `primary` plate's tick is white: this one means something.
      const g = PLATE_SCALES[ENTRY_SCALE];
      const th = Math.min(g.tickHeight, rect.height - 2 * g.bezel);
      nodes.body
        .rect(rect.x + g.bezel + g.padX, rect.y + sink + (rect.height - th) / 2, g.tickWidth, th)
        .fill({ color: BONE.mid, alpha: 1 });
    }

    nodes.label.text = entry.title;
    nodes.label.style.fontSize = px;
    nodes.label.style.letterSpacing = trackingPx(TRACKING.name, px);
    nodes.label.style.fill = entry.selected ? BONE.hi : MATERIAL_SHADES.bone;
    nodes.label.style.wordWrap = true;
    // The title column is the SAME on a selected row and an unselected one, so a
    // moving selection slides a mark in beside the list rather than shunting every
    // title sideways.
    nodes.label.style.wordWrapWidth = Math.max(20, rect.x + rect.width - wrapRight - textX);
    nodes.label.x = textX;
    nodes.label.y = rect.y + rect.height / 2 + sink;
  }

  // --- The article ----------------------------------------------------------

  /**
   * The reading pane: a title, badges, a summary, the body, the machine-checked
   * numbers, and the cross-references. **No plate, no bevel, no rivets** — the one
   * place on this screen the material stops, because this is the text a player is
   * actually reading and the frozen legibility rule outranks the register.
   *
   * Emphasis here is the value ramp and nothing else: the title is chalk-bright,
   * the body is Bone, the summary and the see-also are the low step. The badges
   * used to be plasma and the fact values used to be plasma; both are Bone now,
   * because Bone spends no hue on a menu.
   */
  private drawDetail(detail: CodexDetailView | null, pane: Rect, m: FrameMetrics): void {
    this.detailMask.clear();
    this.detailMask.rect(pane.x, pane.y, pane.width, pane.height).fill({ color: 0xffffff });

    const showEmpty = detail === null;
    this.detailEmpty.visible = showEmpty;
    for (const t of [
      this.detailTitle,
      this.detailBadges,
      this.detailSummary,
      this.detailBody,
      this.detailFactsHead,
      this.detailSeeAlso,
    ]) {
      t.visible = !showEmpty;
    }

    const pad = Math.max(8, Math.round(DETAIL_PAD * m.scale));
    if (!detail) {
      this.detailEmpty.text = 'No entries.';
      this.detailEmpty.style.fontSize = typeSize(DETAIL_SUMMARY_PX, m);
      this.detailEmpty.x = pane.x + pad;
      this.detailEmpty.y = pane.y + pad;
      this.detailContentHeight = 0;
      this.detailClip.y = 0;
      return;
    }

    const wrap = Math.max(40, pane.width - 2 * pad);
    const left = pane.x + pad;
    const gap = Math.max(6, Math.round(DETAIL_BLOCK_GAP * m.scale));
    let y = pane.y + pad;

    const titlePx = typeSize(DETAIL_TITLE_PX, m);
    this.detailTitle.style.fontSize = titlePx;
    this.detailTitle.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, titlePx);
    y = this.placeBlock(this.detailTitle, detail.title, left, y, wrap) + 2;

    if (detail.badges.length > 0) {
      y += Math.round(gap / 2);
      const badgePx = typeSize(DETAIL_BADGE_PX, m);
      this.detailBadges.style.fontSize = badgePx;
      this.detailBadges.style.letterSpacing = trackingPx(TRACKING.label, badgePx);
      y = this.placeBlock(this.detailBadges, detail.badges.join('   ·   ').toUpperCase(), left, y, wrap);
    } else {
      this.detailBadges.visible = false;
    }

    if (detail.summary) {
      y += gap;
      // Prose: no tracking. The three tiers are for tags, control words and names.
      this.detailSummary.style.fontSize = typeSize(DETAIL_SUMMARY_PX, m);
      this.detailSummary.style.letterSpacing = 0;
      this.detailSummary.style.fill = MATERIAL_SHADES.boneLo;
      y = this.placeBlock(this.detailSummary, detail.summary, left, y, wrap);
    } else {
      this.detailSummary.visible = false;
    }

    y += gap;
    this.detailBody.style.fontSize = typeSize(DETAIL_BODY_PX, m);
    this.detailBody.style.letterSpacing = 0;
    y = this.placeBlock(this.detailBody, detail.body, left, y, wrap);

    if (detail.facts.length > 0) {
      y += gap;
      const headPx = typeSize(EYEBROW_PX, m);
      this.detailFactsHead.style.fontSize = headPx;
      this.detailFactsHead.style.letterSpacing = trackingPx(TRACKING.eyebrow, headPx);
      y = this.placeBlock(this.detailFactsHead, 'FIGURES', left, y, wrap);
      y += Math.round(gap / 2);
      const factPx = typeSize(DETAIL_FACT_PX, m);
      const column = Math.min(Math.round(FACT_VALUE_COLUMN * m.scale), wrap / 2);
      for (let i = 0; i < detail.facts.length; i++) {
        const fact = detail.facts[i];
        if (!fact) continue;
        const nodes = this.factSlot(i);
        nodes.value.visible = true;
        nodes.label.visible = true;
        nodes.value.text = fact.value;
        nodes.value.style.fontSize = factPx;
        nodes.value.style.letterSpacing = trackingPx(TRACKING.name, factPx);
        nodes.value.x = left;
        nodes.value.y = y;
        nodes.label.text = fact.label;
        nodes.label.style.fontSize = typeSize(DETAIL_BADGE_PX, m);
        nodes.label.style.letterSpacing = 0;
        nodes.label.x = left + column;
        nodes.label.style.wordWrap = true;
        nodes.label.style.wordWrapWidth = Math.max(20, wrap - column);
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
      y += gap;
      this.detailSeeAlso.style.fontSize = typeSize(DETAIL_BADGE_PX, m);
      this.detailSeeAlso.style.letterSpacing = 0;
      y = this.placeBlock(this.detailSeeAlso, `See also — ${detail.seeAlso.join(', ')}`, left, y, wrap);
    } else {
      this.detailSeeAlso.visible = false;
    }

    this.detailContentHeight = y - pane.y + pad;
    this.scrollDetail(0); // re-clamp against the fresh content height
    this.detailClip.y = -this.detailScroll;
  }

  /** Place a text block at `(x, y)` with word-wrap, returning the y below it. */
  private placeBlock(node: Text, text: string, x: number, y: number, wrapWidth: number): number {
    node.visible = true;
    node.text = text;
    node.style.wordWrap = true;
    node.style.wordWrapWidth = wrapWidth;
    node.x = x;
    node.y = y;
    return y + node.height;
  }

  private tabSlot(index: number): TabNodes {
    const existing = this.tabNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, TAB_PX, MATERIAL_SHADES.bone);
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
    const label = makeText('', FONT_HEADING, ENTRY_PX, MATERIAL_SHADES.bone);
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
    const value = makeText('', FONT_BODY, DETAIL_FACT_PX, BONE.hi);
    value.anchor.set(0, 0);
    const label = makeText('', FONT_BODY, DETAIL_BADGE_PX, MATERIAL_SHADES.boneLo);
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
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0 } });
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
