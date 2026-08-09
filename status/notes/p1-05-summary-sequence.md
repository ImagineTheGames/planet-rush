# p1-05-summary-sequence.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as you
work; a future you reads it first. This is a working note, not evidence — "done"
is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/p1-05-summary-sequence`, cut from `origin/main` @ `12c2e2e`.
Contract: `docs/progression-plan.md` §6 (and §5 Task PR-5). **The plan wins where
it and the brief disagree** — annotate any such place in the brief and in the PR.

## THE GROUND THIS STARTS FROM (read before touching anything)

- `src/ui/end-of-match.ts` / `-view.ts` — a0-09's team-aware screen. **Extend, do
  not fork.** `endOfMatchModel` stays pure; the sequence's state is
  `(model, elapsed, skipped)`.
- pr-01 `src/progression/profile.ts` (`loadProfile`/`saveProfile`), pr-03
  `curve.ts` (`levelForXp`, `levelProgress`, `xpToReach`), pr-04 `accrual.ts`
  (`createAccrualObserver`) + `xp.ts` (`xpForMatch`) — all merged in `main`.
- pr-07 merged the four cues: `audio.cue('xpTick', i)`, `audio.xpFill(p)` /
  `stopXpFill()`, `audio.cue('levelUp')`, `audio.cue('xpSettle')`.

## BUILT

(in progress — see git log on this branch)

## DECISIONS (why, and what was rejected)

(in progress)

## NEXT

(in progress)
