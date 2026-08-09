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
 * ── AND THE COLOUR HALF OF THE DIRECTION (u11-01) ──────────────────────────
 * u7-02 landed the wheel's STRUCTURE in Gantry/Bone and left its PALETTE behind:
 * the hub's chevron still drew in plasma, `OPEN ▸` and the index diamond in a
 * hand-picked chalk, and every wedge face and edge in raw `hullSteel`. A developer
 * read the result as half-finished, and the diagnosis is one line — Gantry/Bone's
 * premise is that **the menu spends no colour**, so the primary is the brightest
 * thing rather than the bluest one. Every tone this file paints now comes from
 * {@link WHEEL_CHROME} in {@link ./instrument} — the SAME in-match Bone vocabulary
 * the HUD took in u7-07, not a parallel one — with exactly two exceptions, both
 * ratified: the cost numerals and the hub's ore total (rule 2 above), and the
 * threat red of a REJECTED press, which is danger rather than chrome.
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
import { MATERIAL_SHADES, TRACKING, trackingPx, WHEEL_HALO, wheelMetrics } from '../art/materials';
import type { WheelProfile } from '../art/materials';
import { SEGMENT_ARC } from './build-wheel';
import type { BuildWheelModel, SegmentState, WheelSegment } from './build-wheel';
import {
  buildWedgeLines,
  capWords,
  costWords,
  pipRows,
  segmentCostPaint,
  statWords,
  targetWords,
  upgradeCostPaint,
  upgradeCostWords,
  upgradeWedgeLines,
} from './wheel-stack';
import type { CostPaint, WedgeLine } from './wheel-stack';

export type { CostPaint } from './wheel-stack';
import { upgradeWedgeArc } from './upgrade-wheel';
import type { UpgradeWheelModel, UpgradeWedge, UpgradeWedgeState } from './upgrade-wheel';
import { WheelToggle } from './wheel-toggle';
import type { HubBack } from './wheel-nav';
import { NEUTRAL_FEEDBACK } from './press-feedback';
import type { ControlFeedback, PressFeedback, PressSurface } from './press-feedback';
import { wheelRadius, WHEEL_MIN_RADIUS } from './hud-geometry';
import { WHEEL_CHROME, WHEEL_FACE_ALPHA } from './instrument';
import { FONT_BODY as FONT_NUMERAL, FONT_HEADING } from './typography';

/** One Build-wheel wedge as the view drew it — the ?debug=1 live-stage seam's
 *  shape. Repair (p5-08) is the one that needed this first: a live-stage test
 *  reads back the REPAIR wedge's real effect line ("+15 HP", the partial, or a
 *  reason) off the shipped bundle, the same discipline as {@link
 *  DrawnUpgradeWedge}. Since u7-02 it carries the whole four-line stack, so the
 *  cost and count/cap lines are read back the same way. */
export interface DrawnBuildWedge {
  readonly id: WheelSegment['id'];
  readonly label: string;
  /**
   * The wedge's *reason* line as drawn — repair's effect/reason copy ("+15 HP",
   * "REPAIR in 12s"), or the target line ("YOUR STATION") on every other wedge.
   *
   * Deliberately not "whatever is on visual line 2": this field is what the wedge
   * *says about itself*, and the p5-08 live-stage spec reads the repair deal off
   * it. Since u7-02 repair's line is drawn on the fourth line rather than the
   * second (the design's own stack order), and the field still answers the same
   * question.
   */
  readonly sub: string;
  /** The target line as drawn — "YOUR STATION" / "YOUR SHIP", or their compact
   *  phone forms. Every wedge names which (GDD §2.5). */
  readonly target: string;
  /** The count/cap line as drawn — "2 / 4 BUILT" — or `''` on an uncapped wedge. */
  readonly caps: string;
  /** The cost line as drawn — "3", "FULL", or "OPEN ▸" on the one wedge that
   *  opens a screen instead of spending. One numeral since a0-03; whether it can
   *  be paid is {@link costPaint}, not a second number. */
  readonly costLabel: string;
  readonly cost: number | null;
  /** Whether the wedge drew bright (pressable) or dark (refused, with a reason). */
  readonly ready: boolean;
  /** How the cost numeral was painted — the ratified style-guide §2 carve-out:
   *  `ore` (signal yellow, payable), `refused` (threat red, not payable), `spent`
   *  (steel, capped or inert), or `none` (no numeral drawn). */
  readonly costPaint: CostPaint;
}

/**
 * One upgrade wedge as the view drew it — the ?debug=1 live-stage seam's shape (a
 * bought tier must re-render its wedge here). Since u7-06 it carries the whole
 * four-line stack as well as the model values behind it, so a real-input spec
 * reads the strings the shipped bundle actually rendered rather than re-deriving
 * them — the same discipline as {@link DrawnBuildWedge}.
 */
