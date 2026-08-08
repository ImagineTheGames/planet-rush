/**
 * evidence/a0-03-wheel-cost/crop.mjs — pull one region out of a golden pair.
 * OWNER: UI Engineer (a0-03). Analysis tool, not a golden and not a test.
 *
 * `localize-diffs.mjs` says WHERE a frame moved; this says WHAT moved, by
 * stacking the stored golden over the freshly-rendered frame at 4× so 11 px
 * caption text is legible. Re-baselining a frame without reading both halves of
 * this is how another lane's drift gets absorbed into a UI branch's diff.
 *
 * Usage: node evidence/a0-03-wheel-cost/crop.mjs <test-results-dir> x0 y0 x1 y1 [out.png]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const [dir, ...rest] = process.argv.slice(2);
const [x0, y0, x1, y1] = rest.slice(0, 4).map(Number);
const out = rest[4] ?? 'crop.png';
const SCALE = 4;
const GAP = 8;

let expected;
let actual;
for (const f of readdirSync(dir)) {
  if (f.endsWith('-expected.png')) expected = join(dir, f);
  if (f.endsWith('-actual.png')) actual = join(dir, f);
}

const a = PNG.sync.read(readFileSync(expected));
const b = PNG.sync.read(readFileSync(actual));
const w = x1 - x0;
const h = y1 - y0;

// Stacked: stored golden on top, fresh render below, a magenta rule between.
const dst = new PNG({ width: w * SCALE, height: (h * 2 + GAP) * SCALE });
function blit(src, dstYOffset) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (src.width * (y + y0) + (x + x0)) << 2;
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          const di = (dst.width * ((y + dstYOffset) * SCALE + sy) + x * SCALE + sx) << 2;
          dst.data[di] = src.data[si];
          dst.data[di + 1] = src.data[si + 1];
          dst.data[di + 2] = src.data[si + 2];
          dst.data[di + 3] = 255;
        }
      }
    }
  }
}
blit(a, 0);
blit(b, h + GAP);
for (let y = h * SCALE; y < (h + GAP) * SCALE; y++) {
  for (let x = 0; x < dst.width; x++) {
    const di = (dst.width * y + x) << 2;
    dst.data[di] = 255;
    dst.data[di + 1] = 0;
    dst.data[di + 2] = 255;
    dst.data[di + 3] = 255;
  }
}
writeFileSync(out, PNG.sync.write(dst));
console.log(`${out}  (top = stored golden, bottom = fresh render)`);
