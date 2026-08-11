/**
 * evidence/a0-22-bloom-colour/diff-goldens.mjs — what moved in each baseline, and
 * whether the backdrop can explain it. OWNER: Art Agent.
 *
 * The brief's standing rule for a re-baseline is "look at every image, justify
 * each change, and **say explicitly if any snapshot changed in a way the backdrop
 * cannot explain**". Forty-four plates is too many to hold in an eye alone, so
 * this measures each one first and the eye then goes to the ones the numbers
 * point at.
 *
 * Per baseline, HEAD's bytes against the working tree's:
 *  · differing pixels, and as a fraction of the frame;
 *  · the peak luma delta, and the mean over the pixels that moved;
 *  · the **hue** of the change — a bloom tint takes value OUT of a white halo and
 *    puts chroma in, so its signature is a negative mean ΔY′ with the blue and
 *    green channels falling less than red. Anything with a positive mean ΔY′, or
 *    a change concentrated somewhere a star cannot be, is the row to look at;
 *  · the bounding box of everything that moved, so a change inside a HUD panel
 *    cannot hide inside a frame-wide count.
 *
 * Three comparisons are needed to attribute a re-baseline honestly, and the
 * script takes each as a pair of sources so all three run through one instrument:
 *
 *   # what THIS BRANCH moved, against what main has committed
 *   node evidence/a0-22-bloom-colour/diff-goldens.mjs git:HEAD <dir> branch-vs-head
 *   # the NOISE FLOOR — two regenerations of one build (this came back a zero)
 *   node evidence/a0-22-bloom-colour/diff-goldens.mjs <dirA> <dirB> noise-floor
 *   # main's committed baselines against main REGENERATED in this container
 *   node evidence/a0-22-bloom-colour/diff-goldens.mjs git:origin/main <dir> main-drift
 *
 * `git:<ref>` reads the baseline out of a git object rather than the disk, so a
 * comparison never depends on a working tree being in a particular state.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DIR = 'tests/mobile/goldens.spec.ts-snapshots';

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const r2 = (x) => Math.round(x * 100) / 100;

const [FROM = 'git:HEAD', TO = join(ROOT, DIR), LABEL = 'branch-vs-head'] = process.argv.slice(2);

const names = execFileSync('git', ['ls-files', DIR], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((p) => p.replace(`${DIR}/`, ''));

/** One baseline's bytes, from a git ref or from a directory on disk. */
const load = (src, file) =>
  src.startsWith('git:')
    ? execFileSync('git', ['show', `${src.slice(4)}:${DIR}/${file}`], { cwd: ROOT, maxBuffer: 1 << 28 })
    : readFileSync(join(src, file));

const rows = [];
for (const name of names) {
  const head = PNG.sync.read(load(FROM, name));
  const now = PNG.sync.read(load(TO, name));
  if (head.width !== now.width || head.height !== now.height) {
    rows.push({ name, error: `size ${head.width}x${head.height} -> ${now.width}x${now.height}` });
    continue;
  }
  const n = head.width * head.height;
  let moved = 0;
  let peak = 0;
  let sumDY = 0;
  let sumDR = 0;
  let sumDG = 0;
  let sumDB = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = now.data[o] - head.data[o];
    const dg = now.data[o + 1] - head.data[o + 1];
    const db = now.data[o + 2] - head.data[o + 2];
    if (dr === 0 && dg === 0 && db === 0) continue;
    moved++;
    const dY = luma(now.data[o], now.data[o + 1], now.data[o + 2]) - luma(head.data[o], head.data[o + 1], head.data[o + 2]);
    sumDY += dY;
    sumDR += dr;
    sumDG += dg;
    sumDB += db;
    if (Math.abs(dY) > Math.abs(peak)) peak = dY;
    const x = i % head.width;
    const y = (i - x) / head.width;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  rows.push({
    name,
    w: head.width,
    h: head.height,
    moved,
    movedPct: r2((100 * moved) / n),
    peakDeltaY: r2(peak),
    meanDeltaY: moved ? r2(sumDY / moved) : 0,
    meanDeltaRGB: moved ? [r2(sumDR / moved), r2(sumDG / moved), r2(sumDB / moved)] : [0, 0, 0],
    box: moved ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  });
}

writeFileSync(join(HERE, `golden-diffs.${LABEL}.json`), JSON.stringify({ from: FROM, to: TO, rows }, null, 2));
console.log(`${FROM}  ->  ${TO}\n`);

const pad = (s, n) => String(s).padStart(n);
console.log(
  'baseline'.padEnd(52),
  'moved'.padStart(8),
  '%'.padStart(6),
  'peakΔY'.padStart(8),
  'meanΔY'.padStart(7),
  'meanΔRGB'.padStart(20),
);
for (const r of rows.sort((a, b) => (b.moved ?? 0) - (a.moved ?? 0))) {
  if (r.error) {
    console.log(r.name.padEnd(52), r.error);
    continue;
  }
  console.log(
    r.name.padEnd(52),
    pad(r.moved, 8),
    pad(r.movedPct, 6),
    pad(r.peakDeltaY, 8),
    pad(r.meanDeltaY, 7),
    pad(`[${r.meanDeltaRGB.join(', ')}]`, 20),
  );
}
const unchanged = rows.filter((r) => r.moved === 0).length;
console.log(`\n${rows.length - unchanged} of ${rows.length} baselines moved; ${unchanged} are byte-identical.`);
