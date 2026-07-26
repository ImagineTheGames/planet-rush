/**
 * src/platform/touch-visuals.ts — the visible touch controls. OWNER: Platform
 * Engineer.
 *
 * `touch.ts` is input-only: it turns thumbs into a device-neutral ControlState
 * and draws nothing. This module is the *view* — a pooled PixiJS layer that
 * makes the dynamic twin sticks and the fire-mode morph visible on touch
 * devices (GDD §2.4, mobile amendment §2; milestone-1 phone gap #1). It reads a
 * {@link TouchReadout} (which {@link ./touch.TouchController} satisfies) plus the
 * viewport size each frame and only touches child transforms/visibility — no
 * per-frame allocation, no geometry rebuild (GDD §4.3, render discipline).
 *
 * What it draws (style-guide §1 colours — plasma for energy/interactive, never
 * RESERVED signal-yellow or threat-red):
 *
 *  - **Left half — always thrust/steer.** A faint ghost ring shows the thumb
 *    zone while idle; the moment a thumb lands, a live base ring appears at the
 *    landing point (dynamic origin) with a knob that follows the thumb.
 *  - **Right half — morphs with fire mode:**
 *      · **Auto-aim** — a persistent hold-to-FIRE *button* (plasma ring, ≥72px
 *        so it reads as a thumb-scale button) with a pressed state.
 *      · **Manual** — a faint aim-zone hint while idle; a live aim base + knob
 *        under the thumb while engaged (aim and fire are one gesture).
 *
 * The layer hides itself entirely on non-touch devices — desktop draws nothing.
 *
 * Decision logic ({@link affordanceVisibility}) is pure and unit-tested; this
 * file is the thin Pixi view that renders it, mirroring the UI layer's split.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Vec2 } from '@shared/types';
import { PALETTE } from '@render/index';
import { FireMode } from './actions';
import type { Rect } from './layout-registry';

// ---------------------------------------------------------------------------
// Layout constants (CSS pixels; the Application handles devicePixelRatio)
// ---------------------------------------------------------------------------

/** Stick base ring radius — matches the input full-deflection radius so the knob
 *  reaches the ring's edge (touch.ts DEFAULT_CONFIG.maxRadius). */
const R_STICK = 64;
/** Knob radius. */
const R_KNOB = 26;
/** FIRE button radius. Diameter = 84px (≥72px thumb-scale requirement). */
const R_FIRE = 42;
/** BUILD button radius — the touch E-equivalent (GDD §2.4). Thumb-scale like
 *  FIRE, a little smaller because it is contextual rather than held. */
const R_BUILD = 38;
/** BOOST button radius. Diameter = 72px (the thumb-scale floor, parity req 3). The
 *  discoverable alternative to the left-stick double-tap-and-hold (docs/input-parity). */
const R_BOOST = 36;
/** PING button radius. Diameter = 72px, thumb-scale. */
const R_PING = 36;
/** Vertical gap between the left stick's zone and the BUILD button above it. */
const BUILD_GAP = 18;
/** Horizontal gap between the left stick zone and the BOOST button inboard of it. */
const BOOST_GAP = 22;
/** Vertical gap between the FIRE button and the PING button stacked above it. */
const PING_GAP = 16;
/** Margin from the screen edges to a control's centre. */
const EDGE_MARGIN = 28;

// ---------------------------------------------------------------------------
// The readout this layer consumes (TouchController satisfies it structurally)
// ---------------------------------------------------------------------------

/** One dynamic stick's live state — {@link ./touch.VirtualStick} satisfies it. */
export interface StickReadout {
  /** Whether a thumb is currently on this stick. */
  readonly engaged: boolean;
  /** Where the thumb landed (base centre). Meaningless while released. */
  readonly origin: Vec2;
  /** Where the thumb is now (knob, before clamping to the ring). */
  readonly current: Vec2;
}

/** The touch state this layer reads each frame — {@link ./touch.TouchController}
 *  satisfies it structurally, so no adapter is needed in `main.ts`. */
export interface TouchReadout {
  getFireMode(): FireMode;
  readonly left: StickReadout;
  readonly right: StickReadout;
  /** Whether the Auto-aim hold-to-FIRE button is pressed (always false in
   *  Manual — there the right side is the aim stick). */
  readonly rightButtonEngaged: boolean;
}

