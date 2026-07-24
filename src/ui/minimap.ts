/**
 * src/ui/minimap.ts — the minimap and its ping. OWNER: UI Engineer.
 *
 * One of the five things the HUD shows at all times (GDD §2.2): "a minimap
 * (bottom right)". It is a *position* instrument — where the planets sit in the
 * ring, where the ships are, and where you are in it — and deliberately **not a
 * health readout**: enemy planet health is scouted, never broadcast (GDD §2.2),
 * so no HP ever reaches the minimap. The fog rule lives in {@link ./enemy-fog};
 * this module draws dots, and a dot has no HP.
 *
 * What the minimap *is* allowed to show is identity and shape, both of which are
 * always-known: a planet's beacon ring is "always visible" (GDD §5.2), and
 * "a silhouette on the minimap is information" (GDD §2.11 — bot personalities map
 * to hulls, so recognising a shape at 24 px tells you who you are dealing with).
 * So blips carry the owner's identity colour and the local player's blip is
 * marked out, but never a number.
 *
 * The **ping** (GDD §2.4: "Ping minimap — middle click / D-pad / tap minimap")
 * is the one thing the player *adds* to the map: a {@link PingAction} drops a
 * marker at a map-space point, and this module gives it a deterministic,
 * match-time-driven lifecycle — an expanding pulse that fades and expires — so a
 * teammate sees "look here" without a word of chat.
 *
 * Pure and DOM-free, like every decision module in `src/ui`. All geometry is
 * **screen space, CSS pixels, origin top-left, y-down** (the registry / camera
 * convention); the Pixi view in {@link ./minimap-view} draws exactly what this
 * returns, and {@link ./hud} registers the rect it occupies with the layout
 * registry under `bottom-right`.
 */

import type { Rect } from '@platform/layout-registry';
import { DEFAULT_STRIP_HEIGHT } from '@platform/layout-registry';
import { PALETTE, PLAYER_COLORS } from '@render/index';
import { HUD_PAD } from './hud-geometry';
import type { Point } from './enemy-fog';

// ---------------------------------------------------------------------------
// Size and placement (bottom-right, GDD §2.2)
// ---------------------------------------------------------------------------

/** Minimap side length as a fraction of the smaller viewport dimension. Big
 *  enough to place a blip, small enough not to eat the corner of a phone. */
export const MINIMAP_SCALE = 0.22;
/** Clamp so the map is legible on a small phone and not absurd on a 4K desktop. */
export const MINIMAP_MIN = 96;
export const MINIMAP_MAX = 180;
/** Corner margin — the same HUD margin the ore/HP corners use, so the four
 *  corners share one inset and cannot drift apart. */
export const MINIMAP_MARGIN = HUD_PAD;

/** The minimap's square side for a viewport, CSS px. */
export function minimapSize(viewport: { width: number; height: number }): number {
  return clamp(
    Math.min(viewport.width, viewport.height) * MINIMAP_SCALE,
    MINIMAP_MIN,
    MINIMAP_MAX,
  );
}

/**
 * The minimap's drawn footprint — a square hugging the **bottom-right** corner
 * (GDD §2.2), inset by {@link MINIMAP_MARGIN} from the right edge and lifted
 * above the controls strip so the two never overlap on desktop.
 *
 * The extra bottom clearance is the controls-strip band ({@link DEFAULT_STRIP_HEIGHT}):
 * the strip runs full width along the very bottom (`bottom-strip`), so a minimap
 * sitting flush to the bottom edge would land on top of it. Touch has no strip,
 * but the boost/BUILD buttons live down there too, so the clearance is right on
 * both. `stripHeight` is a parameter so a caller with a taller strip can say so.
 */
export function minimapBounds(
  viewport: { width: number; height: number },
  stripHeight: number = DEFAULT_STRIP_HEIGHT,
): Rect {
  const size = minimapSize(viewport);
  return {
    x: viewport.width - MINIMAP_MARGIN - size,
    y: viewport.height - MINIMAP_MARGIN - stripHeight - size,
    width: size,
    height: size,
  };
}

