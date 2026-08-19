# a0-107 — the dead band: the retreat still had no end, 260 units further out

**Branch** `agent/bots/a0-107-close-the-dead-band` · **Owner** Bot Engineer ·
**Date** 2026-08-19 · **Closes** QA defect `a0-106-01`

QA built the adversarial harness (a0-106) and it found one defect on its first
run, on the a0-105 fix itself. Their write-up is
`tests/reports/a0-106-adversarial.md` §5 and it is the evidence; this report is
the fix and the measurement either side of it.

a0-105 gave the retreat an end, and it fires: the standoff commits in 20 cells
of QA's sweep and releases in every one. **The problem was what stood in front
of it.**

```ts
if (threat.distance > THREAT_RANGE || !retreatOutOfRoad(ctx, threat)) {
  resetStandoff(stand);           // ← a read that cannot be evaluated
  return true;                    //   threw the patience clock away
}
```

Both gates are things an opponent controls, and a read that failed either one
did not merely skip the fold — it **reset the patience clock**. So an opponent
who kept either false on any tick kept the clock at zero forever. a0-105 added a
third exit to a latch whose two exits were opponent-controlled, and put it behind
a fourth and a fifth that are too.

---

## Summary

| | |
|---|---|
| Defect | `a0-106-01` — the flee latch, unbounded again, 25 reproductions |
| Fix | `src/bots/standoff.ts`, `src/bots/behaviors.ts` — the two gates deleted, a second progress anchor added |
| `KNOWN_UNBOUNDED` | 25 entries → **0** |
| Worst hold, `park@580`, 300 s ceiling | **17 860 ticks → 630** (rusty) |
| Retreat episodes, 5 whole matches | 311 → 300; median **1.25 s → 1.40 s**; longest **99.00 s → 14.17 s** |
| Match length | mean 811 s → **809 s**, 0 unfinished of 96 |
| Win rates | strategy contest top 43.8% → **39.6%**, inside the 55% band on both builds |

---

## 1 · The fix, and why it is not a wider range

QA ruled out the obvious repair before anyone wrote it, and they were right:
**widening `THREAT_RANGE` moves the dead band, it does not close it.** Any fold
gated on a distance has an annulus on the far side of that distance and inside
`RETREAT_CLEAR_RANGE`. Their constraint (2) — *the reset is the bug more than the
gate is* — is the one this branch took, with one amendment their §5 could not
have known without trying it.

### What "hold the clock instead of resetting it" alone does not do

Holding is necessary and it is not sufficient, because **in the reproduction the
fold is never evaluated at all.** Under `park@580` the separation is in the band
on 17 954 ticks of 18 000, so the `THREAT_RANGE` gate fails on essentially every
one; a held clock that is never *started* stays at `-1` and no character ever
turns. `block-home` is the same in the other gate: the subject never gets inside
`ARRIVE_RADIUS` of a station somebody is standing on, so `retreatOutOfRoad` can
stay false for the whole run and the fold never runs there either.

So the measurement itself has to become unconditional. That is the amendment, and
it is the same instinct one step further: **stop asking permission to measure,
and measure the thing the gate was standing in for.**

### The two anchors

A retreat is a manoeuvre with exactly two ways of working, and the gates were
crude proxies for both:

| the old gate | what it was really asking | what replaces it |
|---|---|---|
| `threat.distance > THREAT_RANGE` | *is this thing still pinning me?* | the separation is folded against the flee latch's **own** contact read (`nearestThreat(ctx, RETREAT_CLEAR_RANGE)`) — the same threat that keeps the latch committed is the one it is measured against |
| `!retreatOutOfRoad(ctx, threat)` | *am I still going somewhere?* | `retreatRoad` — the **distance** to the refuge, folded as a second monotone anchor |

`standoffFold` now takes both and gives the patience back for improving on
**either**:

```ts
if (latch.gap < 0 || gap >= latch.gap + progress) { latch.gap = gap; working = true; }
if (road >= 0 && (latch.road < 0 || road <= latch.road - progress)) { latch.road = road; working = true; }
if (working) { latch.since = -1; return false; }
```

