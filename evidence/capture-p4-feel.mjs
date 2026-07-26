/**
 * evidence/capture-p4-feel.mjs — P4 "the game answers your finger". OWNER: QA Manager.
 *
 * Four frames off the REAL preview bundle, all through the ?debug=1 press-stage
 * seam (`window.__pressStage`) that the UI team's own live-stage spec drives —
 * the SAME seam, read by the QA evidence officer's eyes instead of an assertion:
 *
 *   1. press-feedback-pressed   — an AFFORDABLE TURRET wedge caught in its pressed
 *      state (openBuild(999) → press): scale-down + plasma glow, no reject flash.
 *   2. press-feedback-rejected  — a DISABLED TURRET wedge caught mid-rejection
 *      (openBuild(0), so it is unaffordable → press): threat-red flash, no glow.
 *      Both under ?freeze=1, where frame.time is pinned so the pressed value holds
 *      at its peak for a clean still (press-feedback.ts is a pure fn of elapsed).
 *   3. repair-confirmation      — the flagship. LIVE (no ?freeze, so world.time
 *      advances and the cost genuinely TRAVELS): openBuild(50) → confirm the
 *      REPAIR wedge (index 2, cost REPAIR_ENTRY_ORE = 1) through the wheel's own
 *      confirm seam → a signal-yellow "1" caught mid-arc off the REPAIR wedge
 *      toward the top-left bank readout, with the patina repair-shimmer washing
 *      the core HP bar (the "core pip ticks up" tell, hud.ts).
 *   4. settings-vibration-absent — a clean boot (no ?debug) → the SETTINGS screen,
 *      with a recording navigator.vibrate armed BEFORE boot (so haptics.isSupported()
 *      is TRUE and any motor-gated toggle WOULD draw). Documents which rows the
 *      settings screen actually has — and that a VIBRATION toggle is not among them.
 *
 * Every frame prints the seam readback it was shot at, so the attestation cites
 * numbers the run actually saw, not the code's claims.
 *
 * Usage: node evidence/capture-p4-feel.mjs   (needs the preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const VP = { width: 1280, height: 800 };
const DSF = 2; // crisp text at pixel scale, like the hud-detail crops

const TURRET_WEDGE = 0;
const REPAIR_WEDGE = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, { arm } = {}) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  if (arm) await arm(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  return page;
}

/** Boot the real bundle and wait for the press-stage seam. */
async function bootPress(page, query) {
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__pressStage?.openBuild === 'function', undefined, {
    timeout: 20_000,
  });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page.evaluate(() => window.__planetRush?.build ?? null);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // --- 1. press-feedback-pressed (freeze; affordable TURRET pressed) ---------
  {
    const page = await newPage(browser);
    const build = await bootPress(page, '/?debug=1&freeze=1');
    await page.evaluate(() => window.__pressStage.openBuild(999));
    // Press and read back the pressed motion (freeze pins time → held at peak).
    const fb = await page.waitForFunction((i) => {
      window.__pressStage.press('build', i);
      const f = window.__pressStage.feedback('build', i);
      return f && f.glow > 0 && f.scale < 1 ? f : null;
    }, TURRET_WEDGE, { timeout: 20_000 }).then((h) => h.jsonValue());
    const bank = await page.evaluate(() => window.__pressStage.bank());
    await page.screenshot({ path: join(OUT, 'press-feedback-pressed.png') });
    console.log('[1 pressed]', { build, bank, feedback: fb, errors: page._errors });
    await page.context().close();
  }

  // --- 2. press-feedback-rejected (freeze; disabled TURRET rejecting) --------
  {
    const page = await newPage(browser);
    const build = await bootPress(page, '/?debug=1&freeze=1');
    const opened = await page.evaluate(() => window.__pressStage.openBuild(0));
    const fb = await page.waitForFunction((i) => {
      window.__pressStage.press('build', i);
      const f = window.__pressStage.feedback('build', i);
      return f && f.reject > 0 ? f : null;
    }, TURRET_WEDGE, { timeout: 20_000 }).then((h) => h.jsonValue());
    const bank = await page.evaluate(() => window.__pressStage.bank());
    await page.screenshot({ path: join(OUT, 'press-feedback-rejected.png') });
    console.log('[2 rejected]', { build, opened, bank, feedback: fb, errors: page._errors });
    await page.context().close();
  }

  // --- 3. repair-confirmation (LIVE; cost floats wedge→bank, core shimmers) ---
  //     The float lives CONFIRM_SECONDS = 0.55 s and a Playwright screenshot has
  //     ~0.3 s of latency (≈ 0.4 of progress). So confirming and screenshotting
  //     IMMEDIATELY lands the capture mid-arc, with the "1" out over open space on
  //     the wedge→top-left-bank diagonal. (Waiting on floats() progress instead
  //     pushes capture time to near-expiry, alpha→0, and the numeral fades out —
  //     the false negative that first read as "the float never draws".)
  //     DSF 1 here on purpose: at DSF 2 the screenshot is slow enough that the
  //     0.55 s float expires before the frame lands. A DSF-1 shot ~0.1 s after
  //     confirm catches the numeral out in open space, arcing toward the bank.
  {
    const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const build = await bootPress(page, '/?debug=1'); // no freeze: the cost must travel
    const opened = await page.evaluate(() => window.__pressStage.openBuild(50));
    const bankBefore = await page.evaluate(() => window.__pressStage.bank());
    await page.evaluate((i) => window.__pressStage.confirm('build', i, 1, false, true), REPAIR_WEDGE);
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(OUT, 'repair-confirmation.png') });
    const after = await page.evaluate((i) => {
      const f = window.__pressStage.floats().find((x) => x.index === i);
      return { floatNow: f ?? null, shimmer: window.__pressStage.coreShimmer(), bank: window.__pressStage.bank() };
    }, REPAIR_WEDGE);
    console.log('[3 repair]', { build, opened, bankBefore, ...after, errors });
    await ctx.close();
  }

  // --- 3b. repair-confirmation-detail (FREEZE; the REPAIR wedge at the moment of
  //     confirm, close-up). Freeze pins the float at progress 0 — right on its
  //     launch point at the wedge — so the signal-yellow "1" reads large and the
  //     plasma pulse on the wedge is unambiguous. A ?debug clip, DSF 3.
  {
    const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const build = await bootPress(page, '/?debug=1&freeze=1');
    await page.evaluate(() => window.__pressStage.openBuild(50));
    await page.evaluate((i) => window.__pressStage.confirm('build', i, 1, false, true), REPAIR_WEDGE);
    const readout = await page.evaluate((i) => ({
      floats: window.__pressStage.floats(), shimmer: window.__pressStage.coreShimmer(),
      wedge: window.__pressStage.feedback('build', i),
    }), REPAIR_WEDGE);
    // Clip the REPAIR wedge (bottom-right of centre) so the launched "1" is legible.
    await page.screenshot({ path: join(OUT, 'repair-confirmation-detail.png'), clip: { x: 600, y: 450, width: 340, height: 175 } });
    console.log('[3b repair-detail]', { build, ...readout, errors });
    await ctx.close();
  }

  // --- 4. settings-vibration-absent (clean boot → SETTINGS, vibrate armed) ----
  {
    const page = await newPage(browser, {
      arm: async (p) => p.addInitScript(() => {
        // A recording motor, defined before any page script → isSupported() TRUE.
        Object.defineProperty(navigator, 'vibrate', {
          configurable: true, writable: true, value: () => true,
        });
      }),
    });
    await page.goto(BASE + '/', { waitUntil: 'load' }); // CLEAN boot: the menu path
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    // Walk down the vertical centre clicking until the menu reports the settings
    // screen (never clicking PLAY, the top button — start below mid-height).
    let onSettings = false;
    for (let y = 440; y <= 620 && !onSettings; y += 12) {
      await page.mouse.click(VP.width / 2, y);
      await sleep(120);
      onSettings = await page.evaluate(() => window.__mainMenu?.screen === 'settings');
    }
    await sleep(300); // let the settings view draw
    const screen = await page.evaluate(() => window.__mainMenu?.screen ?? null);
    await page.screenshot({ path: join(OUT, 'settings-vibration-absent.png') });
    console.log('[4 settings]', { screen, onSettings, errors: page._errors });
    await page.context().close();
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
