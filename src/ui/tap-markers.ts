/**
 * src/ui/tap-markers.ts — the Tap Commander order markers (lock-on reticle,
 * waypoint marker, line-of-intent). OWNER: UI Engineer (developer §4, GDD §2.4).
 *
 * Tap Commander (the ratified optional scheme, `src/platform/tap-pilot.ts`) turns
 * a tap into a standing *order*: fly to a point, or lock and attack a target. This
 * module is the DRAWN half of that order — the visual tell the developer asked for
 * (p6-01 §4):
 *
 *  - **The lock reticle** — a bracket that rides the locked target in the player's
 *    identity colour, so at a glance the player knows *what* the ship is fighting.
 *    A line of intent from the ship to the target draws *while firing*, so a held
 *    lock reads as an active engagement, not a passive selection.
 *  - **The waypoint marker** — a small pulse where the player tapped empty space,
 *    fading on arrival (the pilot clears the order when the ship reaches it).
 *
 * **This is the pure, PixiJS-free decision half**, the same split the health bars
 * and nameplates use ([[healthbar]] / healthbar-view, [[nameplates]] /
 * nameplates-view): it decides *which* markers exist this frame and *what colour*
 * they are, from the pilot's standing order already re-resolved and projected to
 * SCREEN space by the wiring. The view ({@link ./tap-markers-view}) owns the
 * animation (spin, pulse, arrival fade) and the drawing; the layout contract for
 * these world-tracking markers is registered by the Platform lane in `main.ts`
 * (`tap-lock-reticle` / `tap-waypoint-marker`), which this draws to agree with.
 *
 * Positions arrive in screen space, CSS px — the wiring projects world → screen via
 * the renderer's camera before handing them over, exactly like the bars and labels,
 * so the markers are a fixed screen size regardless of camera zoom.
 *
 * Colour is the **player's identity colour** (style-guide §3 — one of the few
 * places player colour is allowed, alongside HP bars and nameplates), read through
 * the SAME {@link playerColor} roster the bars and labels use, so a ship's trim,
 * its bar, its name and its order markers can never disagree. Never signal yellow
 * or threat red — those are RESERVED (style-guide §2).
 */

import type { PlayerId } from '@shared/types';
import { playerColor } from './planet-hp';

// ---------------------------------------------------------------------------
// Model I/O
// ---------------------------------------------------------------------------

/** A point in screen space, CSS px (the wiring already projected world → screen). */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The pilot's standing order for one frame, as the marker model sees it — already
 * re-resolved to live positions and projected to screen by the wiring (`main.ts`
 * `feedTapMarkers`). Absent members mean "no such order this frame": no waypoint,
 * nothing locked. Off (`sticks`) scheme feeds all-empty, so nothing draws.
 */
export interface TapMarkerInput {
  /** The local player's slot — selects the identity colour every marker wears. */
  readonly owner: PlayerId;
  /** Where the ship is heading (a move order), screen space, or null for none. */
  readonly waypoint: ScreenPoint | null;
  /** The locked target's screen centre + screen radius, or null when nothing is
   *  locked. The reticle rides this, so it tracks a moving ship / shrinking rock. */
  readonly lock: { readonly x: number; readonly y: number; readonly radius: number } | null;
  /** The pilot is loosing its weapon on the lock this tick → the line of intent
   *  draws. False on a friendly fly-to or a lock still being closed on. */
  readonly firing: boolean;
  /** The local ship's screen position — the line of intent's origin. The follow
   *  camera holds the ship at the viewport centre, so the caller passes that. */
  readonly shipX: number;
  readonly shipY: number;
}

/** The lock-on reticle to draw: a bracket riding the target in the owner colour. */
export interface ReticleMark {
  /** Target centre, screen px — the reticle is centred here and rides it. */
  readonly x: number;
  readonly y: number;
  /** Target screen radius — the view floats the bracket just outside this. */
  readonly radius: number;
  /** The owner's identity colour (style-guide §3). */
  readonly color: number;
}

/** The waypoint pulse to draw where the player tapped empty space. */
export interface WaypointMark {
  readonly x: number;
  readonly y: number;
  readonly color: number;
}

/** The line of intent from ship to locked target, drawn only while firing (§4). */
export interface IntentMark {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly color: number;
}

/** Everything the view needs for one frame — each member null when that marker
 *  is not present, so the view has no decisions left to make, only drawing. */
export interface TapMarkers {
  readonly reticle: ReticleMark | null;
  readonly waypoint: WaypointMark | null;
  readonly intent: IntentMark | null;
}

// ---------------------------------------------------------------------------
// The decision (pure)
// ---------------------------------------------------------------------------

/**
 * Decide the order markers for one frame. Pure: the presence of each marker is a
 * direct read of the standing order, and every marker wears the one identity
 * colour. The line of intent exists only when the pilot is actually firing on a
 * lock — never on a bare selection or a friendly fly-to — so the line means
 * "engaging this", the reticle alone means "locked on this".
 */
export function tapMarkersModel(input: TapMarkerInput): TapMarkers {
  const color = playerColor(input.owner);

  const reticle: ReticleMark | null = input.lock
    ? { x: input.lock.x, y: input.lock.y, radius: input.lock.radius, color }
    : null;

  const waypoint: WaypointMark | null = input.waypoint
    ? { x: input.waypoint.x, y: input.waypoint.y, color }
    : null;

  const intent: IntentMark | null =
    input.firing && input.lock
      ? { fromX: input.shipX, fromY: input.shipY, toX: input.lock.x, toY: input.lock.y, color }
      : null;

  return { reticle, waypoint, intent };
}
