/**
 * src/art/decals.ts — hull number decals. OWNER: Art & Audio Agent.
 *
 * Style-guide §3, rule 3 — and it is a *hard* rule, not a flourish:
 *
 * > **Every ship carries its player number as a hull decal.** Identity never
 * > depends on colour alone — this is the colourblind-safe path and costs
 * > nothing. The decal is the source of truth; the colour is the fast-read
 * > shortcut.
 *
 * So the number has to survive everything the colour doesn't: greyscale, a
 * colourblind player, and a 24px minimap read. A seven-segment glyph is the
 * right tool — it is the most legible digit form that exists at a handful of
 * pixels, it is pure straight strokes (cheap in a Graphics batch), and it needs
 * no font file, so a decal can never fail to render because a webfont hasn't
 * loaded yet.
 *
 * Glyphs are drawn in a 1×1 box centred on the origin and scaled by the caller.
 */

import { DERIVED } from './palette';
import { fill, poly, polyline, round, stroke, type Shape } from './shapes';

// ---------------------------------------------------------------------------
// The seven segments, in a unit box (x ∈ [-0.5, 0.5], y ∈ [-0.5, 0.5])
// ---------------------------------------------------------------------------

const L = -0.32; // left rail (narrow: digits read taller than wide)
const R = 0.32; // right rail
const T = -0.5; // top rail
const M = 0; // middle rail
const B = 0.5; // bottom rail

/** `[x0, y0, x1, y1]` per segment, keyed by the classic A–G naming. */
const SEGMENTS = {
  a: [L, T, R, T],
  b: [R, T, R, M],
  c: [R, M, R, B],
  d: [L, B, R, B],
  e: [L, M, L, B],
  f: [L, T, L, M],
  g: [L, M, R, M],
} as const;

type SegmentId = keyof typeof SEGMENTS;

/**
 * Which segments each digit lights. Only 1–8 exist: player numbers are slots
 * 1..8 (GDD §2.1), so there is no 0 and no 9 to draw. `0` is mapped to `8`'s
 * shape defensively — a decal must never come out blank.
 */
const DIGITS: Readonly<Record<number, readonly SegmentId[]>> = {
  0: ['a', 'b', 'c', 'd', 'e', 'f'],
  1: ['b', 'c'],
  2: ['a', 'b', 'g', 'e', 'd'],
  3: ['a', 'b', 'g', 'c', 'd'],
  4: ['f', 'g', 'b', 'c'],
  5: ['a', 'f', 'g', 'c', 'd'],
  6: ['a', 'f', 'g', 'e', 'c', 'd'],
  7: ['a', 'b', 'c'],
  8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
};

/** The digit a player slot wears: slot 0 is "1" on the hull (GDD §2.1). */
export function decalDigit(playerId: number): number {
  const n = ((Math.trunc(playerId) % 8) + 8) % 8;
  return n + 1;
}

/**
 * The strokes of one digit, in a `size`-tall box centred at (`cx`, `cy`).
 * Returned as unit-space polylines so they compose into any sprite.
 */
export function decalStrokes(digit: number, cx: number, cy: number, size: number): number[][] {
  const segs = DIGITS[digit] ?? DIGITS[8]!;
  return segs.map((id) => {
    const [x0, y0, x1, y1] = SEGMENTS[id];
    return [
      round(cx + x0 * size),
      round(cy + y0 * size),
      round(cx + x1 * size),
      round(cy + y1 * size),
    ];
  });
}

/**
 * A hull decal: the player's number stencilled into the steel in `decalInk`
 * (a dark shade of hull steel — §1's ramp, not a new colour). Dark-on-steel
 * rather than light-on-steel because the decal has to read against the *hull*,
 * and the hull is the light thing in this palette.
 *
 * Rotated 90° so the digit stands upright when the ship's nose points +x: the
 * decal reads correctly on a ship flying "up" the screen, which is where a
 * player's eye is.
 */
export function hullDecal(playerId: number, cx: number, cy: number, size: number): Shape[] {
  const paint = stroke(DERIVED.decalInk, size * 0.2, 'material', 0.9);
  // A lit plate under the digit. Without it the decal lands on whatever panel
  // happens to be beneath — sometimes steel, sometimes a shadowed inset — and a
  // decal that only reads on half the hulls fails rule 3 on the other half.
  const hw = size * 0.56;
  const hh = size * 0.4;
  const plate = poly(
    [
      round(cx - hw), round(cy - hh),
      round(cx + hw), round(cy - hh),
      round(cx + hw), round(cy + hh),
      round(cx - hw), round(cy + hh),
    ],
    fill(DERIVED.hullLight, 'material', 0.55),
  );
  return [
    plate,
    ...decalStrokes(decalDigit(playerId), 0, 0, size).map((s) =>
      // Pre-rotate the glyph +90° — (x, y) → (−y, x) — then translate onto the
      // hull. The renderer turns the whole sprite by `Ship.angle`, so a ship
      // flying up the screen (angle −π/2) cancels this exactly and the digit
      // lands upright under the player's eye.
      polyline([round(cx - s[1]!), round(cy + s[0]!), round(cx - s[3]!), round(cy + s[2]!)], paint),
    ),
  ];
}
