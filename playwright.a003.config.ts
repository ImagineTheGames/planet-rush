/**
 * SCRATCH — NOT FOR COMMIT. a0-03 only.
 *
 * Same trick as r5-01's `playwright.isolated.config.ts`, on its own port. The
 * committed config pins 4173 with `reuseExistingServer: !CI`, and several lanes
 * share this box: whichever lane starts `vite preview` on 4173 first has its
 * bundle served to every other lane's suite. That is the stale-bundle trap that
 * silently invalidates goldens — and re-baselining goldens against another
 * lane's bundle would bake another lane's pixels into this branch.
 *
 * Private port, own build, `reuseExistingServer: false`. Verified per run
 * against `/version.json`, which carries the short HEAD sha of the bundle
 * actually being served.
 */
import base from './playwright.config';
import { defineConfig } from '@playwright/test';

const PREVIEW_PORT = 4197;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: PREVIEW_URL },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
