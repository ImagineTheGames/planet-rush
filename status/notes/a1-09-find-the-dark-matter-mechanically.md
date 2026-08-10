# a1-09 — find the dark matter mechanically

**Branch:** `agent/platform/a1-09-dark-matter-scan` · **PR:** #368 (open) ·
**Owner:** Platform Engineer

A working note, not evidence. The evidence is `docs/dark-matter-scan.md`,
`evidence/a1-09-dark-matter/`, and the PR.

---

## BUILT

| Commit | What |
|---|---|
| `8afa3d3` | `tools/dark-matter-scan.mjs` — the scan, on the TypeScript compiler API |
| `4c1b200` | deleted `HUB_FRACTION`, the one candidate triage proved DEAD, guarded by a spec |
| `57b0283` | `docs/dark-matter-scan.md` triage of all 278 candidates + the CI gate |
| `64b0c2d` | corrected the report's counts to what the scan actually prints |
| *(this session)* | gate prints its own warnings; `abundanceOf` typo out of the report; this note |

Shipped surface:

- `npm run dark-matter` (report) · `-- --json` · `-- --modules` · `-- --all` ·
  `-- --write-allowlist` · `--project` (scan another checkout)
- `npm run dark-matter:check` — the CI gate, wired into the `ci` job in
  `.github/workflows/ci.yml` between the unit tests and the build
- `tools/dark-matter-allowlist.json` — 278 triaged entries, one reason each
- `tests/tools/dark-matter-scan.test.ts` + `tools/fixtures/dark-matter/` — the
  scan's own spec, run as a subprocess so the EXIT CODE is what is pinned

## Acceptance — re-verified this session, not inherited

Everything below was re-run from scratch rather than read off the committed
evidence files:

- **`matchAbundance` at `51e8445^` (`7e175ac`)**: `prod:0 test:3`, `dark:true`,
  hint `test-only`. Reproduced byte-for-byte against a detached worktree; matches
  `evidence/a1-09-dark-matter/acceptance-51e8445-parent.json`.
- **`matchAbundance` at HEAD**: still `prod:0`, now `test:5`. Still dark, exactly
  as the brief said it would be — `n5-01` fixed the behaviour along a different
  path and left the accessor as uncalled as it found it.
- **The gate, red then green**: appended a dark `export const` to
  `src/platform/wheel-input.ts` → exit 1 naming it; reverted → exit 0. Working
  tree left clean.
- **Every number in the report's §3 table** recomputed off `--json`:
  2769 exports · 1528 dark · self-used 1221/826 · test-only 157/156 ·
  orphan-module 105/80 · unreferenced 37/34 · reexported-unused 8/8 ·
  **278 gated** · 17 unreachable modules · 1198 value exports scanned. All match.
- `npx tsc --noEmit` clean. CI's `Typecheck, test, build` green on #368.

## DECISIONS (and what was rejected)

- **Compiler API, not grep — the brief's own trap.** `matchAbundance` has three
  non-test grep hits at `51e8445^` and all three are prose. `singlePrimary` has
  19 at HEAD, every one a comment. Both would read as live.
- **Four rules for what a "use" is.** A re-export is plumbing; an import with no
  call in the body is not a use; the declaration is not a use; and production
  means *reachable* production — imports followed from `src/main.ts`,
  `server/index.ts`, `allocator/index.ts`, `vite.config.ts`. Without the last
  one, an unwired cluster keeps itself alive, every member "called" by a sibling
  nobody loads.
- **`self-used` is ranked apart and excluded from the gate.** 1221 of the 1528
  raw candidates are a module calling its own helper. That code *runs*; only the
  `export` keyword is wider than the use. Ranking it with the real findings would
  have made the gate 75% noise and 0% value. Rejected: reporting one flat list.
- **The gate ships.** Measured rather than guessed: over the 99 merges to `main`
  in the preceding week it would have fired on 65 exports — about one every other
  merge — and 23 of those carry a DARK verdict. About a third actionable, one
  line of JSON to answer when it is not. That was the bar the brief set for
  gating vs. reporting, and it cleared it.
- **Delta gate, not backlog gate.** Today's 278 sit in an allowlist and fail
  nothing; a *new* one goes red. A check that opens with 278 findings is a check
  everyone learns to skip.
- **A stale allowlist entry is a NOTE, not a failure.** Failing a build because
  someone *fixed* dark matter is how a check gets disabled.
- **Exactly one deletion.** `HUB_FRACTION` — zero references of any kind, and a
  stale mirror of a `build-wheel-view.ts` geometry that no longer exists.
  Guarded (LESSONS §14): `wheel-input.test.ts` presses at 0/0.10/0.22/0.29r on
  two axes and requires every one to miss; watched it go red by setting
  `INNER_FRACTION` back to 0.22 before trusting it. Everything else triaged DEAD
  belongs to another agent — a dark-matter scan that becomes a deletion spree is
  a worse outcome than the dark matter.
- **No behaviour changed.** Nothing was wired up. Wiring an unwired feature is
  its own brief, with the developer's word behind it.
- **This session's two fixes.** `--check` now prints the same "this scan may be
  wrong" warnings the human report does — the tool's own header claimed it did
  and it did not, and the gate is precisely where an unclassified production tree
  (the `allocator/` failure, already paid for once) needs to announce itself.
  And the report's opening line named `abundanceOf`, a function that does not
  exist in this repo.

## Findings worth someone's attention (detail in `docs/dark-matter-scan.md` §4)

DARK, verified: `src/ui/lobby-flow.ts` (25 of 26 value exports dark, 222 spec
references, one caller — the module written so the front-of-match order would
stop living in a comment is itself being consumed as a comment) ·
`src/art/vfx/` + `presenter.ts` (50 dark values, an island no entry point
reaches — the tell stream is sounded and not drawn) · `src/net/link-loss-view.ts`
(the CONNECTION LOST overlay; `installLinkLossView` called by nothing, not even a
spec) · `src/art/atlas.ts` (11 of 12; the texture pooling that was built is not
the pooling that runs — a Platform 60 fps concern) · `mainMenuRoute` (and the
inline chain that replaced it defaults *differently*) · `matchAbundance` itself.

## NEXT

Nothing outstanding on this brief. Remaining items are other agents' calls, not
blockers:

- The §4.1 DARK findings are handed to their owners (UI, Art, Netcode, Gameplay)
  via the report. Wiring any of them is a separate brief.
- §4.2 is flagged "owner to confirm" on purpose — same shape as `mainMenuRoute`,
  confirmed by the scan but not individually read against the production path.
- §4.4 SURFACE is 157 items triaged **by pattern**, and the report says so. It is
  the section most likely to be wrong in the expensive direction (a DARK finding
  filed as SURFACE stays invisible).
- Observation, no behaviour changed: `wheel-input.ts`'s dead zone is
  `INNER_FRACTION` 0.300 of the drawn radius while the hub is *drawn* at 0.319,
  so a press in that thin annulus lands on the drawn hub and hit-tests as a
  segment. Worth its own brief.
- `content/` is the one directory `roleOf()` does not classify. It is JSON and
  contributes no references; the warning is left switched on deliberately.

## If you are resuming this branch

Re-run `npm run dark-matter` before believing any number in the report — every
count in it is reproducible, and that is the point. Do not `--write-allowlist`
casually: it re-baselines the gate and silently accepts whatever is dark today.
