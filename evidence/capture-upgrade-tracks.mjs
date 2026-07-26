/**
 * evidence/capture-upgrade-tracks.mjs — P4 upgrade-wheel evidence. OWNER: QA Manager.
 *
 * Two deliverables, all off the REAL preview bundle through the ?debug=1 upgrade
 * live-stage seam (`window.__upgradeWheelStage`) that the UI team's own spec drives:
 *
 *   1. exact-cost-purchase — the scenario that failed on a192ed8: bank == a wedge's
 *      cost EXACTLY. openUpgrade(2) banks exactly 2 ore (CARGO's cost). BEFORE frame:
 *      CARGO reads affordable (ore-yellow cost, not dimmed) while the cost-3 wedges
 *      (ENGINE/HULL) are dimmed — proof the exact-cost boundary is affordable, not
 *      off-by-one. Then buyByTrack('cargo') through the sim's real buyUpgrade. AFTER
 *      frame: the hub ore reads 0 and the CARGO wedge has re-rendered its next tier.
 *
 *   2. damage-and-speed-tracks — the WEAPON sub-wheel (reached via the main wheel's
 *      WEAPON wedge → openWeapon()) showing DAMAGE and SPEED, both affordable, each
 *      carrying its current→next delta (DAMAGE a per-hit integer, SPEED a percent)
 *      and an ore cost, plus the BACK wedge.
 *
 * Everything is shot under ?freeze=1 so the wheel holds still, and every frame
 * prints the seam's wedge readback so the attestation cites what actually rendered.
 *
 * Usage: node evidence/capture-upgrade-tracks.mjs   (needs the preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const VP = { width: 1280, height: 800 };
const DSF = 2;
const WHEEL_CLIP = { x: 300, y: 150, width: 680, height: 520 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(browser, query) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__upgradeWheelStage?.openUpgrade === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // --- 1. exact-cost-purchase (bank == CARGO cost == 2) ----------------------
  {
    const page = await boot(browser, '/?debug=1&freeze=1');
    const opened = await page.evaluate(() => window.__upgradeWheelStage.openUpgrade(2));
    await sleep(150);
    const before = await page.evaluate(() => window.__upgradeWheelStage.wedges());
    const bankBefore = await page.evaluate(() => window.__pressStage?.bank?.() ?? null);
    await page.screenshot({ path: join(OUT, 'exact-cost-before.png'), clip: WHEEL_CLIP });
    await page.screenshot({ path: join(OUT, 'exact-cost-before-full.png') });

    const buy = await page.evaluate(() => window.__upgradeWheelStage.buyByTrack('cargo'));
    await sleep(150);
    const after = await page.evaluate(() => window.__upgradeWheelStage.wedges());
    const bankAfter = await page.evaluate(() => window.__pressStage?.bank?.() ?? null);
    await page.screenshot({ path: join(OUT, 'exact-cost-after.png'), clip: WHEEL_CLIP });
    await page.screenshot({ path: join(OUT, 'exact-cost-after-full.png') });

    console.log('[exact-cost]', JSON.stringify({
      opened, bankBefore, bankAfter, buy,
      cargoBefore: before.find((w) => w.track === 'cargo'),
      cargoAfter: after.find((w) => w.track === 'cargo'),
      statesBefore: before.map((w) => `${w.label}:${w.state}:${w.cost}`),
      errors: page._errors,
    }, null, 2));
    await page.context().close();
  }

  // --- 2. damage-and-speed-tracks (the WEAPON sub-wheel) ---------------------
  {
    const page = await boot(browser, '/?debug=1&freeze=1');
    await page.evaluate(() => window.__upgradeWheelStage.openUpgrade(999));
    const w = await page.evaluate(() => window.__upgradeWheelStage.openWeapon());
    await sleep(200);
    const wedges = await page.evaluate(() => window.__upgradeWheelStage.wedges());
    await page.screenshot({ path: join(OUT, 'weapon-subwheel.png'), clip: WHEEL_CLIP });
    await page.screenshot({ path: join(OUT, 'weapon-subwheel-full.png') });

    // Seam-certain "both purchasable": buy one DAMAGE tier and one SPEED tier
    // through the sim's real buyUpgrade; each must report ok and the tier steps up.
    const damageBefore = await page.evaluate(() => window.__upgradeWheelStage.wedges().find((x) => x.track === 'power'));
    const buyDamage = await page.evaluate(() => window.__upgradeWheelStage.buyByTrack('power'));
    await sleep(120);
    const damageAfter = await page.evaluate(() => window.__upgradeWheelStage.wedges().find((x) => x.track === 'power'));
    await page.screenshot({ path: join(OUT, 'weapon-subwheel-damage-bought.png'), clip: WHEEL_CLIP });
    const buySpeed = await page.evaluate(() => window.__upgradeWheelStage.buyByTrack('speed'));
    await sleep(120);
    const speedAfter = await page.evaluate(() => window.__upgradeWheelStage.wedges().find((x) => x.track === 'speed'));

    console.log('[weapon-subwheel]', JSON.stringify({
      open: w, wedges,
      buyDamage, damageBefore, damageAfter,
      buySpeed, speedAfter,
      errors: page._errors,
    }, null, 2));
    await page.context().close();
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
