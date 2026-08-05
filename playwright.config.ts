/**
 * playwright.config.ts — mobile-emulation suite. OWNER: QA Agent.
 *
 * Drives the QA mobile-emulation suite (`tests/mobile/`) against the real Vite
 * preview build, so it exercises the same bundle the classroom loads — not a
 * dev server, not jsdom (GDD §4.6 M1: "phone-verified"; §4.3b risk 7 "mobile
 * browser quirks"). This suite was added after M1 phone verification caught
 * invisible touch UI and unhandled portrait; it makes that class of miss
 * impossible to ship again by asserting the affordances are actually *rendered*
 * (pixel-level), not merely present in the DOM — the app draws everything into a
 * single PixiJS/WebGL canvas, so a DOM-presence check would have missed the bug.
 *
 * Chromium only (brief): one engine, emulated across the device matrix. Custom
 * device descriptors match the brief's exact numbers rather than Playwright's
 * built-in profiles, so the matrix is the contract:
 *   - iPhone-ish : 390×844  dpr 3    touch   (portrait by default)
 *   - Pixel-ish  : 412×915  dpr 2.6  touch   (portrait by default)
 *   - Desktop    : 1280×800 dpr 1    no touch (control)
 *
 * `isMobile`/`hasTouch` are Chromium-only Playwright features — fine here.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: './tests/mobile',
  // A hung page load is a failed test, never a hung suite (QA charter: enforced
  // timeouts). These bound each test and each assertion.
  //
  // `timeout` here is the FLOOR, not the suite's budget. It is the right number
  // for a two-assertion test and the wrong one for a journey — orient, boot, hold
  // thrust, settle, assert — which on a software-GL CI runner costs ~6× what it
  // costs on this hardware. A flat 60 s cut centering.spec.ts off mid-journey and
  // held `main` red for two days (q7-01), after flaking a green PR four times
  // before that.
  //
  // DO NOT RAISE THIS NUMBER to fix a slow test. A blanket bump buys silence
  // across the whole suite and hides the next genuine hang. Every test in
  // tests/mobile/ instead declares the work it does and takes the budget that
  // follows, via `budgetTest()` in tests/mobile/budgets.ts — and
  // tests/mobile-budget-contract.test.ts fails the build if one forgets to.
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
      name: 'iphone',
      use: {
        browserName: chromium,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'pixel',
      use: {
        browserName: chromium,
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 2.6,
        isMobile: true,
        hasTouch: true,
      },
    },
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

  // Build once, then serve the production bundle with `vite preview` — the suite
  // runs against the real shipped artifact (GDD §4.6). Reuse a running preview
  // locally; always start fresh in CI.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
