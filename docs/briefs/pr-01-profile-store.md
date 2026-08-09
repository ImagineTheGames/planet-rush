# pr-01 — the profile: one versioned blob that can never be reset, so it must be migratable

**Owner:** Platform Engineer + UI Engineer · **needs: nothing** — claimable today
**Plan:** `docs/progression-plan.md` §2.1 · **GDD:** §4.1 (the `platform.ts` seam)
**Blocks:** pr-05, pr-06

---

## The ask

The game has **no profile, no career, no stored identity**. Every persisted value today is a
bare string under a flat `planet-rush:*` key — fire mode, control scheme, hull, name, map,
haptics — read defensively, folding any missing or corrupt value to a safe default
(`readFireMode` / `readControlScheme` / `readMapId`, `src/main.ts`). A progression record is the
**first structured, post-match-mutated thing the game persists**, and the first payload that
needs a version.

Build that, and nothing else. No UI, no XP, no accrual — this brief is one module and its tests.

```ts
// src/progression/profile.ts (new)
export interface Profile {
  v: 1;              // schema version — the FIRST versioned payload in the store
  xp: number;        // lifetime XP
  level: number;     // derived from xp, cached for the UI
  matches: number;   // lifetime matches played
  unlocked?: string[]; // phase 2 cosmetics; absent in phase 1
}

export const PROFILE_KEY = 'planet-rush:profile';
export const PROFILE_BACKUP_KEY = 'planet-rush:profile.bak';

export function loadProfile(storage: Storage): Profile;
export function saveProfile(storage: Storage, p: Profile): void;
```

`storage` is **injected**, exactly like `createBrowserHaptics(platform.storage)`
(`src/main.ts:264`). A progression module that takes the seam as a dependency tests headless and
never touches a browser global.

> **AS SHIPPED** *(amended p1-01, 2026-08-09 — this brief was implemented inside a0-14/PR #333
> before this lane opened, then hardened on `agent/platform/p1-01-profile-store`).* The sketch
> above is accurate except in three details, and pr-05/pr-06 should read the module, not the
> sketch:
>
> - **`ProfileStorage`, not `Storage`** — `Storage` is a DOM lib global and a local interface by
>   that name shadows it silently. Identical shape; `platform.storage` passes straight in.
> - **`saveProfile` returns `boolean`, not `void`** — it validates with the same reader that will
>   read it back and refuses a profile `loadProfile` would reject, leaving the stored career
>   untouched. `JSON.stringify` turns `NaN` into `null` without a murmur, so an unguarded write
>   site loses a career on a *later* boot.
> - **`equipped?: Record<slot, id>` is on the shape**, added by a0-14 and absent from plan §2.1.
>   Unlocking and equipping are different verbs, and it passes the plan's own device-independence
>   test. Kept, and flagged here because the plan's shape does not show it.
>
> **Plan vs brief: checked, no conflict found.** Everything else here agrees with
> `docs/progression-plan.md` §2.1.

## Why this one is load-bearing out of proportion to its size

**Progression is never wiped** — the developer's own ruling, 2026-08-07, verbatim: *"no."* There
is no reset button, and this brief must not add one. That single answer turns an ordinary
storage module into the one below, because it removes the escape hatch every other persisted
value in this game has: *if it breaks, clear it.* **Migration is the only repair tool this
profile will ever have.** A stored profile with no version is one nobody can fix — not the
developer, not a support answer, not a future you.

## Test first

1. **Round trip.** A fresh profile saves and loads back equal to itself.
2. **Absent.** No key ⇒ `{ v: 1, xp: 0, level: 1, matches: 0 }`.
3. **Corrupt.** A non-JSON blob, and a JSON blob with the wrong field types, both fold to the
   fresh profile — the `readMapId` discipline, field by field, not a blanket `as Profile`.
4. **Forward-compatible.** A `{"v":2,...}` blob **does not crash** a `v:1` reader; it folds.
5. **Nothing is destroyed silently.** Any blob that fails to parse or validate is **first copied
   verbatim to `planet-rush:profile.bak`**, then folded. This is the test that gets skipped, and
   it is the only thing standing between a schema bug and a wiped career the player was promised
   would never be wiped.
6. **Migration seam exists and is exercised.** `migrate(raw: unknown): Profile | null` is called
   for a *known older* version and its result is used. Ship it with one entry (`v0 → v1`, an
   identity for a shape that never existed) so the path is live, tested, and not written for the
   first time on the day it is needed.
7. **Headless.** Every test above runs against an in-memory `Storage` double. No `localStorage`,
   no `window`.

## Traps

- **The seam holds strings only** (`platform.ts:36-39`). `JSON.stringify` on write, `JSON.parse`
  **plus per-field validation** on read.
- **The seam has no `remove` and no `keys`.** You do not need them here — pr-06 adds `remove`.
  Do not add it in this brief; do not reach around the seam to `localStorage` to get it.
- **Do not add a reset.** It was in the s4 plan as Task P5 and it is cancelled. If you find
  yourself writing `clearProfile`, re-read §Q4.
- **No device-specific fields, ever.** No screen size, no input scheme, no install id, no "last
  map" — those are settings and already have keys. The test: *would this number still be true if
  the player picked up a different phone and signed in?* If not, it is not a profile field. A
  later backend must be a **sync** problem, not a rewrite.
- **No sim import.** This module must not reach into `src/sim/`; the sim must never read the
  profile (determinism, GDD §4.8).

## Definition of Done

```
npx tsc --noEmit
npm test -- --run
bash -c "git ls-files src/progression/profile.ts | grep -q ."
bash -c "grep -rn 'localStorage' src/progression/ | grep -v '\\.test\\.ts' | wc -l | grep -q '^0$'"
bash -c "git fetch origin main && git merge-base --is-ancestor origin/main HEAD"
```

## Evidence line

The seven tests above, green, in the PR body — plus the **backup** case shown as a before/after
of the two storage keys, because that is the one a reviewer cannot take on trust.

## Open questions this brief is exposed to

**None.** Nothing in the developer's five open questions touches the profile shape.
