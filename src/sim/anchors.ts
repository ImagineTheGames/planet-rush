/**
 * src/sim/anchors.ts — safe arrival geometry. OWNER: Gameplay Engineer.
 *
 * The developer report p14 ("bot wedged on its OWN station's rim") names the
 * class of bug: an *arrival point* — a place a ship is told to fly to and stop —
 * that lies at or inside a solid body's collision radius. A ship steered onto
 * such a point pushes into the geometry it can never reach and wedges (see the
 * escape hatch in `./step`, and `WEDGE_SLIDE_*` in `./constants`).
 *
 * Every arrival point a pilot can be given — a bot's deposit approach, defend
 * post, repair park, satellite tend, or a human autopilot's fly-to — must sit
 * OUTSIDE `bodyRadius + SHIP_RADIUS + margin`, or the ship rams the body. This
 * is one pure geometry rule, so it lives in ONE place rather than being re-derived
 * (and mis-derived) at each site. The sim's own collision response is the floor
 * that guarantees no *permanent* pin; routing arrival points through
 * {@link clampAnchorOutside} is the belt that stops a ship ever reaching the rim
 * in the first place — the report's "fix the class, not the case."
 *
 * Pure and deterministic: no RNG, no clock, no allocation beyond the returned
 * point (GDD §4.1, §4.8).
 */

import type { Vec2 } from '@shared/types';
import { SHIP_RADIUS } from './constants';

/**
 * Default clearance (world units) kept between an arrival point and a body's
 * collision surface, on top of the ship's own radius. A ship parked exactly at
 * `bodyRadius + SHIP_RADIUS` is *touching*; this margin backs it off so a tick
 * of drift or a decelerating overshoot does not tip it into contact. Comfortably
 * larger than one tick's cruise drift, small enough that a "park next to it"
 * anchor still reads as next to it. TUNABLE.
 */
export const ANCHOR_MARGIN = 8;

/**
 * The minimum centre-to-centre distance an arrival point must hold from a body
 * of radius `bodyRadius` so a ship stopped there clears the body's surface by
 * `margin`: `bodyRadius + SHIP_RADIUS + margin`. The single source of truth for
 * "how far out is safe" — every stand-off, guard ring, and dock distance should
 * be at least this.
 */
export function safeAnchorRadius(bodyRadius: number, margin: number = ANCHOR_MARGIN): number {
  return bodyRadius + SHIP_RADIUS + margin;
}

/**
 * Push an arrival point radially outward off a body until it clears
 * {@link safeAnchorRadius}, leaving any point already outside untouched.
 *
 * Given a desired `anchor` and a solid body (`bodyCenter`, `bodyRadius`), returns
 * the nearest point on the ray from the body centre through the anchor that a
 * ship can actually stop at without wedging. An anchor at the body centre (the
 * `arrive(station.pos)` case the report photographed) has no direction to push
 * along, so `fallbackDir` — a unit heading, e.g. the ship's bearing from the
 * body — decides which way out; it defaults to +x.
 *
 * Deterministic and allocation-light: returns the input object identity only when
 * it is already safe is NOT guaranteed (a fresh Vec2 is always returned), so
 * callers must not rely on reference equality.
 */
export function clampAnchorOutside(
  anchor: Vec2,
  bodyCenter: Vec2,
  bodyRadius: number,
  margin: number = ANCHOR_MARGIN,
  fallbackDir: Vec2 = { x: 1, y: 0 },
): Vec2 {
  const min = safeAnchorRadius(bodyRadius, margin);
  let dx = anchor.x - bodyCenter.x;
  let dy = anchor.y - bodyCenter.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return { x: anchor.x, y: anchor.y };

  const d = Math.sqrt(d2);
  if (d > 1e-9) {
    dx /= d;
    dy /= d;
  } else {
    // Anchor sits on the body centre — no outward direction of its own. Fall
    // back to the supplied heading (normalised; +x if it too is degenerate).
    const fd = Math.sqrt(fallbackDir.x * fallbackDir.x + fallbackDir.y * fallbackDir.y);
    if (fd > 1e-9) {
      dx = fallbackDir.x / fd;
      dy = fallbackDir.y / fd;
    } else {
      dx = 1;
      dy = 0;
    }
  }
  return { x: bodyCenter.x + dx * min, y: bodyCenter.y + dy * min };
}
