# r8-01-unstick-u7-gantry-match-hud.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT

- `0b9eecb` — **Merge main into the branch (third pass).** Ten files conflicted,
  exactly as the brief said: `src/ui/hud.ts` + nine in-match goldens.
  - hud.ts: three hunks, all resolved main's CONTENT + this branch's TREATMENT.
  - nine conflicted goldens: took main's bytes (`git checkout --theirs`).
- `5c04811` — **Merge main, fourth pass.** Session 2 opened with the third-pass
  merge STILL UNPUSHED and main another **64 commits** ahead (a0-06's character
  select, a0-17's abundance spread). This merge was **clean — zero conflicts**.
  `npx tsc --noEmit` clean; unit suite **250 files / 4318 tests, all passed**.
  Pushed, so the merge can no longer be lost to a dead session.
- `e2d3391` — **Re-shoot the eight goldens this branch actually moves.**

## DECISIONS

**The three hud.ts hunks** (session 1, unchanged and still correct).

1. *Ore-cluster section comment.* Collided only because this branch declares its
   new `metrics` field directly above it. Kept both — no disagreement existed.
2. *The label.* The one genuine content collision.
   main `makeText('ORE', FONT_HEADING, 11, TEXT_MUTED)` vs this branch
   `makeText('TOTAL', …, TYPE.eyebrow, …, 'eyebrow')`. Took main's **word** and
   its whole a0-03 ratification comment; kept this branch's type scale + eyebrow
   tracking. **`TYPE.eyebrow` IS 11** — checked, not assumed, so the resolution
   moves no metric.
3. *`// --- Ore:` section header.* A **false conflict** — this branch appends four
   `draw*Chrome` methods immediately above a header main renamed TOTAL→BANK.
   Kept every method, took main's header.

**Rejected: picking a side on hud.ts.** `--ours` reverts a0-03's ratified `ORE`
and a0-16's wave interval; `--theirs` throws away the instrument rework, which
is the deliverable.

**The re-shoot set was chosen by MEASUREMENT, not by the conflict list.**
`git diff --name-only origin/main...HEAD -- …/goldens.spec.ts-snapshots/`
returned exactly **three** files — the band goldens u7-07 *adds*. So after the
merge this branch carried **main's bytes for every shared baseline**, which is
what the brief asked for and made the question purely "which does u7-07 move?".

**The control run is what answered it.** Same specs, same container, clean
`origin/main` worktree at `/tmp/main-check` (node_modules symlinked, run
sequentially on its own `PREVIEW_PORT`): **35 passed / 0 failed**. Branch:
**30 passed / 8 failed**. So nothing failing here is main's drift or this host's.

**A hypothesis the control KILLED — write this one down.** Six of the eight
failures were `iphone` and every `desktop` in-match golden passed, which looks
exactly like the dpr-3 drift a0-06's note describes. I had half-written that
conclusion. The control refuted it outright. The real cause is the **0.01
`maxDiffPixelRatio`**: at dpr 1 in a 1280×800 frame the HUD is a small enough
share that the same treatment change lands *under* tolerance; at 844×390 it does
not. Desktop's baselines are therefore correctly left as main's — they still
pass — and re-shooting them "for consistency" would have been the exact silent
overwrite the brief forbids.

**A diff image misled me; the full frames corrected it.** The frozen-teams diff
appeared to show `MATCH 0:52` against `MATCH 0:02` — a clock *value* change,
which would have been a behavioural regression, not a re-baseline. Reading
actual and expected **whole** showed both say `MATCH 0:02`; the overlay had
doubled the anti-aliased text because the block *moved*. Never diagnose from the
diff overlay alone.

**Checked before blessing it: the `MATCH` row that main hides.** Main's wheel
goldens show no `MATCH` line, this branch's do. That smelled like reverting a
decluttering decision. Grepped both: **neither** `hud.ts` gates `waveMatch` on
wheel-open — main draws it too and the *wheel overlay occludes it*. This
branch's tighter instrument leading lifts the third line clear. Treatment, not
content.

**The eight, each looked at, one line each** — see `e2d3391`'s message for the
full split. The wheel four are the strongest: main's onboarding prompt is a
floating plate that **covers REPAIR REACTOR's and RADAR's costs and the whole
CARGO wedge**; u7-07's bottom band uncovers them. Costs visible is GDD §2.5's
entire point, so those four re-baselines are a fix, not cosmetic churn.

**Port 4173.** `playwright.config.ts` now reads `PREVIEW_PORT` (added since
session 1), so the lane-collision risk is handled properly by env instead of
session 1's `CI=1` workaround. Branch runs on 4193, control on 4194, never
concurrently.

**The DoD's last line is a real gate — hand-tested twice.** Session 2 run:
resolves `state=OPEN number=298`, counts **3** failing checks (`Mobile
emulation` and its shards 1/6 and 4/6) and **exits non-zero**. LESSONS §22
satisfied by demonstration, not assertion.

**The behavioural proofs, re-run by name and confirmed RUN, not skipped.**
`build-wheel-gantry.spec.ts:371` (capped-wedge refusal) ✓ iphone, pixel, desktop.
`build-flow.spec.ts:266` (u7-02 BACK cycle) ✓ iphone, pixel — desktop skips it by
design, it is a touch flow. Grepped the log for both by name rather than trusting
the summary count, because "88 passed" is also what a run that skipped them says.

**Reverted, not committed: `evidence/voice-*.png`.** `voice-copy-fit.spec.ts`
rewrites nine evidence PNGs as a side effect of any run. They belong to the voice
work, not to this brief; committing them would have been an edit outside
ownership dressed as test output.

## OUTCOME — #298 MERGED

CI on the pushed branch went **fully green, all six shards**, including 1/6 and
4/6 which were the two red ones. #298 then merged as `7c7794c`.

**One more check after the merge, and it mattered.** `a2-04` (the Cutterhead —
the station loses its hull turrets) landed in the same window. That is a station
silhouette change and could have invalidated six freshly-re-shot in-match
baselines. Re-ran the full golden suite on the merged tree carrying both:
**38 passed / 0 failed**. The baselines survive it.

Final DoD, all four lines, run verbatim on `6ab4064`:

| Line | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test -- --run` | **252 files / 4347 tests passed** |
| `origin/main` ancestor of HEAD | exit 0 |
| PR gate | `state=MERGED` → exit 0 |

**Note for whoever runs this DoD next.** Line 3 failed twice during
verification, both times purely because `main` moved *between* the fetch and the
check — not because anything regressed. Re-merge and re-run; it is a treadmill,
not a fault. Line 4 short-circuits on `MERGED` now, so it no longer exercises the
`gh pr checks` branch — that branch was hand-tested while #298 was still open and
**did** fail (3 failing checks, non-zero exit), which is the LESSONS §22
demonstration.

## NEXT

Nothing outstanding. The branch is merged and equals `origin/main`.
