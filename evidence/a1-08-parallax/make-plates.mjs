/**
 * evidence/a1-08-parallax/make-plates.mjs — a1-08, the plates. OWNER: QA Manager.
 *
 * Turns the raw isolated frames and the measured shifts into images a person can
 * look at and check the claim from. Two devices, both borrowed from how a1-05
 * stated its half-answer:
 *
 *  1. **Red/cyan registration.** Stop 0 goes in the red channel, the later stop
 *     in green+blue. Where the two agree the result is neutral grey; where they
 *     disagree it fringes red on one side and cyan on the other. Laid out twice
 *     per layer — once AT ZERO SHIFT (the "glued to the camera" hypothesis, which
 *     fringes) and once RE-ALIGNED by the measured shift (which does not). That
 *     is the whole argument in a form that needs no arithmetic to read.
 *
 *  2. **Amplification.** The isolated layers paint at single-digit luma over the
 *     canvas clear colour, so every panel is stretched by a FIXED per-layer gain
 *     printed on the plate. The stretch is applied identically to both stops, so
 *     it cannot manufacture or hide a shift.
 *
 * The numbers on the plates are read from the measurement JSON; nothing here
 * recomputes or rounds them differently.
 *
 *   node evidence/a1-08-parallax/make-plates.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const PLATES = join(HERE, 'plates');
const IMAGES = join(HERE, '..', 'images');
mkdirSync(PLATES, { recursive: true });

const read = (f) => PNG.sync.read(readFileSync(join(FRAMES, f)));

/** Per-image floor/peak, so a layer that paints at luma 13–28 becomes visible. */
function stretch(p) {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = p.data[i + c];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return { lo, gain: 255 / Math.max(1, hi - lo) };
}

/** luma after the stretch, as a plain array. */
function lumaPlane(p, lo, gain) {
  const n = p.width * p.height;
  const a = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const v = 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
    a[j] = Math.max(0, Math.min(255, Math.round((v - lo) * gain)));
  }
  return a;
}

/**
 * A crop of `A` in red against `B` (offset by dx,dy) in cyan. Agreement reads
 * grey; disagreement fringes. `dx/dy` is the shift being TESTED, so passing 0
 * draws the camera-locked hypothesis and passing the measured shift draws the
 * measured one.
 */
function registration(A, B, dx, dy, crop, out, zoom = 1) {
  const st = stretch(A);
  const la = lumaPlane(A, st.lo, st.gain);
  const lb = lumaPlane(B, st.lo, st.gain); // SAME stretch for both — see header
  const { x, y, w, h } = crop;
  const png = new PNG({ width: w * zoom, height: h * zoom });
  for (let jz = 0; jz < h * zoom; jz++) {
    for (let iz = 0; iz < w * zoom; iz++) {
      const i = Math.floor(iz / zoom);
      const j = Math.floor(jz / zoom);
      const ax = x + i;
      const ay = y + j;
      const bx = ax + Math.round(dx);
      const by = ay + Math.round(dy);
      // Outside the shifted frame there is no second sample, so the pixel goes
      // black rather than showing stop 0's red alone — an unpaired red band at
      // the edge would read as a misregistration finding when it is only the
      // margin the shift walked off.
      const inB = bx >= 0 && bx < B.width && by >= 0 && by < B.height;
      const va = inB ? la[ay * A.width + ax] ?? 0 : 0;
      const vb = inB ? lb[by * B.width + bx] : 0;
      const o = (jz * w * zoom + iz) * 4;
      png.data[o] = va; // red   = stop 0
      png.data[o + 1] = vb; // green } = the later stop
      png.data[o + 2] = vb; // blue  }
      png.data[o + 3] = 255;
    }
  }
  writeFileSync(join(PLATES, out), PNG.sync.write(png));
  return { out, gain: st.gain, floor: st.lo };
}

/** A plain stretched view of one frame (for the "what the layer looks like" row). */
function plain(A, crop, out, gainOverride) {
  const st = stretch(A);
  const gain = gainOverride ?? st.gain;
  const { x, y, w, h } = crop;
  const png = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = ((y + j) * A.width + (x + i)) * 4;
      const o = (j * w + i) * 4;
      for (let c = 0; c < 3; c++) png.data[o + c] = Math.max(0, Math.min(255, Math.round((A.data[s + c] - st.lo) * gain)));
      png.data[o + 3] = 255;
    }
  }
  writeFileSync(join(PLATES, out), PNG.sync.write(png));
  return { out, gain, floor: st.lo };
}

