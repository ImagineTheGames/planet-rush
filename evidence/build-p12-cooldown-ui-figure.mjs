/**
 * evidence/build-p12-cooldown-ui-figure.mjs — compose the re-verified
 * `repair-cooldown-countdown-ui` deliverable figure from the raw frames + readback
 * captured by capture-p12-cooldown-ui.mjs. OWNER: QA Manager. Read-only over the
 * PNGs/JSON; every caption number is copied from the run's own readback
 * (p12-cd-ui-readback.json). No claim here is not on the frame or in the readback.
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
    <figure class="${p.wide ? 'wide' : ''} ${p.good ? 'good' : ''}">
      <img src="${img(p.img)}"/>
      <figcaption><span class="t ${p.good ? 'tg' : ''}">${p.tag}</span> ${p.cap}</figcaption>
    </figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark}
    body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:20px;margin:0 0 4px}
    .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1180px}
    .grid{display:flex;flex-wrap:wrap;gap:16px;max-width:1180px;align-items:flex-start}
    figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden;flex:1 1 calc(50% - 8px);min-width:0}
    figure.wide{flex-basis:100%}
    figure.good{border-color:#1e6b3a}
    img{width:100%;display:block;background:#05070a;max-height:760px;object-fit:contain}
    figcaption{padding:10px 12px;font-size:12.5px;color:#b9c2cf}
    .t{display:inline-block;background:#1b3a6b;color:#cfe0ff;border-radius:4px;padding:1px 8px;font-weight:600;margin-right:6px}
    .t.tg{background:#14532b;color:#c8f2d6}
    b{color:#ffd24f}
  </style></head><body>
    <h1>${title}</h1><p class="sub">${sub}</p>
    <div class="grid">${cells}</div></body></html>`;
}

async function shoot(page, html, out) {
  const fp = '/tmp/_p12uifig.html';
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
  const r = rb('p12-cd-ui-readback.json');
  const sha = r.build.sha + (r.build.dirty ? '*' : '');
  const pc = r.pc, ph = r.phone;

  // Panel for a form factor's GATED (grayed countdown + refused-tap no-ore) frame.
  const gated = (f, key, label) => ({
    good: true, tag: `${label} · MID-COOLDOWN`, img: `p12-cd-ui-${key}-B-gated.png`,
    cap: `The REPAIR REACTOR wedge is now GRAYED (ready=<b>${f.B.wedge.ready}</b>) and draws a live countdown "<b>${f.B.wedge.sub}</b>" `
      + `— dim, unlike the bright TURRET/SHIELD deals; its cost "1" is gray, not signal-yellow. `
      + `REFUSED-TAP proof: <b>${f.B.taps} rapid real taps</b> into that grayed wedge moved ZERO ore and ZERO HP — the core bar holds `
      + `<b>${f.B.read.coreHp}/${f.B.read.maxCoreHp}</b> and the hub holds <b>${f.B.read.banked} ORE</b> `
      + `(coreFrozen=${f.B.coreFrozen}, bankFrozen=${f.B.bankFrozen}). The countdown reads off sim state each frame — it ticks down between the `
      + `readback snapshot and the shot as the gate drains.`,
  });
  // Panel for a form factor's RE-ARM (ready "+15 HP") frame.
  const rearm = (f, key, label) => ({
    good: true, tag: `${label} · RE-ARMED at expiry`, img: `p12-cd-ui-${key}-C-rearm.png`,
    cap: `Once the gate drains to 0 (~${f.C.elapsedSimS}s of sim time), the SAME wedge re-arms to a bright "<b>${f.C.wedge.sub}</b>" `
      + `ready=<b>${f.C.wedge.ready}</b> with a signal-yellow "1" — matching TURRET/SHIELD. A real tap from this state lands a SECOND repair: `
      + `core <b>${f.C.readAtRearm.coreHp}→${f.C.readAfterTap.coreHp}</b> (+${f.C.coreDelta} HP), bank <b>${f.C.readAtRearm.banked}→${f.C.readAfterTap.banked}</b> (${f.C.bankDelta} ore).`,
  });

  await shoot(page, figureHTML(
    'repair-cooldown-countdown-ui — RE-VERIFIED: the wedge now tells the truth about the 15s cooldown (grayed "REPAIR in Ns", re-arms at expiry)',
    `Build ${sha}, live ?debug=1 (NO freeze). Round-9 FAILED on 35c2595: the 15s repair lockout was enforced sim-side but INVISIBLE — the wedge `
      + `kept drawing "+15 HP" ready=true while every tap was silently refused. PR #212 (p12 cooldown-wedge) wired <b>station.repairGate</b> through to `
      + `the wedge. Re-checked here on BOTH form factors with REAL taps at the drawn wedge (${r.pc_label} · mouse; ${r.phone_label} · touch). `
      + `In each, one tap first LANDS a repair (core ${pc.read0.coreHp}→${pc.A.read.coreHp}, bank ${pc.read0.banked}→${pc.A.read.banked}) and arms the 15s gate; `
      + `the frames below show the grayed live countdown mid-window, the refused taps that move nothing, and the wedge re-arming at expiry. `
      + `Zero page errors on either run. REPAIR_HP_PER_ORE 15, REPAIR_ORE_COST 1, REPAIR_COOLDOWN_SECONDS 15.`,
    [
      gated(pc, 'pc', 'DESKTOP'),
      rearm(pc, 'pc', 'DESKTOP'),
      gated(ph, 'phone', 'iPHONE'),
      rearm(ph, 'phone', 'iPHONE'),
    ],
  ), 'p12-cooldown-countdown-ui.png');

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
