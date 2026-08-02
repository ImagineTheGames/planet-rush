# p15 — "radar built, fog stayed": what was broken, and what QA actually saw

*Gameplay lane, branch `agent/gameplay/p15-radar-fog`. Developer report: "I built
the radar but I still had fog of war over what I was discovering."*

---

## The short version

The radar was never broken. **The fog's memory was.**

A satellite ordered through the real build wheel does register as a coverage
source, on a real match, through the shipped chain. What did not work is that
the only static geography the fog remembered was *homes*. Ore fields — the thing
a player actually flies out and **discovers** — were gated on CURRENT coverage
like a live enemy ship, so every field a player found went dark again the moment
they flew home. Building a radar could not fix that, because the radar's disc
sits over the one part of the map the player already knows.

Fixed by remembering ore fields under the same rule homes already had.

---

## 1. Root cause, measured

The three suspects in the report, tested at the three seams they live at
(`src/sim/radar-fog.test.ts` walks all of them on a real `createWorld` match):

| # | Suspect | Verdict |
|---|---|---|
| 1 | The sensing system never registered the BUILT satellite as a fog source (did the p13-03 wedge fix re-wire it?) | **Cleared.** A `buildOrder` through the wheel path lands in `station.satellites`, and `sensorSources` picks it up as a `satellite` disc at `SATELLITE.sensorRange`. Discs 2 → 3. |
| 2 | Coverage applies to the WORLD but the minimap reads a different visibility source | **Cleared.** One truth end to end: `sensing.sensorSources` → `main.ts feedMinimapFog` → `minimap.minimapScene`. Every disc survives every hop; the counts match at each one. |
| 3 | Coverage only updates on orbit ticks / the area was outside the swept band | **Cleared.** `updateSatellites` rederives `pos` every tick and `sensorSources` reads it fresh every read — there is no sweep, the disc is whole and continuous. |

Measured on a live two-player match (seed 7, 2400×2400 arena, 26 rocks):

| | coverage discs | arena covered | ore rocks sensed |
|---|---|---|---|
| before the radar | 2 (ship 520 + station 300) | **14.2%** | 6 / 26 |
| after the radar | 3 (+ satellite 900) | **35.5%** | 18 / 26 |

The radar more than doubles what you can see. It works.

**The actual defect** is one line of the model nobody wrote down. From
`src/sim/sensing.ts`'s own doc, before this branch:

> **Static geography** (station positions) is REMEMBERED once seen — it stays on
> the minimap after coverage moves off it, because a home does not move…

An asteroid does not move either. It only depletes. But ore was in the *live
entity* bucket with ships and projectiles, so:

- fly out, find a distant field → it lights up;
- fly home → **it goes dark again**;
- build a radar → the disc lights up your own back yard, which you already knew,
  and the field you found out there is *still* dark.

That is the report, exactly, in both of its clauses.

## 2. The fix

Ore fields become the second kind of remembered static geography.

- `SensoryMemory.seenOre[player]` — an ascending list of asteroid ids ever
  sensed. A list rather than a bitmask because ids run past 32 across five waves;
  ascending so the stored order never depends on the order rocks arrive in, and a
  replay reproduces it byte for byte.
- `updateSensory` inserts every rock under coverage, surface-aware (a rock is a
  sized body, same as a station). Rocks already remembered skip the coverage test
  through a binary-search lookup, so the pass gets **cheaper** as a field becomes
  known, not dearer.
- `sensedState.rememberedOre` resolves the memory against the *live* field, so a
  rock mined out of existence stops being reported — a remembered field is never
  a phantom the player can fly to and find empty.
- The minimap gives ore the same tri-state a station has: full under current
  coverage, dimmed (`MINIMAP_REMEMBERED_ORE_ALPHA`) once scouted, fogged if never
  seen.

Monotonic and per-player: nothing is ever un-remembered, and one player's
scouting run reveals nothing to anyone else.

**What did NOT change:** the satellite-killed moment. Kill a radar and its disc
still collapses the same tick, and every live contact under it still drops
immediately. Coverage is not memory — the difference is now visible on the map:
the enemy dots vanish, the ore fields the radar mapped stay, dimmed.

## 3. Reconciling with `radar-wedge-restored` (p13-04)

The brief asks what QA saw that the developer didn't. **QA's attestation was
honest and its evidence stands.** Their frame 3 says "FOG LIFTS: after the 12s
construction the minimap shows the satellite LARGE coverage disc; coverage discs
2→3, satellites 0→1, and 4 enemy contacts the fog had hidden are now dots on the
map." Every one of those numbers reproduces here (the disc counts are asserted in
`radar-fog.test.ts` seam 1, and the 14% → 36% measurement is the same event).

The difference is the *move*, not the code:

- **QA's move** was build → observe → kill → observe. Every observation happened
  **while the coverage was live**. That path exercises exactly the half that
  works, and it is the right test for the question they were asked (did the p13
  wedge cut come back? did the satellite die correctly?).
- **The developer's move** was build → *fly out and explore* → come home. The
  only move that shows the memory gap is leaving an area you have already seen
  and looking back at the map. Neither QA gate ever leaves coverage behind.

So: no contradiction, and no bad evidence. A coverage gate cannot catch a memory
bug, and nobody had written a memory gate for ore.

## 4. Evidence gates — status, honestly

**Not re-shot in this lane.** Playwright cannot launch a browser here (no
`libnss3.so`, no root); the launch was attempted and failed at browser start, so
there are no fresh PNGs on this branch.

What re-verification needs to cover, for whoever runs it:

- `radar-coverage` and `minimap-fog` (ids unchanged) — their assertions read
  `coverageCount`, `shipCount` and `satelliteCount`, none of which this branch
  changes. They should re-verify as-is on the fixed build.
- The `fog returns` frame is where the change is visible and the expectation
  moves: coverage 3→2, satellites →0 and enemy dots →0 exactly as before, but
  **`oreCount` no longer drops** — the fields the radar mapped stay on the map,
  dimmed. An old expectation of "ore dots fall back" would now be wrong.
- Worth a new natural-match frame, since it is the reported bug: fly out to a
  distant field, watch it light, fly home, and see it **still there and dim**
  instead of swallowed by the fog.

## 5. Reported, not fixed: the radar's reach is anchored at home

Not touched on this branch, because it is a balance call and `SATELLITE`'s table
is marked TUNABLE with QA owning it — but the Director should see the number.

The satellite orbits its own station 114u out, with a 900u sensor, in a 2400×2400
arena. Its disc is therefore always a bubble around the player's own home, and it
overlaps the station's own 300u disc entirely. It buys real sight (14% → 36% of
the arena) but all of it *near home* — a player who builds a radar and then flies
to the contested middle gets nothing new where they actually are.

With ore now remembered, this matters much less: the radar permanently maps every
field in its disc, and a scouting run permanently maps everything it passes, so
the map fills in as the player plays. If the Director wants the radar to feel like
reach rather than a home floodlight, the levers are `SATELLITE.sensorRange` or
letting a satellite ride further out — both one-line tunables, neither mine to
ratify.
