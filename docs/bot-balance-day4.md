# Bot behaviour, day 4 — what the trees do, and two things QA should know

**Author:** Bot Engineer · **Scope:** `src/bots/` · **Status:** report, not a contract

The Easy/Medium/Hard trees and the seven personalities landed on
`agent/bots/d4-difficulties` (GDD §2.9, §2.11). This note records what a match
of them actually *does*, measured, plus the two findings that belong to someone
else's file and are therefore flagged rather than fixed.

## What was measured

Twenty eight-bot offline matches, one per seed, at the **shipped** baseline
constants — nothing mocked, `COLLAPSE_CORE_DECAY` at its shipped `0`:

| | Result |
|---|---|
| Matches reaching a winner | **20 / 20** |
| Median match length | **15.2 min** (911 s) |
| Range | 13.5 – 19.5 min |
| Collapse begins | 12.5 min (750 s), every match |

The 10–15 minute target (GDD §1) is the top of that range rather than its
middle, so the matches run a little long — but they *end*, without entropy, and
they end because the bots did something to each other.

## Finding 1 — Warden wins almost everything

Win counts by character over the same twenty matches, and again over
twenty-one matches with the roster rotated through the slots (so that seat
position and character are separated):

| Character | Tier | Hull | Wins /20 | Wins /21, rotated |
|---|---|---|---|---|
| Warden | Hard | Excavator | 19 | 19 |
| Foreman | Medium | Excavator | 1 | 1 |
| Sable | Hard | Interceptor | 0 | 1 |
| everyone else | — | — | 0 | 0 |

Two things this is **not**: it is not a seat advantage (rotating the roster
spread the winning slots evenly — 4/3/3/3/3/2/2/1 across the eight seats), and
it is not simply "Hard beats Easy", because the other two Hard characters win
about as rarely as the Easy ones.

The tier ordering is exactly what GDD §2.9 asks for — Easy never wins, Medium
occasionally, Hard usually. The *within-tier* spread is the finding: Warden is
a Hard bot in the Excavator, whose beam stat of 13 is the highest in the game
(GDD §2.11), with `homebody: 1.0` keeping it fighting next to its own turrets —
which GDD §2.6 says is the strongest place in the game to fight ("turrets
fighting alongside the defender's ship focus fire and kill attackers fast", and
"a defended planet is nearly uncrackable one-on-one"). Warden is not exploiting
anything; it is doing the thing the siege model says wins, in the hull that does
the most damage while doing it.

That makes this a **balance** question, and balance is QA's from M2 (GDD §2.8,
§3.8 — "no strategy exceeds a stated win-rate threshold"). The knobs, in the
order I would try them:

1. `SHIP_STATS[excavator].beam` (13) against `hull` (55) — the Excavator is
   currently the best beam *and* second-best hull. QA owns `src/sim/constants.ts`.
2. `PERSONALITIES.warden.weights.homebody` (1.0) and `triangle.defend` (0.45) —
   mine, and I will retune on request rather than pre-emptively, because the
   character is meant to read as territorial and a 55%-win-rate Warden that
   wanders is a worse Warden.
3. `TURRET.range` (240) vs `BEAM_RANGE` (260) — the twenty-unit window that
   makes patient turret-stripping possible. Widening it weakens every defender.

I have deliberately not tuned any of these to flatten the curve: doing it before
QA states the target would be tuning against a number nobody has agreed on.

## Finding 2 — a two-survivor endgame cannot resolve on the ruleset alone

`COLLAPSE_CORE_DECAY` ships at `0`, with a comment in `src/sim/constants.ts`
saying why: GDD §2.3 spells collapse out as exactly three rules — no shield
regeneration, no repair, no new ore — and adding a fourth is a design decision.
The consequence for bots is concrete: once two defended planets are left, no
ore is arriving, no core can be repaired, and if both survivors sit at home the
match state is genuinely frozen. GDD §1 promises "entropy finishes whoever the
players don't"; at `0`, entropy finishes nobody.

The trees now do the rational thing rather than the timid one, and this is the
whole reason 20/20 matches end:

- **No retreat in collapse** (Medium, Hard). There is no hold left worth saving
  and a respawn is free — GDD §2.7's "the cost of dying is *time and position*"
  is nearly free when there is no economy left to lose position in.
- **No defending in collapse** (Medium, Hard). A core that cannot be repaired
  only ever goes down, so the endgame is a damage race and every second on
  defence is a second not spent on the rival's core.
- **Ship targets discounted to 0.3** in collapse (`COLLAPSE_SHIP_DISCOUNT`).
  Killing a ship buys five seconds; killing a core wins.
- **Hunt.** With nothing in view, a bot flies at the nearest home still standing
  — off planet positions, which are public at any range (GDD §2.2).

This is honest play, not a workaround, and I would keep it whatever QA decides.
But it is worth stating plainly: **bots keeping matches out of stalemate is not
the same as the ruleset guaranteeing an ending.** Two *humans* who both turtle
at collapse still cannot finish the match. If QA wants the guarantee to be
structural, `COLLAPSE_CORE_DECAY` is the knob, and this is the falsification the
constant was left at zero for.

## Two bugs found by running it rather than reading it

Recorded because both are the kind of thing that would otherwise be rediscovered:

1. **A latched one-shot press empties a bank.** Bots re-emit their action stream
   between decisions (reaction time, modelled as cadence). `buildOrder` and
   `upgradeOrder` are one-shot by contract — the sim acts on them for the tick
   they appear in — so a held stream containing one bought a turret *on every
   tick of the interval*: ten turrets in a sixth of a second. Fixed in
   `harness.ts` (`holdable`), in the one place that re-emits a stream, rather
   than asked of every tree.
2. **Solid bodies deadlock a naive seek.** Asteroids and planets stop a ship
   dead, and the late waves land in a tight cluster with gaps no hull fits
   through, so "fly at the target" pins a bot against a rock with the collision
   response cancelling exactly the thrust it keeps asking for — for the rest of
   the match. Fixed with local avoidance around the single most urgent body
   (summing a push per rock is worse: thirty of them cancel into a shiver), plus
   a committed escape run when a bot notices it has stopped moving while asking
   to travel.
