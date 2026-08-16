/**
 * evidence/a0-53-bloom-radius/capture.spec.ts — the shipped frame, captured.
 * OWNER: Art Agent.
 *
 * Boots the REAL preview build exactly the way QA's frozen goldens do
 * (`?debug=1&freeze=1`, which boots `octagon` — the map whose sky is NONE, so
 * the field is ground + star layers and nothing else) and writes the raw frame
 * to `frames/desktop-frozen-octagon.png`.
 *
 * It also records the CAMERA OFFSET beside it. `Renderer.centerCamera` writes
 * one number into both `worldRoot` and `backdrop.update`, and `projectToScreen`
 * is `worldRoot + world` — so `shipScreen - shipWorld`, read off the app's own
 * published instrument, IS that offset. With it the frame can be REGISTERED
 * against the model, which is what lets a measured blob be identified rather
 * than guessed at.
 *
 * ```sh
 * PREVIEW_PORT=4259 npx playwright test \
 *   --config evidence/a0-53-bloom-radius/playwright.config.ts
 * ```
 */
import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFrames } from '../../tests/mobile/render-settle';

const FRAMES = join(dirname(fileURLToPath(import.meta.url)), 'frames');

/** QA's own frozen boot (tests/mobile/goldens.spec.ts `bootFrozen`). */
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

test('capture the shipped frame', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(FRAMES, { recursive: true });
  await bootFrozen(page);

  // A canvas whose CSS size differs from its backing store is resampled by the
  // compositor, which would put a scale factor between the frame and the model.
  // Recorded so the registration below cannot be quietly wrong.
  const geom = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { backing: { w: c.width, h: c.height }, css: { w: r.width, h: r.height }, dpr: window.devicePixelRatio };
  });
  console.log(`canvas geometry: ${JSON.stringify(geom)}`);

  writeFileSync(join(FRAMES, 'desktop-frozen-octagon.png'), await page.screenshot());

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
    join(FRAMES, 'desktop-frozen-octagon.json'),
    `${JSON.stringify({ ...hook, cameraOffset, canvas: geom }, null, 2)}\n`,
  );
  console.log(`camera offset = ${JSON.stringify(cameraOffset)}`);
});
