/**
 * tests/perf/playwright.perf.config.ts — the frame-time capture suite's config.
 * OWNER: QA Agent (GDD §4.3 performance budget, §4.6 M5 gate).
 *
 * Its own config rather than a fourth project in `playwright.config.ts`, for one
 * reason: **this suite is a measurement instrument first and a gate second.**
 * The mobile-emulation suite gates every PR; a frame-rate assertion cannot,
 * because GitHub's runners render WebGL through SwiftShader on a shared vCPU and
 * would fail 60 fps on hardware that has no GPU at all. So:
 *
 *   npx playwright test --config tests/perf/playwright.perf.config.ts
 *
 * always *measures* and always prints the numbers; it only *fails* when
 * `PERF_GATE=1` marks the host as real hardware — the developer's laptop for the
 * 60 fps desktop gate, and the developer's phone (via `PERF_GATE=1` against a
 * deployed URL) for the mobile gate (GDD §4.3: "60 fps on the developer's own
 * phone … with a 30 fps floor on a 3-year-old mid-range Android").
 *
 * Two projects, matching the two gates in GDD §4.3: `desktop` (1280×800 dpr1)
 * and `phone-landscape` (844×390 dpr3 — the iPhone-ish profile rotated into the
 * only orientation the game plays in).
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

const PREVIEW_PORT = 4174; // not 4173: this suite must be runnable alongside the mobile one
const PREVIEW_URL = process.env.PERF_URL ?? `http://localhost:${PREVIEW_PORT}`;

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

/** A remote target (a deploy, the developer's phone over the network) needs no
 *  local preview server — and must not start one. */
const usingRemote = Boolean(process.env.PERF_URL);

export default defineConfig({
  testDir: '.',
  // CROSS-OWNER, one line, flagged in a1-16's PR — this file is QA's.
  //
  // `testDir: '.'` with Playwright's default `testMatch` claims every spec in
  // `tests/perf/`, and since a1-16 that directory also holds `draw-budget.spec.ts`
  // — the CI half of the gate, which drives a rig page that is deliberately NOT
  // in the production bundle. This config's `webServer` builds and previews that
  // bundle, so it would serve that spec a 404 and report the gate as broken.
  // Naming the file keeps each config running exactly the suite its own server
  // can serve. Nothing about what this suite asserts changes.
  testMatch: 'frame-time.spec.ts',
  // A hung capture is a failed test, never a hung suite (the QA charter's
  // enforced-timeout rule, applied outside the sim).
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // One worker, unconditionally (a0-00c). `fullyParallel: false` only serialises
  // files *within* a project; the two projects below are separate work units and
  // Playwright's default pool (`os.cpus().length / 2`) would happily run the
  // desktop capture and the phone capture at the same instant — each measuring
  // frame time while the other saturates the box. An instrument that reports the
  // frame rate of a machine running a second copy of itself is not measuring the
  // game. This is not the container cap that `playwright.config.ts` takes from
  // `harness/pool-size.ts`: it is 1 everywhere, including on an idle laptop,
  // because a shared box invalidates the reading no matter how many cores it has.
  workers: 1,
  // Never retry a performance measurement: a retry that passes would report the
  // best of two runs as if it were the run.
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    trace: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: { browserName: chromium, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
    {
      name: 'phone-landscape',
      use: {
        browserName: chromium,
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  ...(usingRemote
    ? {}
    : {
        webServer: {
          command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
          url: PREVIEW_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      }),
});
