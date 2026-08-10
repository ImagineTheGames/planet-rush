/**
 * evidence/a1-08-parallax/measure-drift.mjs — a1-08, the ruler. OWNER: QA Manager.
 *
 * measure-flight.mjs isolated each void layer and shot it alone at four camera
 * positions. This measures HOW FAR THE INK ACTUALLY MOVED between them, without
 * consulting the transform that moved it — so the answer is independent of the
 * scene-graph readback and either corroborates it or contradicts it.
 *
 * ── The ruler ───────────────────────────────────────────────────────────────
 * Both frames are converted to luma and mean-subtracted (the isolated frames sit
 * on the canvas clear colour, a DC term that carries no information). For a
 * candidate shift (Dx, Dy) the score is the MEAN ABSOLUTE DIFFERENCE over the
 * overlap:  mean |A(x, y) − B(x + Dx, y + Dy)|.  Lowest score wins.
 *
 * Coarse-to-fine, because the near layer moves 700 px and searching that at full
 * resolution is minutes of nothing: an eighth-scale sweep over ±800 px in x and
 * ±128 px in y finds the basin, then a full-resolution ±6 px sweep lands it, then
 * a parabola through the three samples astride the minimum gives the sub-pixel
 * figure. Frames are deviceScaleFactor 1, so a pixel here is a CSS pixel is a
 * world unit — the number needs no conversion to be compared with the flight.
 *
 * ── The controls that make a number mean something ──────────────────────────
 *  - **Score at zero shift** is reported beside the score at the best shift for
 *    every layer. "Glued to the camera" is the hypothesis that zero IS the best
 *    shift; the two numbers are what tests it, and a1-05 used the same pair.
 *  - **The runner-up minimum** (the best score outside ±25 px of the winner) is
 *    reported too, so a shallow or ambiguous match cannot pass as a sharp one.
 *  - **`void-ground` is parallax 0**, and its frames are byte-identical across
 *    stops. It is the round's null: the ruler must return exactly 0 px on it.
 *
 *   node evidence/a1-08-parallax/measure-drift.mjs [name]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const NAME = process.argv[2] ?? 'line';

const flight = JSON.parse(readFileSync(join(FRAMES, `${NAME}-flight.json`), 'utf8'));

/**
 * THE PREDICTION UNDER TEST — per arena, the number a0-07b's table says the sky
 * should drift at. This is the hypothesis, not an input to the measurement:
 * nothing below consults it until after the shift has been found in the pixels.
 *
 *   line    → deepEmber, on SKY_PARALLAX (0.085)
 *   compass → coalsack, deliberately NOT on SKY_PARALLAX — it is dust in FRONT
 *             of the deep layer at 0.14, so if the ruler simply echoed whatever
 *             it was told, these two arenas could not disagree. They must.
 */
const SKY_PREDICTION = { line: 0.085, compass: 0.14 };

/** luma plane, mean-subtracted, with the RMS contrast the ruler has to work on. */
function plane(file) {
  const p = PNG.sync.read(readFileSync(join(FRAMES, file)));
  const n = p.width * p.height;
  const a = new Float32Array(n);
  let sum = 0;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const v = 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
    a[j] = v;
    sum += v;
  }
  const mean = sum / n;
  let sq = 0;
  for (let j = 0; j < n; j++) {
    a[j] -= mean;
    sq += a[j] * a[j];
  }
  return { w: p.width, h: p.height, a, mean, rms: Math.sqrt(sq / n) };
}

/** Box-downsample by an integer factor. */
function down(img, f) {
  const w = Math.floor(img.w / f);
  const h = Math.floor(img.h / f);
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += img.a[(y * f + dy) * img.w + (x * f + dx)];
      a[y * w + x] = s / (f * f);
    }
  }
  return { w, h, a };
}

/** mean |A(x,y) − B(x+Dx, y+Dy)| over the overlap; null if the overlap is thin. */
function mad(A, B, Dx, Dy) {
  const x0 = Math.max(0, -Dx);
  const x1 = Math.min(A.w, B.w - Dx);
  const y0 = Math.max(0, -Dy);
  const y1 = Math.min(A.h, B.h - Dy);
  const cols = x1 - x0;
  const rows = y1 - y0;
  if (cols < A.w * 0.25 || rows < A.h * 0.25) return null;
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const ra = y * A.w;
    const rb = (y + Dy) * B.w + Dx;
    for (let x = x0; x < x1; x++) {
      const d = A.a[ra + x] - B.a[rb + x];
      s += d < 0 ? -d : d;
      n++;
    }
  }
  return { score: s / n, overlap: n, cols, rows };
}

