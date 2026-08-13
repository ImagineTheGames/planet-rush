/**
 * evidence/a0-36-name-the-blobs/motion.mjs — a0-36, the drift meter.
 * OWNER: QA Manager.
 *
 * The developer's second claim: the discs "seem to move when i move the camera",
 * and the ones with stars **separate from their star** as the camera pans.
 *
 * This measures it. For each layer, twice, by two independent routes:
 *
 *  1. **Read.** The camera offset is the world container's own screen position,
 *     and every backdrop layer's position is written from it each frame. Sampling
 *     both across a real flight gives drift-per-camera-pixel by least squares —
 *     the running build's number, not `SKY_PARALLAX`'s.
 *
 *  2. **Measure.** The same flight is flown again with EVERY layer hidden but
 *     one, and the two end frames are cross-correlated. That returns how far the
 *     layer's PIXELS actually went, which is the thing the player sees. It needs
 *     no faith in (1) at all, and it catches anything that moves a layer without
 *     going through `position`.
 *
 * Route 2 is why the flight is repeated per layer rather than shot once: with one
 * layer visible, the cross-correlation has nothing else's motion in it. The flight
 * is not required to be identical between passes — the camera offset is recorded
 * for each pass, and drift is normalised to **one screen-width panned**, which is
 * the unit the developer experiences.
 *
 * Read-only round: visibility and input only, via the `__PIXI_APP_INIT__`
 * devtools hook (a1-07's provenance). Nothing in `src/` is touched.
 *
 *   node evidence/a0-36-name-the-blobs/motion.mjs [port] [map] [view]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'frames');
const PORT = process.argv[2] ?? '4336';
const MAP = process.argv[3] ?? 'oval';
const VIEWKEY = process.argv[4] ?? 'desktop';
const BASE = `http://127.0.0.1:${PORT}`;

const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
};
const VIEW = VIEWS[VIEWKEY];

const settle = (page, n = 10) =>
  page.evaluate(
    (f) =>
      new Promise((done) => {
        let i = 0;
        const t = () => (++i < f ? requestAnimationFrame(t) : done());
        requestAnimationFrame(t);
      }),
    n,
  );

const init = (mapId) => `
  try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(mapId)}); } catch (e) {}
  globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
`;

/** Cache game-root, the world container (the one holding `boundary`), the void
 *  container and the vfx container on the page. */
const BIND = () => {
  const app = globalThis.__qaApp;
  let root = null;
  const find = (n, d) => {
    if (root || d > 8) return;
    if (n.label === 'game-root') { root = n; return; }
    for (const c of n.children || []) find(c, d + 1);
  };
  find(app.stage, 0);
  const world = root.children.find((c) => (c.children || []).some((k) => k.label === 'boundary'));
  const void_ = root.children.find((c) => c.label === 'void-backdrop');
  const vfx = root.children.find((c) => c.label === 'vfx');
  globalThis.__qa = { app, root, world, void: void_, vfx };
  return {
    voidLayers: void_.children.map((c) => c.label),
    worldLayers: world.children.map((c) => c.label),
    vfxLayers: (vfx?.children || []).map((c) => c.label),
  };
};

/** One sample: the camera offset and every backdrop layer's position. */
const SAMPLE = () => {
  const { world, void: v, vfx } = globalThis.__qa;
  const pos = (n) => ({ x: n.position.x, y: n.position.y });
  const out = { camera: pos(world), vfx: vfx ? pos(vfx) : null, layers: {} };
  for (const c of v.children) out.layers[c.label] = pos(c);
  return out;
};

/** Show exactly the named labels under game-root's three containers; hide the
 *  rest of the stage (HUD, badge, touch). `void-ground` is always kept: it is
 *  the opaque Floor everything composites over, and it does not move (parallax
 *  0), so it cannot contribute drift. */
const SOLO = (labels) => {
  const { app, root, world, void: v, vfx } = globalThis.__qa;
  const want = new Set(labels);
  // The UI is taken out with **alpha, not visibility**, and that is load-bearing
  // rather than fussy. The shipped scheme is Tap Commander: the flight in this
  // file is driven by clicking, and the click lands on a hit area that lives in
  // the UI layer. `visible = false` prunes a Pixi subtree from hit-testing too,
  // so the first version of this pass hid the HUD, clicked, and measured a
  // camera pan of ZERO on five of seven classes — the harness had disabled the
  // input it was about to use. `alpha = 0` draws nothing and still hit-tests.
  for (const c of root.children) c.alpha = c === world || c === v || c === vfx ? 1 : 0;
  for (const c of app.stage.children) if (c.label === 'badge-root') c.alpha = 0;
  for (const c of v.children) c.visible = c.label === 'void-ground' || want.has(c.label);
  for (const c of world.children) c.visible = want.has(c.label);
  for (const c of vfx?.children || []) c.visible = want.has(c.label);
  return true;
};

