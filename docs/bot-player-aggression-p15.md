# p15 — "Are they ignoring me???" measured

**Developer report.** *"I don't think enemies attacked me at all… they attacked
each other though. Are they ignoring me??? Hard enemies should attack more."*

**Instrument.** `tests/harness/player-aggression.test.ts` — a scripted human flies
a real FFA match (8 slots, human in seat 3, 10 seeds × 180 s) and every bot
decision is tallied by *who it is engaging*. The winning leaf comes off
`Brain.lastBehavior`; its target is recomputed with the same public function the
leaf itself called, on a read-only context. Intent and outcome are kept apart.

**Guard.** `src/sim/ffa-hostility.test.ts` — the match-build half: FFA team-id
uniqueness across every slot with the human in every seat, the untagged-roster
default, and end-to-end proof through `step` that a rival's auto-aim and a
rival's turret both put fire on the human.

Three findings, in the order they were reached.

---

## 1. The prime suspect is CLEARED — the human is not a teammate

The brief's first suspect was the p14 teams-identity change: a human whose seat
resolved to a team id a bot also held would read as a *teammate* — never locked,
never damaged — while bot-vs-bot pairs still fought normally.

It does not happen. FFA resolves teams-of-one at every layer the human passes
through (`configToPlayers`, the sparse/closed-slot compaction, the pre-teams
`{id, shipClass}` roster the offline client actually boots with, and the mixed
untagged-human/tagged-bot case). That is now pinned permanently — the p14 suite
asserted "never attack teammates" and nothing asserted the complement, which in
FFA is the entire game.

Nor is it p8's slot bias (already index-blind and pinned flat), nor fog. **Bots
aim at the player more than they aim at each other**, in every tier (per minute
the slot is alive; HUMAN | per-BOT-rival):

| cast | attack initiations | dwell | first contact → first attack |
| --- | --- | --- | --- |
| easy | 2.8 \| 1.6 (×1.73) | 73 \| 51 (×1.44) | 0.0 s → 10.0 s |
| medium | 5.0 \| 5.3 (×0.94) | 168 \| 187 (×0.90) | 0.0 s → 10.0 s |
| hard | 24.9 \| 15.9 (×1.57) | 644 \| 510 (×1.26) | 0.0 s → 10.0 s |
| roster (shipped cast) | 13.7 \| 9.5 (×1.45) | 413 \| 327 (×1.26) | 0.0 s → 10.0 s |

First attack lands at 10.0 s in every tier — the tick spawn protection lifts.

## 2. What the player actually feels: conversion, not attention

The gap is entirely in what lands. Hull damage the human absorbs, and the share
of engagement that converts (hull damage per 100 decisions of dwell):

| cast | hull dmg, human \| bot | converts, human \| bot |
| --- | --- | --- |
| easy | 10.1 \| 28.8 (×0.35) | 13.7 \| 56.8 (×0.24) |
| medium | 30.0 \| 84.6 (×0.35) | 17.8 \| 45.2 (×0.39) |
| hard | 91.3 \| 123.7 (×0.74) | 14.2 \| 24.3 (×0.58) |
| roster | 58.3 \| 100.3 (×0.58) | 14.1 \| 30.7 (×0.46) |

A juking human converts a bot's intent at **0.24–0.58×** the rate a bot rival
does. The control run settles it: the same seat flown by a *bot* (probe=clone)
converts at ×0.94 at Hard and takes ×1.04 the hull damage of a bot rival. Same
seat, same slot, same cast — only the flying differs.

This is the p5 aim-error model working exactly as ratified — "a player who
strafes and juke-reverses shakes ~two thirds of a Hard bot's shots" — measured
from the other side. Being aimed at all match and hit a fraction of the time is
indistinguishable, from the cockpit, from being ignored.

**Not touched here.** Tightening the aim back up would reverse a tuning the same
developer ratified in v0.2.2 ("enemies' aim is too accurate"), and the p15 note
does not ask for it. **Director: this dial, not the targeting ladder, is what
"they never attacked me" is made of.** If more felt pressure is wanted, the lever
is Hard's `aimLatency` (0.20 s) / `aimJitter` (0.05), and the harness above
measures the result in one run.

## 3. The ratified appetite tuning: built, measured, NOT shipped

Implemented exactly as the note specifies — one Hard-only tier knob
(`DifficultyTuning.aggression`, Easy and Medium left at 1.0, "EASY stays timid")
moving the three named dials, each a no-op at 1.0:

- **initiation range** — `hardAttackFloor` divided by the appetite (0.34 → 0.21);
- **siege willingness** — an enemy home's score leaned up against a duel;
- **target-the-leader weighting** — the owner's standing counted for more inside
  a home's threat term.

Measured A/B, all-Hard cast, per minute the human is alive, **both arms carrying
the wedge fix of §4** so the comparison isolates the tuning:

