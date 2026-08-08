# r9-01 — unstick `agent/gameplay/z2-second-station-spike`

**Branch:** `agent/gameplay/z2-second-station-spike` · **Brief:** merge `origin/main`,
re-run the mobile suite, do not re-shoot the golden, do not raise the budget.

The spike's deliverable — `docs/design/second-station-spike.md` — is untouched by
this unstick, and no second station is being built. This is a merge.

---

## BUILT

- **The merge: `8fd4d32`** — `origin/main` (34 commits) merged into the spike
  branch, conflict-free. `git merge-base --is-ancestor origin/main HEAD` passes.
  The branch's own diff is still exactly the two markdown files it always was:

  ```
  docs/design/second-station-spike.md        | 672 +++++++++
  status/notes/z2-01-second-station-spike.md | 122 +++++
  ```

  **No snapshot in it.** `docs/design/second-station-spike.md` is byte-unchanged
  from `a76b3d0` (`git diff a76b3d0 HEAD -- <deliverable>` is empty).

- **Pre-merge mobile suite: `81 skipped / 96 passed (17.9m)`, exit 0.** Fully
  green — *including* `goldens.spec.ts:270`, which passed in **29.6 s**.
- **`npx tsc --noEmit`** — clean, exit 0.
- **`npm test -- --run`** — `229 passed (229)` files, `3825 passed (3825)` tests,
  exit 0. Note this is *better* than the state PR #307's body describes: the two
  it recorded as pre-existing failures (`tests/net/capacity/capacity-regression`
  and `tests/net/online-2p`) both pass here. Neither was ever this branch's.
- Post-merge mobile suite: running.

## DECISIONS

### The brief names two stacked causes. Only one of them is real for this golden.

