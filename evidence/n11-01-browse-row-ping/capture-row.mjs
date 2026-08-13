/**
 * evidence/n11-01-browse-row-ping/capture-row.mjs — THE BROWSE ROW'S PING, on the
 * real fleet, at 390 px landscape. OWNER: Netcode Engineer (n11-01).
 *
 * a1-17 photographed a row that read `IAD —` and asked why the browse list is
 * handed no ping. The answer is a RACE, not a missing wire: the listing lands in
 * ~0.6 s and the region survey answered only after its LAST sample, so for about a
 * second the row had a region and no number. This script measures that second on
 * both builds, against the same live fleet, minutes apart, interleaved:
 *
 *   BEFORE — the DEPLOYED build (GitHub Pages), the bundle a1-17 shot.
 *   AFTER  — this branch, built here and served from `vite preview`, in which the
 *            survey publishes each completed ROUND instead of only its last.
 *
 * Two numbers are recorded per guest, and the second is the one that matters:
 *
 *   • **wall clock** — ms between the row being drawn and the row carrying a ping.
 *     Honest, and noisy: this is a shared lane container on a residential ISP, so
 *     it is reported as a median over three interleaved runs per build.
 *   • **probe requests completed when the number appeared** — counted from the
 *     browser's own network events. Noise-free, because it counts the SCHEDULE
 *     rather than the weather: 1 warm-up + 3 samples × 2 regions = 7 requests for
 *     a whole survey, against 1 + 2 = 3 for a first round. That number is the
 *     mechanism, and no amount of latency moves it.
 *
 * Nothing is mocked. The room the guest browses is a real room hosted by a second
 * real client on the live fleet, and the ping on the row is a round trip this
 * machine timed against the gameserver's own `/health`.
 *
 *   node evidence/n11-01-browse-row-ping/capture-row.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const IMAGES = resolve(ROOT, 'evidence', 'images');
const ALLOCATOR = process.env.N11_ALLOCATOR ?? 'https://planet-rush-allocator.fly.dev';
const DEPLOYED = process.env.N11_DEPLOYED ?? 'https://imaginethegames.github.io/planet-rush/';
const OUT_DIR = 'dist-n11-01';
const PORT = Number(process.env.N11_PORT ?? 4319);
const LOCAL = `http://127.0.0.1:${PORT}/`;
const RUNS = Number(process.env.N11_RUNS ?? 3);

/** The developer's phone, held the way they play (`tests/browse`): 844×390. */
const PHONE_LANDSCAPE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
/** The host is a second client and is never photographed; a desktop is simplest. */
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
mkdirSync(IMAGES, { recursive: true });

// ---------------------------------------------------------------------------
// Build this branch, and serve it. The deployed build needs neither.
// ---------------------------------------------------------------------------

function run(cmd, args, env) {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))));
  });
}

async function buildAndServe() {
  console.log(`building ${OUT_DIR} with the LIVE allocator baked in…`);
  await run('npx', ['vite', 'build', '--outDir', OUT_DIR, '--emptyOutDir'], { VITE_ALLOCATOR_URL: ALLOCATOR });
  if (!existsSync(resolve(ROOT, OUT_DIR, 'index.html'))) throw new Error('the build produced no index.html');
  // vite's own binary, not `npx`: a direct child is one this script can actually
  // kill, and `--host 127.0.0.1` because the default binds IPv6 `localhost` only.
  const server = spawn(
    resolve(ROOT, 'node_modules', '.bin', 'vite'),
    ['preview', '--outDir', OUT_DIR, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(LOCAL)).ok) return server;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`the preview server never answered on ${LOCAL}`);
}

/**
 * The bundle the browser will actually run must carry the live allocator's URL —
 * a served build that does not is a screenshot of nothing.
 *
 * Every asset the page pulls is checked, not just the entry: the entry chunk is
 * about a kilobyte and the client lives in `main-*.js`, so looking only at
 * `index-*.js` answers "no" for a build that is perfectly correct.
 */
