/**
 * spikes/atlas-pooling/run.mjs — drives `bench.html` and prints the numbers.
 * OWNER: Platform Engineer (a1-10).
 *
 *   node spikes/atlas-pooling/run.mjs                 # measure, print a table
 *   node spikes/atlas-pooling/run.mjs --json out.json # …and keep the raw payload
 *   node spikes/atlas-pooling/run.mjs --headed        # watch it draw
 *
 * Starts the Vite **dev** server (the bench is not part of the production build
 * and must never become part of it), opens the rig in Chromium with the vsync
 * cap off, and waits for `window.__atlasBench`.
 *
 * `--disable-gpu-vsync` / `--disable-frame-rate-limit` are the whole reason this
 * is a script and not a Playwright project: with vsync on, every path that fits
 * inside 16.67 ms reports exactly 16.67 ms and the comparison says nothing. Off,
 * a `requestAnimationFrame` delta is the frame's real cost.
 *
 * This is an instrument, not a gate. It asserts nothing and fails only if the
 * page itself failed — the numbers are the output, and the decision they support
 * lives in `docs/atlas-pooling-measured.md`.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';

/**
 * A port nothing else is holding.
 *
 * It used to be a hard-coded 5183 with `--strictPort`, and a1-12 lost a capture
 * to exactly that: a **stale vite from an earlier session** still held the port,
 * the new one exited with "Port 5183 is already in use", and the run navigated
 * to the survivor and measured ITS module graph — printing a1-11's baselines
 * over a1-12's code, plausibly and silently. That is the same class of failure
 * the goldens' `reuseExistingServer` note is about, and the instrument has to be
 * immune to it rather than the operator vigilant about it.
 *
 * Two defences, because the port is only half of it: bind an ephemeral port here
 * so a survivor cannot collide with us at all, and refuse to report a payload
 * that did not come from THIS rig (see `RIG_MARKER` below).
 */
