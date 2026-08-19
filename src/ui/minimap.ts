/**
 * src/ui/minimap.ts — the minimap. OWNER: UI Engineer (GDD §2.2, field request
 * v0.2.2). The pure, PixiJS-free half: the two-state toggle, the corner/overlay
 * geometry, and the map → minimap-rect projection that turns live sim positions
 * into dots. The thin Pixi layer that paints it is {@link ./minimap-view}; the
 * `Hud` owns both and feeds this a {@link MinimapFrame} each frame.
 *
 * **What it shows (sim-driven — GDD §2.2 "a minimap (bottom right)").** Arena
 * bounds, stations as owner-coloured squares (a derelict wreck goes neutral steel —
 * it is no longer owned, GDD §2.7), ships as smaller triangles pointed along their
 * heading (the local ship highlighted, a spawn-protected ship dimmed — GDD §2.1),
 * radar satellites as small diamonds (feature f1), the collapse ring while it is
 * active (GDD §2.3), and faint ore-field dots. **Marks and colours only** — no
 * nameplates, no health numbers (those are read off the station and the ship
 * themselves, GDD §2.2).
 *
 * **Shape is KIND, colour is OWNER (a0-88).** Two independent channels. Colour was
 * already carrying roster identity (style-guide §3), so when every body was a
 * filled circle the only thing left to separate a ship from a station was SIZE —
 * and at minimap scale on a phone that is no separation at all: *"the minimap shows
 * two circles. ships should be a different icon though to differentiate."* See
 * {@link MinimapShape} for the grammar and {@link markPolygon} for the geometry.
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
 *     it. While it is open it is **MODAL: a press anywhere collapses it, on the
 *     overlay or off it, and the press is consumed** rather than falling through
 *     to fly the ship (developer report u6-01). The asymmetry with COLLAPSED —
 *     where a press that misses the corner square still falls through, because the
 *     player is flying — is deliberate and is the point; see {@link Minimap.tap}.
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

// ---------------------------------------------------------------------------
// Shape carries KIND; colour carries OWNER (a0-88)
// ---------------------------------------------------------------------------
//
// The developer, on a phone: *"the minimap shows two circles. ships should be a
// different icon though to differentiate."* Every mark was the same primitive —
// a filled circle — so only SIZE and COLOUR separated a ship from a station, and
// colour is already spoken for: it is roster identity (style-guide §3), and a
// channel that carries two meanings carries neither. Shape is the second channel,
// and it was free.
//
//   SHIP      → a triangle, pointed along its heading. A ship is the one thing on
//               this map that is going somewhere, and a dot throws that away. The
//               triangle is the obvious mark precisely because it survives at a
//               few pixels AND shows facing; nothing else does both.
//   STATION   → a square. A fixed installation reads as a solid anchor — flat
//               sides and corners, the visual opposite of a thing in motion.
//   SATELLITE → a diamond. An installation too (so: angular, the station's
//               family), but a small orbiting one — the square turned on its
//               point, smaller, and still wearing its steel outline (feature f1).
//   ORE       → a plain dot. Neither a vessel nor an installation, and the mark
//               it already had; a rock has no facing and anchors nothing.
//
// Sizes are UNCHANGED — the fractions above still set the mark's radius, and each
// shape is drawn to roughly the AREA the circle of that radius had, so no mark got
// louder or quieter. Kind is legible from the outline alone; a colour-blind read
// and a greyscale read both survive, which is the whole point of a second channel.

/** The mark a minimap body is drawn as. Kind, and only kind — the colour beside it
 *  is the owner and never varies with this. */
export type MinimapShape = 'triangle' | 'square' | 'diamond' | 'circle';

/** How far a triangle's nose reaches, in dot radii. */
const TRIANGLE_NOSE = 1.95;
/** Half-angle from the heading to each rear corner, radians, and how far out they
 *  sit — a dart wide enough to read as a triangle at 4 px, not a needle. */
const TRIANGLE_REAR_ANGLE = 2.35;
const TRIANGLE_REAR = 1.3;
/** A square of half-side `k·r` has the area of a circle of radius `r` at
 *  `k = √π / 2`; the diamond's half-diagonal wants `√(π/2)`. Equal ink, so the
 *  new shape channel changes what a mark IS without changing how loud it is. */
