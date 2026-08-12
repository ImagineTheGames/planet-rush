/**
 * evidence/a0-31-solo-no-open-slots/playwright.config.ts — the frame a0-31 asks
 * for. OWNER: UI Engineer.
 *
 * The brief: *"a frame of a solo lobby showing only BOT and CLOSED seats."* That
 * is an OFFLINE claim, so unlike a0-11's captures it needs no allocator and no
 * match server: the shipped bundle with no `VITE_ALLOCATOR_URL` is exactly the
 * artifact PLAY SOLO runs on, and the whole rule under test — *"no one can join
 * in solo"* — is a statement about that flavour.
 *
 *   npx playwright test --config evidence/a0-31-solo-no-open-slots/playwright.config.ts
 *
 * **A private port and a private outDir, on purpose.** `reuseExistingServer`
 * cannot tell one lane's `vite preview` from another's, and a capture attributed
 * to another branch's bundle is worse than a red run (the trap the mobile and
 * live-stage configs both carry a warning about). 4196 and `dist-a0-31` are this
 * capture's alone, and the server is never reused.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { resolve } from 'node:path';

const PREVIEW_PORT = Number(process.env.PREVIEW_PORT ?? 4196);
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const OUT_DIR = 'dist-a0-31';

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command:
      `npx vite build --outDir ${OUT_DIR} && ` +
      `npx vite preview --outDir ${OUT_DIR} --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    cwd: resolve(import.meta.dirname, '..', '..'),
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