async function servedSourceCheck(base) {
  const html = await (await fetch(base)).text();
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => new URL(m[1], base).href);
  if (refs.length === 0) throw new Error(`no bundle referenced by ${base}`);
  const checked = [];
  for (const url of refs) {
    const js = await (await fetch(url)).text();
    checked.push({ url, bytes: js.length, carriesAllocator: js.includes(ALLOCATOR) });
    // The entry imports the rest; follow one hop so `main-*.js` is reached.
    for (const m of js.matchAll(/["'](\.\/[^"']+\.js)["']/g)) {
      const next = new URL(m[1], url).href;
      if (checked.some((c) => c.url === next) || refs.includes(next)) continue;
      const child = await (await fetch(next)).text();
      checked.push({ url: next, bytes: child.length, carriesAllocator: child.includes(ALLOCATOR) });
    }
  }
  return { base, assets: checked, allocatorBakedIn: checked.some((c) => c.carriesAllocator) };
}

/**
 * What the fleet costs from THIS machine, measured the way `region-probe` does it
 * — one region at a time, min of N, against the same `/health` — but from node,
 * outside every browser. It is the reference the browser's own numbers are read
 * against: a container sharing six cores with two other lanes inflates them, and
 * a reader deserves to know by how much.
 */
async function baselinePings() {
  const out = {};
  const regions = (await (await fetch(`${ALLOCATOR}/regions`)).json()).regions ?? [];
  for (const r of regions) {
    if (!r.probe?.url) continue;
    let best = null;
    for (let i = 0; i < 4; i++) {
      const t0 = performance.now();
      try {
        const res = await fetch(r.probe.url, { headers: r.probe.headers ?? {} });
        await res.json();
      } catch {
        continue;
      }
      const ms = Math.round(performance.now() - t0);
      // The first sample pays TLS; min-of-N sheds it, exactly as the client does.
      if (best === null || ms < best) best = ms;
    }
    out[r.region] = best;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The clients
// ---------------------------------------------------------------------------

const browser = await chromium.launch();

async function boot(base, device, label) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.clear());
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${label} console.error] ${m.text()}`);
  });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.screen === 'string', undefined, { timeout: 40_000 });
  return { ctx, page };
}

/** Press a control where the CLIENT says it drew it — never a seam method: a seam
 *  that opens the thing under test cannot also witness that it opened. */
async function press(page, which, kind, touch) {
  const box = await page.locator('canvas').boundingBox();
  const at = await page.evaluate(
    ({ which, kind }) => {
      const list = which === 'menu' ? window.__mainMenu?.controls : window.__onlineMenu?.doorControls;
      const c = (list ?? []).find((x) => x.kind === kind);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    { which, kind },
  );
  if (!at) throw new Error(`no ${which} control of kind ${kind}`);
  if (touch) await page.touchscreen.tap(box.x + at.x, box.y + at.y);
  else await page.mouse.click(box.x + at.x, box.y + at.y);
  return at;
}

/** Crop a rect out of a screenshot and blow it up, so a row is readable as an
 *  image rather than as a claim about one. */
function zoomCrop(srcPath, rect, factor, dstPath) {
  const src = PNG.sync.read(readFileSync(srcPath));
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.min(Math.ceil(rect.width), src.width - x0));
  const h = Math.max(1, Math.min(Math.ceil(rect.height), src.height - y0));
  const dst = new PNG({ width: w * factor, height: h * factor });
  for (let y = 0; y < h * factor; y += 1) {
    for (let x = 0; x < w * factor; x += 1) {
      const si = (src.width * (y0 + Math.floor(y / factor)) + (x0 + Math.floor(x / factor))) << 2;
      const di = (dst.width * y + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
  writeFileSync(dstPath, PNG.sync.write(dst));
  return { x: x0, y: y0, width: w, height: h, factor };
}

/**
 * THE PHOTOGRAPHS, taken on this branch's build with the measurement runs over
 * and the second host shut down — every screenshot here is of a quiet machine.
 *
 * Three frames, and the middle one is the one the brief asks to be *shown* rather
 * than described:
 *
 *   • `…-row-unmeasured` — the browser winning the race. This guest's probes are
 *     held at the network for {@link HOLD_MS}, so the listing is drawn while the
 *     fleet is genuinely untimed: the row prints its region and NO number, which
 *     is the same thing a region that cannot be measured at all prints. Absent,
 *     never zero, in both cases (region-probe rule 1).
 *   • `…-row-ping` — the same row, the same client, once the first round lands.
 *   • `…-row-settled` — after the whole survey: the min-of-N has settled, so this
 *     is the number the picker on the doors prints too, and both are photographed
 *     in the same frame's readback so they can be checked against each other.
 */
const HOLD_MS = 4000;

async function photograph(base, tag, room) {
  const out = { base, tag, room };

  // (1) the row before any measurement exists — probes held at the wire.
  const held = await boot(base, PHONE_LANDSCAPE, `${tag}:held`);
  await held.page.route(/\/health/, async (route) => {
    await sleep(HOLD_MS);
    await route.continue();
  });
  await press(held.page, 'menu', 'play', true);
  await held.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  await press(held.page, 'doors', 'join', true);
  for (let i = 0; i < 60; i++) {
    const rows = await held.page.evaluate(() => (window.__onlineMenu?.browseRows ?? []).length);
    if (rows > 0) break;
    await sleep(100);
  }
  out.unmeasured = await held.page.evaluate(() => ({
    regions: window.__onlineMenu?.regions ?? [],
    regionLine: window.__onlineMenu?.regionLine ?? '',
    rows: (window.__onlineMenu?.browseRows ?? []).map((r) => ({ owner: r.owner, meta: r.meta, where: r.where, bounds: r.physicalBounds })),
  }));
  const heldFrame = resolve(IMAGES, `n11-01-${tag}-row-unmeasured.png`);
  await held.page.screenshot({ path: heldFrame });
  out.unmeasured.frame = heldFrame;
  await held.ctx.close();

  // (2) and (3) the same row on a clean guest: the first number, then the settled one.
  const guest = await boot(base, PHONE_LANDSCAPE, `${tag}:photo`);
  await press(guest.page, 'menu', 'play', true);
  await guest.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  await press(guest.page, 'doors', 'join', true);
  const read = () =>
    guest.page.evaluate(() => ({
      regions: window.__onlineMenu?.regions ?? [],
      rows: (window.__onlineMenu?.browseRows ?? []).map((r) => ({ owner: r.owner, meta: r.meta, where: r.where, bounds: r.physicalBounds })),
    }));
  for (let i = 0; i < 200; i++) {
    const state = await read();
    if (state.rows[0] && /\d+\s*ms/i.test(state.rows[0].where)) {
      out.firstNumber = state;
      const frame = resolve(IMAGES, `n11-01-${tag}-row-ping.png`);
      await guest.page.screenshot({ path: frame });
      out.firstNumber.frame = frame;
      break;
    }
    await sleep(50);
  }
  // Let the survey finish: min-of-N only ever lowers a number, and the settled one
  // is what the doors' own picker is printing beside it.
  await sleep(6000);
  out.settled = await read();
  out.settled.regionLine = await guest.page.evaluate(() => window.__onlineMenu?.regionLine ?? '');
  const settledFrame = resolve(IMAGES, `n11-01-${tag}-row-settled.png`);
  await guest.page.screenshot({ path: settledFrame });
  out.settled.frame = settledFrame;
  await guest.ctx.close();

  // The crops, at the scale a1-17's row is published at.
  const dpr = PHONE_LANDSCAPE.deviceScaleFactor;
  const crop = (frame, bounds, name) =>
    zoomCrop(
      frame,
      { x: bounds.x * dpr, y: bounds.y * dpr, width: bounds.width * dpr, height: bounds.height * dpr },
      2,
      resolve(IMAGES, name),
    );
  for (const [key, name] of [
    ['unmeasured', `n11-01-${tag}-row-unmeasured-zoom.png`],
    ['firstNumber', `n11-01-${tag}-row-ping-zoom.png`],
    ['settled', `n11-01-${tag}-row-settled-zoom.png`],
  ]) {
    const state = out[key];
    if (state?.frame && state.rows[0]) state.crop = crop(state.frame, state.rows[0].bounds, name);
  }
  console.log(`[${tag}] photographed: unmeasured "${out.unmeasured.rows[0]?.where}" → settled "${out.settled.rows[0]?.where}"`);
  return out;
}

/** Host a real room on one build and stay in its lobby, so the room keeps being
 *  heartbeat-confirmed for as long as the guests are browsing. */
async function hostARoom(base, tag) {
  const host = await boot(base, DESKTOP, `${tag}:host`);
  await press(host.page, 'menu', 'play', false);
  await host.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  await press(host.page, 'doors', 'create', false);
  for (let i = 0; i < 120; i++) {
    if (await host.page.evaluate(() => window.__lobby?.visible === true)) break;
    await sleep(500);
  }
  const room = await host.page.evaluate(() => window.__lobby?.room ?? null);
  if (room === null) throw new Error(`[${tag}] the host never reached a lobby — no room to browse for`);
  console.log(`[${tag}] hosting room ${room}`);
  return { ...host, room };
}

/**
 * ONE guest: a phone in landscape, PLAY → JOIN, watching the row it is handed.
 *
 * `shoot` asks for the two frames — the row as first drawn, and the row once it
 * carries a number — which only the last run of each build bothers with.
 */
async function browseOnce(base, tag, shoot) {
  const guest = await boot(base, PHONE_LANDSCAPE, `${tag}:guest`);
  // The probe's own requests, counted from the browser's network events. This is
  // the schedule, and it is the same on any network.
  let probes = 0;
  guest.page.on('requestfinished', (req) => {
    if (req.url().includes('/health')) probes += 1;
  });

  const t0 = Date.now();
  await press(guest.page, 'menu', 'play', true);
  await guest.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  await press(guest.page, 'doors', 'join', true);

  const out = { base, tag, samples: [] };
  for (let i = 0; i < 300 && out.firstPing === undefined; i++) {
    const state = await guest.page.evaluate(() => ({
      regions: (window.__onlineMenu?.regions ?? []).map((r) => ({ id: r.id, pingMs: r.pingMs })),
      rows: (window.__onlineMenu?.browseRows ?? []).map((r) => ({
        owner: r.owner,
        meta: r.meta,
        where: r.where,
        bounds: r.physicalBounds,
      })),
      stamp: window.__onlineMenu?.browseStamp ?? null,
    }));
    const at = Date.now() - t0;
    out.samples.push({ at, probes, regions: state.regions, rows: state.rows.map((r) => `${r.owner}|${r.where}`) });
    if (state.regions.length > 0 && out.firstRegions === undefined) {
      out.firstRegions = { at, probes, regions: state.regions };
    }
    const row = state.rows[0];
    if (row && out.firstRow === undefined) {
      out.firstRow = { at, probes, where: row.where, rows: state.rows.length };
      if (shoot) {
        const frame = resolve(IMAGES, `n11-01-${tag}-row-first.png`);
        await guest.page.screenshot({ path: frame });
        out.firstRow.frame = frame;
        out.firstRow.bounds = row.bounds;
      }
    }
    if (row && /\d+\s*ms/i.test(row.where) && out.firstPing === undefined) {
      out.firstPing = { at, probes, where: row.where, rows: state.rows.map((r) => r.where) };
      if (shoot) {
        const frame = resolve(IMAGES, `n11-01-${tag}-row-ping.png`);
        await guest.page.screenshot({ path: frame });
        out.firstPing.frame = frame;
        out.firstPing.bounds = row.bounds;
      }
    }
    await sleep(50);
  }
  out.dashMs = out.firstRow && out.firstPing ? out.firstPing.at - out.firstRow.at : null;

  if (shoot) {
    const dpr = PHONE_LANDSCAPE.deviceScaleFactor;
    const crop = (shot, bounds, name) =>
      zoomCrop(
        shot,
        { x: bounds.x * dpr, y: bounds.y * dpr, width: bounds.width * dpr, height: bounds.height * dpr },
        2,
        resolve(IMAGES, name),
      );
    if (out.firstRow?.frame) out.firstRow.crop = crop(out.firstRow.frame, out.firstRow.bounds, `n11-01-${tag}-row-first-zoom.png`);
    if (out.firstPing?.frame) out.firstPing.crop = crop(out.firstPing.frame, out.firstPing.bounds, `n11-01-${tag}-row-ping-zoom.png`);
  }
  await guest.ctx.close();
  console.log(
    `[${tag}] row @${out.firstRow?.at}ms "${out.firstRow?.where}" → ping @${out.firstPing?.at}ms ` +
      `"${out.firstPing?.where}" after ${out.firstPing?.probes} probe requests (dash for ${out.dashMs}ms)`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// Both builds, same fleet, same machine, interleaved
// ---------------------------------------------------------------------------

const readback = {
  capturedAt: new Date().toISOString(),
  allocator: ALLOCATOR,
  allocatorHealth: await (await fetch(`${ALLOCATOR}/health`)).json(),
  fleetRegions: await (await fetch(`${ALLOCATOR}/regions`)).json(),
  baselinePingsFromNode: await baselinePings(),
  note: 'BEFORE is the deployed build (a1-17s bundle); AFTER is this branch, built here and served locally. Same live allocator, same live gameservers, interleaved guests.',
};

let server = null;
let hosts = [];
try {
  readback.before = { source: 'the DEPLOYED build — the bundle a1-17 photographed', ...(await servedSourceCheck(DEPLOYED)) };
  server = await buildAndServe();
  readback.after = { source: 'THIS BRANCH, built here and served locally', ...(await servedSourceCheck(LOCAL)) };

  const beforeHost = await hostARoom(DEPLOYED, 'before');
  const afterHost = await hostARoom(LOCAL, 'after');
  hosts = [beforeHost, afterHost];
  readback.rooms = { before: beforeHost.room, after: afterHost.room };

  // A room is listed only once its gameserver's heartbeat has confirmed it (5 s).
  for (let i = 0; i < 20; i++) {
    readback.allocatorRooms = await (await fetch(`${ALLOCATOR}/rooms`)).json();
    if ((readback.allocatorRooms.rooms ?? []).length >= 2) break;
    await sleep(1000);
  }

  readback.runs = [];
  for (let i = 0; i < RUNS; i++) {
    const last = i === RUNS - 1;
    readback.runs.push(await browseOnce(DEPLOYED, last ? 'before' : `before-${i + 1}`, last));
    readback.runs.push(await browseOnce(LOCAL, last ? 'after' : `after-${i + 1}`, last));
  }

  // The photographs come last, with the deployed build's host shut down: a ping
  // measured while four Chromiums render a starfield is a ping this container
  // paid for, not one the fleet charged.
  await beforeHost.ctx.close();
  hosts = [afterHost];
  readback.photos = await photograph(LOCAL, 'after', afterHost.room);

  const of = (base) => readback.runs.filter((r) => r.base === base);
  readback.summary = {
    before: {
      dashMsPerRun: of(DEPLOYED).map((r) => r.dashMs),
      medianDashMs: median(of(DEPLOYED).map((r) => r.dashMs)),
      probesWhenTheNumberAppeared: of(DEPLOYED).map((r) => r.firstPing?.probes ?? null),
    },
    after: {
      dashMsPerRun: of(LOCAL).map((r) => r.dashMs),
      medianDashMs: median(of(LOCAL).map((r) => r.dashMs)),
      probesWhenTheNumberAppeared: of(LOCAL).map((r) => r.firstPing?.probes ?? null),
    },
  };
} finally {
  for (const h of hosts) await h.ctx.close().catch(() => undefined);
  await browser.close();
  if (server) server.kill();
}

writeFileSync(resolve(HERE, 'readback-row.json'), `${JSON.stringify(readback, null, 2)}\n`);
console.log('\n--- the row, before and after -------------------------------------');
console.log(JSON.stringify(readback.summary, null, 2));
