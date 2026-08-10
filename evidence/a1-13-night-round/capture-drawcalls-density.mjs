/**
 * evidence/a1-13-night-round/capture-drawcalls-density.mjs — does the count hold
 * as the field FILLS? OWNER: QA Manager (a1-13 §3; a1-12 / #374).
 *
 * `./capture-drawcalls.mjs` measured 16.9 draw calls per frame at 844x390 on the
 * served build, and then the screenshot undercut it: MATCH 0:32, WAVE 1/5, one
 * station, one ship and four rocks. A viewport cull cannot be shown to be working
 * by a scene that has nothing to cull. The number was real and it proved almost
 * nothing, which is worse than an honest gap.
 *
 * a1-12's claim is that the client submits WHAT IS ON SCREEN — 660 entities down
 * to 11 at this profile. The shipped game has no seam reporting world entity
 * counts, so the density cannot be read off a number. It can be MADE, and watched:
 * asteroids arrive in waves (GDD §5.5), so a match left running fills its field on
 * a 180 s metronome while the viewport stays exactly the same size. If the cull is
 * live, draw calls per frame stay flat across five waves of arrivals. If the client
 * were submitting the world rather than the view, this is where it would climb.
 *
 * So: one 844x390 match, a 120-frame draw-call window every ~50 s for eleven
 * minutes, and a full frame committed at every sample so the field behind each
 * number can be looked at rather than taken on trust. The wave counter is read off
 * the HUD's own clock seam at each sample and reported beside the count.
 *
 *   node evidence/a1-13-night-round/capture-drawcalls-density.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const BASE = process.env.A1_13_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';

const VIEW = { width: 844, height: 390 };
const FRAMES = 120;
const SAMPLES = 14;
const GAP_MS = 50_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(IMAGES, { recursive: true });

const COUNTER = () => {
  const w = window;
  w.__gl = { calls: 0, frames: 0 };
  const NAMES = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'];
  for (const Ctor of [w.WebGLRenderingContext, w.WebGL2RenderingContext]) {
    if (!Ctor) continue;
    for (const name of NAMES) {
      const orig = Ctor.prototype[name];
      if (typeof orig !== 'function') continue;
      Ctor.prototype[name] = function (...args) {
        w.__gl.calls++;
        return orig.apply(this, args);
      };
    }
  }
  const tick = () => {
    w.__gl.frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const out = { base: BASE, capturedAt: new Date().toISOString(), view: VIEW, frames: FRAMES, samples: [], errors: [] };

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
await ctx.addInitScript(COUNTER);
const page = await ctx.newPage();
page.on('pageerror', (e) => out.errors.push({ kind: 'pageerror', message: e.message }));
page.on('console', (m) => {
  if (m.type() === 'error') out.errors.push({ kind: 'console.error', message: m.text() });
});

await page.goto(`${BASE}?debug=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForFunction(() => window.__planetRush?.build?.sha, undefined, { timeout: 90_000 });
out.build = await page.evaluate(() => ({ ...window.__planetRush.build }));
await page.waitForFunction(() => window.__vfxStage !== undefined, undefined, { timeout: 90_000 });
await sleep(8000);

const t0 = Date.now();
for (let i = 0; i < SAMPLES; i++) {
  const win = await page.evaluate(async (frames) => {
    const w = window;
    const c0 = w.__gl.calls;
    const f0 = w.__gl.frames;
    const t = performance.now();
    await new Promise((resolve) => {
      const step = () => {
        if (w.__gl.frames - f0 >= frames) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const elapsed = performance.now() - t;
    const calls = w.__gl.calls - c0;
    const df = w.__gl.frames - f0;
    const vfx = w.__vfxStage?.read() ?? null;
    return {
      calls,
      frames: df,
      drawCallsPerFrame: calls / df,
      fps: (df / elapsed) * 1000,
      ticks: w.__planetRush?.ticks ?? null,
      vfx: vfx
        ? { sprites: vfx.sprites, particles: vfx.particles, quality: vfx.quality, reduced: vfx.reduced }
        : null,
    };
  }, FRAMES);

  const file = `a1-13-density-${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: join(IMAGES, file) });
  out.samples.push({ i, atMs: Date.now() - t0, image: `images/${file}`, ...win });
  console.log(
    `${i} @${Math.round((Date.now() - t0) / 1000)}s  dc/frame=${win.drawCallsPerFrame.toFixed(2)}  ` +
      `fps=${win.fps.toFixed(1)}  sprites=${win.vfx?.sprites}  reduced=${win.vfx?.reduced}`,
  );
  if (i < SAMPLES - 1) await sleep(GAP_MS);
}

const dcs = out.samples.map((s) => s.drawCallsPerFrame);
out.summary = {
  min: Math.min(...dcs),
  max: Math.max(...dcs),
  mean: dcs.reduce((a, b) => a + b, 0) / dcs.length,
  first: dcs[0],
  last: dcs[dcs.length - 1],
  spanMs: out.samples[out.samples.length - 1].atMs,
};

await browser.close();
writeFileSync(join(HERE, 'readback-density.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out.summary, null, 2));