/** Put every layer back on. The flight is flown with the scene NORMAL — see
 *  `fly` and the note at the solo pass for why that is not optional. */
const UNSOLO = () => {
  const { app, root, world, void: v, vfx } = globalThis.__qa;
  for (const c of root.children) { c.alpha = 1; c.visible = true; }
  for (const c of app.stage.children) c.alpha = 1;
  for (const c of v.children) c.visible = true;
  for (const c of world.children) c.visible = true;
  for (const c of vfx?.children || []) c.visible = true;
  return true;
};

/**
 * Fly, **in the scheme the game actually ships in**. The ratified default is
 * Tap Commander (`main.ts` §3, a0-33): the pilot replaces the sticks and the
 * ship flies to where the player clicks. WASD belongs to the `sticks` scheme,
 * which a default install is not in — a first pass held `KeyD` for six seconds
 * and the ship did not move a world unit, which is the build behaving correctly
 * and the harness asking the wrong way.
 *
 * So: click the left edge, repeatedly, and sample the camera at each click. The
 * pan achieved is READ, never assumed — the caller normalises by it.
 */
async function fly(page, clicks) {
  const samples = [await page.evaluate(SAMPLE)];
  const { width, height } = VIEW.viewport;
  for (let i = 0; i < clicks; i++) {
    await page.mouse.click(60, Math.round(height / 2));
    await settle(page, 100);
    samples.push(await page.evaluate(SAMPLE));
  }
  return samples;
}

/** Least-squares slope of `ys` against `xs`, through the data (not the origin). */
function slope(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : +(num / den).toFixed(4);
}

/**
 * Horizontal shift, in device px, that best aligns `b` to `a` — normalised
 * cross-correlation over integer lags, on luma, over a band that excludes the
 * frame edges (where content enters and leaves).
 */
function bestShiftX(a, b, maxLag) {
  const { width: w, height: h } = a;
  const y0 = Math.round(h * 0.12),
    y1 = Math.round(h * 0.88);
  const x0 = maxLag + 2,
    x1 = w - maxLag - 2;
  if (x1 <= x0) return { lag: null, r: null, note: 'lag window wider than the frame' };
  const luma = (p, x, y) => {
    const i = (y * w + x) * 4;
    return 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
  };
  /** Pearson r between A and B-shifted-by-lag, sampled on a `step` lattice. */
  const score = (lag, step) => {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const va = luma(a, x, y);
        const vb = luma(b, x + lag, y);
        sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n++;
      }
    }
    const cov = sab / n - (sa / n) * (sb / n);
    const va = saa / n - (sa / n) ** 2;
    const vb = sbb / n - (sb / n) ** 2;
    return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
  };
  // Coarse then fine. A star layer at parallax 0.5 shifts most of a screen, so
  // the lag range is large and an every-lag/every-pixel search would take longer
  // than the flight did; the coarse pass is on an 8-px lattice at 8-px lag steps
  // and the fine pass refines ±10 at full resolution.
  let best = 0, bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag += 8) {
    const r = score(lag, 8);
    if (r > bestScore) { bestScore = r; best = lag; }
  }
  let fine = best, fineScore = -Infinity;
  for (let lag = best - 10; lag <= best + 10; lag++) {
    if (Math.abs(lag) > maxLag) continue;
    const r = score(lag, 2);
    if (r > fineScore) { fineScore = r; fine = lag; }
  }
  return { lag: fine, r: +fineScore.toFixed(4) };
}

// ---------------------------------------------------------------------------

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

async function boot() {
  const ctx = await browser.newContext(VIEW);
  await ctx.addInitScript(init(MAP));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__qaApp?.stage?.children?.length > 0, null, { timeout: 30000 });
  await settle(page, 60);
  const bound = await page.evaluate(BIND);
  return { ctx, page, bound };
}

// --- Pass 1: read the transforms across one real flight ----------------------
const p1 = await boot();
const samples = await fly(p1.page, 8);
const camX = samples.map((s) => s.camera.x);
const panPx = Math.abs(camX[camX.length - 1] - camX[0]);
const layerNames = Object.keys(samples[0].layers);
const readSlopes = {};
for (const name of layerNames) {
  readSlopes[name] = slope(camX, samples.map((s) => s.layers[name].x));
}
readSlopes['(world container)'] = slope(camX, samples.map((s) => s.camera.x));
readSlopes['(vfx container)'] = samples[0].vfx ? slope(camX, samples.map((s) => s.vfx.x)) : null;
const bound = p1.bound;
await p1.ctx.close();

console.log(`\n=== ${MAP} / ${VIEWKEY} — pass 1, transforms read live ===`);
console.log(`camera panned ${panPx.toFixed(0)} device px over ${samples.length} samples`);
for (const [k, v] of Object.entries(readSlopes)) console.log(`  ${k.padEnd(26)} drift/camera px = ${v}`);

