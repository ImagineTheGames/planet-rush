/**
 * evidence/build-radar-wedge-figure.mjs — compose the `radar-wedge-restored`
 * deliverable montages from the frames capture-radar-wedge.mjs wrote to /tmp.
 * OWNER: QA Manager. Renders one captioned HTML montage per form factor and
 * screenshots it; adds no interpretation to the frames themselves. The phone frames
 * are rotated 90° CCW into the landscape orientation the player holds (the portrait
 * viewport is rotated under the landscape lock), so the wheel reads upright.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = '/tmp';
const rb = JSON.parse(readFileSync(join(OUT, 'radar-wedge-readback.json'), 'utf8'));

/** Rotate a PNG 90° counter-clockwise (undo the +90° landscape-lock rotation). */
function rotate90ccw(srcPath, dstPath) {
  const src = PNG.sync.read(readFileSync(srcPath));
  const { width: W, height: H } = src;
  const dst = new PNG({ width: H, height: W });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (W * y + x) << 2;
      const dx = y, dy = W - 1 - x;
      const di = (H * dy + dx) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  writeFileSync(dstPath, PNG.sync.write(dst));
  return dstPath;
}

const b64 = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

/** The five panels for a form factor, with captions drawn from the seam readback. */
function panels(key) {
  const r = rb[key];
  return [
    { img: r.files.armed, cap: `ARMED — the five-wedge Build wheel; the RADAR wedge shows "0/1" and cost 6. Hub ${r.bankStart} ORE, TOTAL ${r.bankStart}.` },
    { img: r.files.built, cap: `REAL TAP → BUILT — a genuine pointer press on the RADAR wedge spent exactly ${r.spent} ore (SATELLITE.cost): TOTAL ${r.bankStart}→${r.built.banked}, the wedge caps to "1/1" (dimmed).` },
    { img: r.files.fogLifted, cap: `FOG LIFTS — 12 s construction done; the satellite's LARGE coverage disc appears (coverage ${r.minimapBaseline.coverageCount}→${r.fogLifted.coverageCount}, satellites ${r.fogLifted.satelliteCount}) and reveals ${r.fogLifted.shipCount} enemy contacts (enemy dots 0→${r.fogLifted.shipCount}).` },
    { img: r.files.fogReturned, cap: `SATELLITE KILLED → FOG RETURNS — its HP driven to 0: the big disc collapses (coverage ${r.fogLifted.coverageCount}→${r.fogReturned.coverageCount}, satellites →${r.fogReturned.satelliteCount}, enemy dots →${r.fogReturned.shipCount}). Only the own-station reach remains.` },
    { img: r.files.rearmed, cap: `RE-ARMED — with the satellite gone the RADAR wedge is back to "0/1" and pressable (bright 6); bank ${r.rearm.banked} still ≥ 6, so it can be rebuilt.` },
  ];
}

function figureHTML(title, subtitle, cells) {
  const figs = cells.map((p, i) => `
    <figure>
      <img src="${p.src}"/>
      <figcaption><span class="n">${i + 1}</span>${p.cap}</figcaption>
    </figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark}
    body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:21px;margin:0 0 4px}
    .sub{color:#8b96a5;font-size:12.5px;margin:0 0 18px;max-width:1700px}
    .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;max-width:1720px}
    figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden}
    img{width:100%;display:block;background:#05070a}
    figcaption{padding:9px 10px;font-size:11.5px;color:#c2cbd7;min-height:96px}
    .n{display:inline-block;background:#1b3a6b;color:#cfe0ff;border-radius:50%;width:18px;height:18px;line-height:18px;text-align:center;font-weight:700;margin-right:6px;font-size:11px}
  </style></head><body>
    <h1>${title}</h1>
    <p class="sub">${subtitle}</p>
    <div class="grid">${figs}</div>
  </body></html>`;
}

async function render(page, file, html) {
  const path = join(TMP, file + '.html');
  writeFileSync(path, html);
  await page.goto('file://' + path, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  const box = await page.evaluate(() => ({ w: Math.ceil(document.body.getBoundingClientRect().width), h: document.body.scrollHeight }));
  await page.setViewportSize({ width: Math.min(1800, box.w + 52), height: box.h + 52 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, file + '.png'), fullPage: true });
  console.log('wrote', file + '.png');
}

const SUB_DESKTOP =
  `Build ${'dbf2541'} (HEAD), desktop 1280×800, live ?debug=1 (no freeze — the 12 s construction runs). ` +
  `Every build is a REAL synthesized pointer press on the drawn RADAR wedge (reconstructed geometry, self-checked to <1px against the REPAIR wedge), ` +
  `gated on sim state read off __repairStage / __minimapStage — a mis-tap fails the gate, it never fakes a pass. Numbers are the seams' own readback.`;
const SUB_MOBILE =
  `Build ${'dbf2541'} (HEAD), iPhone profile 390×844 @3x portrait, touch input, live ?debug=1. Frames rotated 90° CCW into the landscape ` +
  `orientation the player holds (the game is landscape-locked under a portrait viewport). Same REAL-tap, gated cycle as desktop, driven through the +90° transform.`;

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 })).newPage();

  // Desktop panels use the frames as-is (already landscape).
  const desktop = panels('desktop').map((p) => ({ ...p, src: b64(p.img) }));
  await render(page, 'radar-wedge-desktop', figureHTML(
    'radar-wedge-restored (desktop) — the RADAR wedge is back, a real tap builds the satellite, the minimap fog lifts, a kill returns it, the wedge re-arms',
    SUB_DESKTOP, desktop));

  // Mobile panels rotated CCW to landscape.
  const mobile = panels('mobile').map((p, i) => ({ ...p, src: b64(rotate90ccw(p.img, join(TMP, `rw_mobile_rot_${i}.png`))) }));
  await render(page, 'radar-wedge-mobile', figureHTML(
    'radar-wedge-restored (mobile / iPhone touch) — the same real-tap build → fog-lift → kill → re-arm cycle on the phone form factor',
    SUB_MOBILE, mobile));
} finally {
  await browser.close();
}
