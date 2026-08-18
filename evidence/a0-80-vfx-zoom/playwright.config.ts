/**
 * evidence/a0-80-vfx-zoom/playwright.config.ts — OWNER: UI Engineer (a0-80).
 *
 * A private config, so this capture never runs inside QA's suite and never
 * touches `tests/mobile/`. The two rules a0-62 established and a0-70/a0-71/a0-74
 * kept:
 *
 *  1. The server is the app's OWN production pipeline — `npm run build` with the
 *     repo's `vite.config.ts`, served by `npm run preview`. The report is against
 *     the real client, so the real bundle is the specimen.
 *  2. Its own port, because the lanes share this box and 4173 may be serving
 *     another lane's bundle (a0-06's trap: a local PASS on someone else's pixels).
 *
 * ── The before/after pair ───────────────────────────────────────────────────
 *
 * `A0_80_ROOT` points the build at a different checkout, and `A0_80_LABEL` names
 * the frames it produces. The BEFORE set is captured by pointing it at a
 * worktree of the parent commit and running THIS SAME SPEC — one capture script
 * for both halves, so the two frames differ by the change and not by the harness
 * (a0-74's discipline, and the only way a pair is evidence at all).
 *
 *     A0_80_LABEL=before A0_80_ROOT=/tmp/a0-80-before PREVIEW_PORT=4281 \
 *       npx playwright test -c evidence/a0-80-vfx-zoom/playwright.config.ts
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4280);
const URL = `http://localhost:${PORT}`;
const ROOT = process.env.A0_80_ROOT ?? process.cwd();

export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: /frames\.spec\.ts/,
  reporter: [['list']],
  workers: 1,
  timeout: 300_000,
  use: {
    baseURL: URL,
    browserName: 'chromium',
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    cwd: ROOT,
    url: URL,
    // Never reuse by default (a0-06's trap). `A0_80_REUSE=1` is for iterating
    // against a server this run did not start.
    reuseExistingServer: Boolean(process.env.A0_80_REUSE),
    timeout: 900_000,
  },
});
