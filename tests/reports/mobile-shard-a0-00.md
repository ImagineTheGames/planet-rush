# Sharding the mobile gate, and why four runners were not four times faster — a0-00 / a0-00b

**QA Agent · branch `agent/qa/a0-00-shard-mobile-suite` · PR #321 · against `main` @ `b32d0a7`**

The mobile emulation suite is the gate that three of the developer's PRs — #298,
#316, #319 — were red behind, and every UI brief queued behind those adds goldens
the runner has to capture inside a budget. a0-00 split the job four ways.
This report is what the split measured, what it did **not** fix, and what was
done about that.

Four sentences of summary, because the rest is arithmetic:

- **The split works, and so does the rollup** — the one red shard correctly took
  the whole PR red (§2a).
- **`--shard` divides by test COUNT, and this suite's tests are nothing like
  uniform**, so the four shards came back at 5 · 12 · 21 · 42 minutes; and the
  four tests that failed did not fail because of sharding and were never going to
  be fixed by it (§3, §4).
- **Three specs were fixed rather than re-budgeted** — a sampling loop priced in
  frames, and two wheel specs' CDP round trips batched. −32%, nothing asserted
  differently, no timeout raised (§5).
- **Then the re-balance broke four goldens that used to pass, and that is the
  most useful thing in this report** (§6). Balancing shards by total work says
  nothing about whether two expensive pages run at the same *instant*; at
  `workers: 2` a unit does not have a cost at all. The suite now runs **one page
  per runner at N=8** (§6b).

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

