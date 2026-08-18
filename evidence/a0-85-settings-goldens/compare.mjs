/**
 * evidence/a0-85-settings-goldens/compare.mjs — is the merged frame NEITHER side?
 * OWNER: UI Engineer (a0-85). Analysis tool, not a golden and not a test.
 *
 * a0-77 and a0-79 both re-baselined the three settings goldens; the merge is a
 * binary conflict on all three. Picking a side is always wrong here — `--ours`
 * ships a screen without a0-79's plate geometry, `--theirs` ships one without
 * a0-77's `?` marks — so the resolution is a frame rendered FROM the merged
 * tree, and the proof that it IS that frame is that it differs from BOTH sides,
 * each time in the region the OTHER brief changed.
 *
 * The clustering is a0-03's (`evidence/a0-03-wheel-cost/localize-diffs.mjs`),
 * lifted verbatim, because pixel COUNT cannot separate signal from font/GPU
 * antialiasing and position can. What changed is only the input: this takes two
 * explicit paths rather than walking `test-results/`, since the pair under
 * comparison here is two committed baselines, not an expected/actual pair.
 *
 * Usage: node evidence/a0-85-settings-goldens/compare.mjs <a.png> <b.png>
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

function analyse(expected, actual) {
  const a = PNG.sync.read(readFileSync(expected));
  const b = PNG.sync.read(readFileSync(actual));
  if (a.width !== b.width || a.height !== b.height) return { resized: true };

  const pts = [];
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (a.width * y + x) << 2;
      const d =
        Math.abs(a.data[i] - b.data[i]) +
        Math.abs(a.data[i + 1] - b.data[i + 1]) +
        Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 24) pts.push([x, y]);
    }
  }
  if (!pts.length) return { count: 0, size: [a.width, a.height], clusters: [] };

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

const [, , A, B] = process.argv;
if (!A || !B) {
  console.error('usage: node compare.mjs <a.png> <b.png>');
  process.exit(2);
}
const r = analyse(A, B);
if (r.resized) {
  console.log(`${A}\n  vs ${B}\n    RESIZED — different dimensions`);
} else {
  const px = r.size[0] * r.size[1];
  const top = r.clusters.slice(0, 6).map((c) => `${c.n}px@[${c.box.join(',')}]`).join(' ');
  console.log(
    `${A}\n  vs ${B}\n    ${r.count} changed of ${r.size.join('x')} ` +
      `(${((r.count / px) * 100).toFixed(2)}%) | ${r.clusters.length} clusters | ${top}`,
  );
}
