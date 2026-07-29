/**
 * evidence/capture-online-live.mjs — the ONLINE front door, driven against the
 * REAL Fly allocator over the real internet. OWNER: QA Manager (M3/online step 4).
 *
 * The client bundle under test was built with
 *   VITE_ALLOCATOR_URL=https://planet-rush-allocator.fly.dev
 * so pressing CREATE / JOIN makes a genuine HTTP round trip to the live control
 * plane — no fake, no loopback. We drive the shipped `window.__onlineMenu` seam
 * (the same pure transitions a tap fires), wait for the door to settle out of
 * `connecting`, and screenshot what a player would actually see.
 *
 * Every caption number/string is read back off the live seam (status, error,
 * resolvedCode), never asserted from the code.
 *
 * Usage: node evidence/capture-online-live.mjs   (needs preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 2 });
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

/** Read the live online-door seam. */
const readSeam = (page) =>
  page.evaluate(() => {
    const s = window.__onlineMenu;
    return { visible: s.visible, screen: s.screen, status: s.status, error: s.error, code: s.code, resolvedCode: s.resolvedCode, regionPickerVisible: s.regionPickerVisible };
  });

/** Wait until the door is no longer `connecting` (the allocator answered), up to `ms`. */
async function settle(page, ms = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await readSeam(page);
    if (s.status !== 'connecting') return s;
    await sleep(200);
  }
  return readSeam(page);
}

async function shot(page, name) {
  const path = join(OUT, name);
  await page.screenshot({ path });
  return path;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = {};
  try {
    const page = await boot(browser);

    // 1 · Open the ONLINE front door and screenshot the CREATE / JOIN doors.
    await page.evaluate(() => window.__onlineMenu.open());
    await sleep(400);
    results.door = await readSeam(page);
    results.doorShot = await shot(page, 'online-door.png');

    // 2 · CREATE — a genuine allocate against the live control plane.
    await page.evaluate(() => window.__onlineMenu.create());
    results.createConnecting = await readSeam(page);
    results.createSettled = await settle(page);
    await sleep(300);
    results.createShot = await shot(page, 'online-create-live.png');

    // 3 · Back to the doors, then JOIN a made-up code — the other live path.
    await page.evaluate(() => {
      const s = window.__onlineMenu;
      // back out of any error to the doors, then take the JOIN door + type a code.
      s.back();
      s.join();
      for (const ch of 'ABCD') s.typeCode(ch);
    });
    await sleep(200);
    results.joinTyped = await readSeam(page);
    await page.evaluate(() => window.__onlineMenu.submit());
    results.joinSettled = await settle(page);
    await sleep(300);
    results.joinShot = await shot(page, 'online-join-live.png');

    results.pageErrors = page._errors;
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, 'online-live-readback.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
