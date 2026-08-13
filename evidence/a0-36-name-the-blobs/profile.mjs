/**
 * evidence/a0-36-name-the-blobs/profile.mjs — a0-36, ring or glow.
 * OWNER: QA Manager.
 *
 * The brief's central question. The developer's discs "read as RINGS — a
 * brighter rim with a DARKER centre", and three concentric FILLED discs cannot
 * composite to a donut. So: measure it, per disc, per layer.
 *
 * For each isolated layer (|A − B_L|, so the pixels are that layer's own), find
 * its blobs and take a **radial profile**: mean isolated-luma in annuli of one
 * device pixel out from the blob's brightest point. Then classify the profile:
 *
 *   GLOW  — the maximum is at the centre and the profile falls outward
 *   RING  — the profile rises from the centre to a maximum at r > 0 and then
 *           falls, with the interior dip deeper than the quantisation step
 *
 * The dip has to clear **1/255**, because an additive stack banded at 1–3 levels
 * per stop can dip by less than one code value and that is rounding, not a ring.
 * The threshold is stated here so the verdict is reproducible rather than a
 * matter of how the plate was looked at.
 *
 * Blobs are ranked by area and the largest few are profiled — those are the
 * "large soft discs" the report is about. Small ones are counted, not profiled.
 *
 *   node evidence/a0-36-name-the-blobs/profile.mjs <map> <view> [layer ...]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'frames');
const MAP = process.argv[2] ?? 'oval';
const VIEW = process.argv[3] ?? 'desktop';

const inv = JSON.parse(readFileSync(join(HERE, 'inventory.json'), 'utf8'));
const run = inv.find((r) => r.mapId === MAP && r.view === VIEW);
if (!run) throw new Error(`no inventory row for ${MAP}/${VIEW}`);
const dpr = run.dpr;

const load = (p) => PNG.sync.read(readFileSync(p));
const A = load(join(OUT, `${MAP}-${VIEW}-A-all.png`));
const { width: w, height: h } = A;

const LUMA = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The isolated luma field for layer L: how much luma L adds at each pixel. */
function isolate(label) {
  const B = load(join(OUT, `${MAP}-${VIEW}-B-no-${label}.png`));
  const f = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    f[p] =
      LUMA(A.data[i], A.data[i + 1], A.data[i + 2]) - LUMA(B.data[i], B.data[i + 1], B.data[i + 2]);
  }
  return f;
}

/** Components of `f > 0.5/255`, iterative, with the peak pixel recorded. */
function blobs(f, minArea) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || f[i] <= 0.5) continue;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    let area = 0, minX = w, maxX = -1, minY = h, maxY = -1, peak = -1, px = 0, py = 0, sum = 0;
    let cxs = 0, cys = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      area++; sum += f[p]; cxs += x; cys += y;
      if (f[p] > peak) { peak = f[p]; px = x; py = y; }
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && f[p - 1] > 0.5 && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && f[p + 1] > 0.5 && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && f[p - w] > 0.5 && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && f[p + w] > 0.5 && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (area < minArea) continue;
    out.push({
      area, peak: +peak.toFixed(2), peakAt: [px, py], mean: +(sum / area).toFixed(3),
      centroid: [Math.round(cxs / area), Math.round(cys / area)],
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      span: Math.max(maxX - minX + 1, maxY - minY + 1),
      spanCss: +(Math.max(maxX - minX + 1, maxY - minY + 1) / dpr).toFixed(1),
    });
  }
  return out.sort((a, b) => b.area - a.area);
}

/** Mean isolated luma in 1-px annuli around (cx, cy), out to `rMax`. */
function radial(f, cx, cy, rMax) {
  const sum = new Float64Array(rMax + 1);
  const cnt = new Int32Array(rMax + 1);
  for (let y = Math.max(0, cy - rMax); y <= Math.min(h - 1, cy + rMax); y++) {
    for (let x = Math.max(0, cx - rMax); x <= Math.min(w - 1, cx + rMax); x++) {
      const r = Math.round(Math.hypot(x - cx, y - cy));
      if (r > rMax) continue;
      sum[r] += f[y * w + x];
      cnt[r]++;
    }
  }
  const prof = [];
  for (let r = 0; r <= rMax; r++) prof.push(cnt[r] ? +(sum[r] / cnt[r]).toFixed(3) : 0);
  return prof;
}

