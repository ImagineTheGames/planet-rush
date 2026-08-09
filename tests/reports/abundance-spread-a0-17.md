# a0-17 — The abundance interval spread: how wide it can get, and what wider costs

**Branch `agent/qa/a0-17-wider-abundance-intervals`. Author: QA Agent. 2026-08-09.**
**Instrument:** `harness/abundance.ts` · `npx vite-node harness/cli.ts abundance`.
**Precedent:** `docs/p11-ore-scarcity.md` (same shape of numbers, so the two read side by side).

> *"we need bigger intervals 25 seconds between rich and 15 to scarce is not a big
> change, it should be a much BIGGER time difference"* — developer, 2026-08-07

---

## The one line to read

**SCARCE now drops a wave every 3 minutes; RICH drops one every 1 minute 52.**
A SCARCE claim gives you 3:00 of empty field between refills and takes about
13:50 to resolve; a RICH one refills before you have finished the last wave and
resolves in about the same 13:50 — the *rhythm* differs by 67.5 seconds a wave,
the clock does not. That is 1.8× the old difference, and **90% of the entire
difference the 10–15 minute match-length target can physically hold.**

## The table that shipped

| | `totalOre` | `density` | `respawnInterval` | wave gap | schedule |
|---|---|---|---|---|---|
| **SCARCE** *(default)* | 0.55 | 0.75 | **1.2** *(was 1.1)* | **180 s — 3:00** | 0:00 · 3:00 · 6:00 · 9:00 · 12:00 |
| STANDARD | 1.00 | 1.00 | 1.00 | 150 s — 2:30 | 0:00 · 2:30 · 5:00 · 7:30 · 10:00 |
| **RICH** | 1.60 | 1.25 | **0.75** *(was 0.85)* | **112.5 s — 1:52** | 0:00 · 1:53 · 3:45 · 5:38 · 7:30 |

| | before (p11) | after (a0-17) |
|---|---|---|
| SCARCE ↔ RICH spread | 37.5 s | **67.5 s** (1.8×) |
| SCARCE ÷ RICH | 1.29 : 1 | **1.60 : 1** |
| SCARCE ↔ STANDARD | 15 s | **30 s** |
| RICH ↔ STANDARD | 22.5 s | **37.5 s** |

`totalOre` and `density` are **p11's ratified numbers, untouched** — a0-17 moved
the economy's *rhythm*, not its *richness* (the brief's constraint).

One other value moved, and it is named rather than buried: **`COLLAPSE_GRACE_FLOOR_S`
60 → 30.** §4 says why, and what it costs.

---

## 1 · The rail this fought, named

The brief set out three possibilities and asked which is true, with measurements.
**It is possibility 2 — a genuinely lean SCARCE runs longer than 15 minutes — and
possibility 3 cannot happen at all.** Both answers are structural, not statistical:

**Possibility 3 (the last wave silently stops mattering) is impossible by
construction.** `enterCollapseIfDue` (`src/sim/match.ts`) returns early on
`!allWavesSpawned(world)`, so the collapse phase *cannot* open before wave 5 has
landed, at any interval. Measured: **every candidate tested, out to a 4-minute
interval, delivered 5/5 waves in every run.** The mechanic never disappears.

**And that is exactly why possibility 2 is true.** Because collapse waits for the
final wave, and a match ends 100–160 s after collapse opens, an ending lands near:

```
end  ≈  4 × interval  +  tail
```

**The wave interval and the match length are the same dial.** So the 10–15 minute
target (GDD §1) — a **300-second window** — divided across the `WAVE_COUNT - 1` = **4
gaps** between five waves, caps the entire SCARCE↔RICH interval spread at about
**75 seconds**. p11 used 37.5 of it. This lands 67.5 — 90%.

The two ends bind against different measurements, and each was found, not assumed:

| bound | what binds it | the number |
|---|---|---|
| SCARCE ceiling | full-turtle field: forced collapse + `CORE_HP / COLLAPSE_CORE_DECAY` = 100 s of entropy | 192.5 s/wave keeps 15:00 |
| SCARCE ceiling *(binding)* | the collapse deadline must stay on its pre-p11 anchor (750 s) | **180 s/wave** |
| RICH floor | all-miner mirror: a fully-delivered rich field is mined out early | **112.5 s/wave** (10:11); 105 s gives 9:42 — under the floor |

