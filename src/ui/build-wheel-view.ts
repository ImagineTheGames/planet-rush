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
  fitWedgeStack,
  pipRows,
  scaleName,
  segmentCostPaint,
  statWords,
  targetWords,
  upgradeCostPaint,
  upgradeCostWords,
  upgradeWedgeLines,
} from './wheel-stack';
import type { CostPaint, WedgeFit, WedgeLine } from './wheel-stack';

export type { CostPaint } from './wheel-stack';
import { upgradeWedgeArc } from './upgrade-wheel';
import type { UpgradeWheelModel, UpgradeWedge, UpgradeWedgeState } from './upgrade-wheel';
import { WheelToggle } from './wheel-toggle';
import type { HubBack } from './wheel-nav';
import { NEUTRAL_FEEDBACK } from './press-feedback';
import type { ControlFeedback, PressFeedback, PressSurface } from './press-feedback';
import { wheelRadius, WHEEL_MIN_RADIUS } from './hud-geometry';
import { WHEEL_CHROME, WHEEL_FACE_ALPHA, WHEEL_SELECTION } from './instrument';
import { WheelSelection } from './wheel-selection';
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
  /** Whether this is the wedge the player is pointing at (u16-01) — the design's
   *  `sel === i`, read back off the descriptor the view actually drew from, so a
   *  live-stage test can assert the highlight followed a real pointer rather than
   *  re-deriving where it should have gone. */
  readonly selected: boolean;
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
  /** Whether this is the wedge the player is pointing at — the Build wheel's
   *  {@link DrawnBuildWedge.selected}, on the level behind its arrow (a0-51), read
   *  back off the descriptor the view actually drew from so a live-stage test can
   *  assert the highlight followed a real pointer onto a real wedge. */
  readonly selected: boolean;
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
  /** The cost line as drawn — `"12"`, `"MAX"`, or `"OPEN ▸"` on the wedge that
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

/**
 * The colour a wedge's NAME is drawn in — its own state first, the selection
 * second (u16-01).
 *
 * A refused wedge stays refused whether or not it is being pointed at: pointing
 * at a capped turret ring must not make it look buyable, which is why `ready` is
 * tested before `selection` and not alongside it. What the selection then does is
 * exactly one step of the Bone ramp, and only downward — the selected name is
 * already the brightest step the ramp has, so the contrast is bought by the OTHER
 * wedges stepping back (plus the size step, {@link SELECTION_NAME_SCALE}, and the
 * highlight behind it). That is the design's own `#FFFFFF` against `#C6CDD6`.
 */
function nameColor(ready: boolean, selection: WedgeSelection): number {
  if (!ready) return WHEEL_CHROME.nameInert;
  return selection === 'receded' ? WHEEL_CHROME.nameReceded : WHEEL_CHROME.nameReady;
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
  /** The last {@link fitWedgeStack} answer for this wedge, and the inputs it was
   *  computed from — see {@link BuildWheelView.fitFor}. Mutable on purpose: it is
   *  a per-node cache, not state the wheel reasons about. */
  fitKey: string;
  fit: WedgeFit;
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
  /** Where this wedge stands in the selection (u16-01) — see {@link WedgeSelection}. */
  readonly selection: WedgeSelection;
}

/**
 * One wedge's standing in the selection (u16-01).
 *
 *  - `selected` — the wedge being pointed at: its name goes up a step and up a
 *    size, its read-lines go up a step, and the highlight is over it.
 *  - `receded`  — a wedge on a wheel where something ELSE is selected: its name
 *    steps down one, and nothing else about it moves.
 *  - `none`     — nothing is selected anywhere on this wheel. Every wedge draws
 *    exactly as it did before this landed; a resting wheel spends no contrast
 *    advertising a choice nobody has made.
 */
export type WedgeSelection = 'selected' | 'receded' | 'none';

