/**
 * src/art/raster.ts — a tiny CPU rasterizer for the legibility test.
 * OWNER: Art & Audio Agent.
 *
 * Style-guide §9 makes "reads at a glance" a standing check with criteria
 * rather than vibes, and §4 fixes the criterion for hulls at 24×24 px, flat, in
 * greyscale. That is a *measurement*, so it needs a measuring device that runs
 * in CI — no GPU, no canvas, no screenshot. This is it: a scanline-free,
 * point-sampled rasterizer over the sprite IR (./shapes) that answers one
 * question — which pixels does this sprite's mass occupy?
 *
 * Only **filled, closed** paths count. Outlines, panel lines and decals are
 * detail; a 24px render throws detail away, so the test must too, or it would
 * be measuring something the player can't see.
 */

import type { SpriteDef } from './shapes';

/** A rasterized silhouette: `size × size`, row-major, 1 = covered. */
export interface Mask {
  readonly size: number;
  readonly bits: Uint8Array;
}

/** Samples per axis inside each pixel. 2 ⇒ 4 samples, enough to stabilise thin fins. */
const SUBSAMPLES = 2;

function pointInPoly(points: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = points.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i * 2]!;
    const yi = points[i * 2 + 1]!;
    const xj = points[j * 2]!;
    const yj = points[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Rasterize a sprite's filled mass at `size × size`. The sprite's `extent` maps
 * to the square's half-width, so two sprites of different extents are compared
 * as they would actually appear: scaled to the same on-screen box.
 */
export function rasterize(def: SpriteDef, size: number): Mask {
  const bits = new Uint8Array(size * size);
  const solids = def.shapes.filter((s) => s.fill !== undefined && s.fill.alpha >= 0.5);
  const step = (def.extent * 2) / size;
  const sub = step / (SUBSAMPLES + 1);
  const need = Math.ceil((SUBSAMPLES * SUBSAMPLES) / 2);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 1; sy <= SUBSAMPLES; sy++) {
        for (let sx = 1; sx <= SUBSAMPLES; sx++) {
          const x = -def.extent + px * step + sx * sub;
          const y = -def.extent + py * step + sy * sub;
          let covered = false;
          for (const s of solids) {
            if (s.path.kind === 'circle') {
              const dx = x - s.path.cx;
              const dy = y - s.path.cy;
              if (dx * dx + dy * dy <= s.path.r * s.path.r) covered = true;
            } else if (s.path.closed && pointInPoly(s.path.points, x, y)) {
              covered = true;
            }
            if (covered) break;
          }
          if (covered) hits++;
        }
      }
      if (hits >= need) bits[py * size + px] = 1;
    }
  }
  return { size, bits };
}

/** Fraction of the box the sprite's mass fills, 0..1. */
export function coverage(mask: Mask): number {
  let n = 0;
  for (const b of mask.bits) n += b;
  return n / mask.bits.length;
}

/**
 * Jaccard overlap of two masks: |A ∩ B| / |A ∪ B|. 1 means identical mass,
 * 0 means no shared pixel. This is the number style-guide §4's "unambiguously
 * distinguishable" is measured as.
 */
export function jaccard(a: Mask, b: Mask): number {
  if (a.size !== b.size) throw new Error(`mask size mismatch: ${a.size} vs ${b.size}`);
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.bits.length; i++) {
    const x = a.bits[i]!;
    const y = b.bits[i]!;
    if (x || y) either++;
    if (x && y) both++;
  }
  return either === 0 ? 1 : both / either;
}

/** The mask as ASCII, for a failing test's message (and for a human's eye). */
export function asciiMask(mask: Mask): string {
  const rows: string[] = [];
  for (let y = 0; y < mask.size; y++) {
    let row = '';
    for (let x = 0; x < mask.size; x++) row += mask.bits[y * mask.size + x] ? '#' : '.';
    rows.push(row);
  }
  return rows.join('\n');
}
