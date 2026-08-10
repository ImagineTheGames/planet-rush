/**
 * evidence/a1-07-sky-registry/shoot-skies.mjs — a1-07, the camera. OWNER: QA Manager.
 *
 * Six arenas, six skies, one hand-written table (`MAP_NEBULA`, src/art/backdrop.ts)
 * that has never been checked against a running build. This boots the SERVED
 * bundle once per arena and asks it, at runtime, which sky it actually loaded.
 *
 * ── How the sky is READ rather than eyeballed ───────────────────────────────
 * `Void.build()` labels every layer it makes: `void-ground`, `void-stars-<key>`,
 * and — only if the map's `NebulaSpec` is not `none` — `void-nebula-<id>`. Those
 * labels are the registry's own answer, applied: the same `this.nebula.id` that
 * names the layer is the id `nebulaSprite()` draws from, so the label cannot
 * disagree with the geometry.
 *
 * The `?debug=1` handle publishes no scene graph (a0-12 said so plainly and it is
 * still true), and this is a READ-ONLY round — no seam may be added to `src/`. So
 * the labels are read through **Pixi's own devtools hook**: `pixi.js` 8.6.6 calls
 * `globalThis.__PIXI_APP_INIT__(app, version)` from `ApplicationInitHook.init`
 * (node_modules/pixi.js/lib/utils/global/globalHooks.mjs) with the Application as
 * `this`. An init-script sets that global before any page script runs, so the
 * harness holds the real live `app.stage` and can walk it. Nothing in `src/`
 * changes, and nothing here runs unless this file is run.
 *
 * ── What each arena is shot with ────────────────────────────────────────────
 *   <id>-live.png            `?debug=1`, sim running, BUILD BADGE IN FRAME.
 *   <id>-A-frozen.png        `?debug=1&freeze=1`, the seeded pinned world.
 *   <id>-B-no-nebula.png     the same frozen frame, `void-nebula-*` hidden.
 *   <id>-C-no-stars.png      the same frozen frame, every `void-stars-*` hidden.
 *   <id>-D-ground-only.png   the same frozen frame, ALL void layers but the
 *                            ground hidden.
 *
 * Freeze is what makes B/C/D worth having: the sim is pinned at `FREEZE_TICK`, so
 * A and B differ by EXACTLY ONE HIDDEN LAYER and |A−B| is the sky, isolated —
 * not a claim about the sky, the sky's own pixels. D is the answer to the
 * developer's report on its own terms: if soft discs are still in the empty field
 * when neither the sky nor a single star layer is drawing, they are neither.
 *
 * Visibility is toggled on the Pixi node, never in the sim: `Void.build()`
 * rebuilds only when the viewport/bounds/vfx-tier/nebula change and `update()`
 * only writes `position`, so a hidden layer stays hidden across frames.
 *
 * The map is chosen the way a player chooses it — `localStorage`
 * `planet-rush:mapId`, the seam the PLAY screen writes and the `?debug=1` boot
 * reads (there is no lobby under `?debug=1`).
 *
 *   node evidence/a1-07-sky-registry/shoot-skies.mjs [port]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'frames');
const PORT = process.argv[2] ?? '4287';
const BASE = `http://127.0.0.1:${PORT}`;

/** Desktop, 1:1 — a wide frame so there is open void either side of the ship. */
const VP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

/** The table under test — src/art/backdrop.ts `MAP_NEBULA` as written today.
 *  `expect` is what the REGISTRY CLAIMS; the run reports what it FINDS. */
