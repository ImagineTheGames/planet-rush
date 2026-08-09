/**
 * evidence/a0-14-hangar/playwright.config.ts — the a0-14 captures. OWNER: UI Engineer.
 *
 * The brief asks for *"the hangar at 390 px landscape and at desktop, with a
 * real ship and a real level on it, plus the empty-state frame"* — and says
 * which one matters: *"the empty frame is the one that matters, because it is
 * the one that ships first."*
 *
 * So this runs against the SHIPPED bundle (`vite build` → `vite preview`), not a
 * dev server and not jsdom: the ship in the bay is drawn by the real generator
 * through the real Pixi path, and the level comes off the real profile reader.
 * The only thing seeded is `localStorage` — a real profile blob, read by the
 * real `loadProfile`, exactly as a player's own would be.
 *
 *   node evidence/a0-14-hangar/run.mjs
 *   # or:  npx playwright test --config evidence/a0-14-hangar/playwright.config.ts
 *
 * **The port is private (4188), deliberately.** The shared 4173 is what
 * `tests/live-stage` and the mobile suite use, and a preview already listening
 * there serves whatever bundle it was started with — a green run against another
 * lane's stale artifact. `--strictPort` plus a port nobody else claims means this
 * config either serves the bundle it just built or fails loudly.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { resolve } from 'node:path';

const PREVIEW_PORT = 4188;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const OUT_DIR = 'dist-a0-14';

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
  },
  projects: [
    {
      // The desktop control, dpr 1 — the same frame the mobile suite calls
      // `desktop`, so the two are comparable.
      name: 'desktop',
      use: { browserName: chromium, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
      testMatch: /desktop\.spec\.ts/,
    },
    {
      // The target: a 390 px phone held PORTRAIT. The landscape lock rotates the
      // game root, so the hangar lays out in an 844×390 LOGICAL viewport — which
      // is the case a0-14 says has to work rather than merely fit. Same
      // descriptor as the mobile suite's `iphone`.
      name: 'phone',
      use: {
        browserName: chromium,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
      testMatch: /phone\.spec\.ts/,
    },
  ],
  webServer: {
    command: `npx vite build --outDir ${OUT_DIR} && npx vite preview --outDir ${OUT_DIR} --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    cwd: resolve(import.meta.dirname, '..', '..'),
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
