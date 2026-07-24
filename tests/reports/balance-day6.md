# Balance report — day 6

**Author:** QA Agent · **Branch:** `agent/qa/d6-balance` · **Date:** 2026-07-24
**Scope:** the two measurable balance targets (GDD §1, §2.11, §3.8)

- **Match length** lands in **10–15 minutes** across bot mirrors.
- **No strategy and no ship class exceeds a 55 % win rate** across bot mirrors.

---

## Verdict

| Target | Shipped baseline | With the fix QA found | Status |
|---|---|---|---|
| Match length 10–15 min | ❌ median **15.2 min**, tail to **19.5**, 39 % in band | ✅ **100 %** in band, median **12:55** | **Fix found, BLOCKED** — the fix is one constant (`COLLAPSE_CORE_DECAY = 3`) that `src/sim/match.test.ts` pins to 0 |
| No strategy > 55 % | ❌ **Warden 94 %** | ⚠️ **44–53 %** reachable | Partly reachable via QA-owned constants; a safe margin needs a Bot-Engineer weight change |
| No class > 55 % | ❌ **Excavator 96 %** | ⚠️ floor **~60 %** | **BLOCKED** — the decisive knob (Excavator `beam`) is pinned to the GDD table by `src/sim/upgrades.test.ts` |

**Bottom line.** QA found the constant changes that hit — or come far closer to
— both targets, and reproduced them across 100+ headless matches. **None of them
could be shipped in this PR**, because every constant that moves a target is
hard-pinned to its current value by a Gameplay-Engineer test in `src/`, which QA
does not own and may not edit. This report is the evidence; the unblock is a
Director call (§ *The blocker*, below). The reusable harness that produced every
number here **is** shipped (`harness/`), so the moment the pins are relaxed the
retune is a values-only PR with the measurements already in hand.

---

## Method

- **Harness:** `harness/` — new this milestone (it was a placeholder). `runBalance(n)`
  seats a full eight-slot roster (`fillEmptySlots`), runs each match headless with
  the enforced timeout (`src/bots/harness` `runHeadlessMatch`), and reduces the
  batch to match-length distribution and win share by class and by strategy
  (`harness/stats.ts`, pure and unit-tested in `tests/harness/stats.test.ts`).
  Deterministic: seed drives world *and* bots, so a batch is a repeatable
  experiment, not a sample of noise (GDD §4.8).
- **Bots under test:** the **day-4 behaviour trees** (`agent/bots/d4-difficulties`:
  Easy/Medium/Hard + the seven personalities). These are **not merged into `main`**
  — `main` still carries the do-nothing baseline — so the measurements below were
  taken with that branch's `src/bots/` overlaid **for measurement only**. Nothing
  from it is committed here; this PR touches only files QA owns. **The win-rate
  numbers become real on `main` only once the d4 trees are merged.**
- **Field:** eight slots, roster order, so the class mix is the GDD §2.9/§2.11
  mapping: Excavator ×2 (Foreman, Warden), Interceptor ×2 (Bolt, Sable),
  Hauler ×3 (Rusty ×2 by roster wrap, Patch), Vanguard ×1 (Vulture).
- **Samples:** 50 matches per tuning candidate; **100** at the two decision points.
- **Corroboration:** the Bot Engineer independently measured the same baseline
  (`docs/bot-balance-day4.md`): 20/20 matches end, median 15.2 min, Warden 19/20.
  Our harness reproduces both findings, which cross-validates the measurement.

Reproduce: overlay the trees (`git checkout origin/agent/bots/d4-difficulties -- src/bots/`),
then `runBalance(100)` from `harness/` (see the scratch runner in this PR's
description); restore with `git checkout HEAD -- src/bots/`.

---

## Target 1 — match length

### Baseline (shipped constants, real trees, 50 matches)

| min | p10 | **median** | mean | p90 | max | in 10–15 band |
|---|---|---|---|---|---|---|
| 13:29 | 14:08 | **15:16** | 15:40 | 17:18 | 19:27 | **38.8 %** |

The median sits at the very top of the band and the tail runs to 19.5 minutes.
Cause (confirmed against `src/sim/match.ts`): at `COLLAPSE_CORE_DECAY = 0`,
collapse begins at 12.5 min but removes no core HP, so the match only ends when a
bot *hunts down* the last cores — the "no defending / no retreat in collapse"
behaviour the trees adopt precisely because the ruleset alone cannot finish
(docs/bot-balance-day4.md, Finding 2). That hunt is what overruns 15 minutes.

