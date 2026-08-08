/**
 * playwright.config.ts — mobile-emulation suite. OWNER: QA Agent.
 *
 * Drives the QA mobile-emulation suite (`tests/mobile/`) against the real Vite
 * preview build, so it exercises the same bundle the classroom loads — not a
 * dev server, not jsdom (GDD §4.6 M1: "phone-verified"; §4.3b risk 7 "mobile
 * browser quirks"). This suite was added after M1 phone verification caught
 * invisible touch UI and unhandled portrait; it makes that class of miss
 * impossible to ship again by asserting the affordances are actually *rendered*
 * (pixel-level), not merely present in the DOM — the app draws everything into a
 * single PixiJS/WebGL canvas, so a DOM-presence check would have missed the bug.
 *
 * Chromium only (brief): one engine, emulated across the device matrix. Custom
 * device descriptors match the brief's exact numbers rather than Playwright's
 * built-in profiles, so the matrix is the contract:
 *   - iPhone-ish : 390×844  dpr 3    touch   (portrait by default)
 *   - Pixel-ish  : 412×915  dpr 2.6  touch   (portrait by default)
 *   - Desktop    : 1280×800 dpr 1    no touch (control)
 *
 * `isMobile`/`hasTouch` are Chromium-only Playwright features — fine here.
 */
import { readdirSync } from 'node:fs';
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { DEVICE_MATRIX } from './tests/mobile/shot-budget';
import { filesForShard, planShards, spreadSeconds } from './tests/mobile/shard-plan';

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const TEST_DIR = './tests/mobile';

/**
 * ── SHARDING: BY MEASURED DURATION, NOT BY TEST COUNT (a0-00b) ─────────────
 *
 * Playwright's own `--shard=i/N` divides the collected tests by COUNT. Run that
 * way, the four shards of this suite came back at **5 · 12 · 21 · 42 minutes**
 * (PR #321, run 31249237259): a gate is as slow as its slowest shard, so four
 * runners bought the wall time of one 42-minute job. The suite's tests span
 * 1.4 s to 300 s and 90 of its 213 collected tests are `test.skip`ped by
 * project, so counting tests measures almost nothing about cost.
 *
 * So the split is computed here instead, from a measured cost table, by
 * `tests/mobile/shard-plan.ts` — read that file for the algorithm and for how to
 * re-measure the table. Nothing about WHAT is asserted changes: same specs, same
 * three projects, same budgets, same baselines, same tolerance. Only which
 * runner picks up which spec file.
 *
 * Set `MOBILE_SHARD` / `MOBILE_SHARDS` (ci.yml does; `--shard` is not used).
 * Unset — every local `npm run test:mobile` — the whole suite runs, unfiltered.
 *
 * The file list is read off DISK rather than off the cost table, so the union of
 * the shards is the whole suite by construction: a spec added and never measured
 * still runs, on some shard, on the first PR that carries it.
 */
const SPEC_FILES = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.spec.ts'))
  .sort();
const PROJECT_NAMES = ['iphone', 'pixel', 'desktop'] as const;
const SHARD = Number(process.env.MOBILE_SHARD ?? '');
const SHARDS = Number(process.env.MOBILE_SHARDS ?? '');
const SHARDING = Number.isInteger(SHARD) && Number.isInteger(SHARDS) && SHARDS > 0;

/**
 * The spec files this shard runs on this project — or `undefined` (Playwright's
 * default: everything) when the suite is not being sharded at all.
 *
 * A shard that owns NOTHING on a project gets a pattern that cannot match rather
 * than an empty list, because an empty `testMatch` is the kind of thing that
 * quietly reverts to "match everything" and would run the suite three times.
 */
function shardMatch(project: string): PlaywrightTestConfig['testMatch'] {
  if (!SHARDING) return undefined;
  const files = filesForShard(PROJECT_NAMES, SPEC_FILES, project, SHARD, SHARDS);
  return files.length > 0 ? files.map((f) => `**/${f}`) : /(?!)/;
}

// Say out loud what this runner is about to do. A shard that silently ran the
// wrong quarter of the suite is the failure mode worth one line of log.
if (SHARDING) {
  const plan = planShards(PROJECT_NAMES, SPEC_FILES, SHARDS);
  const mine = plan.find((s) => s.shard === SHARD);
  console.log(
    `[shard-plan] shard ${SHARD}/${SHARDS} — ${mine ? Math.round(mine.seconds) : 0}s of measured work ` +
      `(plan: ${plan.map((s) => Math.round(s.seconds)).join(' / ')}s, spread ${Math.round(spreadSeconds(plan))}s)`,
  );
  for (const project of PROJECT_NAMES) {
    const files = filesForShard(PROJECT_NAMES, SPEC_FILES, project, SHARD, SHARDS);
    console.log(`[shard-plan]   ${project}: ${files.length > 0 ? files.join(', ') : '(nothing)'}`);
  }
}

