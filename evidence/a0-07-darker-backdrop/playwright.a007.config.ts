/**
 * evidence/a0-07-darker-backdrop/playwright.a007.config.ts — the goldens, on a
 * port nobody else is holding. OWNER: Art Agent (a0-07).
 *
 * Identical to the committed `playwright.config.ts` in every way that can change
 * a pixel — same `testDir`, same device matrix, same project names (therefore
 * the same snapshot filenames), same timeouts and tolerances — and different in
 * exactly one: the preview port.
 *
 * That difference is not fussiness. `playwright.config.ts` pins the preview to
 * **4173** with `reuseExistingServer: !CI`, and several lanes share this box. If
 * another lane's `vite preview` is already holding 4173, Playwright reuses it and
 * this suite silently shoots **that lane's bundle** — which is how a3-01 got a
 * re-shot golden back byte-identical to its old baseline and nearly believed it.
 * A private port with `reuseExistingServer: false` makes the suite build and
 * serve this branch's own bundle, and `verify-served-build.mjs` next door reads
 * the served bundle back and proves it before any shot is trusted.
 *
 *   node evidence/a0-07-darker-backdrop/verify-served-build.mjs
 *   npx playwright test --config evidence/a0-07-darker-backdrop/playwright.a007.config.ts \
 *     tests/mobile/goldens.spec.ts --update-snapshots
 *
 * And delete the baselines first: on Playwright 1.49.1 `--update-snapshots` only
 * rewrites a baseline whose diff EXCEEDS `maxDiffPixelRatio`, so a golden that
 * moved by less than 1% of its pixels keeps its stale image (r5-01).
 */
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

const PREVIEW_PORT = 4207; // a0-07
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  ...base,
  testDir: new URL('../../tests/mobile', import.meta.url).pathname,
  snapshotDir: new URL('../../tests/mobile', import.meta.url).pathname,
  use: { ...base.use, baseURL: PREVIEW_URL },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
