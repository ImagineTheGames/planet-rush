/** SCRATCH — NOT FOR COMMIT. a0-11 only: the mobile suite on a private preview
 *  port, so this lane serves its OWN bundle (4173 is shared across lanes). */
import base from './playwright.config';
import { defineConfig } from '@playwright/test';
const PREVIEW_PORT = 4191;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: PREVIEW_URL },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort --host 127.0.0.1`,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
