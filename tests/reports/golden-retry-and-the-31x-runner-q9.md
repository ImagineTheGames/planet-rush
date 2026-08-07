# Golden retry, and the 31× runner — q9-01

**QA Agent · branch `agent/qa/q9-golden-retry-31x` · against `main` @ `369d7a6`**

The sibling of `mobile-journey-budgets-q7.md` (a budget per test) and
`golden-diffs-and-highdpi-settle-q8.md` (a budget per golden comparison). Both of
those answered "how slow is the runner?" with a number. This one is about the run
where no number would have been right.

---

## 1. What happened

`main` at `369d7a6` went red on exactly one test:

```
[iphone] › goldens.spec.ts:270 › golden: landscape phone BUILD WHEEL — the compact copy, at 390 px
Test timeout of 90000ms exceeded          ← and it failed the retry too
```

A **timeout, not a pixel mismatch**. No `actual` / `expected` / `diff` PNG exists,
because nothing was ever captured to compare — the baseline is not in question.

The budget model was not wrong either. That test declares `measuredSeconds: 9`,
and `9 × CI_SLOW_FACTOR 10 = 90 s`. What was wrong is that the run sat outside the
band the factor is sized for: the suite took **47.2 min against ~1.5 min
in-container — about 31×**.

Since the supervisor's merge gate started requiring a real `pass` on every check
(the correct fix, after cancelled checks let two untested PRs merge), a single
flaky golden on `main` blocks the entire merge queue. The cost of this class of
failure went up the moment the gate got stricter.

## 2. Every slowdown sample we have

Same suite, same Playwright 1.49.1, same Ubuntu 24.04; ~1.5 min in the studio
container throughout.

| commit | runner wall-clock | ratio | what went red |
|---|---|---|---|
| `11659df` | 8.9 min | **5.9×** | `centering.spec.ts` (q7-01) — the fit `CI_SLOW_FACTOR` was derived from |
| PR #291 | 31.8 min | **~21×** | two `iphone` goldens (q8-01) |
| `369d7a6` | 47.2 min | **~31×** | the phone BUILD WHEEL golden (this report) |

LESSONS §5 bands software-GL runners at 3–10×. **Two of three samples sit outside
that band, and the widest is 31×** — five times the observation the constant was
fitted to. That is now written into the `CI_SLOW_FACTOR` doc comment
(`tests/mobile/budget-model.ts`), which previously cited only the 5.9× sample, so
the next person reads the honest number instead of rediscovering it.

Nothing in the three slow runs is common to the code. What is common is a shared,
noisy-neighbour runner, and the tail of that distribution has no ceiling we can
name.

## 3. Why not simply raise the factor

Because `CI_SLOW_FACTOR` sizes **every** budget in the suite, and a budget is also
the only bound on a test wedged in work the tighter watchdogs cannot see (the boot
fixtures' `waitForSelector` caps, `render-settle.ts`, `sim-clock.ts` — all 10–30 s,
all unchanged).

At 31×, this 9 s golden needs a **4.5-minute** ceiling. A genuine hang would then
sit undetected behind it for four of those minutes, on every test in the suite.
That trades a rare, loud red for a slow, silent one — the wrong direction for a
merge gate.

Worth noting: raising the *test* budget alone would not even have fixed it. The
golden comparison carries its own 45 s ceiling (`GOLDEN_SHOT_TIMEOUT_MS`), also
sized at 10×, and the stabilisation pair at 31× costs ~119 s. Both numbers are
budgets, and budgets are the wrong instrument for this failure.

**A budget is for the run we normally get. The tail gets an attempt.**

## 4. The retry, and its scope

`tests/mobile/goldens.spec.ts`, at file scope:

```ts
test.describe.configure({ retries: GOLDEN_RETRIES });   // 2 on CI, 0 locally
```

The number and its argument live in `tests/mobile/shot-budget.ts`
(`GOLDEN_CI_RETRIES`).

**Scope.** `goldens.spec.ts` is the only file in `tests/mobile/` that calls
`toHaveScreenshot`, so "the goldens" and "this file" are the same set. The
suite-wide `retries: 1` in `playwright.config.ts` is untouched: every behavioural
spec — a tap landing, a lock holding, a wheel opening — still gets exactly two
attempts, because those assert on behaviour and a second re-run really could paper
over a genuine intermittent bug in the product.

**Why it cannot hide a real mismatch.** Every scene in this file is booted under
`?debug=1&freeze=1`: the sim is pinned at a fixed tick and the renderer is a pure
function of that world, which is the same property that lets these goldens diff
the whole frame with nothing masked. A frame that differs from its baseline
therefore differs on *every* attempt — and Playwright only downgrades a failure to
`flaky` when an attempt actually **passes**. An extra attempt can turn a timeout
green; it has no mechanism by which to turn a diff green.

**Cost.** Paid only on a run that is already red: a failing golden now costs three
attempts instead of two. A passing one costs nothing.

## 5. Evidence

### 5.1 Effective retries, measured — not read off the config

A throwaway reporter printing each `TestCase.retries` after resolution, over the
full mobile suite (`--list`, no browser time):

```
CI=1:   retries=2   goldens.spec.ts        :: desktop | iphone | pixel
        retries=1   build-flow.spec.ts     :: desktop | iphone | pixel
        retries=1   build-wheel-gantry.spec.ts, campaign-door, centering,
                    emulation, landscape-lock, layout, menu-frame-cost,
                    slot-state                        (all three projects)

local:  retries=0   every spec, every project
```

