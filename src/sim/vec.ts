/**
 * src/sim/vec.ts — deterministic 2D vector math. OWNER: Gameplay Engineer.
 *
 * Tiny pure helpers over the shared `Vec2` plain-data type. Determinism policy
 * (GDD §4.1, §4.8): we own every float operation, so operation order is fixed
 * and there are no square roots on the hot collision path — narrow phase uses
 * squared distances (`dist2`, i.e. `dx² + dy² < (r1+r2)²`). `len` exists for
 * geometry that genuinely needs a magnitude (it backs `normalize`); the
 * broad/narrow phase never calls it.
 */

import type { Vec2 } from '@shared/types';

/** Length. Uses sqrt — only where a true magnitude is required. */
export function len(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/** Squared distance between two points — no sqrt. */
export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Unit vector in the same direction, or `fallback` when `v` is (near) zero.
 * The fallback keeps direction math total: an idle stick or a chunk sitting on
 * a ship never yields NaN.
 */
export function normalize(v: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 {
  const l = len(v);
  if (l < 1e-9) return { x: fallback.x, y: fallback.y };
  return { x: v.x / l, y: v.y / l };
}

/**
 * Rotate `angle` toward `target` by at most `maxDelta` radians, taking the
 * shortest way around. Used for turn-rate-limited facing (GDD §2.11).
 */
export function turnToward(angle: number, target: number, maxDelta: number): number {
  // Shortest signed angular difference in (-π, π].
  let diff = (target - angle) % (2 * Math.PI);
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  if (diff > maxDelta) diff = maxDelta;
  if (diff < -maxDelta) diff = -maxDelta;
  return angle + diff;
}
