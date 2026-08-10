/**
 * evidence/a1-15-cull-visible-rocks/mine-chunks.mjs — a1-15, the ore chunks.
 * OWNER: QA Manager.
 *
 * The rocks are settled by `census-drawn.mjs` on the frozen scene. The ore chunks
 * cannot be, and the reason is itself a finding worth stating: **the shipped game
 * has no chunks to cull until somebody mines.** `?freeze=1` pins the sim at
 * `FREEZE_TICK` 120 with empty inputs, and a chunk exists only once a mining beam
 * has chipped a rock (`src/sim/projectiles.ts` `spawnChunk`) or a rock has been
 * destroyed (`src/sim/damage.ts`). Every frozen profile reported `chunks
 * children=0` on both builds, and 40 s of live boot with no input added none —
 * nothing in the arena mines on its own. a1-12's headline "120 -> 0 chunks on the
 * phone" is a figure from `spikes/atlas-pooling/bench.ts`, which scatters 120
 * chunks across the whole arena as a synthetic load. It is the right number for a
 * bench and it is not a number the shipped game ever produces.
 *
 * So the chunks are tested the only way they exist: **by playing.** The probe
 * flies the ship at a rock and holds the mine button, on both builds, and the
 * input is issued against a PINNED CLOCK (`page.clock`) — every key press, every
 * mouse button and every sample lands at an exact sim time rather than whenever
 * the machine got round to it. Two builds given identical inputs at identical sim
 * times from the same seed step identically, so the comparison is exact rather
 * than approximate. Verified: the HUD's own MATCH clock advances exactly 5 s per
 * `runFor(5000)`.
 *
 * The measurement is the rocks' measurement, applied to chunks:
 *   VISIBLE_TRUE = chunks whose real drawn rect (pre-cull build, nothing culled)
 *                  intersects the visible viewport
 *   DRAWN        = chunks the served build left visible
 *   MISSING      = VISIBLE_TRUE \ DRAWN, matched by world position
 * and, because the brief calls a culled chunk near the ship a GAMEPLAY bug rather
 * than a cosmetic one, every chunk is also reported with its distance from the
 * ship, which sits at the visible viewport's centre (camera.ts).
 *
 *   node evidence/a1-15-cull-visible-rocks/mine-chunks.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const BUILDS = [
  { label: 'pre-cull', dist: '/tmp/pre-cull/dist' },
  { label: 'served', dist: resolve(HERE, '..', '..', 'dist') },
];

/** Desktop: the profile whose census located a minable rock 387 px from the ship. */
const PROFILE = { name: 'desktop-1280x800', width: 1280, height: 800 };
/** Where that rock sits on screen at t0 (from `census-pre-cull-111db86.json`). */
const TARGET = { x: 265, y: 302 };
/** Sim ms per sample, and how many samples. Long enough to mine, and to let the
 *  chunks drift and be collected, which is when they visit the screen edges. */
const STEP_MS = 3000;
const SAMPLES = 14;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json; charset=utf-8',
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
    const find = (l) => { let r = null; const w = (n, d) => { if (r || d > 24) return;
      for (const c of n.children || []) { if (c.label === l) { r = c; return; } w(c, d + 1); } }; w(app.stage, 0); return r; };
    const rect = (n) => { const b = n.getBounds();
      return { minX: b.minX !== undefined ? b.minX : b.x, minY: b.minY !== undefined ? b.minY : b.y,
               maxX: b.maxX !== undefined ? b.maxX : b.x + b.width, maxY: b.maxY !== undefined ? b.maxY : b.y + b.height }; };
    const census = (l) => { const layer = find(l); if (!layer) return { error: 'no layer ' + l };
      return { children: layer.children.length, items: layer.children.map((c) => { const r = rect(c);
        return { x: Math.round(c.x * 1e3) / 1e3, y: Math.round(c.y * 1e3) / 1e3,
                 visible: c.visible === true, renderable: c.renderable !== false, alpha: c.alpha,
                 minX: Math.round(r.minX * 1e3) / 1e3, minY: Math.round(r.minY * 1e3) / 1e3,
                 maxX: Math.round(r.maxX * 1e3) / 1e3, maxY: Math.round(r.maxY * 1e3) / 1e3 }; }) }; };
    const texts = []; const w = (n, d) => { if (d > 30) return; if (typeof n.text === 'string') texts.push(n.text);
      for (const c of n.children || []) w(c, d + 1); }; w(app.stage, 0);
    return { chunks: census('chunks'), asteroids: census('asteroids'), ships: census('ships'),
             hud: texts.filter((t) => /MATCH|ORE/.test(t)) };
  })()
