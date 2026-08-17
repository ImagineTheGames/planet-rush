/**
 * evidence/a0-74-viewport/playwright.config.ts — OWNER: UI Engineer (a0-74).
 *
 * A private config, so this capture never runs inside QA's suite and never
 * touches `tests/mobile/`. Same two rules a0-62 established and a0-70/a0-71 kept:
 *
 *  1. The server is the app's OWN production pipeline — `npm run build` with the
 *     repo's `vite.config.ts`, served by `npm run preview`. Three developer
 *     reports against the real client, so the real bundle is the specimen.
 *  2. Its own port, because the lanes share this box and 4173 may be serving
 *     another lane's bundle (a0-06's trap: a local PASS on someone else's pixels).
 *
 * Unlike a0-70's, this config pins **no viewport**: the whole brief is that the
 * answer depends on the viewport, so every profile is set per-test from
 * {@link ./profiles.ts} and stated in the audit beside its numbers.
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4274);
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
    // Never reuse by default (a0-06's trap). `A0_74_REUSE=1` is for iterating
    // against a server this run did not start.
    reuseExistingServer: Boolean(process.env.A0_74_REUSE),
    timeout: 900_000,
  },
});