The anchor is the tighter of the two SCARCE bounds, so it is the one that set the
shipped value. It is not a soft preference: `src/sim/abundance.test.ts` asserts
`collapseDeadline` is equal at every level — *"a longer SCARCE interval never
lengthens the match past target"* — and that holds exactly while
`waveTime(WAVE_COUNT, interval) + grace floor ≤ 750`.

## 2 · Ore per minute, per level

Headless bot-vs-bot, 8 seeds, all-miner mirror, full 8-slot matches — p11's §A
lineup, so the columns are comparable line for line. `ore/min` is
`world.ledger.mined` ÷ match minutes.

| level | s/wave | ore mined/min | mined total | field left | match len (med) | ended |
|---|---|---|---|---|---|---|
| **scarce** | 180.0 | **15.5** | 220 | 92 | 14:10 | 8/8 |
| standard | 150.0 | 32.4 | 400 | 112 | 12:20 | 8/8 |
| **rich** | 112.5 | **62.2** | 640 | 121 | 10:15 | 8/8 |

**SCARCE ore-per-minute is 52.3% below STANDARD** (p11 measured 48.4%), and RICH
is **92% above** (p11: 76%). **This is reported, not compensated.** The brief
forbade reaching for another dial, and nothing was: the same 220 ore now arrives
over a longer schedule, which is arithmetically the whole of the change. The
*ratified* number — p11's `totalOre` cut of 0.45, inside its 30–50% band — is
untouched, so `abundance.test.ts`'s assertion on it is green. If the developer
wants SCARCE's throughput back inside 50%, that is a `totalOre` question and a
different brief.

## 3 · Match length, per level

Three lineups. The turtle mirror is the worst case the rail must survive; the
roster cast is the real shipped bot trees, i.e. the match a player actually gets.

| level | s/wave | turtle med / max | roster med / max | all-miner med | ended | waves |
|---|---|---|---|---|---|---|
| scarce | 180.0 | 14:10 / 14:10 | 13:51 / 13:55 | 14:10 | 24/24 | 5/5 |
| standard | 150.0 | 14:10 / 14:10 | 13:55 / 14:00 | 12:20 | 24/24 | 5/5 |
| rich | 112.5 | 14:10 / 14:10 | 13:50 / 14:02 | 10:15 | 24/24 | 5/5 |

**Every level, every lineup, resolves inside 10–15 minutes. Nothing timed out.**
The turtle mirror lands on 14:10 at all three levels — the same 14:10 p11
measured, unmoved by the wider spread, because the collapse deadline is still
anchored (12:30 at every level).

Read across the middle column: **the length a player experiences barely moves
(13:50 ↔ 13:55) while the rhythm moves 67.5 seconds a wave.** That is the whole
goal of the change, and it is the reason the spread is worth having even at 67.5 s.

### Side by side with the table it replaces

Same instrument, 16 seeds, the pre-a0-17 intervals forced back on:

| | s/wave | ore/min | all-miner | turtle | roster med | waves |
|---|---|---|---|---|---|---|
| scarce *(p11)* | 165.0 | 16.6 | 13:15 | 14:10 | 13:53 | 5/5 |
| **scarce *(a0-17)*** | **180.0** | **15.6** | **14:10** | **14:10** | **13:54** | **5/5** |
| standard | 150.0 | 32.4 | 12:21 | 14:10 | 13:55 | 5/5 |
| rich *(p11)* | 127.5 | 57.2 | 11:09 | 14:10 | 13:54 | 5/5 |
| **rich *(a0-17)*** | **112.5** | **62.5** | **10:11** | **14:10** | **13:51** | **5/5** |

## 4 · The one other value that moved — `COLLAPSE_GRACE_FLOOR_S` 60 → 30

SCARCE could only reach the round 3:00 because of this. The collapse deadline
stays on its pre-p11 anchor while `4 × interval + floor ≤ 750`: a 60-second floor
caps SCARCE at 172.5 s/wave (2:52.5), a 30-second floor at **180** (3:00).

**What it spends:** 30 seconds of *guaranteed* mining after the final wave.
**Why that is cheap, stated precisely:** the floor is only ever read when the
field is **still un-mined when the deadline arrives** — a match in which nobody
has mined anything for twelve minutes. Whenever players do clear the field,
collapse opens on *exhaustion* and this number is never consulted. It also does
not change what the deadline *is* at any shipped level: 12:30 at SCARCE, STANDARD
and RICH alike, identical to p11.

