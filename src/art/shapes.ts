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

/**
 * A **smooth radial falloff** over a fill: the alpha at a point is the ink's own
 * alpha times {@link falloffProfile} of that point's elliptical distance from
 * `(cx, cy)`. At the falloff's own rim the alpha is exactly zero, so a
 * gradient-filled shape has no visible boundary at all.
 *
 * ## Why this is in the IR rather than faked with more geometry (a0-39)
 *
 * Before this existed, every soft edge in the art was a **stack of concentric
 * flat-filled shapes** — four of them, at radius fractions `1.0 / 0.72 / 0.46 /
 * 0.2`. At sprite scale that reads as a soft edge. At *nebula* scale it reads as
 * four hard-edged rings with a dark core, and it is precisely what the developer
 * photographed and reported three times as *"bloom orbs with no stars in them"*:
 *
 * ```
 *   an isolated Deep Ember body, 720-ray rotational profile, Y′ over Floor
 *   r      0…40    40   44…92    93   96…144   145  148…202  202   ≥208
 *   Y′     7.633   ↓    4.995    ↓    3.357    ↓    2.144    ↓     1.932   ← Floor
 *   rings at r/r_outer  0.198 / 0.460 / 0.718 / 1.000
 *   SOFT_STOPS radii    0.200 / 0.460 / 0.720 / 1.000
 * ```
 *
 * Four dead-flat plateaus, four hard edges, nothing in between. The steepest
 * 6 px drop was **2.629 Y′** where a smooth falloff over the same blob cannot
 * exceed **0.143** — an 18× overshoot.
 *
 * Adding stops does not fix it: sixteen bands is still bands, and every stop is
 * another covered layer on a per-frame fill-rate budget CI pins
 * (`NebulaSpec.overdraw`). What fixes it is one shape whose *alpha* varies,
 * which is what this is — and it costs a **quarter** of the geometry the stack
 * did, because one shape replaces four.
 *
 * It stays in the IR rather than becoming a texture-mapped layer of its own so
 * that a sky is still plain data: `./compliance` still audits its colour and its
 * peak alpha, `./raster` still rasterizes it, `./svg` still draws it for review,
 * and `backdrop.test.ts` still measures its brightness and its overdraw.
 */
export interface Falloff {
  /** Centre of the falloff, in the same space as the path. */
  readonly cx: number;
  readonly cy: number;
  /** The radii at which the alpha reaches **zero**, before rotation. */
  readonly rx: number;
  readonly ry: number;
  /** Rotation of the falloff's axes, radians. */
  readonly angle: number;
  /**
   * Which curve the alpha follows from the centre out. Absent is `'smooth'` —
   * {@link falloffProfile}, the curve every soft body in the art is made of. See
   * {@link FalloffCurve} for the one exception and why it had to exist.
   */
  readonly curve?: FalloffCurve | undefined;
}

/**
 * **The two radial curves in the art**, and there are two rather than one for a
 * reason that is measured rather than aesthetic (a0-44):
 *
 *  - `smooth` — {@link falloffProfile}, `(1 − t²)²`. Every soft *body*: every
 *    nebula blob, and everything a0-39 converted off the four-stop stack.
 *  - `halo` — {@link haloProfile}, the design preview's own three-stop star
 *    glow. **Only a bloomed star's halo.**
 *
 * A star's glow is not a small nebula and the design does not draw it like one.
 * A blob is a body with a soft edge, so it wants a curve that is flat in the
 * middle and lands tangentially; a glow is a *bright core with a wide faint
 * skirt*, which is what the design's stops paint and what `(1 − t²)²` cannot —
 * the same disc under `smooth` carries **1.85×** the design's light, most of it
 * in a plateau the design does not have. At the design's halo radius that is not
 * a nuance: it misses the design's own measured star p99 (46–53) by half again
 * (66.9), and matching the curve lands it at 47.9. The run is in
 * `evidence/a0-44-star-bloom-radius/audit.txt`.
 */
export type FalloffCurve = 'smooth' | 'halo';

/** A colour and its opacity. */
export interface Ink {
  readonly color: number;
  /**
   * The opacity — and, when {@link falloff} is present, the **peak** opacity,
   * reached only at the falloff's centre. Every consumer that bounds a fill
   * (notably `./compliance`'s sky ceilings) therefore reads the conservative
   * number without having to know about the falloff at all.
   */
  readonly alpha: number;
  /** A smooth radial falloff over this fill, or absent for a flat one. */
  readonly falloff?: Falloff | undefined;
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

/**
 * A fill in `color` whose alpha falls smoothly from `peakAlpha` at the
 * falloff's centre to **zero** at its rim ({@link Falloff}).
 *
 * The path is still the path: the falloff modulates the paint, it does not
 * clip. Give the shape a path that sits at or inside the falloff's zero rim and
 * the result has no boundary a player can see.
 */
export function softFill(
  color: number,
  role: PaintRole,
  peakAlpha: number,
  falloff: Falloff,
): Paint {
  return { role, fill: { color, alpha: peakAlpha, falloff } };
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

/**
 * A closed ellipse as a polygon: `rx`×`ry`, rotated by `angle`. The path a
 * {@link Falloff}'s own zero rim traces, so a soft element's geometry and its
 * paint end in the same place.
 */
export function ellipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number,
  vertices = 28,
): number[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pts: number[] = [];
  const n = Math.max(3, Math.floor(vertices));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const ex = Math.cos(t) * rx;
    const ey = Math.sin(t) * ry;
    pts.push(round(cx + ex * cos - ey * sin), round(cy + ex * sin + ey * cos));
  }
  return pts;
}

