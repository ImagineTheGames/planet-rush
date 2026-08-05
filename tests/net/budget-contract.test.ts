/**
 * tests/net/budget-contract.test.ts — the two rules n4-01 cost us, made
 * mechanical. OWNER: Netcode Engineer.
 *
 * LESSONS §5 has said for a while that a journey test must be budgeted for the
 * work it does rather than left on the suite's flat default. q7-01 encoded that
 * for `tests/mobile/` after it held `main` red for two days. A week later `main`
 * went red again, on `tests/net/playtest-log-online.test.ts` — the same disease,
 * in the suite nobody had encoded it for. A lesson written down in one place is
 * a lesson that recurs everywhere else.
 *
 * So this is the encoding, for the vitest suite, and it is deliberately about
 * BOTH halves of what went wrong:
 *
 *   1. **Budgets.** Every test in a file that lets time pass declares what it
 *      does and takes the budget that follows (`./budgets.ts`), so nothing rides
 *      vitest's flat 5 s default by accident and no magic number appears in a
 *      test file again.
 *   2. **Waits.** No test in this suite sleeps. A `sleep(400)` before an
 *      assertion is a guess about how fast the machine is, and it fails on the
 *      machine that gates merges — which is exactly how both reds happened. The
 *      wait belongs on the condition the assertion needs (`until()` in
 *      `./node-websocket.ts`) or on the sim's own clock (`./sim-clock.ts`).
 *
 * Both are source-level checks, so they cost no socket time and fail on the
 * cheapest job in CI.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetMsFor, CI_SLOW_FACTOR, FLAT_DEFAULT_MS, ROUND_TO_MS } from './budgets';

const NET_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * The harnesses that make a test's wall-clock cost a function of the host: a real
 * socket and a real server (`./node-websocket`, `./local-fleet`), a scripted wire
 * driving real sessions (`./latency-harness`), or a `MatchServer` driven through
 * a clock the test advances.
 *
 * A file importing one of these is a file whose tests take real time, and those
 * are exactly the tests a flat default can cut off mid-journey.
 */
const HARNESS_IMPORTS = ['node-websocket', 'local-fleet', 'latency-harness', 'match-server'];

/**
 * The one file that imports a harness and is still NOT budgeted, named here so
 * the exclusion is a decision rather than an oversight.
 *
 * `online-teams.test.ts` constructs a `MatchServer` and calls `update()` **once**
 * to build a world and a roster; it then asks the sim questions synchronously.
 * There is no wire, no loop and nothing that waits, so its tests are model checks
 * that happen to import the server — the fastest of them is under a millisecond
 * and the slowest is a quarter second. Budgeting them would put a declaration on
 * fifty assertions that cannot be affected by the runner's clock, which is
 * ceremony, and ceremony is how a rule stops being read.
 */
const UNBUDGETED_BY_DECISION = ['online-teams.test.ts'];

/** `it('…'` / `it(`…`` at a statement position — NOT `.it(`, `it.skip(`, or the
 *  bare word "it" in prose. */
const TEST_DECL = /(?<![.\w])it\(\s*[`'"]/g;

/** A hand-written timeout in `it()`'s third argument: `}, 30_000);`. */
const HAND_ROLLED_TIMEOUT = /\}\s*,\s*\d[\d_]*\s*\)\s*;/g;

/** A wall-clock wait inside a test file. `until(...)` and `waitForTicks(...)`
 *  are the two sanctioned shapes; these are the two that are not. */
const WALL_CLOCK_WAIT = /(?<![.\w])(sleep|setTimeout)\s*\(/g;

const testFiles = (): string[] => readdirSync(NET_DIR).filter((f) => f.endsWith('.test.ts'));

/**
 * Drop comments before scanning. These files document themselves heavily and
 * legitimately *quote* the patterns this file bans ("this used to be
 * `await sleep(1_500)`"), so scanning raw source would flag the explanation of a
 * fix as the fix's absence. Crude by design — it does not parse strings, which is
 * fine here: no test file puts `//` inside a string literal on the same line as
 * code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const read = (file: string): string => stripComments(readFileSync(join(NET_DIR, file), 'utf8'));

/** True when this file stands something up that takes real time to run. */
const isTimed = (source: string): boolean =>
  HARNESS_IMPORTS.some((h) => new RegExp(`from '[^']*${h}'`).test(source));

