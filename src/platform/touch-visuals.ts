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
 * ── THE THUMB CONTROLS DO NOT WEAR PLASMA (a0-23, ruled 2026-08-11) ──────────
 *
 * They did until a0-23, and the developer caught it from two phone captures of
 * the live build: *"look at blue buttons, not matching theme"*. The audit
 * (`docs/theme-coverage.md` §3) confirmed all four controls were the only
 * surfaces in the game with no relationship to Gantry/Bone at all — plasma
 * rings, plasma knobs, plasma labels, flat `letterSpacing`, and no import from
 * the direction in any form.
 *
 * The reason it matters is not tidiness. **Plasma carries meaning in a match** —
 * energy, shields, the mining torch, weapon fire — so a plasma FIRE button paints
 * the player's own controls in the same blue as the shield standing in front of
 * an enemy reactor. Taking the furniture off plasma therefore *frees* a hue
 * rather than spending one, which is the handoff's own stated reason for Bone
 * existing ("it spends no colour, which leaves the palette's hues free to mean
 * things during a match").
 *
 * What replaces it, from {@link ./touch-chrome}: a scrim where a plate would
 * have a face, a rim lit along its top and shadowed along its bottom where a
 * plate would have a bezel, and **brightness — not hue — as the thing that says
 * "press me"**.
 *
 * ONE PRIMARY, and how the rule survives on glass. Bone's constraint is that the
 * primary "must never share a screen with a second bright plate", and a match can
 * legitimately show FIRE and BUILD & UPGRADE at the same instant. It is NOT
 * resolved by dimming FIRE: FIRE is a held control that is always available, and
 * a dim always-available control is the gray-active button `src/ui/button-theme`
 * exists to forbid. It is resolved by the **halo**, which exactly one control
 * ever carries: BUILD & UPGRADE, and only while you are docked — the moment a
 * whole new verb opens up. Both rims are bright because both can be pressed; only
 * one of them has a pool of void around it saying *this one just arrived*.
 *
 * What it draws (style-guide §1/§2 — Bone brightness for the furniture; plasma
 * stays with energy, and never RESERVED signal-yellow or threat-red):
 *
 *  - **Left half — always thrust/steer.** A faint ghost ring shows the thumb
 *    zone while idle; the moment a thumb lands, a live base ring appears at the
 *    landing point (dynamic origin) with a knob that follows the thumb.
 *  - **Right half — morphs with fire mode:**
 *      · **Auto-aim** — a persistent hold-to-FIRE *button* (Bone rim over a
 *        scrim, ≥72px so it reads as a thumb-scale button) with a pressed state.
 *      · **Manual** — a faint aim-zone hint while idle; a live aim base + knob
 *        under the thumb while engaged (aim and fire are one gesture).
 *
 * The layer hides itself entirely on non-touch devices — desktop draws nothing.
 *
 * Decision logic ({@link affordanceVisibility}) is pure and unit-tested; this
 * file is the thin Pixi view that renders it, mirroring the UI layer's split.
 * What a control is *painted* in is {@link ./touch-chrome}'s call, not this
 * file's — see the ruling below.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Vec2 } from '@shared/types';
import { DISPLAY_TRACKING, TRACKING, trackingPx } from '../art/materials';
import { FireMode } from './actions';
import type { Rect } from './layout-registry';
import {
  TOUCH_ALPHA,
  TOUCH_CHROME,
  TOUCH_RIM,
  drawBoneRing,
  drawPressOverlay,
  drawVoidHalo,
} from './touch-chrome';

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
/** Vertical gap between the left stick's zone and the BUILD button above it. */
const BUILD_GAP = 18;
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
 * GDD §2.4 gives touch "a dedicated BUILD button near the player's own station
 * (the E-equivalent)", and §2.5 opens the wheel at your own station and nowhere
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

/** Allocating convenience over {@link writeAffordanceRects} — tests/one-off use. */
export function affordanceRects(isTouch: boolean, mode: FireMode, w: number, h: number): TouchAffordanceRects {
  return writeAffordanceRects(isTouch, mode, w, h, { leftStickZone: null, aimZone: null, fireButton: null });
}

// ---------------------------------------------------------------------------
// Type (style-guide §7 — the two ratified faces, on the ratified tracking)
// ---------------------------------------------------------------------------
//
// Every tone and every alpha is {@link ./touch-chrome}'s; what is left here is
// the type, because a Text style is the view's own furniture.
//
// The two stacks are spelled out rather than imported: `src/ui/typography.ts`
// owns them, and nothing in `src/platform/` imports `src/ui/` at runtime (the
// sim and the frame never depend on the widgets). `./touch-visuals.test.ts`
// imports typography and pins these equal to it, so the duplication cannot
// drift — which matters more than it sounds, because a fallback face was
// silently deciding what four goldens looked like until a1-01 caught it.

/** Audiowide — the wordmark/heading face. A control's own WORD: `FIRE`, `BUILD`. */
const FONT_DISPLAY = 'Audiowide, "Trebuchet MS", sans-serif';

/** Oxanium — body and numerals. The sub-line under a control's word. */
const FONT_TEXT = 'Oxanium, "Liberation Mono", monospace';

/**
 * Both pressed words keep the weight they shipped with.
 *
 * Audiowide has one upstream weight, so `bold` here is a *synthesised* stroke —
 * which is why the menus do not ask for it. This is not a menu: it is a word on
 * glass, over a firefight, under a thumb, and the heavier stroke is worth real
 * pixels there. Measured on the frozen phone golden, dropping it cost the word
 * `FIRE` 22% of its lit pixels (354 → 277 above mid-grey) for no gain — so the
 * one thing this brief must not do, make the primary action harder to hit, is
 * exactly what it would have done. `src/ui/hud.ts` makes the same call for the
 * respawn line, the other Audiowide string that lives on the glass.
 */
const PRESSED_WEIGHT = 'bold';

/** `FIRE`. 18px, unchanged — the button's diameter did not move, so neither did
 *  the word that has to fit inside it. */
const FIRE_SIZE = 18;
/** `BUILD`. */
const BUILD_SIZE = 15;
/**
 * `& UPGRADE`.
 *
 * Up from 8px, and it stops there rather than at `TYPE_MIN` (11) for a reason
 * worth stating: the chord of a 38px-radius circle at this baseline is ~68px,
 * and `R_BUILD` is a **layout contract** (`buildButtonRect`, which QA's
 * placement suite asserts against) rather than a drawing detail, so the button
 * cannot grow to fit a bigger word. Ten px of Oxanium at dpr 3 is 30 device
 * pixels of a face designed for game interfaces; the frames in
 * `evidence/a0-23-touch-controls-theme/` are what settle whether that reads, and they do.
 */
const BUILD_SUB_SIZE = 10;

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
  private readonly leftGhost = zoneRing();
  private readonly leftBase = liveRing();
  private readonly leftKnob = knob();

  // Right aim stick (Manual only).
  private readonly aimGhost = zoneRing();
  private readonly rightBase = liveRing();
  private readonly rightKnob = knob();

  // Right hold-to-FIRE button (Auto-aim only).
  private readonly fireGroup = new Container();
  private readonly fireBody = new Graphics();
  /** The pressed overlay: drawn once at full strength, shown by node alpha, so a
   *  press never rebuilds geometry (`./touch-chrome` drawPressOverlay). */
  private readonly firePress = new Graphics();

  // BUILD button — the touch E-equivalent, shown only at your own station.
  private readonly buildGroup = new Container();

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

    // FIRE button: a scrim with a Bone rim over it, and a centred label. The
    // label is anchor-centred (no width read — keeps the layer headless-safe).
    //
    // The scrim is the part that answers a0-20's fair objection — that Bone's
    // "the brightest thing is the actionable thing" is easier to state on a menu
    // of plates than on a translucent ring over a firefight. A ring alone
    // competes with whatever passes under it; the scrim gives the rim and the
    // word something to be bright *against*, which is the same job `SCRIM` does
    // for every corner readout in the HUD and the same reason the build wheel
    // can sit over a live match at all.
    drawBoneRing(this.fireBody, R_FIRE, {
      scrim: TOUCH_ALPHA.actionScrim,
      face: TOUCH_ALPHA.actionFace,
      rim: {
        width: TOUCH_RIM.fire,
        lit: TOUCH_CHROME.rimLit,
        shadow: TOUCH_CHROME.rimShadow,
        litAlpha: TOUCH_ALPHA.actionLit,
        shadowAlpha: TOUCH_ALPHA.actionShadow,
      },
    });
    drawPressOverlay(this.firePress, R_FIRE, TOUCH_RIM.fire);
    this.firePress.alpha = 0;
    const label = new Text({
      text: 'FIRE',
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: FIRE_SIZE,
        fill: TOUCH_CHROME.label,
        fontWeight: PRESSED_WEIGHT,
        letterSpacing: trackingPx(DISPLAY_TRACKING.heading, FIRE_SIZE),
      },
    });
    label.anchor.set(0.5);
    this.fireGroup.addChild(this.fireBody, this.firePress, label);

    // BUILD button: the same Bone vocabulary as FIRE, and named in full —
    // "BUILD & UPGRADE" is what the strip says on desktop (GDD §2.5: a player
    // who doesn't know upgrades exist will never look for them), so the button
    // carries the second word as a subtitle rather than dropping it.
    //
    // Drawn LIT, always — because it is only ever on screen while the ship is
    // docked (`buildButtonVisible`/`buildButtonHighlighted`, @ui/build-button),
    // and that is exactly the moment a field report asked it to announce itself:
    // "once you are in build distance it should highlight the build button (make
    // it stand out)" (2026-08-05). The lit chrome is a CHILD of the group whose
    // visibility is `docked`, so the two can never come apart — there is no
    // second signal to get out of step, which is the same discipline the
    // visibility rule itself is written under.
    //
    // It stood out from nothing before: fill 0.16 and a 3px ring is the FIRE
    // button's own weight, so the button that means "a whole new verb just
    // opened up" arrived looking like the one that has been there all match.
    //
    // a0-23 keeps that separation and changes what pays for it. The two plasma
    // haloes were the loud part: a *glow*, in the one hue the match needs for
    // energy, on a project that has twice been told its bloom had to go (a0-18,
    // a0-22). Bone's answer is the opposite operation — a pool of **void**
    // outside the rim (`drawVoidHalo`), which separates the primary from the
    // fight subtractively. The button gains contrast; the screen gains no light,
    // and no hue. It is also the one mark that is never on two controls at once,
    // which is how Bone's "never a second bright plate" survives a match where
    // FIRE and BUILD are both legitimately pressable (see the header).
    this.buildGroup.label = 'build-button';
    // Drawn OUTSIDE the rim, and deliberately not into the hit rect: the halo is
    // periphery-of-vision read, and `buildButtonRect` is a layout contract QA's
    // placement suite asserts against, so the tappable circle stays exactly where
    // it was at exactly the size it was.
    const buildHalo = new Graphics();
    drawVoidHalo(buildHalo, R_BUILD);
    const buildBody = new Graphics();
    drawBoneRing(buildBody, R_BUILD, {
      scrim: TOUCH_ALPHA.primaryScrim,
      face: TOUCH_ALPHA.primaryFace,
      rim: {
        width: TOUCH_RIM.build,
        lit: TOUCH_CHROME.rimLit,
        shadow: TOUCH_CHROME.rimShadow,
        litAlpha: TOUCH_ALPHA.primaryLit,
        shadowAlpha: TOUCH_ALPHA.primaryShadow,
      },
    });
    const buildLabel = new Text({
      text: 'BUILD',
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: BUILD_SIZE,
        fill: TOUCH_CHROME.label,
        fontWeight: PRESSED_WEIGHT,
        letterSpacing: trackingPx(DISPLAY_TRACKING.heading, BUILD_SIZE),
      },
    });
    buildLabel.anchor.set(0.5);
    buildLabel.y = -10;
    const buildSub = new Text({
      text: '& UPGRADE',
      style: {
        fontFamily: FONT_TEXT,
        fontSize: BUILD_SUB_SIZE,
        fill: TOUCH_CHROME.sub,
        fontWeight: '700',
        letterSpacing: trackingPx(TRACKING.label, BUILD_SUB_SIZE),
      },
    });
    buildSub.anchor.set(0.5);
    buildSub.y = 10;
    this.buildGroup.addChild(buildHalo, buildBody, buildLabel, buildSub);
    this.buildGroup.visible = false;

    // Back-to-front: ghosts, live bases, knobs, FIRE, BUILD.
    this.addChild(
      this.leftGhost,
      this.aimGhost,
      this.leftBase,
      this.rightBase,
      this.leftKnob,
      this.rightKnob,
      this.fireGroup,
      this.buildGroup,
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
    // Pressed state via alpha + a small "give" — no geometry rebuild. Bone's
    // answer to "this one, now" is luminance, so the press is a bright overlay
    // fading in over the button rather than a colour change: the same call
    // u11-01 made for a pressed wheel wedge, and the only shape a press can take
    // in a layer that draws its geometry exactly once (GDD §4.3).
    this.firePress.alpha = pressed ? TOUCH_ALPHA.press : 0;
    this.fireGroup.scale.set(pressed ? 0.94 : 1);

    // --- BUILD button: contextual, at your own station and nowhere else. ------
    // `docked` here is `buildButtonVisible` from the call site, which is also
    // `buildButtonHighlighted` (@ui/build-button) — the button appearing and the
    // button being lit are one event, because crossing STATION.dockRange is one
    // event. Its lit chrome is built into the group (constructor), so there is no
    // second flag here that could fall out of step with the wheel's availability.
    this.buildGroup.visible = docked;
    if (docked) {
      const c = buildButtonCenter(w, h);
      this.buildGroup.position.set(c.x, c.y);
    }
  }
}

