/**
 * evidence/a0-78-menu-swipe/playwright.config.ts — OWNER: UI Engineer (a0-78).
 *
 * A private config, for the same reason a0-62's is private: this capture is
 * evidence for one brief, it is not QA's suite, and it must never be collected
 * by `npm run test:mobile` or compared against a frozen golden.
 *
 * Two things it deliberately does NOT do:
 *
 *  - It does not pass `?gate=0`. The whole bug lives on the front screen and the
 *    title gate is that screen; a capture that opted out of the door would boot
 *    past the thing under test. Every profile below therefore opens the real
 *    door with a real press before it touches anything else.
 *  - It does not set a viewport in `use`. The spec makes its own context per
 *    device profile, because the orientation IS the variable — the landscape
 *    lock rotates the whole overlay in portrait and not at all in landscape,
 *    and a bug that only bites one of them would be invisible from a single
 *    fixed viewport.
 *
 * Its own port: the lanes share this box and 4173 may be serving another lane's
 * bundle (a0-06's trap).
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4278);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: /capture\.spec\.ts/,
  reporter: [['list']],
  workers: 1,
  timeout: 180_000,
  use: {
    baseURL: URL,
    browserName: 'chromium',
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    // Never reuse: another lane may be holding this port with ITS bundle (a0-06),
    // and the before/after frames below are only worth anything if both were
    // shot against a build of the tree they claim to be.
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
