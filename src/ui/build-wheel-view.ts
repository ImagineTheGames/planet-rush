/**
 * src/ui/build-wheel-view.ts — the Pixi view for the wheel + panel. OWNER: UI.
 *
 * The drawing half of GDD §2.5. All the decisions live in the pure, unit-tested
 * models ({@link ./build-wheel}, {@link ./upgrade-panel}); this file only turns
 * them into Graphics and Text, and holds the one piece of view state the models
 * deliberately don't: **which screen is on top** — the wheel, or the panel
 * behind its UPGRADE SHIP arrow.
 *
 * Two rules from the contract are enforced here, in the drawing code, because
 * this is where they could be broken:
 *
 *  1. **The only number on a segment is its cost** (GDD §2.5). The segment
 *     draws `label`, and `cost` when the model gives one. There is no third
 *     text field on a segment, and no way to add one without changing the model.
 *  2. **Cost numerals are signal yellow** `#F2D24B` — one of the explicitly
 *     allowed uses of the RESERVED colour (style-guide §2, "cost numerals on the
 *     build wheel"). Everything else on the wheel is neutral or plasma; a dimmed
 *     segment loses its yellow rather than recolouring it, so yellow always
 *     means "this is ore."
 *
 * Sizing is thumb-scale aware: {@link BuildWheelView.resize} scales the whole
 * wheel to the smaller viewport dimension so it stays reachable on a phone and
 * doesn't swallow a desktop screen.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { TextStyleFontWeight } from 'pixi.js';
import { PALETTE } from '@render/index';
import { SEGMENT_ARC } from './build-wheel';
import type { BuildWheelModel, SegmentState, WheelSegment } from './build-wheel';
import type { UpgradePanelModel, UpgradeRow } from './upgrade-panel';

// ---------------------------------------------------------------------------
// Typography & neutrals (style-guide §5.6 — shared with the HUD)
// ---------------------------------------------------------------------------

const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_NUMERAL = 'Oxanium, "DejaVu Sans Mono", monospace';

/** Neutral light UI text. Chalk-white — never signal yellow (style-guide §2). */
const TEXT_PRIMARY = 0xdce3ec;
const TEXT_DIM = PALETTE.hullSteel;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Wheel radii as a fraction of the reference size, so the whole thing scales
 *  with the viewport instead of being pinned to desktop pixels. */
const HUB_RADIUS = 0.22;
const INNER_RADIUS = 0.30;
/** Where a segment's words sit, between the inner ring and the outer edge. */
const LABEL_RADIUS = 0.60;

/** Reference wheel size as a fraction of the smaller viewport dimension. Big
 *  enough to hit with a thumb, small enough to leave the field readable behind
 *  it — the wheel is opened *at* your planet, so the world under it is calm. */
const WHEEL_SCALE = 0.36;
/** Clamp so the wheel is neither unreadable on a small phone nor absurd on a
 *  4K desktop. CSS px radius of the outer ring. */
const WHEEL_MIN = 120;
const WHEEL_MAX = 230;

// ---------------------------------------------------------------------------
// Per-state tinting
// ---------------------------------------------------------------------------

/** How opaque a segment's body is, by state. A refused segment is *dark*, not
 *  hidden: the player still learns the segment exists and what it costs. */
function bodyAlpha(state: SegmentState): number {
  return state === 'ready' ? 0.9 : 0.45;
}

/** Colour of a segment's words, by state. */
function labelColor(state: SegmentState): number {
  return state === 'ready' ? TEXT_PRIMARY : TEXT_DIM;
}

/**
 * Colour of a segment's cost numeral. Signal yellow when the ore is there —
 * that is what yellow means. When it isn't, the numeral goes grey rather than
 * dim-yellow: a half-lit yellow still reads as "ore is here" at a glance, and
 * spending that trust on a segment you cannot afford is exactly the misuse
 * style-guide §2 forbids.
 */
function costColor(state: SegmentState): number {
  return state === 'ready' ? PALETTE.signalYellow : TEXT_DIM;
}

// ---------------------------------------------------------------------------
// One segment's children
// ---------------------------------------------------------------------------

