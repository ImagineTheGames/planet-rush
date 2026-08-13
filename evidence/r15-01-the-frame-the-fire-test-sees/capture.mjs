/**
 * evidence/r15-01-the-frame-the-fire-test-sees/capture.mjs — the desktop frame
 * `tests/mobile/emulation.spec.ts:508` samples, and where its Bone-lit pixels
 * actually come from.
 *
 * The a0-23 assertion is a NEGATIVE one: in the bottom-right corner
 * (`REGION_FIRE` = x 0.7–1.0, y 0.8–1.0 of the viewport) there must be almost no
 * chalk-bright Bone, because a touch FIRE rim leaking onto desktop would be
 * exactly that. A negative pixel assertion cannot say WHAT lit the region up —
 * only that something did. This script answers that question by attributing the
 * matched pixels to the rects the app itself publishes under `?debug=1`
 * (`window.__planetRush.layout`), so the attribution is the app's own contract
 * rather than a hand-drawn box:
 *
 *   - `minimap`   — the collapsed corner square, which the test already exempts;
 *   - `onboarding`— the prompt panel, which a0-34 gave a fifth entry that fires
 *                   at the START of the first match, i.e. exactly when the test
 *                   shoots.
 *
 * It prints the same numbers the test computes (`fireBone - mmBone` against
 * `ABSENT_MAX_PX` = 40), then the same count with the PROMPT rect subtracted as
 * well. If the second number is small and the first is not, the prompt is what
 * trips the assertion and no FIRE affordance is on screen.
 *
 * Usage — with a preview server already up on PREVIEW_PORT:
 *   node evidence/r15-01-the-frame-the-fire-test-sees/capture.mjs before
 *   node evidence/r15-01-the-frame-the-fire-test-sees/capture.mjs after
 *
 * Writes `<label>-desktop.png` (the whole 1280×800 frame), `<label>-corner.png`
 * (REGION_FIRE at 2×, which is where the argument is), and `<label>.json` (the
 * counts, the rects, and the prompt text that was on screen).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const label = process.argv[2] ?? 'after';
const PORT = process.env.PREVIEW_PORT ?? '4193';

/** The desktop control profile from playwright.config.ts, verbatim. */
const VIEWPORT = { width: 1280, height: 800 };
const DPR = 1;
/** `SETTLE_TICKS` in emulation.spec.ts is a second of SIM (60), and `boot()`
 *  waits for the sim clock first. Same window, so the same frame. */
const TICKS = 60;

/** `REGION_FIRE` from tests/mobile/pixels.ts, verbatim. */
const REGION_FIRE = { x0: 0.7, y0: 0.8, x1: 1.0, y1: 1.0 };
/** `ABSENT_MAX_PX` from tests/mobile/emulation.spec.ts. */
const ABSENT_MAX_PX = 40;
/** `isBoneLit` from tests/mobile/pixels.ts, verbatim. */
const isBoneLit = (r, g, b) => r > 170 && g > 170 && b > 170;

/** Device-pixel box of a fractional region over an image. */
function boxOf(img, region) {
  return {
    x0: Math.max(0, Math.min(img.width, Math.floor(region.x0 * img.width))),
    y0: Math.max(0, Math.min(img.height, Math.floor(region.y0 * img.height))),
    x1: Math.max(0, Math.min(img.width, Math.ceil(region.x1 * img.width))),
    y1: Math.max(0, Math.min(img.height, Math.ceil(region.y1 * img.height))),
  };
}

/** Count `isBoneLit` pixels inside `region`, skipping any pixel that falls in
 *  one of `exclude` (fractional regions). */
function countBone(img, region, exclude = []) {
  const b = boxOf(img, region);
  const outs = exclude.map((e) => boxOf(img, e));
  let matched = 0;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      if (outs.some((o) => x >= o.x0 && x < o.x1 && y >= o.y0 && y < o.y1)) continue;
      const i = (y * img.width + x) * 4;
      if (isBoneLit(img.data[i], img.data[i + 1], img.data[i + 2])) matched++;
    }
  }
  return matched;
}

