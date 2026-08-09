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
- Merged `origin/main` into the branch (the DoD's ancestor check was failing:
  the branch was cut before a0-16 landed). Clean merge, no conflicts.

- `harness/pool-contention-bench.sh` (`942ea57`) — the fixed-competing-load rig.
  It turned out to measure the wrong thing (see DECISIONS); kept and documented
  as such so nobody builds it a second time.
- `harness/pool-lane-aggregate.sh` (`25cbc85`) — the rig that matches the claim.
  Three concurrent `vitest --run`, disjoint `--shard` thirds, timed to the LAST
  lane home. Total CPU work pinned at one suite in both arms.
- `tests/harness/pool-size.test.ts` fix (`94607a8`) — the real-box invariant test
  asserted `workers <= hostParallelism()` unconditionally, which the "before" arm
  would have reddened on its way to measuring itself. The ceiling belongs to the
  derivation, not to an explicit override.
- `tests/reports/test-pool-a0-00c.md` (`ab818a3`) — the report. Ten arms, three
  rigs. Leads with the finding, which is not the one the brief expected.

## THE FINDING (read before touching the number)

Two things came out opposite to the brief, both evidenced in the report:

1. **vitest was never reading the host's 16.** `os.availableParallelism()` is
   cgroup-aware (libuv reads the quota) and vitest 2.1.8 prefers it: 6 on this
   box against `os.cpus()`'s 8. The oversubscription was 3× (three lanes each
   claiming the container's whole budget), not 8×. **Playwright** is the runner
   genuinely blind to the quota — `os.cpus()/2` = 4, at ~2 cores per dpr-3 page,
   so 3 lanes = 24 cores of demand on 6. If an 85-minute lane recurs, look there.
2. **The cap costs throughput and buys gate stability.** Three real lanes
   sharding one suite finish FASTER uncapped — 248 s vs 320 s, and 131 s vs
   252 s, with the capped arm holding the quieter box in rep 1. What capping buys
   is 1 red arm in 5 instead of 3 in 5, including a 60 fps gate (`perf.test.ts`
   p95 4.33 ms vs 4.17 ms) that failed only uncapped, from contention.

Shipped at 2/lane as briefed — it is the ask, and it is where the 60 fps gates
hold. Report §5 puts the trade to the Director explicitly. Raising it is one
value (`LANES`, or `VITEST_MAX_WORKERS` per run); do not quietly re-tune it
without that call.

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
- **The opportunistic before/after was discarded, and the rig replaced it.** Two
  real runs on 2026-08-09: capped (2 workers) 574 s at load 17, uncapped (6
  workers) 214 s at load 8. That reads backwards from the truth, because the two
  other lanes went quiet between them — it measures the afternoon, not the
  change. `harness/pool-contention-bench.sh` supplies the competing load itself
  (12 spinners = 2 lanes × 6 uncapped workers; 4 = 2 lanes × 2 capped) and runs
  the pair interleaved, twice, so drift shows up in both arms instead of in one.
- **Spinners, not three real suite runs.** Three vitest runs in one working tree
  collide over test artifacts, and the red that produces would be an artifact of
  the measurement. CPU demand is the thing an oversized pool takes from its
  neighbours, and CPU demand is what the rig reproduces — without writing into
  another lane's tree.
- **The brief's diagnosis is right about the bug and off by one detail about the
  mechanism.** vitest 2.1.8 sizes from `os.availableParallelism()` (falling back
  to `os.cpus().length`), and libuv *does* read the cgroup quota: on this box
  `availableParallelism()` = 6 while `os.cpus().length` = 8. So vitest was not
  reading the host's 16 — it was reading the quota correctly and still being
  wrong, because 6 is the *container's* budget and three lanes each claimed all
  of it. The division by `LANES` is what does the work here, not the cgroup read;
  the cgroup read is what keeps the laptop fallback honest. Playwright is the one
  that reads `os.cpus().length` straight (`/2`), so it saw 8 → 4 workers.
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
- **For the Platform Engineer, flagged in the PR, not edited:** three Playwright
  configs leave `workers` unset and so inherit the quota-blind
  `os.cpus().length / 2` — `tests/live-stage/playwright.config.ts`,
  `tests/live-stage/playwright.live-stage.config.ts`, and
  `tests/live/playwright.live.config.ts`. `npm run test:live-stage` is a real
  package script, so these are lane-runnable, not one-offs. One line each:
  `workers: browserWorkerCap()`. (The other three live-stage configs and
  `tests/live-stage-online/` already set `workers: 1` — checked, not assumed; an
  earlier draft of the report claimed the whole directory was capped and was
  wrong.)
- Known and unrelated: `tests/net/capacity/capacity-regression.test.ts` is
  load-flaky (asserts a 33 ms wall-clock tick budget on a shared box). It went
  red in 4 of the 10 measurement arms, in BOTH capped and uncapped ones — it is a
  symptom of a shared box throughout, never a signal about this change.
- Open question for the Director, report §5: whether sweep throughput outranks
  gate stability. If it does, the cap should be raised, and the better fix is to
  make the wall-clock gates measure CPU time rather than wall time — a separate
  brief, and a bigger one.
