# a0-00c — capping the test worker pool to the container

QA Agent · branch `agent/qa/a0-00c-cap-test-pool` · measured 2026-08-09 in lane-2
of the studio container.

**Read this first:** the change is in and green, and the number it was asked for
is derived rather than hardcoded. But the measurements do **not** reproduce the
brief's premise, and they say the cap costs throughput rather than buying it. The
honest headline is a trade, not a win: capping makes a lane's tests **slower**
and makes the wall-clock-budget gates **hold**. Section 5 is the number the
Director should actually decide on.

---

## 1. What changed

| file | before | after |
| --- | --- | --- |
| `vitest.config.ts` *(new)* | no config; vitest default pool | `poolOptions.forks/threads` + `maxWorkers` from `harness/pool-size.ts` |
| `playwright.config.ts` | `workers: CI ? 1 : undefined` | `workers: CI ? 1 : browserWorkerCap()` |
| `tests/perf/playwright.perf.config.ts` | inherited default | `workers: 1`, unconditionally |
| `harness/pool-size.ts` *(new)* | — | the derivation |
| `harness/pool-contention-bench.sh`, `harness/pool-lane-aggregate.sh` *(new)* | — | the two measurement rigs |

The arithmetic, printed by the config on every containerised run:

```
[pool-size] worker cap 2: cgroup quota 6 cores / LANES 3 = 2 workers (host claims 6)
```

`600000/100000 = 6` cores from `/sys/fs/cgroup/cpu.max`, ÷ `LANES=3` = **2
workers per lane**, floored, clamped to `[1, hostParallelism]`. 3 lanes × 2 = the
6 the container has. With no cgroup quota and no `LANES` — a laptop, a GitHub
runner — it resolves to host parallelism and nothing changes at all.

## 2. The brief's diagnosis is right about the bug and wrong about the runner

The brief says both runners size their pool from `os.cpus().length`, which inside
a container reports the host's 16. Measured on this box:

| reading | value |
| --- | --- |
| `os.cpus().length` | 8 |
| `os.availableParallelism()` | 6 |
| cgroup quota (`cpu.max`) | 6 |

`availableParallelism()` **already tracks the cgroup quota** — libuv reads it —
and vitest 2.1.8 sizes from `availableParallelism()` with `os.cpus()` only as a
fallback (`node_modules/vitest/dist/chunks/resolveConfig.*.js`). So vitest was
never reading 16 here. It was reading 6, correctly, and still oversubscribing —
because 6 is the *container's* budget and all three lanes each claimed the whole
of it. **The `÷ LANES` is what does the work; the cgroup read is what keeps the
laptop fallback honest.**

Playwright is the runner that genuinely has the false view: its default is
`os.cpus().length / 2` → **4** workers here, off the 8-core reading, quota
ignored. At the ~2 cores a dpr-3 page needs (this suite's own evidence, quoted in
`playwright.config.ts`), three lanes × 4 workers is **24 cores of demand on a
6-core box**. That is the real 4× oversubscription in the studio, and the mobile
DoD runs in these lanes. It is now `browserWorkerCap()` → **1**.

## 3. Nothing was skipped — the control

The concern with adding a `vitest.config.ts` is that vitest prefers it and does
**not** also read `vite.config.ts`, so a naive file drops the aliases and the
`include` glob and "passes" by running nothing. It merges. Collection is
identical in every arm, capped and uncapped:

| run | workers | files collected | tests |
| --- | --- | --- | --- |
| full suite, capped | 2 | **244** | 4132 |
| full suite, uncapped | 6 | **244** | 4132 |
| spinner arms ×4 | 6 / 2 | **244** each | 4132 each |
| aggregate, 3 shards | 6 / 2 | 82 + 82 + 80 = **244** | 4132 |

244 files and 4132 tests, every time. This is the control the brief asked for,
and it is stronger than a wall-time number: the cap changes how many workers run
the suite and demonstrably not which specs run.

The DoD run on the pushed tree: `npm test -- --run` → **rc=0, 244 files, 4132
tests, 672 s**, taken with the other two lanes live (load 12–27 across the run).

## 4. The measurements