// ---------------------------------------------------------------------------
// Shape factories (drawn once) + per-frame knob placement
// ---------------------------------------------------------------------------

/**
 * An idle stick-zone ghost: a Bone rim and nothing inside it, drawn once.
 *
 * No scrim and no face here, deliberately. A zone hint is a statement about
 * where your thumb may land, not a control sitting on the glass — the fight has
 * to read straight through it, which is the same reason the build wheel's disc
 * is translucent and the wedges carry no outline of their own.
 */
function zoneRing(): Graphics {
  const g = new Graphics();
  drawBoneRing(g, R_STICK, {
    rim: {
      width: TOUCH_RIM.stick,
      lit: TOUCH_CHROME.hintLit,
      shadow: TOUCH_CHROME.hintShadow,
      litAlpha: TOUCH_ALPHA.hintLit,
      shadowAlpha: TOUCH_ALPHA.hintShadow,
    },
  });
  return g;
}

/** A live stick base — the ring under a thumb that has landed. Brighter than the
 *  ghost it replaces, with the faintest Bone lift inside so the deflection zone
 *  reads as a dish rather than as a hoop. */
function liveRing(): Graphics {
  const g = new Graphics();
  drawBoneRing(g, R_STICK, {
    face: TOUCH_ALPHA.liveFace,
    rim: {
      width: TOUCH_RIM.stick,
      lit: TOUCH_CHROME.rimLit,
      shadow: TOUCH_CHROME.rimShadow,
      litAlpha: TOUCH_ALPHA.liveLit,
      shadowAlpha: TOUCH_ALPHA.liveShadow,
    },
  });
  return g;
}

/** The knob: the one part of a stick that is a solid object, so it is the one
 *  part that gets a scrim as well as a face. Drawn once. */
function knob(): Graphics {
  const g = new Graphics();
  drawBoneRing(g, R_KNOB, {
    scrim: TOUCH_ALPHA.knobScrim,
    face: TOUCH_ALPHA.knobFace,
    rim: {
      width: TOUCH_RIM.knob,
      lit: TOUCH_CHROME.rimLit,
      shadow: TOUCH_CHROME.rimShadow,
      litAlpha: TOUCH_ALPHA.knobLit,
      shadowAlpha: TOUCH_ALPHA.knobShadow,
    },
  });
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
