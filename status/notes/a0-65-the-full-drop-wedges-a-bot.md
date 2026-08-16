# a0-65 — the full drop wedges a bot

Branch: `agent/gameplay/a0-59-full-death-drop` (continued, not restarted).
Working note. Not evidence — it never substitutes for the DoD, the PR, or QA.

## The one-sentence answer

The wedge is a **map-geometry trap in `src/sim/waves.ts`**, not bot target
selection: the late commons waves sealed the map centre on **100 seeds out of
100**, and `DEATH_ORE_DROP_FRACTION` 0.5 → 1 changed which seeds happened to have
a bot standing inside it when it closed. Fixed in the sim; the fraction stays `1`.

## BUILT

- `eff9443 sim(a0-65): the commons must leave the centre a way out`
  - `WAVE.lastRadiusFraction` 0.25 → 0.5 (`src/sim/constants.ts`)
  - `WAVE.ringCorridorAllowance` 1.7, new (`src/sim/constants.ts`)
  - `ringSizeScale()` in `src/sim/waves.ts`, applied in `spawnWave`
  - `src/sim/waves.test.ts` flipped from characterising the defect to pinning
    the invariant — which is exactly what its own header asked the fixer to do

Verified: `npx tsc --noEmit` clean; `src/sim/waves.test.ts` green;
`tests/harness/unstuck.test.ts` **green, all 24 matches**, with
`DEATH_ORE_DROP_FRACTION` still `1`.

## DECISIONS

### The Director's hypothesis was checked first, and it is wrong

The brief proposed a haul-target selection loop — a bot oscillating between ore
chunks it cannot reach, with the doubled ore field as the cause. Instrumented on
seed 15, slot 2, and it is not that:

- **`chunks within tractor range (120u) = 0` for the entire match.** The nearest
  chunk during the whole 133.5 s wedge is ~950 u away. The bot is not near ore.
