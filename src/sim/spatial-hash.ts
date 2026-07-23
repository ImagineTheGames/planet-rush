/**
 * src/sim/spatial-hash.ts — uniform-grid broad phase. OWNER: Gameplay Engineer.
 *
 * GDD §4.1: "Broad phase: uniform-grid spatial hash, cell size ≈ 2× largest
 * radius; test same + adjacent cells only." This turns the O(n²) all-pairs
 * check into a near-linear neighborhood query for ship↔asteroid collisions and
 * chunk↔ship tractor pickup.
 *
 * Determinism: candidate indices are returned in ascending order, and every
 * caller resolves them in that order, so the broad phase never introduces
 * iteration-order nondeterminism into the state hash (GDD §4.8).
 */

import type { Vec2 } from '@shared/types';

/**
 * A grid of point indices bucketed by cell. Built once per subsystem per tick
 * from a snapshot of positions; queried by world-space region.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly cells = new Map<string, number[]>();

  constructor(cellSize: number) {
    // Guard against a zero/negative cell size collapsing every point into one
    // bucket (which would silently restore O(n²)).
    this.cellSize = cellSize > 0 ? cellSize : 1;
  }

  private key(cx: number, cy: number): string {
    return cx + ',' + cy;
  }

  /** Insert point `index` at world position `p`. */
  insert(index: number, p: Vec2): void {
    const cx = Math.floor(p.x / this.cellSize);
    const cy = Math.floor(p.y / this.cellSize);
    const k = this.key(cx, cy);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(index);
    else this.cells.set(k, [index]);
  }

  /** Build a hash from every point in `points` (index = array position). */
  static from(points: readonly Vec2[], cellSize: number): SpatialHash {
    const h = new SpatialHash(cellSize);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p) h.insert(i, p);
    }
    return h;
  }

  /**
   * All indices whose cell overlaps the circle (`center`, `radius`), scanning
   * the covered cells plus a one-cell margin so no neighbor within `radius +
   * cellSize` is missed. Returned sorted ascending and de-duplicated.
   */
  query(center: Vec2, radius: number): number[] {
    const minCx = Math.floor((center.x - radius) / this.cellSize) - 1;
    const maxCx = Math.floor((center.x + radius) / this.cellSize) + 1;
    const minCy = Math.floor((center.y - radius) / this.cellSize) - 1;
    const maxCy = Math.floor((center.y + radius) / this.cellSize) + 1;

    const out: number[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket) for (const i of bucket) out.push(i);
      }
    }
    // Sort + dedupe so callers iterate in a stable, hash-safe order.
    out.sort((a, b) => a - b);
    let w = 0;
    for (let r = 0; r < out.length; r++) {
      if (r === 0 || out[r] !== out[r - 1]) out[w++] = out[r]!;
    }
    out.length = w;
    return out;
  }
}
