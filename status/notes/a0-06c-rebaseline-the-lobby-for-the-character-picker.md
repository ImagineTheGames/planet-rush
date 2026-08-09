# a0-06c-rebaseline-the-lobby-for-the-character-picker.md — working notes (bots)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/bots/a0-06-pick-the-character` — the SAME branch as a0-06. See
`a0-06-pick-the-character-not-the-tier.md` (1516 lines) for the feature work.

## READ THIS FIRST — the brief's premise expired before the brief ran

**PR #319 is MERGED.** It merged at **2026-08-09 06:30:57 UTC**, ~40 minutes
before this session started, carrying its own re-baseline of the five lobby
goldens (`08754f2`). Main's push run `31299052491` at `22bf4e7` is **green on all
six mobile shards**. The four red goldens the brief describes are green.

So items 1 and 2 of the brief were already done by a0-06's last session:
- **merge `origin/main`** — done at `a745e47`; the local branch is now `22bf4e7`,
  bit-identical to `origin/main`, because main merged this branch.
- **re-baseline the lobby goldens** — done at `08754f2`, five frames, in main.

What had **never** been done is item 3 — *confirm what changed is only the seat
rows* — and that is what this session did. It does not pass. See REGRESSION.

## BUILT

1. **`evidence/a0-06c-lobby-rebaseline/`** — the audit, ~1.5 MB, 12 full frames +
   8 zooms + two measurement transcripts + two tools. `README.md` is the writeup.
   Committed in `<see git log>`; nothing else on this branch changes.
2. **No PNG under `tests/mobile/goldens.spec.ts-snapshots` is touched, and that
   is a RESULT, not an omission.** Proof in DECISIONS below.

## DECISIONS

- **Three renders, not two.** A re-baseline PNG blends three separate briefs'
  changes, so the audit built:
  - **A** = the baseline CI compared against pre-#319 (a0-07, `7ffc837`)
  - **B** = what main **without** the picker renders **today** — a throwaway
    `git worktree` at `2d3f29b`, five baselines deleted, forced fresh writes
  - **C** = the baseline that landed with #319
  `B→C` is a0-06's own delta. `A→B` is everyone else's un-baselined drift.
  Without B you cannot tell them apart, and the a0-06 commit's claim about
  a0-11/a0-12 was an assertion until B existed.
- **`--update-snapshots` CANNOT answer "is this baseline stale".** It leaves a
  snapshot alone when it passes within `maxDiffPixelRatio`, so it cannot separate
  *matches* from *drifted but under budget*. `rm` the file and force the write.
  (Same trap the a0-06 note flags; it is worth its own line because it is the
  whole method.)
- **Private ports, always** — `PREVIEW_PORT=4196` (branch) and `4197` (worktree).
  Shared 4173 is `reuseExistingServer: !CI` across three lanes; a run there can
  shoot another lane's bundle into your baselines. The build badge in the footer
  names the tree that was actually served, so the bundle is verified not assumed.
- **Control run first, before trusting anything:** five lobby goldens + three
  untouched SETTINGS goldens against the committed baselines → **8 passed**. The
  container reproduces CI.
- **Rejected: re-shooting the five frames to satisfy the DoD's snapshot-diff
  line.** Measured, a fresh forced write differs from the landed baseline in
  **one band only — the build-sha stamp** (`5c7b991*` → `22bf4e7*`; desktop rows
  782–789, phone rows 371–378). The baselines already depict today's render
  exactly. Re-shooting would commit a new sha stamp under a message claiming a
  seat-row re-baseline — a false claim in the history, to make a gate go green
  that has already been satisfied by #319. Not done. See NEXT for the DoD status.
- **Rejected: adding a golden of the codex opened from a bot row's `?`** to make
  the snapshot gate pass honestly. `tests/mobile/` is QA's, a new test needs a
  measured entry in the shard cost table and a `budgetTest` declaration, and the
  `?`-by-tap-at-390px path is already covered by `lobby-cast.spec.ts`. Adding a
  redundant test to another agent's suite to satisfy a mechanical check is the
  wrong instinct.

## ⚠ REGRESSION FOUND — and it is in main

**`phone-landscape-lobby-teams`: the side label is no longer a word at 390 px.**

The `?` is a **sixth** column on a row that already carried five, and at 390 px
the team chip is what gives up the width. The P3 row's `FRIENDLY A`, measured as
chip ink (`evidence/…/measure-team-chip.txt`):

