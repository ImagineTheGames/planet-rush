# r14-01-unstick-a0-34-behind-the-scheme-branching.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/a0-34-teach-the-objective` (PR #405). Rescue of a CONFLICTING
PR whose session ended, NOT new work.

## BUILT

- **`b437eb1` — the merge itself.** `origin/main` (a0-33, #404) into the branch.
  Three files conflicted (`src/ui/onboarding.ts`, `src/ui/hud.ts`,
  `tests/live-stage/haul-prompt.spec.ts`); `src/main.ts` and
  `src/ui/onboarding.test.ts` auto-merged, and `PROMPT_ORDER` auto-merged into
  exactly the order the a0-34 note predicted. Both features kept, in full:
  - `PROMPT_ORDER` = UNDER-ATTACK, **OBJECTIVE**, MINE, HAUL-HOME, SPEND,
    **CONTROLS** — goal, then verbs, then settings, siege above all of it.
  - the OBJECTIVE entry in `PROMPT_COPY` now declares `manual` / `autoAim` /
    `tap` and resolves through `lessonFor`, i.e. it goes THROUGH a0-33's branch.
    All three slots carry the same ratified sentence, because the objective
    names no gesture.
  - `CONTROLS_TIP_SECONDS` + `controlsSeconds` folded into a0-34's
    `DWELL_SECONDS` table + `dwelled` map. One mechanism, two rows (both 8 s).
  - `OnboardingSignals.time` keeps BOTH no-clock rules, and the merged doc says
    why they differ: OBJECTIVE is withheld (top of the order — an un-retiring
    one would sit on the mining lesson), CONTROLS stays up (last — blocks
    nothing). Behaviour of each is unchanged from its own brief's.
  - `resolvePromptText` keeps a0-33's required 4th `scheme` arg; `hud.ts` keeps
    feeding `frame.time`.
- **`bbc0c71` — evidence.** `evidence/r14-01-objective-behind-the-branching/`
  (`readback.ts` + `readback.json`): a0-33's readback re-run against the merged
  module. `sixReadings` is the brief's deliverable; `objectiveAcrossTheSix`
  proves ONE distinct sentence across all six with all four beats present;
  `firstMatch` walks the real machine with the clock fed. a0-33's own evidence
  directory is left untouched — it is that brief's record.

## DECISIONS

- **Same sentence in three slots IS scheme-aware, and going through the branch
  is what the brief asked for.** The alternative reading — write three different
  objective lines — was rejected: the four beats are ratified copy, none of them
  is a gesture, and a scheme-specific objective would turn a mission statement
  into a fifth control lesson (and collide with MINE, which already teaches the
  gesture). What matters is that OBJECTIVE is not exempt from `PromptCopy`'s
  three required fields: a prompt allowed to skip `tap` is exactly how one
  silently teaches the wrong scheme, which is the bug a0-33 fixed. The slot is
  there the day the objective needs different words under Tap Commander.
- **The line reads fine under all six** (brief item 3's "fix it now" clause did
  not fire). It is now the LONGEST string the game authors — 106 chars, ahead of
  a0-33's Tap Commander haul sentence — so it was measured on the 390 px phone:
  3 lines, 65 px panel against a 324 px cap, bottom edge 340 against a visible
  bottom of 356. Fits.
- **a0-33's CONTROLS tests start from `afterTheObjective()`**, a machine built on
  a memory that already holds OBJECTIVE. Nine of them went red on the merge for
  one reason: they feed `time` (for the CONTROLS dwell) and the objective now
  outranks what they were asserting. Seeding the memory is honest rather than a
  workaround — u15-01 makes "objective already read" the state of every match a
  player plays but their first, which is the only career the CONTROLS tip lives
  in. Their assertions are unchanged. Rejected: shifting every absolute `time:`
  in those tests (fiddly, and it would have buried a0-33's own numbers).
- **The codex half merged clean, as predicted.** a0-33 touched no codex file; the
  merge commit changes nothing under `content/` or `src/ui/codex.ts`.
  `CODEX_TABS` is OBJECTIVE, BOTS, SHIPS, SYSTEMS, STRATEGY — the new section
  first, the existing four in main's own relative order.
- **No golden collision.** a0-33 rewrote only the `haul-prompt-*-evidence.png`
  screenshots; a0-34 rebaselined `tests/mobile/goldens.spec.ts-snapshots/`.
  Disjoint sets, and a0-33's copy changes are invisible in the golden scenes
  because the OBJECTIVE band outranks MINE there anyway.
- **Merge commit message amended** rather than left as git's default: the whole
  point of this branch now is what the merge decided, and `git log` is where the
  next session looks first.

## NEXT

- Nothing blocking. Remaining: push, update the PR body with the six readings,
  confirm `mergeable` flips off CONFLICTING and checks stay green.
- Still open from a0-34 and unchanged by this rescue: the NEW COPY (the prompt
  and both codex entries) awaits the developer's approval of the *wording* — the
  substance is ratified. a0-33's new copy (the Auto-aim and Tap wordings of MINE,
  the Tap wording of HAUL-HOME, and the whole CONTROLS tip) is in the same
  position.
- `content/codex/` and `tests/codex/` are the Gameplay Engineer's by their file
  headers; touched by a0-34 because its brief's one-to-one contract required it.
  Flagged in the PR, and unchanged by this rescue.
