# a0-106 — nothing in this studio plays to break the game

**QA Agent · branch `agent/qa/a0-106-adversarial-harness` · 2026-08-19**

Every bug of one particular kind has reached this studio the same way: the
developer found it. a0-81 — a fleeing bot that would not shoot. a0-105 — a bot
camped at its own station, frozen for as long as a player cared to stand there.
Both arrived as a screenshot and a sentence, and both cost a live match to find,
because the match harness plays bot-vs-bot and **bots play the game the way it is
meant to be played**.

a0-105's ruling generalises past the bot that prompted it:

> **Any latch whose release depends only on conditions an opponent controls can
> be held open by that opponent.**

That is a property you can test for, across every latch, without knowing in
advance which one is broken. This lane built the instrument that does, ran it,
and found one — **on the a0-105 fix itself.**

---

## Summary

| | |
|---|---|
| Instrument | `tests/adversarial/` — antagonist harness + standing gate |
| Cross-product | 12 antagonists × 7 characters × 12 latches = 84 runs, 1008 readings |
| Wall clock | ~3 s of test time, ~7 s standalone |
| Latches with a ceiling | 7 — all hold, **except `fleeing`** |
| Latches correctly unbounded | 5 — argued below, and asserted on differently |
| **Defects found** | **1** (`a0-106-01`), 25 reproductions, every tier |
| Game code changed | **none** — `src/` and `harness/` untouched |

---

## 1 · The instrument

`tests/adversarial/antagonist.ts` is `evidence/a0-105-standoff/standoff.ts`
lifted into something reusable. Real world, real behaviour trees, fog-honest
views, and **one hostile that does a single deliberately unhelpful thing and
holds it** while the bot under test runs its own real brain against it.

**What is scripted, and what is not.** Only the antagonist. The bot under test
gets `botInputs` — its own cadence, its own fog, its own gun, its own tree — and
is free to fly anywhere it likes. The antagonist is the only thing the harness
reaches into the world to move, so any hold that shows up is a property of the
tree and not of the staging.

**Two idealisations, both deliberate, both stated:**

- The antagonist **station-keeps perfectly**: its position and velocity are set
  each tick to wherever it has decided to be. A human holds a spot to within a
  few units by thrusting against their own drift; the wobble would only add noise
  to a measurement whose entire question is *"does this ever end?"*. This is also
  exactly what the ratified a0-105 evidence run did, so the numbers are
  comparable.
- The "never kill" antagonists **pin state the sim would otherwise resolve** —
  the subject's hull fraction, the antagonist's own hull, a besieged core. An
  exit gated on a situation ending cannot be measured while the situation is
  allowed to end. Nothing else is written: the antagonist's gun is the sim's own
  `auto` weapon, so a poke costs real hull through `sim/damage.ts`.

**What is measured.** For every latch, on every tick: is it engaged? The reading
is the **longest unbroken engaged run**, plus what the bot turned to when it let
go, whether the run was still open at the ceiling, whether it ended because the
bot *died* rather than *decided*, and — the load-bearing one — how much of the
hold the bot spent **firing** and how far it **travelled**.

That last pair is why latches with no duration ceiling can still be asserted on.
A bot fighting a blockader for ninety seconds is playing the game; a bot orbiting
its own station for ninety seconds is switched off. The report calls the second
one `INERT`, and the gate fails on it.

### Files

| File | What it is |
|---|---|
| `tests/adversarial/antagonist.ts` | staging, the twelve antagonists, the run loop, the trace reader |
| `tests/adversarial/latches.ts` | the census — every latch, enumerated from `src/bots/` |
| `tests/adversarial/sweep.ts` | the cross-product and the two breach predicates |
| `tests/adversarial/latch-bounds.test.ts` | the standing gate (5 assertions) |
| `tests/adversarial/report.ts` | the table below (`npx vite-node tests/adversarial/report.ts`) |

The gate and the report share `sweep.ts`, so the numbers asserted on and the
numbers printed here are the same numbers produced by the same code.