const SQUARE_HALF_SIDE = Math.sqrt(Math.PI) / 2;
const DIAMOND_HALF_DIAGONAL = Math.sqrt(Math.PI / 2);

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
/** A REMEMBERED ore field — scouted once, not under coverage right now. Dimmer
 *  still than a live hint (the same "known, not sensed" step the station tri-state
 *  makes), so the map distinguishes "I can see this field" from "I found this
 *  field earlier" without either one shouting. */
export const MINIMAP_REMEMBERED_ORE_ALPHA = 0.14;

// ---------------------------------------------------------------------------
// Fog of war (RATIFIED feature f1 — the minimap renders ONLY the player's
// sensed-state, `../sim/sensing`). Three visual states, item 1 of the brief:
//   - FOGGED regions read dark (Cold Vacuum) — no coverage, so nothing shows;
//   - REMEMBERED static geography (a station or an ORE FIELD scouted at least
//     once) stays on the map but DIMMED, because neither a home nor a rock moves
//     (GDD §2.7) — a field you flew over is still there when you fly home;
//   - LIVE dots (ships, satellites) show ONLY under CURRENT coverage — the
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
  /**
   * Facing in radians (the sim's `Ship.angle`) — which way the ship's triangle
   * points (a0-88). Optional, defaulting to 0 (nose right), so a feed that has
   * never heard of headings still type-checks and still gets a *ship-shaped* mark;
   * the shape channel is what carries kind, and it does not depend on this.
   */
  readonly angle?: number;
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
  /** REMEMBERED asteroid ids — the ore half of the same memory (`../sim/sensing`
   *  `SensoryMemory.seenOre`): a field the viewer has scouted stays on the map
   *  after coverage moves off it, dimmed. A set, so the gate is O(1) per hint.
   *  Optional: a feed that carries none behaves exactly as before (ore shows only
   *  under current coverage), which is what every pre-existing fixture wants. */
  readonly rememberedOre?: ReadonlySet<number>;
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
  /** Faint ore-field hints — asteroid centres, map space (GDD §2.3, §5.5). `id` is
   *  the rock's `Asteroid.id`, which the fog's remembered-ore set is keyed by; a
   *  hint with no id is simply never remembered (older feeds and fixtures). */
  readonly oreHints?: readonly { readonly x: number; readonly y: number; readonly id?: number }[];
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

/**
 * One drawable mark (screen space, CSS px). `shape` is its KIND (a0-88) and
 * `color` is its OWNER — two independent channels, neither doing the other's job.
 * The name is historical: only an ore hint is still literally a dot.
 */
