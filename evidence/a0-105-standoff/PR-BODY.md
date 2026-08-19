# a0-105 — a wounded bot ran home, the player followed, and it never came out again

> *"I was able to make rusty just stay stuck there by putting myself in between
> the ore and his base. he just stayed in that same spot scared of me. ship lives
> are cheap. enemies should not fear death..."* — the developer, 2026-08-19, with
> a screenshot of Rusty parked at its own station at 20/70 hull

The last sentence is the ruling, and it is already the design: respawn is free
(GDD §2.3, §2.7). A bot that holds position because it is afraid is trading a
free thing for the match's whole tempo, and a player who finds that has found a
way to switch an opponent off by standing still.

## The trace in the brief is correct, and it is worse than "long"

`wantsRetreat` latched with `commit(latch, enter, recovered || escaped)`, and
**both exits are conditions the opponent controls**: park inside
`RETREAT_CLEAR_RANGE` and `escaped` can never read true, and nothing in the game
repairs a hull, so `recovered` can never read true either. `cornered` covers the
case where the road home runs *through* the threat and is ruled out explicitly
when the bot is already home; `last-stand` needs a core under 30%.

Reproduced before touching anything —
`npx vite-node evidence/a0-105-standoff/standoff.ts`, output in
`evidence/a0-105-standoff/standoff.txt`:

| build | rusty | bolt | foreman | patch | sable | vulture | warden |
|---|---|---|---|---|---|---|---|
| main @ `84b0f1c`, 120 s ceiling | 7200/7200 | 7200/7200 | 7200/7200 | 7200/7200 | 7200/7200 | 7200/7200 | 7200/7200 |
| this branch, ticks before it turns | 250 | 110 | 140 | 150 | 69 | 78 | 78 |

Every character, every tier, held the `retreat` leaf on **every tick it was
given**. The hold is not long, it is unbounded.

## What was built

A retreat is a manoeuvre, not a state of mind, so it got the one exit the **bot**
controls rather than the opponent: *is the running working?*

- **`src/bots/standoff.ts`** — a third latch beside `./commitment` and
  `./cornered`, carrying no domain knowledge in the same way they don't: an
  anchor (the widest gap this retreat has opened), a patience clock that runs
  only while that anchor stands unbeaten, and a commitment window.
- **`wantsRetreat`** folds one gap reading per decision, and only when the
  retreat has **run out of road** — inside `ARRIVE_RADIUS` of its own station, or
  with no refuge to fly to at all (station dead, or the threat sitting on it) —
  *and* it is still in contact (`THREAT_RANGE`).
- **`turn-and-fight`** is a new leaf directly below `retreat` in all three trees,
  engaging on exactly the terms every other attack does.

**What a player sees.** They chase a wounded bot home and park on it, the way the
developer did. The bot keeps running for a beat — a timid character about four
seconds, a Hard one barely one — and then it stops, swings its nose around and
comes at them, in among its own turrets, which is the best fight it is going to
get and the whole reason a bot retreats *into* its defences (GDD §2.6). It does
not read as a timer expiring, because it is not one: **back off far enough that
the bot starts opening ground and the same bot keeps running instead.** The turn
is its answer to *running is not working*.

**The personality spread is intact, and every tier turns.** Patience is
`tier × caution` — Rusty 3.9 s, Bolt 1.5 s, the Hard seats ~1.2 s — clamped to
[0.5 s, 5 s], so "every tier turns" is a property of the code rather than of three
numbers in a tuning table.

Rejected, deliberately: a bare timer (reads as a timer), a hull-fraction tweak
(moves the deadlock rather than removing it), and deleting the retreat.

## The scope, and the trap in it

The first cut fired on *any* in-contact retreat that was not opening ground.
That halved retreat time and pushed `dead` from 14% to 24% of all decisions —
deleting the retreat in everything but name, which the brief forbids.
`retreatOutOfRoad` is the correction, and it is the whole difference between the
change the developer asked for and a balance change wearing its clothes. As
shipped, over five whole eight-bot matches:

