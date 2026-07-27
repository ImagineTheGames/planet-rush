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
 *
 * ── PRESS & CONFIRM FEEDBACK (field report v0.2.2) ──────────────────────────
 * Each wedge draws its press/confirm motion from the shared {@link PressFeedback}
 * driver ({@link ./press-feedback}), sampled per wedge as it is drawn: a press-down
 * glows and scales it, a disabled press shakes and red-flashes it, a confirmed
 * spend pulses and shimmers it. The words live in a per-wedge {@link Container}
 * (the "cluster") precisely so one transform can scale and shake the whole label
 * group; the glow/flash/shimmer are palette-legal overlays on the wedge body. All
 * of it is a no-op when the driver is absent or idle, so an untouched wheel draws
 * exactly as it did before this pass — the feedback lights up, nothing else moves.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { TextStyleFontWeight } from 'pixi.js';
import { PALETTE } from '@render/index';
import { SEGMENT_ARC } from './build-wheel';
import type { BuildWheelModel, SegmentState, WheelSegment } from './build-wheel';
import { upgradeWedgeArc } from './upgrade-wheel';
import type {
  UpgradeWheelModel,
  UpgradeWedge,
  UpgradeWedgeState,
  UpgradeSummaryPip,
} from './upgrade-wheel';
import { WheelToggle } from './wheel-toggle';
import { NEUTRAL_FEEDBACK } from './press-feedback';
import type { ControlFeedback, PressFeedback, PressSurface } from './press-feedback';
import { wheelRadius, WHEEL_MIN_RADIUS } from './hud-geometry';

/** One Build-wheel wedge as the view drew it — the ?debug=1 live-stage seam's
 *  shape. Repair (p5-08) is the one that needs this: a live-stage test reads back
 *  the REPAIR wedge's real second line ("+15 HP", the partial, or a reason) off
 *  the shipped bundle, the same discipline as {@link DrawnUpgradeWedge}. */
export interface DrawnBuildWedge {
  readonly id: WheelSegment['id'];
  readonly label: string;
  /** The second line the wedge drew — a target ("YOUR PLANET") or, for repair,
   *  its effect/reason line. */
  readonly sub: string;
  readonly cost: number | null;
  /** Whether the wedge drew bright (pressable) or dark (refused, with a reason). */
  readonly ready: boolean;
}

/** One upgrade wedge as the view drew it — the ?debug=1 live-stage seam's shape
 *  (a bought tier must re-render its wedge here). */
export interface DrawnUpgradeWedge {
  readonly kind: UpgradeWedge['kind'];
  readonly track: UpgradeWedge['track'];
  readonly label: string;
  readonly tier: number;
  readonly current: string;
  readonly next: string | null;
  readonly cost: number | null;
  readonly state: UpgradeWedgeState;
  /** The WEAPON wedge's tier summary (pips), or `null` on other wedges. */
  readonly summary: UpgradeWedge['summary'];
}

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
  /** The label/sub/cost/arrow, parented together so a press-down or confirm pulse
   *  scales — and a rejection shakes — the whole cluster as one (press feedback,
   *  field report v0.2.2). Positioned at the wedge's label point; its children sit
   *  at offsets from there. */
  readonly cluster: Container;
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
  /** Draw the "opens a screen" arrow — UPGRADE SHIP on the Build wheel, and the
   *  WEAPON wedge on the upgrade wheel (both open a wheel behind them). */
  readonly arrow: boolean;
  /** Draw the "go back" chevron (the weapon sub-wheel's BACK wedge). */
  readonly back: boolean;
}

/** A weapon track's tiers as filled-vs-empty pip glyphs: `●●○` at tier 2 of 3.
 *  A compact, palette-neutral summary that reads without opening the sub-wheel. */
