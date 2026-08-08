/**
 * evidence/a0-07-darker-backdrop/measure-sky-cost.mjs — what a sky actually
 * costs a frame. OWNER: Art Agent (a0-07).
 *
 * `backdrop.test.ts` measures a sky's **overdraw** — the average number of
 * translucent layers stacked on a pixel — off the geometry, with no GPU
 * involved. That is the right number to *design* against and the wrong one to
 * stop at, because the brief asks for the per-frame cost and a fill-rate layer's
 * cost is a property of the rasterizer, not of the shape list.
 *
 * So this measures it, on a real frame, on the landscape phone profile: boot the
 * frozen scene on each map, sample the render loop's own frame times through the
 * `?debug=1` hook, and report the median and the delta against NONE (the map with
 * no sky at all, which is the control this experiment gets for free because the
 * developer picked it).
 *
 * ## READ THIS BEFORE QUOTING THE OUTPUT: the experiment does not isolate the sky
 *
 * It was run, and it is committed **as a negative result**, because the numbers
 * it produced are not evidence and it would be worse to leave the attempt
 * unrecorded. What came back (2026-08-08, this container):
 *
 * ```
 * octagon  None          overdraw 0.000   median 564.90 ms
 * compass  Coalsack      overdraw 0.691   median 744.80 ms   +179.90
 * diamond  Patina Drift  overdraw 0.863   median 365.20 ms   −199.70
 * oval     Plasma Reef   overdraw 1.121   median 311.50 ms   −253.40
 * ```
 *
 * The **costliest sky measured the fastest**, which is enough on its own to
 * throw the result out. Two confounds, either fatal:
 *
 *  1. **Changing the sky means changing the map, by design.** A map's sky is its
 *     identity, so there is no way to A/B one map against itself — and the maps
 *     differ in exactly the thing that dominates a frame. `compass` and `diamond`
 *     are derelict-fill: below eight players they lay out all eight board
 *     positions and carry wrecks plus lootable debris. `oval` regenerates exactly
 *     `count` homes. So "compass" is +8 wrecks against "oval", and that swamps a
 *     sky worth ~1 screen of translucent fill.
 *  2. **The box is loaded and has no GPU.** 565 ms/frame is 1.7 fps — Chromium on
 *     SwiftShader on a machine several lanes are building on. Run-to-run drift at
 *     that scale is larger than the effect.
 *
 * So the cost figure this brief reports is **overdraw**, measured off the
 * geometry by `src/art/backdrop.test.ts` — device-independent, deterministic, and
 * the input a fill-rate bound is computed from:
 *
 *   844×390 at dpr 3 = 2.96 Mpx/frame. The costliest sky, at 1.121 overdraw, is
 *   ~3.3 Mpx of blended fill; on a phone GPU in the 4–10 Gpx/s class that is
 *   **~0.3–0.8 ms**, against a 16.7 ms budget.
 *
 * A trustworthy per-frame measurement needs a device (or a quiet box with a real
 * GPU) and a harness that varies the sky with everything else held still. This
 * script is the shape of that harness; it is not that measurement.
 *
 *   node evidence/a0-07-darker-backdrop/measure-sky-cost.mjs [port]
 */
import { chromium } from 'playwright';

const port = process.argv[2] ?? '4207';
const ORIGIN = `http://127.0.0.1:${port}`;
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

/** Map → the sky it flies under (src/art/backdrop.ts MAP_NEBULA), plus overdraw. */
const MAPS = [
  { mapId: 'octagon', sky: 'None', overdraw: 0.0 },
  { mapId: 'compass', sky: 'Coalsack', overdraw: 0.691 },
  { mapId: 'diamond', sky: 'Patina Drift', overdraw: 0.863 },
  { mapId: 'oval', sky: 'Plasma Reef', overdraw: 1.121 },
];

const SAMPLES = 140;

async function frameTimes(browser, mapId) {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript((id) => {
    try {
      localStorage.setItem('planet-rush:mapId', id);
    } catch {
      /* storage disabled — falls back to the default map */
    }
  }, mapId);
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/?debug=1&freeze=1`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready);

  // Time the frames the page itself presents. `?freeze=1` pins the sim, so what
  // is left between two rAF callbacks is very nearly the render — which is the
  // half a nebula is in.
  const times = await page.evaluate(async (n) => {
    // Warm up first: the first frames after boot pay for texture bakes and
    // geometry builds that happen exactly once, and charging those to the sky
    // would be measuring the build, not the frame.
    await new Promise((done) => {
      let i = 0;
      const tick = () => (++i < 40 ? requestAnimationFrame(tick) : done());
      requestAnimationFrame(tick);
    });
    return new Promise((done) => {
      const out = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        out.push(now - last);
        last = now;
        if (out.length < n) requestAnimationFrame(tick);
        else done(out);
      };
      requestAnimationFrame(tick);
    });
  }, SAMPLES);

  await ctx.close();
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { median: at(0.5), p90: at(0.9) };
}

const browser = await chromium.launch();
const rows = [];
for (const m of MAPS) {
  const t = await frameTimes(browser, m.mapId);
  rows.push({ ...m, ...t });
  console.log(`  measured ${m.mapId} (${m.sky})`);
}
await browser.close();

const base = rows.find((r) => r.sky === 'None');
console.log(`\nlandscape phone 844×390 @dpr3, frozen scene, ${SAMPLES} frames, software GL`);
console.log('NOT EVIDENCE — the map changes with the sky (derelict-fill boards carry +8 wrecks),');
console.log('and the box has no GPU. See this file’s header before quoting any of it.\n');
console.log('map      | sky           | overdraw | median ms | p90 ms | Δ median vs NONE');
console.log('---------|---------------|----------|-----------|--------|-----------------');
for (const r of rows) {
  const d = r.median - base.median;
  console.log(
    `${r.mapId.padEnd(8)} | ${r.sky.padEnd(13)} | ${r.overdraw.toFixed(3).padStart(8)} | ` +
      `${r.median.toFixed(2).padStart(9)} | ${r.p90.toFixed(2).padStart(6)} | ` +
      `${(d >= 0 ? '+' : '') + d.toFixed(2)} ms`,
  );
}
console.log('');
