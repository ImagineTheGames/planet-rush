# Dead tunables in `src/sim/constants.ts` — decisions and the sweep (g6-01)

**Owner:** Gameplay Engineer · **Branch:** `agent/gameplay/g6-01-dead-tunables`
**Answers:** `docs/gdd-conformance.md` items **G-13** and **G-14** (a0-19), and
the §8 task **T-7**.

A dead tunable is worse than a missing one: it invites a balance pass to turn it,
watch nothing happen, and distrust the whole table. GDD §2.8 already set the
precedent when it **retired** `Sensor range` instead of zeroing it — *"a `0`
would still read as tunable"* — and both decisions below follow it rather than
inventing a new pattern.

---

## 1. `AUTO_AIM_ARC` — **made live**

**Decision: wire it.** GDD §2.4 does not merely describe the 360°, it flags *the
arc itself* as the knob: *"checked across the full 360° around the ship, no
front-arc restriction (`TUNABLE`)"*. The design wants this dial; what was missing
was the code that reads it. Deleting it would also have deleted the only place in
the repo where the 360° rule is written down as an executable value — a0-19's own
warning ("do not delete it silently").

**What changed.** `withinAimArc` (`src/sim/step.ts`) now gates every acquisition
*candidate* — enemy ship, turret, radar satellite, core, and asteroid — against
the arc, centred on the hull's facing.

**Candidates, not the winner.** The gate sits inside the loops in `acquireEnemy`
and `acquireAsteroid`, not on the acquired target. With an arc set, auto-aim
therefore engages the nearest target *inside* the arc, instead of holding fire
because the nearest target overall happened to be behind. That is §2.4's "nearest
**valid** target", where the arc is part of what makes one valid.

**The default did not move — by construction, not by inspection.** At exactly
`2π` the gate short-circuits to `true` before any arithmetic:

```ts
const AIM_ARC_FULL_CIRCLE = AUTO_AIM_ARC >= 2 * Math.PI;
if (AIM_ARC_FULL_CIRCLE) return true;
```

A target dead astern is a bearing of exactly π against a `cos(π)` threshold, and
one bit of rounding either way decides whether it is acquired. Short-circuiting
means the shipped path never evaluates that comparison at all, so today's
behaviour is what it was with no check in the file: the failure mode this brief
names — *a balance change smuggled in as a wiring fix* — is closed at the
source, not argued about.

**Determinism.** The arc case is a dot product against the facing versus
`Math.sqrt` of the squared distance (IEEE-754 correctly rounded); no `atan2`, no
RNG, no clock. The shipped path evaluates neither branch.

### Evidence — `tests/sim/aim-arc.test.ts` (11 cases)

The spec has to prove two things that pull against each other.

| | |
|---|---|
| **The default did not move** | at `2π` an enemy *dead astern* is acquired and shot; a rock dead astern is still mined; and the **nearest** target still wins even when the nearest is behind you |
| **The knob turns** | the *same fixture* under a re-bound `π` picks the farther enemy in **front** over the nearer one behind; a lone enemy astern makes the shooter hold fire; rocks are gated by the same arc; the arc is centred on `ship.angle` (turning the hull re-acquires); the edge holds (80° in, 100° out); at `0` only what is exactly down the barrel is valid |

The knob is re-bound by mocking `src/sim/constants` and re-importing the sim, so
every case runs the real `step()` rather than a copy of the arc arithmetic.

**Probed red, not assumed green.** Setting the shipped default to `Math.PI`
fails four pins, including "acquires an enemy DEAD ASTERN". Reverted; not
committed.

---

## 2. `SHIP_HULL` — **retired**

**Decision: delete it.** The design moved and the knob did not follow. Hull is
**absolute per class** (§2.11 — Interceptor 35 · Vanguard 50 · Excavator 55 ·
Hauler 70), and `shipMaxHull` reads that class row and multiplies it by the §2.5
tier ladder. `SHIP_HULL = 50` was a fourth copy of one cell of `SHIP_STATS` that
nothing read: a QA agent retuning §2.8's "Ship hull" row changed nothing.

**Why not wire it instead.** The one plausible wiring exists in the file already
— `CARGO_BASE` is a *floor* under the class row in `shipCargoCap`. Applying that
shape to hull would raise the Interceptor's 35 to 50 and flatten the class the
§2.11 spread exists to distinguish. That is a balance change wearing a wiring
fix's clothes, and this brief forbids exactly that. There is no single base hull
left in the design to be the knob for.

**GDD §2.8's row is struck through** with the reason written in, following
`Sensor range`. §2.11's hull column is unchanged and remains the ratified table.
*This is a design-document amendment and is flagged for the Director in the PR.*

### Evidence — a guard, not a test

The behaviour to protect is "the constant cannot come back dead", so the guard is
the dark-matter gate, the way `n7-01` did it: **the allowlist entry goes with the
constant** (`tools/dark-matter-allowlist.json`). Re-introducing a dead
`SHIP_HULL` now fails `npm run dark-matter:check` instead of landing pre-blessed
and invisible.

Probed: re-appending `export const SHIP_HULL: Tunable<number> = 50;` exits **1**
with the "wire it up, delete it, or allowlist it" message. Reverted; not
committed.

`AUTO_AIM_ARC`'s allowlist entry is removed too. It is live now, so the entry is
stale — and leaving it would silently re-bless the constant if the wiring were
ever removed, which is the precise regression this brief exists to prevent.

The Vanguard's 50 survives where it is load-bearing: `SHIP_STATS`, pinned to the
GDD table through the sim by `src/sim/upgrades.test.ts` (which no longer claims
§2.8 states it).

