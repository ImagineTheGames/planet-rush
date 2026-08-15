/**
 * evidence/a0-46-pierce-laser-shot/playwright.a046.config.ts — a0-46 only.
 *
 * Same shape and the same reasons as a0-45's: the committed `playwright.config.ts`
 * pins 4173 with `reuseExistingServer: !CI`, several lanes share this box, and
 * whichever lane starts `vite preview` on 4173 first has ITS bundle served to
 * every other lane's suite. A golden run against another lane's bundle proves
 * nothing about this branch. Private port, own build, `reuseExistingServer:
 * false`.
 *
 * `timeout` is 900 s rather than the committed 60 for the reason a0-45 measured:
 * under other lanes' vitest load, `browserContext.newPage` alone has been over
 * 60 s here, and it is charged before the in-body `test.skip` for a project
 * mismatch can fire. A verification run wants to be slow rather than to lose a
 * frame to another lane's compile.
 *
 * ── WHY THIS RUN EXISTS, GIVEN a0-46 CHANGES NO GOLDEN ──────────────────────
 *
 * `buildFrozenWorld()` returns a world with `projectiles.length === 0` at every
 * player count, and neither `stampDefenseShowcase` nor `stageVfxShowcase` adds
 * one — so the shot layer paints nothing in any frozen frame and both halves of
 * this change (the bolt, and `blendMode = 'add'`) land on an empty container.
 *
 * That is an argument, not evidence, and the rule is that anything which changes
 * what RENDERS re-baselines the goldens. So the suite is run at
 * **`maxDiffPixelRatio: 0`** — every frame that differs by a single pixel fails,
 * and `git status` is then the complete list of what moved. Zero is the claim;
 * this is what tests it. (The tolerance edit is NOT committed: `GOLDEN` in
 * `tests/mobile/goldens.spec.ts` exists for font/GPU antialiasing and is the
 * right shipped number. a0-45 documents the same discipline and the same trap —
 * a change under the tolerance cannot fail a golden, and therefore cannot
 * re-baseline one either.)
 */
import base from '../../playwright.config';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PREVIEW_PORT = 4246;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

// Playwright resolves a config's relative paths against the CONFIG's directory,
// and this one does not live at the repo root — so `testDir` is re-anchored
// explicitly. Left implicit it silently resolves to a path that exists nowhere
// and the run exits 0 with "No tests found": a green that ran nothing.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  ...base,
  testDir: resolve(REPO_ROOT, 'tests/mobile'),
  timeout: 900_000,
  use: { ...base.use, baseURL: PREVIEW_URL },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
