/**
 * evidence/a0-11-open-rooms/playwright.config.ts — the two captures a0-11 asks
 * for, against a REAL fleet. OWNER: Netcode Engineer.
 *
 * The brief: *"Two captures: a newly created room showing eight open seats and no
 * bots, and a host-plus-bots RUSH! that boots with no server session held — with
 * the released room code and the cost avoided named in the PR body."*
 *
 * Neither of those can be taken against the shipped offline artifact: it carries
 * no `VITE_ALLOCATOR_URL`, so CREATE ROOM there can only refuse. So this reuses
 * the online live-stage fleet verbatim — the same `globalSetup` that bundles and
 * spawns the SHIPPED allocator and the SHIPPED match server, and the same
 * online-flavoured client build (`../../tests/live-stage-online/online-fleet.ts`).
 * Nothing here is a stub, which is the point: "no server session held" is a claim
 * about a real room on a real Machine, and it is asked of the ALLOCATOR rather
 * than of the client that would like it to be true.
 *
 *   node evidence/a0-11-open-rooms/run.mjs
 *   # or:  npx playwright test --config evidence/a0-11-open-rooms/playwright.config.ts
 *
 * It uses the same fixed ports as `tests/live-stage-online` (8791 / 8792 / 4174) —
 * the client's allocator URL is baked in at build time, so they cannot be
 * ephemeral — which means the two suites cannot run at the same time. That is the
 * existing constraint, not a new one.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { resolve } from 'node:path';
import {
  ALLOCATOR_URL,
  ONLINE_OUT_DIR,
  PREVIEW_PORT,
  PREVIEW_URL,
} from '../../tests/live-stage-online/online-fleet';

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: resolve(import.meta.dirname, '..', '..', 'tests', 'live-stage-online', 'online-fleet.ts'),
  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command:
      `npx vite build --outDir ${ONLINE_OUT_DIR} && ` +
      `npx vite preview --outDir ${ONLINE_OUT_DIR} --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    cwd: resolve(import.meta.dirname, '..', '..'),
    env: { VITE_ALLOCATOR_URL: ALLOCATOR_URL },
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
