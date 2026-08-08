# a2-05-unstick-the-cutterhead-pr.md — working notes (art)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## The job in one line

Merge `origin/main` into `agent/art/a2-03-planets-biomes` so #312 picks up
#311's golden retry, re-run, report honestly. **Add no art. Re-baseline nothing.**

## BUILT

- **`72037be` — merge `origin/main` (`eb75891`) into the branch. No conflicts.**
  `git merge-base --is-ancestor origin/main HEAD` now passes (DoD 4).
  The merge brings #311's golden retry (`d2797dc`), #310's art evidence
  (`81f5b76`) and #300's upgrade wheel (`eb75891`).

- **The merge changed exactly ONE file relative to the branch tip: `style-guide.md`,
  and only §2.1.** Diffed `092210e..HEAD` over `src/art/`, `src/render/`,
  `assets/`, and the frozen goldens — **empty**. The Cutterhead's geometry, the
  five re-baselined goldens and the contact-sheet captions are byte-identical to
  what a2-03 shipped. §5 (THE CUTTERHEAD) is untouched; what came in is u7-06's
  §2.1 scope clarification ("build wheel" → "Build & Upgrade wheel"), which is
  main's and belongs to the UI lane. Nothing needed resolving "the Cutterhead's
  way" because nothing on main had touched the Cutterhead.

- The five goldens still differ from `origin/main` — same five files, no more,
  no fewer. No snapshot added, none re-shot.

## DECISIONS

- **The before-number, captured before touching anything.** #312's last mobile
  run is GitHub Actions run `31216242940`, job wall **45m58s**, summary
  **`2 failed / 94 passed (45.3m)`**. Both failures are
  `Test timeout of 90000ms exceeded` on `toHaveScreenshot`; the log carries
  **zero** "screenshot comparison failed". Nothing was captured, so there is no
  diff and nothing to re-baseline. This is the brief's premise, verified rather
  than assumed.

- **#311's fix is real and it is on `main`.** `d2797dc` merged it;
  `tests/mobile/shot-budget.ts:279` exports
  `GOLDEN_RETRIES = goldenRetriesFor(!!process.env.CI)` and
  `tests/mobile/goldens.spec.ts:42` applies it at file scope.
  **`goldenRetriesFor(false) === 0`** — the extra attempts are CI-only by
  design. So a local `npm run test:mobile` here does NOT exercise the fix; it
  only proves the merge did not break the art. The fix is proved by CI on the
  merge commit, and that is the "after" number that belongs in the PR body.

## NEXT

1. Merge `origin/main`. Watch `style-guide.md` (both sides moved) and
   `tests/mobile/goldens.spec.ts` (main +154, branch touched only its snapshots).
2. `npx tsc --noEmit`, `npm test -- --run`, `npm run test:mobile` — the mobile
   run detached on a private port, per the lane's standing traps.
3. Push, update the PR body with before/after and no snapshot in the diff.
4. If a golden still times out after the merge: report it with the wall time and
   STOP. That is #311's problem, not this branch's.
