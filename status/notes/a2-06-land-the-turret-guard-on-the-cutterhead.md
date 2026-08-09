# a2-06 — land the turret guard on the Cutterhead

Branch: `agent/art/a2-04-no-hull-turrets` (PR **#313**, on Director hold)
Owner: Art Agent. Started 2026-08-09. Continues a2-04.

Read this with `status/notes/a2-04-cutterhead-carries-no-turrets.md` (in-repo) —
that is the previous session, and its "NEXT" item is exactly this brief.

---

## BUILT

- **`706c3e0` — the merge, resolved the Cutterhead's way.**
  #312 landed on `main` 2026-08-08, so `src/art/stations.ts` conflicted exactly
  as a2-04's notes predicted. Resolved with `git checkout --theirs` — verified
  **0 lines of diff against `origin/main`** before re-applying anything, so not
  one line of the old planet sprite survived. Then re-applied a2-04's exclusion
  on top: `STATION_HULL_EXCLUSIONS` (quote, three consequences, named-list
  framing — all verbatim), `StationHullPart`, and a manifest re-derived over the
  REAL generator: `cutterheadHullParts()` names the 18 live sections
  (claim, deck-plate, cutter-ring, anchor-lugs, throat, cut-face, core, kerf,
  bore-housing, ore-circuit, deck-ore, chute, hoppers, smelter,
  apron-and-barge, radiator, spoil-boom, corrosion; core-out / ore-spill on the
  derelict). `cutterheadShapes()` is that flattened, nothing appended.

- **`4d6e3b8` — the guard re-aimed, and mutation-proved.** See DECISIONS.

- Everything from a2-04 stands untouched: `facility-concepts-r2.html`, the
  amendment note, the DEFEND card, the three callouts, the siege captions, the
  17 board crops. The merge did not touch the board (no conflict), and the DoD
  grep on it still passes.

## DECISIONS

### The merge: `--theirs` wholesale, then re-apply — not a hand-merge

The temptation was to hand-merge and "keep both." Rejected: the brief is explicit
that #312's file wins on geometry wholesale, and a hand-merge is exactly how a
softened bore-head silhouette would sneak in. Took theirs, proved it identical to
`origin/main`, then added only the exclusion.

### The refactor is a re-composition, PROVED, not asserted

`cutterheadHullParts` uses a `part(name)` recorder: `let shapes` is rebound to a
fresh array registered under the new name, so every existing `shapes.push` lands
in whichever part it is written under. No push was moved, no order changed.

Verified with a throwaway test comparing the flattened output against
`origin/main`'s `cutterheadShapes`, deep-equal on **4 variants x 8 owners x
live/dead = 36 configurations**. Green. Deleted after (it imported a temp copy of
main's file; do not leave that in the tree).

That is what lets the goldens claim stand up: no geometry moved, so the read the
developer picked D for is untouched by construction.

### The two renderer tests from a2-04 had to go, and a2-03 is why

- `SHIPPED_HULL_DRAW_CALLS = 5` — the Cutterhead makes **361**.
- "the hull draws nothing outboard of its radius" — the spoil boom reaches
  **98 world units against a radius of 64** (1.53 R). Correct, by design.

Both existed only because the renderer used to hand-author the station body in
Pixi with hexes no audit could see. **a2-03 closed that** (`src/render/index.ts`
now plays `stationSprite` + `beaconRingSprite` through `drawSprite`), so they are
replaced by one strictly stronger check with no magic number: the shipped hull's
instruction count is **derived** from the sprite defs by `drawSprite`'s own rule
(one instruction per fill, one per stroke). Hand-drawn station geometry now fails.

Note this is the SECOND time the "nothing outboard" idea has been tried and
killed by the same geometry. Do not try it a third time.

### New test the brief's "must not change" list earned

`the eight anchor lugs are still there`. "No turrets on the hull" must not become
"no mounting ground on the hull": the lug is the seat, the keyway is the roster
colour. Pins 8 x 6 shapes and 8 `identity` keyways live; 6 x 5 and zero keyways on
a derelict (two lugs snap off — it has come loose from its claim).

### Mutation-proved — the whole point of this brief

Each applied locally, run, reverted. 29 green before and after.

| mutation | expect | result |
|---|---|---|
| hull grows a `turrets` part, honestly named | fail | red — name check |
| four guns smuggled into `anchor-lugs` | fail | red — lug count pin |
| a mark appended after the manifest flattens | fail | red — exhaustiveness |
| renderer hand-draws four guns on the hull | fail | red — derived count |
| renderer stops drawing built turrets | fail | red — both dir-2 frames |
| `capPerStation` raised 4 -> 6 silently | fail | red — asserted literal |
| the lug keyway deleted with the gun | fail | red — keyway count |

**Say this out loud in the PR:** nothing here understands what a gun *is*. Row 2
is caught by a pinned count, not by a classifier. That is the honest limit, and
it is the same limit a2-04 hit.

## NEXT

- [x] merge, resolved the Cutterhead's way
- [x] exclusion re-pointed
- [x] tests re-aimed + mutation-proved
- [ ] re-shoot the evidence frames on the Cutterhead (4 built standing / ring
      shot empty). #313's set has these for the OLD hull — re-shoot, do not
      reinvent. `evidence/a2-04-no-hull-turrets/frames.ts` + `capture-frames.mjs`
      already drive the shipped Renderer against the shipped sim; the captions
      read back off `data-turrets`, so they stay honest.
- [ ] goldens: the sprite output is byte-identical to main's, so nothing should
      move. #312 already re-baselined five. **Say so explicitly** rather than
      leaving it unsaid — the brief asks for that in as many words.
- [ ] DoD, PR body rewrite, and state that the hold can come off.

### Known and NOT mine (carried from a2-04, re-verify before repeating)

`tests/net/capacity/capacity-regression.test.ts` is load-flaky on this shared
box, and four UPGRADE WHEEL goldens were failing on `origin/main`'s own tip.
Report by name, never adopt, never re-baseline from this lane.
