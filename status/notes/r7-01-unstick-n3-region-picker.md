# r7-01-unstick-n3-region-picker.md — working notes (netcode)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT

- **The second merge — `origin/main` had moved again, and this time it carried
  the actual fix.** Between sessions main went `81f5b76 → d2797dc`, merging
  PR #311 from `agent/qa/q9-golden-retry-31x`. That is the *exact* branch the
  previous session named as holding the real fix for this red and could not
  inherit. It is now inherited: `GOLDEN_RETRIES = 2` is in the tree
  (`tests/mobile/shot-budget.ts:279`, applied at `goldens.spec.ts:42` via
  `test.describe.configure({ retries: GOLDEN_RETRIES })`), together with q9-01's
  re-fitted capture intercept (550 → 600 ms). Clean merge, zero conflicts, and
  it touches nothing of mine — `git diff HEAD^1 HEAD -- src/net/ server/ docs/`
  is empty. Its whole footprint is six QA-owned files under `tests/`.

- **`c3e53b8` — the first merge, this time actually committed.** A previous session's
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

### The q9-01 retry is the real fix for this red — and it LANDED (was: not on main)

**Superseded, in my favour.** Everything below was written when
`agent/qa/q9-golden-retry-31x` was unmerged. It merged as `d2797dc`
(PR #311) and this session's merge inherited it. The prediction the previous
session made — that this red is a clock failure whose fix is QA's retry, not a
baseline I could shoot — is now testable rather than argued, and the discipline
of *not* reaching into `tests/mobile/` to copy the fix is what let it arrive
cleanly through main instead of as a conflicting duplicate. Kept verbatim below
because the reasoning is what made waiting the right call.

---



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

### `npm test -- --run` is now FULLY GREEN — and that confirms the load diagnosis

Post-merge, on a quiet box: **233 files, 3829/3829 passed, 218.89s.** The
capacity-regression test that was red twice last session passed without a single
character changing in it.

That is the cleanest possible confirmation of the call recorded below. Last
session measured `maxLagMs` at 56.96 on this branch and 114.66 on clean `main`,
at load average 31–50 on 8 cores. This session's run started at load average
**~8** and the same assertion — `expect(maxLagMs).toBeLessThan(33)` — passed.
Same code, same gate, different box load, opposite result. The number was
tracking the host, exactly as argued.

**This vindicates not touching it, and it does not retract the bug.** The gate is
still an absolute lag gate on a host whose own design notes (`m11-01`) say lag is
not a capacity reading there — it will go red again the next time a neighbouring
lane loads the box, and a genuine 2× regression on a quiet runner would look
identical to today's green. Had I "fixed" it last session by loosening the
threshold, I would have permanently weakened a real capacity gate to silence a
symptom that resolved itself in forty minutes. The inconsistency is still worth
its own brief with re-measurement; it is no longer blocking anything.

The original reasoning, from when it was red:

---

### (was) `npm test -- --run` has one red, it is MAIN's, and I am not fixing it under this brief

`tests/net/capacity/capacity-regression.test.ts > the loop stays inside the tick
budget at 12 rooms` — `expect(maxLagMs).toBeLessThan(33)`.

Measured, same box, minutes apart:

| tree | maxLagMs | verdict |
|---|---|---|
| this branch, post-merge | **56.96** | red |
| `origin/main` @ `81f5b76`, clean worktree | **114.66** | red, twice as bad |

Main is *worse than my branch*, so the number is tracking box load, not code. Load
average was 31–50 on 8 cores throughout — the same oversubscription that produced
the golden timeout. My branch's only `server/` change is CORS headers on the
`/health` HTTP route (`git diff <merge-base> HEAD -- server/` is 35 lines, all of
it request-path, none of it tick-path), and the file's own **normalised** gate —
the one it calls "a gate rather than a flake" — passed comfortably at
**1.4× a sim step** against a budget of 12.

The test file is mine (`OWNER: Netcode Engineer`). I still did not touch it:

* **`m11-01` already decided this.** Its notes record, from measurement on this
  host: empty process p99 loop lag **5.84 ms**; two rooms **24.6 ms** at 3.4% CPU
  ("dominated by the wave metronome and host jitter, not by saturation"); forty
  rooms on a full core **1–11 ms**. Conclusion, verbatim: *"the ramp now flags
  `baselineExceedsLimit` and says in its own report that the lag column is not a
  capacity reading on such a host. That is why the CI gate is a CPU gate
  (normalised to a bare sim step, so it is portable across runners) and **not a
  lag gate**."* The CI-able subset nonetheless kept an absolute lag gate. That is
  a real inconsistency between the design and the test, and it is the actual bug.
* **But it is a capacity gate, and gates are not edited in passing.** The right
  fix mirrors the ramp's own `baselineExceedsLimit`: measure the host's idle
  loop-lag floor and hold the assertion only where the reading means something.
  That is a re-measurement job with its own brief — the file says in terms that
  budgets move "only with a re-measured `docs/server-capacity.md` in the same
  commit". Weakening a server capacity gate inside an unrelated unstick, on a
  branch about a region picker, is how a real 2× regression walks in later.

So: reported, not silenced. Same discipline the previous session applied to QA's
`measuredSeconds`, and the same one that kept me out of `tests/mobile/` today.
Flagged for the Director — **main is currently red on this test**, which is
everyone's problem, not just mine.

### Port 4173 is shared across lanes, and a local mobile run can silently test SOMEONE ELSE'S BUILD

The single most important thing found this session, and it poisons local mobile
evidence on this box generally.

`playwright.config.ts` hardcodes `PREVIEW_PORT = 4173` with
`reuseExistingServer: !process.env.CI` — true locally. The lanes share a host.
At 19:56 I found 4173 already answering 200, owned by

```
659201 node /lanes/lane-1/node_modules/.bin/vite preview --port 4173 --strictPort
```

— **lane-1's** dist, a different branch's bundle. Had I run `npm run test:mobile`
then, Playwright would have reused it and every result would have described
lane-1's tree while being reported as mine. Green or red, the run would have been
worthless, and nothing in the output would have said so.

This is very likely what the previous session's "before" run measured. That run
(`/tmp/mobile-before.log`, 19:41, pre-merge) reported **4 failed / 92 passed** —
PORTRAIT-HELD lobby golden, `landscape-lock`, `slot-state`, desktop
`build-wheel-gantry` — and **not** the build-wheel golden this brief is about. A
red set that shares nothing with the CI red it is supposed to reproduce is the
signature of a run against the wrong tree.

My memory note `mobile-suite-preview-orphaning` says to bring your own preview.
It did not say to check *whose* preview is already there. Both matter; the second
is worse, because orphaning fails loudly (~150 ms per test) and this fails
quietly with plausible numbers.

**What I did:** did not run against it, and did not kill another lane's process.
Waiting for 4173 to free, then claiming it with this lane's own preview. Did not
edit `playwright.config.ts` to move the port — QA owns that file, and the DoD
line is `npm run test:mobile`, which has to mean the real command.

## NEXT

### The proof the brief asked for, and the one it did not expect

The brief wanted "one failure to zero, with no snapshot file in your diff". The
second half is provable outright and is now airtight:

```
git diff --stat origin/main HEAD -- tests/mobile/     → empty
git rev-parse origin/main:…/phone-landscape-build-wheel-iphone-linux.png
git rev-parse HEAD:…/phone-landscape-build-wheel-iphone-linux.png
                                       → 39548c3…  ==  39548c3…
```

Identical blob. This proves I re-baselined nothing — **and** it re-proves the
previous session's finding from a second direction: main's baseline for the
failing golden is byte-identical to the one my branch already carried, so the
merge cannot have changed what that test compares against. The stale-baseline
theory is not merely unsupported, it is excluded.

Re-verified this session against the *new* `origin/main` (`d2797dc`): still
`39548c3…` on both sides, and `git diff --stat origin/main HEAD -- tests/`
carries only my own three net/allocator test files, **zero PNGs**. Two merges
have now passed over this branch without moving that baseline by a byte.

### The region picker still measures — checked, not assumed

The brief's one substantive "must not change". Both merges left `src/net/`
untouched, and the tests still assert measurement rather than a table:
`region-probe.test.ts` drives `measureRegionPing` through an injected clock and
fetch (an unreachable host measures `null`, a non-2xx is not a measurement, an
edge that ignored the steer is not a measurement of the region asked for), and
`region-picker.test.ts` measures **real round trips against live localhost
servers** — its own header says "no artificial latency and no sleep: the numbers
here are whatever localhost costs". A fixture-substitution regression would have
to delete these, not merely pass them.

### State of the DoD

| line | result |
|---|---|
| `npx tsc --noEmit` | **green** (exit 0) |
| `npm test -- --run` | **green — 233 files, 3829/3829, 218.89s.** The capacity red is gone on a quiet box, untouched |
| `npm run test:mobile` | in flight against a fingerprint-guarded :4173 serving this lane's post-merge `dist` |
| `git merge-base --is-ancestor origin/main HEAD` | **green** vs `d2797dc` |

### Remaining

1. Record the mobile summary line, then update PR #305's body with the
   before/after and the blob-identity proof.
2. On reading the result: the wheel golden now has **two retries** behind it
   (inherited, not written by me). If it still fails, check for the presence of
   actual/expected/diff PNGs *before* believing anything about pixels — their
   absence still means the clock, and a retry cannot turn a genuine diff green.

### The port-4173 guard, generalised

`ss`/`netstat` return nothing in this sandbox, so a port check must be curl +
fingerprint rather than a socket list. Two further wrinkles found this session:
the preview binds **IPv6-only** — `curl 127.0.0.1:4173` returns `000` while
`localhost` and `[::1]` return 200, so a v4-only probe reports "free" for a port
that is very much taken — and `vite preview` serves from disk, so a preview
started before a rebuild silently begins serving the new bundle without a
restart. `/tmp/r7-after.sh` therefore compares the md5 of the *served bytes*
against `dist/index.html` immediately before launching and aborts on mismatch.
That is the check that makes a local mobile run mean anything on a shared box.

### For the Director

- **q9-01's golden retry has landed** (`d2797dc`, PR #311) and this branch has
  inherited it. The item the previous session escalated is closed.
- **The capacity gate is still wrong, just no longer red.**
  `tests/net/capacity/capacity-regression.test.ts` asserts an absolute
  `maxLagMs < 33` on a host where `m11-01`'s own measurements say lag is not a
  capacity reading. It read 114.66 ms on clean `main` at load 31–50 and passes
  today at load ~8 — so it will flip red again whenever a neighbouring lane is
  busy, and a real 2× regression on a quiet runner would be invisible to it. The
  fix mirrors the ramp's `baselineExceedsLimit`: measure the idle loop-lag floor
  and hold the assertion only where the reading means something. It is my file
  and I have the fix shape; it wants its own brief with re-measurement (the file
  itself says budgets move only with a re-measured `docs/server-capacity.md` in
  the same commit), not a drive-by edit inside a region-picker unstick.
- **:4173 is contended across lanes** and `reuseExistingServer` is true locally,
  so any lane can silently run the mobile suite against another lane's bundle and
  report the result as its own — it fails *quietly*, with plausible numbers. An
  env-overridable port in QA's `playwright.config.ts` would fix it for everyone.
