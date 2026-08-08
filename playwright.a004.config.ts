/**
 * SCRATCH — NOT FOR COMMIT. a0-04 only.
 *
 * Same trick as r5-01's `playwright.isolated.config.ts` and a0-03's: the committed
 * live-stage config pins port 4173 with `reuseExistingServer: !CI`, and several
 * lanes share this box — whichever lane starts `vite preview` on 4173 first serves
 * its bundle to every other lane's suite. This one points at a preview this lane
 * started itself on a private port, verified against /version.json.
 */
import base from './tests/live-stage/playwright.config';
import { defineConfig } from '@playwright/test';

const PREVIEW_URL = 'http://localhost:4198';

export default defineConfig({
  ...base,
  testDir: './tests/live-stage',
  use: { ...base.use, baseURL: PREVIEW_URL },
  webServer: undefined,
});
