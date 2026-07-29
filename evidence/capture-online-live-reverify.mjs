/**
 * evidence/capture-online-live-reverify.mjs — RE-VERIFY the three online gates
 * against the LIVE Fly deployment, from the shipped client's real front door.
 * OWNER: QA Manager (M3/online re-verify, branch m10-evidence-online-live).
 *
 * The bundle under test is built with
 *   VITE_ALLOCATOR_URL=https://planet-rush-allocator.fly.dev
 * so CREATE / JOIN make genuine HTTP round trips to the live control plane — no
 * fake, no loopback. We drive the shipped `window.__onlineMenu` seam (the same
 * pure transitions a tap fires) from a FRESH boot per attempt, wait for the door
 * to settle out of `connecting`, and screenshot exactly what a player would see.
 * Both form factors: desktop (1000x640) and portrait phone (390x844).
 *
 * Every caption number/string is read back off the live seam, never asserted
 * from code. Usage: EVIDENCE_BASE_URL=http://localhost:4173 node this.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readSeam = (page) =>
  page.evaluate(() => {
    const s = window.__onlineMenu;
    return {
      visible: s.visible, screen: s.screen, status: s.status,
      error: s.error, code: s.code, resolvedCode: s.resolvedCode,
      regionPickerVisible: s.regionPickerVisible,
    };
  });

async function settle(page, ms = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await readSeam(page);
    if (s.status !== 'connecting') return s;
    await sleep(200);
  }
  return readSeam(page);
}

async function boot(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__onlineMenu?.open === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  page._errors = errors;
  return page;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = { base: BASE, forms: {} };
  try {
    for (const [form, viewport, tag] of [
      ['desktop', { width: 1000, height: 640 }, 'desktop'],
      ['phone', { width: 390, height: 844 }, 'phone'],
    ]) {
      const r = {};

      // --- CREATE: a genuine allocate against the live control plane ---
      let page = await boot(browser, viewport);
      await page.evaluate(() => window.__onlineMenu.open());
      await sleep(400);
      r.door = await readSeam(page);
      await page.screenshot({ path: join(OUT, `online-door-${tag}.png`) });
      await page.evaluate(() => window.__onlineMenu.create());
      r.createConnecting = await readSeam(page);
      r.createSettled = await settle(page);
      await sleep(300);
      await page.screenshot({ path: join(OUT, `online-create-${tag}.png`) });
      r.createErrors = page._errors.slice();
      await page.context().close();

      // --- JOIN: fresh boot, type a made-up code, submit against the live allocator ---
      page = await boot(browser, viewport);
      await page.evaluate(() => {
        window.__onlineMenu.open();
        window.__onlineMenu.join();
        for (const ch of 'WXYZ') window.__onlineMenu.typeCode(ch);
      });
      await sleep(400);
      r.joinKeypad = await readSeam(page);
      await page.screenshot({ path: join(OUT, `online-join-keypad-${tag}.png`) });
      await page.evaluate(() => window.__onlineMenu.submit());
      r.joinSettled = await settle(page);
      await sleep(300);
      await page.screenshot({ path: join(OUT, `online-join-${tag}.png`) });
      r.joinErrors = page._errors.slice();
      await page.context().close();

      results.forms[form] = r;
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, 'online-live-reverify-readback.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
