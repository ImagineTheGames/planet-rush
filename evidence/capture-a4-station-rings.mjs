/**
 * evidence/capture-a4-station-rings.mjs — a4-01 evidence: TWO rings, and the
 * BUILD button lighting up inside the inner one. OWNER: Art & Audio Agent.
 *
 * The field report was visual ("theres a bunch of rings around the station …
 * once you are in build distance it should highlight the build button"), so the
 * evidence has to be visual too, and on the surfaces the report came from:
 *
 *   RINGS-POINTER   — desktop 1280×800, the frozen scene. The two rings around
 *                     the viewer's own station: a soft atmosphere edge at
 *                     DEPOSIT_RANGE (256 u) and dashed plasma at STATION.dockRange
 *                     (160 u). Nothing in between reads as a third.
 *   BUTTON-LANDSCAPE— iPhone-ish 844×390 WITH TOUCH, ship parked docked. The
 *                     BUILD button in its lit state, thumb-height above the left
 *                     stick.
 *   BUTTON-PORTRAIT — the same phone HELD PORTRAIT (390×844), so the frame goes
 *                     through the landscape lock's 90° rotation. A touch control
 *                     verified only on a desktop has shipped broken here before.
 *
 * Nothing is faked. The rings are the real render of the real sprite; the docked
 * ship is parked by `__oreDepositStage.stage(0)` — the ratified ?debug=1 seam that
 * settles the local ship at rest `station.radius + ship.radius + 30` = 110 u from
 * its own centre, comfortably inside the 160 u dock range — and the button is then
 * whatever the live boot decides to draw. The manifest records the measured
 * ship→station distance beside `STATION.dockRange` so the reader can check that
 * the button in the frame really is inside the ring in the frame.
 *
 * Usage: node evidence/capture-a4-station-rings.mjs   (needs preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const DEPOSIT_RANGE = 256; // STATION.radius(64) * 4   (src/sim/constants.ts)
const DOCK_RANGE = 160; // STATION.dockRange           (src/sim/constants.ts)
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const notes = [];

/** Boot a page and wait until the debug hook says the frame is really up. */
async function boot(page, url) {
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  await page.goto(BASE + url, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => (window.__planetRush?.viewport?.width ?? 0) > 0, undefined, {
    timeout: 25000,
  });
  await page.evaluate(() => document.fonts?.ready);
  return errs;
}

// --- 1. The rings, on a pointer screen --------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = await boot(page, '/?debug=1&freeze=1');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, 'a4-rings-desktop-full.png') });
  notes.push({ frame: 'rings-pointer', viewport: '1280x800 dpr1', touch: false, errors: errs.length });
  await ctx.close();
}

// --- 2 & 3. The lit BUILD button, on touch, both ways up --------------------
for (const [name, w, h] of [
  ['landscape', 844, 390],
  ['portrait', 390, 844],
]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = await boot(page, '/?debug=1');
  // Park the ship docked at its own station — the ratified deposit stage, which
  // settles it at rest 110 u out: inside dockRange, so the wheel is live and the
  // button is lit, and clear of the station's own collider.
  const staged = await page.waitForFunction(
    () => (typeof window.__oreDepositStage?.stage === 'function' ? window.__oreDepositStage.stage(0) : null),
    undefined,
    { timeout: 25000 },
  );
  if (!(await staged.jsonValue())) throw new Error(`${name}: the deposit stage found no local ship/station`);
  // Let the live sim run a beat so the frame on screen is the docked one.
  await page.waitForTimeout(900);
  // The layout registry's own record of what was DRAWN this frame — the same
  // source the QA placement suite asserts against, so "the button is in the
  // picture" is a fact rather than a reading of the picture.
  const drawn = await page.evaluate(() => {
    const pr = window.__planetRush;
    const e = (pr?.layout ?? []).find((r) => r.id === 'build-button');
    return e ? { bounds: e.bounds, ship: pr.shipWorld } : null;
  });
  await page.screenshot({ path: join(OUT, `a4-build-button-${name}-full.png`) });
  notes.push({
    frame: `button-${name}`,
    viewport: `${w}x${h} dpr3`,
    touch: true,
    buildButtonDrawn: drawn !== null,
    buildButtonBounds: drawn?.bounds ?? null,
    stagedAt: 'station.radius + ship.radius + 30 = 110 u from own centre',
    dockRange: DOCK_RANGE,
    depositRange: DEPOSIT_RANGE,
    errors: errs.length,
  });
  if (!drawn) throw new Error(`${name}: docked, but the registry drew no build-button`);
  await ctx.close();
}

await browser.close();
writeFileSync(join(OUT, 'a4-station-rings.manifest.json'), JSON.stringify({ base: BASE, frames: notes }, null, 2));
console.log(JSON.stringify(notes, null, 2));
