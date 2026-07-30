/**
 * tests/live-stage/playwright.build-badge-online.config.ts — the badge's server
 * suffix, with a fleet behind it.
 *
 * A near-twin of `./playwright.connect-trace.config.ts` (read that file for why a
 * fleet is needed at all): two match Machines with the socket-hop pin armed, a
 * Fly-shaped edge in front of them, a real allocator, and `vite preview` on a
 * bundle built with `VITE_ALLOCATOR_URL` pointed at it. Its own ports, so this run
 * and a connect-trace run cannot collide over a socket.
 *
 * `PR_LIVE_FLEET=1` is what tells `./build-badge-online.spec.ts` that there is
 * something to connect to; without it (the default live-stage config, an offline
 * bundle) that spec skips itself instead of failing about a server that was never
 * asked to exist.
 *
 *   npx playwright test --config tests/live-stage/playwright.build-badge-online.config.ts
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** The repository root — both webServer commands are repo-root commands. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PREVIEW_PORT = 4175;
const ALLOCATOR_PORT = 8793;
const EDGE_PORT = 8794;
/** Long enough for the spec to read "DIALING MACHINE …" off the title before the
 *  welcome overtakes it; on localhost the socket would otherwise open in a frame. */
const HOP_DELAY_MS = 1200;

const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const ALLOCATOR_URL = `http://127.0.0.1:${ALLOCATOR_PORT}`;

// Read by the spec (workers inherit this process's env) — the "there is a fleet"
// switch. Set here rather than demanded of the caller, so the documented one-line
// command is the whole invocation.
process.env['PR_LIVE_FLEET'] = '1';

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  testMatch: /build-badge-online\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },

  webServer: [
    {
      command:
        `LOCAL_FLEET=serve LOCAL_FLEET_PORT=${ALLOCATOR_PORT} LOCAL_FLEET_EDGE_PORT=${EDGE_PORT} ` +
        `LOCAL_FLEET_HOP_DELAY_MS=${HOP_DELAY_MS} npx vite-node tests/net/local-fleet.ts`,
      url: `${ALLOCATOR_URL}/health`,
      cwd: ROOT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        `VITE_ALLOCATOR_URL=${ALLOCATOR_URL} npm run build && ` +
        `npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      cwd: ROOT,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
