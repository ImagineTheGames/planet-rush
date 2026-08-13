/**
 * evidence/a0-36-name-the-blobs/analyse.mjs — a0-36, the census.
 * OWNER: QA Manager.
 *
 * Turns `isolate.mjs`'s frames into an INVENTORY. For each hidden layer L:
 *
 *   mask   = pixels where |A − B_L| exceeds THRESH on any channel
 *   blobs  = 4-connected components of that mask, each with a bbox, an area,
 *            an equivalent diameter and its own peak/mean delta
 *
 * Because the sim is frozen, |A − B_L| is L's own pixels and nothing else's, so
 * a blob in that mask is a THING LAYER L DREW — not a thing a theory says L
 * drew. That is the whole point of the round.
 *
 * THRESH is 1/255: the skies paint at single-digit luma over Floor (a0-07 chose
 * "subtle"), so anything higher would silently drop the very discs under study.
 * A 1/255 floor over a FROZEN pair has no noise to reject — which the empty
 * layers prove, below.
 *
 * **The calibrated zero.** Layers with zero children in the frozen frame
 * (typically `turrets`, `shots`, `muzzles`) must difference to EXACTLY 0 pixels:
 * hiding nothing must change nothing. a1-07 used the octagon's absent sky the
 * same way. If any of those comes back non-zero the freeze is not pinning and
 * no other number in this file may be believed; the run says so out loud.
 *
 *   node evidence/a0-36-name-the-blobs/analyse.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'frames');
const THRESH = 1; // out of 255, per channel

const runs = JSON.parse(readFileSync(join(HERE, 'isolation-runs.json'), 'utf8'));

const load = (p) => PNG.sync.read(readFileSync(p));

/** 4-connected components over a Uint8 mask, iterative (no recursion depth). */
function components(mask, w, h, minArea) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    let area = 0,
      minX = w,
      maxX = -1,
      minY = h,
      maxY = -1,
      sx = 0,
      sy = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w,
        y = (p / w) | 0;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (area < minArea) continue;
    blobs.push({
      area,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      cx: Math.round(sx / area),
      cy: Math.round(sy / area),
      /** Longest side of the bbox — how wide the thing READS, in device px. */
      span: Math.max(maxX - minX + 1, maxY - minY + 1),
      /** Diameter of a disc of the same area — separates discs from streaks. */
      eqDia: +(2 * Math.sqrt(area / Math.PI)).toFixed(1),
    });
  }
  return blobs;
}

const pct = (n, d) => +((100 * n) / d).toFixed(3);

const report = [];
for (const run of runs) {
  const tag = `${run.mapId}-${run.view}`;
  const aPath = join(OUT, `${tag}-A-all.png`);
  if (!existsSync(aPath)) continue;
  const A = load(aPath);
  const { width: w, height: h } = A;
  const dpr = run.dpr;

  // A2 vs A: the freeze's own stability. Two screenshots of the same unchanged
  // scene, taken at the START and END of the toggling. Anything non-zero here
  // is drift and every other row in this run inherits it.
  let drift = null;
  const a2Path = join(OUT, `${tag}-A2-restored.png`);
  if (existsSync(a2Path)) {
    const A2 = load(a2Path);
    let n = 0,
      peak = 0;
    for (let i = 0; i < w * h * 4; i += 4) {
      const d = Math.max(
        Math.abs(A.data[i] - A2.data[i]),
        Math.abs(A.data[i + 1] - A2.data[i + 1]),
        Math.abs(A.data[i + 2] - A2.data[i + 2]),
      );
      if (d > peak) peak = d;
      if (d >= THRESH) n++;
    }
    drift = { pixels: n, pctFrame: pct(n, w * h), peak };
  }

  const layers = [];
  for (const L of run.layers) {
    const bPath = join(OUT, `${tag}-B-no-${L.label}.png`);
    if (!existsSync(bPath)) continue;
    const B = load(bPath);
    const mask = new Uint8Array(w * h);
    let n = 0,
      peak = 0,
      sr = 0,
      sg = 0,
      sb = 0;
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      const dr = Math.abs(A.data[i] - B.data[i]);
      const dg = Math.abs(A.data[i + 1] - B.data[i + 1]);
      const db = Math.abs(A.data[i + 2] - B.data[i + 2]);
      const d = Math.max(dr, dg, db);
      if (d > peak) peak = d;
      if (d >= THRESH) {
        mask[p] = 1;
        n++;
        sr += dr;
        sg += dg;
        sb += db;
      }
    }
    // A blob smaller than ~3 device px across is a single antialiased edge
    // pixel, not an object. Stated so the count is reproducible.
    const minArea = Math.max(4, Math.round(Math.PI * (1.5 * dpr) ** 2));
    const blobs = n ? components(mask, w, h, minArea) : [];
    blobs.sort((p, q) => q.area - p.area);
    const spansCss = blobs.map((b) => +(b.span / dpr).toFixed(1)).sort((p, q) => p - q);
    layers.push({
      label: L.label,
      kids: L.kids,
      pixels: n,
      pctFrame: pct(n, w * h),
      peakDelta: peak,
      meanInk: n ? [+(sr / n).toFixed(2), +(sg / n).toFixed(2), +(sb / n).toFixed(2)] : null,
      blobs: blobs.length,
      spanCssPx: spansCss.length
        ? { min: spansCss[0], median: spansCss[spansCss.length >> 1], max: spansCss[spansCss.length - 1] }
        : null,
      biggest: blobs.slice(0, 6).map((b) => ({ span: b.span, eqDia: b.eqDia, at: [b.cx, b.cy] })),
    });
  }

  // The zero: empty layers must have moved no pixels at all.
  const empties = layers.filter((l) => l.kids === 0 && l.label !== 'void-ground' && !l.label.startsWith('void-stars') && !l.label.startsWith('void-nebula'));
  const zeroOk = empties.every((l) => l.pixels === 0);

  report.push({ ...run, frame: { w, h }, restoreDrift: drift, zeroControl: { layers: empties.map((l) => `${l.label}=${l.pixels}px`), ok: zeroOk }, layers });

  console.log(`\n=== ${tag}  ${w}x${h} (dpr ${dpr}) ===`);
  console.log(`  restore drift: ${drift ? `${drift.pixels}px peak ${drift.peak}` : 'n/a'}`);
  console.log(`  ZERO CONTROL: ${zeroOk ? 'PASS' : '*** FAIL ***'}  ${empties.map((l) => `${l.label}=${l.pixels}`).join(' ')}`);
  console.log('  layer                        kids   %frame  peakΔ  blobs   span css px (min/med/max)');
  for (const l of layers) {
    console.log(
      `  ${l.label.padEnd(28)} ${String(l.kids).padStart(4)}  ${String(l.pctFrame).padStart(7)}  ` +
        `${String(l.peakDelta).padStart(5)}  ${String(l.blobs).padStart(5)}   ` +
        (l.spanCssPx ? `${l.spanCssPx.min} / ${l.spanCssPx.median} / ${l.spanCssPx.max}` : '—'),
    );
  }
}
writeFileSync(join(HERE, 'inventory.json'), JSON.stringify(report, null, 2));
console.log('\nwrote inventory.json');