function pipRow(pip: UpgradeSummaryPip): string {
  const filled = '●'.repeat(Math.max(0, pip.tier));
  const empty = '○'.repeat(Math.max(0, pip.maxTier - pip.tier));
  return `${pip.label} ${filled}${empty}`;
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

  /** ?debug=1 live-stage capture: the upgrade wedges the view actually drew last
   *  frame (or empty when the upgrade wheel is not up), so a Playwright test can
   *  assert a bought tier re-rendered. Costs nothing in a normal build. */
  private lastUpgradeWedges: DrawnUpgradeWedge[] = [];
  private lastUpgradeDrawn = false;
  /** The Build-wheel wedges the view drew last frame (empty when the Build wheel
   *  is not the one on top), for the ?debug=1 repair-wedge live-stage seam. */
  private lastBuildWedges: DrawnBuildWedge[] = [];
  private lastBuildDrawn = false;

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
   * @param feedback Per-wedge press/confirm motion (field report v0.2.2), sampled
   *                per wedge as it is drawn. Optional — omitted, every wedge draws
   *                neutral, exactly as before the press-feedback pass landed.
   */
  update(
    wheel: BuildWheelModel,
    upgrade: UpgradeWheelModel,
    time: number,
    feedback?: PressFeedback,
  ): void {
    const dt = this.lastTime < 0 ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;

    // The player wants the wheel up iff the model is open; the shared toggle turns
    // that target into a pop and — critically — can never latch shut on it.
    this.toggle.update(wheel.open, dt);
    // With no time to animate across (a frozen frame, or the very first update),
    // land on the target rather than sitting at scale 0 — the pop needs a clock.
    if (dt <= 0) this.toggle.settle();
    this.visible = this.toggle.visible;
    if (!this.visible) {
      this.lastUpgradeDrawn = false;
      this.lastBuildDrawn = false;
      return;
    }

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

    if (showUpgrade) this.drawUpgradeWheel(upgrade, time, feedback);
    else this.drawBuildWheel(wheel, time, feedback);
  }

  /** The press/confirm motion for one wedge on `surface`, or the neutral no-op
   *  when there is no feedback driver (an unwired caller / a headless test). */
  private sample(
    feedback: PressFeedback | undefined,
    surface: PressSurface,
    index: number,
    time: number,
  ): ControlFeedback {
    return feedback ? feedback.feedback(surface, index, time) : NEUTRAL_FEEDBACK;
  }

  // --- Build wheel ---------------------------------------------------------

  private drawBuildWheel(model: BuildWheelModel, time: number, feedback?: PressFeedback): void {
    this.lastUpgradeDrawn = false; // the upgrade wheel is not the one on top
    const r = this.radius;
    const inner = r * INNER_RADIUS;
    const hub = r * HUB_RADIUS;

    this.drawRings(this.buildRings, r, hub);

    for (let i = 0; i < model.segments.length; i++) {
      const seg = model.segments[i];
      if (!seg) continue;
      const nodes = this.wedgeNodes(this.buildGroup, this.buildWedges, i);
      this.drawWedge(nodes, buildSegmentDraw(seg), inner, r, SEGMENT_ARC, this.sample(feedback, 'build', i, time));
    }
    // Any pooled wedges beyond this model's segment count stay hidden.
    this.hideWedgesFrom(this.buildWedges, model.segments.length);

    this.buildHubOre.text = `${model.ore}`;
    this.buildHubOre.y = -4;
    this.buildHubLabel.y = this.buildHubOre.y + 12;
    this.buildHubLabel.text = 'ORE';

    // Capture what was drawn for the ?debug=1 repair-wedge live-stage seam: the
    // REAL second line each wedge rendered (repair's "+15 HP"/partial/reason),
    // straight off the descriptors the view just drew from.
    this.lastBuildDrawn = true;
    this.lastBuildWedges = model.segments.map((seg) => {
      const d = buildSegmentDraw(seg);
      return { id: seg.id, label: d.label, sub: d.sub, cost: d.cost, ready: d.ready };
    });
  }

  // --- Upgrade wheel -------------------------------------------------------

  /** The one screen where ship stats appear (GDD §2.2, §2.5), now a wheel: one
   *  wedge per track, each giving current value → next tier → ore cost. */
  private drawUpgradeWheel(model: UpgradeWheelModel, time: number, feedback?: PressFeedback): void {
    this.lastBuildDrawn = false; // the Build wheel is not the one on top
    const r = this.radius;
    const inner = r * INNER_RADIUS;
    const hub = r * HUB_RADIUS;
    const arc = upgradeWedgeArc(model.wedges.length);

    this.drawRings(this.upgradeRings, r, hub);

    for (let i = 0; i < model.wedges.length; i++) {
      const wedge = model.wedges[i];
      if (!wedge) continue;
      const nodes = this.wedgeNodes(this.upgradeGroup, this.upgradeWedges, i);
      this.drawWedge(nodes, upgradeWedgeDraw(wedge), inner, r, arc, this.sample(feedback, 'upgrade', i, time));
    }
    this.hideWedgesFrom(this.upgradeWedges, model.wedges.length);

    this.upgradeHubOre.text = `${model.ore}`;
    this.upgradeHubOre.y = -4;
    this.upgradeHubLabel.y = this.upgradeHubOre.y + 12;
    // Name the hull whose stats these are — the class is the lobby choice.
    this.upgradeHubLabel.text = model.className;

    // Capture what was drawn for the ?debug=1 live-stage seam (a bought tier must
    // re-render here). Rebuilt from the model the view just drew from.
    this.lastUpgradeDrawn = true;
    this.lastUpgradeWedges = model.wedges.map((w) => ({
      kind: w.kind,
      track: w.track,
      label: w.label,
      tier: w.tier,
      current: w.current,
      next: w.next,
      cost: w.cost,
      state: w.state,
      summary: w.summary,
    }));
  }

  // --- ?debug=1 live-stage seam --------------------------------------------

  /** Whether the wheel accepts input this frame — the leak-fix's verdict, read by
   *  the cycle live-stage test to prove it still opens after rapid mashing. */
  debugInteractive(): boolean {
    return this.visible && this.toggle.interactive;
  }

  /** The upgrade wedges the view actually drew last frame (empty when the upgrade
   *  wheel is not up), so a test can assert a bought tier re-rendered its wedge. */
  debugUpgradeWedges(): DrawnUpgradeWedge[] {
    return this.lastUpgradeDrawn ? this.lastUpgradeWedges : [];
  }

  /** The Build-wheel wedges the view actually drew last frame (empty when the
   *  Build wheel is not the one on top), so the repair-wedge live-stage test can
   *  read the REPAIR wedge's real "+15 HP"/partial/reason line off the client. */
  debugBuildWedges(): DrawnBuildWedge[] {
    return this.lastBuildDrawn ? this.lastBuildWedges : [];
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
   *  nothing else (GDD §2.5). Written once, used by both wheels. `fb` is the
   *  press/confirm motion for this wedge (field report v0.2.2): a press-down
   *  glows and scales it, a rejection shakes and red-flashes it, a confirmed spend
   *  pulses and shimmers it — all neutral (a no-op) when nothing is happening. */
  private drawWedge(
    nodes: WedgeNodes,
    d: WedgeDraw,
    inner: number,
    outer: number,
    arc: number,
    fb: ControlFeedback = NEUTRAL_FEEDBACK,
  ): void {
    const half = arc / 2;
    const a0 = d.angle - half;
    const a1 = d.angle + half;

    // Trace the wedge arc into the body. Re-issued before each fill/stroke group
    // (the same discipline drawRings uses) so an overlay always draws on a freshly
    // traced path rather than relying on Pixi's retained-path behaviour.
    const trace = (): Graphics =>
      nodes.body
        .moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner)
        .arc(0, 0, outer, a0, a1)
        .lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner)
        .arc(0, 0, inner, a1, a0, true)
        .closePath();

    nodes.body.visible = true;
    nodes.body.clear();
    trace()
      .fill({ color: PALETTE.hullSteel, alpha: bodyAlpha(d.ready) * 0.16 })
      .stroke({ width: 1, color: PALETTE.hullSteel, alpha: bodyAlpha(d.ready) * 0.5 });

    // Press/confirm/reject overlays on the body, in palette-legal colours: a
    // plasma glow on press, a plasma shimmer on a confirmed spend, a threat-red
    // wash on a rejection (danger only — style-guide §2). Each is 0-alpha when
    // idle, so an untouched wedge draws exactly as before.
    const energy = Math.max(fb.glow, fb.shimmer);
    if (energy > 0) trace().fill({ color: PALETTE.plasma, alpha: energy * 0.2 });
    if (fb.glow > 0) trace().stroke({ width: 2, color: PALETTE.plasma, alpha: fb.glow });
    if (fb.reject > 0) {
      trace().fill({ color: PALETTE.threatRed, alpha: fb.reject * 0.28 });
      trace().stroke({ width: 2, color: PALETTE.threatRed, alpha: fb.reject });
    }

    const lx = Math.cos(d.angle) * outer * LABEL_RADIUS;
    const ly = Math.sin(d.angle) * outer * LABEL_RADIUS;
    // The cluster carries the words; the feedback scales it (press-down / confirm
    // pulse) and shakes it sideways (rejection).
    nodes.cluster.visible = true;
    nodes.cluster.x = lx + fb.shakeX;
    nodes.cluster.y = ly;
    nodes.cluster.scale.set(fb.scale);

    nodes.label.visible = true;
    nodes.label.text = d.label;
    nodes.label.style.fill = d.ready ? TEXT_PRIMARY : TEXT_DIM;

    nodes.sub.visible = true;
    nodes.sub.text = d.sub;

    if (d.cost !== null) {
      nodes.cost.visible = true;
      nodes.cost.text = `${d.cost}`;
      // Yellow only when payable — a half-lit yellow still reads as "ore is here"
      // at a glance, and that trust is what style-guide §2 forbids spending.
      nodes.cost.style.fill = d.costReady ? PALETTE.signalYellow : TEXT_DIM;
    } else {
      nodes.cost.visible = false;
    }

    // An "opens a screen" arrow points right (UPGRADE SHIP, WEAPON); the BACK
    // chevron points left, off the label's leading edge — one node, two glyphs.
    const showArrow = d.arrow || d.back;
    nodes.arrow.visible = showArrow;
    if (showArrow) {
      nodes.arrow.clear();
      const glyph = d.back ? [8, -5, 0, 0, 8, 5] : [0, -5, 8, 0, 0, 5];
      nodes.arrow.poly(glyph).fill({ color: PALETTE.plasma, alpha: d.ready ? 0.95 : 0.5 });
      nodes.arrow.x = d.back ? -(nodes.label.width / 2 + 18) : nodes.label.width / 2 + 10;
      nodes.arrow.y = -9;
    }
  }

  /** Lazily create (and then reuse) one wedge's children, parented to `group`. */
  private wedgeNodes(group: Container, pool: WedgeNodes[], index: number): WedgeNodes {
    const existing = pool[index];
    if (existing) return existing;

    const body = new Graphics();
    const cluster = new Container();
    const label = makeText('', FONT_HEADING, 13, TEXT_PRIMARY);
    const sub = makeText('', FONT_HEADING, 9, TEXT_DIM);
    const cost = makeText('', FONT_NUMERAL, 20, PALETTE.signalYellow, 'bold');
    const arrow = new Graphics();
    for (const t of [label, sub, cost]) t.anchor.set(0.5, 0);
    // Children sit at fixed offsets from the cluster origin (the wedge's label
    // point), so scaling/offsetting the cluster moves the whole label group.
    label.y = -16;
    sub.y = -2;
    cost.y = 12;
    // The cluster is pivoted on its own centre so a confirm pulse swells about the
    // label rather than growing off one corner.
    cluster.pivot.set(0, -2);
    cluster.addChild(label, sub, cost, arrow);
    group.addChild(body);
    group.addChild(cluster);

    const nodes: WedgeNodes = { body, cluster, label, sub, cost, arrow };
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
      // The label/sub/cost/arrow all live under the cluster, so one flag hides the
      // whole wedge's words.
      n.cluster.visible = false;
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
    // REPAIR CORE is the one wedge that names its effect: the HP a tap buys, or the
    // reason it's refused (p5-08 — a discrete purchase, so the deal must be legible
    // before the tap). Every other wedge's second line names its target instead —
    // "every label names which" (GDD §2.5), planet or ship, words not a number.
    sub: seg.repair ? seg.repair.line : seg.target === 'ship' ? 'YOUR SHIP' : 'YOUR PLANET',
    cost: seg.cost,
    ready: wedgeReady(seg.state),
    costReady: seg.state === 'ready',
    arrow: seg.opensPanel,
    back: false,
  };
}