Three properties fall out, and they are the whole argument:

1. **No annulus can exist.** The contact range is now the same predicate the flee
   latch's `escaped` exit uses. Past `RETREAT_CLEAR_RANGE` there is nothing to
   measure *because the retreat has succeeded*, and inside it everything is
   measured. There is no third region for anyone to park in — which is a
   structural claim, not a tuning one, and it is why no range moved.
2. **Nothing on the path is opponent-controlled.** An opponent can stop the clock
   only by letting the bot open ground or letting it get home. Both are the
   retreat working. (This is the audit the brief asks for, and §6 does it line by
   line.)
3. **It terminates.** Both anchors only ever move in the improving direction, so
   an opponent who herds a bot back and forth cannot be paid twice for the same
   ground: there is only so much ground to open and only so much road to close,
   so there are finitely many legitimate resets and every retreat ends.

The a0-105 **scope trap** — "the first cut fired on ANY in-contact retreat that
was not opening ground, which halved retreat time and effectively deleted the
retreat" — is what the road anchor is for. A wounded bot flying to its turrets
improves the road every decision or two, so this branch never interrupts it. §4
is the measurement of that claim rather than the assertion of it.

---

## 2 · Held ticks, before and after, at three ceilings

**Instrument** `evidence/a0-107-dead-band/deadband.ts` — deliberately *QA's*
harness (`tests/adversarial/antagonist.ts`, `latches.ts`) with one axis added,
the ceiling, so the numbers here and the numbers the standing gate asserts on are
produced by the same code. Run with
`npx vite-node evidence/a0-107-dead-band/deadband.ts`; raw output in
`deadband-before.txt` (measured in a worktree at `3de74a4`) and
`deadband-after.txt`.

