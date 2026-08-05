/**
 * evidence/build-a4-rings-figure.mjs — the a4-01 before/after, side by side.
 * OWNER: Art & Audio Agent. Read-only over PNGs it is handed.
 *
 * The field report was a screenshot, so the answer to it should be one too. This
 * crops the same square of world out of the BEFORE and AFTER desktop goldens —
 * 520 CSS px centred on the viewer's own station, which at this scene's ~1:1 zoom
 * comfortably contains the 256 u atmosphere — and lays them beside each other,
 * captioned.
 *
 * BEFORE comes from git, not from a stale file on disk:
 *
 *   git show <sha>:tests/mobile/goldens.spec.ts-snapshots/desktop-frozen-desktop-linux.png > /tmp/before.png
 *   node evidence/build-a4-rings-figure.mjs /tmp/before.png \
 *        tests/mobile/goldens.spec.ts-snapshots/desktop-frozen-desktop-linux.png
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const [beforeSrc, afterSrc] = process.argv.slice(2);
if (!beforeSrc || !afterSrc) throw new Error('usage: build-a4-rings-figure.mjs <before.png> <after.png>');

// The own station sits at (735, 400) in the 1280×800 desktop golden; 520 px of
// frame around it holds the whole atmosphere with room to breathe.
const BOX = { x: 735 - 260, y: 400 - 260, w: 520, h: 520 };

function crop(srcPath, dstPath) {
  const src = PNG.sync.read(readFileSync(srcPath));
  const out = new PNG({ width: BOX.w, height: BOX.h });
  PNG.bitblt(src, out, BOX.x, BOX.y, BOX.w, BOX.h, 0, 0);
  writeFileSync(dstPath, PNG.sync.write(out));
  return dstPath;
}

const b64 = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

const panels = [
  {
    img: crop(beforeSrc, '/tmp/a4_before.png'),
    tag: 'BEFORE',
    cap: 'Five concentric edges — look for them at roughly 0.26, 0.4, 0.6, 0.8 and 1.0 of the halo radius. They are meant to be one gradient: five stacked discs at alphas .035/.05/.065/.08/.1, which composite to jumps of ~0.067 apiece, about sixteen levels of a channel against Vacuum. That is a step, not a gradient, and it is countable. Docking range is marked nowhere at all, so none of the five is the edge that gates building.',
  },
  {
    img: crop(afterSrc, '/tmp/a4_after.png'),
    tag: 'AFTER',
    cap: 'Two rings. The soft outer band is the atmosphere edge at DEPOSIT_RANGE (256 u) — outer edge on the constant, exactly as before, p4-12 still green. The dashed plasma inside it is STATION.dockRange (160 u), drawn for the first time: cross it and the BUILD button lights. Between them is one smooth haze whose worst step is ~0.005, about one level — CI now fails any gradient step over 0.012.',
  },
];

const cells = panels
  .map(
    (p) => `
    <figure>
      <img src="${b64(p.img)}"/>
      <figcaption><span class="t">${p.tag}</span> ${p.cap}</figcaption>
    </figure>`,
  )
  .join('');

const html = `<!doctype html><html><head><meta charset="utf8"><style>
  :root{color-scheme:dark}
  body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1100px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;max-width:1140px}
  figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden}
  img{width:100%;display:block;background:#05070a}
  figcaption{padding:12px 14px;font-size:13px;color:#b6c0cd}
  .t{display:inline-block;background:#141a22;color:#4dc3ff;font-weight:700;letter-spacing:.5px;margin-right:6px}
</style></head><body>
  <h1>a4-01 — two rings around the station</h1>
  <p class="sub">The same 520&times;520 px of the frozen desktop golden, before and after. Same scene, same camera, same station; only the halo sprite changed. Neither radius moved — both are the sim's own constants, untouched.</p>
  <div class="grid">${cells}</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
const box = await page.locator('body').boundingBox();
await page.screenshot({ path: join(OUT, 'a4-rings-before-after.png'), clip: { x: 0, y: 0, width: 1200, height: Math.ceil(box.height) } });
await browser.close();
console.log('wrote', join(OUT, 'a4-rings-before-after.png'));
