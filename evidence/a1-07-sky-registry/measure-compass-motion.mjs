/**
 * evidence/a1-07-sky-registry/measure-compass-motion.mjs — a1-07, the one sky a
 * still cannot carry. OWNER: QA Manager.
 *
 * Coalsack is the only sky in the set with `occludes: true`: it is drawn in the
 * GROUND COLOUR, in front of all three star layers, so it adds no light at all
 * (the frozen isolation measured its own paint at 0.1% of the frame and its mean
 * ink at r17.8 g18.4 b18.9 — neutral, i.e. the stars it covered, not ink it
 * laid). What it does instead is TAKE STARS OUT. On a still that is a shape you
 * cannot see: an absence has no edge of its own.
 *
 * In motion it has one distinguishing property, and it is the whole question the
 * developer's report turns on — does the star-poor patch travel with the STARS
 * (a dust lane between us and them) or with the SHIP (a smear on the glass)?
 *
 * So: three camera positions along one straight live flight on The Compass
 * (`compass-flight-{1,2,3}.png`, shot by `shoot-skies.mjs`), and for each frame
 *
 *   1. every STAR POINT is extracted — bright, small, and isolated. Big bright
 *      things (stations, asteroids, ships, HUD, minimap) are removed first by a
 *      coarse block mask, so nothing but the field survives;
 *   2. those points are counted per screen column into a smoothed density
 *      profile, whose troughs ARE the dust lanes;
 *   3. the profiles are cross-correlated between frames. The shift that best
 *      re-aligns them is how far the star-poor structure TRAVELLED.
 *
 * Four outcomes, four different worlds:
 *
 *   shift ≈ 0 px               → the patch is stuck to the screen (the bug)
 *   shift ≈ camera travel      → it is stuck to the world, not a backdrop
 *   shift ≈ 0.10 × travel      → it rides the DEEP star layer (parallax 0.10)
 *   shift ≈ 0.14 × travel      → it rides COALSACK'S OWN plane
 *
 * Those last two are 4% of the camera's travel apart, and that gap is the design:
 * Coalsack is on parallax **0.14**, the one sky NOT on `SKY_PARALLAX` (0.085),
 * deliberately NEARER than the 0.10 deep layer it eats "so it reads as foreground
 * dust rather than as a hole punched in the far sky". Whether this instrument can
 * separate 0.10 from 0.14 off a few hundred star pixels is reported, not assumed.
 *
 * The star field is not rigid either — deep 0.10, mid 0.26, near 0.50 — so over a
 * LONG baseline the three layers separate and no single shift re-aligns the
 * profile. That is a real limit of the method and the long pair is printed with
 * the short ones so it can be seen rather than dropped.
 *
 * `star-map-compass-{1,2,3}.png` renders the extracted points, so the profile is
 * checkable by eye against the thing it was computed from.
 *
 *   node evidence/a1-07-sky-registry/measure-compass-motion.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');

/** The open band of the frame, in device px of the 2880×1800 (dpr 2) shot: below
 *  the top HUD strip, above the hint banner and the controls row, and clear of
 *  the right-hand minimap plate. Nothing but world and void is inside it. */
const BAND = { x0: 60, x1: 2500, y0: 260, y1: 1500 };
/** A star is bright... */
const STAR_LUMA = 16;
/** ...and LOCAL: any 16×16 block whose mean luma clears this holds something
 *  bigger than a star (a rock, a ring, a nameplate) and is dropped whole. */
const BLOCK = 16;
const BLOCK_MEAN_MAX = 3.0;

const load = (n) => PNG.sync.read(readFileSync(join(FRAMES, n)));
const luma = (p, i) => 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];

/** Extract star points and the per-column density profile of one frame. */
function starProfile(png) {
  const { width, height } = png;
  const bw = Math.ceil(width / BLOCK);
  const sum = new Float64Array(bw * Math.ceil(height / BLOCK));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sum[Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)] += luma(png, (width * y + x) << 2);
    }
  }
  const blockMean = sum.map((s) => s / (BLOCK * BLOCK));

  const profile = new Float64Array(width);
  const points = [];
  for (let y = BAND.y0; y < BAND.y1; y++) {
    for (let x = BAND.x0; x < BAND.x1; x++) {
      if (blockMean[Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)] > BLOCK_MEAN_MAX) continue;
      if (luma(png, (width * y + x) << 2) < STAR_LUMA) continue;
      profile[x] += 1;
      points.push([x, y]);
    }
  }
  // A 61-px box smooth: individual stars are 1–5 px, dust lanes are hundreds.
  const smooth = new Float64Array(width);
  const R = 30;
  for (let x = 0; x < width; x++) {
    let s = 0;
    let n = 0;
    for (let d = -R; d <= R; d++) {
      const i = x + d;
      if (i < BAND.x0 || i >= BAND.x1) continue;
      s += profile[i];
      n++;
    }
    smooth[x] = n ? s / n : 0;
  }
  return { profile: smooth, points };
}

/** The correlation this curve scored at one shift (or null if out of range). */
const at = (scores, shift) => scores.find((s) => s.shift === shift)?.score ?? null;

