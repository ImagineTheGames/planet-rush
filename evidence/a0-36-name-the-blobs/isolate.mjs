/**
 * evidence/a0-36-name-the-blobs/isolate.mjs — a0-36, the layer isolator.
 * OWNER: QA Manager.
 *
 * The developer's frame has many large soft discs in it and nobody has NAMED
 * them. Four hypotheses have been guessed and refuted. This does not guess: it
 * boots the served bundle, hides ONE live layer at a time, and differences the
 * frames — so every disc in the frame is attributed to the layer that actually
 * drew it, by construction.
 *
 * Method is a1-07's, widened. a1-07 walked only the void container and toggled
 * four layer sets; the developer's discs might be anything, so this enumerates
 * EVERY labelled layer under `game-root` — the void's five, the world's ten, and
 * the two VFX pools a2-07 wired — and isolates each.
 *
 * `?freeze=1` pins the sim at FREEZE_TICK, so A and B differ by exactly one
 * hidden layer and |A−B| is that layer's own pixels rather than a claim about
 * them. Visibility is toggled on the Pixi node, never in the sim: `Void.build()`
 * only rebuilds on a viewport/bounds/tier/nebula change and `update()` only
 * writes `position`, so a hidden layer stays hidden across frames.
 *
 * The stage is reached through Pixi's `__PIXI_APP_INIT__` devtools hook, as in
 * a1-07 — this is a READ-ONLY round and nothing in `src/` gains a seam.
 *
 * **The zero.** `void-ground` is hidden on a frame where it is the only opaque
 * thing under everything: it MUST move a large number of pixels. The calibrated
 * null is instead `turrets`/`shots` — layers with zero children in a frozen
 * frame. Hiding an empty layer must difference to exactly 0 pixels, and the run
 * asserts it does before any other number is believed.
 *
 *   node evidence/a0-36-name-the-blobs/isolate.mjs [port]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'frames');
const PORT = process.argv[2] ?? '4336';
const BASE = `http://127.0.0.1:${PORT}`;

/** Both of the developer's conditions. Their frame is desktop; the brief asks
 *  for phone-class too, and the sky is authored per-screen so the two are
 *  genuinely different skies, not one scaled. */
const VIEWS = [
  { key: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  { key: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
];

/** Every arena that HAS a sky — the developer's frame has one, so `octagon`
 *  (nebula `none`) is carried only as the control that shows what a skyless
 *  frame's discs look like. */
const MAPS = ['oval', 'diamond', 'line', 'crescents', 'compass', 'octagon'];

const settle = (page, n = 12) =>
  page.evaluate(
    (frames) =>
      new Promise((done) => {
        let i = 0;
        const tick = () => (++i < frames ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
    n,
  );

function initScript(mapId) {
  return `
    try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(mapId)}); } catch (e) {}
    globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
  `;
}

/** Find `game-root` and index every labelled descendant we might isolate. */
const INDEX = () => {
  const app = globalThis.__qaApp;
  if (!app?.stage) return { error: 'no __qaApp' };
  let root = null;
  const find = (n, d) => {
    if (root || d > 8) return;
    if (n.label === 'game-root') {
      root = n;
      return;
    }
    for (const c of n.children || []) find(c, d + 1);
  };
  find(app.stage, 0);
  if (!root) return { error: 'no game-root on the stage' };

  const WANT = new Set([
    'void-ground',
    'void-stars-deep',
    'void-stars-mid',
    'void-stars-near',
    'boundary',
    'atmosphere',
    'stations',
    'turrets',
    'asteroids',
    'chunks',
    'muzzles',
    'impacts',
    'ships',
    'shots',
    'vfx-matter',
    'vfx-light',
  ]);
  const found = [];
  const walk = (n, d, path) => {
    if (d > 6) return;
    for (const c of n.children || []) {
      const l = c.label;
      if (l && (WANT.has(l) || l.startsWith('void-nebula-'))) {
        found.push({ label: l, path: `${path}/${l}`, kids: (c.children || []).length, visible: c.visible });
      }
      walk(c, d + 1, `${path}/${l || c.constructor?.name || '?'}`);
    }
  };
  walk(root, 0, 'game-root');
  globalThis.__qaRoot = root;
  return { layers: found };
};

/** Set one labelled layer's visibility. Returns what it actually did. */
const SET_VIS = ([label, on]) => {
  const root = globalThis.__qaRoot;
  let hit = 0;
  const walk = (n, d) => {
    if (d > 8) return;
    for (const c of n.children || []) {
      if (c.label === label) {
        c.visible = on;
        hit++;
      }
      walk(c, d + 1);
    }
  };
  walk(root, 0);
  return hit;
};

/** Hide every UI/HUD sibling of the world so the measurement sees the game
 *  frame only. The HUD is constant across A and B and would cancel anyway; it
 *  is hidden so the CONNECTED-COMPONENT pass is not chasing letterforms. */
const HIDE_UI = () => {
  const app = globalThis.__qaApp;
  let root = null;
  const find = (n, d) => {
    if (root || d > 8) return;
    if (n.label === 'game-root') { root = n; return; }
    for (const c of n.children || []) find(c, d + 1);
  };
  find(app.stage, 0);
  // game-root's children: void-backdrop, world, vfx, then UI. Anything that is
  // not one of the three known world layers is UI for this purpose.
  const KEEP = new Set(['void-backdrop', 'vfx']);
  const names = [];
  for (const c of root.children) {
    const isWorld = (c.children || []).some((k) => k.label === 'boundary');
    if (KEEP.has(c.label) || isWorld) continue;
    c.visible = false;
    names.push(c.label ?? '(unlabelled)');
  }
  for (const c of app.stage.children) {
    if (c.label === 'badge-root') c.visible = false;
  }
  return names;
};

async function run(browser, mapId, view) {
  const tag = `${mapId}-${view.key}`;
  const ctx = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.deviceScaleFactor });
  await ctx.addInitScript(initScript(mapId));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?debug=1&freeze=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__qaApp?.stage?.children?.length > 0, null, { timeout: 30000 });
  await settle(page, 60);

  const idx = await page.evaluate(INDEX);
  if (idx.error) throw new Error(`${tag}: ${idx.error}`);

  // "As played" — everything drawing, HUD included. This is the frame to
  // compare against the developer's own.
  await page.screenshot({ path: join(OUT, `${tag}-played.png`) });

  const hidden = await page.evaluate(HIDE_UI);
  await settle(page, 8);
  await page.screenshot({ path: join(OUT, `${tag}-A-all.png`) });

  for (const layer of idx.layers) {
    const n = await page.evaluate(SET_VIS, [layer.label, false]);
    await settle(page, 8);
    await page.screenshot({ path: join(OUT, `${tag}-B-no-${layer.label}.png`) });
    await page.evaluate(SET_VIS, [layer.label, true]);
    layer.toggled = n;
  }
  await settle(page, 8);
  await page.screenshot({ path: join(OUT, `${tag}-A2-restored.png`) });

  await ctx.close();
  return { mapId, view: view.key, viewport: view.viewport, dpr: view.deviceScaleFactor, uiHidden: hidden, layers: idx.layers };
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const runs = [];
for (const m of MAPS) {
  for (const v of VIEWS) {
    const r = await run(browser, m, v);
    runs.push(r);
    console.log(`${m}/${v.key}: ${r.layers.length} layers isolated — ${r.layers.map((l) => `${l.label}(${l.kids})`).join(' ')}`);
  }
}
await browser.close();
writeFileSync(join(HERE, 'isolation-runs.json'), JSON.stringify(runs, null, 2));
console.log('\nwrote isolation-runs.json');
