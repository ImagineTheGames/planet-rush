# p11 — Ore scarcity: the abundance levels

**Branch `agent/gameplay/p11-ore-scarcity`. Author: Gameplay Engineer.**

> "There's too much ore and it respawns too quickly … more scarcity, and perhaps
> controllable before matches, but by default more scarce so combat and resource
> management is deeper." — developer, ratified p11

Ore abundance is now a **per-match knob**, `abundance: scarce | standard | rich`,
on `MatchConfig` (authored in the lobby, carried in the room ad) and on
`WorldConfig`. Each level is a named multiplier set over the three economy
tunables the developer named — resolved **once** at `createWorld` into
`world.economy` (`ResolvedEconomy`), which the sim's ore code reads instead of the
raw baseline, so one match can be SCARCE while another is RICH with no global
state. **SCARCE is the default** (`DEFAULT_ABUNDANCE`).

## The table (`src/sim/constants.ts` `ABUNDANCE`)

| level | `totalOre` | `density` | `respawnInterval` |
|---|---|---|---|
| **scarce** (default) | 0.55 | 0.75 | 1.10 |
| standard (pre-p11 baseline) | 1.00 | 1.00 | 1.00 |
| rich | 1.60 | 1.25 | 0.85 |

- **`totalOre`** scales the whole field yield (`FIELD_YIELD`, home + commons
  together) — the dominant ore-per-minute lever. SCARCE seeds **45% less ore**.
- **`density`** scales the *count* of rocks (home `homeCount`, per-wave
  `asteroidsPerWave`, each ≥ 1). Texture, not yield: fewer, individually leaner
  rocks, so "how full do I run?" is asked more often.
- **`respawnInterval`** scales the wait between asteroid waves (`WAVE_INTERVAL_S`):
  SCARCE waves land **10% further apart** (a felt wait), RICH 15% closer (a quick
  refill). Kept modest on purpose (see *cross-lane note*).

Resolved values at the default two/eight-slot arena:

| level | field yield | home rocks | rocks/wave | wave interval |
|---|---|---|---|---|
| scarce | 220 | 2 | 15 | 165 s |
| standard | 400 | 3 | 20 | 150 s |
| rich | 640 | 4 | 25 | 128 s |

## Why SCARCE feels like a real wait, not a refill

The developer named respawn *speed* specifically. Most of SCARCE's "real wait" is
carried by **lean waves** (`totalOre`), not just the longer interval: a SCARCE
wave delivers ~45% less ore, so you mine a thin wave out fast and then wait the
interval with an **empty** field — a real wait — where a STANDARD field still had
ore left when the next wave topped it up (the "refill" the developer disliked).
The interval bump (1.1×) sharpens it without lengthening the match (below).

## Measurements

Headless bot-vs-bot, 8 seeds, QA probes (`harness/strategies.ts`), full 8-slot
matches. "ore/min" is `world.ledger.mined` (rock chipped into the economy) ÷ match
minutes — the field's throughput.

### A · All-miner mirror — the economy throughput ceiling

| level | ore mined/min | mined total | field left | match len (med) | ended |
|---|---|---|---|---|---|
| **scarce** | **16.7** | 220 | 92 | 13:12 | 8/8 |
| standard | 32.3 | 400 | 112 | 12:20 | 8/8 |
| rich | 56.8 | 640 | 121 | 11:17 | 8/8 |

**SCARCE ore-per-minute is 48.4% below STANDARD** — inside the ratified 30–50%
target, deliberately near the deep end ("by default more scarce"). RICH is 76%
above. Every level resolves inside the 10–15 min target; nobody times out.

### B · Mixed round-robin (miner / turtle / rusher / raider), 32 matches/level

| level | ore mined/min | match len (med) | ended | top win-share |
|---|---|---|---|---|
| scarce | 31.9 | 3:52 | 32/32 | rusher 100% |
| standard | 38.6 | 4:01 | 32/32 | rusher 100% |
| rich | 42.6 | 4:32 | 32/32 | rusher 100% |

`rusher` wins 100% at **every** level — this is the pre-existing undefended-core
hole (`tests/reports/balance-01.md` Finding 2: the QA probes don't defend, so a
lone rusher sieges an undefended core in under a minute), **not** an abundance
regression. Abundance is **win-share-neutral**: the distribution is identical
across levels, so the ceiling holds relative to baseline. The real defender is the
shipped bot trees; re-run against them, not the probes.

### C · Turtle mirror — the p5-07b repair/turtle stall check

| level | match len (med) | longest | ended | field left |
|---|---|---|---|---|
| scarce | 14:10 | 14:10 | 8/8 | 136 |
| standard | 14:10 | 14:10 | 8/8 | 275 |
| rich | 14:10 | 14:10 | 8/8 | 468 |

The stall stays **green at every level**: a full turtle field resolves at 14:10
(< 15 min), 8/8, none times out. This is the re-anchored collapse deadline at
work (below) — SCARCE's longer waves do **not** lengthen the match. Scarcer
turtles sit on far less unspent ore (136 vs 275 vs 468), exactly the "weightier
1-ore repair" the developer wanted: with a lean field, every ore banked toward a
repair is an ore not mined.

## Balance rails that had to hold — all green

- **Match length 10–15 min / 100% terminate.** The collapse deadline is
  **re-anchored** so match length is invariant under abundance
  (`collapseDeadline`, `match.ts`): it holds at the baseline anchor
  (`waveTime(WAVE_COUNT) + COLLAPSE_GRACE_S` = 750 s) and keeps a floor of grace
  after the final wave, so a longer SCARCE interval never pushes the ending past
  target. Measured: every mirror resolves ≤ 14:10 at every level.
- **Fairness (p1-09).** A multiplier scales the *pattern* uniformly, never
  re-rolls it per player, so every home field stays identical by construction at
  every level and player count (`abundance.test.ts`, `resource-fairness.test.ts`).
- **Repair / turtle interplay (p5-07b).** Green — section C.
- **Determinism.** `world.economy` is pure data resolved from the level; same
  seed + level ⇒ byte-identical world and replay (`abundance.test.ts`). The
  determinism hash does not fingerprint `economy` (it fingerprints the asteroids
  it produces), so accounting for it never perturbs a replay.

## Cross-lane note — the wave clock

The wave-schedule *timing* (`waveTime`) is read cross-lane by the HUD wave clock
(`src/ui/wave-clock.ts`) and bot perception (`src/bots/perception.ts`) through the
**baseline** interval — they cannot yet see `world.economy.waveInterval`. So a
non-baseline `respawnInterval` (SCARCE 1.1×, RICH 0.85×) drifts those readouts
until they are taught to read the per-world interval — the same n1 wiring that
lands the lobby control (n1-05) and passes `MatchConfig.abundance` into
`createWorld`. This is why SCARCE's interval bump is kept small; the scarcity is
carried mostly by `totalOre`, which has no cross-lane coupling. The sim is
authoritative regardless.

## What lands here vs. later (per the p11 brief, item 4)

- **Here:** the `abundance` config field on `MatchConfig`/`WorldConfig`, the
  `ABUNDANCE` table + `resolveEconomy`, the per-world economy on `World`, the
  scarcity-aware waves + re-anchored collapse, and the tests.
- **Later (other lanes):** the lobby control (n1-05), and the world-build wiring
  that passes `matchAbundance(cfg)` into `createWorld` + feeds the wave clock the
  per-world interval. Until then `createWorld` defaults to `standard`, so every
  pre-p11 caller (tests, harness, foreign builders) is byte-for-byte unchanged.
