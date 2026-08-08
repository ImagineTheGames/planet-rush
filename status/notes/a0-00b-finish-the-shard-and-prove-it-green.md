# a0-00b — finish the shard: every shard green, and the numbers written down

Branch: `agent/qa/a0-00-shard-mobile-suite` · PR #321 · owner: QA Agent

a0-00 left the 4-way split working and the rollup correctly red, but the shards
were 5 · 12 · 21 · 42 minutes and four tests failed on per-test timeouts that
sharding cannot fix. This brief finishes both.

---

## BUILT

| commit | what |
|---|---|
| `90aa098` | `ci(a0-00b)`: shard by measured duration — `tests/mobile/shard-plan.ts`, wired through `playwright.config.ts` + `ci.yml`, contract-tested by `tests/mobile-shard-plan.test.ts` |
| `3b1375b` | `test(a0-00b)`: `menu-frame-cost.spec.ts` samples a 3 s WINDOW, not 60 frames |
| `2fec14f` | `test(a0-00b)`: CDP round trips batched in the two Gantry wheel specs |
| `b177c23` | `docs(a0-00b)`: this note |
| `3e5521b` | `docs(a0-00b)`: `tests/reports/mobile-shard-a0-00.md` — the deliverable |

PR #321 body rewritten, WIP marker gone, title now names what it does.

**Numbers.** Serial spread `1123 / 3800 / 2364 / 325 s` → `1901 / 1907 / 1903 /
1905 s` (3475 s → **6 s**). The three worst specs, 20 tests, 4 cores / 2 workers:
**20.0 min → 13.6 min (−32%)**, all passing, nothing asserted differently.

---

## DECISIONS

### 1 · Balance at spec-file × project, by LPT

`fullyParallel: false` runs a file's tests serially in one worker, so a
file/project pair is the smallest unit a scheduler can move — the granularity is
forced, not chosen, and it also sets the floor (`iphone|upgrade-wheel-gantry`,
1338 s, one indivisible brick). LPT greedy: four lines, deterministic on the
unit's own name, provably within 4/3−1/(3N) of optimal.

Every shard computes the whole plan and takes its own slice, so the runners agree
by construction. The file list comes off **disk**, not off the cost table, so a
new spec always runs somewhere.

**Rejected:** sharding by project (`[iphone]` is 43% of the time — it floors the
job); optimal bin-packing (LPT is within 25% of optimal at N=4 and reviewable);
generating durations at run time (needs a warm cache the first PR of the day
would not have). **N stays at 4** — past N=5 the heaviest brick binds.

### 2 · The slow specs are round-trip-bound, and the trace proves it

Step-level profiling: `page.evaluate` was 172 of 249 s across 100 calls that each
read a getter — **~1.7 s a call**, computing nothing. A CDP evaluate waits for the
page's main thread, which under software GL is painting for nearly the whole
frame, so **one round trip ≈ one frame**.

The clinching number came out of the failure artifact itself: screencast frame
gaps in the traces are **3.3–3.7 s** on the timed-out wheel tests against
**0.66 s** on a test with the runner more to itself. ~0.28 fps, not the ~1 fps
`sim-clock.ts` assumes.

**Rejected as causes, by measurement:** racing the wall clock (the wheel specs
already settle on `waitForSimTicks`, correctly, and that stays); CPU throughput
(8 → 4 cores barely moved wall time — latency-bound, not throughput-bound);
`trace: 'retain-on-failure'` (turning it off on half the cores was no faster, so
it stays and is what made §7 of the report possible).

### 3 · Fix the specs; do not touch the budgets

No timeout raised, nothing skipped, nothing moved out of the gate.
`menu-frame-cost` was the real wall-clock bug in disguise — 60 frames per sample
is 40 s of wall clock at 0.66 s/frame, so it paid the cost it measures. Now a
fixed ~3 s window with a nine-frame floor; same median rAF delta, same ratio,
same `MAX_RATIO = 4` against a 14× regression.

### 4 · `workers: 1` scoped OUT, as a named follow-up

`workers: 2` on a 4-core runner puts two dpr-3 software-GL pages on the same
cores; the `[pixel]` copy of `build-wheel-gantry:314` timed out at 300 s while the
**heavier** `[iphone]` copy passed at 126 s in the same run. Almost certainly a
contention artifact, and `workers: 1 × N=8` is probably better on both axes — but
it wants its own measurement rather than a guess bundled into this PR.
Scoped as **`a0-00c` — one page per runner** (report §6).

---

## SESSION 2 (2026-08-08) — run `31258319576`, and what it changed

**The three spec fixes worked.** Re-summed off this run's own `list` output, the
units this brief attacked came back roughly halved against the table:

