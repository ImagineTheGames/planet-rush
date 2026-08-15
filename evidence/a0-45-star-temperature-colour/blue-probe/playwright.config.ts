/**
 * evidence/a0-45-star-temperature-colour/blue-probe/playwright.config.ts —
 * OWNER: Art Agent.
 *
 * A private config so the probe never runs inside QA's suite and never touches
 * `tests/mobile/`. Same `pixel` device the failing shard uses (412×915 dpr2.6
 * touch), same preview build, its own port — the lanes share this box and 4173
 * may be serving another lane's bundle.
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4246);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  reporter: [['list']],
  workers: 1,
  use: {
    baseURL: URL,
    browserName: 'chromium',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.6,
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
