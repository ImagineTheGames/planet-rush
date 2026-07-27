/**
 * evidence/capture-minimap-corner.mjs — v0.2.2 evidence: "the minimap sits collapsed
 * in the bottom-right corner, clear of the FIRE button", on BOTH phone profiles.
 * OWNER: QA Manager. The minimap corner square and the FIRE thumb button both live
 * in the bottom-right of a touch layout; the field rule is that the map tucks beside
 * the FIRE button, not under it. This reads the two rects the layout ACTUALLY drew
 * this frame off __planetRush.layout (the id 'minimap' and 'touch-fire-button'
 * entries) + the minimap's own debug capture (__minimapStage.state()), LOOKS at the
 * corner in the PNG, and reports both rects + their gap so the caption can carry the
 * layout-registry geometry.
 *
 * Profiles (playwright.config.ts): iPhone-ish (390×844 dpr3) and Pixel-ish
 * (412×915 dpr2.6), each rotated into its landscape presentation (844×390 / 915×412)
 * — the same already-landscape convention the round-7 map captures used. Default
 * (sticks) control scheme, so the FIRE button draws. ?debug=1, no forcing: the
 * layout lays itself out; this only reads it back.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4191 node evidence/capture-minimap-corner.mjs
 * Launch under the sandboxed-Chromium LD_LIBRARY_PATH (see the QA memory).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = '/tmp/capminimap';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const PROFILES = [
  { key: 'iphone', label: 'iPhone-ish 844x390 dpr3', vw: 844, vh: 390, dpr: 3 },
  { key: 'pixel', label: 'Pixel-ish 915x412 dpr2.6', vw: 915, vh: 412, dpr: 2.6 },
];

function cropSave(src, out, x, y, w, h) {
  const p = PNG.sync.read(readFileSync(src));
  x = Math.max(0, Math.min(Math.round(x), p.width - 1));
  y = Math.max(0, Math.min(Math.round(y), p.height - 1));
  w = Math.round(Math.min(w, p.width - x)); // round: a fractional PNG width tears the buffer
  h = Math.round(Math.min(h, p.height - y));
  const o = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const si = ((y + j) * p.width + (x + i)) * 4, di = (j * w + i) * 4;
    o.data[di] = p.data[si]; o.data[di + 1] = p.data[si + 1]; o.data[di + 2] = p.data[si + 2]; o.data[di + 3] = 255;
  }
  writeFileSync(out, PNG.sync.write(o));
}

const browser = await chromium.launch();
const results = [];
for (const prof of PROFILES) {
  const ctx = await browser.newContext({ viewport: { width: prof.vw, height: prof.vh }, deviceScaleFactor: prof.dpr, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 25000 });
  await page.waitForFunction(() => Array.isArray(window.__planetRush.layout) && window.__planetRush.layout.length > 0, undefined, { timeout: 20000 });
  await page.waitForFunction(() => typeof window.__minimapStage?.state === 'function', undefined, { timeout: 20000 });
  await page.waitForTimeout(900);

  const info = await page.evaluate(() => {
    const lay = window.__planetRush.layout.map((e) => ({ id: e.id, rect: e.bounds || e.rect }));
    const mm = window.__minimapStage.state();
    const by = (id) => lay.find((e) => e.id === id)?.rect ?? null;
    return { mm, minimap: by('minimap'), fire: by('touch-fire-button'), scheme: window.__tapCommanderStage?.readout?.().scheme, sha: window.__planetRush.build.sha, vp: window.__planetRush.viewport };
  });
  await page.screenshot({ path: join(TMP, `${prof.key}-full.png`) });

  // Gap between the minimap's right edge and the FIRE button's left edge (logical px).
  const mm = info.minimap, fire = info.fire;
  const gapX = mm && fire ? +(fire.x - (mm.x + mm.width)).toFixed(1) : null;
  const overlap = mm && fire ? !(fire.x >= mm.x + mm.width || fire.x + fire.width <= mm.x || fire.y >= mm.y + mm.height || fire.y + fire.height <= mm.y) : null;

  // Crop the bottom-right corner spanning both rects (logical -> physical via dpr).
  const d = prof.dpr;
  const xs = [mm?.x, fire?.x].filter((v) => v != null);
  const ys = [mm?.y, fire?.y].filter((v) => v != null);
  const xe = [mm ? mm.x + mm.width : null, fire ? fire.x + fire.width : null].filter((v) => v != null);
  const ye = [mm ? mm.y + mm.height : null, fire ? fire.y + fire.height : null].filter((v) => v != null);
  const cx = (Math.min(...xs) - 24) * d, cy = (Math.min(...ys) - 24) * d;
  const cw = (Math.max(...xe) - Math.min(...xs) + 48) * d, ch = (Math.max(...ye) - Math.min(...ys) + 48) * d;
  cropSave(join(TMP, `${prof.key}-full.png`), join(OUT, `minimap-corner-${prof.key}.png`), cx, cy, cw, ch);
  writeFileSync(join(OUT, `minimap-corner-${prof.key}-full.png`), readFileSync(join(TMP, `${prof.key}-full.png`)));

  const r = { profile: prof.label, sha: info.sha, scheme: info.scheme, minimap: mm, fire, minimapState: info.mm, gapX, overlap, errs: errs.slice(0, 4) };
  results.push(r);
  console.log(`[${prof.key}] minimap=${JSON.stringify(mm)} fire=${JSON.stringify(fire)} gapX=${gapX} overlap=${overlap} scheme=${info.scheme} errs=${errs.length}`);
  await ctx.close();
}
writeFileSync(join(TMP, 'summary.json'), JSON.stringify(results, null, 2));
await browser.close();
