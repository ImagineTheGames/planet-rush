/**
 * evidence/a0-98-corner-collisions-everywhere-else/playwright.config.ts —
 * OWNER: UI Engineer (a0-98).
 *
 * The OFFLINE half of the capture: the boot-failure screen, the front door and
 * its refusals, the lobby, and an offline match. Same two rules every evidence
 * capture in this repo has kept since a0-62, and the same ones a0-97's config
 * states:
 *
 *  1. The specimen is the app's OWN production pipeline — `npm run build` with the
 *     repo's `vite.config.ts`, served by `npm run preview`. A claim about what a
 *     player can press has to be taken from the bundle a player gets.
 *  2. Its own port, because the lanes share this box.
 *
 * The ONLINE half needs an allocator and a match server behind the bundle, so it
 * has its own config (`./playwright.online.config.ts`) standing up the real fleet.
 * No viewport is pinned here: every run states its own profile (a0-96's
 * `profiles.ts`, reused verbatim, so "the phone" and "the desktop" mean exactly
 * what a0-96 and a0-97 meant).
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4298);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: /1-.*\.spec\.ts/,
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
    reuseExistingServer: Boolean(process.env.A0_98_REUSE),
    timeout: 900_000,
  },
});
