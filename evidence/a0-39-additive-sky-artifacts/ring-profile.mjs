/**
 * evidence/a0-39-additive-sky-artifacts/ring-profile.mjs — the number that
 * closes (or refutes) a0-39's diagnosis. OWNER: Art Agent.
 *
 * The brief's instruction is exact: *"count the rings in a captured blob and
 * check they land at the stop radii. If they do, the diagnosis is closed."* This
 * does that, and only that.
 *
 * Given a starless frame and a point inside one blob, it walks a radius outward
 * and reports the profile: luma against distance. A **step** is an adjacent
 * sample whose luma changes by ≥ 0.5 (half a code value on a sky whose entire
 * peak is ~9 over a ground of 1.9 — a 47% relative change across one pixel).
 * Each step's distance is then divided by the outermost step's, which turns the
 * profile into the one comparison that matters:
 *
 *     measured  d/dₒᵤₜ        vs   SOFT_STOPS radii   0.20 / 0.46 / 0.72 / 1.00
 *
 * Averaging over 720 rays rather than reading one row, because a single scan
 * line through a 14-gon wisp crosses a chord and not a radius, and because one
 * row is one sample of an antialiased edge.
 *
 *   node evidence/a0-39-additive-sky-artifacts/ring-profile.mjs <png> <cx> <cy> [maxR]
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [file, cxArg, cyArg, maxRArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: ring-profile.mjs <png> <cx> <cy> [maxR]');
  process.exit(2);
}
const png = PNG.sync.read(readFileSync(file));
const cx = Number(cxArg);
const cy = Number(cyArg);
const MAX_R = Number(maxRArg ?? 320);
const RAYS = 720;

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function at(x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= png.width || yi >= png.height) return null;
  const i = (yi * png.width + xi) * 4;
  return luma(png.data[i], png.data[i + 1], png.data[i + 2]);
}

// The rotationally-averaged radial profile. A ring is a circle, so averaging
// around the circle keeps every ring and cancels the noise between them.
const profile = [];
for (let r = 0; r <= MAX_R; r++) {
  let sum = 0;
  let n = 0;
  for (let k = 0; k < RAYS; k++) {
    const a = (k / RAYS) * Math.PI * 2;
    const v = at(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    if (v !== null) {
      sum += v;
      n++;
    }
  }
  profile.push(n > 0 ? sum / n : 0);
}

/**
 * A ring is a **local maximum of the outward gradient**, measured across a
 * ±`HALF`-pixel window and required to drop at least `STEP`.
 *
 * The window is what makes the count honest in both directions. A filled disc's
 * rim is antialiased over ~4 px, so a strict adjacent-pixel test splits one ring
 * into four sub-threshold samples and reports none; and a genuine gradient
 * spread over 200 px cannot fake a `STEP` drop inside 6 px whatever the window,
 * because it does not have that much luma to give in that little distance.
 */
const HALF = 3;
const grad = [];
for (let r = 0; r <= MAX_R; r++) {
  const lo = profile[Math.max(0, r - HALF)];
  const hi = profile[Math.min(MAX_R, r + HALF)];
  grad.push(lo - hi); // positive = falling outward
}

function rings(step) {
  const out = [];
  for (let r = HALF + 1; r < MAX_R - HALF; r++) {
    if (grad[r] < step) continue;
    if (grad[r] < grad[r - 1] || grad[r] < grad[r + 1]) continue; // local max only
    const last = out[out.length - 1];
    if (last && r - last.r <= 2 * HALF) {
      if (grad[r] > last.drop) out[out.length - 1] = { r, drop: +grad[r].toFixed(3) };
    } else {
      out.push({ r, drop: +grad[r].toFixed(3) });
    }
  }
  return out;
}

/**
 * Two thresholds, and the reason there are two.
 *
 * `0.5` is the honest **band detector**: a smooth falloff from this blob's own
 * core (Y′ 7.6) to the ground (1.9) over its own radius is 0.028 Y′ per pixel,
 * so the most any true gradient can drop across this 6 px window is **0.17** —
 * a third of the threshold. Anything ≥ 0.5 is therefore geometry, not shading.
 *
 * `0.15` exists only to make the *outermost* stop visible in the same list. The
 * last stop of `SOFT_STOPS` falls from aFrac 0.18 to nothing, which on this blob
 * is a 0.21 Y′ step — a real hard edge (the profile is flat on both sides of it)
 * but a small one, and the radius it sits at is half of what the stop-radius
 * comparison is testing. It is listed separately so no reader mistakes the loose
 * threshold for the criterion.
 */
const banded = rings(0.5);
const merged = rings(0.15);
const outer = merged.length > 0 ? merged[merged.length - 1].r : 0;
let maxStep = 0;
for (let r = HALF; r < MAX_R - HALF; r++) maxStep = Math.max(maxStep, grad[r]);

console.log(`\n${file}  centre (${cx}, ${cy})  rays ${RAYS}  window ±${HALF} px\n`);
console.log('  r      Y′       ΔY′ inward');
for (let r = 0; r <= MAX_R; r += 4) {
  const d = r === 0 ? 0 : profile[r - 4] - profile[r];
  console.log(`  ${String(r).padStart(3)}  ${profile[r].toFixed(3).padStart(7)}  ${d.toFixed(3).padStart(7)}`);
}
console.log(`\nSTEEPEST 6 px DROP ANYWHERE IN THE PROFILE: ${maxStep.toFixed(3)} Y′`);
console.log(`  (a smooth falloff over this blob's own radius could not exceed ${((profile[0] - profile[MAX_R]) / MAX_R * 2 * HALF).toFixed(3)})`);
console.log(`\nHARD BANDS (drop ≥ 0.5 Y′ across 6 px): ${banded.length}`);
console.log(`ALL STEPS (drop ≥ 0.15 Y′): ${merged.length}`);
for (const s of merged) {
  console.log(`  r ${String(s.r).padStart(3)}  drop ${s.drop.toFixed(3).padStart(6)} Y′   r/r_outer ${(s.r / outer).toFixed(3)}`);
}
console.log(`\nSOFT_STOPS radii for comparison: 0.200 / 0.460 / 0.720 / 1.000\n`);
