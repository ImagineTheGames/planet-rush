/**
 * evidence/capture-p12-cooldown-ui.mjs — "the wedge now tells the truth about the
 * cooldown" (p12 RE-VERIFY). OWNER: QA Manager.
 *
 * Round-9 (repair-cooldown-countdown-ui) FAILED: on build 35c2595 the 15s repair
 * lockout was enforced sim-side but INVISIBLE in the wheel — the wedge kept drawing
 * "+15 HP" ready=true while every tap was silently refused 'cooling-down'. PR #212
 * (p12 cooldown-wedge) wired station.repairGate through to the wedge. This file
 * re-verifies on the FIXED build, on BOTH form factors, with REAL taps:
 *
 *   A · LAND    — a sieged, funded core: one real tap lands a repair (+15 HP, −1 ore)
 *      and arms the 15s gate this same tick.
 *   B · GATED   — mid-cooldown: the wedge is now GRAYED (ready=false) and draws a
 *      live "REPAIR in Ns" countdown read straight off sim state. Four rapid real
 *      taps into that grayed wedge move ZERO ore and ZERO HP — the refused-tap /
 *      no-ore-moved proof (core & bank frozen across the taps).
 *   C · RE-ARM  — once the gate drains to 0 the wedge re-arms to "+15 HP" ready=true,
 *      and a real tap lands a SECOND repair (+15 HP, −1 ore).
 *
 * Taps are dispatched at repairWedgeClientPoint() — the wedge centre in CLIENT space,
 * which un-rotates through logicalToPhysical (identity on desktop, real rotation on a
 * portrait phone under the landscape lock) and offsets by the canvas rect. The SAME
 * cycle drives on desktop (pointerType mouse) and iPhone (pointerType touch).
 *
 * Runs WITHOUT ?freeze — the sim must step for orders to resolve and repairGate to
 * decrement. Every caption number is copied from the run's own readback JSON.
 *
 * Usage: node evidence/capture-p12-cooldown-ui.mjs   (needs a server on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const REPAIR_HP = 15; // REPAIR_HP_PER_ORE
const COOLDOWN_S = 15; // REPAIR_COOLDOWN_SECONDS
const TICK_DT = 1 / 60; // src/sim/constants.ts
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two real form factors. Desktop = mouse; iPhone 390×844 dpr3 = touch, isMobile so
// the client goes through the same portrait/landscape remap a thumb crosses.
const FORMS = [
  { key: 'pc', label: 'Desktop 1280×800', pointerType: 'mouse',
    ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } },
  { key: 'phone', label: 'iPhone 390×844 dpr3', pointerType: 'touch',
    ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
];

async function boot(browser, form) {
  const ctx = await browser.newContext(form.ctx);
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

/** One REAL pointerdown at the drawn REPAIR wedge centre in CLIENT space — the exact
 *  event a thumb (or mouse) fires, into the same main.ts pointer handler. */
