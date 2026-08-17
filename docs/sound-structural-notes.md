# Sound — structural notes (a0-68)

OWNER: Sound Agent. **Three of the 2026-08-17 denials could not be answered with
sounds.** Each one says the *slot* is wrong, not the voice in it, so this file is
where the structure behind them is written down: what the sim actually knows, what
the tell actually carries, and — for one of the three — a question only the
developer can answer.

Two of the three are fixed in this brief. The third is a **finding**, and it is
deliberately left with no candidates against it until the developer rules.

The numbers below are measured, not asserted. Every one of them is regenerable:

```
npx vite-node evidence/a0-68-structural-slots/spawn-protection.ts
npx vite-node evidence/a0-68-structural-slots/impact-surfaces.ts
```

---

## 1. `spawnPulse` — *"we dont have spawn portection i dont know what these are"*

**This is the one the brief says not to answer with sounds, and it is not
answered with sounds.** The developer asked a question of fact, and it has one.

### Does spawn protection exist?

**Yes. It is ratified, live, and it decides matches.**

| | |
|---|---|
| GDD §2.1 | *"**10 seconds of spawn protection** on ship and reactor, so no rush can end a match before anyone has flown"* |
| GDD §2.8 | the baseline constants table: `Spawn protection · Ship and core, match start · 10 s` |
| GDD §7 (design review) | *"starting ore and spawn protection **replace the naked-core opening**"* — it is one of the changes the six-agent board asked for |
| `src/sim/constants.ts:74` | `SPAWN_PROTECTION_S: Tunable<number> = 10` |

Measured on a real two-player match:

```
SPAWN_PROTECTION_S                     10 s
ships[0].spawnProtect at t=0           10
stations[0].spawnProtect at t=0        10
ship protection lapses at              10.000 s
core protection lapses at              10.000 s
```

### Does it *do* anything?

**Yes — it is the difference between a shot landing and a shot passing through.**

```
target.spawnProtect = 10.0  → damage dealt 0    (the shot flew over it)
target.spawnProtect =  0.0  → damage dealt 3.5  (the shot landed)
```

One point-blank round, one target, one variable. Five separate rules read the
field, all in the Gameplay Engineer's files:

- `projectiles.ts:255` — a shot **passes over** a protected hull rather than dying on it;
- `projectiles.ts:309` — and over a protected core;
- `projectiles.ts:333` — and your own protection is **forfeited** the moment you
  land an offensive hit ("the grace is to fly, not to siege");
- `buildings.ts:1150` — a turret **will not acquire** a protected ship;
- `step.ts:842` — and neither will ship auto-aim.

It is also on the wire (`src/net/prediction.ts:1972`, `entity-events.ts:440`), so
it survives an online match, and in the determinism hash (`platform/freeze.ts`).

### Does it have a *tell*, and does `spawnPulse` fire?

**Both, and the sound fires a great deal more than anyone seems to have noticed.**

