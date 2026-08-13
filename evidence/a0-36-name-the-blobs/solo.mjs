/**
 * evidence/a0-36-name-the-blobs/solo.mjs — a0-36, one layer at a time, alone.
 * OWNER: QA Manager.
 *
 * `isolate.mjs` differences A against A-minus-one-layer, which attributes every
 * pixel correctly but shows a layer only where nothing occluded it. This does the
 * complement: it draws ONE layer over the bare Floor and nothing else, so the
 * class can be looked at directly — its shape, its size, whether it is a filled
 * glow or an annulus. Those are plates a human reads; the numbers stay in
 * `analyse.mjs`.
 *
 * Run twice on purpose:
 *
 *   --freeze   the pinned world. Every solo is the SAME frame, so the counts
 *              across layers are one coherent inventory rather than a dozen
 *              moments averaged together.
 *   (live)     a real match with the sim running. `vfx-matter` / `vfx-light`
 *              are transient — a frozen frame may hold none — so the VFX classes
 *              can only be looked at here, and the counts are then honestly a
 *              sample of one live frame rather than a census.
 *
 * `void-ground` stays visible under every solo: it is the opaque Floor the whole
 * void composites over, and without it a `sky` -role fill is being judged against
 * whatever the canvas clear colour happens to be, which is not what the player
 * sees. It is also shot alone, as the empty plate.
 *
 *   node evidence/a0-36-name-the-blobs/solo.mjs [port] [map] [view] [--freeze]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'frames');
const args = process.argv.slice(2);
const FREEZE = args.includes('--freeze');
const rest = args.filter((a) => !a.startsWith('--'));
const PORT = rest[0] ?? '4336';
const MAP = rest[1] ?? 'oval';
const VIEWKEY = rest[2] ?? 'desktop';
const BASE = `http://127.0.0.1:${PORT}`;

const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
};
const VIEW = VIEWS[VIEWKEY];
const MODE = FREEZE ? 'frozen' : 'live';

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
  const void_ = root.children.find((c) => c.label === 'void-backdrop');
  const vfx = root.children.find((c) => c.label === 'vfx');
  globalThis.__qa = { app, root, world, void: void_, vfx };
  const kids = (c) => (c?.children || []).map((k) => ({ label: k.label, n: (k.children || []).length }));
  return { void: kids(void_), world: kids(world), vfx: kids(vfx) };
};

/** Show only the named labels (plus `void-ground`); hide all UI. */
const SOLO = (labels) => {
  const { app, root, world, void: v, vfx } = globalThis.__qa;
  const want = new Set(labels);
  for (const c of root.children) c.visible = c === world || c === v || c === vfx;
  for (const c of app.stage.children) if (c.label === 'badge-root') c.visible = false;
  const counts = {};
  for (const c of v.children) c.visible = c.label === 'void-ground' || want.has(c.label);
  for (const c of world.children) { c.visible = want.has(c.label); if (want.has(c.label)) counts[c.label] = (c.children || []).length; }
  for (const c of vfx?.children || []) { c.visible = want.has(c.label); if (want.has(c.label)) counts[c.label] = (c.children || []).length; }
  return counts;
};

const ctxOpts = { viewport: VIEW.viewport, deviceScaleFactor: VIEW.deviceScaleFactor };
const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

const ctx = await browser.newContext(ctxOpts);
await ctx.addInitScript(init(MAP));
const page = await ctx.newPage();
await page.goto(`${BASE}/?debug=1${FREEZE ? '&freeze=1' : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__qaApp?.stage?.children?.length > 0, null, { timeout: 30000 });
await settle(page, FREEZE ? 60 : 120);
const bound = await page.evaluate(BIND);

const nebula = bound.void.map((k) => k.label).find((l) => l && l.startsWith('void-nebula-'));
const SOLOS = [
  { key: 'ground-only', labels: [] },
  { key: 'nebula', labels: nebula ? [nebula] : [] },
  { key: 'stars-deep', labels: ['void-stars-deep'] },
  { key: 'stars-mid', labels: ['void-stars-mid'] },
  { key: 'stars-near', labels: ['void-stars-near'] },
  { key: 'stars-all', labels: ['void-stars-deep', 'void-stars-mid', 'void-stars-near'] },
  { key: 'asteroids', labels: ['asteroids'] },
  { key: 'chunks', labels: ['chunks'] },
  { key: 'atmosphere', labels: ['atmosphere'] },
  { key: 'stations', labels: ['stations'] },
  { key: 'turrets', labels: ['turrets'] },
  { key: 'ships', labels: ['ships'] },
  { key: 'shots', labels: ['shots'] },
  { key: 'muzzles', labels: ['muzzles'] },
  { key: 'impacts', labels: ['impacts'] },
  { key: 'boundary', labels: ['boundary'] },
  { key: 'vfx-light', labels: ['vfx-light'] },
  { key: 'vfx-matter', labels: ['vfx-matter'] },
  { key: 'vfx-all', labels: ['vfx-light', 'vfx-matter'] },
];

const shot = [];
for (const s of SOLOS) {
  if (s.key === 'nebula' && !s.labels.length) continue;
  const counts = await page.evaluate(SOLO, s.labels);
  await settle(page, 6);
  const file = `solo-${MAP}-${VIEWKEY}-${MODE}-${s.key}.png`;
  await page.screenshot({ path: join(OUT, file) });
  shot.push({ ...s, counts, file });
  console.log(`  ${s.key.padEnd(14)} ${JSON.stringify(counts)}  → ${file}`);
}
await ctx.close();
await browser.close();

writeFileSync(
  join(HERE, `solos-${MAP}-${VIEWKEY}-${MODE}.json`),
  JSON.stringify({ map: MAP, view: VIEWKEY, mode: MODE, viewport: VIEW, bound, shot }, null, 2),
);
console.log(`\nwrote solos-${MAP}-${VIEWKEY}-${MODE}.json`);
