# a0-86 — explosions may burn red

Branch: `agent/art/a0-86-red-explosions`. Owner: Art Agent.

**A colour round on the existing lab. Nothing is ported and nothing in `src/`
renders differently** — the only `src/` files touched are a new test, a prose
clarification in `tokens.ts`, and `style-guide.md`. No golden re-baseline.

The developer asked why explosions are only ever blue. The ruling is theirs and
the code agrees: `threatRed` is reserved to a STATE (danger), not to a faction,
and destruction is that state. `signalYellow` is ore and does not move at any
brightness.

## BUILT

- `tools/explosion-lab/heat.ts` — the whole treatment, two colours:
  `plasma → threatRed`, `plasmaHot → shotEnemy3`. Plus `HeatPool`,
  `HEAT_SPRITES`, and `heatDiffers`.
- `tools/explosion-lab/candidates.ts` — `TREATMENTS`, `optionId`, `poolFor`,
  `heatMoved`, and a per-family `heatNote`. **The nineteen candidates are
  untouched** — not one number.
- `tools/make-explosion-lab.ts` — pair layout, warm `<defs>`, per-treatment
  filmstrips, the new copy, and the 38 option ids printed for the Director.
- `docs/art-direction/explosion-lab.html` (+ the `assets/preview/` twin) —
  1525 KB, one line, no external URLs, 38 options, 228 stills.
- `src/art/vfx/kinds.test.ts` — **new file**, `no explosion particle lands on
  ore yellow` plus three supporting tests.
- `style-guide.md` §2.3 — the ruling, written down. `src/art/tokens.ts` —
  `MATERIALS.ice.reads` / `.ember.reads` carry the narrowing, since the "never a
  warm spark" line the brief quotes lives there.
- `evidence/a0-86-red-explosions/` — the capture script and 23 images.

Commits: `0ceac6bb` (the lab), and the test/guide commit that follows it.

## DECISIONS

- **The treatment is a map on COLOUR, not on kind, and that is the load-bearing
  choice.** `plasma → threatRed` and `plasmaHot → shotEnemy3` warm the
  cold-energy register wherever it appears and are *structurally incapable* of
  touching rock, hull, smoke, dust, the repair channel or the ore payout. No
  allow-list to keep in sync, and "debris is not on fire" is enforced rather than
  remembered.
- **`plasmaHot → shotEnemy3` is not a taste.** Both are their register's base
  mixed **0.45 toward WHITE** (`DERIVED_RECIPES`), so the red twin is compared at
  the same heat as the cold one. `assertHeatMap()` checks that against the
  recipes at module load — retune either and the generator fails instead of
  quietly shifting the comparison.
- **One copy of the motion.** A red twin is the candidate's own `emit`, off the
  same seed, run into a `HeatPool` that maps the colour column on the way past.
  The two panels cannot drift into two effects, because there is only one effect.
  This is why the board can claim "colour alone" without anyone auditing 38
  emitters.
- **The live half still draws through the real `VfxLayer`.** The red panel's
  layer is built over a SECOND `SpriteTextureCache` pre-seeded at the keys
  `VfxLayer` asks for (`vfx:<name>:48`). `getBy` builds only on a miss, so the
  warm textures are picked up with **zero change to `src/`** and no fork of the
  draw path. Two caches, not one, because the cold panel needs the cold texture
  under the same key.
- **REJECTED: adding warm particle kinds to `src/art/vfx/kinds.ts`.** It is the
  obvious way to get warm textures and it is wrong here twice over: it ships a
  baked texture for a look no emitter uses, on a verdict that has not been given,
  and it edits the shipped vocabulary in a brief whose scope says *no porting*.
  If the developer picks a red option, the port adds them then — with a caller.
- **REJECTED: tinting the existing cold looks red.** `sprite.tint` MULTIPLIES,
  so tinting a blue-cored texture red gives a dark grey-violet, not a red
  explosion — the flare and the shockwave would simply have gone dim. A red
  explosion needs red *textures*; that is why `HEAT_SPRITES` exists.