// ---------------------------------------------------------------------------
// The falloff profile — one curve, for the whole art
// ---------------------------------------------------------------------------

/**
 * **The falloff curve: `(1 − t²)²`**, for `t` = elliptical distance from the
 * centre in units of the falloff's own radius. 1 at the centre, 0 from `t = 1`
 * outward.
 *
 * One curve for every soft element in the game, and it is this one for three
 * reasons that are all about *not producing an edge*:
 *
 *  1. **Its slope is zero at both ends.** `f′(t) = −4t(1 − t²)` is 0 at `t = 0`
 *     and at `t = 1`, so the blob has a naturally flat core without a plateau
 *     spliced onto it, and it meets the background tangentially instead of
 *     landing on it. A curve that arrives at the rim with slope — `1 − t`, or
 *     any of the stop tables this replaced — leaves a Mach band there, which is
 *     the artefact all over again at one ring instead of four.
 *  2. **It is smooth everywhere in between.** No knot, no piecewise join, so
 *     there is no radius at which the *second* derivative jumps either — the
 *     other place the eye finds a ring that the arithmetic says is not there.
 *  3. **It has a closed-form mean**, `∫₀¹ (1−t²)²·2t dt = 1/3`, so "what does
 *     this blob cost the frame on average" is arithmetic rather than a sample.
 *
 * Its practical consequence, worth having in front of you when tuning a sky:
 * **a gradient blob's average alpha is a third of its peak**, where the old
 * four-stop stack's was most of its peak across most of its radius. A sky ported
 * from stops to a gradient at the same declared alpha gets dimmer, and the
 * honest fix is to re-declare the peak — not to widen the curve.
 */
export function falloffProfile(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  const v = 1 - t * t;
  return v * v;
}

/**
 * **Where the star glow's knee sits**, as a fraction of the halo's radius — the
 * design preview's middle gradient stop. See {@link haloProfile}.
 */
export const HALO_KNEE_AT = 0.35;

/**
 * **The star glow's value at that knee**, as a fraction of its own peak.
 *
 * `13 / 42`, and it is written as that ratio rather than as `0.3095` because it
 * is exactly what the design's two stops are — `0.13 × intensity` over
 * `0.42 × intensity` — so the intensity cancels and the *shape* is intensity-free.
 * `./mockup-reference` carries the two alphas themselves; this is their ratio,
 * and `backdrop.test.ts` asserts the two agree.
 */
export const HALO_KNEE = 13 / 42;

/**
 * **The star glow's curve** — the design preview's own radial gradient, which is
 * three stops linearly interpolated:
 *
 * ```
 *   t = 0      1                 (the peak)
 *   t = 0.35   13/42 = 0.3095    (the knee)
 *   t = 1      0                 (the rim)
 * ```
 *
 * Linear between them, because that is what `createRadialGradient` paints and the
 * design preview states its glow as three `addColorStop`s and nothing else.
 *
 * ## Why the art now has a second curve (a0-44)
 *
 * {@link falloffProfile}'s docstring argues for one curve everywhere, and every
 * word of it still holds **for a body**. A star's halo is not a body:
 *
 * ```
 *   t        0.10   0.20   0.35   0.50   0.62   0.75   0.90
 *   design   .803   .605   .310   .238   .181   .119   .048
 *   smooth   .980   .922   .770   .563   .379   .191   .036
 * ```
 *
 * The design is already down to a third of its peak at `t = 0.35`, where
 * `(1 − t²)²` is still at three quarters — a glow with a core and a skirt against
 * a ball with a soft edge. Integrated over the disc that is **0.180 against
 * 0.333**: the same halo drawn `smooth` carries 1.85× the light. Measured on the
 * design's own instrument, a field of the design's halos drawn `smooth` reads
 * p99 **66.9** against the design's stated **46–53**; drawn on this curve it
 * reads **47.9** (`evidence/a0-44-star-bloom-radius/audit.txt`).
 *
 * It costs the two things `falloffProfile` was chosen to avoid, and they are
 * worth naming rather than discovering later: this curve has a **knot at 0.35**
 * and it **arrives at the rim with slope**. Both are bounded here in a way they
 * were not on the four-stop stack a0-39 removed — the steepest slope change is
 * across `0.0147` of alpha per px on the largest halo in the field against the
 * stack's `2.6` luma per 6 px, and the rim slope is `0.0036` alpha/px, i.e. under
 * one code value per pixel on white. They are also, and mainly, **what the design
 * draws**, and the ruling on this backdrop is that the game matches the design
 * rather than improves on it.
 */
