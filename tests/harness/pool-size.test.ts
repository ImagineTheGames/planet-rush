/**
 * tests/harness/pool-size.test.ts — the worker-cap arithmetic. OWNER: QA Agent
 * (a0-00c).
 *
 * `harness/pool-size.ts` decides how many test workers this box can afford, and
 * it is load-bearing in two directions: too high and three lanes thrash a
 * six-core container (the bug it was written for); too low and every lane runs
 * single-file forever. Neither failure is visible from a test result — the suite
 * stays green either way — so the arithmetic is asserted here directly.
 *
 * Every case feeds `resolveWorkerCap` a synthetic box, so these assertions hold
 * on a laptop, in the studio container, and on a GitHub runner alike. The one
 * case that reads the real box asserts only the invariants that must be true
 * everywhere (>= 1, <= host parallelism) — not a number, because the number is
 * a property of whoever is running it.
 */

import { describe, it, expect } from 'vitest';
import {
  CORES_PER_BROWSER_WORKER,
  quotaCores,
  resolveBrowserWorkerCap,
  resolveWorkerCap,
  workerCap,
  hostParallelism,
  type BoxReading,
} from '../../harness/pool-size';

/** A box with no cgroup quota and no lanes: a developer's laptop. */
function laptop(overrides: Partial<BoxReading> = {}): BoxReading {
  return {
    cpuMax: null,
    cfsQuota: null,
    cfsPeriod: null,
    hostParallelism: 16,
    lanes: undefined,
    override: undefined,
    ...overrides,
  };
}

describe('quotaCores', () => {
  it('reads a cgroup v2 quota as a core count', () => {
    // The studio container, as measured 2026-08-08: 600 ms of CPU per 100 ms.
    expect(quotaCores(laptop({ cpuMax: '600000 100000\n' }))).toBe(6);
  });

  it('reads a cgroup v1 quota/period pair', () => {
    expect(
      quotaCores(laptop({ cfsQuota: '400000\n', cfsPeriod: '100000\n' })),
    ).toBe(4);
  });

  it('treats an unlimited v2 quota as no quota', () => {
    expect(quotaCores(laptop({ cpuMax: 'max 100000\n' }))).toBeNull();
  });

  it('treats an unlimited v1 quota (-1) as no quota', () => {
    expect(
      quotaCores(laptop({ cfsQuota: '-1\n', cfsPeriod: '100000\n' })),
    ).toBeNull();
  });

  it('is null when neither cgroup file is readable', () => {
    expect(quotaCores(laptop())).toBeNull();
  });

  it('keeps a fractional grant fractional', () => {
    expect(quotaCores(laptop({ cpuMax: '150000 100000\n' }))).toBe(1.5);
  });
});

