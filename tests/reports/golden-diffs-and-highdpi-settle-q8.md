# Golden diffs in CI, and the dpr-3 settle — q8-01

**Branch `agent/qa/q8-golden-diffs-and-highdpi-settle` · owner: QA Agent ·
verified in-container against the real preview build (`npm run test:mobile`,
Playwright 1.49.1, Chromium 1148, Ubuntu 24.04 — the CI image).**

PR #291 (u7-02, the Gantry build wheel) went red on two `iphone` goldens:

```
[iphone] › goldens.spec.ts:244 › golden: landscape phone BUILD WHEEL — the compact copy, at 390 px
[iphone] › goldens.spec.ts:263 › golden: PORTRAIT-HELD phone BUILD WHEEL — the wheel survives the lock
```

Nothing was wrong with either frame. Two things were wrong with the gate: its
failures could not be looked at, and its comparisons were not budgeted for the
frames they compare. This report is the evidence for both, and for the claim
that the baselines are correct.

---

## A. Which side was wrong (confirm, don't assume)

Reproduced at PR #291's head, `0830118`. That commit already merges `main`
(`git merge-base main <head>` == `main`), so the head **is** the merge result CI
builds — the reproduction is of the same tree, not an approximation of it.

```
$ npx playwright test tests/mobile/goldens.spec.ts --project=iphone
  ✓ 7 goldens.spec.ts:244 › golden: landscape phone BUILD WHEEL — the compact copy, at 390 px (7.5s)
  ✓ 8 goldens.spec.ts:263 › golden: PORTRAIT-HELD phone BUILD WHEEL — the wheel survives the lock (7.0s)
  6 skipped
  9 passed (56.2s)
```

**The committed baselines match. No baseline is changed by q8-01.** The failure
was environmental, and the rest of this report is what the environment was doing.

---

## B. What was actually wrong

Two defects. The first is why this cost a day of guessing; the second is why it
happened at all.

### B.1 A visual gate whose failures are invisible

`playwright.config.ts` set `reporter: process.env.CI ? [['github'], ['list']] :
[['list']]`. Neither reporter writes a file, so `playwright-report/` was never
created and ci.yml's `upload-artifact` step warned

> No files were found with the provided path: playwright-report/

on **every** run, red or green. The three PNGs a failed `toHaveScreenshot`
produces — actual, expected, diff — and the `trace: 'retain-on-failure'` traces
are test *attachments*: they exist only where a file-producing reporter puts
them. So every golden failure in this repo's history has had to be debugged by
reproduction and guesswork, which is exactly what happened here.

### B.2 A comparison budgeted like a two-line check

The brief's reading was that goldens rode the config's `expect.timeout` of 10 s.
They did not, and the truth is worse: **`toHaveScreenshot` carries its own 5 s
default and never consults `expect.timeout`.** Playwright's own call log, from a
deliberately-broken baseline run before the fix:

```
expect.toHaveScreenshot(phone-landscape-frozen.png) with timeout 5000ms
```

What has to fit inside that 5 s: Playwright will not diff a frame it has not
captured **twice identically**. Measured in the studio container, six
consecutive captures per project at `scale: 'css'` — the scale
`toHaveScreenshot` uses:

| project | frame | rasterised | per capture (`css`) | per capture (`device`) |
|---|---|---|---|---|
| desktop | 1280×800 dpr 1 | 1.02 MP | **0.96 s** | 1.04 s |
| pixel | 412×915 dpr 2.6 | 2.55 MP | **1.57 s** | 1.22 s |
| iphone | 390×844 dpr 3 | 2.96 MP | **1.81 s** | 1.51 s |

Two things fall out of that table. The dpr-3 phone frame rasterises ~2.9× the
desktop control's pixels — and the golden path is the *more* expensive of the
two scales on a hi-dpi frame, because `scale: 'css'` resamples 1170×2532 back
down to 844×390 after the readback. The stabilisation **pair** on `iphone` is
therefore ~3.6 s in-container before the comparison starts.

Against the suite's software-GL allowance (`CI_SLOW_FACTOR` = 10,
`tests/mobile/budget-model.ts`) that pair has never fitted in 5 s. On an ordinary
CI run the goldens got away with it; on the run that failed — **31.8 min against
a normal ~9**, with a third test flaky — they did not. Reported as a timeout,
with no pixels attached, a slow frame reads exactly like a broken screen.

### B.3 And the settle was a stopwatch

`bootFrozen` waited `waitForTimeout(500)` for "a couple of render frames", with
the honest note that the frozen frame is time-invariant so an early shot is the
same deterministic frame. True of the **world**; silent about the **compositor**.
500 ms is ~30 frames in-container and can be *none* on a loaded runner — so the
capture goes off before the renderer has drawn the state the test just staged.
`bootFrozenTeams` (+500 ms), `bootMenu` (+1200 ms) and `openSettings` (+300 ms)
had the same shape, as does u7-02's `bootFrozenBuildWheel`.

