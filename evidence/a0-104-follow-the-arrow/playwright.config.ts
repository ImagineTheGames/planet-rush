/**
 * evidence/a0-104-follow-the-arrow/playwright.config.ts — OWNER: UI Engineer (a0-104).
 *
 * A private capture config, inherited from a0-99's unchanged, for the two
 * reasons that config states: the specimen is the app's OWN production pipeline
 * (`npm run build` + `npm run preview`, the bundle a player gets), and it takes
 * its own port because the lanes share this box and a PASS on someone else's
 * pixels is not a pass.
 *
 * No viewport is pinned here: every frame states its own profile
 * ({@link ./profiles.ts}), because "on a phone and on a desktop" is two claims.
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4304);
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
    reuseExistingServer: Boolean(process.env.A0_104_REUSE),
    timeout: 900_000,
  },
});
