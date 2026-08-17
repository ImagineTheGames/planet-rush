/**
 * evidence/a0-62-app-shell-bloom/probe-scene.mjs — what the shipped app's own
 * scene graph does to the star layers. OWNER: Art Agent.
 *
 * The frame measurement (audit.txt) says the halo arrives at `f²` where the
 * design says `f` — the gradient squared, the point and the diffraction cross
 * (flat fills and strokes, which never touch the ramp) untouched. Squaring is
 * what happens when a PREMULTIPLIED source is composited as though it were
 * straight, so this reads the two places that could do it, off the LIVE client
 * rather than off the source:
 *
 *  - the star layers' ancestry — filters, render groups, `cacheAsTexture`,
 *    blend modes, alpha;
 *  - the ramp texture as the renderer holds it — `alphaMode`, mipmaps, the
 *    uploaded size, and whether the GL texture was premultiplied on upload.
 *
 * Reached through Pixi 8.6.6's own devtools hook, `globalThis.__PIXI_APP_INIT__`
 * (the same door `evidence/a0-18-bloom-gone/probe-bloom.mjs` used).
 *
 *   node evidence/a0-62-app-shell-bloom/probe-scene.mjs --port 4262
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', '4262'));
const DPR = Number(arg('dpr', '1'));
const OUT = arg('out', 'scene.json');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: DPR });
const page = await context.newPage();
await page.addInitScript(() => {
  globalThis.__PIXI_APP_INIT__ = (app) => {
    globalThis.__qaApp = app;
  };
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:${PORT}/?debug=1&freeze=1`);
await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 30_000 });
await page.waitForFunction(() => !!globalThis.__qaApp, undefined, { timeout: 30_000 });
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const report = await page.evaluate(() => {
  const app = globalThis.__qaApp;
  const found = [];
  const walk = (node, path) => {
    const label = node.label ?? '';
    if (typeof label === 'string' && label.startsWith('void-stars-')) found.push({ node, path: [...path, label] });
    for (const c of node.children ?? []) walk(c, [...path, label || c.constructor?.name || '?']);
  };
  walk(app.stage, []);

  const describe = (n) => ({
    label: n.label ?? null,
    ctor: n.constructor?.name ?? null,
    alpha: n.alpha,
    visible: n.visible,
    renderable: n.renderable,
    blendMode: n.blendMode ?? null,
    tint: n.tint ?? null,
    filters: (n.filters ?? []).map((f) => f.constructor?.name ?? '?'),
    isRenderGroup: !!n.isRenderGroup,
    hasCacheAsTexture: !!n.isCachedAsTexture,
    // What a cached container composites WITH — the squaring suspect.
    cacheOptions: n.renderGroup?.textureOptions ?? null,
  });

  const layers = found.map(({ node, path }) => {
    const chain = [];
    for (let n = node; n; n = n.parent) chain.push(describe(n));
    return { path, chain };
  });

  // The ramp textures, as the RENDERER holds them: found by walking the
  // texture-source cache the GL system keeps, so this is the uploaded object.
  const gl = app.renderer.texture;
  const sources = [];
  const seen = new Set();
  const collect = (src) => {
    if (!src || seen.has(src.uid)) return;
    seen.add(src.uid);
    if (!String(src.label ?? '').includes('falloff-ramp')) return;
    const glTex = gl.getGlSource ? gl.getGlSource(src) : null;
    sources.push({
      label: src.label,
      alphaMode: src.alphaMode,
      width: src.width,
      height: src.height,
      pixelWidth: src.pixelWidth,
      pixelHeight: src.pixelHeight,
      resolution: src.resolution,
      autoGenerateMipmaps: src.autoGenerateMipmaps,
      mipLevelCount: src.mipLevelCount,
      scaleMode: src.scaleMode,
      addressMode: src.addressMode,
      format: src.format,
      uploadMethodId: src.uploadMethodId,
      glTarget: glTex ? glTex.target : null,
      // The first row of the buffer as authored — RGB should EQUAL A on a
      // premultiplied ramp; if the GPU copy has RGB = A² something premultiplied
      // it a second time.
      authoredSample: (() => {
        const r = src.resource;
        if (!r || !r.length) return null;
        const at = (x, y) => {
          const i = (y * src.pixelWidth + x) * 4;
          return [r[i], r[i + 1], r[i + 2], r[i + 3]];
        };
        const half = src.pixelHeight >> 1;
        return { c40: at(half + 40, half), c80: at(half + 80, half), c110: at(half + 110, half) };
      })(),
    });
  };
  for (const src of gl.managedTextures ?? []) collect(src);
  return {
    renderer: {
      name: app.renderer.name,
      type: app.renderer.type,
      resolution: app.renderer.resolution,
      antialias: app.renderer.options?.antialias ?? null,
      useBackBuffer: !!app.renderer.backBuffer?.useBackBuffer,
      multisample: app.renderer.gl?.getParameter?.(app.renderer.gl.SAMPLES) ?? null,
      contextAttrs: app.renderer.gl?.getContextAttributes?.() ?? null,
      devicePixelRatio: window.devicePixelRatio,
    },
    layers,
    ramps: sources,
  };
});

mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, OUT), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2).slice(0, 6000));
await browser.close();
