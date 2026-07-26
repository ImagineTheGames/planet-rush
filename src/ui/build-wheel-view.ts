/**
 * src/ui/build-wheel-view.ts — the Pixi view for BOTH wheels. OWNER: UI.
 *
 * The drawing half of GDD §2.5. All the decisions live in the pure, unit-tested
 * models ({@link ./build-wheel}, {@link ./upgrade-wheel}); this file only turns
 * them into Graphics and Text, and holds the two pieces of view state the models
 * deliberately don't: **which wheel is on top** — the Build wheel, or the Upgrade
 * wheel behind its UPGRADE SHIP arrow — and **the shared open/close pop**.
 *
 * ── ONE COMPONENT, TWO WHEELS (the field report) ────────────────────────────
 * A developer reported the upgrade screen *"should be a wheel menu as well."* So
 * it is: the Upgrade screen is now drawn by the **same wedge routine** the Build
 * wheel uses ({@link drawWedge}) — same arc geometry, same label/cost typography,
 * same dimmed-with-a-reason states. A wedge is a wedge; only the copy on it
 * differs (a build target vs. a stat's current→next value). New upgrade tracks
 * (p2-03) arrive as extra wedges with no view change, because the view draws
 * however many wedges the model hands it.
 *
 * ── THE SHARED POP, AND WHY IT CAN'T LATCH (the field report) ───────────────
 * A developer also reported breaking the menu by opening and closing it fast
 * until it *"wouldn't open anymore."* The open/close transition is a single
 * {@link WheelToggle} shared by both wheels — a pure, leak-safe machine that can
 * never wedge (see its file). The view only *reads* its `progress` to scale/fade
 * the wheel; it holds no open/close flag of its own, so it cannot reintroduce the
 * latch. Both wheels get the fix because both are this one view.
 *
 * Two rules from the contract are still enforced here, in the drawing code:
 *  1. **The only number on a wedge is its cost** (plus the stat value it upgrades,
 *     on the upgrade wheel — this being the one screen stats appear on). There is
 *     no way to add a third number without changing a model.
 *  2. **Cost numerals are signal yellow** `#F2D24B` — an explicitly allowed use
 *     of the RESERVED colour (style-guide §2). A dimmed wedge loses its yellow
 *     rather than recolouring it, so yellow always means "this is ore."
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
import { upgradeWedgeArc } from './upgrade-wheel';
import type { UpgradeWheelModel, UpgradeWedge, UpgradeWedgeState } from './upgrade-wheel';
import { WheelToggle } from './wheel-toggle';
import { wheelRadius, WHEEL_MIN_RADIUS } from './hud-geometry';

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
/** Where a wedge's words sit, between the inner ring and the outer edge. */
const LABEL_RADIUS = 0.60;

/** Ease the raw 0→1 pop progress so it settles rather than arriving linearly —
 *  a small overshoot-free ease-out reads as a wheel "snapping" into place. */
function easePop(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - (1 - c) * (1 - c);
}

// ---------------------------------------------------------------------------
// Per-state tinting (shared by both wheels — a dimmed wedge is a dimmed wedge)
// ---------------------------------------------------------------------------

/** Whether a wedge is drawn bright (pressable) or dark (refused, with a reason).
 *  Unifies the Build wheel's {@link SegmentState} and the Upgrade wheel's
 *  {@link UpgradeWedgeState}: `ready` is bright, everything else is dark. */
function wedgeReady(state: SegmentState | UpgradeWedgeState): boolean {
  return state === 'ready';
}

/** How opaque a wedge's body is. A refused wedge is *dark*, not hidden: the
 *  player still learns the wedge exists and what it costs. */
function bodyAlpha(ready: boolean): number {
  return ready ? 0.9 : 0.45;
}

// ---------------------------------------------------------------------------
// One wedge's children (shared shape for both wheels)
// ---------------------------------------------------------------------------

interface WedgeNodes {
  readonly body: Graphics;
  readonly label: Text;
  /** The second line: a build target ("YOUR PLANET") or a stat value ("10 → 13"). */
  readonly sub: Text;
  readonly cost: Text;
  /** The arrow that marks UPGRADE SHIP as the one that opens a screen. */
  readonly arrow: Graphics;
}

/** The normalised descriptor {@link BuildWheelView.drawWedge} draws — the one
 *  shape both wheels reduce to, so the drawing code is written once. */