export interface MinimapDot {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: number;
  readonly alpha: number;
  /** True for the local ship's dot — the view outlines it so it reads as mine. */
  readonly own?: boolean;
  /**
   * The mark's kind (a0-88). A ship and a station never share one, and the
   * distinction does NOT live in {@link radius} — shrink every mark to the same
   * size and the map still says which is which.
   */
  readonly shape: MinimapShape;
  /** Rotation in radians, for the shapes that have one — a triangle's heading.
   *  Absent / 0 on a square, a diamond and a dot, which have no facing to tell. */
  readonly angle?: number;
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
  /** The projected coverage discs (screen space). Empty when {@link fogged} is
   *  false. These are the raw sensor sources — one per ship / station / satellite;
   *  what the view actually DRAWS is their union, {@link sensedRegion}. */
  readonly coverage: readonly MinimapCoverageDraw[];
  /**
   * The sensed region (a0-88): the union of {@link coverage}, as one
   * {@link MinimapRegion} per connected component — discs that touch merge into a
   * single silhouette, discs that do not stay separate lobes.
   *
   * This is what replaced N stacked circles. The developer could not read the old
   * picture — *"it shows a circle around my ship and a circle around the station
   * not sure what the station circle is"* — because a circle drawn around an
   * object reads as an attribute OF that object, and one of them had no
   * attribute anybody could name. The union has no such reading available: it is
   * one shape, it is not centred on anything, and it changes when you fly. It says
   * the only true thing here, which is *this is the edge of what you can see*.
   * Filling it once also kills the double-blended lens where two discs overlapped
   * — the very artefact that made "two circles" the obvious reading.
   *
   * Empty when {@link fogged} is false.
   */
  readonly sensedRegion: readonly MinimapRegion[];
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
// Mark geometry (a0-88) — the shape channel, as polygons the view just fills
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/**
 * The polygon for a mark, as a flat `[x0,y0,x1,y1,…]` screen-space point list —
 * or `null` for a `'circle'`, which the view draws with the circle primitive
 * (a tessellated 2 px dot is strictly worse than a real one).
 *
 * Pure, so *what a ship looks like* is asserted headless like every other minimap
 * decision — the view only fills what this returns. Each shape is sized to about
 * the AREA the old filled circle of the same `radius` had (see
 * {@link SQUARE_HALF_SIDE}), so the mark's weight on the map did not change when
 * its outline did.
 */
export function markPolygon(dot: MinimapDot): number[] | null {
  const { x, y, radius: r } = dot;
  switch (dot.shape) {
    case 'triangle': {
      // Nose along the heading, two rear corners swept back — a dart. It reads as
      // "pointing" down to ~4 px across, which is the collapsed phone map.
      const a = dot.angle ?? 0;
      const rl = a + TRIANGLE_REAR_ANGLE;
      const rr = a - TRIANGLE_REAR_ANGLE;
      return [
        x + Math.cos(a) * r * TRIANGLE_NOSE,
        y + Math.sin(a) * r * TRIANGLE_NOSE,
        x + Math.cos(rl) * r * TRIANGLE_REAR,
        y + Math.sin(rl) * r * TRIANGLE_REAR,
        x + Math.cos(rr) * r * TRIANGLE_REAR,
        y + Math.sin(rr) * r * TRIANGLE_REAR,
      ];
    }
    case 'square': {
      // Axis-aligned, deliberately: a station does not turn, and a square that
      // shares the frame's own horizon is the flattest, most planted thing the
      // map can draw.
      const h = r * SQUARE_HALF_SIDE;
      return [x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h];
    }
    case 'diamond': {
      const d = r * DIAMOND_HALF_DIAGONAL;
      return [x, y - d, x + d, y, x, y + d, x - d, y];
    }
    case 'circle':
      return null;
  }
}

// ---------------------------------------------------------------------------
// The sensed region (a0-88) — the union of the coverage discs, as an outline
// ---------------------------------------------------------------------------

/** Screen-px tolerance for "these two arc endpoints are the same intersection".
 *  Coincident endpoints agree to ~1e-12 px; distinct ones nearer than this are
 *  near-tangent circles, where stitching either way is sub-pixel identical. */
const STITCH_EPSILON = 1e-3;

/** Chord-length target when tessellating a boundary arc, screen px — and the
 *  clamps that keep a huge disc from exploding the vertex count and a tiny one
 *  from becoming a triangle. */
const ARC_CHORD = 1.5;
const ARC_STEP_MIN = TAU / 256;
const ARC_STEP_MAX = TAU / 16;

function arcStep(radius: number): number {
  return clampNum(ARC_CHORD / Math.max(radius, 0.001), ARC_STEP_MIN, ARC_STEP_MAX);
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** `x mod TAU`, always in `[0, TAU)`. */
function wrapAngle(a: number): number {
  const m = a % TAU;
  return m < 0 ? m + TAU : m;
}

/** One boundary arc of the union: the CCW sweep `from → to` on disc `c`. */
interface BoundaryArc {
  readonly c: MinimapCoverageDraw;
  readonly from: number;
  readonly to: number;
}

/**
 * One connected piece of the sensed region (a0-88) — a filled area and the
 * pockets punched out of it.
 *
 * `outline` is its boundary, closed, as a flat `[x0,y0,x1,y1,…]` point list.
 * `holes` are the pockets **inside** that boundary which no disc actually
 * reaches: three or more of your side's discs can ring an area without covering
 * it, and the union's boundary then has an inner loop as well as an outer one. A
 * pocket is not a detail — the wash means *sensed*, so painting one would be the
 * map asserting a thing it does not know (GDD §2.2 makes exactly this argument
 * about station health: a display whose unknown state is indistinguishable from
 * its known one asserts a false state rather than withholding a true one).
 */
export interface MinimapRegion {
  readonly outline: number[];
  readonly holes: number[][];
}

/**
 * The union of a set of discs, as {@link MinimapRegion}s — the geometry behind
 * {@link MinimapScene.sensedRegion}.
 *
 * Two halves: {@link unionLoops} walks the discs' boundaries and returns every
 * closed loop of the union; {@link groupLoops} decides which of those loops is an
 * outer boundary and which is a pocket inside one, by nesting depth.
 *
 * O(n²) in the disc count, which is a handful (your ship, your home, each
 * satellite, and in TEAMS your side's) — and it runs on the throttled rebuild, not
 * per frame.
 */
export function sensedRegions(discs: readonly MinimapCoverageDraw[]): MinimapRegion[] {
  return groupLoops(unionLoops(discs));
}

/**
 * The raw closed boundary loops of the union — outer boundaries and pocket
 * boundaries alike, in no particular order.
 *
 * Three steps, all exact until the last one tessellates:
 *  1. **Cull** every disc wholly inside another (largest first, so a container is
 *     always already kept; exact duplicates cull each other but the first).
 *  2. **Free arcs** — for each surviving disc, subtract the angular intervals its
 *     boundary spends inside another disc. What is left is on the union boundary.
 *     A disc that meets nothing keeps its whole circle and is emitted as its own
 *     loop.
 *  3. **Stitch** — walk arc end → the arc that starts there ({@link STITCH_EPSILON}),
 *     which is well-defined because every free arc ends at an intersection point
 *     where exactly one other free arc begins. CCW arcs traversed in order trace
 *     the boundary CCW, so a component closes on itself — and a pocket, walked the
 *     same way, closes the other way round, which is what {@link groupLoops} reads.
 */
function unionLoops(discs: readonly MinimapCoverageDraw[]): number[][] {
  const live = discs.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y) && d.radius > 0);
  if (live.length === 0) return [];