| arm | initiations | dwell | hull dmg | struct dmg | total dmg | human survives |
| --- | --- | --- | --- | --- | --- | --- |
| shipped (appetite 1.0) | 24.9 | 644 | 91.3 | 50.7 | 142.0 | 99 s |
| appetite 1.6, full | 17.2 | 626 | 73.7 | 56.6 | 130.3 | 98 s |
| appetite 1.6, floor only | 21.8 | 734 | 106.7 | 48.0 | 154.7 | 110 s |

**It does not deliver.** Total fire on the player moves −8% (full) to +9% (floor
only), the human's life expectancy does not move, and what the dial really does
is trade duels for sieges: at the full setting the fire on the player's *ship*
drops 19% while the fire on their *home* rises 12%. A Hard bot that stops
duelling reads as *less* interested in you — the exact complaint being answered.

Shipping a ratified behaviour change that measurably fails its own goal is worse
than reporting it, so `src/bots/` is untouched by this PR. The dials, the values,
and this table are the whole implementation; re-landing it is an afternoon if the
Director wants it anyway.

**An earlier reading of this table said +38%.** It was measured against raw
per-match totals, before the two normalisations below, and against a build that
still had the wedge bug. Both are recorded because both were wrong in an
instructive way:

1. **Per match-minute, not per match.** A more aggressive cast ends matches
   sooner; raw totals read a faster kill as less aggression.
2. **Per minute *alive*, not per match-minute.** A slot eliminated at 90 s cannot
   be shot at for the remaining 90.

## 4. What was actually broken: bots wedge, and the soak passes by seed luck

Chasing the tuning through the suite turned up a live bug in the shipped build.

`tests/harness/unstuck.test.ts` is the ratified "no bot stays wedged" class-killer
(v0.2.2 field report §3), soaking seeds 1–24. It is green. Run the **same shipped
code on seeds 25–48 and five bots wedge**, three of them for over half a minute:

```
seed 32: patch  (slot 3) wedged 33.9s while 'cornered-fight'
seed 42: rusty  (slot 0) wedged 37.6s while 'haul'
seed 44: bolt   (slot 1) wedged 27.4s while 'haul'
seed 46: patch  (slot 3) wedged 12.6s while 'cornered-fight'
seed 47: patch  (slot 3) wedged 18.1s while 'mine'
```

The invariant passes on the seeds it happens to soak, not because the trap is
gone. That is also why *any* behaviour change — the p15 tuning at +60%, or at
+10%, which produced **four** wedges — appeared to "cause" wedges: it only moved
which seeds land in the trap.

**Root cause (sim, mine).** The p14 escape hatch gates on speed: a ship pressing
into a body *and held below `WEDGE_SLIDE_SPEED`* earns a tangential slide off the
rim. That is right for the pin it was written for — a ship steering into its own
station grinds to a dead stop — and blind to a **pocket**. A hull wedged in the V
between two rocks keeps ~90% of cruise on the clock, because each body reflects
only its own inward component and what survives points straight into the other;
the old ramp then scaled the rescue kick to nearly nothing on the grounds that
the ship was "already moving". Instrumented, a bot sat at (1544,1347) with a
steady 47 u/s on the clock and a net displacement of one unit, for 50 seconds.

**Fix (`src/sim/step.ts`, `WEDGE_ESCAPE_PROGRESS`, `WEDGE_SLIDE_RUN_S`).** Three
changes to the hatch, all deterministic, no RNG and no clock:

1. **Ask about headway, not speed.** The pin is timed against an anchor
   (`Ship.wedgeAnchor`) and a hull that has not moved its own diameter in half a
   second while pressed into something is pinned, whatever its velocity says.
2. **Commit to one slide direction** (`Ship.wedgeSlide`) until the hull has
   actually gone somewhere. The tangent is taken about the body last pressed
   into, and a hull in a V presses into a different one every tick — re-deriving
   it each tick flips the push and the two cancel.
3. **Escalate a failed run** by a quarter-turn: tangent, then *outward along the
   contact normal* — reversing back out, the only exit from a symmetric notch and
   one no tangential slide can ever find — then the other tangent. And do not
   throw the commitment away on a single tick without contact: a hull rattling in
   a pocket loses its press constantly, and resetting on that was itself a loop
   (press in, two futile seconds, one free tick, forget everything, repeat).

**Result:** seeds 1–24 green, and on 72 *unseen* seeds (25–96) the wedge count
goes from ~15-per-72 to **1**. Pinned by three new cases in
`tests/sim/wedge-escape.test.ts` reproducing the pocket in the real `step()` loop.

**Residual, for the Director.** One seed in 72 still wedges, always within ~20
units of the arena centre, always a hull buried inside several overlapping
late-wave rocks. That is a wave-placement question (GDD §2.3 — every wave lands
closer in than the last), not a collision-response one, and it wants its own
brief. It is a real bug a player can meet today.

## 5. Ownership

Everything in this PR is Gameplay Engineer territory: `src/sim/` and the QA
harness. `src/bots/` is deliberately untouched — see §3.
