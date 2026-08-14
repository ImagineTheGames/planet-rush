/**
 * src/art/svg.ts — sprites as SVG. OWNER: Art & Audio Agent.
 *
 * GDD §4.5: *"Asset generation: art is generated as code (SVG/procedural
 * sprites) — reproducible, diffable, license-clean, regenerable offline."*
 *
 * The "diffable" half needs a target a human can open, and this is it. The same
 * {@link SpriteDef} that becomes a pooled GPU texture in the game (./textures)
 * becomes an SVG here, so the picture in review and the pixels in the build can
 * never be two different things. `preview.ts` writes the whole catalogue to one
 * contact sheet, and the sheet is committed — so an art change shows up in a
 * PR diff as a shape change, not as a binary blob nobody can read.
 *
 * Output is deterministic: coordinates are already quantised in the IR
 * (`round`, 1e-4), so the same generators produce byte-identical SVG on every
 * machine, and the committed sheet is a golden the test can compare against.
 */

import { hex, PALETTE } from './palette';
import { curveProfile, HALO_KNEE_AT, type Falloff, type Shape, type SpriteDef } from './shapes';

function num(n: number): string {
  // Trim -0 and trailing zeroes so the output diffs cleanly.
  const v = Object.is(n, -0) ? 0 : n;
  return String(Number(v.toFixed(4)));
}

function pointsAttr(points: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < points.length; i += 2) parts.push(`${num(points[i]!)},${num(points[i + 1]!)}`);
  return parts.join(' ');
}

/**
 * Number of stops a {@link Falloff} is written out with. SVG interpolates
 * linearly between stops, so this is the one place the curve is sampled rather
 * than evaluated — 16 segments hold `(1 − t²)²` to under half a percent, which
 * on a sky whose whole peak is a few alpha percent is far below a code value.
 */
const SVG_FALLOFF_STOPS = 16;

/**
 * A stable id for one falloff, from its own numbers. Deterministic, so the
 * committed contact sheet still diffs as a shape change rather than churning a
 * counter every time a sprite is inserted above another.
 */
function falloffId(f: Falloff, color: number, alpha: number): string {
  const key = [f.cx, f.cy, f.rx, f.ry, f.angle, color, alpha]
    .map(num)
    .concat(f.curve ?? 'smooth')
    .join('_');
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `f${(h >>> 0).toString(36)}`;
}

/**
 * A falloff as an SVG `<radialGradient>` — *the* construct the concept board the
 * developer approved drew its nebulae with (`createRadialGradient`), which is
 * why a review sheet is now the same picture as a frame rather than an
 * approximation of one.
 *
 * Authored as a unit circle in `objectBoundingBox`-free user space and shaped
 * by `gradientTransform`, so an elongated, rotated falloff needs no second code
 * path.
 */
function falloffDefs(f: Falloff, color: number, alpha: number, id: string): string {
  const profile = curveProfile(f.curve);
  // A `halo` is the design's own three-stop gradient and SVG interpolates stops
  // linearly, so three stops reproduce it EXACTLY — sampling it 16 times would
  // only blunt its knee, which is the one feature it has (a0-44, `./shapes`
  // `haloProfile`). A `smooth` curve is a curve and still wants its 16.
  const offsets =
    f.curve === 'halo'
      ? [0, HALO_KNEE_AT, 1]
      : Array.from({ length: SVG_FALLOFF_STOPS + 1 }, (_, i) => i / SVG_FALLOFF_STOPS);
  const stops = offsets.map(
    (t) =>
      `<stop offset="${num(t)}" stop-color="${hex(color)}" stop-opacity="${num(
        Number((alpha * profile(t)).toFixed(5)),
      )}"/>`,
  );
  const tf =
    `translate(${num(f.cx)} ${num(f.cy)}) rotate(${num((f.angle * 180) / Math.PI)}) ` +
    `scale(${num(f.rx)} ${num(f.ry)})`;
  return (
    `<defs><radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `cx="0" cy="0" r="1" gradientTransform="${tf}">${stops.join('')}</radialGradient></defs>`
  );
}

function paintAttrs(shape: Shape): string {
  const attrs: string[] = [];
  if (shape.fill) {
    if (shape.fill.falloff) {
      // The gradient already carries the colour AND the alpha, per stop.
      attrs.push(`fill="url(#${falloffId(shape.fill.falloff, shape.fill.color, shape.fill.alpha)})"`);
      return attrs.join(' ');
    }
    attrs.push(`fill="${hex(shape.fill.color)}"`);
    if (shape.fill.alpha < 1) attrs.push(`fill-opacity="${num(shape.fill.alpha)}"`);
  } else {
    attrs.push('fill="none"');
  }
  if (shape.stroke) {
    attrs.push(`stroke="${hex(shape.stroke.color)}"`, `stroke-width="${num(shape.stroke.width)}"`);
    attrs.push('stroke-linecap="round"', 'stroke-linejoin="round"');
    if (shape.stroke.alpha < 1) attrs.push(`stroke-opacity="${num(shape.stroke.alpha)}"`);
  }
  return attrs.join(' ');
}

/** One shape as an SVG element, in unit space. */
export function shapeToSvg(shape: Shape): string {
  const paint = paintAttrs(shape);
  // A gradient-filled shape carries its own `<defs>` immediately in front of it.
  // SVG allows `<defs>` anywhere, and keeping the definition beside its one user
  // is what makes `shapeToSvg` stay a pure function of a single shape.
  const defs =
    shape.fill?.falloff === undefined
      ? ''
      : falloffDefs(
          shape.fill.falloff,
          shape.fill.color,
          shape.fill.alpha,
          falloffId(shape.fill.falloff, shape.fill.color, shape.fill.alpha),
        );
  if (shape.path.kind === 'circle') {
    const { cx, cy, r } = shape.path;
    return `${defs}<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" ${paint}/>`;
  }
  const tag = shape.path.closed ? 'polygon' : 'polyline';
  return `${defs}<${tag} points="${pointsAttr(shape.path.points)}" ${paint}/>`;
}

/**
 * A sprite as a `<g>` in unit space, scaled so its extent fills `size` pixels.
 * Callers position it with the `translate` arguments.
 */
export function spriteToGroup(def: SpriteDef, size: number, tx = 0, ty = 0): string {
  const scale = size / (def.extent * 2);
  const body = def.shapes.map(shapeToSvg).join('');
  const cx = num(tx + size / 2);
  const cy = num(ty + size / 2);
  return `<g transform="translate(${cx} ${cy}) scale(${num(scale)})">${body}</g>`;
}

/** A single sprite as a standalone SVG document on Vacuum. */
export function spriteToSvg(def: SpriteDef, size = 128): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" fill="${hex(PALETTE.vacuum)}"/>`,
    spriteToGroup(def, size),
    '</svg>',
  ].join('');
}
