/**
 * evidence/a0-110-friend-or-foe-minimap/playwright.config.ts — OWNER: UI Engineer.
 *
 * A private config, so this capture never runs inside QA's suite and never touches
 * `tests/mobile/`. The two rules a0-62 set and every capture since has kept:
 *
 *  1. The server is the app's OWN production pipeline — `npm run build` with the
 *     repo's `vite.config.ts`, served by `npm run preview`. The specimen is the
 *     real bundle, because the report is about the real bundle.
 *  2. Its own port. The lanes share this box and 4173 may be serving another
 *     lane's build (a0-06's trap: a local PASS on someone else's pixels).
 *
 * No viewport is pinned here — the spec shoots a PHONE and a DESKTOP profile per
 * frame and sets each per-context (`shots.spec.ts`).
 *
 * `A0_110_REUSE=1` skips the build and attaches to a server this run did not
 * start — how the `before` half is captured against a worktree of origin/main
 * (see README.md).
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4290);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  // Playwright resolves a config's relative paths against the CONFIG's directory,
  // and this one does not sit at the repo root — left implicit, `testDir` becomes
  // a path that exists nowhere and the run exits 0 with "No tests found"
  // (a0-41's trap: a green that ran nothing).
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: /shots\.spec\.ts/,
  reporter: [['list']],
  workers: 1,
  timeout: 240_000,
  use: {
    baseURL: URL,
    browserName: 'chromium',
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: Boolean(process.env.A0_110_REUSE),
    timeout: 900_000,
  },
});