Measured at 30: turtle mirror 14:10 at every level, 8/8, all five waves land, and
the full suite (244 files, 4143 tests) is green — including the re-anchor
assertion this constant governs.

## 5 · Win rates — abundance is neutral, and the excavator hole is not ours

Real bot trees. Character contest: the three Hard characters dealt round-robin
across 8 seats, one hull, every rotation. Hull contest: four hulls, one behaviour,
every rotation. 16 seeds × 7 rotations = **112 decided matches per candidate**.

| candidate | s/wave | top contestant | rate |
|---|---|---|---|
| scarce *(p11)* | 165.0 | excavator | 73.4% |
| **scarce *(a0-17)*** | 180.0 | excavator | 76.6% |
| standard *(untouched)* | 150.0 | excavator | 73.4% |
| rich *(p11)* | 127.5 | excavator | 68.8% |
| **rich *(a0-17)*** | 112.5 | excavator | 73.4% |

**Abundance is win-rate-neutral.** The spread between the widened table and the
one it replaces (73.4 → 76.6, 68.8 → 73.4) is the same size as the spread *within*
either table across levels — noise at 112 matches, not signal.

Contestant by contestant, at the shipped table (8 seeds, 56 decided per level;
fair share is 33.3% per character, 25.0% per hull):

| level | character contest | hull contest |
|---|---|---|
| scarce 180.0 | warden 45.8% · vulture 29.2% · sable 25.0% | **excavator 84.4%** · hauler 12.5% · vanguard 3.1% · interceptor 0.0% |
| standard 150.0 | sable 41.7% · warden 41.7% · vulture 16.7% | **excavator 75.0%** · vanguard 12.5% · hauler 12.5% · interceptor 0.0% |
| rich 112.5 | *(16-seed pooled: top 73.4%)* | **excavator 73.4%** |

The **character** contest is inside the ceiling at every level — 45.8% is the worst
seen, under 55% and near the 33.3% fair share. The failure is entirely the hull
contest, and it has the same shape everywhere.

**The 55% ceiling does fail, and it fails on `main` too.** The excavator wins
~73% of the hull contest at **every** level on **both** tables, including
STANDARD — whose world is byte-identical to `origin/main`, since all three of its
multipliers are 1 and its collapse deadline is unchanged. So this is a **§2.11
ship-class hole that a0-17 neither caused nor cured**, and it is not a number this
brief owns. **It needs its own brief**, and QA files it as the top open balance
item.

## 6 · What did not change

- **Fairness.** Untouched by construction — a multiplier scales the seeded
  pattern uniformly and never re-rolls it per station, so all `N` home fields hold
  exactly equal ore at every level and player count. Every fairness test is green
  with **no tolerance widened** (`src/sim/abundance.test.ts`,
  `resource-fairness.test.ts`), and `commonsMinShare` is untouched.
- **`totalOre` and `density`.** p11's ratified values, verbatim. §2 reports the
  ore-per-minute consequence instead of compensating for it.
- **Wave geometry.** Five waves shrinking 1.0 → 0.25 toward the centre. The
  closing ring is untouched, and — see §1 — it still fully closes at every level.
- **Determinism, and the a0-16 clock/spawner agreement.** Same seed + level ⇒
  byte-identical world and replay; the HUD countdown and bot perception read the
  same `waveIntervalOf` the spawner does, so the widened intervals are felt on the
  clock exactly as they are in the field.

---

## 7 · The trade the developer gets to make

**The brief proposed SCARCE 1.6 / RICH 0.6 — a 150-second spread. It is buyable,
and the price is match length.** Measured on the shipped table, same instrument:

| SCARCE s/wave | ×base | last wave | roster med / max | turtle max | ore/min | inside 10–15? |
|---|---|---|---|---|---|---|
| **180.0 (shipped)** | **1.2** | **12:00** | **13:51 / 13:55** | **14:10** | **15.5** | **yes** |
| 192.5 | 1.283 | 12:50 | 14:33 / 14:50 | 15:00 | 14.7 | on the line |
| 210.0 | 1.4 | 14:00 | 15:50 / 16:00 | 16:10 | 13.6 | **no — +1:10** |
| 240.0 *(the proposal)* | 1.6 | 16:00 | 17:41 / 17:57 | 18:10 | 12.1 | **no — +3:10** |

