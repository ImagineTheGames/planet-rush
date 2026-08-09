# r4-01-unstick-u7-gantry-match-hud.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT

Branch `agent/ui/u7-gantry-match-hud`, PR **#298** (existing — no new PR opened).
Base before this session: `b8ca92d`, forked at `3229b84` (the u7-04 doors/CODEX
merge). Main had moved to `29f2950`.

- **`57b9efd` — Merge main into u7-gantry-match-hud.**
  Brings in a1-01, q8-01, b1-01, m11-01, u7-02 (build wheel) and u7-05 (pause /
  end-of-match). `origin/main` is now an ancestor of HEAD, so the DoD ancestry
  line passes. Two conflicts, both import-block only — see DECISIONS.
  After the merge: `npx tsc --noEmit` clean, `npm test -- --run` **3814 passed /
  230 files**.

- **`87be92d` — Merge main into u7-gantry-match-hud (SECOND pass).**
  Main moved again between sessions: PR **#294** landed `u7-03`
  (`u7-gantry-lobby-shipselect`), so `origin/main` went `29f2950` → `369d7a6` and
  the ancestry gate flipped back to failing. Merged it: **clean, zero conflicts** —
  u7-03's surface is `lobby-*.ts` / `map-picker-view.ts` / `index.ts`, this
  branch's is `hud.ts` / `instrument.ts` / the HUD views, and the two blocks each
  side added to `tests/mobile/goldens.spec.ts` are disjoint. a1-01's typography
  resolution from `57b9efd` carries forward untouched.
  After: `npx tsc --noEmit` clean, `npm test -- --run` **3824 passed / 230 files**
  (+10 = u7-03's new lobby specs), ancestry gate **passes**.

  **NOT BLOCKED on u7-03.** The previous session's note said to say BLOCKED if a
  conflict with `u7-gantry-lobby-shipselect` appeared. It has since MERGED to
  main, so it is no longer a sibling branch to guess at — it is just main, and
  merging main is the brief. The BLOCKED clause still stands for
  `u7-gantry-upgrade-wheel` if that one ever conflicts while still open.

## DECISIONS

### The textual conflicts — both a1-01's typography repair, both resolved its way

Exactly the conflict r2-01 predicted for the still-open siblings, in two files.

a1-01 (`bb054ad`) deleted each file's private copy of the font stacks and
imported them from `./typography`, because the shared fallback moved
`"DejaVu Sans Mono"` → `"Liberation Mono"` and any file carrying its own copy
would be left behind — one game, two body faces, on the CI runner only. u7-07
rewrote `hud.ts` wholesale onto `./instrument` and carried the stale literals
along, so both sides touched the same lines.

**`src/ui/hud.ts`** — resolved to a1-01's import, keeping u7-07's `./instrument`
vocabulary alongside it. Recorded as *not* a genuine disagreement: u7-07 never
meant to pin a face, it inherited literals it happened to be rewriting around.
Which stack draws what — the reskin's actual decision — is untouched. Note the
alias `FONT_BODY as FONT_NUMERAL` preserves u7-07's 7 call sites unchanged.

`PANEL_FILL` / `PANEL_FILL_ALPHA` / `PANEL_RULE` / `PANEL_RULE_ALPHA` / `RADIUS`
arrived on the same import line and were **dropped**: u7-07 replaced the HUD's
plates with scrims and edge rules, so nothing uses them and keeping them fails
`noUnusedLocals`. Verified the only surviving `PANEL_FILL` mention is prose in a
comment (hud.ts:1841) explaining what the scrim replaced. Rejected the
alternative of re-introducing a use just to keep the import — same call r2-01
made on `build-wheel-view.ts`.

**`src/ui/nameplates-view.ts`** — same repair, but here **both** sides' imports
are kept: `hudTracking` from `./instrument` (u7-07) and `FONT_BODY` from
`./typography` (a1-01). They do not collide.

### The semantic conflict r2-01 hit did NOT recur — checked, not assumed

q8-01 retired `waitForTimeout(500)` for `settleFrames()` across
`tests/mobile/goldens.spec.ts`. On the build-wheel branch that bit, because
`bootFrozenBuildWheel` was a locally-written helper using the old pattern and
git took it verbatim. Here the three clipped HUD-band goldens all boot through
the **shared** `bootFrozen`, which q8-01 already converted — so they inherit the
frame-counted settle for free. They spread the shared `GOLDEN`, so they inherit
its derived comparison timeout too. Verified no `waitForTimeout` survives in
that file (only prose mentions of what it used to be).

`tests/mobile/shot-budget.ts` changed on main but doc-only — no signature
change, `budgetTest` call sites unaffected.

### The goldens — how the re-shoot set was CHOSEN (this is the session's real work)

`fb3f4a6` re-shoots **12** of the 34 goldens. Method, because "which baselines
changed?" turned out to be a genuinely hard question and the obvious answers are
all wrong:

1. **Byte compare is useless here.** Deleted all 34, `-u`, then `git status`:
   **all 34 modified.** Not 34 real changes — the build-SHA stamp in the corner
   is *deliberately unmasked* (`goldens.spec.ts:408`, ~250 inked px = 0.03% of
   the 1% budget) and moves on every commit. Any method resting on `git status`
   over these PNGs reports 100% change forever.

2. **Measure the noise floor, don't assume it.** Re-shot the whole set a SECOND
   time at the same commit and pixel-compared A vs B: **0 differing pixels,
   maxΔ 0, on all 34.** The frozen render is bit-for-bit deterministic. That is
   what makes every other number below trustworthy — without it I could not tell
   a 1% real change from 1% AA jitter.

3. **Separate my drift from inherited drift** with a clean `origin/main`
   worktree (`git worktree add`, node_modules symlinked), re-shot there, then
   three-way compared. Two results:
   - **main is ALREADY drifted from its own committed baselines**: settings
     1.54%, doors 1.51%, title 1.40%, frozen 1.02–1.49%, eliminated 0.57%.
     Almost certainly a1-01's font landing without re-shooting the menu family;
     they survive only because Playwright's YIQ threshold scores them under 1%.
     **Not mine, not in this brief's scope — but flagged in the PR and here.**
     Those baselines are one AA-nudge from going red on someone else's PR.
   - **mine-fresh vs main-fresh** is the clean signal: exactly 12 in-match
     screens move (1.2–5.8%); every other screen moves 0.016–0.040% at maxΔ ~60,
     which is the SHA stamp and nothing else.

   So: committed the 12, **restored the other 22 to main's bytes**. Rejected
   committing all 34 — it would be churn on other briefs' baselines and would
   bake this branch's SHA into files it has no business touching.

**The knife-edge was real, and in the direction the note predicted.** Both
desktop build-wheel goldens PASSED the 1% gate while carrying the *occlusion bug
this branch fixes* — the prompt plate sitting on the wheel, hiding REPAIR
REACTOR's `1/8` and RADAR's `0 / 1 BUILT`. A full frame's changed pixels are
mostly low-contrast grey-on-dark, which the comparator discounts. The three
clipped bands exist for exactly this and they did fire.

Trap for a future session: **a `tail -60` pipeline hides the real exit code.**
`npx playwright test | tail -60` exits 0 even when Playwright fails — the exit
status is `tail`'s. Read the summary line, never the exit code.

### Traps carried forward from the sibling notes

- **`reuseExistingServer` serves a STALE BUNDLE** (a1-01). Killed `vite preview`
  before running anything that shoots pixels. Confirmed only a defunct zombie.
- **`--update-snapshots` rewrites NOTHING on a passing comparison** (r2-01,
  Playwright 1.49). `git status` clean after `-u` is not evidence of "no change".
  Check mtimes, and re-run at zero tolerance for the real numbers.

## NEXT

Items 1–3 of the previous NEXT are **done** (goldens re-shot and justified, PR
body updated, no new PR, no force-push). All four DoD lines pass. Remaining:

1. **The one flake, now settled — recorded so nobody re-investigates it.** The
   mobile run right after the golden commit was `1 failed / 98 passed`, and the
   failure was **not** a golden — `build-wheel-gantry.spec.ts` "a real press on a
   capped wedge is refused" (u7-02's, from main), on *"the real open affordance
   did not open the wheel"*. Confirmed a **load flake**: it passed on identical
   source in the earlier full run; the only change since was 12 PNG files, which
   cannot affect an interaction test; it passed on re-run in isolation; and the
   **full suite then re-ran clean at `99 passed / 0 failed / 87 skipped`**. The
   failing run took 15.3m vs 12.1m — another lane was building concurrently. CI
   carries `retries: 1`, which covers this class.
2. **Not blocked.** `u7-03` merged to main and was taken cleanly.
   `u7-gantry-upgrade-wheel` is still open and still shares `src/ui`; if a
   future merge conflicts with it, say BLOCKED and name it rather than guessing
   at someone else's merge.

## HANDOFF — a finding this brief could not fix

**main's menu goldens are stale and sitting just under the gate.** Measured on a
clean `origin/main` worktree against main's own committed baselines: settings
1.54%, doors 1.51%, title 1.40%, desktop-settings 1.00%, desktop-title 0.78%,
eliminated 0.57%. Consistent with a1-01's font landing without the menu family
being re-shot. They pass only because Playwright's YIQ threshold scores them
under 1% — one antialiasing nudge from going red on an unrelated PR. Out of this
brief's scope and NOT touched here; flagged in the PR body for QA/art. If a
future session sees mystery menu-golden failures on main, this is why.