A **held tick** is a tick of the longest unbroken run of the `fleeing` latch
(`committed()`, the bot's own bit). `†` means the hold was **still open** when
the run stopped — the shape of an unbounded latch, and the reason one ceiling
proves nothing.

### `park@580` — the cheapest opponent there is

Parked, silent, never moves, never fires, at one fixed range in the annulus.
This is the cell the brief names and the one that costs 0.3 s to check.

| character | tier | 40 s (2400) | 120 s (7200) | 300 s (18000) | | 40 s | 120 s | 300 s | turned to |
|---|---|---|---|---|---|---|---|---|---|
| | | **before** | **before** | **before** | | **after** | **after** | **after** | **after** |
| rusty | easy | 2230 † | 7030 † | 17830 † | | 630 | 630 | 630 | `turn-and-fight` |
| bolt | easy | 2230 † | 7030 † | 17830 † | | 340 | 440 | 440 | `turn-and-fight` |
| foreman | medium | 2245 † | 7045 † | 17845 † | | 200 | 325 | 395 | `turn-and-fight` |
| patch | medium | 2245 † | 7045 † | 17845 † | | 415 | 415 | 415 | `turn-and-fight` |
| sable | hard | 2262 † | 2595 | 2595 | | 240 | 267 | 294 | `turn-and-fight` |
| vulture | hard | 2262 † | 2595 | 2595 | | 141 | 267 | 297 | `turn-and-fight` |
| warden | hard | 2262 † | 3846 | 3846 | | 183 | 267 | 267 | `turn-and-fight` |

Before, the Easy and Medium seats track the ceiling exactly — 17 830 of 18 000
against an opponent doing nothing — and the Hard seats do escape but sideways,
into `mine` or `cornered-fight`, after 43 to 64 seconds. **No character in the
cast turned and fought**, because the standoff was never folded at all.

After, every character turns, every one of them into `turn-and-fight`, and the
number **stops tracking the ceiling** — 630 at 40 s is 630 at 300 s. That is what
bounded looks like from outside.

### The other five reproductions

Longest hold in ticks; `before → after` at each ceiling. Full tables in the raw
output.

| antagonist | character | 40 s | 120 s | 300 s | after, turned to |
|---|---|---|---|---|---|
| `block-ore` | rusty | 2180 † → 380 | 6980 † → 650 | 17780 † → 680 | `turn-and-fight` |
| `block-ore` | bolt | 2180 † → 240 | 6980 † → 450 | 17780 † → 460 | `turn-and-fight` |
| `block-ore` | foreman | 2190 † → 435 | 6990 † → 445 | 17790 † → 510 | `turn-and-fight` |
| `block-ore` | patch | 2190 † → 445 | 6990 † → 510 | 17790 † → 510 | `turn-and-fight` |
| `block-ore` | warden | 2211 † → 198 | 3009 → 198 | 3009 → 396 | `turn-and-fight` |
| `block-home` | rusty | 2400 † → 370 | 5920 → 370 | 5920 → 370 | `turn-and-fight` |
| `block-home` | bolt | 2400 † → 230 | 6790 → 230 | 6790 → 230 | `turn-and-fight` |
| `never-die` | rusty | 2400 † → 360 | 7200 † → 360 | 18000 † → 360 | `turn-and-fight` |
| `never-die` | bolt | 2400 † → 220 | 7200 † → 220 | 18000 † → 220 | `turn-and-fight` |
| `park-squad` | all seven | 2230–2262 † → 141–630 | 7030–7045 † → 234–630 | 17830–17845 † → 249–630 | `turn-and-fight` |
| `never-die-squad` | rusty | 2400 † → 360 | 7200 † → 360 | 11290 → 360 | `turn-and-fight` |
| `never-die-squad` | bolt | 2400 † → 220 | 7200 † → 220 | 10870 → 220 | `turn-and-fight` |

**`never-die` is the load-bearing one.** It is the antagonist under which *no*
opponent-controlled exit can fire by construction — invulnerable, and the
subject's hull pinned — so it is the pure test of whether the bot owns a way out.
Before: 18 000 of 18 000, still open. After: 360 ticks, six seconds, at every
ceiling.

The worst hold anywhere in the sweep after the fix is **680 ticks (11.3 s)**,
against the `fleeing` latch's 30 s bound.

### The whole cross-product

`npx vitest run tests/adversarial/latch-bounds.test.ts` — 12 antagonists × 7
characters × 12 latches, all five assertions green with `KNOWN_UNBOUNDED`
**empty**, which means assertion 1 now exempts nothing:

```
 ✓ tests/adversarial/latch-bounds.test.ts (5 tests) 3.7s
```

---

## 3 · Did it delete the retreat? No — it cut the tail

This is the a0-105 scope trap's own test, and the number that answers it is not
the share of decisions but the **distribution of episode lengths**. Deleting the
retreat moves the median; ending it moves the maximum.

**Instrument** `evidence/a0-107-dead-band/decision-mix.ts`, five whole FFA
matches (180 s, eight bots, the shipped cast — `ffa-parity.test.ts`'s own run
shape), 432 000 decisions per build.

| retreat episodes | before | after |
|---|---|---|
| count | 311 | **300** |
| mean | 5.36 s | 2.76 s |
| **median** | **1.25 s** | **1.40 s** |
| p90 | 11.00 s | 7.17 s |
| **longest** | **99.00 s** | **14.17 s** |
| ticks in 10 s-plus episodes | 68 276 (**68.3%** of all retreat) | 8 090 (**16.3%**) |

Bots retreat **just as often** (311 → 300) and the ordinary retreat is a touch
*longer* (1.25 s → 1.40 s). What halved the share is the 99-second one that used
to exist: two thirds of all retreat time before this branch was spent inside
episodes longer than ten seconds, which is the defect measured in a live match
rather than in a staging.

The decision mix moves accordingly, and legibly:

| leaf | before | after |
|---|---|---|
| `retreat` | 23.15% | 11.49% |
| `turn-and-fight` | 0.82% | 3.00% |
| `attack` | 16.84% | 17.52% |
| `mine` | 13.29% | 15.51% |
| `defend` | 12.70% | 14.90% |
| `dead` | 16.10% | 18.64% |
| `cornered-fight` | 1.52% | 1.70% |

`dead` moves 2.5 points, which is the cost of the ruling and was priced in when
it was made: respawn is free (GDD §2.3, §2.7), and a bot that trades a free thing
to hold position is trading away the match's tempo. For scale, a0-105's *rejected*
first cut pushed the same number from 14% to 24%.

---

## 4 · Match length and win rates — inside the band

**Instrument** `evidence/a0-107-dead-band/win-rates.ts`, which is
`evidence/a0-105-standoff/win-rates.ts` verbatim but for its env prefix — itself
`harness/abundance.ts`'s `readContests` shape, so every seed plays every rotation
and a seat-order advantage cancels inside each seed. Raw output in
`win-rates-{before,after}.txt`.

### Match length (GDD §1 — 10–15 minutes)

| contest | before | after |
|---|---|---|
| strategy, 96 matches | mean **811 s**, min 774, max 836, 0 unfinished | mean **809 s**, min 768, max 837, 0 unfinished |
| class, 128 matches | mean **811 s**, min 601, max 843, 0 unfinished | mean **806 s**, min 322, max 848, 0 unfinished |

Unmoved: 13.5 minutes, and no run in any sweep failed to end. The one 322-second
match in the class contest is a single early rout in an excavator-vs-interceptor
lineup and is one match of 128; the distribution is otherwise unchanged.

### Strategy contest — bot mirrors (GDD §3.8), fair share 33.3%, ceiling 55%

96 matches per build (32 seeds × 3 rotations), 0 unfinished on either.

| contestant | before (main @ `3de74a4`) | after |
|---|---|---|
| warden | 42/96 — **43.8%** | 35/96 — 36.5% |
| vulture | 34/96 — 35.4% | 38/96 — **39.6%** |
| sable | 20/96 — 20.8% | 23/96 — 24.0% |

**Both builds are inside the band**, and the top contestant moves *down*, 43.8%
→ 39.6% — fifteen points clear of the ceiling and closer to the 33.3% fair
share than before. The first and second places swap, by four points, which is
under one standard error at this sample size (SE ≈ 4.9 points). Where the
movement is legible it reads the right way: a0-105 rewarded Warden most because
it ends a retreat at the bot's own turret ring, and a0-107 takes some of that
back by ending the retreats that were happening *away* from the ring too.

### Class contest (GDD §2.11), fair share 25%, ceiling 55%

| hull | before | after | 256-match re-read, before | after |
|---|---|---|---|---|
| excavator | 90/128 — **70.3% OVER** | 97/128 — **75.8% OVER** | see below | |
| vanguard | 17/128 — 13.3% | 21/128 — 16.4% | | |
| hauler | 18/128 — 14.1% | 6/128 — 4.7% | | |
| interceptor | 3/128 — 2.3% | 4/128 — 3.1% | | |

**This is over the ceiling on both builds and is not this branch's finding.** It
is a pre-existing ship-class result on the shipped trees — a0-105 recorded the
same OVER at 78.1% before it and 68.8% after — and the §2.11 class multipliers
are gameplay's lane, not the bot lane's. It is reported here because a reader who
runs the instrument will see the OVER and should know it was already there. The
5.5-point move between these two builds is about 1.4 standard errors at 128
matches (SE ≈ 4.0 points).

---

## 5 · What else moved, and why

Three suites re-baselined, all measured, all documented in the files themselves.

- **`src/bots/ffa-parity.test.ts`** — the three FFA goldens move a seventh time
  (a0-81, a0-105 and five before them). Unavoidable: wounded bots leave the dead
  band on ticks they previously spent parked in it, so hulls, kills, chunks and
  every downstream decision differ. The module note carries the reason and §3's
  table as the size.
- **`src/bots/defender-role.test.ts`** — its match-scale case measured the
  two-teammates-flying residual on **one** seed against a 5% cap, where it read
  0.0%. That is a measurement of seed 11, not of the behaviour. Over six seeds
  on both builds (`evidence/a0-107-dead-band/ally-double.ts`) the metric reads
  **0.00% before and 0.88% after**, worst seed 5.19% — and **zero** defender
  disagreements in all twelve matches, which is the property that case exists to
  protect. It now runs three seeds, asserts the aggregate under 5% and each match
  under 8%. The residual is `./ally`'s latch inertia, bounded by
  `ALLY_RESPONSE_MAX`, and a retreat that now ends in a fight leaves bots in
  different places so the assignment changes hands mid-flight more often.
- **`src/bots/cornered.test.ts`** — the off-road negative case runs a **frozen**
  staging for six seconds. Nothing in it ever moves, so the bot opens no ground
  and closes no road, and after Rusty's 3.9 s of patience the standoff correctly
  reads a retreat that is getting nowhere and turns. The case asserts the retreat
  at one second and names the turn at six: `turn-and-fight`, not
  `cornered-fight`, which is the claim it was actually making.

New tests, in the bots lane's own suite (`src/bots/behaviors.test.ts`,
`src/bots/standoff.test.ts`): `park@580` against every character, a sweep of five
separations across the old 416 gate, one past the clear range that must *not*
turn, a bot chased home that must not be interrupted, and the road anchor's
arithmetic including the herding case. **The two dead-band cases were verified to
fail on `3de74a4`** in a throwaway worktree (`expected -1 to be greater than 0`)
and the two scope cases to pass there — a0-105's scope is what those assert, and
this branch keeps it.

