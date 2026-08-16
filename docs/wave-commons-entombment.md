# The commons ring entombs ships at the map centre

**Status:** open defect on `main`. Root-caused and measured; **not fixed**, because
every fix that works is a balance/design call.
**Owner of the code:** Gameplay (`src/sim/waves.ts`, `src/sim/constants.ts`).
**Owner of the decision:** Director — this doc exists to make that decision cheap.
**Where the decision is queued:** `docs/gdd-conformance.md` **Q-6** (§7, QUESTIONS
FOR THE DEVELOPER), which states the ask in one screen and links back here for the
measurements. §2.3's wave row there carries the defect too, so the gap register
does not certify this mechanic without it.
**Found by:** `tests/harness/unstuck.test.ts`, during a0-59 (PR #436).

> This was written out of a0-59's PR body so it outlives that PR. a0-59 is a
> one-constant developer ruling that neither caused this nor worsened it; it is
> written up here so the two can be decided separately.

---

## The defect in one paragraph

From wave 2 onward the commons ring carries more rock than its own circumference
can hold, and by wave 5 it is **3.66× oversubscribed**. The ring closes to 71 u
from the map centre and seals the disc inside it: a solid annulus of overlapping
asteroids with a free pocket of **19.3 u** at its middle. `SHIP_RADIUS` is **16**.
Any ship standing near the centre when wave 5 lands is entombed for the rest of the
match — at full throttle, with nowhere to go. **This applies to a human player
exactly as it applies to a bot.**

The two clearance guarantees the code documents — the radial "clear eye" and the
angular "clear launch spoke" — are **both void at wave 5**, and the spoke guarantee
is already broken at wave 3.

---

## Measured geometry

Reproduced by instantiating the shipped world and reading the constants — no match
run required, so this is seconds, not hours:

```ts
const w = createWorld({ seed: 15, players: botLobby(fillEmptySlots([], MATCH_SLOTS)) });
// then read w.fieldRadius, w.asteroidsPerWave, w.stations.length,
// and waveRadiusFraction(n) for n = 1..5, against RESOURCE_FIELD / ASTEROID / SHIP_RADIUS.
```

```
fieldRadius=307.2  sectors=8  sectorWidth=45.00deg  gap=0.330rad (clamp 0.353)
asteroidsPerWave=20  sectorRocks=3  total=24  ASTEROID r=[22,46] mean=34  SHIP_RADIUS=16

wave  disc    eye(centres)  freeEye  ringMid  circum  rockArc  oversub  spokeClear
 1    307.2      261.1       215.1    284.2    1785     1632     0.91x      84.6
 2    249.6      212.2       166.2    230.9    1451     1632     1.13x      68.7
 3    192.0      163.2       117.2    177.6    1116     1632     1.46x      52.9
 4    134.4      114.2         68.2   124.3     781     1632     2.09x      37.0
 5     76.8       65.3         19.3    71.0     446     1632     3.66x      21.2

needSpokeClear = SHIP_RADIUS + ASTEROID.maxRadius = 62
rMinPassable   = (24 x 68 + 2 x corridor) / 2pi  = 276 u (corridor at mean rock)
                                                 = 280 u (corridor at max rock)
```

Column meanings, because two of them have bitten prior sessions:

- **`freeEye`** is `eye(centres) − ASTEROID.maxRadius`. The eye is reserved by rock
  **centre**, so the genuinely-free disc is a whole rock radius smaller than the
  constant suggests. At wave 5 that is a 19.3 u pocket for a 16 u hull — **3 u of
  slack**, very nearly a press fit.
- **`rockArc`** is `24 × 2 × 34`: the arc all the wave's rocks occupy if laid
  shoulder to shoulder around the ring. **`oversub` is `rockArc / circum`.** Above
  1.0 the rocks must overlap; there is no arrangement in which they do not.
- **`spokeClear`** is `eye × sin(gap)` — the *linear* clearance the angular spoke
  gap actually buys at that ring. Compare it to `needSpokeClear = 62`.

### Confirmation from a real match

`tests/harness/unstuck.test.ts` seed 15, `foreman` (slot 2), wedged **133.5 s** at
(1204,1195) — the map centre is (1200,1200):

```
t=570  wave 4    0 rocks near centre   slot 2  39u from centre   free
t=600  wave 5   24 rocks near centre   slot 2   8u from centre   WEDGED
t=810  wave 5   23 rocks near centre   slot 2   6u from centre   still wedged
```

The measured pocket at seed 15 is ~21.6 u, against the 19.3 u the geometry predicts
— same number, confirming the pocket **is** `eye − rock body`. The "13×9 u box the
ship orbits" that earlier diagnoses chased is the pocket.

Per-seed, at the instant wave 5 lands:

| seed | free pocket | ring blocked |
|---|---|---|
| 1 | 32.1 u | 232/360 directions |
| 7 | 27.7 u | 264/360 |
| 15 | 21.6 u | **304/360** |
| 42 | 35.9 u | 200/360 |
| 991 | 38.1 u | 192/360 |

Every seed measured puts a rock trap at the exact centre of the board from wave 5.

---

## Incidence: ~1.25% of seeds, and it is on `main`

200 seeds, both arms, run through a verbatim copy of `unstuck`'s own `worstWedge`
probe (`WEDGE_R = 8`, `WEDGE_LIMIT_S = 12`, 20-minute cap):

| build | wedged seeds | rate |
|---|---|---|
| `main` (`DEATH_ORE_DROP_FRACTION` 0.5) | 142, 146, 147 | **3 / 200** |
| a0-59 (fraction 1) | 15, 142 | **2 / 200** |

Every wedge on both builds is at or beside the map centre. The lone outlier (146,
108 u out) is still inside wave 5's 21.6 → 112 u annulus.

**`main` passes the standing gate by luck.** The gate draws seeds 1–24 and asserts
zero; all three of `main`'s bad seeds fall outside that draw. Seed 15 falls inside
it, which is the only reason this is visible at all.

**Consequence for every lane:** a zero-tolerance 24-seed draw over a ~1.25% defect
passes ~74% of the time, so roughly **one sim change in four** will turn
`unstuck.test.ts` red without having caused anything. Until this is fixed, a red
`unstuck` should be checked against this doc before it is treated as a regression.

---

## Why there is no placement fix

**The ring is oversubscribed.** Wave 5 needs 1632 u of rock arc on a 446 u
circumference. No angular or radial rearrangement fits 1632 u of rock into 446 u of
ring — this is arithmetic, not tuning. Every "just place them better" proposal dies
here, and two prior sessions of a0-59 lost time to proposals that had not checked it.

**`commonsHoleFraction` was never the right knob.** It was raised 0.75 → 0.85 for
*exactly this bug*, and its doc-comment claimed the raise pushed the innermost ring
out to "a radius whose circumference actually admits a ship-wide gap." That claim is
false — 276 u is needed, 71 u is delivered — and it has been struck out in
`src/sim/constants.ts` (a0-59, `faa756b`, comment-only). The raise grew `freeEye`
from ~10 u to 19.3 u, which shortened the wedge (a ship rattles in a bigger pocket
and sometimes escapes inside 12 s) without ever opening a corridor. The constant is
bounded by 1.0 and tops out at 77 u. **Do not raise it a third time.**

**`commonsSpokeGap` cannot repair it either.** It is an angle, so the linear
clearance it buys shrinks with the ring. The required gap exceeds the
`sectorWidth × 0.45` clamp long before the corridor opens, and the ring is
oversubscribed regardless.

**And the p14 escape hatch cannot repair it — measured, not reasoned.** This is
the last knob in the gameplay lane, and the obvious one to reach for: the sim
already carries a ratified anti-wedge mechanic (`WEDGE_SLIDE_SPEED`,
`WEDGE_SLIDE_KICK`, `WEDGE_SLIDE_RUN_S`, `WEDGE_CONTACT_S` in
`src/sim/constants.ts`; `updateWedgeEscape` in `src/sim/step.ts`) whose whole
job is that no ship stays wedged against anything, and whose doc-comment
promised a ship "can never *stay* pinned". So: is it simply failing to fire at
seed 15, and is this a one-constant tune after all?

**No. It fires on 98.4% of ticks and is already at full stretch.** Instrumented
over the 12600 ticks of the seed-15 wedge (slot 2, t = 600–810), reading
`Ship.wedgeContactS` / `Ship.wedgeSlide` off the live world:

| measure | value |
|---|---|
| ticks in contact with rock | 12599 / 12600 |
| ticks with the hatch armed and sliding | **12402 (98.4%)** |
| distinct slide directions used | **4 — the entire quarter-turn search, cycling** |
| mean hull speed through the wedge | **68.7 u/s** |
| clearance to nearest rock surface | −2.6 u to **+5.5 u**, against `SHIP_RADIUS` 16 |

Three things follow. The hull is **not motionless** — it is at cruise speed the
whole 133.5 s, which is why `unstuck` measures *displacement* and not speed. The
hatch is **not failing**; it runs its complete bounded search — tangent, outward
along the normal, other tangent, inward — over and over, exactly as designed. And
the search cannot succeed, because the pocket's most generous clearance is 5.5 u
for a 16 u hull: **there is no direction with an exit.** A larger
`WEDGE_SLIDE_KICK` or a longer `WEDGE_SLIDE_RUN_S` reaches the wall sooner and
changes nothing else.

The hatch beats *pinning against a surface* — one body, open space behind. It
cannot beat *enclosure*. Its search is over directions; it cannot make space. The
false guarantee has been struck from `src/sim/constants.ts` and `src/sim/step.ts`
(a0-59, comment-only) so the next reader is not sent down this path, since the
in-file promise was itself the argument for taking it.

**With this, every knob inside the gameplay lane is measured and exhausted.**
Placement (arithmetic), `commonsHoleFraction` (at its ceiling, wrong knob),
`commonsSpokeGap` (angular, clamped), and now the escape hatch (firing, saturated,
no exit). What remains is the three costed candidates below, and every one of them
is a design ruling.

---

## Candidates, costed

None is taken. Each needs a design ruling.

**1 · Widen the final wave's ring (`WAVE.lastRadiusFraction`, currently 0.25).**
**Recommend against — it is a non-starter, not a trade-off.** Passability needs a
ring mid radius of ~276 u out of a 307 u field, i.e. `lastRadiusFraction ≈ 0.90`
against wave 1's own 1.00. All five waves would land in the same annulus. This does
not weaken GDD §2.3's shrinking ring, it **deletes** it.

**2 · Cut late-wave rock size or count. The only knob with real travel.**
The ring is oversubscribed 3.66×, so passability needs the rock arc down ~4×:
either `ASTEROID.maxRadius` tapered with `waveRadiusFraction`, or `sectorRocks`
falling as the ring closes. Both keep GDD §2.3's ring closing in.
- Costs GDD §5.5's "a payout the player can judge" — rock size reads as ore — and
  changes the field's late-match visual texture.
- **The count variant is likely cheaper than the size variant**, because the wave's
  fixed ore budget absorbs it: fewer rocks carrying the same `WAVE_ORE` makes the
  survivors richer, which is the trade `asteroidCount` already documents.
- Moves goldens (`ffa-parity`, `FFA_GOLDEN`) by construction.
- **This is the one to brief.**

**3 · Eject any live ship a landing wave would entomb.**
Rock positions untouched, so `FIELD_YIELD` and the `N`-fold fairness symmetry are
both exact, and because it fires only on the ~1.25% of seeds where a ship is
actually caught it moves almost no goldens. Cheapest of the three and the only one
that changes no field design.
- Against it: it is a **new sim rule** (a wave displacing a ship), and it treats the
  symptom — with the ring 3.66× oversubscribed the centre stays a sealed pocket for
  anyone who flies in *after* the wave lands. It only stops someone being sealed in
  at the instant of landing.
- **Trigger must be "no escape route", not "overlaps rock".** At seed 15 the ship
  sits ~8 u from centre in a 19.3 u free pocket with a 16 u hull — it overlaps
  nothing. It is sealed *behind* a ~90 u annulus, not pinned inside rock. An
  overlap-triggered version would not fire.

---

## A second-order bug in the same file, worth folding in

The commons reserves its eye by rock **centre**:

```ts
const innerRadius = discRadius * RESOURCE_FIELD.commonsHoleFraction;
```

The launch pocket ~90 lines above in the same file reserves by rock **body**, and
says so:

```ts
// ...keeps the whole rock out of the pocket, not just its centre
const pocketOuterR = ringR - ringR * SPAWN_CLEAR_POCKET - ASTEROID.maxRadius;
```

The commons omits that `− ASTEROID.maxRadius` term. That is why a 65.3 u eye leaves
only 19.3 u of actually-free space. **Correcting it alone does not open a corridor**
— the ring is oversubscribed either way — but it is the same class of mistake, it
makes the constant mean what its name says, and it belongs in whichever brief takes
candidate 2. It moves rock positions, so it moves goldens.

---

## Repro

```
npx vitest run tests/harness/unstuck.test.ts     # fails at seed 15 with fraction = 1
```

For `main`'s sim, set `DEATH_ORE_DROP_FRACTION` back to `0.5` and probe seeds
**142, 146, 147**; seeds 1–48 are clean on `main`, which is the whole reason its
24-seed gate is green.

The geometry table needs no match run — instantiate the world as shown above.

---

## Diagnostic history, so it is not re-walked

Four wrong answers preceded this doc. Recorded because each is a plausible-looking
dead end:

1. "Steering limit cycle in open space" — measured centre-to-centre, not hull
   clearance.
2. A `dodge` oscillation between two rocks — a symptom of the pocket.
3. The pocket, root-caused correctly but **mis-costed**: a 12 u hull instead of the
   real 16, and an adjacent-pair spacing bound (`R ≥ 117`) instead of the
   whole-circumference one (`R ≥ 276`).
4. An A/B claiming a0-59 made the wedge ~50% *more* likely; on 200 seeds it is
   marginally less. The seeds behind the original table did not reproduce.

The conclusion "no in-lane fix" survived all four. The numbers under it did not.
**Trust the measured table; re-measure before trusting any prose about it — including
this sentence.**
