/**
 * tests/live-stage/playwright.link-loss.config.ts — the CONNECTION LOST overlay,
 * over a real socket that really dies. OWNER: Netcode Engineer (n6-01).
 *
 * A near-twin of `./playwright.build-badge-online.config.ts` (read
 * `./playwright.connect-trace.config.ts` for why a fleet is needed at all): two
 * match Machines with the pin armed, a Fly-shaped edge in front of them, a real
 * allocator, and `vite preview` on a bundle built with `VITE_ALLOCATOR_URL` pointed
 * at it. Its own ports, so this run cannot collide with either of the others.
 *
 * The edge is the instrument. `?gag=1` on its control route stops delivery from the
 * Machines **without closing anything** (`tests/net/fly-edge.ts` `gag`), which is the
 * developer's zombie match exactly: sockets open, `readyState` still `OPEN`, no
 * `onclose` anywhere, and not one further frame. No client code is involved in
 * producing that state, which is the point — the spec proves the shipped bundle
 * notices it and says so.
 *
 * `PR_LIVE_FLEET=1` is what tells `./link-loss.spec.ts` there is something to
 * connect to; without it (the default live-stage config, an offline bundle) the spec
 * skips itself rather than failing about a server nobody asked for.
 *
 *   npx playwright test --config tests/live-stage/playwright.link-loss.config.ts
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** The repository root — both webServer commands are repo-root commands. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PREVIEW_PORT = 4176;
const ALLOCATOR_PORT = 8795;
const EDGE_PORT = 8796;

const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const ALLOCATOR_URL = `http://127.0.0.1:${ALLOCATOR_PORT}`;

// Read by the spec (workers inherit this process's env) — the "there is a fleet"
// switch, set here so the documented one-line command is the whole invocation.
process.env['PR_LIVE_FLEET'] = '1';

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  testMatch: /link-loss\.spec\.ts/,
  // Two browsers, a room, a match, and a 2.5-second silence limit crossed in real
  // time — this run does not get to move a clock.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    viewport: { width: 1280, height: 800 },
    // A click that never lands is a failed test, never a hung suite — and this
    // overlay is a surface where "the button did nothing" is the whole risk.
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
  },

  webServer: [
    {
      command:
        `LOCAL_FLEET=serve LOCAL_FLEET_PORT=${ALLOCATOR_PORT} LOCAL_FLEET_EDGE_PORT=${EDGE_PORT} ` +
        `npx vite-node tests/net/local-fleet.ts`,
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