// ---------------------------------------------------------------------------
// Affordance visibility — the pure, testable matrix (GDD §2.4)
// ---------------------------------------------------------------------------

/**
 * Which *idle* affordances are shown, by device and fire mode. This is the
 * visibility matrix the milestone-1 gap asks for: desktop shows nothing;
 * touch+Auto-aim shows the FIRE button; touch+Manual shows the aim-zone hint.
 * Live (engaged) sticks are driven separately by the thumb state.
 */
export interface AffordanceVisibility {
  /** The left thrust stick's zone ghost (always shown on touch). */
  leftStickZone: boolean;
  /** The persistent Auto-aim hold-to-FIRE button. */
  fireButton: boolean;
  /** The Manual-mode faint aim-zone hint on the right half. */
  aimHint: boolean;
}

/** Fill `out` with the affordance visibility for `isTouch`/`mode` — no
 *  allocation (the per-frame path reuses one scratch object). */
export function writeAffordanceVisibility(
  isTouch: boolean,
  mode: FireMode,
  out: AffordanceVisibility,
): AffordanceVisibility {
  if (!isTouch) {
    out.leftStickZone = false;
    out.fireButton = false;
    out.aimHint = false;
    return out;
  }
  out.leftStickZone = true;
  out.fireButton = mode === FireMode.AutoAim;
  out.aimHint = mode === FireMode.Manual;
  return out;
}

/** Allocating convenience over {@link writeAffordanceVisibility} — for tests and
 *  one-off queries, not the hot path. */
export function affordanceVisibility(isTouch: boolean, mode: FireMode): AffordanceVisibility {
  return writeAffordanceVisibility(isTouch, mode, {
    leftStickZone: false,
    fireButton: false,
    aimHint: false,
  });
}

// ---------------------------------------------------------------------------
// Anchored affordance rects — for the layout registry (?debug=1)
// ---------------------------------------------------------------------------

/**
 * The screen rects of the touch controls' *anchored home positions* — the fixed
 * spots the idle stick-zone ghosts and the FIRE button occupy, computed from the
 * very constants that draw them ({@link R_STICK}, {@link R_FIRE},
 * {@link EDGE_MARGIN}), so the layout registry never has to duplicate this
 * geometry. Dynamic engaged sticks appear under the thumb (by design); these are
 * the fixed affordances a placement check can actually assert against.
 *
 * `null` for a control not present in the current device/mode (all null on
 * desktop; the aim zone is absent in Auto-aim; the FIRE button is absent in
 * Manual).
 */
export interface TouchAffordanceRects {
  /** Left thrust-stick zone ghost (always present on touch). */
  leftStickZone: Rect | null;
  /** Right-half aim-stick zone hint (Manual mode only). */
  aimZone: Rect | null;
  /** Hold-to-FIRE button (Auto-aim mode only). */
  fireButton: Rect | null;
}

/**
 * Fill `out` with the anchored rects of the visible touch affordances for the
 * given device/mode/viewport, mirroring {@link TouchVisuals.update}'s own
 * placement math exactly. Allocation-light: the three `Rect`s are reused across
 * frames (their fields are overwritten). Returns `out`.
 */
export function writeAffordanceRects(
  isTouch: boolean,
  mode: FireMode,
  w: number,
  h: number,
  out: TouchAffordanceRects,
): TouchAffordanceRects {
  if (!isTouch) {
    out.leftStickZone = null;
    out.aimZone = null;
    out.fireButton = null;
    return out;
  }

  const bottom = h - EDGE_MARGIN - R_STICK;
  const leftAnchorX = EDGE_MARGIN + R_STICK;
  const rightAnchorX = w - EDGE_MARGIN - R_STICK;

  out.leftStickZone = assign(out.leftStickZone, leftAnchorX - R_STICK, bottom - R_STICK, 2 * R_STICK, 2 * R_STICK);

  if (mode === FireMode.Manual) {
    out.aimZone = assign(out.aimZone, rightAnchorX - R_STICK, bottom - R_STICK, 2 * R_STICK, 2 * R_STICK);
    out.fireButton = null;
  } else {
    out.aimZone = null;
    const fx = w - EDGE_MARGIN - R_FIRE;
    const fy = h - EDGE_MARGIN - R_FIRE;
    out.fireButton = assign(out.fireButton, fx - R_FIRE, fy - R_FIRE, 2 * R_FIRE, 2 * R_FIRE);
  }
  return out;
}

