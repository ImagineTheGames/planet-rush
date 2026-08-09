# p1-01-profile-store.md — working notes (platform)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT

**The module already existed when this lane opened.** `src/progression/profile.ts`
landed on main in `d3df684` (+ `ebaff59`), written by the Sound Agent inside the
**a0-14 hangar** branch (PR #333, merged 2026-08-09) because a0-14 was
`needs:`-gated on a profile that did not exist. It is a faithful implementation
of this brief — all seven of the brief's "test first" cases are present and green
— so this branch is NOT a re-implementation. Do not rewrite it; check the branch
history before touching anything.

What this branch adds, on top of that, is the three places where the shipped
module did not yet meet its own stated contract:

- **The migration ladder now composes** — `MIGRATIONS` was a single hop straight
  to `PROFILE_VERSION`; it is now one rung per version and `migrate()` walks
  them. Plus `MIGRATABLE_VERSIONS` and a **no-gaps test**, so bumping the version
  without adding a rung is a red test.
- **`saveProfile` is guarded by the reader** and returns `boolean` (was `void`).
  It refuses to write a profile `loadProfile` would reject, and leaves the stored
  career untouched when it does.
- **`level` is reconciled against `xp` on read.** The file already *documented*
  this rule ("a reader that finds them disagreeing trusts `xp`") and did not
  implement it.

Evidence: `evidence/p1-01-profile-store/readback.{ts,json}` — the four load paths
and the write guard, off a real seam, with the backup case as a before/after of
both keys (the brief's evidence line).

## DECISIONS

- **Why the migration ladder mattered enough to change working code.** A rung
  that jumps straight to current reads fine today and rots the day `v:2` ships:
  the `v:0` rung would stamp `v:2` onto a shape that never met `v:2`'s rules, so
  the OLDEST profiles — the ones with the most career in them — fold to fresh
  while newer ones migrate cleanly. Migration is the only repair tool this
  profile will ever have (no reset ships, developer 2026-08-07: *"no."*), so a
  repair tool that silently stops covering the oldest cases is the exact failure
  the module exists to prevent. Single rungs + a no-gaps test make the shipped
  comment ("the day `v:2` ships, `1` gains an entry and nothing else changes")
  true, which it was not.
- **Why the write guard.** `JSON.stringify({xp: NaN})` is `{"xp":null}` — no
  throw. The read side is paranoid and the write side had nothing at all, so an
  accrual bug at pr-04's single write site would put an unreadable blob on disk
  and the loss would surface on a *later* boot, far from the cause. The backup
  key makes that recoverable-by-hand; recoverable-by-hand is not the promise.
- **Rejected: `throw` on a bad write.** The write happens on the way out of a
  match — a throw there loses the match just played. Refuse, return `false`.
- **Rejected: repairing a bad write** (e.g. `NaN` → 0). Repair-to-zero *is* the
  wipe. Refusing keeps the last good profile on disk.
- **`void` → `boolean` on `saveProfile`** widens the brief's sketched signature;
  it breaks no caller (`src/main.ts:7097` ignores it) and `tsc` is clean.
- **Reconciliation is only for a WELL-FORMED level.** A junk level (`null`,
  `"4"`) still folds the whole blob, because the brief's corrupt case requires
  it and a payload that malformed is not one to mine a career out of. A
  well-formed cache that merely drifted is repaired. Two existing fixtures had
  inconsistent `(xp, level)` pairs (`xp:4211, level:5` — 4211 buys level 4) and
  were corrected to `xpToReach(L)`; that they were inconsistent at all is the
  drift this repair exists for.
- **Left alone deliberately: the backup clobber.** A second corruption
  overwrites the first backup. Every fix needs either a second key or the
  seam's `remove`, and the brief forbids both ("pr-06 adds `remove`; do not add
  it in this brief"). Flagged in the PR for pr-06, not fixed here.
- **`equipped?: Record<slot,id>` is a departure from plan §2.1's shape**, added
  by a0-14. Kept: it passes the plan's own device-independence test, and the
  hangar is merged on it. Raised in the PR as a plan-vs-shipped note.

## NEXT

- **DONE. PR #342 is MERGED** (`be3c5dd` on main). All four DoD gates PASS on
  the merged state, re-taken 2026-08-09c: `tsc --noEmit` clean; suite 255 files
  / 4423 tests / 0 failures; `origin/main` an ancestor of HEAD; PR state MERGED.
- One housekeeping step that session: the ancestor gate had gone red for a
  purely mechanical reason — main was exactly one commit ahead, and that commit
  *was* #342's own merge. Fast-forwarded the branch onto `be3c5dd` and pushed
  (ff-only, no rebase). `git diff origin/main...HEAD` was already empty before
  the merge: every deliverable was in main. Nothing was rebuilt.
- **Session 2026-08-09b: main moved twice under this branch, both merged.**
  The rest of the P1 chain landed while #342 sat open:
  - `#344` **p1-03 level curve** — added `src/progression/curve.test.ts` (15
    tests) and evidence. It did **not** touch `curve.ts`, so the `xpToReach`
    that this module's read-side reconciliation calls is semantically
    unchanged; the fixture corrections under DECISIONS still hold. Both
    progression suites green together (15 + 25 = 40).
  - `#343` **p1-02 attribution hook** — entirely `src/sim/` (`combat-credit.ts`,
    the write-only credit ledger + `by: PlayerId` on the damage path). No
    overlap with `src/progression/`. This is the upstream half of the same
    chain, not a competing profile write.
  Neither merge conflicted. Gates re-taken on the merge actually proposed each
  time — the branch is only ever fast-forwarded onto main, never rebased.
- For whoever takes **pr-06**: backup rotation (see the clobber above) wants the
  `remove(key)` that brief adds.
- For whoever takes **pr-04** (accrual, the single write site): `saveProfile`
  now returns `false` instead of writing garbage — check it. Note the chain is
  now joined at both ends — p1-02 emits `world.credit`, pr-04 consumes it and
  writes through this module's guard. `DAMAGE_HP_PER_UNIT` is pr-04's constant;
  p1-02's ledger stores raw HP.
