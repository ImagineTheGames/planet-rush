/**
 * evidence/a0-75-fill-rate/attribute.mjs — drives `./fill-rig.html` across the
 * viewport sweep and writes `attribution.json`. OWNER: Art Agent (a0-75).
 *
 * The rig renders one scenario at a time and reports a median frame time; this
 * runner is the loop over viewports and the AA switch, and nothing else. Same
 * caveat as `./sweep.mjs`: the box has no GPU, so these are SwiftShader
 * milliseconds — a magnifying glass on per-pixel cost, which is the axis under
 * investigation, and not the developer's stopwatch.
 *
 *   node evidence/a0-75-fill-rate/attribute.mjs
 *   node evidence/a0-75-fill-rate/attribute.mjs --frames 40
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.A075_RIG_PORT ?? 5231);
// 127.0.0.1, not `localhost`: Node's `fetch` resolves `localhost` to ::1 first
// and the dev server binds IPv4 only, so the readiness probe reported
// ECONNREFUSED against a server that was serving perfectly well to curl.
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const arg = (n, f) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : f;
};
const FRAMES = Number(arg('frames', 50));
const SETTLE = Number(arg('settle', 15));

const VIEWPORTS = [
  { name: 'phone', w: 798, h: 384 },
  { name: '1280x720', w: 1280, h: 720 },
  { name: '1920x1080', w: 1920, h: 1080 },
  { name: '2560x1440', w: 2560, h: 1440 },
  { name: '3440x1440', w: 3440, h: 1440 },
  { name: '5120x1440', w: 5120, h: 1440 },
];

async function main() {
  // `A075_RIG_REUSE=1` attaches to a dev server already on PORT instead of
  // spawning one. Opt-in only, and never the default: a0-06 lost a whole result
  // to a suite that silently attached to a neighbouring lane's tree. Vite's
  // first dep pre-bundle on this entry takes well over a minute, so a long
  // measurement session is worth not paying it twice.
  const reuse = process.env.A075_RIG_REUSE === '1';
  const server = reuse
    ? null
    : spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  if (reuse) {
    const r = await fetch(BASE).catch(() => null);
    if (!r?.ok) {
      console.error(`A075_RIG_REUSE=1 but nothing is serving ${BASE}`);
      process.exit(1);
    }
    console.log(`reusing dev server on ${PORT}`);
  }
  if (server) {
    server.stdout.on('data', () => {});
    // A `--strictPort` collision is a HARD stop, never a silent attach. a0-06
    // lost a whole result to a suite that quietly measured a neighbouring lane's
    // tree, and the first run of this file measured a stale module for it.
    let portTaken = false;
    server.stderr.on('data', (d) => {
      const s = String(d);
      if (s.includes('already in use')) portTaken = true;
      process.stderr.write(`[vite] ${s}`);
    });
    let up = false;
    // 300 s, not 60: vite's first dep pre-bundle on this entry takes minutes on
    // a cold cache, and a 60 s wait reported "did not come up" for a server that
    // was in fact starting — and then left it running to collide with the retry.
    for (let i = 0; i < 600 && !portTaken; i++) {
      try {
        const r = await fetch(BASE);
        if (r.ok) {
          up = true;
          break;
        }
      } catch {
        /* not up */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (portTaken || !up) {
      console.error(`dev server did not come up on ${PORT} (portTaken=${portTaken})`);
      server.kill('SIGTERM');
      process.exit(1);
    }
  }

  const browser = await chromium.launch({
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  });
  const readings = [];
  let gpu = 'unknown';

  // Full scenario set at every size with AA on (the shipped setting), plus the
  // whole-stack scenarios with AA off at the two biggest sizes — MSAA is a
  // per-pixel multiplier and it is the one render setting that is invisible in
  // the scene graph.
  const passes = [];
  for (const vp of VIEWPORTS) passes.push({ vp, aa: 1, only: null });
  for (const vp of VIEWPORTS) passes.push({ vp, aa: 0, only: 'full-reef,full-none,clear' });

  for (const pass of passes) {
    const ctx = await browser.newContext({
      viewport: { width: Math.min(pass.vp.w, 5120), height: Math.min(pass.vp.h, 1440) },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('[page]', m.text());
    });
    const q = new URLSearchParams({
      w: String(pass.vp.w),
      h: String(pass.vp.h),
      frames: String(FRAMES),
      settle: String(SETTLE),
      aa: String(pass.aa),
    });
    if (pass.only) q.set('only', pass.only);
    await page.goto(`${BASE}/evidence/a0-75-fill-rate/fill-rig.html?${q}`, { waitUntil: 'load' });
    // NOTE the `null`: `waitForFunction(fn, arg, options)`. Passing the options
    // object second makes it the *argument* and leaves the default 30 s timeout
    // in force, which is how the first run of this file died at 3440×1440.
    await page.waitForFunction(
      () => window.__a075 !== undefined || window.__a075Error !== undefined,
      null,
      { timeout: 1_800_000 },
    );
    const err = await page.evaluate(() => window.__a075Error ?? null);
    if (err) {
      console.error(err);
      process.exitCode = 1;
      await ctx.close();
      break;
    }
    const payload = await page.evaluate(() => window.__a075);
    gpu = payload.gpu;
    for (const r of payload.readings) {
      readings.push({ viewport: pass.vp.name, megapixels: (pass.vp.w * pass.vp.h) / 1e6, ...r });
      process.stdout.write(
        `${pass.vp.name.padEnd(10)} aa=${pass.aa} ${r.scenario.padEnd(22)} @${r.scale} ` +
          `median ${r.median.toFixed(2).padStart(8)} ms  p95 ${r.p95.toFixed(2).padStart(8)} ms\n`,
      );
    }
    await ctx.close();
  }

  await browser.close();
  server?.kill('SIGTERM');
  writeFileSync(
    new URL('./attribution.json', import.meta.url),
    `${JSON.stringify({ gpu, frames: FRAMES, settle: SETTLE, readings }, null, 2)}\n`,
  );
  console.log(`\nGPU: ${gpu}\nwrote attribution.json`);
}

await main();
