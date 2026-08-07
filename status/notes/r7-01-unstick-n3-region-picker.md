# r7-01-unstick-n3-region-picker.md — working notes (netcode)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT

- **`c3e53b8` — the merge, this time actually committed.** A previous session's
  notes claimed the merge was done; the branch disagreed and the branch wins.
  `git merge-base --is-ancestor 8688880 HEAD` said NO, and there was no merge
  commit in the log — so it was staged-and-lost, never committed. Redone against
  the *current* `origin/main` (`81f5b76`, which had moved on again to pick up
  a2-08's art evidence). Clean, zero conflicts. It touches nothing of mine:
  `git diff HEAD^1 HEAD -- src/net/ server/ allocator/ docs/region-picker.md`
  is empty, and the only `tests/` movement is a3-01's same seven baseline PNGs.

## DECISIONS

### Trust the branch over the notes — the merge had not landed

The previous session's DECISIONS say "Merged `origin/main` anyway". It had not
been committed. This is exactly the case the brief's RESUME line covers, and the
reason the note's own header says a line written here is not evidence. Re-checked
from git rather than from the note, and redid it.

### The q9-01 retry is the real fix for this red, and it is NOT on main yet

`status/notes/q9-01-golden-retry-and-the-31x-runner.md` is QA diagnosing this
exact failure from the other side: a golden that dies on the clock on a loaded
runner, fixed with `GOLDEN_RETRIES = 2` scoped to `goldens.spec.ts`. Their note
records runner slowdown samples of 5.9×, ~21× and ~31× against a `CI_SLOW_FACTOR`
of 10, and argues — correctly — that a retry can turn a *timeout* green and has
no mechanism to turn a *diff* green (a frozen scene is a pure function of the
seeded world, so a real mismatch mismatches on every attempt).

It lives on `agent/qa/q9-golden-retry-31x` and is **not merged**: `GOLDEN_RETRIES`
does not appear in `origin/main:tests/mobile/shot-budget.ts`. So I cannot inherit
it, and I will not reach into `tests/mobile/` to copy it — that is QA's file and
their PR. Named in my PR body as the fix this red is actually waiting on.

### The brief's diagnosis is wrong, and the evidence says so plainly

The brief says PR #305's one red golden — `[iphone] goldens.spec.ts › golden:
landscape phone BUILD WHEEL — the compact copy, at 390 px` — is a stale baseline
being judged against `a3-01`'s new render, and that merging `origin/main` brings
the new baseline with it. **It does not, because there is no new baseline for
that test.** Checked before touching anything:

* `496a215` re-baselined **seven** files. `phone-landscape-build-wheel-iphone-linux.png`
  is **not one of them**. The seven are the two desktop build-wheel frames and
  five frozen-scene frames.
* `git diff --stat HEAD origin/main -- tests/mobile/` → the same seven files, and
  the branch and main carry **identical** bytes for the failing test's baseline.
  The snapshot file set is the same 31 on both sides.

So the merge cannot change what this golden is compared against. The branch being
stale is true and is owed a merge; it is not the cause of this red.

### What the red actually is: the test ran out of clock, and never compared pixels

The CI log's failure line is `Test timeout of 90000ms exceeded.` — not a pixel
mismatch. Two independent confirmations:

1. **No diff images exist.** The run's `playwright-report` artifact contains two
   trace zips and **zero PNGs**. A failed comparison writes actual/expected/diff;
   a test that dies before comparing writes nothing. `tests/mobile/shot-budget.ts`
   predicts exactly this in its header: a golden cut off by the clock "reports a
   *timeout*, with no actual/expected/diff, and the reviewer learns nothing about
   the pixels."
2. **The trace says where the 90 s went.** Decoding `test.trace` from the failed
   attempt, per-action wall clock:

   | action | ms |
   |---|---|
   | `page.goto` | 619 |
   | `page.waitForSelector` | 15,293 |
   | `page.waitForFunction` | 3,881 |
   | `page.evaluate` ×5 (boot + wheel) | 40,347 |
   | **`expect.toHaveScreenshot(phone-landscape-build-wheel.png)`** | **29,834** |
   | (+ fixtures / hooks) | ~940 |
   | **total** | **~90,900 → cut at 90,000** |

   The boot path alone spent ~60 s of a 90 s budget. The shot then got ~30 s of
   its own 45 s entitlement (`GOLDEN_SHOT_TIMEOUT_MS`, sized at the iphone frame)
   before the *test* clock — not the shot clock — killed it. It had not finished
   the stabilisation pair, so it never reached a comparison.

The runner was extraordinarily loaded: **47.4 min** for a suite that
`tests/mobile/budgets.ts` documents at 8.9 min on a runner and 1.5 min in a
container. That is ~5× the modelled runner cost, on top of the 10× the model
already pays (`CI_SLOW_FACTOR`). This test declares `measuredSeconds: 9`, which
buys exactly 90 s — the boot is ~6 s and the shot pair ~3.6 s in-container, so at
a true 10× it lands right on the boundary with nothing spare. It is the most
marginal golden in the matrix and the first to go when a runner is busy.

Corroborating: `a3-01` closed its own DoD as "mobile suite green at **96/0** on a
**quiet box**" (`fe8cfac`) — same 96 tests, same baselines, no failure.

### What I did about it, and what I deliberately did not

* **Merged `origin/main` anyway.** It is a DoD line in its own right
  (`git merge-base --is-ancestor origin/main HEAD`) and the branch was genuinely
  7 behind. It is owed regardless of whether it fixes the golden.
* **Did NOT re-baseline.** The brief forbids it and the evidence independently
  says it would be wrong: there is no pixel disagreement on record to fix, and
  re-shooting from this branch would overwrite `a3-01`'s deliberate colour
  decision with a frame nobody looked at. Zero snapshot files in the diff.
* **Did NOT touch the budget.** `measuredSeconds: 9` is arguably light, but
  `tests/mobile/` is QA's, `budgets.ts` says in terms not to nudge a spec to make
  a flake go away, and the honest reading is that the runner was 5× off-model,
  not that this test's work grew. Raising it here would be a netcode lane editing
  QA's contract to silence someone else's infrastructure problem. Flagged to QA
  in the PR body instead.

## NEXT

<!-- filled in as the runs land -->