/** The shift (px, applied to b) that best re-aligns b onto a. Normalised
 *  cross-correlation over the overlap, so a shift is not rewarded for trimming. */
function bestShift(a, b, maxShift) {
  const scores = [];
  let best = { shift: 0, score: -Infinity };
  for (let s = -maxShift; s <= maxShift; s++) {
    let num = 0;
    let da = 0;
    let db = 0;
    let n = 0;
    for (let x = BAND.x0 + maxShift; x < BAND.x1 - maxShift; x++) {
      const va = a[x];
      const vb = b[x + s];
      num += va * vb;
      da += va * va;
      db += vb * vb;
      n++;
    }
    const score = n && da && db ? num / Math.sqrt(da * db) : 0;
    scores.push({ shift: s, score: Math.round(score * 1e5) / 1e5 });
    if (score > best.score) best = { shift: s, score };
  }
  return { best, scores };
}

const readback = JSON.parse(readFileSync(join(FRAMES, 'readback.json'), 'utf8'));
const flight = readback.compassFlight;
console.log(`compass flight: ${flight.dir}, from world x ${flight.x0}`);

const frames = flight.frames.map((f, i) => {
  const png = load(f.file);
  const { profile, points } = starProfile(png);
  console.log(`  frame ${i + 1}: ${f.file}  ship x=${f.worldX} (${f.flown} u flown)  ${points.length} star pixels`);

  // The star map: the extracted points and nothing else, so the profile can be
  // checked against the picture it came from.
  const map = new PNG({ width: png.width, height: png.height });
  for (let i2 = 0; i2 < map.data.length; i2 += 4) {
    map.data[i2] = map.data[i2 + 1] = map.data[i2 + 2] = 6;
    map.data[i2 + 3] = 255;
  }
  for (const [x, y] of points) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = (map.width * (y + dy) + (x + dx)) << 2;
        if (p >= 0 && p < map.data.length) map.data[p] = map.data[p + 1] = map.data[p + 2] = 235;
      }
    }
  }
  writeFileSync(join(FRAMES, `star-map-compass-${i + 1}.png`), PNG.sync.write(map));
  return { ...f, points: points.length, profile };
});

/** Device px per world unit: the camera is 1:1 in CSS px and the shot is dpr 2. */
const DPR = 2;
const out = { flight: { dir: flight.dir, x0: flight.x0 }, dpr: DPR, pairs: [] };
for (const [i, j] of [
  [0, 1],
  [0, 2],
  [1, 2],
]) {
  const travelWorld = frames[j].flown - frames[i].flown;
  const travelPx = travelWorld * DPR;
  const { best, scores } = bestShift(frames[i].profile, frames[j].profile, 300);
  const ratio = travelPx ? Math.abs(best.shift) / travelPx : 0;
  const pair = {
    from: i + 1,
    to: j + 1,
    cameraTravelWorldUnits: travelWorld,
    cameraTravelDevicePx: travelPx,
    bestShiftPx: best.shift,
    correlation: Math.round(best.score * 1000) / 1000,
    shiftAsFractionOfCameraTravel: Math.round(ratio * 1000) / 1000,
    // What each hypothesis predicts, for the same numbers to be read against.
    predicted: {
      screenLocked: 0,
      worldLocked: travelPx,
      deepStars010: Math.round(travelPx * 0.1),
      coalsack014: Math.round(travelPx * 0.14),
      midStars026: Math.round(travelPx * 0.26),
      nearStars050: Math.round(travelPx * 0.5),
    },
    // The correlation AT each hypothesis, not just at the winner. A single
    // argmax on a quasi-periodic field is worth very little on its own; what
    // the curve scores where each explanation says it should is worth more.
    scoreAt: {
      screenLocked: at(scores, 0),
      worldLocked: at(scores, travelPx),
      deepStars010: at(scores, Math.round(travelPx * 0.1)),
      coalsack014: at(scores, Math.round(travelPx * 0.14)),
      midStars026: at(scores, Math.round(travelPx * 0.26)),
      best: Math.round(best.score * 1000) / 1000,
    },
    curve: scores.filter((s) => s.shift % 4 === 0),
  };
  out.pairs.push(pair);
  console.log(
    `  frames ${i + 1}→${j + 1}: camera travelled ${travelWorld} u = ${travelPx} px;` +
      ` star field re-aligns at shift ${best.shift} px (r=${pair.correlation}),` +
      ` = ${(ratio * 100).toFixed(1)}% of camera travel`,
  );
  console.log(
    `             correlation at: screen-locked(0) ${pair.scoreAt.screenLocked}` +
      `   deep stars 0.10(${pair.predicted.deepStars010}) ${pair.scoreAt.deepStars010}` +
      `   coalsack 0.14(${pair.predicted.coalsack014}) ${pair.scoreAt.coalsack014}` +
      `   mid stars 0.26(${pair.predicted.midStars026}) ${pair.scoreAt.midStars026}` +
      `   world-locked(${travelPx}) ${pair.scoreAt.worldLocked}   best ${pair.scoreAt.best}`,
  );
}

writeFileSync(join(HERE, 'compass-motion.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nwrote ${HERE}/compass-motion.json and three star maps`);