/** Overwrite (or allocate) a Rect in place — keeps the per-frame path alloc-free. */
function assign(r: Rect | null, x: number, y: number, width: number, height: number): Rect {
  if (r) {
    r.x = x;
    r.y = y;
    r.width = width;
    r.height = height;
    return r;
  }
  return { x, y, width, height };
}

/**
 * The BUILD button's screen rect, or `null` when it is not on screen.
 *
 * GDD §2.4 gives touch "a dedicated BUILD button near the player's own planet
 * (the E-equivalent)", and §2.5 opens the wheel at your own planet and nowhere
 * else — so `docked` is the whole visibility rule, and it is the sim's own
 * `isDocked` answer rather than a distance this layer re-derives.
 *
 * Kept out of {@link TouchAffordanceRects} on purpose: that shape is the always-
 * present twin-stick affordances the layout registry asserts against, and the
 * BUILD button is contextual — a null-most-of-the-time entry there would read as
 * a missing control rather than an absent one.
 */
export function buildButtonRect(isTouch: boolean, docked: boolean, w: number, h: number): Rect | null {
  if (!isTouch || !docked) return null;
  const { x, y } = buildButtonCenter(w, h);
  return { x: x - R_BUILD, y: y - R_BUILD, width: 2 * R_BUILD, height: 2 * R_BUILD };
}

/** Where the BUILD button sits: directly above the left stick's zone, so it is
 *  reachable by the thumb that is already on that side of the screen. */
function buildButtonCenter(w: number, h: number): { x: number; y: number } {
  void w;
  const bottom = h - EDGE_MARGIN - R_STICK;
  return { x: EDGE_MARGIN + R_STICK, y: bottom - R_STICK - BUILD_GAP - R_BUILD };
}

/**
 * The BOOST button's screen rect (always present on touch, `null` on desktop). It
 * is the discoverable alternative to the left-stick double-tap-and-hold — a small
 * button inboard of the left stick, on the movement side, so the same thumb can
 * reach it (docs/input-parity.md, field report v0.2.2).
 */
export function boostButtonRect(isTouch: boolean, w: number, h: number): Rect | null {
  if (!isTouch) return null;
  const c = boostButtonCenter(w, h);
  return { x: c.x - R_BOOST, y: c.y - R_BOOST, width: 2 * R_BOOST, height: 2 * R_BOOST };
}

/** BOOST sits inboard of (to the right of) the left stick zone, sharing its
 *  bottom row so the movement thumb reaches it without travelling. */
function boostButtonCenter(w: number, h: number): { x: number; y: number } {
  void w;
  return { x: EDGE_MARGIN + 2 * R_STICK + BOOST_GAP + R_BOOST, y: h - EDGE_MARGIN - R_STICK };
}

/**
 * The PING button's screen rect (always present on touch, `null` on desktop). It
 * stacks just above the FIRE button on the right edge — in Auto-aim (the touch
 * default) the right side is a fixed FIRE button, not an aim surface, so a button
 * above it holes nothing; a tap pings your position, a drag pings a direction.
 */
export function pingButtonRect(isTouch: boolean, w: number, h: number): Rect | null {
  if (!isTouch) return null;
  const c = pingButtonCenter(w, h);
  return { x: c.x - R_PING, y: c.y - R_PING, width: 2 * R_PING, height: 2 * R_PING };
}

/**
 * PING's home. On a tall enough viewport it stacks just above the FIRE button on
 * the right edge. But on a SHORT landscape phone (e.g. the iPhone's 844×390
 * logical viewport) that stack — the FIRE diameter, a gap, and the PING diameter,
 * all above the bottom margin — is taller than the lower half of the screen, so
 * the stacked PING climbs out of the top of its `right-half-bottom` anchor
 * (y ≥ H/2) and breaks the layout contract. So the placement REFLOWS: when the
 * stacked PING's top would rise past the viewport midpoint (the anchor's top
 * edge), PING moves inboard of FIRE on the same bottom row instead — where it
 * still clears FIRE by a gap and stays inside the lower-right zone. The threshold
 * is computed from the very constants that size the cluster (R_FIRE, R_PING, the
 * gaps, the margin) against H/2, so it scales with any device rather than pinning
 * a magic height.
 */
