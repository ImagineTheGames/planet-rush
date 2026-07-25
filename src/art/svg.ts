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
import type { Shape, SpriteDef } from './shapes';

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

function paintAttrs(shape: Shape): string {
  const attrs: string[] = [];
  if (shape.fill) {
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
  if (shape.path.kind === 'circle') {
    const { cx, cy, r } = shape.path;
    return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" ${paint}/>`;
  }
  const tag = shape.path.closed ? 'polygon' : 'polyline';
  return `<${tag} points="${pointsAttr(shape.path.points)}" ${paint}/>`;
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
