/**
 * evidence/a0-53-bloom-radius/playwright.config.ts — OWNER: Art Agent.
 *
 * A private config so the capture never runs inside QA's suite and never touches
 * `tests/mobile/`. Desktop 1280×800 at dpr 1 — the same profile the frozen
 * desktop golden uses, so one screen pixel is one device pixel and a measured
 * radius needs no dpr correction. Its own port: the lanes share this box and
 * 4173 may be serving another lane's bundle (a0-06's trap).
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4253);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  // ONLY the capture. The other specs here need the dev server's module URLs, so
  // a bare `testDir` would drag them onto the preview build.
  testMatch: /capture\.spec\.ts/,
  reporter: [['list']],
  workers: 1,
  use: {
    baseURL: URL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: false,
    timeout: 420_000,
  },
});
