/**
 * evidence/a0-07-darker-backdrop/shoot-evidence.mjs — the frames the brief asks
 * for. OWNER: Art Agent (a0-07).
 *
 * Four things, on a landscape phone at gameplay zoom (the game is
 * landscape-locked on phones, GDD §4.6), all against a preview that
 * `verify-served-build.mjs` has already proved is the right bundle:
 *
 *   1-2. **The side by side.** The same frozen scene — same seed, same tick,
 *        same rock field, same station — on today's `#0D1015` and on Floor. Two
 *        builds, two ports: `origin/main` on 4208, this branch on 4207. Not a
 *        recolour of one screenshot; the actual shipped frame next to the actual
 *        proposed one.
 *   3.   **Each of the six skies**, on the map it was assigned (and, for the two
 *        unassigned ones, on The Oval so they can be compared like for like).
 *   4.   **The disqualifier frame.** Floor under Plasma Reef, station damaged,
 *        owner beacon ring and the clockwise threat fill both visible. The brief:
 *        "if that frame is honest, the pick is safe."
 *
 * The map comes from `localStorage['planet-rush:mapId']`, which is where the
 * boot reads it under `?debug=1` (no lobby). The damage comes from the `?debug=1`
 * write seam `window.__planetRush.damageCore`, which drains on a tick boundary —
 * so shot 4 runs WITHOUT `?freeze=1` (a frozen sim never steps, so it would
 * never drain the write). Shots 1-3 are frozen and therefore deterministic.
 *
 *   node evidence/a0-07-darker-backdrop/shoot-evidence.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = `${dirname(fileURLToPath(import.meta.url))}/frames`;
const AFTER = 'http://127.0.0.1:4207';
const BEFORE = 'http://127.0.0.1:4208';

/** The landscape phone the brief asks for — the iphone profile, rotated. */
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

/** Boot, wait for the canvas, the frozen flag, fonts, and a couple of frames. */
async function boot(page, url, { frozen = true } = {}) {
  await page.goto(url);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  if (frozen) {
    await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 });
  } else {
    await page.waitForFunction(() => !!window.__planetRush, undefined, { timeout: 20_000 });
  }
  await page.evaluate(() => document.fonts?.ready);
  // Settle: count frames rather than time them, so a loaded software-GL runner
  // cannot shoot a frame the renderer has not drawn yet (the q8 lesson).
  await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const tick = () => (++n < 8 ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
  );
}

/** A fresh phone context with the map preselected in storage. */
async function phone(browser, origin, mapId) {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(
    (id) => {
      try {
        localStorage.setItem('planet-rush:mapId', id);
      } catch {
        /* storage disabled — the boot falls back to the default map */
      }
    },
    mapId,
  );
  return { ctx, origin };
}

async function shot(browser, { origin, mapId, name, url, frozen = true, before }) {
  const { ctx } = await phone(browser, origin, mapId);
  const page = await ctx.newPage();
  await boot(page, `${origin}${url}`, { frozen });
  if (before) await before(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}.png   ${origin}  map=${mapId}`);
  await ctx.close();
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

console.log('\nthe side by side — the same frozen scene, two builds:');
await shot(browser, { origin: BEFORE, mapId: 'octagon', name: '1-ground-before-vacuum', url: '/?debug=1&freeze=1' });
await shot(browser, { origin: AFTER, mapId: 'octagon', name: '2-ground-after-floor', url: '/?debug=1&freeze=1' });

// The four ASSIGNED skies, each on its own map. The two unassigned ones
// (ironVeil, deepEmber) cannot appear here and that is the point of them being
// unassigned — no map flies under either, so there is no in-game frame to shoot.
// They are on the committed contact sheet (assets/preview/sprite-sheet.svg,
// "The void — the six skies"), which renders the same generator.
console.log('\nthe four assigned skies, each on the map it flies over:');
const SKIES = [
  ['none', 'octagon'],
  ['coalsack', 'compass'],
  ['patinaDrift', 'diamond'],
  ['plasmaReef', 'oval'],
];
for (const [sky, mapId] of SKIES) {
  await shot(browser, { origin: AFTER, mapId, name: `3-sky-${sky}-on-${mapId}`, url: '/?debug=1&freeze=1' });
}

console.log('\nthe disqualifier frame — Floor under Plasma Reef, station damaged:');
await shot(browser, {
  origin: AFTER,
  mapId: 'oval',
  name: '4-disqualifier-plasma-reef-damaged',
  url: '/?debug=1',
  frozen: false,
  before: async (page) => {
    // Take the local player's core down far enough that the clockwise threat
    // fill is unmistakable, then let the sim carry the write to a tick boundary.
    await page.waitForFunction(() => typeof window.__planetRush?.damageCore === 'function', undefined, {
      timeout: 20_000,
    });
    await page.evaluate(() => window.__planetRush.damageCore(0, 62));
    await page.waitForTimeout(900);
  },
});

await browser.close();
console.log(`\nframes → ${OUT}\n`);