/** Coarse-to-fine best shift, plus the diagnostics that keep it honest. */
function bestShift(A, B, xRange, yRange) {
  const F = 8;
  const a8 = down(A, F);
  const b8 = down(B, F);
  let best = { score: Infinity, dx: 0, dy: 0 };
  const coarse = [];
  for (let dy = -Math.ceil(yRange / F); dy <= Math.ceil(yRange / F); dy++) {
    for (let dx = -Math.ceil(xRange / F); dx <= Math.ceil(xRange / F); dx++) {
      const m = mad(a8, b8, dx, dy);
      if (!m) continue;
      coarse.push({ dx: dx * F, dy: dy * F, score: m.score });
      if (m.score < best.score) best = { score: m.score, dx, dy };
    }
  }
  const cx = best.dx * F;
  const cy = best.dy * F;

  // Full resolution around the basin.
  let fine = { score: Infinity, dx: cx, dy: cy, overlap: 0 };
  const row = new Map();
  for (let dy = cy - 6; dy <= cy + 6; dy++) {
    for (let dx = cx - 6; dx <= cx + 6; dx++) {
      const m = mad(A, B, dx, dy);
      if (!m) continue;
      row.set(`${dx},${dy}`, m.score);
      if (m.score < fine.score) fine = { score: m.score, dx, dy, overlap: m.overlap };
    }
  }

  // Sub-pixel: parabola through the three x-samples astride the minimum.
  const l = row.get(`${fine.dx - 1},${fine.dy}`);
  const c = row.get(`${fine.dx},${fine.dy}`);
  const r = row.get(`${fine.dx + 1},${fine.dy}`);
  let sub = fine.dx;
  if (l != null && r != null && l - 2 * c + r > 0) sub = fine.dx + (0.5 * (l - r)) / (l - 2 * c + r);

  const zero = mad(A, B, 0, 0);
  // The best score anywhere outside ±25 px of the winner: a sharp minimum has a
  // clearly worse runner-up; a shallow one does not, and should not be trusted.
  let runner = { score: Infinity, dx: null };
  for (const p of coarse) if (Math.abs(p.dx - cx) > 25 && p.score < runner.score) runner = { score: p.score, dx: p.dx };

  return {
    dx: fine.dx,
    dy: fine.dy,
    dxSubPixel: +sub.toFixed(2),
    scoreAtBest: +fine.score.toFixed(4),
    scoreAtZero: zero ? +zero.score.toFixed(4) : null,
    zeroOverBest: zero ? +(zero.score / fine.score).toFixed(3) : null,
    runnerUpScore: Number.isFinite(runner.score) ? +runner.score.toFixed(4) : null,
    runnerUpDx: runner.dx,
    runnerUpOverBest: Number.isFinite(runner.score) ? +(runner.score / fine.score).toFixed(3) : null,
    overlapPx: fine.overlap,
  };
}

// ── run every layer against every baseline ─────────────────────────────────

const s0 = flight.stops[0];
const results = { brief: 'a1-08', map: flight.map, served: flight.served, name: NAME, pairs: [] };

console.log(`served ${JSON.stringify(flight.served)}   map=${flight.map}`);
console.log(`frames at deviceScaleFactor ${flight.viewport.deviceScaleFactor} — 1 image px = 1 CSS px = 1 world unit\n`);

