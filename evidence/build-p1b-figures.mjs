/**
 * evidence/build-p1b-figures.mjs — compose the four p1b deliverable figures from
 * the raw frames captured by capture-wheel-real.mjs / capture-legend.mjs /
 * capture-theme.mjs. OWNER: QA Manager. Read-only over the PNGs.
 *
 *   weapon-wheel-real      — E -> UPGRADE SHIP -> WEAPON -> buy -> BACK, no bounce
 *   upgrades-apply-real    — tier-0 baseline vs every-track-raised
 *   contextual-build-legend— PC near/far strip + mobile near/far
 *   button-theme-consistent— menu (SETTINGS active) + end (both alive) + disabled row
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const b64 = (p) => 'data:image/png;base64,' + readFileSync(join(OUT, p)).toString('base64');

function figureHTML(title, sub, panels) {
  const cells = panels.map((p) => `
    <figure class="${p.wide ? 'wide' : ''}">
      <img src="${b64(p.img)}"/>
      <figcaption><span class="t">${p.tag}</span> ${p.cap}</figcaption>
    </figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark}
    body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:21px;margin:0 0 4px}
    .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1120px}
    .grid{display:flex;flex-wrap:wrap;gap:16px;max-width:1120px;align-items:flex-start}
    figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden;flex:1 1 calc(50% - 8px);min-width:0}
    figure.wide{flex-basis:100%}
    img{width:100%;display:block;background:#05070a}
    figcaption{padding:10px 12px;font-size:12.5px;color:#b9c2cf}
    .t{display:inline-block;background:#1b3a6b;color:#cfe0ff;border-radius:4px;padding:1px 8px;font-weight:600;margin-right:6px}
  </style></head><body>
    <h1>${title}</h1><p class="sub">${sub}</p>
    <div class="grid">${cells}</div></body></html>`;
}

async function shoot(page, html, out) {
  const fp = '/tmp/_p1bfig.html';
  const { writeFileSync } = await import('node:fs');
  writeFileSync(fp, html);
  await page.goto('file://' + fp, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  const box = await page.evaluate(() => ({ w: Math.ceil(document.body.getBoundingClientRect().width), h: Math.ceil(document.body.scrollHeight) }));
  await page.setViewportSize({ width: Math.min(1220, box.w + 52), height: box.h + 52 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, out), fullPage: true });
  console.log('wrote', out);
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1220, height: 900 }, deviceScaleFactor: 2 })).newPage();

  // 1) weapon-wheel-real
  await shoot(page, figureHTML(
    'weapon-wheel-real — WEAPON sub-wheel by real clicks; BACK returns to the upgrade wheel, not the build wheel',
    'Build 986b11e, live ?debug=1 (NO freeze). The seam only PLACED the ship docked+funded (60 ore); every wheel-open and navigation below is a REAL key/mouse event the sim’s own pointerdown handler hit-tests. Center (640,400), r=230. The developer reported that buying in the WEAPON sub-wheel bounced the player back to the BUILD wheel — these four frames, captured in one unbroken real-input session, show it does not.',
    [
      { img: 'wwr-1-build-wheel.png', tag: '1 · E KEY', cap: 'A real “E” press opens the BUILD wheel: TURRET/YOUR PLANET (3), SHIELD/YOUR PLANET (5), REPAIR CORE/YOUR PLANET (1), UPGRADE SHIP/YOUR SHIP with a ▶. Hub “60 ORE”.' },
      { img: 'wwr-3-weapon-sub.png', tag: '2 · CLICK WEAPON', cap: 'Real click on UPGRADE SHIP (502,400) opened the upgrade wheel; a real click on WEAPON (640,262) opened the SUB-WHEEL: DAMAGE (10→13, cost 4), SPEED (100%→115%, cost 8), BACK ◀ TO SHIP. Hub “60 / VANGUARD”.' },
      { img: 'wwr-4-after-buy.png', tag: '3 · BUY DAMAGE', cap: 'Real click on DAMAGE (640,262) buys one tier: the wedge re-renders 13→15 (cost now 8) and the hub drops 60→56 (−4 ore spent). Still on the sub-wheel — no bounce on purchase.' },
      { img: 'wwr-5-after-back.png', tag: '4 · CLICK BACK', cap: 'Real click on BACK (520,469) returns to the UPGRADE main wheel — WEAPON/ENGINE/CARGO/HULL, with the WEAPON group’s DAMAGE pip now filled ●○○ from the purchase. It did NOT drop to TURRET/SHIELD/REPAIR/UPGRADE. The bounce-back is gone.' },
    ],
  ), 'weapon-wheel-real.png');

  // 2) upgrades-apply-real
  await shoot(page, figureHTML(
    'upgrades-apply-real — one tier of EVERY track bought by real clicks; each ship stat steps up',
    'Build 986b11e, live ?debug=1 (NO freeze), 999 ore. Opened via a real E press + real UPGRADE SHIP click, then every track bought by a real mouse click at its wedge point. The wedge current→next strings are the game’s only ship-stat readout (GDD §2.2/§2.5); the deltas below are read straight off the live wheel. Verified per-track (before→after current): ENGINE 100%→115%, CARGO 2→4, HULL 50→60, DAMAGE 10→13, SPEED 100%→115% — hub 999→979 (spent 3+2+3+4+8=20).',
    [
      { img: 'uar-0-baseline.png', tag: 'BEFORE (tier 0)', cap: 'Pristine wheel, nothing bought: WEAPON pips empty (DAMAGE ○○○, SPEED ○○), ENGINE 100%→115%, CARGO 2→4, HULL 50→60. Every “current” is the tier-0 base value.' },
      { img: 'uar-final-main.png', tag: 'AFTER (all +1)', cap: 'After one real-click purchase per track: DAMAGE ●○○ and SPEED ●○ filled; ENGINE now 115%→130%, CARGO 4→6, HULL 60→70 — each “current” has advanced one tier. Hub reads 979.' },
    ],
  ), 'upgrades-apply-real.png');

  // 3) contextual-build-legend
  await shoot(page, figureHTML(
    'contextual-build-legend — the BUILD affordance is gated on proximity to your own planet (dockRange 160u)',
    'Build 986b11e, live ?debug=1. “Far” is a real tap-to-move order flown >440u from spawn (well outside the 160u dock bubble); “near” is docked at the home planet. Desktop shows the bottom controls strip; mobile (emulated landscape phone, touch) shows the on-screen button.',
    [
      { img: 'legend-pc-near-strip.png', wide: true, tag: 'PC · NEAR', cap: 'Docked. The strip offers the live control “E Build & Upgrade” at full brightness (E binding in cyan), among Thrust / Aim / Fire / Boost / Ping.' },
      { img: 'legend-pc-far-strip.png', wide: true, tag: 'PC · FAR', cap: 'Away from the planet. The BUILD entry is DIMMED to grey and carries its reason — “Build & Upgrade — get closer to your planet” — with no “E” binding, while every other control stays bright. Offered when near, dimmed-with-reason when far.' },
      { img: 'legend-mobile-near-full.png', tag: 'MOBILE · NEAR', cap: 'Docked at the home planet (“YOU”). The cyan BUILD & UPGRADE button is present, top-left, alongside BOOST / PING / FIRE.' },
      { img: 'legend-mobile-far-full.png', tag: 'MOBILE · FAR', cap: 'Ship flown out to open space (planet off-screen). The BUILD & UPGRADE button is GONE — only BOOST / PING / FIRE remain. Parity with desktop: the button appears only near.' },
    ],
  ), 'contextual-build-legend.png');

  // 4) button-theme-consistent
  await shoot(page, figureHTML(
    'button-theme-consistent — enabled controls read active; the one disabled control is grey WITH its reason',
    'Build 986b11e, real front-door boots. The shared button contract (src/ui/button-theme.ts) gives every enabled control a full-contrast chalk label; grey is reserved for genuinely-disabled controls, which must state why. Menu = clean boot; end screen = ?debug=1 + __endScreenStage.endMatch(); the disabled row is the live away-from-planet BUILD legend.',
    [
      { img: 'theme-menu-raw.png', tag: 'MENU', cap: 'PLAY (plasma-cyan, PRIMARY) and SETTINGS (steel, STANDARD) both carry a full 2px border and a full-contrast chalk label — SETTINGS is unmistakably active alongside PLAY, differing only in hue, not in “aliveness”.' },
      { img: 'theme-end-result-raw.png', tag: 'END SCREEN', cap: 'Match over (“DEFEAT — Player 2 took the system”). BOTH actions are alive: REMATCH (plasma PRIMARY) and BACK TO MENU (steel STANDARD), each a full-contrast chalk label — neither is greyed.' },
      { img: 'legend-pc-far-strip.png', wide: true, tag: 'DISABLED + REASON', cap: 'For contrast: a genuinely-disabled control. Away from the planet the BUILD legend renders GREY and states its reason — “Build & Upgrade — get closer to your planet” — while the surrounding controls stay bright. Grey appears only where a control is truly unavailable, and it always says why.' },
    ],
  ), 'button-theme-consistent.png');

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