interface SegmentNodes {
  readonly body: Graphics;
  readonly label: Text;
  readonly target: Text;
  readonly cost: Text;
  /** The arrow that marks UPGRADE SHIP as the one that opens a screen. */
  readonly arrow: Graphics;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/**
 * The Build & Upgrade wheel and the upgrade panel behind it. Add once to the
 * HUD; call {@link update} each frame with the two models. The container hides
 * itself entirely when the wheel is closed, so away from your own planet it
 * costs one boolean per frame.
 */
export class BuildWheelView extends Container {
  private readonly wheelGroup = new Container();
  private readonly panelGroup = new Container();

  // --- Wheel ---------------------------------------------------------------
  private readonly rings = new Graphics();
  private readonly segments: SegmentNodes[] = [];
  private readonly hubOre: Text;
  private readonly hubLabel: Text;

  // --- Upgrade panel -------------------------------------------------------
  private readonly panelBg = new Graphics();
  private readonly panelTitle: Text;
  private readonly panelHint: Text;
  private readonly panelHeader: Text[] = [];
  private readonly panelRows: {
    readonly label: Text;
    readonly current: Text;
    readonly next: Text;
    readonly cost: Text;
  }[] = [];

  /** Outer ring radius in CSS px, recomputed on resize. */
  private radius = WHEEL_MIN;

  constructor(screenWidth: number, screenHeight: number) {
    super();

    // Hub: the live ore total (GDD §2.5, "with your live ore total in the hub").
    // Signal yellow — it is ore, the one thing the colour is for.
    this.hubOre = makeText('', FONT_NUMERAL, 26, PALETTE.signalYellow, 'bold');
    this.hubOre.anchor.set(0.5, 0.5);
    this.hubLabel = makeText('ORE', FONT_HEADING, 11, TEXT_DIM);
    this.hubLabel.anchor.set(0.5, 0);
    this.wheelGroup.addChild(this.rings, this.hubOre, this.hubLabel);

    // Upgrade panel: title, column headers, four rows, and the way back out.
    this.panelTitle = makeText('', FONT_HEADING, 18, TEXT_PRIMARY);
    this.panelTitle.anchor.set(0.5, 0);
    this.panelHint = makeText('', FONT_HEADING, 11, TEXT_DIM);
    this.panelHint.anchor.set(0.5, 0);
    this.panelGroup.addChild(this.panelBg, this.panelTitle, this.panelHint);
    for (const heading of ['', 'NOW', 'NEXT', 'ORE']) {
      const t = makeText(heading, FONT_HEADING, 10, TEXT_DIM);
      this.panelHeader.push(t);
      this.panelGroup.addChild(t);
    }

    this.addChild(this.wheelGroup, this.panelGroup);
    this.visible = false;
    this.resize(screenWidth, screenHeight);
  }

  /** Re-centre and re-scale for a new viewport. Thumb-scale on a phone, sane on
   *  a desktop — the wheel is a touch target first (GDD §2.4 BUILD button). */
  resize(width: number, height: number): void {
    this.radius = clamp(Math.min(width, height) * WHEEL_SCALE, WHEEL_MIN, WHEEL_MAX);
    this.wheelGroup.x = width / 2;
    this.wheelGroup.y = height / 2;
    this.panelGroup.x = width / 2;
    this.panelGroup.y = height / 2;
  }

  /**
   * Draw one frame.
   *
   * @param wheel The wheel model — `open: false` hides everything.
   * @param panel The upgrade panel model — `open: true` puts it in front of the
   *              wheel, which is what the UPGRADE SHIP arrow means (GDD §2.5).
   */
  update(wheel: BuildWheelModel, panel: UpgradePanelModel): void {
    this.visible = wheel.open;
    if (!wheel.open) return;

    const showPanel = panel.open;
    this.wheelGroup.visible = !showPanel;
    this.panelGroup.visible = showPanel;

    if (showPanel) this.drawPanel(panel);
    else this.drawWheel(wheel);
  }

  // --- Wheel ---------------------------------------------------------------

