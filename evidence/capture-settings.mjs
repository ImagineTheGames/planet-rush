/**
 * evidence/capture-settings.mjs — capture the SETTINGS screen to check, with the
 * QA officer's own eyes, whether a Vibration toggle appears (field request v0.2.2
 * item 2). Boots the REAL menu (no ?debug=1, so the menu is not skipped), injects
 * a recording navigator.vibrate BEFORE boot so haptics.isSupported() is TRUE — the
 * exact condition under which the settings screen is supposed to SHOW the toggle.
 *
 * Usage: node evidence/capture-settings.mjs
 *   env EVIDENCE_BASE_URL (default http://localhost:4173)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  // A recording navigator.vibrate installed before any page script → haptics
  // feature-detects a motor as present, so isSupported() is true.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value: () => true });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(800);

  // Menu shot first (PLAY / SETTINGS).
  await page.screenshot({ path: join(OUT, 'menu-before-settings.png') });

  // The two buttons are a centred column below the wordmark. SETTINGS is the
  // lower of the two — click the lower-button band at screen centre-x.
  const vp = page.viewportSize();
  await page.mouse.click(vp.width / 2, vp.height * 0.62);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'settings-after-click-062.png') });

  console.log(JSON.stringify({ errors: errors.slice(0, 4), vp }));
  await context.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
