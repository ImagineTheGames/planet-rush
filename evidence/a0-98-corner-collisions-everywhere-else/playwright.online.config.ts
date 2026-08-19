/**
 * evidence/a0-98-corner-collisions-everywhere-else/playwright.online.config.ts —
 * OWNER: UI Engineer (a0-98).
 *
 * The ONLINE half of the capture, and the reason it needs a config of its own:
 * the state the brief calls the one that matters most — a session in
 * `reconnecting` or `closed` — cannot be reached on the offline artifact at all.
 * That bundle has no allocator baked in, so the most its front door can do is
 * refuse; there is never a session to lose.
 *
 * So this borrows the fleet the online live-stage suite already stands up
 * (`tests/live-stage-online/online-fleet.ts` — the SHIPPED match server and the
 * SHIPPED allocator, bundled and spawned as a `globalSetup`) and serves the
 * online-flavoured bundle behind it, exactly as
 * `tests/live-stage-online/playwright.config.ts` does. Nothing here is a stub: the
 * browser asks a real allocator for a real room, opens a real socket to a real
 * match server, and then that socket is really cut.
 *
 * Ports 8791 / 8792 / 4174 are the fleet's own and every listener is strict, so a
 * clash fails the run loudly rather than quietly measuring the wrong process. It
 * therefore cannot run at the same time as the online live-stage suite — which is
 * correct: they are the same fleet.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOCATOR_URL, ONLINE_OUT_DIR, PREVIEW_PORT, PREVIEW_URL } from '../../tests/live-stage-online/online-fleet';

const HERE = dirname(fileURLToPath(import.meta.url));
const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: HERE,
  testMatch: /2-.*\.spec\.ts/,
  // Two clients, a real room, a real countdown and a real severed wire.
  timeout: 480_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // One worker: the fleet is one Machine.
  workers: 1,
  retries: 0,
  reporter: [['list']],

  globalSetup: resolve(HERE, '..', '..', 'tests', 'live-stage-online', 'online-fleet.ts'),

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    // No action may wait forever: a hung locator costs the whole table.
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
  },

  webServer: {
    command:
      `npx vite build --outDir ${ONLINE_OUT_DIR} && ` +
      `npx vite preview --outDir ${ONLINE_OUT_DIR} --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    cwd: resolve(HERE, '..', '..'),
    env: { VITE_ALLOCATOR_URL: ALLOCATOR_URL },
    reuseExistingServer: Boolean(process.env.A0_98_REUSE),
    timeout: 480_000,
  },
});
