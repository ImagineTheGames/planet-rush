/**
 * playwright.u17.config.ts — the lobby browser's evidence run. OWNER: UI
 * Engineer (u17-01).
 *
 * Two things this needs that the committed mobile config cannot give it:
 *
 *  1. **An allocator URL in the bundle.** `allocatorUrlFromEnv` reads
 *     `VITE_ALLOCATOR_URL` at BUILD time, so a preview built without one never
 *     asks for a listing at all — the browse screen would be correct and empty
 *     forever. This build sets one; the spec then answers every allocator call
 *     itself with `page.route`, so the fleet under test is a fixture rather than
 *     a deployment (and nothing here can spend money — §6/D5 is the developer's).
 *  2. **Its own directory and its own port.** `tests/mobile/` is QA's suite and
 *     is collected by the committed config, where these routes would not be
 *     installed and this spec would fail for the wrong reason. And several lanes
 *     share this box: whichever lane holds 4173 first serves ITS bundle to every
 *     other lane's suite, which is the stale-bundle trap that silently
 *     invalidates goldens (a0-06). Private port, own build,
 *     `reuseExistingServer: false`.
 *
 * Run: `npx playwright test --config playwright.u17.config.ts`
 * Frames: `PR_EVIDENCE=1 npx playwright test --config playwright.u17.config.ts`
 */
import base from './playwright.config';
import { defineConfig } from '@playwright/test';

const PREVIEW_PORT = 4198;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

/** A host nothing resolves: every request to it is answered by `page.route`, and
 *  any that is not is a test that would hang rather than one that quietly passed
 *  against a real fleet. */
const ALLOCATOR = 'http://allocator.u17.test';

export default defineConfig({
  ...base,
  testDir: './tests/browse',
  // The committed config shards `tests/mobile/` by a measured cost table. This
  // run is four tests on one project and has nothing to balance.
  testMatch: undefined,
  // One profile: the 390 px landscape phone the developer plays on, which is the
  // device every claim in the spec is about.
  projects: (base.projects ?? []).filter((project) => project.name === 'iphone'),
  use: { ...base.use, baseURL: PREVIEW_URL },
  webServer: {
    command:
      `VITE_ALLOCATOR_URL=${ALLOCATOR} npm run build && ` +
      `npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});

export { ALLOCATOR };