| | chip ink | the word's box |
|---|---|---|
| before (main without the picker) | 115 px | 56 × 6 px |
| after (landed baseline) | **33 px** | **19 × 3 px** |
| desktop control | 239 px → **239 px** | 71 × 24, only *translated* 38 px left |

Desktop is bit-for-bit identical and merely moves. The 390 px chip loses 71 % of
its ink and draws `FRIENDLY` as eight glyphs in 19 px at a 3 px cap height. `EASY`
beside it stays legible, which is what makes it unarguable. Look at
`evidence/a0-06c-lobby-rebaseline/zoom/2-teamchip-390-{before,after}.png`.

Why it is a defect: GDD §2.1 — *"Color reinforces the word; it never replaces it
… the readout survives with the hue removed"* — and §2.2 records that the label
exists because a Teams match was played where it was *"impossible to know who is
on your team."* A label legible only by hue is the exact failure the amendment
was ratified to prevent, on the platform §2.4's parity principle protects.

**The screen already knows the right answer.** `src/ui/lobby-view.ts:657` drops
the hull sub-label **whole** rather than scaling it — *"`EXCAVATOR` fitted into
40px is a 5px smudge, not a word."* The team chip does not follow that ladder; it
scales into exactly the smudge the ladder forbids. Likely fix: drop to the
absolute letter `A`/`B` (§2.1: the letter is the half that keeps sides apart) and
drop the relative word whole when it will not fit.

**NOT FIXED HERE.** `src/ui/lobby-view.ts` is the UI Engineer's; this lane does
not touch `src/ui/`. Both the `?` and the side label are ratified, so the
collision is a design call. Escalated in the PR body — needs a UI brief.

**Non-defect, recorded so it is not re-opened:** the hull sub-label is dropped
from the longer classes at 390 px (`Bolt` loses `INTERCEPTOR`, `Foreman` loses
`EXCAVATOR`; `HAULER` survives). That is the same `twoLines` ladder working as
designed — dropped whole, not clipped. `zoom/1-hullline-390-*.png`.

## What a0-06 itself moved, for the record (brief item 3, answered)

Desktop `B→C`: **one band, y 238–679, x 152–746** — inside the roster panel
(x 44–751). The arena cards start at **x 765** and show **zero** differing pixels;
so do the hull tiles, the header, `MODE`, `YIELD`, `BACK`, `RUSH!` and the
`1 PLAYING · 7 BOTS` footer. The band begins at y 238 = the top of the **P2** row,
so the human's `YOU` row does not move in FFA. Inside the roster: the `?` cell,
the tier moving 38 px left onto the inert surface, and the three Hard characters
rotating one seat (`Vulture/Warden/Sable` → `Sable/Vulture/Warden`; same cast,
same per-seat tiers). In TEAMS the band starts at y 175 because P1 carries a side
chip in TEAMS and none in FFA, so its row shifts with the column.

`A→B` (**neither side contains the picker**, and they still differ by 22 214 px):
`OPEN`→`BOT` in the state column (x 64–102) is **a0-11**; four arena cards → six
(y 572–679, x to 1227) is **a0-12**. Both landed on main without re-baselining and
hid under the 1 % budget. That content is in the new baselines and **is not
a0-06's**.

## NEXT

- **The regression is the only outstanding work and it is not this lane's.**
  Director: it needs a UI brief against `src/ui/lobby-view.ts` `drawTeamChip`,
  plus a re-baseline of `phone-landscape-lobby-teams` once fixed (and a check of
  whether the fix reflows `phone-landscape-lobby`).
- **DoD status, stated honestly rather than gamed:**
  - `npx tsc --noEmit` — clean.
  - `npm test -- --run` — see the PR body for the count.
  - snapshot-diff vs `origin/main` — **FAILS, and correctly.** main *contains*
    this branch's re-baseline (#319), so the diff is empty by arithmetic. This is
    the same expired-gate shape a0-14b hit at session 3: a pre-merge gate that
    stops holding the moment the branch merges. The measurement proving the
    baselines are current is in `evidence/a0-06c-lobby-rebaseline/` PART 1.
    **Do not "fix" it by re-shooting.**
  - `merge-base --is-ancestor origin/main HEAD` — passes.
  - the PR-state line — passes; `#319` is `MERGED`, and the new PR is green.
- **Keep BOTH copies of this note in step** — `/status/notes/…` (the shared 9p
  mount) and `status/notes/…` (the repo copy the DoD sees). `diff -q` them.
- **Do not re-shoot any lobby golden without re-reading the "Rejected" bullet
  above.** The five frames in main are current; the only thing that moves on a
  fresh write is the build sha.
