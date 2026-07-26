/**
 * evidence/build-turret-figure.mjs — compose the captioned turret-healthbars
 * deliverable from the two live captures. OWNER: QA Manager. Crops the relevant
 * region out of each full frame (DSF 2, so image px = CSS px × 2) and lays them
 * into a captioned montage. Read-only over the captured PNGs.
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const D = 2; // deviceScaleFactor of the captures

/** Crop a CSS-space rect {x,y,w,h} out of a DSF-2 PNG → new PNG file. */
function crop(srcPath, dstPath, { x, y, w, h }) {
  const src = PNG.sync.read(readFileSync(srcPath));
  const out = new PNG({ width: w * D, height: h * D });
  PNG.bitblt(src, out, x * D, y * D, w * D, h * D, 0, 0);
  writeFileSync(dstPath, PNG.sync.write(out));
  return dstPath;
}

const b64 = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

async function main() {
  // Crops (CSS px). Tuned to the captured frames.
  const ownCrop = crop(join(OUT, 'turret-own-full.png'), '/tmp/turret_own_crop.png',
    { x: 430, y: 300, w: 360, h: 280 });
  const enemyCrop = crop(join(OUT, 'turret-enemy-full.png'), '/tmp/turret_enemy_crop.png',
    { x: 640, y: 440, w: 360, h: 280 });

  const panels = [
    {
      img: ownCrop,
      tag: 'OWN',
      cap: 'Two turrets built on the LOCAL planet (your colour, blue — same as the YOU ring). __healthbarStage.damageTurret dropped one to 40% hp: it wears a short BLUE bar at its rim/orbit position. Its full-HP sibling below the planet wears NONE. bars(): [{owner:0, fraction:0.40, local:false}] — the only bar drawn (a lull: the ship carries no bar).',
    },
    {
      img: enemyCrop,
      tag: 'ENEMY',
      cap: 'A bot planet (Rusty, teal) staged beside the ship out in open space; with no local turret, damageTurret fell to Rusty’s turret at 35% hp — a short TEAL (owner-colour) bar at its orbit. bars() reports {owner:1, fraction:0.35, local:false}. Threat red is never used on an enemy bar (style-guide §2): a low enemy turret shows a short bar in ITS colour, not red.',
    },
  ];

  const cells = panels.map((p) => `
    <figure>
      <img src="${b64(p.img)}"/>
      <figcaption><span class="t">${p.tag}</span> ${p.cap}</figcaption>
    </figure>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark}
    body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:22px;margin:0 0 4px}
    .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1100px}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;max-width:1040px}
    figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden}
    img{width:100%;display:block;background:#05070a}
    figcaption{padding:10px 12px;font-size:12.5px;color:#b9c2cf}
    .t{display:inline-block;background:#1b3a6b;color:#cfe0ff;border-radius:4px;padding:1px 8px;font-weight:600;margin-right:6px}
  </style></head><body>
    <h1>turret-healthbars — every turret wears a bar when damaged; a full one wears none (v0.2.2)</h1>
    <p class="sub">Build fb75961. Live ?debug=1 offline match (turrets do not exist at spawn — they are built). Bars are drawn by the real HUD health-bar layer; each caption quotes the bars() the layer reported for that frame. The bar colour is the turret OWNER’s identity colour — blue for the local player, teal for the bot Rusty.</p>
    <div class="grid">${cells}</div>
  </body></html>`;
  writeFileSync('/tmp/fig_turret_hb.html', html);

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await page.goto('file:///tmp/fig_turret_hb.html', { waitUntil: 'load' });
  await page.waitForTimeout(250);
  const box = await page.evaluate(() => ({ w: Math.ceil(document.body.getBoundingClientRect().width), h: Math.ceil(document.body.scrollHeight) }));
  await page.setViewportSize({ width: Math.min(1200, box.w + 52), height: box.h + 52 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, 'turret-healthbars.png'), fullPage: true });
  console.log('wrote turret-healthbars.png');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
