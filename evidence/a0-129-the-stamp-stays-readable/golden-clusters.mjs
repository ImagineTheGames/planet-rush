/**
 * evidence/a0-129-the-stamp-stays-readable/golden-clusters.mjs — WHERE did each
 * re-baselined golden move? OWNER: UI Engineer (a0-129). Analysis tool, not a
 * golden and not a test.
 *
 * a0-03's method, and it is needed for the same reason: at the gate's
 * `maxDiffPixelRatio: 0.01` a footer plate moving 3px on a desktop is 0.1% of the
 * frame, so the golden stays green while the stored PNG shows the plate where it
 * used to be. Re-running at tolerance 0 finds those — and also finds every frame
 * whose only difference is font/GPU antialiasing, which is exactly what the 1%
 * tolerance exists for. Pixel COUNT cannot tell those apart. POSITION can.
 *
 * So this walks every golden this branch re-baselined, diffs it against the same
 * file on `origin/main`, and reports the changed pixels' bounding box and their
 * grid clusters. This brief's signature is one tight cluster along the bottom of
 * the frame, at the footer beam, and nothing anywhere else.
 *
 * Usage: node evidence/a0-129-the-stamp-stays-readable/golden-clusters.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { HERE } from './lib.mjs';

const BASE = process.env.GOLDEN_BASE ?? 'origin/main';
const DIR = 'tests/mobile/goldens.spec.ts-snapshots';

/** The goldens this branch rewrote, from git itself rather than from a list. */
const changed = execFileSync('git', ['diff', '--name-only', BASE, '--', DIR], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/** Changed pixels grouped by 32px grid buckets — a plate that moved is one run of
 *  adjacent buckets; antialiasing is a scatter of isolated ones. */
function analyse(before, after) {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) return { error: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  const G = 32;
  const buckets = new Map();
  let count = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (a.width * y + x) * 4;
      if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]) continue;
      count++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      const key = `${Math.floor(x / G)},${Math.floor(y / G)}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  const total = a.width * a.height;
  // The heaviest buckets, and how far up the frame the changed pixels reach —
  // the two numbers that say "this is the footer and nothing else".
  const top = [...buckets.entries()]
    .sort((p, q) => q[1] - p[1])
    .slice(0, 4)
    .map(([k, n]) => `[${k.split(',').map((v) => Number(v) * G).join(',')}]:${n}`);
  return {
    size: `${a.width}x${a.height}`,
    changed: count,
    ratio: `${((count / total) * 100).toFixed(3)}%`,
    bbox: count ? { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } : null,
    /** How far the changed region sits from the BOTTOM of the frame, in px. */
    fromBottom: count ? a.height - (y1 + 1) : null,
    /** …and how much of the frame's height is above the topmost changed pixel. */
    fromTop: count ? y0 : null,
    buckets: buckets.size,
    heaviest: top,
  };
}

const report = [];
for (const path of changed) {
  const before = execFileSync('git', ['show', `${BASE}:${path}`], { maxBuffer: 64 * 1024 * 1024 });
  const after = readFileSync(path);
  const r = analyse(before, after);
  report.push({ golden: path.replace(`${DIR}/`, ''), ...r });
  console.log(
    `${path.replace(`${DIR}/`, '').padEnd(48)} ${String(r.changed).padStart(8)} px  ${String(r.ratio).padStart(8)}  ` +
      `bbox ${JSON.stringify(r.bbox)}  top=${r.fromTop} bottom=${r.fromBottom}  heaviest ${r.heaviest?.join(' ')}`,
  );
}
mkdirSync(join(HERE, 'shots'), { recursive: true });
writeFileSync(join(HERE, 'shots', 'golden-clusters.json'), `${JSON.stringify({ base: BASE, report }, null, 2)}\n`);
