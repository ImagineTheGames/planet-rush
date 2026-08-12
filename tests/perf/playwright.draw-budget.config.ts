/**
 * tests/perf/playwright.draw-budget.config.ts — config for the CI half of the
 * performance gate. OWNER: Platform Engineer (a1-16).
 *
 * Its own config rather than a project in `./playwright.perf.config.ts`, for a
 * concrete reason and not a filing preference: **the two halves need different
 * servers.** The frame-time half boots the shipped `vite preview` bundle,
 * because a frame time is only interesting if it is the frame time of what
 * ships. This half drives a rig page (`draw-budget.html`) that is deliberately
 * *not* in the bundle — `vite build` takes `index.html` alone — so it needs the
 * dev server, exactly as `spikes/atlas-pooling/run.mjs` does.
 *
 *   npm run test:perf-budget                          # the gate (CI runs this)
 *   PERF_BUDGET_SCALE=0.5 npm run test:perf-budget    # prove it can go red
 *
 * The other half, which this one deliberately does not attempt:
 *
 *   PERF_GATE=1 npx playwright test --config tests/perf/playwright.perf.config.ts
 *
 * That one is manual, on real hardware, and `docs/perf-gate.md` says when it is
 * required. Nothing here fakes it.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

/**
 * The repository root, derived from this file rather than from `process.cwd()`.
 *
 * `webServer.cwd` defaults to the **config file's** directory, not the invoking
 * shell's — so without this, `npx vite` starts in `tests/perf/`, finds no
 * `vite.config.ts`, and serves the tree with none of the `@shared` / `@platform`
 * / `@render` aliases. The symptom is a dev server that boots and then reports
 * "@platform/camera … Are they installed?", which reads like a broken checkout
 * and is really a working directory. Cost this brief a run; named so it cannot
 * cost the next one.
 */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Overridable, and defaulted away from every other port in the repo: 4173 is the
 * mobile suite's preview, 4174 the frame-time suite's, 5173 the developer's own
 * `npm run dev`. Lanes on one box share a port space, and a0-06 lost a whole
 * result to a suite silently attaching to a neighbour's server.
 */
const PORT = Number(process.env.PERF_BUDGET_PORT ?? 5184);
const BASE_URL = `http://localhost:${PORT}`;

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

export default defineConfig({
  testDir: '.',
  // Only this spec. `./playwright.perf.config.ts` lives in the same directory and
  // owns `frame-time.spec.ts`; naming the file here keeps each config running
  // exactly the suite its `webServer` can actually serve.
  testMatch: 'draw-budget.spec.ts',
  // A hung rig is a failed test, never a hung suite. The rig renders 100 frames
  // per profile through software WebGL, which is slow but bounded.
  timeout: 420_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // One worker. The measurement is a *count*, so it does not degrade under load
  // the way a millisecond does — but the rig is one page load shared by every
  // test in the file (`beforeAll`), and a second worker would boot a second
  // browser and render the whole scene again for nothing.
  workers: 1,
  // No retries. This gate asserts counts, which are deterministic; a retry that
  // passed would be hiding a real non-determinism rather than absorbing noise,
  // and that is exactly the thing worth seeing.
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    browserName: chromium,
    trace: 'off',
    launchOptions: {
      args: [
        // `requestAnimationFrame` must keep firing in a window nothing is
        // looking at: the rig advances one frame per rAF, and a throttled tab
        // turns a 100-frame capture into a timeout.
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    },
  },

  webServer: {
    // The DEV server: the rig page is not in the production bundle by design.
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: REPO_ROOT,
    url: BASE_URL,
    // Never reuse, on any host. `reuseExistingServer: !CI` plus a fixed port is
    // how a0-06 measured a neighbouring lane's bundle and reported it as its
    // own; for a gate whose entire output is a number about THIS tree, silently
    // attaching to another tree is the worst available failure. `--strictPort`
    // then makes a collision loud instead of clever.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
