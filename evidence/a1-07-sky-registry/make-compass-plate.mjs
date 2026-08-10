/**
 * evidence/a1-07-sky-registry/make-compass-plate.mjs — a1-07, The Compass's own
 * plate. OWNER: QA Manager.
 *
 * Coalsack earns a second plate because it is the one sky whose whole read is an
 * ABSENCE, and an absence needs two things the other five do not:
 *
 *   TOP — a patch where the star field demonstrably STOPS. The |A−B| isolation
 *   already located every star the dust lane covers; this finds the densest such
 *   cluster automatically (the 400×250 device-px window holding the most revealed
 *   star pixels) and shows the same window three ways at 3×: with the dust,
 *   without it, and the difference. No hand-picked crop — the window is chosen by
 *   the measurement, so it cannot be chosen to flatter.
 *
 *   BOTTOM — motion. Three camera positions along one live flight, each with the
 *   star points the profile was computed from, and the shift that best re-aligns
 *   consecutive profiles (`measure-compass-motion.mjs`).
 *
 *   node evidence/a1-07-sky-registry/make-compass-plate.mjs
 */
import { PNG } from 'pngjs';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const WIN = { w: 400, h: 250 };
const ZOOM = 3;

const load = (n) => PNG.sync.read(readFileSync(join(FRAMES, n)));
const lum = (p, i) => 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];

const A = load('compass-A-frozen.png');
const B = load('compass-B-no-nebula.png');

// --- find the window with the most star-pixels revealed by hiding the dust ----
// Only B-brighter-than-A counts: those are stars the lane was covering. (A minus
// B would also catch any pixel the lane made brighter — it makes none, which is
// itself the point, and the search would then be measuring nothing.)
const revealed = new Uint8Array(A.width * A.height);
for (let i = 0, p = 0; i < revealed.length; i++, p += 4) {
  revealed[i] = lum(B, p) - lum(A, p) > 8 ? 1 : 0;
}
let best = { x: 0, y: 0, n: -1 };
for (let y = 200; y + WIN.h < 1560; y += 25) {
  for (let x = 60; x + WIN.w < 2520; x += 25) {
    let n = 0;
    for (let dy = 0; dy < WIN.h; dy += 2) {
      const row = (y + dy) * A.width;
      for (let dx = 0; dx < WIN.w; dx += 2) n += revealed[row + x + dx];
    }
    if (n > best.n) best = { x, y, n };
  }
}
const totalRevealed = revealed.reduce((s, v) => s + v, 0);
console.log(`revealed star pixels in the whole frame: ${totalRevealed}`);
console.log(`densest ${WIN.w}x${WIN.h} window at (${best.x}, ${best.y}) — ${best.n} sampled revealed pixels`);

/** Crop `png` to the chosen window, nearest-neighbour zoomed, optionally amplified. */
function crop(png, amp = 1) {
  const out = new PNG({ width: WIN.w * ZOOM, height: WIN.h * ZOOM });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const sp = (png.width * (best.y + Math.floor(y / ZOOM)) + best.x + Math.floor(x / ZOOM)) << 2;
      const dp = (out.width * y + x) << 2;
      for (let c = 0; c < 3; c++) out.data[dp + c] = Math.min(255, png.data[sp + c] * amp);
      out.data[dp + 3] = 255;
    }
  }
  return out;
}
writeFileSync(join(FRAMES, 'compass-zoom-with-dust.png'), PNG.sync.write(crop(A, 3)));
writeFileSync(join(FRAMES, 'compass-zoom-no-dust.png'), PNG.sync.write(crop(B, 3)));
writeFileSync(join(FRAMES, 'compass-zoom-difference.png'), PNG.sync.write(crop(load('compass-sky-isolated.png'))));

const motion = JSON.parse(readFileSync(join(HERE, 'compass-motion.json'), 'utf8'));
const readback = JSON.parse(readFileSync(join(FRAMES, 'readback.json'), 'utf8'));
const flight = readback.compassFlight;

