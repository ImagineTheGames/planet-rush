/**
 * evidence/a0-18-bloom-gone/probe-bloom.mjs — a0-18, the instrument. OWNER: Art Agent.
 *
 * The developer, from live play: *"the bloom orbs are gone, but they are gone
 * completely, they were supposed to be there with subtle bloom on random
 * stars…"*. `BLOOM` (src/art/backdrop.ts) is intact in source, so the question is
 * not what the generator AUTHORS, it is what the running build SUBMITS and what
 * the GPU then paints. This asks the served bundle both questions separately,
 * because they have different answers and only one of them is the bug.
 *
 * ── 1. What the build SUBMITS (the geometry read-back) ───────────────────────
 * `starFieldSprite` pushes, per bloomed star and in this exact order, the outer
 * halo (r×4.3, alpha×0.065), the inner halo (r×2.4, alpha×0.16), then the star's
 * own point (r, alpha) — three fills at ONE centre. An unbloomed star is one fill
 * at its centre. `drawSprite` plays each shape as `circle()` + `fill()`, so on the
 * live `Graphics` every one of those is its own `context.instructions` entry with
 * its own path and its own fill alpha. Grouping the fills of a `void-stars-*`
 * layer by centre therefore recovers the scatter EXACTLY: a group of 3 is a
 * bloomed star, a group of 1 is a plain one, and `bloomed / stars` must land on
 * `BLOOM.scatter` (0.18). Nothing is inferred from a pixel here.
 *
 * ── 2. What the GPU PAINTS (the frame isolation, a1-07's method) ─────────────
 * `?debug=1&freeze=1` pins the sim, so two screenshots differing by exactly one
 * hidden layer differ by that layer's own pixels and nothing else. Per star
 * layer: |A − (A with that layer hidden)| is the layer, isolated. On that
 * isolate we measure the thing the developer is describing — **soft round area**:
 *   · `blobMaxArea` — largest 4-connected component at Δluma ≥ 2. A bloomed near
 *     star is a ~19 px disc (r×4.3 at maxR 2.2); an unbloomed one is a ~4 px dot.
 *     This number is the orb.
 *   · the Δluma histogram, split at 8/255 — halo wash sits low, star cores high.
 * Layer visibility is toggled on the Pixi node, never in the sim: `configure()`
 * rebuilds only on a viewport/bounds/sky change and `update()` writes only
 * `position`, so a hidden layer stays hidden across frames.
 *
 * The stage is reached through Pixi's own devtools hook —
 * `globalThis.__PIXI_APP_INIT__`, called by `pixi.js` 8.6.6 with the live
 * `Application` — set from a Playwright init script before any page script runs.
 * NOTHING in `src/` is touched, so the same file measures the served bundle of any
 * commit: run it against two ports and the pair of JSONs names the culprit.
 *
 *   node evidence/a0-18-bloom-gone/probe-bloom.mjs <port> <label>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = process.argv[2] ?? '4931';
const LABEL = process.argv[3] ?? `port-${PORT}`;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(HERE, 'frames', LABEL);

/** Desktop, dpr 2 — a1-07's viewport, so the two rounds are comparable. */
const VP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

/** Two arenas: the default (sky `none` — the goldens' scene, stars only) and one
 *  with a lit sky, because "bloom survives a bright nebula" is what a0-07 says
 *  subtle was chosen FOR. */
