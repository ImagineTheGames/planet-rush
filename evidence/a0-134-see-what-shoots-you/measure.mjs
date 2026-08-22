/**
 * evidence/a0-134-see-what-shoots-you/measure.mjs — how much world each screen
 * draws, off the shipped bundle, before and after. OWNER: UI Engineer (a0-134).
 *
 * The brief asks for *"the visible world extent per profile against weapon
 * range"*. Both halves are READ rather than computed here:
 *
 *  - the extent is `window.__viewStage.world()`, which returns
 *    `renderer.visibleWorld` — the very rectangle the cull culls against, so this
 *    is the renderer's own answer to "what is on screen", not a second one.
 *  - the range is `WEAPON_RANGE` + `SHIP_RADIUS` from `src/sim/constants.ts`,
 *    imported by the reporter rather than typed as a literal.
 *
 * The one number this file computes is the subtraction between them, and it does
 * so on the SHORT axis because the camera centres the ship: the world reaches
 * half the glass in each direction, so the nearest edge is always the short one.
 *
 *   BASE=http://localhost:4319 node evidence/a0-134-see-what-shoots-you/measure.mjs before
 *   BASE=http://localhost:4320 node evidence/a0-134-see-what-shoots-you/measure.mjs after
 *
 * `?debug=1` is used here and ONLY here. a0-131's rule is that a photograph never
 * carries it (it skips the main menu, and `?freeze=1` hides the build stamp); this
 * pass takes no photographs — it reads instruments — and `__viewStage` is a
 * `?debug=1` seam, so there is no other way to ask the renderer the question.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4318';
const LABEL = process.argv[2] ?? 'after';

/** QA's matrix, plus the two ultrawides the brief asks about by name. `short` is
 *  what the sightline is measured on; the landscape lock rotates a portrait phone
 *  into a landscape LOGICAL frame, so a portrait row and its landscape twin are
 *  the same screen asked twice — which is the point of measuring both. */
const PROFILES = [
  { name: 'desktop', width: 1280, height: 800, touch: false }, // a0-131's HOST
  { name: 'qa-phone/landscape', width: 798, height: 384, touch: true }, // a0-131's JOINER
  { name: 'iphone/landscape', width: 844, height: 390, touch: true },
  { name: 'iphone/portrait', width: 390, height: 844, touch: true },
  { name: 'pixel/landscape', width: 915, height: 412, touch: true },
  { name: 'iphone-se/portrait', width: 375, height: 667, touch: true },
  { name: 'small/landscape', width: 568, height: 320, touch: true },
  { name: 'ultrawide-21:9', width: 2560, height: 1080, touch: false },
  { name: 'ultrawide-32:9', width: 3840, height: 1080, touch: false },
];

const browser = await chromium.launch();
const rows = [];
for (const p of PROFILES) {
  const ctx = await browser.newContext({
    viewport: { width: p.width, height: p.height },
    deviceScaleFactor: 2,
    hasTouch: p.touch,
    isMobile: p.touch,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${p.name} pageerror]`, String(e).slice(0, 160)));
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__viewStage?.world === 'function', undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1200); // let the camera settle on a live ship
  const stage = await page.evaluate(() => ({
    world: window.__viewStage.world(),
    viewport: window.__viewStage.viewport(),
    zoom: window.__viewStage.zoom(),
    control: window.__viewStage.control(),
    build: window.__planetRush?.build ?? null,
  }));
  rows.push({ profile: p.name, css: `${p.width}x${p.height}`, ...stage });
  console.log(
    `${p.name.padEnd(20)} css ${String(p.width).padStart(4)}x${String(p.height).padEnd(4)} ` +
      `zoom ${String(stage.zoom).padEnd(5)} world ${stage.world.width.toFixed(0)}x${stage.world.height.toFixed(0)} ` +
      `half-short ${(Math.min(stage.world.width, stage.world.height) / 2).toFixed(1)}`,
  );
  await ctx.close();
}
await browser.close();

mkdirSync(join(ROOT, 'shots'), { recursive: true });
writeFileSync(
  join(ROOT, 'shots', `view-extents-${LABEL}.json`),
  `${JSON.stringify({ label: LABEL, base: BASE, rows }, null, 2)}\n`,
);
console.log(`\nwrote shots/view-extents-${LABEL}.json`);
