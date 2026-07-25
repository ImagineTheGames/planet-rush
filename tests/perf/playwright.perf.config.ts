/**
 * tests/perf/playwright.perf.config.ts — the frame-time capture suite's config.
 * OWNER: QA Agent (GDD §4.3 performance budget, §4.6 M5 gate).
 *
 * Its own config rather than a fourth project in `playwright.config.ts`, for one
 * reason: **this suite is a measurement instrument first and a gate second.**
 * The mobile-emulation suite gates every PR; a frame-rate assertion cannot,
 * because GitHub's runners render WebGL through SwiftShader on a shared vCPU and
 * would fail 60 fps on hardware that has no GPU at all. So:
 *
 *   npx playwright test --config tests/perf/playwright.perf.config.ts
 *
 * always *measures* and always prints the numbers; it only *fails* when
 * `PERF_GATE=1` marks the host as real hardware — the developer's laptop for the
 * 60 fps desktop gate, and the developer's phone (via `PERF_GATE=1` against a
 * deployed URL) for the mobile gate (GDD §4.3: "60 fps on the developer's own
 * phone … with a 30 fps floor on a 3-year-old mid-range Android").
 *
 * Two projects, matching the two gates in GDD §4.3: `desktop` (1280×800 dpr1)
 * and `phone-landscape` (844×390 dpr3 — the iPhone-ish profile rotated into the
 * only orientation the game plays in).
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

const PREVIEW_PORT = 4174; // not 4173: this suite must be runnable alongside the mobile one
const PREVIEW_URL = process.env.PERF_URL ?? `http://localhost:${PREVIEW_PORT}`;

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

/** A remote target (a deploy, the developer's phone over the network) needs no
 *  local preview server — and must not start one. */
const usingRemote = Boolean(process.env.PERF_URL);

export default defineConfig({
  testDir: '.',
  // A hung capture is a failed test, never a hung suite (the QA charter's
  // enforced-timeout rule, applied outside the sim).
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Never retry a performance measurement: a retry that passes would report the
  // best of two runs as if it were the run.
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    trace: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: { browserName: chromium, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
    {
      name: 'phone-landscape',
      use: {
        browserName: chromium,
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  ...(usingRemote
    ? {}
    : {
        webServer: {
          command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
          url: PREVIEW_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      }),
});
