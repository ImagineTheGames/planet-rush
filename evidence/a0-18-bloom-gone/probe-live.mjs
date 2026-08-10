/**
 * evidence/a0-18-bloom-gone/probe-live.mjs — a0-18, the developer's condition. OWNER: Art Agent.
 *
 * `probe-bloom.mjs` measures `?debug=1&freeze=1`, and freeze pins `reduceVfx` to
 * FALSE by construction (src/main.ts: `flags.freeze ? false : …`). The developer is
 * not playing the frozen scene — they are playing, on a machine whose frame rate
 * decides the VFX tier for them. So the third suspect, "reduced-VFX sheds more
 * than it claims", cannot be tested by the frozen probe at all, and this is the
 * probe that can.
 *
 * It boots the SERVED bundle LIVE, holds it for long enough that the auto-reducer
 * has had every chance to engage (a1-07 watched `plasmaReef` drop at t+8.3 s, so
 * 30 s is four times the observed latency), and reads the star layers' submitted
 * geometry — the same grouping-by-centre read-back — at three moments. If the
 * reducer sheds stars or their bloom, the fill count drops between t+2 s and
 * t+30 s and this prints it.
 *
 * Two viewports, because the tier and the cull are both viewport-dependent: the
 * desktop the developer plays on, and a phone at dpr 3 (the device a1-11 and a1-12
 * were tuned for, and the one whose `resolution` cap `src/main.ts` now sets).
 *
 *   node evidence/a0-18-bloom-gone/probe-live.mjs <port> <label>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = process.argv[2] ?? '4931';
const LABEL = process.argv[3] ?? `live-${PORT}`;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(HERE, 'frames', LABEL);

const DEVICES = [
  { name: 'desktop-1440x900-dpr2', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  { name: 'phone-844x390-dpr3', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const initScript = (mapId) => `
  try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(mapId)}); } catch (e) {}
  globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
`;

/** The star layers' submitted geometry, plus the live tier read-back. Same
 *  grouping as probe-bloom.mjs: 3 fills at one centre = a bloomed star. */
const READ = `
  (() => {
    const app = globalThis.__qaApp;
    if (!app || !app.stage) return { error: 'no __qaApp' };
    let void_ = null;
    const walk = (node, depth) => {
      if (void_ || depth > 24) return;
      const kids = node.children || [];
      if (kids.some((c) => c.label === 'void-ground')) { void_ = node; return; }
      for (const c of kids) walk(c, depth + 1);
    };
    walk(app.stage, 0);
    if (!void_) return { error: 'no void container' };
    const layers = [];
    for (const c of void_.children) {
      const label = typeof c.label === 'string' ? c.label : '';
      if (!label.startsWith('void-stars-')) continue;
      const groups = new Map();
      let fills = 0;
      for (const ins of (c.context ? c.context.instructions : []) || []) {
        if (ins.action !== 'fill') continue;
        const list = (ins.data.path && ins.data.path.instructions) || [];
        const circle = list.find((p) => p.action === 'circle');
        if (!circle) continue;
        fills++;
        const key = circle.data[0] + ',' + circle.data[1];
        groups.set(key, (groups.get(key) || 0) + 1);
      }
      let stars = 0;
      let bloomed = 0;
      for (const n of groups.values()) { stars++; if (n >= 3) bloomed++; }
      layers.push({
        label,
        visible: c.visible !== false,
        alpha: c.alpha,
        renderable: c.renderable !== false,
        worldVisible: !!(c.parent && c.parent.visible !== false) && c.visible !== false,
        fills,
        stars,
        bloomed,
        bloomRatio: stars ? Math.round((bloomed / stars) * 1e4) / 1e4 : null,
      });
    }
    const pr = globalThis.__planetRush;
    return {
      order: void_.children.map((c) => (typeof c.label === 'string' ? c.label : '?')),
      voidVisible: void_.visible !== false,
      voidAlpha: void_.alpha,
      layers,
      build: pr && pr.build ? pr.build.sha : null,
      // Whatever the debug handle exposes about the tier, verbatim — no guessing.
      pr: pr
        ? Object.fromEntries(
            Object.keys(pr).map((k) => {
              try {
                const v = typeof pr[k] === 'function' ? pr[k]() : pr[k];
                return [k, typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v];
              } catch (e) {
                return [k, '<threw: ' + e.message + '>'];
              }
            }),
          )
        : null,
    };
  })()
`;

mkdirSync(OUT, { recursive: true });
const served = await (await fetch(`${BASE}/version.json`)).json();
console.log(`\n=== ${LABEL}  ${BASE}  served sha ${served.sha}  (LIVE, sim running) ===\n`);

const browser = await chromium.launch();
const report = { label: LABEL, base: BASE, served, devices: [] };

for (const d of DEVICES) {
  const row = { device: d.name, samples: [], frames: {} };
  const ctx = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor });
  await ctx.addInitScript(initScript('octagon'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [page error]', e.message));
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__planetRush?.shipWorld, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready);

  console.log(`── ${d.name}`);
  for (const at of [2, 12, 30]) {
    const target = at * 1000;
    // Held from boot, so t is real elapsed play time, not a sum of sleeps.
    const elapsed = await page.evaluate(() => performance.now());
    if (target > elapsed) await sleep(target - elapsed);
    const s = await page.evaluate(READ);
    s.atSeconds = at;
    row.samples.push(s);
    const f = `${d.name}-t${at}s.png`;
    await page.screenshot({ path: join(OUT, f) });
    row.frames[`t${at}s`] = f;
    const totals = (s.layers ?? []).reduce(
      (a, l) => ({ fills: a.fills + l.fills, stars: a.stars + l.stars, bloomed: a.bloomed + l.bloomed }),
      { fills: 0, stars: 0, bloomed: 0 },
    );
    const vis = (s.layers ?? []).map((l) => `${l.label.replace('void-stars-', '')}:${l.visible ? 'on' : 'OFF'}`).join(' ');
    console.log(
      `   t+${String(at).padStart(2)}s  layers=[${s.order?.join(' > ')}]\n` +
        `          fills=${totals.fills} stars=${totals.stars} bloomed=${totals.bloomed}` +
        ` ratio=${totals.stars ? Math.round((totals.bloomed / totals.stars) * 1e4) / 1e4 : null}  ${vis}` +
        `\n          reduceVfx=${s.pr?.reduceVfx ?? '(not exposed)'}  skyDensity=${s.pr?.skyDensity ?? '(not exposed)'}` +
        `  fps=${s.pr?.fps ?? '(not exposed)'}`,
    );
  }
  if (row.samples.length > 1) {
    const a = row.samples[0].layers ?? [];
    const b = row.samples[row.samples.length - 1].layers ?? [];
    const same =
      a.length === b.length && a.every((l, i) => l.fills === b[i].fills && l.bloomed === b[i].bloomed && l.visible === b[i].visible);
    console.log(`   ${same ? 'the star field is UNCHANGED from t+2s to t+30s' : '*** THE STAR FIELD MOVED ***'}\n`);
    row.starFieldStable = same;
  }
  await ctx.close();
  report.devices.push(row);
}

await browser.close();
const p = join(HERE, `readback-${LABEL}.json`);
writeFileSync(p, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${p}\nframes in ${OUT}`);
