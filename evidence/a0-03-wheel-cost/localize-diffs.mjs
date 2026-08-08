/**
 * evidence/a0-03-wheel-cost/localize-diffs.mjs — WHERE did each golden move?
 * OWNER: UI Engineer (a0-03). Analysis tool, not a golden and not a test.
 *
 * A label change is ~0.03% of a 1.02 MP frame, so it passes `maxDiffPixelRatio:
 * 0.01` untouched — the golden suite is green while the stored PNGs still show
 * `6/8` and `BANKED`. Re-running at tolerance 0 makes 30 of 35 frames "differ",
 * but most of that is font/GPU antialiasing, which is exactly what the 1%
 * tolerance is for.
 *
 * So pixel COUNT cannot tell signal from noise. Position can: this walks each
 * failing test's expected/actual pair and reports the bounding box and the
 * connected clusters of changed pixels. A caption swap is one tight cluster in a
 * known corner; AA noise is a scatter of single pixels across the frame.
 *
 * Usage: node evidence/a0-03-wheel-cost/localize-diffs.mjs
 */
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const ROOT = 'test-results';

/** Changed pixels, grouped into clusters by simple grid-bucket adjacency. */
function analyse(expected, actual) {
  const a = PNG.sync.read(readFileSync(expected));
  const b = PNG.sync.read(readFileSync(actual));
  if (a.width !== b.width || a.height !== b.height) return { resized: true };

  const pts = [];
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (a.width * y + x) << 2;
      // Ignore imperceptible per-channel drift; an AA edge moves by a lot less
      // than a glyph appearing or vanishing.
      const d =
        Math.abs(a.data[i] - b.data[i]) +
        Math.abs(a.data[i + 1] - b.data[i + 1]) +
        Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 24) pts.push([x, y]);
    }
  }
  if (!pts.length) return { count: 0, clusters: [] };

  // Bucket into 24 px cells, then merge touching cells — enough to tell "one
  // word changed here" from "single pixels sprayed everywhere".
  const CELL = 24;
  const cells = new Map();
  for (const [x, y] of pts) {
    const k = `${(x / CELL) | 0},${(y / CELL) | 0}`;
    cells.set(k, (cells.get(k) ?? 0) + 1);
  }
  const seen = new Set();
  const clusters = [];
  for (const k of cells.keys()) {
    if (seen.has(k)) continue;
    const queue = [k];
    seen.add(k);
    let n = 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    while (queue.length) {
      const cur = queue.pop();
      const [cx, cy] = cur.split(',').map(Number);
      n += cells.get(cur);
      x0 = Math.min(x0, cx * CELL);
      y0 = Math.min(y0, cy * CELL);
      x1 = Math.max(x1, cx * CELL + CELL);
      y1 = Math.max(y1, cy * CELL + CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nk = `${cx + dx},${cy + dy}`;
          if (cells.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            queue.push(nk);
          }
        }
      }
    }
    clusters.push({ n, box: [x0, y0, x1, y1] });
  }
  clusters.sort((p, q) => q.n - p.n);
  return { count: pts.length, size: [a.width, a.height], clusters };
}

for (const dir of readdirSync(ROOT).sort()) {
  const d = join(ROOT, dir);
  if (!statSync(d).isDirectory()) continue;
  let expected;
  let actual;
  for (const f of readdirSync(d)) {
    if (f.endsWith('-expected.png')) expected = join(d, f);
    if (f.endsWith('-actual.png')) actual = join(d, f);
  }
  if (!expected || !actual || !existsSync(expected)) continue;
  const r = analyse(expected, actual);
  const top = (r.clusters ?? [])
    .slice(0, 4)
    .map((c) => `${c.n}px@[${c.box.join(',')}]`)
    .join(' ');
  console.log(`${dir}\n    ${r.count} changed of ${r.size?.join('x')} | ${r.clusters?.length} clusters | ${top}`);
}
