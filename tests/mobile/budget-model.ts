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
 * ── THE SAMPLES, ALL OF THEM ───────────────────────────────────────────────
 * Same suite, same Playwright (1.49.1), same distro (Ubuntu 24.04); the
 * container number is ~1.5 min throughout.
 *
 *   11659df   8.9 min on the runner   →   **5.9×**   (q7-01: the fit for this constant)
 *   PR #291  31.8 min on the runner   →   **~21×**   (q8-01: two `iphone` goldens red)
 *   369d7a6  47.2 min on the runner   →   **~31×**   (q9-01: one `iphone` golden red)
 *
 * LESSONS §5 bands software-GL runners at 3–10×. **The band is wider than that.**
 * Two of the three samples above sit outside it, and the widest is 31× — five
 * times the observation this constant was fitted to. That is the honest number,
 * written here so the next person reads it instead of rediscovering it. What all
 * three slow runs have in common is not the code: it is a shared, noisy-neighbour
 * runner, and the tail of that distribution has no ceiling we can name.
 *
 * ── AND THE FACTOR STILL STAYS AT 10 ───────────────────────────────────────
 * The temptation on seeing 31× is to raise this number. Do not. It sizes EVERY
 * budget in the suite, and a budget is also the only bound on a test that is
 * genuinely wedged in work the tighter watchdogs in ./budgets.ts cannot see. At
 * 31× the 9 s phone BUILD WHEEL golden would take a 4.5-minute ceiling, and a
 * real hang would sit silent behind it for four of those minutes. That trades a
 * rare, loud red for a slow one — the wrong direction for a merge gate.
 *
 * So this constant keeps doing the job it is good at: sizing the run we NORMALLY
 * get, at the top of the band we normally see. The tail gets a different
 * instrument — an extra ATTEMPT, scoped to the goldens, where a re-run cannot
 * mask a regression because the frame is deterministic
 * (./shot-budget.ts `GOLDEN_CI_RETRIES`). Budgets for the common case, retries
 * for the tail; neither one asked to do the other's job.
 *
 * ── WHY 10 AND NOT 5.9 ─────────────────────────────────────────────────────
 * We size at the TOP of the documented band, not at the first observation, for
 * three reasons: that observation is one sample of a shared runner; a whole-suite
 * ratio hides that the costs inside any one test scale unevenly (a page boot and
 * a CDP round-trip stretch much further than a tick-denominated wait, which
 * stretches by ~4× — 60 ticks/s to ~15); and the cost of being generous is
 * bounded — a budget is only ever spent on work that is genuinely running, since
 * hangs are caught by the tighter, separate bounds documented in ./budgets.ts —
 * while the cost of being tight is a red `main`.
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