const MAPS = [
  { id: 'octagon', sky: 'none' },
  { id: 'line', sky: 'deepEmber' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Settle by counting frames, not by timing them (the a0-07b lesson). */
const settle = (page, n = 10) =>
  page.evaluate(
    (frames) =>
      new Promise((done) => {
        let i = 0;
        const tick = () => (++i < frames ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
    n,
  );

const initScript = (mapId) => `
  try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(mapId)}); } catch (e) {}
  globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
`;

/** Find the container holding `void-ground` — the backdrop's own root. */
const FIND_VOID = `
  (() => {
    const app = globalThis.__qaApp;
    if (!app || !app.stage) return null;
    let found = null;
    const walk = (node, depth) => {
      if (found || depth > 24) return;
      const kids = node.children || [];
      if (kids.some((c) => c.label === 'void-ground')) { found = node; return; }
      for (const c of kids) walk(c, depth + 1);
    };
    walk(app.stage, 0);
    return found;
  })()
`;

/**
 * The geometry read-back: every fill the live star layers submitted, grouped by
 * centre. Three fills at one centre = a bloomed star (outer halo, inner halo,
 * point); one fill = a plain one.
 */
const READ_STARS = `
  (() => {
    const void_ = ${FIND_VOID};
    if (!void_) return { error: 'no void container on the stage' };
    const layers = [];
    for (const c of void_.children) {
      const label = typeof c.label === 'string' ? c.label : '';
      if (!label.startsWith('void-stars-')) continue;
      const ctx = c.context;
      if (!ctx || !ctx.instructions) { layers.push({ label, error: 'no GraphicsContext instructions' }); continue; }
      const groups = new Map();
      let fills = 0;
      let strokes = 0;
      for (const ins of ctx.instructions) {
        if (ins.action === 'stroke') { strokes++; continue; }
        if (ins.action !== 'fill') continue;
        const path = ins.data && ins.data.path;
        const list = (path && path.instructions) || [];
        const circle = list.find((p) => p.action === 'circle');
        if (!circle) continue;
        fills++;
        const [x, y, r] = circle.data;
        const key = x + ',' + y;
        const g = groups.get(key) || [];
        g.push({ r, alpha: ins.data.style ? ins.data.style.alpha : null });
        groups.set(key, g);
      }
      // Per star: sorted radii, largest first — the authored push order.
      let stars = 0;
      let bloomed = 0;
      let maxHaloR = 0;
      let maxCoreR = 0;
      const haloAlphas = [];
      const sizes = {};
      for (const g of groups.values()) {
        stars++;
        sizes[g.length] = (sizes[g.length] || 0) + 1;
        const radii = g.map((s) => s.r).sort((a, b) => b - a);
        const core = radii[radii.length - 1];
        if (core > maxCoreR) maxCoreR = core;
        if (g.length >= 3) {
          bloomed++;
          if (radii[0] > maxHaloR) maxHaloR = radii[0];
          for (const s of g) if (s.r > core + 1e-9) haloAlphas.push(Math.round(s.alpha * 1e4) / 1e4);
        }
      }
      haloAlphas.sort((a, b) => a - b);
      layers.push({
        label,
        visible: c.visible !== false,
        alpha: c.alpha,
        fills,
        strokes,
        stars,
        bloomed,
        bloomRatio: stars ? Math.round((bloomed / stars) * 1e4) / 1e4 : null,
        groupSizes: sizes,
        maxHaloRadius: Math.round(maxHaloR * 100) / 100,
        maxCoreRadius: Math.round(maxCoreR * 100) / 100,
        haloAlphaMin: haloAlphas[0] ?? null,
        haloAlphaMax: haloAlphas[haloAlphas.length - 1] ?? null,
        haloAlphaDistinct: [...new Set(haloAlphas)].slice(0, 8),
      });
    }
    const pr = globalThis.__planetRush;
    return {
      layers,
      order: void_.children.map((c) => (typeof c.label === 'string' ? c.label : '?')),
      build: pr && pr.build ? pr.build.sha : null,
      // The debug handle's shape has moved between rounds, so read it defensively
      // and RECORD what was there — a null here is a fact about the handle, not
      // about the void.
      prKeys: pr ? Object.keys(pr) : null,
      frozen: pr && typeof pr.frozen === 'function' ? !!pr.frozen() : (pr ? pr.frozen ?? null : null),
      viewport: pr && pr.viewport ? { w: pr.viewport.w, h: pr.viewport.h } : null,
      reduceVfx: pr && typeof pr.reduceVfx === 'function' ? pr.reduceVfx() : (pr ? pr.reduceVfx ?? null : null),
    };
  })()
`;

/** Hide/show the void layers whose label starts with `prefix` ('*' = all but ground). */
const setVisible = (page, prefix, visible) =>
  page.evaluate(`
    (() => {
      const prefix = ${JSON.stringify(prefix)};
      const visible = ${JSON.stringify(visible)};
      const void_ = ${FIND_VOID};
      if (!void_) return { touched: [], error: 'no void container' };
      const touched = [];
      for (const c of void_.children) {
        const l = typeof c.label === 'string' ? c.label : '';
        const hit = prefix === '*' ? l.startsWith('void-') && l !== 'void-ground' : l.startsWith(prefix);
        if (hit) { c.visible = visible; touched.push(l); }
      }
      return { touched };
    })()
  `);

// --- image maths -------------------------------------------------------------

const readPng = (p) => PNG.sync.read(readFileSync(p));

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * |A − B| as a luma delta field, plus the measurements that answer the brief:
 * how much of the frame the layer touches, how bright its brightest pixel is,
 * and — the orb — the largest connected run of soft pixels.
 */
function isolate(aPath, bPath, outPath, amplify = 14) {
  const A = readPng(aPath);
  const B = readPng(bPath);
  if (A.width !== B.width || A.height !== B.height) throw new Error('frame size mismatch');
  const n = A.width * A.height;
  const delta = new Float32Array(n);
  let touched = 0;
  let peak = 0;
  let ink = 0;
  let low = 0; // halo wash: 2 ≤ Δ < 8
  let high = 0; // star cores: Δ ≥ 8
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.abs(luma(A.data[o], A.data[o + 1], A.data[o + 2]) - luma(B.data[o], B.data[o + 1], B.data[o + 2]));
    delta[i] = d;
    if (d > 0) touched++;
    if (d > peak) peak = d;
    ink += d;
    if (d >= 2 && d < 8) low++;
    else if (d >= 8) high++;
  }

  // Largest 4-connected component at Δ ≥ 2, and the component-size histogram.
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let blobMaxArea = 0;
  let blobs = 0;
  let blobsOver100 = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i] || delta[i] < 2) continue;
    let top = 0;
    stack[top++] = i;
    seen[i] = 1;
    let area = 0;
    while (top > 0) {
      const p = stack[--top];
      area++;
      const x = p % A.width;
      const y = (p - x) / A.width;
      const push = (q) => {
        if (q >= 0 && q < n && !seen[q] && delta[q] >= 2) {
          seen[q] = 1;
          stack[top++] = q;
        }
      };
      if (x > 0) push(p - 1);
      if (x < A.width - 1) push(p + 1);
      if (y > 0) push(p - A.width);
      if (y < A.height - 1) push(p + A.width);
    }
    blobs++;
    if (area > blobMaxArea) blobMaxArea = area;
    if (area >= 100) blobsOver100++;
  }

  // The amplified plate — this is what gets looked at with human eyes.
  const out = new PNG({ width: A.width, height: A.height });
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const v = Math.min(255, Math.round(delta[i] * amplify));
    out.data[o] = v;
    out.data[o + 1] = v;
    out.data[o + 2] = v;
    out.data[o + 3] = 255;
  }
  writeFileSync(outPath, PNG.sync.write(out));

  return {
    plate: outPath.split('/').pop(),
    amplify,
    pixels: n,
    touchedPct: Math.round((touched / n) * 1e4) / 100,
    peakDelta: Math.round(peak * 10) / 10,
    meanInk: Math.round((ink / n) * 1e4) / 1e4,
    softPixels: low,
    corePixels: high,
    softToCore: high ? Math.round((low / high) * 100) / 100 : null,
    blobs,
    blobMaxArea,
    blobsOver100,
  };
}

