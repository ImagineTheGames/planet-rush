# a0-14-the-hangar.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/a0-14-hangar`, cut from `main` @ c13890b.

## BUILT

1. **`f9a374d` — pr-01, the profile.** `src/progression/profile.ts` +
   18 tests. `planet-rush:profile`, `v: 1`, injected storage seam, three load
   paths (current / migrate-forward / fold-with-backup), no reset. Added
   `equipped?: Record<slot, id>` for a0-14.
2. **`ec3d53c` — pr-03, the level curve.** `src/progression/curve.ts` + 13
   tests. base 300 / exp 1.6, bounded `levelForXp`, `frac` in `[0, 1)`.
3. **`77c19da` — the hangar model + the wiring contract.** `src/ui/hangar.ts`
   (+33 tests), the cosmetic contract, `MAIN_MENU_ITEMS` gains HANGAR fourth,
   `FlowScreen` gains `'hangar'`, `menu-nav` gains the node and both edges, and
   `main-menu.test.ts` gains the two-lists-agree block.
4. **`4dfabce` — the view and the wiring.** `src/ui/hangar-view.ts` (real
   `shipSprite` through `drawSprite`), `src/main.ts` sixth screen + seam
   readback, keyboard focus ring on the menu.
5. **evidence** — `evidence/a0-14-hangar/`: desktop, 390 px landscape, and the
   clean-install empty frame, plus `readback.json`.

## DECISIONS

- **The profile did not exist, so this PR builds it.** `src/progression/` was
  empty on main; a0-13 emitted `pr-01` and `pr-03` but nobody had claimed them,
  and both name **UI Engineer** as an owner with `needs: nothing`. a0-14 forbids
  inventing storage ("one profile, one key, one reader"), so the honest move was
  to implement the ratified spec verbatim as separate commits. Rejected: a
  hangar-local key (violates the brief), and BLOCKED (the gate is on the *spec*,
  which exists and is ratified).
- **`ProfileStorage`, not `Storage`.** pr-01's literal spelling shadows the DOM
  lib global inside the file. Same shape; flagged in the PR body.
- **HANGAR is appended, not inserted.** The brief forbids changing the existing
  three items *and their order*; appending is the only reading that is
  unambiguously safe. There is a test pinning the first three and their subs.
- **The wiring test has teeth two ways.** `mainMenuRoute` / `flowScreenHandler`
  are exhaustive switches with `default: return null` — the compiler catches a
  case deleted from the *union*, the tests catch one deleted from the *switch*.
  Proven: deleting both `case 'hangar'`s turns six assertions red (in the PR).
- **The equip write is an effect, not a call.** `flowTapHangar` returns a
  `save-profile` effect, matching the flow's existing no-sockets/no-storage
  rule. A refused equip returns the identical profile, so it writes nothing.
- **Keyboard reach needed a focus ring.** The menu answered exactly one key
  (Enter = PLAY), so "reaches HANGAR by keyboard" was not true of any list-based
  claim. Added `mainMenuStep`/`mainMenuIndexOf`, pure and index-based, with the
  focus starting on PLAY so every existing keyboard path is unchanged.
- **The level block reads, never recomputes.** `levelProgress(profile.xp)`;
  `profile.level` is treated as a cache. The evidence run proved this in the
  shipped bundle by accident — a first-draft seed of 12 000 XP claiming `level:
  7` drew LEVEL 6, which is correct.
- **Private preview port 4188** for the evidence config (lane memory: a green
  run on 4173 can be another lane's stale bundle).

## Traps hit

- `exactOptionalPropertyTypes` — an un-equipped slot must delete the key, not
  set `undefined`; `equipCosmetic` strips `equipped` entirely when it empties.
- A pure share of the band for the level block left a hand's width of dead panel
  on desktop. It is now `min(share, rowHeight × 2.6)` — content-shaped where
  there is height, share-shaped where there is not.
- `tests/net/capacity/capacity-regression.test.ts` fails under CPU contention
  (two vitest runs at once). Green on its own; nothing to do with this branch.

## NEXT

- Nothing outstanding. Full suite green, evidence taken, PR open.
- For whoever picks up the rest of the a0-13 chain: pr-01 and pr-03 are LANDED
  here. pr-04 (accrual) writes `xp`/`matches`; pr-05 (summary) should read
  `levelProgress` — do not re-derive the curve.
