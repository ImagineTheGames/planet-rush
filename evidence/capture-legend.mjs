/**
 * evidence/capture-legend.mjs — contextual-build-legend evidence. OWNER: QA Manager.
 *
 * The BUILD affordance is proximity-gated (dockRange 160u to your own planet):
 *   DESKTOP controls strip (bottom edge):
 *     near (docked) -> live row  { label:'Build & Upgrade', binding:'E', dimmed:false }
 *     far (away)    -> dimmed row { label:'Build & Upgrade — get closer to your planet', dimmed:true, binding:null }
 *   MOBILE (touch): no strip; a BUILD button appears ONLY when docked (parity).
 *
 * Placement is scene staging (park docked via seam / let a fresh boot coast out).
 * The state is read back from __upgradeWheelStage.legend() and __planetRush.layout.
 *
 * Usage: node evidence/capture-legend.mjs   (preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4188';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(browser, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  page._ctx = ctx;
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__upgradeWheelStage?.legend === 'function' && !!window.__planetRush, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page;
}

const legend = (page) => page.evaluate(() => window.__upgradeWheelStage.legend());
const buildRow = (leg) => (leg || []).find((r) => r.action === 'build') || null;
const layoutHas = (page, id) => page.evaluate((x) => (window.__planetRush.layout || []).some((e) => e.id === x), id);
const layoutRect = (page, id) => page.evaluate((x) => { const e = (window.__planetRush.layout || []).find((y) => y.id === x); return e ? { id: e.id, x: e.x, y: e.y, w: e.w, h: e.h } : null; }, id);

// Park docked + close any wheel, so the frame is plain gameplay at the planet.
async function parkDockedClosed(page) {
  await page.evaluate(() => { window.__upgradeWheelStage.openUpgrade(20); });
  await sleep(150);
  await page.evaluate(() => window.__upgradeWheelStage.close());
  await sleep(250);
}

// Fly the ship well out of dock range with a real move-order (tap-to-move), then
// wait until the sim reports the BUILD affordance has gone away (dimmed / gone).
async function flyAway(page) {
  const start = await page.evaluate(() => {
    const tap = window.__tapCommanderStage;
    const s = window.__planetRush.shipWorld;
    if (!tap || !s) return null;
    tap.setScheme('tap');
    tap.tapWorld(s.x + 900, s.y + 640); // 900u from spawn; spawn sits <160u from planet
    return { x: s.x, y: s.y };
  });
  // Wait until the ship has actually travelled >350u from spawn — spawn is <96u
  // from the planet, so >350u from spawn is >250u from the planet, well outside
  // the 160u dock bubble (works on desktop AND touch, where legend() is empty).
  await page.waitForFunction((s0) => {
    const s = window.__planetRush.shipWorld;
    return s && Math.hypot(s.x - s0.x, s.y - s0.y) > 350;
  }, start, { timeout: 25_000 }).catch(() => {});
  await sleep(400);
  const travelled = await page.evaluate((s0) => {
    const s = window.__planetRush.shipWorld;
    return s ? Math.round(Math.hypot(s.x - s0.x, s.y - s0.y)) : null;
  }, start);
  return { start, travelled };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const log = {};
  const STRIP = { x: 0, y: 754, width: 1280, height: 46 }; // desktop controls strip band

  // --- DESKTOP near (docked) ------------------------------------------------
  {
    const page = await boot(browser, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await parkDockedClosed(page);
    const leg = await legend(page);
    await page.screenshot({ path: join(OUT, 'legend-pc-near-full.png') });
    await page.screenshot({ path: join(OUT, 'legend-pc-near-strip.png'), clip: STRIP });
    log.pcNear = { buildRow: buildRow(leg), errors: page._errors.slice(0, 3) };
    await page._ctx.close();
  }

  // --- DESKTOP far (drifted out of dock range) ------------------------------
  {
    const page = await boot(browser, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const flightPc = await flyAway(page);
    const leg = await legend(page);
    await page.screenshot({ path: join(OUT, 'legend-pc-far-full.png') });
    await page.screenshot({ path: join(OUT, 'legend-pc-far-strip.png'), clip: STRIP });
    log.pcFar = { buildRow: buildRow(leg), flight: flightPc, errors: page._errors.slice(0, 3) };
    await page._ctx.close();
  }

  // --- MOBILE near (docked): BUILD button present ---------------------------
  const phone = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  {
    const page = await boot(browser, phone);
    await parkDockedClosed(page);
    const present = await layoutHas(page, 'build-button');
    const rect = await layoutRect(page, 'build-button');
    await page.screenshot({ path: join(OUT, 'legend-mobile-near-full.png') });
    log.mobileNear = { buildButtonPresent: present, rect, errors: page._errors.slice(0, 3) };
    await page._ctx.close();
  }

  // --- MOBILE far (drifted): BUILD button absent ----------------------------
  {
    const page = await boot(browser, phone);
    const flightM = await flyAway(page);
    const present = await layoutHas(page, "build-button");
    await page.screenshot({ path: join(OUT, "legend-mobile-far-full.png") });
    log.mobileFar = { buildButtonPresent: present, flight: flightM, errors: page._errors.slice(0, 3) };
    await page._ctx.close();
  }

  await browser.close();
  writeFileSync(join(HERE, 'legend-readback.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
