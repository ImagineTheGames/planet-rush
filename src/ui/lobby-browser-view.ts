/**
 * src/ui/lobby-browser-view.ts — the Pixi view for the BROWSE half of the JOIN
 * screen. OWNER: UI Engineer (u17-01).
 *
 * The drawing half of {@link ./lobby-browser}. Every decision lives in the pure
 * model and every rect in {@link ./lobby-geometry} `entryLayout`; this file only
 * turns them into Graphics and Text, and owns the one thing neither has an
 * opinion about — which Pixi child is which.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE, ON A SCREEN THE HANDOFF NEVER DREW
 * ---------------------------------------------------------------------------
 * This is new surface, so it is themed from the set rather than added to a0-20's
 * UNTHEMED list. Nothing here invents a material: every bevel, band and tone comes
 * from {@link ../art/materials}, and the two constructions it needs already exist
 * one screen over in the CODEX ({@link ./codex-view}), which is the same shape of
 * screen — a switch above a list of rows.
 *
 *  1. **A row is an `inert` SURFACE, not a plate.** Gantry's word for a surface is
 *     *"a thing that holds content rather than inviting a press"*, and a list of
 *     twelve rooms is content. What invites the press is the **JOIN chip** at the
 *     row's trailing end — the developer's *"there should be a join button to join
 *     it"* — and it is a `secondary` chip rather than a `primary` plate for a
 *     structural reason: twelve bright plates is twelve headline actions, and the
 *     one-primary rule ({@link ./gantry} `singlePrimary`) is what makes brightness
 *     mean anything on a screen that spends no colour.
 *  2. **A dim control carries its reason** (the ratified p4-03 rule). A row the
 *     listing no longer offers loses its brightness *and* its button says which of
 *     the two things happened — `FULL` or `CLOSED` — so the dimming is never a
 *     mystery the player has to press to solve.
 *  3. **Colour is spent exactly twice, and both are style-guide §2.** Threat red
 *     for an age stamp that has gone past two polls (the picture is no longer
 *     being refreshed — that IS a failure), and nothing else. Signal yellow is
 *     RESERVED for ore and there is no ore on this screen.
 *
 * Typography (§7): Audiowide for the owner tag and the button word — they are
 * names — and Oxanium for the seat line, the place, the ping and the stamp, which
 * are strings of characters to be read one at a time. That is the same division
 * the keypad screen makes one segment away.
 */

import { Container, Graphics, Text } from 'pixi.js';
import {
  BONE,
  DISPLAY_TRACKING,
  MATERIAL_SHADES,
  PLATE_SCALES,
  ROW,
  TRACKING,
  drawPlate,
  plateMaterial,
  plateTypeSize,
  trackingPx,
  typeSize,
} from '../art/materials';
import type { FrameMetrics, PlateState } from '../art/materials';
import { PALETTE } from '@render/index';
import type { Rect } from '@platform/layout-registry';
import type { BrowseModel, BrowseRowModel } from './lobby-browser';
import { FONT_BODY, FONT_HEADING } from './typography';

// ---------------------------------------------------------------------------
// Reference type sizes — at the handoff's 1280×720 reference
// ---------------------------------------------------------------------------

/** The owner tag: the row's name, in the display face. */
const OWNER_PX = 16;
/** `2 PLAYERS · 4 SEATS OPEN · TEAMS`, under it. */
const META_PX = 12;
/** `VIRGINIA 38ms`, at the row's trailing end. */
const WHERE_PX = 13;
/** The word inside the JOIN chip. */
const ACTION_PX = 14;
/** `UPDATED 3s AGO`, over the list. */
const STAMP_PX = 12;
/** The empty list's two lines: what happened, and what to do about it. */
const EMPTY_HEAD_PX = 18;
const EMPTY_DETAIL_PX = 13;

/** Vertical gap between a row's two left-hand lines (the doors' own LABEL_GAP). */
const LINE_GAP = 3;

interface RowNodes {
  readonly body: Graphics;
  readonly owner: Text;
  readonly meta: Text;
  readonly where: Text;
  readonly action: Text;
}

/** The rects this view draws into — {@link ./lobby-geometry} `EntryLayout`'s
 *  browse half, handed over rather than re-derived. */
export interface BrowseRects {
  readonly rows: readonly Rect[];
  readonly joins: readonly Rect[];
  readonly stamp: Rect;
  readonly list: Rect;
}

