/**
 * evidence/a1-07-sky-registry/measure-grey-discs.mjs — a1-07, the developer's
 * actual complaint. OWNER: QA Manager.
 *
 * The round was called because of one line from live play:
 *
 *   "it doesnt look right, perhaps the stars that are supposed to be there are
 *    underneath?"  — on soft grey discs in an otherwise empty field.
 *
 * The registry half of that question is now answered: on `octagon`, the DEFAULT
 * arena, hiding `void-nebula-*` changes literally zero pixels, because there is
 * no such layer to hide. Nothing draws a sky there. So whatever the discs are,
 * they are not the sky.
 *
 * This asks what they ARE, off the frame rather than off a theory. Frame D of the
 * octagon set has EVERY void layer but the ground hidden — no sky, not one star,
 * not one bloom halo. Anything still in the empty field is a world object. This
 * segments those objects, measures them, and puts the number the brief already
 * ruled out beside them:
 *
 *   • the largest star is the `near` layer at `maxR 2.2`, its outer bloom halo
 *     `4.3×` that — about **19 px across** at ~6% alpha (BLOOM.intensity[1] =
 *     0.065). The brief's ruling-out says the discs are "several times that".
 *     This measures how many times.
 *
 * Segmentation is a flood fill over pixels above the Floor ground, restricted to
 * the open band and to grey (max channel − min channel small) — so a station's
 * blue rings, the ore's yellow and the HUD's text are not counted as discs.
 *
 *   node evidence/a1-07-sky-registry/measure-grey-discs.mjs
 */
import { PNG } from 'pngjs';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');

/** The open band, device px of the 2880×1800 (dpr 2) shot: clear of the HUD
 *  strips top and bottom and of the minimap plate bottom-right. */
const BAND = { x0: 40, x1: 2500, y0: 250, y1: 1520 };
const DPR = 2;
/** Above the Floor ground (#010204, luma ≈ 1.4) by enough to be an object. */
const ON = 10;
/** Grey: no channel more than this above the darkest. Rocks are neutral; the
 *  station rings, ore and beams are not. */
const GREY_SPREAD = 26;
/** Ignore specks — a disc the developer can see is not 12 px². */
const MIN_AREA = 400;

/** The brief's bloom arithmetic, restated so the comparison is checkable:
 *  near-layer maxR 2.2 → outer halo radius 2.2 × 4.3 = 9.46 → 18.9 px across. */
const BLOOM_HALO_CSS_PX = 2.2 * 4.3 * 2;

const png = PNG.sync.read(readFileSync(join(FRAMES, 'octagon-D-ground-only.png')));
const { width, height } = png;
const at = (x, y) => (width * y + x) << 2;

const on = new Uint8Array(width * height);
for (let y = BAND.y0; y < BAND.y1; y++) {
  for (let x = BAND.x0; x < BAND.x1; x++) {
    const p = at(x, y);
    const r = png.data[p];
    const g = png.data[p + 1];
    const b = png.data[p + 2];
    const lo = Math.min(r, g, b);
    const hi = Math.max(r, g, b);
    if (hi > ON && hi - lo <= GREY_SPREAD) on[width * y + x] = 1;
  }
}

