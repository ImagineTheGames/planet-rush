/**
 * evidence/a1-15-cull-visible-rocks/live-chunks.mjs — a1-15, the ore chunks.
 * OWNER: QA Manager.
 *
 * `census-drawn.mjs` settles the rocks on the frozen scene. It cannot settle the
 * ore chunks, because **the frozen world has none**: `?freeze=1` pins the sim at
 * `FREEZE_TICK` = 120 with empty inputs (`src/platform/freeze.ts`), and a chunk
 * only exists once something has mined a rock (`src/sim/projectiles.ts`
 * `spawnChunk`, `src/sim/damage.ts`). Every frozen profile reported `chunks
 * children=0` on both builds. So the chunk half of the brief — *"if a chunk near
 * the ship is being culled, that is a gameplay bug"* — needs a LIVE match.
 *
 * ── HOW TWO LIVE BUILDS ARE MADE COMPARABLE ────────────────────────────────
 * A live world exposes no tick and no hash (`worldHash` is null unless frozen),
 * so two live boots cannot be lined up by asking them where they are. They are
 * lined up by **controlling time instead of observing it**: Playwright's clock is
 * installed before any page script runs and advanced by an identical scripted
 * amount on both builds, so both sims take the same number of fixed-timestep
 * steps from the same seed with the same (empty) inputs. Nothing is left to wall
 * clock, so a slower build cannot land on a different world than a faster one.
 *
 * That determinism is then **checked rather than trusted**: the 48 asteroids are
 * present in both scene graphs with their own world coordinates, so at every
 * sample the probe compares the two builds' full sorted rock-position lists. If
 * the worlds had drifted apart by a single step the rocks would not agree to
 * three decimals, and the sample is reported as divergent instead of being
 * quietly compared. This is the live equivalent of the frozen `worldHash`.
 *
 * No player input is sent. The chunks come from the bots working the field, which
 * is the sim's own behaviour and identical on both builds.
 *
 * The measurement is the same one the rocks got:
 *   VISIBLE_TRUE = chunks whose real drawn rect (pre-cull build, nothing culled)
 *                  intersects the visible viewport
 *   DRAWN        = chunks the served build left visible
 *   MISSING      = VISIBLE_TRUE \ DRAWN, matched by world position
 * plus, for the gameplay question specifically, the distance from each dropped
 * chunk to the ship — which sits at the visible viewport's centre (camera.ts).
 *
 *   node evidence/a1-15-cull-visible-rocks/live-chunks.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILDS = [
  { label: 'pre-cull', dist: '/tmp/pre-cull/dist' },
  { label: 'served', dist: resolve(HERE, '..', '..', 'dist') },
];

/** Desktop and the 390 px landscape phone — the profile a1-12 culls hardest. */
const PROFILES = [
  { name: 'desktop-1280x800', width: 1280, height: 800 },
  { name: 'phone-landscape-844x390', width: 844, height: 390 },
];

/** Sim seconds between samples, and how many samples. Bots need a while to chip
 *  a rock, so the run is long enough to see chunks spawn, drift and be collected. */
const STEP_MS = 5000;
const SAMPLES = 24;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
};