- `lastBehavior` is `haul`, and `haul` is `haulHome` — **fly to your own station**.
  Its destination is fixed (slot 2's station, (1200,2064)); there is no target to
  oscillate between. The behaviour name rules the hypothesis out on its own.
- The bot is at **(1200,1200) — the arena centre** — with `clear` (distance to the
  nearest rock surface) oscillating around **0.0 and going negative**, at
  `thrust=1.00`, for 133.5 s. It is pressed against rock, not choosing a target.

### What it actually is, measured

Flood fill of free configuration space from the arena centre (any weaving path
counts, not just a radial ray), on the shipped constants:

| | sealed seeds | first sealed wave |
|---|---|---|
| baseline (pre-fix) | **100 / 100** | wave 4 on 96, wave 3 on 1, wave 5 on 3 |
| after the fix | **0 / 100** | — |

The seal is **not rare and not seed-specific** — it is every seed. It is also
**identical at a drop fraction of 0.5 and of 1**: the geometry never reads the
constant, and `waves.test.ts` steps the world with no inputs, so no ship dies and
`DEATH_ORE_DROP_FRACTION` never executes.

Cause, from the per-wave numbers (8 players, `fieldRadius` 307.2):

| wave | disc | inner ring | rock area / disc area |
|---|---|---|---|
| 1 | 307.2 | 261.1 | 0.29 |
| 2 | 249.8 | 212.2 | 0.44 |
| 3 | 192.0 | 163.2 | 0.75 |
| 4 | 134.6 | 114.2 | **1.53** |
| 5 | 76.8 | 65.3 | **4.70** |

The seal appears exactly where the rocks stop fitting in the disc they are placed
in. On the ring itself: wave 5's circumference is 410 u and its 24 rocks need
`24 × 2 × 34` = 1632 u of arc before a ship corridor is asked for. A wave cannot
be a ring at that radius; it can only be a plug.

### Why the fix is two parts

Both measured on 100 seeds, sealed-seed count:

| candidate | sealed |
|---|---|
| baseline | 100/100 |
| `lastRadiusFraction` 0.5 alone | 23/24 |
| rock-size taper alone | still sealed (floors at 2 u pebbles first) |
| **0.5 + taper (shipped)** | **0/100** |
| `lastRadiusFraction` 0.65 alone | 0/100 |

`0.65` alone works and is a one-line change, and I **rejected** it: it closes the
field only 307 → 200 (1.54×) and largely abolishes the Outer Drift, which is the
GDD §2.3 mechanic. `0.5 + taper` closes 307 → 154 (2×), leaves **waves 1–3 placed
exactly as before**, and never shrinks a rock below ~21 u (ship radius is 16), so
the late rocks stay readable.

Also rejected, each measured rather than argued:
- `commonsHoleFraction` / `commonsSpokeGap` — the hole is a fraction of a disc
  that is itself shrinking, and the spoke gap is an *angle*, so its linear
  clearance shrinks with the ring. Both re-seal.
- Widening the band inward — moves rock into the eye and seals *earlier* (wave 3).
- Disc-area fill caps — arc on the thin ring binds first; 23/24 even at fill 0.40.
- `+ ASTEROID.maxRadius` on `innerRadius` — a **gate mask**. It enlarges the
  pocket past `unstuck`'s `WEDGE_R = 8` so CI goes green while the player stays
  entombed. `waves.test.ts` is the check it cannot fool.

### The taper is derived, not tuned per wave

`ringSizeScale` compares the arc the drawn rocks demand against the ring's
circumference, so it self-adjusts to player count (`sectors`), lobby size
(`sectorRocks`) and field radius. A hard-coded per-wave table would break at N=4
or N=16. The one calibrated number is `ringCorridorAllowance` 1.7, which is above
1 because rocks stagger radially across a band rather than sitting on a wire; it
is one step inside a measured cliff (0/100 at 1.6 and 1.7, 9/24 sealed at 1.8).

Applied **after** the draw, so the RNG stream is byte-identical whether or not the
taper bites.

### On the ruling that sent this back

The Director's measurement (green on `origin/main`, red here) is correct and the
rule behind it is right. One caveat worth recording: this branch is 23 commits
behind `main`, so that A/B is not a clean isolation of the branch delta. The
controlled version — the sim delta on this branch is *only* the constant, since
`damage.ts` and the rest are comment-only — gives the same verdict, and the
geometry measurement above shows why: the trap is on `main` too, on every seed,
and the constant only re-rolls which seed puts a bot inside it. Both statements
are true at once; the fix is the same either way.

## Balance impact (for the balance crew)

The fix does **not** change bot code. It changes the map, so it changes matches.

- **Ore: unchanged by construction.** `drawCanon` scales rock ore to the wave
  budget independently of radius and count, so the taper moves no ore. A smaller
  late rock carries the same ore in a denser package.
- **Fairness: untouched.** Both parts reshape the one drawn sector that is then
  stamped `N`-fold, so the commons stays rotationally symmetric
  (`resource-fairness.test.ts`).
- **The Outer Drift is weaker but alive:** final ring 76.8 u → 153.6 u, so the
  field closes 2× over the match instead of 4×. The endgame commons is a wider
  band; players converge less tightly.
- **Late rocks are smaller:** wave 4 ×0.905, wave 5 ×0.565 (mean radius 31 → 28
  and 37 → 21). Waves 1–3 unchanged. Smaller rocks are slightly harder to hit and
  block less line of fire.
- This lands on top of a live economy change already on this branch (the full
  death drop, measured at 4.8× more ore returned per kill). The two compound.

## NEXT

- Suite result and the A/B economy numbers to be appended once measured.
- Docs to update: `docs/wave-commons-entombment.md` (defect → fixed) and Q-6 in
  `docs/gdd-conformance.md` (the decision it was waiting on is now moot).
- PR body must state the cause in one sentence and name the fix as sim, not bots.

No blockers.
