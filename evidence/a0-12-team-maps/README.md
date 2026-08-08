# a0-12 — two maps with four stations a side and open ground between them

> *"we can make some new maps that are more balanced for teams with 4 on one side
> and 4 on the other [so we need 2 new maps for all nebula options]"*
> — the developer, 2026-08-07

Two new maps, both two-sided. **`line` / "The Line"** — two straight picket lines
of four, 2027 u apart, on the wide arena. **`crescents` / "The Crescents"** — two
arcs of four on one ring, facing each other across the bowl, on the square arena.

Regenerate everything here with:

```
npx vite-node evidence/a0-12-team-maps/capture-layouts.mjs      # geometry + numbers
npx vite build --outDir dist-a012 && npx vite preview --outDir dist-a012 --port 4231 --strictPort
node evidence/a0-12-team-maps/capture-frames.mjs                # live frames
```

`4231` is deliberate, not 4173: a preview server on the shared port will happily
serve **another lane's stale bundle** and photograph it without complaint.
`capture-frames.mjs` compares `/version.json` against the working tree's HEAD on
every run and says so in `frames.txt`, so the frames name the build they are of.

---

## 1. The layout at N=8, with the two sides tinted

| | |
|---|---|
| `line-layout.png` | The Line, N=8, full field |
| `crescents-layout.png` | The Crescents, N=8, full field |

Blue is side A, gold is side B, and the dashed vertical rule is the axis between
them. Every stamped body is drawn — stations, ship spawns, the per-home
neighbourhoods, the whole commons schedule — plus each home's
`SPAWN_CLEAR_POCKET` ring and the `WORLD_EDGE_MARGIN` box, so the two invariants
the registry may never smuggle past are visible rather than asserted offstage.
(SVG sources alongside; they are the diff-able form.)

`line-n4.png` / `crescents-n4.png` are the same boards at a **real 2v2** with the
lobby's own team assignment: team 0 wholly on side A, team 1 wholly on side B,
and the four unused board positions standing as unowned derelict wrecks — still
mirror-paired, so a short roster leaves seats empty without reshaping the arena.

## 2. The mirror, as numbers

`mirror.txt` (and `mirror.json`) — printed, not claimed. Highlights:

| | The Line | The Crescents |
|---|---|---|
| point-reflection residual, stations | `0.000e+0` u | `2.274e-13` u |
| …ships | `0.000e+0` u | `1.137e-13` u |
| …asteroids (position **and** ore), 144 rocks | `3.216e-13` u | `7.190e-13` u |
| midline-mirror residual, station centres | `2.542e-13` u | `3.216e-13` u |
| per-side home ore | A `80.000000000` / B `80.000000000`, **exactly equal** | same |
| commons split by the dividing axis | A `120` / B `120`, Δ `0.000e+0` | same |
| run to the middle, per side | `1030.278 1030.278 1157.030 1157.030` both sides | `916` ×4 both sides |
| `SPAWN_CLEAR_POCKET` slack, cross-station, 9 seeds × N=2..8 | **+81.5 u** | **+67.7 u** |
| own-turret-range slack, same grid | +328.8 u | +265.7 u |
| nearest ally / nearest enemy | 372 / 2027 u (**5.44×**) | 505 / 1226 u (**2.43×**) |
| empty corridor with no station in it | 2027 u | 1226 u |

**Why a point reflection and not a mirror.** `spawnHomeFields` stamps every home
neighbourhood by a *rotation*, so rotating the board by π carries stations, ships,
home fields and the N-fold-symmetric commons onto themselves exactly — side
equality is the same fact as "the stamp is a rotation", not a tuning result. The
midline mirror (the one a player sees) is exact for station and ship centres
because each side is itself symmetric about the perpendicular axis, but it
**cannot** hold for ore: the canonical rock pattern is chiral, and no rotation
stamp equals its own mirror image. `tests/sim/team-maps.test.ts` asserts both and
pins the chirality (> 1 u) so nobody closes the gap with a tolerance.

## 3. A live 4v4 at gameplay zoom, on each map's assigned sky

| | |
|---|---|
| `crescents-match.png` | The Crescents under **Iron Veil** — the flat laminated sheets across the frame |
| `line-match.png` | The Line under **Deep Ember** — coals at the rim, the middle clean |

Both are `?debug=1&sides=2` on the real bundle (sha stamped bottom-left, and
`frames.txt` matches it to HEAD). The Line's frame is the map's whole character in
one picture: two team-mates above and below in the line, the arena wall at your
back, your neighbourhood in front, and the corridor beyond it.

The readback in `frames.txt` is `shipWorld`, and it carries the claim: on `line`
it reads **(682.7, 1186.2)** — P0's spawn in the registry to the decimal
(`line-layout.svg`), on the near half of a 3200×2000 arena. The `?debug=1` handle
publishes no world and no backdrop, so the sky is named from `MAP_NEBULA` (which
`backdrop.test.ts` asserts) and *shown* in the frame, not read back — said plainly
so the printout is not read for more than it earns.

## 4. The developer's actual case — a 4v4 lobby where the sides are the sides

`lobby-4v4-line.png`, `lobby-4v4-crescents.png`.

MODE · TEAMS, eight seats alternating FRIENDLY A / ENEMY B, **A 4 · B 4** on the
footer, and an arena row carrying **all six** maps — The Ring, The Compass, The
Oval, Double Diamond, **The Line**, **The Crescents** — each card showing the
registry's own preview, so The Line reads as two columns of four and The Crescents
as two arcs. Nothing in `src/ui/lobby.ts` changed to get this: `defaultTeamForSlot`
is still `index % 2`, and the map does all the work.