interface WedgeDraw {
  readonly angle: number;
  readonly label: string;
  readonly sub: string;
  readonly cost: number | null;
  /** Bright vs. dark (dimmed-with-a-reason). */
  readonly ready: boolean;
  /** Whether the cost numeral is payable — drives its yellow-vs-grey. */
  readonly costReady: boolean;
  /** Draw the "opens a screen" arrow (UPGRADE SHIP on the Build wheel only). */
  readonly arrow: boolean;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/**
 * The Build wheel and the Upgrade wheel behind its arrow. Add once to the HUD;
 * call {@link update} each frame with the two models and the frame time. The
 * container hides itself entirely once the wheel is fully closed, so away from
 * your own planet it costs one boolean per frame.
 */
export class BuildWheelView extends Container {
  private readonly buildGroup = new Container();
  private readonly upgradeGroup = new Container();

  /** The shared, leak-safe open/close transition (the field bug's fix). */
  private readonly toggle = new WheelToggle();
  /** Last frame time seen, for deriving the transition's `dt`. */
  private lastTime = -1;

  // --- Build wheel ---------------------------------------------------------
  private readonly buildRings = new Graphics();
  private readonly buildWedges: WedgeNodes[] = [];
  private readonly buildHubOre: Text;
  private readonly buildHubLabel: Text;

  // --- Upgrade wheel -------------------------------------------------------
  private readonly upgradeRings = new Graphics();
  private readonly upgradeWedges: WedgeNodes[] = [];
  private readonly upgradeHubOre: Text;
  private readonly upgradeHubLabel: Text;

  /** Outer ring radius in CSS px, recomputed on resize. */
  private radius = WHEEL_MIN_RADIUS;

  constructor(screenWidth: number, screenHeight: number) {
    super();

    // Build wheel hub: the live ore total (GDD §2.5) in signal yellow.
    this.buildHubOre = makeText('', FONT_NUMERAL, 26, PALETTE.signalYellow, 'bold');
    this.buildHubOre.anchor.set(0.5, 0.5);
    this.buildHubLabel = makeText('ORE', FONT_HEADING, 11, TEXT_DIM);
    this.buildHubLabel.anchor.set(0.5, 0);
    this.buildGroup.addChild(this.buildRings, this.buildHubOre, this.buildHubLabel);

    // Upgrade wheel hub: the same ore total (one purchase draws on the same ore),
    // labelled with the hull whose stats these are — the class is locked at the
    // lobby, so it names whose ship you are spending on.
    this.upgradeHubOre = makeText('', FONT_NUMERAL, 26, PALETTE.signalYellow, 'bold');
    this.upgradeHubOre.anchor.set(0.5, 0.5);
    this.upgradeHubLabel = makeText('', FONT_HEADING, 10, TEXT_DIM);
    this.upgradeHubLabel.anchor.set(0.5, 0);
    this.upgradeGroup.addChild(this.upgradeRings, this.upgradeHubOre, this.upgradeHubLabel);

    this.addChild(this.buildGroup, this.upgradeGroup);
    this.visible = false;
    this.resize(screenWidth, screenHeight);
  }

  /** Re-centre and re-scale for a new viewport. Thumb-scale on a phone, sane on
   *  a desktop — the wheel is a touch target first (GDD §2.4 BUILD button). */
  resize(width: number, height: number): void {
    this.radius = wheelRadius(width, height);
    this.buildGroup.x = width / 2;
    this.buildGroup.y = height / 2;
    this.upgradeGroup.x = width / 2;
    this.upgradeGroup.y = height / 2;
  }

  /** The Build wheel's drawn container — the layout registry's `build-wheel`
   *  entry. Exposed so the HUD can register what was really drawn without
   *  reaching into this view's internals. */
  get wheelNode(): Container {
    return this.buildGroup;
  }

  /** The Upgrade wheel's drawn container — the registry's `upgrade-wheel`. */
  get panelNode(): Container {
    return this.upgradeGroup;
  }

