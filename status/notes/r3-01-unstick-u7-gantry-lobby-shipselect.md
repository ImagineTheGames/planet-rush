# r3-01 — unstick #294 (agent/ui/u7-gantry-lobby-shipselect)

Working notes. Not evidence — the DoD, the PR and QA attestation are.

## Situation at pickup (2026-08-07)

- Branch HEAD was `c63b74e`, merge-base with `origin/main` was `1c003b4` (PR #292).
- `origin/main` was `03c7b88`. Between base and main: `a1-01` (repaired 15 specs
  the doors/CODEX reskin broke), `u7-04` doors/CODEX, `u7-05` pause/end-match,
  `u8-01` controls label, `u9-01` campaign door, `b1-01` team bots, `m11-01`
  server stress, `q8-01` golden diffs + high-dpi settle.

## BUILT

- `87aeadc` — merge of `origin/main`, seven conflicted files resolved.
- `d1a26e1` — all five lobby goldens re-shot against the merged render, plus the
  frame-cost budget re-measured.

`git merge-base --is-ancestor origin/main HEAD` passes.

## DECISIONS

**The rule applied to every conflict: where this branch and the a1-01 repair
genuinely disagree, the repair wins.** It won three times, and each time this
branch had nothing worth keeping:

- `src/art/materials.ts` — both sides gave `drawBeam` a `height` parameter and
  guarded it. Took main's `width <= 0 || height <= 0`; rejected this branch's
  `Math.max(0, height)` as an equivalent spelling. The materials test that pins a
  zero-height beam passes against main's guard, so nothing was lost.
- `main-menu-view.ts` / `settings-view.ts` — identical code both sides, comment
  wording apart. Took main's comments, which say what the mismatch did on a phone.
- `lobby-view.ts` — this branch had already moved the font stacks to imports from
  `./typography`, which is the same repair a1-01 made, reached separately. Main
  also carried `TEXT_PRIMARY` / `TEXT_DIM`; the re-skin draws neutrals from
  `MATERIAL_SHADES` / `BONE` and references neither, so they are deleted rather
  than left dead. Kept main's warning comment against a second local copy.

**Both sides' work kept, nothing dropped:**

- `goldens.spec.ts` — both branches appended a section. Main's doors/CODEX and
  pause/end-of-match baselines are in full; the five lobby baselines follow them.
- `menu-frame-cost.spec.ts` — this branch had a standalone lobby frame-cost test.
  a1-01 had widened the gate from the title alone to *every static Gantry screen
  reachable from the title, in one pass against one match sample*, and its header
  says a screen added to the set and not added here can peg the runner in silence.
  **Rejected keeping my separate test**; folded the lobby into a1-01's sweep
  instead, reached by pressing SOLO on the doors the test already stands at.
  Measured: match 83.8ms · DOORS 60.3ms (0.7×) · LOBBY 60.2ms (0.7×) · CODEX
  58.2ms (0.7×), ceiling 4×. `measuredSeconds` re-measured to 32 (not my first
  guess of 40).

**The thing no conflict marker showed.** `lobby-geometry.ts`'s conflict was only
the import line. Underneath it, `contentBox` — the pre-Gantry layout helper — had
lost its last caller: u7-03 moved `lobbyLayout` onto `gantryFrame`, u7-04 moved
`entryLayout` onto it the same way, and each branch still saw the other's screen
using the old helper. `tsc` found it; it is deleted. `LOBBY_PAD` stays because
`./menu-geometry` publishes its page margin against it, with its doc comment
corrected to stop claiming the doors lay out to it.

**Goldens.** All five lobby baselines were shot pre-merge with `FONT_BODY` still
naming `"DejaVu Sans Mono"`; a1-01 moved it to `"Liberation Mono"` precisely
because the container and the runner disagreed about the first. Only the two
phone FFA shots went red. The other three **passed while still being wrong** —
forced fresh and byte-compared they were 3.33% / 3.28% / 2.03% different, under
Playwright's per-pixel threshold but eating the 1% ratio budget. Re-shot all
five so every committed baseline is the byte-truth of the merged render. Eyes on
each; in every diff image the red sits only on body-face strings and every
Audiowide heading is untouched, which is the signature of that one change.

## NEXT

- Push and update #294's body. **Do not open a new PR** — #294 is the one that
  has to go green.
- Nothing is blocked on another stuck branch: this resolution depends on no
  Gantry branch except the ones already merged to main.
- If the chain recurs: the Gantry branches were briefed as parallel work all
  editing `src/ui` from different fork points. `contentBox` is the concrete cost —
  two branches each half-migrated the same helper and neither could see it.
