/**
 * evidence/a1-05-live-round/probe-clean-boot-error.mjs — locating the one
 * exception the shipped client throws on a CLEAN boot. OWNER: QA Manager.
 *
 * Every clean-boot capture in this round logged exactly one uncaught
 * `TypeError: Cannot read properties of null (reading 'clear')`. This walks the
 * front door one screen at a time and records which step it appears after, so the
 * manifest item can say WHERE rather than only THAT.
 *
 *   node evidence/a1-05-live-round/probe-clean-boot-error.mjs
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://imaginethegames.github.io/planet-rush/';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push({ at: Date.now(), message: e.message, stack: (e.stack ?? '').split('\n').slice(0, 6) }));

const log = [];
const mark = (step) => log.push({ step, errorsSoFar: errors.length });

async function point(seam, kind) {
  return page.evaluate(
    ([w, k]) => {
      const list = w === 'menu' ? (window.__mainMenu?.controls ?? []) : (window.__onlineMenu?.doorControls ?? []);
      const c = list.find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    [seam, kind],
  );
}
async function click(p) {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 45_000 });
await page.waitForTimeout(6000);
mark('menu up, idle 6s');

await click(await point('menu', 'play'));
await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
await page.waitForTimeout(3000);
mark('doors up, idle 3s');

await click(await point('door', 'solo'));
await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });
await page.waitForTimeout(4000);
mark('lobby up, idle 4s');

const rush = await page.evaluate(() => {
  const c = window.__lobby?.rushControl.physicalCenter;
  return c ? { x: c.x, y: c.y } : null;
});
await click(rush);
await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 90_000 });
await page.waitForTimeout(6000);
mark('match running, idle 6s');

const sha = await page.evaluate(async () => {
  try {
    const r = await fetch('./version.json', { cache: 'no-store' });
    return r.ok ? (await r.json()).sha : null;
  } catch {
    return null;
  }
});

const out = { base: BASE, servedSha: sha, log, errors };
writeFileSync(join(HERE, 'clean-boot-errors.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
await browser.close();
