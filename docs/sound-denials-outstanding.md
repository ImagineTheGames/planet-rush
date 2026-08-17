# Sound denials outstanding — every denial, and the decision against it

OWNER: Sound Agent. This is the ledger that should have existed on 2026-08-07.

`docs/sound-adoptions.md` watches the gap between a developer **approval** and the
bank. This file watches the other gap, the one that stayed open longer: between a
developer **denial** and the work it was supposed to produce. Nineteen denials sat
for a week and a developer had to go looking for one of them in the game before
anybody noticed — not because nothing was written down, but because what was
written down was a *list* and a list carries no decision.

So every row below carries a **disposition**, and there are only three:

| disposition | means |
|---|---|
| **revoice** | the denial is unanswered. New offers are owed, under new letters. |
| **cut** | the developer asked for no sound here. The slot should lose its voice, not gain a new one. |
| **superseded** | offers that post-date the denial are already on the board, waiting for a first verdict. Nothing is owed but a listen. |

## The rule that produces a disposition

A denial names a *set of offers*, and `/status/sound-choices.json` records it as
`{"verdict": "deny-all"}` against the slot, with a timestamp and nothing else. So
the only mechanical question that can be asked of a stale denial is:

> **Is the newest offer in this slot older or newer than the denial?**
>
> Newer → the denial has been answered; it is **superseded** and wants a listen.
> Older → the developer is still looking at the sounds they turned down; it is
> **outstanding** and wants either a revoice or a cut.

That test is applied to all 38 rows below, by resolving each slot's current
candidate `a` back to the commit that introduced it. It is the test the board
could not make, and the reason is in *"Why nobody noticed"* at the bottom.

## The reasons, verbatim

Four distinct denial reasons are on the record. They are quoted here character for
character and must be quoted character for character into anything that
regenerates a slot — a paraphrase of a denial is a new opinion (LESSONS §17).

**R1** — 2026-08-07T20:09:00Z, 35 slots. Recorded on the developer's behalf as an
instruction to the Director:

> still have all the old sounds i said i didnt want there, we need to deny all of
> those sounds at once and make new ones that match the new theme (modern/sci-fi
> and not retro/toony)

**R2** — 2026-08-14T19:19:51Z, `levelUp`:

> sounds too toony, doesn't sound rewarding

**R3** — 2026-08-14T19:21:23Z, `xpBarFill`:

> all these sounds are mega annoying, we don't need this at all no need for regeneration

**R4** — 2026-08-14T19:17:16Z, `oreCollect`:

> add a little bit more of sparkle to it, like you've won a prize, but subtle... it shouldn't be too long

**R5 addendum** — `rejectBuzz`, 2026-08-17T00:45:19.932Z, denied in the same pass
as the other nineteen and missed by both briefs that answered it:

> none of these sound like rejected

It is recorded separately here because the miss is the point. a0-67 was scoped to
sixteen slots and a0-68 to three, and this row was in neither list — not because
anybody argued it out, but because the two briefs were written from two different
readings of one verdict pass. The board's own `denied_without_work` signal flagged
it within a minute of being pointed at the rule that work must post-date the
verdict it answers. That signal is still the open question at the bottom of this
file: nothing reads it, and this is now the **third** round where it would have
caught something before a person did.

**R5** — 2026-08-17, **twenty slots, a reason each.** The developer listened to
the whole a0-60 re-voiced board and denied nineteen of the thirty-five, not with a
theme this time but with a specific sentence per slot. They are quoted character
for character in `docs/sound-round-two-manifest.md`, which is the status of record
for the sixteen of them that ask for new sounds (a0-67). The other three —
`shotImpact`, `matchEnd`, `spawnPulse` — ask for **structural** changes rather
than voices and are a0-68; they are deliberately not in that manifest, because a
row there is a promise of four voices and offering four voices against a reason
that is not asking for voices is how a board gets denied a third time.

**What R5 says about R1, and about how this ledger reads a denial.** R1 was one
sentence over thirty-five slots and it was answered with one theme, per family.
Nineteen of those thirty-five came back. That is not a verdict on the sweep's
craft — several of the round-one takes are exactly what their family note asked
for, and `buildPlaced`'s four are a textbook execution of *"a latch, never a
fanfare"* (§7.3). It is a verdict on the **shape of the answer**: a theme can only
be wrong in one way at a time, and sixteen slots turned out to be wrong in sixteen
different ways. The rule this ledger takes from it, for the next deny-all that
arrives:

