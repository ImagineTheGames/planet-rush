import { test, type Page } from '@playwright/test';
import { settleFrames } from '../../tests/mobile/render-settle';

async function boot(page: Page): Promise<void> {
  await page.goto('/?debug=1&freeze=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => {
    const pr = (window as any).__planetRush; return !!pr && pr.frozen === true;
  }, undefined, { timeout: 20_000 });
  await settleFrames(page);
}

test('spy on GL', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const w = window as any;
    w.__gl = { uploads: [], order: [] };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: any, attrs: any) {
      const c = orig.call(this, type, attrs);
      if (type === 'webgl2' || type === 'webgl') {
        const g: any = c;
        w.__glctx = g;
        let premul = false; // WebGL default
        const ps = g.pixelStorei;
        g.pixelStorei = function (pname: number, param: any) {
          if (pname === 37441) premul = !!param;
          return ps.call(this, pname, param);
        };
        const t2 = g.texImage2D;
        g.texImage2D = function (...a: any[]) {
          const src = a[a.length - 1];
          const isBuf = !!(src && src.byteLength !== undefined);
          const width = a[3], height = a[4];
          const bound = g.getParameter(g.TEXTURE_BINDING_2D);
          w.__gl.order.push({
            kind: isBuf ? `buffer ${width}x${height} L${a[1]}` : `dom ${src?.constructor?.name}`,
            premultiplyFlagActive: premul,
          });
          if (isBuf && width === 256 && height === 256 && a[1] === 0) {
            const row = 128, samples: number[][] = [];
            for (const x of [128, 150, 170, 190, 210, 220]) {
              const i = (row * 256 + x) * 4;
              samples.push([x, src[i], src[i + 3]]);
            }
            w.__gl.uploads.push({ premultiplyFlagActive: premul, sourceSamples: samples, tex: bound });
            w.__ramps = w.__ramps || []; w.__ramps.push(bound);
          }
          return t2.apply(this, a);
        };
      }
      return c;
    } as any;
  });
  await boot(page);

  const out = await page.evaluate(() => {
    const w = window as any;
    const g = w.__glctx;
    // Read the ramp textures BACK OUT of the GPU: what is actually stored,
    // after whatever the upload path did to it.
    const readback = (tex: WebGLTexture): number[][] => {
      const fb = g.createFramebuffer();
      g.bindFramebuffer(g.FRAMEBUFFER, fb);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
      const px = new Uint8Array(256 * 4);
      const rows: number[][] = [];
      if (g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE) {
        g.readPixels(0, 128, 256, 1, g.RGBA, g.UNSIGNED_BYTE, px);
        for (const x of [128, 150, 170, 190, 210, 220]) rows.push([x, px[x * 4], px[x * 4 + 3]]);
      }
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      g.deleteFramebuffer(fb);
      return rows;
    };
    return {
      order: w.__gl.order.slice(0, 40),
      uploads: w.__gl.uploads.map((u: any, i: number) => ({
        premultiplyFlagActive: u.premultiplyFlagActive,
        sourceSamples: u.sourceSamples,
        storedInGpu: readback(w.__ramps[i]),
      })),
    };
  });
  console.log(JSON.stringify(out, null, 1));
});
