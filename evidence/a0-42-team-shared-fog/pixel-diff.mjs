/**
 * evidence/a0-42-team-shared-fog/pixel-diff.mjs — how many pixels moved, and where.
 *
 * Counts differing pixels between two PNGs of the same size and reports the
 * bounding box of the difference. Used on the control captures (the same frozen
 * scenes shot off a build of `origin/main` and a build of this branch, on the
 * same box) so "FFA did not move" and "the teams frame moved, in the minimap and
 * nowhere else" are measurements rather than impressions.
 *
 *   node evidence/a0-42-team-shared-fog/pixel-diff.mjs A.png B.png
 */
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2);
const A = PNG.sync.read(readFileSync(a));
const B = PNG.sync.read(readFileSync(b));
if (A.width !== B.width || A.height !== B.height) throw new Error('size mismatch');

let n = 0;
let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
for (let y = 0; y < A.height; y++) {
  for (let x = 0; x < A.width; x++) {
    const i = (y * A.width + x) * 4;
    if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) {
      n++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
}
const total = A.width * A.height;
console.log(
  `${a.split('/').pop()}  ${n} / ${total} px differ (${((100 * n) / total).toFixed(3)}%)` +
    (n ? `  bbox x ${x0}..${x1}, y ${y0}..${y1}` : ''),
);