// ---------------------------------------------------------------------------
// World → minimap projection
// ---------------------------------------------------------------------------

/** The rectangular play bounds the minimap represents — the sim's `Bounds`
 *  (world units). Structural, so a sim `Bounds` satisfies it directly. */
export interface Arena {
  readonly width: number;
  readonly height: number;
}

/**
 * Project a world-space point into the minimap rect, preserving the arena's
 * aspect ratio (letterboxed and centred inside the square) and clamping to the
 * rect so a point outside the arena still lands on the map's edge rather than
 * escaping it. Deterministic — pure arithmetic, no state.
 */
export function projectToMinimap(world: Point, arena: Arena, rect: Rect): Point {
  if (arena.width <= 0 || arena.height <= 0) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
  const scale = Math.min(rect.width / arena.width, rect.height / arena.height);
  const drawW = arena.width * scale;
  const drawH = arena.height * scale;
  const ox = rect.x + (rect.width - drawW) / 2;
  const oy = rect.y + (rect.height - drawH) / 2;
  return {
    x: clamp(ox + world.x * scale, rect.x, rect.x + rect.width),
    y: clamp(oy + world.y * scale, rect.y, rect.y + rect.height),
  };
}

// ---------------------------------------------------------------------------
// The ping (GDD §2.4)
// ---------------------------------------------------------------------------

/** How long a dropped ping lives before it expires, seconds. Long enough for a
 *  teammate across the map to look, short enough that the map does not fill with
 *  stale markers. TUNABLE. */
export const PING_TTL = 4;
/** Pulse rate of the ping's expanding ring, Hz. Two pulses a second reads as
 *  "urgent, look here" without strobing. */
export const PING_PULSE_HZ = 2;
/** The ping ring's radius at the start of a pulse and how far it expands, CSS px.
 *  A ring that starts small and blooms outward draws the eye to the centre. */
export const PING_MIN_RADIUS = 4;
export const PING_MAX_RADIUS = 16;

/** A ping the sim reports as live: where it was dropped and when (match time). */
export interface Ping {
  /** Map-space (world) point the ping was dropped at (GDD §2.4 `PingAction.at`). */
  readonly at: Point;
  /** Match time the ping was dropped, seconds — its age is measured from here. */
  readonly time: number;
  /** Who pinged — colours the marker in their identity colour so a teammate
   *  knows who is calling. Optional; absent falls back to plasma. */
  readonly by?: number;
}

/** The drawn state of a ping's pulse this frame. */
export interface PingMarker {
  /** Screen position of the ping centre (projected onto the minimap). */
  readonly x: number;
  readonly y: number;
  /** Expanding-ring radius this frame, CSS px. */
  readonly radius: number;
  /** Ring opacity this frame, 0..1 — fades over the ping's life and per pulse. */
  readonly alpha: number;
  /** The marker's colour — the pinging player's identity colour, or plasma. */
  readonly color: number;
}

/** A ping's age in seconds at match time `now` (may be <0 if `now` predates it). */
export function pingAge(ping: Ping, now: number): number {
  return now - ping.time;
}

/** Whether a ping has expired (or is not yet born) at match time `now`. */
export function pingExpired(ping: Ping, now: number): boolean {
  const age = pingAge(ping, now);
  return age < 0 || age >= PING_TTL;
}

/**
 * The ping's pulse geometry for a given age, at unit scale (radius in CSS px,
 * alpha 0..1). The ring expands each pulse from {@link PING_MIN_RADIUS} to
 * {@link PING_MAX_RADIUS} and fades within the pulse; a slower overall fade over
 * the whole {@link PING_TTL} takes the marker gently to nothing at expiry, so it
 * never blinks out mid-bloom. Match-time driven, so it is deterministic.
 */
export function pingPulse(age: number): { radius: number; alpha: number } {
  if (age < 0 || age >= PING_TTL) return { radius: PING_MIN_RADIUS, alpha: 0 };
  const phase = (age * PING_PULSE_HZ) % 1; // 0..1 within the current pulse
  const radius = PING_MIN_RADIUS + phase * (PING_MAX_RADIUS - PING_MIN_RADIUS);
  const lifeFade = 1 - age / PING_TTL; // 1 at birth → 0 at expiry
  const pulseFade = 1 - phase; // bright at the centre of each bloom
  return { radius, alpha: lifeFade * pulseFade };
}

