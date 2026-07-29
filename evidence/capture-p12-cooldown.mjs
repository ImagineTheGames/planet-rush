/**
 * evidence/capture-p12-cooldown.mjs — "the repair cooldown, honest on the wedge" (p12).
 * OWNER: QA Manager. Drives the SHIPPED ?debug=1 `window.__repairStage` seam with
 * REAL pointer clicks on the drawn REPAIR CORE wedge (the p1a rule — a genuine
 * pointerdown into the same main.ts handler a thumb hits), reads the LIVE sim +
 * DRAWN wedge back, and LOOKS at each frame.
 *
 * PR #203 (sim p12) gave station repair a 15s per-station cooldown: a repair press
 * arms `MiningStation.repairGate = REPAIR_COOLDOWN_SECONDS`, and while it is > 0 the
 * sim refuses the next repair order `'cooling-down'`, SPENDING NOTHING. This file
 * witnesses that lockout on ONE continuous cooldown timeline, three frames:
 *
 *   A · LAND     — a sieged, funded core: one real tap lands a repair. Core +15 HP,
 *      bank −1 ore. The cooldown arms this same tick.
 *   B · GATED    — inside the 15s window, FOUR rapid real taps spend ZERO ore and
 *      lift ZERO HP: core & bank frozen. The lockout is real.  *** FINDING ***: the
 *      shipped wedge STILL draws "+15 HP" ready=true — no "REPAIR in Ns" countdown,
 *      no dimming. The gate is enforced by the sim but INVISIBLE in the UI.
 *   C · RE-ARM   — once ≥15s of SIM time (polled off __planetRush.ticks · TICK_DT)
 *      have elapsed, a real tap lands a SECOND repair: core +15, bank −1 again.
 *
 * Runs WITHOUT ?freeze — the sim must step for orders to resolve and repairGate to
 * decrement. Every caption number is copied from the run's own readback JSON, and
 * the elapsed-seconds captions are derived from fixed sim ticks (TICK_DT = 1/60),
 * not wall-clock.
 *
 * Usage: node evidence/capture-p12-cooldown.mjs   (needs a server on $EVIDENCE_BASE_URL)
 *   env EVIDENCE_BASE_URL (default http://localhost:4173)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const REPAIR_HP = 15; // REPAIR_HP_PER_ORE
const REPAIR_ORE = 1; // REPAIR_ORE_COST
const COOLDOWN_S = 15; // REPAIR_COOLDOWN_SECONDS
const TICK_DT = 1 / 60; // src/sim/constants.ts
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
  await page.waitForFunction(() => typeof window.__planetRush?.ticks === 'number', undefined, { timeout: 20_000 });
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
const ticks = (page) => page.evaluate(() => window.__planetRush.ticks);
const build = (page) => page.evaluate(() => window.__planetRush.build);
const frames = (page, n = 3) => page.evaluate((k) => new Promise((r) => { let i = 0; const s = () => { i++; i >= k ? r() : requestAnimationFrame(s); }; requestAnimationFrame(s); }), n);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const readback = {};

  const page = await boot(browser);
  readback.build = await build(page);

  // Siege the core to 10/100 with a 10-ore bank so two 15-HP repairs (landing +
  // re-arm) both stay well under the clamp. The one-shot siege raises the
  // UNDER-ATTACK coach toast (ALARM_HOLD_S = 5s) over the bottom REPAIR wedge; let
  // it lapse so the wedge's own copy is unobscured.
  const staged = await page.evaluate(() => window.__repairStage.siege(90, 10));
  await page.waitForFunction(() => window.__repairStage.wedge(), undefined, { timeout: 20_000 });
  await sleep(6000);
  await frames(page, 4);
  const read0 = await readout(page);
  readback.staged = staged;
  readback.read0 = read0;

  // ── A · LAND ──────────────────────────────────────────────────────────────
  // One real tap lands a repair and arms the 15s gate this same tick.
  await realTapRepair(page);
  await waitForCore(page, read0.coreHp + REPAIR_HP);
  await frames(page, 4);
  const landTick = await ticks(page);
  const readA = await readout(page);
  const wedgeA = await wedge(page);
  await page.screenshot({ path: join(OUT, 'p12-cooldown-A-land.png') });
  readback.A = {
    tick: landTick, read: readA, wedge: wedgeA,
    coreDelta: readA.coreHp - read0.coreHp, bankDelta: readA.banked - read0.banked,
  };

  // ── B · GATED ─────────────────────────────────────────────────────────────
  // Inside the 15s window, four RAPID real taps. Each must be refused
  // 'cooling-down', spending nothing — core & bank stay put.
  const gateTaps = 4;
  for (let i = 0; i < gateTaps; i++) { await realTapRepair(page); await sleep(80); }
  await frames(page, 4);
  const gateTick = await ticks(page);
  const readB = await readout(page);
  const wedgeB = await wedge(page);
  await page.screenshot({ path: join(OUT, 'p12-cooldown-B-gated.png') });
  readback.B = {
    tick: gateTick, taps: gateTaps, read: readB, wedge: wedgeB,
    elapsedSimS: +(((gateTick - landTick) * TICK_DT).toFixed(2)),
    coreFrozen: readB.coreHp === readA.coreHp,
    bankFrozen: readB.banked === readA.banked,
    // The finding, machine-checked: the wedge still advertised a ready +HP deal
    // while the sim was silently refusing every tap.
    wedgeStillReadyDuringLockout: wedgeB.ready === true && /\+\d+\s*HP/.test(wedgeB.sub),
  };

  // ── C · RE-ARM ────────────────────────────────────────────────────────────
  // Poll ticks until ≥15s of SIM time have elapsed since the landing tick, then
  // tap: repairGate has drained to 0, so the order lands a second repair.
  await page.waitForFunction(
    ([lt, need]) => (window.__planetRush.ticks - lt) * (1 / 60) >= need,
    [landTick, COOLDOWN_S + 0.5],
    { timeout: 40_000 },
  );
  const preRearmTick = await ticks(page);
  await realTapRepair(page);
  await waitForCore(page, readB.coreHp + REPAIR_HP);
  await frames(page, 4);
  const rearmTick = await ticks(page);
  const readC = await readout(page);
  const wedgeC = await wedge(page);
  await page.screenshot({ path: join(OUT, 'p12-cooldown-C-rearm.png') });
  readback.C = {
    tick: rearmTick, read: readC, wedge: wedgeC,
    elapsedSimS: +(((preRearmTick - landTick) * TICK_DT).toFixed(2)),
    coreDelta: readC.coreHp - readB.coreHp, bankDelta: readC.banked - readB.banked,
  };

  readback.errors = page._errors;
  await page.context().close();
  writeFileSync(join(OUT, 'p12-cooldown-readback.json'), JSON.stringify(readback, null, 2));
  console.log(JSON.stringify(readback, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