### The fix (measured)

`COLLAPSE_CORE_DECAY = 3` — a naked 100-HP core dies ~33 s after collapse opens,
so entropy, not a stalled hunt, ends the match:

| Config (100 matches) | median | range | in band | timeouts |
|---|---|---|---|---|
| decay 3, stock classes | **12:55** | 12:38 – 13:02 | **100 %** | 0 |

This is the falsification the constant was explicitly left at 0 for (its own doc
comment, and Finding 2). It makes the ending **structural** — two humans who both
turtle can no longer freeze a match the ruleset promised would end — which the
harness now pins as a live gap in `tests/harness/balance.test.ts` (at the shipped
0, an idle match times out).

**Decay was swept, not guessed:**

| decay | length median | notes |
|---|---|---|
| 0 (shipped) | 15:16 | tail to 19:27; not structural |
| 1.5 | ~13:20 | bounds the tail, but win share worsens (see below) |
| 3 | 12:55 | **chosen** — in band, structural, difficulty ordering intact |
| 5 | 12:46 | in band, **but** an Easy bot (Rusty) climbs to 24 % — breaks GDD §2.9 |

### Status: **BLOCKED**

`COLLAPSE_CORE_DECAY = 3` breaks three tests in `src/sim/match.test.ts`:

1. *"delivers the whole field yield, and not one wave more"* — decay kills the
   two cores within the 900-step window, and the wreck debris adds ore beyond
   `FIELD_YIELD`.
2. *"two runs of the whole wave schedule deep-equal"* — asserts `phase === 'collapse'`
   at t=800 s; with decay both cores are dead by then, so `phase === 'ended'`.
3. *"shuts the repair channel off"* — asserts `planet.coreHp` is **exactly**
   unchanged across 300 collapse steps, which requires decay to be *exactly* 0.

All three assume `COLLAPSE_CORE_DECAY = 0`. They are in `src/`, which QA may not
touch. So the knob the sim's own comment hands QA "to falsify the stalemate
hypothesis by raising" cannot actually be raised without the code owner
parameterising these tests off the constant. **The value is held at 0 pending
that.** (See *The blocker*.)

---

## Target 2 — win rate

### Baseline (shipped constants, real trees, 50 matches)

| By class | share | | By strategy | share |
|---|---|---|---|---|
| **Excavator** | **96 %** | | **Warden** | **94 %** |
| Interceptor | 2 % | | Foreman | 2 % |
| Hauler | 2 % | | Sable | 2 % |