/** What the pointer is doing, as `entryTargetKey`s (`row:2`). */
export interface BrowsePointer {
  readonly hover?: string | null;
  readonly press?: string | null;
}

/**
 * The browse list. Added as a child of {@link ./lobby-entry-view}, which owns the
 * beams, the mode switch and the footer — this view is only what changes between
 * the two modes.
 *
 * It is hidden wholesale in CODE mode rather than drawn empty: a container that is
 * not visible costs one boolean, and a row drawn under the keypad is a tap target
 * the hit test would have to know about (it does not — {@link entryHitTest} takes
 * the mode).
 */
export class LobbyBrowserView extends Container {
  private readonly rowNodes: RowNodes[] = [];
  private readonly stamp: Text;
  private readonly hidden: Text;
  private readonly emptyHead: Text;
  private readonly emptyDetail: Text;

  constructor() {
    super();
    this.stamp = makeText('', FONT_BODY, STAMP_PX, MATERIAL_SHADES.boneLo);
    this.stamp.anchor.set(1, 0.5);
    this.hidden = makeText('', FONT_BODY, STAMP_PX, MATERIAL_SHADES.boneLo);
    this.hidden.anchor.set(0, 0.5);
    this.emptyHead = makeText('', FONT_HEADING, EMPTY_HEAD_PX, MATERIAL_SHADES.bone);
    this.emptyHead.anchor.set(0.5, 0.5);
    this.emptyDetail = makeText('', FONT_BODY, EMPTY_DETAIL_PX, MATERIAL_SHADES.boneLo);
    this.emptyDetail.anchor.set(0.5, 0.5);
    this.emptyDetail.style.align = 'center';
    this.addChild(this.stamp, this.hidden, this.emptyHead, this.emptyDetail);
  }

  /** Draw one frame of the list. */
  update(model: BrowseModel, rects: BrowseRects, m: FrameMetrics, pointer: BrowsePointer = {}): void {
    this.drawStamp(model, rects.stamp, m);
    this.drawEmpty(model, rects.list, m);

    for (let i = 0; i < rects.rows.length; i++) {
      const rect = rects.rows[i];
      const row = model.rows[i];
      const nodes = this.rowSlot(i);
      if (!rect || !row) {
        // Pooled rows past the end of the listing are hidden, never drawn empty:
        // an empty plate reads as a room whose name failed to load.
        setVisible(false, nodes.body, nodes.owner, nodes.meta, nodes.where, nodes.action);
        continue;
      }
      const key = `row:${i}`;
      const state: PlateState = !row.enabled
        ? 'rest'
        : pointer.press === key
          ? 'press'
          : pointer.hover === key
            ? 'hover'
            : 'rest';
      this.drawRow(nodes, row, rect, rects.joins[i], state, m);
    }
    // …and any pooled row the layout itself no longer has a rect for.
    for (let i = rects.rows.length; i < this.rowNodes.length; i++) {
      const nodes = this.rowNodes[i];
      if (nodes) setVisible(false, nodes.body, nodes.owner, nodes.meta, nodes.where, nodes.action);
    }
  }

  // --- The age stamp --------------------------------------------------------

  /**
   * `UPDATED 3s AGO`, right-aligned over the list — and `LAST SEEN 24s AGO` in
   * threat red once the picture is older than two polls.
   *
   * The red is the one place this screen spends a hue and it is the style-guide's
   * own meaning: a list that has stopped being refreshed is genuinely wrong, in a
   * way a player can act on (leave and come back, check the connection). What did
   * not fit rides the same strip at its leading end, because "3 NOT SHOWN" is a
   * fact about the same photograph.
   */
  private drawStamp(model: BrowseModel, rect: Rect, m: FrameMetrics): void {
    const px = typeSize(STAMP_PX, m);
    const drawable = rect.width > 0 && rect.height > 0;
    const midY = rect.y + rect.height / 2;

    this.stamp.text = model.stamp;
    this.stamp.visible = drawable && model.stamp !== '';
    this.stamp.style.fontSize = px;
    this.stamp.style.letterSpacing = trackingPx(TRACKING.eyebrow, px);
    this.stamp.style.fill = model.stale ? PALETTE.threatRed : MATERIAL_SHADES.boneLo;
    this.stamp.x = rect.x + rect.width;
    this.stamp.y = midY;

    this.hidden.text = model.hiddenLine;
    this.hidden.visible = drawable && model.hiddenLine !== '';
    this.hidden.style.fontSize = px;
    this.hidden.style.letterSpacing = trackingPx(TRACKING.eyebrow, px);
    this.hidden.x = rect.x;
    this.hidden.y = midY;
    // A narrow strip carries the age before it carries the footnote: how old the
    // picture is outranks how much of it fits.
    if (drawable && this.stamp.visible && this.hidden.visible) {
      const room = rect.width - this.stamp.width - m.gutter;
      if (this.hidden.width > room) this.hidden.visible = false;
    }
  }

