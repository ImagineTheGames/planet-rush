/**
 * src/ui/minimap.ts — the minimap. OWNER: UI Engineer (GDD §2.2, field request
 * v0.2.2). The pure, PixiJS-free half: the two-state toggle, the corner/overlay
 * geometry, and the map → minimap-rect projection that turns live sim positions
 * into dots. The thin Pixi layer that paints it is {@link ./minimap-view}; the
 * `Hud` owns both and feeds this a {@link MinimapFrame} each frame.
 *
 * **What it shows (sim-driven — GDD §2.2 "a minimap (bottom right)").** Arena
 * bounds, planets as owner-coloured dots (a derelict wreck goes neutral steel —
 * it is no longer owned, GDD §2.7), ships as smaller dots (the local ship
 * highlighted, a spawn-protected ship dimmed — GDD §2.1), the collapse ring while
 * it is active (GDD §2.3), and faint ore-field hints. **Dots and colours only** —
 * no nameplates, no health numbers (those are scouted / over-ship, GDD §2.2). And
 * **no ping markers**: pings are cut from the game (p7-01/02), so nothing here
 * draws one.
 *
 * **Two states, one gesture (the developer's spec).**
 *   - COLLAPSED — a small corner square, bottom-right (GDD §2.2). On mobile it is
 *     *really* small: a glance object, sized to stay clear of the thumb zones and
 *     kept inside the `bottom-right` layout region.
 *   - EXPANDED — a centred overlay at readable scale; the match plays on behind
 *     it. A tap/click anywhere on the overlay (or its close affordance) collapses
 *     it again.
 * The toggle is the SAME interaction on both platforms — a click on PC, a tap on
 * mobile, both routed through {@link Minimap.tap} — plus an `M` keyboard shortcut
 * on PC ({@link MINIMAP_TOGGLE_KEY}). "Same code path, both platforms" is the
 * input-parity contract this element signs (docs/input-parity.md), and it is a
 * unit test (./minimap.test.ts), not a promise.
 *
 * **Projection.** The content arrives in **map (world) space** — unlike the rest
 * of the HUD, which is fed already-projected to screen — because the minimap does
 * its own fit: {@link fitBounds} letterboxes the arena into the active rect
 * (aspect preserved, centred), and {@link mapPoint} places each entity. So the
 * dots are correct at either scale from one transform, and the view never has to
 * know the camera.
 *
 * Pure and DOM-free: every decision here unit-tests headless; {@link ./minimap-view}
 * only draws what {@link minimapScene} returns and holds the state this exposes.
 */

import type { PlayerId } from '@shared/types';
import type { Rect } from '@platform/layout-registry';
import { PALETTE } from '@render/index';
import { playerColor } from './planet-hp';

// ---------------------------------------------------------------------------
// The keyboard shortcut (PC) — docs/input-parity.md
// ---------------------------------------------------------------------------

/**
 * The desktop keyboard shortcut that toggles the minimap (`KeyboardEvent.code`).
 * `M` for minimap — added to the input-parity table alongside `F` (fire mode) and
 * `C` (control scheme) as a PC convenience over the primary click/tap gesture.
 * `main.ts` wires it; the parity is asserted in ./minimap.test.ts.
 */
export const MINIMAP_TOGGLE_KEY = 'KeyM';

// ---------------------------------------------------------------------------
// Redraw cadence (GDD §4.3 — no per-frame rebuild of the map content)
// ---------------------------------------------------------------------------

/**
 * How many sim ticks between rebuilds of the (heavy) map content — planets,
 * enemy ships, ore hints, collapse ring — into the view's cached texture. The
 * field request calls for "low-frequency redraw … every N ticks to an offscreen
 * texture, never per-frame". ~6 ticks ≈ 10 Hz at 60 Hz, fast enough that a moving
 * dot never looks stale, cheap enough that a static scene rebuilds ten times a
 * second, not sixty. The **local ship's own dot** is exempt — the view redraws
 * that one dot every frame so it tracks the player's motion smoothly (it is a
 * single dot, so the cost the throttle exists to dodge does not apply). TUNABLE.
 */
export const MINIMAP_REDRAW_TICKS = 6;

// ---------------------------------------------------------------------------
// Geometry constants (screen space, CSS px)
// ---------------------------------------------------------------------------

/** Inset from the viewport edges the collapsed square hugs, CSS px. Doubles as
 *  the registered `bottom-right` anchor margin so drawing and registration can
 *  never drift ([[layout-registry]]). */