const chromium: NonNullable<PlaywrightTestConfig['use']>['browserName'] = 'chromium';

/**
 * The matrix's three profiles, stated ONCE in tests/mobile/shot-budget.ts and
 * read twice: here, as what Chromium emulates, and there, as the pixel count a
 * full-frame golden capture of that emulation has to pay for. Stating them once
 * is what stops a device's screenshot budget from drifting away from the frame
 * it was derived from (q8-01).
 */
const { iphone: IPHONE, pixel: PIXEL, desktop: DESKTOP } = DEVICE_MATRIX;

export default defineConfig({
  testDir: TEST_DIR,
  // A hung page load is a failed test, never a hung suite (QA charter: enforced
  // timeouts). These bound each test and each assertion.
  //
  // `timeout` here is the FLOOR, not the suite's budget. It is the right number
  // for a two-assertion test and the wrong one for a journey — orient, boot, hold
  // thrust, settle, assert — which on a software-GL CI runner costs ~6× what it
  // costs on this hardware. A flat 60 s cut centering.spec.ts off mid-journey and
  // held `main` red for two days (q7-01), after flaking a green PR four times
  // before that.
  //
  // DO NOT RAISE THIS NUMBER to fix a slow test. A blanket bump buys silence
  // across the whole suite and hides the next genuine hang. Every test in
  // tests/mobile/ instead declares the work it does and takes the budget that
  // follows, via `budgetTest()` in tests/mobile/budgets.ts — and
  // tests/mobile-budget-contract.test.ts fails the build if one forgets to.
  timeout: 60_000,
  // The floor for an ORDINARY assertion — a locator check, a `waitFor`.
  //
  // Golden comparisons do NOT ride this, and never did: `toHaveScreenshot`
  // carries its own default (5 s in Playwright 1.49.1, lower than this line
  // suggests), and it is nowhere near a dpr-3 phone frame's stabilisation pair.
  // They take a budget derived from the frame they rasterise instead —
  // tests/mobile/shot-budget.ts `GOLDEN_SHOT_TIMEOUT_MS`, passed on the options
  // object in goldens.spec.ts. Do not raise the number on this line to fix a
  // golden: it would bump every ordinary assertion in the suite and still be
  // sized by nothing in particular.
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  // ── Reporters, and the one that made a golden failure inspectable (q8-01) ──
  //
  // `github` writes the inline annotations that surface a failure in the PR's
  // checks — it is what a reviewer sees first, and it stays.
  //
  // What it cannot do is carry a PICTURE. A failed `toHaveScreenshot` produces
  // three PNGs (actual / expected / diff) and, under `trace: 'retain-on-failure'`
  // below, a trace — as test ATTACHMENTS, which only a file-producing reporter
  // ever writes out. With `github` + `list` alone nothing was written, so
  // ci.yml's `upload-artifact` step warned "No files were found with the provided
  // path: playwright-report/" on every single run and every visual failure had to
  // be debugged by reproduction and guesswork (PR #291 — the brief for q8-01).
  //
  // `html` with `open: 'never'` closes that: it writes `playwright-report/`
  // (the path ci.yml already uploads) with the attachments copied into
  // `playwright-report/data/`, and inlines the report itself into `index.html`
  // so the downloaded artifact opens by double-clicking it — no server, no
  // `npx playwright show-report`. `open: 'never'` because a CI runner has no
  // browser to open it in and would hang trying.
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list']],

  use: {
    baseURL: PREVIEW_URL,
    browserName: chromium,
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'iphone',
      testMatch: shardMatch('iphone'),
      // 2.96 MP a capture — ~2.9× the desktop control's, and the reason PR #291's
      // two `iphone` goldens ran out of clock on a loaded runner while passing
      // everywhere else (tests/mobile/shot-budget.ts).
      use: {
        browserName: chromium,
        viewport: { width: IPHONE.width, height: IPHONE.height },
        deviceScaleFactor: IPHONE.deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'pixel',
      testMatch: shardMatch('pixel'),
      use: {
        browserName: chromium,
        viewport: { width: PIXEL.width, height: PIXEL.height },
        deviceScaleFactor: PIXEL.deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      testMatch: shardMatch('desktop'),
      use: {
        browserName: chromium,
        viewport: { width: DESKTOP.width, height: DESKTOP.height },
        deviceScaleFactor: DESKTOP.deviceScaleFactor,
        isMobile: false,
        hasTouch: false,
      },
    },
  ],

  // Build once, then serve the production bundle with `vite preview` — the suite
  // runs against the real shipped artifact (GDD §4.6). Reuse a running preview
  // locally; always start fresh in CI.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