---

## 2 · The antagonists

| id | staging | what it does |
|---|---|---|
| `park@200` | duel | sits 200 u off the subject's station on the lane to the field, does nothing — **inside `THREAT_RANGE` (416)**, the a0-105 photograph verbatim |
| `park@580` | duel | the same, at 580 u — **between `THREAT_RANGE` and `RETREAT_CLEAR_RANGE` (676)** |
| `park@840` | duel | the same, at 840 u — **outside `RETREAT_CLEAR_RANGE`**, so escape is readable |
| `block-ore` | duel | interposes between the subject and its nearest rock, silently |
| `block-home` | duel | stands on the line between the subject and its own station |
| `block-build` | duel | parks on the subject's own doorstep so it cannot dock and spend |
| `poke` | duel | closes to 150 u firing, withdraws past 800 u, repeats every 5 s |
| `never-die` | duel | follows at 200 u, invulnerable, subject's hull pinned — no opponent-controlled exit can fire |
| `siege-home` | duel | holds the subject's own core under attack at 0.2 and never finishes it |
| `park-squad` | 2v2 | `park@580` on a team board |
| `never-die-squad` | 2v2 | `never-die` on a team board |
| `siege-ally` | 2v2 | holds the **teammate's** core under attack at 0.5 and never finishes it |

**The park distance is the variable, and sweeping it is what earned this its
keep.** The flee branch reads two ranges — `THREAT_RANGE` on the way in,
`RETREAT_CLEAR_RANGE` on the way out — so the interesting question was never
*"does a parked hostile hold the bot?"* but *"at which range?"*. One park either
side of each range, and one between them. The one in between is the finding.

Ceilings: 40 s (2400 ticks) for duel stagings, 90 s (5400 ticks) for squad, which
must outlast `ALLY_RESPONSE_MAX` (45 s) to be able to tell a bounded ally
response from an unbounded one. `A0106_SECONDS` overrides.

---

## 3 · The census — every latch, enumerated from the source

Taken by reading `src/bots/`, not from the brief, because the point is to catch
the latch nobody thought to name. It is deliberately wider than "things called
`Latch`".

| latch | lives in | read as | ceiling |
|---|---|---|---|
| `dead` | `easy/medium/hard.ts` `when('dead', …)` | `!self.alive` | 20 s |
| `last-stand` | `behaviors.ts` `coreUnderFinalAssault` → `lastStandDefend` | winning leaf | **none — by design** |
| `cornered` | `cornered.ts` `CorneredLatch` | `corneredCommitted` | **none — by design** |
| `fleeing` | `commitment.ts` `Latch` on `Brain.fleeing` | `committed` | 30 s |
| `standoff` | `standoff.ts` `StandoffLatch` | `standoffCommitted` | 16 s (`STANDOFF_COMMIT_SECONDS × 4`) |
| `defend` | `easy/medium/hard.ts` `when('defend', …)` → `defendHome` | winning leaf | **none — by design** |
| `ally-response` | `ally.ts` `AllyResponse` on `Brain.allyResponse` | `allyResponseTarget` | 55 s (`ALLY_RESPONSE_MAX + 10`) |
| `ally-assault` | `ally.ts` `AllyResponse` on `Brain.allyAssault` | `allyResponseTarget` | 35 s (`ASSAULT_JOIN_MAX + 10`) |
| `haul` | `easy/medium/hard.ts` `when('haul', …)` → `haulHome` | winning leaf | **none — by design** |
| `mine-site` | `behaviors.ts` `mine` → `Brain.mineSite` | winning leaf | **none — by design** |
| `escape-run` | `behaviors.ts` `go` → `Brain.escapeUntil` | `time < escapeUntil` | 8 s (`ESCAPE_SECONDS × 4`) |
| `mine-tabu` | `behaviors.ts` `tabuMineSite` → `Brain.tabu` | any live entry | 48 s (`TABU_SECONDS × 4`) |

