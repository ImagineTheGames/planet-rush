/**
 * tests/mobile-budget-contract.test.ts — the budget rule, made mechanical. OWNER: QA Agent.
 *
 * LESSONS §5 has said for a while that a journey test must be budgeted for the
 * work it does rather than left on the suite's flat default. The lesson was
 * written down and never encoded, so it recurred: a flat 60 s cut
 * `centering.spec.ts`'s post-thrust journey off mid-flight on the CI runner's
 * software GL and held `main` red for two days (q7-01), having already flaked a
 * green PR four times.
 *
 * This is the encoding. It is a source-level contract over tests/mobile/, run by
 * `npm test` (vitest) — so it costs no browser time and fails on the cheapest job
 * in CI:
 *
 *   1. every `test(...)` in tests/mobile/ declares its budget via `budgetTest()`,
 *      so nothing rides the flat default by accident;
 *   2. nobody hand-rolls `test.setTimeout()` or `test.slow()`, so every budget in
 *      the suite is sized by one reviewable model (tests/mobile/budgets.ts)
 *      instead of by a magic number in a spec;
 *   3. the budget arithmetic itself holds — a cheap test still gets the floor, so
 *      this file can never quietly become the blanket bump it exists to prevent.
 *
 * It lives OUTSIDE tests/mobile/ on purpose: Playwright's `testDir` is that
 * directory and its default `testMatch` picks up `*.test.ts` as well as
 * `*.spec.ts`, so a vitest file in there would be collected by the browser suite
 * too.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The pure model only — importing ./mobile/budgets would pull the Playwright
// runtime into the vitest job for no benefit.
import { budgetMsFor, CI_SLOW_FACTOR, FLAT_DEFAULT_MS } from './mobile/budget-model';

const MOBILE_DIR = fileURLToPath(new URL('./mobile', import.meta.url));

/** `test('…'` / `test(`…`` at a statement position — NOT `test.skip(`, `test.describe(`
 *  or a `.test(` method call, and not the bare word "test" in prose. */
const TEST_DECL = /(?<![.\w])test\(\s*[`'"]/g;

const specFiles = (): string[] => readdirSync(MOBILE_DIR).filter((f) => f.endsWith('.spec.ts'));

/**
 * Drop comments before scanning. These specs document themselves heavily and
 * legitimately *quote* the patterns this file bans ("this used to be
 * `test.slow()`"), so scanning raw source would flag the explanation of a fix as
 * the fix's absence. Crude by design — it does not parse strings, which is fine
 * here: no spec puts `//` inside a string literal on the same line as code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const readSpec = (file: string): string => stripComments(readFileSync(join(MOBILE_DIR, file), 'utf8'));

/** The source of each `test(...)` body: from its declaration to the next one. */
function testBodies(source: string): { title: string; body: string }[] {
  const starts: number[] = [];
  for (const m of source.matchAll(TEST_DECL)) starts.push(m.index);
  return starts.map((start, i) => {
    const body = source.slice(start, starts[i + 1] ?? source.length);
    const title = /^test\(\s*[`'"]([^`'"]*)/.exec(body)?.[1] ?? '(untitled)';
    return { title, body };
  });
}

describe('tests/mobile budget contract', () => {
  const files = specFiles();

  it('finds the mobile specs (a moved suite must not silently pass this)', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files).toContain('centering.spec.ts');
  });

  it('every test declares its budget with budgetTest()', () => {
    const unbudgeted: string[] = [];
    for (const file of files) {
      for (const { title, body } of testBodies(readSpec(file))) {
        if (!body.includes('budgetTest(')) unbudgeted.push(`${file} › ${title}`);
      }
    }
    expect(
      unbudgeted,
      'These tests ride playwright.config.ts\'s flat default instead of budgeting the work they do.\n' +
        'Call budgetTest({ work, measuredSeconds }) first thing in the body — see tests/mobile/budgets.ts.\n' +
        unbudgeted.join('\n'),
    ).toEqual([]);
  });

  it('no spec hand-rolls a timeout — budgets come from one model', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const [match] of readSpec(file).matchAll(/\btest\.(setTimeout|slow)\s*\(/g)) {
        offenders.push(`${file}: ${match.trim()}`);
      }
    }
    expect(
      offenders,
      'A hand-written timeout says nothing about the work and drifts when the config moves.\n' +
        'Use budgetTest({ work, measuredSeconds }) instead (tests/mobile/budgets.ts).\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('sizes a journey from its measured cost, and leaves a cheap test on the floor', () => {
    // A two-assertion test stays at the flat default: budgeting per test must not
    // become a blanket bump.
    expect(budgetMsFor(2)).toBe(FLAT_DEFAULT_MS);
    expect(budgetMsFor(6)).toBe(FLAT_DEFAULT_MS);

    // A journey gets the software-GL allowance, rounded up to a human step.
    expect(budgetMsFor(27)).toBe(270_000); // 27 s × 10 = 270 s, already a step
    expect(budgetMsFor(28)).toBe(300_000); // 28 s × 10 = 280 s → rounds up to 300 s
    expect(budgetMsFor(15)).toBe(150_000);

    // The allowance covers the runner slowdown we NORMALLY see (5.9× at 11659df)
    // with room, and sits at the top of the band LESSONS §5 records for software
    // GL. It deliberately does not chase the tail: 21× (PR #291) and 31×
    // (369d7a6) have both been measured, and sizing every budget in the suite for
    // 31× would give a genuine hang minutes to hide in. The tail is covered by an
    // extra ATTEMPT on the goldens instead — tests/mobile/shot-budget.ts
    // `GOLDEN_CI_RETRIES`, and the sample table in ./mobile/budget-model.ts.
    expect(CI_SLOW_FACTOR).toBeGreaterThanOrEqual(6);
    expect(CI_SLOW_FACTOR).toBeLessThanOrEqual(10);
  });
});