function pingButtonCenter(w: number, h: number): { x: number; y: number } {
  // Stacked home: centred on the right edge, one PING_GAP above the FIRE button.
  const stackedY = h - EDGE_MARGIN - 2 * R_FIRE - PING_GAP - R_PING;
  // The stacked button's top must clear the bottom-half boundary (y = H/2), the
  // top edge of PING's `right-half-bottom` anchor. If it doesn't, reflow inboard.
  if (stackedY - R_PING >= h / 2) {
    return { x: w - EDGE_MARGIN - R_PING, y: stackedY };
  }
  // Short-viewport reflow: bottom aligned with FIRE's, one PING_GAP inboard (left)
  // of FIRE's outer edge — the FIRE button spans 2*R_FIRE in from the edge margin.
  return {
    x: w - EDGE_MARGIN - 2 * R_FIRE - PING_GAP - R_PING,
    y: h - EDGE_MARGIN - R_PING,
  };
}

/** Allocating convenience over {@link writeAffordanceRects} — tests/one-off use. */
export function affordanceRects(isTouch: boolean, mode: FireMode, w: number, h: number): TouchAffordanceRects {
  return writeAffordanceRects(isTouch, mode, w, h, { leftStickZone: null, aimZone: null, fireButton: null });
}

// ---------------------------------------------------------------------------
// Colours (style-guide §1 — plasma for interactive/energy affordances)
// ---------------------------------------------------------------------------

const GHOST_ALPHA = 0.18; // idle affordance — barely there
const BASE_ALPHA = 0.4; // live stick base ring
const KNOB_ALPHA = 0.5; // live knob fill
const FIRE_IDLE_FILL = 0.14; // FIRE button fill, released
const FIRE_PRESSED_FILL = 0.5; // FIRE button fill, pressed

/** Neutral chalk for the FIRE label (NOT signal yellow — RESERVED, §2). */
const FIRE_LABEL = 'Audiowide, "Trebuchet MS", sans-serif';

// ---------------------------------------------------------------------------
// The visuals layer
// ---------------------------------------------------------------------------

/**
 * The pooled touch-controls layer. Build once; call {@link update} each frame
 * with the live touch state and the viewport size. Every affordance's geometry
 * is drawn once at construction — the frame path only moves things and toggles
 * `visible`/`alpha`, so it makes zero per-frame allocations (GDD §4.3).
 */
export class TouchVisuals extends Container {
  // Left thrust stick.
  private readonly leftGhost = ring(R_STICK, GHOST_ALPHA);
  private readonly leftBase = ring(R_STICK, BASE_ALPHA);
  private readonly leftKnob = knob();

  // Right aim stick (Manual only).
  private readonly aimGhost = ring(R_STICK, GHOST_ALPHA);
  private readonly rightBase = ring(R_STICK, BASE_ALPHA);
  private readonly rightKnob = knob();

  // Right hold-to-FIRE button (Auto-aim only).
  private readonly fireGroup = new Container();
  private readonly fireFill = new Graphics();
  private readonly fireRing = new Graphics();

  // BUILD button — the touch E-equivalent, shown only at your own planet.
  private readonly buildGroup = new Container();

  // BOOST button — the discoverable alternative to the double-tap-and-hold, and
  // PING button — tap/drag to ping. Both always present on touch (parity gaps).
  private readonly boostGroup = new Container();
  private readonly boostFill = new Graphics();
  private readonly pingGroup = new Container();
  private readonly pingFill = new Graphics();

  /** Reused visibility scratch — the frame path allocates nothing. */
  private readonly vis: AffordanceVisibility = {
    leftStickZone: false,
    fireButton: false,
    aimHint: false,
  };

