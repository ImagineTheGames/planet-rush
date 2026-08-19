/**
 * evidence/a0-99-wheel-and-hud/playwright.config.ts — OWNER: QA Manager (a0-99).
 *
 * A private capture config, inherited from a0-96 unchanged, for the same two
 * reasons that config states:
 *
 *  1. The specimen is the app's OWN production pipeline — `npm run build` with
 *     the repo's `vite.config.ts`, served by `npm run preview`. A report about
 *     what a player sees has to be taken from the bundle a player gets.
 *  2. Its own port, because the lanes share this box and 4173 (and 4296) may be
 *     serving another lane's bundle — a0-06's trap, a local PASS on someone
 *     else's pixels.
 *
 * No viewport is pinned here: every frame states its own profile
 * ({@link ./profiles.ts}), because "on a phone and on a desktop" is two claims.
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4299);
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
    reuseExistingServer: Boolean(process.env.A0_99_REUSE),
    timeout: 900_000,
  },
});
