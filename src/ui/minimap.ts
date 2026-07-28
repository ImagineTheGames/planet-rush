/**
 * src/ui/minimap.ts — the minimap. OWNER: UI Engineer (GDD §2.2, field request
 * v0.2.2). The pure, PixiJS-free half: the two-state toggle, the corner/overlay
 * geometry, and the map → minimap-rect projection that turns live sim positions
 * into dots. The thin Pixi layer that paints it is {@link ./minimap-view}; the
 * `Hud` owns both and feeds this a {@link MinimapFrame} each frame.
 *
 * **What it shows (sim-driven — GDD §2.2 "a minimap (bottom right)").** Arena
 * bounds, stations as owner-coloured dots (a derelict wreck goes neutral steel —
 * it is no longer owned, GDD §2.7), ships as smaller dots (the local ship
 * highlighted, a spawn-protected ship dimmed — GDD §2.1), radar satellites as
 * small dots (feature f1), the collapse ring while it is active (GDD §2.3), and
 * faint ore-field hints. **Dots and colours only** — no nameplates, no health
 * numbers (those are scouted / over-ship, GDD §2.2).
 *
 * **Fog of war (RATIFIED feature f1).** The map renders ONLY the player's
 * sensed-state (`../sim/sensing`): fogged regions read dark, static geography a
 * player has scouted stays DIMMED (remembered), and LIVE dots show only under
 * CURRENT sensor coverage — so a killed radar satellite collapses its coverage
 * and everything only under it drops the same tick. The coverage discs are faintly
 * visible ("you see what your radar buys you"). The fog decision (the coverage
 * math + the tri-state) lives here and unit-tests headless; the dark/reveal look
 * is the view's ({@link ./minimap-view}). See {@link minimapScene} and
 * {@link MinimapFog}.
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
import { playerColor } from './station-hp';

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
 * How many sim ticks between rebuilds of the (heavy) map content — stations,
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

/**
 * Width the collapsed square keeps clear of the viewport's RIGHT edge on TOUCH,
 * CSS px — the FIRE column (field report v0.2.4: "clear of FIRE").
 *
 * The Auto-aim hold-to-FIRE button is a plasma ring in the extreme bottom-right
 * corner (`platform/touch-visuals.ts`, GDD §2.4) — the primary touch target, and
 * its placement lives in platform's lane. The bottom-right BAND is only the bottom
 * third of the viewport (~130 px on a landscape iPhone), and the 84 px fire button
 * fills most of it, so the map cannot stack *above* fire and still fit the band.
 * So the map wins the bottom-right band but sits immediately **left of the fire
 * column** — clear of FIRE, never on it. It mirrors touch-visuals' fire footprint
 * (`EDGE_MARGIN + 2·R_FIRE` = 28 + 84 = 112) plus a small gap, the same
 * mirror-a-platform-constant discipline {@link MINIMAP_STRIP_CLEARANCE} uses.
 *
 * (See the PR: the field report's preferred resolution is for the minimap to take
 * the extreme corner and FIRE to shift; shifting FIRE is a platform-lane change,
 * so this PR shifts the *minimap* left of the fire column instead — the honest
 * in-lane way to keep the map both bottom-right and clear of FIRE.)
 */
export const MINIMAP_FIRE_COLUMN = 120;

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

const STATION_DOT_FRACTION = 0.04;
const STATION_DOT_MIN = 2;
const SHIP_DOT_FRACTION = 0.026;
const SHIP_DOT_MIN = 1.5;
/** A radar satellite reads a touch smaller than a ship — a small orbiting body,
 *  not a combatant (feature f1). */
const SATELLITE_DOT_FRACTION = 0.02;
const SATELLITE_DOT_MIN = 1.25;
/** The local ship's dot is drawn larger than an enemy's so it reads as *mine* at
 *  a glance — the minimap counterpart of the own-ship health bar's larger size. */
const OWN_SHIP_DOT_MULTIPLIER = 1.55;
const ORE_DOT_FRACTION = 0.011;
const ORE_DOT_MIN = 0.5;

/** Full opacity of an owned station / live ship dot. */
export const MINIMAP_DOT_ALPHA = 0.95;
/** A derelict station's dot (a wreck — no longer owned, GDD §2.7): neutral and
 *  dimmer, so the map reads it as spent, not as somebody's home. */
