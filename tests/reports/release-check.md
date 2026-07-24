# Release check — v0.1 candidate (M7 / GDD §4.6)

**Branch `agent/qa/d7-release` · owner: QA Agent · measured at the shipped
`main` baseline (`src/sim/constants.ts` unchanged).**

Every number below is produced by the headless suite and harness on this branch
and is reproducible from the commands in §F. Nothing here is typed by hand except
the readings, which are marked as such.

---

## Top line

**The engineering gates are green; the balance targets are not met at the shipped
baseline.** Build, determinism, headless performance and the 50-match soak all
pass with margin — the game compiles, replays bit-for-bit, runs the sim at ~1.5%
of the 60 fps budget, and never once hung across 450 headless matches. But two of
the four measurable balance targets fail, and **both failures trace to holes with
a named owner other than QA** — the same two the M5 report (`balance-01.md`)
raised, now confirmed against the *shipped* Easy/Medium/Hard trees rather than the
QA probes:

1. **Match length runs long** (median **15:16**, target 10–15 min) and a field of
   non-aggressive bots never resolves at all — because the collapse phase has no
   teeth (`COLLAPSE_CORE_DECAY = 0`). Raising it is a **Director + Gameplay**
   decision: the constant's own doc calls a nonzero value "a design decision, not
   a tuning one," and it breaks two ratified `src/sim/match.test.ts` cases QA does
   not own (verified this branch — see §D). QA cannot ship it unilaterally.
2. **One strategy dominates** (Warden **71.4%** among equally-skilled Hard bots) —
   a **Bot Engineer** personality-weights question, amplified by the same collapse
   hole (a turtle that survives to collapse is never finished).

**Recommendation to the Director:** do not tag v0.1 as *balance-complete*. Either
(a) ratify `COLLAPSE_CORE_DECAY = 1` (+ update the two sim tests) and have the Bot
Engineer temper Warden's territorial weights, after which QA re-measures and
re-issues this report; or (b) tag v0.1 for the classroom with §D's two items as
documented known-issues. That call is the Director's; the evidence is here.

One gate is **outside this headless environment entirely** and remains
outstanding: every M1–M7 milestone is defined as *phone-verified at the public
URL* (GDD §4.6a), and this container has no phone, no GPU, and no live deploy. §E
lists exactly what still needs a device.

---

## A · Definition of Done

| DoD item | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0) | clean typecheck, whole repo (`src`, `server`, `tests`, `harness`) |
| `npm test -- --run` | **PASS** | 72 files, 1173 tests, 0 failures (§B.0) |
| `tests/reports/release-check.md` | **PASS** | this file |

---

## B · The four QA measurable targets (GDD §3.8, §2.11, §4.3)

Measured against the **shipped** Easy/Medium/Hard trees (`src/bots/`), which is
what the classroom plays — not the QA probes. The probes (`harness/strategies.ts`)
remain the fixed reference instrument (§B.5).

| # | Target | Source | Measured | Verdict |
|---|---|---|---|---|
| T0 | Headless suite green | DoD | 1173/1173 pass | **PASS** |
| T0 | Determinism replay (same inputs ⇒ same hash) | GDD §4.8 | 7201/7201 ticks, hash match | **PASS** |
| T0 | 50-match headless soak, zero hangs | GDD §3.8 | 0 hangs / 450 matches | **PASS** |
| T1 | Match length lands in 10–15 min | GDD §1 | median **15:16**, 38.8% inside | **FAIL** |
| T2 | No strategy > 55% win rate | GDD §3.8 | Warden **71.4%** (Hard pool) | **FAIL** |
| T3 | No ship class > 55% win rate | GDD §2.11 | Excavator **54.0%** | **PASS** (thin) |
| T4 | 60 fps performance gate (sim half) | GDD §4.3 | p95 0.064 ms vs 4.17 ms budget | **PASS** |

### B.0 · Full suite