async function freePort() {
  if (process.env.BENCH_PORT) return Number(process.env.BENCH_PORT);
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const PORT = await freePort(); // never 5173: leave the developer's own `npm run dev` alone
const URL = `http://localhost:${PORT}/spikes/atlas-pooling/bench.html`;

/** A field only this revision of `bench.ts` emits. A payload without it came
 *  from some other build of the rig, and reporting it as this run's numbers is
 *  worse than reporting nothing. */
const RIG_MARKER = 'baselines';
const headed = process.argv.includes('--headed');
const jsonAt = process.argv[process.argv.indexOf('--json') + 1];
const wantJson = process.argv.includes('--json') && jsonAt && !jsonAt.startsWith('--');

/**
 * Start `vite` in its own **process group**, so we can always kill it again.
 *
 * `detached: true` is the whole point and it is not decoration. `npx` spawns a
 * shell which spawns node-vite, so killing the pid we hold kills the wrapper and
 * orphans the server: a1-12 found one from an *earlier session* still holding
 * the port, and found the current run hanging after its own numbers were printed
 * because the orphan had inherited stdout and nothing downstream ever saw EOF.
 * A group kill (`-pid`) takes the shell and the server together.
 */
function startVite() {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  proc.on('exit', (code) => {
    proc.exitedWith = code;
  });
  return proc;
}

/** SIGKILL the whole server group. Falls back to the single pid if the group is
 *  already gone, and never throws — this runs in a `finally`. */
function killVite(proc) {
  for (const target of [-proc.pid, proc.pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      /* already dead */
    }
  }
}

/** Give a failing vite a moment to report itself before we try to load a page.
 *  Without this the first `goto` can win the race against the `exit` event and
 *  we happily measure whatever else is answering on that port. */
function settle(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Navigate, retrying until the dev server answers.
 *
 * Readiness is polled with **the browser**, not with node's `fetch` and not by
 * sniffing vite's banner. Both of those were tried and both lie here: `fetch`
 * resolves `localhost` differently from Chromium and spent 90 s refusing a
 * server that was up and serving 200 to curl, and the banner prints before the
 * socket is reliably accepting. The only client whose opinion matters is the one
 * that has to load the page.
 */
async function gotoWhenReady(page, proc) {
  const deadline = Date.now() + 120_000;
  for (let attempt = 1; ; attempt++) {
    if (proc.exitedWith != null) throw new Error(`vite exited with ${proc.exitedWith}`);
    if (Date.now() > deadline) throw new Error(`vite never served ${URL}`);
    try {
      await page.goto(URL, { waitUntil: 'load', timeout: 15_000 });
      return;
    } catch (err) {
      if (attempt % 5 === 0) console.log(`  …waiting for ${URL} (${String(err).split('\n')[0]})`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

function pad(s, n) {
  return String(s).padEnd(n);
}
function num(v, n = 2) {
  return typeof v === 'number' ? v.toFixed(n) : String(v);
}

function table(payload) {
  const lines = [];
  lines.push(`box        : ${payload.gpu}`);
  lines.push(`viewport   : ${payload.view.width}×${payload.view.height} @dpr1`);
  lines.push(`scene      : ${JSON.stringify(payload.scene)}`);
  lines.push(`sampling   : ${payload.frames} frames × ${payload.rounds} rounds (round 1 discarded)`);
  lines.push('');

  lines.push('-- baseline: the SHIPPED renderer on the GDD §4.3 stress scene --');
  // `baselines` is a1-12's array (every screen × VFX tier); the two named keys
  // are a1-10's desktop pair, kept so older captures still print.
  const shipped = payload.baselines ?? [payload.baseline, payload.baselineReduced].filter(Boolean);
  for (const b of shipped) {
    lines.push(
      `  ${pad(b.name, 38)} ${b.entities} entities, ${b.drawn} submitted · median ${num(b.stats.median)} ms ` +
        `(${num(b.stats.fps, 1)} fps) · p95 ${num(b.stats.p95)} · ` +
        `${num(b.drawCallsPerFrame, 1)} draw calls/frame · ` +
        `VfxAutoQuality would engage: ${b.vfxWouldEngage ? 'YES' : 'no'}`,
    );
  }
  if (payload.baseline && payload.baselineReduced) {
    const bought = payload.baseline.stats.median - payload.baselineReduced.stats.median;
    const pctOf = (bought / payload.baseline.stats.median) * 100;
    lines.push(
      `  → engaging reduce-VFX buys back ${num(bought)} ms of ${num(payload.baseline.stats.median)} ms ` +
        `(${num(pctOf, 1)}% of the frame)`,
    );
  }
  lines.push('');

  // Every scenario pays the same clear+present at 1280×800, so quoting raw
  // medians would flatter whichever path sits closest to that floor. The column
  // that decides anything is `layer ms` — the median with the floor removed.
  const floor = payload.results.find((r) => r.name.startsWith('floor'))?.stats.median ?? 0;

  lines.push(`-- A/B: the same layer, several ways (empty-stage floor: ${num(floor)} ms) --`);
  lines.push(
    `  ${pad('scenario', 22)}${pad('n', 5)}${pad('drawn', 7)}${pad('pooled', 8)}${pad('draws/f', 9)}` +
      `${pad('median', 9)}${pad('layer ms', 10)}${pad('fps', 7)}`,
  );
  for (const r of payload.results) {
    const marginal = r.stats.median - floor;
    lines.push(
      `  ${pad(r.name, 22)}${pad(r.entities, 5)}${pad(r.drawn, 7)}${pad(r.pooled, 8)}${pad(num(r.drawCallsPerFrame, 1), 9)}` +
        `${pad(num(r.stats.median), 9)}${pad(num(marginal > 0 ? marginal : 0), 10)}${pad(num(r.stats.fps, 1), 7)}`,
    );
  }
  return lines.join('\n');
}

const vite = startVite();
let exitCode = 0;
try {
  const browser = await chromium.launch({
    headless: !headed,
    args: [
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--enable-precise-memory-info',
      // rAF must keep firing when the window is not foregrounded.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[page]', m.text());
  });
  page.on('pageerror', (e) => console.error('[page error]', e.message));

  console.log(`bench → ${URL}`);
  await settle(1500);
  if (vite.exitedWith != null) throw new Error(`vite exited with ${vite.exitedWith} before the page loaded`);
  await gotoWhenReady(page, vite);
  await page.waitForFunction(() => window.__atlasBench !== undefined, undefined, { timeout: 900_000 });
  const payload = await page.evaluate(() => window.__atlasBench);
  await browser.close();

  if (payload.error) {
    console.error('bench failed in page:', payload.error);
    exitCode = 1;
  } else if (!(RIG_MARKER in payload)) {
    console.error(
      `the page returned a payload with no '${RIG_MARKER}' — it is not this revision of the rig.\n` +
        'Something else served bench.html (a stale dev server, a neighbouring lane). Refusing to report it.',
    );
    exitCode = 1;
  } else {
    console.log('\n' + table(payload) + '\n');
    if (wantJson) {
      writeFileSync(jsonAt, JSON.stringify(payload, null, 2));
      console.log(`raw payload → ${jsonAt}`);
    }
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  // SIGKILL the GROUP, not SIGTERM the wrapper: a survivor holding the port
  // makes the next run fail to start — and, worse, makes THIS run hang after it
  // has already printed, because it inherited stdout. Both have happened here.
  killVite(vite);
}
process.exit(exitCode);
