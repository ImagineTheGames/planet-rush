/**
 * evidence/a0-40-backdrop-matches-mockup/plate.ts — a PNG rasterizer for
 * `SpriteDef`s, in plain TS. OWNER: Art Agent.
 *
 * There is no browser and no SVG rasterizer in this container (no playwright
 * browsers, no `rsvg-convert`), and a0-40 changes what the backdrop RENDERS — so
 * the golden re-bake has to be looked at, and something has to turn shapes into
 * pixels. This is that something.
 *
 * It composites the game's own shapes through {@link inkAlphaAt}, which is the
 * single definition of "how bright is this ink here" that `backdrop.test.ts`,
 * `sky-preview.ts` and the CPU rasterizer all share. A plate therefore cannot
 * flatter the build: if a number is wrong the plate is wrong in the same way.
 *
 * 2× supersampled and box-averaged down, which is enough to keep a 0.4 px star
 * from aliasing away — the smallest thing the design draws.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { inkAlphaAt, type Shape } from '../../src/art/shapes';

/** Supersampling factor. */
export const SS = 2;

export interface Buffer {
  readonly w: number;
  readonly h: number;
  readonly px: Float64Array;
}

export function unpack(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

export function ground(w: number, h: number, color: number): Buffer {
  const [r, g, b] = unpack(color);
  const px = new Float64Array(w * h * SS * SS * 3);
  for (let i = 0; i < px.length; i += 3) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  }
  return { w, h, px };
}

function boundsOf(s: Shape): { minX: number; maxX: number; minY: number; maxY: number } {
  if (s.path.kind === 'circle') {
    return {
      minX: s.path.cx - s.path.r,
      maxX: s.path.cx + s.path.r,
      minY: s.path.cy - s.path.r,
      maxY: s.path.cy + s.path.r,
    };
  }
  const p = s.path.points;
  let a = Infinity;
  let b = -Infinity;
  let c = Infinity;
  let d = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    a = Math.min(a, p[i]!);
    b = Math.max(b, p[i]!);
    c = Math.min(c, p[i + 1]!);
    d = Math.max(d, p[i + 1]!);
  }
  return { minX: a, maxX: b, minY: c, maxY: d };
}

function inShape(s: Shape, x: number, y: number): boolean {
  if (s.path.kind === 'circle') {
    const dx = x - s.path.cx;
    const dy = y - s.path.cy;
    return dx * dx + dy * dy <= s.path.r * s.path.r;
  }
  const p = s.path.points;
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i]!;
    const yi = p[i + 1]!;
    const xj = p[j]!;
    const yj = p[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Paint one shape into the buffer, painter's algorithm, over its bbox only. */
export function paint(buf: Buffer, s: Shape, additive: boolean): void {
  const cols = buf.w * SS;
  const rows = buf.h * SS;
  const toCol = (x: number): number => (x + buf.w / 2) * SS;
  const toRow = (y: number): number => (y + buf.h / 2) * SS;

  if (s.fill) {
    const bb = boundsOf(s);
    const c0 = Math.max(0, Math.floor(toCol(bb.minX)));
    const c1 = Math.min(cols - 1, Math.ceil(toCol(bb.maxX)));
    const r0 = Math.max(0, Math.floor(toRow(bb.minY)));
    const r1 = Math.min(rows - 1, Math.ceil(toRow(bb.maxY)));
    const [sr, sg, sb] = unpack(s.fill.color);
    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) / SS - buf.h / 2;
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) / SS - buf.w / 2;
        if (!inShape(s, x, y)) continue;
        const a = inkAlphaAt(s.fill, x, y);
        if (a <= 0) continue;
        const i = (r * cols + c) * 3;
        if (additive) {
          buf.px[i] = Math.min(255, buf.px[i]! + sr * a);
          buf.px[i + 1] = Math.min(255, buf.px[i + 1]! + sg * a);
          buf.px[i + 2] = Math.min(255, buf.px[i + 2]! + sb * a);
        } else {
          buf.px[i] = buf.px[i]! * (1 - a) + sr * a;
          buf.px[i + 1] = buf.px[i + 1]! * (1 - a) + sg * a;
          buf.px[i + 2] = buf.px[i + 2]! * (1 - a) + sb * a;
        }
      }
    }
  }

  // A stroked polyline — the star's diffraction cross, and the only stroke the
  // backdrop draws. Walked along its segments as a band of the stroke's width.
  if (s.stroke && s.path.kind === 'poly') {
    const p = s.path.points;
    const [sr, sg, sb] = unpack(s.stroke.color);
    const half = Math.max(s.stroke.width, 0.5) / 2;
    const a = s.stroke.alpha;
    // Distance-to-segment, sample by sample, over the segment's own bbox. A
    // stamped kernel would have drawn the arms three times their width, which on
    // a plate whose whole job is "does the cross read as subtle" would be the
    // plate answering the question rather than the art.
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i]!;
      const y0 = p[i + 1]!;
      const x1 = p[i + 2]!;
      const y1 = p[i + 3]!;
      const c0 = Math.max(0, Math.floor(toCol(Math.min(x0, x1) - half)));
      const c1 = Math.min(cols - 1, Math.ceil(toCol(Math.max(x0, x1) + half)));
      const r0 = Math.max(0, Math.floor(toRow(Math.min(y0, y1) - half)));
      const r1 = Math.min(rows - 1, Math.ceil(toRow(Math.max(y0, y1) + half)));
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len2 = dx * dx + dy * dy || 1;
      for (let r = r0; r <= r1; r++) {
        const y = (r + 0.5) / SS - buf.h / 2;
        for (let c = c0; c <= c1; c++) {
          const x = (c + 0.5) / SS - buf.w / 2;
          const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
          if (Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t)) > half) continue;
          const idx = (r * cols + c) * 3;
          buf.px[idx] = buf.px[idx]! * (1 - a) + sr * a;
          buf.px[idx + 1] = buf.px[idx + 1]! * (1 - a) + sg * a;
          buf.px[idx + 2] = buf.px[idx + 2]! * (1 - a) + sb * a;
        }
      }
    }
  }
}

/** Box-average the supersampled buffer down and write it out. */
/** Box-average the supersampled buffer down and write it out as a PNG. */
export function write(buf: Buffer, dir: string, name: string): void {
  const png = new PNG({ width: buf.w, height: buf.h });
  const cols = buf.w * SS;
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * cols + (x * SS + sx)) * 3;
          r += buf.px[i]!;
          g += buf.px[i + 1]!;
          b += buf.px[i + 2]!;
        }
      }
      const n = SS * SS;
      const o = (y * buf.w + x) * 4;
      png.data[o] = Math.round(r / n);
      png.data[o + 1] = Math.round(g / n);
      png.data[o + 2] = Math.round(b / n);
      png.data[o + 3] = 255;
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name), PNG.sync.write(png));
}