  // --- Nothing to show ------------------------------------------------------

  /**
   * An empty list is a SENTENCE (LESSONS §20) — centred in the space the rows
   * would have taken, so the player is looking at the answer rather than at the
   * absence of rows.
   *
   * Two lines when there is something to do about it, one while the screen is
   * still looking. The detail names the other segment, which is drawn one strip
   * above it: the way out is on the screen the line is drawn on.
   */
  private drawEmpty(model: BrowseModel, list: Rect, m: FrameMetrics): void {
    const [head = '', detail = ''] = model.empty;
    const drawable = list.width > 0 && list.height > 0;
    const two = detail !== '';
    const headPx = typeSize(two ? EMPTY_HEAD_PX : EMPTY_DETAIL_PX, m);
    const detailPx = typeSize(EMPTY_DETAIL_PX, m);
    const gap = Math.max(4, Math.round(8 * m.scale));

    this.emptyHead.text = head;
    this.emptyHead.visible = drawable && head !== '';
    this.emptyHead.style.fontSize = headPx;
    this.emptyHead.style.fontFamily = two ? FONT_HEADING : FONT_BODY;
    this.emptyHead.style.fill = two ? MATERIAL_SHADES.bone : MATERIAL_SHADES.boneLo;
    this.emptyHead.style.letterSpacing = trackingPx(
      two ? DISPLAY_TRACKING.heading : TRACKING.label,
      headPx,
    );

    this.emptyDetail.text = detail;
    this.emptyDetail.visible = drawable && two;
    this.emptyDetail.style.fontSize = detailPx;
    this.emptyDetail.style.letterSpacing = trackingPx(TRACKING.label, detailPx);
    // Both lines wrap inside the list box rather than running off a phone's edges.
    this.emptyDetail.style.wordWrap = true;
    this.emptyDetail.style.wordWrapWidth = Math.max(1, list.width);

    const midX = list.x + list.width / 2;
    const midY = list.y + list.height / 2;
    const block = this.emptyHead.height + (two ? gap + this.emptyDetail.height : 0);
    this.emptyHead.x = midX;
    this.emptyHead.y = midY - block / 2 + this.emptyHead.height / 2;
    this.emptyDetail.x = midX;
    this.emptyDetail.y = midY + block / 2 - this.emptyDetail.height / 2;
  }

  // --- One room -------------------------------------------------------------

  /**
   * A row: the owner tag over the seat line at the leading edge, the place and its
   * ping at the trailing edge, and the JOIN chip past that.
   *
   * Every text block is *shrunk to fit* rather than allowed to spill (the
   * codex tab's own move): a room name is not something this screen may truncate
   * silently, and a phone's row is not a desktop's. The place line yields the
   * width first, because "which room" survives a smaller place name and a place
   * name that ran under the JOIN button would be unreadable anyway.
   */
  private drawRow(
    nodes: RowNodes,
    row: BrowseRowModel,
    rect: Rect,
    join: Rect | undefined,
    state: PlateState,
    m: FrameMetrics,
  ): void {
    nodes.body.clear();
    const drawable = rect.width > 0 && rect.height > 0;
    setVisible(drawable, nodes.owner, nodes.meta, nodes.where, nodes.action);
    if (!drawable) return;

    // The row itself: a surface, at row scale, dimmed when the listing is no longer
    // offering it. The dimming always arrives with the word that explains it.
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, 'inert', 'standard', 'rest');
    nodes.body.alpha = row.enabled ? 1 : 0.55;

    const padX = Math.max(8, Math.round(ROW.padX * m.plateScale));
    const midY = rect.y + rect.height / 2;
    const textX = rect.x + padX;
    const chip = join && join.width > 0 ? join : null;
    // Where the left-hand block must stop: the JOIN chip, or the row's own padding
    // when the chip was squeezed out of existence.
    const rightEdge = (chip ? chip.x : rect.x + rect.width) - padX;

