# a0-105 — the standoff: a retreat that never ended

**Branch** `agent/bots/a0-105-no-fear-of-death` · **Owner** Bot Engineer ·
**Date** 2026-08-19

The developer, from a live match, with a screenshot of Rusty parked at its own
station at 20/70 hull:

> *"I was able to make rusty just stay stuck there by putting myself in between
> the ore and his base. he just stayed in that same spot scared of me. ship lives
> are cheap. enemies should not fear death..."*

The last sentence is the ruling, and it is already the design: respawn is free
(GDD §2.3, §2.7). This report is the measurement either side of the fix.

---

## 1 · The reproduction

**Instrument** `evidence/a0-105-standoff/standoff.ts` — run with
`npx vite-node evidence/a0-105-standoff/standoff.ts`, and
`A0105_SECONDS=<n>` to change the ceiling. Raw output, before and after, in
`evidence/a0-105-standoff/standoff.txt`.

**The staging is the photograph.** One bot at its own station — it ran, it
arrived, and it is out of road — with one hostile parked 200 units out along the
lane to the ore. Both hulls are put back where they started before every step and
the bot's hull is held at its staged fraction, which is *the player standing
still*: exactly what the report describes. Everything else is the real sim and
the real trees — the bot's own reaction cadence, its own fog-honest view, its own
gun. 200 units is inside `RETREAT_CLEAR_RANGE` (676), so the retreat can never
read *escaped*, and inside `GUARD_RADIUS × 2` (268), so this is a siege on the
doorstep and not a blockade of the road home — `src/bots/cornered.ts` owns that
other case and it already terminates.

