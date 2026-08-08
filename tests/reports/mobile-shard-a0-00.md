# Sharding the mobile gate, and why four runners were not four times faster — a0-00 / a0-00b

**QA Agent · branch `agent/qa/a0-00-shard-mobile-suite` · PR #321 · against `main` @ `b32d0a7`**

The mobile emulation suite is the gate that three of the developer's PRs — #298,
#316, #319 — were red behind, and every UI brief queued behind those adds goldens
the runner has to capture inside a budget. a0-00 split the job four ways.
This report is what the split measured, what it did **not** fix, and what was
done about that.

Two sentences of summary, because the rest is arithmetic:

- **The split works, and so does the rollup** — four runners, one required check,
  and the one red shard correctly took the whole PR red.
- **`--shard` divides by test COUNT, and this suite's tests are nothing like
  uniform**, so the four shards came back at 5 · 12 · 21 · 42 minutes; and the
  four tests that failed did not fail because of sharding and were never going to
  be fixed by it.

Sibling reports: `mobile-journey-budgets-q7.md` (a budget per test),
`golden-diffs-and-highdpi-settle-q8.md` (a budget per golden comparison, and the
artifact that makes a failure inspectable), `golden-retry-and-the-31x-runner-q9.md`
(the runner's slowdown distribution).

---

## 1. Before: one job, and what it cost

One `Mobile emulation (Playwright)` job, `workers: 2`, ~60–77 minutes on every
pull request, paid twice whenever a timeout forced a re-run.

## 2. After the a0-00 split: the four shards, measured

Run [`31249237259`](https://github.com/ImagineTheGames/planet-rush/actions/runs/31249237259),
`--shard=i/4`:

| shard | result | wall | executed tests | serial test time |
|---|---|---|---|---|
| 1/4 | pass | 12m08s | 39 | 18.7 min |
| 2/4 | **fail** | **42m04s** | 30 | 63.3 min* |
| 3/4 | pass | 21m07s | 41 | 39.5 min |
| 4/4 | pass | 5m16s | 13 | 5.4 min |

\* first attempts only; shard 2 also paid four retries, three of them 300 s each.

**Against a 60–90 minute single job that is the promised improvement**, and the
whole gate now costs one runner's 42 minutes instead of one runner's 70. The
sum of the parts is ~127 minutes of serial test time — more than the old job's
wall clock, because two workers were already overlapping it.

### 2a · The rollup went red, and that is the proof the brief asked for

It was obtained by accident, and it counts. `mobile-gate` keeps the single-job
check's exact name, so the repository's required-check setting resolves without
being re-pointed, and it is red unless `needs.mobile.result` — the matrix
**aggregate** — is `success`. One shard failed; the aggregate was `failure`; the
required check went red; the PR was blocked. The `!cancelled()` guard did its job
too: the rollup ran rather than reporting SKIPPED, which a merge gate reads as
"not red" and is the exact hole the guard exists to close.

The three green shards were not cancelled either (`fail-fast: false`), so one pass
produced the **whole** failure list rather than the first item on it.

## 3. Problem one: `--shard` counts tests, and tests are not the cost

Two facts kill the count-based split:

- **90 of the 213 collected tests never execute.** They are `test.skip`ped by
  project — `menu-frame-cost` is iphone-only, `build-flow` skips desktop,
  `goldens` skips pixel. `--shard` divides all 213; only 123 cost anything.
- **The 123 that do execute span 1.4 s to 300 s.** The heaviest single spec-file
  /project pair costs more than the whole of the lightest shard.

Serial test time as `--shard` distributed it: **1123 / 3800 / 2364 / 325 seconds.**
Per project it is 55.0 min iphone, 52.2 min pixel, 19.7 min desktop — which is
also why sharding **by project** is not the answer: `[iphone]` alone is 43% of the
suite and would floor the gate at ~34 minutes however many runners it got.

### 3a · The fix: divide by measured duration

`tests/mobile/shard-plan.ts`. A checked-in table of measured costs, and a
longest-processing-time-first greedy pack over it.

**The unit is a spec file on a project, and that is forced, not chosen.**
`playwright.config.ts` sets `fullyParallel: false`, so every test in one file runs
serially in one worker: a file/project pair is the smallest thing a scheduler can
move. That also sets the floor — no shard count can beat the heaviest single
brick, which is why the report quotes it alongside the spread.

Deterministic by construction: ties break on the unit's own name, so every shard
computes the identical whole plan and takes its own slice. The shards never have
to agree at run time; they agree before it. The file list is read off **disk**
rather than off the cost table, so a spec added and never measured still runs.

**The spread, at N=4 and either side of it:**

| N | serial seconds per shard | spread |
|---|---|---|
| 2 | 3804 / 3812 | 8 s |
| 3 | 2538 / 2541 / 2537 | 4 s |
| **4** | **1901 / 1907 / 1903 / 1905** | **6 s** |
| 5 | 1513 / 1511 / 1536 / 1516 / 1540 | 29 s |
| 6 | 1338 / 1250 / 1263 / 1259 / 1255 / 1251 | 88 s |
| 8 | 1338 / 918 / 894 / 898 / 892 / 900 / 885 / 891 | 453 s |

Against `--shard`'s 325 → 3800 s, that is a **6-second spread instead of a
3475-second one.** N stays at 4: past N=5 the plan stops improving because
`iphone|upgrade-wheel-gantry.spec.ts` — 1338 s, one indivisible brick — becomes
the binding constraint, and every further runner is bought at no gain.

`tests/mobile-shard-plan.test.ts` holds this on the cheap vitest job: the union of
the shards is exactly the matrix (61 + 60 + 62 + 30 = 213), nothing is in two of
them, the planner is deterministic, and a spec file with no measured cost is red
here rather than a shard that quietly grew ten minutes.

## 4. Problem two: four tests that sharding was never going to fix

**Splitting a queue does not make one item in it faster.** Exactly four tests
failed, every one of them a **timeout, not a screenshot mismatch**:

| test | project | budget | attempts |
|---|---|---|---|
| `menu-frame-cost.spec.ts:164` — the static title screen | iphone | 150 s | timed out ×2 |
| `upgrade-wheel-gantry.spec.ts:375` — a maxed track quotes MAX | iphone | 300 s | timed out ×2 |
| `upgrade-wheel-gantry.spec.ts:417` — a real press on WEAPON | iphone | 300 s | timed out ×2 |
| `build-wheel-gantry.spec.ts:314` — a capped press is refused | pixel | 300 s | timed out ×2 |

*(The brief's "20 specs blew a 300-second budget" reads high; the artifact in §7
lists four failures, three at 300 s and one at 150 s. `menu-frame-cost.spec.ts:227`
did not fail but finished at 330 s against a 330 s budget, so it belongs on this
list in every sense except its outcome.)*

They are not on the list because they assert more than their neighbours. They are
on it because of **how they talk to the page**.

### 4a · Where the time goes, measured

Profiled with a step-level Playwright reporter (`onTestEnd` → `result.steps`), so
every API call is timed without touching a spec. `upgrade-wheel-gantry.spec.ts` on
`iphone`, one worker, studio container — 249 s across six tests:

| API call | count | total | per call |
|---|---|---|---|
| `page.evaluate` | 100 | **171.9 s** | **~1.7 s** |
| `touchscreen.tap` | 13 | 40.1 s | ~3.1 s |
| `page.waitForSelector` | 6 | 17.4 s | ~2.9 s |
| `page.waitForFunction` | 6 | 8.1 s | ~1.4 s |
| `page.goto` | 6 | 1.3 s | ~0.2 s |

Those evaluates read a getter or find an id in an array. **Nothing is computing
for 1.7 seconds.** A CDP `Runtime.evaluate` cannot run until the page's main
thread yields, and under software GL the main thread is painting for very nearly
the whole frame. **One round trip costs about one frame.** These specs make ~17 of
them per test; the neighbours that finish in seconds make a handful.

### 4b · And how slow a frame actually is, off the failure's own trace

The clinching number is inside the artifact of §7. Playwright's trace records a
screencast frame per rendered frame, so the **gaps between them are the page's
real frame period on the runner**:

| trace | median gap between screencast frames | test |
|---|---|---|
| 6 wheel-spec traces | **3.30 – 3.71 s** | the three timed-out wheel tests, both attempts |
| 2 menu-frame-cost traces | **0.66 – 0.68 s** | `menu-frame-cost.spec.ts:164`, both attempts |

The 0.66 s figure is what bounds the claim: whatever throttle the screencast has,
it is not slower than that, so **3.5 s between frames is the page genuinely
rendering at ~0.28 fps** — not the ~1 fps this suite's own notes assume
(`tests/mobile/sim-clock.ts`). At 0.28 fps a spec making 25 crossings spends over
a minute doing nothing but waiting for the main thread to answer the phone.

### 4c · Not the wall clock, and not the CPU

Two candidate explanations were tested and rejected:

- **"A spec that waits on real time rather than sim ticks" (LESSONS §5).** Not
  these. Every settle in the wheel specs already goes through
  `waitForSimTicks()`, which counts the sim's own fixed steps. That is correct and
  it stays. *(The exception is §5a below, which is genuinely this bug — in a form
  the lesson does not name.)*
- **CPU starvation alone.** Halving the cores available to a run (8 → 4) barely
  moved its wall time — 6.5 min → 6.0 min for the same file, the second run also
  having tracing off. The work is **latency-bound, not throughput-bound**, so the
  number of crossings is the lever, not the clock speed.

`trace: 'retain-on-failure'` was also measured as a suspect and cleared: turning
it off on half the cores was no slower than leaving it on with all of them. It
stays, because it is what makes §7 possible.

## 5. What was done about each of the four

**No timeout was raised, nothing was skipped, and nothing left the PR gate.**

### 5a · `menu-frame-cost.spec.ts` — a sampling loop priced in frames

This one *is* the wall-clock bug, wearing a disguise. `medianFrameMs()` sampled a
flat **60 frames**. That is a fixed amount of work only on a host where a frame
costs what a frame should cost — and at the 0.66 s/frame measured in §4b, "60
frames" means **40 seconds of wall clock per sample**. The title test takes two
samples; the three-screen test takes four. A spec that measures frame cost, priced
in frames, pays the very cost it is measuring: the worse the runner, the longer it
runs, without ever asserting anything more.

Now it samples a fixed **~3 second window** and takes the median of whatever
frames arrive, with a nine-frame floor so a median stays honest on a host too slow
to fill the window (and so the worst case is ~9 s a sample, not ~60).

The assertion does not move: still the median rAF delta, still a ratio against a
match sampled the same way in the same page, still `MAX_RATIO = 4` against a
regression that was 14×. Nine samples resolve 14× with room to spare.

**Measured, studio container, 4 cores / 2 workers, the same shape as CI:**

| test | before | after |
|---|---|---|
| `:164` the static title screen | 78 s | **31.8 s** |
| `:227` THE DOORS / THE LOBBY / THE CODEX | 180 s | **66 s** |

**−59% and −63%**, and `:164` now has five times its measured cost as headroom
instead of falling off the end of it.

### 5b · The two Gantry wheel specs — round trips, batched

Every crossing that could be merged into a neighbour was:

- the BUILD button's centre is computed **in the page**, in the same call that
  reads the logical viewport it needs;
- `pressWedge` finds the wheel and applies the client transform in one call —
  which is also strictly more correct, because the rect the angle is measured from
  and the transform applied to it are now guaranteed to be the same frame's;
- `openBuildForReal` hands its rect back instead of the caller re-reading it;
- `pressAt` no longer settles on its own, because every caller settled again on
  top of it — the wait is the caller's alone, and is always still there;
- the wheels' bounds, the wedges and the bank come off **one** frame via
  `drawnState()`, so they can no longer disagree with each other by a frame
  either.

Not one assertion moved. Same seams, same values, same real synthesized events on
the canvas, same budgets.

**Measured, same shape:**

| test | before | after |
|---|---|---|
| `upgrade-wheel` a maxed track quotes MAX (was `:375`) | 120 s | **96 s** |
| `upgrade-wheel` a real press on WEAPON (was `:417`) | 138 s | **114 s** |
| `upgrade-wheel` every wedge is a thumb target (was `:469`) | 66 s | **51 s** |
| `build-wheel` a capped press is refused, iphone (was `:314`) | 126 s | **114 s** |
| `build-wheel` PORTRAIT-HELD (was `:372`) | 90 s | **52 s** |

**−10% to −42%, ~20% typical.** Honest reading: this is a real improvement and it
is **smaller than the menu-frame-cost one**, because what remains after the merge
is a journey that genuinely has to cross the wire twenty-odd times — boot, press,
settle, read, press, settle, read. See §6 for the part that is not finished.

### 5c · The three specs together, same run, same shape

All twenty executed tests of the three specs on `iphone` + `pixel`, 4 cores,
2 workers — the closest reproduction of a CI shard available off the runner:

| spec file | before | after |
|---|---|---|
| `[iphone] upgrade-wheel-gantry` | 9.9 min | **7.7 min** |
| `[pixel] upgrade-wheel-gantry` | 8.6 min | **5.1 min** |
| `[pixel] build-wheel-gantry` | 4.6 min | **3.7 min** |
| `[iphone] menu-frame-cost` | 4.3 min | **1.6 min** |
| **whole run, 20 tests** | **20.0 min** | **13.6 min** |

**−32% on the three specs that were killing the gate**, all twenty passing, with
no assertion, budget, baseline or tolerance changed.

## 6. What is NOT finished, and the follow-up it deserves

**The four failures are addressed by three different mechanisms** — the sampling
window (large, certain), the round-trip batching (~20%, certain), and the
re-balance (removes the pile-up that starved shard 2, effect real but not
independently measurable). Whether that is enough margin on a runner whose
slowdown distribution has a 31× tail (`golden-retry-and-the-31x-runner-q9.md`) is
answered by this PR's own checks, not by this paragraph.

What the profiling turned up and this brief did not spend:

**`workers: 2` is very likely the wrong setting for a software-GL runner.**
Playwright defaults to `cpus / 2`, which is 2 on a 4-core GitHub runner, so two
dpr-3 pages rasterise in software on the same four cores. §4b measured what that
costs: the wheel tests' pages ran at **0.28 fps** while a test with the runner more
to itself got **1.5 fps** — a 5× difference in the quantity every round trip is
priced in. The `[pixel]` copy of `build-wheel-gantry.spec.ts:314` timing out at
300 s while the *heavier* `[iphone]` copy passed at 126 s **in the same run** is
that effect and not a property of either test.

If that holds, `workers: 1` with a larger N is strictly better on both axes: each
lane runs ~1.65× faster (measured, 4 cores) for the same total lane count, and the
per-test timeouts stop being contention artifacts. It is a config change, it is
cheap, and it wants its own measurement rather than a guess bundled into this PR.

> **Follow-up brief: `a0-00c` — one page per runner.** Measure the mobile suite at
> `workers: 1 × N=8` against `workers: 2 × N=4` on the real runner: wall time,
> runner-minutes, and per-test duration against budget. Ship whichever wins. The
> hypothesis, and the numbers it comes from, are §4b and §6 above.

Two smaller things, named so they are not rediscovered:

- **`tests/mobile/sim-clock.ts` says the runner renders "~1 fps".** Measured here
  at 0.28 fps under two workers and 1.5 fps under lighter load. The doc is not
  wrong so much as it quotes a single point on a wide distribution; a0-00c should
  correct it with the range.
- **The cost table in `shard-plan.ts` still holds the PRE-fix numbers**, including
  the 300 s timeouts. That is conservative rather than wrong — it keeps the heavy
  file isolated on its own shard — but it should be refreshed off the first green
  four-shard run. §8 is the procedure.

## 7. The failure artifact, retrieved from a non-zero shard

The brief asks for proof that q8-01's inspectability survived the split. It did.
`playwright-report-shard-2` from run `31249237259`, downloaded and opened cold:

```
$ gh run download 31249237259 --name playwright-report-shard-2
$ ls
data/  index.html  trace/
$ du -sh .
29M
```

- **`index.html` is self-contained** — 565 KB with the report inlined as a base64
  zip, so the downloaded artifact opens by double-clicking it. No server, no
  `npx playwright show-report`.
- **Every failed attempt carries its trace.** Eight trace zips in `data/`,
  3.6 MB each: two attempts × four failures, exactly as `retries: 1` and
  `trace: 'retain-on-failure'` promise.
- **The traces are real traces** — `test.trace`, `0-trace.network`, the page
  resources, and ~100 screencast JPEGs per trace, which is what §4b's frame-period
  measurement was taken from. A reviewer gets the same picture a single-job run
  gave them.
- Reading the report back names all four failures, their project, their attempt
  count and their per-attempt duration (300612 / 300778 ms, etc.).

Per-shard artifact naming (`playwright-report-shard-${{ matrix.shard }}`) is what
makes this work: `upload-artifact@v4` errors on same-name uploads from parallel
jobs, so without it the shards would have raced.

There are **no** actual/expected/diff PNGs in this artifact, and that is correct
rather than a gap: all four failures are timeouts, so no frame was ever captured
to compare. No baseline is in question.

## 8. Re-measuring the cost table

The table is a snapshot and snapshots go stale. `tests/mobile-shard-plan.test.ts`
catches the loud failure (a spec with no row at all); this is the procedure for
the quiet one (a row that has drifted).

1. Take a **green** four-shard run and download each shard job's log:
   `gh run view --log --job <id>`.
2. The `list` reporter prints one line per test:
   `[project] › file:line › title (Ns)`. Parse those, dropping any line marked
   `(retry #N)` — a retry repeats work already counted, and counting it inflates
   exactly the specs that are already the problem.
3. Sum per `project|file`, round to whole seconds, and replace
   `MEASURED_SECONDS`. A pair that executed zero tests is `0`, not absent — the
   difference is what tells "skipped here" apart from "never measured".
4. `npx vitest run tests/mobile-shard-plan.test.ts` and paste the new spread into
   §3a's table.

---

## Appendix · the N=4 assignment, as shipped

```
shard 1 — 1901s   iphone|upgrade-wheel-gantry 1338 · iphone|slot-state 213 ·
                  desktop|centering 114 · iphone|landscape-lock 98 ·
                  iphone|voice-copy-fit 77 · pixel|voice-copy-fit 61
shard 2 — 1907s   pixel|upgrade-wheel-gantry 918 · iphone|goldens 363 ·
                  iphone|build-wheel-gantry 221 · pixel|centering 182 ·
                  iphone|campaign-door 93 · iphone|layout 67 ·
                  desktop|slot-state 53 · desktop|layout 10
shard 3 — 1903s   pixel|build-wheel-gantry 552 · desktop|goldens 444 ·
                  pixel|landscape-lock 261 · desktop|upgrade-wheel-gantry 226 ·
                  iphone|build-flow 204 · pixel|emulation 88 ·
                  iphone|emulation 68 · desktop|campaign-door 60
shard 4 — 1905s   pixel|build-flow 546 · iphone|menu-frame-cost 480 ·
                  pixel|campaign-door 259 · desktop|build-wheel-gantry 216 ·
                  pixel|slot-state 204 · iphone|centering 77 · pixel|layout 65 ·
                  desktop|voice-copy-fit 23 · desktop|emulation 21 ·
                  desktop|landscape-lock 14
```

Every shard prints this, and the files it picked up, before it starts a test — a
shard that silently ran the wrong quarter of the suite is the failure mode worth
one line of log.