    // --- The name, and what is in the room ---------------------------------
    const ownerPx = plateTypeSize(OWNER_PX, m);
    const metaPx = plateTypeSize(META_PX, m);
    const gap = Math.max(1, Math.round(LINE_GAP * m.plateScale));
    nodes.owner.text = row.owner;
    nodes.owner.style.fontSize = ownerPx;
    nodes.owner.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, ownerPx);
    nodes.owner.style.fill = row.enabled ? BONE.hi : MATERIAL_SHADES.bone;
    nodes.meta.text = row.meta;
    nodes.meta.style.fontSize = metaPx;
    nodes.meta.style.letterSpacing = trackingPx(TRACKING.label, metaPx);
    nodes.meta.style.fill = MATERIAL_SHADES.boneLo;

    // The place gets what the name does not need, and never less than a third of
    // the row: `VIRGINIA 38ms` is the developer's *location / ping* and it is half
    // the reason to pick one room over another.
    const inner = Math.max(0, rightEdge - textX);
    const wherePx = plateTypeSize(WHERE_PX, m);
    nodes.where.text = row.where;
    nodes.where.style.fontSize = wherePx;
    nodes.where.style.letterSpacing = trackingPx(TRACKING.eyebrow, wherePx);
    nodes.where.style.fill = row.enabled ? MATERIAL_SHADES.bone : MATERIAL_SHADES.boneLo;
    nodes.where.scale.set(1);
    const whereRoom = Math.min(Math.max(inner / 3, 0), inner);
    fit(nodes.where, whereRoom);

    const nameRoom = Math.max(0, inner - nodes.where.width - m.gutter);
    nodes.owner.scale.set(1);
    nodes.meta.scale.set(1);
    fit(nodes.owner, nameRoom);
    fit(nodes.meta, nameRoom);

    const block = nodes.owner.height + gap + nodes.meta.height;
    const twoLines = block <= rect.height - 6;
    nodes.meta.visible = twoLines;
    nodes.owner.x = textX;
    nodes.meta.x = textX;
    if (twoLines) {
      nodes.owner.y = midY - block / 2;
      nodes.meta.y = midY - block / 2 + nodes.owner.height + gap;
    } else {
      nodes.owner.y = midY - nodes.owner.height / 2;
    }

    nodes.where.x = rightEdge;
    nodes.where.y = midY;

    // --- The button ---------------------------------------------------------
    if (!chip) {
      nodes.action.visible = false;
      return;
    }
    drawPlate(nodes.body, chip.x, chip.y, chip.width, chip.height, 'secondary', 'chip', state);
    const actionPx = plateTypeSize(ACTION_PX, m);
    nodes.action.text = row.action;
    nodes.action.style.fontSize = actionPx;
    nodes.action.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, actionPx);
    nodes.action.style.fill = row.enabled ? BONE.hi : MATERIAL_SHADES.boneLo;
    nodes.action.alpha = row.enabled ? 1 : 0.7;
    nodes.action.scale.set(1);
    fit(nodes.action, Math.max(0, chip.width - 2 * PLATE_SCALES.chip.bezel - 6));
    nodes.action.x = chip.x + chip.width / 2;
    nodes.action.y = chip.y + chip.height / 2 + plateMaterial('secondary', state, 'chip').offsetY;
  }

  private rowSlot(index: number): RowNodes {
    const existing = this.rowNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const owner = makeText('', FONT_HEADING, OWNER_PX, BONE.hi);
    owner.anchor.set(0, 0);
    const meta = makeText('', FONT_BODY, META_PX, MATERIAL_SHADES.boneLo);
    meta.anchor.set(0, 0);
    const where = makeText('', FONT_BODY, WHERE_PX, MATERIAL_SHADES.bone);
    where.anchor.set(1, 0.5);
    const action = makeText('', FONT_HEADING, ACTION_PX, BONE.hi);
    action.anchor.set(0.5, 0.5);
    this.addChild(body, owner, meta, where, action);
    const nodes: RowNodes = { body, owner, meta, where, action };
    this.rowNodes[index] = nodes;
    return nodes;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shrink a line that will not fit its allotment, rather than letting it spill —
 *  nothing on this screen truncates, and nothing runs past its own plate. */
function fit(text: Text, room: number): void {
  if (room <= 0 || text.width <= 0) return;
  if (text.width > room) text.scale.set(room / text.width);
}

function setVisible(visible: boolean, ...nodes: Array<Graphics | Text>): void {
  for (const node of nodes) node.visible = visible;
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0 } });
}