export const MINIMAP_MARGIN = 12;

/** Collapsed square side on desktop, CSS px — a readable-but-small glance object. */
export const MINIMAP_COLLAPSED_DESKTOP = 148;
/** Collapsed square side on touch, CSS px — *really* small (the developer's spec),
 *  so it stays out of the thumb zones the dynamic sticks land in (GDD §2.4). */
export const MINIMAP_COLLAPSED_TOUCH = 80;
/** Floor for the collapsed square once a tiny viewport clamps it — below this it
 *  stops being a glance object, so we never shrink past it (we accept a touch of
 *  the band instead). CSS px. */
export const MINIMAP_COLLAPSED_MIN = 44;

/** Clearance the collapsed square lifts above the desktop controls strip, CSS px,
 *  so the corner map never sits on the bindings legend. Touch has no strip, so it
 *  gets none. Roughly the strip band ({@link @platform/layout-registry}
 *  `DEFAULT_STRIP_HEIGHT}). */
export const MINIMAP_STRIP_CLEARANCE = 40;

/** Expanded overlay side as a fraction of the shorter viewport dimension —
 *  readable scale, centred (GDD §2.2). */
export const MINIMAP_EXPANDED_FRACTION = 0.7;
/** Floor for the expanded overlay side, CSS px (a tiny window still opens usable). */
export const MINIMAP_EXPANDED_MIN = 180;

/** Bottom band the expanded overlay keeps clear so it never blocks the critical
 *  controls (touch: the thumb sticks / FIRE button; desktop: the controls strip)
 *  — the field request rule 3. On touch it is a fraction of the height (the sticks
 *  live low on both halves); on desktop it clears the strip. */
export const MINIMAP_THUMB_RESERVE_FRACTION = 0.16;

// ---------------------------------------------------------------------------
// Dot sizing & colour (fractions of the active rect, so one set works at both
// scales — a collapsed dot is tiny, the same dot expanded is readable)
// ---------------------------------------------------------------------------

const PLANET_DOT_FRACTION = 0.04;
const PLANET_DOT_MIN = 2;
const SHIP_DOT_FRACTION = 0.026;
const SHIP_DOT_MIN = 1.5;
/** The local ship's dot is drawn larger than an enemy's so it reads as *mine* at
 *  a glance — the minimap counterpart of the own-ship health bar's larger size. */
const OWN_SHIP_DOT_MULTIPLIER = 1.55;
const ORE_DOT_FRACTION = 0.011;
const ORE_DOT_MIN = 0.5;

/** Full opacity of an owned planet / live ship dot. */
export const MINIMAP_DOT_ALPHA = 0.95;
/** A derelict planet's dot (a wreck — no longer owned, GDD §2.7): neutral and
 *  dimmer, so the map reads it as spent, not as somebody's home. */
export const MINIMAP_DERELICT_ALPHA = 0.55;
/** A spawn-protected ship (GDD §2.1) reads dimmed — it cannot be shot yet, so it
 *  is not a live threat/target on the glance map. */
export const MINIMAP_SPAWN_PROTECT_ALPHA = 0.4;
/** Faint ore-field hints — present enough to read where the field is, quiet
 *  enough never to compete with the planet/ship dots. Signal yellow is correct
 *  here: it is the RESERVED ore colour (style-guide §2), and this *is* ore. */
export const MINIMAP_ORE_ALPHA = 0.28;

// ---------------------------------------------------------------------------
// Model I/O
// ---------------------------------------------------------------------------

/** The two states of the minimap; the toggle flips between them. */
export type MinimapState = 'collapsed' | 'expanded';

/** A home planet as the minimap sees it (map/world space). */
export interface MinimapPlanet {
  readonly owner: PlayerId;
  /** Centre in map space. */
  readonly x: number;
  readonly y: number;
  /** False once the core is destroyed — a wreck, drawn neutral (GDD §2.7). */
  readonly alive: boolean;
}

/** A ship as the minimap sees it (map/world space). */
export interface MinimapShip {
  readonly owner: PlayerId;
  readonly x: number;
  readonly y: number;
  /** Dead-and-respawning ships drop off the map until they exist again. */
  readonly alive: boolean;
  /** The camera-followed local ship — drawn highlighted (larger + outlined). */
  readonly local: boolean;
  /** Spawn protection still up (GDD §2.1) — the dot dims (not yet a live target). */
  readonly spawnProtected: boolean;
}

