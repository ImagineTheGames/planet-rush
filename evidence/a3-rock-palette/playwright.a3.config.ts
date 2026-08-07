/**
 * evidence/a3-rock-palette/playwright.a3.config.ts — the golden suite, on a port
 * this lane owns. OWNER: Art Agent (brief a3-01).
 *
 * `playwright.config.ts` (OWNER: QA Agent) pins the preview to **4173** and sets
 * `reuseExistingServer: !CI`. In this studio container that port is shared with the
 * other lanes, and it bit: a build-wheel golden re-shot at 15:22 came back
 * byte-identical to the old baseline because lane-3's `vite preview` held 4173 at
 * the time and Playwright happily reused it. The frame was a different branch's
 * build. A golden shot against someone else's bundle is worse than no golden.
 *
 * So: same suite, same testDir, same project names — therefore the SAME snapshot
 * files, since Playwright resolves a baseline from the test file's directory plus
 * the project name (`…-desktop-linux.png`) and neither moves — but pointed at a
 * port this lane holds, with `reuseExistingServer: false` so it always builds and
 * serves THIS working tree. `verify-served-build.mjs` next to this file then reads
 * the served bundle back and asserts the new `rockBody` is in it before any shot is
 * taken, so "wrong build" can never again be a silent pass.
 *
 * Nothing here overrides a QA decision that matters to the picture — the device
 * matrix, the tolerances, the timeouts and the reporters all come from the QA
 * config verbatim. Only the URL moves.
 *
 *   node evidence/a3-rock-palette/verify-served-build.mjs      # after the server is up
 *   npx playwright test --config evidence/a3-rock-palette/playwright.a3.config.ts \
 *       tests/mobile/goldens.spec.ts --update-snapshots
 */
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import base from '../../playwright.config';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A port picked out of the shared lane range. Override if it, too, is taken. */
const PORT = Number(process.env.A3_PREVIEW_PORT ?? 4287);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  ...base,
  // `testDir` in the QA config is relative to the repo root; this config lives two
  // directories down, so it has to be re-anchored or Playwright finds no tests.
  testDir: resolve(HERE, '../../tests/mobile'),
  use: { ...base.use, baseURL: URL },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    // NEVER reuse. That is the whole point of this file.
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