  constructor() {
    super();

    // Stable labels so callers/tests can find affordances without depending on
    // child order (Pixi getChildByLabel); harmless in production.
    this.label = 'touch-visuals';
    this.leftGhost.label = 'left-stick-zone';
    this.aimGhost.label = 'aim-hint';
    this.fireGroup.label = 'fire-button';

    // FIRE button: a plasma ring over a faint fill, with a centred label. The
    // label is anchor-centred (no width read — keeps the layer headless-safe).
    // Fill drawn at full opacity; the released/pressed brightness is the node
    // alpha (both < 1), so pressing is a transform-cheap alpha change.
    this.fireFill.circle(0, 0, R_FIRE).fill({ color: PALETTE.plasma, alpha: 1 });
    this.fireFill.alpha = FIRE_IDLE_FILL;
    this.fireRing.circle(0, 0, R_FIRE).stroke({ width: 4, color: PALETTE.plasma, alpha: 0.85 });
    const label = new Text({
      text: 'FIRE',
      style: { fontFamily: FIRE_LABEL, fontSize: 18, fill: PALETTE.plasma, fontWeight: 'bold', letterSpacing: 1 },
    });
    label.anchor.set(0.5);
    this.fireGroup.addChild(this.fireFill, this.fireRing, label);

    // BUILD button: same plasma vocabulary as FIRE, and named in full —
    // "BUILD & UPGRADE" is what the strip says on desktop (GDD §2.5: a player
    // who doesn't know upgrades exist will never look for them), so the button
    // carries the second word as a subtitle rather than dropping it.
    this.buildGroup.label = 'build-button';
    const buildFill = new Graphics();
    buildFill.circle(0, 0, R_BUILD).fill({ color: PALETTE.plasma, alpha: 0.16 });
    const buildRing = new Graphics();
    buildRing.circle(0, 0, R_BUILD).stroke({ width: 3, color: PALETTE.plasma, alpha: 0.85 });
    const buildLabel = new Text({
      text: 'BUILD',
      style: { fontFamily: FIRE_LABEL, fontSize: 15, fill: PALETTE.plasma, fontWeight: 'bold', letterSpacing: 1 },
    });
    buildLabel.anchor.set(0.5);
    buildLabel.y = -8;
    const buildSub = new Text({
      text: '& UPGRADE',
      style: { fontFamily: FIRE_LABEL, fontSize: 8, fill: PALETTE.plasma, letterSpacing: 0.5 },
    });
    buildSub.anchor.set(0.5);
    buildSub.y = 9;
    this.buildGroup.addChild(buildFill, buildRing, buildLabel, buildSub);
    this.buildGroup.visible = false;

    // BOOST + PING buttons: the same plasma vocabulary as FIRE/BUILD, each a fill
    // whose alpha carries the pressed state (a transform-cheap change, no rebuild).
    this.boostGroup.label = 'boost-button';
    buildAuxButton(this.boostGroup, this.boostFill, R_BOOST, 'BOOST', 14);
    this.pingGroup.label = 'ping-button';
    buildAuxButton(this.pingGroup, this.pingFill, R_PING, 'PING', 15);
    // Hidden until the first touch frame turns them on — so on desktop, where
    // `update()` returns before the touch path, they never read as visible even
    // though the whole layer is gated off (mirrors the BUILD group).
    this.boostGroup.visible = false;
    this.pingGroup.visible = false;

    // Back-to-front: ghosts, live bases, knobs, FIRE, BUILD, BOOST, PING.
    this.addChild(
      this.leftGhost,
      this.aimGhost,
      this.leftBase,
      this.rightBase,
      this.leftKnob,
      this.rightKnob,
      this.fireGroup,
      this.buildGroup,
      this.boostGroup,
      this.pingGroup,
    );
  }

