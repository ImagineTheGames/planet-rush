/**
 * evidence/a0-123-fewer-blooms-loose-crosses/golden-crop.mjs — one region of a
 * golden pair, side by side and enlarged. OWNER: Art Agent.
 *
 * "Look at every image with your own eyes" is the rule, and at 1:1 the things
 * this brief moves are a 0.7 px line and a faint wash. This puts BEFORE on the
 * left and AFTER on the right at an integer zoom, from the same crop of each, so
 * the comparison is a look rather than a number.
 *
 * It is nearest-neighbour on purpose: a smooth resample would invent gradients
 * exactly where the question is whether a faint gradient is there.
 *
 * Usage: node golden-crop.mjs <before.png> <after.png> <out.png> <x> <y> <w> <h> [zoom]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require(new URL('../../node_modules/pngjs/lib/png.js', import.meta.url).pathname);

const [a, b, out, X, Y, W, H, Z] = process.argv.slice(2);
if (!a || !b || !out || X === undefined) {
  console.error('usage: node golden-crop.mjs <before> <after> <out> <x> <y> <w> <h> [zoom]');
  process.exit(2);
}
const x0 = +X;
const y0 = +Y;
const w = +W;
const h = +H;
const z = +(Z ?? 4);
const A = PNG.sync.read(readFileSync(a));
const B = PNG.sync.read(readFileSync(b));
/** A white gutter, so "where does BEFORE end" is never a judgement call. */
const GAP = 8;
const o = new PNG({ width: (w * 2 + GAP) * z, height: h * z });
o.data.fill(255);
const put = (S, dx) => {
  for (let y = 0; y < h * z; y++) {
    for (let x = 0; x < w * z; x++) {
      const sx = x0 + Math.floor(x / z);
      const sy = y0 + Math.floor(y / z);
      const di = (y * o.width + (x + dx)) * 4;
      o.data[di + 3] = 255;
      if (sx < 0 || sy < 0 || sx >= S.width || sy >= S.height) continue;
      const si = (sy * S.width + sx) * 4;
      o.data[di] = S.data[si];
      o.data[di + 1] = S.data[si + 1];
      o.data[di + 2] = S.data[si + 2];
    }
  }
};
put(A, 0);
put(B, (w + GAP) * z);
writeFileSync(out, PNG.sync.write(o));
console.log(`${out} — left BEFORE, right AFTER, ${w}x${h} at ${z}x from (${x0},${y0})`);