| RICH s/wave | ×base | last wave | all-miner med | roster med | ore/min | inside 10–15? |
|---|---|---|---|---|---|---|
| **112.5 (shipped)** | **0.75** | **7:30** | **10:15** | **13:50** | **62.2** | **yes** |
| 105.0 | 0.7 | 7:00 | 9:42 | 13:52 | 65.9 | no — 0:18 under the floor |
| 90.0 *(the proposal)* | 0.6 | 6:00 | 8:40 | 13:54 | 73.6 | no — 1:20 under |
| 75.0 | 0.5 | 5:00 | 7:45 | 13:53 | 82.6 | no — 2:15 under |
| 60.0 | 0.4 | 4:00 | 6:38 | 13:48 | 95.7 | no — 3:22 under |

**Note the asymmetry in those two tables.** Every SCARCE row past 180 moves the
*roster* median — the match a player actually plays gets longer, run for run. No
RICH row moves it at all (13:48–13:54 across the whole column, down to a
one-minute wave gap), because a real match ends on combat and the anchored
collapse deadline, not on running out of rock. Only the artificial all-mining
lobby shortens.

**The question in one sentence:** *the 150-second spread you asked for exists, and
it makes a SCARCE claim run past 18 minutes and an all-mining RICH claim finish
under 9 — is a bigger felt difference worth a match-length target of 9–19 minutes
instead of 10–15?*

Two things worth knowing before answering:

1. **Nothing breaks either way.** All five waves land at every interval tested;
   the closing ring, fairness, determinism and the clock agreement hold at 240 s
   exactly as at 180. The *only* thing a wider spread costs is time on the clock.
2. **The RICH side is the cheaper half of the buy.** Going from 0.75 to 0.6 costs
   nothing a *player* experiences — the roster cast still resolves at 13:54; it is
   the artificial all-mining mirror that drops to 8:31. If the developer wants
   more felt difference for the least real cost, **RICH 0.6 is where to spend
   it** (spread 90 s, ratio 2.0 : 1, and the quotable pair becomes *"a wave every
   three minutes"* vs *"a wave every ninety seconds"*). QA held the line at 0.75
   only because p11 quoted the all-miner mirror as rail evidence, and this report
   holds itself to the same standard.

**If the developer would rather have both the spread and the 10–15 rail**, the
lever is not this table: it is the coupling in §1. Fewer waves at SCARCE, or a
shorter post-collapse tail, would decouple the interval from the ending — both are
**structure**, not values, so both belong to the Gameplay Engineer and to a
ratification, not to a QA tuning PR.

### 7.1 · Reproducing every number here

```
npx vite-node harness/cli.ts abundance --seeds 8                       # the shipped table (§2, §3)
npx vite-node harness/cli.ts abundance --seeds 16 \
      --scarce 165,180 --rich 127.5,112.5 --standard 150               # before/after (§3, §5)
npx vite-node harness/cli.ts abundance --seeds 8 \
      --scarce 192.5,210,240 --rich 90,75                              # the wider spreads (§7)
npx vite-node harness/cli.ts abundance --seeds 8 --contests            # win rates, contestant by contestant
```

A bare `--scarce`/`--rich`/`--standard` prices whatever the shipped table
resolves to, so a bare run is "re-measure what is committed". Values ≤ 4 are read
as `respawnInterval` multipliers, larger ones as literal seconds.

**How a candidate is measured without editing the constants table.**
`world.economy.waveInterval` is the single number the spawner, the collapse
deadline, the HUD clock and bot perception all read (`waveIntervalOf`, pinned by
a0-16), and wave 1 lands at t=0 where no interval can matter — so forcing that
field immediately after `createWorld` reproduces exactly the world a table with
that multiplier would have built. It is applied inside `buildWorld`, the single
construction path a run and its replay share, so a recorded match still replays
bit-for-bit. **Validated against p11:** run at the pre-a0-17 intervals the
instrument reproduces that report's numbers exactly — 16.6 / 32.5 / 57.5 ore/min,
220 / 400 / 640 mined, turtle 14:10 at every level, 136 / 271 / 473 field left.

### 7.2 · The open item this report did not own

**Excavator ~73–90% of the hull contest, at every abundance level, on both
tables** (§5) — and 0.0% for the interceptor in every run above. That is a GDD
§2.11 class-balance failure against the 55% ceiling, it predates a0-17, and no
value in the abundance table moves it. **QA's top open balance item; it needs its
own brief.**