Where the state exists as a bit on the `Brain` it is read through that module's
own public reader, so a change to how a latch stores itself cannot quietly change
what is measured. Where a "latch" is really a branch that keeps winning the
selector, the winning leaf's own name is what is watched — a branch that always
wins is functionally latched whether or not a boolean is stored anywhere, which
is why the brief was right to name `last-stand`, `defend` and `haulHome`.

Ceilings are **generous on purpose**. The claim is that a bound exists, not that
it is tight; the gate should fail on a latch that runs forever, never on one that
runs a second longer than it used to.

---

## 4 · Results — worst hold per latch × tier, seconds

Duel stagings run to a 40 s ceiling, squad stagings to 90 s; a number at the
ceiling means the hold was **still open when the run stopped**.

| latch | easy | medium | hard | verdict |
|---|---|---|---|---|
| `dead` | 5.02 | 5.02 | 5.02 | the sim's respawn clock, exactly |
| `last-stand` | 40.00 † | 40.00 † | 40.00 † | at ceiling — **correct**, see §6 |
| `cornered` | — | 4.00 | 4.00 | one commit window, released cleanly |
| **`fleeing`** | **90.00 †** | **87.42 †** | **64.10** | **DEFECT — §5** |
| `standoff` | 4.00 | 4.00 | 4.00 | exactly `STANDOFF_COMMIT_SECONDS` |
| `defend` | 3.00 | 2.83 | 3.50 | never even approached a hold |
| `ally-response` | 45.17 | 45.08 | — | `ALLY_RESPONSE_MAX` (45 s) to the tick |
| `ally-assault` | — | — | — | **not reachable by this instrument** — §7 |
| `haul` | 12.83 | 7.75 | 11.15 | released every time |
| `mine-site` | 8.50 | 8.50 | 9.10 | the day job |
| `escape-run` | 2.00 | 2.00 | 2.00 | exactly `ESCAPE_SECONDS`, never renewed mid-run |
| `mine-tabu` | 35.17 † | 35.50 † | 12.00 | at ceiling — **not a hold**, see below |

† still open at the ceiling.

Two of the three ceiling-length rows are fine, and it is worth saying why rather
than leaving a reader to squint at them:

- **`ally-response` is the shape everything else should have.** Held 45.17 s and
  45.08 s under `siege-ally` — a siege the responder genuinely cannot break, the
  exact failure `docs/team-bots-plan.md` §4.2 named in advance ("a siege the
  responder cannot break becomes a permanent posting"). `ALLY_RESPONSE_MAX` is
  45 s, and the latch let go at 45. **A ceiling written into the primitive, that
  fires on the nose, against an opponent who never stops.** This is what a latch
  looks like when somebody thought about the adversarial case first.
- **`mine-tabu`'s 35 s is not one hold.** The watch reads *"is any entry live"*,
  which merges consecutive bookings. Instrumented directly
  (`park@840` × rusty, 2400 ticks): **three distinct rocks, 2–3 bookings each,
  every booking a fresh absolute 12 s expiry — `TABU_SECONDS` exactly, and no
  entry ever renewed while live.** The bot is rotating between three fields and
  breaking off each approach in turn, which is the p11 behaviour working, not a
  latch stuck on. Recorded here so the ceiling-length number is not mistaken for
  a second defect.

Everything else releases, at every tier, under every antagonist. **`fleeing` does
not.**

---

## 5 · DEFECT `a0-106-01` — the flee latch, unbounded again

> **Owner: bots agent.** QA owns `tests/` and `harness/`; the behaviour is not
> ours to change and has not been. This section is written to be a brief.

### What it is

a0-105 gave the retreat an end: `wantsRetreat` folds every committed decision
into the standoff latch, and when the running has opened no ground for the
character's own patience, the bot turns and fights. **The fix is correct and this
instrument confirms it fires**: the standoff latch commits and releases cleanly
in 20 cells of the sweep — under `block-build`, `never-die`, `never-die-squad`
and `block-home` — always for exactly `STANDOFF_COMMIT_SECONDS` (240 ticks), at
19–100 % trigger, turning into `turn-and-fight`. And where the retreat genuinely
*works*, it is left alone exactly as designed: at `park@200` every character
opens ground, reads *escaped* past `RETREAT_CLEAR_RANGE`, and releases inside
1.83 s without the standoff ever being needed.

**But the fold is gated behind two preconditions, and both of them are things an
opponent controls.** From `behaviors.ts` `wantsRetreat`:

```ts
if (threat.distance > THREAT_RANGE || !retreatOutOfRoad(ctx, threat)) {
  resetStandoff(stand);
  return true;
}
```

A read that fails either gate does not merely skip the fold — it **resets the
patience clock**. So an opponent who can keep either gate false, on any tick,
keeps the clock at zero forever. The flee latch's own two exits (`escaped`,
`recovered`) were already opponent-controlled; a0-105 added a third, and put it
behind a fourth and fifth that are opponent-controlled too. The property a0-105
ruled against is reinstated one level down.

