/**
 * evidence/a0-75-fill-rate/sweep.mjs — frame time vs. rendered area, on the
 * SHIPPED bundle. OWNER: Art Agent (a0-75).
 *
 * The developer bisected a0-75 by hand — host swap (still stutters), then window
 * resize (*"if i resize to a small window the game plays much better"*). This is
 * that bisection turned into a measurement: boot `vite preview` of the real
 * build at five viewport sizes and sample `requestAnimationFrame` deltas in-page.
 * If frame time tracks pixel count roughly linearly, the cost is per-pixel.
 *
 * ## What this instrument is, and what it is not
 *
 * The studio image has no GPU: Chromium draws WebGL through **SwiftShader**, a
 * CPU rasteriser. A millisecond off this box is therefore NOT the developer's
 * millisecond and this file never claims it is. What SwiftShader is unusually
 * good for is precisely the question a0-75 asks: it is a *pure* function of
 * fragments shaded, with no fixed-function fill-rate headroom to hide behind, so
 *
 *   - the **shape** of frame-time vs. pixels is the real shape, and
 *   - the **attribution** between layers is honest, because every layer pays the
 *     same per-fragment tariff.
 *
 * The absolute numbers are a magnifying glass, not a stopwatch. `attribute.mjs`
 * is the other half: it takes the layers apart.
 *
 *   node evidence/a0-75-fill-rate/sweep.mjs                  # the whole sweep
 *   node evidence/a0-75-fill-rate/sweep.mjs --frames 60       # quicker
 *   node evidence/a0-75-fill-rate/sweep.mjs --map oval        # a specific sky
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.A075_PORT ?? 4196);
// 127.0.0.1, not `localhost` — see attribute.mjs: Node resolves `localhost` to
// ::1 and the vite servers bind IPv4 only.
const URL_BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

/** Frames sampled per reading. 90 at 3440×1440 on SwiftShader is already ~30 s. */
const FRAMES = Number(arg('frames', 90));
/** Frames discarded first: boot, texture uploads, the backdrop's one bake. */
const SETTLE = Number(arg('settle', 40));

/**
 * The five viewports. 1280×720 is the small window the developer says plays
 * well; 3440×1440 is their ultrawide; 5120×1440 is the 32:9 the brief asks the
 * budget to be stated at. 798×384 is the phone the same build runs smoothly on —
 * the control that proves the axis is area and not the build.
 */
const VIEWPORTS = [
  { name: 'phone', width: 798, height: 384 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '3440x1440', width: 3440, height: 1440 },
  { name: '5120x1440', width: 5120, height: 1440 },
];

/**
 * Two scenes, because the brief asks for both and they answer different halves.
 * `freeze` pins the sim at the golden tick, so every reading is the same world
 * and the only variable is the viewport. `live` lets the match run, so the
 * entity churn a real player pays for is in the number.
 */
const SCENES = [
  { name: 'frozen', query: '?debug=1&freeze=1' },
  { name: 'live', query: '?debug=1' },
];

const MAP = arg('map', 'oval'); // Plasma Reef — the additive sky, the worst case.

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** Sample rAF deltas in-page: the browser's own cadence, not Playwright's view. */
async function sampleFrames(page, frames, settle) {
  return page.evaluate(
    ({ frames, settle }) =>
      new Promise((done) => {
        const deltas = [];
        let last = performance.now();
        let seen = 0;
        const tick = (now) => {
          const dt = now - last;
          last = now;
          seen++;
          if (seen > settle) deltas.push(dt);
          if (deltas.length < frames) {
            requestAnimationFrame(tick);
            return;
          }
          done(deltas);
        };
        requestAnimationFrame(tick);
      }),
    { frames, settle },
  );
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));
  // Wait for the port.
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(URL_BASE);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const browser = await chromium.launch({
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  });

  const rows = [];
  let gpu = 'unknown';
  for (const scene of SCENES) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      await page.addInitScript((mapId) => {
        localStorage.setItem('planet-rush:mapId', mapId);
      }, MAP);
      await page.goto(`${URL_BASE}/${scene.query}`, { waitUntil: 'load' });
      // Let the boot finish: the backdrop bakes its geometry on the first draw.
      await page.waitForTimeout(3000);
      if (gpu === 'unknown') {
        gpu = await page.evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl2');
          const e = gl?.getExtension('WEBGL_debug_renderer_info');
          return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'no debug_renderer_info';
        });
      }
      const nebula = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c ? `${c.width}x${c.height}` : 'no canvas';
      });
      const deltas = await sampleFrames(page, FRAMES, SETTLE);
      const sorted = [...deltas].sort((a, b) => a - b);
      const row = {
        scene: scene.name,
        viewport: vp.name,
        width: vp.width,
        height: vp.height,
        megapixels: (vp.width * vp.height) / 1e6,
        drawingBuffer: nebula,
        frames: sorted.length,
        median: pct(sorted, 0.5),
        p95: pct(sorted, 0.95),
        mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      };
      rows.push(row);
      console.log(
        `${row.scene.padEnd(7)} ${row.viewport.padEnd(10)} ${row.megapixels.toFixed(2).padStart(5)} Mpx  ` +
          `median ${row.median.toFixed(1).padStart(7)} ms  p95 ${row.p95.toFixed(1).padStart(7)} ms  ` +
          `${(row.median / row.megapixels).toFixed(2).padStart(6)} ms/Mpx`,
      );
      await ctx.close();
    }
  }

  await browser.close();
  server.kill('SIGTERM');

  const out = { gpu, map: MAP, frames: FRAMES, settle: SETTLE, rows };
  writeFileSync(new URL('./sweep.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nGPU: ${gpu}\nwrote sweep.json`);
}

await main();