/** A ring in map space (the collapse ring, GDD §2.3). */
export interface MinimapRing {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Everything the minimap draws for one frame, all in **map (world) space** — the
 *  view projects it into the active rect itself. Every field bar `bounds` is
 *  optional so an early (pre-planets) feed still renders an empty arena. */
export interface MinimapFrame {
  /** The arena play bounds (`world.bounds`) — the box the fit letterboxes into. */
  readonly bounds: { readonly width: number; readonly height: number };
  /** Home planets (GDD §2.1). */
  readonly planets?: readonly MinimapPlanet[];
  /** Ships (GDD §2.2). */
  readonly ships?: readonly MinimapShip[];
  /** The collapse ring, present only while collapse is active (GDD §2.3). */
  readonly collapse?: MinimapRing | null;
  /** Faint ore-field hints — asteroid centres, map space (GDD §2.3, §5.5). */
  readonly oreHints?: readonly { readonly x: number; readonly y: number }[];
}

/** Safe-area / thumb insets, CSS px. All optional, default 0 — so a desktop or an
 *  inset-less phone both pass `{}` and get sensible edges (mobile amendment §2). */
export interface MinimapInsets {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

/** One drawable dot (screen space, CSS px) the view paints as a filled circle. */
export interface MinimapDot {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: number;
  readonly alpha: number;
  /** True for the local ship's dot — the view outlines it so it reads as mine. */
  readonly own?: boolean;
}

/** A drawn ring (screen space). */
export interface MinimapRingDraw {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: number;
}

/** The whole projected scene the view draws, decided here so it unit-tests
 *  headless. Positions are screen space (CSS px), already fit into `rect`. */
export interface MinimapScene {
  /** The active rect this scene was fit into (the frame border / mask). */
  readonly rect: Rect;
  /** The map → rect transform, so the view can place the per-frame own-ship dot
   *  without recomputing the whole scene ({@link MINIMAP_REDRAW_TICKS}). */
  readonly transform: FitTransform;
  readonly planetDots: readonly MinimapDot[];
  /** Enemy / non-local ship dots (the local ship is {@link ownDot}, drawn every
   *  frame by the view rather than folded into the throttled content). */
  readonly shipDots: readonly MinimapDot[];
  readonly oreDots: readonly MinimapDot[];
  /** The local ship's dot, or null when it is dead / absent this frame. */
  readonly ownDot: MinimapDot | null;
  /** The collapse ring, or null while the field still has something in it. */
  readonly collapseRing: MinimapRingDraw | null;
}

// ---------------------------------------------------------------------------
// The fit: arena (map space) → minimap rect (screen space), aspect preserved
// ---------------------------------------------------------------------------

/** A uniform-scale, centred map → rect placement (letterbox). */
export interface FitTransform {
  /** map units → screen px. */
  readonly scale: number;
  /** screen x of map x=0. */
  readonly offsetX: number;
  /** screen y of map y=0. */
  readonly offsetY: number;
}

/**
 * Fit map `bounds` (a `width×height` box, origin top-left) into `rect`, preserving
 * aspect and centring — the same letterbox the map-picker previews use. A
 * degenerate box (0 or non-finite extent) yields a zero scale so the view simply
 * draws an empty frame rather than dividing by zero.
 */
export function fitBounds(bounds: { width: number; height: number }, rect: Rect): FitTransform {
  const bw = bounds.width;
  const bh = bounds.height;
  if (!(bw > 0) || !(bh > 0) || !(rect.width > 0) || !(rect.height > 0)) {
    return { scale: 0, offsetX: rect.x + rect.width / 2, offsetY: rect.y + rect.height / 2 };
  }
  const scale = Math.min(rect.width / bw, rect.height / bh);
  const offsetX = rect.x + (rect.width - bw * scale) / 2;
  const offsetY = rect.y + (rect.height - bh * scale) / 2;
  return { scale, offsetX, offsetY };
}

/** Project a map-space point through a {@link FitTransform} to screen space. */
export function mapPoint(t: FitTransform, x: number, y: number): { x: number; y: number } {
  return { x: t.offsetX + x * t.scale, y: t.offsetY + y * t.scale };
}

// ---------------------------------------------------------------------------
// The two rects
// ---------------------------------------------------------------------------

/** Read an inset field, defaulting missing/negative to 0. */
function inset(v: number | undefined): number {
  return v && v > 0 ? v : 0;
}

/**
 * The collapsed square, bottom-right (GDD §2.2). Sized by platform (really small
 * on touch), lifted above the desktop controls strip, and **clamped to fit inside
 * the `bottom-right` layout band** (x∈[W/2,W], y∈[2H/3,H]) so its registered
 * placement is honest on every profile — a small viewport shrinks the square
 * rather than letting it spill out of its region.
 */
export function collapsedRect(
  viewport: { width: number; height: number },
  isTouch: boolean,
  insets: MinimapInsets = {},
): Rect {
  const W = viewport.width;
  const H = viewport.height;
  const m = MINIMAP_MARGIN;
  const right = inset(insets.right);
  const bottom = inset(insets.bottom) + (isTouch ? 0 : MINIMAP_STRIP_CLEARANCE);

  const base = isTouch ? MINIMAP_COLLAPSED_TOUCH : MINIMAP_COLLAPSED_DESKTOP;
  // Fit inside the bottom-right band so `withinAnchor` holds: width budget is the
  // right half minus the edge margin/inset; height budget is the bottom third
  // minus the margin/inset (and the desktop strip clearance).
  const bandW = W / 2 - m - right;
  const bandH = H / 3 - m - bottom;
  let size = Math.min(base, bandW, bandH);
  if (size < MINIMAP_COLLAPSED_MIN) size = Math.max(0, Math.min(MINIMAP_COLLAPSED_MIN, bandW, bandH));

  const x = W - m - right - size;
  const y = H - m - bottom - size;
  return { x, y, width: size, height: size };
}

/**
 * The expanded overlay: a centred square at readable scale (GDD §2.2), sized to
 * the shorter viewport dimension, clamped to leave the top/side margins and a
 * bottom band clear so it never covers the critical controls (field request rule
 * 3). Centred horizontally; centred vertically within the space above the
 * reserved bottom band.
 */
export function expandedRect(
  viewport: { width: number; height: number },
  isTouch: boolean,
  insets: MinimapInsets = {},
): Rect {
  const W = viewport.width;
  const H = viewport.height;
  const m = MINIMAP_MARGIN;
  const top = m + inset(insets.top);
  const reserve = isTouch ? H * MINIMAP_THUMB_RESERVE_FRACTION : MINIMAP_STRIP_CLEARANCE;
  const bottomLimit = H - m - inset(insets.bottom) - reserve;
  const leftLimit = m + inset(insets.left);
  const rightLimit = W - m - inset(insets.right);

  const availW = rightLimit - leftLimit;
  const availH = bottomLimit - top;
  const wanted = Math.min(W, H) * MINIMAP_EXPANDED_FRACTION;
  let size = Math.min(wanted, availW, availH);
  if (size < MINIMAP_EXPANDED_MIN) size = Math.max(0, Math.min(MINIMAP_EXPANDED_MIN, availW, availH));

  const x = leftLimit + (availW - size) / 2;
  const y = top + (availH - size) / 2;
  return { x, y, width: size, height: size };
}

/** The active rect for a state — the one the view draws and the hit test uses. */
export function minimapRect(
  state: MinimapState,
  viewport: { width: number; height: number },
  isTouch: boolean,
  insets: MinimapInsets = {},
): Rect {
  return state === 'expanded'
    ? expandedRect(viewport, isTouch, insets)
    : collapsedRect(viewport, isTouch, insets);
}

/** True when a screen point sits inside a rect (inclusive) — the hit test core. */
export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

// ---------------------------------------------------------------------------
// The scene: project a frame into the active rect
// ---------------------------------------------------------------------------

function dotRadius(rectSize: number, fraction: number, min: number): number {
  return Math.max(min, rectSize * fraction);
}

/**
 * Project a {@link MinimapFrame} into `rect`: fit the arena, then place every
 * planet, ship, ore hint and the collapse ring as screen-space dots with the
 * right colour and dim/highlight rules. Pure — the whole "what the minimap shows"
 * decision, so it is asserted headless (./minimap.test.ts) and the view only paints.
 */
export function minimapScene(frame: MinimapFrame, rect: Rect, _isTouch = false): MinimapScene {
  const transform = fitBounds(frame.bounds, rect);
  const size = Math.min(rect.width, rect.height);
  const planetR = dotRadius(size, PLANET_DOT_FRACTION, PLANET_DOT_MIN);
  const shipR = dotRadius(size, SHIP_DOT_FRACTION, SHIP_DOT_MIN);
  const oreR = dotRadius(size, ORE_DOT_FRACTION, ORE_DOT_MIN);

  const planetDots: MinimapDot[] = [];
  for (const p of frame.planets ?? []) {
    const s = mapPoint(transform, p.x, p.y);
    planetDots.push({
      x: s.x,
      y: s.y,
      radius: planetR,
      // A wreck is no longer owned (GDD §2.7): neutral steel, dimmer.
      color: p.alive ? playerColor(p.owner) : PALETTE.hullSteel,
      alpha: p.alive ? MINIMAP_DOT_ALPHA : MINIMAP_DERELICT_ALPHA,
    });
  }

  const shipDots: MinimapDot[] = [];
  let ownDot: MinimapDot | null = null;
  for (const sh of frame.ships ?? []) {
    if (!sh.alive) continue; // dead-and-respawning → off the map
    const s = mapPoint(transform, sh.x, sh.y);
    const dot: MinimapDot = {
      x: s.x,
      y: s.y,
      radius: sh.local ? shipR * OWN_SHIP_DOT_MULTIPLIER : shipR,
      color: playerColor(sh.owner),
      alpha: sh.spawnProtected ? MINIMAP_SPAWN_PROTECT_ALPHA : MINIMAP_DOT_ALPHA,
      own: sh.local,
    };
    if (sh.local) ownDot = dot;
    else shipDots.push(dot);
  }

  const oreDots: MinimapDot[] = [];
  for (const o of frame.oreHints ?? []) {
    const s = mapPoint(transform, o.x, o.y);
    oreDots.push({ x: s.x, y: s.y, radius: oreR, color: PALETTE.signalYellow, alpha: MINIMAP_ORE_ALPHA });
  }

  let collapseRing: MinimapRingDraw | null = null;
  if (frame.collapse) {
    const c = mapPoint(transform, frame.collapse.x, frame.collapse.y);
    collapseRing = { x: c.x, y: c.y, radius: frame.collapse.radius * transform.scale, color: PALETTE.threatRed };
  }

  return { rect, transform, planetDots, shipDots, oreDots, ownDot, collapseRing };
}

// ---------------------------------------------------------------------------
// The toggle — the interaction, one code path for click and tap
// ---------------------------------------------------------------------------

/**
 * The minimap's toggle state and hit test. A stateful, DOM-free model (the same
 * shape as {@link ./onboarding} `Onboarding` and {@link ./alarm} `UnderAttackAlarm}):
 * the `Hud` holds one, routes a click/tap through {@link tap}, and reads
 * {@link state} to drive the view. Click (PC) and tap (mobile) call the SAME
 * {@link tap}, so the two platforms can never diverge — the input-parity contract
 * for this element (docs/input-parity.md), pinned by ./minimap.test.ts.
 */
export class Minimap {
  private _expanded = false;