/** An Upgrade-wheel wedge. A `track` wedge carries its current → next stat value
 *  (GDD §2.5 — the one screen a stat value ever shows): `10 → 13`, or `MAX` on a
 *  finished ladder. The WEAPON wedge carries its tier pips and an arrow (it opens
 *  the sub-wheel); the BACK wedge carries a go-back chevron. */
function upgradeWedgeDraw(wedge: UpgradeWedge): WedgeDraw {
  if (wedge.kind === 'weapon') {
    // The pips ARE the second line — the main wheel says the weapon tiers at a
    // glance without the sub-wheel (RATIFIED v0.2.2, item 3). No cost: it opens a
    // screen rather than spending, exactly like UPGRADE SHIP on the Build wheel.
    const sub = (wedge.summary ?? []).map(pipRow).join('\n');
    return {
      angle: wedge.angle,
      label: wedge.label,
      sub,
      cost: null,
      ready: wedgeReady(wedge.state),
      costReady: false,
      arrow: true,
      back: false,
    };
  }
  if (wedge.kind === 'back') {
    return {
      angle: wedge.angle,
      label: wedge.label,
      sub: 'TO SHIP',
      cost: null,
      ready: wedgeReady(wedge.state),
      costReady: false,
      arrow: false,
      back: true,
    };
  }
  const sub = wedge.state === 'maxed' ? `${wedge.current} · MAX` : `${wedge.current} → ${wedge.next}`;
  return {
    angle: wedge.angle,
    label: wedge.label,
    sub,
    cost: wedge.cost,
    ready: wedgeReady(wedge.state),
    costReady: wedge.state === 'ready',
    arrow: false,
    back: false,
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
