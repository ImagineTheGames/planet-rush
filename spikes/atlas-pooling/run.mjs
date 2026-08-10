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
import { chromium } from '@playwright/test';

const PORT = 5183; // not 5173: leave the developer's own `npm run dev` alone
// 127.0.0.1, not `localhost`: node's `fetch` prefers the AAAA record and vite
// binds v4 only, so the readiness poll would time out against a server that is
// up and answering (it did — 90 s of it).
const URL = `http://127.0.0.1:${PORT}/spikes/atlas-pooling/bench.html`;
const headed = process.argv.includes('--headed');
const jsonAt = process.argv[process.argv.indexOf('--json') + 1];
const wantJson = process.argv.includes('--json') && jsonAt && !jsonAt.startsWith('--');

/**
 * Start `vite` and resolve once it actually serves the bench page.
 *
 * Readiness is polled with a real request rather than sniffed out of vite's
 * banner: with stdout piped instead of a TTY the banner's timing and wording are
 * not something to hang a 60-second timeout on, and "the URL answers 200" is the
 * condition we actually need anyway.
 */
async function startVite() {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let dead = null;
  proc.on('exit', (code) => {
    dead = code;
  });

  const deadline = Date.now() + 90_000;
  for (;;) {
    if (dead !== null) throw new Error(`vite exited with ${dead}`);
    if (Date.now() > deadline) {
      proc.kill('SIGTERM');
      throw new Error(`vite did not serve ${URL} within 90s`);
    }
    try {
      const res = await fetch(URL);
      if (res.ok) return proc;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
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

  const b = payload.baseline;
  lines.push('-- baseline: the SHIPPED renderer on the GDD §4.3 stress scene --');
  lines.push(
    `  ${b.entities} entities · median ${num(b.stats.median)} ms (${num(b.stats.fps, 1)} fps) · ` +
      `p95 ${num(b.stats.p95)} · ${num(b.drawCallsPerFrame, 1)} draw calls/frame · ` +
      `VfxAutoQuality would engage: ${b.vfxWouldEngage ? 'YES' : 'no'}`,
  );
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

const vite = await startVite();
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

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__atlasBench !== undefined, undefined, { timeout: 300_000 });
  const payload = await page.evaluate(() => window.__atlasBench);
  await browser.close();

  if (payload.error) {
    console.error('bench failed in page:', payload.error);
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
  vite.kill('SIGTERM');
}
process.exit(exitCode);
