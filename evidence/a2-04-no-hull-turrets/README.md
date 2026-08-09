# a2-04 / a2-06 — the Cutterhead carries no turrets

Evidence for `agent/art/a2-04-no-hull-turrets`. Two claims, two sets of images.

The board half (§1, §4) is a2-04's and stands unchanged — it never depended on
which hull shipped. The frames (§2, §3) were **re-shot on the Cutterhead** under
a2-06, once a2-03 landed on `main`.

The developer, 2026-08-07: *"an ammendment to the new mining station, we dont
need the turrets on it, those will be built externally as it already is...."*

---

## 1 · The board, before and after

`node evidence/a2-04-no-hull-turrets/capture-board.mjs`

Shoots the same DOM sections out of `docs/art-direction/facility-concepts-r2.html`
at `origin/main` (`board-before/`) and at HEAD (`board-after/`), from `file://`,
at dpr 2. Sections are addressed by selector, so a section that moved shows as a
moved crop rather than silently shifting what the pair claims to show.

| file | what changed |
|---|---|
| `d-live.png` | D · the live callout figure. Four turret barrels gone from the mounts at 12/3/6/9; the lug pad, seat and owner keyway stay. Callout `ANCHOR LUG + TURRET` → `ANCHOR LUG — a bare turret seat`. |
| `d-states.png` | D · siege / derelict / ownership. Siege loses its two firing barrels and their muzzle flashes; incoming fire, hits and the alarm edge are untouched. Derelict keeps its cold lugs, loses its cold guns. The ownership row still reads at four palette swaps — the keyway carries the roster colour, so identity survives the guns coming off. |
| `d-keeps.png` | `Defend — four turrets seated on four of the eight lugs` → `the owner ring, and eight bare lugs a bought turret seats on`. |
| `e-live.png` | E · `TURRET on the corner cut` → `MOUNT PAD on the corner cut, bare`. |
| `f-live.png` | F · `TURRET on the rim` → `MOUNT PAD on the rim, bare`. |
| `defend-card.png` | The DEFEND vocabulary card, rewritten. Was: "Four turret mounts on the body radius … Unchanged from round 1 — this part was never the problem." Now: the owner ring, threat red filling it, and clear unoccupied mounting ground — with the reason stated. |
| `board-after/amendment-note.png` | New. The dated, attributed amendment, in the board's own text. |

`mount-before.png` / `mount-after.png` — one mount at 4× nearest-neighbour, so
what came off (breech, barrel, muzzle) and what stayed (pad, seat, keyway) can be
looked at rather than inferred.

`d-live-diff.png` — the pixel diff. **Read it with the caveat**: the AFTER card is
2 px taller (the rewritten caption reflows), so everything is offset by two rows
and outlines red. The four solid red blobs at 12/3/6/9 are the real change.

## 2 · The silhouette, against the turret count — ON THE CUTTERHEAD