const MAPS = [
  { id: 'octagon', name: 'The Octagon', expect: 'none', note: 'DEFAULT_MAP_ID — a fresh install lands here' },
  { id: 'compass', name: 'The Compass', expect: 'coalsack', note: 'the one sky drawn IN FRONT of the stars' },
  { id: 'oval', name: 'The Oval', expect: 'plasmaReef', note: '' },
  { id: 'diamond', name: 'Double Diamond', expect: 'patinaDrift', note: '' },
  { id: 'line', name: 'The Line', expect: 'deepEmber', note: '' },
  { id: 'crescents', name: 'The Crescents', expect: 'ironVeil', note: '' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Settle by counting frames, not by timing them — a software-GL box can still be
 *  mid-draw when a clock says it is finished (the q8 lesson, via a0-07b). */
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

/** The init script: pin the map, and catch the Application on its way up. */
function initScript(mapId) {
  return `
    try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(mapId)}); } catch (e) {}
    globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
  `;
}

/** Walk the live stage; return the void container's children IN DRAW ORDER. */
const READ_VOID = () => {
  const app = globalThis.__qaApp;
  if (!app || !app.stage) return { error: 'no __qaApp — the Pixi devtools hook did not fire' };
  let found = null;
  const walk = (node, depth, path) => {
    if (found || depth > 24) return;
    const kids = node.children || [];
    if (kids.some((c) => c.label === 'void-ground')) {
      found = { node, path };
      return;
    }
    for (const c of kids) walk(c, depth + 1, `${path}/${c.label || c.constructor?.name || '?'}`);
  };
  walk(app.stage, 0, 'stage');
  if (!found) return { error: 'no container holding a void-ground child was found on the stage' };
  const children = found.node.children.map((c, i) => {
    let b = null;
    try {
      const r = c.getLocalBounds();
      b = { w: Math.round(r.width), h: Math.round(r.height) };
    } catch (e) {
      /* a layer with no geometry has no bounds — recorded as null, not guessed */
    }
    return {
      index: i,
      label: typeof c.label === 'string' ? c.label : null,
      visible: c.visible !== false,
      blendMode: c.blendMode ?? null,
      alpha: c.alpha,
      x: Math.round(c.position?.x ?? 0),
      y: Math.round(c.position?.y ?? 0),
      localBounds: b,
    };
  });
  const pr = globalThis.__planetRush;
  return {
    path: found.path,
    children,
    nebulaLabels: children.map((c) => c.label).filter((l) => l && l.startsWith('void-nebula-')),
    starLabels: children.map((c) => c.label).filter((l) => l && l.startsWith('void-stars-')),
    build: pr?.build ?? null,
    ticks: pr?.ticks ?? null,
    shipWorld: pr?.shipWorld ?? null,
    viewport: pr?.viewport ? { w: pr.viewport.w, h: pr.viewport.h } : null,
  };
};

/** Hide/show void layers whose label matches `pattern` (a prefix). */
const SET_VISIBLE = ([prefix, visible]) => {
  const app = globalThis.__qaApp;
  let found = null;
  const walk = (node, depth) => {
    if (found || depth > 24) return;
    const kids = node.children || [];
    if (kids.some((c) => c.label === 'void-ground')) {
      found = node;
      return;
    }
    for (const c of kids) walk(c, depth + 1);
  };
  walk(app.stage, 0);
  if (!found) return { hidden: [], error: 'void container not found' };
  const touched = [];
  for (const c of found.children) {
    const l = typeof c.label === 'string' ? c.label : '';
    if (prefix === '*' ? l.startsWith('void-') && l !== 'void-ground' : l.startsWith(prefix)) {
      c.visible = visible;
      touched.push(l);
    }
  }
  return { touched };
};

async function boot(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__planetRush?.shipWorld, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settle(page, 20);
}

mkdirSync(OUT, { recursive: true });

const served = await (await fetch(`${BASE}/version.json`)).json();
console.log(`served ${BASE}/version.json = ${JSON.stringify(served)}\n`);

const browser = await chromium.launch();
const report = { base: BASE, served, capturedAt: new Date().toISOString(), maps: [] };

for (const m of MAPS) {
  console.log(`── ${m.name} (${m.id}) — registry says ${m.expect}${m.note ? `  [${m.note}]` : ''}`);
  const row = { ...m, live: null, frozen: null, frames: {} };

  // --- 1. LIVE: the sim running, the build badge in the corner --------------
  {
    const ctx = await browser.newContext(VP);
    await ctx.addInitScript(initScript(m.id));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('   [page error]', e.message));
    await boot(page, `${BASE}/?debug=1`);
    await sleep(1500);
    await settle(page, 12);
    row.live = await page.evaluate(READ_VOID);
    const f = `${m.id}-live.png`;
    await page.screenshot({ path: join(OUT, f) });
    row.frames.live = f;
    console.log(`   live   nebula=[${row.live.nebulaLabels?.join(', ') || '(none)'}]  stars=${row.live.starLabels?.length}  build=${row.live.build?.sha}`);
    await ctx.close();
  }

  // --- 2. FROZEN: A / B / C / D, one hidden-layer set apart -----------------
  {
    const ctx = await browser.newContext(VP);
    await ctx.addInitScript(initScript(m.id));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('   [page error]', e.message));
    await boot(page, `${BASE}/?debug=1&freeze=1`);
    await sleep(1200);
    await settle(page, 12);
    row.frozen = await page.evaluate(READ_VOID);

    const shot = async (tag) => {
      await settle(page, 6);
      const f = `${m.id}-${tag}.png`;
      await page.screenshot({ path: join(OUT, f) });
      row.frames[tag] = f;
      return f;
    };
    await shot('A-frozen');

    row.hidden = {};
    row.hidden.nebula = await page.evaluate(SET_VISIBLE, ['void-nebula-', false]);
    await shot('B-no-nebula');
    await page.evaluate(SET_VISIBLE, ['void-nebula-', true]);

    row.hidden.stars = await page.evaluate(SET_VISIBLE, ['void-stars-', false]);
    await shot('C-no-stars');
    await page.evaluate(SET_VISIBLE, ['void-stars-', true]);

    row.hidden.all = await page.evaluate(SET_VISIBLE, ['*', false]);
    await shot('D-ground-only');
    await page.evaluate(SET_VISIBLE, ['*', true]);

    console.log(`   frozen nebula=[${row.frozen.nebulaLabels?.join(', ') || '(none)'}]  order: ${row.frozen.children.map((c) => c.label).join(' > ')}`);
    console.log(`   hid: nebula=[${row.hidden.nebula.touched.join(',') || '-'}]  stars=${row.hidden.stars.touched.length}  all=${row.hidden.all.touched.length}`);
    await ctx.close();
  }

  const got = row.frozen?.nebulaLabels ?? [];
  const actual = got.length === 0 ? 'none' : got[0].replace('void-nebula-', '');
  row.actual = actual;
  row.match = actual === m.expect;
  console.log(`   REGISTRY ${m.expect}   RENDERED ${actual}   ${row.match ? 'MATCH' : '*** MISMATCH ***'}\n`);
  report.maps.push(row);
}