  /**
   * Draw one frame.
   *
   * @param wheel   The Build wheel model — `open: false` closes everything (with
   *                a pop, via the shared transition).
   * @param upgrade The Upgrade wheel model — `open: true` puts it in front of the
   *                Build wheel, which is what the UPGRADE SHIP arrow means.
   * @param time    The frame's match time (`world.time`), for the pop's `dt`.
   */
  update(wheel: BuildWheelModel, upgrade: UpgradeWheelModel, time: number): void {
    const dt = this.lastTime < 0 ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;

    // The player wants the wheel up iff the model is open; the shared toggle turns
    // that target into a pop and — critically — can never latch shut on it.
    this.toggle.update(wheel.open, dt);
    this.visible = this.toggle.visible;
    if (!this.visible) return;

    // Pop from the screen centre: scale/fade each group about its own local
    // origin (which the resize() above pins at the viewport centre).
    const p = easePop(this.toggle.progress);
    this.buildGroup.scale.set(p);
    this.upgradeGroup.scale.set(p);
    this.buildGroup.alpha = p;
    this.upgradeGroup.alpha = p;

    const showUpgrade = upgrade.open;
    this.buildGroup.visible = !showUpgrade;
    this.upgradeGroup.visible = showUpgrade;

    if (showUpgrade) this.drawUpgradeWheel(upgrade);
    else this.drawBuildWheel(wheel);
  }

  // --- Build wheel ---------------------------------------------------------

  private drawBuildWheel(model: BuildWheelModel): void {
    const r = this.radius;
    const inner = r * INNER_RADIUS;
    const hub = r * HUB_RADIUS;

    this.drawRings(this.buildRings, r, hub);

    for (let i = 0; i < model.segments.length; i++) {
      const seg = model.segments[i];
      if (!seg) continue;
      const nodes = this.wedgeNodes(this.buildGroup, this.buildWedges, i);
      this.drawWedge(nodes, buildSegmentDraw(seg), inner, r, SEGMENT_ARC);
    }
    // Any pooled wedges beyond this model's segment count stay hidden.
    this.hideWedgesFrom(this.buildWedges, model.segments.length);

    this.buildHubOre.text = `${model.ore}`;
    this.buildHubOre.y = -4;
    this.buildHubLabel.y = this.buildHubOre.y + 12;
    this.buildHubLabel.text = 'ORE';
  }

  // --- Upgrade wheel -------------------------------------------------------

  /** The one screen where ship stats appear (GDD §2.2, §2.5), now a wheel: one
   *  wedge per track, each giving current value → next tier → ore cost. */
  private drawUpgradeWheel(model: UpgradeWheelModel): void {
    const r = this.radius;
    const inner = r * INNER_RADIUS;
    const hub = r * HUB_RADIUS;
    const arc = upgradeWedgeArc(model.wedges.length);

    this.drawRings(this.upgradeRings, r, hub);

    for (let i = 0; i < model.wedges.length; i++) {
      const wedge = model.wedges[i];
      if (!wedge) continue;
      const nodes = this.wedgeNodes(this.upgradeGroup, this.upgradeWedges, i);
      this.drawWedge(nodes, upgradeWedgeDraw(wedge), inner, r, arc);
    }
    this.hideWedgesFrom(this.upgradeWedges, model.wedges.length);

    this.upgradeHubOre.text = `${model.ore}`;
    this.upgradeHubOre.y = -4;
    this.upgradeHubLabel.y = this.upgradeHubOre.y + 12;
    // Name the hull whose stats these are — the class is the lobby choice.
    this.upgradeHubLabel.text = model.className;
  }

  // --- Shared wedge drawing (the field report's "same component family") ----

  private drawRings(rings: Graphics, r: number, hub: number): void {
    // Backing disc + hub ring. Redrawn per frame: one Graphics, open for seconds.
    rings.clear();
    rings
      .circle(0, 0, r)
      .fill({ color: PALETTE.vacuum, alpha: 0.88 })
      .circle(0, 0, r)
      .stroke({ width: 1.5, color: PALETTE.plasma, alpha: 0.35 })
      .circle(0, 0, hub)
      .fill({ color: PALETTE.vacuum, alpha: 0.95 })
      .circle(0, 0, hub)
      .stroke({ width: 1.5, color: PALETTE.plasma, alpha: 0.6 });
  }

  /** Draw one wedge: the body, the words, the second line, and the cost — and
   *  nothing else (GDD §2.5). Written once, used by both wheels. */
  private drawWedge(
    nodes: WedgeNodes,
    d: WedgeDraw,
    inner: number,
    outer: number,
    arc: number,
  ): void {
    const half = arc / 2;
    const a0 = d.angle - half;
    const a1 = d.angle + half;

    nodes.body.visible = true;
    nodes.body.clear();
    nodes.body
      .moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner)
      .arc(0, 0, outer, a0, a1)
      .lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner)
      .arc(0, 0, inner, a1, a0, true)
      .closePath()
      .fill({ color: PALETTE.hullSteel, alpha: bodyAlpha(d.ready) * 0.16 })
      .stroke({ width: 1, color: PALETTE.hullSteel, alpha: bodyAlpha(d.ready) * 0.5 });

