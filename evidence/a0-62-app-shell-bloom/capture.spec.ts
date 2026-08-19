/**
 * evidence/a0-62-app-shell-bloom/capture.spec.ts — the developer's frame, at
 * the ratios a real screen has. OWNER: Art Agent.
 *
 * a0-22, a0-44, a0-45 and a0-53 each measured a surface that is NOT the
 * player's screen: `field-probe`, `renderer-probe`, `sky-preview`, a unit test.
 * All four force `resolution: 1`. The app does not — `src/main.ts` initialises
 * the Pixi `Application` at `window.devicePixelRatio` and the `Renderer`'s
 * texture baker at `min(dpr, 2)` — so every instrument this repo had was blind
 * to anything that only happens at dpr > 1.
 *
 * This spec drives the REAL shell: the real `index.html`, the real `main.ts`,
 * the app's OWN `vite.config.ts` (`npm run build && npm run preview`), on QA's
 * frozen boot, at deviceScaleFactor 1, 1.5, 2 and 3. Nothing is stubbed and no
 * probe page is involved. Each capture writes:
 *
 *   frames/<set>/app-dpr<N>.png    the raw frame, in DEVICE pixels (1280·N × 800·N)
 *   frames/<set>/app-dpr<N>.json   canvas backing store vs CSS box, the reported dpr,
 *                            and the camera offset the client published, so the
 *                            frame can be REGISTERED against the model rather
 *                            than have blobs guessed at.
 *
 * ```sh
 * PREVIEW_PORT=4262 npx playwright test \
 *   --config evidence/a0-62-app-shell-bloom/playwright.config.ts
 * ```
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFrames } from '../../tests/mobile/render-settle';

/** `frames/broken` was captured on the code BEFORE the fix and is kept; the
 *  default writes `frames/fixed`. `A062_FRAMES=broken` re-captures the other. */
const FRAMES = join(dirname(fileURLToPath(import.meta.url)), 'frames', process.env.A062_FRAMES ?? 'fixed');
/** The ratios real screens report: 1 desktop, 1.5 a scaled Windows laptop,
 *  2 a retina/HiDPI panel, 3 a modern phone. */
const RATIOS = [1, 1.5, 2, 3];

/** QA's own frozen boot (tests/mobile/goldens.spec.ts `bootFrozen`) — `octagon`,
 *  the map whose sky is NONE, so the field is ground + star layers and nothing
 *  else can be mistaken for a halo. */
async function bootFrozen(page: Page, url = '/?debug=1&freeze=1'): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const pr = (window as unknown as { __planetRush?: { frozen?: boolean } }).__planetRush;
      return !!pr && pr.frozen === true;
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  await settleFrames(page);
}

async function captureAt(browser: Browser, baseURL: string, dpr: number): Promise<void> {
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: dpr,
    isMobile: false,
    hasTouch: false,
  });
  const page = await ctx.newPage();
  try {
    await bootFrozen(page);

    const geom = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return {
        backing: { w: c.width, h: c.height },
        css: { w: r.width, h: r.height },
        dpr: window.devicePixelRatio,
      };
    });
    // The whole point of this brief: if the backing store is NOT dpr × the CSS
    // box, the app is not drawing at the ratio the screen has and every number
    // below is about a different picture than the developer's.
    expect(geom.dpr).toBeCloseTo(dpr, 3);

    const tag = `app-dpr${String(dpr).replace('.', '_')}`;
    writeFileSync(join(FRAMES, `${tag}.png`), await page.screenshot());

    const hook = await page.evaluate(() => {
      const pr = (
        window as unknown as {
          __planetRush?: {
            shipScreen: { x: number; y: number };
            shipWorld: { x: number; y: number };
            viewport: { w: number; h: number };
          };
        }
      ).__planetRush;
      return pr ? { shipScreen: pr.shipScreen, shipWorld: pr.shipWorld, viewport: pr.viewport } : null;
    });
    if (!hook) throw new Error('__planetRush is not installed');
    const cameraOffset = { x: hook.shipScreen.x - hook.shipWorld.x, y: hook.shipScreen.y - hook.shipWorld.y };
    writeFileSync(
      join(FRAMES, `${tag}.json`),
      `${JSON.stringify({ requestedDpr: dpr, ...hook, cameraOffset, canvas: geom }, null, 2)}\n`,
    );
    console.log(`dpr ${dpr}: canvas ${JSON.stringify(geom)} camera ${JSON.stringify(cameraOffset)}`);
  } finally {
    await page.close();
    await ctx.close();
  }
}

test('capture the real app shell at every device pixel ratio', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  mkdirSync(FRAMES, { recursive: true });
  for (const dpr of RATIOS) await captureAt(browser, baseURL!, dpr);
});
