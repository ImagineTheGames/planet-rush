/**
 * evidence/a1-13-night-round/capture-drawcalls.mjs — the renderer is lighter, on
 * the SERVED build. OWNER: QA Manager (a1-13 §3; a1-11 / #373, a1-12 / #374).
 *
 * a1-11 wired the atlas pooling and a1-12 culled every entity layer to the
 * viewport, and between them they report 263 → 32 → 10.9 draw calls on desktop and
 * 660 → 11 entities submitted on a 390 px landscape phone. Every one of those
 * numbers comes off `spikes/atlas-pooling/bench.ts`, which builds its OWN scene —
 * 8 ships, 32 turrets, 16 shields, 200 asteroids, 300 projectiles, 120 chunks —
 * and drives the renderer directly. That is the right instrument for an A/B, and
 * it is not the shipped game. This asks the narrower question: what does the
 * bundle actually on the wire submit, per frame, in a real match.
 *
 * ── WHAT IS COUNTED ───────────────────────────────────────────────────────
 * A draw call, defined exactly as the bench defines it (`bench.ts` ~134): every
 * call to `drawElements`, `drawArrays`, `drawElementsInstanced` or
 * `drawArraysInstanced` on the WebGL context. The counter is installed by patching
 * the two context prototypes from an init script, BEFORE any context exists, so
 * nothing about how the client builds or uses its renderer is changed — the calls
 * are tallied on their way through. Frames are counted by a `requestAnimationFrame`
 * chain in the same page, so `calls / frames` is a per-frame figure on one clock.
 *
 * ── AND WHAT IS NOT ──────────────────────────────────────────────────────
 * MILLISECONDS. This box has no GPU (SwiftShader), so a frame time measured here
 * is a measurement of this container and does not travel; the brief says to rest on
 * the draw-call count and that is what the verdict rests on. Frame times and fps
 * ARE recorded, and they are recorded in order to be discounted out loud rather
 * than quietly omitted — and because one of them matters for a different reason:
 * `VfxAutoQuality` engages off sustained fps below 30 (`platform/vfx-quality.ts`),
 * so on a GPU-less box its `reduced` flag reports this container's frame rate, not
 * the renderer's improvement. Both are reported; neither is dressed up.
 *
 * Two profiles, the same as the bench: desktop 1280x800 and phone-landscape
 * 844x390 — the profile the 390 px win was measured at.
 *
 *   node evidence/a1-13-night-round/capture-drawcalls.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const BASE = process.env.A1_13_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';

/** The bench's own two profiles (`spikes/atlas-pooling/run.mjs`). */
const PROFILES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone-landscape', width: 844, height: 390 },
];

/** Frames per measurement window, and how many windows. The bench uses 180. */
const FRAMES = 180;
const ROUNDS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(IMAGES, { recursive: true });

/** Patch the GL prototypes before any context is made. Counts only; changes
 *  nothing about what is drawn. */
const COUNTER = () => {
  const w = window;
  w.__gl = { calls: 0, frames: 0, byName: {} };
  const NAMES = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'];
  for (const Ctor of [w.WebGLRenderingContext, w.WebGL2RenderingContext]) {
    if (!Ctor) continue;
    for (const name of NAMES) {
      const orig = Ctor.prototype[name];
      if (typeof orig !== 'function') continue;
      Ctor.prototype[name] = function (...args) {
        w.__gl.calls++;
        w.__gl.byName[name] = (w.__gl.byName[name] ?? 0) + 1;
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

const out = { base: BASE, capturedAt: new Date().toISOString(), frames: FRAMES, rounds: ROUNDS, profiles: [] };

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

for (const profile of PROFILES) {
  const rec = { ...profile, errors: [], windows: [] };
  const ctx = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(COUNTER);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => rec.errors.push({ kind: 'pageerror', message: e.message }));
  page.on('console', (m) => {
    if (m.type() === 'error') rec.errors.push({ kind: 'console.error', message: m.text() });
  });

  await page.goto(`${BASE}?debug=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => window.__planetRush?.build?.sha, undefined, { timeout: 90_000 });
  rec.build = await page.evaluate(() => ({ ...window.__planetRush.build }));
  await page.waitForFunction(() => window.__vfxStage !== undefined, undefined, { timeout: 90_000 });

  // Let the match get going and the sprite pools settle — a renderer still
  // building its atlas is not the steady state the claim is about.
  await sleep(15_000);

  rec.canvas = await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll('canvas')).sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];
    return c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null;
  });
  rec.viewportSeam = await page.evaluate(() => ({ ...window.__planetRush.viewport }));

  for (let r = 0; r < ROUNDS; r++) {
    const win = await page.evaluate(async (frames) => {
      const w = window;
      const startCalls = w.__gl.calls;
      const startFrames = w.__gl.frames;
      const t0 = performance.now();
      const deltas = [];
      let last = t0;
      await new Promise((resolve) => {
        const step = () => {
          const now = performance.now();
          deltas.push(now - last);
          last = now;
          if (w.__gl.frames - startFrames >= frames) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      const elapsed = performance.now() - t0;
      const calls = w.__gl.calls - startCalls;
      const drawnFrames = w.__gl.frames - startFrames;
      const sorted = [...deltas].sort((a, b) => a - b);
      const vfx = w.__vfxStage?.read() ?? null;
      return {
        calls,
        frames: drawnFrames,
        drawCallsPerFrame: calls / drawnFrames,
        elapsedMs: elapsed,
        fps: (drawnFrames / elapsed) * 1000,
        frameMs: {
          median: sorted[Math.floor(sorted.length / 2)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
        },
        vfx: vfx
          ? {
              attached: vfx.attached,
              particles: vfx.particles,
              sprites: vfx.sprites,
              quality: vfx.quality,
              reduced: vfx.reduced,
              drawnTotal: vfx.drawnTotal,
            }
          : null,
        debugFps: w.__planetRush?.fps ?? null,
      };
    }, FRAMES);
    rec.windows.push(win);
  }

  rec.byName = await page.evaluate(() => ({ ...window.__gl.byName }));
  rec.drawCallsPerFrame = {
    mean: rec.windows.reduce((a, w) => a + w.drawCallsPerFrame, 0) / rec.windows.length,
    min: Math.min(...rec.windows.map((w) => w.drawCallsPerFrame)),
    max: Math.max(...rec.windows.map((w) => w.drawCallsPerFrame)),
  };
  rec.image = `images/a1-13-drawcalls-${profile.name}.png`;
  await page.screenshot({ path: join(IMAGES, `a1-13-drawcalls-${profile.name}.png`) });

  out.profiles.push(rec);
  await ctx.close();
}

await browser.close();
writeFileSync(join(HERE, 'readback-drawcalls.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  JSON.stringify(
    out.profiles.map((p) => ({
      profile: p.name,
      view: `${p.width}x${p.height}`,
      build: p.build.sha,
      canvas: p.canvas,
      drawCallsPerFrame: p.drawCallsPerFrame,
      perWindow: p.windows.map((w) => ({
        dc: +w.drawCallsPerFrame.toFixed(2),
        fps: +w.fps.toFixed(1),
        medianMs: +w.frameMs.median.toFixed(1),
        reduced: w.vfx?.reduced,
        quality: w.vfx?.quality,
      })),
      byName: p.byName,
      errors: p.errors.length,
    })),
    null,
    2,
  ),
);
