/**
 * evidence/a0-118-the-four-fixes/playwright.config.ts — OWNER: QA Manager (a0-118).
 *
 * a0-111's config, unchanged except for the port. That is the whole point of this
 * brief: four defects were found with a particular camera, four fixes were
 * shipped, and the only honest way to ask whether they hold is to point the SAME
 * camera at the SAME screens and compare numbers with numbers. A re-measure taken
 * on a different ruler is a new opinion, not a verdict.
 *
 *  1. The specimen is the app's OWN production pipeline — `npm run build` with the
 *     repo's `vite.config.ts`, served by `npm run preview`.
 *  2. Its own port (4318), because the lanes share this box and a neighbouring
 *     preview on 4173 / 4311 may be serving another lane's bundle — a0-06's trap,
 *     a local PASS on someone else's pixels.
 *
 * No viewport is pinned here: every frame states its own profile
 * ({@link ./profiles.ts}), because "on a phone and on a desktop" is two claims,
 * and a0-111's ore-counter finding scored differently on the two.
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4318);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: /\d-.*\.spec\.ts/,
  reporter: [['list']],
  workers: 1,
  timeout: 300_000,
  use: {
    baseURL: URL,
    browserName: 'chromium',
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: Boolean(process.env.A0_118_REUSE),
    timeout: 900_000,
  },
});
