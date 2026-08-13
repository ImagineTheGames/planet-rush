/**
 * evidence/a1-17-defaults-and-browser/capture-labels.mjs — DO THE WORDS FIT?
 * OWNER: QA Manager (a1-17 §5; a0-32 / #403).
 *
 * The developer's report was a phone capture: *"have words clipping past menus
 * upgrade ship and build and upgrade…"*. Two labels, one phone, at 390 px
 * landscape:
 *
 *   · `BUILD & UPGRADE` — the round HUD button. Its second line, `& UPGRADE`,
 *     was wider than the circle and broke the silhouette on BOTH sides.
 *   · `UPGRADE SHIP` — the wheel wedge at nine o'clock. Wheel labels are not
 *     rotated with the wheel, so on that wedge a line runs along the RADIUS and
 *     the rim is what stops it. `UPGRADE` ran past it.
 *
 * AND THE SELECTED STATE, which is the half that could still be broken: a
 * selected wedge's name goes UP a size step (u16-01), so a fix measured on the
 * resting label proves nothing about the state the player puts it in by pointing
 * at it. The wheel's selection is driven here by a REAL POINTER MOVE, and which
 * wedge it landed on is read back from the view's own record of what it drew
 * (`selected`), never assumed from the coordinate.
 *
 * Rects come from the client, not from me: the BUILD button's box is the
 * layout-registry entry `build-button` the client publishes, and the wheel's
 * wedge is found by sweeping the pointer round the hub and asking the view which
 * wedge it selected. Every crop is 4x NEAREST-NEIGHBOUR — no interpolation, so
 * a glyph cannot be smoothed off a rim it was actually crossing.
 *
 * ONE DISCLOSED STAGING SEAM: `__upgradeWheelStage.openBuild()` parks the local
 * ship docked at its own station and opens the wheel. The button and the wheel
 * only exist while docked, and flying there is not what is under test. It moves
 * the same state a real dock does; every label read afterwards is what the view
 * drew.
 *
 *   node evidence/a1-17-defaults-and-browser/capture-labels.mjs
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

const browser = await chromium.launch();
const out = { base: BASE, capturedAt: new Date().toISOString(), viewport: { width: 844, height: 390 }, runs: {} };

const ctx = await browser.newContext({ viewport: out.viewport, hasTouch: true, isMobile: false, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.clear());
await page.goto(`${BASE}?debug=1`, { waitUntil: 'load' });
await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
await page.waitForFunction(() => typeof window.__pressStage?.wedges === 'function', undefined, { timeout: 40_000 });
await sleep(2500);

out.buildSha = await page.evaluate(() => window.__planetRush?.build?.sha ?? null);
out.scheme = await page.evaluate(() => window.__onboardingStage?.scheme?.() ?? null);

// Stage the dock and open the wheel (disclosed above).
out.openBuild = await page.evaluate(() => window.__upgradeWheelStage.openBuild());
await sleep(1200);

// --- the BUILD & UPGRADE button, at the rect the CLIENT publishes -----------
const layout = await page.evaluate(() => (window.__planetRush?.layout ?? []).map((e) => ({ id: e.id, bounds: { ...e.bounds } })));
out.layout = layout;
const btn = layout.find((e) => e.id === 'build-button');
if (!btn) throw new Error('the client published no build-button layout entry');
out.buildButtonBounds = btn.bounds;

const full = join(IMAGES, 'a1-17-labels-390-wheel-open.png');
await page.screenshot({ path: full });
out.fullImage = 'images/a1-17-labels-390-wheel-open.png';
// Pad generously: the whole point is to see whether anything crosses the rim,
// so the crop has to include the space OUTSIDE the circle.
const pad = 16;
out.buildButtonZoom = zoomCrop(
  full,
  { x: btn.bounds.x - pad, y: btn.bounds.y - pad, width: btn.bounds.width + pad * 2, height: btn.bounds.height + pad * 2 },
  4,
  join(IMAGES, 'a1-17-labels-390-build-button.png'),
);

// --- the wedges, as DRAWN ---------------------------------------------------
const restingWedges = await page.evaluate(() => window.__pressStage.wedges().map((w) => ({ id: w.id, label: w.label, sub: w.sub, selected: w.selected, costLabel: w.costLabel })));
out.restingWedges = restingWedges;
console.log('wedges drawn:', restingWedges.map((w) => `${w.label}${w.selected ? ' [SELECTED]' : ''}`).join(' | '));

/** Sweep the pointer round the hub until the VIEW says UPGRADE SHIP is the
 *  selected wedge. The coordinate is never trusted — the readback is. */
const box = await page.locator('canvas').boundingBox();
const hub = { x: box.x + out.viewport.width / 2, y: box.y + out.viewport.height / 2 };
let selectedAt = null;
const sweep = [];
outer: for (const radius of [70, 90, 110, 130]) {
  for (let deg = 0; deg < 360; deg += 6) {
    const a = (deg * Math.PI) / 180;
    const p = { x: hub.x + Math.cos(a) * radius, y: hub.y + Math.sin(a) * radius };
    await page.mouse.move(p.x, p.y);
    await sleep(45);
    const sel = await page.evaluate(() => (window.__pressStage.wedges().find((w) => w.selected) ?? null));
    if (sel) sweep.push({ radius, deg, id: sel.id, label: sel.label });
    if (sel && /upgrade/i.test(sel.id + ' ' + sel.label)) {
      selectedAt = { ...p, radius, deg, id: sel.id, label: sel.label };
      break outer;
    }
  }
}
out.selectionSweepHits = sweep.length;
out.upgradeShipSelectedAt = selectedAt;

if (selectedAt) {
  await sleep(400);
  out.selectedWedges = await page.evaluate(() => window.__pressStage.wedges().map((w) => ({ id: w.id, label: w.label, selected: w.selected })));
  const selShot = join(IMAGES, 'a1-17-labels-390-wedge-selected.png');
  await page.screenshot({ path: selShot });
  out.selectedImage = 'images/a1-17-labels-390-wedge-selected.png';
  // The left half of the wheel, so the nine-o'clock wedge and the rim it has to
  // stay inside are both in frame, in BOTH states.
  const wedgeRect = { x: out.viewport.width / 2 - 165, y: out.viewport.height / 2 - 80, width: 165, height: 160 };
  out.wedgeRect = wedgeRect;
  out.wedgeSelectedZoom = zoomCrop(selShot, wedgeRect, 4, join(IMAGES, 'a1-17-labels-390-wedge-selected-zoom.png'));
  out.wedgeRestingZoom = zoomCrop(full, wedgeRect, 4, join(IMAGES, 'a1-17-labels-390-wedge-resting-zoom.png'));
  console.log(`UPGRADE SHIP selected at r=${selectedAt.radius} deg=${selectedAt.deg} (id=${selectedAt.id})`);
} else {
  console.log('the pointer sweep never selected an UPGRADE wedge');
}

await ctx.close();
await browser.close();
writeFileSync(join(HERE, 'readback-labels.json'), JSON.stringify(out, null, 2));
console.log('wrote readback-labels.json');
