/**
 * src/art/shapes.ts — the sprite IR. OWNER: Art & Audio Agent.
 *
 * Art is code (GDD §4.5), which means a sprite has to be a *value* before it is
 * ever a pixel. Every generator in `src/art/` returns a {@link SpriteDef}: plain
 * serializable data — polygons, circles, colours, roles — with no PixiJS in
 * sight. That buys four things the brief actually requires:
 *
 *  1. **Determinism** — same inputs, deep-equal output. Testable with no GPU.
 *  2. **Palette compliance** — a colour audit is a walk over data (./compliance),
 *     not a screenshot review.
 *  3. **Diffable review** — the same data renders to SVG (./svg) for eyeballing
 *     and to a pooled Pixi texture (./textures) for the game. One source.
 *  4. **The 24px legibility test** (style-guide §4) — fills rasterize in pure TS
 *     (./raster), so "unambiguously distinguishable at 24×24" is a CI assertion.
 *
 * ## Unit space
 *
 * Sprites are authored in **unit space**: the entity's simulation radius is
 * `1.0`, the origin is its centre, and **+x is the facing direction** (matching
 * `Ship.angle`, where angle 0 faces +x). A sprite declares an {@link
 * SpriteDef.extent} — the half-width of the square it must be rasterized in —
 * so a hull whose fins reach past its collision radius still renders whole.
 */

// ---------------------------------------------------------------------------
// Roles — the structural half of the RESERVED rule (style-guide §2)
// ---------------------------------------------------------------------------

/**
 * What a painted shape *means*. The role is not decoration: it is the field the
 * palette-compliance test checks colours against (./compliance).
 *
 *  - `material` — hull, rock, ocean, continent. The world's own substance.
 *  - `identity` — player colour trim: wing tips, cockpit, beacon ring, HP bar.
 *  - `energy`   — plasma: weapon fire, cockpit glass glow, shield bubbles, muzzles.
 *  - `ore`      — ore chunks and the veins in a rock. Signal yellow, legally.
 *  - `core`     — the station core: the win condition, so it earns yellow (§2).
 *  - `danger`   — damage, alarms, hazard stripes, enemy fire. Threat red, and
 *                 the only other place signal yellow may appear.
 *  - `sky`      — the void's own wash: a nebula sheet or a dust lane, behind
 *                 every entity in the game and never part of one (a0-07). It is
 *                 a role rather than "material at a low alpha" because the
 *                 audit treats it differently and much more strictly: signal
 *                 yellow may never touch it at any alpha, and threat red may
 *                 only at a whisper the audit enforces numerically
 *                 (style-guide §2.2, ./compliance `SKY_RESERVED_ALPHA_MAX`).
 *                 No entity sprite may ever carry it.
 */
export type PaintRole = 'material' | 'identity' | 'energy' | 'ore' | 'core' | 'danger' | 'sky';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** A polygon (closed) or polyline (open), as flat `[x0, y0, x1, y1, …]`. */
export interface PolyPath {
  readonly kind: 'poly';
  readonly points: readonly number[];
  /** Closed polygons contribute to the silhouette; open polylines are detail. */
  readonly closed: boolean;
}

