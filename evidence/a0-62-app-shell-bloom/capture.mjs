/**
 * evidence/a0-62-app-shell-bloom/capture.mjs — the REAL app shell, at four
 * device-pixel ratios. OWNER: Art Agent.
 *
 * Every previous round on this element measured a surface that forces
 * `resolution: 1` — `field-probe`, `renderer-probe`, `sky-preview`, the unit
 * suite — and every one of them draws the bloom correctly. The developer's
 * screen is none of those. So this drives `index.html` + `src/main.ts`, built by
 * the app's OWN `vite.config.ts` and served by `vite preview`, in a browser
 * whose `deviceScaleFactor` is the only variable:
 *
 *   `app.init({ resolution: window.devicePixelRatio || 1, autoDensity: true })`
 *                                                       (src/main.ts)
 *
 * A plain node script rather than a Playwright config, because the thing under
 * test IS `deviceScaleFactor` and one config cannot vary it per shot without a
 * project matrix that hides the variable in a file the audit does not read.
 *
 *   npx vite build                                   # dist/, the shipped bundle
 *   npx vite preview --port 4262 --strictPort &
 *   node evidence/a0-62-app-shell-bloom/capture.mjs --port 4262
 *
 * Writes `frames/app-dpr<N>.png` and `frames/app-dpr<N>.json` (the camera
 * offset the client published, plus the canvas geometry, so the frame can be
 * REGISTERED against the same `starFieldSprite` call the client made).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', '4262'));
const URL_BASE = `http://localhost:${PORT}`;
const PATHS = arg('path', '/?debug=1&freeze=1');
/** The frozen desktop golden's viewport — same CSS pixels at every ratio, so
 *  the only thing that changes between frames is the backing store. */
const VIEW = { width: 1280, height: 800 };
const RATIOS = arg('dpr', '1,1.5,2,3').split(',').map(Number);
const TAG = arg('tag', 'app');

/** QA's own settle: wait for frames, never for milliseconds
 *  (tests/mobile/render-settle.ts, inlined so this script needs no TS loader). */
const settle = (page, frames = 3, stall = 10_000) =>
  page.evaluate(
    ([wanted, stallMs]) =>
      new Promise((resolve, reject) => {
        let seen = 0;
        let watchdog = window.setTimeout(
          () => reject(new Error(`no animation frame for ${stallMs} ms (saw ${seen}/${wanted})`)),
          stallMs,
        );
        const onFrame = () => {
          seen += 1;
          window.clearTimeout(watchdog);
          if (seen >= wanted) return resolve(seen);
          watchdog = window.setTimeout(
            () => reject(new Error(`no animation frame for ${stallMs} ms (saw ${seen}/${wanted})`)),
            stallMs,
          );
          window.requestAnimationFrame(onFrame);
        };
        window.requestAnimationFrame(onFrame);
      }),
    [frames, stall],
  );

mkdirSync(FRAMES, { recursive: true });
const browser = await chromium.launch();

for (const dpr of RATIOS) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: dpr });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [console.error] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

  await page.goto(`${URL_BASE}${PATHS}`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settle(page);

  // A canvas whose CSS size differs from its backing store by anything other
  // than the ratio under test would put an unrecorded scale between the frame
  // and the model. Recorded, not assumed.
  const geom = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return {
      backing: { w: c.width, h: c.height },
      css: { w: r.width, h: r.height },
      dpr: window.devicePixelRatio,
      // What the app actually handed Pixi, read off the live renderer rather
      // than off the source — the lead this brief exists to test.
      pixi: (() => {
        const pr = window.__PIXI_APP__ ?? window.__planetRush?.pixi;
        return pr ? { resolution: pr.renderer?.resolution ?? null } : null;
      })(),
    };
  });

  const shot = await page.screenshot();
  const name = `${TAG}-dpr${String(dpr).replace('.', '_')}`;
  writeFileSync(join(FRAMES, `${name}.png`), shot);

  const hook = await page.evaluate(() => {
    const pr = window.__planetRush;
    return pr ? { shipScreen: pr.shipScreen, shipWorld: pr.shipWorld, viewport: pr.viewport } : null;
  });
  if (!hook) throw new Error('__planetRush is not installed — the app did not boot');
  const cameraOffset = { x: hook.shipScreen.x - hook.shipWorld.x, y: hook.shipScreen.y - hook.shipWorld.y };
  writeFileSync(
    join(FRAMES, `${name}.json`),
    `${JSON.stringify({ dpr, url: PATHS, ...hook, cameraOffset, canvas: geom }, null, 2)}\n`,
  );
  console.log(
    `${name}: canvas ${geom.backing.w}x${geom.backing.h} backing / ${geom.css.w}x${geom.css.h} css, ` +
      `window.devicePixelRatio ${geom.dpr}, camera offset ${JSON.stringify(cameraOffset)}`,
  );
  await context.close();
}

await browser.close();
