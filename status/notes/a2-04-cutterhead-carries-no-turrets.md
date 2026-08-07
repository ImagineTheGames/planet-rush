# a2-04 — the Cutterhead carries no turrets

Branch: `agent/art/a2-04-no-hull-turrets` (based on `origin/main` @ `eb75891`)
Owner: Art Agent. Started 2026-08-07.

The developer, 2026-08-07: *"an ammendment to the new mining station, we dont
need the turrets on it, those will be built externally as it already is...."*

---

## BUILT

- **`c685f98` — the board loses its hull turrets.**
  `docs/art-direction/facility-concepts-r2.html`. Per mount, the breech / barrel
  / muzzle rects come off; the lug pad, seat and owner keyway stay. That is 25
  live mounts (D, E, F + their siege variants + the DEFEND vocabulary card) and
  12 derelict ones, plus 6 muzzle flashes — with no gun there is nothing to fire.
  Text: the DEFEND card rewritten (owner ring + threat red + *clear, unoccupied
  mounting ground*); the three siege captions no longer claim "turrets
  answering"; three "keeps" lines and three callouts renamed to mounts; a dated,
  attributed amendment note at the head of the board, in the source comment, and
  in the footer.

- **`d5a01ac` — `STATION_HULL_EXCLUSIONS` + the two-way guard.**
  `src/art/stations.ts` (the constant, and `stationHullParts()` — a named parts
  manifest that `stationSprite()` is composed from and nothing appended) and
  `src/art/compliance.test.ts` (both directions; 27 tests green).

- **`7ada2da` — the evidence.** `evidence/a2-04-no-hull-turrets/`:
  `capture-board.mjs` (the board's own DOM sections at `origin/main` vs HEAD)
  and `frames.html` + `capture-frames.mjs` (the shipped `Renderer` against the
  shipped sim, four panels: 0 built / 4 built / 2 shot down / ring shot empty,
  each caption read back off `data-turrets`). Plus `frames-before/`, the same
  four with `stations.ts` reverted — **zero differing pixels on every panel**.

---

## DECISIONS

### Base: `origin/main`, not the a2-03 branch

The brief reads as though a2-03 has landed. **It has not** — `a2-03` is open PR
#312 (`agent/art/a2-03-planets-biomes`), branched off `c2d401f`, and
`origin/main` is not an ancestor of it. So there are two possible bases:

- **`origin/main`** — the station generator here is still the l1-02b planetoid
  (ocean / continents / limb / core). Independently mergeable, DoD's
  `merge-base --is-ancestor origin/main HEAD` trivially satisfied.
- **the a2-03 branch** — carries the Cutterhead, but stacking would put 1,800
  lines I do not own into my PR and entangle my merge with a decision that is
  not mine.

Chose `origin/main`. Rejected stacking: a brief branch has to be mergeable on
its own, and a2-03 could still change under review.

**Consequence, flagged for the Director:** `src/art/stations.ts` will conflict
when a2-03 merges (a2-03 rewrites 794 lines of it). The exclusion constant and
the parts manifest must survive that resolution — that is the whole point of the
brief, and losing them in a conflict is exactly the LESSONS §14 failure this is
guarding against. The compliance test does not conflict and will fail loudly if
the constant goes missing, which is the backstop.

### Part 2 (the generator) is a NO-OP, and I did not invent a removal

- `origin/main`'s `src/art/stations.ts`: **zero** turret references, before and
  after. The hull is ocean, continents, limb, core.
- a2-03's Cutterhead (`origin/agent/art/a2-03-planets-biomes`): **one** turret
  mention, and it is a comment on the *keyway* — "the roster colour, on the seat
  a turret bolts to." Eight anchor lugs, no gun geometry. It already ships clean.

So the art was right and the board was wrong, exactly as the brief allowed for.
The deliverable here is the board correction and the guard.

### The guard: what it can honestly assert, and what it cannot

Direction 1 (the hull emits nothing on the list) is carried by a **named parts
manifest**: `stationHullParts()` returns `{part, shapes}[]`, `stationSprite()` is
that list flattened *and nothing appended*, and the test asserts both the names
(none on the exclusion list) and **exhaustiveness** (the sprite's shape count
equals the manifest's). Without exhaustiveness the name check proves nothing —
unnamed shapes would be unexcludable.

**Rejected: a geometric turret classifier.** I first wrote "the hull draws
nothing outboard of its own radius," which caught a hull gun beautifully — and
also fails a2-03's anchor lugs and its spoil boom (extent 1.95, boom at 1.68 R).
There is no geometric rule that separates a hull gun from a lug or a spoil boom,
and inventing one would ban the mining read a2-03 was picked for. Deleted it.

What replaced it, stated as what it is: a **declared draw-call tripwire** on the
shipped renderer (`SHIPPED_HULL_DRAW_CALLS = 5`). The renderer's station body is
hand-authored Pixi, not `stationSprite` — a2-03 is the brief that closes that —
so the manifest cannot reach it, and four anonymous circles on the body radius
would otherwise go unnoticed. Coarse on purpose; the failure message says so and
says what to do.

Direction 2 (everything *not* on the list is still reachable) is the half that
matters, and is behavioural: the TURRET wedge builds; the ring caps at **4**
(literal, not just `TURRET.capPerStation` — a silent cap raise must fail); a
destroyed turret disappears from both the count and the frame; the turret art
renders from the **buildings** layer across 0 → 4 → 0 while the hull graphic is
byte-identical in all three frames; and the whole Mk ladder × state pool still
draws.

### Mutation-tested, because a green test that cannot fail proves nothing

| mutation | expected | result |
|---|---|---|
| art hull emits a part named `turret-*` | fail | ✅ names + exhaustiveness |
| shapes appended after the manifest is flattened | fail | ✅ exhaustiveness |
| renderer's hull grows four guns on the body radius | fail | ✅ tripwire + fill extent |
| renderer stops drawing built turrets ("deleted from the game") | fail | ✅ direction 2 |
| `TURRET.capPerStation` silently raised 4 → 6 | fail | ✅ direction 2 |
| art hull grows an honestly-named `lug` inside extent | pass | ✅ (no false positive on structure) |

The last row is the one that killed the first design. See the rejected classifier
above.

### Goldens: none moved, and that is the finding

Every re-baseline rule was applied and the honest answer is that **nothing
renders differently**. Proven three ways rather than asserted:

1. `stationSprite()`'s output is byte-identical to `origin/main` on all four
   variants (15 / 21 / 12 / 27 shapes) — the manifest is a re-composition.
2. `frames-before/` vs `frames/`: the four live-render panels, captured with
   `stations.ts` at `origin/main` and at HEAD. **0 differing pixels, max channel
   delta 0**, on all four.
3. The mobile golden suite, run in the container.

The brief warns "if no snapshot moves, either the change did not land or your DoD
is lying to you." Here the third possibility is the true one, and the brief
allowed for it: **the removal was a no-op in code** (the art never drew turrets)
and the whole defect lived in the board plus the absence of a guard.

---

## NEXT

- [ ] Confirm the mobile golden suite is green (running).
- [ ] Push and open the PR.

### Known, and NOT mine

`tests/net/capacity/capacity-regression.test.ts > the loop stays inside the tick
budget at 12 rooms` fails (62.86 ms vs a 33 ms budget). **Pre-existing**: it fails
identically with the working tree reset to `origin/main` content, it is a
load-sensitive netcode/server timing test, and it touches nothing this branch
changes. a2-03's working notes call the same test a flake (`092210e`, "the
capacity flake proves itself a flake"). Everything else is green — 3836 passed.