for (const stop of flight.stops.slice(1)) {
  const dCamX = stop.before.camera.x - s0.before.camera.x;
  const dCamY = stop.before.camera.y - s0.before.camera.y;
  const flownX = stop.before.shipWorld.x - s0.before.shipWorld.x;
  const flownY = stop.before.shipWorld.y - s0.before.shipWorld.y;

  console.log(
    `── stop 0 → stop ${stop.index}:  flew ${Math.abs(flownX).toFixed(1)} u ${flownX < 0 ? 'west' : 'east'} ` +
      `(${flownY.toFixed(1)} u of y wander)`,
  );
  console.log(`   camera offset moved ${dCamX.toFixed(2)} px in x, ${dCamY.toFixed(2)} px in y`);
  console.log(
    `   ${'layer'.padEnd(10)} ${'measured'.padStart(10)} ${'predicted'.padStart(10)} ${'meas/cam'.padStart(9)} ` +
      `${'declared'.padStart(9)} ${'zero/best'.padStart(10)} ${'2nd/best'.padStart(9)}`,
  );

  const pair = { from: 0, to: stop.index, dCamX, dCamY, flownX, flownY, layers: [] };

  for (const L of flight.layers) {
    const fa = s0.frames[L.tag];
    const fb = stop.frames[L.tag];
    if (!fa || !fb) continue;
    const A = plane(fa);
    const B = plane(fb);
    const range = Math.min(900, Math.abs(dCamX) * 0.6 + 60);
    const r = bestShift(A, B, range, Math.max(48, Math.abs(dCamY) * 0.6 + 24));

    // Is this layer measurable AT ALL? Cross-correlation needs structure to lock
    // onto. `void-ground` is a flat fill: after mean-subtraction every candidate
    // shift scores the same (~0), so the "winner" is whichever the loop reached
    // first — a number with no meaning behind it. Say so rather than print it.
    // The identical-bytes test is what actually pins that layer, and it is
    // stronger than any correlation: the same pixels cannot have moved.
    // The test is DISCRIMINATION, not absolute score: a star field is mostly
    // empty, so its winning score is tiny in absolute terms while still being a
    // sharp, unambiguous lock. What separates a real lock from a flat surface is
    // how much worse everything else scores — so the criterion is the runner-up
    // ratio. A flat fill scores the same everywhere and cannot produce one.
    const identical = readFileSync(join(FRAMES, fa)).equals(readFileSync(join(FRAMES, fb)));
    const degenerate = !Number.isFinite(r.runnerUpOverBest) || r.runnerUpOverBest < 1.05;

    const live = s0.before.layers.find((l) => (l.label || '').startsWith(L.match));
    const declared = L.parallax ?? SKY_PREDICTION[flight.map] ?? null;
    const measured = degenerate ? (identical ? 0 : null) : r.dxSubPixel;
    const ratio = dCamX === 0 || measured == null ? NaN : measured / dCamX;
    const predicted = declared == null ? null : declared * dCamX;

    const shown = degenerate
      ? identical
        ? '0 (identical)'
        : 'unmeasurable'
      : r.dxSubPixel.toFixed(2);
    console.log(
      `   ${L.tag.padEnd(10)} ${shown.padStart(13)} ` +
        `${(predicted == null ? '—' : predicted.toFixed(2)).padStart(10)} ` +
        `${(Number.isNaN(ratio) ? '—' : ratio.toFixed(4)).padStart(9)} ${(declared == null ? '—' : String(declared)).padStart(9)} ` +
        `${String(degenerate ? '—' : r.zeroOverBest).padStart(10)} ${String(degenerate ? '—' : r.runnerUpOverBest).padStart(9)}`,
    );

    pair.layers.push({
      tag: L.tag,
      label: live?.label ?? null,
      declaredParallax: declared,
      frames: [fa, fb],
      rmsContrast: +A.rms.toFixed(3),
      framesIdentical: identical,
      degenerate,
      method: degenerate ? (identical ? 'identical bytes — drift is 0 by identity' : 'no structure to correlate') : 'cross-correlation',
      measuredDx: measured,
      measuredDxInteger: r.dx,
      measuredDy: r.dy,
      measuredRatio: Number.isNaN(ratio) ? null : +ratio.toFixed(4),
      predictedDx: predicted == null ? null : +predicted.toFixed(2),
      residualPx: predicted == null || measured == null ? null : +(measured - predicted).toFixed(2),
      sceneGraphDx: +(
        (stop.before.layers.find((l) => (l.label || '').startsWith(L.match))?.x ?? 0) - (live?.x ?? 0)
      ).toFixed(2),
      ...r,
    });
  }
  // ── Not "unmeasurable" — NOT THE VOID AT ALL ─────────────────────────────
  // If every layer in a pair is degenerate AND they all score within a hair of
  // each other, the five "isolated layers" are five copies of the same picture,
  // which can only mean the isolation was not in force when the shutter fired.
  // On compass that is exactly what happened twice: the ship was destroyed and
  // the ELIMINATED summary replaced the arena mid-sequence. Naming it matters —
  // "the correlator found no structure" and "these frames are of a menu" are
  // different facts, and only one of them is about the sky.
  // The test is exact rather than statistical: five frames that are supposed to
  // be five DIFFERENT single layers, but which are byte-identical to each other,
  // cannot have been taken with the isolation in force.
  const later = pair.layers.map((l) => readFileSync(join(FRAMES, l.frames[1])));
  const allSame = later.every((b) => b.equals(later[0]));
  if (allSame && pair.layers.length > 1) {
    pair.invalid = true;
    pair.invalidReason =
      'the five "isolated layer" frames at this stop are byte-identical to each other, so no isolation was in force when they were taken — ' +
      'the match ended mid-sequence and these are five screenshots of the end-of-match summary, not of the void.';
    console.log(`   *** NOT A MEASUREMENT: ${pair.invalidReason}`);
  }

  console.log('');
  results.pairs.push(pair);
}

writeFileSync(join(FRAMES, `${NAME}-drift.json`), `${JSON.stringify(results, null, 2)}\n`);
console.log(`wrote ${FRAMES}/${NAME}-drift.json`);