export interface DrawnUpgradeWedge {
  readonly kind: UpgradeWedge['kind'];
  readonly track: UpgradeWedge['track'];
  readonly label: string;
  readonly tier: number;
  readonly maxTier: number;
  readonly current: string;
  readonly next: string | null;
  readonly cost: number | null;
  readonly state: UpgradeWedgeState;
  /** The WEAPON wedge's tier summary (pips), or `null` on other wedges. */
  readonly summary: UpgradeWedge['summary'];
  /** The stat line as drawn — `"111% → 123%"`, its compact phone form, or the
   *  WEAPON wedge's stacked pip rows. */
  readonly stat: string;
  /** The cost line as drawn — `"12/8"`, `"MAX"`, or `"OPEN ▸"` on the wedge that
   *  opens a screen instead of spending. `''` where no cost slot was drawn. */
  readonly costLabel: string;
  /** The ladder-position pips as drawn — `"●●○"`. `''` on the WEAPON wedge. */
  readonly tiers: string;
  /** Whether the wedge drew bright (pressable) or dark (refused, with a reason). */
  readonly ready: boolean;
  /** How the cost numeral was painted — the style-guide §2 carve-out: `ore`
   *  (payable), `refused` (threat red, not payable), `spent` (steel, maxed), or
   *  `none` (the `OPEN ▸` signpost, chalk). */
  readonly costPaint: CostPaint;
}

// ---------------------------------------------------------------------------
// Typography & neutrals (style-guide §5.6 — shared with the HUD)
// ---------------------------------------------------------------------------

// The two stacks come from ./typography (imported above), which exists so a face
// swap is one line rather than a grep. This file used to spell them out again,
// which is exactly the drift that module prevents — and it bit (a1-01): the shared
// stack's fallback moved and this copy did not, so the wheel would have drawn its
// ore total in a different face from the HUD's on the CI runner.
//
// The COLOURS took the same lesson in u11-01. They used to be spelled out here as
// a local `TEXT_PRIMARY = 0xdce3ec` and a local `TEXT_DIM = hullSteel`, which is
// how the wheel ended up a step bluer than the HUD it sits inside; they are now
// {@link WHEEL_CHROME}, the same Bone ramp `./instrument` hands the rest of the
// glass. `TEXT_MUTED` (./chrome) went the same way — it is 0x8b95a5, which is
// `BONE.lo` with five more parts of blue in it, and five parts of blue is exactly
// the size of the drift this brief exists to close.

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
//
// The radii come from the ratified Gantry/Bone profile for this wheel's actual
// drawn radius ({@link wheelMetrics}), which states the look twice — once at the
// handoff's desktop radius and once at a 390 px phone's — and interpolates. The
// hub disc IS the inner edge of the wedge ring, exactly as the handoff draws it
// (a 150 px hub inside a 470 px disc), so there is one number rather than two
// that have to be kept in step.

/** Where a wedge's word stack ENDS, as a fraction of the outer radius: the stack
 *  hangs from just inside the rim, where the arc is widest, and grows inward.
 *  Anchoring it at the rim rather than centring it in the ring is what lets a
 *  four-line stack fit a 72° wedge on a phone. */
function labelTopRadius(m: WheelProfile, outer: number): number {
  return outer - m.labelInset * outer;
}

/** The hub chevron's half-height as a fraction of its half-width — see
 *  {@link BuildWheelView.drawHubBack}, which is also where the layout reads it
 *  back, so the mark and the space reserved for it can never disagree. */
const CHEVRON_ASPECT = 0.625;

/** Ease the raw 0→1 pop progress so it settles rather than arriving linearly —
 *  a small overshoot-free ease-out reads as a wheel "snapping" into place. */
function easePop(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - (1 - c) * (1 - c);
}

/**
 * Solve the per-ring alpha for a set of NESTED translucent rings, given the
 * coverage each should leave behind it — the same increment-not-target algebra
 * `src/art/materials.ts` uses for a plate's cast shadow, because it is the same
 * problem: a ring painted over the ones beneath it must carry the *difference*,
 * or a stepped falloff reads as a stack of grey hoops.
 */
