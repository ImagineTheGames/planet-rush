/**
 * tests/mobile/budgets.ts — per-test time budgets for the mobile suite. OWNER: QA Agent.
 *
 * ── THE LESSON THIS FILE ENCODES ───────────────────────────────────────────
 * `playwright.config.ts` used to hand every test in this suite the same flat
 * 60 s. That is the right budget for a two-assertion test and the wrong one for a
 * journey — orient, boot the debug build, assert, hold thrust, settle, assert
 * again — and the difference is not small on the machine that gates merges.
 *
 * The GitHub runner rasterizes WebGL in software. Measured on the SAME commit
 * (11659df) with the SAME Playwright (1.49.1) on the SAME distro (Ubuntu 24.04):
 * the whole suite took 1.5 min in a studio container and 8.9 min on the runner —
 * **5.9×** — and `centering.spec.ts`'s post-thrust journey passed in 20.7 s
 * locally while timing out at 60 s on the runner, twice. It was never hanging; it
 * was being cut off mid-journey. That flake had already burned a green PR four
 * times before it took `main` red for two days.
 *
 * The fix is NOT to raise the global `timeout`. A blanket bump buys silence
 * across the whole suite and hides the next genuine hang. Instead **every test in
 * tests/mobile/ declares the work it does and is budgeted from it**, here, in one
 * table, through {@link budgetTest}. Nothing rides the flat default by accident —
 * `tests/mobile-budget-contract.test.ts` fails the build if a test tries to.
 *
 * ── WHY A BIG BUDGET IS SAFE HERE ──────────────────────────────────────────
 * A budget is a CEILING, not a target, and it is *not* what catches a hang in
 * this suite. Those bounds are separate, tighter, and unchanged by this file:
 *
 *   - a wedged boot trips the `waitForSelector` / `waitForFunction` caps inside
 *     each spec's boot fixture (15–30 s), naming what never arrived;
 *   - a wedged assertion trips `expect.timeout` (10 s, playwright.config.ts);
 *   - a sim that stops stepping trips the stall watchdog in ./sim-clock.ts
 *     (10 s of NO tick ⇒ immediate failure, naming how far it got).
 *
 * So a hang still fails in seconds. The journey budget only ever gets spent on
 * work that is genuinely running — which is what makes it safe to size it for the
 * slowest host we support rather than the fastest.
 *
 * ── THE ARITHMETIC ─────────────────────────────────────────────────────────
 * `budget = max(FLAT_DEFAULT_MS, roundUpTo30s(measuredSeconds × CI_SLOW_FACTOR))`
 *
 * `measuredSeconds` is this test's own wall-clock cost, measured in the studio
 * container (hardware GL) — the honest proxy for "the work the test actually
 * does", and the number to re-measure when a test changes shape. The factor
 * converts that into runner time. The floor keeps a cheap test cheap: a
 * two-assertion check still fails fast, so this file never becomes the blanket
 * bump it exists to avoid.
 */
import { test } from '@playwright/test';
import { budgetMsFor, CI_SLOW_FACTOR, FLAT_DEFAULT_MS } from './budget-model';

export { budgetMsFor, CI_SLOW_FACTOR, FLAT_DEFAULT_MS };

/** What a test does, and what that cost when measured. */
export interface TestJob {
  /**
   * The work this budget pays for, in the test's own terms — "boot → 3 taps →
   * lobby → match assembly". This is the field that makes a budget reviewable:
   * a reader can tell whether the number matches the journey without running it.
   */
  readonly work: string;
  /**
   * Wall-clock seconds this test measured in the studio container (hardware GL,
   * `npm run test:mobile`), on its SLOWEST project. Re-measure when the test's
   * work changes; do not nudge it to make a flake go away — a budget that has to
   * grow without the work growing is a performance regression, and should be
   * read as one.
   */
  readonly measuredSeconds: number;
}

/**
 * Declare what this test does and take the budget that follows from it. Call it
 * first thing in every test body in tests/mobile/ (the contract test enforces
 * that every one does). Returns the budget in ms, and records it as a test
 * annotation so a CI report shows the budget next to the duration it bounded —
 * which is how creeping cost gets noticed before it becomes a timeout.
 */
export function budgetTest(job: TestJob): number {
  const ms = budgetMsFor(job.measuredSeconds);
  test.setTimeout(ms);
  test.info().annotations.push({
    type: 'budget',
    description:
      `${(ms / 1000).toFixed(0)}s for: ${job.work} ` +
      `(measured ${job.measuredSeconds}s in-container × ${CI_SLOW_FACTOR} software-GL allowance)`,
  });
  return ms;
}
