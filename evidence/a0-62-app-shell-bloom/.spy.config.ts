/**
 * evidence/a0-62-app-shell-bloom/playwright.config.ts — OWNER: Art Agent.
 *
 * A private config so this capture never runs inside QA's suite and never
 * touches `tests/mobile/`. Two rules it exists to enforce:
 *
 *  1. The server is the app's OWN production pipeline — `npm run build` with
 *     the repo's `vite.config.ts`, served by `npm run preview`. No probe
 *     config, no dev server, no `#probe` page. a0-53's decisive control was
 *     that the same `index.html` built by a DIFFERENT vite config draws the
 *     halo correctly, so the build is part of the specimen.
 *  2. `deviceScaleFactor` is NOT set here. The spec makes its own context per
 *     ratio, because the variable under test is exactly that number.
 *
 * Its own port: the lanes share this box and 4173 may be serving another
 * lane's bundle (a0-06's trap).
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4263);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: /glspy.spec.ts/,
  reporter: [['list']],
  workers: 1,
  use: {
    baseURL: URL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
