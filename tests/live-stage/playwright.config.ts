/**
 * tests/live-stage/playwright.config.ts — the LIVE-STAGE suite. OWNER: Platform Engineer.
 *
 * A test class the unit suite cannot fake: it boots the REAL preview bundle (the
 * same artifact the classroom loads, GDD §4.6) and asserts what the booted client
 * puts on the PixiJS stage — not the render MODEL a unit test constructs in memory.
 * It exists for the round-2 field bug (enemy fire and turret fire invisible in the
 * real client while m2-11's model-level unit tests stayed green): the wiring from
 * sim combat state to the render layer lived nowhere a unit test could reach.
 *
 * Like the mobile suite it runs against `vite preview` on the built bundle, Chromium
 * only, desktop viewport. Separate config (not a project on the mobile one) so the
 * mobile matrix stays exactly the device contract it documents.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

/**
 * The preview port — overridable with `PREVIEW_PORT` *(a0-06, proposed; default
 * unchanged, so CI and a single checkout behave exactly as before)*.
 *
 * `reuseExistingServer` reuses **whatever is already listening on this port**, and
 * it cannot tell one workspace's preview from another's. Two agent lanes building
 * the same repo side by side therefore run each other's bundle: the suite boots,
 * the seams are the *other* branch's, and a readback that is impossible reads as
 * missing wiring in code that is wired. This branch's own working note carries the
 * trap as a warning ("check `pgrep -fa 'vite preview'` before you debug the app")
 * and a later session lost the time again anyway, so here is the warning as a
 * mechanism: `PREVIEW_PORT=4191 npm run test:live-stage` takes a private port.
 *
 * Marked separately because `tests/live-stage/` is Platform's; it is a default-
 * preserving test-infra change and drops cleanly if the owner would rather not.
 */
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT ?? 4173);
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: {
        browserName: chromium,
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
    },
  ],

  // Build once, serve the production bundle — the suite runs against the real
  // shipped artifact. Reuse a running preview locally; always start fresh in CI.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