`;

async function play(build, shotFile) {
  const { server, port } = await serve(build.dist);
  const version = JSON.parse(readFileSync(join(build.dist, 'version.json'), 'utf8'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: PROFILE.width, height: PROFILE.height },
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date('2026-08-10T00:00:00Z') });
  await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction('!!globalThis.__qaApp', null, { timeout: 30000 });

  // Aim at the rock, thrust toward it (up-left), and hold the mine button. The
  // whole run is issued before any clock advance, so both builds see the same
  // inputs at the same sim times.
  await page.mouse.move(TARGET.x, TARGET.y);
  await page.keyboard.down('a');
  await page.keyboard.down('w');
  await page.mouse.down({ button: 'left' });

  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    await page.clock.runFor(STEP_MS);
    await page.mouse.move(TARGET.x, TARGET.y); // keep the aim on the rock
    const read = await page.evaluate(READ);
    read.atMs = (i + 1) * STEP_MS;
    samples.push(read);
    if (read.chunks.children > 0 && !samples.shot) {
      await page.screenshot({ path: shotFile });
      samples.shot = true;
    }
  }

  await page.mouse.up({ button: 'left' });
  await page.keyboard.up('a');
  await page.keyboard.up('w');
  await browser.close();
  server.close();
  return { label: build.label, buildSha: version.sha, samples };
}

const touches = (r, vp) => r.maxX >= vp.left && r.minX <= vp.right && r.maxY >= vp.top && r.minY <= vp.bottom;
const insideR = (r, vp) => r.minX >= vp.left && r.maxX <= vp.right && r.minY >= vp.top && r.maxY <= vp.bottom;
const key = (i) => `${i.x.toFixed(2)},${i.y.toFixed(2)}`;
const fingerprint = (s) => s.ships.items.map((i) => key(i)).sort().join('|');

async function run() {
  mkdirSync(FRAMES, { recursive: true });
  const res = {};
  for (const b of BUILDS) res[b.label] = await play(b, join(FRAMES, `mining-${b.label}.png`));

  const vp = { left: 0, top: 0, right: PROFILE.width, bottom: PROFILE.height };
  const rows = [];
  let missing = 0, trueTotal = 0, straddleTotal = 0, divergent = 0, peakChunks = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const a = res['pre-cull'].samples[i];
    const b = res['served'].samples[i];
    // Determinism check: the two builds must agree on every ship position. Ships
    // are drawn on both builds and they MOVE, so they are a live fingerprint of
    // the world in a way the static rocks are not.
    const agree = fingerprint(a) === fingerprint(b);
    if (!agree) divergent++;

    const truth = a.chunks.items.filter((c) => touches(c, vp));
    const straddle = truth.filter((c) => !insideR(c, vp));
    const drawn = b.chunks.items.filter((c) => c.visible && c.renderable && c.alpha > 0);
    const drawnKeys = new Set(drawn.map(key));
    const miss = agree ? truth.filter((c) => !drawnKeys.has(key(c))) : [];

    peakChunks = Math.max(peakChunks, a.chunks.children);
    trueTotal += truth.length;
    straddleTotal += straddle.length;
    missing += miss.length;

    rows.push({
      atMs: a.atMs, worldsAgree: agree,
      chunksInWorld: a.chunks.children,
      chunksVisibleTrue: truth.length, straddling: straddle.length,
      chunksDrawnServed: drawn.length, missing: miss.length,
      nearestChunkToShipPx: truth.length
        ? Math.round(Math.min(...truth.map((c) => Math.hypot((c.minX + c.maxX) / 2 - vp.right / 2, (c.minY + c.maxY) / 2 - vp.bottom / 2))))
        : null,
      missingDetail: miss.map((c) => ({ x: c.x, y: c.y, rect: [c.minX, c.minY, c.maxX, c.maxY] })),
      hud: a.hud,
    });
  }

  const out = {
    profile: PROFILE.name, pre: res['pre-cull'].buildSha, served: res['served'].buildSha,
    target: TARGET, stepMs: STEP_MS, samples: rows,
    totals: { samples: SAMPLES, peakChunksInWorld: peakChunks, chunksVisibleTrue: trueTotal,
              straddling: straddleTotal, missing, divergentSamples: divergent },
  };
  writeFileSync(join(HERE, 'mine-chunks.json'), JSON.stringify(out, null, 2));

  console.log(`${out.pre} (pre-cull) vs ${out.served} (served) — ${PROFILE.name}\n`);
  console.log('  atMs  agree  inWorld  visibleTrue  straddling  drawnServed  MISSING  nearestToShip  HUD');
  for (const r of rows)
    console.log(
      `${String(r.atMs).padStart(6)} ${String(r.worldsAgree).padStart(6)} ${String(r.chunksInWorld).padStart(8)} ${String(r.chunksVisibleTrue).padStart(12)} ${String(r.straddling).padStart(11)} ${String(r.chunksDrawnServed).padStart(12)} ${String(r.missing).padStart(8)} ${String(r.nearestChunkToShipPx ?? '-').padStart(14)}  ${r.hud.join(' ')}`,
    );
  const t = out.totals;
  console.log(
    `\npeak chunks in world: ${t.peakChunksInWorld}; chunk-instances visible: ${t.chunksVisibleTrue}; straddling: ${t.straddling}; divergent samples: ${t.divergentSamples}`,
  );
  console.log(t.missing === 0 ? 'CHUNK CULL INNOCENT — no visible chunk was dropped' : `CHUNK CULL DROPS ${t.missing}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