describe('resolveWorkerCap', () => {
  it('is the studio arithmetic: 6 cores / 3 lanes = 2 workers', () => {
    // The whole point of a0-00c. 3 lanes x 2 workers = the 6 the box has.
    const cap = resolveWorkerCap(
      laptop({ cpuMax: '600000 100000\n', lanes: '3' }),
    );
    expect(cap.workers).toBe(2);
    expect(cap.quotaCores).toBe(6);
    expect(cap.lanes).toBe(3);
  });

  it('leaves a quota-less box on host parallelism — the laptop control', () => {
    // Nothing changes off a container: this is the number vitest would have
    // picked for itself, so a developer sees no difference at all.
    const cap = resolveWorkerCap(laptop({ hostParallelism: 16 }));
    expect(cap.workers).toBe(16);
    expect(cap.quotaCores).toBeNull();
  });

  it('leaves a CI runner alone (no quota, no LANES)', () => {
    const cap = resolveWorkerCap(
      laptop({ cpuMax: 'max 100000\n', hostParallelism: 4 }),
    );
    expect(cap.workers).toBe(4);
  });

  it('defaults to one lane when LANES is unset', () => {
    const cap = resolveWorkerCap(laptop({ cpuMax: '600000 100000\n' }));
    expect(cap.workers).toBe(6);
    expect(cap.lanes).toBe(1);
  });

  it('never returns zero workers, however thin the slice', () => {
    // One core split three ways is a third of a core; you still get a worker.
    const cap = resolveWorkerCap(
      laptop({ cpuMax: '100000 100000\n', lanes: '3' }),
    );
    expect(cap.workers).toBe(1);
  });

  it('never exceeds what the machine claims to have', () => {
    // A quota larger than the host is nonsense, but it must not become an
    // oversized pool — that is the failure mode this file exists to prevent.
    const cap = resolveWorkerCap(
      laptop({ cpuMax: '3200000 100000\n', hostParallelism: 4 }),
    );
    expect(cap.workers).toBe(4);
  });

  it('floors a fractional share rather than rounding it up', () => {
    // 3 cores / 2 lanes = 1.5 -> 1. Rounding up is how the box gets oversold.
    const cap = resolveWorkerCap(
      laptop({ cpuMax: '300000 100000\n', lanes: '2' }),
    );
    expect(cap.workers).toBe(1);
  });

  it('ignores garbage in LANES rather than dividing by it', () => {
    for (const lanes of ['0', '-2', 'three', '']) {
      const cap = resolveWorkerCap(laptop({ cpuMax: '600000 100000\n', lanes }));
      expect(cap.workers).toBe(6);
      expect(cap.lanes).toBe(1);
    }
  });

  it('lets VITEST_MAX_WORKERS override everything, for measurement runs', () => {
    // How the a0-00c before/after numbers were taken on the same commit.
    const cap = resolveWorkerCap(
      laptop({ cpuMax: '600000 100000\n', lanes: '3', override: '7' }),
    );
    expect(cap.workers).toBe(7);
    expect(cap.reason).toContain('override');
  });

  it('ignores a garbage override', () => {
    const cap = resolveWorkerCap(
      laptop({ cpuMax: '600000 100000\n', lanes: '3', override: 'lots' }),
    );
    expect(cap.workers).toBe(2);
  });

  it('states its arithmetic, so a report can quote it', () => {
    const cap = resolveWorkerCap(
      laptop({ cpuMax: '600000 100000\n', lanes: '3' }),
    );
    expect(cap.reason).toContain('6 cores');
    expect(cap.reason).toContain('LANES 3');
  });
});

describe('resolveBrowserWorkerCap', () => {
  it('gives the studio one mobile page at a time: 2 lane cores / 2 = 1', () => {
    const cap = resolveWorkerCap(
      laptop({ cpuMax: '600000 100000\n', lanes: '3' }),
    );
    expect(resolveBrowserWorkerCap(cap)).toBe(1);
  });

  it('leaves a quota-less box on Playwright’s own default', () => {
    // undefined, not a number: off a container playwright.config keeps saying
    // "a dev box has the cores", and a0-00c does not overrule that.
    expect(resolveBrowserWorkerCap(resolveWorkerCap(laptop()))).toBeUndefined();
  });

  it('is never zero, however thin the lane’s share', () => {
    const cap = resolveWorkerCap(
      laptop({ cpuMax: '100000 100000\n', lanes: '3' }),
    );
    expect(resolveBrowserWorkerCap(cap)).toBe(1);
  });

  it('scales with the quota: 12 cores to one lane is 6 pages', () => {
    const cap = resolveWorkerCap(laptop({ cpuMax: '1200000 100000\n', hostParallelism: 16 }));
    expect(resolveBrowserWorkerCap(cap)).toBe(12 / CORES_PER_BROWSER_WORKER);
  });
});

describe('workerCap on the box actually running this', () => {
  it('is at least one worker and never more than the host claims', () => {
    const cap = workerCap();
    expect(cap.workers).toBeGreaterThanOrEqual(1);
    expect(cap.workers).toBeLessThanOrEqual(hostParallelism());
    expect(Number.isInteger(cap.workers)).toBe(true);
  });

  it('reports a quota when it is running under one', () => {
    // Not an assertion about *this* box — either branch is legitimate. It
    // asserts the two fields stay consistent with each other.
    const cap = workerCap();
    if (cap.quotaCores === null) {
      expect(cap.reason).toContain('no cgroup CPU quota');
    } else {
      expect(cap.quotaCores).toBeGreaterThan(0);
    }
  });
});