  // 1. Cull contained discs, largest radius first.
  const byRadius = live
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d.radius - a.d.radius || a.i - b.i);
  const kept: MinimapCoverageDraw[] = [];
  for (const { d } of byRadius) {
    let contained = false;
    for (const k of kept) {
      if (Math.hypot(k.x - d.x, k.y - d.y) + d.radius <= k.radius + 1e-9) {
        contained = true;
        break;
      }
    }
    if (!contained) kept.push(d);
  }

  // 2. Free arcs per disc.
  const arcs: BoundaryArc[] = [];
  const loops: number[][] = [];
  for (let i = 0; i < kept.length; i++) {
    const c = kept[i] as MinimapCoverageDraw;
    const covered: [number, number][] = [];
    for (let j = 0; j < kept.length; j++) {
      if (i === j) continue;
      const o = kept[j] as MinimapCoverageDraw;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d >= c.radius + o.radius || d <= 1e-9) continue; // disjoint or concentric
      const cosA = (d * d + c.radius * c.radius - o.radius * o.radius) / (2 * d * c.radius);
      if (cosA >= 1) continue; // touching at a point — nothing swallowed
      const half = Math.acos(clampNum(cosA, -1, 1));
      const mid = Math.atan2(dy, dx);
      covered.push([mid - half, mid + half]);
    }
    const free = freeArcs(covered);
    if (free === 'whole') {
      loops.push(tessellate(c, 0, TAU, true));
      continue;
    }
    for (const [from, to] of free) arcs.push({ c, from, to });
  }

  // 3. Stitch the arcs into closed loops.
  const used = new Array(arcs.length).fill(false);
  for (let s = 0; s < arcs.length; s++) {
    if (used[s]) continue;
    const loop: number[] = [];
    let cur = s;
    for (let guard = 0; cur >= 0 && guard <= arcs.length; guard++) {
      used[cur] = true;
      const a = arcs[cur] as BoundaryArc;
      const pts = tessellate(a.c, a.from, a.to, false);
      for (const v of pts) loop.push(v);
      const ex = a.c.x + a.c.radius * Math.cos(a.to);
      const ey = a.c.y + a.c.radius * Math.sin(a.to);
      let best = -1;
      let bestD = Infinity;
      for (let k = 0; k < arcs.length; k++) {
        if (used[k]) continue;
        const b = arcs[k] as BoundaryArc;
        const px = b.c.x + b.c.radius * Math.cos(b.from);
        const py = b.c.y + b.c.radius * Math.sin(b.from);
        const dd = (px - ex) * (px - ex) + (py - ey) * (py - ey);
        if (dd < bestD) {
          bestD = dd;
          best = k;
        }
      }
      cur = best >= 0 && bestD <= STITCH_EPSILON * STITCH_EPSILON ? best : -1;
    }
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}

/**
 * Subtract a set of covered angular intervals from the full circle. Returns
 * `'whole'` when nothing is covered (the disc contributes a complete circle), or
 * the free `[from, to]` sweeps with `to > from` — possibly wrapping past TAU, so a
 * free arc that straddles angle 0 stays ONE arc rather than two that would have to
 * be stitched back together through a seam that is not an intersection.
 */
