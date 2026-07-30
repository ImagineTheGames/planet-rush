/**
 * tests/live-stage-online/playwright.config.ts — the ONLINE live-stage suite.
 * OWNER: Gameplay Engineer (the ratified unified play flow, item 5).
 *
 * The sibling of `tests/live-stage/playwright.config.ts`, and different from it in
 * exactly one way that matters: the bundle it serves is built WITH `VITE_ALLOCATOR_URL`, and
 * a real allocator + a real match server are standing behind that URL
 * (`./online-fleet.ts`). So CREATE ROOM actually creates a room here, a second
 * browser context actually joins it, and the match actually arrives from
 * authority — the half of the flow the offline artifact can only refuse.
 *
 * It is a SEPARATE config in a SEPARATE directory, not a project on the offline
 * one, because the two suites need two different artifacts: the offline suite's
 * whole point is that the shipped bundle has no allocator, and a spec that needs
 * one must never be picked up by that run. Nothing is shared but the browser.
 *
 * HOW TO RUN IT
 * ---------------------------------------------------------------------------
 *   npx playwright test --config tests/live-stage-online/playwright.config.ts
 *
 * `.github/workflows/ci.yml` does NOT run it (CI runs typecheck, vitest, the
 * build, `tests/mobile` and `tests/live`), so like the rest of `tests/live-stage`
 * it is exercised deliberately, on a machine with browsers installed. It needs
 * ports 8791 / 8792 / 4174 free; every listener is strict, so a clash fails the
 * run rather than testing the wrong process.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { ALLOCATOR_URL, ONLINE_OUT_DIR, PREVIEW_PORT, PREVIEW_URL } from './online-fleet';

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  // Two clients, two boots and a real countdown — the walk is longer than the
  // offline one, but a hung page is still a failed test and never a hung suite.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // One worker: the fleet is one Machine and the tests assert on its room count.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  // The allocator and the match server, bundled and spawned before the suite.
  globalSetup: resolve(import.meta.dirname, 'online-fleet.ts'),

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },

  // The ONLINE artifact: the same client build, with the allocator URL baked in
  // (it is read at build time — `src/net/allocator-client.ts`), served out of its
  // own directory so `dist/` keeps holding the offline artifact the other suites
  // and the shipped build assert against.
  webServer: {
    command:
      `npx vite build --outDir ${ONLINE_OUT_DIR} && ` +
      `npx vite preview --outDir ${ONLINE_OUT_DIR} --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    // Playwright runs a webServer from the CONFIG's directory; Vite must run from
    // the repository root, where `index.html` and `vite.config.ts` are.
    cwd: resolve(import.meta.dirname, '..', '..'),
    env: { VITE_ALLOCATOR_URL: ALLOCATOR_URL },
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