**The spread, at N=8 and either side of it** — against the refreshed cost table
(run `31258319576`; the numbers below moved when §5's fixes halved two of the
table's largest rows, and again when §6 re-measured everything):

| N | serial seconds per shard | spread |
|---|---|---|
| 2 | 4180 / 4176 | 4 s |
| 3 | 2788 / 2783 / 2785 | 5 s |
| 4 | 2094 / 2085 / 2087 / 2090 | 9 s |
| 5 | 1662 / 1674 / 1661 / 1687 / 1672 | 26 s |
| 6 | 1394 / 1391 / 1388 / 1396 / 1401 / 1386 | 15 s |
| 7 | 1184 / 1213 / 1183 / 1203 / 1194 / 1195 / 1184 | 30 s |
| **8** | **1032 / 1042 / 1058 / 1036 / 1054 / 1038 / 1036 / 1060** | **28 s** |
| 9 | 1032 / 918 / 916 / 917 / 909 / 912 / 914 / 919 / 919 | 123 s |

Against `--shard`'s 325 → 3800 s, that is a **28-second spread instead of a
3475-second one.** N stops at 8 because at 9 the plan stops improving:
`iphone|goldens.spec.ts` — 1032 s, one indivisible brick — becomes the binding
constraint, the makespan flatlines, and every further runner is bought at no
gain. (This section originally shipped N=4 off the pre-fix table, where the
binding brick was `iphone|upgrade-wheel-gantry` at 1338 s. §6b is why N moved.)

`tests/mobile-shard-plan.test.ts` holds this on the cheap vitest job: the union of
the shards is exactly the matrix, nothing is in two of them, the planner is
deterministic, and a spec file with no measured cost is red here rather than a
shard that quietly grew ten minutes. It asserts balance at the N that ships and
at its neighbours, because "it balances at 8" is a weaker claim than it looks.

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

## 6. The second run, and the thing the re-balance broke

The three fixes and the re-balance went to the runner as
[`31258319576`](https://github.com/ImagineTheGames/planet-rush/actions/runs/31258319576).
Half of it is the result §5 predicts, and half of it is this report's most
useful finding, because **the re-balance caused a regression**.

| shard | result | wall |
|---|---|---|
| 1/4 | pass | 16m34s |
| 2/4 | **fail** | **33m00s** |
| 3/4 | **fail** | **24m51s** |
| 4/4 | pass | 13m33s |

**The spec fixes held.** Re-summed from this run's own `list` output, against the
table's pre-fix numbers:

| unit | before | after |
|---|---|---|
| `iphone\|upgrade-wheel-gantry` | 1338 s | **688 s** |
| `iphone\|menu-frame-cost` | 480 s | **186 s** |

**But two shards went red, on two failure modes, neither of them a slow spec.**

**Shard 3 — a fifth spec on the same cliff.** `build-flow.spec.ts:157` (the
full-construction-cycle test) blew its **330 s** budget on `[iphone]`, twice. It
was never on this brief's list of four, it is **untouched by this branch**, and
its 330 s is its own `budgetTest({measuredSeconds: 32})` — nothing raised it.
What makes it evidence rather than just another failure: its `[pixel]` twin
passed the **identical test at 276 s** against the **same** budget. Two copies of
one test, 20% apart, straddling the line.

**Shard 2 — goldens that used to pass.** Four `[iphone]` goldens timed out at
90 s with `Page.captureScreenshot: Internal server error, session closed` — the
session did not merely crawl, it **died**. The same four in run `31249237259`:

| golden | a0-00 run | after the re-balance |
|---|---|---|
| `goldens.spec.ts:295` phone BUILD WHEEL | 40.6 s | **timeout (>90 s)** |
| `goldens.spec.ts:430` phone UPGRADE WHEEL | 34.1 s | **timeout (>90 s)** |
| `goldens.spec.ts:448` PORTRAIT-HELD UPGRADE WHEEL | 20.4 s | **timeout (>90 s)** |

Nothing about those goldens changed. What changed is that a duration-balanced
plan seated `iphone|goldens` next to `pixel|upgrade-wheel-gantry`, the
second-heaviest brick in the suite.

### 6a · Balancing by total work is the wrong objective when units contend

That is the finding, and it indicts §3a's plan rather than the specs:

> LPT balances the **sum** of each shard's work. It says nothing about whether
> two expensive dpr-3 pages are resident **at the same instant** — and at
> `workers: 2` that is the only thing that decides whether a budget holds. So a
> strictly better-balanced plan simply relocated the contention onto a new
> victim, and paid for shard 2's 42 minutes with four goldens that used to pass.

There is a deeper version of the same point. The cost table asserts that a unit
*has* a cost. At `workers: 2` it does not: `build-wheel-gantry:314` cost 300 s on
`[pixel]` and 126 s on the heavier `[iphone]` **in one run**; `build-flow:157`
cost 276 s on one project and >330 s on the other. A scheduler cannot balance
quantities that are properties of the schedule it is producing.

### 6b · What was done: one page per runner, and N instead

`workers: 1` in CI (`playwright.config.ts`), with wall time bought back by
raising N rather than by putting a second page on the same four cores. Four
independent measurements say the contention is the cause, not the specs:

1. **0.28 fps vs 1.5 fps** — frame periods read out of a failure trace's own
   screencast (§4b). One CDP round trip ≈ one frame, so 5× the frame period is
   5× every round trip.
2. **`build-wheel-gantry:314`** — 300 s `[pixel]` / 126 s `[iphone]`, same run.
3. **`build-flow:157`** — >330 s `[iphone]` beside heavy `[pixel]` work, 276 s
   `[pixel]`, against a 32 s in-container measurement.
4. **The four goldens above** — 20–41 s, then dead sessions, with no change to
   the goldens.

**N=8, and that number is derived rather than picked.** Total serial work is
**8355 s**, so an even split at N=8 is **1044 s**; the heaviest *indivisible*
unit — one spec file on one project, which `fullyParallel: false` runs serially
in one worker — is now `iphone|goldens` at **1032 s**. N=8 is therefore the
largest N that still divides evenly. The planner, run across N:

| N | makespan | spread |
|---|---|---|
| 4 | 2094 s (34.9 m) | 9 s |
| 6 | 1401 s (23.4 m) | 15 s |
| **8** | **1060 s (17.7 m)** | **28 s** |
| 9 | 1032 s (17.2 m) | 123 s |
| 10 | 1032 s (17.2 m) | 237 s |

At N=9 the brick binds: the makespan stops falling and the ninth runner buys
12 seconds for a spread that quadruples. N=8 is where the split stops paying.

**17.7 minutes is the worst case, not the estimate.** Those 8355 seconds were
themselves measured at `workers: 2`, so every one of them carries the contention
tax this change removes — the projection assumes relieving contention buys
exactly nothing. It is also why an inflated table is safe to schedule from:
**LPT balances on ratios, so a uniform scale factor cannot change the assignment
it produces.** What breaks a plan is a cost wrong *relative to its neighbours*,
which is what the stale table had become once the three fixes halved two of its
largest rows.

Runner-minutes do not rise: the same total work crosses the same total cores,
minus the tax. What rises is the per-job fixed cost (~2 min of checkout, `npm
ci`, browser install and `npm run build`), paid 8 times instead of 4 — and paid
in parallel, so it costs wall time zero.

### 6c · Still open

- **`tests/mobile/sim-clock.ts` says the runner renders "~1 fps".** Measured at
  0.28 fps under two workers and 1.5 fps under lighter load. Not wrong so much as
  a single point quoted from a wide distribution; it should carry the range, and
  the range is narrower now that `workers: 1` removes the low end.
- **The table should be refreshed once more off a green 8-shard run.** It is
  currently a `workers: 2` snapshot being used to schedule a `workers: 1` suite.
  Harmless for balance (ratios), but the absolute numbers in §6b's arithmetic
  will read high until then. §8 is the procedure.
- **`build-flow.spec.ts` has never had the round-trip audit §5b gave the two
  wheel specs.** It is now the heaviest non-golden unit on `iphone` (570 s) and
  its own comment argues ~45 s of that is irreducible sim advance. The gap
  between 45 s and 570 s is worth someone's afternoon.

> **Follow-up brief: `a0-00c` — the round-trip audit, finished.** Apply §5b's
> batching to `build-flow.spec.ts` and re-measure `iphone|goldens`, the two
> units that now floor the plan at 1032 s. Both are round-trip-bound and neither
> has been profiled. Correct `sim-clock.ts`'s fps claim with the measured range
> while there.

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

### 7a · Retrieved again, off the re-balanced run, and re-measured

Repeated on `playwright-report-shard-3` from run `31258319576` — a different
non-zero shard, a different failure, the current config:

```
$ gh run download 31258319576 --name playwright-report-shard-3
data/  index.html  trace/          9.9M
index.html                         545 KB, self-contained
data/*.zip                         2 traces × 4.2 MB
                                   = 2 attempts × 1 failure (retries: 1)
each trace                         117 entries: test.trace, 0-trace.trace,
                                   0-trace.network, 0-trace.stacks,
                                   110 screencast frames
```

The inspectability holds, and the screencast is a measuring instrument as well
as a picture. Frame timestamps out of the failing `build-flow.spec.ts:157`
trace:

| | median | mean | p90 | max |
|---|---|---|---|---|
| frame period | **3.39 s** | 3.01 s | 3.85 s | 9.08 s |

**0.30 fps** — an independent reproduction of §4b's 0.28 fps, on a different
spec, in a different run, and the direct cause of a test measured at 32 s
in-container spending more than 330 s here. This is the number `workers: 1`
exists to move, and re-running this extraction against a green 8-shard trace is
how a0-00c should check that it did.

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

## Appendix · the N=8 assignment, as shipped

Costs are the refreshed `MEASURED_SECONDS` (run `31258319576`, first attempts
only), in seconds. Spread 28 s across 8 shards.

```
shard 1 — 1032s   iphone|goldens 1032   (+ the four zero-cost pairs: a project
                  that skips a whole file still has to be assigned somewhere)
shard 2 — 1042s   pixel|upgrade-wheel-gantry 918 · desktop|build-wheel-gantry 94 ·
                  desktop|voice-copy-fit 17 · desktop|layout 13
shard 3 — 1058s   iphone|upgrade-wheel-gantry 688 · iphone|emulation 218 ·
                  pixel|centering 152
shard 4 — 1036s   iphone|build-flow 570 · pixel|campaign-door 234 ·
                  iphone|centering 173 · iphone|layout 59
shard 5 — 1054s   iphone|build-wheel-gantry 504 · iphone|campaign-door 254 ·
                  pixel|emulation 185 · pixel|voice-copy-fit 64 · pixel|layout 47
shard 6 — 1038s   pixel|build-wheel-gantry 504 · iphone|slot-state 240 ·
                  iphone|menu-frame-cost 186 · iphone|voice-copy-fit 78 ·
                  desktop|emulation 17 · desktop|landscape-lock 13
shard 7 — 1036s   pixel|build-flow 492 · iphone|landscape-lock 307 ·
                  pixel|slot-state 174 · desktop|centering 63
shard 8 — 1060s   desktop|goldens 421 · desktop|upgrade-wheel-gantry 311 ·
                  pixel|landscape-lock 206 · desktop|campaign-door 68 ·
                  desktop|slot-state 54
```

Shard 1 is the shape of the constraint: `iphone|goldens` is one indivisible
1032 s brick, so its shard carries that and nothing else. That is not a balance
failure, it is the floor — and it is why N stops at 8.

Every shard prints this, and the files it picked up, before it starts a test — a
shard that silently ran the wrong eighth of the suite is the failure mode worth
one line of log.
