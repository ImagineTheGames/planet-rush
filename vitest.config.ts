/**
 * vitest.config.ts — the test runner's config. OWNER: QA Agent (a0-00c).
 *
 * This file exists for exactly one reason: to cap the worker pool at the number
 * of cores this lane actually has. Everything else about the run — which specs
 * are collected, the node environment, the globals, the path aliases, the build
 * define — is `vite.config.ts`'s, and is merged in below unchanged. If you are
 * looking for what is tested, it is still there; this file adds no `include`,
 * no `exclude`, and no timeout, on purpose.
 *
 * ── Why it is a separate file ──────────────────────────────────────────────
 *
 * `vite.config.ts` is the Platform Engineer's (it carries the client build:
 * base path, sourcemaps, the git build stamp). A pool size is a property of the
 * QA harness, not of the bundle, so it lives here and imports that config
 * rather than editing it. Vitest prefers `vitest.config.*` over `vite.config.*`
 * and does **not** read both, which is precisely the trap: without the
 * `mergeConfig` below, adding this file would silently drop the aliases and the
 * `include` glob and "pass" by running no tests. It merges, and
 * `tests/harness/pool-size.test.ts` plus the DoD's own `npm test -- --run`
 * keep that honest — a dropped alias fails to resolve `@shared` in the first
 * spec that imports it.
 *
 * ── The number ────────────────────────────────────────────────────────────
 *
 * Vitest sizes its default pool from `os.availableParallelism()`, which inside
 * a container is the HOST's core count — Docker does not mask `/proc/cpuinfo`
 * against the cgroup quota. The studio container is capped at 6 cores and runs
 * `LANES=3` lanes, so three simultaneous DoD runs each spawned a host-sized
 * pool and spent their time descheduling one another: one `npm test -- --run`
 * measured 85 minutes and climbing against ~2 minutes on a quiet box.
 *
 *     cgroup quota 600000/100000 = 6 cores ÷ LANES 3 = 2 workers per lane
 *     3 lanes × 2 workers = the 6 cores the container actually has
 *
 * Derived, not hardcoded — see `harness/pool-size.ts`. Off a container (a
 * developer's laptop, a GitHub runner) there is no quota and no `LANES`, so the
 * cap resolves to host parallelism and nothing changes at all.
 *
 * This is orthogonal to CI's shard plan (a0-00b): that divides the suite across
 * MACHINES, this bounds the workers WITHIN one. Both, not either.
 *
 * `VITEST_MAX_WORKERS=n` overrides, which is how the before/after numbers in
 * `tests/reports/test-pool-a0-00c.md` were taken on one commit.
 */

import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
import { announcedWorkerCap } from './harness/pool-size';

const workers = announcedWorkerCap();

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Both pools are set because the default pool has moved between vitest
      // majors (`threads` then `forks`), and a config that only caps the one in
      // fashion today is a regression waiting for an upgrade. `minX` matters as
      // much as `maxX`: tinypool spawns `min` workers up front, so a min left at
      // the host-sized default would keep the pool it was asked to shrink.
      poolOptions: {
        forks: { minForks: 1, maxForks: workers },
        threads: { minThreads: 1, maxThreads: workers },
      },
      // The pool-agnostic ceiling, honoured by whichever pool ends up running.
      maxWorkers: workers,
      minWorkers: 1,
    },
  }),
);
