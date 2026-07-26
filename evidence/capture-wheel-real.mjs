/**
 * evidence/capture-wheel-real.mjs — the wheel, walked through the front door.
 * OWNER: QA Manager.
 *
 * REAL input on the live build (no freeze; real E key + real mouse clicks at the
 * wheel's pixel geometry). The seam is used ONLY to PLACE the ship docked+funded
 * (scene staging), then EVERY wheel-open and navigation is a genuine E press /
 * pointer click that the sim's own pointerdown handler hit-tests.
 *
 * Geometry (1280x800 desktop, logical==physical): center (640,400), r=230,
 * press radius 138. Main upgrade wheel [WEAPON,ENGINE,CARGO,HULL]; WEAPON
 * sub-wheel [DAMAGE,SPEED,BACK]; build wheel [TURRET,SHIELD,REPAIR,UPGRADE SHIP].
 *
 *   weapon-wheel-real   — E -> UPGRADE SHIP -> WEAPON -> buy DAMAGE -> BACK,
 *                         landing on the upgrade main wheel (NOT bouncing to build).
 *   upgrades-apply-real — buy one tier of EVERY track by clicking; wedges()
 *                         current->next readback captions each sim stat change.
 *
 * Usage: node evidence/capture-wheel-real.mjs   (preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4188';
const VP = { width: 1280, height: 800 };
const DSF = 2;
const CX = 640, CY = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wheel click points (logical px) from the geometry report.
const P = {
  upgradeShip: { x: 502, y: 400 }, // build wheel, 180deg
  weapon: { x: 640, y: 262 },       // main upgrade wheel, -90deg
  engine: { x: 778, y: 400 },       // main upgrade wheel, 0deg
  cargo: { x: 640, y: 538 },        // main upgrade wheel, 90deg
  hull: { x: 502, y: 400 },         // main upgrade wheel, 180deg
  damage: { x: 640, y: 262 },       // sub-wheel, -90deg
  speed: { x: 760, y: 469 },        // sub-wheel, 30deg
  back: { x: 520, y: 469 },         // sub-wheel, 150deg
};
const WHEEL_CLIP = { x: 300, y: 150, width: 680, height: 520 };

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  page._ctx = ctx;
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__upgradeWheelStage?.openUpgrade === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page;
}

const ticks = (page) => page.evaluate(() => window.__planetRush.ticks);
const waitTick = (page, t) => page.waitForFunction((x) => window.__planetRush.ticks >= x, t, { timeout: 15_000 }).catch(() => {});
const wedges = (page) => page.evaluate(() => window.__upgradeWheelStage.wedges());
const bank = (page) => page.evaluate(() => window.__pressStage?.bank?.() ?? null);
const labels = (ws) => (ws || []).map((w) => w.label);
const byLabel = (ws, l) => (ws || []).find((w) => w.label === l) || null;

// Real click, then let the pendingUpgrade drain a couple of ticks.
async function realClick(page, pt, settle = 3) {
  const t = await ticks(page);
  await page.mouse.click(pt.x, pt.y);
  await waitTick(page, t + settle);
  await sleep(120);
}

// Park the ship docked + funded via the seam (scene staging only), then CLOSE
// the wheel so the following opens are real input on a genuinely-docked ship.
async function parkDockedFunded(page, ore) {
  await page.evaluate((o) => { window.__upgradeWheelStage.openUpgrade(o); }, ore);
  await sleep(150);
  await page.evaluate(() => window.__upgradeWheelStage.close());
  await sleep(150);
}

async function weaponWheelReal(browser, log) {
  const page = await boot(browser);
  await parkDockedFunded(page, 60);

  // 1) REAL 'E' -> build wheel opens.
  let t = await ticks(page);
  await page.keyboard.press('KeyE');
  await waitTick(page, t + 2);
  await sleep(200);
  await page.screenshot({ path: join(OUT, 'wwr-1-build-wheel.png'), clip: WHEEL_CLIP });

  // 2) REAL click UPGRADE SHIP -> upgrade main wheel.
  await realClick(page, P.upgradeShip);
  const mainWedges = await wedges(page);
  await page.screenshot({ path: join(OUT, 'wwr-2-upgrade-main.png'), clip: WHEEL_CLIP });

  // 3) REAL click WEAPON -> sub-wheel (DAMAGE + SPEED + BACK).
  await realClick(page, P.weapon);
  const subWedges = await wedges(page);
  await page.screenshot({ path: join(OUT, 'wwr-3-weapon-sub.png'), clip: WHEEL_CLIP });

  // 4) buy DAMAGE by REAL click.
  const dmgBefore = byLabel(subWedges, 'DAMAGE');
  const bankBefore = await bank(page);
  await realClick(page, P.damage);
  const afterBuy = await wedges(page);
  const dmgAfter = byLabel(afterBuy, 'DAMAGE');
  const bankAfterBuy = await bank(page);
  await page.screenshot({ path: join(OUT, 'wwr-4-after-buy.png'), clip: WHEEL_CLIP });

  // 5) REAL click BACK -> should land on the upgrade MAIN wheel, not build wheel.
  await realClick(page, P.back);
  const afterBack = await wedges(page);
  await page.screenshot({ path: join(OUT, 'wwr-5-after-back.png'), clip: WHEEL_CLIP });
  await page.screenshot({ path: join(OUT, 'wwr-5-after-back-full.png') });

  log.weaponWheel = {
    buildThenUpgradeShip_mainLabels: labels(mainWedges),
    weaponClick_subLabels: labels(subWedges),
    damage: { before: dmgBefore && { tier: dmgBefore.tier, current: dmgBefore.current, next: dmgBefore.next, cost: dmgBefore.cost }, after: dmgAfter && { tier: dmgAfter.tier, current: dmgAfter.current } },
    bank: { before: bankBefore, afterBuy: bankAfterBuy },
    afterBack_labels: labels(afterBack),
    afterBack_isUpgradeMainWheel: JSON.stringify(labels(afterBack)) === JSON.stringify(['WEAPON', 'ENGINE', 'CARGO', 'HULL']),
    errors: page._errors.slice(0, 4),
  };
  await page._ctx.close();
}

async function upgradesApplyReal(browser, log) {
  const page = await boot(browser);
  await parkDockedFunded(page, 999);

  // Open via REAL input: E -> UPGRADE SHIP.
  let t = await ticks(page);
  await page.keyboard.press('KeyE');
  await waitTick(page, t + 2);
  await sleep(150);
  await realClick(page, P.upgradeShip);

  // Pristine tier-0 baseline (all pips empty) before any purchase.
  const baseline = await wedges(page);
  await page.screenshot({ path: join(OUT, 'uar-0-baseline.png'), clip: WHEEL_CLIP });

  const applied = [];
  const capMain = async (tag) => { await page.screenshot({ path: join(OUT, `uar-${tag}.png`), clip: WHEEL_CLIP }); };

  // Helper: buy a main-wheel track by real click, record current->next delta.
  async function buyMain(label, pt, tag) {
    const before = byLabel(await wedges(page), label);
    await realClick(page, pt);
    const after = byLabel(await wedges(page), label);
    applied.push({ track: label, current_before: before?.current, next_before: before?.next, tier_before: before?.tier, current_after: after?.current, tier_after: after?.tier, cost: before?.cost });
    await capMain(tag);
  }

  await buyMain('ENGINE', P.engine, 'engine');
  await buyMain('CARGO', P.cargo, 'cargo');
  await buyMain('HULL', P.hull, 'hull');

  // Into the WEAPON sub-wheel for DAMAGE + SPEED.
  await realClick(page, P.weapon);
  await page.screenshot({ path: join(OUT, 'uar-weapon-sub-before.png'), clip: WHEEL_CLIP });
  async function buySub(label, pt, tag) {
    const before = byLabel(await wedges(page), label);
    await realClick(page, pt);
    const after = byLabel(await wedges(page), label);
    applied.push({ track: label, current_before: before?.current, next_before: before?.next, tier_before: before?.tier, current_after: after?.current, tier_after: after?.tier, cost: before?.cost });
    await page.screenshot({ path: join(OUT, `uar-${tag}.png`), clip: WHEEL_CLIP });
  }
  await buySub('DAMAGE', P.damage, 'damage');
  await buySub('SPEED', P.speed, 'speed');

  // Back out to the main wheel for a final all-tracks-raised frame.
  await realClick(page, P.back);
  const finalMain = await wedges(page);
  await page.screenshot({ path: join(OUT, 'uar-final-main.png'), clip: WHEEL_CLIP });

  log.upgradesApply = { applied, baseline: baseline.map((w) => ({ label: w.label, tier: w.tier, current: w.current })), finalMain: finalMain.map((w) => ({ label: w.label, tier: w.tier, current: w.current })), bank: await bank(page), errors: page._errors.slice(0, 4) };
  await page._ctx.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const log = {};
  await weaponWheelReal(browser, log);
  await upgradesApplyReal(browser, log);
  await browser.close();
  writeFileSync(join(HERE, 'wheel-real-readback.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