/** Where wedge `index` stands, given the model's selected wedge. */
function selectionOf(selected: number | null, index: number): WedgeSelection {
  if (selected === null) return 'none';
  return selected === index ? 'selected' : 'receded';
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
  // The wedge faces and the wedge WORDS are parented separately so the selection
  // highlight can sit between them — over the faces, under the type — which is
  // the order screen 5a draws them in and the only order in which a 0.26 white
  // tint lights a wedge instead of washing out its name (u16-01). Pooled wedge
  // nodes used to be added straight to the group as they were created, which made
  // the z-order an accident of creation time.
  private readonly buildBodies = new Container();
  private readonly buildSelection = new Graphics();
  private readonly buildClusters = new Container();
  /** The 140 ms sweep between wedges — the design's own transition, and the first
   *  consumer `PLATE_MOTION.wheelMs` has ever had ({@link ./wheel-selection}).
   *  The Build wheel's; the Upgrade wheel drives {@link upgradeSweep}. */
  private readonly buildSweep = new WheelSelection();
  /**
   * The Upgrade wheel's sweep — the SAME machine, given a different wedge count
   * (a0-51's guardrail: one radial menu, one selection machine, parameterised;
   * never a second copy of the logic).
   *
   * A second INSTANCE rather than a second implementation, and rather than one
   * instance re-pointed as the wheels swap: each wheel's highlight belongs to its
   * own wedges, so the Build wheel's fades out on the wedge it was on while the
   * Upgrade wheel's arrives on its own, instead of one highlight sliding from a
   * fifth of a turn to a quarter of one across a wheel change nobody asked to see
   * animated.
   */
  private readonly upgradeSweep = new WheelSelection();
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
  private readonly upgradeBodies = new Container();
  /** The Upgrade wheel's highlight, between its faces and its words for the same
   *  reason the Build wheel's is (a0-51 — it had neither the layer nor the draw
   *  call, so the wheel behind the arrow drew no selection at all). */
  private readonly upgradeSelection = new Graphics();
  private readonly upgradeClusters = new Container();
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
      this.buildBodies,
      this.buildSelection,
      this.buildClusters,
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
      this.upgradeBodies,
      this.upgradeSelection,
      this.upgradeClusters,
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
    // The selection sweeps run off the same clock (u16-01), one per wheel and
    // each given ITS OWN wedge count — the count decides where a wedge sits, so a
    // sweep driven by the wrong one lands right only at twelve o'clock (a0-51).
    // Each wheel is fed `null` while the other is the one on top, so a highlight
    // fades out with the thing it belongs to rather than being switched off by a
    // second rule here.
    this.buildSweep.update(upgrade.open ? null : wheel.selected, wheel.segments.length, dt);
    this.upgradeSweep.update(
      upgrade.open ? upgrade.selected : null,
      upgrade.wedges.length,
      dt,
    );
    // With no time to animate across (a frozen frame, or the very first update),
    // land on the target rather than sitting at scale 0 — the pop needs a clock,
    // and so does the sweep.
    if (dt <= 0) {
      this.toggle.settle();
      this.buildSweep.settle();
      this.upgradeSweep.settle();
    }
    this.visible = this.toggle.visible;
    if (!this.visible) {
      this.lastUpgradeDrawn = false;
      this.lastBuildDrawn = false;
      // A wheel that has finished closing is pointing at nothing, so the next
      // open starts dark rather than re-lighting whatever the pointer last
      // crossed on the way out.
      this.buildSweep.reset();
      this.upgradeSweep.reset();
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

    drawWheelRings(this.buildRings, r, hub, m);
    drawWheelSpokes(this.buildRings, inner, r, model.segments.length, m);

    // The highlighted wedge (u16-01) — drawn once for the wheel, at the swept
    // angle rather than at a wedge index, because mid-sweep it is BETWEEN two
    // wedges and that is the whole tell.
    drawWheelSelection(
      this.buildSelection,
      r,
      inner,
      m,
      this.buildSweep.angle,
      SEGMENT_ARC,
      this.buildSweep.presence,
    );

    for (let i = 0; i < model.segments.length; i++) {
      const seg = model.segments[i];
      if (!seg) continue;
      const nodes = this.wedgeNodes(this.buildBodies, this.buildClusters, this.buildWedges, i);
      this.drawWedge(
        nodes,
        buildSegmentDraw(seg, m, selectionOf(model.selected, i)),
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
    this.lastBuildWedges = model.segments.map((seg, i) => {
      const d = buildSegmentDraw(seg, m, selectionOf(model.selected, i));
      return {
        id: seg.id,
        selected: d.selection === 'selected',
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

    drawWheelRings(this.upgradeRings, r, hub, m);
    drawWheelSpokes(this.upgradeRings, inner, r, model.wedges.length, m);

    // The highlighted wedge — the same layer, the same routine and the same swept
    // angle as the Build wheel's, at THIS wheel's arc (a0-51). Before this the
    // call was simply absent here, so the wheel behind the arrow had no highlight
    // to be in the wrong place: *"it doesnt have the selection animation or
    // graphics"*.
    drawWheelSelection(
      this.upgradeSelection,
      r,
      inner,
      m,
      this.upgradeSweep.angle,
      arc,
      this.upgradeSweep.presence,
    );

    for (let i = 0; i < model.wedges.length; i++) {
      const wedge = model.wedges[i];
      if (!wedge) continue;
      const nodes = this.wedgeNodes(this.upgradeBodies, this.upgradeClusters, this.upgradeWedges, i);
      this.drawWedge(
        nodes,
        upgradeWedgeDraw(wedge, m, selectionOf(model.selected, i)),
        inner,
        r,
        arc,
        m,
        this.sample(feedback, 'upgrade', i, time),
      );
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
    this.lastUpgradeWedges = model.wedges.map((w, i) => {
      const d = upgradeWedgeDraw(w, m, selectionOf(model.selected, i));
      return {
        kind: w.kind,
        // Read off the descriptor the view drew from, exactly as the Build
        // wheel's is, so a live-stage test can see WHICH wedge lit rather than
        // re-deriving where the highlight should have gone (a0-51).
        selected: d.selection === 'selected',
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

    // ── The stack is FITTED to the wedge, not hung at a fixed radius (a0-32) ──
    //
    // The design anchors the words just inside the rim, and for the wedge at
    // twelve o'clock that is exactly right. The labels are not rotated with the
    // wheel — a radial menu you can read keeps them upright — so on the wedge at
    // NINE o'clock a line of text runs along the RADIUS, and what stops it is the
    // rim rather than the arc. `UPGRADE` ran 10 px past it on a 390 px phone.
    // {@link ../ui/wheel-stack} `fitWedgeStack` re-answers the two things that
    // were never ratified numbers — how far in the stack hangs, and how much
    // bigger u16-01's selected name gets — and is a no-op on every wedge that
    // already fitted. Memoised on the node, because the answer only changes when
    // the words, their sizes or the wheel's radius do.
    const fit = this.fitFor(nodes, d, outer, m, arc);
    const lines = scaleName(d.lines, fit.nameScale);

    let y = 0;
    for (const line of lines) {
      const t = slots[line.slot];
      t.visible = true;
      t.text = line.text;
      // The name dims with its wedge; the two muted lines stay muted (they are
      // read, not acted on); the cost slot takes the one RESERVED carve-out —
      // signal yellow when payable, threat red when not, steel where there is no
      // price to pay at all (style-guide §2, amended 2026-08-06).
      //
      // The selection moves the first two by exactly one step of the Bone ramp
      // (u16-01) and the cost slot NOT AT ALL: the cost's colour is the answer to
      // "can I pay for this", and a numeral that also brightened when you pointed
      // at it would be saying two things in one channel.
      t.style.fill =
        line.slot === 'name'
          ? nameColor(d.ready, d.selection)
          : line.slot === 'cost'
            ? costColor(d.costPaint)
            : d.selection === 'selected'
              ? WHEEL_CHROME.secondaryLit
              : WHEEL_CHROME.secondary;
      restyle(t, line.size, trackingPx(line.tracking, line.size));
      t.y = y;
      y += t.height + line.gap;
    }
    const stackHeight = y;

    // The cluster's own origin is its top-centre (children are anchored 0.5, 0),
    // so the pivot puts the pulse's centre of gravity in the middle of the stack.
    //
    // The design hangs the stack from just inside the rim; a0-32's fit is applied
    // as a DELTA off that rather than as an absolute radius, so a wedge that needs
    // no fitting lands exactly where it always did. (The two measure the stack's
    // height with different rulers — PixiJS here, `./font-metrics` there — and
    // they agree to about a pixel; a pixel is not worth moving four wedges that
    // were never wrong.)
    const centre = labelTopRadius(m, outer) - stackHeight / 2 - fit.pullIn;
    const lx = Math.cos(d.angle) * centre;
    const ly = Math.sin(d.angle) * centre;
    nodes.cluster.pivot.set(0, stackHeight / 2);
    nodes.cluster.visible = true;
    nodes.cluster.x = lx + fb.shakeX;
    nodes.cluster.y = ly;
    nodes.cluster.scale.set(fb.scale);
  }

  /**
   * This wedge's fit ({@link fitWedgeStack}), memoised on its node.
   *
   * The answer is a function of the words, their type sizes, the wheel's radius
   * and the wedge's angle and width — and of nothing else, which is why it can be
   * cached against exactly those. A wheel sitting open with an unchanged model
   * therefore pays one string compare per wedge per frame; it recomputes when a
   * cost changes, when a wedge is pointed at (u16-01 grows the name), and when the
   * viewport resizes. GDD §4.3's zero-allocation frame path is unbothered: the key
   * is the only allocation, and `restyle`/`t.text` already make one per line.
   */
  private fitFor(
    nodes: WedgeNodes,
    d: WedgeDraw,
    outer: number,
    m: WheelProfile,
    arc: number,
  ): WedgeFit {
    let key = `${outer.toFixed(2)}|${d.angle.toFixed(4)}|${arc.toFixed(4)}`;
    for (const line of d.lines) key += `|${line.slot}:${line.size.toFixed(2)}:${line.text}`;
    if (key !== nodes.fitKey) {
      nodes.fitKey = key;
      nodes.fit = fitWedgeStack(d.lines, outer, m, d.angle, Math.round((2 * Math.PI) / arc));
    }
    return nodes.fit;
  }

  /** Lazily create (and then reuse) one wedge's children. The face goes in
   *  `bodies` and the words in `clusters`, two containers with the selection
   *  highlight between them, so a wedge's z-order is a property of the wheel's
   *  layering rather than of which frame the node happened to be created on. */
  private wedgeNodes(
    bodies: Container,
    clusters: Container,
    pool: WedgeNodes[],
    index: number,
  ): WedgeNodes {
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
    bodies.addChild(body);
    clusters.addChild(cluster);

    const nodes: WedgeNodes = {
      body,
      cluster,
      label,
      sub,
      cost,
      detail,
      fitKey: '',
      fit: { radius: 0, pullIn: 0, nameScale: 1 },
    };
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
// The disc and its spokes — the chrome under both wheels
// ---------------------------------------------------------------------------

/**
 * Stroke ONE arc, and only the arc — the a0-21 fix, and the reason every arc on
 * this disc goes through a helper instead of calling `Graphics.arc` directly.
 *
 * **The defect.** A horizontal hairline ran from the hub's edge out to the outer
 * ring at the wheel's vertical centre, just under `OPEN ▸` — straight through the
 * middle of the UPGRADE SHIP wedge, bisecting the one segment it is not a
 * boundary of. It shipped, and it was in the committed golden, because it looks
 * exactly like a rule somebody drew on purpose: it is the rim's own lit tone at
 * the rim's own weight, since that is literally what it is.
 *
 * **The mechanism.** Pixi's `arc()` continues the open sub-path: if a point is
 * already open it emits a straight LINE from that point to the arc's start before
 * it begins curving (`ShapePath.arc` → `_ensurePoly(false)`, the same rule as
 * Canvas2D). And a point is *always* open here, because every `fill()`/`stroke()`
 * re-opens the path at the last point drawn (`GraphicsContext
 * ._initNextPathLocation`). So `circle(0,0,r).fill()` followed by
 * `arc(0,0,r, π, 2π)` does not draw a rim — it draws a chord from wherever the
 * pen was left to nine o'clock, and then the rim. A `circle`'s last point reads
 * back as its centre, so the chord ran from (0, 0) to (−r, 0): a full radius of
 * hairline across the wedge face. The hub's rim arc drew the same chord at hub
 * radius, over the hub disc, which is why the line reached the middle rather than
 * stopping where the hub covered it.
 *
 * **The fix.** `moveTo` the arc's own start point first, so the connector Pixi
 * insists on drawing is zero-length. Nothing is hidden and nothing is clipped:
 * the line was never a label separator, so there is nothing here to keep.
 *
 * The hub's `CLOSE · ESC` rule is a *different* thing and is untouched — it is
 * drawn deliberately, by {@link BuildWheelView.drawHubBack}, to {@link
 * WheelProfile.hubRule} width, and it is correct.
 */
function strokeArc(
  g: Graphics,
  radius: number,
  from: number,
  to: number,
  style: { width: number; color: number; alpha: number },
): void {
  g.moveTo(Math.cos(from) * radius, Math.sin(from) * radius)
    .arc(0, 0, radius, from, to)
    .stroke(style);
}

/**
 * The disc the wedges sit on — the Gantry/Bone build wheel (u7-02), and the one
 * place in this file where "no plates over gameplay" is actually enforced.
 *
 * Module-level and exported since a0-21, rather than a private method: it reads
 * nothing off the view, and a bare `Graphics` needs no DOM, so what this disc
 * actually draws can be asserted headlessly — which is what
 * `build-wheel-view.test.ts` does, and what a golden alone could not, because a
 * reviewer approves an image without knowing what it should not contain.
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
 * Every arc below goes through {@link strokeArc}, and that is load-bearing: a
 * bare `arc()` drags a chord in from wherever the previous primitive left the
 * pen, which is the stray rule a0-21 was called in to remove.
 *
 * Redrawn per frame: one Graphics, open for seconds at a time.
 */
export function drawWheelRings(rings: Graphics, r: number, hub: number, m: WheelProfile): void {
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
  strokeArc(rings, r, Math.PI, 2 * Math.PI, {
    width: m.ring,
    color: MATERIAL_SHADES.ruleLit,
    alpha: 0.95,
  });
  strokeArc(rings, r, 0, Math.PI, {
    width: m.ring,
    color: MATERIAL_SHADES.ruleDeep,
    alpha: 0.95,
  });

  // 6. The index diamond at twelve o'clock — a machined mark, and since u11-01
  //    the SAME mark tone as the hub's chevron ({@link WHEEL_CHROME.mark}).
  const d = m.detent;
  rings
    .poly([0, -r - d / 2, d / 2, -r, 0, -r + d / 2, -d / 2, -r])
    .fill({ color: WHEEL_CHROME.mark, alpha: 0.9 });

  // The hub disc, with the same lit-top / shadowed-bottom rim.
  rings.circle(0, 0, hub).fill({ color: PALETTE.vacuum, alpha: 0.95 });
  strokeArc(rings, hub, Math.PI, 2 * Math.PI, {
    width: m.ring,
    color: MATERIAL_SHADES.ruleLit,
    alpha: 0.9,
  });
  strokeArc(rings, hub, 0, Math.PI, {
    width: m.ring,
    color: MATERIAL_SHADES.ruleDeep,
    alpha: 0.9,
  });
}

/** The hairline spokes between wedges — the handoff's 1.2° conic dividers.
 *  Drawn once for the whole wheel rather than per wedge, so a wedge's own
 *  press/confirm overlays never paint over a divider.
 *
 *  Since u11-01 these are the ONLY thing dividing one wedge from the next: a
 *  wedge no longer strokes its own outline, because the ring it sits in is
 *  already bounded on all four sides (the disc rim outside, the hub ring inside,
 *  a spoke on each flank) and outlining it again is what made five wedges read
 *  as five little plates. See {@link ../ui/instrument} `WHEEL_FACE_ALPHA`.
 *
 *  "The ONLY thing" is now asserted rather than asserted-in-prose: a0-21 found a
 *  sixth line on the face that nobody had drawn on purpose, so
 *  `build-wheel-view.test.ts` reads the drawn geometry back and fails if anything
 *  crosses a wedge face away from these boundaries. */
export function drawWheelSpokes(
  rings: Graphics,
  inner: number,
  outer: number,
  count: number,
  m: WheelProfile,
): void {
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

// ---------------------------------------------------------------------------
// The highlighted wedge (u16-01 — screen 5a's selection state)
// ---------------------------------------------------------------------------

/**
 * The highlight over the wedge the player is pointing at — the half of screen 5a
 * that `docs/theme-coverage.md` found was never built.
 *
 * Three layers, in the design's own order and its own amounts
 * ({@link WHEEL_SELECTION}), all of them ALPHA over the disc rather than a
 * surface on it, so the fight still reads through the wheel:
 *
 *  1. **The tint** (`5a:55`) — one arc of the ring, lifted. This is the layer
 *     that says *this one*.
 *  2. **The two edge lines** (`5a:56`) — the design's 1.6° conic slivers on the
 *     wedge's own boundaries, each inside a stepped bloom standing in for its
 *     `box-shadow: 0 0 26px`. They land exactly on the hairline spokes, which is
 *     why the highlight cannot be mistaken for a wedge that has grown.
 *  3. **The outward glow** (`5a:57`) — `closest-side, transparent 62% → …100%`,
 *     masked to the wedge: it brightens toward the RIM, which is where the words
 *     are, and a soft bloom behind the name carries the design's `text-shadow:
 *     0 0 18px` without a blurred glyph raster.
 *
 * Module-level and taking a bare `Graphics`, for the same reason
 * {@link drawWheelRings} is: what this draws can then be read back headlessly
 * (`build-wheel-view.test.ts`), which is how the a0-21 law — nothing crosses a
 * wedge face that is not a boundary — is held over a NEW layer that draws inside
 * one. A golden cannot answer that question; it can only say the picture changed.
 *
 * `angle` is the SWEPT angle, not a wedge centre: mid-sweep the highlight sits
 * between two wedges, and that is the 140 ms the design asks for
 * ({@link ./wheel-selection}).
 */
export function drawWheelSelection(
  g: Graphics,
  outer: number,
  inner: number,
  m: WheelProfile,
  angle: number,
  arc: number,
  presence: number,
): void {
  g.clear();
  const lit = presence > 0.001;
  g.visible = lit;
  if (!lit) return;

  const half = arc / 2;
  const sector = (from: number, to: number, r0: number, r1: number): Graphics =>
    g
      .moveTo(Math.cos(from) * r0, Math.sin(from) * r0)
      .arc(0, 0, r1, from, to)
      .lineTo(Math.cos(to) * r0, Math.sin(to) * r0)
      .arc(0, 0, r0, to, from, true)
      .closePath();

  // 1. The tint over the selected wedge's face.
  sector(angle - half, angle + half, inner, outer).fill({
    color: WHEEL_CHROME.selection,
    alpha: WHEEL_SELECTION.tint * presence,
  });

  // 3a. The outward glow — nested annular sectors from `rimFrom` out to the rim,
  //     each carrying the INCREMENT rather than the target ({@link
  //     nestedRingAlphas}), or a stepped falloff reads as a stack of hoops.
  const bands = WHEEL_SELECTION.bands;
  const glowFrom = Math.max(inner, outer * WHEEL_SELECTION.rimFrom);
  const glowTargets: number[] = [];
  for (let i = 0; i < bands; i++) {
    const t = (i + 1) / bands;
    glowTargets.push(WHEEL_SELECTION.rim * t * t);
  }
  const glowAlphas = nestedRingAlphas(glowTargets);
  for (let i = bands - 1; i >= 0; i--) {
    const alpha = glowAlphas[i] ?? 0;
    if (alpha <= 0) continue;
    const r0 = glowFrom + ((outer - glowFrom) * i) / bands;
    sector(angle - half, angle + half, r0, outer).fill({
      color: WHEEL_CHROME.selection,
      alpha: alpha * presence,
    });
  }

  // 3b. The bloom behind the name — the design's `text-shadow: 0 0 18px`, cast by
  //     the layer that is already casting light rather than by the glyphs.
  const nameR = labelTopRadius(m, outer) - m.name * 0.6;
  // Clamped to the ring it lights. Unclamped, the phone profile's stack sits
  // close enough to the rim that a bloom scaled off the name would spill OUTSIDE
  // the disc — a glow with no wheel under it, over the halo, which is the one
  // thing on this screen that is supposed to have no edge at all.
  const bloom = Math.min(m.name * 1.9, outer - nameR, nameR - inner);
  for (let i = 0; i < bands; i++) {
    const t = (i + 1) / bands;
    g.circle(Math.cos(angle) * nameR, Math.sin(angle) * nameR, bloom * (1 - t + 1 / bands)).fill({
      color: WHEEL_CHROME.selection,
      alpha: (WHEEL_SELECTION.nameGlow / bands) * presence,
    });
  }

  // 2. The two edge lines, each inside its bloom. Drawn last so the brightest
  //    thing on the wheel is the boundary of the thing you are pointing at.
  const edge = (WHEEL_SELECTION.edgeDegrees * Math.PI) / 360; // half-width, radians
  for (const boundary of [angle - half, angle + half]) {
    for (let i = bands; i >= 1; i--) {
      const spread = edge * (1 + (WHEEL_SELECTION.edgeGlowSpread - 1) * (i / bands));
      sector(boundary - spread, boundary + spread, inner, outer).fill({
        color: WHEEL_CHROME.selection,
        alpha: (WHEEL_SELECTION.edgeGlowAlpha / bands) * presence,
      });
    }
    sector(boundary - edge, boundary + edge, inner, outer).fill({
      color: WHEEL_CHROME.selection,
      alpha: WHEEL_SELECTION.edge * presence,
    });
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
function buildSegmentDraw(
  seg: WheelSegment,
  m: WheelProfile,
  selection: WedgeSelection = 'none',
): WedgeDraw {
  return {
    angle: seg.angle,
    lines: buildWedgeLines(seg, m, selection === 'selected'),
    cost: seg.cost,
    ready: wedgeReady(seg.state),
    // UPGRADE SHIP keeps its arrow rather than a number — it is the one segment
    // that opens a second screen (GDD §2.5), and the handoff says so in the slot
    // the others spend on a price: `OPEN ▸`, in chalk rather than in ore yellow.
    costPaint: segmentCostPaint(seg),
    selection,
  };
}

/**
 * An Upgrade-wheel wedge, in the same four slots the Build wheel's uses (u7-06):
 *
 *   NAME / the stat this tier moves / the cost / where it sits on its ladder.
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
 *
 * ── THE SELECTION IS THIS WHEEL'S TOO (a0-51) ──────────────────────────────
 * This function used to hard-code `selection: 'none'`, on the argument that
 * screen 5a is the BUILD wheel and giving this one a highlight by inheritance
 * would be inventing design. The developer settled it by looking at the shipped
 * thing — *"build wheel still doesnt have the effects i asked for"* — and they
 * are right: the two wheels are one control at two levels (style-guide §2.1),
 * drawn by this one routine, and a control that lights under the pointer on the
 * page in front and goes dead on the page behind reads as a bug, not as
 * restraint. The rule is unchanged, and now it is applied at both levels.
 */
function upgradeWedgeDraw(
  wedge: UpgradeWedge,
  m: WheelProfile,
  selection: WedgeSelection = 'none',
): WedgeDraw {
  return {
    angle: wedge.angle,
    lines: upgradeWedgeLines(wedge, m, selection === 'selected'),
    cost: wedge.cost,
    ready: wedgeReady(wedge.state),
    costPaint: upgradeCostPaint(wedge),
    selection,
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
