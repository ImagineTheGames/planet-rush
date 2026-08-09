/**
 * evidence/a1-05-live-round/measure.mjs — pixel arithmetic for the a1-05 round.
 * OWNER: QA Manager.
 *
 * Two of the day's claims cannot be settled by looking at one still:
 *
 *  - **the sky moves with the far stars, not with the ship** — a claim about how
 *    far a layer TRAVELS between two camera positions, and
 *  - **a full hold flashes** — a claim about a 2 Hz blink.
 *
 * So this measures them off the captured PNGs. It computes, it does not judge:
 * the numbers land in `measurements.json` and the verdict is written by hand in
 * `evidence/manifest.json` afterwards.
 *
 *   node evidence/a1-05-live-round/measure.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');

function load(name) {
  return PNG.sync.read(readFileSync(join(IMAGES, name)));
}

function lum(png, x, y) {
  const i = (png.width * y + x) << 2;
  return 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
}

/**
 * The horizontal shift (px, rightwards applied to B) that best re-aligns B onto A
 * inside `region`. Returns the whole profile so a local minimum can be read off
 * it rather than only the global one — several layers travel at once.
 */
function shiftProfile(a, b, region, maxShift) {
  const out = [];
  for (let s = 0; s <= maxShift; s++) {
    let sum = 0;
    let n = 0;
    for (let y = region.y0; y < region.y1; y += 2) {
      for (let x = region.x0; x < region.x1; x += 1) {
        const bx = x - s;
        if (bx < 0 || bx >= b.width) continue;
        sum += Math.abs(lum(a, x, y) - lum(b, bx, y));
        n++;
      }
    }
    out.push({ shift: s, sad: n ? sum / n : Infinity });
  }
  return out;
}

function localMinima(profile, window = 6) {
  const mins = [];
  for (let i = window; i < profile.length - window; i++) {
    let isMin = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j !== i && profile[j].sad < profile[i].sad) {
        isMin = false;
        break;
      }
    }
    if (isMin) mins.push(profile[i]);
  }
  return mins.sort((p, q) => p.sad - q.sad).slice(0, 6);
}

/** Mean luminance inside a rect — the flash measurement. */
function meanLum(png, r) {
  let sum = 0;
  let n = 0;
  for (let y = r.y; y < r.y + r.height && y < png.height; y++) {
    for (let x = r.x; x < r.x + r.width && x < png.width; x++) {
      sum += lum(png, x, y);
      n++;
    }
  }
  return n ? sum / n : 0;
}

const out = {};

// --- The flight: how far did each layer travel? ----------------------------
if (existsSync(join(IMAGES, 'a1-05-sky-flight-0.png'))) {
  const f0 = load('a1-05-sky-flight-0.png');
  const f1 = load('a1-05-sky-flight-1.png');
  const f2 = load('a1-05-sky-flight-2.png');
  // Sky only: below the wave clock, above the controls strip, left of the
  // minimap, and clear of the ore readout.
  const region = { x0: 20, y0: 90, x1: 1100, y1: 740 };
  const p01 = shiftProfile(f0, f1, region, 300);
  const p12 = shiftProfile(f1, f2, region, 300);
  out.flight = {
    worldTravelPerLeg: 844,
    note: 'shift in px that best re-aligns the LATER frame onto the earlier one',
    leg01: { minima: localMinima(p01), atZero: p01[0].sad },
    leg12: { minima: localMinima(p12), atZero: p12[0].sad },
    profile01: p01.filter((p) => p.shift % 4 === 0),
  };
}

// --- The full-hold flash ----------------------------------------------------
const flashFiles = [];
for (let i = 0; i < 24; i++) {
  const full = `a1-05-flash-full-${i}.png`;
  const half = `a1-05-flash-half-${i}.png`;
  if (existsSync(join(IMAGES, full))) flashFiles.push(['full', i, full]);
  if (existsSync(join(IMAGES, half))) flashFiles.push(['half', i, half]);
}
if (flashFiles.length) {
  const series = { full: [], half: [] };
  for (const [kind, i, file] of flashFiles) {
    const png = load(file);
    series[kind].push({ i, mean: Number(meanLum(png, { x: 0, y: 0, width: png.width, height: png.height }).toFixed(3)) });
  }
  for (const kind of ['full', 'half']) {
    const vals = series[kind].map((s) => s.mean);
    if (!vals.length) continue;
    series[`${kind}Range`] = {
      min: Math.min(...vals),
      max: Math.max(...vals),
      spread: Number((Math.max(...vals) - Math.min(...vals)).toFixed(3)),
    };
  }
  out.holdFlash = series;
}

// --- The station ring: what fraction of it is cyan, at each range? ---------
// The crops are anchored on the station's own projected centre (the capture
// records it), so the circle sampled here is the circle the client drew.
const readback = JSON.parse(readFileSync(join(HERE, 'readback.json'), 'utf8'));
if (readback['station-health']?.frames) {
  out.stationRing = readback['station-health'].frames.map((f) => {
    const png = load(f.crop.replace('images/', ''));
    const ox = Math.max(0, Math.round(f.geometry.screen.x) - 130);
    const oy = Math.max(0, Math.round(f.geometry.screen.y) - 130);
    const cx = f.geometry.screen.x - ox;
    const cy = f.geometry.screen.y - oy;
    let best = null;
    for (let r = 60; r <= 80; r++) {
      let cyan = 0;
      let red = 0;
      for (let a = 0; a < 3600; a++) {
        const t = (a * Math.PI) / 1800;
        const x = Math.round(cx + r * Math.cos(t));
        const y = Math.round(cy + r * Math.sin(t));
        if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
        const i = (png.width * y + x) << 2;
        const [R, G, B] = [png.data[i], png.data[i + 1], png.data[i + 2]];
        if (G > 120 && B > 120 && R < 120) cyan++;
        else if (R > 140 && G < 110 && B < 110) red++;
      }
      if (!best || cyan + red > best.hit) best = { r, cyan, red, hit: cyan + red };
    }
    const tot = best.cyan + best.red;
    return {
      name: f.name,
      stagedCoreFraction: f.geometry.coreFraction,
      surfaceDistance: f.geometry.surfaceDistance,
      ringRadiusPx: best.r,
      cyanPct: Number(((100 * best.cyan) / tot).toFixed(1)),
      redPct: Number(((100 * best.red) / tot).toFixed(1)),
      arcSamples: tot,
    };
  });
}

// --- The backdrop's ground colour, off the composited frame ----------------
if (existsSync(join(IMAGES, 'a1-05-backdrop-frozen-desktop.png'))) {
  const png = load('a1-05-backdrop-frozen-desktop.png');
  const counts = new Map();
  for (let y = 100; y < 740; y += 2) {
    for (let x = 20; x < 1040; x += 2) {
      const i = (png.width * y + x) << 2;
      const key = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  out.backdrop = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, n]) => ({
      hex: '#' + k.split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join(''),
      rgb: k,
      pixels: n,
      pct: Number(((100 * n) / total).toFixed(2)),
    }));
}

writeFileSync(join(HERE, 'measurements.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.flight ?? {}, null, 1).slice(0, 2500));
console.log('holdFlash:', JSON.stringify(out.holdFlash?.fullRange), JSON.stringify(out.holdFlash?.halfRange));
