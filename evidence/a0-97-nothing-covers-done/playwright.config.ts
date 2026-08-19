/**
 * evidence/a0-97-nothing-covers-done/playwright.config.ts — OWNER: UI Engineer (a0-97).
 *
 * A private capture config, following the same two rules every evidence capture
 * in this repo has kept since a0-62:
 *
 *  1. The specimen is the app's OWN production pipeline — `npm run build` with the
 *     repo's `vite.config.ts`, served by `npm run preview`. A claim about what a
 *     player can press has to be taken from the bundle a player gets.
 *  2. Its own port, because the lanes share this box and another lane's preview
 *     may be holding the usual one.
 *
 * No viewport is pinned here: every run states its own profile (a0-96's
 * `profiles.ts`, reused verbatim so "the phone" and "the desktop" mean exactly
 * what QA's finding meant).
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4297);
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
    reuseExistingServer: Boolean(process.env.A0_97_REUSE),
    timeout: 900_000,
  },
});
