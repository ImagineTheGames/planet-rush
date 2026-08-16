/**
 * evidence/a0-62-app-shell-bloom/probe-when.mjs — WHEN the halo collapses.
 * OWNER: Art Agent.
 *
 * `probe-solo.mjs` shot the same client at the same URL and got the CORRECT
 * halo; `capture.mjs` shot it and got the collapsed one. Neither changed a
 * pixel of art, so the variable is not the build, the ratio or the scene — it
 * is WHEN the frame is taken and what the page did before it.
 *
 * This walks that: one boot, and a shot after each of a ladder of animation
 * frames, plus a shot before and after `document.fonts.ready`. The frame the
 * halo dies on is the finding.
 *
 *   node evidence/a0-62-app-shell-bloom/probe-when.mjs --port 4262
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', '4262'));
const LADDER = arg('frames', '0,1,2,3,4,6,10,20,60').split(',').map(Number);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();

const rafs = (n) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        if (count <= 0) return resolve(0);
        let seen = 0;
        const step = () => {
          seen += 1;
          if (seen >= count) return resolve(seen);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );

await page.goto(`http://localhost:${PORT}/?debug=1&freeze=1`);
await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 30_000 });

let at = 0;
for (const target of LADDER) {
  await rafs(target - at);
  at = target;
  writeFileSync(join(FRAMES, `when-f${String(target).padStart(3, '0')}-dpr1.png`), await page.screenshot());
  const fonts = await page.evaluate(() => document.fonts?.status ?? 'n/a');
  console.log(`frame ${target}: document.fonts.status=${fonts}`);
}

await page.evaluate(() => document.fonts?.ready);
await rafs(3);
writeFileSync(join(FRAMES, 'when-fontsready-dpr1.png'), await page.screenshot());
console.log('after document.fonts.ready + 3 frames');

await browser.close();
