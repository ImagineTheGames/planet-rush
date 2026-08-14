/**
 * evidence/a0-41-crystalline-ore/capture.mjs — shoot `scene.html` and keep the PNGs.
 *
 *   node evidence/a0-41-crystalline-ore/capture.mjs           # → ./after/
 *   node evidence/a0-41-crystalline-ore/capture.mjs --out before
 *
 * Starts the Vite **dev** server on an ephemeral port (never 5173: leave the
 * developer's own `npm run dev` alone, and never a fixed one: a stale server from
 * another lane holding the port is how a1-12 published one branch's numbers under
 * another branch's name), opens the page in Chromium, waits for `__oreScene`, and
 * screenshots the canvas.
 *
 * An instrument, not a gate. It asserts nothing; the pictures are the output.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const outName = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'after';
const OUT = resolve(HERE, outName);

/** The four frames, and why each one is here. */
const SHOTS = [
  { file: 'field-1x.png', query: 'zoom=1', why: 'the whole desktop frame — the ore at the size it is played at' },
  { file: 'field-1x-ore-only.png', query: 'zoom=1&chunks=only', why: 'the same frame with every other layer hidden' },
  { file: 'field-4x.png', query: 'zoom=4', why: 'the same shipped frame, magnified — what the chunk actually is' },
  { file: 'field-8x.png', query: 'zoom=8', why: 'close enough to count the facets' },
];

async function freePort() {
  return new Promise((ok, err) => {
    const probe = createServer();
    probe.on('error', err);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

const port = await freePort();
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: resolve(HERE, '../..'),
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((ok, err) => {
  const timer = setTimeout(() => err(new Error('vite did not start in 60s')), 60_000);
  vite.stdout.on('data', (b) => {
    process.stdout.write(b);
    if (String(b).includes('Local:')) {
      clearTimeout(timer);
      ok();
    }
  });
});

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
for (const shot of SHOTS) {
  await page.goto(`http://localhost:${port}/evidence/a0-41-crystalline-ore/scene.html?${shot.query}`);
  await page.waitForFunction(() => window.__oreScene === true, null, { timeout: 60_000 });
  await page.locator('canvas').screenshot({ path: resolve(OUT, shot.file) });
  process.stdout.write(`${shot.file}  ${shot.why}\n`);
}
await browser.close();
vite.kill();
process.stdout.write(`\nwrote ${OUT}\n`);
// Vite's own child keeps the loop alive after `kill()`; the pictures are on disk
// and there is nothing left to wait for, so say so rather than hang for a timeout.
process.exit(0);