function serve(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let path = join(root, decodeURIComponent(url.pathname));
    if (!path.startsWith(root)) return void res.writeHead(403).end();
    if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
    if (!existsSync(path)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

const INIT = `globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };`;

const READ = `
  (() => {
    const app = globalThis.__qaApp;
    if (!app || !app.stage) return { error: 'no pixi app' };
    const findLayer = (label) => {
      let found = null;
      const walk = (node, depth) => {
        if (found || depth > 24) return;
        for (const c of node.children || []) { if (c.label === label) { found = c; return; } walk(c, depth + 1); }
      };
      walk(app.stage, 0);
      return found;
    };
    const rect = (n) => {
      const b = n.getBounds();
      const minX = b.minX !== undefined ? b.minX : b.x, minY = b.minY !== undefined ? b.minY : b.y;
      const maxX = b.maxX !== undefined ? b.maxX : b.x + b.width, maxY = b.maxY !== undefined ? b.maxY : b.y + b.height;
      return { minX, minY, maxX, maxY };
    };
    const census = (label) => {
      const layer = findLayer(label);
      if (!layer) return { error: 'no layer ' + label };
      return {
        children: layer.children.length,
        items: layer.children.map((c) => {
          const r = rect(c);
          return {
            x: Math.round(c.x * 1e3) / 1e3, y: Math.round(c.y * 1e3) / 1e3,
            visible: c.visible === true, renderable: c.renderable !== false, alpha: c.alpha,
            minX: Math.round(r.minX * 1e3) / 1e3, minY: Math.round(r.minY * 1e3) / 1e3,
            maxX: Math.round(r.maxX * 1e3) / 1e3, maxY: Math.round(r.maxY * 1e3) / 1e3,
          };
        }),
      };
    };
    const pr = window.__planetRush || {};
    return {
      seam: pr.viewport ? { ...pr.viewport } : null,
      screen: { width: app.renderer.screen.width, height: app.renderer.screen.height },
      asteroids: census('asteroids'), chunks: census('chunks'), ships: census('ships'),
    };
  })()
`;

async function sampleBuild(build, profile) {
  const { server, port } = await serve(build.dist);
  const version = JSON.parse(readFileSync(join(build.dist, 'version.json'), 'utf8'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  // Pin time BEFORE the app boots, so every sim step is scripted, not raced.
  await page.clock.install({ time: new Date('2026-08-10T00:00:00Z') });
  await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction('!!globalThis.__qaApp', null, { timeout: 30000 });

  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    await page.clock.runFor(STEP_MS);
    const read = await page.evaluate(READ);
    read.atMs = (i + 1) * STEP_MS;
    samples.push(read);
  }

  await browser.close();
  server.close();
  return { label: build.label, buildSha: version.sha, samples };
}

const touches = (r, vp) => r.maxX >= vp.left && r.minX <= vp.right && r.maxY >= vp.top && r.minY <= vp.bottom;
const inside = (r, vp) => r.minX >= vp.left && r.maxX <= vp.right && r.minY >= vp.top && r.maxY <= vp.bottom;
const key = (i) => `${i.x.toFixed(2)},${i.y.toFixed(2)}`;
const posList = (c) => c.items.map((i) => key(i)).sort().join('|');

async function run() {
  const out = { profiles: {} };
  for (const profile of PROFILES) {
    const results = {};
    for (const build of BUILDS) results[build.label] = await sampleBuild(build, profile);

    const vp = { left: 0, top: 0, right: profile.width, bottom: profile.height };
    const rows = [];
    let missingTotal = 0, chunkTrueTotal = 0, straddleTotal = 0, divergent = 0, samplesWithChunks = 0;

    for (let i = 0; i < SAMPLES; i++) {
      const a = results['pre-cull'].samples[i];
      const b = results['served'].samples[i];
      // Determinism check: the two builds must agree on every rock position.
      const worldsAgree = posList(a.asteroids) === posList(b.asteroids);
      if (!worldsAgree) divergent++;

      const truth = a.chunks.items.filter((c) => touches(c, vp));
      const straddle = truth.filter((c) => !inside(c, vp));
      const drawn = b.chunks.items.filter((c) => c.visible && c.renderable && c.alpha > 0);
      const drawnKeys = new Set(drawn.map(key));
      const missing = worldsAgree ? truth.filter((c) => !drawnKeys.has(key(c))) : [];

      if (a.chunks.children > 0) samplesWithChunks++;
      chunkTrueTotal += truth.length;
      straddleTotal += straddle.length;
      missingTotal += missing.length;

      rows.push({
        atMs: a.atMs,
        worldsAgree,
        chunksInWorld: a.chunks.children,
        chunksVisibleTrue: truth.length,
        straddling: straddle.length,
        chunksDrawnServed: drawn.length,
        missing: missing.length,
        missingDetail: missing.map((c) => ({
          x: c.x, y: c.y,
          rect: [c.minX, c.minY, c.maxX, c.maxY],
          // The ship sits at the visible viewport's centre (camera.ts).
          pxFromShip: Math.round(Math.hypot((c.minX + c.maxX) / 2 - profile.width / 2, (c.minY + c.maxY) / 2 - profile.height / 2)),
        })),
      });
    }

    out.profiles[profile.name] = {
      pre: results['pre-cull'].buildSha,
      served: results['served'].buildSha,
      samples: rows,
      totals: {
        samples: SAMPLES,
        samplesWithChunksInWorld: samplesWithChunks,
        divergentSamples: divergent,
        chunksVisibleTrue: chunkTrueTotal,
        straddling: straddleTotal,
        missing: missingTotal,
      },
    };

    console.log(`\n=== ${profile.name} (${results['pre-cull'].buildSha} vs ${results['served'].buildSha}) ===`);
    console.log('  atMs  worldsAgree  inWorld  visibleTrue  straddling  drawnServed  MISSING');
    for (const r of rows)
      console.log(
        `${String(r.atMs).padStart(6)} ${String(r.worldsAgree).padStart(11)} ${String(r.chunksInWorld).padStart(8)} ${String(r.chunksVisibleTrue).padStart(12)} ${String(r.straddling).padStart(11)} ${String(r.chunksDrawnServed).padStart(12)} ${String(r.missing).padStart(8)}`,
      );
    const t = out.profiles[profile.name].totals;
    console.log(
      `  totals: ${t.chunksVisibleTrue} chunk-instances visible, ${t.straddling} straddling, ${t.missing} MISSING, ${t.divergentSamples} divergent samples`,
    );
  }

  writeFileSync(join(HERE, 'live-chunks.json'), JSON.stringify(out, null, 2));
  const missing = Object.values(out.profiles).reduce((n, p) => n + p.totals.missing, 0);
  console.log(`\n${missing === 0 ? 'CHUNK CULL INNOCENT — no visible chunk was dropped' : `CHUNK CULL DROPS ${missing}`}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