export function haloProfile(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  if (t <= HALO_KNEE_AT) return 1 + (t / HALO_KNEE_AT) * (HALO_KNEE - 1);
  return HALO_KNEE * (1 - (t - HALO_KNEE_AT) / (1 - HALO_KNEE_AT));
}

/** The curve a falloff follows — {@link FalloffCurve}, with `smooth` the default. */
export function curveProfile(curve: FalloffCurve | undefined): (t: number) => number {
  return curve === 'halo' ? haloProfile : falloffProfile;
}

/** Elliptical distance of `(x, y)` from a falloff's centre, in radius units. */
export function falloffDistance(f: Falloff, x: number, y: number): number {
  const dx = x - f.cx;
  const dy = y - f.cy;
  const cos = Math.cos(f.angle);
  const sin = Math.sin(f.angle);
  // Into the falloff's own axes: the inverse rotation, then divide by each
  // radius, so a circle in that space is the ellipse in this one.
  const ex = (dx * cos + dy * sin) / f.rx;
  const ey = (-dx * sin + dy * cos) / f.ry;
  return Math.hypot(ex, ey);
}

/**
 * The alpha an ink actually paints at `(x, y)`: its own alpha for a flat fill,
 * and its peak alpha shaped by its falloff's own curve ({@link curveProfile}) for
 * a soft one.
 *
 * This is the single definition of "how bright is this ink here" for a consumer
 * holding a point in the sprite's own space: the CPU rasterizer and the sky's
 * brightness and overdraw measurements. The two drawing paths — the ramp
 * texture and the SVG review sheets — take the curve itself, because both work
 * in the falloff's unit space and have no world point to ask about; both pick it
 * with the same {@link curveProfile}. The shape of the falloff is shared either
 * way, so a picture, a measurement and a frame can never disagree about a
 * gradient.
 */
export function inkAlphaAt(ink: Ink, x: number, y: number): number {
  if (!ink.falloff) return ink.alpha;
  return (
    ink.alpha * curveProfile(ink.falloff.curve)(falloffDistance(ink.falloff, x, y))
  );
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

// ---------------------------------------------------------------------------
// Area — what a shape costs the rasteriser (a0-75)
// ---------------------------------------------------------------------------

/**
 * **The area one shape asks the rasteriser to shade**, in the sprite's own
 * units squared.
 *
 * This is the unit of a0-75. The developer bisected a stutter to *"it gets worse
 * the larger the playing area is on my screen"*, and what makes that true is
 * that per-frame cost is `screen pixels × Σ overdraw`, where overdraw is the sum
 * of these areas over the field they cover. Counting it needs no GPU, so it is
 * the same answer on the developer's ultrawide as in a test runner — which is
 * exactly what a per-frame budget has to be to be a budget.
 *
 * **A soft fill counts its WHOLE path.** Alpha reaching zero at the rim costs a
 * blend exactly like alpha 1 does, and a layer nobody can see can still be the
 * most expensive thing in the frame. That is not a hypothetical: it is what the
 * sky was.
 */
export function shapeArea(shape: Shape): number {
  let area = 0;
  if (shape.fill) {
    area += shape.path.kind === 'circle' ? Math.PI * shape.path.r ** 2 : polyArea(shape.path.points);
  }
  if (shape.stroke) {
    const len =
      shape.path.kind === 'circle'
        ? 2 * Math.PI * shape.path.r
        : polyLength(shape.path.points, shape.path.closed);
    area += len * shape.stroke.width;
  }
  return area;
}

/** {@link shapeArea} summed over a sprite — the fill one layer submits. */
export function spriteArea(def: SpriteDef): number {
  let a = 0;
  for (const s of def.shapes) a += shapeArea(s);
  return a;
}

/** A closed polygon's own area, by the shoelace formula. */
function polyArea(points: readonly number[]): number {
  let a = 0;
  const n = points.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += points[2 * i]! * points[2 * j + 1]! - points[2 * j]! * points[2 * i + 1]!;
  }
  return Math.abs(a) / 2;
}

/** A path's length — what a stroke's area is its width times. */
function polyLength(points: readonly number[], closed: boolean): number {
  let len = 0;
  const n = points.length / 2;
  for (let i = 0; i + 1 < n; i++) {
    len += Math.hypot(points[2 * i + 2]! - points[2 * i]!, points[2 * i + 3]! - points[2 * i + 1]!);
  }
  if (closed && n > 1) {
    len += Math.hypot(points[0]! - points[2 * n - 2]!, points[1]! - points[2 * n - 1]!);
  }
  return len;
}