  private drawWheel(model: BuildWheelModel): void {
    const r = this.radius;
    const inner = r * INNER_RADIUS;
    const hub = r * HUB_RADIUS;

    // Backing disc + hub ring. Redrawn per frame: it is one Graphics and the
    // wheel is open for seconds at a time, not for the whole match.
    this.rings.clear();
    this.rings
      .circle(0, 0, r)
      .fill({ color: PALETTE.vacuum, alpha: 0.88 })
      .circle(0, 0, r)
      .stroke({ width: 1.5, color: PALETTE.plasma, alpha: 0.35 })
      .circle(0, 0, hub)
      .fill({ color: PALETTE.vacuum, alpha: 0.95 })
      .circle(0, 0, hub)
      .stroke({ width: 1.5, color: PALETTE.plasma, alpha: 0.6 });

    for (let i = 0; i < model.segments.length; i++) {
      const seg = model.segments[i];
      if (!seg) continue;
      const nodes = this.segmentNodes(i);
      this.drawSegment(nodes, seg, inner, r);
    }

    this.hubOre.text = `${model.ore}`;
    this.hubOre.y = -4;
    this.hubLabel.y = this.hubOre.y + 12;
  }

  /** Draw one wedge: the body, the words, the target, and the cost — and
   *  nothing else (GDD §2.5, "the only number on a segment is its cost"). */
  private drawSegment(nodes: SegmentNodes, seg: WheelSegment, inner: number, outer: number): void {
    const half = SEGMENT_ARC / 2;
    const a0 = seg.angle - half;
    const a1 = seg.angle + half;

    nodes.body.clear();
    nodes.body
      .moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner)
      .arc(0, 0, outer, a0, a1)
      .lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner)
      .arc(0, 0, inner, a1, a0, true)
      .closePath()
      .fill({ color: PALETTE.hullSteel, alpha: bodyAlpha(seg.state) * 0.16 })
      .stroke({ width: 1, color: PALETTE.hullSteel, alpha: bodyAlpha(seg.state) * 0.5 });

    const lx = Math.cos(seg.angle) * outer * LABEL_RADIUS;
    const ly = Math.sin(seg.angle) * outer * LABEL_RADIUS;

    nodes.label.text = seg.label;
    nodes.label.style.fill = labelColor(seg.state);
    nodes.label.x = lx;
    nodes.label.y = ly - 16;

    // "Every label names which" — planet or ship (GDD §2.5). Words, not a number.
    nodes.target.text = seg.target === 'ship' ? 'YOUR SHIP' : 'YOUR PLANET';
    nodes.target.x = lx;
    nodes.target.y = ly - 2;

    if (seg.cost !== null) {
      nodes.cost.visible = true;
      nodes.cost.text = `${seg.cost}`;
      nodes.cost.style.fill = costColor(seg.state);
      nodes.cost.x = lx;
      nodes.cost.y = ly + 12;
    } else {
      nodes.cost.visible = false;
    }

