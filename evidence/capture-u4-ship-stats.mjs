/**
 * evidence/capture-u4-ship-stats.mjs — u4-01 ship stats on ship-select.
 *
 * WHAT IT PROVES: the four hull tiles in the lobby carry their stats as **pips
 * AND numbers, together** (ratified 2026-08-05: "both pips and numbers"), and
 * that they do so on a POINTER device and a TOUCH device, in landscape and
 * portrait-held — the brief's explicit cross-platform ask, because a layout
 * verified only on desktop has shipped broken on this project before.
 *
 * It reaches the lobby the way a player does — a real click / a real touch on
 * PLAY, then PLAY SOLO — rather than by calling a seam, so the shot is of the
 * screen a player actually gets. Each profile is shot twice: the lobby as it
 * opens (Vanguard pre-selected, GDD §2.11), and again after a real press on a
 * different hull tile, so the selected-tile treatment (plasma pips) is visible
 * beside three unselected ones.
 *
 * Usage:
 *   npm run build && npx vite preview --port 4173 --strictPort &
 *   node evidence/capture-u4-ship-stats.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

/** The device matrix: QA's own profiles, plus the pointer control. Portrait is
 *  included deliberately — the game locks to landscape, so a portrait-HELD phone
 *  renders the rotated canvas, and that is a real device state for this screen. */
const PROFILES = [
  { id: 'desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, touch: false },
  { id: 'iphone-landscape', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, touch: true },
  { id: 'iphone-portrait', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, touch: true },
  { id: 'pixel-landscape', viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, touch: true },
];

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

const report = { capture: 'u4-ship-stats-on-select', base: BASE, profiles: [] };

for (const profile of PROFILES) {
  const ctx = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.touch,
    hasTouch: profile.touch,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // A real press, through whichever input this profile has. The lobby's controls
  // report the PHYSICAL point their logical rect maps to (the landscape-lock
  // remap), so the same code drives both form factors.
  const press = async (x, y) => {
    if (profile.touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await sleep(500);
  };

  await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});

  // PLAY → the doors → PLAY SOLO → the lobby.
  const play = await page.evaluate(() =>
    (window.__mainMenu.controls ?? []).find((c) => c.kind === 'play')?.physicalCenter ?? null,
  );
  await press(play.x, play.y);
  await page.waitForFunction(
    () => window.__onlineMenu?.visible === true && (window.__onlineMenu.doorControls ?? []).length > 0,
    undefined,
    { timeout: 30_000 },
  );
  const solo = await page.evaluate(() =>
    (window.__onlineMenu.doorControls ?? []).find((c) => c.kind === 'solo')?.physicalCenter ?? null,
  );
  await press(solo.x, solo.y);
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
  await sleep(700);

  const opened = join(OUT, `u4-ship-stats-${profile.id}-default.png`);
  await page.screenshot({ path: opened });

  // Now press a hull that is NOT the onboarding default, so one tile shows the
  // selected treatment (plasma pips, bright figures) beside three that do not.
  const seam = await page.evaluate(() => ({
    selected: window.__lobby.selectedClass,
    def: window.__lobby.defaultClass,
    order: window.__lobby.classOrder,
    controls: window.__lobby.classControls,
    isTouch: window.__lobby.isTouch,
    viewport: window.__lobby.logicalViewport,
  }));
  const pickIndex = seam.order.findIndex((c) => c !== seam.def);
  const target = seam.controls.find((c) => c.index === pickIndex);
  await press(target.physicalCenter.x, target.physicalCenter.y);
  const picked = await page.evaluate(() => window.__lobby.selectedClass);

  const shot = join(OUT, `u4-ship-stats-${profile.id}-picked.png`);
  await page.screenshot({ path: shot });

  report.profiles.push({
    id: profile.id,
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    input: profile.touch ? 'touch' : 'pointer',
    orientation: profile.viewport.width >= profile.viewport.height ? 'landscape' : 'portrait-held',
    lobbyIsTouch: seam.isTouch,
    logicalViewport: seam.viewport,
    openedWith: seam.def,
    pressedTile: pickIndex,
    selectedAfterPress: picked,
    pickTookEffect: picked !== seam.def,
    images: [opened.replace(HERE + '/', ''), shot.replace(HERE + '/', '')],
    consoleErrors: errors,
  });

  await ctx.close();
  console.log(`${profile.id}: ${profile.touch ? 'touch' : 'pointer'} → lobby, picked ${picked} (was ${seam.def}), ${errors.length} errors`);
}

await browser.close();
const path = join(OUT, 'u4-ship-stats.json');
writeFileSync(path, JSON.stringify(report, null, 2));
console.log(`\nwrote ${path}`);
