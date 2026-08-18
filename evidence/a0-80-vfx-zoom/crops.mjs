/**
 * evidence/a0-80-vfx-zoom/crops.mjs — OWNER: UI Engineer (a0-80).
 *
 * The frames are a 798×384 phone at dpr 3, so an effect that lands 8 CSS px from
 * a hull is 24 px in a 2394×1152 image and easy to miss at page scale. This cuts
 * the same window out of every live frame — centred on the LOCAL SHIP, which the
 * camera holds at the middle of the viewport all match — so the before/after pair
 * can be read side by side without measuring anything.
 *
 * Nearest-neighbour, no resampling and no annotation: a crop is a crop of the
 * shipped pixels, not a drawing of them.
 *
 *     node evidence/a0-80-vfx-zoom/crops.mjs      # from the repo root (pngjs)
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const CROPS = join(HERE, 'crops');

/** The local ship's screen position, dpr 3 — `__planetRush.shipScreen` (399,192)
 *  times the device pixel ratio the frames were shot at. The camera centres it,
 *  so this is the same point in every live frame in the set (./readback-*.json). */
const SHIP = { x: 399 * 3, y: 192 * 3 };

/** Two windows: the neighbourhood, and the hull itself at 3x. */
const WINDOWS = [
  { name: 'ship', w: 560, h: 400, zoom: 1 },
  { name: 'hull', w: 200, h: 150, zoom: 3 },
];

function crop(src, dst, cx, cy, w, h, zoom) {
  const png = PNG.sync.read(readFileSync(src));
  const x0 = Math.max(0, Math.min(png.width - w, cx - (w >> 1)));
  const y0 = Math.max(0, Math.min(png.height - h, cy - (h >> 1)));
  const out = new PNG({ width: w * zoom, height: h * zoom });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = (((y0 + ((y / zoom) | 0)) * png.width + x0 + ((x / zoom) | 0)) << 2);
      const di = (y * out.width + x) << 2;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  writeFileSync(dst, PNG.sync.write(out));
}

mkdirSync(CROPS, { recursive: true });
// Thrust only, and deliberately: it is the effect the report names, and it is the
// one that is CONTINUOUSLY emitted, so a crop of it always has something in it.
// The live ore frames are in ./frames for completeness, but a pickup is ten
// sub-pixel particles at the 2x rung and a crop of one proves nothing either way
// — the deterministic ore and explosion evidence is the frozen sheet, whose
// forty-two pinned particles are legible at full frame size.
for (const label of ['before', 'after']) {
  for (const effect of ['thrust']) {
    for (const rung of ['1x', '1_5x', '2x']) {
      for (const win of WINDOWS) {
        const src = join(FRAMES, `${label}-${effect}-${rung}.png`);
        const dst = join(CROPS, `${label}-${effect}-${rung}-${win.name}.png`);
        crop(src, dst, SHIP.x, SHIP.y, win.w, win.h, win.zoom);
        process.stdout.write(`${dst}\n`);
      }
    }
  }
}
