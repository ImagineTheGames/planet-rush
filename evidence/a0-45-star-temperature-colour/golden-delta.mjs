/**
 * evidence/a0-45-star-temperature-colour/golden-delta.mjs — how far each golden
 * baseline moved, by the gate's OWN rule. OWNER: Art Agent.
 *
 * ```sh
 * node evidence/a0-45-star-temperature-colour/golden-delta.mjs > evidence/a0-45-star-temperature-colour/golden-delta.txt
 * ```
 *
 * Playwright's `toHaveScreenshot` counts a pixel as different when its YIQ delta
 * exceeds `35215 × threshold²`; at the default `threshold: 0.2` that is a
 * per-pixel luma difference of **52.8 of 255**, and `tests/mobile/goldens.spec.ts`
 * holds the ratio of such pixels under `maxDiffPixelRatio: 0.01`. So "did this
 * golden move" has a precise answer, and it is not the same question as "does any
 * pixel differ" — a0-44's whole golden section turns on that distinction.
 *
 * This compares each committed baseline **as of `git HEAD`** against the file in
 * the working tree, so it prices a re-baseline rather than a test run.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const DIR = 'tests/mobile/goldens.spec.ts-snapshots';
const THRESHOLD = 0.2;
const CUTOFF = 35215 * THRESHOLD * THRESHOLD;

/** pixelmatch's own YIQ delta, transcribed. */
const y = (r, g, b) => r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
const i = (r, g, b) => r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
const q = (r, g, b) => r * 0.21147017 - g * 0.52261711 + b * 0.31114694;

function delta(a, b, k) {
  const dy = y(a[k], a[k + 1], a[k + 2]) - y(b[k], b[k + 1], b[k + 2]);
  const di = i(a[k], a[k + 1], a[k + 2]) - i(b[k], b[k + 1], b[k + 2]);
  const dq = q(a[k], a[k + 1], a[k + 2]) - q(b[k], b[k + 1], b[k + 2]);
  return 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
}

const rows = [];
let moved = 0;
for (const name of readdirSync(DIR).sort()) {
  if (!name.endsWith('.png')) continue;
  let head;
  try {
    head = execFileSync('git', ['show', `HEAD:${DIR}/${name}`], { maxBuffer: 1 << 28 });
  } catch {
    rows.push([name, 'NEW', '', '']);
    moved++;
    continue;
  }
  const a = PNG.sync.read(head);
  const b = PNG.sync.read(readFileSync(`${DIR}/${name}`));
  if (a.width !== b.width || a.height !== b.height) {
    rows.push([name, 'RESIZED', `${a.width}x${a.height}`, `${b.width}x${b.height}`]);
    moved++;
    continue;
  }
  let gate = 0;
  let any = 0;
  for (let k = 0; k < a.data.length; k += 4) {
    const d = delta(a.data, b.data, k);
    if (d > 0) any++;
    if (d > CUTOFF) gate++;
  }
  const n = a.width * a.height;
  const ratio = gate / n;
  if (any > 0) moved++;
  rows.push([
    name,
    `${((any / n) * 100).toFixed(2)}%`,
    `${(ratio * 100).toFixed(3)}%`,
    ratio > 0.01 ? 'OVER THE GATE' : any > 0 ? 'moved, under the gate' : 'identical',
  ]);
}

console.log('golden baselines — HEAD vs this working tree (a0-45)');
console.log('====================================================');
console.log('');
console.log(`  gate: a pixel counts when its YIQ delta > ${CUTOFF.toFixed(0)} (luma ≈ 52.8/255);`);
console.log('        the suite fails over maxDiffPixelRatio 1%.');
console.log('');
console.log(`  ${'baseline'.padEnd(52)} ${'any px'.padStart(8)} ${'by gate'.padStart(9)}`);
for (const [name, any, gate, note] of rows) {
  console.log(`  ${name.padEnd(52)} ${String(any).padStart(8)} ${String(gate).padStart(9)}  ${note ?? ''}`);
}
console.log('');
console.log(`  ${moved} of ${rows.length} baselines moved at all.`);
