/**
 * evidence/a0-62-app-shell-bloom/probe-solo.mjs — bisect the LIVE app's scene.
 * OWNER: Art Agent.
 *
 * The build configuration is not the variable (both bundles measure the same
 * broken halo, and `renderer-probe.html` inside the SAME bundle measures the
 * correct one). What is left is what the app shell puts on the stage around the
 * backdrop. So: boot the real client, then strip the scene down a piece at a
 * time through Pixi's devtools hook, re-render, and shoot each state.
 *
 *   node evidence/a0-62-app-shell-bloom/probe-solo.mjs --port 4262
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', '4262'));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.addInitScript(() => {
  globalThis.__PIXI_APP_INIT__ = (app) => {
    globalThis.__qaApp = app;
  };
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:${PORT}/?debug=1&freeze=1`);
await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 30_000 });
await page.waitForFunction(() => !!globalThis.__qaApp, undefined, { timeout: 30_000 });
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Hide everything on the stage except the subtree that contains the backdrop,
 *  optionally also stopping the app's own frame loop first. */
const states = {
  /** Everything the client normally draws — the frame audit.txt measures. */
  full: () => {},
  /** Only the void: the world, the HUD and every overlay hidden. */
  'solo-void': () => {
    const app = globalThis.__qaApp;
    const keep = new Set();
    const mark = (n) => {
      if (!n) return;
      keep.add(n);
      mark(n.parent);
    };
    const find = (n) => {
      if (n.label === 'void-backdrop') mark(n);
      for (const c of n.children ?? []) find(c);
    };
    find(app.stage);
    const strip = (n) => {
      for (const c of n.children ?? []) {
        if (!keep.has(c)) {
          c.visible = false;
          continue;
        }
        strip(c);
      }
    };
    strip(app.stage);
  },
  /** The void plus the world, without the HUD/UI layers. */
  'no-ui': () => {
    const app = globalThis.__qaApp;
    for (const c of app.stage.children) if (c.label !== 'game-root') c.visible = false;
    const root = app.stage.children.find((c) => c.label === 'game-root');
    for (const c of root?.children ?? []) {
      if (c.label !== 'void-backdrop' && c.label !== 'world-root') c.visible = false;
    }
  },
};

for (const [name, fn] of Object.entries(states)) {
  await page.reload();
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => !!globalThis.__qaApp, undefined, { timeout: 30_000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(fn);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const shot = await page.screenshot();
  writeFileSync(join(FRAMES, `solo-${name}-dpr1.png`), shot);
  const seen = await page.evaluate(() => {
    const app = globalThis.__qaApp;
    let visible = 0;
    const count = (n) => {
      if (n.visible === false) return;
      visible += 1;
      for (const c of n.children ?? []) count(c);
    };
    count(app.stage);
    return visible;
  });
  console.log(`solo-${name}: ${seen} visible nodes`);
}

await browser.close();