> **A denial that names a register can be answered by a register. A denial that
> names a slot cannot.** Where a reason is available per slot, the round is worked
> slot by slot even if that is sixteen briefs' worth of reading — because the
> alternative is one more round that answers the average of what was said and
> none of what was said.

**On R3's last clause.** The a0-49 brief quotes R3 as ending at *"we don't need
this at all"*. The record runs four words further — *"no need for regeneration"* —
and those four words are the whole disposition. The brief reads the shorter
quotation correctly anyway (*"Reason 3 is not a request for a new sound"*); the
record simply says so outright, so nobody has to read it as written.

**R4 is not in the a0-49 brief's table at all**, and it should have been: see
`oreCollect` under *revoice*.

## The ledger

38 outstanding denials. `†` marks the twenty-one the a0-49 brief lists as having
no regeneration brief against them.

| slot | label | reason | denied (UTC) | offer on the board now | disposition |
|---|---|---|---|---|---|
| `alarm` | Home Alarm | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `5dfc162`) | superseded |
| `ambient` | Ambient Bed | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8406579`) | superseded ×2 |
| `bankOre` | Bank Ore | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `f908f8d`) | superseded |
| `buildComplete` | Build Complete | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `5dfc162`) | superseded |
| `buildPlaced`† | Build Placed | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `5dfc162`) | superseded |
| `collapseBegin`† | Collapse Begin | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `5dfc162`) | superseded |
| `coreHit` | Core Hit | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `96d5085`) | superseded |
| `depositTick`† | Deposit Tick | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `f908f8d`) | superseded |
| `holdFull` | Cargo Hold Full | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `f908f8d`) | superseded |
| `matchEnd` | Match End | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `5dfc162`) | superseded |
| `minimapPing`† | Minimap Ping | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `c81ea9c`) | superseded |
| `musicBed`† | Music Bed — Calm | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8406579`) | superseded |
| `musicDread`† | Music Dread — Collapse | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8406579`) | superseded |
| `musicLoss`† | Defeat Sting | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8406579`) | superseded |
| `musicPulse`† | Music Pulse — Rising Tension | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8406579`) | superseded |
| `musicTheme`† | Music Theme — Siege | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8406579`) | superseded |
| `musicWin`† | Victory Sting | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8406579`) | superseded |
| `pressTick` | Press Tick | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `c81ea9c`) | superseded |
| `purchaseConfirm`† | Purchase Confirm | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `c81ea9c`) | superseded |
| `rejectBuzz` | Reject Buzz | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `c81ea9c`) | superseded |
| `repairTick`† | Repair Tick | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `5dfc162`) | superseded |
| `respawnBeep` | Respawn Beep | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `c81ea9c`) | superseded |
| `respawnGo`† | Respawn Go | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `c81ea9c`) | superseded |
| `shieldDown` | Shield Down | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `96d5085`) | superseded |
| `shieldHit` | Shield Hit | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `96d5085`) | superseded |
| `shipExplode` | Ship Explosion | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8cfb860`) | superseded |
| `shipSpawn`† | Ship Spawn | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8cfb860`) | superseded |
| `shotImpact` | Shot Impact | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `96d5085`) | superseded |
| `spawnPulse`† | Spawn Protection Pulse | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8cfb860`) | superseded |
| `stationDeath`† | MiningStation Death | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `5dfc162`) | superseded |
| `thruster` | Thruster Loop | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `8cfb860`) | superseded |
| `turretDown`† | Turret Destroyed | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `96d5085`) | superseded |
| `turretFire` | Turret Fire | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `96d5085`) | superseded |
| `upgradeBought`† | Upgrade Bought | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `5dfc162`) | superseded |
| `waveArrive`† | Wave Arrive | R1 | 2026-08-07 20:09 | 2026-08-08 (a0-01b `5dfc162`) | superseded |
| `oreCollect` | Ore Collect | R4 | 2026-08-14 19:17 | **2026-08-15 (a0-49, `d`/`e`/`f`)** | **revoice — done** |
| `levelUp`† | Level Up | R2 | 2026-08-14 19:19 | **2026-08-15 (a0-49, `d`/`e`/`f`)** | **revoice — done** |
| `xpBarFill`† | XP Bar Fill | R3 | 2026-08-14 19:21 | 2026-08-09 (p1-07 `c1fb32b`) | **cut** |