// --- the run ----------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const served = await (await fetch(`${BASE}/version.json`)).json();
console.log(`\n=== ${LABEL}  ${BASE}  served sha ${served.sha} ===\n`);

const browser = await chromium.launch();
const report = { label: LABEL, base: BASE, served, viewport: VP, maps: [] };

for (const m of MAPS) {
  const row = { ...m, frames: {}, isolates: {} };
  const ctx = await browser.newContext(VP);
  await ctx.addInitScript(initScript(m.id));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [page error]', e.message));
  await page.goto(`${BASE}/?debug=1&freeze=1`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__planetRush?.shipWorld, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready);
  await sleep(1200);
  await settle(page, 20);

  row.readback = await page.evaluate(READ_STARS);
  console.log(`── ${m.id} (sky ${m.sky})  build=${row.readback.build}  frozen=${row.readback.frozen}`);
  console.log(`   layers: ${row.readback.order.join(' > ')}`);
  for (const l of row.readback.layers ?? []) {
    console.log(
      `   ${l.label.padEnd(18)} stars=${String(l.stars).padStart(5)} bloomed=${String(l.bloomed).padStart(4)}` +
        ` ratio=${l.bloomRatio}  groupSizes=${JSON.stringify(l.groupSizes)}` +
        `  haloR<=${l.maxHaloRadius}  haloAlpha=${l.haloAlphaMin}..${l.haloAlphaMax}`,
    );
  }

  const shot = async (tag) => {
    await settle(page, 6);
    const f = join(OUT, `${m.id}-${tag}.png`);
    await page.screenshot({ path: f });
    row.frames[tag] = `${m.id}-${tag}.png`;
    return f;
  };

  const A = await shot('A-frozen');
  for (const l of row.readback.layers ?? []) {
    const key = l.label.replace('void-stars-', '');
    await setVisible(page, l.label, false);
    const B = await shot(`no-${key}`);
    await setVisible(page, l.label, true);
    row.isolates[key] = isolate(A, B, join(OUT, `${m.id}-iso-${key}.png`));
    const r = row.isolates[key];
    console.log(
      `   iso ${key.padEnd(6)} touched=${String(r.touchedPct).padStart(5)}%  peakΔ=${String(r.peakDelta).padStart(5)}` +
        `  soft=${String(r.softPixels).padStart(6)} core=${String(r.corePixels).padStart(6)}` +
        `  blobs=${String(r.blobs).padStart(5)} maxBlob=${String(r.blobMaxArea).padStart(5)} ≥100px=${r.blobsOver100}`,
    );
  }

  // All stars at once, and the ground-only control.
  await setVisible(page, 'void-stars-', false);
  const noStars = await shot('no-stars');
  await setVisible(page, 'void-stars-', true);
  row.isolates.allStars = isolate(A, noStars, join(OUT, `${m.id}-iso-allStars.png`));
  console.log(
    `   iso ${'ALL'.padEnd(6)} touched=${String(row.isolates.allStars.touchedPct).padStart(5)}%` +
      `  peakΔ=${row.isolates.allStars.peakDelta}  maxBlob=${row.isolates.allStars.blobMaxArea}` +
      `  ≥100px=${row.isolates.allStars.blobsOver100}`,
  );

  // The null control (a1-07): re-shoot A with nothing changed. Must be zero, or
  // every number above has an unstated noise floor.
  const A2 = await shot('A-frozen-again');
  row.nullControl = isolate(A, A2, join(OUT, `${m.id}-iso-null.png`));
  console.log(
    `   NULL   touched=${row.nullControl.touchedPct}%  peakΔ=${row.nullControl.peakDelta}` +
      `  ${row.nullControl.peakDelta === 0 ? '(calibrated zero)' : '*** NOISE FLOOR ***'}\n`,
  );

  await ctx.close();
  report.maps.push(row);
}

await browser.close();
const jsonPath = join(HERE, `readback-${LABEL}.json`);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${jsonPath}\nframes in ${OUT}`);