The brief's cause **#1 (stale baseline)** says the failing golden
`phone-landscape-build-wheel` "was one of the seven re-shot" by `496a215`
(a3-01's rock re-baseline) and that the branch therefore carries the old
baseline. **It was not one of the seven, and the branch's copy is not stale.**

`git show --stat 496a215` lists the seven it moved:

```
desktop-build-wheel           desktop-frozen                 phone-landscape-frozen
desktop-build-wheel-short     desktop-frozen-teams           phone-landscape-frozen-teams
                                                             phone-portrait-frozen-teams
```

`phone-landscape-build-wheel-iphone-linux.png` is not among them, and its blob is
**byte-identical on this branch and on `origin/main`**
(`39548c3133a67155ce08b3949f42138bc30534f9` both sides). Merging cannot change it.

Why a3-01 correctly left it out — re-running their `#939BA5` sweep per-colour over
that one 844×390 frame:

| | OLD rockBody | OLD rockShadow | OLD rockFissure |
|---|---|---|---|
| `phone-landscape-build-wheel` (branch **and** main) | **0** | 1 | 26 |
| `desktop-frozen` (main, re-shot) | 0 | 0 | 8 |
| `desktop-frozen` (branch, stale) | 17390 combined — 1.698% of frame | | |

Zero old-`rockBody` pixels. At 390 px landscape the wheel and HUD cover the rock
field; 27 stray fissure/shadow pixels is 0.008% of the frame, two orders under the
suite's own `maxDiffPixelRatio` of 0.01. There is nothing in this frame for a rock
palette change to move.

q9-01 reached the same conclusion from the other direction and wrote it down
(`tests/reports/golden-retry-and-the-31x-runner-q9.md` §1): *"A timeout, not a
pixel mismatch. No actual/expected/diff PNG exists, because nothing was ever
captured to compare — the baseline is not in question."* §5.3 measured the golden
passing on its real baseline in-container at **7.7 s against its declared 9 s**.

**So: cause #2 is the whole cause.** That does not change the work — the brief's
instruction is still "merge main", and the merge is still exactly what fixes it —
but it changes what the merge is *for*, and it is worth having in writing before
someone reads a red and reaches for `--update-snapshots`.

### What the merge actually delivers: #311, already landed

The brief was written while `q9-01`'s retry work sat on an un-PR'd branch and told
me to "name #311 as the fix in flight". **#311 merged into `main` at `d2797dc`**,
ahead of this unstick. So merging `origin/main` *is* taking the fix, not waiting
on it — the branch gains `GOLDEN_RETRIES` (2 on CI, 0 locally) at `goldens.spec.ts`
file scope, plus the 550→600 ms capture-intercept re-fit (`fad3988`).

### Port 4173 is shared across lanes, and a naive `npm run test:mobile` is worthless

`playwright.config.ts` (QA's) hardcodes `PREVIEW_PORT = 4173` with
`reuseExistingServer: !process.env.CI` — **true locally**. The lanes share this
box, and lane-3's `vite preview` (pid 667524, up since 20:12) still holds 4173 in
this session too:

```
667524  node /lanes/lane-3/node_modules/.bin/vite preview --port 4173 --strictPort
```

Because Playwright skips the `webServer.command` entirely when the URL already
answers, **`npm run build` never runs** — the suite describes lane-3's bundle while
reporting as mine. Session 1 quoted no such run, and neither will this one.

**What I do instead.** Not killing lane-3's process — it is not mine. Running
through **`evidence/a3-rock-palette/playwright.a3.config.ts`**, already committed
on `main`: it spreads QA's config verbatim (device matrix, tolerances, timeouts,
reporters — only the URL moves), sets `reuseExistingServer: false` so it always
builds and serves *this* working tree, and takes its port from `A3_PREVIEW_PORT`.
Running on **4292**, probed free first. a3-01 wrote that file after this exact bug
bit them; reusing it adds **nothing** to my diff.

Session 1's contaminated run is worth one line for what it accidentally proved,
as corroboration only (not evidence, not in the PR body): lane-3's tree is
post-`496a215`, so it put a **new-palette render** against **my branch's
baselines** — and `goldens.spec.ts:270 phone-landscape-build-wheel` **passed,
32.2 s**, while `phone-landscape-frozen` and `phone-landscape-frozen-teams` both
failed. Exactly the split the sweep predicts: the two frozen frames are rock-heavy
and stale, the build wheel has no rock body in it at all.

### The pre-merge run settles the question the brief left open

The brief stacked two causes and told me not to re-shoot. The pre-merge run
proves cause #1 was never in play at all: on an isolated build of this branch's
**own, unmerged** tree, `goldens.spec.ts:270` **passed in 29.6 s**, and so did
every other golden — 96 passed, 0 failed. A stale baseline cannot pass against
the code that produced it *and* be the reason CI went red.

The merge confirms it from the other side. Main moves **eleven** snapshots
(a3-01's seven, r5-01's two upgrade-wheel re-shoots, u7-06's four new ones), and
`phone-landscape-build-wheel-iphone-linux.png` is **not one of them** — its blob
is `39548c31…` on both sides after the merge, exactly as before it. The merge
could not have fixed a baseline problem, because there was no baseline problem.

What the merge *does* fix is the thing that actually failed: `GOLDEN_RETRIES` is
now on the branch at `goldens.spec.ts:42`, and `CAPTURE_FIXED_MS` is 600.

### The box, measured — why "it passes here" is not "it passes there"

At the time of the pre-merge run: **load average 31.6 on 8 cores**, with **4098
zombie processes** (3117 defunct `headless_shell`) left by other lanes' runs.
That is ~4x oversubscription, and it is the honest shape of q9-01's 31x runner.
I did not reap them — they are not my processes, and their parents are not mine
to signal. It is worth knowing that the number in the pre-merge line (17.9m for
96 tests) was paid on a box in that state and still came back green.

### The merge needed two untracked files moved, not deleted

`evidence/a3-rock-palette/{playwright.a3.config.ts,verify-served-build.mjs}` sat
untracked in this working tree (session 1 pulled them in to run with) and git
refused the merge rather than overwrite them. Both were **byte-identical to
main's tracked copies** (hashes checked before and after), so I moved them to
`/tmp`, merged, and confirmed the checked-out versions matched what I had moved.
No `git clean`, and nothing lost. `evidence/netcode/` and `fly.capacity.toml`
are another lane's debris in this tree — left untracked and uncommitted; they
are not mine.

### Rejected

- **Re-baselining the golden.** Refused by the brief, and independently
  unnecessary: the baseline is byte-identical to main's and provably carries no
  rock body. A re-shoot from this branch would have overwritten a correct file
  with a pre-`496a215` render for no reason at all.
- **Raising `GOLDEN_SHOT_TIMEOUT_MS` / widening `maxDiffPixelRatio`.** Refused by
  the brief, and q9-01 §3 already argued it out: at 31× the 9 s golden needs a
  4.5-minute ceiling, behind which a genuine hang sits undetected on every test in
  the suite. *"A budget is for the run we normally get. The tail gets an attempt."*
- **Killing lane-3's orphaned preview to free 4173.** Not my process, and the
  isolated-port route costs nothing.
- **Touching the spike deliverable, or starting the second station.** The
  developer asked for an investigation. This unstick does not change that.

## NEXT

1. Post-merge mobile suite (running, port 4292) — its summary line is the second
   half of the evidence.
2. Push, and put both summary lines in the PR body with no snapshot in the diff.

Nothing is blocking. If the post-merge run goes red on `:270`, the brief's
instruction stands: say so plainly and name #311 — except that #311 is now
*merged here*, so a red would mean the retry did not cover it, which is QA's
call and not a licence to re-baseline.
