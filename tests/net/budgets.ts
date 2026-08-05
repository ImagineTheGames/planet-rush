/**
 * tests/net/budgets.ts — per-test time budgets for the net suite. OWNER: Netcode Engineer.
 *
 * ── THE LESSON THIS FILE ENCODES (the second time) ──────────────────────────
 * q7-01 wrote this rule down for `tests/mobile/`: a journey test must be
 * budgeted for the work it does, not left on the suite's flat default. A week
 * later `main` went red again on the same disease in a second suite (n4-01,
 * `playtest-log-online.test.ts`) — because the rule had been encoded for the
 * Playwright suite alone and `tests/net/` had never been looked at.
 *
 * So this is the SAME model, in the same vocabulary, for the vitest suite:
 *
 *   `budget = max(suite default, roundUp(measured in-container seconds × CI_SLOW_FACTOR))`
 *
 * {@link CI_SLOW_FACTOR} is imported from `tests/mobile/budget-model.ts` rather
 * than re-declared, which is the whole point: it is a fact about the CI runner,
 * not about a suite, and one project gets one number for it. Two constants ARE
 * this suite's own, and both are the same *rule* instantiated differently:
 *
 *  - {@link FLAT_DEFAULT_MS} is "whatever a test gets when it declares nothing".
 *    For Playwright that is `playwright.config.ts`'s 60 s; for vitest it is the
 *    5 s built-in default, because `vite.config.ts` sets no `testTimeout`.
 *  - {@link ROUND_TO_MS} is the human step budgets are quoted in. The mobile
 *    journeys land at 60–330 s, so they round to 30 s. These land at 5–50 s, so
 *    they round to 10 s — round *those* to 30 s and every test in the suite
 *    lands on the same number and the table stops saying anything.
 *
 * ── WHY THE NET SUITE NEEDS THIS AT ALL ────────────────────────────────────
 * Nothing here rasterizes WebGL, so it is worth saying where the slowdown
 * actually comes from: these tests stand up a real `node:http` listener, a real
 * RFC 6455 endpoint, a real `MatchServer` on a real 60 Hz `setInterval`, and one
 * or two real client sessions — all on the runner's shared 2 cores, alongside
 * whatever else vitest is running in parallel. Every one of those is event-loop
 * work that stretches when the box is busy. The n4-01 reproduction measured CI's
 * runners at ~6× this hardware, inside the 3–10× band LESSONS §5 records for CI,
 * so the same top-of-band ×10 allowance applies for the same reason it does in
 * `tests/mobile/budgets.ts`: the observation is one sample of a noisy shared
 * runner, and the cost of being generous is bounded while the cost of being
 * tight is a red `main`.
 *
 * ── WHY A BIG BUDGET IS SAFE HERE ──────────────────────────────────────────
 * A budget is a CEILING, not a target, and it is *not* what catches a hang.
 * Those bounds are separate, tighter, and unchanged by this file:
 *
 *   - every wait in this suite goes through `until()` (./node-websocket.ts),
 *     which fails at its own bound naming the condition that never held;
 *   - a sim that stops stepping trips the stall watchdog in ./sim-clock.ts
 *     (no tick at all for {@link ./sim-clock.DEFAULT_STALL_MS} ⇒ immediate
 *     failure, naming how far it got).
 *
 * So a hang still fails in seconds, and the journey budget is only ever spent on
 * work that is genuinely running — which is what makes it safe to size it for
 * the slowest host we support rather than the fastest.
 *
 * ── HOW TO USE IT ──────────────────────────────────────────────────────────
 * ```ts
 * it('runs end-to-end against a locally-run server', async () => {
 *   …
 * }, netBudget({
 *   work: 'boot a server → seat two clients → RUSH! → 1.5 s of SIM → assert travel + prediction',
 *   measuredSeconds: 1.9,
 * }));
 * ```
 * It goes exactly where the hand-written `30_000` used to: `it()`'s third
 * argument, on the closing line, immediately after the journey a reader has just
 * read. `work` is the reviewable half — you can tell whether the number matches
 * the journey without running it. `./budget-contract.test.ts` fails the build if
 * a test rides the flat default or hand-rolls a number here instead.
 */
import { CI_SLOW_FACTOR } from '../mobile/budget-model';

export { CI_SLOW_FACTOR };

/**
 * What a test gets when it declares nothing: vitest's built-in `testTimeout`.
 * `vite.config.ts` deliberately does not raise it, and this file exists so that
 * it never has to — a blanket bump buys silence across the whole suite and hides
 * the next genuine hang.
 */
export const FLAT_DEFAULT_MS = 5_000;

/** Budgets round up to this, so the table reads in human steps rather than in
 *  false precision inherited from one stopwatch reading. */
export const ROUND_TO_MS = 10_000;

/** The budget, in ms, implied by a test's measured in-container cost. */
export function budgetMsFor(measuredSeconds: number): number {
  const scaled = measuredSeconds * 1000 * CI_SLOW_FACTOR;
  const rounded = Math.ceil(scaled / ROUND_TO_MS) * ROUND_TO_MS;
  return Math.max(FLAT_DEFAULT_MS, rounded);
}

/** What a test does, and what that cost when measured. */
export interface TestJob {
  /**
   * The work this budget pays for, in the test's own terms — "seat two clients →
   * RUSH! → buy an upgrade → build a satellite". This is the field that makes a
   * budget reviewable: a reader can tell whether the number matches the journey
   * without running it.
   */
  readonly work: string;
  /**
   * Wall-clock seconds this test measured in the studio container
   * (`npx vitest run tests/net`). Re-measure when the test's work changes; do not
   * nudge it to make a flake go away — a budget that has to grow without the work
   * growing is a performance regression, and should be read as one.
   */
  readonly measuredSeconds: number;
}

/**
 * Declare what this test does and take the budget, in ms, that follows from it.
 * Goes in `it()`'s third argument — the position the hand-written timeout used to
 * occupy: `it(title, async () => { … }, netBudget({ work, measuredSeconds }))`.
 */
export function netBudget(job: TestJob): number {
  return budgetMsFor(job.measuredSeconds);
}