---

## 6 · The audit the brief asked for

> *An exit condition that only an opponent can satisfy is not an exit.* When you
> land this, audit the fix you just wrote against that sentence.

Every condition on the path from "the bot is retreating" to "the bot turns":

| condition | who controls it | verdict |
|---|---|---|
| `ctx.view.collapsed`, `!ctx.self.alive` | the sim | releases the latch outright, and a collapse is the endgame |
| `corneredCommitted(...)` | the bot's own commitment | the bot is already **fighting**, and the blockade branch has its own ratified renewal |
| `standoffCommitted(...)` | a fixed window the bot set | bounded by `STANDOFF_COMMIT_SECONDS`, nothing renews it mid-window |
| `threat === null` (past `RETREAT_CLEAR_RANGE`) | the opponent — **by leaving** | the retreat has succeeded; this is the exit working, not an exit being withheld |
| `gap >= latch.gap + progress` | the **bot** — by opening ground | monotone anchor; an opponent who drops back and closes again pays only once |
| `road <= latch.road - progress` | the **bot** — by flying home | monotone anchor; same argument |
| `road === NO_ROAD` (station dead, or threat sitting on it) | the opponent can force it | forces the *shorter* path: one axis fewer to be working on, so it brings the turn **forward**. Safe direction. |
| `now - latch.since >= patienceSeconds` | the bot's own clock | `standoffPatience` is clamped to ≤ 5 s for every character at every tier |

