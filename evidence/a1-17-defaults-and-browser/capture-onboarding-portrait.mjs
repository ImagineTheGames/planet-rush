/**
 * evidence/a1-17-defaults-and-browser/capture-onboarding-portrait.mjs — the one
 * case `capture-onboarding.mjs` mis-framed. OWNER: QA Manager (a1-17 §2).
 *
 * On a 390x844 PORTRAIT phone the client applies the landscape lock and draws
 * the whole UI rotated 90 degrees, so the prompt's band is not the bottom of the
 * physical frame — it is the RIGHT-HAND EDGE of it. The general capture cropped
 * the bottom, found the FIRE button's glyphs there, and stopped on them; the
 * frame it kept has no prompt in it. That is a framing bug in the instrument,
 * not a finding about the build, and it is fixed here rather than argued around.
 *
 * Same clean front-door boot, same fresh profile, correct band.
 *
 *   node evidence/a1-17-defaults-and-browser/capture-onboarding-portrait.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const BASE = process.env.A1_17_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(IMAGES, { recursive: true });
const VP = { width: 390, height: 844 };

function zoomCrop(srcPath, rect, factor, dstPath) {
  const src = PNG.sync.read(readFileSync(srcPath));
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.min(Math.ceil(rect.width), src.width - x0));
  const h = Math.max(1, Math.min(Math.ceil(rect.height), src.height - y0));
  const dst = new PNG({ width: w * factor, height: h * factor });
  for (let y = 0; y < h * factor; y += 1) {
    for (let x = 0; x < w * factor; x += 1) {
      const si = (src.width * (y0 + Math.floor(y / factor)) + (x0 + Math.floor(x / factor))) << 2;
      const di = (dst.width * y + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
  writeFileSync(dstPath, PNG.sync.write(dst));
  return { x: x0, y: y0, width: w, height: h, factor };
}
function countLit(path, rect) {
  const png = PNG.sync.read(readFileSync(path));
  let lit = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const i = (png.width * y + x) << 2;
      if (png.data[i] > 150 && png.data[i + 1] > 150 && png.data[i + 2] > 150) lit += 1;
    }
  }
  return lit;
}

/** The logical bottom band, rotated: the LEFT quarter of the physical portrait
 *  frame, which is where the rotated prompt is drawn (see the debug frame). */
const BAND = { x: 0, y: 0, width: Math.round(VP.width * 0.28), height: VP.height };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VP, hasTouch: true, isMobile: false, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.clear());
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
await page.waitForFunction(() => typeof window.__mainMenu?.screen === 'string', undefined, { timeout: 40_000 });

const box = await page.locator('canvas').boundingBox();
const tapKind = async (which, kind) => {
  const at = await page.evaluate(
    ({ which, kind }) => {
      const list = which === 'menu' ? window.__mainMenu?.controls : window.__onlineMenu?.doorControls;
      const c = (list ?? []).find((x) => x.kind === kind);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    { which, kind },
  );
  if (!at) throw new Error(`no ${which} control ${kind}`);
  await page.touchscreen.tap(box.x + at.x, box.y + at.y);
};

await tapKind('menu', 'play');
await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
await tapKind('doors', 'solo');
await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 20_000 });
await sleep(700);
{
  const at = await page.evaluate(() => window.__lobby.rushControl.physicalCenter);
  await page.touchscreen.tap(box.x + at.x, box.y + at.y);
}
await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });

const out = {
  base: BASE,
  capturedAt: new Date().toISOString(),
  viewport: VP,
  band: BAND,
  menuControlScheme: await page.evaluate(() => window.__mainMenu.controlScheme),
  matchControlScheme: await page.evaluate(() => window.__mainMenu.matchControlScheme),
};

const probe = join(IMAGES, '_probe-portrait.png');
await page.screenshot({ path: probe });
const baseline = countLit(probe, BAND);
const targets = [
  { fx: 0.5, fy: 0.25 }, { fx: 0.35, fy: 0.15 }, { fx: 0.7, fy: 0.2 },
  { fx: 0.3, fy: 0.55 }, { fx: 0.75, fy: 0.5 }, { fx: 0.5, fy: 0.8 },
];
let hit = null;
for (let i = 0; i < 30 && !hit; i += 1) {
  const t = targets[i % targets.length];
  await page.touchscreen.tap(box.x + box.width * t.fx, box.y + box.height * t.fy);
  await sleep(1400);
  await page.screenshot({ path: probe });
  const lit = countLit(probe, BAND);
  if (lit > baseline + 200) hit = { lit, baseline, taps: i + 1 };
}
out.baselineLitPixels = baseline;
out.hit = hit;

const shot = join(IMAGES, 'a1-17-prompt-clean-phone390x844-fresh.png');
await page.screenshot({ path: shot });
out.bandZoom = zoomCrop(shot, BAND, 3, join(IMAGES, 'a1-17-prompt-clean-phone390x844-fresh-band.png'));
console.log(`portrait clean boot: scheme=${out.matchControlScheme} lit=${hit?.lit ?? 'none'}/${baseline} after ${hit?.taps ?? 30} taps`);

await ctx.close();
await browser.close();
writeFileSync(join(HERE, 'readback-onboarding-portrait.json'), JSON.stringify(out, null, 2));
console.log('wrote readback-onboarding-portrait.json');