/**
 * Build the drawable ping marker, or `null` when there is no live ping (none
 * dropped, or it has expired). Projects the ping's map-space point onto the
 * minimap rect and applies the pulse.
 */
export function pingMarker(
  ping: Ping | undefined,
  now: number,
  arena: Arena,
  rect: Rect,
): PingMarker | null {
  if (!ping || pingExpired(ping, now)) return null;
  const p = projectToMinimap(ping.at, arena, rect);
  const pulse = pingPulse(pingAge(ping, now));
  return { x: p.x, y: p.y, radius: pulse.radius, alpha: pulse.alpha, color: pingColor(ping.by) };
}

// ---------------------------------------------------------------------------
// Blips
// ---------------------------------------------------------------------------

/** A minimap entity as the caller knows it — a planet or a ship. Position and
 *  identity only; no HP ever crosses into the minimap (GDD §2.2). */
export interface MinimapEntity {
  /** Owner slot — selects the identity colour (always known, GDD §5.2). */
  readonly owner: number;
  /** World position. */
  readonly pos: Point;
  /** False for a dead ship / destroyed planet — drawn as a dim wreck, or omitted
   *  by the view. Default true. */
  readonly alive?: boolean;
}

/** A projected blip ready to draw. */
export interface MinimapBlip {
  readonly x: number;
  readonly y: number;
  readonly color: number;
  /** The local player's own blip — the view draws it larger / ringed so you can
   *  find yourself at a glance. */
  readonly isSelf: boolean;
  /** Live, or a wreck to draw dim. */
  readonly alive: boolean;
}

/** Everything the minimap needs for one frame. */
export interface MinimapInput {
  readonly viewport: { width: number; height: number };
  readonly arena: Arena;
  /** The local player's slot — marks their own planet and ship blips. */
  readonly self: number;
  readonly planets: readonly MinimapEntity[];
  readonly ships: readonly MinimapEntity[];
  /** A live ping to show, if any (GDD §2.4). */
  readonly ping?: Ping;
  /** Match time, seconds — drives the ping pulse deterministically. */
  readonly now: number;
  /** Controls-strip band height to clear; defaults to the registry's. */
  readonly stripHeight?: number;
}

/** The whole minimap for one frame: its rect, the blips, and the live ping. */
export interface MinimapModel {
  readonly rect: Rect;
  readonly planets: MinimapBlip[];
  readonly ships: MinimapBlip[];
  readonly ping: PingMarker | null;
}

/** Build the minimap model for one frame — the single call the view makes. */
export function minimapModel(input: MinimapInput): MinimapModel {
  const rect = minimapBounds(input.viewport, input.stripHeight);
  const blip = (e: MinimapEntity): MinimapBlip => {
    const p = projectToMinimap(e.pos, input.arena, rect);
    return {
      x: p.x,
      y: p.y,
      color: identityColor(e.owner),
      isSelf: e.owner === input.self,
      alive: e.alive !== false,
    };
  };
  return {
    rect,
    planets: input.planets.map(blip),
    ships: input.ships.map(blip),
    ping: pingMarker(input.ping, input.now, input.arena, rect),
  };
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** Identity colour for a slot, from the ratified roster (style-guide §3.1),
 *  degrading to steel for an out-of-range slot — identity is also carried by the
 *  silhouette, never colour alone. */
function identityColor(owner: number): number {
  if (!Number.isFinite(owner) || owner < 0) return PALETTE.hullSteel;
  return PLAYER_COLORS[Math.floor(owner) % PLAYER_COLORS.length] ?? PALETTE.hullSteel;
}

/** A ping's colour: the pinging player's identity colour so a teammate knows who
 *  called, or plasma when the pinger is unknown. */
function pingColor(by: number | undefined): number {
  return by === undefined ? PALETTE.plasma : identityColor(by);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