function freeArcs(covered: readonly [number, number][]): 'whole' | [number, number][] {
  if (covered.length === 0) return 'whole';
  // Normalise into [0, TAU), splitting anything that wraps.
  const spans: [number, number][] = [];
  for (const [s, e] of covered) {
    const width = e - s;
    if (width >= TAU) return [];
    const from = wrapAngle(s);
    const to = from + width;
    if (to <= TAU) spans.push([from, to]);
    else {
      spans.push([from, TAU]);
      spans.push([0, to - TAU]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  // Merge.
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + 1e-12) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  // Complement.
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s - cursor > 1e-9) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (TAU - cursor > 1e-9) gaps.push([cursor, TAU]);
  if (gaps.length === 0) return [];
  // Join a gap ending at TAU with one starting at 0 — the seam at angle 0 is an
  // artefact of the normalisation, not a boundary.
  const firstGap = gaps[0] as [number, number];
  const lastGap = gaps[gaps.length - 1] as [number, number];
  if (gaps.length > 1 && firstGap[0] <= 1e-9 && lastGap[1] >= TAU - 1e-9) {
    lastGap[1] = TAU + firstGap[1];
    gaps.shift();
  } else if (gaps.length === 1 && firstGap[0] <= 1e-9 && firstGap[1] >= TAU - 1e-9) {
    return 'whole';
  }
  return gaps;
}

/**
 * Sort the union's loops into regions by NESTING, not by winding.
 *
 * A loop that sits inside an odd number of other loops is a pocket, and belongs
 * to the smallest loop containing it; a loop inside an even number (usually zero)
 * is a region of its own. Even-odd rather than the loops' orientation, because the
 * nesting can go deeper than two: park a radar satellite in the middle of a pocket
 * its own side's ships have ringed, and its disc is a genuine region sitting
 * inside a hole inside a region.
 *
 * Containment is decided by one point of the inner loop — sound here because the
 * loops of a union never cross, so if one point of a loop is inside another loop
 * the whole loop is.
 */
function groupLoops(loops: number[][]): MinimapRegion[] {
  if (loops.length === 0) return [];
  if (loops.length === 1) return [{ outline: loops[0] as number[], holes: [] }];

  const depth = loops.map(() => 0);
  const parent = loops.map(() => -1);
  for (let i = 0; i < loops.length; i++) {
    const inner = loops[i] as number[];
    let smallest = -1;
    let smallestArea = Infinity;
    for (let j = 0; j < loops.length; j++) {
      if (i === j) continue;
      const outer = loops[j] as number[];
      if (!pointInLoop(outer, inner[0] as number, inner[1] as number)) continue;
      depth[i] = (depth[i] as number) + 1;
      const a = Math.abs(loopArea(outer));
      if (a < smallestArea) {
        smallestArea = a;
        smallest = j;
      }
    }
    parent[i] = smallest;
  }

  const regionOf = new Map<number, MinimapRegion & { holes: number[][] }>();
  const out: MinimapRegion[] = [];
  for (let i = 0; i < loops.length; i++) {
    if ((depth[i] as number) % 2 !== 0) continue; // a pocket, placed below
    const region = { outline: loops[i] as number[], holes: [] as number[][] };
    regionOf.set(i, region);
    out.push(region);
  }
  for (let i = 0; i < loops.length; i++) {
    if ((depth[i] as number) % 2 === 0) continue;
    const host = regionOf.get(parent[i] as number);
    if (host) host.holes.push(loops[i] as number[]);
  }
  return out;
}

/** Twice the signed area of a closed flat point list (the shoelace sum, halved) —
 *  used only for its magnitude, to find the SMALLEST loop that contains another. */
function loopArea(loop: number[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i += 2) {
    const j = (i + 2) % loop.length;
    sum += (loop[i] as number) * (loop[j + 1] as number) - (loop[j] as number) * (loop[i + 1] as number);
  }
  return sum / 2;
}

/** Even-odd ray cast: is `(x, y)` inside the closed flat point list `loop`? */
function pointInLoop(loop: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 2; i < loop.length; j = i, i += 2) {
    const yi = loop[i + 1] as number;
    const yj = loop[j + 1] as number;
    if (yi > y !== yj > y) {
      const xi = loop[i] as number;
      const xj = loop[j] as number;
      if (x < xi + ((y - yi) / (yj - yi)) * (xj - xi)) inside = !inside;
    }
  }
  return inside;
}

/** Tessellate the CCW sweep `from → to` on `c` into flat `[x,y,…]`. Both endpoints
 *  are included (they are the intersection points the stitch matches on) unless
 *  `closed`, where the final duplicate of the first point is dropped. */