function nestedRingAlphas(targets: readonly number[]): number[] {
  const out: number[] = [];
  let covered = 0;
  for (const target of targets) {
    if (target <= covered || covered >= 1) {
      out.push(0);
      continue;
    }
    out.push((target - covered) / (1 - covered));
    covered = target;
  }
  return out;
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

/** How much of {@link WHEEL_CHROME.face} a wedge's face carries. A refused wedge
 *  is *dark*, not hidden: the player still learns the wedge exists and what it
 *  costs. The two numbers, and why the wedge no longer outlines itself, are
 *  {@link WHEEL_FACE_ALPHA}'s. */
function faceAlpha(ready: boolean): number {
  return ready ? WHEEL_FACE_ALPHA.ready : WHEEL_FACE_ALPHA.inert;
}

/** The colour a {@link CostPaint} resolves to (the paints themselves, and the
 *  style-guide §2 carve-out they implement, live in {@link ./wheel-stack}). */
function costColor(paint: CostPaint): number {
  switch (paint) {
    case 'ore':
      return PALETTE.signalYellow;
    case 'refused':
      return PALETTE.threatRed;
    case 'spent':
      return MATERIAL_SHADES.tickSteel;
    case 'none':
      // `OPEN ▸` — the one slot that signposts a screen instead of quoting a
      // price. It spends no RESERVED colour, so under Bone it is simply the
      // brightest metal on the wedge: the affordance reads by brightness.
      return WHEEL_CHROME.nameReady;
  }
}

// ---------------------------------------------------------------------------
// One wedge's children (shared shape for both wheels)
// ---------------------------------------------------------------------------

interface WedgeNodes {
  readonly body: Graphics;
  /** The name/target/cost/count lines and the arrow, parented together so a
   *  press-down or confirm pulse scales — and a rejection shakes — the whole
   *  cluster as one (press feedback, field report v0.2.2). Positioned at the
   *  wedge's label point; its children sit at offsets from there. */
  readonly cluster: Container;
  /** Line 1 — the wedge's own name, Audiowide. Multi-word names wrap. */
  readonly label: Text;
  /** Line 2 — what it spends on ("YOUR STATION"), or a stat value ("10 → 13")
   *  on the upgrade wheel. */
  readonly sub: Text;
  /** Line 3 — the cost numeral, or `FULL` / `OPEN ▸`. */
  readonly cost: Text;
  /** Line 4 — the count over its cap ("2 / 4 BUILT"), repair's effect/reason line
   *  ("+15 HP", "REPAIR in 12s"), or the upgrade wheel's ladder pips ("●●○").
   *  Empty on a wedge that has none of them. */
  readonly detail: Text;
}

/** The normalised descriptor {@link BuildWheelView.drawWedge} draws — the one
 *  shape both wheels reduce to, so the drawing code is written once. The lines
 *  themselves, and which slot carries what, are decided in {@link ./wheel-stack}
 *  so they can be held to a fit budget headless. */
interface WedgeDraw {
  readonly angle: number;
  /** The stack, top-first. A slot that has nothing to say is simply absent. */
  readonly lines: readonly WedgeLine[];
  readonly cost: number | null;
  /** Bright vs. dark (dimmed-with-a-reason). */
  readonly ready: boolean;
  /** How the cost slot is painted (style-guide §2's carve-out, both colours). */
  readonly costPaint: CostPaint;
}

/** The text a `WedgeDraw` put in one slot, or `''` if the slot is unused. */
function slotText(d: WedgeDraw, slot: WedgeLine['slot']): string {
  return d.lines.find((l) => l.slot === slot)?.text ?? '';
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/**
 * The Build wheel and the Upgrade wheel behind its arrow. Add once to the HUD;
 * call {@link update} each frame with the two models and the frame time. The
 * container hides itself entirely once the wheel is fully closed, so away from
 * your own station it costs one boolean per frame.
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
  /** The hub's BACK affordance (field report v0.2.4): an up-chevron + a word
   *  (`CLOSE` at the top level) that a hub tap / ESC acts on. */
  private readonly buildHubBackChevron = new Graphics();
  private readonly buildHubBackLabel: Text;
  /** The short fading hairline between the hub's total and its BACK word (the
   *  handoff's hub divider). */
  private readonly buildHubRule = new Graphics();
  /** The hub disc as a tap surface — sized to the hub ring each frame so the HUD
   *  can register the BACK affordance thumb-sized (field report v0.2.4). Invisible
   *  fill: the ring is already drawn by {@link drawRings}; this only carries the
   *  bounds. */
  private readonly buildHubHit = new Graphics();

  // --- Upgrade wheel -------------------------------------------------------
  private readonly upgradeRings = new Graphics();
  private readonly upgradeWedges: WedgeNodes[] = [];
  private readonly upgradeHubOre: Text;
  private readonly upgradeHubLabel: Text;
  private readonly upgradeHubBackChevron = new Graphics();
  private readonly upgradeHubBackLabel: Text;
  private readonly upgradeHubRule = new Graphics();
  private readonly upgradeHubHit = new Graphics();

  // The hub group is measured by {@link drawHub} and placed by {@link drawHubBack}
  // once its full height is known, so the whole stack sits centred in the disc
  // rather than hanging off a guessed offset. These carry the measurement across.
  private hubOreNode: Text | null = null;
  private hubCaptionNode: Text | null = null;
  private hubOreCentre = 0;
  private hubCaptionTop = 0;
  private hubStackHeight = 0;

  /** Whether the last frame was a touch device — decides the hub BACK's key hint
   *  (`· ESC` on PC only, field report v0.2.4 "ESC mirrors it … legend shows it").
   *  Fed per frame by {@link update}; defaults to touch so an unwired caller shows
   *  no dead desktop key. */
  private isTouch = true;

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

    // Build wheel hub: the live ore total (GDD §2.5) in signal yellow, under the
    // hub's BACK affordance (field report v0.2.4 — a tap on the hub goes up a
    // level; here, the top level, that CLOSES the wheel).
    this.buildHubOre = makeText('', FONT_NUMERAL, 26, PALETTE.signalYellow, 'bold');
    this.buildHubOre.anchor.set(0.5, 0.5);
    this.buildHubLabel = makeText('ORE', FONT_NUMERAL, 11, WHEEL_CHROME.secondary, 'bold');
    this.buildHubLabel.anchor.set(0.5, 0);
    this.buildHubBackLabel = makeText('', FONT_NUMERAL, 9, WHEEL_CHROME.affordance, 'bold');
    this.buildHubBackLabel.anchor.set(0.5, 0);
    this.buildGroup.addChild(
      this.buildHubHit,
      this.buildRings,
      this.buildHubOre,
      this.buildHubLabel,
      this.buildHubRule,
      this.buildHubBackChevron,
      this.buildHubBackLabel,
    );

    // Upgrade wheel hub: the same ore total (one purchase draws on the same ore),
    // labelled with the hull whose stats these are — the class is locked at the
    // lobby, so it names whose ship you are spending on.
    this.upgradeHubOre = makeText('', FONT_NUMERAL, 26, PALETTE.signalYellow, 'bold');
    this.upgradeHubOre.anchor.set(0.5, 0.5);
    this.upgradeHubLabel = makeText('', FONT_NUMERAL, 10, WHEEL_CHROME.secondary, 'bold');
    this.upgradeHubLabel.anchor.set(0.5, 0);
    this.upgradeHubBackLabel = makeText('', FONT_NUMERAL, 9, WHEEL_CHROME.affordance, 'bold');
    this.upgradeHubBackLabel.anchor.set(0.5, 0);
    this.upgradeGroup.addChild(
      this.upgradeHubHit,
      this.upgradeRings,
      this.upgradeHubOre,
      this.upgradeHubLabel,
      this.upgradeHubRule,
      this.upgradeHubBackChevron,
      this.upgradeHubBackLabel,
    );

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

  /** The hub's BACK tap surface for the wheel currently on top — the disc at the
   *  wheel's centre a hub tap / ESC acts on (field report v0.2.4), sized to the
   *  hub ring so it registers thumb-sized. `null` when no wheel is up, so the HUD
   *  registers it only while it is actually drawn. */
  get hubBackNode(): Container | null {
    if (!this.toggle.visible) return null;
    const active = this.upgradeGroup.visible ? this.upgradeHubHit : this.buildHubHit;
    return active.visible ? active : null;
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
   * @param isTouch Whether the active device is touch — decides the hub BACK's key
   *                hint (`· ESC` on PC only, field report v0.2.4). Defaults to
   *                touch, so an unwired caller never prints a dead desktop key.
   */
  update(
    wheel: BuildWheelModel,
    upgrade: UpgradeWheelModel,
    time: number,
    feedback?: PressFeedback,
    isTouch = true,
  ): void {
    this.isTouch = isTouch;
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
    const m = wheelMetrics(r);
    const inner = r * m.hub;
    const hub = inner;

    this.drawRings(this.buildRings, r, hub, m);
    this.drawSpokes(this.buildRings, inner, r, model.segments.length, m);

    for (let i = 0; i < model.segments.length; i++) {
      const seg = model.segments[i];
      if (!seg) continue;
      const nodes = this.wedgeNodes(this.buildGroup, this.buildWedges, i);
      this.drawWedge(
        nodes,
        buildSegmentDraw(seg, m),
        inner,
        r,
        SEGMENT_ARC,
        m,
        this.sample(feedback, 'build', i, time),
      );
    }
    // Any pooled wedges beyond this model's segment count stay hidden.
    this.hideWedgesFrom(this.buildWedges, model.segments.length);

    this.drawHub(this.buildHubOre, this.buildHubLabel, `${model.ore}`, 'ORE', m);
    this.drawHubBack(
      this.buildHubBackChevron,
      this.buildHubBackLabel,
      this.buildHubHit,
      this.buildHubRule,
      hub,
      m,
      model.hubBack,
    );

    // Capture what was drawn for the ?debug=1 live-stage seams — the REAL lines
    // each wedge rendered (repair's "+15 HP"/partial/reason, the cost line, the
    // count over its cap), straight off the descriptors the view just
    // drew from, so a Playwright test reads the shipped client rather than a model.
    this.lastBuildDrawn = true;
    this.lastBuildWedges = model.segments.map((seg) => {
      const d = buildSegmentDraw(seg, m);
      return {
        id: seg.id,
        label: seg.label,
        // Line 2 as drawn: repair's effect/reason, else what the wedge spends on.
        sub: slotText(d, 'sub'),
        target: targetWords(seg),
        caps: capWords(seg, m) ?? '',
        costLabel: costWords(seg) ?? '',
        cost: d.cost,
        ready: d.ready,
        costPaint: d.costPaint,
      };
    });
  }

  // --- Upgrade wheel -------------------------------------------------------

  /** The one screen where ship stats appear (GDD §2.2, §2.5), now a wheel: one
   *  wedge per track, each giving current value → next tier → ore cost. */
  private drawUpgradeWheel(model: UpgradeWheelModel, time: number, feedback?: PressFeedback): void {
    this.lastBuildDrawn = false; // the Build wheel is not the one on top
    const r = this.radius;
    const m = wheelMetrics(r);
    const inner = r * m.hub;
    const hub = inner;
    const arc = upgradeWedgeArc(model.wedges.length);

    this.drawRings(this.upgradeRings, r, hub, m);
    this.drawSpokes(this.upgradeRings, inner, r, model.wedges.length, m);

    for (let i = 0; i < model.wedges.length; i++) {
      const wedge = model.wedges[i];
      if (!wedge) continue;
      const nodes = this.wedgeNodes(this.upgradeGroup, this.upgradeWedges, i);
      this.drawWedge(nodes, upgradeWedgeDraw(wedge, m), inner, r, arc, m, this.sample(feedback, 'upgrade', i, time));
    }
    this.hideWedgesFrom(this.upgradeWedges, model.wedges.length);

    // Name the hull whose stats these are — the class is the lobby choice.
    this.drawHub(this.upgradeHubOre, this.upgradeHubLabel, `${model.ore}`, model.className, m);
    this.drawHubBack(
      this.upgradeHubBackChevron,
      this.upgradeHubBackLabel,
      this.upgradeHubHit,
      this.upgradeHubRule,
      hub,
      m,
      model.hubBack,
    );

    // Capture what was drawn for the ?debug=1 live-stage seam (a bought tier must
    // re-render here). Rebuilt from the model the view just drew from.
    this.lastUpgradeDrawn = true;
    this.lastUpgradeWedges = model.wedges.map((w) => {
      const d = upgradeWedgeDraw(w, m);
      return {
        kind: w.kind,
        track: w.track,
        label: w.label,
        tier: w.tier,
        maxTier: w.maxTier,
        current: w.current,
        next: w.next,
        cost: w.cost,
        state: w.state,
        summary: w.summary,
        // The lines the view just drew from, read back off the SAME descriptors
        // rather than recomposed — a spec that reads these is reading the client.
        stat: w.kind === 'weapon' ? pipRows(w.summary ?? []) : statWords(w, m),
        costLabel: upgradeCostWords(w) ?? '',
        tiers: slotText(d, 'detail'),
        ready: d.ready,
        costPaint: d.costPaint,
      };
    });
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

  /**
   * The hub's BACK affordance (field report v0.2.4) — an up-chevron above a word,
   * at the top of the hub. The whole hub disc is the tap target (registered
   * thumb-sized by the HUD), and ESC mirrors it on PC, so the word carries a `·
   * ESC` hint on desktop ("the legend shows it"). `null` (a closed wheel) hides
   * both nodes. The chevron points UP — "go up a level" — and is a **machined
   * mark** ({@link WHEEL_CHROME.mark}), the same solid chalk the index diamond at
   * twelve o'clock is cut from, so backward/forward read as one language.
   *
   * It used to be a 1.5px *stroked outline* in **plasma**, which is the single
   * loudest thing this brief was called in to fix: it put the pre-Gantry accent
   * at the centre of the wheel, brighter than the CLOSE word it belongs to, and
   * on a phone (`c` ≈ 3.3px) a 1.5px outline of a 6px triangle is most of the
   * triangle anyway. Filled and hueless it is crisper at both sizes and it costs
   * the palette nothing.
   */
  private drawHubBack(
    chevron: Graphics,
    label: Text,
    hit: Graphics,
    rule: Graphics,
    hub: number,
    m: WheelProfile,
    hb: HubBack | null,
  ): void {
    if (!hb) {
      chevron.visible = false;
      label.visible = false;
      hit.visible = false;
      rule.visible = false;
      return;
    }
    // The tap surface is the whole hub disc — thumb-sized (field report v0.2.4).
    // Near-invisible: the visible ring is drawRings'; this only carries the bounds
    // the HUD registers ({@link hubBackNode}).
    hit.visible = true;
    hit.clear();
    hit.circle(0, 0, hub).fill({ color: PALETTE.vacuum, alpha: 0.001 });

    // CLOSE / BACK, plus the PC key that mirrors the hub tap (field report v0.2.4).
    label.visible = true;
    label.text = this.isTouch ? hb.label : `${hb.label} · ESC`;
    restyle(label, m.hubBack, trackingPx(TRACKING.eyebrow, m.hubBack));

    // The up-chevron — "go up a level" — sits BETWEEN the rule and the word,
    // pointing back at the total above it, so the gesture and its label read as
    // one thing rather than as a word with a mark stranded under it.
    //
    // `CHEVRON_ASPECT` is the half-height, as a fraction of the half-width. It was
    // 0.6 while the mark was a 1.5px OUTLINE, where a shallow triangle still reads
    // as a chevron because the eye follows two strokes. Filled (u11-01) a 1.67:1
    // triangle is a hill, not an arrowhead, so the apex is raised until the mark
    // is closer to the index diamond it now shares a tone with — that diamond is
    // 1:1, this is 1.25:1, and both read as "here" at a glance rather than as a
    // shape that has to be decoded.
    chevron.visible = true;
    chevron.clear();
    const c = Math.max(3, m.detent * 0.55);
    const apex = c * CHEVRON_ASPECT;
    chevron.poly([-c, apex, 0, -apex, c, apex]).fill({ color: WHEEL_CHROME.mark, alpha: 0.9 });

    // Now that every piece has been measured, centre the whole hub group on the
    // disc — the handoff's hub is a stack centred in its circle, and hanging it
    // off a guessed offset is what left it sitting on the bottom rim.
    const gap = Math.max(4, m.gapCost + 2);
    const chevronH = c * CHEVRON_ASPECT * 2;
    const total = this.hubStackHeight + gap + chevronH + 2 + label.height;
    const top = -total / 2;
    if (this.hubOreNode) this.hubOreNode.y = top + this.hubOreCentre;
    if (this.hubCaptionNode) this.hubCaptionNode.y = top + this.hubCaptionTop;

    const ruleY = top + this.hubStackHeight + gap / 2;
    rule.visible = true;
    rule.clear();
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const w = m.hubRule * (1 - (0.8 * i) / steps);
      rule.moveTo(-w / 2, ruleY).lineTo(w / 2, ruleY).stroke({
        width: 1,
        color: WHEEL_CHROME.divider,
        alpha: 0.3,
      });
    }
    chevron.y = ruleY + gap / 2 + chevronH / 2;
    label.y = chevron.y + chevronH / 2 + 2;
  }

  /** The hub's live ore total and its caption — the handoff's `40px` numeral over
   *  a tracked eyebrow. The Build wheel captions it `ORE`; the upgrade wheel names
   *  the hull whose stats are being spent on. Measured here and *placed* by
   *  {@link drawHubBack}, which is the piece that knows how tall the whole group
   *  ends up and so where the middle of it is. */
  private drawHub(ore: Text, caption: Text, value: string, word: string, m: WheelProfile): void {
    ore.text = value;
    restyle(ore, m.hubOre, trackingPx(TRACKING.name, m.hubOre));
    caption.text = word;
    restyle(caption, m.hubCaption, trackingPx(TRACKING.eyebrow, m.hubCaption));
    // The numeral is anchored on its own centre, the caption on its top edge —
    // record both as offsets from the top of the pair so the group can be centred.
    this.hubOreNode = ore;
    this.hubCaptionNode = caption;
    this.hubOreCentre = ore.height / 2;
    this.hubCaptionTop = ore.height + 2;
    this.hubStackHeight = ore.height + 2 + caption.height;
    ore.y = this.hubOreCentre;
    caption.y = this.hubCaptionTop;
  }

  /**
   * The disc the wedges sit on — the Gantry/Bone build wheel (u7-02), and the one
   * place in this file where "no plates over gameplay" is actually enforced.
   *
   * Drawn outermost-first:
   *
   *  1. **The halo** — a pool of void with no edge ({@link WHEEL_HALO}), stepped
   *     into nested rings whose alphas carry the increment rather than the target
   *     ({@link nestedRingAlphas}). This is what the wheel reads *against*. The
   *     handoff gives it a `radial-gradient` rather than a card precisely so the
   *     fight stays visible up to the disc; a rectangle would give the HUD a
   *     corner, and a corner is what turns a wheel into a panel.
   *  2. **A faint halo ring**, the handoff's `inset:-26px` hairline — the machined
   *     edge of the pool, so the falloff has somewhere to end.
   *  3. **The disc**, still translucent (the world reads through it) in the
   *     Gantry face tone rather than the old flat panel fill.
   *  4. **An inner vignette**, the handoff's `inset 0 0 56px` — the rim is a
   *     machined lip, so the disc is darker where it turns away from the light.
   *  5. **The rim**, lit along its top and shadowed along its bottom: the
   *     handoff's whole diagnosis ("a lit top edge, a shadowed under-line")
   *     stated on a circle instead of on a rectangle.
   *  6. **The index diamond** at twelve o'clock — where segment 0 begins.
   *
   * Redrawn per frame: one Graphics, open for seconds at a time.
   */
  private drawRings(rings: Graphics, r: number, hub: number, m: WheelProfile): void {
    rings.clear();

    // 1 + 2. The halo, and the hairline that ends it.
    const holdR = r * WHEEL_HALO.holdTo;
    const fadeR = r * WHEEL_HALO.fadeTo;
    const bands = WHEEL_HALO.bands;
    const targets: number[] = [];
    for (let i = 0; i < bands; i++) {
      // 1 at the outer edge of the falloff, 1/bands at its inner edge; squared, so
      // the pool has a soft shoulder rather than a linear ramp.
      const outward = (bands - i) / bands;
      targets.push(WHEEL_HALO.peak * (1 - outward) * (1 - outward));
    }
    const alphas = nestedRingAlphas(targets);
    for (let i = 0; i < bands; i++) {
      const radius = fadeR + ((holdR - fadeR) * i) / bands;
      const alpha = alphas[i] ?? 0;
      if (alpha <= 0) continue;
      rings.circle(0, 0, radius).fill({ color: PALETTE.vacuum, alpha });
    }
    rings.circle(0, 0, holdR).fill({ color: PALETTE.vacuum, alpha: WHEEL_HALO.peak });
    rings
      .circle(0, 0, r + m.haloOffset)
      .stroke({ width: m.haloRing, color: PALETTE.hullSteel, alpha: 0.14 });

    // 3. The disc. Translucent on purpose: the wheel opens over a live fight.
    rings.circle(0, 0, r).fill({ color: MATERIAL_SHADES.faceShade, alpha: 0.88 });

    // 4. The inner vignette — nested rings inside the rim, darkening outward.
    const vig = Math.max(1, Math.round(m.vignette / 6));
    for (let i = 0; i < vig; i++) {
      const t = (i + 1) / vig;
      rings
        .circle(0, 0, r - (m.vignette * (1 - t)) / 1)
        .stroke({ width: m.vignette / vig + 1, color: PALETTE.vacuum, alpha: 0.16 * t });
    }

    // 5. The rim: lit across the top, shadowed across the bottom.
    rings
      .arc(0, 0, r, Math.PI, 2 * Math.PI)
      .stroke({ width: m.ring, color: MATERIAL_SHADES.ruleLit, alpha: 0.95 });
    rings
      .arc(0, 0, r, 0, Math.PI)
      .stroke({ width: m.ring, color: MATERIAL_SHADES.ruleDeep, alpha: 0.95 });

    // 6. The index diamond at twelve o'clock — a machined mark, and since u11-01
    //    the SAME mark tone as the hub's chevron ({@link WHEEL_CHROME.mark}).
    const d = m.detent;
    rings
      .poly([0, -r - d / 2, d / 2, -r, 0, -r + d / 2, -d / 2, -r])
      .fill({ color: WHEEL_CHROME.mark, alpha: 0.9 });

    // The hub disc, with the same lit-top / shadowed-bottom rim.
    rings.circle(0, 0, hub).fill({ color: PALETTE.vacuum, alpha: 0.95 });
    rings
      .arc(0, 0, hub, Math.PI, 2 * Math.PI)
      .stroke({ width: m.ring, color: MATERIAL_SHADES.ruleLit, alpha: 0.9 });
    rings
      .arc(0, 0, hub, 0, Math.PI)
      .stroke({ width: m.ring, color: MATERIAL_SHADES.ruleDeep, alpha: 0.9 });
  }

  /** The hairline spokes between wedges — the handoff's 1.2° conic dividers.
   *  Drawn once for the whole wheel rather than per wedge, so a wedge's own
   *  press/confirm overlays never paint over a divider.
   *
   *  Since u11-01 these are the ONLY thing dividing one wedge from the next: a
   *  wedge no longer strokes its own outline, because the ring it sits in is
   *  already bounded on all four sides (the disc rim outside, the hub ring inside,
   *  a spoke on each flank) and outlining it again is what made five wedges read
   *  as five little plates. See {@link ../ui/instrument} `WHEEL_FACE_ALPHA`. */
  private drawSpokes(rings: Graphics, inner: number, outer: number, count: number, m: WheelProfile): void {
    if (count <= 1) return;
    const arc = (2 * Math.PI) / count;
    for (let i = 0; i < count; i++) {
      // Boundaries sit half an arc off each wedge centre; segment 0 is centred at
      // twelve o'clock, so the first boundary is half an arc clockwise from it.
      const a = -Math.PI / 2 + arc * (i + 0.5);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      rings
        .moveTo(cos * inner, sin * inner)
        .lineTo(cos * outer, sin * outer)
        .stroke({ width: m.spoke, color: WHEEL_CHROME.divider, alpha: 0.45 });
    }
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
    m: WheelProfile,
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

    // The face, and ONLY the face — no outline of its own (u11-01). A ready
    // wedge is a brighter lift over the glass than an inert one; that difference
    // IS the state, because Bone spends brightness where the old chrome spent an
    // outline weight and a hue.
    nodes.body.visible = true;
    nodes.body.clear();
    trace().fill({ color: WHEEL_CHROME.face, alpha: faceAlpha(d.ready) });

    // Press/confirm/reject overlays on the body. A press and a confirmed spend go
    // BRIGHT rather than blue (u11-01 — they drew in plasma, the accent this whole
    // brief is removing; Bone's answer to "this one, now" is luminance). The
    // rejection keeps its threat red: that is DANGER, the other half of
    // style-guide §2, and a refusal is a mechanic rather than chrome. Each is
    // 0-alpha when idle, so an untouched wedge draws exactly as before.
    const energy = Math.max(fb.glow, fb.shimmer);
    if (energy > 0) trace().fill({ color: WHEEL_CHROME.press, alpha: energy * 0.14 });
    if (fb.glow > 0) trace().stroke({ width: 2, color: WHEEL_CHROME.press, alpha: fb.glow });
    if (fb.reject > 0) {
      trace().fill({ color: PALETTE.threatRed, alpha: fb.reject * 0.28 });
      trace().stroke({ width: 2, color: PALETTE.threatRed, alpha: fb.reject });
    }

    // --- The word stack (the handoff's four lines) --------------------------
    //
    // Type sizes come from the resolved profile, so the same look states itself
    // at 235 px and at 140 px rather than one of them being a scaled accident.
    // Which slot carries what is {@link ./wheel-stack}'s call; this only paints
    // and places. Each line is measured after its text is set and stacked under
    // the one above, so a wrapped name or a multi-line pip block pushes the rest
    // down instead of overlapping it.
    const slots: Record<WedgeLine['slot'], Text> = {
      name: nodes.label,
      sub: nodes.sub,
      cost: nodes.cost,
      detail: nodes.detail,
    };
    for (const t of [nodes.label, nodes.sub, nodes.cost, nodes.detail]) t.visible = false;

    let y = 0;
    for (const line of d.lines) {
      const t = slots[line.slot];
      t.visible = true;
      t.text = line.text;
      // The name dims with its wedge; the two muted lines stay muted (they are
      // read, not acted on); the cost slot takes the one RESERVED carve-out —
      // signal yellow when payable, threat red when not, steel where there is no
      // price to pay at all (style-guide §2, amended 2026-08-06).
      t.style.fill =
        line.slot === 'name'
          ? d.ready
            ? WHEEL_CHROME.nameReady
            : WHEEL_CHROME.nameInert
          : line.slot === 'cost'
            ? costColor(d.costPaint)
            : WHEEL_CHROME.secondary;
      restyle(t, line.size, trackingPx(line.tracking, line.size));
      t.y = y;
      y += t.height + line.gap;
    }
    const stackHeight = y;

    const top = labelTopRadius(m, outer);
    // The cluster's own origin is its top-centre (children are anchored 0.5, 0),
    // so the pivot puts the pulse's centre of gravity in the middle of the stack.
    const centre = top - stackHeight / 2;
    const lx = Math.cos(d.angle) * centre;
    const ly = Math.sin(d.angle) * centre;
    nodes.cluster.pivot.set(0, stackHeight / 2);
    nodes.cluster.visible = true;
    nodes.cluster.x = lx + fb.shakeX;
    nodes.cluster.y = ly;
    nodes.cluster.scale.set(fb.scale);
  }

  /** Lazily create (and then reuse) one wedge's children, parented to `group`. */
  private wedgeNodes(group: Container, pool: WedgeNodes[], index: number): WedgeNodes {
    const existing = pool[index];
    if (existing) return existing;

    const body = new Graphics();
    const cluster = new Container();
    // Sizes are set per frame from the resolved wheel profile ({@link restyle});
    // these are only the faces and the roles. The name is the one display face on
    // the wheel; everything else is Oxanium, per style-guide §7.
    const label = makeText('', FONT_HEADING, 13, WHEEL_CHROME.nameReady);
    const sub = makeText('', FONT_NUMERAL, 12, WHEEL_CHROME.secondary, 'bold');
    const cost = makeText('', FONT_NUMERAL, 20, PALETTE.signalYellow, 'bold');
    const detail = makeText('', FONT_NUMERAL, 12, WHEEL_CHROME.secondary, 'bold');
    for (const t of [label, sub, cost, detail]) {
      t.anchor.set(0.5, 0);
      t.style.align = 'center';
    }
    cluster.addChild(label, sub, cost, detail);
    group.addChild(body);
    group.addChild(cluster);

    const nodes: WedgeNodes = { body, cluster, label, sub, cost, detail };
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
      // The four lines all live under the cluster, so one flag hides the whole
      // wedge's words.
      n.cluster.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Model → wedge descriptor (the only place the two wheels differ)
// ---------------------------------------------------------------------------

/**
 * A Build-wheel segment as a wedge — the handoff's four lines (u7-02):
 *
 *   NAME / what it spends on / the cost / the count over its cap.
 *
 * Every wedge names its target on line 2 now — "every label names which" (GDD
 * §2.5), words not a number — and line 4 carries whichever of the two things a
 * wedge has to add: its **count over its cap** (TURRET, SHIELD, RADAR — u7-02,
 * closing u2-02) or, on REPAIR REACTOR, the **effect/reason** copy that is the
 * one ratified exception to "the only number is the cost" (p5-08: the HP a tap
 * buys, or why it is refused). UPGRADE SHIP has neither, and spends its cost slot
 * on the words that say it opens a screen.
 */
function buildSegmentDraw(seg: WheelSegment, m: WheelProfile): WedgeDraw {
  return {
    angle: seg.angle,
    lines: buildWedgeLines(seg, m),
    cost: seg.cost,
    ready: wedgeReady(seg.state),
    // UPGRADE SHIP keeps its arrow rather than a number — it is the one segment
    // that opens a second screen (GDD §2.5), and the handoff says so in the slot
    // the others spend on a price: `OPEN ▸`, in chalk rather than in ore yellow.
    costPaint: segmentCostPaint(seg),
  };
}

/**
 * An Upgrade-wheel wedge, in the same four slots the Build wheel's uses (u7-06):
 *
 *   NAME / the stat this tier moves / `cost/held` / where it sits on its ladder.
 *
 * Everything about which slot carries what is {@link ./wheel-stack}'s call, so
 * the stat line — the densest text on any wheel in the game — is held to the arc
 * by the same headless fit budget as the Build wheel's copy, at every profile
 * (`hud-geometry.test.ts`). This function only says which model the lines come
 * from and how the cost slot is painted.
 *
 * The WEAPON wedge is the exception, and it is the Build wheel's exception too:
 * it opens a screen rather than spending, so it says `OPEN ▸` where the others
 * quote a price — the same words in the same slot as UPGRADE SHIP. BACK is not a
 * wedge on either wheel any more; it lives on the hub (field report v0.2.4).
 */
function upgradeWedgeDraw(wedge: UpgradeWedge, m: WheelProfile): WedgeDraw {
  return {
    angle: wedge.angle,
    lines: upgradeWedgeLines(wedge, m),
    cost: wedge.cost,
    ready: wedgeReady(wedge.state),
    costPaint: upgradeCostPaint(wedge),
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

/**
 * Re-size and re-track one line to the resolved wheel profile — the mechanism by
 * which the same look states itself at 235 px and at 140 px.
 *
 * Guarded on the current values: a Pixi `TextStyle` setter dirties the text and
 * forces a re-measure, and this runs for every line of every wedge every frame
 * the wheel is open. Sizes only actually change on a resize, so the guard turns a
 * per-frame restyle into a no-op.
 */
function restyle(text: Text, fontSize: number, letterSpacing: number): void {
  const size = Math.round(fontSize * 100) / 100;
  const spacing = Math.round(letterSpacing * 100) / 100;
  if (text.style.fontSize !== size) text.style.fontSize = size;
  if (text.style.letterSpacing !== spacing) text.style.letterSpacing = spacing;
}
