# a0-14-the-hangar.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT
<!-- what is actually finished, with the commit that did it -->

- (in progress) branch `agent/ui/a0-14-hangar` cut from `main` @ c13890b.

## DECISIONS

- **The profile did not exist.** `src/progression/` was empty on main — a0-13
  emitted `docs/briefs/pr-01-profile-store.md` (profile) and `pr-03-level-curve.md`
  (curve) but nobody has built them. Both name **UI Engineer** as an owner and both
  are `needs: nothing`. a0-14 says the hangar "must not invent its own storage —
  one profile, one key, one reader", so the only honest move is to implement
  pr-01 and pr-03 **to their briefs, verbatim**, as separate clearly-marked
  commits, and build the hangar on top. Rejected: a hangar-local storage key
  (violates the brief outright), and BLOCKED (the brief is gated on the *spec*,
  which exists and is ratified).

## NEXT

1. `src/progression/profile.ts` + tests (pr-01 shape, `planet-rush:profile`).
2. `src/progression/curve.ts` + tests (pr-03, base 300 / exp 1.6).
3. `src/ui/hangar.ts` — pure model/layout/hit-test + the cosmetic contract.
4. `src/ui/hangar-view.ts` — Pixi.
5. `FlowScreen` gains `'hangar'`; `MAIN_MENU_ITEMS` gains HANGAR (4th, order of
   the existing three untouched); `menu-nav` gains the node + edges.
6. The wiring test in `src/ui/main-menu.test.ts` (DoD greps that file for a diff).
7. `src/main.ts` wiring + seam; evidence at 390 landscape and desktop.