Visible (this is the Art Agent's half, listed for completeness):
`ships.ts:306` draws a **plasma shell** behind a protected hull, keyed into the
sprite cache at `atlas.ts:74`; `minimap.ts:168` dims a protected dot.

Audible: `observer.ts:465` emits a `spawnPulse` every `SPAWN_PULSE_S` (0.5 s) for
every protected ship, and `engine.ts` sounds each one, spatialised.

```
spawnPulse tells emitted                38     ← two-player match, first 15 s
  first at 0.52 s, last at 9.52 s
  per ship: p0=19, p1=19
```

**Nineteen per ship, and every ship in the match is protected at once.** At the
eight-slot count GDD §2.1 designs for, that is ~152 pulses in the opening ten
seconds of every match, of which the local player hears every one inside earshot.

### So what IS the finding?

The mechanic is not missing. **The sound is unattributable**, which is a different
failure and a worse one to leave in place:

1. It fires **on everybody**, not on the local player. Twenty blips arriving from
   several directions at match open do not read as *"you specifically are
   protected right now"* — they read as ambient noise, which is exactly how a
   player ends up not knowing what a sound is.
2. It fires on a **fixed clock rather than on a state change**, and the state it
   is reporting is one the player already has continuously (the shell is on their
   own hull, in front of them, for the whole ten seconds).
3. It has **no ending**. The moment that actually matters is protection
   *lapsing* — the instant you become shootable — and nothing sounds then. The
   pulses simply stop, and a sound stopping is not a tell.

The developer heard a sound they could not attribute to a mechanic, on a board
where the slot is labelled "Spawn Protection Pulse". That is the board working
correctly and the *design* being wrong.

### The proposal, for the developer to rule on

**Neither "voice it as it stands" nor "cut the mechanic".** Spawn protection is
ratified and load-bearing; cutting it is not on the table (§2.1). The recommended
option is (B).

| | proposal | what it costs |
|---|---|---|
| **A** | **Voice it as it stands.** Four candidates against `spawnPulse` as currently emitted. | Cheapest. Does not fix anything: the developer would be picking a nicer version of a sound they could not attribute. |
| **B** | **Re-scope the slot to the local player, and add the lapse.** `spawnPulse` becomes *your own* protection only — so it is one voice, not eight — and a new tell fires once when protection ends. Then voice both. | One observer change (a `local` check it already has the field for) and one new tell. This is a **gameplay/UX finding** as well as a sound one: the moment you become shootable is currently silent. |
| **C** | **Cut the sound, keep the mechanic.** The plasma shell and the dimmed minimap dot already carry it; §3.6 asks for a tell, and a visible one exists. | The GDD §3.6 mandate says *"visible **and** audible"*, so this is a documented exception rather than a tidy-up. |

**No `spawnPulse` candidates are generated in this brief.** The brief that produced
this note says so, and the reason holds independently: three of the four options
above change what the slot is for, and voices written against the wrong slot are
what got this row denied in the first place.

---

## 2. `matchEnd` — *"none of these sound like match end and we need separate ones for winning and losing"*

**Fixed in this brief.** Two findings, and the second explains why nobody could
have judged the four takes that were denied.

### Finding 1: the plumbing was never missing — the bank threw it away

`src/art/tells.ts` has documented `matchEnd`'s payload as **`magnitude: '1 win, 0
loss'`** since the tell was written, and `observer.ts:838` fills it from
`match.winner === this.local`. The soundtrack has been reading it correctly the
whole time (`music.ts` `MusicScore.end(magnitude >= 0.5)`), which is why
`musicWin` and `musicLoss` are two slots and always were.

The **bank** was the collapse: `TELL_SOUND` is a flat `kind → sound` table, so the
outcome was discarded one layer below the thing that carried it.

So `matchEnd` is now two slots, `matchWin` and `matchLoss`, resolved by
`soundForTell(kind, magnitude, variant)` — the one place a tell's payload becomes
a bank entry. `matchEnd` reads its **magnitude** (already categorical, already
documented as such, already read by the music); `shotImpact` reads the new
**variant** column (§3). Two mechanisms, because a second copy of the outcome in
the variant column would be a second source of truth for one fact.

### Finding 2: the denied takes were audible for a tenth of a second each

`src/sim/match.ts` resolves the match **in the same tick** the last opposing core
dies. So the observer emits `stationDeath` and `matchEnd` into the *same frame*,
in that order — and `stationDeath` starts the three seconds of quiet (GDD §4.7).

`DeathMoment.gain` is exactly 1 at the instant of the trigger and reaches 0 over
`HUSH_CUT_S` = **0.12 s**. The old `matchEnd` played through `routine → flat` on
the ordinary SFX bus, so it started at full level into a mix that was multiplied to
zero 120 ms later. All four denied takes are over a second long.

**The developer denied four sounds for not sounding like match end. They had heard
the first tenth of each.**

### How it is fixed, and how the sting and the music sit together

The fix is *not* to exempt the sting from the hush the way the death fall is
(a0-55). The three seconds of silence are a ratified design element and the brief
that produced this note says to protect them. So the outcome is **held**:

```
t = 0.00    the last core dies
            → stationDeath, on the hush-exempt sting bus (a0-55)
            → the three seconds of silence begin. Nothing else sounds.
t ≈ 3.05    the hush lifts past STING_GATE
            → matchWin / matchLoss — the VERDICT.
              SFX bus, short, dry. Which way it went, and nothing else.
t ≈ 3.60    STING_LEAD_S later
            → musicWin / musicLoss — the READING.
              music bus, longer, the emotional tail. Re-voiced in a0-67.
```

Verdict, then reading. They are on **different buses on purpose**: a player with
the music slider at zero still gets told which way the match went, which is the
property that makes two pairs right rather than redundant. `STING_LEAD_S` (0.55 s)
is what turns an overlap into a sequence — the brief for this work says in as many
words that the two pairs must not fight, so it is held as a test
(`audio.test.ts`, *"lands the SFX verdict BEFORE the music that reads it"*).

### A hush bug found on the way

`DeathMoment.gain` crosses `STING_GATE` **twice** — once on the 0.12 s ramp *into*
the quiet and once on the 0.9 s ramp *out* of it. A sting gated on
`gain > STING_GATE` therefore opens on the way IN, three seconds early, inside the
silence it exists to protect. The first version of the outcome sting did exactly
that. `./engine` now derives a `stingGate` from `DeathMoment.silent` (unambiguous
for the whole window) and hands the same corrected number to the music director,
which had the same latent bug and was only saved by its own lead being longer than
the ramp.

---

## 3. `shotImpact` — *"none of these sound like impact sounds, they should also be different depending on the thing that was hit..."*

**Fixed in this brief.** The second clause is the structural one: no set of takes
against a single slot could have answered it.

### What the sim really knows at the moment of impact

Read `src/sim/projectiles.ts` `resolveHit` rather than assuming. A shot despawns on
the **first** body it strikes, tested in this order:

| # | branch | what applies | reachable by |
|---|---|---|---|
| 1 | enemy **ship** | `damageShip` | any shot |
| 2 | **asteroid** | `chipAsteroid` | ship weapon only |
| 3 | enemy **turret** | `damageTurret` | ship weapon only |
| 4 | enemy **radar satellite** | `damageSatellite` | ship weapon only |
| 5 | enemy **station**, shields up | `damageStation` → the bubble absorbs | ship weapon only |
| 6 | enemy **station**, no shields | `damageStation` → the core | ship weapon only |

**Six distinguishable physical events**, not the four the brief guessed at. A
turret shot only ever reaches branch 1; everything else is the ship weapon, which
mines and fights with one projectile (amendment v0.3).

Two things the sim knows that are **not** impacts: a shot that expires and a shot
that leaves the arena. The observer already filters both, and they stay silent.

### Six branches, four voices

| sim branch | voice | why |
|---|---|---|
| ship | `impactHull` | thin plate over a body that is moving — the only one that rings |
| asteroid | `impactRock` | stone: it absorbs, it does not ring |
| shield up | `impactShield` | the round never reached anything solid, and that is the whole information |
| turret · satellite · core | `impactStation` | anchored, mounted metal — one arrival |

The fold is a **decision**, and it lives in one table (`IMPACT_OF`, `src/art/tells.ts`)
so a later brief can split satellites out by moving a row rather than re-deriving
any of this. The argument for it: the *arrival* is the same event on all three
(a round biting anchored metal), and each already has its own **consequence** voice
a beat later — `turretDown`, `coreHit`, a satellite's own death. The impact says
what you hit; the consequence says what it did. Splitting the arrival three ways
would spend three slots on a distinction the next sound already makes.

Four is also about what an ear can learn. The player has to acquire these during a
firefight, on a phone speaker.

### How the surface reaches the audio engine

**Not by the renderer telling it, and not by the sim growing an event bus.**

`src/sim/` emits no events and that is load-bearing (GDD §4.1) — it is also not
this lane's file. So the surface is **derived** in `WorldObserver.impactSurface`,
which is where every other tell in the game comes from, and written into a new
`variant` column on the tell.

That placement is the point. The observer is the one derivation both halves of art
read, and it runs identically on a locally predicted world and on an authoritative
server snapshot (GDD §4.2) — so the prediction path and the authoritative path
cannot disagree about what the player hears. Choosing the sound from whatever the
renderer happened to know would have been exactly that disagreement.

The classifier walks the same list in the same first-body-wins order as
`resolveHit`, so where two bodies overlap it agrees with the branch that actually
ran. Rock is last and is also the fall-through — which `hitsHull` already assumed,
and which a rock mined out by the finishing shot needs (it is removed at end of
step, so it is gone by the time the observer looks).

### Why `variant` is a column and not a value in `magnitude`

`magnitude` is a *strength* — the mixer multiplies a gain out of it
(`engine.ts` `levelFor`). A shot into rock is not a quieter shot into a hull.
Packing a categorical value into a continuous one is the same defect `matchEnd`
had, and it is why that slot could sound the same on a win and a loss for six
months without anyone noticing.

### The two frame-boundary cases

The observer sees the world **after** the hit resolved, so the two targets a shot
can destroy have to be remembered rather than seen:

- **A shot that kills a hull.** `resolveHit` only strikes a *live* ship, so it is a
  hull hit — but the ship is dead by the time we look, a geometric scan skips it,
  and the impact falls through to the default. **The shot that kills somebody
  would have sounded like a shot into stone.** `ShipMemo.hullFrame` records "was
  alive entering this frame", which is the state the shot met.
- **A shot that empties the last shield.** `damageStation` spends the hit on a live
  bubble before the core sees any of it, so it was a shield hit; the post-hit world
  says core. `ShieldMemo.upFrame`, same trick, same reason.

Both are written from the memo's previous value earlier in the same frame.

### Measured, end to end

One real shot per branch, through the real sim and the real observer:

```
scenario                                   sim branch that ran      surface   → voice
an enemy ship                              damageShip               hull      → impactHull
an enemy ship, killed by the shot          damageShip → dead        hull      → impactHull
an asteroid                                chipAsteroid             rock      → impactRock
an enemy turret                            damageTurret             station   → impactStation
an enemy core behind a live shield (1 up)  damageStation → shields  shield    → impactShield
an enemy core, no shield                   damageStation → core     station   → impactStation
```

### Known limit, stated rather than hidden

Bodies move between the tick the shot resolved and the frame the observer reads. At
60 Hz that is one tick of velocity against a ship radius plus `HULL_HIT_SLOP`, which
is small — but it is a real approximation, and it is the same one `hitsHull` has
lived with since the laser retired. If it ever misclassifies in practice, the fix
is a wider slop or a memo of last-frame positions, not a different architecture.

---

## 4. An adjacent finding: two adopted sounds that cannot be heard

Turned up by the control in `spawn-protection.ts` and **not fixed here** — it is
outside this brief and it needs a decision.

`TELL.mineHit` and `TELL.weaponHit` are the two firing voices GDD §3.6 names
explicitly (*"the distinct rock-vs-hull impact sounds"*). They route to `rockChip`
and `hullHit`, which are two of the very few slots the developer has actually
**adopted** — `rockChip/b` on 2026-08-13, `hullHit/a` on 2026-08-13.

They never fire.

```
turret muzzles published over 60 s of live fire       90
  …of which carry a hitPoint                          0
```

`src/sim/buildings.ts:1334` `makeMuzzle` has emitted `hitPoint: null`
**unconditionally** since the v0.3 laser funeral — correctly, and the Gameplay
Engineer's own test asserts it (`buildings.test.ts:1069`). But
`observer.ts:498` skips any muzzle without one, so `observeMuzzles` has been a
no-op ever since, and `mineHit`/`weaponHit` have been dead tells.

Consequences worth someone's attention:

1. **Two sounds the developer chose by ear are not in the game.** Any judgement of
   the mix that assumed they were is wrong by two voices.
2. **`shotImpact` has been carrying the entire impact vocabulary alone** — which is
   a large part of why *"none of these sound like impact sounds"* was a fair thing
   to say. It was doing four jobs and standing in for two more.
3. The §3.6 rock-vs-hull mandate is currently satisfied by `impactRock` and
   `impactHull` (the a0-68 family) rather than by the slots named for it.

The likely resolution is that `rockChip`/`hullHit` and the impact family are now
**the same two jobs described twice**, and one pair should be retired — but that is
a merge of two vocabularies across two lanes, and picking which survives is a
Director call, not a sound one.

---

## Bookkeeping: what happens to a denial whose slot no longer exists

`docs/sound-denials-outstanding.md` holds a rule — *a row leaves only when the slot
carries a verdict that is not `deny-all`* — which `shotImpact` and `matchEnd` can
now never satisfy, because there is nothing left to carry a verdict.

The disposition is **`superseded — structural`**, and it is not a way to make a
denial go away quietly. It requires all three of:

1. the reason is quoted verbatim on the row, as always;
2. the heirs are **named** on the row, so the trail from denial to answer is one hop;
3. every heir carries a full set of offers under letters no verdict has spent —
   which `candidates.test.ts` enforces off the manifest's `split` rows, so a slot
   cannot be deleted to escape the work it owed.

The heirs' letters start at `a`. A letter only means anything inside a slot
(`/status/sound-choices.json` records a slot **and** a letter) and no verdict has
ever named an `impactHull` or a `matchWin`, so there is no record for an `a` to
make unreadable. Inventing an offset would imply a history the slot does not have.
