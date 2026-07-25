/**
 * playwright.live-stage.config.ts — the live-stage suite. OWNER: UI Engineer.
 *
 * Boots the REAL production bundle (`vite build` → `vite preview`, the same
 * artifact the classroom loads) and drives it through the `?debug=1` staging
 * seams to prove a client behaviour that only a booted client can answer.
 *
 * It exists because the enemy over-ship health bars shipped dead twice: the
 * pure model (`src/ui/healthbar`) was unit-green, but nothing verified the layer
 * was on the stage AND fed sim state on a real boot — so the bars were never
 * drawn in the actual client (QA round-1/round-2 `enemy-healthbars`). A headless
 * unit test could not have caught that; only booting the bundle and looking at
 * what the layer drew can. Desktop Chromium is enough — the wiring under test is
 * device-independent.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  // A hung page load is a failed test, never a hung suite.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },

  // Build once, then serve the production bundle — the suite runs against the
  // real shipped artifact, the same discipline as the mobile suite.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
