/**
 * evidence/a1-08-parallax/recon.mjs — a1-08, reconnaissance. OWNER: QA Manager.
 *
 * Before measuring anything, look at the stage. This dumps the full live scene
 * graph of the SERVED bundle on the `line` arena so the measuring script knows
 * (a) the path to the void container, (b) what its siblings are — everything the
 * isolation has to hide — and (c) the arena bounds, which decide how far a
 * straight flight can actually go.
 *
 * Read-only: the Pixi devtools hook (`__PIXI_APP_INIT__`, pixi.js 8.6.6) is
 * claimed from a Playwright init-script, exactly as a1-07 did it. Nothing in
 * `src/` is touched.
 *
 *   node evidence/a1-08-parallax/recon.mjs [port] [mapId]
 */
import { chromium } from '@playwright/test';

const PORT = process.argv[2] ?? '4291';
const MAP = process.argv[3] ?? 'line';
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const served = await (await fetch(`${BASE}/version.json`)).json();
console.log(`served ${JSON.stringify(served)}  map=${MAP}\n`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(`
  try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(MAP)}); } catch (e) {}
  globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
`);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[page error]', e.message));
await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
await page.waitForFunction(() => !!window.__planetRush?.shipWorld, undefined, { timeout: 30_000 });
await sleep(2000);

const tree = await page.evaluate(() => {
  const app = globalThis.__qaApp;
  if (!app?.stage) return { error: 'no __qaApp' };
  const lines = [];
  const walk = (n, d, idx) => {
    if (d > 6) return;
    const label = typeof n.label === 'string' && n.label ? n.label : n.constructor?.name || '?';
    lines.push(
      `${'  '.repeat(d)}[${idx}] ${label}  <${n.constructor?.name}>  vis=${n.visible} alpha=${n.alpha} ` +
        `pos=(${Math.round(n.position?.x ?? 0)},${Math.round(n.position?.y ?? 0)}) ` +
        `scale=(${(n.scale?.x ?? 1).toFixed(3)},${(n.scale?.y ?? 1).toFixed(3)}) kids=${n.children?.length ?? 0}`,
    );
    (n.children || []).forEach((c, i) => walk(c, d + 1, i));
  };
  walk(app.stage, 0, 0);
  const pr = globalThis.__planetRush;
  return {
    tree: lines,
    build: pr?.build ?? null,
    bounds: pr?.bounds ?? null,
    world: pr?.world ?? null,
    shipWorld: pr?.shipWorld ?? null,
    shipScreen: pr?.shipScreen ?? null,
    viewport: pr?.viewport ?? null,
    keys: Object.keys(pr || {}),
  };
});

console.log(tree.tree ? tree.tree.join('\n') : JSON.stringify(tree));
console.log('\n── handles ──');
console.log('build     ', JSON.stringify(tree.build));
console.log('bounds    ', JSON.stringify(tree.bounds));
console.log('shipWorld ', JSON.stringify(tree.shipWorld));
console.log('shipScreen', JSON.stringify(tree.shipScreen));
console.log('viewport  ', JSON.stringify(tree.viewport));
console.log('__planetRush keys:', tree.keys.join(', '));

await browser.close();