  /**
   * Draw one frame. `touch` is the live controller (or any {@link TouchReadout});
   * `isTouch` gates the whole layer off on desktop; `w`/`h` anchor the idle
   * affordances and the FIRE button to the screen corners.
   */
  update(
    touch: TouchReadout,
    isTouch: boolean,
    w: number,
    h: number,
    docked = false,
    boostActive = false,
    pingPressed = false,
  ): void {
    const mode = touch.getFireMode();
    writeAffordanceVisibility(isTouch, mode, this.vis);

    // Whole layer off on desktop — nothing to draw, nothing to position.
    this.visible = isTouch;
    if (!isTouch) return;

    const bottom = h - EDGE_MARGIN - R_STICK;
    const leftAnchorX = EDGE_MARGIN + R_STICK;
    const rightAnchorX = w - EDGE_MARGIN - R_STICK;

    // --- Left thrust stick: ghost when idle, live base+knob when engaged. ----
    const le = touch.left.engaged;
    this.leftGhost.visible = this.vis.leftStickZone && !le;
    this.leftGhost.position.set(leftAnchorX, bottom);
    this.leftBase.visible = le;
    this.leftKnob.visible = le;
    if (le) {
      this.leftBase.position.set(touch.left.origin.x, touch.left.origin.y);
      placeKnob(this.leftKnob, touch.left.origin, touch.left.current);
    }

    // --- Right side: aim stick (Manual) or FIRE button (Auto-aim). -----------
    const manual = mode === FireMode.Manual;
    const re = touch.right.engaged;
    this.aimGhost.visible = this.vis.aimHint && !re;
    this.aimGhost.position.set(rightAnchorX, bottom);
    this.rightBase.visible = manual && re;
    this.rightKnob.visible = manual && re;
    if (manual && re) {
      this.rightBase.position.set(touch.right.origin.x, touch.right.origin.y);
      placeKnob(this.rightKnob, touch.right.origin, touch.right.current);
    }

    // --- FIRE button (Auto-aim): persistent, with a pressed state. -----------
    this.fireGroup.visible = this.vis.fireButton;
    this.fireGroup.position.set(w - EDGE_MARGIN - R_FIRE, h - EDGE_MARGIN - R_FIRE);
    const pressed = touch.rightButtonEngaged;
    // Pressed state via alpha + a small "give" — no geometry rebuild.
    this.fireFill.alpha = pressed ? FIRE_PRESSED_FILL : FIRE_IDLE_FILL;
    this.fireGroup.scale.set(pressed ? 0.94 : 1);

    // --- BUILD button: contextual, at your own planet and nowhere else. ------
    this.buildGroup.visible = docked;
    if (docked) {
      const c = buildButtonCenter(w, h);
      this.buildGroup.position.set(c.x, c.y);
    }

    // --- BOOST + PING buttons: always present on touch, pressed via fill alpha. -
    const bc = boostButtonCenter(w, h);
    this.boostGroup.visible = true;
    this.boostGroup.position.set(bc.x, bc.y);
    this.boostFill.alpha = boostActive ? FIRE_PRESSED_FILL : FIRE_IDLE_FILL;
    this.boostGroup.scale.set(boostActive ? 0.94 : 1);

    const pc = pingButtonCenter(w, h);
    this.pingGroup.visible = true;
    this.pingGroup.position.set(pc.x, pc.y);
    this.pingFill.alpha = pingPressed ? FIRE_PRESSED_FILL : FIRE_IDLE_FILL;
    this.pingGroup.scale.set(pingPressed ? 0.94 : 1);
  }
}

/**
 * Build one small plasma button (BOOST / PING) into `group`: a fill whose alpha
 * carries the pressed state over a plasma ring, with a centred label. Mirrors the
 * FIRE button's construction so the whole touch surface reads as one vocabulary.
 */
function buildAuxButton(group: Container, fill: Graphics, r: number, text: string, fontSize: number): void {
  fill.circle(0, 0, r).fill({ color: PALETTE.plasma, alpha: 1 });
  fill.alpha = FIRE_IDLE_FILL;
  const ringG = new Graphics();
  ringG.circle(0, 0, r).stroke({ width: 3, color: PALETTE.plasma, alpha: 0.85 });
  const label = new Text({
    text,
    style: { fontFamily: FIRE_LABEL, fontSize, fill: PALETTE.plasma, fontWeight: 'bold', letterSpacing: 1 },
  });
  label.anchor.set(0.5);
  group.addChild(fill, ringG, label);
}

// ---------------------------------------------------------------------------
// Shape factories (drawn once) + per-frame knob placement
// ---------------------------------------------------------------------------

/** A plasma ring (stroke only) at fixed radius `r`, drawn once. */
function ring(r: number, alpha: number): Graphics {
  return new Graphics().circle(0, 0, r).stroke({ width: 3, color: PALETTE.plasma, alpha });
}

/** A filled plasma knob, drawn once. */
function knob(): Graphics {
  const g = new Graphics();
  g.circle(0, 0, R_KNOB).fill({ color: PALETTE.plasma, alpha: KNOB_ALPHA });
  g.circle(0, 0, R_KNOB).stroke({ width: 2, color: PALETTE.plasma, alpha: 0.8 });
  return g;
}

/** Place a knob at `current` clamped to the stick's deflection radius around
 *  `origin`, so it never leaves the base ring. Allocation-free (locals only). */
function placeKnob(g: Graphics, origin: Vec2, current: Vec2): void {
  let dx = current.x - origin.x;
  let dy = current.y - origin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > R_STICK) {
    dx = (dx / dist) * R_STICK;
    dy = (dy / dist) * R_STICK;
  }
  g.position.set(origin.x + dx, origin.y + dy);
}
