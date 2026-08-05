/**
 * src/art/ring-scan.ts — how many rings does this sprite actually SHOW?
 * OWNER: Art & Audio Agent.
 *
 * A field report, 2026-08-05, with a screenshot: *"theres a bunch of rings
 * around the station (planet) we only need 2."* Nobody drew a bunch of rings.
 * What was drawn was a five-step alpha gradient meant to read as one soft
 * atmosphere — and at the shipped alphas each step was a **visible edge**, so the
 * player counted five boundaries and reasonably assumed each one meant something.
 *
 * The lesson is that "how many rings does this read as" is not the same question
 * as "how many ring-shaped primitives did I write", and only the first one is the
 * bug. So this module measures the first one, the way ./raster measures the 24px
 * legibility rule: as a number, in CI, with no GPU.
 *
 * ## What it measures
 *
 * A **radial alpha profile**: composite the sprite's filled shapes at points
 * marching outward from the origin (taking the brightest sample around each
 * radius, so a *dashed* ring counts once rather than not at all), then look for
 * the places where that profile jumps.
 *
 *  - An **edge** is a step in composited alpha larger than {@link RING_JND} —
 *    a step the eye can find.
 *  - A **ring** is a rising edge followed by a falling one: a band that stands
 *    out from what surrounds it.
 *
 * A genuinely smooth gradient contributes no edges at all, however many discs it
 * is built from, because each of its steps is under the threshold. That is
 * exactly the distinction the field report is about, so it is the distinction the
 * test asserts on.
 *
 * Only **filled** paths count, for the same reason ./raster ignores outlines:
 * hairline strokes are detail, and this is a measure of what reads at a glance.
 */

import { pointInPoly } from './raster';
import type { SpriteDef } from './shapes';

/**
 * The smallest step in composited alpha that counts as an edge.
 *
 * Every entity reads against Vacuum `#0D1015` (style-guide §1), whose brightest
 * channel is 21/255, so a shape's alpha `a` moves a channel by up to
 * `a · (255 − 21) ≈ a · 234` levels. At `0.012` that is ~2.8 levels — around
 * where a step in a large smooth field starts to be findable, and comfortably
 * under a step that reads as a deliberate boundary. The five-band halo this
 * module was written for stepped by ~0.067 (≈16 levels) per band.
 */
export const RING_JND = 0.012;

export interface RingScanOptions {
  /** Radial samples across `0 .. extent · 1.05`. */
  readonly samples?: number;
  /** Angles sampled per radius. The profile keeps the brightest, so a dashed
   *  ring registers as long as one angle lands on a dash. */
  readonly angles?: number;
  /** Override {@link RING_JND} — for probing, not for the standing tests. */
  readonly jnd?: number;
}

/** One step in the profile big enough to see, and which way it went. */
export interface RingEdge {
  /** Radius of the step, in the sprite's unit space. */
  readonly radius: number;
  /** Signed change in composited alpha across it. */
  readonly delta: number;
}

/** A band that stands out from both of its neighbours: one visible ring. */
export interface DetectedRing {
  /** Radius of the rising edge — where the ring begins. */
  readonly inner: number;
  /** Radius of the falling edge — where the ring ends. This is the radius a
   *  range ring *means*: the rule's boundary is the outside of the band. */
  readonly outer: number;
  /** Peak composited alpha inside the band. */
  readonly alpha: number;
}

export interface RingScan {
  /** Sample radii, ascending. */
  readonly radii: readonly number[];
  /** Composited alpha at each radius — the brightest angle sampled there. */
  readonly alpha: readonly number[];
  /** Every step over the threshold, ascending by radius. */
  readonly edges: readonly RingEdge[];
  /** The rings those edges bound, ascending by radius. */
  readonly rings: readonly DetectedRing[];
  /** Spacing between samples — the resolution any radius here is known to. */
  readonly step: number;
}

/** Composited alpha of the sprite's fills at one point in unit space. */
function alphaAt(def: SpriteDef, x: number, y: number): number {
  let a = 0;
  for (const s of def.shapes) {
    const ink = s.fill;
    if (!ink) continue;
    let covered: boolean;
    if (s.path.kind === 'circle') {
      const dx = x - s.path.cx;
      const dy = y - s.path.cy;
      covered = dx * dx + dy * dy <= s.path.r * s.path.r;
    } else {
      covered = s.path.closed && pointInPoly(s.path.points, x, y);
    }
    if (covered) a += ink.alpha * (1 - a);
  }
  return a;
}

/**
 * Scan a sprite for the rings a player would actually count.
 *
 * Radii run a little past the sprite's extent so the outermost boundary has
 * empty space to fall to — otherwise a ring that ends exactly at the edge of the
 * art would have no falling edge to be closed by.
 */
export function scanRings(def: SpriteDef, options: RingScanOptions = {}): RingScan {
  const samples = options.samples ?? 900;
  const angles = options.angles ?? 72;
  const jnd = options.jnd ?? RING_JND;
  const far = def.extent * 1.05;
  const step = far / samples;

  const radii: number[] = [];
  const alpha: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const r = i * step;
    let best = 0;
    for (let k = 0; k < angles; k++) {
      // Half-step offset: annulus polygons are traced with a zero-width slit at
      // angle 0 (./shapes `annulusPoints`), and a sample landing exactly on it
      // is the one point where the crossing test is ambiguous.
      const a = ((k + 0.5) / angles) * Math.PI * 2;
      const v = alphaAt(def, r * Math.cos(a), r * Math.sin(a));
      if (v > best) best = v;
    }
    radii.push(r);
    alpha.push(best);
  }

  const edges: RingEdge[] = [];
  for (let i = 0; i + 1 < alpha.length; i++) {
    const delta = alpha[i + 1]! - alpha[i]!;
    if (Math.abs(delta) > jnd) edges.push({ radius: (radii[i]! + radii[i + 1]!) / 2, delta });
  }

  // A rising edge opens a band; the next falling edge closes it. Unpaired edges
  // are left out of `rings` on purpose — they are still in `edges`, and a test
  // that asserts a ring count should assert the edge count with it.
  const rings: DetectedRing[] = [];
  let open: RingEdge | null = null;
  for (const e of edges) {
    if (e.delta > 0) {
      open = e;
    } else if (open) {
      let peak = 0;
      for (let i = 0; i < radii.length; i++) {
        if (radii[i]! >= open.radius && radii[i]! <= e.radius && alpha[i]! > peak) peak = alpha[i]!;
      }
      rings.push({ inner: open.radius, outer: e.radius, alpha: peak });
      open = null;
    }
  }

  return { radii, alpha, edges, rings, step };
}