Counted: **35 superseded, 2 revoice, 1 cut.**

### R5, 2026-08-17 — nineteen rows, and where each one is

The ledger's rule is that a denial gets its row before anything else happens, so
these are recorded here as well as in the round-two manifest. `oreCollect` appears
twice in this file on purpose: it now carries two live denials from two different
dates, and the older one (R4) was not withdrawn by the newer.

| slot | reason | disposition |
|---|---|---|
| `oreCollect` | R5 | **revoice — done** (a0-67, `g`/`h`/`i`/`j`) |
| `turretFire` | R5 | **revoice — done** (a0-67, `h`/`i`/`j`/`k`) |
| `shieldHit` | R5 | **revoice — done** (a0-67) |
| `thruster` | R5 | **revoice — done** (a0-67) |
| `buildPlaced` | R5 | **revoice — done** (a0-67) |
| `bankOre` | R5 | **revoice — done** (a0-67, around the incumbent) |
| `upgradeBought` | R5 | **revoice — done** (a0-67, around the incumbent) |
| `stationDeath` | R5 | **revoice — done** (a0-67) |
| `alarm` | R5 | **revoice — done** (a0-67) |
| `musicBed` | R5 | **revoice — done** (a0-67) |
| `musicPulse` | R5 | **revoice — done** (a0-67) |
| `musicTheme` | R5 | **revoice — done** (a0-67) |
| `musicDread` | R5 | **revoice — done** (a0-67) |
| `musicWin` | R5 | **revoice — done** (a0-67, around the incumbent) |
| `musicLoss` | R5 | **revoice — done** (a0-67, around the incumbent) |
| `pressTick` | R5 | **revoice — done** (a0-67, back into the ratified glass) |
| `shotImpact` | R5 | **superseded — structural** (a0-68): the slot is gone, split into `impactHull`/`impactRock`/`impactShield`/`impactStation`, four offers each |
| `matchEnd` | R5 | **superseded — structural** (a0-68): the slot is gone, split into `matchWin`/`matchLoss`, four offers each |
| `spawnPulse` | R5 | **finding — awaiting the developer** (a0-68). The mechanic is live, ratified and effective; the SOUND is unattributable. `docs/sound-structural-notes.md` §1 puts three options up. **No candidates until they rule** |
| `rejectBuzz` | R5 | **revoice — done** (a0-68, `h`-`k`). Denied the same evening as the other nineteen and left out of both a0-67's brief and a0-68's original scope; `denied_without_work` caught it |

Every row above stays in this file under the rule at the bottom: a row leaves only
when the slot carries a verdict that is not `deny-all`, and none of these does yet.
What has changed for the sixteen is the same thing that changed for `oreCollect`
and `levelUp` under a0-49 — the newest offer in the slot now post-dates the denial,
under letters no verdict has spent, which is the test every other row here is
judged by. The before/after in numbers is `evidence/a0-67-round-two/numbers.txt`,
regenerable.

**One thing R5 fixed that this ledger had been complaining about since a0-49.**
`/status/sound-choices.json` records a verdict as a slot and a **letter**, so *"keep
what ships"* has never been an expressible answer — and four of the sixteen reasons
open with some form of *"i like current"*. Six slots now offer the incumbent under
a letter of its own (`SoundCandidate.anchor`, written through to
`sound-review/manifest.json`), which makes it one. It also costs nothing: an anchor
is asserted to render sample-for-sample identical to the shipped voice, so it can
never quietly become an improvement on the developer's own reference.

> **Update, a0-60 (2026-08-16).** *Superseded* was the correct mechanical reading
> — the a0-01b offers do post-date the denial — and it was still not what the
> developer was looking at: *"im still staring at a sound board with no
> regenerated options."* The 35 rows above were re-voiced under new letters in the
> a0-60 sweep, slot by slot, and `docs/sound-revoice-manifest.md` is the status of
> record for that. The lesson for this ledger is that **superseded is not a
> disposition a lane can close a denial with**: an offer standing behind a
> deny-all still reads as the denied board until the denied letters come *off* it.

