/**
 * evidence/capture-online-join-live.mjs — the JOIN path (the guest side of a
 * two-client match), driven against the REAL Fly allocator. OWNER: QA Manager.
 *
 * A second player joins by typing the code the host read out. This captures that
 * keypad on the shipped client, then submits a code against the live allocator
 * and screenshots the result. Fresh boot so the door state is clean.
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
    return { visible: s.visible, screen: s.screen, status: s.status, error: s.error, code: s.code };
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = {};
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => typeof window.__onlineMenu?.open === 'function', undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});

    // ONLINE → JOIN → type a plausible code, screenshot the keypad.
    await page.evaluate(() => {
      window.__onlineMenu.open();
      window.__onlineMenu.join();
      for (const ch of 'WXYZ') window.__onlineMenu.typeCode(ch);
    });
    await sleep(400);
    results.keypad = await readSeam(page);
    await page.screenshot({ path: join(OUT, 'online-join-keypad.png') });

    // Submit against the live allocator, screenshot the outcome.
    await page.evaluate(() => window.__onlineMenu.submit());
    results.submitted = await settle(page);
    await sleep(300);
    await page.screenshot({ path: join(OUT, 'online-join-live.png') });

    results.pageErrors = errors;
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, 'online-join-readback.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