// --- Pass 2: fly again per layer, cross-correlate the pixels ------------------
const SOLOS = [
  { key: 'stars-deep', labels: ['void-stars-deep'] },
  { key: 'stars-mid', labels: ['void-stars-mid'] },
  { key: 'stars-near', labels: ['void-stars-near'] },
  { key: 'nebula', labels: [bound.voidLayers.find((l) => l.startsWith('void-nebula-'))].filter(Boolean) },
  { key: 'world-rocks', labels: ['asteroids', 'chunks', 'boundary'] },
  { key: 'vfx-light', labels: ['vfx-light'] },
  { key: 'vfx-matter', labels: ['vfx-matter'] },
].filter((s) => s.labels.length);

const measured = [];
for (const solo of SOLOS) {
  const p = await boot();
  // Solo ONLY around each screenshot, and fly with the scene NORMAL. Taking the
  // UI out — by `visible` or by `alpha` — stops the click that Tap Commander
  // flies on from landing, and the pass then measures a camera pan of zero on
  // most classes. The isolation is only needed while the shutter is open, so it
  // is only applied then; the two frames still differ by exactly the flight.
  await p.page.evaluate(SOLO, solo.labels);
  await settle(p.page, 8);
  const before = await p.page.evaluate(SAMPLE);
  const aPath = join(OUT, `motion-${MAP}-${VIEWKEY}-${solo.key}-A.png`);
  await p.page.screenshot({ path: aPath });
  await p.page.evaluate(UNSOLO);
  await settle(p.page, 4);
  await fly(p.page, 2);
  await p.page.evaluate(SOLO, solo.labels);
  await settle(p.page, 8);
  const after = await p.page.evaluate(SAMPLE);
  const bPath = join(OUT, `motion-${MAP}-${VIEWKEY}-${solo.key}-B.png`);
  await p.page.screenshot({ path: bPath });
  await p.ctx.close();

  const cam = after.camera.x - before.camera.x;
  const A = PNG.sync.read(readFileSync(aPath));
  const B = PNG.sync.read(readFileSync(bPath));
  // The lag window has to be able to hold the drift the camera pan implies, or
  // the correlation finds its best match at the edge of the search and reports a
  // number the search chose rather than one the pixels did. A layer at parallax
  // 1 would move the whole camera pan, so that — plus a fifth for slack — is the
  // window, capped at 45% of the frame so a correlation band still exists.
  // The window must hold the drift a parallax-1 layer would show — the whole
  // camera pan — or the correlation rails at the edge of its own search and
  // returns a number the search chose rather than one the pixels did. That is
  // also why the solo flight is SHORT (2 taps): a long pan puts a parallax-0.5
  // star layer past 45% of the frame, and past that there is no band left to
  // correlate over.
  const need = Math.round(Math.abs(cam) * VIEW.deviceScaleFactor * 1.15) + 24;
  const maxLag = Math.min(Math.round(A.width * 0.45), need);
  const railed = need > maxLag;
  const xc = bestShiftX(A, B, maxLag);
  const screenW = VIEW.viewport.width * VIEW.deviceScaleFactor;
  measured.push({
    key: solo.key,
    labels: solo.labels,
    cameraPanDevicePx: +cam.toFixed(1),
    cameraPanScreenWidths: +(cam / screenW).toFixed(3),
    xcorrLagDevicePx: xc.lag,
    xcorrR: xc.r,
    /** True when the search window could not hold a parallax-1 drift, so the
     *  lag below is a floor rather than a measurement. Never silently dropped. */
    lagWindowRailed: railed,
    maxLagDevicePx: maxLag,
    /** The number the developer feels: device px this class moves when the
     *  camera pans one whole screen-width. */
    driftPerScreenWidth: cam === 0 ? null : +((xc.lag / cam) * screenW).toFixed(1),
    ratioMeasured: cam === 0 ? null : +(xc.lag / cam).toFixed(4),
    frames: [aPath, bPath].map((f) => f.split('/').pop()),
  });
  console.log(
    `  ${solo.key.padEnd(12)} camera ${cam.toFixed(0)}px  lag ${String(xc.lag).padStart(4)}px (r=${xc.r})  ` +
      `ratio ${measured[measured.length - 1].ratioMeasured}  drift/screen-width ${measured[measured.length - 1].driftPerScreenWidth}px`,
  );
}

await browser.close();
writeFileSync(
  join(HERE, `motion-${MAP}-${VIEWKEY}.json`),
  JSON.stringify(
    { map: MAP, view: VIEWKEY, viewport: VIEW, bound, pass1: { cameraPanDevicePx: +panPx.toFixed(1), samples: samples.length, driftPerCameraPx: readSlopes }, pass2: measured },
    null,
    2,
  ),
);
console.log(`\nwrote motion-${MAP}-${VIEWKEY}.json`);