---

## 3. The sweep — the rest of the table

`a0-19` found its two by reading. Nobody had swept the file, so this was done
mechanically: every `export const` / `export function` in `src/sim/constants.ts`
joined against `tools/dark-matter-scan.mjs`'s reference counts.

    node tools/dark-matter-scan.mjs --json > /tmp/dm.json
    node evidence/g6-01-dead-tunables/sweep.mjs /tmp/dm.json

Grep cannot answer this question — `a1-09` measured 19 of `singlePrimary`'s hits
as comments — so the join walks the TypeScript program from the real entry
points and "production" means *reachable* production.

**Result, on this branch: 87 exported values, 70 flagged `TUNABLE`, 15 with zero
production references.** Raw output: `evidence/g6-01-dead-tunables/sweep-branch.txt`.

Zero production references is **not** the same as dead. Ranking the 15 by who
actually reads the value:

### 3.1 Live — the module derives something live from it (9)

`CARGO_PER_TIER` · `TURRET_TIERS` · `SHOT_SPEED_STEPS` · `SHOT_SPEED_COSTS` ·
`WAVE_INTERVAL_S` · `WAVE` · `ABUNDANCE` · `abundanceMultipliers` ·
(and `MINING_RATE`, which does not even reach this list).

This is `g5-01`'s trap: a constant its own module builds a live constant out of
**is running**; only its `export` is wider than its use. Spot-verified rather
than assumed — `CARGO_PER_TIER` builds the `UPGRADES` cargo ladder
(`constants.ts:1292`), and `WAVE_INTERVAL_S` feeds `waveTime`, the abundance
table's `waveInterval`, and `COLLAPSE_GRACE_S`. Turning any of them changes the
game. **No action.**

### 3.2 Superseded derivations — stale mirrors, not knobs (5)

| Symbol | Superseded by | Note |
|---|---|---|
| `MINING_YIELD_PER_HIT` (L383) | `shipMineYield` (`upgrades.ts`) | *Unreferenced by anything at all.* `upgrades.ts` even documents it as "the Vanguard baseline this scales from" — and then scales from `shipMiningRate` instead |
| `miningRate()` (L1165) | `shipMineYield` / `shipMiningRate` | unreferenced; already noted in `docs/gdd-conformance.md` §1 |
| `WAVE_ORE` (L670) | `waveOreFor` (a0-17 abundance) | one spec reads it |
| `homeFieldOre()` (L676) | `homeFieldOreFor` (a0-17) | one spec reads it |
| `classWeaponDps` / `classCoreDps` (L1153/L1159) | `shipWeaponDps` / `shipCoreDps` (`upgrades.ts`) | specs only; the loadout-aware forms are what the sim runs |

**Reported, not acted on.** None is a knob a balance pass would reach for — they
are *computed* values and functions, so "turning" them is not a thing anyone can
do; the trap G-13/G-14 describe does not apply. They are duplicated derivations,
and the one that matters is `MINING_YIELD_PER_HIT`: it is arithmetically equal to
the live path today but reassociates the multiply
(`(rate × interval) × power/VANGUARD` vs `rate × (power/VANGUARD) × interval`),
so "just make it live" is a float-order change to ore yields and **not** a
no-op. That is a separate decision with QA's name on it, and this brief's rule is
that behaviour does not move.

### 3.3 One more genuine dead knob — `WEDGE_SLIDE_SPEED` (L1396) ⚠

**This is the sweep's real find, and it is worse than G-13.** It is flagged
`TUNABLE`, it is a hand-typed 52, and **three comments assert it governs the
wedge-escape mechanic**:

- `constants.ts:1396` — *"Speed at or below which a ship pressing into a body
  counts as pinned and earns the tangential slide"*, and the kick is *"RAMPED to
  zero as the hull's speed approaches `WEDGE_SLIDE_SPEED`"*;
- `step.ts` (the `updateWedgeEscape` doc) — *"while a ship is both pressing into a
  body and held below `WEDGE_SLIDE_SPEED` by it, `wedgeContactS` counts up"*;
- `tests/sim/wedge-escape.test.ts:285` — *"The kick only fires while the ship is
  below `WEDGE_SLIDE_SPEED`"*.

None of it is in the code. `step.ts` imports `WEDGE_SLIDE_KICK`,
`WEDGE_SLIDE_RUN_S` and `WEDGE_CONTACT_S` — never `WEDGE_SLIDE_SPEED`. The pin is
detected by **anchor displacement** (`WEDGE_ESCAPE_PROGRESS`), not by a speed
threshold, and the kick self-limits by clamping the along-slide component *up to*
`WEDGE_SLIDE_KICK` rather than ramping to zero near anything. Its single
reference is one spec's loose upper bound (`maxSpeed < WEDGE_SLIDE_SPEED * 4`),
so turning the knob moves the slack in an assertion and nothing else.

G-13's knob was silent; this one is silent **and** three places in the repo say
it is not. The mechanic itself is fine — the displacement gate works and is
tested — so what is wrong is the knob and the prose around it.

**Reported, not acted on.** Both forks change something this brief protects:
making it live puts a *speed* gate into ship physics that is not there today, and
retiring it means rewriting the wedge-escape prose in two files to describe the
displacement gate that actually runs. It wants its own brief, with the fork
decided up front — the same shape as this one, and about a day's work.

---

## What did not change

Auto-aim is 360° with no front arc. The four classes and `SHIP_STATS` are
untouched, hull values included. Nothing in §2.11 moved, and §2.8's existing
retirements are followed, not re-invented.
