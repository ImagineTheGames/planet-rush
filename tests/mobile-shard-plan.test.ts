/**
 * tests/mobile-shard-plan.test.ts — the shard split, made mechanical. OWNER: QA Agent.
 *
 * `tests/mobile/shard-plan.ts` decides which runner executes which spec file.
 * Two things about that decision are worth more than a comment, because getting
 * either wrong is silent:
 *
 *   1. **The union of the shards must be the whole suite.** A spec that lands in
 *      no shard still shows up green, on every shard, forever — the worst
 *      possible failure of a merge gate, and one no shard's own log would name.
 *      A spec that lands in TWO shards merely wastes a runner, but it is the same
 *      bug seen from the other side, so both are asserted.
 *   2. **The table must keep up with the directory.** A cost table is a snapshot;
 *      the way a snapshot fails is that someone adds a spec and nobody re-measures.
 *      That is caught here, on the cheapest job in CI, rather than as a shard that
 *      quietly grew ten minutes.
 *
 * It lives OUTSIDE tests/mobile/ for the same reason
 * `tests/mobile-budget-contract.test.ts` does: Playwright's `testDir` is that
 * directory and its default `testMatch` picks up `*.test.ts` as well as
 * `*.spec.ts`, so a vitest file in there would be collected by the browser suite.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MEASURED_FILES,
  MEASURED_SECONDS,
  UNMEASURED_SECONDS,
  costOf,
  filesForShard,
  heaviestUnit,
  planShards,
  spreadSeconds,
} from './mobile/shard-plan';

const MOBILE_DIR = fileURLToPath(new URL('./mobile', import.meta.url));

/** The projects `playwright.config.ts` defines, in its order. */
const PROJECTS = ['iphone', 'pixel', 'desktop'] as const;

/** Every spec file the browser suite collects — read the same way the config
 *  reads it, so this test and the runner can never disagree about the input. */
const SPEC_FILES = readdirSync(MOBILE_DIR)
  .filter((f) => f.endsWith('.spec.ts'))
  .sort();

/** The shard count ci.yml runs. Asserted at the number actually shipped, and at
 *  its neighbours, because "it balances at 4" is a weaker claim than it looks. */
const CI_SHARDS = 4;

describe('the mobile suite has spec files to shard at all', () => {
  it('finds them', () => {
    expect(SPEC_FILES.length).toBeGreaterThan(0);
  });
});

describe('every shard plan covers the suite exactly once', () => {
  for (const total of [1, 2, 3, 4, 5, 8]) {
    it(`N=${total}: the union of the shards is the whole matrix, with nothing twice`, () => {
      const seen = new Map<string, number[]>();
      for (let shard = 1; shard <= total; shard++) {
        for (const project of PROJECTS) {
          for (const file of filesForShard(PROJECTS, SPEC_FILES, project, shard, total)) {
            const key = `${project}|${file}`;
            seen.set(key, [...(seen.get(key) ?? []), shard]);
          }
        }
      }

      const expected = PROJECTS.flatMap((p) => SPEC_FILES.map((f) => `${p}|${f}`));
      // Named rather than counted: a failure should say WHICH pair went missing.
      expect([...seen.keys()].sort()).toEqual([...expected].sort());
      expect([...seen.entries()].filter(([, shards]) => shards.length !== 1)).toEqual([]);
    });
  }

  it('rejects a shard index outside the matrix rather than running nothing', () => {
    expect(() => filesForShard(PROJECTS, SPEC_FILES, 'iphone', 0, 4)).toThrow();
    expect(() => filesForShard(PROJECTS, SPEC_FILES, 'iphone', 5, 4)).toThrow();
    expect(() => planShards(PROJECTS, SPEC_FILES, 0)).toThrow();
  });

  it('is deterministic — two runs of the planner agree, so two runners do', () => {
    const a = planShards(PROJECTS, SPEC_FILES, CI_SHARDS);
    const b = planShards([...PROJECTS].reverse(), [...SPEC_FILES].reverse(), CI_SHARDS);
    const key = (s: (typeof a)[number]): string =>
      s.units
        .map((u) => `${u.project}|${u.file}`)
        .sort()
        .join(',');
    expect(a.map(key)).toEqual(b.map(key));
  });
});

describe('the plan is actually balanced', () => {
  it(`N=${CI_SHARDS}: no shard carries more than 110% of an even split`, () => {
    const plan = planShards(PROJECTS, SPEC_FILES, CI_SHARDS);
    const even = plan.reduce((sum, s) => sum + s.seconds, 0) / CI_SHARDS;
    const worst = Math.max(...plan.map((s) => s.seconds));
    // The theoretical floor is the heaviest indivisible unit; assert against the
    // even split, and only when the split is the binding constraint — below that
    // the plan is as good as any plan can be and the ratio means nothing.
    const floor = heaviestUnit(PROJECTS, SPEC_FILES).seconds;
    if (even > floor) expect(worst).toBeLessThanOrEqual(even * 1.1);
    else expect(worst).toBeLessThanOrEqual(floor * 1.1);
  });

  it('beats splitting by test count, which is what this replaced', () => {
    // The measured spread `--shard=i/N` produced on run 31249237259, in seconds
    // of test time: 1122 / 4848 / 2370 / 324. Anything close to that is not a
    // balanced plan, and this is the number the report quotes.
    const plan = planShards(PROJECTS, SPEC_FILES, CI_SHARDS);
    expect(spreadSeconds(plan)).toBeLessThan(4848 - 324);
    expect(spreadSeconds(plan)).toBeLessThan(120);
  });
});

describe('the cost table keeps up with the directory', () => {
  it('every spec file in tests/mobile/ has a measured cost on some project', () => {
    const missing = SPEC_FILES.filter((f) => !MEASURED_FILES.has(f));
    expect(
      missing,
      'these specs are in tests/mobile/ but have no row in shard-plan.ts MEASURED_SECONDS. ' +
        'They will be scheduled at the UNMEASURED_SECONDS guess until someone re-measures — ' +
        'see tests/reports/mobile-shard-a0-00.md §6 for how.',
    ).toEqual([]);
  });

  it('the table names no spec file that has been deleted', () => {
    const stale = [...MEASURED_FILES].filter((f) => !SPEC_FILES.includes(f));
    expect(stale, 'shard-plan.ts prices spec files that no longer exist').toEqual([]);
  });

  it('an unmeasured file costs the guess, not nothing', () => {
    // Zero is the dangerous default: a free-looking spec gets stacked onto
    // whichever shard is already lightest and turns up as a mystery regression.
    expect(costOf('iphone', 'not-a-real-file.spec.ts')).toBe(UNMEASURED_SECONDS);
    expect(UNMEASURED_SECONDS).toBeGreaterThan(0);
  });

  it('a measured file that is skipped on a project genuinely costs nothing there', () => {
    // `menu-frame-cost` is iphone-only — absent is not the same as unmeasured.
    expect(costOf('desktop', 'menu-frame-cost.spec.ts')).toBe(0);
    expect(costOf('iphone', 'menu-frame-cost.spec.ts')).toBeGreaterThan(0);
  });

  it('every key in the table names a project the config defines', () => {
    const strays = Object.keys(MEASURED_SECONDS).filter(
      (k) => !PROJECTS.includes(k.slice(0, k.indexOf('|')) as (typeof PROJECTS)[number]),
    );
    expect(strays).toEqual([]);
  });
});
