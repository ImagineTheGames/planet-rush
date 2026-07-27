/**
 * evidence/capture-p5-repair.mjs — "repair is a DISCRETE, honest purchase" (p5).
 * OWNER: QA Manager. Drives the SHIPPED ?debug=1 `window.__repairStage` seam with
 * REAL pointer clicks on the drawn REPAIR CORE wedge (the p1a rule — a real
 * pointerdown into the same main.ts handler a thumb hits, NOT a debug order
 * method), then reads the LIVE sim + the DRAWN wedge back and LOOKS at each frame.
 *
 * The channel is gone (PR #148): a press spends REPAIR_ORE_COST (1) ore and lifts
 * the core REPAIR_HP_PER_ORE (15) HP, clamped — no per-tick drain, no stacking
 * beyond discrete purchases. This file witnesses that honestly:
 *
 *   A · WEDGE       — a sieged, funded core: the REPAIR wedge draws "+15 HP" with
 *      the bare "1" as its only cost numeral, bright/pressable. (the deal, pre-tap)
 *   B · 3 TAPS      — three real clicks step the bank DOWN 1 ore each while the
 *      core steps UP 15 HP each (bank 10→7, core +45): discrete, in lockstep.
 *   C · AUTO-STOP   — core topped to full: the wedge dims to "CORE FULL" and five
 *      RAPID real clicks spend ZERO ore (bank frozen), core pinned at max.
 *   D · 5 DISCRETE  — five real clicks on a damaged core = exactly +75 HP / −5 ore,
 *      no channel over-spend: N presses are N purchases.
 *
 * Runs WITHOUT ?freeze — the sim must step for each order to resolve.
 *
 * Usage: node evidence/capture-p5-repair.mjs   (needs a server on $EVIDENCE_BASE_URL)
 *   env EVIDENCE_BASE_URL (default http://localhost:4173)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const REPAIR_HP = 15;
const REPAIR_ORE = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__repairStage?.siege === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page;
}

/** One REAL pointerdown at the drawn REPAIR wedge centre — the exact event a thumb
 *  fires, into the same main.ts pointer handler. */
async function realTapRepair(page) {
  const point = await page.evaluate(() => window.__repairStage.repairWedgePoint());
  if (!point) throw new Error('no REPAIR wedge to tap');
  await page.evaluate((p) => {
    const canvas = document.querySelector('canvas');
    const ev = new PointerEvent('pointerdown', { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev);
  }, point);
}

async function waitForCore(page, target) {
  const h = await page.waitForFunction((t) => {
    const r = window.__repairStage.readout();
    return r && r.coreHp >= t - 0.5 ? r.coreHp : null;
  }, target, { timeout: 20_000 });
  return h.jsonValue();
}

const wedge = (page) => page.evaluate(() => window.__repairStage.wedge());
const readout = (page) => page.evaluate(() => window.__repairStage.readout());
const frames = (page, n = 3) => page.evaluate((k) => new Promise((r) => { let i = 0; const s = () => { i++; i >= k ? r() : requestAnimationFrame(s); }; requestAnimationFrame(s); }), n);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const readback = {};
  const allErrors = [];

  // Each scene boots FRESH (the core starts at full = maxCoreHp) so no scene's
  // siege lands on a previous scene's already-sieged core — driving a core to 0
  // would destroy the home planet and confound the readback.

  // ── A · WEDGE + B · 3 TAPS ────────────────────────────────────────────────
  {
    const page = await boot(browser);
    // Siege 80 HP down so three 15-HP taps never hit the clamp; bank 10 ore.
    const staged = await page.evaluate(() => window.__repairStage.siege(80, 10));
    await page.waitForFunction(() => window.__repairStage.wedge(), undefined, { timeout: 20_000 });
    // The one-shot siege raises the UNDER-ATTACK coach toast (ALARM_HOLD_S = 5s),
    // which sits over the bottom REPAIR wedge. Let it lapse so the wedge's own
    // "+15 HP" deal is unobscured; the prompt fires once and never returns.
    await sleep(6000);
    await frames(page, 4);
    const wedgeA = await wedge(page);
    const readA = await readout(page);
    await page.screenshot({ path: join(OUT, 'p5-repair-A-wedge.png') });

    // Three real clicks — wait for the core to step up between each (each order
    // drains in its own frame), so three clicks are three independent purchases.
    for (let i = 1; i <= 3; i++) {
      await realTapRepair(page);
      await waitForCore(page, readA.coreHp + i * REPAIR_HP);
    }
    await frames(page, 4);
    const readB = await readout(page);
    await page.screenshot({ path: join(OUT, 'p5-repair-B-3taps.png') });
    readback.A = { staged, wedge: wedgeA, read: readA };
    readback.B = { read: readB, coreDelta: readB.coreHp - readA.coreHp, bankDelta: readB.banked - readA.banked };
    allErrors.push(...page._errors);
    await page.context().close();
  }

  // ── D · 5 DISCRETE TAPS ───────────────────────────────────────────────────
  {
    const page = await boot(browser);
    const stagedD = await page.evaluate(() => window.__repairStage.siege(90, 10)); // core 10, bank 10
    await page.waitForFunction(() => window.__repairStage.wedge(), undefined, { timeout: 20_000 });
    await sleep(6000); // let the UNDER-ATTACK toast lapse (ALARM_HOLD_S = 5s)
    await frames(page, 4);
    const readD0 = await readout(page);
    for (let i = 1; i <= 5; i++) {
      await realTapRepair(page);
      await waitForCore(page, readD0.coreHp + i * REPAIR_HP);
    }
    await frames(page, 4);
    const readD = await readout(page);
    await page.screenshot({ path: join(OUT, 'p5-repair-D-5taps.png') });
    readback.D = { staged: stagedD, before: readD0, after: readD, coreDelta: readD.coreHp - readD0.coreHp, bankDelta: readD.banked - readD0.banked };
    allErrors.push(...page._errors);
    await page.context().close();
  }

  // ── C · AUTO-STOP AT FULL ─────────────────────────────────────────────────
  {
    const page = await boot(browser);
    await page.evaluate(() => window.__repairStage.siege(30, 9));
    await page.waitForFunction(() => window.__repairStage.wedge(), undefined, { timeout: 20_000 });
    await sleep(6000); // let the UNDER-ATTACK toast lapse before topping the core
    await page.evaluate(() => window.__repairStage.setCore(window.__repairStage.readout().maxCoreHp));
    await page.waitForFunction(() => { const w = window.__repairStage.wedge(); return w && !w.ready ? w : null; }, undefined, { timeout: 20_000 });
    await frames(page, 4);
    const wedgeC = await wedge(page);
    const readC0 = await readout(page);
    // Five RAPID real clicks with no wait — every one must be refused at full.
    for (let i = 0; i < 5; i++) { await realTapRepair(page); await sleep(30); }
    await frames(page, 6);
    const readC = await readout(page);
    await page.screenshot({ path: join(OUT, 'p5-repair-C-full.png') });
    readback.C = { wedge: wedgeC, before: readC0, after: readC, bankFrozen: readC.banked === readC0.banked, coreFrozen: readC.coreHp === readC0.coreHp };
    allErrors.push(...page._errors);
    await page.context().close();
  }

  writeFileSync(join(OUT, 'p5-repair-readback.json'), JSON.stringify(readback, null, 2));
  console.log(JSON.stringify(readback, null, 2));
  console.log('ERRORS', allErrors);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