  /** Whether the overlay is open. */
  get expanded(): boolean {
    return this._expanded;
  }

  /** The active state name — drives the view and the registered anchor. */
  get state(): MinimapState {
    return this._expanded ? 'expanded' : 'collapsed';
  }

  /** Flip collapsed ↔ expanded (the `M` key, and a click/tap that hit). */
  toggle(): void {
    this._expanded = !this._expanded;
  }

  /** Force expanded (idempotent). */
  expand(): void {
    this._expanded = true;
  }

  /** Force collapsed (idempotent) — e.g. a match ending or a scene reset. */
  collapse(): void {
    this._expanded = false;
  }

  /** Does a screen point hit the active minimap surface (the corner square when
   *  collapsed, the whole overlay when expanded)? */
  hitTest(
    x: number,
    y: number,
    viewport: { width: number; height: number },
    isTouch: boolean,
    insets: MinimapInsets = {},
  ): boolean {
    return pointInRect(x, y, minimapRect(this.state, viewport, isTouch, insets));
  }

  /**
   * Apply a click/tap at a screen point: if it lands on the active surface, toggle
   * and return `true` (the caller consumes the event so it never also flies the
   * ship or engages a stick under it); otherwise return `false` and leave the
   * event to fall through. The one entry point both PC clicks and mobile taps use.
   */
  tap(
    x: number,
    y: number,
    viewport: { width: number; height: number },
    isTouch: boolean,
    insets: MinimapInsets = {},
  ): boolean {
    if (!this.hitTest(x, y, viewport, isTouch, insets)) return false;
    this.toggle();
    return true;
  }
}
