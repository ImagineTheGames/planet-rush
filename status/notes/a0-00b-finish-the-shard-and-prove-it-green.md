# a0-00b — finish the shard: every shard green, and the numbers written down

Branch: `agent/qa/a0-00-shard-mobile-suite` · PR #321 · owner: QA Agent

The state a0-00 left behind: the 4-way split works and the rollup correctly went
red on one bad shard, but the shards are 5 · 12 · 21 · 42 minutes and shard 2
fails on per-test timeouts that sharding cannot fix. This brief finishes both.

---

## BUILT

*(nothing committed yet — see NEXT)*

---

## DECISIONS

### 1 · The measurement, first

Pulled the four shard job logs off run `31249237259` and parsed the `list`
reporter's per-test durations out of them (`[proj] › file:line › title (Ns)`).
That is the only per-test cost data that exists for this suite on the runner,
and it is enough:

- **123 tests actually execute** of the 213 the matrix collects — 90 are
  `test.skip`ped by project (`menu-frame-cost` is iphone-only, `build-flow` skips
  desktop, `goldens` skips pixel). "213 tests" is the number `--shard` divides by,
  and it is not the number that costs anything. That alone explains a lot of the
  spread.
- **126.9 minutes of serial test time**, first attempts only (a retry repeats
  work already counted, and counting it would inflate exactly the specs that are
  the problem).
- Per project: iphone 55.0 m, pixel 52.2 m, desktop 19.7 m.
- The four shards held 18.7 / 80.8 / 39.5 / 5.4 minutes of that. `--shard`
  divides by TEST COUNT, and this suite's tests span 1.4 s to 300 s.

### 2 · Balance by measured duration, at spec-file × project granularity

`playwright.config.ts` sets `fullyParallel: false`, so a spec file on a project
runs serially in one worker. That pair is therefore the smallest unit a
scheduler can actually move — the reason the plan is not finer-grained.

`tests/mobile/shard-plan.ts`: a checked-in measured cost table plus an LPT
(longest-processing-time-first) greedy pack. Deterministic — ties break on the
unit's own name, so every runner computes the identical whole plan and takes its
own slice, and the shards agree by construction rather than by protocol.

Predicted serial spread at N=4: **1901 / 1907 / 1903 / 1905 s — a 6-second
spread**, against the 5/12/21/42-minute spread `--shard` produced.

**Rejected:** sharding by project (`[iphone]` alone is 43% of the time — it
floors the job); optimal bin-packing (LPT is within 4/3−1/(3N) of optimal and
reviewable in four lines); a durations file generated at run time (needs a
warm cache the first PR of the day would not have).

### 3 · The slow specs are round-trip-bound, not compute-bound

Profiled with a step-level Playwright reporter (`onTestEnd` → `result.steps`),
so every `page.evaluate` / `tap` / `waitFor` is timed without touching a spec.

`upgrade-wheel-gantry.spec.ts` on `iphone`, one worker, this container —
249 s across 6 tests, of which:

| API call | count | total |
|---|---|---|
| `page.evaluate` | 100 | **171.9 s** |
| `touchscreen.tap` | 13 | 40.1 s |
| `page.waitForSelector` | 6 | 17.4 s |
| `page.waitForFunction` | 6 | 8.1 s |

The evaluates are trivial — `registered()` finds an id in an array;
`drawnWedges()` reads a getter — and each costs **~2–3 seconds**. Nothing is
computing for 2.5 s. A CDP `Runtime.evaluate` cannot run until the page's main
thread is free, and under the runner's software GL the main thread is busy
painting for very nearly the whole frame. **Every round trip costs about one
frame.** These specs make ~17 of them per test; their fast neighbours make a
handful. That is the whole answer to "why do these cost minutes".

Not, therefore, a spec racing the wall clock (LESSONS §5) — the waits here are
already tick-denominated via `sim-clock.ts`, which is correct and stays.

*(experiments in flight: CI-shaped baseline at 4 cores / 2 workers; and an A/B
on `trace: 'retain-on-failure'`, which records every action on the passing path
too — a second suspect for the per-action cost.)*

---

## NEXT

- Finish the two profiling runs; decide fix vs. scoped follow-up per spec.
- Wire the plan into `playwright.config.ts` + `ci.yml`; contract-test the plan.
- Re-measure, write `tests/reports/mobile-shard-a0-00.md`, pull the WIP marker
  off #321.

No blockers.
