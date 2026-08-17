/**
 * evidence/a0-70-title-entrance/playwright.config.ts — OWNER: UI Engineer.
 *
 * A private config, so this capture never runs inside QA's suite and never
 * touches `tests/mobile/`. Same two rules a0-62's capture established:
 *
 *  1. The server is the app's OWN production pipeline — `npm run build` with the
 *     repo's `vite.config.ts`, served by `npm run preview`. The bug report is
 *     against the real client, so the real bundle is the specimen.
 *  2. The viewport is the developer's own session: **1707×898**, desktop, no
 *     touch. That is the branch of `computeRootTransform` the report was filed
 *     on, and candidate 2 is only falsifiable at that exact size.
 *
 * Its own port: the lanes share this box and 4173/4262 may be serving another
 * lane's bundle (a0-06's trap).
 */
import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEVICE_MATRIX } from '../../tests/mobile/shot-budget';

const PORT = Number(process.env.PREVIEW_PORT ?? 4270);
const URL = `http://localhost:${PORT}`;

/**
 * ── a0-71: THE PLATFORM THE DEVELOPER ACTUALLY NAMED ────────────────────────
 *
 * a0-70 filmed 1707×898, 2560×1440 and 900×600. All three are landscape, so
 * `computeRootTransform`'s rotated branch — the one whose `x: physW` is the only
 * thing in this client that can put content a whole screen-width to the right —
 * was never entered on any frame of any film. The developer's correction ("no
 * I'm on mobile, on PC it's fine") reached the brief after that session started.
 *
 * `A0_71_DEVICE=iphone|pixel` selects a REAL device profile — the same numbers
 * the CI mobile shards use, imported from QA's own `DEVICE_MATRIX` rather than
 * retyped, so this film cannot drift from the matrix it claims to be. Both are
 * PORTRAIT (h > w) and both set `isMobile`/`hasTouch`, because the rotated
 * branch needs BOTH: a resized desktop window is portrait but not mobile, and
 * satisfies neither half of the test.
 *
 * `A0_71_LANDSCAPE=1` swaps width and height on the same profile — the control
 * that separates "mobile" from "portrait mobile" when a difference shows up.
 */
const DEVICE = process.env.A0_71_DEVICE as keyof typeof DEVICE_MATRIX | undefined;
const PROFILE = DEVICE ? DEVICE_MATRIX[DEVICE] : null;
if (DEVICE && !PROFILE) {
  throw new Error(`A0_71_DEVICE=${DEVICE} is not in DEVICE_MATRIX (${Object.keys(DEVICE_MATRIX).join(', ')})`);
}
const MOBILE = PROFILE
  ? {
      viewport: process.env.A0_71_LANDSCAPE
        ? { width: PROFILE.height, height: PROFILE.width }
        : { width: PROFILE.width, height: PROFILE.height },
      deviceScaleFactor: PROFILE.deviceScaleFactor,
      isMobile: DEVICE !== 'desktop',
      hasTouch: DEVICE !== 'desktop',
    }
  : null;

export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: /(capture|firstframes|motion|portrait|reload|resize-boot|reveal)\.spec\.ts/,
  reporter: [['list']],
  workers: 1,
  timeout: 180_000,
  use: {
    baseURL: URL,
    browserName: 'chromium',
    // The developer's session, verbatim (a0-70 report) — unless a device profile
    // is named, in which case that profile IS the specimen (a0-71).
    ...(MOBILE ?? {
      viewport: { width: 1707, height: 898 },
      isMobile: false,
      hasTouch: false,
    }),
    // 1707×898 is not a round number by accident: it is a 2560×1440 panel at
    // 150% OS scaling (2560/1.5 = 1706.7, and 1440/1.5 = 960 less the browser's
    // own chrome). `A0_70_DPR` lets a run pick the ratio deliberately, because
    // `resolution: devicePixelRatio` + `autoDensity` is exactly where a
    // fractional ratio would show up if it showed up anywhere. A named device
    // profile brings its own ratio (dpr 3 / 2.6) and keeps it: overriding it here
    // would make the film a viewport the matrix does not contain.
    ...(MOBILE ? {} : { deviceScaleFactor: Number(process.env.A0_70_DPR ?? 1) }),
  },
  webServer: {
    // The production pipeline by default. `A0_70_DEV=1` swaps in `npm run dev`
    // — the un-bundled vite dev server, which is what a developer watching the
    // first second is most likely to have been looking at, and which loads a few
    // hundred separate modules instead of one chunk. Different boot timing is
    // exactly the kind of difference a first-frame bug can hide behind.
    command: process.env.A0_70_DEV
      ? `npm run dev -- --port ${PORT} --strictPort`
      : `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    // Never reuse by default (a0-06's trap: another lane's bundle on the port).
    // `A0_70_REUSE=1` is for iterating against a server this run did not start.
    reuseExistingServer: Boolean(process.env.A0_70_REUSE),
    timeout: 600_000,
  },
});