| leaf | before | after |
|---|---|---|
| `retreat` | 23.50% | 17.60% |
| `turn-and-fight` | — | 0.57% |
| `cornered-fight` | 1.26% | 1.10% |

## What it costs, stated plainly

It is paid in hulls, which is the trade the ruling orders. Over twelve whole
matches: deaths 1754 → 2184 (+25%), and because a dead ship drops its whole hold
(GDD §2.7), accepted core repairs 122 → 80 and core HP bought 1830 → 1200.
`src/bots/repair-honesty.test.ts` (the p15-02 lock) is widened from five seeds to
twelve — core patches are a low-frequency event and five seeds is a number with a
±50% mood — and its floors restated between a p15-02-*off* build (~50) and this
one (80), with the table in its own note. It still fails loudly if the home
errand regresses.

Match length is unmoved: mean 812 s against 813 s, inside the 10–15 minute target,
no run in any sweep failed to end.

## Win rates — inside the 55% band

`evidence/a0-105-standoff/win-rates.ts`, the `readContests` shape verbatim
(every seed plays every rotation). Strategy contest — the bot mirrors — one hull,
the three equally-skilled Hard characters rotated, 96 matches per build:

| contestant | before (`84b0f1c`) | after |
|---|---|---|
| warden | 38.5% | **43.8%** |
| vulture | 34.4% | 35.4% |
| sable | 27.1% | 20.8% |

Inside the band on both, ordering unchanged, top contestant eleven points clear
of the 55% ceiling. Match length unmoved (811 s vs 812 s), no unfinished match on
either build.

The class contest (`harness/soak.ts`'s other 55% contest) reads **excavator
78.1% before / 68.8% after** over 32 matches. That is over the ceiling on **both**
builds — a pre-existing ship-class finding, not this branch's, and moved *down*
by it. Flagged for the gameplay lane rather than touched here.

## Sibling latches — the same question asked of every one

*Any latch whose release depends only on conditions an opponent controls can be
held open by that opponent.* Full table in
`tests/reports/a0-105-standoff.md` §6; the short version:

- `fleeing` — **this bug. Fixed.**
- `cornered` — an opponent who holds the lane keeps the bot committed, but what
  is held open is a *fight*, not a hold. **Reported, no fix.**
- `defend` / `last-stand` — no latch at all; an opponent can hold either true by
  parking on a doorstep or keeping a core under 30%. Both resolve into the bot
  fighting at home, and `last-stand` is the ratified priority exception.
  **Reported, no fix.**
- `allyResponse` / `allyAssault` / `escapeUntil` / `tabu` — all carry their own
  ceilings (45 s / 25 s / 2 s / 12 s). **Bounded by construction.**
- `haul` — no latch, and `defend` sits above it, so a ship parked on the station
  is a `homeIntruder` and gets fought. **Ok.**

## Standing tests

- `src/bots/behaviors.test.ts` — **`a retreat that cannot recover and cannot
  escape ends in a fight`**, the reported scenario, bounded at 8 s. It fails on
  `84b0f1c` with `expected -1 to be greater than 0` (verified in a throwaway
  worktree). Plus the per-tier spread, the retreat that *is* working and is left
  alone, and the turn that ends when its subject does.
- `src/bots/standoff.test.ts` — the primitive as arithmetic, including that it
  terminates at *every* patience a caller can hand it.
- `src/bots/ffa-parity.test.ts` — **sixth re-baseline**, on the a0-81 precedent
  and the same bar: nothing in a0-105 is team-aware (the standoff reads one
  distance to `nearestThreat`, this bot's own station and its own hull), so it
  moves FFA and teams by the identical mechanism. The module note carries the
  reasoning and the old hashes.
- `src/bots/ally-assault.test.ts` — the forced-vs-control ordering is now a mean
  over three seeds; at seed 31 alone the *control* match opens a long unscripted
  raid of its own on this build.

Report: `tests/reports/a0-105-standoff.md`. Evidence:
`evidence/a0-105-standoff/`.