export const MINIMAP_DERELICT_ALPHA = 0.55;
/** A spawn-protected ship (GDD §2.1) reads dimmed — it cannot be shot yet, so it
 *  is not a live threat/target on the glance map. */
export const MINIMAP_SPAWN_PROTECT_ALPHA = 0.4;
/** Faint ore-field hints — present enough to read where the field is, quiet
 *  enough never to compete with the station/ship dots. Signal yellow is correct
 *  here: it is the RESERVED ore colour (style-guide §2), and this *is* ore. */
export const MINIMAP_ORE_ALPHA = 0.28;

// ---------------------------------------------------------------------------
// Fog of war (RATIFIED feature f1 — the minimap renders ONLY the player's
// sensed-state, `../sim/sensing`). Three visual states, item 1 of the brief:
//   - FOGGED regions read dark (Cold Vacuum) — no coverage, so nothing shows;
//   - REMEMBERED static geography (a station scouted at least once) stays on the
//     map but DIMMED, because a home does not move (GDD §2.7);
//   - LIVE dots (ships, satellites, ore) show ONLY under CURRENT coverage — the
//     instant a satellite dies its disc is gone and everything only under it
//     drops the same tick (the "satellite-killed moment").
// The pure model here decides WHICH of the three a body is in (the coverage math
// + the tri-state), from the sim's own coverage discs; the view (./minimap-view)
// decides how the dark/reveal reads. Own stations and the collapse ring are the
// documented always-visible exceptions (see {@link minimapScene}).
// ---------------------------------------------------------------------------

/** A remembered-but-not-currently-covered station: dimmer than a live dot, so the
 *  map reads it as "known geography", not as something you sense right now. Below
 *  a derelict's dim so remembered wrecks recede further still. */
export const MINIMAP_REMEMBERED_ALPHA = 0.3;
/** How dark a FOGGED region reads — the near-opaque Cold-Vacuum veil the view lays
 *  over the whole map, punched back through by the coverage discs. */
export const MINIMAP_FOG_ALPHA = 0.9;
/** The faint reveal wash inside a coverage disc — sensed vacuum reads a touch
 *  lighter than the fog around it (you can see into what your radar covers). */
export const MINIMAP_COVERAGE_FILL_ALPHA = 0.16;
/** The coverage-disc edge ring — faintly visible, so "you see what your radar
 *  buys you" is legible on the map (feature f1, item 1). */
export const MINIMAP_COVERAGE_RING_ALPHA = 0.34;

// ---------------------------------------------------------------------------
// Model I/O
// ---------------------------------------------------------------------------

/** The two states of the minimap; the toggle flips between them. */
export type MinimapState = 'collapsed' | 'expanded';

/** A home station as the minimap sees it (map/world space). */
export interface MinimapStation {
  readonly owner: PlayerId;
  /** Centre in map space. */
  readonly x: number;
  readonly y: number;
  /** False once the core is destroyed — a wreck, drawn neutral (GDD §2.7). */
  readonly alive: boolean;
  /** The station's board id (`MiningStation.id`, 0..7) — indexes the fog
   *  remembered-mask ({@link MinimapFog}). Optional so a fog-less feed (no
   *  sensing) still type-checks; required only when fog is active. */
  readonly id?: number;
}

/** A radar satellite as the minimap sees it (map/world space, feature f1). It
 *  reads like a small ship dot — an enemy satellite appears when sensed, the
 *  viewer's own always shows (it is a high-value thing to spot / defend). */
