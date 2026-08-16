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
**Pinned by:** `src/sim/waves.test.ts` — a direct reachability check that, unlike
the wedge gate, cannot be masked by widening the cage. See
[The trap starts at wave 4](#the-trap-starts-at-wave-4-and-nothing-in-ci-can-see-it-there).

> This was written out of a0-59's PR body so it outlives that PR. a0-59 is a
> one-constant developer ruling that neither caused this nor worsened it; it is
> written up here so the two can be decided separately.

---

## The defect in one paragraph

From wave 2 onward the commons ring carries more rock than its own circumference
can hold, and by wave 5 it is **3.66× oversubscribed**. The ring closes to 71 u
from the map centre and seals the disc inside it: a solid annulus of overlapping
asteroids with a free pocket of **19.3 u** at its middle. `SHIP_RADIUS` is **16**.
Any ship standing near the centre when the late waves land is entombed — at full
throttle, with nowhere to go. **This applies to a human player exactly as it
applies to a bot.**

Two corrections to what this document used to claim, both measured in the
fourteenth session and both important to the ruling:

- **The seal closes at wave 4, not wave 5**, on every seed measured. Wave 5 is
  only where it becomes *visible*: it shrinks the sealed cell from 68–108 u across
  to 4–24 u, which is the first point a wedge detector can see it. For a whole
  wave beforehand an entombed ship flies around a roomy cell looking healthy.
- **It is usually not "for the rest of the match."** The ring is minable rock, and
  a trapped ship normally chews its way out in 30–120 s. The cost is a large slice
  of a wave cycle, not the match — but the tail is long (seed 15 is still sealed
  four minutes on) and the ship is helpless while it lasts.

Both are in [The trap starts at wave 4](#the-trap-starts-at-wave-4-and-nothing-in-ci-can-see-it-there).
Net: the defect is **much more frequent, much less visible, and less individually
severe** than this document previously said.

Earlier revisions said wave 5 throughout; that was the limit of the instrument,
not of the defect.

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

**Read the `wave 4 … free` row above with care.** "Free" there is the *wedge
probe's* verdict — the ship was not held inside `WEDGE_R = 8`, so the gate called
it fine. It was not fine: measured below, slot 2 was **already sealed in** at that
instant, inside a cell reaching 73 u. The row records the moment the instrument
went blind, not the moment the ship was still free.

---

## The trap starts at wave 4, and nothing in CI can see it there

*(Fourteenth session, 2026-08-16. This is the first measurement of **enclosure**
rather than of wedging, and it moves the start of the defect one wave earlier.)*

Every earlier measurement in this document — including the ray-cast in
[the masking section](#measured-and-it-is-a-trap-this-correction-masks-the-gate) —
asked whether a *straight line* leaves the centre. That is a necessary condition
for escape, not a sufficient one: a ship could in principle weave out through
gaps no radial ray finds. The test that settles it is a flood fill of free
**configuration space** — the set of positions a hull centre may legally occupy,
i.e. further than `rock.radius + SHIP_RADIUS` from every rock centre. If the
connected component containing the map centre never reaches past the field edge,
there is no route out at all, for any path, at any speed, with any steering.

Run on the shipped 8-slot field, waves 1–5, nine seeds:

| seed | w1 | w2 | w3 | w4 | w5 |
|---|---|---|---|---|---|
| 1 | open | open | open | **SEALED** (cell ≤102 u) | **SEALED** (≤17 u) |
| 7 | open | open | open | **SEALED** (≤68 u) | **SEALED** (≤12 u) |
| 15 | open | open | open | **SEALED** (≤73 u) | **SEALED** (≤6 u) |
| 42 | open | open | open | **SEALED** (≤82 u) | **SEALED** (≤22 u) |
| 142 | open | open | open | **SEALED** (≤108 u) | **SEALED** (≤4 u) |
| 146 | open | open | open | **SEALED** (≤77 u) | **SEALED** (≤24 u) |
| 147 | open | open | open | **SEALED** (≤72 u) | **SEALED** (≤6 u) |
| 991 | open | open | open | **SEALED** (≤74 u) | **SEALED** (≤24 u) |
| 2024 | open | open | open | **SEALED** (≤70 u) | **SEALED** (≤13 u) |

**9 of 9 seal at wave 4. 0 of 9 seal at wave 3.** This is structural, not
probabilistic: it is not that some seeds are unlucky, it is that the wave-4 ring
closes the centre on every board the generator can produce.

### Why a whole wave of it was invisible

`tests/harness/unstuck.test.ts` flags a bot held within `WEDGE_R = 8` of one spot
while asking to travel. That is a **cell-size proxy**, and it fails in both
directions here:

- **It cannot fire at wave 4 at all.** The sealed cell is 68–108 u across. A ship
  in it flies freely, re-anchors constantly, and never accumulates held time. It
  is entombed and reads as healthy.
- **Anything that enlarges the cell reads to it as a fix.** That is exactly the
  masking result already recorded below for the eye-by-body correction.

So the wedge gate does not measure entombment. It measures entombment *in a cell
small enough to look like wedging*, which is a strictly later and strictly rarer
event.

**A second instrument now exists: `src/sim/waves.test.ts`.** It pins this table's
two claims (escapable through wave 3; sealed at waves 4 and 5, seeds 1/15/42) and
is immune to the mask — applying the eye-by-body edit leaves it reporting sealed,
because it asks whether the ship can get *out*, not whether it has room to move.
It is a characterisation test: **if it goes red because the centre is escapable
again, that is the fix landing**, and this document and Q-6 should be updated with
it rather than the test being repaired.

### How often a ship is actually caught

Enclosure at the instant a late wave lands, over the standing gate's own 24 seeds,
shipped 8-slot bot cast, full matches:

| | |
|---|---|
| seeds with ≥1 ship entombed | **16 / 24** |
| ship-snapshots entombed | **28 of 46** free-and-inside the commons at a w4/w5 landing |
| of those catches, at wave 4 | **24 of 28** |
| excluded as transient rock contact | 11 (overlapping a rock is not enclosure) |

Two things follow.

**The wedge gate sees roughly one affected seed in sixteen.** It reds on seed 15
alone out of these 24; a ship is actually sealed in on 16 of them. The `~1.25%`
figure in the next section is the rate at which this defect *becomes visible to
CI*, and it has been read throughout this document as though it were the rate at
which it happens. It is not.

**Nearly every catch is the central pocket, but not quite all.** 27 of the 28 have
a cell reaching the map centre. The exception — seed 17, slot 3, at 146 u out,
cell 147–157 u — is a ship sealed into an **annular pocket between two rings**,
never near the centre at all. The oversubscription argument predicts this (a ring
that cannot admit a corridor cannot be crossed from either side), but it had not
been observed before, and a fix aimed only at the centre would not catch it.

### How long they stay caught — the seal is permeable, and this lowers the severity

Tracking all 24 ships sealed at the wave-4 landing, re-running the enclosure test
at +30 s, +60 s, +120 s and +240 s:

| outcome by +240 s | ships |
|---|---|
| got out alive | **18 / 24** |
| died while still sealed (or died and respawned out) | 5 / 24 |
| **still sealed** | **1 / 24** — seed 15, the one the gate catches |

Escapes cluster early: 8 by +30 s, 5 more by +60 s, 2 by +120 s, 3 by +240 s.

**A sealed ship cannot change component by flying**, so an escape means the field
itself changed — the ring is minable rock and it gets chewed open, by the trapped
ship or by anyone working that ring. That is a deduction from the geometry, not a
separate measurement: no path exists at +0 s and one exists at +60 s, and only
mining removes rock.

So the honest severity is **"a lost 30–120 s and a helpless ship", not "out of the
match"** — with a long tail, since seed 15 is still sealed after four minutes and
holds the wedge for 133.5 s of it. This is a real reduction in the per-incident
cost, and it should be weighed against the much higher incidence above rather than
read on its own.

> **Methodological caveat, because the raw traces mislead.** Ships respawn, and a
> respawned ship stands at its home station 768 u out, which the enclosure test
> reads as free. Counting "free" naively scores a death as an escape — it inflates
> the escape count from 18 to 21 of 24. The table above discounts any ship that
> showed as dead before it showed as free. Anyone re-running this must do the same.

One trace is worth singling out: **seed 23, slot 2 escapes by +120 s and is sealed
again by +240 s.** Re-entry is not hypothetical, which is the concrete form of
candidate 3's known weakness — ejecting ships at the landing instant does nothing
for whoever flies in afterwards.

---

## Incidence: ~1.25% of seeds *is the gate's detection rate*, not the defect's

> **Read this section for what it is.** Everything below is measured *through the
> wedge probe*, so it describes when the trap is loud enough for CI to notice, not
> when it happens. The rates here are ~1/16 of the entombment rate measured above.
> They are still the right numbers for the question "how often does this turn a
> build red", which is what they are used for.

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

### Independently confirmed on the five named seeds — four minutes, not four hours

The table above cost a 200-seed sweep on both arms. Confirming it does not: the
claim it carries is *which named seeds wedge on which build*, and that is four
matches per arm. Re-run from scratch, both arms, on the same tree with the one
constant flipped — every figure reproduces **to the tenth of a second and the unit
of position**:

| seed | `main` (0.5) | a0-59 (1) |
|---|---|---|
| 15  | clean — 2.5 s | **WEDGED 133.5 s** @1204,1195 `foreman` s2 `haul` |
| 142 | **WEDGED 40.9 s** @1202,1193 `foreman` s2 `defend` | **WEDGED 12.3 s** @1205,1204 `patch` s3 `cornered-fight` |
| 146 | **WEDGED 58.8 s** @1200,1308 `foreman` s2 `last-stand` | clean — 3.2 s |
| 147 | **WEDGED 95.9 s** @1198,1193 `patch` s3 `fix-base` | clean — 2.4 s |

Note the *behaviours* differ across the arms (`haul` vs `defend`, `last-stand`,
`fix-base`) while the *positions* do not. The trap is indifferent to what the ship
was trying to do; it is a property of the map, and any ship that is at the centre
when wave 5 lands is caught regardless of intent. That is the strongest single
piece of evidence that this is geometry and not bot logic.

**This is the cheap check.** Anyone doubting the headline — *`main` carries this
defect and a0-59 does not worsen it* — should run these four seeds on both arms
rather than re-run the sweep or re-read this document. The recipe is in
[Repro](#repro).

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

> **Before reading these, read the measured warning in *A second-order bug in the
> same file* below.** There is a fourth thing one could do — reserve the commons
> eye by rock body, correcting a real inconsistency — and it turns the red gate
> **green while leaving the ring 360/360 sealed**. It is the cleanest-looking edit
> here and it is the one that must not be made alone.

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
both exact. Cheapest of the three and the only one that changes no field design.
- **Re-costed, and it is no longer cheap on goldens.** This bullet used to read
  "fires only on the ~1.25% of seeds … so it moves almost no goldens". That was
  the *gate's* detection rate. Measured, a ship is actually entombed on **16 of 24
  seeds**, and the trigger must arm at **wave 4**, so this rule fires on most
  matches and displaces a ship in each. It moves goldens broadly, and it changes
  late-game positioning on two thirds of boards — a balance effect in its own
  right, not a quiet safety net.
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

### MEASURED, and it is a trap: this correction MASKS the gate

*(Thirteenth session, 2026-08-16. The paragraph above was reasoned; this is
measured, and it turns a tidy-looking cleanup into the most dangerous edit in this
file.)*

Applying exactly that one-term correction —

```ts
const innerRadius = discRadius * RESOURCE_FIELD.commonsHoleFraction + ASTEROID.maxRadius;
```

— and running the gate's own `worstWedge` probe verbatim at both values:

| build | free pocket (seed 15) | escape bearings blocked | `unstuck` seed 15 |
|---|---|---|---|
| shipped | 21.6 u | **360 / 360** | **133.5 s — RED** |
| eye reserved by body | 42.1 u | **360 / 360** | **2.7 s — GREEN** |

Worst wedge across all four decisive seeds falls to 2.4–2.7 s, under both
`WEDGE_LIMIT_S` (12 s) and the file's own worst-transient canary. **The only red
check on PR #436 goes green.**

**The ship is no less entombed.** The ring is 100 % sealed on *both* builds — not
one of 360 bearings admits a `SHIP_RADIUS` hull out of the commons, before or
after. The correction doubles the pocket (21.6 → 42.1 u) and opens **zero** exits.
What changes is only that the hull's centre can now roam ~26 u instead of ~5.6 u,
and `unstuck.test.ts:107` **re-anchors** whenever a hull travels more than
`WEDGE_R = 8` from its anchor. Above that threshold the gate stops accumulating
held time. The trap becomes invisible to the instrument while getting slightly
worse for the player: a bigger sealed pocket to cruise around inside.

**There is now a check this edit cannot fool.** `src/sim/waves.test.ts` measures
reachability rather than cell size, and applying the correction above leaves it
reporting **sealed** on all three of its seeds while `unstuck` goes green. If this
edit is ever made, that divergence — one gate green, the other still red-flagging
the seal — is the signal to read this document rather than to celebrate.

That is the whole mechanism, and it is worth stating plainly because it is
counter-intuitive: **`WEDGE_R = 8` is not a measure of confinement, it is a
measure of confinement *tighter than 8 u*.** A ship sealed in a 42 u cell is
entombed and reads as healthy.

Method, so it can be re-run: one line flipped on this tree, both arms measured,
then reverted — `git diff -- src/` empty afterwards, which is the proof the
restore was exact. Solidity is measured off the *field*, not off a ship, precisely
because changing the geometry re-rolls the match: under the correction slot 2 is
simply somewhere else when wave 5 lands (min radius 137 u, never at the centre),
so any ship-tracking measurement compares two different matches and answers
nothing. Ray-cast: for each of 360 bearings from the map centre, require
perpendicular clearance `> rock.radius + SHIP_RADIUS` against every rock along the
path out to 300 u.

Two caveats on the numbers, stated rather than smoothed over. This ray-cast is
**stricter than the 232–304/360 figures in the incidence table above** — it demands
whole-path clearance for a 16 u hull against the *cumulative* field (81 rocks
inside 260 u by wave 5), where the earlier metric looked at wave 5's own ring. Both
say sealed; only this one says *completely*. And the probe reproduces the earlier
free-pocket figure exactly — 21.6 u at seed 15, matching the measured pocket at the
top of this document — which is what validates it against known ground truth.

**Consequence for whoever takes this brief: do not take this correction as the
fix, and do not let a green `unstuck` be the evidence that the trap is gone.** It
is still worth making — the constant should mean what its name says — but it must
land *with* candidate 2, never before it, and the gate must not be the thing that
certifies it. On its own it is a change that deletes the only instrument currently
detecting a live, player-affecting defect.

---

## Repro

```
npx vitest run tests/harness/unstuck.test.ts     # fails at seed 15 with fraction = 1
```

For `main`'s sim, set `DEATH_ORE_DROP_FRACTION` back to `0.5` and probe seeds
**142, 146, 147**; seeds 1–48 are clean on `main`, which is the whole reason its
24-seed gate is green.

To reproduce the whole A/B in about four minutes rather than re-running the sweep:
copy `worstWedge` out of `tests/harness/unstuck.test.ts` verbatim into a scratch
file **under `tests/` or `src/`** (vitest's `include` is `tests/**/*.test.ts,
src/**/*.test.ts` — a probe at the repo root is silently collected as *no test
files found*), loop it over seeds `[15, 142, 146, 147]`, and run it once at each
value of the constant. Expected output is the per-seed table above. Delete the
scratch file and restore the constant afterwards — `git status` must come back to
where it started.

The geometry table needs no match run at all — instantiate the world as shown
above.

**The enclosure results are the cheapest of the lot**, and they are the ones that
matter most, so they are worth re-running rather than trusted:

```
npx vitest run src/sim/waves.test.ts     # ~2 s: escapable through w3, sealed at w4/w5
```

That file's `centreCanEscape` is the whole instrument — flood-fill free
configuration space, ask whether the centre's component reaches past the field
edge. Both other numbers in this section reuse it: the 9-seed table by calling it
per wave, and the 16/24 incidence by starting the fill at each live ship's
position during a real match (via `runHeadlessMatch`'s `onTick`) rather than at
the centre. Neither needs new geometry — just the same fill from a different
seed cell.

Validate any re-implementation against two anchors before believing it: it must
report the centre **open at wave 3** (a fill that always says "sealed" is the
easy bug), and it must reproduce the **19.3 u** free eye at wave 5 on seed 15.

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
5. **"The trap starts at wave 5, and hits ~1.25% of seeds."** Both wrong, and
   wrong the same way: every measurement up to the thirteenth session was taken
   through `unstuck.test.ts`'s wedge probe, which detects *small cells*, not
   *enclosure*. Measuring enclosure directly moves the onset to wave 4 and the
   incidence to 16 of 24 seeds. The defect was always this size; the instrument
   only ever showed its tip.

The conclusion "no in-lane fix" survived all five. The numbers under it did not.
**Trust the measured table; re-measure before trusting any prose about it — including
this sentence.**

The recurring lesson, now five for five: **every wrong number here came from
reading an instrument's verdict as the thing itself** — centre-to-centre distance
for hull clearance, adjacent-pair spacing for passability, a wedge threshold for
entombment. Before quoting a figure from this document, check what was actually
measured to produce it.
