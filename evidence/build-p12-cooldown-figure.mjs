/**
 * evidence/build-p12-cooldown-figure.mjs — compose the `repair-cooldown` deliverable
 * figure from the raw frames + readback captured by capture-p12-cooldown.mjs.
 * OWNER: QA Manager. Read-only over the PNGs/JSON; every caption number is copied
 * from the run's own readback (p12-cooldown-readback.json). No claim here is not
 * on the frame or in the readback.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const img = (p) => 'data:image/png;base64,' + readFileSync(join(OUT, p)).toString('base64');
const rb = (p) => JSON.parse(readFileSync(join(OUT, p), 'utf8'));

function figureHTML(title, sub, panels) {
  const cells = panels.map((p) => `
    <figure class="${p.wide ? 'wide' : ''} ${p.finding ? 'finding' : ''}">
      <img src="${img(p.img)}"/>
      <figcaption><span class="t ${p.finding ? 'tf' : ''}">${p.tag}</span> ${p.cap}</figcaption>
    </figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark}
    body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:20px;margin:0 0 4px}
    .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1180px}
    .grid{display:flex;flex-wrap:wrap;gap:16px;max-width:1180px;align-items:flex-start}
    figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden;flex:1 1 calc(50% - 8px);min-width:0}
    figure.wide{flex-basis:100%}
    figure.finding{border-color:#8a5a1e}
    img{width:100%;display:block;background:#05070a}
    figcaption{padding:10px 12px;font-size:12.5px;color:#b9c2cf}
    .t{display:inline-block;background:#1b3a6b;color:#cfe0ff;border-radius:4px;padding:1px 8px;font-weight:600;margin-right:6px}
    .t.tf{background:#7a4a12;color:#ffddaa}
    b{color:#ffd24f}
  </style></head><body>
    <h1>${title}</h1><p class="sub">${sub}</p>
    <div class="grid">${cells}</div></body></html>`;
}

async function shoot(page, html, out) {
  const fp = '/tmp/_p12fig.html';
  writeFileSync(fp, html);
  await page.goto('file://' + fp, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => ({ w: Math.ceil(document.body.getBoundingClientRect().width), h: Math.ceil(document.body.scrollHeight) }));
  await page.setViewportSize({ width: Math.min(1240, box.w + 52), height: box.h + 52 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, out), fullPage: true });
  console.log('wrote', out);
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 })).newPage();
  const r = rb('p12-cooldown-readback.json');
  const sha = r.build.sha + (r.build.dirty ? '*' : '');

  await shoot(page, figureHTML(
    'repair-cooldown — a repair lands, the station locks out for 15s (taps do nothing), then re-arms and a second repair lands',
    `Build ${sha}, live ?debug=1 (NO freeze). PR #203 (sim p12) gave station repair a 15s per-station cooldown: a repair press arms `
      + `<b>MiningStation.repairGate = 15s</b>, and while it is &gt; 0 the sim refuses the next repair order <b>'cooling-down'</b>, spending nothing. `
      + `Every press below is a REAL pointerdown on the drawn REPAIR REACTOR wedge (the shipped __repairStage seam only sieged the core to `
      + `${r.read0.coreHp}/${r.read0.maxCoreHp} and funded ${r.read0.banked} ore). Elapsed-seconds captions are derived from fixed sim ticks `
      + `(TICK_DT 1/60), not wall-clock. REPAIR_HP_PER_ORE 15, REPAIR_ORE_COST 1.`,
    [
      { tag: '1 · LAND (tick ' + r.A.tick + ')', img: 'p12-cooldown-A-land.png',
        cap: `One real tap on REPAIR REACTOR lands a repair: the HOME core bar (top-right) reads <b>${r.A.read.coreHp}/${r.A.read.maxCoreHp}</b> `
          + `(core ${r.read0.coreHp}→${r.A.read.coreHp}, +${r.A.coreDelta} HP) and the hub reads <b>${r.A.read.banked} ORE</b> `
          + `(bank ${r.read0.banked}→${r.A.read.banked}, ${r.A.bankDelta} ore). The repairGate arms to 15s this same tick.` },
      { tag: '2 · GATED · FINDING', finding: true, img: 'p12-cooldown-B-gated.png',
        cap: `<b>${r.B.elapsedSimS}s</b> into the 15s lockout, <b>${r.B.taps} rapid real taps</b> land ZERO effect: the core bar is still `
          + `<b>${r.B.read.coreHp}/${r.B.read.maxCoreHp}</b> and the hub is still <b>${r.B.read.banked} ORE</b> `
          + `(coreFrozen=${r.B.coreFrozen}, bankFrozen=${r.B.bankFrozen}) — the sim refused every tap 'cooling-down', spending nothing. `
          + `FINDING: the wedge is INDISTINGUISHABLE from panel 1 — it still draws "<b>${r.B.wedge.sub}</b>" ready=${r.B.wedge.ready}. `
          + `There is NO "REPAIR in Ns" countdown, no dimming, no reason copy. The 15s gate is enforced by the sim but INVISIBLE to the player `
          + `(the cross-lane UI countdown from PR #203 is not yet wired).` },
      { wide: true, tag: '3 · RE-ARM (' + r.C.elapsedSimS + 's elapsed, tick ' + r.C.tick + ')', img: 'p12-cooldown-C-rearm.png',
        cap: `Once <b>${r.C.elapsedSimS}s</b> of sim time have passed since the landing (repairGate drained to 0), a real tap lands a SECOND repair: `
          + `the HOME core bar reads <b>${r.C.read.coreHp}/${r.C.read.maxCoreHp}</b> (core ${r.B.read.coreHp}→${r.C.read.coreHp}, +${r.C.coreDelta} HP) `
          + `and the hub reads <b>${r.C.read.banked} ORE</b> (bank ${r.B.read.banked}→${r.C.read.banked}, ${r.C.bankDelta} ore). `
          + `The cooldown expired and the station is armed again — one repair every 15s, not one every frame.` },
    ],
  ), 'repair-cooldown.png');

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
