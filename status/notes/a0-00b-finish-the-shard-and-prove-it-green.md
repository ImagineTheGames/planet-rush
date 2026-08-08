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

## NEXT

- Local controlled measurement of `build-flow.spec.ts` at `--workers=2` vs
  `--workers=1`, pinned to 4 cores (`taskset -c 0-3`), running now. This is the
  number that decides whether `workers: 1` comes IN scope from `a0-00c`.
- Refresh `MEASURED_SECONDS` off this run's real per-unit costs (parser written;
  3 of 4 shards aggregated, total 5369 s serial, heaviest brick now 688 s not
  1338 s). A halved heaviest brick is what makes a larger N viable.
- Then re-plan N / workers together, push, and watch #321 to zero failing checks.

Known-unrelated: `tests/net/capacity/capacity-regression.test.ts` fails locally
under load (34.6 ms vs a 33 ms budget) and passes both isolated and in CI. Not
this brief's; noted so a future session does not chase it.

No blockers.
