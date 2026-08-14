/**
 * evidence/a0-41-cost-every-page/playwright.a041.config.ts — a0-41 only.
 *
 * The committed `playwright.config.ts` pins 4173 with `reuseExistingServer: !CI`,
 * and several lanes share this box: whichever lane starts `vite preview` on 4173
 * first has ITS bundle served to every other lane's suite. Re-baselining goldens
 * against another lane's bundle would bake another lane's pixels into this
 * branch — the trap a0-03 named and every evidence config since has dodged the
 * same way.
 *
 * Private port, own build, `reuseExistingServer: false`.
 */
import base from '../../playwright.config';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PREVIEW_PORT = 4211;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

// Playwright resolves a config's relative paths against the CONFIG's directory,
// and this one does not live at the repo root — so `testDir` is re-anchored
// explicitly. Left implicit it silently resolves to
// `evidence/a0-41-cost-every-page/tests/mobile`, which exists nowhere, and the
// run exits 0 with "No tests found" — a green that ran nothing.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  ...base,
  testDir: resolve(REPO_ROOT, 'tests/mobile'),
  use: { ...base.use, baseURL: PREVIEW_URL },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