async function realTapRepair(page, pointerType) {
  const point = await page.evaluate(() => window.__repairStage.repairWedgeClientPoint());
  if (!point) throw new Error('no REPAIR wedge to tap');
  await page.evaluate(({ p, pt }) => {
    const canvas = document.querySelector('canvas');
    const ev = new PointerEvent('pointerdown', { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: pt, isPrimary: true, bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev);
  }, { p: point, pt: pointerType });
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
const frames = (page, n = 4) => page.evaluate((k) => new Promise((r) => { let i = 0; const s = () => { i++; i >= k ? r() : requestAnimationFrame(s); }; requestAnimationFrame(s); }), n);

async function captureForm(browser, form, readback) {
  const page = await boot(browser, form);
  readback.build = await build(page);
  const rec = {};

  // Siege the core to 10/100 with a 10-ore bank so LAND + RE-ARM both stay under the
  // clamp. Let the 5s UNDER-ATTACK toast lapse so the wedge copy is unobscured.
  const staged = await page.evaluate(() => window.__repairStage.siege(90, 10));
  await page.waitForFunction(() => window.__repairStage.wedge(), undefined, { timeout: 20_000 });
  await sleep(6000);
  await frames(page);
  const read0 = await readout(page);
  rec.staged = staged;
  rec.read0 = read0;

  // ── A · LAND ──────────────────────────────────────────────────────────────
  await realTapRepair(page, form.pointerType);
  await waitForCore(page, read0.coreHp + REPAIR_HP);
  await frames(page);
  const landTick = await ticks(page);
  const readA = await readout(page);
  const wedgeA = await wedge(page);
  await page.screenshot({ path: join(OUT, `p12-cd-ui-${form.key}-A-land.png`) });
  rec.A = { tick: landTick, read: readA, wedge: wedgeA,
    coreDelta: +(readA.coreHp - read0.coreHp).toFixed(2), bankDelta: +(readA.banked - read0.banked).toFixed(2) };

  // ── B · GATED — grayed wedge + live countdown + refused-tap/no-ore-moved ─────
  // Settle ~1.5s into the window, snapshot the grayed wedge, then fire 4 rapid real
  // taps and re-read: core & bank must be frozen (every tap refused 'cooling-down').
  await sleep(1500);
  await frames(page);
  const gateTickPre = await ticks(page);
  const readBpre = await readout(page);
  const wedgeB = await wedge(page);
  const gateTaps = 4;
  for (let i = 0; i < gateTaps; i++) { await realTapRepair(page, form.pointerType); await sleep(80); }
  await frames(page);
  const readBpost = await readout(page);
  await page.screenshot({ path: join(OUT, `p12-cd-ui-${form.key}-B-gated.png`) });
  rec.B = {
    tick: gateTickPre, taps: gateTaps, read: readBpost, wedge: wedgeB,
    elapsedSimS: +(((gateTickPre - landTick) * TICK_DT).toFixed(2)),
    repairGate: +readBpre.repairGate.toFixed(2),
    coreFrozen: readBpost.coreHp === readBpre.coreHp,
    bankFrozen: readBpost.banked === readBpre.banked,
    // The fix, machine-checked: the wedge is now GRAYED (ready=false) and draws the
    // live "REPAIR in Ns" countdown while the sim refuses every tap.
    wedgeGrayedDuringLockout: wedgeB.ready === false,
    wedgeShowsCountdown: /REPAIR in \d+s/.test(wedgeB.sub),
  };

  // ── C · RE-ARM — wedge back to "+15 HP" ready at expiry, second repair lands ──
  await page.waitForFunction(
    ([lt, need]) => (window.__planetRush.ticks - lt) * (1 / 60) >= need,
    [landTick, COOLDOWN_S + 0.3],
    { timeout: 40_000 },
  );
  await page.waitForFunction(() => window.__repairStage.wedge()?.ready === true, undefined, { timeout: 10_000 });
  await frames(page);
  const rearmReadyTick = await ticks(page);
  const wedgeCready = await wedge(page);
  const readCpre = await readout(page);
  await page.screenshot({ path: join(OUT, `p12-cd-ui-${form.key}-C-rearm.png`) });
  // then prove a tap actually lands a second repair from the re-armed state
  await realTapRepair(page, form.pointerType);
  await waitForCore(page, readCpre.coreHp + REPAIR_HP);
  await frames(page);
  const readCpost = await readout(page);
  rec.C = {
    readyTick: rearmReadyTick, wedge: wedgeCready,
    elapsedSimS: +(((rearmReadyTick - landTick) * TICK_DT).toFixed(2)),
    readAtRearm: readCpre, readAfterTap: readCpost,
    coreDelta: +(readCpost.coreHp - readCpre.coreHp).toFixed(2),
    bankDelta: +(readCpost.banked - readCpre.banked).toFixed(2),
  };

  rec.errors = page._errors;
  await page.context().close();
  readback[form.key] = rec;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const readback = {};
  for (const form of FORMS) {
    readback[form.key + '_label'] = form.label;
    await captureForm(browser, form, readback);
  }
  writeFileSync(join(OUT, 'p12-cd-ui-readback.json'), JSON.stringify(readback, null, 2));
  console.log(JSON.stringify(readback, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
