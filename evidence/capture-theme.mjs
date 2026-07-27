/**
 * evidence/capture-theme.mjs — button-theme-consistent evidence. OWNER: QA Manager.
 *
 * Shoots the shared button contract (src/ui/button-theme.ts) on the REAL preview
 * build through the front door:
 *   A. main-menu    — clean boot (no ?debug): PLAY (primary) + SETTINGS (standard),
 *                     both full-contrast chalk labels. SETTINGS unmistakably active.
 *   B. end-screen   — ?debug=1 then __endScreenStage.endMatch() (drives the sim's
 *                     real destroyCore) → result screen: REMATCH + BACK TO MENU, alive.
 *   C. defeated     — __endScreenStage.eliminateLocal() → DEFEATED: REMATCH + SPECTATE.
 *
 * Raw frames only; the multi-panel figure is composed by build-theme-figure.mjs.
 * Usage: node evidence/capture-theme.mjs   (needs preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4188';
const VP = { width: 1280, height: 800 };
const DSF = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(browser, query, ready) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  page._ctx = ctx;
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  if (ready) await page.waitForFunction(ready, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // --- A. main menu (clean boot) --------------------------------------------
  {
    const page = await boot(browser, '/', () => typeof window.__mainMenu?.controls !== 'undefined' || !!document.querySelector('canvas'));
    await sleep(900);
    const controls = await page.evaluate(() => {
      const s = window.__mainMenu;
      if (!s) return null;
      return (s.controls || []).map((c) => ({ kind: c.kind, label: c.label, rect: c.logical ?? c.rect }));
    });
    await page.screenshot({ path: join(OUT, 'theme-menu-raw.png') });
    console.log('[menu] controls=', JSON.stringify(controls), 'errors=', page._errors.slice(0, 3));
    await page._ctx.close();
  }

  // --- B. end screen: result (match over) -----------------------------------
  {
    const page = await boot(browser, '/?debug=1', () => typeof window.__endScreenStage?.endMatch === 'function');
    await sleep(500);
    const t0 = await page.evaluate(() => window.__endScreenStage.ticks());
    await page.evaluate(() => window.__endScreenStage.endMatch());
    await page.waitForFunction((was) => window.__endScreenStage.ticks() > was + 2, t0, { timeout: 10_000 }).catch(() => {});
    await page.waitForFunction(() => window.__endScreenStage.screen() === 'result', undefined, { timeout: 10_000 }).catch(() => {});
    await sleep(700);
    const info = await page.evaluate(() => ({ screen: window.__endScreenStage.screen(), buttons: window.__endScreenStage.buttons() }));
    await page.screenshot({ path: join(OUT, 'theme-end-result-raw.png') });
    console.log('[end-result]', JSON.stringify(info), 'errors=', page._errors.slice(0, 3));
    await page._ctx.close();
  }

  // --- C. end screen: defeated (eliminated, others fight on) -----------------
  {
    const page = await boot(browser, '/?debug=1', () => typeof window.__endScreenStage?.eliminateLocal === 'function');
    await sleep(500);
    await page.evaluate(() => window.__endScreenStage.eliminateLocal());
    await page.waitForFunction(() => window.__endScreenStage.screen() === 'defeated', undefined, { timeout: 10_000 }).catch(() => {});
    await sleep(700);
    const info = await page.evaluate(() => ({ screen: window.__endScreenStage.screen(), buttons: window.__endScreenStage.buttons() }));
    await page.screenshot({ path: join(OUT, 'theme-end-defeated-raw.png') });
    console.log('[end-defeated]', JSON.stringify(info), 'errors=', page._errors.slice(0, 3));
    await page._ctx.close();
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