const row = (p) => `<tr>
  <td>${p.from} → ${p.to}</td>
  <td class="n">${p.cameraTravelWorldUnits} u = ${p.cameraTravelDevicePx} px</td>
  <td class="n">${p.bestShiftPx} px</td>
  <td class="n">${(p.shiftAsFractionOfCameraTravel * 100).toFixed(1)}%</td>
  <td>${p.scoreAt.screenLocked}</td>
  <td class="hit">${p.predicted.deepStars010} px → <b>${p.scoreAt.deepStars010}</b></td>
  <td>${p.predicted.coalsack014} px → ${p.scoreAt.coalsack014}</td>
</tr>`;

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:26px 24px 30px; background:#14181d; color:#b9c2cc;
         font-family:'Oxanium',ui-monospace,monospace; width:1520px; }
  h1 { font-size:20px; margin:0 0 3px; color:#4DC3FF; font-weight:600; }
  h2 { font-size:14px; margin:20px 0 8px; color:#e7edf3; font-weight:600; }
  h2 .sub { color:#7E8894; font-weight:400; font-size:12px; }
  .lede { font-size:12.5px; margin:4px 0 14px; line-height:1.6; color:#8b96a3; }
  .lede b { color:#cfd7e0; } code { color:#e0c07a; }
  .row { display:flex; gap:12px; }
  figure { margin:0; }
  figure img { display:block; border:1px solid #2b333c; }
  .z img { width:487px; }
  .f img { width:487px; }
  figcaption { font-size:11px; line-height:1.45; padding-top:5px; color:#8b96a3; width:487px; }
  figcaption b { color:#cfd7e0; }
  table { border-collapse:collapse; font-size:11.5px; margin-top:10px; width:100%; }
  td,th { border:1px solid #2b333c; padding:4px 9px; text-align:left; }
  th { color:#7E8894; font-weight:400; }
  td.n { color:#e7edf3; } td.hit { color:#57d98a; }
  .note { font-size:11.5px; color:#7E8894; line-height:1.55; margin-top:8px; }
</style></head><body>
  <h1>The Compass — Coalsack, the sky you see by what is missing</h1>
  <p class="lede">
    Served bundle <b>${readback.served.sha}</b>. The live stage carries
    <code>void-nebula-coalsack</code> and carries it <b>last</b> — draw order
    <code>void-ground › void-stars-deep › void-stars-mid › void-stars-near › void-nebula-coalsack</code>,
    i.e. in FRONT of all three star layers, which is what <code>occludes: true</code> is for.
    Coalsack is the ground colour, so it adds no light: over the whole frozen frame its own paint
    changed <b>0.1%</b> of pixels, mean ink r17.8 g18.4 b18.9 — neutral grey, the colour of the stars it
    covered rather than any ink of its own.
  </p>

  <h2>The patch where the star field stops <span class="sub">— 400×250 device px at (${best.x}, ${best.y}), 3×; the window is the one holding the MOST covered stars, chosen by the measurement, not by hand</span></h2>
  <div class="row z">
    <figure><img src="compass-zoom-with-dust.png"/><figcaption><b>A — the dust drawing</b> (frozen, ×3 exposure so the void is legible). Empty.</figcaption></figure>
    <figure><img src="compass-zoom-no-dust.png"/><figcaption><b>B — <code>void-nebula-coalsack</code> hidden</b>, same exposure. The stars come back.</figcaption></figure>
    <figure><img src="compass-zoom-difference.png"/><figcaption><b>|A − B| × 14 — every star the lane was standing in front of.</b> ${totalRevealed.toLocaleString()} pixels of star are covered across the whole frame.</figcaption></figure>
  </div>

  <h2>In motion <span class="sub">— one straight live flight ${flight.dir}, three camera positions; below each frame, the star points the profile is computed from</span></h2>
  <div class="row f">
    ${flight.frames.map((f, i) => `<figure><img src="${f.file}"/><figcaption><b>frame ${i + 1}</b> — ship world x ${f.worldX} (${f.flown} u flown)</figcaption></figure>`).join('')}
  </div>
  <div class="row f">
    ${flight.frames.map((f, i) => `<figure><img src="star-map-compass-${i + 1}.png"/><figcaption>the extracted star points, ${motion.pairs ? '' : ''}frame ${i + 1}</figcaption></figure>`).join('')}
  </div>
  <table>
    <tr><th>frames</th><th>camera travelled</th><th>best re-alignment</th><th>as % of camera travel</th>
        <th>r at screen-locked (0 px)</th><th>r at deep stars, parallax 0.10</th><th>r at Coalsack's own 0.14</th></tr>
    ${motion.pairs.map(row).join('')}
  </table>
  <p class="note">
    <b>What this settles and what it does not.</b> The field is not stuck to the glass: on both short
    baselines the profile re-aligns at 10.0% and 9.9% of the camera's travel — the deep star layer's
    <code>parallax 0.1</code> to within a pixel — and scores materially worse at 0 px (0.51 vs 0.61, 0.43 vs 0.60).
    It does NOT resolve Coalsack's own 0.14 from the 0.10 of the stars it eats: those predictions are 4% of
    travel apart (37 px and 28 px here) and a few hundred star pixels will not separate them; 0.14 scores
    below 0.10 on every pair, which is the expected answer for a profile made of STARS.
    The long pair (1→3) is the method failing honestly rather than being dropped: it peaks at 33 px and
    scores best of all at 0 px. Two reasons, both real — the star field is not rigid (deep 0.10, mid 0.26,
    near 0.50 separate by hundreds of px over 1636 px of travel), and frame 1 alone contains the home
    station's dashed range rings, thin and dim enough to survive the point detector as fixed structure near
    frame centre. Pair 2→3 is the clean one, and it is the one that lands on 0.10.
  </p>
</body></html>`;

const file = join(FRAMES, 'plate-compass-motion.html');
writeFileSync(file, HTML);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1570, height: 1400 }, deviceScaleFactor: 1.4 });
const page = await ctx.newPage();
await page.goto(`file://${file}`, { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.screenshot({ path: join(FRAMES, 'plate-compass-motion.png'), fullPage: true });
await browser.close();
writeFileSync(join(HERE, 'compass-occlusion.json'), `${JSON.stringify({ window: { ...best, ...WIN }, totalRevealedPixels: totalRevealed }, null, 2)}\n`);
console.log('wrote plate-compass-motion.png');
