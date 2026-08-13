/**
 * evidence/a0-36-name-the-blobs/drift.mjs — a0-36, the drift meter (route 2).
 * OWNER: QA Manager.
 *
 * `motion.mjs` route 1 reads each layer's transform off the running build across
 * a real flight. That is a measurement, not a code constant — but it is a
 * measurement of `position`, and `position` is not the screen. This closes that
 * gap the only way that needs no faith in route 1 at all: **it photographs each
 * layer at two known camera offsets and cross-correlates the pixels.**
 *
 * One boot, ONE flight, both ends shot for every layer:
 *
 *   at P1 — solo each layer in turn, screenshot, un-solo
 *   fly (Tap Commander: click, because that is the shipped scheme — a0-33)
 *   at P2 — solo each layer in turn, screenshot, un-solo
 *
 * That ordering matters and is the whole reason this file exists next to
 * `motion.mjs`. Soloing is applied **only while the shutter is open**: taking the
 * UI out of the scene — by `visible` OR by `alpha` — stops the click Tap
 * Commander flies on from landing, and a pass that flies while soloed measures a
 * camera pan of zero. One flight instead of one-per-layer also makes the camera
 * offset identical for every class, so the ratios are directly comparable rather
 * than each normalised by its own flight.
 *
 * Read-only round: visibility and input only, through Pixi's `__PIXI_APP_INIT__`
 * devtools hook (a1-07's provenance). Nothing in `src/` is touched.
 *
 *   node evidence/a0-36-name-the-blobs/drift.mjs [port] [map] [view]
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
const DPR = VIEW.deviceScaleFactor;

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
  const v = root.children.find((c) => c.label === 'void-backdrop');
  const vfx = root.children.find((c) => c.label === 'vfx');
  globalThis.__qa = { app, root, world, void: v, vfx };
  return { void: v.children.map((c) => c.label), world: world.children.map((c) => c.label) };
};

const CAM = () => {
  const { world, void: v } = globalThis.__qa;
  const out = { camera: { x: world.position.x, y: world.position.y }, layers: {} };
  for (const c of v.children) out.layers[c.label] = { x: c.position.x, y: c.position.y };
  return out;
};

const SOLO = (labels) => {
  const { app, root, world, void: v, vfx } = globalThis.__qa;
  const want = new Set(labels);
  for (const c of root.children) c.visible = c === world || c === v || c === vfx;
  for (const c of app.stage.children) if (c.label === 'badge-root') c.visible = false;
  for (const c of v.children) c.visible = c.label === 'void-ground' || want.has(c.label);
  for (const c of world.children) c.visible = want.has(c.label);
  for (const c of vfx?.children || []) c.visible = want.has(c.label);
  return true;
};

const UNSOLO = () => {
  const { app, root, world, void: v, vfx } = globalThis.__qa;
  for (const c of root.children) { c.visible = true; c.alpha = 1; }
  for (const c of app.stage.children) { c.visible = true; c.alpha = 1; }
  for (const c of v.children) c.visible = true;
  for (const c of world.children) c.visible = true;
  for (const c of vfx?.children || []) c.visible = true;
  return true;
};

/** Horizontal shift in device px that best aligns `b` to `a`. Coarse then fine;
 *  the band excludes the frame edges, where content enters and leaves. */
function bestShiftX(a, b, maxLag) {
  const { width: w, height: h } = a;
  const y0 = Math.round(h * 0.12), y1 = Math.round(h * 0.88);
  const x0 = maxLag + 2, x1 = w - maxLag - 2;
  if (x1 <= x0) return { lag: null, r: null, note: 'lag window wider than the frame' };
  const luma = (p, x, y) => {
    const i = (y * w + x) * 4;
    return 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
  };
  const score = (lag, step) => {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const va = luma(a, x, y), vb = luma(b, x + lag, y);
        sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n++;
      }
    }
    const cov = sab / n - (sa / n) * (sb / n);
    const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
    return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
  };
  let best = 0, bs = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag += 8) { const r = score(lag, 8); if (r > bs) { bs = r; best = lag; } }
  let fine = best, fs = -Infinity;
  for (let lag = best - 10; lag <= best + 10; lag++) {
    if (Math.abs(lag) > maxLag) continue;
    const r = score(lag, 2);
    if (r > fs) { fs = r; fine = lag; }
  }
  return { lag: fine, r: +fs.toFixed(4) };
}

// ---------------------------------------------------------------------------

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const ctx = await browser.newContext(VIEW);
await ctx.addInitScript(init(MAP));
const page = await ctx.newPage();
await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__qaApp?.stage?.children?.length > 0, null, { timeout: 30000 });
await settle(page, 60);
const bound = await page.evaluate(BIND);

const nebula = bound.void.find((l) => l && l.startsWith('void-nebula-'));
const CLASSES = [
  { key: 'nebula', labels: nebula ? [nebula] : [] },
  { key: 'stars-deep', labels: ['void-stars-deep'] },
  { key: 'stars-mid', labels: ['void-stars-mid'] },
  { key: 'stars-near', labels: ['void-stars-near'] },
  { key: 'world', labels: ['boundary', 'asteroids', 'stations'] },
].filter((c) => c.labels.length);