const dataUri = (f) => `data:image/png;base64,${readFileSync(join(PLATES, f)).toString('base64')}`;

// ── the plates ─────────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; }
  body { margin:0; background:#0b0d12; color:#dfe4ee; font:14px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; padding:26px 30px; }
  h1 { font-size:21px; margin:0 0 4px; letter-spacing:.2px; }
  .sub { color:#8d97ab; font-size:12.5px; margin-bottom:18px; }
  .sub b { color:#cbd3e2; font-weight:600; }
  .grid { display:grid; gap:14px; }
  .cap { font-size:12px; color:#9aa4b8; margin:6px 0 0; }
  .cap b { color:#e6ebf5; font-weight:600; }
  .panel { background:#12151d; border:1px solid #232838; border-radius:7px; padding:11px; }
  .panel img { display:block; width:100%; border-radius:3px; image-rendering:pixelated; }
  .tag { font:600 11.5px ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.4px; text-transform:uppercase; color:#7f8aa1; margin-bottom:8px; }
  .bad .tag { color:#ff8f7a; } .good .tag { color:#6fe0a8; }
  table { border-collapse:collapse; width:100%; font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace; }
  th,td { text-align:right; padding:5px 9px; border-bottom:1px solid #1e2331; }
  th:first-child, td:first-child { text-align:left; }
  th { color:#8d97ab; font-weight:600; border-bottom:1px solid #2b3245; }
  .hi { color:#7ee3b0; font-weight:700; }
  .zero { color:#ff9d86; }
  .note { color:#8d97ab; font-size:12px; margin-top:14px; border-top:1px solid #232838; padding-top:11px; }
  .note b { color:#cbd3e2; }
`;

async function shoot(browser, html, out, width) {
  const src = out.replace(/\.png$/, '.html');
  writeFileSync(join(PLATES, src), html);
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
  await page.goto(`file://${join(PLATES, src)}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready);
  await page.screenshot({ path: join(IMAGES, out), fullPage: true });
  await page.close();
  console.log(`  wrote images/${out}`);
}

const browser = await chromium.launch();

// ---------------------------------------------------------------------------
// PLATE 1 — the headline: the sky, re-aligned, against the camera-locked case.
// ---------------------------------------------------------------------------
for (const cfg of [
  { name: 'line', sky: 'deepEmber', pred: 0.085, title: 'The Line — deepEmber' },
  { name: 'compass', sky: 'coalsack', pred: 0.14, title: 'The Compass — coalsack' },
]) {
  let drift;
  try {
    drift = JSON.parse(readFileSync(join(FRAMES, `${cfg.name}-drift.json`), 'utf8'));
  } catch {
    console.log(`  (no ${cfg.name}-drift.json — skipping)`);
    continue;
  }
  const flight = JSON.parse(readFileSync(join(FRAMES, `${cfg.name}-flight.json`), 'utf8'));
  // The longest VALID baseline: longest because the residual is a fixed handful
  // of tenths of a pixel either way, so the ratio is tightest there; valid
  // because compass lost its last stop to the match ending mid-sequence.
  const usable = drift.pairs.filter((p) => !p.invalid && p.layers.some((l) => l.tag === 'nebula' && !l.degenerate));
  const pair = usable.reduce((a, b) => (Math.abs(b.dCamX) > Math.abs(a.dCamX) ? b : a));
  const dropped = drift.pairs.filter((p) => p.invalid);
  const L = (t) => pair.layers.find((l) => l.tag === t);
  const sky = L('nebula');
  const deep = L('deep');

  const A = read(sky.frames[0]);
  const B = read(sky.frames[1]);
  const CROP = { x: 120, y: 120, w: 1120, h: 620 };

  const zero = registration(A, B, 0, 0, CROP, `${cfg.name}-sky-zero.png`);
  const align = registration(A, B, sky.measuredDx, sky.measuredDy, CROP, `${cfg.name}-sky-aligned.png`);
  // The deep stars are single-pixel points, so their panels are a smaller region
  // magnified 2× (nearest-neighbour, no smoothing): at full-frame scale a 14 px
  // doubling is invisible and the panel would prove nothing to a reader's eye.
  const dA = read(deep.frames[0]);
  const dB = read(deep.frames[1]);
  const SCROP = { x: 130, y: 150, w: 560, h: 310 };
  const dZero = registration(dA, dB, sky.measuredDx, sky.measuredDy, SCROP, `${cfg.name}-deep-at-sky-shift.png`, 2);
  const dAlign = registration(dA, dB, deep.measuredDx, deep.measuredDy, SCROP, `${cfg.name}-deep-aligned.png`, 2);

  const rows = pair.layers
    .map((l) => {
      const m = l.measuredDx == null ? 'unmeasurable' : l.framesIdentical ? '0.00' : l.measuredDx.toFixed(2);
      const ratio = l.measuredRatio == null ? '—' : l.measuredRatio.toFixed(4);
      const cls = l.tag === 'nebula' ? 'hi' : l.tag === 'ground' ? 'zero' : '';
      return `<tr><td>${l.label ?? l.tag}</td><td class="${cls}">${m}</td><td>${
        l.predictedDx == null ? '—' : l.predictedDx.toFixed(2)
      }</td><td class="${cls}">${ratio}</td><td>${l.declaredParallax ?? '—'}</td><td>${
        l.sceneGraphDx == null ? '—' : l.sceneGraphDx.toFixed(2)
      }</td><td>${l.degenerate ? '—' : l.zeroOverBest}</td></tr>`;
    })
    .join('');

  const perScreen = (r) => (r == null ? '—' : (r * flight.screenWidthU).toFixed(1));
  // Direction and sense are read off the measurement, not assumed: `line` was
  // flown east (content moves left, dx negative) and `compass` west. And
  // coalsack is FASTER than the deep stars — it is dust in front of them, not a
  // backdrop behind them — so "falls behind" is wrong for it by design.
  const cyanSide = sky.measuredDx < 0 ? 'left' : 'right';
  const gap = Math.abs(deep.measuredDx) - Math.abs(sky.measuredDx);
  const skyIsSlower = gap > 0;
  const gapPerScreen = Math.abs(deep.measuredRatio - sky.measuredRatio) * flight.screenWidthU;

  const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<h1>a1-08 · ${cfg.title} — the sky's own drift, measured against the stars'</h1>
<div class="sub">served build <b>${flight.served.sha}</b> · ${flight.map} · 1440×900 at dpr 1, so <b>1 image px = 1 CSS px = 1 world unit</b> ·
flew <b>${Math.abs(pair.flownX).toFixed(1)} u</b> ${pair.flownX < 0 ? 'west' : 'east'}, camera offset moved <b>${pair.dCamX.toFixed(
    2,
  )} px</b> ·
each layer isolated by hiding every other layer and every sibling of the void container</div>

<div class="grid" style="grid-template-columns:1fr 1fr">
  <div class="panel bad">
    <div class="tag">the sky · tested at zero shift — "glued to the camera"</div>
    <img src="${dataUri(zero.out)}">
    <p class="cap">Stop 0 in <b>red</b>, stop ${pair.to} in <b>cyan</b>, both stretched ${zero.gain.toFixed(
      1,
    )}× from floor ${zero.floor}. Every disc is doubled — a red one and a cyan one, cyan to the ${cyanSide}. <b>The sky moved.</b></p>
  </div>
  <div class="panel good">
    <div class="tag">the same pair, re-aligned by ${Math.abs(sky.measuredDx).toFixed(2)} px</div>
    <img src="${dataUri(align.out)}">
    <p class="cap">Shift stop ${pair.to} back by <b>${sky.measuredDx.toFixed(2)} px</b> in x (${sky.measuredDy} in y) and the doubling closes to neutral grey.
    Mean abs difference is <b>${sky.zeroOverBest}×</b> worse at zero shift than here.</p>
  </div>
  <div class="panel bad">
    <div class="tag">the deep stars · tested at the SKY's shift</div>
    <img src="${dataUri(dZero.out)}">
    <p class="cap">The same ${Math.abs(sky.measuredDx).toFixed(
      2,
    )} px applied to <b>void-stars-deep</b>, a 560×310 region at 2×. Still doubled — every star is a red dot with a cyan one beside it: the stars did <b>not</b> move by the sky's amount.</p>
  </div>
  <div class="panel good">
    <div class="tag">the deep stars, re-aligned by ${Math.abs(deep.measuredDx).toFixed(2)} px</div>
    <img src="${dataUri(dAlign.out)}">
    <p class="cap">Same region, same 2×. The stars need <b>${deep.measuredDx.toFixed(2)} px</b> — ${Math.abs(gap).toFixed(
      2,
    )} px ${skyIsSlower ? 'more' : 'less'} than the sky over this flight — and now each pair closes to a single white point.
    ${
      skyIsSlower
        ? 'That gap is the separation the sky is supposed to have: it travels with the stars and falls behind them slowly.'
        : 'The sky here is the <b>faster</b> of the two — coalsack is dust in FRONT of the deep layer, so it out-runs the stars rather than trailing them.'
    }</p>
  </div>
</div>

<table style="margin-top:16px">
  <tr><th>layer</th><th>measured px</th><th>predicted px</th><th>measured ÷ camera</th><th>declared parallax</th><th>live transform px</th><th>zero ÷ best</th></tr>
  ${rows}
</table>

<div class="note">
  <b>Per screen-width flown (${flight.screenWidthU} u), from the measured ratios:</b>
  sky <b>${perScreen(sky.measuredRatio)} px</b> · deep stars <b>${perScreen(deep.measuredRatio)} px</b> ·
  the sky ${skyIsSlower ? 'falls' : '<b>out-runs</b> them by'} <b>${gapPerScreen.toFixed(1)} px</b> ${
    skyIsSlower ? 'behind them' : ''
  } per screen-width.
  <b>void-ground</b> is parallax 0 — the picture of a layer that IS glued to the camera; its frames are byte-identical across every stop,
  which is also how we know nothing live leaked past the isolation.
  The <b>live transform</b> column is read from the Pixi scene graph and never consulted by the correlator; the two columns are independent measurements.
  ${
    dropped.length
      ? `<br><br><b>Dropped from this plate:</b> ${dropped.length} camera stop(s). ${dropped[0].invalidReason} Those frames are kept in <code>frames/</code> and are not measurements of anything.`
      : ''
  }
</div>`;

  await shoot(browser, html, `a1-08-${cfg.name}-sky-drift.png`, 1500);
}

// ---------------------------------------------------------------------------
// PLATE 2 — the ladder: every layer, one flight, 0 → 0.085 → 0.10 → 0.26 → 0.50
// ---------------------------------------------------------------------------
{
  const drift = JSON.parse(readFileSync(join(FRAMES, 'line-drift.json'), 'utf8'));
  const flight = JSON.parse(readFileSync(join(FRAMES, 'line-flight.json'), 'utf8'));
  const pair = drift.pairs[1];
  const CROP = { x: 160, y: 160, w: 1040, h: 480 };

  const panels = pair.layers
    .map((l) => {
      const A = read(l.frames[0]);
      const B = read(l.frames[1]);
      const p = registration(A, B, 0, 0, CROP, `ladder-${l.tag}.png`);
      const moved = l.framesIdentical ? '0.00' : l.measuredDx == null ? 'unmeasurable' : l.measuredDx.toFixed(2);
      return `<div class="panel"><div class="tag">${l.label ?? l.tag} — parallax ${l.declaredParallax ?? '?'}</div>
        <img src="${dataUri(p.out)}">
        <p class="cap">Red = stop 0, cyan = stop ${pair.to}, no re-alignment, stretched ${p.gain.toFixed(1)}×.
        Measured drift <b>${moved} px</b>${l.framesIdentical ? ' — the two frames are the same bytes' : ''}.</p></div>`;
    })
    .join('');

  const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<h1>a1-08 · the whole ladder on one flight — what each layer does when the camera moves ${Math.abs(
    pair.dCamX,
  ).toFixed(0)} px</h1>
<div class="sub">served build <b>${flight.served.sha}</b> · The Line · flew <b>${pair.flownX.toFixed(
    1,
  )} u</b> east · every panel is the same two camera positions, overlaid with <b>no</b> re-alignment, so the width of the red/cyan separation IS the drift</div>
<div class="grid" style="grid-template-columns:1fr 1fr">${panels}</div>
<div class="note">Top-left is the null: <b>void-ground</b> sits at parallax 0, is glued to the camera by construction, and shows no separation at all because the two frames are byte-identical.
Reading down, the separation widens in the declared order — the sky at <b>0.0850</b> sits just below the deep stars at <b>0.1001</b>, which is the whole of what a0-07b set out to do:
close enough to travel with them, strictly slower, so it separates slowly instead of sticking to the glass.</div>`;

  await shoot(browser, html, 'a1-08-line-layer-ladder.png', 1500);
}

await browser.close();
console.log('plates done');