```
Test Files  72 passed (72)
     Tests  1173 passed (1173)
```

Includes `tests/determinism.test.ts` (the CI replay test), the sim contract
(`src/sim/*.test.ts`), the three bot trees playing whole matches inside the
enforced timeout (`src/bots/trees.test.ts`), fog-honesty, the net/server suite,
and this branch's new `tests/harness/soak.test.ts` (the shipped-bot instrument's
own tests). +1 file / +10 tests over the pre-branch baseline (71 files / 1163).

### B.1 · Determinism (GDD §4.8) — **PASS**

`npx vite-node harness/cli.ts determinism 120`

```
recorded 7201 ticks · hash 7823dd4d
replayed 7201 ticks · hash 7823dd4d
MATCH — same inputs, same final state hash
```

The replay reconstructs the world from the same seed and re-steps the recorded
inputs, so it exercises seeded construction *and* the step. Also asserted per-push
by `tests/determinism.test.ts` in CI, as its own named red line.

### B.2 · Soak / termination (GDD §3.8) — **PASS**

`npx vite-node harness/cli.ts soak 50 --rotations 4` — **450 matches** total
(50 real-cast + 200 class contest + 200 strategy contest), of the *shipped* trees.

| Batch | matches | ended | sim-timeout | **hangs** | max wall |
|---|---|---|---|---|---|
| Real offline cast | 50 | 49 | 1 | **0** | 1486 ms |
| Class contest (Sable, ×4 rot) | 200 | 200 | 0 | **0** | — |
| Strategy contest (Hard pool, ×4 rot) | 200 | 196 | 4 | **0** | — |

**Zero hangs across all 450 matches** — no wall-clock and no stall failure ever
fired. A `sim-timeout` (5 of 450) is a *match* that would not end inside 20 min,
reported as a finding (T1), never a hung harness. A 20-minute sim match is ~72 000
ticks and completes in ~1.5 s of wall clock; the guard ceiling is 120 s, so the
harness has ~80× headroom before it would ever call a slow match a hang. That is
the charter working exactly as written: *a hung match is a failed test, not a hung
harness.*

### B.3 · Match length (GDD §1) — **FAIL**

Real offline cast (`fillEmptySlots`, the exact match a solo player gets), 50 seeds:

| min | p10 | median | mean | p90 | max | inside 10–15 min |
|---|---|---|---|---|---|---|
| 13:29 | 14:08 | **15:16** | 15:40 | 17:10 | 19:27 | **38.8%** |

The whole distribution sits at the top of the band and spills over it: even the
10th percentile (14:08) is near the ceiling, and the median clears it. Matches end
*late* rather than never — they resolve once the collapse phase (which begins ~12.5
min in) finally lets an attacker crack a defended core. But because collapse
removes regen/repair/ore and does **not** itself take a core down
(`COLLAPSE_CORE_DECAY = 0`), a cautious defender drags the ending 1–4 minutes past
target. This is not tunable by any value QA owns without re-breaking something
else (nerfing the beam to shorten sieges stops undefended cores dying too); the
lever is collapse teeth, and that lever is §D.1.

### B.4 · Strategy win rate (GDD §3.8) — **FAIL**

One hull (Vanguard, to neutralize shape), the three **equally-skilled** Hard
characters dealt round-robin across the eight seats, ×4 rotations = 200 matches.
Holding skill and hull fixed makes a win attributable to the triangle *strategy* a
character leans on — the thing this target is actually about (a Hard bot beating an
Easy one is not a strategy imbalance, it is what difficulty is *for*).

| Contestant | strategy lean | wins | win rate | vs fair (33%) |
|---|---|---|---|---|
| **Warden** | territorial defense, homebody 1.0 | 140/196 | **71.4%** ⚠ | 2.14× |
| Sable | opportunist raider, attack 0.55 | 55/196 | 28.1% | 0.84× |
| Vulture | wreck scavenger, balanced | 1/196 | 0.5% | 0.02× |