/** Shoot every class at the current camera offset. */
async function shootAll(tag) {
  for (const c of CLASSES) {
    await page.evaluate(SOLO, c.labels);
    await settle(page, 6);
    await page.screenshot({ path: join(OUT, `drift-${MAP}-${VIEWKEY}-${c.key}-${tag}.png`) });
  }
  await page.evaluate(UNSOLO);
  await settle(page, 4);
}

const before = await page.evaluate(CAM);
await shootAll('A');

// The flight. Tap Commander, with the scene NORMAL — see the header.
//
// The pan is VERIFIED, not assumed. A tap does not always take (the ship can be
// mid-manoeuvre, or already against the boundary it was sent toward), and a run
// that quietly panned 0 px reports every ratio as NaN and every correlation as a
// perfect 1 — which looks like a result. So: click, read the camera, and keep
// going until it has actually moved far enough to measure, or fail loudly.
const { width, height } = VIEW.viewport;
const MIN_PAN = 400; // css px — enough that a 0.085 layer still moves 30+ px
let panned = 0;
let side = 60; // fly left first
let stalls = 0;
for (let i = 0; i < 12 && panned < MIN_PAN; i++) {
  await page.mouse.click(side, Math.round(height / 2));
  await settle(page, 100);
  const now = await page.evaluate(CAM);
  const next = Math.abs(now.camera.x - before.camera.x);
  // Keep ONE direction: alternating cancels the pan out, which is how an earlier
  // version spent ten taps to travel 364 px. Flip only if the ship has stopped
  // making progress, i.e. it is up against the boundary on this side.
  if (next - panned < 20) {
    if (++stalls >= 2) { side = side === 60 ? width - 60 : 60; stalls = 0; }
  } else {
    stalls = 0;
  }
  panned = next;
}
if (panned < MIN_PAN) {
  throw new Error(`camera panned only ${panned.toFixed(1)} css px after 10 taps — refusing to report ratios off it`);
}
const after = await page.evaluate(CAM);
await shootAll('B');
await ctx.close();
await browser.close();

const camCss = after.camera.x - before.camera.x;
const camDev = camCss * DPR;
const screenW = VIEW.viewport.width;
console.log(`\n=== ${MAP} / ${VIEWKEY} — one boot, one flight ===`);
console.log(`camera panned ${camCss.toFixed(1)} css px (${camDev.toFixed(0)} device px), one screen-width = ${screenW} css`);

const rows = [];
for (const c of CLASSES) {
  const A = PNG.sync.read(readFileSync(join(OUT, `drift-${MAP}-${VIEWKEY}-${c.key}-A.png`)));
  const B = PNG.sync.read(readFileSync(join(OUT, `drift-${MAP}-${VIEWKEY}-${c.key}-B.png`)));
  // The search window has to be able to hold a parallax-1 drift (the whole
  // camera pan). Where it cannot, the window is capped at 45% of the frame so a
  // correlation band still exists — and then a class whose true drift is larger
  // will come back sitting ON the boundary. THAT is what "railed" means, and it
  // is a per-class fact, not a per-run one: an earlier version computed it from
  // the window alone and flagged every row, including four that had landed well
  // inside their search.
  const need = Math.round(Math.abs(camDev) * 1.15) + 24;
  const maxLag = Math.min(Math.round(A.width * 0.45), need);
  const xc = bestShiftX(A, B, maxLag);
  const railed = xc.lag !== null && Math.abs(xc.lag) >= maxLag - 1;
  // What the transform SAYS, for the same class, over the same flight — so the
  // two routes can be compared line by line rather than in prose.
  const lbl = c.labels[0];
  const read =
    before.layers[lbl] !== undefined
      ? (after.layers[lbl].x - before.layers[lbl].x) / camCss
      : 1; // the world container IS the camera: ratio 1 by definition
  rows.push({
    key: c.key,
    labels: c.labels,
    readRatio: +read.toFixed(4),
    measuredRatio: camDev === 0 ? null : +(xc.lag / camDev).toFixed(4),
    xcorrLagDevicePx: xc.lag,
    xcorrR: xc.r,
    lagWindowRailed: railed,
    maxLagDevicePx: maxLag,
    driftPerScreenWidthCssPx: camDev === 0 ? null : +((xc.lag / camDev) * screenW).toFixed(1),
    readDriftPerScreenWidthCssPx: +(read * screenW).toFixed(1),
  });
  const r = rows[rows.length - 1];
  console.log(
    `  ${c.key.padEnd(11)} read ${String(r.readRatio).padStart(7)}   measured ${String(r.measuredRatio).padStart(7)}` +
      ` (lag ${String(xc.lag).padStart(5)}/${maxLag} dev px, r=${xc.r})${railed ? ' RAILED' : '       '}` +
      `   drift/screen-width ${String(r.readDriftPerScreenWidthCssPx).padStart(7)} css px`,
  );
}

writeFileSync(
  join(HERE, `drift-${MAP}-${VIEWKEY}.json`),
  JSON.stringify(
    { map: MAP, view: VIEWKEY, viewport: VIEW, screenWidthCssPx: screenW,
      cameraPanCssPx: +camCss.toFixed(1), cameraPanDevicePx: +camDev.toFixed(1), classes: rows },
    null, 2,
  ),
);
console.log(`\nwrote drift-${MAP}-${VIEWKEY}.json`);