function tessellate(c: MinimapCoverageDraw, from: number, to: number, closed: boolean): number[] {
  const sweep = to - from;
  const steps = Math.max(1, Math.ceil(sweep / arcStep(c.radius)));
  const out: number[] = [];
  const last = closed ? steps - 1 : steps;
  for (let k = 0; k <= last; k++) {
    const a = from + (sweep * k) / steps;
    out.push(c.x + c.radius * Math.cos(a), c.y + c.radius * Math.sin(a));
  }
  return out;
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
 *   - an ORE hint takes the SAME tri-state (a rock is static geography too): full
 *     under coverage, {@link MINIMAP_REMEMBERED_ORE_ALPHA} once `fog.rememberedOre`
 *     holds its id, fogged if never scouted;
 *   - live ships / satellites draw ONLY under CURRENT coverage — so the tick
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
      // A fixed installation: the solid anchor (a0-88). A wreck keeps the square —
      // it is still an installation, just nobody's; what says "spent" is the
      // neutral steel and the dim, and that grammar did not move.
      shape: 'square',
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
      // A vessel, pointed where it is going (a0-88).
      shape: 'triangle',
      angle: sh.angle ?? 0,
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
      // An installation, but a small orbiting one: the station's square, turned on
      // its point and smaller (a0-88). It keeps its steel outline from feature f1.
      shape: 'diamond',
    });
  }

  const oreDots: MinimapDot[] = [];
  for (const o of frame.oreHints ?? []) {
    // Ore is STATIC geography, so it gets the station tri-state, not the live-dot
    // gate: full under current coverage, dimmed once scouted, fogged if never
    // seen. A rock mined out of existence is simply absent from the feed.
    let alpha = MINIMAP_ORE_ALPHA;
    if (fog) {
      const sensedNow = pointInCoverage(coverage, o.x, o.y, 0);
      if (!sensedNow) {
        const remembered = o.id !== undefined && (fog.rememberedOre?.has(o.id) ?? false);
        if (!remembered) continue; // fogged — never scouted
        alpha = MINIMAP_REMEMBERED_ORE_ALPHA; // remembered, dimmed
      }
    }
    const s = mapPoint(transform, o.x, o.y);
    // Ore is neither a vessel nor an installation and keeps the plain dot (a0-88).
    oreDots.push({ x: s.x, y: s.y, radius: oreR, color: PALETTE.signalYellow, alpha, shape: 'circle' });
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
    // The union, not N circles (a0-88) — see MinimapScene.sensedRegion.
    sensedRegion: sensedRegions(coverageDraw),
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
   * Apply a click/tap at a screen point. The one entry point both PC clicks and
   * mobile taps use — and it is **deliberately asymmetric between the two states**
   * (developer report u6-01, *"when you have radar opened clicking anywhere off
   * the map should close it"*). A future reader will want to "simplify" the two
   * branches back into one hit test; that is the bug, so here is why they differ:
   *
   * - **EXPANDED — the overlay is MODAL: every press is consumed.** A press on it
   *   collapses it (as before) and so does a press *outside* it, and either way
   *   this returns `true` so the caller consumes the event. That `true` is the
   *   whole fix: while the radar is open, a press off the map used to return
   *   `false`, fall through, and *fly the ship / engage a stick under the overlay*
   *   while the overlay stayed open — an input-capture defect, not a missing
   *   convenience. The player's instinctive "tap away to dismiss" is now the
   *   dismissal, and nothing else.
   * - **COLLAPSED — nothing is modal; a miss still falls through.** The corner
   *   square consumes only a press that actually lands on it (`false` otherwise),
   *   because the player is *flying*: a 148 px glance widget that ate every press
   *   on the screen would be a far worse bug than the one above.
   *
   * (Priority is `main.ts`'s, not ours: the minimap is checked LAST among the
   * interactive surfaces, so a control drawn over the overlay still wins its own
   * press. "Modal" here means modal against *gameplay*, which is what fell
   * through.)
   */
  tap(
    x: number,
    y: number,
    viewport: { width: number; height: number },
    isTouch: boolean,
    insets: MinimapInsets = {},
  ): boolean {
    if (this._expanded) {
      // Modal: dismiss on ANY press, hit or miss, and report it consumed.
      this._expanded = false;
      return true;
    }
    if (!this.hitTest(x, y, viewport, isTouch, insets)) return false;
    this._expanded = true;
    return true;
  }
}
