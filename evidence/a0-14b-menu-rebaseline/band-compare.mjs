/**
 * evidence/a0-14b-menu-rebaseline/band-compare.mjs — WHERE did the frame change?
 * OWNER: UI Engineer.
 *
 * a0-14 appends a fourth door (HANGAR) to the main menu, so the two menu goldens
 * must move. The question a re-baseline has to answer before it is accepted is
 * not "did it change" but "did ONLY the new row change" — the brief's words: if
 * anything else moved, that is a bug in the hangar's layout, not a baseline to
 * accept.
 *
 * Eyes on two 844x390 frames cannot prove that. This can: it walks the two PNGs
 * row by row and prints the contiguous bands that differ, so the claim
 * "the header is untouched" is a measurement rather than an impression.
 *
 *   node evidence/a0-14b-menu-rebaseline/band-compare.mjs OLD.png NEW.png [threshold]
 *
 * `threshold` is the per-channel 0-255 delta a pixel must exceed to count.
 * Default 8 — above the antialiasing/compositing noise that a dpr-3 frame carries
 * between runs, below any real change in what is drawn. Pass 1 to see the noise
 * floor too (it is large, and it is why the default is not 1).
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [, , aPath, bPath, thresholdArg] = process.argv;
const THRESHOLD = Number(thresholdArg ?? 8);
const a = PNG.sync.read(readFileSync(aPath));
const b = PNG.sync.read(readFileSync(bPath));
if (a.width !== b.width || a.height !== b.height) {
  console.log(`SIZE DIFFERS: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  process.exit(1);
}

console.log(`${aPath}\n  vs ${bPath}`);
console.log(`size ${a.width}x${a.height}, per-channel threshold ${THRESHOLD}/255\n`);

const rows = [];
let total = 0;
for (let y = 0; y < a.height; y++) {
  let n = 0;
  let minX = Infinity;
  let maxX = -1;
  for (let x = 0; x < a.width; x++) {
    const i = (a.width * y + x) << 2;
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    if (d > THRESHOLD) {
      n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  rows.push({ n, minX, maxX });
  total += n;
}

console.log(`differing px: ${total} (ratio ${(total / (a.width * a.height)).toFixed(4)})`);
console.log('bands that differ:');
let start = -1;
let bands = 0;
for (let y = 0; y <= a.height; y++) {
  const d = y < a.height && rows[y].n > 0;
  if (d && start < 0) start = y;
  if (!d && start >= 0) {
    const seg = rows.slice(start, y);
    const x0 = Math.min(...seg.map((r) => r.minX));
    const x1 = Math.max(...seg.map((r) => r.maxX));
    console.log(
      `  y ${String(start).padStart(4)}–${String(y - 1).padStart(4)} ` +
        `(${String(y - start).padStart(3)} rows)  x ${String(x0).padStart(4)}–${String(x1).padStart(4)}  ` +
        `max ${String(Math.max(...seg.map((r) => r.n))).padStart(4)} px/row`,
    );
    bands++;
    start = -1;
  }
}
if (bands === 0) console.log('  (none — the frames agree above the threshold)');
