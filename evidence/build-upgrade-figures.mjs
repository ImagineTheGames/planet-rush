/**
 * evidence/build-upgrade-figures.mjs — compose the captioned exact-cost-purchase
 * and damage-and-speed-tracks deliverables from the wheel crops captured by
 * capture-upgrade-tracks.mjs. OWNER: QA Manager. Read-only over the PNGs.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const b64 = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

function figureHTML(title, sub, panels) {
  const cells = panels.map((p) => `
    <figure>
      <img src="${b64(join(OUT, p.img))}"/>
      <figcaption><span class="t">${p.tag}</span> ${p.cap}</figcaption>
    </figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark}
    body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:22px;margin:0 0 4px}
    .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1120px}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;max-width:1080px}
    figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden}
    img{width:100%;display:block;background:#05070a}
    figcaption{padding:10px 12px;font-size:12.5px;color:#b9c2cf}
    .t{display:inline-block;background:#1b3a6b;color:#cfe0ff;border-radius:4px;padding:1px 8px;font-weight:600;margin-right:6px}
  </style></head><body>
    <h1>${title}</h1><p class="sub">${sub}</p>
    <div class="grid">${cells}</div></body></html>`;
}

async function shoot(page, html, out) {
  writeFileSync('/tmp/_fig.html', html);
  await page.goto('file:///tmp/_fig.html', { waitUntil: 'load' });
  await page.waitForTimeout(250);
  const box = await page.evaluate(() => ({ w: Math.ceil(document.body.getBoundingClientRect().width), h: Math.ceil(document.body.scrollHeight) }));
  await page.setViewportSize({ width: Math.min(1200, box.w + 52), height: box.h + 52 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, out), fullPage: true });
  console.log('wrote', out);
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 })).newPage();

  await shoot(page, figureHTML(
    'exact-cost-purchase — the wheel sells at EXACT cost (the a192ed8 failure, now correct)',
    'Build b4cd87d, ?debug=1&freeze=1 upgrade wheel via __upgradeWheelStage.openUpgrade(2) — the ship banked exactly 2 ore, CARGO’s cost. The purchase runs through the sim’s real buyUpgrade. Cost is the only ore-yellow number on a wedge (style-guide §2); a dimmed grey cost means unaffordable.',
    [
      { img: 'exact-cost-before.png', tag: 'BEFORE', cap: 'Hub ore = 2. CARGO (2 → 4) shows its cost “2” in ORE-YELLOW — affordable at exactly bank == cost. ENGINE and HULL, both cost 3, show “3” in GREY (unaffordable at bank 2). The exact-cost boundary is affordable, not off-by-one.' },
      { img: 'exact-cost-after.png', tag: 'AFTER', cap: 'buyByTrack(\'cargo\') → result "ok". Hub ore = 0 (bank hit exactly zero). CARGO re-rendered to its next tier: 4 → 6, cost now 6. The spent “2” is caught mid-arc floating from the wedge toward the hub. The purchase SUCCEEDED at exact cost.' },
    ],
  ), 'exact-cost-purchase.png');

  await shoot(page, figureHTML(
    'damage-and-speed-tracks — the WEAPON sub-wheel: DAMAGE and SPEED, both purchasable',
    'Build b4cd87d, ?debug=1&freeze=1. openUpgrade(999) → openWeapon() drills into the WEAPON sub-wheel behind the main wheel’s WEAPON wedge. Two projectile tracks live here (RATIFIED v0.2.2). SPEED’s 100%→115%→130% mirrors the sim’s ratified SHOT_SPEED_STEPS [1,1.15,1.3] — projectile muzzle velocity; a speed tier makes the same shot cross the range sooner (harder to dodge). The isolated two-frame in-flight speed differential was not cleanly capturable headless and is not claimed here beyond the ratified constant.',
    [
      { img: 'weapon-subwheel.png', tag: 'SUB-WHEEL', cap: 'Three wedges: DAMAGE (10 → 13, per-hit value, cost “4” ore-yellow), SPEED (100% → 115%, cost “8” ore-yellow), and BACK ◀ TO SHIP. Both track costs are ore-yellow — both affordable/purchasable at 999 ore.' },
      { img: 'weapon-subwheel-damage-bought.png', tag: 'BOUGHT', cap: 'buyByTrack(\'power\') → "ok", tier 0→1: the DAMAGE wedge re-rendered to 13 → 15, its cost stepped to 8, hub ore 999 → 995, the spent “4” floating toward the hub. (SPEED buys identically: buyByTrack(\'speed\') → "ok", wedge → 115% → 130%.)' },
    ],
  ), 'damage-and-speed-tracks.png');

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
