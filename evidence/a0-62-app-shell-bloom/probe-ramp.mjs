/**
 * evidence/a0-62-app-shell-bloom/probe-ramp.mjs — the ramp as the GPU holds it.
 * OWNER: Art Agent.
 *
 * The frame says the halo arrives as `f²` where the design says `f`. Squaring is
 * the signature of a PREMULTIPLIED source composited (or uploaded) as though it
 * were straight, so the question is whether the ramp texture's own texels are
 * still `rgb = a` by the time they reach the shader.
 *
 * So: in the live client, paint the ramp texture 1:1 over an opaque black quad,
 * bake that to a render texture through the app's own renderer, and read the
 * pixels back. Over opaque black, a correct premultiplied ramp reads back
 * `rgb = a`; a doubly-premultiplied one reads back `rgb = a²/255`.
 *
 * Run it in both harness states — the frame is captured alongside, so the
 * read-back is always attributable to a frame that is measurably broken or
 * measurably correct.
 *
 *   node evidence/a0-62-app-shell-bloom/probe-ramp.mjs --port 4262 [--waitsel]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', '4262'));
const WAITSEL = process.argv.includes('--waitsel');
const TAG = arg('tag', WAITSEL ? 'bad' : 'good');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.addInitScript(() => {
  globalThis.__PIXI_APP_INIT__ = (app) => {
    globalThis.__qaApp = app;
  };
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:${PORT}/?debug=1&freeze=1`);
if (WAITSEL) await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 30_000 });
await page.waitForFunction(() => !!globalThis.__qaApp, undefined, { timeout: 30_000 });
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// The frame this read-back belongs to, so the two are never argued about apart.
writeFileSync(join(HERE, 'frames', `ramp-${TAG}-frame-dpr1.png`), await page.screenshot());

const out = await page.evaluate(() => {
  const app = globalThis.__qaApp;
  // Constructors are taken off live objects — the bundle is minified and exports
  // nothing, so this is the only door to `Container`/`Graphics`.
  const Container = app.stage.constructor;
  let starLayer = null;
  const find = (n) => {
    if (typeof n.label === 'string' && n.label.startsWith('void-stars-')) starLayer = n;
    for (const c of n.children ?? []) find(c);
  };
  find(app.stage);
  if (!starLayer) return { error: 'no star layer on the stage' };
  const Graphics = starLayer.constructor;

  // The very `Texture` the star layer fills its halos with, lifted off the live
  // instruction list — the bundle is minified, so this is also the only way to
  // get a `Texture` and a `Matrix` instance without importing pixi.
  let rampTexture = null;
  let Matrix = null;
  for (const raw of starLayer.context?.instructions ?? []) {
    const style = raw?.data?.style;
    if (style?.texture && String(style.texture.source?.label ?? '').includes('falloff-ramp')) {
      rampTexture = style.texture;
      Matrix = style.matrix?.constructor ?? null;
      break;
    }
  }
  if (!rampTexture || !Matrix) return { error: 'no ramp fill on the star layer' };
  const ramp = rampTexture.source;

  const root = new Container();
  const bg = new Graphics();
  bg.rect(0, 0, 256, 256).fill({ color: 0x000000, alpha: 1 });
  root.addChild(bg);
  const paint = new Graphics();
  // 1:1, no matrix — one ramp texel per pixel, so a read-back pixel IS a texel.
  paint.rect(0, 0, 256, 256).fill({
    texture: rampTexture,
    matrix: new Matrix(),
    color: 0xffffff,
    alpha: 1,
  });
  root.addChild(paint);

  const baked = app.renderer.generateTexture({ target: root, resolution: 1, antialias: false });
  const read = app.renderer.extract.pixels(baked);
  const px = read.pixels ?? read;
  const at = (x, y) => {
    const i = (y * 256 + x) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  const src = ramp.resource;
  const authored = (x, y) => {
    const i = (y * 256 + x) * 4;
    return [src[i], src[i + 1], src[i + 2], src[i + 3]];
  };
  const rows = [];
  for (const d of [10, 20, 40, 60, 80, 100, 110]) {
    rows.push({ texel: `+${d}`, authored: authored(128 + d, 128), readBack: at(128 + d, 128) });
  }
  return {
    alphaMode: ramp.alphaMode,
    mipLevelCount: ramp.mipLevelCount,
    autoGenerateMipmaps: ramp.autoGenerateMipmaps,
    format: ramp.format,
    rows,
  };
});

writeFileSync(join(HERE, `ramp-${TAG}.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(`--- ${TAG} (${WAITSEL ? 'with' : 'without'} the early canvas query) ---`);
console.log(JSON.stringify(out, null, 2));
await browser.close();