> **Re-shot 2026-08-09 (a2-06).** The first cut of these frames showed
> `origin/main`'s l1-02b **planetoid**, because a2-03 was still an open PR. a2-03
> has since merged (#312) and the renderer now draws the Cutterhead, so these are
> the same four panels, same rig, on the hull the developer's amendment is
> actually about. Nothing here was reinvented; it was re-shot.

`npx vite --port 5199` then
`node evidence/a2-04-no-hull-turrets/capture-frames.mjs`

`frames.html` drives the **shipped** `Renderer` against the **shipped** sim — the
same `placeOrder` / `updateStations` / `damageTurret` / `sweepDeadTurrets` the
game runs. Each panel's caption is read back off `data-turrets`, so it is the
simulation's own count, not a label someone typed.

| file | sim count | what it proves |
|---|---|---|
| `frames/bare.png` | 0 | A fresh Cutterhead. Eight anchor lugs, bare. Nothing standing, nothing drawn. |
| `frames/built-4.png` | 4 | Four bought at the wheel, assembled, standing outboard on the mounts — **four, not eight**. |
| `frames/shot-2.png` | 2 | Two shot down and swept. The count drops and the picture drops with it. |
| `frames/shot-0.png` | 0 | The ring shot empty. **Pixel-identical to `bare.png`.** |
| `frames/strip.png` | — | All four side by side, which is the argument in one image. |

That last row is the whole brief: **a display whose empty state is
indistinguishable from its full state will lie to you.** Here the *full* and
*empty* states are distinguishable, the empty state is honestly empty, and the
hull is the same object in all four.

## 3 · The frames, as numbers

`node evidence/a2-04-no-hull-turrets/measure-frames.mjs` → `frames-measured.json`

Three measurements, because a picture of a station with no guns on it is only
evidence if someone measures it. The `<figcaption>` band is excluded throughout —
it is DOM text that says different words per panel by design.

**a. Same zoom.** Beacon-ring span on the centre row, band-limited to r < 152 px:

```
bare 299 px   built-4 299 px   shot-2 299 px   shot-0 299 px   (270 -> 569 in all four)
```

The band limit matters and is not a fudge: the ring sits at 140–148 px, a built
turret's art starts at 155 px, and **both carry the roster colour**. An unbounded
azure probe reads the guns on the panels that have guns (299 / 367 / 333 / 299)
and measures nothing about zoom. This is the probe from the planetoid pass,
corrected — on the old hull the turrets did not sit where they now do.

**b. The parts manifest renders nothing new.** `frames-before/` is the same four
panels with `src/art/stations.ts` reverted to `origin/main` — i.e. the Cutterhead
*before* the named-parts refactor:

```
bare 0    built-4 0    shot-2 0    shot-0 0     differing pixels
```

Confirms at the pixel level what the shape level already showed: the flattened
manifest is deep-equal to `origin/main`'s `cutterheadShapes` across 4 variants ×
8 owners × live/dead. **A re-composition, not a redraw** — so no golden can move
on account of this branch, and none did.

**c. Where the turrets' pixels actually are.** Every pixel that differs between
`bare` and the built panels, by distance from the station centre:

| pair | differing px | radial span | entirely outboard of the hull? |
|---|---|---|---|
| `bare` vs `shot-0` | **0** | — | the empty ring IS a fresh spawn |
| `bare` vs `built-4` | 5768 | 155 → 204 px | **yes** (body radius = 128 px) |
| `bare` vs `shot-2` | 2898 | 156 → 204 px | **yes** |

This is "the guns live on the buildings layer" stated as geometry instead of as a
claim about the source. Not one pixel inside the 128 px body radius changes when
four turrets go up — the Cutterhead is the same drawing whether the ring is full
or empty. And `shot-2` differs by almost exactly half of `built-4` (2898 vs 5768),
which is two turrets' worth.

---

## 4 · The zoom tests — "owner-colour legibility at any zoom"

Added to `capture-board.mjs` after the first pass, because both sections
`use href="#bD"` and therefore inherit the geometry change rather than restating
it — which is exactly why they are worth shooting.

| file | what to look for |
|---|---|
| `scale-390.png` | D, E and F at **1:1 in a 390 px viewport** — the size the design is really judged at. Before: small grey gun stubs poke past the beacon ring at the cardinals. After: the outline is clean. The owner read is unchanged, because it was never the guns carrying it — it is the beacon ring, its four pips, and the lug keyway. |
| `scale-downscale.png` | The same sprite at **128 / 72 / 44 / 28 / 18 px, silhouette only, no rings**. This is the one that answers the brief's "must not soften the Cutterhead back toward a generic structure": at 128 px the outline is still lugged, the throat is still toothed, and the spoil boom still leaves the circle. The anti-planetoid read was never the guns' job, and it survives them coming off intact down to 18 px. |

---

## The suite results this branch was measured against

**Mobile goldens, in the container:** 31 passed, 4 failed. The four are all
**UPGRADE WHEEL** — and they fail *identically with the working tree reset to
`origin/main` content*, so they are pre-existing and belong to whoever owns
`src/ui/`. Every golden the station silhouette shows in passes unchanged:

```
✓ golden: desktop frozen scene
✓ golden: landscape phone frozen scene
✓ golden: desktop frozen TEAMS scene — FRIENDLY A / ENEMY B
✓ golden: landscape phone frozen TEAMS scene — FRIENDLY A / ENEMY B
✓ golden: PORTRAIT-HELD phone frozen TEAMS scene — the labels survive the lock
```

**Unit suite:** 3836 passed, 1 failed —
`tests/net/capacity/capacity-regression.test.ts`, also confirmed failing on
`origin/main` content, also not this branch's.