The territorial-defender strategy runs away with it. Two things feed this, and
neither is a constant QA owns: **(a)** Warden's personality weights (defend 0.45 /
homebody 1.0) — a Bot Engineer dial (§D.2); and **(b)** the collapse hole again —
with no entropy to finish a survivor, "outlast everyone" beats "go get them," which
is the *opposite* of the GDD §2.6 intent ("a turtle spends ore to stand still …
when the field runs dry and collapse begins, the stockpile … is gone"). Collapse
teeth (§D.1) would punish the turtle the design says it should.

### B.5 · Ship class win rate (GDD §2.11) — **PASS** (thin)

One behaviour (Sable — an aggressive driver is required, because a non-aggressive
field never decides a winner at this baseline, see §D.1), four hulls dealt
round-robin across the seats, ×4 rotations = 200 matches, all decided.

| Contestant | wins | win rate | vs fair (25%) |
|---|---|---|---|
| **Excavator** | 108/200 | **54.0%** | 2.16× |
| Vanguard | 46/200 | 23.0% | 0.92× |
| Interceptor | 24/200 | 12.0% | 0.48× |
| Hauler | 22/200 | 11.0% | 0.44× |

The §2.11 class multipliers hold **just** under the 55% ceiling — Excavator (the
close bruiser, beam 13 / hull 55) tops out at 54.0%, and Interceptor melts under
fire exactly as intended ("melts against turrets"). This is a real PASS but a thin
one, and it is measured *under aggression*; the class table is not the balance
problem, but Excavator is one good tuning pass away from breaching the ceiling and
is worth watching once collapse teeth change the incentive to fight.

### B.6 · Performance, sim half (GDD §4.3) — **PASS**

`npx vite-node harness/cli.ts perf 600` — sim frame-time at the design entity
counts. Budget: 4.17 ms/tick @60 fps, 8.33 ms/tick @30 fps floor.

| Scene | ships·rocks·turrets·shots·chunks | mean | p95 | 60 fps share | verdict |
|---|---|---|---|---|---|
| Half budget | 8·100·32·150·60 | 0.040 ms | 0.054 ms | 1.3% | **PASS** |
| **GDD §4.3 budget** | 8·200·32·300·120 | 0.055 ms | 0.064 ms | **1.5%** | **PASS** |
| 2× budget | 8·400·32·600·240 | 0.090 ms | 0.107 ms | 2.6% | **PASS** |

The sim uses **1.5% of the 60 fps frame budget** at the full GDD §4.3 entity
counts, and stays under budget at *double* those counts — pooling, the spatial
hash, and zero per-frame allocation are doing their job. **Caveat:** this is the
*sim* half only. The **renderer/GPU half** (PixiJS at these counts, and the
mobile 60 fps / 30 fps-floor gate on the developer's phone) needs a real GPU and a
device; it runs under `PERF_GATE=1` in `tests/perf/` and on the phone, neither of
which exists in this headless container. See §E.

---

## C · GDD §4.6 milestone criteria

Each milestone's player-facing check, with the evidence that exists on `main`.
**Every milestone is defined as phone-verified at the public URL (GDD §4.6a);**
that gate is device-only and is tracked separately in §E — the column below is the
*headless/CI* evidence, which is necessary but not, by the GDD's own definition,
sufficient to close a milestone.

| M | Player-facing check (GDD §4.6) | Headless / CI evidence on `main` | Headless status |
|---|---|---|---|
| **M0** | Concept + tone frozen; repo, CI, deploys, netcode spike | `style-guide.md` frozen; `.github/workflows`; `src/net/spike/spike.bench.test.ts` (snapshot size + tick rate measured) | ✅ present |
| **M1** | Ship flies/shoots/mines; two-number ore HUD; onboarding prompts; touch twin-sticks + fire-mode; gamepad | `src/sim/step.ts` (physics + shared beam + ore), `src/ui/ore-hud.ts`, `src/ui/onboarding.ts`, `src/platform/touch.ts` + `touch-dom.ts`, `src/platform/input.ts` (gamepad), `src/platform/actions.ts` (fire mode) — all with passing tests | ✅ code + tests green |
| **M2** | Planets, cores, turrets, shields, repair channel, build menu, alarm; win/loss + last-to-die vs do-nothing bots | `src/sim/buildings.ts`, `src/sim/match.ts` (elimination, wrecks, waves, collapse, last-to-die), `src/ui/build-wheel.ts`, `src/ui/alarm.ts`, `src/ui/planet-hp.ts`; `src/sim/match.test.ts` (19), `src/sim/buildings.test.ts` (37) | ✅ code + tests green |
| **M3** | WebSocket transport + authoritative server; 2-player online in sync | `server/` (Dockerized Node: `match-server.ts`, `room.ts`, `ws.ts`), `src/net/websocket-transport.ts`, `src/net/prediction.ts`; `tests/net/online-2p.test.ts` (end-to-end, each client predicting), `tests/server/*` | ✅ code + tests green |
| **M4** | 8-slot lobby + room codes, ship-class select, player colors; Easy/Medium/Hard bots w/ personalities fill slots | `src/ui/lobby*.ts` (room codes, class select, 8-colour roster), `src/bots/easy|medium|hard.ts` + `personalities.ts` (the seven characters), `fillEmptySlots`; `src/bots/*.test.ts`, `src/ui/lobby*.test.ts` | ✅ code + tests green |
| **M5** | Full 8-slot match end-to-end; 60 fps gate; first balance pass; art/VFX/audio replace placeholders | soak (§B.2) + perf sim half (§B.6); `balance-01.md`; `src/art/` (ships, planets, atlas), `src/art/vfx/`, `src/art/audio/` with passing tests | ⚠ sim-side ✅; GPU/phone gate → §E |
| **M6** | **Match length 10–15 min**; gamepad + touch verified; onboarding polished | **§B.3 — FAIL (median 15:16)**; touch/input tests green; onboarding tests green | ❌ **T1 fails (§D.1)** |
| **M7** | Full flow: main menu, settings, 8-slot match, end-of-match/Rematch; touch+keyboard; 60 fps on phone | `src/ui/lobby-flow.ts` (menu → match → rematch), `src/platform/actions.ts` (settings/fire-mode); soak proves the 8-slot match resolves | ⚠ flow present; live/phone → §E |

**Reading:** M0–M4 are fully backed by green headless evidence on `main`. M5 and
M7 are backed on their headless-verifiable parts and gated on device checks (§E).
**M6 is the one milestone with a headless criterion that fails** — match length —
and it is the crux of this report (§D.1).

---

## D · Blockers for the Director (neither is a value QA can ship)

### D.1 — Collapse has no teeth. `COLLAPSE_CORE_DECAY` 0 → 1. *(Director + Gameplay)*

The single change that unblocks both T1 (match length) and, in large part, T2
(the turtle-dominance strategy result). First raised in `balance-01.md` at M5
against the probes; **re-confirmed this branch against the shipped bots.**

- **Effect measured (M5, probes):** at `= 1` every passive/economic mirror
  terminates and lands *inside* 10–15 min (idle 14.2, miner 12.5, turtle 14.2,
  raider 13.1).
- **Why QA cannot ship it:** verified on this branch — setting `= 1` breaks **2
  ratified cases in `src/sim/match.test.ts`** (collapse "stops shield regeneration"
  / the repair-interrupt endgame both assert core HP is *unchanged* during
  collapse; with decay the core reads 45 where the test pins 50). That file is the
  Gameplay Engineer's, not QA's. And the constant's own doc reserves a nonzero
  value as "a design decision, not a tuning one" — a Director call by construction.
- **Ask:** ratify `COLLAPSE_CORE_DECAY = 1`, update the two sim tests; QA
  re-baselines this report and B.3/B.4 the day it lands.

### D.2 — Warden's territorial strategy dominates (71.4%). *(Bot Engineer)*

Among equally-skilled Hard bots on an identical hull, the territorial-defender
strategy wins better than 2× its fair share (§B.4). The dominant dial is Warden's
personality weights (`src/bots/personalities.ts`: defend 0.45 / homebody 1.0) —
the Bot Engineer's file, which QA measures but does not own. Note this is partly
downstream of D.1: with entropy finishing a survivor, "outlast" would stop beating
"attack," which is the GDD §2.6 intent. **Ask:** re-run §B.4 after D.1 lands; if
Warden still clears 55%, temper its defend/homebody weights.

---

## E · What this environment cannot verify (device / live / GPU)

QA's charter is to verify **every milestone on the developer's phone before it
ships** (GDD §3.8, §4.6a). This headless container has no phone, no GPU, and no
live deploy, so the following remain **outstanding for the Director to confirm on
device** and are *not* claimed above:

- **Phone verification** of every M1–M7 player-facing check (twin-stick touch,
  hold-to-FIRE, install-to-home-screen, safe-area layout, orientation).
- **Live-at-URL** play (GitHub Pages client + deployed match server) and the
  ntfy-ping-on-tag flow (`milestones.json` → deploy workflow).
- **Renderer / GPU 60 fps gate** — PixiJS at the §4.3 entity counts on integrated
  graphics *and* the phone, with the 30 fps floor and auto-reduce-VFX. Only the
  **sim** half is proven headless (§B.6); the GPU half runs under `PERF_GATE=1` in
  `tests/perf/` on real hardware.
- **Online-in-the-room** feel (prediction/reconciliation under real latency) beyond
  the deterministic loopback + local-server tests that pass headless.

`milestones.json` still marks M2–M7 `"done": false`; that field is the
phone-verification tracker (Platform/Director owned), and the checks above are why
it should stay accurate until each milestone is signed off on the device.

---

## F · Reproduction

Every number in this report comes from one of:

```
npx tsc --noEmit                                  # A · typecheck
npm test -- --run                                 # B.0 · full suite (72 files, 1173 tests)
npx vite-node harness/cli.ts determinism 120      # B.1 · replay, hash match
npx vite-node harness/cli.ts soak 50 --rotations 4 # B.2–B.5 · shipped-bot soak + contests
npx vite-node harness/cli.ts perf 600             # B.6 · sim performance gate
npx vite-node harness/cli.ts balance 8            # B.5 ref · the probe reference instrument
```

The soak is deterministic: the real-cast median (15:16) and every contest table
reproduce bit-for-bit across runs (seeded construction + seeded bots, no wall
clock inside the sim).

---

## G · The constants this was measured against

`src/sim/constants.ts` at the shipped `main` baseline — **unchanged by this
branch.** The one change QA recommends (D.1) is filed for the Director, not
applied, for the reasons in §D.1.

| Constant | This run | GDD §2.8 baseline |
|---|---|---|
| `CORE_HP` | 100 | 100 |
| `BEAM_DPS_CORE` / `BEAM_DPS_SHIP` | 5 / 10 | 5 / 10 |
| `MINING_RATE` | 0.5 | 0.5 |
| `FIELD_YIELD` | 400 | ~400 |
| `WAVE_COUNT × WAVE_INTERVAL_S` | 5 × 150 | 5 × ~150 |
| `COLLAPSE_GRACE_S` | 150 | (derived) |
| **`COLLAPSE_CORE_DECAY`** | **0** | **0 (baseline)** — see §D.1 |
| `RESPAWN_S` | 5 | 5 |

*Filed by the QA Agent on `agent/qa/d7-release`. The engineering gates are green;
the balance verdict and its two owner-actions (§D) are the Director's to resolve
before — or alongside — the v0.1 tag.*
