/**
 * evidence/a0-75-fill-rate/cache-diff.mjs — drives `./cache-diff.html` and
 * writes the frames out. OWNER: Art Agent (a0-75).
 *
 * Two frames per sky per viewport — the raw geometry and the a0-75 cache — plus
 * the numbers that say how far apart they are. The PNGs land in `./frames/` so
 * the claim "invisible" can be checked by looking, which is the only check that
 * settles it.
 *
 *   node evidence/a0-75-fill-rate/cache-diff.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.A075_DIFF_PORT ?? 5232);
const BASE = `http://127.0.0.1:${PORT}`;
const FRAMES = new URL('./frames/', import.meta.url);

/** 1280×800 is `docs/perf-gate.md`'s desktop control profile — the same screen
 *  `backdrop.test.ts` measures every sky's brightness on, so the peak-luma
 *  column here is comparable with the ratified ladder. 3440×1440 is the
 *  developer's. */
const VIEWPORTS = [
  { name: '1280x800', w: 1280, h: 800 },
  { name: '3440x1440', w: 3440, h: 1440 },
];

async function main() {
  const reuse = process.env.A075_DIFF_REUSE === '1';
  const server = reuse
    ? null
    : spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  server?.stdout.on('data', () => {});
  server?.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  let up = false;
  for (let i = 0; i < 600; i++) {
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
  if (!up) {
    console.error(`dev server did not come up on ${PORT}`);
    server?.kill('SIGTERM');
    process.exit(1);
  }

  mkdirSync(FRAMES, { recursive: true });
  const browser = await chromium.launch();
  const all = [];
  let gpu = 'unknown';

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: Math.min(vp.w, 3440), height: Math.min(vp.h, 1440) },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('[page]', m.text());
    });
    await page.goto(`${BASE}/evidence/a0-75-fill-rate/cache-diff.html?w=${vp.w}&h=${vp.h}`, {
      waitUntil: 'load',
    });
    await page.waitForFunction(
      () => window.__a075diff !== undefined || window.__a075diffError !== undefined,
      null,
      { timeout: 900_000 },
    );
    const err = await page.evaluate(() => window.__a075diffError ?? null);
    if (err) {
      console.error(err);
      process.exitCode = 1;
      await ctx.close();
      break;
    }
    const payload = await page.evaluate(() => window.__a075diff);
    gpu = payload.gpu;
    for (const d of payload.diffs) {
      const { pngDirect, pngCached, ...row } = d;
      all.push({ viewport: vp.name, ...row });
      for (const [suffix, url] of [
        ['direct', pngDirect],
        ['cached', pngCached],
      ]) {
        writeFileSync(
          new URL(`./${vp.name}-${d.sky}-${suffix}.png`, FRAMES),
          Buffer.from(url.split(',')[1], 'base64'),
        );
      }
      console.log(
        `${vp.name.padEnd(10)} ${d.sky.padEnd(13)} cache=${d.fitsCache ? 'yes' : 'NO '} ` +
          `maxΔ ${String(d.maxChannel).padStart(3)}  meanΔ ${d.meanChannel.toFixed(4)}  ` +
          `maxΔE ${d.maxDeltaE.toFixed(2)}  changed ${(d.changedFraction * 100).toFixed(1)}%  ` +
          `step ${d.maxStepDirect.toFixed(2)}→${d.maxStepCached.toFixed(2)}  ` +
          `peakY′ ${d.peakDirect.toFixed(1)}→${d.peakCached.toFixed(1)}`,
      );
    }
    await ctx.close();
  }

  await browser.close();
  server?.kill('SIGTERM');
  writeFileSync(
    new URL('./cache-diff.json', import.meta.url),
    `${JSON.stringify({ gpu, rows: all }, null, 2)}\n`,
  );
  console.log(`\nGPU: ${gpu}\nwrote cache-diff.json and frames/`);
}

await main();