// Flood fill (4-connected, iterative — 5.2M pixels will not survive recursion).
const seen = new Uint8Array(width * height);
const blobs = [];
const stack = new Int32Array(width * height);
for (let y = BAND.y0; y < BAND.y1; y++) {
  for (let x = BAND.x0; x < BAND.x1; x++) {
    const start = width * y + x;
    if (!on[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0;
    let minX = x;
    let maxX = x;
    let minY = y;
    let maxY = y;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    while (sp > 0) {
      const i = stack[--sp];
      const iy = (i / width) | 0;
      const ix = i - iy * width;
      area++;
      if (ix < minX) minX = ix;
      if (ix > maxX) maxX = ix;
      if (iy < minY) minY = iy;
      if (iy > maxY) maxY = iy;
      const p = i << 2;
      sr += png.data[p];
      sg += png.data[p + 1];
      sb += png.data[p + 2];
      for (const j of [i - 1, i + 1, i - width, i + width]) {
        if (j < 0 || j >= on.length || seen[j] || !on[j]) continue;
        const jy = (j / width) | 0;
        const jx = j - jy * width;
        if (jx < BAND.x0 || jx >= BAND.x1 || jy < BAND.y0 || jy >= BAND.y1) continue;
        seen[j] = 1;
        stack[sp++] = j;
      }
    }
    if (area < MIN_AREA) continue;
    const wpx = maxX - minX + 1;
    const hpx = maxY - minY + 1;
    const meanR = sr / area;
    const meanG = sg / area;
    const meanB = sb / area;
    const elong = Math.max(wpx, hpx) / Math.max(1, Math.min(wpx, hpx));
    const meanLuma = 0.2126 * meanR + 0.7152 * meanG + 0.0722 * meanB;
    // Not everything neutral-and-brighter-than-Floor is a rock, and saying so is
    // the difference between a measurement and a slogan. Three kinds come out:
    //   • a long thin band          → ARENA_WALL_BANDS, the edge of the world
    //   • a big dark region         → the station's own dark body / its halo ring
    //   • compact, rock-ink, mid    → the asteroid field, which is what was asked
    const kind =
      elong > 6 ? 'arena wall band' : meanLuma < 15 ? 'station body / halo ring' : 'asteroid';
    blobs.push({
      kind,
      elongation: Math.round(elong * 10) / 10,
      x: minX,
      y: minY,
      w: wpx,
      h: hpx,
      areaDevicePx: area,
      widthCssPx: Math.round((wpx / DPR) * 10) / 10,
      heightCssPx: Math.round((hpx / DPR) * 10) / 10,
      // Equivalent diameter of a disc of the same area — the honest single number
      // for a lumpy silhouette.
      equivDiameterCssPx: Math.round((2 * Math.sqrt(area / Math.PI) / DPR) * 10) / 10,
      meanRgb: [Math.round(sr / area), Math.round(sg / area), Math.round(sb / area)],
    });
  }
}
blobs.sort((a, b) => b.areaDevicePx - a.areaDevicePx);

// A second pass the first pass needs: the station is not ONE component. Its dark
// atmosphere/halo ring segments out as a big dark region, but its grey hull and
// its gantry parts are separate mid-grey components sitting INSIDE that ring, and
// a rule that only knows about colour and elongation calls each of them a rock.
// So anything whose centre lands inside a station footprint is re-labelled. This
// is the difference between "12 discs, and they are the rocks" and a count that
// quietly includes the thing in the middle of the screen.
const stationBoxes = blobs.filter((b) => b.kind === 'station body / halo ring');
for (const b of blobs) {
  if (b.kind !== 'asteroid') continue;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (stationBoxes.some((s2) => cx >= s2.x && cx <= s2.x + s2.w && cy >= s2.y && cy <= s2.y + s2.h)) {
    b.kind = 'station part (inside the halo ring)';
  }
}
const rocks = blobs.filter((b) => b.kind === 'asteroid');
const others = blobs.filter((b) => b.kind !== 'asteroid');

const out = {
  frame: 'octagon-D-ground-only.png',
  what: 'every void layer but void-ground hidden — no sky, no stars, no bloom',
  band: BAND,
  bloomHaloCssPxAcross: Math.round(BLOOM_HALO_CSS_PX * 10) / 10,
  count: blobs.length,
  asteroidCount: rocks.length,
  otherObjects: others.map((b) => ({ kind: b.kind, w: b.widthCssPx, h: b.heightCssPx, meanRgb: b.meanRgb })),
  medianEquivDiameterCssPx: rocks.length
    ? [...rocks.map((b) => b.equivDiameterCssPx)].sort((a, b) => a - b)[rocks.length >> 1]
    : null,
  largestEquivDiameterCssPx: rocks[0]?.equivDiameterCssPx ?? null,
  smallestEquivDiameterCssPx: rocks[rocks.length - 1]?.equivDiameterCssPx ?? null,
  blobs,
};
out.medianVsBloomHalo = out.medianEquivDiameterCssPx
  ? Math.round((out.medianEquivDiameterCssPx / BLOOM_HALO_CSS_PX) * 10) / 10
  : null;

console.log(`${blobs.length} grey objects in the open field with EVERY void layer but the ground hidden`);
console.log(`  of which ${rocks.length} are asteroids; the rest: ${others.map((b) => b.kind).join(', ') || 'none'}`);
console.log(`  ASTEROID equivalent diameters (CSS px): median ${out.medianEquivDiameterCssPx}, range ${out.smallestEquivDiameterCssPx}–${out.largestEquivDiameterCssPx}`);
console.log(`  the largest star's bloom halo, for comparison: ${out.bloomHaloCssPxAcross} px across`);
console.log(`  median disc is ${out.medianVsBloomHalo}x the halo`);
console.log(`  mean ink of the five largest asteroids: ${rocks.slice(0, 5).map((b) => `rgb(${b.meanRgb.join(',')})`).join('  ')}`);

// --- the annotated frame ----------------------------------------------------
const marked = PNG.sync.read(readFileSync(join(FRAMES, 'octagon-D-ground-only.png')));
const stroke = (x, y, c) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const p = at(x, y);
  marked.data[p] = c[0];
  marked.data[p + 1] = c[1];
  marked.data[p + 2] = c[2];
};
for (const b of blobs) {
  const c = b.kind === 'asteroid' ? [255, 90, 100] : [90, 130, 190];
  const pad = 10;
  for (let t = 0; t < 3; t++) {
    for (let x = b.x - pad; x <= b.x + b.w + pad; x++) {
      stroke(x, b.y - pad - t, c);
      stroke(x, b.y + b.h + pad + t, c);
    }
    for (let y = b.y - pad; y <= b.y + b.h + pad; y++) {
      stroke(b.x - pad - t, y, c);
      stroke(b.x + b.w + pad + t, y, c);
    }
  }
}
writeFileSync(join(FRAMES, 'octagon-discs-marked.png'), PNG.sync.write(marked));
writeFileSync(join(HERE, 'grey-discs.json'), `${JSON.stringify(out, null, 2)}\n`);

// --- the plate --------------------------------------------------------------
const rows = rocks
  .slice(0, 13)
  .map(
    (b, i) =>
      `<tr><td>${i + 1}</td><td class="n">${b.widthCssPx} × ${b.heightCssPx}</td><td class="n">${b.equivDiameterCssPx}</td>
       <td class="n">${Math.round((b.equivDiameterCssPx / BLOOM_HALO_CSS_PX) * 10) / 10}×</td>
       <td><span class="sw" style="background:rgb(${b.meanRgb.join(',')})"></span> rgb(${b.meanRgb.join(', ')})</td></tr>`,
  )
  .join('');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:26px 24px 30px; background:#14181d; color:#b9c2cc;
         font-family:'Oxanium',ui-monospace,monospace; width:1520px; }
  h1 { font-size:20px; margin:0 0 4px; color:#4DC3FF; font-weight:600; }
  .lede { font-size:12.5px; margin:4px 0 14px; line-height:1.6; color:#8b96a3; }
  .lede b { color:#cfd7e0; } code { color:#e0c07a; }
  .row { display:flex; gap:12px; align-items:flex-start; }
  figure { margin:0; } figure img { display:block; width:740px; border:1px solid #2b333c; }
  figcaption { font-size:11px; line-height:1.45; padding-top:5px; color:#8b96a3; width:740px; }
  figcaption b { color:#cfd7e0; }
  table { border-collapse:collapse; font-size:11.5px; }
  td,th { border:1px solid #2b333c; padding:3px 9px; text-align:left; }
  th { color:#7E8894; font-weight:400; } td.n { color:#e7edf3; }
  .sw { display:inline-block; width:10px; height:10px; border:1px solid #39424c; vertical-align:-1px; margin-right:5px; }
  .note { font-size:11.5px; color:#7E8894; line-height:1.55; margin-top:10px; }
</style></head><body>
  <h1>The Octagon — what the soft grey discs actually are</h1>
  <p class="lede">
    Served bundle <b>dd1d3f5</b>, the DEFAULT arena. <code>MAP_NEBULA.octagon</code> is <b>none</b> and the live
    stage agrees: there is no <code>void-nebula-*</code> layer on the stage at all, and hiding that prefix changes
    <b>zero</b> pixels. Both frames below have every void layer but <code>void-ground</code> hidden — <b>no sky, not
    one star, not one bloom halo.</b> Everything still visible is a world object.
  </p>
  <div class="row">
    <figure><img src="octagon-discs-marked.png"/><figcaption>
      <b>${blobs.length} neutral-grey objects</b> found by flood fill over everything brighter than Floor and
      neutral in hue (so the station's blue rings, the ore's yellow and the HUD text are already excluded).
      <b style="color:#ff5a64">Red — the ${rocks.length} asteroids</b>: compact rock polygons with a lighter
      silhouette rim, opaque, standing in front of whatever star would have been behind them.
      <b style="color:#5a82be">Blue — the ${others.length} that are NOT rocks</b> and are named rather than
      quietly counted in: ${others.map((b) => `${b.kind} (${b.widthCssPx}×${b.heightCssPx} px)`).join('; ')}.
    </figcaption></figure>
    <div>
      <table>
        <tr><th>#</th><th>bbox, CSS px</th><th>equiv. diameter</th><th>vs a bloom halo</th><th>mean ink</th></tr>
        ${rows}
      </table>
      <p class="note">
        The largest star in the field is the <code>near</code> layer at <code>maxR 2.2</code>, and its outer bloom halo
        is <code>4.3×</code> that — <b>${out.bloomHaloCssPxAcross} px across at ~6% alpha</b>
        (<code>BLOOM.intensity[1] = 0.065</code>). The median object here is
        <b>${out.medianEquivDiameterCssPx} px</b> across — <b>${out.medianVsBloomHalo}× the halo</b> — and opaque
        rather than a 6% wash. The ruling-out in the brief holds, and this is what is left.
      </p>
    </div>
  </div>
  <p class="note">
    <b>Read this as a lead, not a verdict on the developer's screenshot.</b> What is attested is what is in THIS
    frame: on the default arena, with no sky drawn and every star layer off, the empty field still contains
    ${rocks.length} soft-edged neutral-grey discs several times the size of the largest bloom, and they are the
    rocks. That matches the report's shape — including "the stars that are supposed to be there are underneath",
    which is exactly true of an opaque rock. It is not proof that this is what they were looking at; nobody has
    matched their frame to a map, a build or a moment.
  </p>
</body></html>`;

const file = join(FRAMES, 'plate-grey-discs.html');
writeFileSync(file, HTML);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1570, height: 1000 }, deviceScaleFactor: 1.4 });
const page = await ctx.newPage();
await page.goto(`file://${file}`, { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.screenshot({ path: join(FRAMES, 'plate-grey-discs.png'), fullPage: true });
await browser.close();
console.log(`\nwrote ${HERE}/grey-discs.json and frames/plate-grey-discs.png`);