There are two ways to stand there, and the sweep found both.

### (A) The range dead-band

`THREAT_RANGE` is 416. `RETREAT_CLEAR_RANGE` is 676. **The 260-unit annulus
between them is a dead zone**: too far for the standoff to be folded, too near
for the flee latch to read *escaped*. A hostile that parks anywhere in it holds a
wounded bot in `retreat` indefinitely.

Reproduction — `park@580` — a hostile that never moves and never fires:

```
stage: 1v1 FFA, seed 20260819, bounds 4000×4000
       subject wounded to 0.14 hull at its own station
       hostile parked 580u from that station along the lane to the arena centre
       (the subject settles ~80u the far side, so the separation it reads is ~660)
```

Instrumented directly, rusty, 18 000 ticks (300 s of sim):

```
separation inside (416, 676]  : 17954 ticks   ← the dead band
separation <= 416             :    34 ticks
separation  >  676            :    12 ticks
standoff latch at the end     : { gap: -1, since: -1, until: -1 }   ← never touched
subject at the end            : 90u from its own station, hull 0.14, leaf 'retreat'
```

Held ticks, same cell, three ceilings — **the hold tracks the ceiling, which is
what "unbounded" looks like from outside**:

| character | tier | 40 s (2400) | 120 s (7200) | 300 s (18000) |
|---|---|---|---|---|
| rusty | easy | 2260 | 7060 | **17860** |
| bolt | easy | 2260 | 7060 | **17860** |
| foreman | medium | 2270 | 7070 | **17870** |
| patch | medium | 2270 | 7070 | **17870** |
| sable | hard | 1611 | 1611 | 1611 |
| vulture | hard | 1611 | 1611 | 2112 |
| warden | hard | 840 | 1191 | 1191 |

*(that table is `park@520`; the shipped `park@580` cell holds all seven
characters at once — 2230–2262 ticks of 2400 at the 40 s ceiling, and 17 830 /
17 845 of 18 000 for the Easy and Medium seats at 300 s.)*

Easy and Medium are **unbounded**. Hard releases — but not by the a0-105 exit: it
falls out sideways into `cornered-fight` or wanders off to `mine`, after 20–64
seconds. No character in the cast turns and fights, because the standoff latch is
never folded at all.

Five minutes of a wounded bot parked 90 units off its own station, at 0 % trigger
and 121 units of drift, against an opponent doing **nothing**. That is the
a0-105 photograph, with the a0-105 fix in place.

Same band, reached differently: `block-ore` — stand between the bot and its rock
— reproduces it for rusty, bolt, foreman, patch and warden (2180–2211 ticks of
2400), because the distance from a blocked rock to a bot at its own station also
lands in the annulus.

### (B) The out-of-road flap

`retreatOutOfRoad` is true when the station is gone, when the threat is within
`GUARD_RADIUS × 2` (268) of it, or when the bot is inside `ARRIVE_RADIUS` (220)
of it. All three are positional, and two of the three move with the opponent.