/** The source of each `it(...)` body: from its declaration to the next one. */
function testBodies(source: string): { title: string; body: string }[] {
  const starts: number[] = [];
  for (const m of source.matchAll(TEST_DECL)) starts.push(m.index);
  return starts.map((start, i) => {
    const body = source.slice(start, starts[i + 1] ?? source.length);
    const title = /^it\(\s*[`'"]([^`'"]*)/.exec(body)?.[1] ?? '(untitled)';
    return { title, body };
  });
}

describe('tests/net budget contract', () => {
  const files = testFiles();
  const sources = new Map(files.map((f) => [f, read(f)] as const));
  const timed = files.filter(
    (f) => isTimed(sources.get(f)!) && !UNBUDGETED_BY_DECISION.includes(f),
  );

  it('finds the net suite (a moved or renamed suite must not silently pass this)', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files).toContain('playtest-log-online.test.ts');
    // The file that went red, and the two that would have gone next: the 4.3 s
    // rtt-decomposition test and the 2.8 s latency-feel gate were both riding
    // vitest's 5 s default, which a ~6× runner turns into a certainty.
    expect(timed).toContain('playtest-log-online.test.ts');
    expect(timed).toContain('rtt-decomposition.test.ts');
    expect(timed).toContain('latency-feel.test.ts');
    expect(timed.length).toBeGreaterThanOrEqual(14);
  });

  it('every test that lets time pass declares its budget with netBudget()', () => {
    const unbudgeted: string[] = [];
    for (const file of timed) {
      for (const { title, body } of testBodies(sources.get(file)!)) {
        if (!body.includes('netBudget(')) unbudgeted.push(`${file} › ${title}`);
      }
    }
    expect(
      unbudgeted,
      'These tests ride vitest’s flat 5 s default instead of budgeting the work they do.\n' +
        'Pass netBudget({ work, measuredSeconds }) as it()’s third argument — see tests/net/budgets.ts.\n' +
        unbudgeted.join('\n'),
    ).toEqual([]);
  });

  it('no test hand-rolls a timeout — budgets come from one model', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const [match] of sources.get(file)!.matchAll(HAND_ROLLED_TIMEOUT)) {
        offenders.push(`${file}: ${match.trim()}`);
      }
    }
    expect(
      offenders,
      'A hand-written timeout says nothing about the work and drifts when the suite moves.\n' +
        'Use netBudget({ work, measuredSeconds }) instead (tests/net/budgets.ts).\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('no test sleeps — a wait is on the condition, or on the sim’s clock', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const [match] of sources.get(file)!.matchAll(WALL_CLOCK_WAIT)) {
        offenders.push(`${file}: ${match.trim()}…`);
      }
    }
    expect(
      offenders,
      'A sleep before an assertion is a guess about how fast the machine is, and it is\n' +
        'how BOTH of this month’s red mains happened. Wait for the condition the assertion\n' +
        'needs — until() in tests/net/node-websocket.ts — or for the simulation the\n' +
        'assertion needs: waitForTicks() in tests/net/sim-clock.ts.\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('sizes a journey from its measured cost, and leaves a cheap test on the floor', () => {
    // A model check stays at vitest's own default: budgeting per test must not
    // become the blanket `testTimeout` bump it exists to avoid.
    expect(budgetMsFor(0.05)).toBe(FLAT_DEFAULT_MS);
    expect(budgetMsFor(0.5)).toBe(FLAT_DEFAULT_MS);

    // A journey gets the CI allowance, rounded up to a human step.
    expect(budgetMsFor(1)).toBe(10_000);
    expect(budgetMsFor(1.6)).toBe(20_000); // 16 s → rounds up to a 20 s step
    expect(budgetMsFor(4.3)).toBe(45_000);

    // The allowance covers the ~6× runner slowdown n4-01 measured, with room, and
    // stays inside the band LESSONS §5 records. It is imported from the mobile
    // model rather than re-declared: it is a fact about the runner, not a suite.
    expect(CI_SLOW_FACTOR).toBeGreaterThanOrEqual(6);
    expect(CI_SLOW_FACTOR).toBeLessThanOrEqual(10);
    // And the floor is genuinely REACHABLE. Round to a step above it — mobile's
    // 30 s, or the 10 s this file was first written with — and rounding swallows
    // the floor: no measurement, however small, can produce it, and "a cheap test
    // stays cheap" quietly stops being true.
    expect(ROUND_TO_MS).toBe(FLAT_DEFAULT_MS);
  });
});