/** A circle. Kept as a primitive so discs stay exact at any texture size. */
export interface CirclePath {
  readonly kind: 'circle';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export type PathData = PolyPath | CirclePath;

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

/** A colour and its opacity. */
export interface Ink {
  readonly color: number;
  readonly alpha: number;
}

/** An outline: an {@link Ink} plus a width, in unit-space units. */
export interface StrokeInk extends Ink {
  readonly width: number;
}

/** One drawable element: a path, what it means, and how it is painted. */
export interface Shape {
  readonly path: PathData;
  readonly role: PaintRole;
  readonly fill?: Ink | undefined;
  readonly stroke?: StrokeInk | undefined;
}

/**
 * A complete sprite: an ordered back-to-front shape list plus the metadata a
 * renderer needs to size it. Plain data — deep-equal comparable, JSON
 * serializable, and hashable (see {@link spriteKey}).
 */
export interface SpriteDef {
  /** Stable identifier. Doubles as the texture-cache key (./textures). */
  readonly name: string;
  /**
   * Half-extent of the square the sprite is authored in, in unit space. `1`
   * means the art exactly fills the collision radius; `1.2` means it overhangs
   * by 20% (fins, beacon rings, muzzle flare) and needs the extra margin.
   */
  readonly extent: number;
  readonly shapes: readonly Shape[];
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** A solid fill in `color` at `alpha`, meaning `role`. */
export function fill(color: number, role: PaintRole, alpha = 1): Paint {
  return { role, fill: { color, alpha } };
}

/** An outline `width` unit-units thick. */
export function stroke(color: number, width: number, role: PaintRole, alpha = 1): Paint {
  return { role, stroke: { color, width, alpha } };
}

/** A filled shape with a contrasting outline — used where a silhouette needs a lip. */
export function filledStroke(
  fillColor: number,
  strokeColor: number,
  width: number,
  role: PaintRole,
  alpha = 1,
): Paint {
  return { role, fill: { color: fillColor, alpha }, stroke: { color: strokeColor, width, alpha } };
}

/** The painting half of a {@link Shape}, before a path is attached. */
export interface Paint {
  readonly role: PaintRole;
  readonly fill?: Ink | undefined;
  readonly stroke?: StrokeInk | undefined;
}

/** A closed polygon from flat `[x0, y0, …]` coordinates. */
export function poly(points: readonly number[], paint: Paint): Shape {
  return { path: { kind: 'poly', points, closed: true }, ...paint };
}

/** An open polyline — detail linework (cracks, panel lines, decal strokes). */
export function polyline(points: readonly number[], paint: Paint): Shape {
  return { path: { kind: 'poly', points, closed: false }, ...paint };
}

/** A circle. */
export function circle(cx: number, cy: number, r: number, paint: Paint): Shape {
  return { path: { kind: 'circle', cx, cy, r }, ...paint };
}

/** A sprite from a name, an extent, and its shapes (nullish entries dropped). */
export function sprite(name: string, extent: number, shapes: readonly (Shape | null)[]): SpriteDef {
  return { name, extent, shapes: shapes.filter((s): s is Shape => s !== null) };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Points along an arc, as flat coordinates. `from`/`to` are radians; `segments`
 * is the number of line segments (so `segments + 1` points). The workhorse
 * behind beacon rings, damage rings, and shield bubbles.
 */
export function arcPoints(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  segments: number,
): number[] {
  const pts: number[] = [];
  const n = Math.max(1, Math.floor(segments));
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    pts.push(round(cx + Math.cos(a) * r), round(cy + Math.sin(a) * r));
  }
  return pts;
}

/**
 * A closed ring segment — an outer arc and an inner arc joined into one
 * polygon. Beacon rings, damage rings, shield bubbles and station limb shading
 * are all this shape, so it lives here rather than four times over.
 */
export function annulusPoints(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  from: number,
  to: number,
  segments: number,
): number[] {
  return [
    ...arcPoints(cx, cy, rOuter, from, to, segments),
    ...arcPoints(cx, cy, rInner, to, from, segments),
  ];
}

/**
 * A closed blob: a radial polygon whose radius at each vertex comes from
 * `radiusAt(i, angle)`. Continents, asteroid bodies and debris are all this.
 */
export function blob(
  cx: number,
  cy: number,
  vertices: number,
  radiusAt: (index: number, angle: number) => number,
): number[] {
  const pts: number[] = [];
  const n = Math.max(3, Math.floor(vertices));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radiusAt(i, a);
    pts.push(round(cx + Math.cos(a) * r), round(cy + Math.sin(a) * r));
  }
  return pts;
}

/** Mirror a polygon across the x axis (y → −y), reversing winding. */
export function mirrorY(points: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = points.length - 2; i >= 0; i -= 2) {
    out.push(points[i]!, round(-points[i + 1]!));
  }
  return out;
}

/**
 * Quantise to 1e-4. Every generated coordinate goes through this, so a sprite
 * built from trig is byte-identical across engines — which is what makes the
 * determinism test and the committed SVG artifact stable (GDD §4.1).
 */
export function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * A stable content key for a sprite: same geometry and paint ⇒ same string.
 * The texture cache pools on this, so two ships of the same class and colour
 * share one GPU texture (GDD §4.3, risk 5).
 */
export function spriteKey(def: SpriteDef): string {
  return JSON.stringify(def);
}

/** Every distinct colour a sprite paints with, in first-use order. */
export function spriteColors(def: SpriteDef): number[] {
  const seen: number[] = [];
  for (const s of def.shapes) {
    for (const ink of [s.fill, s.stroke]) {
      if (ink && !seen.includes(ink.color)) seen.push(ink.color);
    }
  }
  return seen;
}