    const lx = Math.cos(d.angle) * outer * LABEL_RADIUS;
    const ly = Math.sin(d.angle) * outer * LABEL_RADIUS;

    nodes.label.visible = true;
    nodes.label.text = d.label;
    nodes.label.style.fill = d.ready ? TEXT_PRIMARY : TEXT_DIM;
    nodes.label.x = lx;
    nodes.label.y = ly - 16;

    nodes.sub.visible = true;
    nodes.sub.text = d.sub;
    nodes.sub.x = lx;
    nodes.sub.y = ly - 2;

    if (d.cost !== null) {
      nodes.cost.visible = true;
      nodes.cost.text = `${d.cost}`;
      // Yellow only when payable — a half-lit yellow still reads as "ore is here"
      // at a glance, and that trust is what style-guide §2 forbids spending.
      nodes.cost.style.fill = d.costReady ? PALETTE.signalYellow : TEXT_DIM;
      nodes.cost.x = lx;
      nodes.cost.y = ly + 12;
    } else {
      nodes.cost.visible = false;
    }

    nodes.arrow.visible = d.arrow;
    if (d.arrow) {
      nodes.arrow.clear();
      nodes.arrow
        .poly([0, -5, 8, 0, 0, 5])
        .fill({ color: PALETTE.plasma, alpha: d.ready ? 0.95 : 0.5 });
      nodes.arrow.x = lx + nodes.label.width / 2 + 10;
      nodes.arrow.y = ly - 9;
    }
  }

  /** Lazily create (and then reuse) one wedge's children, parented to `group`. */
  private wedgeNodes(group: Container, pool: WedgeNodes[], index: number): WedgeNodes {
    const existing = pool[index];
    if (existing) return existing;

    const body = new Graphics();
    const label = makeText('', FONT_HEADING, 13, TEXT_PRIMARY);
    const sub = makeText('', FONT_HEADING, 9, TEXT_DIM);
    const cost = makeText('', FONT_NUMERAL, 20, PALETTE.signalYellow, 'bold');
    const arrow = new Graphics();
    for (const t of [label, sub, cost]) t.anchor.set(0.5, 0);
    group.addChild(body);
    group.addChild(label, sub, cost, arrow);

    const nodes: WedgeNodes = { body, label, sub, cost, arrow };
    pool[index] = nodes;
    return nodes;
  }

  /** Hide any pooled wedges the current model didn't fill — so a wheel that
   *  shrank (fewer tracks) never leaves a stale wedge drawn. */
  private hideWedgesFrom(pool: WedgeNodes[], from: number): void {
    for (let i = from; i < pool.length; i++) {
      const n = pool[i];
      if (!n) continue;
      n.body.visible = false;
      n.label.visible = false;
      n.sub.visible = false;
      n.cost.visible = false;
      n.arrow.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Model → wedge descriptor (the only place the two wheels differ)
// ---------------------------------------------------------------------------

/** A Build-wheel segment as a wedge: label, its target, its cost. */
function buildSegmentDraw(seg: WheelSegment): WedgeDraw {
  return {
    angle: seg.angle,
    label: seg.label,
    // "Every label names which" — planet or ship (GDD §2.5). Words, not a number.
    sub: seg.target === 'ship' ? 'YOUR SHIP' : 'YOUR PLANET',
    cost: seg.cost,
    ready: wedgeReady(seg.state),
    costReady: seg.state === 'ready',
    arrow: seg.opensPanel,
  };
}

/** An Upgrade-wheel wedge: label, its current → next stat value, its cost. This
 *  screen is the one place a stat value ever shows, so the second line carries
 *  it (GDD §2.5): `10 → 13`, or `MAX` on a finished ladder. */
function upgradeWedgeDraw(wedge: UpgradeWedge): WedgeDraw {
  const sub = wedge.state === 'maxed' ? `${wedge.current} · MAX` : `${wedge.current} → ${wedge.next}`;
  return {
    angle: wedge.angle,
    label: wedge.label,
    sub,
    cost: wedge.cost,
    ready: wedgeReady(wedge.state),
    costReady: wedge.state === 'ready',
    arrow: false,
  };
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
