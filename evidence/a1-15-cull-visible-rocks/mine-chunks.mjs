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
/**
 * Where to aim, in screen px. **Read off the LIVE frame, not off the frozen
 * census.** The first run of this probe took the target from
 * `census-pre-cull-111db86.json`, which is the world at FREEZE_TICK 120 — a
 * different arrangement from the live match this probe actually plays. It aimed
 * at empty space for 44 seconds and mined nothing; the committed frame
 * `frames/mining-served.png` shows the tutorial hint "Hold Left mouse on the
 * asteroid" still up at MATCH 0:04, which is what that mistake looks like. This
 * is a rock roughly 190 px from the ship in the live scene, with the ship at the
 * visible viewport's centre (640, 400).
 */
const TARGET = { x: 605, y: 590 };
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

  // Aim at the rock and hold the mine button. No thrust: the rock is already
  // within reach, and thrusting only carries the ship (and the camera with it)
  // away from the ore it is about to chip.
  await page.mouse.move(TARGET.x, TARGET.y);
  await page.mouse.down({ button: 'left' });

  const samples = [];
  let shot = false;
  for (let i = 0; i < SAMPLES; i++) {
    await page.clock.runFor(STEP_MS);
    await page.mouse.move(TARGET.x, TARGET.y); // keep the aim on the rock
    const read = await page.evaluate(READ);
    read.atMs = (i + 1) * STEP_MS;
    samples.push(read);
    // Shoot the frame the moment a chunk is actually DRAWN — a pooled slot that
    // merely exists proves nothing, and shooting on `children > 0` is what made
    // the first run's frame a picture of an unstarted mine.
    const drawnNow = read.chunks.items.filter(
      (c) => c.visible && c.renderable && c.alpha > 0 && !(c.minX === 0 && c.minY === 0 && c.maxX === 0 && c.maxY === 0),
    ).length;
    read.drawnNow = drawnNow;
    if (drawnNow > 0 && !shot) {
      await page.screenshot({ path: shotFile });
      shot = true;
    }
  }

  await page.mouse.up({ button: 'left' });
  await browser.close();
  server.close();
  return { label: build.label, buildSha: version.sha, samples };
}

const touches = (r, vp) => r.maxX >= vp.left && r.minX <= vp.right && r.maxY >= vp.top && r.minY <= vp.bottom;
const insideR = (r, vp) => r.minX >= vp.left && r.maxX <= vp.right && r.minY >= vp.top && r.maxY <= vp.bottom;
const key = (i) => `${i.x.toFixed(2)},${i.y.toFixed(2)}`;

/**
 * A body whose bounds are an empty rect AT THE ORIGIN has no geometry this frame
 * — a pooled display object that exists but has never been drawn. Its `getBounds()`
 * is `(0,0,0,0)`, which trivially "touches" any viewport anchored at 0,0 and would
 * be counted as a visible body that the other build failed to draw. That is a
 * false positive, and it is exactly the one this probe hit on its first run:
 * every chunk reported a distance-to-ship of 755 px, which is precisely the
 * half-diagonal of 1280x800 — i.e. the screen centre measured to the origin.
 */
const degenerate = (r) => r.minX === 0 && r.minY === 0 && r.maxX === 0 && r.maxY === 0;
const real = (items) => items.filter((i) => !degenerate(i));

/**
 * The live world fingerprint. VISIBLE ships only: the served build culls, so an
 * off-screen ship keeps a stale transform on a hidden display object, and
 * comparing all children would report a divergence that is only the cull doing
 * its job. Comparing the drawn ones asks whether the two builds are drawing the
 * same world, which is the question.
 */
const fingerprint = (s) =>
  real(s.ships.items.filter((i) => i.visible && i.renderable))
    .map((i) => key(i))
    .sort()
    .join('|');

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

    // Ground truth: a chunk the PRE-CULL build actually DREW, whose rect reaches
    // the viewport. The `visible` test matters here in a way it did not for the
    // rocks: the pre-cull build draws every rock, but it hides the chunk slots
    // above the live chunk count (`hideFrom`), and a hidden leftover slot keeps
    // real geometry at a stale position — which would otherwise be counted as a
    // visible chunk the served build had failed to draw.
    const truth = real(a.chunks.items).filter((c) => c.visible && c.renderable && c.alpha > 0 && touches(c, vp));
    const straddle = truth.filter((c) => !insideR(c, vp));
    const drawn = real(b.chunks.items).filter((c) => c.visible && c.renderable && c.alpha > 0);
    const drawnKeys = new Set(drawn.map(key));
    const miss = agree ? truth.filter((c) => !drawnKeys.has(key(c))) : [];

    peakChunks = Math.max(peakChunks, a.chunks.children);
    trueTotal += truth.length;
    straddleTotal += straddle.length;
    missing += miss.length;

    rows.push({
      atMs: a.atMs, worldsAgree: agree,
      chunksInWorld: a.chunks.children,
      chunkObjectsServed: b.chunks.children,
      chunksRealPre: real(a.chunks.items).length,
      chunksRealServed: real(b.chunks.items).length,
      shipsDrawnPre: real(a.ships.items.filter((s) => s.visible)).length,
      shipsDrawnServed: real(b.ships.items.filter((s) => s.visible)).length,
      hudServed: b.hud,
      rawPre: real(a.chunks.items),
      rawServed: real(b.chunks.items),
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
  console.log('  atMs  agree  chunkObjs(pre/served)  realGeom(pre/served)  visibleTrue  drawnServed  MISSING  ships(pre/served)  HUD pre | served');
  for (const r of rows)
    console.log(
      `${String(r.atMs).padStart(6)} ${String(r.worldsAgree).padStart(6)} ${String(r.chunksInWorld + '/' + r.chunkObjectsServed).padStart(22)} ${String(r.chunksRealPre + '/' + r.chunksRealServed).padStart(21)} ${String(r.chunksVisibleTrue).padStart(12)} ${String(r.chunksDrawnServed).padStart(12)} ${String(r.missing).padStart(8)} ${String(r.shipsDrawnPre + '/' + r.shipsDrawnServed).padStart(18)}  ${r.hud.join(' ')} | ${r.hudServed.join(' ')}`,
    );
  const t = out.totals;
  console.log(
    `\npeak chunks in world: ${t.peakChunksInWorld}; chunk-instances visible: ${t.chunksVisibleTrue}; straddling: ${t.straddling}; divergent samples: ${t.divergentSamples}`,
  );
  // MISSING is only meaningful on samples where the two builds agree about the
  // world. Reporting "0 missing" over samples that diverged would be reporting
  // the guard, not the cull — the first run of this probe did exactly that.
  const usable = rows.filter((r) => r.worldsAgree).length;
  if (usable === 0) console.log('INCONCLUSIVE — no sample had the two builds on the same world; nothing is compared');
  else if (t.missing === 0)
    console.log(`CHUNK CULL INNOCENT on ${usable}/${SAMPLES} comparable samples — no visible chunk was dropped`);
  else console.log(`CHUNK CULL DROPS ${t.missing} over ${usable}/${SAMPLES} comparable samples`);
}

run().catch((e) => { console.error(e); process.exit(1); });