Reproduction — `never-die` and `block-home`, rusty, 2400 ticks:

```
separation <= THREAT_RANGE : 2400 / 2400 ticks   ← the first gate always passes
retreatOutOfRoad true      : 1136 / 2400 ticks   ← the second one flaps
standoff at the end        : { gap: 200, since: 59.67, until: -1 }
                             (the run ended at t=60.0 — the clock had been
                              running for a third of a second)
```

The subject oscillates around its own `ARRIVE_RADIUS` while the hostile drifts in
and out of `GUARD_RADIUS × 2`, and **every read that comes back "still has road"
throws the patience clock away**. Rusty's patience is 3.9 s; it never gets past
0.4. `block-home` is the same thing with the standoff at `{ gap: -1, since: -1,
until: -1 }` — reset on literally every tick of 2400.

Easy is unbounded here (2400/2400 for rusty and bolt at 40 s, 5400/5400 at 90 s).
Medium and Hard escape via `cornered-fight`, which is the p15 latch doing its job
— but that is a different branch catching a fall, not this one working.

### The whole reproduction list

25 cells, all on `fleeing`, all pinned in
`tests/adversarial/latch-bounds.test.ts` as `KNOWN_UNBOUNDED`:

| antagonist | characters | held (of ceiling) |
|---|---|---|
| `park@580` | all seven | 2230–2262 / 2400 |
| `block-ore` | rusty, bolt, foreman, patch, warden | 2180–2211 / 2400 |
| `block-home` | rusty, bolt | **2400 / 2400** |
| `never-die` | rusty, bolt | **2400 / 2400** |
| `park-squad` | all seven | 2595–5245 / 5400 |
| `never-die-squad` | rusty, bolt | **5400 / 5400** |

### What a fix has to be true of

Not our call to make, but the instrument constrains the shape, and it is worth
writing down what it rules out:

1. **Widening `THREAT_RANGE` in the fold does not fix it.** It moves the dead
   band out to wherever the new number is. Any fold gated on a *distance* has a
   band on the far side of that distance and inside `RETREAT_CLEAR_RANGE`.
2. **The reset is the bug more than the gate is.** A read that cannot be
   evaluated is not evidence that the retreat is working; `resetStandoff` on
   those paths hands the opponent a free clock reset per tick. Holding the clock
   (rather than resetting it) when the fold cannot be evaluated would close both
   (A) and (B) without touching either range — and would keep a0-105's readable
   property intact, because a retreat that is genuinely opening ground still
   beats the anchor and still resets legitimately.
3. **Whatever lands must fire on `park@580`.** That is the cheapest possible
   opponent — parked, silent, at one fixed range — and the one this instrument
   was named for. It costs 0.3 s to check.

Deleting the corresponding lines from `KNOWN_UNBOUNDED` is what closes this out;
the gate's third assertion fails until they are, so it cannot be forgotten in
either direction.

---

## 6 · Latches that are correctly unbounded

The brief invited this and it is the right thing to say out loud: some latches
have no bound because the situation genuinely does not end, and forcing one in
would make the bot worse. Each of these is asserted on by the **`INERT`**
predicate instead — a hold ≥ 8 s with < 2 % trigger and < 64 u of travel. All
four pass it in every cell.

| latch | why there should be no ceiling | evidence it is not a freeze |
|---|---|---|
| `last-stand` | a core under final assault is a situation that does not end while it is true, and a bot that walked away from it on a timer would be worse. The branch also *releases* the flee, standoff and cornered latches rather than holding them. | `siege-home`, held the full 40 s at every tier — with the trigger down **48–94 %** of it and 340–483 u of movement. The bot is fighting for its home, not parked. |
| `defend` | a hostile inside your own alarm ring is likewise a standing situation, and meeting it in front of your turrets is the ratified answer (GDD §2.6). | never held longer than **3.5 s** in the whole sweep. It did not need the exemption. |
| `cornered` | the commitment renews while the blockade stands — that is p15 ratified, "a blockaded bot FIGHTS, no dithering". | longest hold 4.00 s (one window), at **77–100 % trigger**, 328–415 u of movement, releasing into `cornered-fight`. |
| `haul` | a full hold empties by docking or by dying, and both are legitimate ends. | longest hold 12.83 s, released every single time, always into another errand. |
| `mine-site` | mining is the day job; a bot working a rock for a minute is the game being played. | longest hold 9.10 s. |