| unit | table (pre-fix) | measured now |
|---|---|---|
| `iphone\|upgrade-wheel-gantry` | 1338 s | **688 s** |
| `iphone\|menu-frame-cost` | 480 s | **186 s** |
| `pixel\|build-wheel-gantry` | 552 s | **504 s** |

**But the run is red, on a spec that was never on the list.** Shard 3:
`build-flow.spec.ts:157` `[iphone]` — the full-construction-cycle test — blew its
**330 s** budget twice (initial + retry #1) and took the shard to 24m51s. Shard 1
16m34s pass, shard 4 13m33s pass, shard 2 still running past 35 m.

Two things matter about that failure and neither is "raise the budget":

1. `build-flow.spec.ts` is **untouched by this branch** and its 330 s comes from
   its own `budgetTest({measuredSeconds: 32})` — pre-existing, not raised here.
2. It is the **same root cause as the four**, now on a fifth spec. Its `[pixel]`
   twin passed the identical test at **276 s** against the same 330 s budget —
   i.e. both projects sit within ~15% of the cliff, and which side they land on
   is decided by what shares the runner.

**The contention evidence got stronger.** In shard 3 the failing `[iphone]`
`build-flow:157` ran concurrently with the heavy `[pixel] build-wheel-gantry`
tests, while the *same file's* other test (`:266`) passed at 4.0 m alongside
light `emulation.spec.ts` work. That is Decision §4's `[pixel]`/`[iphone]`
inversion reproduced on an independent spec — two dpr-3 software-GL pages on
4 cores starve each other's main thread, and every CDP round trip costs a frame.

**Shard 2 was red too** — four `[iphone]` goldens dead at 90 s with
`Page.captureScreenshot: Internal server error, session closed`. Checked against
run `31249237259`: **the same four passed there at 40.6 / 34.1 / 20.4 s.** The
goldens did not change. What changed is that MY re-balance seated
`iphone|goldens` beside `pixel|upgrade-wheel-gantry`, the second-heaviest brick.
That is the finding of the whole brief and it indicts the plan, not the specs:
LPT balances the SUM of a shard's work and says nothing about whether two
expensive dpr-3 pages are resident at the same INSTANT.

## BUILT — session 2

| commit | what |
|---|---|
| `86f57e9` | `docs`: the session-2 note |
| `0ce1f1a` | `ci`: **`workers: 1` in CI, N=4 → 8, `MEASURED_SECONDS` refreshed off run 31258319576** |
| `7559e04` | `docs`: report §6 — the regression, the four measurements, the N table; §3a + appendix re-derived |

## DECISIONS — session 2

### 5 · `workers: 1` came IN scope, and the evidence is why

Session 1 scoped it OUT as `a0-00c` because it "wants its own measurement rather
than a guess." It now has four, all off the runner: the 0.28 vs 1.5 fps trace
reading; `build-wheel-gantry:314` at 300 s `[pixel]` / 126 s `[iphone]` in one
run; `build-flow:157` at >330 s / 276 s across projects against a 32 s
in-container measurement; and the four goldens above. That is no longer a guess,
and the DoD gates on green — the contention IS the thing blocking it.

**Rejected: a local A/B** (`taskset -c 0-3`, `--workers=2` vs `1`). Started it,
then threw the arm away: `pgrep` showed another lane's vitest and a `vite
preview` on the same box and on **port 4173**, which this config also uses with
`reuseExistingServer` — the a0-06 note's trap verbatim. A contended 8-core box
cannot measure contention, and the real runner answers it in one push.

### 6 · N=8 is derived, not picked

Total serial 8355 s → even split 1044 s; heaviest indivisible brick
(`iphone|goldens`) 1032 s. So 8 is the LARGEST N that still divides evenly — at
N=9 the makespan flatlines at 1032 s and the spread goes 28 s → 123 s. Verified
by running the planner across N=2…9, table in report §3a.

### 7 · An inflated cost table is safe, and this is why it did not need re-measuring first

The 8355 s were measured at `workers: 2`, so they carry the tax the change
removes. That is fine: **LPT balances on RATIOS, so a uniform scale factor cannot
change the assignment.** What breaks a plan is a cost wrong *relative to its
neighbours* — exactly what the stale table had become once §5's fixes halved two
of its biggest rows. It also makes 17.7 min/shard the WORST case.

### 8 · IT WENT GREEN — run `31259840319`, 8/8 shards, rollup green

123 executed tests, **0 failures, 0 retries**. **The gate: 42m04s red → 12m19s
green.** `build-flow:157` cost **126 s** against the >330 s it was timing out at;
all four dying `[iphone]` goldens passed. Nothing skipped, no budget raised.
`workers: 1` was the whole fix — `pixel|upgrade-wheel-gantry` 918 s → **190 s**.

### 9 · …and then the numbers said N=6. My own §7 was wrong.

§7 argued a contention tax is harmless because LPT balances on RATIOS, so a
**uniform** scale factor cannot change an assignment. True, and it does not
apply: the tax was **not uniform** — 4.8× on `pixel|upgrade-wheel-gantry`, 1.4×
on `iphone|upgrade-wheel-gantry`, because it falls hardest on exactly the
round-trip-bound specs (the ones priced in frames). It **reordered** the table
rather than rescaling it. Hence shards 5m01s…12m19s against a plan predicting
eight equal lanes: shard 2 was sized by a 918 s unit that really costs 190 s.

Re-cut the table off the green run (total serial 8355 → **3838 s**, brick
`iphone|goldens` **659 s**) and N drops **8 → 6**: N=7 and N=8 give the SAME
11.0 min makespan and only widen the spread (26 → 136 → 214 s). Commit `8f48799`.

**The transferable bit, now written into `MEASURED_SECONDS` and report §8:** a
cost table is a statement about a suite AND the machine config that runs it.
Re-measure when the config changes, not only when the specs do.

### 10 · N=6 shipped and green — run `31260614369`

**6/6 shards green, rollup green, 123 tests, 0 failures, 0 retries.** Job walls
10m32s…13m55s, spread **3m23s** (was 7m18s at N=8 on the stale table). Total
serial 3977 s against the table's 3838 s (**+3.6%**) and the brick at 663 s vs
659 s — the table predicts the runner well.

Stated in report §6e rather than buried: **N=6 is not strictly faster than N=8**
(13m55s vs 12m19s). It trades ~1.5 min of gate latency for two runners at the
same runner-minutes. Splitting the golden brick (`a0-00c`) is the thing that
would actually make a larger N pay.

PR #321 title + body rewritten to what shipped; no WIP marker, not a draft.

### 11 · #321 MERGED mid-flight — and two DoD gates went red because of it

**#321 merged at `caa24d5`, 14:09:45, green.** The substance of the brief is in
`main`. But it merged **one commit before** `bb3396d` (report §6e — the measured
numbers for the N=6 config that is what actually ships), and that broke the DoD:

- gate 4 (`gh pr list --head … .[0].number`) lists **OPEN** PRs only → empty →
  `test -n "$n"` fails. A merged PR does not satisfy it.
- gate 5 (`merge-base --is-ancestor origin/main HEAD`) → `main` moved past me
  (my own merge, plus #316 and a style-guide commit) → fails.

**Fix, in order:** merged `origin/main` back in (`9557198`, clean — main already
contained my sharding work, so the only delta was the §6e docs), then opened
**PR #322** for the remaining commit. Gate 4 now resolves to 322, gate 5 passes.

**Trap worth naming:** on this team a PR can be merged out from under you the
moment its checks go green. Push the *evidence* commit before or with the change
it describes — do not leave the report trailing the config by one commit, or the
merge lands the code and strands the numbers.

## NEXT

- **Watch PR #322's checks to zero failing.** That is the last gate. Everything
  else is verified: `tsc` clean on the merged tree · report tracked ·
  `origin/main` is an ancestor again · the shipped config (N=6, `workers: 1`,
  659 s table) confirmed intact after the merge.
- `npm test -- --run` on the merged tree: **3973/3973 passed, 237 files** — one
  earlier run had shown `1 failed / 3972` and both re-runs were clean, i.e. the
  load-flaky perf test again (see the trap below), not a regression.
- `a0-00c` re-scoped: **split the `iphone|goldens` brick.** At 659 s it is the
  only thing flooring the gate; splitting the file buys N=8 at ~480 s (~8 min).
  Also correct `sim-clock.ts`'s "~1 fps" with the measured 0.28–1.5 range.

### Trap for a future you

`npx tsc --noEmit` and `npm test` share this box with other lanes. The perf
tests (`capacity-regression`, and the live-stage suite) fail under that load and
pass isolated — check `pgrep -fa vitest|playwright|vite` before believing one.
Do NOT measure contention on this box for the same reason: the local
`workers: 1` vs `2` A/B was started and thrown away (DECISIONS §5). The real
runner answers it in one push, and one push is ~13 minutes now.

Known-unrelated: `tests/net/capacity/capacity-regression.test.ts` fails locally
under load (34.6 ms vs a 33 ms budget) and passes both isolated and in CI. Not
this brief's; noted so a future session does not chase it.

No blockers.
