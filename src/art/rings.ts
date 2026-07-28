/**
 * src/art/rings.ts — the ring-damage primitive. OWNER: Art & Audio Agent.
 *
 * ONE grammar for every gauge ring on a station (developer-ratified, p11):
 *
 *   > "It should be the colour of the station, and a red segment FILLS it;
 *   >  completely red means death."
 *
 * A whole ring in the OWNER's colour is the health you still have; a threat-red
 * segment grows over it, from twelve o'clock CLOCKWISE, proportional to the pool
 * LOST. A fully red ring is death, exactly. The core ring and every shield layer
 * configure this same primitive, so a besieged station reads outermost-first:
 * shields redden and die before the core has begun to fill — the siege's whole
 * progress, legible at a glance, in one visual verb.
 *
 * Reserved-colour discipline (style-guide §2): the base wears the roster colour
 * on role `identity` (PLAYER_COLORS); the fill is threat-red `#B23A3A` on role
 * `danger` — red is damage and nothing else, ever. Sim data is untouched; this
 * is pure render grammar.
 */

import { PALETTE, playerColor } from './palette';
import { annulusPoints, fill, poly, type Shape } from './shapes';

/**
 * Twelve o'clock. Screen space runs +y downward, so this is the top of the ring
 * and an INCREASING sweep angle travels clockwise — the direction the red fill
 * grows as damage accrues. Core and shields share the origin so their fills line
 * up when stacked concentrically.
 */
export const RING_DAMAGE_START = -Math.PI / 2;

export interface RingDamageOptions {
  /** Whose ring this is — the base wears their roster colour. */
  readonly playerId: number;
  /** Fraction of the pool GONE, 0..1. 0 = whole owner ring; 1 = fully red. */
  readonly lost: number;
  readonly outer: number;
  readonly inner: number;
  /** Base (owner-colour) alpha. Defaults to a legible 0.9. */
  readonly baseAlpha?: number;
  /** Red-fill alpha. Defaults to 0.95 — the damage always reads. */
  readonly fillAlpha?: number;
  /** Segment count of the full ring; the fill scales its own count from this. */
  readonly segments?: number;
}

/**
 * The primitive, as sprite-IR shapes: the owner-colour base ring, then (only
 * when something is lost) the red fill from twelve o'clock clockwise. Returns a
 * plain array so a caller can splice it into a larger sprite (the shield bubble
 * carries its plasma body alongside its gauge).
 */
export function ringDamageShapes(options: RingDamageOptions): Shape[] {
  const lost = options.lost < 0 ? 0 : options.lost > 1 ? 1 : options.lost;
  const segments = options.segments ?? 40;
  const baseAlpha = options.baseAlpha ?? 0.9;
  const fillAlpha = options.fillAlpha ?? 0.95;
  const { outer, inner } = options;

  // The base: the owner's colour, whole — full health is your colour, entire.
  const shapes: Shape[] = [
    poly(
      annulusPoints(0, 0, outer, inner, 0, Math.PI * 2, segments),
      fill(playerColor(options.playerId), 'identity', baseAlpha),
    ),
  ];

  // The damage: threat red, filling clockwise from twelve o'clock. Full == death.
  if (lost > 0) {
    shapes.push(
      poly(
        annulusPoints(
          0,
          0,
          outer,
          inner,
          RING_DAMAGE_START,
          RING_DAMAGE_START + Math.PI * 2 * lost,
          Math.max(2, Math.round(segments * lost)),
        ),
        fill(PALETTE.threatRed, 'danger', fillAlpha),
      ),
    );
  }

  return shapes;
}
