/**
 * tests/live-stage/playwright.subpath.config.ts — the production artifact, served
 * from a deploy SUBPATH. OWNER: Platform Engineer (a0-66, 2026-08-16).
 *
 * The rest of the estate serves the game at `/`, which is why a root-absolute
 * asset URL in TypeScript sailed through every pre-merge check and only failed on
 * the live deploy. `subpath-boot.spec.ts` has the incident; this file is the one
 * mechanical difference that makes it catchable:
 *
 *     npx vite preview --base /planet-rush/
 *
 * on a `base: './'` build. That is not a special build — `npm run build` produces
 * exactly the bundle Pages receives, relative base and all, and `--base` only
 * changes the PATH the preview server mounts it at. So this boots the shipped
 * artifact from the shipped path, and a font, icon, manifest or worker that
 * forgets the base 404s here exactly as it does in production.
 *
 * A separate config rather than a project on `./playwright.config.ts`: that suite
 * is `baseURL`-rooted at `/` and dozens of its specs navigate with bare paths, so
 * moving its server would move all of them. This one starts its own.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

/**
 * A port of its own, and NOT 4173. `reuseExistingServer` matches on the port
 * alone and cannot tell one workspace's preview from another's — the trap
 * `./playwright.config.ts` documents at length, where two lanes building the same
 * repo side by side silently run each other's bundle. This suite also serves at a
 * *different base* on that port, so sharing it would be worse than confusing.
 * Override with `SUBPATH_PORT` if a lane needs a private one.
 */
const PORT = Number(process.env.SUBPATH_PORT ?? 4174);

/** The Pages project path, spelled as the deploy spells it. */
const DEPLOY_BASE = '/planet-rush/';
const SUBPATH_URL = `http://localhost:${PORT}${DEPLOY_BASE}`;

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  testMatch: /subpath-boot\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // In CI: the inline annotation to read on the job page, plus a self-contained
  // `playwright-report/` with the trace in it — this job's failure is a URL that
  // 404'd inside a browser, and the trace is the only place that is legible.
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list']],

  use: {
    baseURL: SUBPATH_URL,
    browserName: chromium,
    // Service workers are the point of the second visit; Playwright allows them
    // by default, and it is stated here so a future `serviceWorkers: 'block'`
    // added for some other suite cannot quietly hollow this one out.
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },

  // The spec takes the URL from Playwright's own `baseURL` fixture, so it and the
  // server cannot disagree about the port or the base — there is one string.
  projects: [
    {
      name: 'desktop',
      use: {
        browserName: chromium,
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
    },
  ],

  webServer: {
    // Both halves go through `npm run`, and that is load-bearing rather than
    // stylistic: Playwright runs `command` with the CONFIG's directory as its
    // cwd, and a bare `vite preview` there finds no vite config and no `dist/`,
    // so it comes up and serves 404 to everything. `npm run` executes in the
    // package root regardless of where it was called from. (Cost of learning
    // this: one config that started a server which was never the game.)
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort --base ${DEPLOY_BASE}`,
    url: SUBPATH_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