### 4.1 The opportunistic pair — discarded

Two real full-suite runs, taken as the box happened to be:

| arm | workers | wall | load at start | result |
| --- | --- | --- | --- | --- |
| capped | 2 | 574 s | 17.1 | green |
| uncapped | 6 | 214 s | 7.6 | green |

Read literally: the cap made the suite 2.7× slower. It says nothing of the kind —
the other two lanes went quiet in between. This pair measures the afternoon. It
is recorded here only because it is the trap the rest of the work exists to
avoid.

### 4.2 Fixed competing load — a rigged comparison, and why

`harness/pool-contention-bench.sh` supplies the neighbours itself: one spin loop
per worker the other two lanes would spawn.

| arm | own workers | competing | wall | result |
| --- | --- | --- | --- | --- |
| uncapped r1 | 6 | 12 | 604 s | red (tick budget, 44.32 ms vs 33) |
| uncapped r2 | 6 | 12 | 436 s | red (tick budget, 33.18 ms vs 33) |
| capped r1 | 2 | 4 | 970 s | green |
| capped r2 | 2 | 4 | 1075 s | red (tick budget) |

The capped arm looks catastrophic, and the design explains why before any test
runs. Linux splits the box between *runnable threads*:

```
uncapped:  6 own / (6 + 12) = 1/3 of 6 cores = 2 cores
capped:    2 own / (2 +  4) = 1/3 of 6 cores = 2 cores
```

Both arms hand this lane exactly two cores' worth — the comparison is flat by
construction. Worse, spinners **never block**, so a 2-worker lane cannot reclaim
its share when its workers wait on I/O, while a 6-worker lane can. Real
neighbouring lanes block on I/O constantly. This rig is an adversarial model of a
neighbour, not a realistic one, and its numbers should not be used to judge the
cap. Kept because a rig that turned out to measure the wrong thing is worth
recording once so nobody builds it again.

### 4.3 Three real lanes — the measurement that matches the claim

`harness/pool-lane-aggregate.sh`. Three concurrent `vitest --run`, each with a
disjoint third of the suite via `--shard` (so no two runs touch the same spec and
total CPU work is pinned at exactly one suite in both arms). The number is when
the **last** lane finishes — a lane that finishes early has not helped anyone if
the sweep is still blocked on its neighbour. Rep 2 runs the arms in reverse order
to cancel ordering effects.

| arm | workers on 6 cores | all done | result | load start → end |
| --- | --- | --- | --- | --- |
| uncapped r1 | 3 × 6 = **18** | **248 s** | **red ×2** | 27.5 → 25.5 |
| capped r1 | 3 × 2 = **6** | **320 s** | green | 25.5 → 10.2 |
| capped r2 | 3 × 2 = **6** | **252 s** | green | 9.6 → 7.0 |
| uncapped r2 | 3 × 6 = **18** | **131 s** | green | 7.0 → 12.8 |

Both reps agree on direction: **the uncapped pool finishes the same total work
faster** — 248 vs 320 s, and 131 vs 252 s. The capped arm in rep 1 ran on the
*quieter* box of the pair and was still slower, so the direction is not a drift
artifact.

The reds are the other half of the story. Uncapped, on the loaded rep, two
independent wall-clock-budget specs failed:

```
tests/net/capacity/capacity-regression.test.ts
  the loop stays inside the tick budget at 12 rooms
  expected 44.32 to be less than 33

tests/harness/perf.test.ts
  sim frame time ... holds the sim inside its share of a 60 fps frame
  expected 4.3266 to be less than or equal to 4.1667
```

The second is a **60 fps gate** — one of QA's standing targets — failing because
the box was oversubscribed, not because the sim regressed.

Across every contended arm run today:

| | arms | red |
| --- | --- | --- |
| uncapped (6 / lane) | 5 | 3 |
| capped (2 / lane) | 5 | 1 |

## 5. What this actually buys, and the decision it needs