    // The arrow: this segment opens a second screen. Without it a player who
    // doesn't know upgrades exist never looks for them (GDD §2.5).
    nodes.arrow.visible = seg.opensPanel;
    if (seg.opensPanel) {
      nodes.arrow.clear();
      nodes.arrow
        .poly([0, -5, 8, 0, 0, 5])
        .fill({ color: PALETTE.plasma, alpha: seg.state === 'ready' ? 0.95 : 0.5 });
      nodes.arrow.x = lx + nodes.label.width / 2 + 10;
      nodes.arrow.y = ly - 9;
    }
  }

  /** Lazily create (and then reuse) one segment's children. */
  private segmentNodes(index: number): SegmentNodes {
    const existing = this.segments[index];
    if (existing) return existing;

    const body = new Graphics();
    const label = makeText('', FONT_HEADING, 13, TEXT_PRIMARY);
    const target = makeText('', FONT_HEADING, 9, TEXT_DIM);
    const cost = makeText('', FONT_NUMERAL, 20, PALETTE.signalYellow, 'bold');
    const arrow = new Graphics();
    for (const t of [label, target, cost]) t.anchor.set(0.5, 0);
    this.wheelGroup.addChild(body);
    this.wheelGroup.addChild(label, target, cost, arrow);

    const nodes: SegmentNodes = { body, label, target, cost, arrow };
    this.segments[index] = nodes;
    return nodes;
  }

  // --- Upgrade panel -------------------------------------------------------

  /** The one screen where ship stats appear (GDD §2.2, §2.5): one row per
   *  track, each giving current value → next tier → ore cost. */
  private drawPanel(model: UpgradePanelModel): void {
    const w = Math.min(360, this.radius * 3);
    const rowH = 30;
    const h = 92 + model.rows.length * rowH;
    const x0 = -w / 2;
    const y0 = -h / 2;

    this.panelBg.clear();
    this.panelBg
      .roundRect(x0, y0, w, h, 10)
      .fill({ color: PALETTE.vacuum, alpha: 0.94 })
      .stroke({ width: 1.5, color: PALETTE.plasma, alpha: 0.55 });

    this.panelTitle.text = `UPGRADE SHIP · ${model.className}`;
    this.panelTitle.y = y0 + 14;

    // Column x positions: label left, then the three numbers right-aligned.
    const colCurrent = x0 + w * 0.56;
    const colNext = x0 + w * 0.76;
    const colCost = x0 + w * 0.94;
    const headerY = y0 + 46;
    const cols = [x0 + 18, colCurrent, colNext, colCost];
    for (let i = 0; i < this.panelHeader.length; i++) {
      const t = this.panelHeader[i];
      if (!t) continue;
      t.x = cols[i] ?? 0;
      t.y = headerY;
      t.anchor.set(i === 0 ? 0 : 1, 0);
    }

    for (let i = 0; i < model.rows.length; i++) {
      const row = model.rows[i];
      if (!row) continue;
      const nodes = this.panelRowNodes(i);
      const y = headerY + 18 + i * rowH;
      this.drawPanelRow(nodes, row, cols, y);
    }

    // The ore total, echoed from the wheel's hub so the trade is visible on the
    // screen where it is made: rows on the left, what you can pay on the right.
    this.panelHint.text = `ORE ${model.ore}`;
    this.panelHint.y = y0 + h - 24;
  }

  private drawPanelRow(
    nodes: { label: Text; current: Text; next: Text; cost: Text },
    row: UpgradeRow,
    cols: readonly number[],
    y: number,
  ): void {
    const maxed = row.state === 'maxed';
    nodes.label.text = row.label;
    nodes.label.style.fill = maxed ? TEXT_DIM : TEXT_PRIMARY;
    nodes.label.x = cols[0] ?? 0;
    nodes.label.y = y;

    nodes.current.text = row.current;
    nodes.current.x = cols[1] ?? 0;
    nodes.current.y = y;

    nodes.next.text = maxed ? 'MAX' : (row.next ?? '');
    nodes.next.style.fill = maxed ? TEXT_DIM : PALETTE.plasma;
    nodes.next.x = cols[2] ?? 0;
    nodes.next.y = y;

    // Cost is the one yellow on this screen, and only when it is payable —
    // same rule as the wheel's numerals (style-guide §2).
    nodes.cost.text = row.cost === null ? '—' : `${row.cost}`;
    nodes.cost.style.fill = row.state === 'ready' ? PALETTE.signalYellow : TEXT_DIM;
    nodes.cost.x = cols[3] ?? 0;
    nodes.cost.y = y;
  }

  private panelRowNodes(index: number): { label: Text; current: Text; next: Text; cost: Text } {
    const existing = this.panelRows[index];
    if (existing) return existing;

    const label = makeText('', FONT_HEADING, 13, TEXT_PRIMARY);
    const current = makeText('', FONT_NUMERAL, 15, TEXT_PRIMARY);
    const next = makeText('', FONT_NUMERAL, 15, PALETTE.plasma);
    const cost = makeText('', FONT_NUMERAL, 15, PALETTE.signalYellow, 'bold');
    for (const t of [current, next, cost]) t.anchor.set(1, 0);
    this.panelGroup.addChild(label, current, next, cost);

    const nodes = { label, current, next, cost };
    this.panelRows[index] = nodes;
    return nodes;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeText(
  text: string,
  fontFamily: string,
  fontSize: number,
  fill: number,
  fontWeight: TextStyleFontWeight = 'normal',
): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, fontWeight, letterSpacing: 0.5 } });
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
