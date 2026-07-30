/**
 * tests/live-stage/playwright.connect-trace.config.ts — the one live-stage run
 * that has a fleet behind it. OWNER: Netcode Engineer (M10 verbose connecting).
 *
 * Every other live-stage config boots the *offline* bundle: no `VITE_ALLOCATOR_URL`,
 * so CREATE can only ever reach "can't reach the servers". That is the right test
 * for the offline promise and the wrong one for a connecting screen, whose whole
 * subject is the four steps *after* the allocator answers.
 *
 * So this config stands up two servers:
 *
 *   1. `tests/net/local-fleet.ts` — two match Machines with the socket-hop pin
 *      armed, a Fly-shaped edge in front of them, and a real allocator on the real
 *      FlyReplayRouter, on fixed ports so a built bundle can be told about them.
 *   2. `vite preview` on a bundle built with `VITE_ALLOCATOR_URL` pointed at that
 *      allocator — the shipped artifact, wired to a fleet.
 *
 * The edge holds each upgrade for {@link HOP_DELAY_MS} so the dial is photographable:
 * on localhost the socket opens in single-digit milliseconds, and a screenshot of
 * "DIALING MACHINE 0800d5b6…" would otherwise be a lucky frame. Nothing about the
 * client changes — the delay is in the fixture standing in for Fly's edge, which on
 * a real network is slower than this anyway.
 *
 *   npx playwright test --config tests/live-stage/playwright.connect-trace.config.ts
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** The repository root. Playwright resolves a `webServer.command`'s cwd against
 *  the config file's directory, and both commands here are repo-root commands. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PREVIEW_PORT = 4174;
const ALLOCATOR_PORT = 8791;
const EDGE_PORT = 8792;
/** Long enough to photograph a dial, short enough to stay well under STALL_MS. */
const HOP_DELAY_MS = 1200;

const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const ALLOCATOR_URL = `http://127.0.0.1:${ALLOCATOR_PORT}`;

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  testMatch: /connect-trace\.spec\.ts/,
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
