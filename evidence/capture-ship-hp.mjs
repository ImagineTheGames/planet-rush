/**
 * evidence/capture-ship-hp.mjs — p8 evidence: "ships show their HP as a number".
 * OWNER: QA Manager. The over-ship health bar now carries a compact current/max
 * numeral (field request v0.2.4, src/ui/healthbar-view.ts) — the same "68/70"
 * treatment the planet core got — for BOTH the local player's own ship and every
 * enemy. This proves it on a REAL boot: the drawn numbers are read straight off the
 * layer's own debug capture (hud.debugHealthBars → __healthbarStage.bars(), whose
 * `hpText` IS the string the Text object rasterised this frame) and then LOOKED at
 * in the PNG, so the pixels and the readback are the same source.
 *
 * Staging: ?debug=1&freeze=1 holds a static frame; __healthbarStage.damageLocal(f)
 * sets the OWN ship's hull to a fraction of max and damageEnemy(f) parks a live
 * enemy a short hop away and sets ITS hull — both below full, so both must draw a
 * bar (+ number). Nothing about the numerals themselves is staged; the sim hull is
 * the only input, the HUD renders the readout. Both are damaged (a fight pose), the
 * two numbers legible side by side.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4191 node evidence/capture-ship-hp.mjs
 * Launch under the sandboxed-Chromium LD_LIBRARY_PATH (see the QA memory).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = '/tmp/capshiphp';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';
const VW = 1280, VH = 800;
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

function cropSave(src, out, x, y, w, h) {
  const p = PNG.sync.read(readFileSync(src));
  x = Math.max(0, Math.min(Math.round(x), p.width - w));
  y = Math.max(0, Math.min(Math.round(y), p.height - h));
  const o = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const si = ((y + j) * p.width + (x + i)) * 4, di = (j * w + i) * 4;
    o.data[di] = p.data[si]; o.data[di + 1] = p.data[si + 1]; o.data[di + 2] = p.data[si + 2]; o.data[di + 3] = 255;
  }
  writeFileSync(out, PNG.sync.write(o));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(BASE + '/?debug=1&freeze=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 25000 });
await page.waitForFunction(() => typeof window.__healthbarStage?.damageLocal === 'function', undefined, { timeout: 20000 });
await page.waitForTimeout(700);

// Own ship 45/50 (0.9), enemy 68/70 (0.97) — both clearly damaged, both legible.
const dl = await page.evaluate(() => window.__healthbarStage.damageLocal(0.9));
const de = await page.evaluate(() => window.__healthbarStage.damageEnemy(0.97));
await page.waitForTimeout(500);
const bars = await page.evaluate(() => window.__healthbarStage.bars());
const hullReadout = await page.evaluate(() => window.__healthbarStage.hullReadout());
const sha = await page.evaluate(() => window.__planetRush.build.sha);

const local = bars.find((b) => b.local);
const enemy = bars.find((b) => !b.local);
await page.screenshot({ path: join(TMP, 'full.png') });

// Crop a box spanning both ships (local at ~640, enemy to its right) with the bars
// and numerals floated just above each ship.
const x0 = Math.min(local?.x ?? 640, enemy?.x ?? 760) - 120;
const y0 = Math.min(local?.y ?? 373, enemy?.y ?? 375) - 90;
cropSave(join(TMP, 'full.png'), join(OUT, 'ship-hp-numbers.png'), x0, y0, 420, 240);
writeFileSync(join(OUT, 'ship-hp-numbers-full.png'), readFileSync(join(TMP, 'full.png')));

const summary = { sha, dl, de, hullReadout, bars, errs: errs.slice(0, 5) };
writeFileSync(join(TMP, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('SUMMARY', JSON.stringify(summary, null, 2));
console.log('local hpText:', local?.hpText, ' enemy hpText:', enemy?.hpText, ' errs:', errs.length);
await browser.close();
