/**
 * evidence/a0-88-minimap/stack.mjs — read the pair, at a size a human eye can
 * actually judge. OWNER: UI Engineer (a0-88). Analysis tool, not a golden and not
 * a test.
 *
 * The whole report is about legibility at a few pixels, so the evidence cannot be
 * two thumbnails. This nearest-neighbour upscales the BEFORE and AFTER crops of
 * the same frame and puts them side by side with a rule between — nearest
 * neighbour on purpose: a smoothing resample would invent the very edge quality
 * the question is about.
 *
 * Usage:
 *   node evidence/a0-88-minimap/stack.mjs <name> [scale]
 *     e.g. node evidence/a0-88-minimap/stack.mjs collapsed-2x 4
 * Reads  shots/before-<name>-map.png + shots/after-<name>-map.png
 * Writes shots/compare-<name>.png
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
const name = process.argv[2];
const SCALE = Number(process.argv[3] ?? 4);
const GAP = 12;
if (!name) {
  console.error('usage: node stack.mjs <name> [scale]');
  process.exit(2);
}

function upscale(png, scale) {
  const out = new PNG({ width: png.width * scale, height: png.height * scale });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = (png.width * ((y / scale) | 0) + ((x / scale) | 0)) << 2;
      const di = (out.width * y + x) << 2;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (src.width * y + x) << 2;
      const di = (dst.width * (y + oy) + (x + ox)) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
}

const paths = ['before', 'after'].map((half) => join(SHOTS, `${half}-${name}-map.png`));
for (const p of paths) {
  if (!existsSync(p)) {
    console.error(`missing ${p} — capture that half first`);
    process.exit(1);
  }
}
const [a, b] = paths.map((p) => upscale(PNG.sync.read(readFileSync(p)), SCALE));

const out = new PNG({ width: a.width + GAP + b.width, height: Math.max(a.height, b.height) });
out.data.fill(0x1a); // a neutral gutter, so the two frames' own edges are legible
blit(out, a, 0, 0);
blit(out, b, a.width + GAP, 0);
const dest = join(SHOTS, `compare-${name}.png`);
writeFileSync(dest, PNG.sync.write(out));
console.log(`wrote ${dest}  (${out.width}×${out.height}, ${SCALE}× nearest-neighbour; left = before, right = after)`);
