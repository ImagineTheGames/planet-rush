/**
 * tests/live-stage/playwright.log-download.config.ts — the live-stage run that
 * happens IN A HAND, and then again at a desk.
 * OWNER: Gameplay Engineer (ratified M10; M10 action-echo §5, mobile logs).
 *
 * *"Clipboard goes away for all (PC and mobile). It should be DOWNLOAD LOG not COPY
 * LOG."*
 *
 * This config used to run one project. The feature it covered was the phone's — the
 * whole original defect was that the developer, mid-playtest on a phone, had no way
 * to get a log off it — and a phone profile is still the harder half: the affordance
 * is DOM over the canvas (`src/net/playtest-log-button.ts`), so what a finger can
 * reach, and which way it reads under the landscape lock, are properties only a touch
 * profile can assert.
 *
 * But the ratification is a claim about **two** devices. "For all (PC and mobile)" is
 * not provable from a phone alone: the clipboard route that died was the desk's
 * default, so the desk is exactly where a regression would reappear unnoticed. Hence
 * two projects over the same spec — `phone` for the hand, `desk` for the 1280×800
 * mouse-and-keyboard profile every other live-stage config runs.
 *
 * Offline bundle on purpose — no allocator. The pause menu and the log are reachable
 * in an offline match, which is the mode the developer plays while travelling
 * (GDD §4.3 constraint 2), and pulling a fleet up would only add ways for this to
 * fail for reasons that are not about the log.
 *
 *   npx playwright test --config tests/live-stage/playwright.log-download.config.ts
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

/** The desk: the same profile the rest of the live-stage suite runs, so a
 *  regression here would show up looking like every other desktop run. */
export const DESK = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
} as const;

export default defineConfig({
  testDir: '.',
  testMatch: /log-download\.spec\.ts/,
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

  projects: [
    { name: 'phone', use: { browserName: chromium, ...PHONE } },
    { name: 'desk', use: { browserName: chromium, ...DESK } },
  ],

  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    cwd: ROOT,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