The two revoices were made under this brief and are on the board now. **Both rows
stay in this file**, because the rule at the bottom is that a row leaves only when
the slot carries a verdict that is not `deny-all` — and neither does yet. What
changed is that the developer is no longer looking at sounds they turned down: the
newest offer in each slot now post-dates its denial, which is the same test every
other row is judged by. The before/after that says the offers actually moved in
the direction asked for is `evidence/a0-49-revoice/numbers.txt`, regenerable.

---

## cut — `xpBarFill`

The developer's words are *"we don't need this at all no need for regeneration"*.
Read as written, that is not a brief for a fourth take on a bar-fill bed; it is a
request to stop making the noise. A sound removed is a sound that cannot annoy
anybody, so **cut is the recommendation.**

§4.9 does not merely sanction losing audio in general here — it names this exact
screen. **Item 3 on the ranked cut list is *"End-of-match summary reduces to a
plain winner screen (Rematch button stays)"***: the whole sequence this bed plays
under is already ranked above the line, decided in daylight rather than at 2 a.m.
on M7. Cutting one loop out of it is a strictly smaller decision than the one the
GDD has already taken, and it is the only one being proposed.

**What the slot is.** `xpBarFill` is the only *sustained* cue in the end-of-match
summary set: a loop started when the XP bar begins moving and stopped when it
stops, its filter and rate riding the bar's progress (`engine.ts` `xpFill()` /
`stopXpFill()`). It is not a mechanic's tell. It is the bed under a bar animation
on a screen the player sees after every match, forever — which is exactly the
shape of thing that becomes *"mega annoying"* by the tenth match.

**What the cut costs, honestly:**

- **Nothing in §3.6.** *Every mechanic gets an audible tell* is not touched: the
  bar fill is a presentation of XP already earned, and the beats around it keep
  their voices — `xpTick` counts the rows (approved, `a`, 2026-08-14), `levelUp`
  marks the threshold, `xpSettle` is the full stop. The sequence still speaks.
- **One deliberate design intent, dropped.** pr-07 built `levelUp` to *duck* the
  bed rather than replace it — *"beat 4 is a pause in the fill, not the end of
  it… a bed that cut out and restarted would announce the seam."* With no bed
  there is no seam to announce and nothing to duck, so `levelUp` lands into
  silence instead of into a hole in a texture. That is a smaller moment. It is
  also the moment the developer just called too toony and not rewarding, so it is
  being rebuilt anyway (see below) and can be built for silence around it.
- **Zero risk to the summary's timing.** The bed carries no state the sequence
  reads; `driveSummaryAudio` calls `xpFill`/`stopXpFill` and never asks it
  anything.

**What the cut actually takes, and who owns each piece.** This is a proposal, not
a change made under this brief, because it cannot be finished inside
`src/art/audio/`:

| step | file | owner |
|---|---|---|
| stop driving the bed | `src/main.ts` `driveSummaryAudio` — drop the `frame.barMoving` branch | **not the Sound Agent's** — UI/app seam |
| drop the engine surface | `src/art/audio/engine.ts` — `xpFill`, `stopXpFill`, `xpFilling`, the loop handle and its trims | Sound Agent |
| drop the voice | `src/art/audio/bank.ts` — `SOUND.xpBarFill` and its spec | Sound Agent |
| drop the offers | `src/art/audio/candidates.ts` + `sound-review/` previews | Sound Agent |
| retire the set-level tests that name it | `audio.test.ts`, `candidates.test.ts` | Sound Agent |

The `src/main.ts` line is the one that makes this a Director decision rather than
a Sound Agent one: removing the bank entry first would break the build for
everybody else. **Nothing in this brief has been cut. The bed still plays.**

**The one question inside R3.** The developer wrote *"all these **sounds**"* —
plural — but the board recorded it against `xpBarFill` alone. Two minutes earlier
they had *approved* `xpTick` (`a`) and denied `levelUp` for being unrewarding, so
they were plainly discriminating between the four cues rather than dismissing the
set. This ledger therefore reads R3 as applying to the slot it was filed against
and no other, and does **not** extend it to `xpTick` or `xpSettle` — extending a
denial to a slot it was not recorded against is inventing a verdict. If the
developer meant the whole summary set, say so and the cut widens to three.

