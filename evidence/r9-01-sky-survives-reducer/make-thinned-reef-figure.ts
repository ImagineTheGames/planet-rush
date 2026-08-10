/**
 * evidence/r9-01-sky-survives-reducer/make-thinned-reef-figure.ts — what the
 * player actually gets when a sky thins. OWNER: Art Agent.
 *
 * The live probe proves the reef **stays on the stage**. It cannot show the
 * *thinned* reef, because that is the whole point of the pin: a sky already on
 * the stage never changes density, so `reducedDensity` only ever applies to a sky
 * built while the tier is already throttled — the next map, or a boot with the
 * manual reduce-VFX setting on. That case still has to be looked at rather than
 * argued about, so this renders it.
 *
 * It is a **true** composite, not an SVG approximation: the reef is the only
 * additive sky in the set, and additive light *accumulates* where normal blending
 * converges (see `ADDITIVE_STOPS` in backdrop.ts — getting this wrong is what made
 * the first Plasma Reef a disqualifier). So the pixels here are integrated with
 * the same per-channel additive accumulation `backdrop.test.ts` measures peak luma
 * with, over the same Floor ground, at the same per-screen authoring the renderer
 * uses. What you see is what the frame does.
 *
 *   npx vite-node evidence/r9-01-sky-survives-reducer/make-thinned-reef-figure.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  FLOOR,
} from '../../src/art/palette';
import {
  NEBULAE,
  SKY_PARALLAX,
  VOID_SEED,
  coverSpan,
  nebulaSprite,
  reducedSkyDensity,
  starFieldSprite,
  STAR_LAYERS,
} from '../../src/art/backdrop';
import { pointInPoly } from '../../src/art/raster';
import type { Shape } from '../../src/art/shapes';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A landscape phone screen — the viewport the sky is authored against. */
const SCREEN = { w: 844, h: 390 } as const;
/** The Oval's arena, so the field is the one the renderer really builds. */
const ARENA = { w: 3200, h: 2000 } as const;
/** Output scale: the figure is rendered at 2× the screen for a legible plate. */
const SCALE = 2;

function unpack(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function covers(shape: Shape, x: number, y: number): boolean {
  if (!shape.fill) return false;
  if (shape.path.kind === 'circle') {
    const dx = x - shape.path.cx;
    const dy = y - shape.path.cy;
    return dx * dx + dy * dy <= shape.path.r * shape.path.r;
  }
  return shape.path.closed && pointInPoly(shape.path.points, x, y);
}

/** Ground, then the star-field, then the sky — the frame's own composite order
 *  for a sky of light (Plasma Reef does not occlude). */
function frame(density: number): { shapes: Shape[]; additive: boolean[] } {
  const fw = coverSpan(SKY_PARALLAX, SCREEN.w, ARENA.w);
  const fh = coverSpan(SKY_PARALLAX, SCREEN.h, ARENA.h);
  const shapes: Shape[] = [];
  const additive: boolean[] = [];
  for (const layer of STAR_LAYERS) {
    const w = coverSpan(layer.parallax, SCREEN.w, ARENA.w);
    const h = coverSpan(layer.parallax, SCREEN.h, ARENA.h);
    for (const s of starFieldSprite(layer, VOID_SEED, w, h).shapes) {
      shapes.push(s);
      additive.push(false);
    }
  }
  for (const s of nebulaSprite('plasmaReef', VOID_SEED, fw, fh, density, SCREEN.w, SCREEN.h).shapes) {
    shapes.push(s);
    additive.push(true);
  }
  return { shapes, additive };
}

function render(density: number): PNG {
  const { shapes, additive } = frame(density);
  const w = SCREEN.w * SCALE;
  const h = SCREEN.h * SCALE;
  const png = new PNG({ width: w, height: h });
  const ground = unpack(FLOOR);
  for (let py = 0; py < h; py++) {
    const y = (py + 0.5) / SCALE - SCREEN.h / 2;
    for (let px = 0; px < w; px++) {
      const x = (px + 0.5) / SCALE - SCREEN.w / 2;
      const out: [number, number, number] = [...ground];
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i]!;
        if (!s.fill || !covers(s, x, y)) continue;
        const [r, g, b] = unpack(s.fill.color);
        const a = s.fill.alpha;
        if (additive[i]) {
          out[0] = Math.min(255, out[0] + r * a);
          out[1] = Math.min(255, out[1] + g * a);
          out[2] = Math.min(255, out[2] + b * a);
        } else {
          out[0] = out[0] * (1 - a) + r * a;
          out[1] = out[1] * (1 - a) + g * a;
          out[2] = out[2] * (1 - a) + b * a;
        }
      }
      const o = (py * w + px) * 4;
      png.data[o] = Math.round(out[0]);
      png.data[o + 1] = Math.round(out[1]);
      png.data[o + 2] = Math.round(out[2]);
      png.data[o + 3] = 255;
    }
  }
  return png;
}

const REDUCED = reducedSkyDensity(NEBULAE.plasmaReef);
for (const [name, density] of [
  ['full', 1],
  ['reduced', REDUCED],
] as const) {
  const png = render(density);
  const file = join(HERE, '..', 'images', `r9-01-plasma-reef-${name}.png`);
  writeFileSync(file, PNG.sync.write(png));
  const shapes = nebulaSprite(
    'plasmaReef',
    VOID_SEED,
    coverSpan(SKY_PARALLAX, SCREEN.w, ARENA.w),
    coverSpan(SKY_PARALLAX, SCREEN.h, ARENA.h),
    density,
    SCREEN.w,
    SCREEN.h,
  ).shapes.length;
  console.log(`${name.padEnd(8)} density ${density}  reef shapes ${String(shapes).padStart(4)}  -> ${file}`);
}