// --- 3. The Compass in MOTION — coalsack is a shape a still cannot carry ----
// Three frames along one straight flight: the occluding dust lane is the only
// sky in the set that TAKES stars out, so what it looks like is a hole moving
// with the star field. Live (freeze pins the ship), west — the local home on
// compass sits east of centre in the earlier rounds' flights, and a ship pinned
// against the arena wall gives three camera positions that are really two
// (the a0-07b lesson).
{
  console.log('── The Compass, in motion (live flight, 3 camera positions)');
  const ctx = await browser.newContext(VP);
  await ctx.addInitScript(initScript('compass'));
  const page = await ctx.newPage();
  await boot(page, `${BASE}/?debug=1`);
  const shipX = () => page.evaluate(() => window.__planetRush.shipWorld.x);
  const x0 = await shipX();
  const marks = [0, 320, 640];
  const dir = x0 > 1200 ? -1 : +1;
  const flight = [];
  for (let i = 0; i < marks.length; i++) {
    if (marks[i] > 0) {
      const key = dir > 0 ? 'KeyD' : 'KeyA';
      const deadline = Date.now() + 30_000;
      await page.keyboard.down(key);
      let x = await shipX();
      while ((x - x0) * dir < marks[i] && Date.now() < deadline) {
        await sleep(80);
        x = await shipX();
      }
      await page.keyboard.up(key);
      await settle(page, 4);
    }
    const at = await shipX();
    const f = `compass-flight-${i + 1}.png`;
    await page.screenshot({ path: join(OUT, f) });
    flight.push({ file: f, worldX: Math.round(at), flown: Math.round((at - x0) * dir) });
    console.log(`   ${f}  ship x=${Math.round(at)} (${Math.round((at - x0) * dir)} u flown, ${dir > 0 ? 'east' : 'west'})`);
  }
  report.compassFlight = { dir: dir > 0 ? 'east' : 'west', x0: Math.round(x0), frames: flight };
  await ctx.close();
}

writeFileSync(join(OUT, 'readback.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

console.log('\n── the table, as the running build answered it ───────────────');
for (const r of report.maps) {
  console.log(`  ${r.id.padEnd(10)} registry ${r.expect.padEnd(12)} rendered ${r.actual.padEnd(12)} ${r.match ? 'match' : 'MISMATCH'}`);
}
const bad = report.maps.filter((r) => !r.match);
console.log(bad.length ? `\n*** ${bad.length} MISMATCH(ES): ${bad.map((r) => r.id).join(', ')}` : '\nall six match');
console.log(`\nwrote ${OUT}/readback.json`);