**The premise did not reproduce.** The brief's 85-minute run is the thing this
work was meant to fix. Nothing close to it appeared: the slowest run measured all
day was 1075 s (18 min), and that was under the adversarial spinner load, not
under real lanes. The likeliest explanation is section 2 — vitest was already
quota-aware, so the vitest side was 3× oversubscribed, not 8×. An 85-minute
vitest run needs a cause this investigation did not find; if it recurs, the
suspect is Playwright (24 cores of demand on 6, section 2) or something outside
the test runner entirely.

**The cap is a trade, and it is the opposite of the one the brief predicted:**

- costs ~30–90% aggregate wall time (248→320 s, 131→252 s)
- buys wall-clock-gate stability: 1 red arm in 5 instead of 3 in 5, including a
  60 fps gate that only failed uncapped

The mechanism is not mysterious. This suite is not CPU-saturating per worker —
on a 574 s run, `collect` was 397 s and `prepare` 268 s against 425 s of actual
tests — so extra workers buy real utilisation, right up until the wall-clock
assertions notice the contention.

**Shipped as briefed** (2 workers/lane, derived), because that is what was asked
for, because it is the configuration under which the 60 fps gates hold, and
because the value is one knob, not a rewrite: `LANES` changes it studio-wide and
`VITEST_MAX_WORKERS` overrides it per run. **If the supervisor sweep's throughput
is the thing that matters more than gate stability, this cap makes it worse and
should be raised** — that is a Director call, and it is a one-value change.

The alternative worth naming: leave vitest near its quota-derived default and
keep only the Playwright cap, then fix the wall-clock gates to be load-robust
(measure CPU time, not wall time) rather than buying their stability with
throughput. That is a bigger piece of work and a separate brief.

## 6. Left alone, and why

- **CI's shard plan (a0-00b).** Different axis: it divides work across *machines*,
  this bounds workers *within* one. CI runners have no cgroup quota and no
  `LANES`, so `pool-size.ts` resolves to host parallelism there and CI is
  bit-for-bit unaffected.
- **Other owners' Playwright configs.** Every one was checked rather than
  assumed, and they split three ways:

  | config | owner | `workers` |
  | --- | --- | --- |
  | `tests/live-stage-online/playwright.config.ts` | Gameplay Eng | `1` ✅ |
  | `tests/live-stage/playwright.{build-badge-online,connect-trace,log-download}.config.ts` | Platform Eng | `1` ✅ |
  | `tests/live-stage/playwright.config.ts` | Platform Eng | **unset** ⚠️ |
  | `tests/live-stage/playwright.live-stage.config.ts` | Platform Eng | **unset** ⚠️ |
  | `tests/live/playwright.live.config.ts` | Platform Eng | **unset** ⚠️ |

  The three unset ones inherit `os.cpus().length / 2` = 4 on this box, off the
  quota-blind 8-core reading. `npm run test:live-stage` is a real package script,
  so this is a lane-runnable suite and not a one-off. `fullyParallel: false`
  limits the damage — it serialises files within a project — but it does not cap
  the pool across projects. **Not my files: flagged for the Platform Engineer,
  one line each (`workers: browserWorkerCap()`), not changed here.**
- **The one-off evidence configs** (`playwright.a003`, `playwright.a004`,
  `playwright.isolated`, `evidence/**` bar one) inherit the uncapped default too.
  They are run by hand, one at a time, not by a lane's DoD. Flagged, not changed.
- **`tsconfig.json`.** `vitest.config.ts` is not in its `include` (which names
  `vite.config.ts` explicitly), so `tsc --noEmit` does not typecheck the new
  config. Not QA's file; proposed to the Platform Engineer as a one-word
  follow-up in the PR.
- **`tests/net/capacity/capacity-regression.test.ts`.** Load-flaky by
  construction — it asserts a 33 ms wall-clock tick budget on a shared box. It is
  a symptom throughout this report, never a signal about the change itself.

## 7. Reproducing

```bash
bash harness/pool-lane-aggregate.sh uncapped 6    # 18 workers on 6 cores
bash harness/pool-lane-aggregate.sh capped   2    # 6 workers on 6 cores
bash harness/pool-contention-bench.sh label <own-workers> <spinners>
VITEST_MAX_WORKERS=6 npx vitest --run              # one lane, uncapped
```