`defend` deserves one more line, because it is the one that *looked* like a
defect on paper. `homeIntruder` is a pure proximity read with no memory and no
timer, so on inspection a hostile that parks inside the ring should hold the
branch indefinitely. It does not, in practice, because the branches above it —
the retreat and the cornered commitment — take the tick first whenever the
intruder is close enough to matter. **The paper reading was wrong and the
measurement is why we know.** That is the argument for owning an instrument
rather than a checklist.

---

## 7 · Coverage limits

Stated rather than omitted, because a hole that is not written down reads as
coverage.

- **`ally-assault` was never engaged.** Joining a raid needs a *teammate to open
  one*, and no antagonist can cause that — the antagonist is a hostile, and the
  bots that could open a raid are running their own unscripted trees. The gate
  declares it in `NOT_REACHABLE` rather than asserting a bound it never
  exercised. Its primitive is the same `AllyResponse` that `ally-response` does
  exercise (and which held to `ALLY_RESPONSE_MAX` on the nose), and its own
  ceiling `ASSAULT_JOIN_MAX` is pinned directly in `src/bots/ally-assault.test.ts`.
  Closing this properly needs a *scripted teammate* as well as a scripted
  opponent — a reasonable next lane for this harness, not a change to it.
- **One seed.** `20260819`, fixed. This instrument answers "does it end?", and a
  seed sweep would trade a clear answer for a slow one. The defect above was
  confirmed at three ceilings and two independent geometries instead, which is
  stronger evidence than the same geometry on eight seeds.
- **`ally-response` engaged for 2 of 7 characters** (rusty, patch) under
  `siege-ally` — the others' `allyResponseRange` and role assignment kept them
  home, which is the design. Both that did answer held to the ceiling exactly.
- **Perfect station-keeping** (§1). A real player wobbles. Every finding above
  was checked to survive it: `block-ore` and `block-home` recompute their
  position from the subject's every tick and still reproduce, and the dead band
  is 260 units wide — two orders of magnitude more than a human's drift.

---

## 8 · The game did not move

This brief adds tests. `src/` and `harness/` are untouched on this branch —
`git diff main --stat` is `tests/adversarial/` and `tests/reports/` only — so the
match-length and win-rate targets cannot have moved: there is no code path
between this branch and a match's outcome.

The standing numbers, from a0-105's ratified evidence on the same `main`
(`evidence/a0-105-standoff/win-rates.txt`): strategy contest top contestant
**43.8 %** over 96 matches, inside the 55 % band; match length mean **811 s**
(13.5 min), inside the 10–15 min window. The class contest's `excavator` at
68.8 % remains **OVER** the ceiling — a pre-existing ship-class finding already
flagged for the gameplay lane in a0-105, unchanged and untouched here.

Suite cost added: **~3 s** of test time for the whole cross-product.

---

## 9 · How to run it

```
npx vitest run tests/adversarial/latch-bounds.test.ts   # the gate
npx vite-node tests/adversarial/report.ts               # the table above
A0106_SECONDS=300 npx vite-node tests/adversarial/report.ts   # the deep look
```

The gate's five assertions:

1. **`no behaviour latch is held open by an opponent standing still`** — every
   latch with a ceiling releases inside it, in every cell, minus
   `KNOWN_UNBOUNDED`.
2. a latch with no ceiling still never leaves the bot switched off (`INERT`).
3. the a0-106 defect **still reproduces** where this report says it does — fails
   the day it is fixed, and the failure means *delete these lines*.
4. every latch in the census was actually engaged by something.
5. the cross-product is the full one — every antagonist, every character, all
   three tiers.
