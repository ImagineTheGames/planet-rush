/**
 * SCRATCH — NOT FOR COMMIT. r5-01 only.
 *
 * Identical to playwright.config.ts except the preview port. The committed
 * config pins 4173 with `reuseExistingServer: !CI`, and several lanes share this
 * box: whichever lane starts `vite preview` on 4173 first has its bundle served
 * to every other lane's suite. That is a1-01's stale-bundle trap across lanes,
 * and it silently invalidates goldens.
 *
 * This config takes a private port so this lane builds and serves its OWN bundle
 * and poisons nobody else's. Verified per run against `/version.json`, which
 * carries the short HEAD sha of the build actually being served.
 */
import base from './playwright.config';
import { defineConfig } from '@playwright/test';

const PREVIEW_PORT = 4193;
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