/** Intersection of two fractional regions, or null. */
function intersect(a, b) {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

function cropRegion(img, region, scale) {
  const b = boxOf(img, region);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const out = new PNG({ width: w * scale, height: h * scale });
  for (let oy = 0; oy < out.height; oy++) {
    for (let ox = 0; ox < out.width; ox++) {
      const sx = Math.min(img.width - 1, b.x0 + Math.floor(ox / scale));
      const sy = Math.min(img.height - 1, b.y0 + Math.floor(oy / scale));
      const si = (sy * img.width + sx) * 4;
      const di = (oy * out.width + ox) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: DPR,
  hasTouch: false,
  isMobile: false,
});
const page = await context.newPage();

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
await page.waitForFunction((t) => window.__planetRush.ticks >= t, from + TICKS, { timeout: 30_000 });

const registry = await page.evaluate(() => {
  const pr = window.__planetRush;
  const pick = (id) => {
    const e = pr.layout.find((x) => x.id === id);
    return e ? e.bounds : null;
  };
  return {
    viewport: { w: pr.viewport.w, h: pr.viewport.h },
    ids: pr.layout.map((e) => e.id),
    minimap: pick('minimap'),
    onboarding: pick('onboarding'),
  };
});

const shotPath = path.join(here, `${label}-desktop.png`);
await page.screenshot({ path: shotPath });
const img = PNG.sync.read(fs.readFileSync(shotPath));

const asRegion = (b) =>
  b
    ? {
        x0: b.x / registry.viewport.w,
        y0: b.y / registry.viewport.h,
        x1: (b.x + b.width) / registry.viewport.w,
        y1: (b.y + b.height) / registry.viewport.h,
      }
    : null;

const mm = asRegion(registry.minimap);
const prompt = asRegion(registry.onboarding);
const mmOverlap = mm ? intersect(REGION_FIRE, mm) : null;
const promptOverlap = prompt ? intersect(REGION_FIRE, prompt) : null;

const fireBone = countBone(img, REGION_FIRE);
const mmBone = mmOverlap ? countBone(img, mmOverlap) : 0;
const promptBone = promptOverlap ? countBone(img, promptOverlap) : 0;
// The test's own number, and then the same with the prompt subtracted too. The
// prompt rect is subtracted from the ALREADY minimap-excluded count, so a pixel
// inside both squares is not counted twice.
const asTestSeesIt = fireBone - mmBone;
const withoutPrompt = countBone(img, REGION_FIRE, [mmOverlap, promptOverlap].filter(Boolean));

fs.writeFileSync(
  path.join(here, `${label}-corner.png`),
  PNG.sync.write(cropRegion(img, REGION_FIRE, 2)),
);

const out = {
  label,
  viewport: registry.viewport,
  dpr: DPR,
  ticks: TICKS,
  regionFire: REGION_FIRE,
  absentMaxPx: ABSENT_MAX_PX,
  registry: { minimap: registry.minimap, onboarding: registry.onboarding, ids: registry.ids },
  overlapsRegionFire: {
    minimap: mmOverlap,
    onboardingPrompt: promptOverlap,
  },
  boneLitPixels: {
    regionFire: fireBone,
    inMinimapSquare: mmBone,
    inPromptPanel: promptBone,
    asTestSeesIt,
    withPromptAlsoExcluded: withoutPrompt,
  },
  verdict: {
    testAssertion: `${asTestSeesIt} < ${ABSENT_MAX_PX}`,
    testPasses: asTestSeesIt < ABSENT_MAX_PX,
    passesOncePromptExcluded: withoutPrompt < ABSENT_MAX_PX,
  },
};
fs.writeFileSync(path.join(here, `${label}.json`), `${JSON.stringify(out, null, 2)}\n`);

await browser.close();
console.log(JSON.stringify(out.boneLitPixels, null, 2));
console.log(JSON.stringify(out.verdict, null, 2));
console.log(`${label}: wrote ${label}-desktop.png, ${label}-corner.png, ${label}.json`);