- **The warmed shapes take role `danger`, and that is the argument, not
  paperwork.** `compliance.ts` allows threat red on `danger` only, so a warmed
  `energy` shape must become a danger shape — which is precisely the brief's
  claim written into the sprite. `assertPaletteCompliance` runs over the warm set
  before anything is drawn with it.
- **The asteroid family's answer is made by the map, not by a paragraph.** Five
  of the seven asteroid candidates contain no light at all, so `heatMoved` is
  **0** and the red twin is identical particle for particle; the panel says
  `IDENTICAL` and says why. M and Q have a shockwave ring and that ring is the
  only thing red can reach. The page states that if warmth is wanted in a rock
  burst it has to come from a new particle at the moment of the HIT, not from a
  recolour of the dust.
- **The test measures direction, not just distance.** "Is this signal yellow" is
  a check nobody fails. The failure mode is *brightening through orange*, so
  `oreward()` measures how far along the road to ore a colour has travelled
  (green's position between blue and red), with the ceiling **derived from
  `YELLOW_FAMILY`'s own reading** (0.807) rather than chosen. The roster's orange
  `#ff8a3d` is the proof both gates are needed: ΔE **46** from ore (passes
  distance) and **40%** of the way there (fails direction). Verified by mutation
  — an orange ember and a red-mixed-toward-ore ember both fail with a readable
  message.
- **The ore payout is exempted by KIND and then asserted to BE ore**, so the
  exemption cannot quietly grow to cover a second yellow particle.
- **REJECTED: importing the lab into the `src/` test.** It would drag `tools/`
  into the root `tsconfig` program, which the platform agent deliberately kept
  out so the shared `npx tsc --noEmit` gate does not move for every other agent.
  Coverage is complete without it: the lab's warm colours are `RED_FAMILY`
  members by construction (asserted in `heat.ts`), and the test gates the whole
  `RED_FAMILY` and every point of every ramp between it and white.
- **Ids are `<letter>-C` / `<letter>-R`** (38), per the brief's "same ids plus a
  colour suffix". The answer format on the page moved from "B, J, N" to
  "B-R, J-C, N-C".
- **`LIVE_PX` 440 → 400** so a pair fits one row. Two effects a developer has to
  scroll between are two effects compared from memory.
- **The stills are now a CLOSED `<details>`** — 38 strips open at once is a page
  nobody can scroll. The no-WebGL fallback opens them all, so the degraded board
  is still the a0-63 board and not a list of summaries.

## Verified

- `npx tsc --noEmit` clean. `npm test -- --run` green.
- `npx tsc --noEmit --project tools` reports nothing in `explosion-lab/` or
  `make-explosion-lab.ts`; the `make-laser-*` / `make-shot-preview` errors are
  pre-existing and untouched (a0-69 recorded the same set).
- Headless Chromium off `file://`: `data-live=on`, **no console errors**, all
  three families play, and a pair's two clocks read the same instant
  (`0.15s · 103p` × 2 on L). 19 pair screenshots + 3 live + the page head are in
  `evidence/a0-86-red-explosions/frames/`, and every one was looked at.
- Mutation-tested: an orange-tinted ember and a red mixed 35% toward ore both
  fail `no explosion particle lands on ore yellow`.

## NEXT

- **Director, job 1: `status/art-review.json` gains the 38 option ids.** That
  file **is not in this lane** (`ls status/` shows `notes/` only, and it is not
  in `git ls-files`), so it cannot be edited here — the same blocker a0-63 and
  a0-69 recorded. The generator now PRINTS the id array ready to paste on every
  run, so it is one copy rather than a re-derivation.
- **Director, job 2: the a0-69 one-line fold question is still open.** Unchanged
  by this brief; see the a0-69 note.
- **The developer answers with one id per family**, e.g. "B-R, J-C, N-C". Nothing
  is ported until they do.
- If the answer is "red embers, cold shockwave", that is a third treatment and
  roughly one line in `heat.ts` — the footer says so on the page.