Ten spec files, three projects, thirty rows: the extra attempt reaches exactly
three of them.

### 5.2 A wrong baseline fails ALL THREE attempts, with a diff

The portrait baseline was copied over the landscape one and the test run with
`CI=1`:

```
Expected an image 390px by 844px, received 844px by 390px.
354788 pixels (ratio 0.50 of all image pixels) are different.

test-results/…-the-compact-copy-at-390-px-iphone/
test-results/…-the-compact-copy-at-390-px-iphone-retry1/
test-results/…-the-compact-copy-at-390-px-iphone-retry2/     ← three attempts

  1 failed
```

Three attempt directories, each carrying `-expected.png`, `-actual.png`,
`-diff.png` and a trace. Failed every time, as a **mismatch** with pixels
attached, never as a timeout, and never reported `flaky`. Baseline restored
afterwards (`git checkout --`); the snapshot is byte-identical to `main`'s.

### 5.3 The golden passes on its real baseline

`npx playwright test tests/mobile/goldens.spec.ts --project=iphone` in-container:
18 passed, 13 skipped, 2.3 min. The BUILD WHEEL golden at **7.7 s** against its
declared `measuredSeconds: 9` — the budget is generous in the right direction.

## 6. Can the heaviest golden be made cheaper?

Asked properly, with a phase breakdown rather than a guess. Four consecutive
captures per row, in-container, of the actual staged frame (boot → open the wheel
→ settle):

| phase | iphone landscape | iphone portrait-held | desktop control |
|---|---|---|---|
| `goto` | 0.13 s | 0.11 s | 0.11 s |
| canvas attached | 1.29 s | 1.29 s | 0.59 s |
| frozen hook | 0.35 s | 0.34 s | 0.14 s |
| `fonts.ready` | 0.08 s | 0.09 s | 0.04 s |
| settle (boot) | 0.25 s | 0.26 s | 0.12 s |
| `openBuild()` | 0.09 s | 0.08 s | 0.04 s |
| settle (wheel) | 0.66 s | 0.56 s | 0.24 s |
| wedge assertions | 0.27 s | 0.22 s | 0.09 s |
| **setup subtotal** | **3.12 s** | **2.95 s** | **1.37 s** |
| one capture, `scale:'css'` | 1.92 s | 1.59 s | 0.65 s |
| one capture, `scale:'device'` | 1.91 s | 1.59 s | 0.70 s |
| **stabilisation pair** | **3.85 s** | **3.19 s** | **1.31 s** |

**Answer: no, and it should be left alone.** The levers, and why each is dead:

- **`scale: 'device'` — dead, and on new evidence.** The q8-01 note recorded
  device captures at ~1.51 s against css at ~1.81 s and blamed the css resample.
  Re-measured, they are *the same to within noise* on all three profiles: the
  readback and encode are the cost, and both scales pay them. Switching would
  force a re-shoot of every phone baseline at 4.5× the PNG bytes and buy nothing.
  This is recorded in `shot-budget.ts` so it is not re-tried on the stale number.
- **Clip or mask the wheel region** — this is the one baseline that proves the
  compact copy lands *at 390 px*, on the whole frame. Shooting less of the frame
  is shooting less of the claim. Rejected on the brief's own terms.
- **Share one boot across the landscape and portrait-held wheel goldens** — saves
  ~3 s of setup, which is not the half that timed out; couples two baselines into
  one test so the first failure hides the second; and makes a retry re-run both.
  Worse on every axis that matters.
- **Fewer captures** — `STABILISATION_CAPTURES` is already 2, which is
  Playwright's floor for a comparison. There is nothing to remove.

The capture pair is **55% of the test and irreducible**; the remaining 45% is a
real boot of the real preview bundle, which is what the suite is for. The honest
conclusion is that this golden costs what it costs.

One thing did come out of the measurement: at identical pixel counts the
**landscape** capture runs ~20% dearer than the portrait one, and the model —
keyed on megapixels alone — was projecting 1.88 s for a 1.92 s capture. Orientation
does not belong in the model, but the promise that a projection sits at or above
what was measured does belong, so `CAPTURE_FIXED_MS` went 550 → 600 ms. Values
only; every budget in the matrix rounds to the same step it did before (30 s /
45 s / 45 s), asserted in the contract test rather than assumed.

## 7. What is now mechanical

`tests/mobile-shot-budget-contract.test.ts` (vitest, no browser time, cheapest job
in CI) pins the whole of §4 so it cannot drift:

- `GOLDEN_CI_RETRIES` is 2 on CI and 0 locally;
- `goldens.spec.ts` applies it **by name** at file scope — a bare literal fails;
- `playwright.config.ts` still reads `retries: process.env.CI ? 1 : 0`, and no
  project block reintroduces a per-device retry;
- **no other spec in `tests/mobile/` configures retries at all** — the assertion
  that keeps "scoped to the goldens" true after the next person adds a spec.

## 8. What this does not do

- It does not widen `maxDiffPixelRatio`. That tolerance is for font and GPU
  antialiasing; widening it to swallow a half-composited frame would blind the one
  gate that catches a real visual regression.
- It does not delete, skip or `fixme` the golden.
- It does not raise `CI_SLOW_FACTOR`, `timeout`, `expect.timeout` or
  `GOLDEN_SHOT_TIMEOUT_MS`. §3 is why.
- It does not claim the 31× runner is fixed. It is not fixable from this repo. The
  claim is narrower and checkable: when it recurs, it costs an attempt instead of
  the merge queue.