---

## C. What changed

### C.1 The report exists (the important half)

```ts
reporter: process.env.CI
  ? [['github'], ['list'], ['html', { open: 'never' }]]
  : [['list']],
```

`github` stays — its annotations are the failure summary a reviewer sees first.
`html` writes `playwright-report/`, the path ci.yml already uploads, with
attachments copied into `playwright-report/data/` and the report itself inlined
into `index.html` as base64 — so the downloaded artifact opens by
double-clicking, with no server and no `npx playwright show-report`.
`open: 'never'` because a runner has no browser to open it in and would hang
trying. **No workflow change was needed**: the upload step was always correct;
it had nothing to upload.

### C.2 The comparison is budgeted from the frame

`tests/mobile/shot-budget.ts` — the sibling of `budget-model.ts`, one level down:

```
capture(mp) = 550 ms + 450 ms/MP × mp            (fit to the table in B.2)
budget(mp)  = max(30 s, roundUpTo15s(capture(mp) × 2 captures × CI_SLOW_FACTOR))
```

giving 30 s for the desktop control and 45 s for both phones. Every rounding
goes the same way — a capture is never assumed cheaper than it measured.

**It ships as one number (the 45 s maximum over the matrix), and that is a
Playwright limitation worth recording.** `TestProject.expect.toHaveScreenshot`
in 1.49.1 accepts `threshold`, `maxDiffPixels`, `maxDiffPixelRatio`,
`animations`, `caret`, `scale`, `stylePath` — and **no `timeout`**. Setting one
type-checks (no excess-property check fires on a returned object) and is then
silently ignored; worse, a project's `expect` block *replaces* the config-level
one, so the project also loses `expect.timeout` and drops to the 5 s default.
That was tried here, and the call log caught it — `with timeout 5000ms` on a
project configured for 45 s. The trap is written down in `shot-budget.ts` so
nobody walks back into it.

So the budget travels on the per-call options object every golden already passes
(`GOLDEN` in `goldens.spec.ts`). That has the property this brief needed most: a
golden written on **another branch, before any of this existed** inherits the fix
by passing the constant it always passed.

Sizing at the maximum over-budgets the desktop control by 15 s and under-budgets
nothing, and over-budgeting costs nothing real: a mismatching golden does **not**
spin until the clock runs out. Once it has two identical captures it compares
once and fails with the diff attached — observed in the break run below, which
failed after exactly two captures.

**`maxDiffPixelRatio` is untouched at 0.01.** The tolerance is for font and GPU
antialiasing; widening it to swallow a half-composited frame would blind the gate
to the real visual regressions it is the only guard against. Time was what was
short.

### C.3 The settle counts frames

`tests/mobile/render-settle.ts` `settleFrames(page, n = 3)` waits for `n` drawn
animation frames. Three, so that at least two full renders of the changed state
have happened whichever order the app's rAF callback and ours are queued in. It
carries the same liveness bound `sim-clock.ts` uses and for the same reason: an
in-page `setTimeout` watchdog fails in 10 s, naming how many frames it got, if
`requestAnimationFrame` stops being called at all — so a wedged compositor is a
fast, named failure and never a hang (QA charter).

Every flat `waitForTimeout` in `goldens.spec.ts` is now one of these, including
the 200 ms poll interval in `waitForStableViewport` (a layout change is only
observable after a frame, so a frame is the honest interval).

It deliberately does **not** re-do Playwright's own "two identical captures"
check. That is the same instrument, and doing it twice would double the most
expensive operation in the suite for no new information; C.2 is what gives the
built-in one time to converge.

### C.4 Both rules are mechanical

`tests/mobile-shot-budget-contract.test.ts` (vitest, no browser time, fails on
the cheapest job in CI) fails the build if a golden hand-writes a screenshot
timeout, if a project stops taking its viewport from the one matrix, if the
model's projections fall below what was measured, or if a flat stopwatch returns
to `goldens.spec.ts`. The lesson is encoded, not just written down — which is the
sibling contract's whole point (q7-01).

---

## D. Evidence

**A deliberately-broken baseline, on CI, producing a downloadable report with
the actual/expected/diff images in it.** The break paints a magenta block over
`phone-landscape-frozen-iphone-linux.png` — comfortably above the 1% tolerance,
so it fails on pixels and not on chance.

