# a0-04 — ship names are always lit (working notes)

Branch: `agent/ui/a0-04-nameplates-always-lit`. Brief: the developer, 2026-08-07 —
*"sometimes other ships names are dim and sometimes they are lit, they should
always be lit...."*

## BUILT

- **The fade is retired, not neutered** (`src/ui/nameplates.ts`).
  `NAMEPLATE_FADE_ALPHA`, the `fadeAlpha` option and the private `underClutter()`
  predicate are gone; `nameplateModel` stamps one alpha on every plate. The two
  fields that fed the fade — `Nameable.inCombat` and `Nameable.hpFraction` — are
  off the interface, so nothing can dim one plate for what its ship is doing.
- **`src/ui/index.ts`**: dropped the `NAMEPLATE_FADE_ALPHA` re-export; added
  `nameplateClusterClearance`.
- **`src/ui/nameplates-view.ts`**: the private `clusterClearance()` is now the
  exported pure `nameplateClusterClearance(plate)` — rule 3's surviving half, so a
  unit test can pin it without a GPU. `DrawnNameplate` also reports the `alpha` it
  drew at, so the live-stage suite and the evidence capture can quote the number
  rather than assert it.
- **`src/main.ts`** (the nameplate feed only): `feedNameplates()` no longer copies
  `ship.firing` / hull fraction into the record, and `MutNameable` loses the two
  fields. Called out in the PR body as a wiring trim outside `src/ui/`.
- **Tests re-pointed, not deleted** (`src/ui/nameplates.test.ts`): the three
  `FADE_ALPHA` pins are now "damaged, fighting and calm all resolve to full
  alpha", plus a new `describe` pinning that the label still sorts above the bar
  cluster (label bottom < bar top, off the health-bar layer's own geometry, for
  every ship radius). 45 tests pass.
- **Live-stage** (`tests/live-stage/nameplates.spec.ts`): a second test damages an
  enemy to 35% via the health-bar stage seam, then asserts every drawn label in
  that frame shares one alpha (0.92) and the lit label still sits above the bar.

## DECISIONS

- **Retire rather than alias.** `FADE_ALPHA = FULL_ALPHA` would leave a constant
  that exists and does nothing — the next person's puzzle, and an invitation to
  re-point it. The brief asked for the seam only if it earns its keep; it does not
  (no caller ever passed `fadeAlpha`).
- **`fullAlpha` stays.** It is per-LAYER, not per-plate: a caller can dim the whole
  nameplate layer, but cannot make two ships differ, so it cannot reproduce the
  bug. A test pins that.
- **`NAMEPLATE_TEAM_ALPHA` (0.85) and `NAMEPLATE_SUFFIX_ALPHA` (0.55) untouched.**
  The developer said *names*; those two are a hierarchy *inside* one plate (side
  tag, difficulty tag), constant per plate, and nothing in the report contradicts
  them. Stated in the PR body.
- **Kept rule 3's intent in geometry.** The label was never *only* dimmed — the
  view floats it above the whole bar cluster. That inequality is now the only thing
  holding "the health bar owns the eye", so it was lifted out of the draw loop into
  an exported, tested function.
- **Rejected:** re-deriving "in combat" inside the nameplate model to fade
  something else (e.g. the suffix) — the developer withdrew the mechanism, not
  just its magnitude.

- **Evidence** (`evidence/capture-a0-04-nameplates.mjs`, images `a0-04-nameplate-*`).
  Frozen PAIR: `damageEnemy(1)` then `stageBot()` parks the bot at a fixed spot
  clear of the home-station art; `damageEnemy(0.35)` + `stageBot()` puts the SAME
  ship back at the SAME spot at 25/70, so the two crops differ in one variable.
  Live BRAWL: past spawn protection (`ticks > 700`, else the damage is absorbed),
  damage every bot through `__planetRush.damageShip` until ≥3 labelled ships wear
  bars, then shoot the frame. The live frame is bracketed by two readbacks — the
  sim is not frozen, so neither list matches the picture exactly, and both print.

## VERIFIED

- `npx tsc --noEmit` clean; `npx vitest run` 234 files / 3899 tests pass.
- Live-stage `nameplates.spec.ts` (2 tests) green against this branch's own
  preview build (sha `a080840`) on a private port — 4173 is shared across lanes.
- Looked at every frame. Pair: "Rusty (EASY)" identical brightness, calm vs
  25/70. Brawl: Warden 39/55, Sable 15/35, Rusty 54/70 — all lit, every bar
  readable directly beneath its name. Every drawn alpha in all three scenes: 0.92.

## NEXT

- PR open; nothing outstanding. If a future brief wants the own-ship label on,
  `showOwnShipLabel` is still the seam — untouched here.
