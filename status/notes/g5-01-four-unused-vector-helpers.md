# g5-01 — four unused vector helpers

Branch: `agent/gameplay/g5-01-vec-dead-members`

## BUILT

- Deleted `vec`, `len2`, `dist`, `dot` from `src/sim/vec.ts`.
- Dropped their four entries from `tools/dark-matter-allowlist.json`, so a
  re-introduction fails `npm run dark-matter:check` rather than being silently
  re-allowed (LESSONS §14, the way `n7-01` guarded it).
- Header comment rewritten: it named `len`/`dist` as the magnitude pair, and
  `dist` is gone. It now names `dist2` as what the narrow phase actually calls
  and `len` as what backs `normalize`.

`len` and `dist2` are untouched — see DECISIONS.

## Evidence

`npm run dark-matter`, main vs. branch:

| | before | after |
|---|---|---|
| exports under `src/` | 2768 | 2764 |
| zero production references | 1475 | 1471 |
| of those, values | 1052 | 1048 |

Down exactly four, no new entry. `npm run dark-matter:check` on the branch:
`no new dark exports (219 known, 1188 value exports scanned)`.

All four read `prod:0 orphan:0 test:0 tool:0 self:0 re-export:0` before the
delete — not merely unimported, but with no reference of any kind, including
from inside their own module.

Green: `npx tsc --noEmit` clean; `npm test -- --run` → 279 files, 4855 tests,
all passing.

Guard proven, not assumed: re-appending `export function dot` to `vec.ts` makes
`npm run dark-matter:check` exit 1 with the "wire it up, delete it, or allowlist
it" message. Probe reverted; not committed.

## DECISIONS

**`len` and `dist2` stay.** The names sit one character from two of the dead
ones and `a1-09`'s original note got this pair backwards (`a1-14` corrected it).
Both are live, and by different routes, which is why neither shows up the same
way in the scan:

- `dist2` — three production callers: `src/sim/buildings.ts`,
  `src/sim/projectiles.ts`, `src/sim/step.ts`. It never appears in the
  zero-production-reference list at all.
- `len` — `prod:0 self:1`. Its only caller is `normalize`, in the same file,
  which is itself live in production and in five test files. The scan reports
  self-references separately and the gate ignores them precisely because a
  helper its own module calls *is running*. Reading `prod:0` as "dead" here is
  the trap; `len` is one call away from every `normalize` in the sim.

**Deleting `dist` does not orphan `dist2`.** `dist` was `dist2`'s only in-file
caller, so removing it drops `dist2` to production callers only — which it
already had three of. Confirmed after the fact: `dist2` still does not appear in
the scan's zero-reference list.

**Rejected: leaving the allowlist entries in place.** They would then describe
symbols that do not exist, and a later re-introduction of any of the four would
land pre-blessed and invisible to the gate. Removing them is the whole point of
the guard.

**Rejected: touching `docs/dark-matter-scan.md`.** The brief scopes the change
to `src/sim/vec.ts` and the allowlist. The triage verdict for these four is
already recorded there from `a1-09`/`a1-14`; re-recording is a Director call,
not mine.

**Nothing outside those two files changed.** No build broke — had one broken,
the row would have been wrong and the brief says stop and say so (that is how
`n7-01` saved `connect-trace-view.ts`). It did not.

## NEXT

Nothing outstanding. This was the last untouched row of `a1-09`'s DEAD list.
PR open on the branch; DoD is tsc + suite + the export assertions + green
checks.