Nothing on the path can be held false from outside. The one thing an opponent can
do is *leave*, and that ends the retreat by succeeding at it — which is the only
shape an exit condition an opponent participates in is allowed to have.

The sibling latches were audited in a0-105 §6 and re-audited by QA's own census
in a0-106 §6; nothing in this branch changes any of them. The general lesson is
written down once, for the lane that hits it next, in **`docs/LESSONS.md`**.

---

## 7 · Files

| file | what changed |
|---|---|
| `src/bots/standoff.ts` | second anchor (`road`), `NO_ROAD`, both anchors folded in one call and re-anchored on the turn |
| `src/bots/behaviors.ts` | both gates deleted from `wantsRetreat`; `retreatOutOfRoad` (a boolean) → `retreatRoad` (a distance) |
| `src/bots/standoff.test.ts` | six new cases for the road axis, including the herding case and the no-refuge case |
| `src/bots/behaviors.test.ts` | four new cases — the dead band, the sweep across 416, the flight home, the turn at every tier |
| `src/bots/cornered.test.ts`, `ffa-parity.test.ts`, `defender-role.test.ts` | re-baselines, §5 |
| `tests/adversarial/latch-bounds.test.ts` | `KNOWN_UNBOUNDED` emptied — QA's gate is the signal this is closed |
| `docs/LESSONS.md` | new — the lesson, twice now, one level apart |
| `evidence/a0-107-dead-band/` | four instruments and their before/after output |
