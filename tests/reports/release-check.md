# Release check — v0.1 candidate (M7 / GDD §4.6)

**Branch `agent/qa/d7-balance-remeasure` · owner: QA Agent · re-measured after the
two M5 owner-actions landed on `main` (collapse decay ratified, Warden tempered).**

Every number below is produced by the headless suite and harness on this branch
and is reproducible from the commands in §F. Nothing here is typed by hand except
the readings, which are marked as such. This report supersedes the `agent/qa/d7-release`
issuance, whose two balance FAILs are the two owner-actions now resolved (§D).

---

## Top line

**All four measurable balance targets are now GREEN, and every engineering gate
holds — the balance verdict is PASS.** The two owner-actions the prior release
check filed as blockers have both landed on `main` and the re-measurement confirms
they did exactly what was predicted:

- **`COLLAPSE_CORE_DECAY` 0 → 1** ratified by Gameplay/Director
  (`498ef03`, PR #47) — collapse now has teeth.
- **Warden tempered** by the Bot Engineer (`7c9762d`, PR #52) — homebody
  1.0 → 0.55, defend triangle 0.45.

With those in, the shipped Easy/Medium/Hard cast — the thing the classroom
actually plays — now lands **match length at a median 13:40 with 100% of matches
inside 10–15 min**, **no strategy above 41.0%**, and **no ship class above 50.5%**,
all under the 55% ceiling. The collapse-teeth fix also closed the termination hole
at its root: every passive/economic probe mirror that used to hang at 20:00 now
**resolves** (idle 14:10, miner 12:31, turtle 14:10, raider 13:06 — §B.5). Build,
determinism, headless performance and the 450-match soak pass with the same margin
as before.

**Recommendation to the Director: v0.1 is balance-complete on every headless
target — tag it from this report.** One class of checks remains **outside this
headless environment entirely** and is *not* claimed here: every M1–M7 milestone
is defined as *phone-verified at the public URL* (GDD §4.6a), and this container
has no phone, no GPU, and no live deploy. §E lists exactly what still needs a
device before the milestones themselves are signed off. That is a device gate, not
a balance gate — the balance work this report owns is done and green.

---

## A · Definition of Done

| DoD item | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0) | clean typecheck, whole repo (`src`, `server`, `tests`, `harness`) |
| `npm test -- --run` | **PASS** | 82 files, 1306 tests, 0 failures (§B.0) |
| balance shows green in `release-check.md` | **PASS** | this file — top line + §B |

---

## B · The four QA measurable targets (GDD §3.8, §2.11, §4.3)

Measured against the **shipped** Easy/Medium/Hard trees (`src/bots/`), which is
what the classroom plays — not the QA probes. The probes (`harness/strategies.ts`)
remain the fixed reference instrument (§B.5).

| # | Target | Source | Measured | Verdict |
|---|---|---|---|---|
| T0 | Headless suite green | DoD | 1306/1306 pass | **PASS** |
| T0 | Determinism replay (same inputs ⇒ same hash) | GDD §4.8 | 7201/7201 ticks, hash match | **PASS** |
| T0 | 450-match headless soak, zero hangs | GDD §3.8 | 0 hangs / 450 matches | **PASS** |
| T1 | Match length lands in 10–15 min | GDD §1 | median **13:40**, **100.0%** inside | **PASS** |
| T2 | No strategy > 55% win rate | GDD §3.8 | Warden **41.0%** (Hard pool) | **PASS** |
| T3 | No ship class > 55% win rate | GDD §2.11 | Excavator **50.5%** | **PASS** |
| T4 | 60 fps performance gate (sim half) | GDD §4.3 | p95 0.068 ms vs 4.17 ms budget | **PASS** |

**All four balance targets (T1–T3, plus the class ceiling) are met.** Every gate on
this table is green.

### B.0 · Full suite

```
Test Files  82 passed (82)
     Tests  1306 passed (1306)
```

Includes `tests/determinism.test.ts` (the CI replay test), the sim contract
(`src/sim/*.test.ts`) — now with the collapse cases updated for the ratified
`COLLAPSE_CORE_DECAY = 1` (the Gameplay Engineer's file, landed in PR #47) — the
three bot trees playing whole matches inside the enforced timeout
(`src/bots/trees.test.ts`), fog-honesty, the net/server suite, and the shipped-bot
soak instrument's own tests. The suite grew from 71 files / 1163 tests (pre-M5) to
**82 files / 1306 tests** as the M5 features and their tests landed; 0 failures.

### B.1 · Determinism (GDD §4.8) — **PASS**

`npx vite-node harness/cli.ts determinism 120`

```
recorded 7201 ticks · hash 7823dd4d
replayed 7201 ticks · hash 7823dd4d
MATCH — same inputs, same final state hash
```

The replay reconstructs the world from the same seed and re-steps the recorded
inputs, so it exercises seeded construction *and* the step. The 120 s window is
pre-collapse (collapse begins ~12.5 min in), so the hash is unchanged from the
prior baseline — the decay change does not perturb the deterministic core before it
fires. Also asserted per-push by `tests/determinism.test.ts` in CI, as its own
named red line.

### B.2 · Soak / termination (GDD §3.8) — **PASS**

`npx vite-node harness/cli.ts soak 50 --rotations 4` — **450 matches** total
(50 real-cast + 200 class contest + 200 strategy contest), of the *shipped* trees.

| Batch | matches | ended | sim-timeout | **hangs** | max wall |
|---|---|---|---|---|---|
| Real offline cast | 50 | 50 | 0 | **0** | 1232 ms |
| Class contest (Sable, ×4 rot) | 200 | 200 | 0 | **0** | — |
| Strategy contest (Hard pool, ×4 rot) | 200 | 200 | 0 | **0** | — |

**Zero hangs and zero sim-timeouts across all 450 matches** — every match now
*ends*. (The prior baseline saw 5 sim-timeouts of 450: passive matches that would
not resolve inside 20 min because collapse had no teeth. With `COLLAPSE_CORE_DECAY
= 1` those resolve.) A 20-minute sim match is ~72 000 ticks and completes in ~1.5 s
of wall clock; the guard ceiling is 120 s, so the harness keeps ~80× headroom
before it would ever call a slow match a hang. That is the charter working exactly
as written: *a hung match is a failed test, not a hung harness* — and this run had
neither.

### B.3 · Match length (GDD §1) — **PASS**

Real offline cast (`fillEmptySlots`, the exact match a solo player gets), 50 seeds:

| min | p10 | median | mean | p90 | max | inside 10–15 min |
|---|---|---|---|---|---|---|
| 13:16 | 13:23 | **13:40** | 13:38 | 13:52 | 14:04 | **100.0%** |

The whole distribution now sits **inside** the band with margin — the median (13:40)
is ~1.3 min under the ceiling and the max (14:04) still clears it, where the prior
baseline had a 15:16 median with only 38.8% of matches inside. Collapse teeth let an
attacker crack a defended core on schedule instead of grinding 1–4 minutes past
target, and the tightened spread (min→max spans just 48 s) shows the ending is now
governed by the collapse clock rather than by whether a turtle can be dislodged.

### B.4 · Strategy win rate (GDD §3.8) — **PASS**

One hull (Vanguard, to neutralize shape), the three **equally-skilled** Hard
characters dealt round-robin across the eight seats, ×4 rotations = 200 matches.
Holding skill and hull fixed makes a win attributable to the triangle *strategy* a
character leans on — the thing this target is actually about (a Hard bot beating an
Easy one is not a strategy imbalance, it is what difficulty is *for*).

| Contestant | strategy lean | wins | win rate | vs fair (33%) |
|---|---|---|---|---|
| **Warden** | territorial defense, homebody 0.55 | 82/200 | **41.0%** | 1.23× |
| Sable | opportunist raider, attack 0.55 | 79/200 | 39.5% | 1.19× |
| Vulture | wreck scavenger, balanced | 39/200 | 19.5% | 0.59× |

The territorial defender no longer runs away with it: Warden falls from **71.4% to
41.0%**, now barely ahead of Sable's aggression (39.5%) and comfortably under the
55% ceiling. Both fixes contributed exactly as §D predicted — collapse teeth stop
"outlast everyone" from beating "go get them" (GDD §2.6 intent), and Warden's
tempered homebody (1.0 → 0.55) stops the bot homesteading through it. The triangle
now reads as a genuine rock-paper-scissors rather than a defender monopoly.

### B.5 · Ship class win rate (GDD §2.11) — **PASS**

One behaviour (Sable — an aggressive driver keeps the class comparison decided on
the seats every rotation), four hulls dealt round-robin across the seats, ×4
rotations = 200 matches, all decided.

| Contestant | wins | win rate | vs fair (25%) |
|---|---|---|---|
| **Excavator** | 101/200 | **50.5%** | 2.02× |
| Vanguard | 46/200 | 23.0% | 0.92× |
| Hauler | 28/200 | 14.0% | 0.56× |
| Interceptor | 25/200 | 12.5% | 0.50× |

The §2.11 class multipliers hold under the 55% ceiling — Excavator (the close
bruiser, beam 13 / hull 55) tops out at **50.5%**, down from 54.0% at the prior
baseline (collapse teeth trim the bruiser's late-game snowball), and Interceptor
melts under fire exactly as intended ("melts against turrets"). This was a *thin*
PASS before; it now clears the ceiling by 4.5 points. Still worth watching, but no
longer one tuning pass from a breach.

### B.5-ref · Probe reference instrument — collapse-teeth confirmation

`npx vite-node harness/cli.ts balance 8` — the fixed synthetic-strategy probes
(`harness/strategies.ts`), the reference stress instrument, *not* the classroom
cast. Its degenerate pure strategies are designed to sit at the extremes and are
**not** a release gate; they exist to isolate the ruleset. The reason to run it
here is the termination result the collapse fix was filed against:

| Mirror | ended (before → after) | median length |
|---|---|---|
| `idle` | 0/8 → **8/8** | 14:10 |
| `miner` | 0/8 → **8/8** | 12:31 |
| `turtle` | 0/8 → **8/8** | 14:10 |
| `raider` | 0/8 → **8/8** | 13:06 |
| `rusher` | 8/8 → 8/8 | 0:47 |

Every passive/economic mirror that used to hang at the 20:00 ceiling now
**terminates inside 10–15 min** — the collapse-teeth prediction from `balance-01.md`
(§D.1), confirmed at the ratified constant. The probe's own aggregate still shows a
`rusher` strategy at 96.9% and a sub-target match-length percentage — because the
all-out-rush probe ends a match in 47 s by design and the miner/idle probes never
fight. **That is the instrument's degenerate tail, not a shipped-cast result:** the
release gate is the shipped Easy/Medium/Hard cast (§B.3–B.5), which passes. The
probe FAIL lines are the reference extremes doing their job of bounding the ruleset.

### B.6 · Performance, sim half (GDD §4.3) — **PASS**

`npx vite-node harness/cli.ts perf 600` — sim frame-time at the design entity
counts. Budget: 4.17 ms/tick @60 fps, 8.33 ms/tick @30 fps floor.

| Scene | ships·rocks·turrets·shots·chunks | mean | p95 | 60 fps share | verdict |
|---|---|---|---|---|---|
| Half budget | 8·100·32·150·60 | 0.042 ms | 0.057 ms | 1.4% | **PASS** |
| **GDD §4.3 budget** | 8·200·32·300·120 | 0.057 ms | 0.068 ms | **1.6%** | **PASS** |
| 2× budget | 8·400·32·600·240 | 0.103 ms | 0.128 ms | 3.1% | **PASS** |

The sim uses **1.6% of the 60 fps frame budget** at the full GDD §4.3 entity
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
| **M2** | Planets, cores, turrets, shields, repair channel, build menu, alarm; win/loss + last-to-die vs do-nothing bots | `src/sim/buildings.ts`, `src/sim/match.ts` (elimination, wrecks, waves, collapse, last-to-die), `src/ui/build-wheel.ts`, `src/ui/alarm.ts`, `src/ui/planet-hp.ts`; `src/sim/match.test.ts`, `src/sim/buildings.test.ts` | ✅ code + tests green |
| **M3** | WebSocket transport + authoritative server; 2-player online in sync | `server/` (Dockerized Node: `match-server.ts`, `room.ts`, `ws.ts`), `src/net/websocket-transport.ts`, `src/net/prediction.ts`; `tests/net/online-2p.test.ts` (end-to-end, each client predicting), `tests/server/*` | ✅ code + tests green |
| **M4** | 8-slot lobby + room codes, ship-class select, player colors; Easy/Medium/Hard bots w/ personalities fill slots | `src/ui/lobby*.ts` (room codes, class select, 8-colour roster), `src/bots/easy|medium|hard.ts` + `personalities.ts` (the seven characters), `fillEmptySlots`; `src/bots/*.test.ts`, `src/ui/lobby*.test.ts` | ✅ code + tests green |
| **M5** | Full 8-slot match end-to-end; 60 fps gate; first balance pass; art/VFX/audio replace placeholders | soak (§B.2) + perf sim half (§B.6); `balance-01.md`; **collapse decay ratified (PR #47) + Warden tempered (PR #52)**; `src/art/` with passing tests | ✅ sim-side green; GPU/phone gate → §E |
| **M6** | **Match length 10–15 min**; gamepad + touch verified; onboarding polished | **§B.3 — PASS (median 13:40, 100% inside)**; touch/input tests green; onboarding tests green | ✅ **T1 passes** |
| **M7** | Full flow: main menu, settings, 8-slot match, end-of-match/Rematch; touch+keyboard; 60 fps on phone | `src/ui/lobby-flow.ts` (menu → match → rematch), `src/platform/actions.ts` (settings/fire-mode); soak proves the 8-slot match resolves | ⚠ flow present; live/phone → §E |

**Reading:** M0–M4 are fully backed by green headless evidence on `main`. **M6 —
the one milestone with a headless criterion that had been failing — now passes
headless** (match length, §B.3). M5 and M7 are backed on their headless-verifiable
parts and gated only on the device checks in §E.

---

## D · The two owner-actions the prior report filed — both RESOLVED

The prior release check (`agent/qa/d7-release`) named exactly two blockers, both
owned outside QA. Both have landed on `main`; this section records the resolution
and the re-measured effect.

### D.1 — Collapse teeth: `COLLAPSE_CORE_DECAY` 0 → 1. **RATIFIED** *(Director + Gameplay)*

Ratified by Gameplay/Director and merged in **PR #47** (`498ef03`,
"feat(collapse): COLLAPSE_CORE_DECAY = 1 — the collapse phase gets teeth"). The two
ratified `src/sim/match.test.ts` cases that pinned core HP as unchanged during
collapse were updated by the Gameplay Engineer in the same change; the full suite
is green (§B.0). Re-measured effect on this branch:

- **Termination:** every passive/economic probe mirror now ends (0/8 → 8/8;
  §B.5-ref), and the shipped-cast soak has **zero sim-timeouts** (5 → 0; §B.2).
- **Match length (T1):** median 15:16 → **13:40**, 38.8% → **100%** inside band.
- **Strategy (T2):** the turtle-dominance it fed collapsed with it (§D.2).

### D.2 — Warden's territorial strategy: tempered. **DONE** *(Bot Engineer)*

Tempered by the Bot Engineer and merged in **PR #52** (`7c9762d`, "balance(bots):
temper Warden's homebody so no Hard strategy dominates") — homebody 1.0 → **0.55**,
defend triangle **0.45**. Re-measured effect: Warden's Hard-pool win rate falls
from **71.4% → 41.0%** (§B.4), under the 55% ceiling, now within a couple points of
Sable's aggression. Both this dial and D.1's collapse teeth contributed, as the
prior report predicted ("with entropy finishing a survivor, 'outlast' would stop
beating 'attack'").

**Both owner-actions are resolved and the targets they blocked are green. No QA
blocker remains for the balance tag.**

---

## E · What this environment cannot verify (device / live / GPU)

QA's charter is to verify **every milestone on the developer's phone before it
ships** (GDD §3.8, §4.6a). This headless container has no phone, no GPU, and no
live deploy, so the following remain **outstanding for the Director to confirm on
device** and are *not* claimed above. **None of these is a balance gate** — the
balance verdict (§B) is complete and green in this environment; these are the
device/GPU checks that close the milestones themselves:

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
npx tsc --noEmit                                   # A · typecheck
npm test -- --run                                  # B.0 · full suite (82 files, 1306 tests)
npx vite-node harness/cli.ts determinism 120       # B.1 · replay, hash match
npx vite-node harness/cli.ts soak 50 --rotations 4 # B.2–B.5 · shipped-bot soak + contests
npx vite-node harness/cli.ts perf 600              # B.6 · sim performance gate
npx vite-node harness/cli.ts balance 8             # B.5-ref · the probe reference instrument
```

The soak is deterministic: the real-cast median (13:40) and every contest table
reproduce bit-for-bit across runs (seeded construction + seeded bots, no wall
clock inside the sim). *(Note: the `balance` command rewrites `balance-01.md` as a
side effect; that file is the M5 historical artifact and is left at its committed
state — the §B.5-ref numbers above are read from the command's own console output,
not from a regenerated report.)*

---

## G · The constants this was measured against

`src/sim/constants.ts` at the `main` baseline, with the one ratified change from
PR #47 (`COLLAPSE_CORE_DECAY` 0 → 1) — **not altered by this branch.** QA owns this
table for values; the collapse constant was a Director/Gameplay decision by the
constant's own doc, now ratified, and QA re-measured against it here.

| Constant | This run | GDD §2.8 baseline |
|---|---|---|
| `CORE_HP` | 100 | 100 |
| `BEAM_DPS_CORE` / `BEAM_DPS_SHIP` | 5 / 10 | 5 / 10 |
| `MINING_RATE` | 0.5 | 0.5 |
| `FIELD_YIELD` | 400 | ~400 |
| `WAVE_COUNT × WAVE_INTERVAL_S` | 5 × 150 | 5 × ~150 |
| `COLLAPSE_GRACE_S` | 150 | (derived) |
| **`COLLAPSE_CORE_DECAY`** | **1** | 0 (baseline) — **ratified nonzero, PR #47** |
| `RESPAWN_S` | 5 | 5 |

*Filed by the QA Agent on `agent/qa/d7-balance-remeasure`. The engineering gates
are green and all four measurable balance targets are met (§B); the two prior
owner-blockers are resolved (§D). The only checks not claimed are the device/GPU
milestone gates in §E, which are the Director's to confirm on the phone. On the
balance question this report exists to answer: **v0.1 is ready to tag.***
