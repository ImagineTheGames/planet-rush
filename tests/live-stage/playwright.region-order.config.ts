/**
 * tests/live-stage/playwright.region-order.config.ts — the region ranking, on the
 * real bundle against the real fleet. OWNER: Netcode Engineer (a0-29).
 *
 * Unlike its neighbours, this config stands up **no local fleet**. The defect it
 * guards (a0-29: probes overlapping on one shared connection to one anycast edge)
 * does not exist on localhost, where every hop is free and there is no edge to
 * share — a local fleet would pass on the broken build. So the bundle is built
 * with `VITE_ALLOCATOR_URL` pointed at the **deployed** allocator and the client
 * measures the actual datacentres, over the actual internet, from wherever this
 * machine happens to be.
 *
 * `PR_LIVE_REGIONS=1` is what tells `./region-order.spec.ts` there is a fleet to
 * reach; without it the spec skips rather than failing about a network it was
 * never given. The spec skips again, on its own, unless the edge confirms this
 * machine's nearest region is the one its assertion is written for.
 *
 * The preview origin is `http://localhost`, which `src/net/cors.ts` always allows,
 * so the probe's cross-origin `GET /health` is granted exactly as it is from the
 * shipped GitHub Pages origin.
 *
 *   npx playwright test --config tests/live-stage/playwright.region-order.config.ts
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** The repository root — the webServer command is a repo-root command. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PREVIEW_PORT = 4176;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const ALLOCATOR_URL = 'https://planet-rush-allocator.fly.dev';

// Read by the spec (workers inherit this process's env) — the "there is a fleet"
// switch, set here so the documented one-line command is the whole invocation.
process.env['PR_LIVE_REGIONS'] = '1';

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  testMatch: /region-order\.spec\.ts/,
  // A survey over the real internet is slow by construction: a warm-up plus three
  // serial samples per region, and a far region costs ~180ms a sample.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  // Never retried: a flaky ranking is the bug, so a pass on the second attempt
  // would be the exact failure this spec exists to catch.
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },

  webServer: {
    command:
      `VITE_ALLOCATOR_URL=${ALLOCATOR_URL} npm run build && ` +
      `npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    cwd: ROOT,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
