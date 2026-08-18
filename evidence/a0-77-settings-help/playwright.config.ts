/**
 * evidence/a0-77-settings-help/playwright.config.ts — OWNER: UI Engineer (a0-77).
 *
 * A private config, so this capture never runs inside QA's suite and never
 * touches `tests/mobile/`. The same two rules a0-62 set and a0-70/a0-71/a0-74
 * kept:
 *
 *  1. The server is the app's OWN production pipeline — `npm run build` with the
 *     repo's `vite.config.ts`, served by `npm run preview`. The report is against
 *     the real client, so the real bundle is the specimen.
 *  2. Its own port, because the lanes share this box and 4173 may be serving
 *     another lane's bundle (a0-06's trap: a local PASS on someone else's pixels).
 *
 * No viewport is pinned here: every frame states its own profile from
 * {@link ./profiles.ts}, and the whole point of the brief is a width.
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4277);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: /(measure|shots)\.spec\.ts/,
  reporter: [['list']],
  workers: 1,
  timeout: 240_000,
  use: {
    baseURL: URL,
    browserName: 'chromium',
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    // Never reuse by default (a0-06's trap). `A0_77_REUSE=1` is for iterating
    // against a server this run did not start.
    reuseExistingServer: Boolean(process.env.A0_77_REUSE),
    timeout: 900_000,
  },
});