A **held tick** is a tick whose winning behavior-tree leaf was `retreat`
(`Brain.lastBehavior` — the bot's own account of what it was doing). The **turn**
is the first tick whose winning leaf is a fighting one.

### The trace in the brief is correct

`wantsRetreat` (`src/bots/behaviors.ts`) latched with
`commit(latch, enter, recovered || escaped)`, and **both exits are conditions the
opponent controls**:

- `escaped` — false, because the player is parked inside `RETREAT_CLEAR_RANGE`;
- `recovered` — false, because nothing in the game repairs a hull, so a bot at
  20/70 can never reach `threshold + RETREAT_RECOVER_MARGIN` (0.80 for Rusty).

`cornered` does not fire — it covers the case where the road home runs *through*
the threat, and this bot is already home (`threatAtHome` rules it out
explicitly). `last-stand` does not fire — the core is untouched. Nothing else
opens the latch, and there is no time bound on it.

---

## 2 · Ticks held, before and after, at every tier

Ticks are sim ticks at 60 Hz (`TICK_DT`). "Turned at" is the tick of the first
`turn-and-fight` decision.

### Before — main @ `84b0f1c`

| character | tier | retreat ticks (20 s ceiling) | retreat ticks (120 s ceiling) | turned at |
|---|---|---|---|---|
| rusty | easy | 1200 / 1200 | 7200 / 7200 | never |
| bolt | easy | 1200 / 1200 | 7200 / 7200 | never |
| foreman | medium | 1200 / 1200 | 7200 / 7200 | never |
| patch | medium | 1200 / 1200 | 7200 / 7200 | never |
| sable | hard | 1200 / 1200 | 7200 / 7200 | never |
| vulture | hard | 1200 / 1200 | 7200 / 7200 | never |
| warden | hard | 1200 / 1200 | 7200 / 7200 | never |

Every character, every tier, holds the `retreat` leaf on **every tick it is
given**. Two minutes was the longest run made; the hold is not long, it is
unbounded.

### After — `agent/bots/a0-105-no-fear-of-death`

| character | tier | caution | patience | retreat ticks | turned at | leaf |
|---|---|---|---|---|---|---|
| rusty | easy | 1.3 | 3.90 s | 250 | t=250 (4.17 s) | `turn-and-fight` |
| bolt | easy | 0.5 | 1.50 s | 110 | t=110 (1.83 s) | `turn-and-fight` |
| foreman | medium | 1.1 | 2.20 s | 140 | t=140 (2.33 s) | `turn-and-fight` |
| patch | medium | 1.2 | 2.40 s | 150 | t=150 (2.50 s) | `turn-and-fight` |
| sable | hard | 0.9 | 1.08 s | 69 | t=69 (1.15 s) | `turn-and-fight` |
| vulture | hard | 1.0 | 1.20 s | 78 | t=78 (1.30 s) | `turn-and-fight` |
| warden | hard | 1.0 | 1.20 s | 78 | t=78 (1.30 s) | `turn-and-fight` |

The retreat-tick counts are **identical at the 20-second and the 120-second
ceiling**: each bot runs, turns once, and stays turned for as long as the
pressure is on. The gap between a tier's patience and its turn is its own
reaction cadence — Easy decides six times a second, Hard twenty.

The personality spread is intact and is the whole ladder: timid Rusty gives a
failing retreat 3.9 seconds, reckless Bolt 1.5, and the Hard seats — which price
their own hull the way the design does — barely one. **Every tier turns**, and
that is structural rather than a property of three tuning numbers: patience is
`tier × caution` clamped to [0.5 s, 5 s] (`standoffPatience`), so no character can
be tuned into a bot that holds forever.

---

## 3 · What was built

A retreat is a manoeuvre and must terminate, so it got the one exit the **bot**
controls rather than the opponent: *is the running working?*

- **`src/bots/standoff.ts`** — a third latch beside `./commitment` and
  `./cornered`, carrying no domain knowledge: an anchor (the widest gap this
  retreat has opened), a patience clock that runs only while that anchor stands
  unbeaten, and a commitment window.
- **`wantsRetreat`** folds one gap reading per decision, and only when the
  retreat has **run out of road** — the bot is inside `ARRIVE_RADIUS` of its own
  station, or has no refuge to fly to at all (station dead, or the threat sitting
  on it) — *and* it is still in contact (`THREAT_RANGE`). A retreat that is still
  flying somewhere, or whose chaser has fallen out of weapon reach, is left
  completely alone.
- **`turn-and-fight`** is a new leaf directly below `retreat` in all three trees.
  It engages the threat on exactly the terms every other attack does.

**What a player sees.** They chase a wounded bot home and park on it, the way the
developer did. The bot keeps running for a beat, and then it stops, swings its
nose around and comes at them, in among its own turrets — the best fight it is
going to get, and the whole reason a bot retreats *into* its defences (GDD §2.6).
It does not read as a timer expiring, because it is not one: back off far enough
that the bot starts opening ground and the same bot keeps running instead. The
turn is the bot's answer to *running is not working*, and the difference is
legible from outside the cockpit.

Rejected, deliberately: a bare timer (reads as a timer), a hull-fraction tweak
(moves the deadlock rather than removing it), and deleting the retreat (a wounded
bot running for cover is good play and the developer has never complained about
it).

---

## 4 · How often it fires, and what it costs

Five whole eight-bot matches, the shipped cast, seeds 1–5, share of all winning
decisions:

| leaf | before | after |
|---|---|---|
| `retreat` | 23.50% | 17.60% |
| `turn-and-fight` | — | 0.57% |
| `cornered-fight` | 1.26% | 1.10% |
| `attack` | 15.42% | 17.37% |
| `dead` | 14.28% | 20.28% |

The retreat is still there and still the bot's third most common decision; what
ended is its immortality. The turn itself is 0.6% of decisions, beside
`cornered-fight`'s 1.1%.

**It is paid in hulls, and that is the ordered trade.** Over twelve whole matches
(seeds 1–12) bots die 25% more often — 1754 → 2184 — and a dead ship drops its
whole hold (GDD §2.7), so less ore reaches a station and fewer cores get patched:
accepted repairs 122 → 80, core HP bought 1830 → 1200, stations that ever patched
45 → 39 of 96. `src/bots/repair-honesty.test.ts` (the p15-02 lock) has been
widened from five seeds to twelve and its floors restated between a
p15-02-*off* build (~50 accepted repairs) and this one (80), with the table in
its own note. That lock still fails loudly if the home errand regresses; what it
no longer claims is that a bot which refuses to die is worth more core HP than
one that does.

Match length is unmoved: mean 812 s after against 813 s before, inside the
10–15 minute target (GDD §1), and no run in any sweep failed to end.

---

## 5 · Win rates — still inside the 55% band

**Instrument** `evidence/a0-105-standoff/win-rates.ts`, which is
`harness/abundance.ts`'s `readContests` shape verbatim: every seed plays every
rotation, so a seat-order advantage cancels inside each seed. Raw output in
`evidence/a0-105-standoff/win-rates.txt`.

### Strategy contest — bot mirrors (GDD §3.8)

One hull (Vanguard), the three equally-skilled Hard characters rotated across the
eight seats, so a win is attributable to the strategy and not to a difficulty
gap. Fair share 33.3%, ceiling 55%.

96 matches per build (32 seeds × 3 rotations), no unfinished match on either.

| contestant | before (main @ `84b0f1c`) | after |
|---|---|---|
| warden | 37/96 — **38.5%** | 42/96 — **43.8%** |
| vulture | 33/96 — 34.4% | 34/96 — 35.4% |
| sable | 26/96 — 27.1% | 20/96 — 20.8% |

**Both builds are inside the band**, and the ordering is unchanged. The top
contestant moves 38.5% → 43.8%, about one standard error at this sample size
(SE ≈ 4.8 points) and eleven points clear of the 55% ceiling. Where the movement
is real it is legible: Warden is the Hard homebody, and a branch that ends a
retreat *at the bot's own turret ring* is worth most to the character that builds
the most turrets. Match length is unmoved — mean 811 s after, 812 s before.


### Class contest (GDD §2.11)

One behaviour (`HARD_POOL[0]` — sable), four hulls rotated, 32 matches per build.
Fair share 25%, ceiling 55%.

| hull | before | after |
|---|---|---|
| excavator | 25/32 — **78.1% OVER** | 22/32 — **68.8% OVER** |
| hauler | 5/32 — 15.6% | 5/32 — 15.6% |
| vanguard | 2/32 — 6.3% | 2/32 — 6.3% |
| interceptor | 0/32 — 0.0% | 3/32 — 9.4% |

**This is over the ceiling on both builds and is not this branch's finding** — it
is a pre-existing ship-class result on the shipped trees, and a0-105 moves it
*down* by nine points. The §2.11 class multipliers are gameplay's lane, not the
bot lane's, so it is reported here and left alone. It is recorded because a
reader who runs the instrument will see the OVER and should know it was already
there.


---

## 6 · Sibling latches — the same question asked of every one

The brief asks for the audit: *any latch whose release depends only on conditions
an opponent controls can be held open by that opponent.*

| latch / branch | release | opponent-holdable? | verdict |
|---|---|---|---|
| `fleeing` (`commitment.ts`) | `recovered \|\| escaped` | **yes — this is a0-105** | **fixed**: a third exit the bot controls (`standoff.ts`) |
| `cornered` (`cornered.ts`) | blockader dies, is eliminated, or leaves `RETREAT_CLEAR_RANGE`; window re-derives every `CORNERED_COMMIT_SECONDS` | yes, by staying in the lane | **reported, no fix**: what is held open is a *fight*, not a hold — the bot is already doing the thing the ruling asks for, and `last-stand` and death both drop it |
| `standoff` (new) | patience clamped ≤ 5 s, window 4 s, re-anchored on the turn | no | bounded by construction |
| `allyResponse` / `allyAssault` (`ally.ts`) | quiet clock, or the `ALLY_RESPONSE_MAX` 45 s / `ASSAULT_JOIN_MAX` 25 s **ceilings** | no — each commitment is time-capped | ok. The known defect next door is unrelated in kind: a join ended by *death* does not charge its cooldown, so a bot that keeps dying re-commits at once (recorded in `ally-assault.test.ts`, b3-01). Each commitment still ends. |
| `escapeUntil` (`behaviors.ts` `go`) | `ESCAPE_SECONDS` (2 s) | no | bounded |
| `tabu` (`Brain.tabu`) | `TABU_SECONDS` (12 s) per entry | no | bounded |
| `defend` | `station.underAttack \|\| homeIntruder` — no latch at all | yes: park a ship on a bot's doorstep and it defends for as long as you stay | **reported, no fix**: `defendHome` *engages* the intruder, so the bot fights rather than holds. It does deny the bot its economy for as long as a player is willing to sit there, which is a trade the over-defence design already makes (GDD §2.9). |
| `last-stand` (`coreUnderFinalAssault`) | core back above 30%, the attack stopping, or collapse | yes, by keeping a core under 30% and shooting it | **reported, no fix**: this is the ratified priority exception — a core under final assault outranks self-preservation (v0.2.2 field report), and the bot is fighting at home while it holds |
| `haul` (`wantsToHaul`) | the hold is spent at the station | not usefully: `defend` sits **above** `haul` in all three trees, so a hostile parked on the station is a `homeIntruder` and gets fought; damage taken on the way makes the bot wounded and the retreat/standoff ladder applies | ok |

The shape a0-105 is about — *an opponent can make the bot do nothing at all* —
exists in exactly one place, and this branch closes it. Every other latch either
carries its own clock or resolves into a fight.

---

## 7 · Standing tests

- `src/bots/behaviors.test.ts` — **`a retreat that cannot recover and cannot
  escape ends in a fight`** (the reported scenario, bounded at 8 s), the per-tier
  spread with the ladder read off the measurement, the retreat that *is* working
  and is left alone, and the turn that ends when its subject does. The first of
  these fails on `84b0f1c` with `expected -1 to be greater than 0`.
- `src/bots/standoff.test.ts` — the primitive as arithmetic, including that it
  terminates at *every* patience a caller can hand it.
- `src/bots/ffa-parity.test.ts` — sixth re-baseline, on the a0-81 precedent and
  the same bar; the module note carries the reasoning and the old hashes.