export interface MinimapSatellite {
  readonly owner: PlayerId;
  readonly x: number;
  readonly y: number;
  /** hp > 0 — a dead satellite is gone from the map (and its coverage collapsed). */
  readonly alive: boolean;
  /** The viewer's own satellite — always shown (cockpit knowledge). */
  readonly local: boolean;
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

/** One sensor-coverage disc the viewer projects this tick (map space) — a ship's
 *  own sensor, a station's short local sensor, or a radar satellite's LARGE
 *  sensor. The union of these is the viewer's current sight (`../sim/sensing`
 *  `SensorSource`); the minimap reveals inside them and fogs everything else. */
export interface MinimapCoverage {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** The fog-of-war input for a frame (feature f1). Present ⇒ the minimap renders
 *  ONLY the sensed-state: dark outside `coverage`, dimmed for stations the mask
 *  remembers, live dots only inside coverage. ABSENT ⇒ no fog (the pre-sensing
 *  feed and every fixture render everything, unchanged). */
export interface MinimapFog {
  /** The viewer's current coverage discs (map space) — the union is their sight. */
  readonly coverage: readonly MinimapCoverage[];
  /** Bitmask of REMEMBERED station board-ids: bit `id` set ⇒ that station has been
   *  sensed at least once, so its static geography persists on the map even after
   *  coverage moves off it (`../sim/sensing` `SensoryMemory`). */
  readonly rememberedMask: number;
}

/** Everything the minimap draws for one frame, all in **map (world) space** — the
 *  view projects it into the active rect itself. Every field bar `bounds` is
 *  optional so an early (pre-stations) feed still renders an empty arena. */
export interface MinimapFrame {
  /** The arena play bounds (`world.bounds`) — the box the fit letterboxes into. */
  readonly bounds: { readonly width: number; readonly height: number };
  /** Home stations (GDD §2.1). */
  readonly stations?: readonly MinimapStation[];
  /** Ships (GDD §2.2). */
  readonly ships?: readonly MinimapShip[];
  /** Radar satellites (feature f1) — enemy ones show only when sensed, own always. */
  readonly satellites?: readonly MinimapSatellite[];
  /** The collapse ring, present only while collapse is active (GDD §2.3). */
  readonly collapse?: MinimapRing | null;
  /** Faint ore-field hints — asteroid centres, map space (GDD §2.3, §5.5). */
  readonly oreHints?: readonly { readonly x: number; readonly y: number }[];
  /** Fog-of-war coverage (feature f1). Present ⇒ the whole scene is fog-gated
   *  (dark outside coverage, remembered geography dimmed, live dots only under
   *  coverage). Absent / null ⇒ no fog, everything renders (backward compatible). */
  readonly fog?: MinimapFog | null;
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

/** A projected coverage disc (screen space) — the view reveals inside it (a faint
 *  wash) and strokes its edge (the radar-reach ring). */
export interface MinimapCoverageDraw {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** The whole projected scene the view draws, decided here so it unit-tests
 *  headless. Positions are screen space (CSS px), already fit into `rect`. */
export interface MinimapScene {
  /** The active rect this scene was fit into (the frame border / mask). */
  readonly rect: Rect;
  /** The map → rect transform, so the view can place the per-frame own-ship dot
   *  without recomputing the whole scene ({@link MINIMAP_REDRAW_TICKS}). */
  readonly transform: FitTransform;
  readonly stationDots: readonly MinimapDot[];
  /** Enemy / non-local ship dots (the local ship is {@link ownDot}, drawn every
   *  frame by the view rather than folded into the throttled content). */
  readonly shipDots: readonly MinimapDot[];
  /** Radar-satellite dots (feature f1) — sensed enemies + the viewer's own. */
  readonly satelliteDots: readonly MinimapDot[];
  readonly oreDots: readonly MinimapDot[];
  /** The local ship's dot, or null when it is dead / absent this frame. */
  readonly ownDot: MinimapDot | null;
  /** The collapse ring, or null while the field still has something in it. */
  readonly collapseRing: MinimapRingDraw | null;
  /** Whether fog is active this frame — the view lays the Cold-Vacuum veil only
   *  when true (feature f1). False for a fog-less feed / every fixture. */
  readonly fogged: boolean;
  /** The projected coverage discs (screen space) the view reveals + rings. Empty
   *  when {@link fogged} is false. */
  readonly coverage: readonly MinimapCoverageDraw[];
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
 * The collapsed square, **hugging the bottom-right corner** (GDD §2.2; field
 * report v0.2.4 "Minimap should be bottom right"). Sized by platform (really small
 * on touch), and **clamped to fit inside the `bottom-right` layout band**
 * (x∈[W/2,W], y∈[2H/3,H]) so its registered placement is honest on every profile —
 * a small viewport shrinks the square rather than letting it spill out of region.
 *
 * The map now takes the corner rather than floating left of it (the old
 * action-corner reserve, PR #147). The one thing it stays clear of is the touch
 * FIRE button:
 *  - **Desktop** — no fire button, so the square hugs the true corner, lifted only
 *    above the real controls strip ({@link MINIMAP_STRIP_CLEARANCE}).
 *  - **Touch** — the hold-to-FIRE button owns the extreme corner (GDD §2.4), so the
 *    square hugs the bottom-right band but sits **left of the fire column**
 *    ({@link MINIMAP_FIRE_COLUMN}) — clear of FIRE, never on it. (The band is too
 *    short to stack it above fire; see the PR for the FIRE-shift follow-up the
 *    field report anticipates.)
 *
 * Its tap surface is the lowest-priority interactive layer (main.ts), so a
 * wheel/button under it still wins the press.
 */
export function collapsedRect(
  viewport: { width: number; height: number },
  isTouch: boolean,
  insets: MinimapInsets = {},
): Rect {
  const W = viewport.width;
  const H = viewport.height;
  const m = MINIMAP_MARGIN;
  // Right edge: hug the right margin, holding clear of the FIRE column on touch
  // (nothing is there on desktop, so the map takes the true corner).
  const rightEdge = W - m - inset(insets.right) - (isTouch ? MINIMAP_FIRE_COLUMN : 0);
  // Bottom edge: lift above the controls strip on desktop; hug the bottom margin
  // on touch (the map sits in the right column, clear of the strip probe's band).
  const bottomEdge = H - m - inset(insets.bottom) - (isTouch ? 0 : MINIMAP_STRIP_CLEARANCE);

  const base = isTouch ? MINIMAP_COLLAPSED_TOUCH : MINIMAP_COLLAPSED_DESKTOP;
  // Fit inside the bottom-right band so `withinAnchor` holds: the budget is the
  // room left in the band once the reserves are taken (right half from W/2, bottom
  // third from 2H/3), so a small viewport shrinks the square rather than spilling.
  const bandW = rightEdge - W / 2;
  const bandH = bottomEdge - (2 * H) / 3;
  let size = Math.min(base, bandW, bandH);
  if (size < MINIMAP_COLLAPSED_MIN) size = Math.max(0, Math.min(MINIMAP_COLLAPSED_MIN, bandW, bandH));

  const x = rightEdge - size;
  const y = bottomEdge - size;
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
 * Whether a map-space point lies inside ANY current coverage disc — the union
 * sight test, squared throughout (no sqrt), mirroring the sim seam's
 * `pointSensed` (`../sim/sensing`). A body's `bodyRadius` lets its SURFACE count
 * as sensed (a home is large). Empty coverage ⇒ nothing is sensed (full fog).
 */
function pointInCoverage(
  coverage: readonly MinimapCoverage[],
  x: number,
  y: number,
  bodyRadius = 0,
): boolean {
  for (const c of coverage) {
    const dx = c.x - x;
    const dy = c.y - y;
    const reach = c.radius + bodyRadius;
    if (dx * dx + dy * dy <= reach * reach) return true;
  }
  return false;
}

/**
 * Project a {@link MinimapFrame} into `rect`: fit the arena, then place every
 * station, ship, satellite, ore hint and the collapse ring as screen-space dots
 * with the right colour and dim/highlight rules. Pure — the whole "what the
 * minimap shows" decision, so it is asserted headless (./minimap.test.ts) and the
 * view only paints.
 *
 * **Fog of war (feature f1).** When `frame.fog` is present the minimap renders
 * ONLY the sensed-state:
 *   - a station NEVER sensed (not in the remembered mask, not under coverage now)
 *     is FOGGED — it does not draw at all;
 *   - a station REMEMBERED but not currently covered draws DIMMED
 *     ({@link MINIMAP_REMEMBERED_ALPHA}) — known geography that persists;
 *   - a station currently under coverage draws at full (a wreck still derelict-dim);
 *   - live ships / satellites / ore draw ONLY under CURRENT coverage — so the tick
 *     a radar satellite dies its disc vanishes and anything only under it drops.
 * **Always-visible exceptions** (documented, brief item 3): the viewer's OWN ship
 * is always its {@link ownDot} (cockpit knowledge), the viewer's OWN stations sit
 * inside their own sensor disc so they are always covered, and the collapse ring
 * is drawn regardless of coverage (match-critical, broadcast in-fiction). When
 * `frame.fog` is ABSENT nothing is gated — the pre-sensing feed and every fixture
 * render the whole scene, unchanged.
 */
export function minimapScene(frame: MinimapFrame, rect: Rect, _isTouch = false): MinimapScene {
  const transform = fitBounds(frame.bounds, rect);
  const size = Math.min(rect.width, rect.height);
  const stationR = dotRadius(size, STATION_DOT_FRACTION, STATION_DOT_MIN);
  const shipR = dotRadius(size, SHIP_DOT_FRACTION, SHIP_DOT_MIN);
  const satR = dotRadius(size, SATELLITE_DOT_FRACTION, SATELLITE_DOT_MIN);
  const oreR = dotRadius(size, ORE_DOT_FRACTION, ORE_DOT_MIN);

  const fog = frame.fog ?? null;
  const coverage = fog?.coverage ?? [];

  const stationDots: MinimapDot[] = [];
  for (const p of frame.stations ?? []) {
    const s = mapPoint(transform, p.x, p.y);
    // Fog tri-state. Without fog every station draws (unchanged). With fog: a
    // station currently under coverage draws full; one only in the remembered
    // mask draws dimmed; one neither remembered nor covered is fogged out.
    let alpha = p.alive ? MINIMAP_DOT_ALPHA : MINIMAP_DERELICT_ALPHA;
    if (fog) {
      const rememberedBit = p.id !== undefined && (fog.rememberedMask & (1 << p.id)) !== 0;
      const sensedNow = pointInCoverage(coverage, p.x, p.y, 0);
      if (!rememberedBit && !sensedNow) continue; // fogged — never seen
      if (!sensedNow) alpha = MINIMAP_REMEMBERED_ALPHA; // remembered, dimmed
    }
    stationDots.push({
      x: s.x,
      y: s.y,
      radius: stationR,
      // A wreck is no longer owned (GDD §2.7): neutral steel, dimmer.
      color: p.alive ? playerColor(p.owner) : PALETTE.hullSteel,
      alpha,
    });
  }

  const shipDots: MinimapDot[] = [];
  let ownDot: MinimapDot | null = null;
  for (const sh of frame.ships ?? []) {
    if (!sh.alive) continue; // dead-and-respawning → off the map
    // Live entities show only under CURRENT coverage; the viewer's own ship is
    // always its own dot (cockpit knowledge, an always-visible exception).
    if (fog && !sh.local && !pointInCoverage(coverage, sh.x, sh.y, 0)) continue;
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

  const satelliteDots: MinimapDot[] = [];
  for (const sat of frame.satellites ?? []) {
    if (!sat.alive) continue; // a dead satellite is gone (its coverage collapsed)
    if (fog && !sat.local && !pointInCoverage(coverage, sat.x, sat.y, 0)) continue;
    const s = mapPoint(transform, sat.x, sat.y);
    satelliteDots.push({
      x: s.x,
      y: s.y,
      radius: satR,
      color: playerColor(sat.owner),
      alpha: MINIMAP_DOT_ALPHA,
      own: sat.local,
    });
  }

  const oreDots: MinimapDot[] = [];
  for (const o of frame.oreHints ?? []) {
    if (fog && !pointInCoverage(coverage, o.x, o.y, 0)) continue; // ore only where you sense
    const s = mapPoint(transform, o.x, o.y);
    oreDots.push({ x: s.x, y: s.y, radius: oreR, color: PALETTE.signalYellow, alpha: MINIMAP_ORE_ALPHA });
  }

  // Coverage discs → screen space, for the view to reveal + ring ("you see what
  // your radar buys you"). Only when fog is active.
  const coverageDraw: MinimapCoverageDraw[] = [];
  for (const c of coverage) {
    const s = mapPoint(transform, c.x, c.y);
    coverageDraw.push({ x: s.x, y: s.y, radius: c.radius * transform.scale });
  }

  let collapseRing: MinimapRingDraw | null = null;
  if (frame.collapse) {
    const c = mapPoint(transform, frame.collapse.x, frame.collapse.y);
    collapseRing = { x: c.x, y: c.y, radius: frame.collapse.radius * transform.scale, color: PALETTE.threatRed };
  }

  return {
    rect,
    transform,
    stationDots,
    shipDots,
    satelliteDots,
    oreDots,
    ownDot,
    collapseRing,
    fogged: !!fog,
    coverage: coverageDraw,
  };
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