It landed on **run
[31143332754](https://github.com/ImagineTheGames/planet-rush/actions/runs/31143332754)**,
at commit `301d032`:

```
1 failed · 62 skipped · 78 passed (29.6m)
  [iphone] goldens.spec.ts:92 golden: landscape phone frozen scene

10679 pixels (ratio 0.04 of all image pixels) are different.
  - expect.toHaveScreenshot(phone-landscape-frozen.png) with timeout 45000ms
    - taking page screenshot … fonts loaded
    - 10679 pixels (ratio 0.04 of all image pixels) are different.
    - waiting 100ms before taking screenshot
    - taking page screenshot … fonts loaded
    - captured a stable screenshot          ← the pair converged, in-budget
    - 10679 pixels (ratio 0.04 of all image pixels) are different.

artifact  playwright-report  3,606,979 bytes
          index.html                          627,934 B, report inlined
          data/*.png                          3 × 844×390 — actual, expected, diff
          data/*.zip                          2 × trace (run + retry)
```

Two things there are worth more than the artifact's mere existence, and both are
the part-2 half of this brief landing on a *real loaded runner* rather than in a
local re-enactment: the assertion failed as a **diff and not a timeout**, and it
`captured a stable screenshot` — the dpr-3 stabilisation pair converged inside
45 s on a run that took 29.6 minutes against a normal ~9.

The three images are pinned in `./q8-golden-diff-artifact/`, because the artifact
itself expires in 7 days (ci.yml `retention-days: 7`). Their provenance is
checkable rather than asserted: the pinned `expected.png` has git blob sha1
`2f789c72…`, byte-identical to the baseline blob `207e1b7` committed.

**The break is reverted** — `33d60fb`, restoring blob `cb6120f`, which is what
`origin/main` carries for that file. It was *not* reverted when it should have
been; see §G.

Locally, with `CI=1` and the same break, before/after the fix:

```
before:  expect.toHaveScreenshot(...) with timeout 5000ms      no playwright-report/
after :  expect.toHaveScreenshot(...) with timeout 45000ms
         playwright-report/index.html                          454 KB, report inlined
         playwright-report/data/*.png                          3 × 844×390 — actual, expected, diff
         playwright-report/data/*.zip                          2 × trace (run + retry)
```

## E. Definition of Done

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test -- --run` | 226 files, 3619 tests passed |
| `npm run test:mobile` | 56 passed, 37 skipped, 4.0 min — all 11 goldens green, baselines unchanged |

## F. What this does NOT do

- **It changes no baseline.** §A is the proof that none needed changing.
- **It does not re-run PR #291.** That PR needs a re-run and not a rewrite: CI
  builds a PR's merge ref, so u7-02's added goldens merge with this `main` and
  inherit the budget through the `GOLDEN` object they already pass. Nothing on
  that branch has to move.
- **It leaves the other Playwright configs alone.** `tests/live/` and
  `tests/live-stage/` have the same reporter blindness but no `toHaveScreenshot`
  goldens, so nothing there fails invisibly today. Worth a follow-up, not worth
  widening this one.

---

## G. Why this PR sat red for a day (the unreverted break)

Worth writing down, because the failure was this branch's own and the mechanism
is one any evidence-by-sabotage brief can walk into.

`207e1b7` painted the magenta block and said, in its own message, *"Reverted in
the following commit."* The following commit — `6e82fc2` — is a docs change. The
revert was never made. The sabotaged blob has been the committed baseline since,
and `npm run test:mobile` has failed on exactly it, once, on every run since.

The merge of `main` could not catch it, and that is the interesting part. `main`
still carries the *pre-break* blob for that file, so git saw "branch modified it,
main did not" and kept the branch's side without a word. **The merge was clean
precisely because a sabotaged baseline is indistinguishable from a legitimately
re-shot one.** Nothing in the tooling can tell those apart — only the commit that
was supposed to follow, and did not.

Two things follow, and the second is the one worth keeping:

- The four goldens `a1-01` repaired on `main` (the doors and CODEX screens) are
  **not** implicated. They pass at this branch's merged HEAD — visible in run
  31143332754's log, where `desktop THE DOORS`, `desktop CODEX` and the rest are
  all green and the failure count is 1. Re-derived, not assumed: which side was
  wrong is *this branch*, on exactly one file, and `main` was right. After the
  revert the branch and `main` agree on every byte of every baseline.
- **An intentional break is only safe if the revert is in the same commit as the
  evidence it produces, or is gated so it cannot merge.** Trusting a *future*
  commit to undo it is how it ships. The evidence does not need the break to be
  in the tree at merge time — it needs the break to have been in the tree at
  *run* time, and a run is already an immutable record. So the honest shape is:
  break, push, let CI fail, pull the artifact down, revert, and commit the
  artifact — which is what `./q8-golden-diff-artifact/` now is.