/**
 * GLOW or RING. A ring needs its maximum away from the centre AND an interior
 * dip of more than one 8-bit code value — below that it is quantisation.
 */
function classify(prof) {
  let argmax = 0;
  for (let r = 1; r < prof.length; r++) if (prof[r] > prof[argmax]) argmax = r;
  if (argmax === 0) return { shape: 'GLOW', peakR: 0, dip: 0 };
  let interiorMin = prof[0];
  for (let r = 0; r < argmax; r++) interiorMin = Math.min(interiorMin, prof[r]);
  const dip = +(prof[argmax] - interiorMin).toFixed(3);
  // Centre value vs the peak: what the eye calls "a darker centre".
  const centreDeficit = +(prof[argmax] - prof[0]).toFixed(3);
  return { shape: dip > 1 ? 'RING' : 'GLOW', peakR: argmax, dip, centreDeficit };
}

const targets = process.argv.slice(4).length
  ? process.argv.slice(4)
  : run.layers.filter((l) => l.blobs > 0 && l.label !== 'void-ground').map((l) => l.label);

const report = [];
console.log(`\n=== ${MAP} / ${VIEW}  ${w}x${h} (dpr ${dpr}) — ring or glow ===`);
for (const label of targets) {
  if (!existsSync(join(OUT, `${MAP}-${VIEW}-B-no-${label}.png`))) continue;
  const f = isolate(label);
  const minArea = Math.max(9, Math.round(Math.PI * (2 * dpr) ** 2));
  const bs = blobs(f, minArea);
  // Profiled from TWO centres, because they answer two different questions.
  //
  //   from the peak     — is one drawn element a donut? (`starFieldSprite`'s
  //                       three filled discs say no; this checks the frame.)
  //   from the centroid — does the GROUP read as a donut? A cluster whose parts
  //                       sit around a common centre is a ring even though every
  //                       part of it is a filled glow, and that is a thing the
  //                       player sees and the per-element check cannot find.
  const profiled = bs.slice(0, 8).map((b) => {
    const rMax = Math.min(90, Math.max(4, Math.round(b.span / 2)));
    const fromPeak = radial(f, b.peakAt[0], b.peakAt[1], rMax);
    const fromCentroid = radial(f, b.centroid[0], b.centroid[1], rMax);
    return {
      ...b,
      element: { profile: fromPeak, ...classify(fromPeak) },
      group: { profile: fromCentroid, ...classify(fromCentroid) },
    };
  });
  const gRings = profiled.filter((p) => p.group.shape === 'RING').length;
  const eRings = profiled.filter((p) => p.element.shape === 'RING').length;
  report.push({ label, blobs: bs.length, profiled });
  console.log(
    `  ${label.padEnd(26)} blobs=${String(bs.length).padStart(4)}  ` +
      `span css ${bs.length ? `${bs[bs.length - 1].spanCss}–${bs[0].spanCss}` : '—'}  ` +
      `top8 from peak: ${eRings} RING/${profiled.length - eRings} GLOW   ` +
      `from centroid: ${gRings} RING/${profiled.length - gRings} GLOW`,
  );
  for (const p of profiled.slice(0, 3)) {
    console.log(
      `      span ${p.spanCss}css peakΔ ${p.peak}  ` +
        `element ${p.element.shape}(max r=${p.element.peakR}, dip ${p.element.dip})  ` +
        `group ${p.group.shape}(max r=${p.group.peakR}, dip ${p.group.dip})`,
    );
    console.log(`        centroid profile: ${p.group.profile.slice(0, 18).join(' ')}`);
  }
}
writeFileSync(join(HERE, `profiles-${MAP}-${VIEW}.json`), JSON.stringify(report, null, 2));
console.log(`\nwrote profiles-${MAP}-${VIEW}.json`);
