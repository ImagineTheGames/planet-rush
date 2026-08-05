/**
 * tests/mobile/budget-model.ts — the budget arithmetic, on its own. OWNER: QA Agent.
 *
 * Split out of ./budgets.ts so the numbers can be asserted by a plain vitest
 * check (tests/mobile-budget-contract.test.ts) without dragging the Playwright
 * runtime into the unit-test job. ./budgets.ts is this model plus the one line
 * that hands the result to `test.setTimeout()`.
 *
 * The rationale for each constant lives in ./budgets.ts — read that first.
 */

/**
 * The suite-wide floor (`playwright.config.ts` `timeout`). A test that does two
 * assertions gets exactly this and no more — the whole point of budgeting per
 * test rather than raising the global cap.
 */
export const FLAT_DEFAULT_MS = 60_000;

/**
 * How much slower a software-GL GitHub runner is than a hardware-GL studio
 * container, running the identical suite.
 *
 * Observed at 11659df: 8.9 min vs 1.5 min = **5.9×**. LESSONS §5 bands
 * software-GL runners at 3–10×. We size at the TOP of that band, not at the
 * observation, because the observation is one sample of a shared, noisy-neighbour
 * runner — and because the cost of being generous is bounded (a budget is only
 * ever spent on work that is genuinely running; hangs are caught by the tighter,
 * separate bounds documented in ./budgets.ts) while the cost of being tight is a
 * red `main`.
 */
export const CI_SLOW_FACTOR = 10;

/** Budgets round up to this, so the table reads in human steps rather than in
 *  false precision inherited from one stopwatch reading. */
export const ROUND_TO_MS = 30_000;

/** The budget, in ms, implied by a test's measured in-container cost. */
export function budgetMsFor(measuredSeconds: number): number {
  const scaled = measuredSeconds * 1000 * CI_SLOW_FACTOR;
  const rounded = Math.ceil(scaled / ROUND_TO_MS) * ROUND_TO_MS;
  return Math.max(FLAT_DEFAULT_MS, rounded);
}
