/**
 * tests/live-stage/playwright.copy-log.config.ts — the live-stage run that happens
 * IN A HAND. OWNER: Netcode Engineer (M10 action-echo §5, mobile logs).
 *
 * *"MOBILE LOGS (the developer had NO way to send them) … Live-stage on a phone
 * profile proves an export path exists on touch."*
 *
 * Every other live-stage config runs a desk: 1280×800, no touch, a mouse. That is
 * the wrong device for this feature by definition — the whole defect is that the
 * developer, on a phone, mid-playtest, had no way to get a log off it. So this
 * config is the same shipped bundle at a **phone profile**: portrait viewport, real
 * touch events, `isMobile`, a device pixel ratio a phone actually has. The COPY LOG
 * affordance is DOM over the canvas (`src/net/playtest-log-button.ts`), so what a
 * finger can reach is a property only a touch profile can assert.
 *
 * Offline bundle on purpose — no allocator. The pause menu and the log are reachable
 * in an offline match, which is the mode the developer plays while travelling
 * (GDD §4.3 constraint 2), and pulling a fleet up would only add ways for this to
 * fail for reasons that are not about the log.
 *
 *   npx playwright test --config tests/live-stage/playwright.copy-log.config.ts
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** The repository root — `webServer.command` resolves against the config's own
 *  directory, and this is a repo-root command. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PREVIEW_PORT = 4175;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

/** The developer's phone, near enough: a 390×844 portrait viewport at DPR 3 — the
 *  iPhone-class profile the mobile suite and the rest of the M10 phone evidence
 *  already use, so a screenshot from here is comparable to those. */
export const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
} as const;

export default defineConfig({
  testDir: '.',
  // Both phone-profile log specs: COPY LOG's export path (`copy-log-touch`) and
  // its DOWNLOAD sibling's (`log-download-touch`, ratified M10 §3 — "too large for
  // mobile clipboard"). One config, because they need the identical device: an
  // offline bundle at a portrait touch viewport, which is where the defect was.
  testMatch: /(copy-log-touch|log-download-touch)\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'phone', use: { browserName: chromium, ...PHONE } }],

  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    cwd: ROOT,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
