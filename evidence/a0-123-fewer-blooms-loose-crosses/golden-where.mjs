/**
 * evidence/a0-123-fewer-blooms-loose-crosses/golden-where.mjs — WHERE a golden
 * moved, and by how much per pixel. OWNER: Art Agent.
 *
 * `../measure-golden-diff.mjs` prices a re-shoot by Playwright's own comparator,
 * which is the right number for "does this pass the gate". It cannot say what
 * moved, and on this brief that mattered twice:
 *
 *  - **10 of the 41 rewritten baselines carry no art change at all.** Their whole
 *    difference is a 38x8 box at the build-hash watermark. A bbox separates them
 *    from the 31 that actually carry the star field, which a pixel COUNT cannot.
 *  - **`desktop-pause-confirm` looked like an outlier** — 649k raw differing
 *    pixels against ~90k for comparable frames — and the delta histogram showed
 *    95% of them differing by exactly ONE code value. That is a scrim
 *    re-quantising, not art, and it is what sent this brief to a fresh `main`
 *    capture, where the frame turned out to be stale before the branch existed.
 *
 * Raw byte equality, deliberately: no perceptual threshold, so a 1-code-value
 * haze is visible here rather than rounded away. That is the point — the gate
 * already tells you what it can see, and this tells you what it cannot.
 *
 * Usage: node golden-where.mjs <before.png> <after.png>
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require(new URL('../../node_modules/pngjs/lib/png.js', import.meta.url).pathname);

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: node golden-where.mjs <before.png> <after.png>');
  process.exit(2);
}
const A = PNG.sync.read(readFileSync(a));
const B = PNG.sync.read(readFileSync(b));
if (A.width !== B.width || A.height !== B.height) {
  console.error(`size mismatch: ${A.width}x${A.height} vs ${B.width}x${B.height}`);
  process.exit(1);
}

let x0 = Infinity;
let y0 = Infinity;
let x1 = -1;
let y1 = -1;
let n = 0;
const hist = new Map();
for (let y = 0; y < A.height; y++) {
  for (let x = 0; x < A.width; x++) {
    const i = (y * A.width + x) * 4;
    const d = Math.max(
      Math.abs(A.data[i] - B.data[i]),
      Math.abs(A.data[i + 1] - B.data[i + 1]),
      Math.abs(A.data[i + 2] - B.data[i + 2]),
    );
    if (d === 0) continue;
    n++;
    hist.set(d, (hist.get(d) ?? 0) + 1);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
}
if (n === 0) {
  console.log(`identical (${A.width}x${A.height})`);
  process.exit(0);
}
const w = x1 - x0 + 1;
const h = y1 - y0 + 1;
const whole = w > A.width * 0.9 && h > A.height * 0.9;
console.log(
  `${n} px differ (raw)  bbox ${w}x${h} at (${x0},${y0})  frame ${A.width}x${A.height}  ` +
    `${whole ? 'WHOLE FRAME' : 'localised'}`,
);
const keys = [...hist.keys()].sort((p, q) => p - q);
let cum = 0;
for (const k of keys) {
  cum += hist.get(k);
  if (k <= 4 || k === keys[keys.length - 1] || hist.get(k) > n * 0.02) {
    console.log(`   delta ${String(k).padStart(3)}: ${String(hist.get(k)).padStart(7)}  (cum ${((100 * cum) / n).toFixed(1)}%)`);
  }
}
