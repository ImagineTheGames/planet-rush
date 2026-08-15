/**
 * evidence/a0-45-star-temperature-colour/playwright.a045.config.ts — a0-45 only.
 *
 * The committed `playwright.config.ts` pins 4173 with `reuseExistingServer: !CI`,
 * and several lanes share this box: whichever lane starts `vite preview` on 4173
 * first has ITS bundle served to every other lane's suite. Re-baselining goldens
 * against another lane's bundle would bake another lane's pixels into this
 * branch — the trap a0-03 named and every evidence config since has dodged the
 * same way.
 *
 * Private port, own build, `reuseExistingServer: false`.
 *
 * The `timeout` is 900 s rather than the committed 60: this box is shared with
 * other lanes' vitest runs, and under that load `browserContext.newPage` alone
 * has been measured over 60 s here. A re-baseline run wants to be slow rather
 * than to lose a frame to another lane's compile.
 *
 * **300 s was not enough, measured.** A first attempt at that budget lost its
 * first two frames to the fixture timeout at exactly 5.0 m each — with load
 * average 7.4 on a 6-core quota split three ways, `page` creation alone outran
 * the whole test budget, and it does so *before* the in-body `test.skip` for a
 * project mismatch can fire, so the ~100 project-skipped tests pay it too. The
 * number is deliberately far above what a quiet box needs: the cost of being
 * generous is wall-clock, and the cost of being tight is a frame with no pixels.
 */
import base from '../../playwright.config';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PREVIEW_PORT = 4245;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

// Playwright resolves a config's relative paths against the CONFIG's directory,
// and this one does not live at the repo root — so `testDir` is re-anchored
// explicitly. Left implicit it silently resolves to
// `evidence/a0-45-star-temperature-colour/tests/mobile`, which exists nowhere,
// and the run exits 0 with "No tests found" — a green that ran nothing.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  ...base,
  testDir: resolve(REPO_ROOT, 'tests/mobile'),
  timeout: 900_000,
  use: { ...base.use, baseURL: PREVIEW_URL },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
