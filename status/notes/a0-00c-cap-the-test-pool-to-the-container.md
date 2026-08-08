# a0-00c — cap the test pool to the container

Branch: `agent/qa/a0-00c-cap-test-pool`. Working note, not evidence.

## BUILT

- `harness/pool-size.ts` — the derivation. Reads the cgroup CPU quota
  (`/sys/fs/cgroup/cpu.max` v2, `cpu.cfs_quota_us`/`cpu.cfs_period_us` v1),
  divides by `LANES`, floors, clamps to `[1, hostParallelism]`. Returns the
  arithmetic alongside the number so a log line and a report can quote it.
  `resolveWorkerCap()` is pure — it takes the raw file contents — so the
  arithmetic is testable for boxes this one is not.
- `vitest.config.ts` — NEW file, `mergeConfig(viteConfig, { test: { poolOptions,
  maxWorkers } })`. Caps `forks`/`threads` min and max plus the pool-agnostic
  `maxWorkers`/`minWorkers`.
- `tests/harness/pool-size.test.ts` — the arithmetic, incl. the laptop control
  (no quota ⇒ unchanged) and the studio case (6 ÷ 3 = 2).
- `playwright.config.ts` — local `workers` was `undefined` (Playwright default
  `os.cpus().length / 2`, the same false view of the machine). Now
  `browserWorkerCap()`: `undefined` off a container, 1 under the studio quota.
- `tests/perf/playwright.perf.config.ts` — `workers: 1` unconditionally. Not the
  container cap: a frame-time instrument must never run beside a second copy of
  itself, on any box.
- `tests/reports/test-pool-a0-00c.md` — the before/after numbers.

## DECISIONS

- **A separate `vitest.config.ts`, not `poolOptions` in `vite.config.ts`.** The
  DoD accepts either. `vite.config.ts` is the Platform Engineer's (it carries the
  client build and the git stamp; `tests/server/match-server.test.ts` says so in
  as many words), and a pool size is a QA property. The trap this creates is that
  vitest prefers `vitest.config.*` and does **not** also read `vite.config.*` —
  adding the file naively would drop the aliases and the `include` glob and
  "pass" by running nothing. Hence `mergeConfig`, and hence the full suite in the
  DoD as the check on it.
- **2 workers per lane.** cgroup quota 600000/100000 = 6 cores ÷ `LANES=3` = 2;
  3 lanes × 2 = the 6 the container has. Derived at config load, not written down.
- **Floor, never round up.** 3 cores ÷ 2 lanes = 1, not 2. Rounding up is how the
  box gets oversold, which is the bug.
- **Fall back to host parallelism, and default `LANES` to 1.** A laptop and a
  GitHub runner have no quota and no `LANES`, so the cap resolves to exactly the
  number vitest would have picked for itself. The quiet-box control number is
  supposed to barely move; if it moved a lot, something was skipped.
- **Both pools capped, and the `min` as well as the `max`.** The default pool has
  moved between vitest majors; tinypool spawns `min` workers eagerly, so a min
  left at the host-sized default keeps the pool the max just shrank.
- **`VITEST_MAX_WORKERS` override.** Not a convenience — it is how the before and
  after numbers were taken on one commit, with the same specs, on the same box.
- Rejected: hardcoding `2`. Rejected: `os.cpus().length / 3` — same lie, divided.
  Rejected: touching the CI shard config (a0-00b); different axis, machines not
  workers, and CI runners have no quota so this changes nothing there.
- Left alone: `tests/live-stage/*` (Platform Engineer's) and
  `tests/live-stage-online/*` (Gameplay Engineer's) — same uncapped default, not
  my files. Flagged in the report.

## NEXT

- `vitest.config.ts` is not in `tsconfig.json`'s `include` (which lists
  `vite.config.ts` explicitly), so `tsc --noEmit` does not typecheck it. I did
  not edit `tsconfig.json` — not my file. Proposed to the Platform Engineer in
  the PR as a one-word follow-up.
- Known and unrelated: `tests/net/capacity/capacity-regression.test.ts` is
  load-flaky (asserts a 33 ms wall-clock tick budget on a shared box). Expect it
  red in a contended run; it is not a signal about this change.
