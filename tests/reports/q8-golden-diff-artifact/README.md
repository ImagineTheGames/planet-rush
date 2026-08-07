# The golden-diff artifact, pinned — q8-01

The deliverable of this brief's part 1 is *an artifact existing*: CI, on a
failing golden, writing a downloadable report that carries the pixels. These
three PNGs are that artifact's payload, lifted out of it and committed here.

They are pinned because `actions/upload-artifact` keeps `playwright-report/`
for **7 days** (ci.yml `retention-days: 7`). The run below will 404 long before
anyone re-reads this branch, and "the artifact existed, trust me" is exactly the
kind of claim this brief exists to stop making.

## Where they came from

| | |
|---|---|
| Run | [31143332754](https://github.com/ImagineTheGames/planet-rush/actions/runs/31143332754) — job `Mobile emulation (Playwright)` |
| Commit | `301d032` (this branch's merge of main, with the deliberate break still live) |
| Artifact | `playwright-report`, 3,606,979 bytes |
| Result | `1 failed · 62 skipped · 78 passed (29.6m)` |
| The one failure | `[iphone] goldens.spec.ts:92 golden: landscape phone frozen scene` |

## The three images

| File | Artifact path | What it is |
|---|---|---|
| `expected.png` | `data/74103fde…png` | the **sabotaged** baseline — the magenta block |
| `actual.png` | `data/6ff1642d…png` | what the runner actually drew — the real frame |
| `diff.png` | `data/504fa333…png` | the differing pixels, in red |

All three are 844×390 — `scale: 'css'`, which is what `toHaveScreenshot` uses,
so a dpr-3 device frame comes back resampled to CSS pixels (shot-budget.ts).
The artifact also carried `index.html` (627,934 bytes, report inlined — it opens
by double-clicking, no server) and two trace zips (run + retry).

`expected.png` has git blob sha1 `2f789c72…`, which is byte-identical to the
baseline blob committed by `207e1b7`. That is the chain of custody: the picture
in the artifact is provably the sabotaged file, not a re-render of it.

## What the failure proves, beyond "a report was written"

```
10679 pixels (ratio 0.04 of all image pixels) are different.
  - expect.toHaveScreenshot(phone-landscape-frozen.png) with timeout 45000ms
    - taking page screenshot … fonts loaded
    - 10679 pixels (ratio 0.04 of all image pixels) are different.
    - waiting 100ms before taking screenshot
    - taking page screenshot … fonts loaded
    - captured a stable screenshot
    - 10679 pixels (ratio 0.04 of all image pixels) are different.
```

Three things, and the second two are the part-2 half of the brief landing in the
place it actually matters — a real loaded runner, not a local re-enactment:

1. **It failed as a DIFF, not as a timeout.** Before q8-01 a golden rode
   Playwright's own 5 s default and reported `Timeout`, with no pixels attached.
   This one reports pixels.
2. **`captured a stable screenshot`** — the dpr-3 stabilisation *pair* converged
   inside the budget, on a run so loaded the suite took 29.6 minutes against a
   normal ~9. Two captures, exactly as `STABILISATION_CAPTURES = 2` predicts.
3. **45 s, not 5 s** — the budget derived in `tests/mobile/shot-budget.ts` from
   the largest frame in the matrix, arriving through the per-call `GOLDEN`
   options object.

`maxDiffPixelRatio` stayed at `0.01`. It was never the knob: the frame was not
wrong and the tolerance was not tight, the clock was short.

## The break is gone

The magenta block was reverted in `33d60fb` — restoring blob `cb6120f`, which is
what `origin/main` carries for that file. `expected.png` here is the only copy of
the sabotaged frame that remains in the repo, and it is evidence, not a baseline:
it sits outside `goldens.spec.ts-snapshots/`, so nothing compares against it.
