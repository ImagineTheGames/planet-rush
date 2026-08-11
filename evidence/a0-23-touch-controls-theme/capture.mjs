/**
 * evidence/a0-23-touch-controls-theme/capture.mjs — the BUILD button, live.
 *
 * The BUILD & UPGRADE button is the one control no golden in this repo can show.
 * It draws on `buildVisible`, which is written in `updateBuildWheel()`, and
 * `?freeze=1` returns from the loop's update *before* that runs — so a frozen
 * scene never carries it. (`__pressStage.openBuild()` docks the ship, but it
 * also opens the wheel, which covers the slot the button sits in.)
 *
 * So this shoots the LIVE build instead, on the profile the developer
 * photographed: 390 px phone, landscape, dpr 3, real touch emulation. The local
 * ship spawns docked at its own station, which is exactly the state the button
 * exists for — the same state `tests/mobile/build-flow.spec.ts` taps it in.
 *
 * Deterministic enough to compare two builds: the seeded world is stepped a
 * fixed number of SIM ticks (not milliseconds) before the shutter, the same way
 * the mobile suite waits.
 *
 * Usage — with a preview server already up on PREVIEW_PORT:
 *   node evidence/a0-23-touch-controls-theme/capture.mjs before
 *   node evidence/a0-23-touch-controls-theme/capture.mjs after
 *
 * Writes `<label>-live.png` (the whole frame) and `<label>-build.png` (the BUILD
 * slot and the stick zone under it, at 3× so the type is readable in a PR).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const label = process.argv[2] ?? 'after';
const PORT = process.env.PREVIEW_PORT ?? '4194';

/** The iPhone-ish profile from playwright.config.ts, rotated to the playable
 *  orientation. 844×390 logical is what the landscape lock hands the game. */
const VIEWPORT = { width: 844, height: 390 };
const DPR = 3;
/** Sim steps to let pass before the shutter — enough that the HUD is populated
 *  and the ship has settled at its spawn, few enough that nothing has drifted. */
const TICKS = 24;

/** The BUILD slot plus the stick zone beneath it, in CSS px (see
 *  `@platform/touch-visuals`: centre (92, 178) at this viewport, r = 38). */
const BUILD_WINDOW = { x: 8, y: 108, w: 190, h: 190 };
const SCALE = 3;

function crop(pngFile, { x, y, w, h }, scale, dpr) {
  const src = PNG.sync.read(fs.readFileSync(pngFile));
  const out = new PNG({ width: w * scale, height: h * scale });
  for (let oy = 0; oy < out.height; oy++) {
    for (let ox = 0; ox < out.width; ox++) {
      const sx = Math.min(src.width - 1, Math.round((x + ox / scale) * dpr));
      const sy = Math.min(src.height - 1, Math.round((y + oy / scale) * dpr));
      const si = (sy * src.width + sx) * 4;
      const di = (oy * out.width + ox) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: DPR,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();

// ?debug=1 and NOT ?freeze=1 — the sim has to run for the dock check to fire.
await page.goto(`http://localhost:${PORT}/?debug=1`);
await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
await page.waitForFunction(
  () => {
    const pr = window.__planetRush;
    return !!pr && Array.isArray(pr.layout) && pr.layout.length > 0 && (pr.ticks ?? 0) > 3;
  },
  undefined,
  { timeout: 20_000 },
);
const from = await page.evaluate(() => window.__planetRush.ticks);
await page.waitForFunction((t) => window.__planetRush.ticks >= t, from + TICKS, { timeout: 20_000 });

// Fail loudly rather than shipping a frame of the thing not being there: the
// layout registry is fed from the same `buildButtonRect` that draws the button.
const registered = await page.evaluate(() =>
  window.__planetRush.layout.map((e) => e.id).filter((id) => /build/.test(id)),
);
if (!registered.includes('build-button')) {
  throw new Error(
    `the BUILD button is not on screen (registry has: ${registered.join(', ') || 'nothing build-ish'})`,
  );
}

const full = path.join(here, `${label}-live.png`);
await page.screenshot({ path: full });
fs.writeFileSync(
  path.join(here, `${label}-build.png`),
  PNG.sync.write(crop(full, BUILD_WINDOW, SCALE, DPR)),
);

await browser.close();
console.log(`${label}: wrote ${label}-live.png and ${label}-build.png`);