Warden (Hard tier, Excavator hull, `homebody 1.0`) wins almost everything. This
is not an exploit — it is the siege model working as designed (GDD §2.6:
"turrets fighting alongside the defender's ship … a defended planet is nearly
uncrackable"), in the hull with the highest beam in the game (13), fighting from
the strongest position. Foreman shares the Excavator hull, so the **class**
number is Warden + Foreman.

### What QA-owned constants can and cannot do (measured)

The clean lever the Bot Engineer flagged — lowering the Excavator's beam — is
**pinned** (see below), so it was measured but cannot ship. With it available:

| Config (50 matches) | Warden | Excavator class | note |
|---|---|---|---|
| baseline | 94 % | 96 % | — |
| decay 3 only (stock classes, 100 m) | **53 %** | **73 %** | decay alone halves it; Warden borderline |
| + Excavator beam 13→11, hull 55→44, decay 3 | 48 % | 66 % | strategy under 55; class stuck (2 Excavators) |
| + turret HP 30→22, decay 4 (beam 11 hull 44) | **44 %** | 66 % | strategy with real margin; Easy suppressed |
| Excavator hull → 32 (glass), beam 11, decay 3 | 40 % | **60 %** | class **floor** — beam is the driver, and it is floored at 11 to keep the "best miner" identity |

Two robust conclusions:

- **Strategy ≤ 55 % is reachable** with QA-owned constants (`COLLAPSE_CORE_DECAY`
  plus a turret-HP nerf gets Warden to ~44 %), *if* those constants were not
  pinned — but decay is pinned (Target 1) and the margin is thin without also
  touching the Excavator.
- **Class ≤ 55 % is not reachable by constants at all.** The Excavator is flown
  by the two strongest pilots (Warden Hard, Foreman Medium) and carries the
  league-high beam; even a glass-cannon Excavator (hull below the Interceptor's)
  bottoms out at **60 %**. Beam is the only lever that crosses 55 %, and lowering
  it below the Vanguard's 10 would invert the class's ratified role
  ("out-earns everyone", GDD §2.11) — a design change, not a tune.

### Status: **BLOCKED** (class) / **needs a cross-owner change** (strategy)

- **Excavator `beam`/`hull` are pinned** to the GDD §2.11 table by
  `src/sim/upgrades.test.ts` (the "keeps the constants table and the GDD table in
  step" test asserts `stats.beam === 13`, `stats.hull === 55` exactly). QA cannot
  change them without editing that `src/` test.
- **The cleanest fix is the Bot Engineer's**, and they offered it
  (docs/bot-balance-day4.md): detune `PERSONALITIES.warden.homebody` /
  `triangle.defend`, or move one of the two strong pilots off the Excavator hull.
  That directly attacks the class concentration without touching the class's
  combat identity. It lives in `src/bots/`, which QA does not own.

---

## The blocker

QA "owns the constants table from M2" (GDD §2.8), but in practice **the values
that matter are frozen by the Gameplay Engineer's own test suite**:

| Constant QA needs to move | Pinned to | by |
|---|---|---|
| `COLLAPSE_CORE_DECAY` (0 → 3) | exactly 0 | `src/sim/match.test.ts` (3 tests) |
| `SHIP_STATS[Excavator].beam` (13 → 11) | exactly the GDD table | `src/sim/upgrades.test.ts` |
| `SHIP_STATS[Excavator].hull` (55 → ≤44) | exactly the GDD table | `src/sim/upgrades.test.ts` |

The `upgrades.test.ts` pin is deliberate and healthy — it stops the class stats
drifting from the design doc silently. The right move there is **not** to loosen
the test but to change the GDD table *and* the constant together, through the
Director. The `match.test.ts` pin, by contrast, looks **accidental**: the sim's
own `constants.ts` comment invites QA to raise `COLLAPSE_CORE_DECAY`, yet those
three collapse tests hard-code its being 0. That is a contradiction inside one
agent's deliverables, and it is what actually blocks the match-length target.

Because unblocking needs a decision only the Director can make — parameterise
tests, or ratify a GDD/constant change — this half of the day-6 pass is escalated
rather than forced. QA will not edit `src/` tests, break a ratified §2.11
contract unilaterally, or ship constant changes that redden the build.

## Recommendations (ordered, with owners)

1. **Director → Gameplay Engineer:** parameterise the three collapse tests in
   `src/sim/match.test.ts` off `COLLAPSE_CORE_DECAY` (or gate them on it being 0).
   Then QA lands `COLLAPSE_CORE_DECAY = 3` as a values-only PR and the
   match-length target is met (evidence above). *Highest value, smallest change.*
2. **Director → Bot Engineer:** take up their offered Warden retune — lower
   `homebody`/`triangle.defend`, or move Warden or Foreman off the Excavator hull.
   This is the only clean path to the **class** ≤ 55 % target. QA will re-measure
   the instant it lands.
3. **Director:** merge `agent/bots/d4-difficulties` into `main`. Until it is, the
   shipped game has do-nothing bots and *none* of these balance numbers exist on
   `main` — the win-rate targets are unmeasurable there by construction.
4. **Housekeeping (Gameplay/Bot):** the comment at `src/bots/match-endgame.test.ts:14`
   ("`COLLAPSE_CORE_DECAY` is `0`") will go stale the moment (1) lands.

## What shipped in this PR

- `harness/` — the balance harness (runner + pure stats + markdown report
  formatter), replacing the day-0 placeholder. Reusable and deterministic.
- `tests/harness/` — 14 tests: the stats arithmetic, and the harness against the
  real sim (structural-ending gap at baseline, timeout enforcement, replay,
  batch aggregation).
- `src/sim/constants.ts` — **no value changes.** One comment update recording
  this finding on `COLLAPSE_CORE_DECAY`, so the next person to open the knob sees
  why it is still 0.
- this report.

`npx tsc --noEmit` clean; `npm test -- --run` green (671/671).