## revoice — `levelUp` and `oreCollect`

These two are the only rows where the denial post-dates every offer in the slot.
The developer is looking at the sounds they turned down, and nothing is queued.

**`levelUp` (R2)** — *"sounds too toony, doesn't sound rewarding"*. Two demands,
and the second is the harder one: the first re-voice of this game already learnt
that removing the toy is not the same as adding the reward (`a0-01`'s finding —
retiring `square` for bare sine partials produced *"a glockenspiel… not less
toony, differently toony"*). A reward in the amended register is **arrival with
mass**, not brightness: something has to move and then be *seated*, with a low
body under it, and the material has to be machined rather than struck-toy.

**`oreCollect` (R4)** — *"add a little bit more of sparkle to it, like you've won
a prize, but subtle... it shouldn't be too long"*. Sparkle is the developer's
word and it is in tension with the amended §4.7 register, so it is taken as
*high-frequency detail with a short life* — several small bright contacts at the
top of the spectrum, not a glissando and not a chime. `oreCollect` is `TELL.
oreCollect` and fires on every ore pickup, so *"shouldn't be too long"* is a hard
bound, not a preference.

Both are re-offered in this brief as **`d`/`e`/`f`**, never as `a`/`b`/`c`.

### What was actually offered, and the number each clause became

There is no house style applied across the two: the reasons ask for opposite
things, and each slot is held to its own words. Every bound below is resolved
against **the takes that were denied** rather than against a constant somebody
picked, because the only thing that makes a re-offer an answer rather than another
guess is that it moved, in the direction that was asked for, from the thing being
rejected. Full table: `evidence/a0-49-revoice/numbers.txt`.

| slot | offer | character | the clause it answers, measured |
|---|---|---|---|
| `oreCollect` | `d` | flake shear, bright chips off the snap | sparkle 0.370 |
| | `e` | charged intake, an ionised edge | sparkle 0.309 |
| | `f` | assay ping, two high bands reading back | sparkle 0.382 |
| `levelUp` | `d` | a lock engaging, mass seating hard | mass 0.058 · seated 0.42 |
| | `e` | a drive coming online, opening | mass 0.069 · seated 0.49 |
| | `f` | a vault seating, contacts in a room | mass 0.063 · seated 0.43 |

- **Sparkle** is the share of energy above 3 kHz. The three denied takes measured
  0.150 / 0.018 / 0.240. It is a *share* and not a level because "sparkle" is a
  character while *"but subtle"* is the clause that bounds the level — the two have
  to be able to move independently or the sentence cannot be satisfied at all.
  *"But subtle"* is therefore held on the whole cue: no offer is louder in peak or
  RMS than the incumbent the developer was asking to add sparkle *to*. *"Shouldn't
  be too long"* is held against the longest denied take (90 ms); all three are
  under it.
- **Mass** is absolute RMS under 200 Hz (denied: 0.026 / 0.045 / 0.010) and
  **seated** is RMS of the last 60% over the first 40% (denied: 0.31 / 0.27 /
  0.28) — *does it have a body, and is any of it left once it lands.* Neither may
  be bought by turning the cue up: the XP beat plays beneath the result, so all
  three sit at least 20% under `matchEnd`.

One thing the 3 kHz crossover is not arbitrary about: `synth.ts` clamps a resonant
cutoff to `SVF_MAX_HZ_FRACTION` (~6.5 kHz at 44.1 k), so 3–6.4 kHz **is** the top
of this bank's spectrum. A first pass written above that clamp measured *darker*
than the takes it was replacing, which is the failure mode of taking "sparkle" to
mean "put it higher" without reading the instrument.

The one way this could satisfy its own brief and still fail §4.7 is by colliding
two mechanics — the tightest pair in the bank is `oreCollect` / `depositTick` (§8),
*picked a chunk up* vs *banked a chunk*, and sparkle moves `oreCollect` straight
toward it. It moves it the safe way: every new offer is at least 3.5× brighter by
zero-crossing than every `depositTick` voice, shipped or offered, so a mixed pair
of verdicts is safe too. `candidates.test.ts` holds that.

### The letters are the whole of how a verdict names an offer

`/status/sound-choices.json` records a choice as a letter — `{"verdict": "b"}` —
and nothing else. So re-offering under a letter that already carries a live
verdict makes that record permanently unreadable: `deny-all` on `a`/`b`/`c` plus
new offers called `a`/`b`/`c` cannot be told apart from a denial of the new ones.
a0-48 established the rule on `ambient`; this brief adds the second and third
slots to follow it, and is the first to follow it as a *rule* rather than a
one-off, so `candidates.test.ts` now holds it as a property over a table of
re-lettered slots — three rows today, and the next denied slot inherits the rule
by joining the table instead of re-deriving it.

**This is also the fix owed to the other 35 rows, and it is not made here.** The
a0-01b offers were filed under `a`/`b`/`c`, the same letters the 2026-08-07
`deny-all` had just spent, twenty-four hours earlier. That is precisely why those
rows *look* unactioned: the board shows a slot whose letters are all denied, and
the only thing distinguishing the denial from the offers is a timestamp
comparison nobody performs. Re-filing those 35 slots' offers under `d`/`e`/`f` is
a mechanical, no-audio-change fix, and it is **proposed as its own brief** rather
than done here — a 100-file rename that nobody asked for, landed inside a brief
about unrequested work, would be its own joke, and it would collide head-on with
a0-48 while that is in flight.

## superseded — the other 35

For every one of these the developer's R1 instruction *was* carried out, by
**a0-01b** on 2026-08-08 — the day after the denial. Forty slots, three new
offers each, 120 rendered previews, in the amended §4.7 register. It is merged and
it is on `main`. Six of the twenty-one slots the a0-49 brief lists as having *"no
regeneration brief at all"* are music slots that a0-01b re-offered as *granular
bed / filtered analogue / wide detuned space*, and the rest are in the same round.

**The work is not missing. The work is invisible.** Nothing is owed on these 35
rows except a listen — and the evidence that the listen is what is missing, rather
than the work, is that the developer has already given first verdicts on the first
five slots in board order (`rockChip`, `hullHit`, `rockCrack` on 2026-08-13;
`rockBurst`, `oreCollect` on 2026-08-14) and then stopped. They are sweeping the
a0-01b board slot by slot and have reached index 4 of 44. `rockChip`'s adopted
voice — *"blunt pressure bite, sub weight"* — is an a0-01b character, so there is
no doubt about which board they are hearing.

Three rows in this group carry a note:

- **`ambient`** is superseded twice: once by a0-01b, and again by **a0-48**
  (PR #421, in flight), which rebuilt the shipped bed and re-offered `d`/`e`/`f`.
  It is out of scope here and needs nothing from this brief.
- **`alarm`** and **`stationDeath`** are protected slots (§4.7, §4.9 — neither is
  cuttable). a0-01b re-offered both inside those fences; `alarm`'s three offers
  were also rewritten from loops to one-shots to match s9-01's once-per-engagement
  klaxon. No disposition here may propose cutting either.
- **`depositTick`, `respawnBeep`, `respawnGo`, `minimapPing`** are the four device
  cues the ratified Gantry/Bone glass set (`ui-cues.ts`, s6-01) deliberately does
  **not** cover, so for these four the denied bank voice is the *only* voice and
  the developer hears it in every match. `pressTick`, `purchaseConfirm` and
  `rejectBuzz` are the opposite case — glass plays them now and the denied bank
  voice is a fallback for when there is no cue player at all. If the sweep is ever
  prioritised rather than taken in board order, those four go first and these
  three go last.

## The music six — a decision, not a batch

`musicBed`, `musicPulse`, `musicTheme`, `musicDread`, `musicWin`, `musicLoss`.

They are six of the twenty-one, they are all R1, and they are all superseded by
a0-01b like everything else in that round — so on the mechanical rule they want a
listen and nothing more. They are pulled out here anyway, because the question
they raise is not *"which of these three"*:

> **Does this game want music at all right now?**

The facts the developer needs to answer it, none of which are visible from the
board:

- **The soundtrack is live and on by default.** `AudioEngine` constructs a
  `MusicDirector` and `options.music ?? true` (`engine.ts`), so every match plays
  four looping stems whose gains follow match phase — calm while mining, tension
  as waves rise, the full theme in a siege, dread through the collapse, a sting at
  the end. The developer has been hearing denied music under every match since
  2026-08-07.
- **Turning it off is already built and costs nothing.** `setMusic(false)` and the
  independent `music` bus/slider both exist (`engine.ts`, `src/ui/settings.ts`).
  Nothing in the mix depends on the soundtrack — the alarm's ducking, the
  station-death hush and every SFX are unaffected by its absence.
- **The cut list already ranks it first.** §4.9 item 1 is *"Ambient music loop
  (SFX and the alarm are mechanics; they stay)"* — the first thing that dies if
  scope runs over, and the ache in §4.7 is protected by *silence*, not by score.
- **What a "yes" costs.** Six slots × 3 offers is the largest single listening
  task left on the board, and every one of them is a loop or a sting that has to
  be judged over a whole match rather than in a two-second preview.

**Three answers, all cheap:**

1. **No music for now.** Default `music: false`, leave the slots and the offers
   where they are. One line, reversible, and the six rows leave the board.
2. **Yes, but later.** Leave it on, leave the denial standing, and schedule the
   listen after the in-match SFX sweep finishes. The rows stay outstanding and
   this ledger says why.
3. **Yes, now.** Listen to the a0-01b offers. No regeneration is needed first —
   they already exist and they already post-date the denial.

**No music has been regenerated under this brief, and none should be until this is
ruled.** Six new tracks nobody asked for is worse than none.

## Why nobody noticed

The board's *"What happened next"* line matches briefs to slot ids. It has two
failure modes and this ledger hit both:

1. **It does not check that the work was the right work.** `ambient` showed two
   entries — an alarm brief and a gantry-cues brief — and looked actioned.
   Neither was a revoice.
2. **It does not check that the work was *after* the denial.** `oreCollect` has
   three briefs against it and every one of them predates its 2026-08-14 denial.
   It is as unactioned as `turretDown` and it is not on the a0-49 brief's list of
   twenty-one, because old work reads as done work.

There is a third failure that belongs to the audio side rather than the board:
**a0-01b's answer was filed under the letters the denial had just spent**, so even
a page that matched the right brief to the right slot would have shown a slot
whose every offer was denied. That one is fixable here, and the fix is the
`d`/`e`/`f` rule above.

**The dashboard change is the Director's**, deliberately: the Sounds page lives in
the studio repo and a lane clone cannot reach it (LESSONS §24 — a gate an agent
cannot satisfy is worse than no gate). What this ledger can offer it is the test
to implement: *flag a slot whose newest offer is older than its newest denial.*
That is one comparison, it needs no brief-matching at all, and it would have lit
up all three of `turretDown`'s week, `oreCollect`'s invisibility, and the
`a`/`b`/`c` collision on the same day they happened.

## Not in this ledger

- **Approved sounds**, out of scope by the a0-49 brief. Flagged in passing because
  the same class of gap is open on the other side: `rockBurst` (`a`, 2026-08-14)
  and `xpTick` (`a`, 2026-08-14) are **approved and not adopted** — they are not in
  `docs/sound-adoptions.md`'s table and the bank still plays its own incumbents for
  both. That wants an adoption brief, and it is exactly the failure
  `sound-adoptions.md` was written to catch.
- **The ambient bed** (a0-48, in flight).
- **The mix and ducking.**

## Keeping this true

A denial arrives → add the row, verbatim reason and all, before doing anything
else. A row leaves this file only when the slot has a verdict that is not
`deny-all`, or its voice is gone from the bank.

**`superseded — structural` (new, a0-68).** Some denials say the SLOT is wrong, not
the voice in it — *"they should also be different depending on the thing that was
hit"* cannot be satisfied by any set of takes filed against one slot. Those rows
can never earn a non-`deny-all` verdict, because there is nothing left to vote on.
They resolve as `superseded — structural`, and that disposition is not a way to
make a denial go away quietly: it requires the reason quoted verbatim as always,
the **heirs named on the row** so the trail from denial to answer is one hop, and
every heir carrying a full set of offers under unspent letters. The last of those
is enforced rather than promised — `candidates.test.ts` reads the `split` rows out
of `docs/sound-revoice-manifest.md` and holds each heir to four offers, so a slot
cannot be deleted to escape the work it owed. When you re-offer, take the next
free letters and add the slot to `RE_LETTERED` in `candidates.test.ts`, so the
board can still say which offers the old verdict was about.
