/**
 * evidence/a0-114-refusal-over-the-doors/playwright.config.ts —
 * OWNER: UI Engineer (a0-114).
 *
 * a0-98's config, with its port changed and its spec glob narrowed. The two rules
 * every evidence capture in this repo has kept since a0-62 are unchanged and are
 * the reason this capture can be believed at all:
 *
 *  1. The specimen is the app's OWN production pipeline — `npm run build` with the
 *     repo's `vite.config.ts`, served by `npm run preview`. a0-111 is a claim about
 *     what a thumb hits, and that has to be taken from the bundle a player gets.
 *  2. Its own port, because the lanes share this box.
 *
 * No allocator is baked into the offline artifact, so pressing HOST here really
 * does fail with `no allocator configured` — a0-111's exact refusal, reached the
 * only honest way: by pressing the door.
 *
 *   A0_114_STAGE=before npx playwright test --config evidence/a0-114-refusal-over-the-doors/playwright.config.ts
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PREVIEW_PORT ?? 4314);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: /refusal-over-the-doors\.spec\.ts/,
  reporter: [['list']],
  workers: 1,
  timeout: 300_000,
  use: {
    baseURL: URL,
    browserName: 'chromium',
    // No action may wait forever: a hung locator costs the whole table.
    actionTimeout: 20_000,
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: Boolean(process.env.A0_114_REUSE),
    timeout: 900_000,
  },
});
