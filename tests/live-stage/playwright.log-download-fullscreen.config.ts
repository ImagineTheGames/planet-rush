/**
 * tests/live-stage/playwright.log-download-fullscreen.config.ts — the phone the
 * developer was actually holding. OWNER: Netcode Engineer (a0-28).
 *
 * *"download logs used to live in match as well pretty sure it was in pause menu."*
 * … *"I was on mobile."*
 *
 * One project, and the profile is the whole point of having a second config rather
 * than a third project on `playwright.log-download.config.ts`:
 *
 *  - **844×390, landscape.** That config's `phone` is 390×844 **portrait**, where the
 *    landscape lock rotates the game root and this affordance turns with it — and its
 *    spec asserts exactly that rotation, so a landscape project bolted onto it would
 *    fail on a rule that is correct. The developer's capture is a landscape frame.
 *  - **Clean boot, no `?debug=1`.** This is the bit that matters. `?debug=1` drops
 *    straight into a match, which skips PLAY — and PLAY is what enters fullscreen on
 *    the game root (`@platform/fullscreen`), which is what buried the affordance.
 *    A phone spec that never presses PLAY can be green while the phone is blank, and
 *    for one build that is precisely what happened.
 *
 * Offline bundle, no allocator, for the same reason as its sibling: the pause menu
 * and the log are reachable in an offline match, and a fleet would only add ways for
 * this to fail for reasons that are not about the log.
 *
 * ── HAS THIS RUN? ──────────────────────────────────────────────────────────
 * Recorded in the PR body with the evidence PNGs it writes. Chromium in some lanes
 * needs its shared libraries staged on `LD_LIBRARY_PATH` first
 * (`docs/netcode-action-echo.md`).
 *
 *   npx playwright test --config tests/live-stage/playwright.log-download-fullscreen.config.ts
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** The repository root — `webServer.command` resolves against the config's own
 *  directory, and this is a repo-root command. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PREVIEW_PORT = 4176;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

/** The developer's phone held the way the game is played: an iPhone-class viewport
 *  in **landscape**, 844×390 at DPR 3 — the same profile a0-24 measures its
 *  bottom-edge clipping on, so the two reports are read against one board. */
export const PHONE_LANDSCAPE = {
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
} as const;

export default defineConfig({
  testDir: '.',
  testMatch: /log-download-fullscreen\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'phone-landscape', use: { browserName: chromium, ...PHONE_LANDSCAPE } }],

  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    cwd: ROOT,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
