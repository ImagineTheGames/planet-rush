# Planet Rush — Design Amendments

Ratified changes to the GDD, recorded here so the GDD's affected sections are
**amended by reference** rather than silently drifting. Each entry names the
date, the ratifying quote, and the exact scope of the change. The interfaces in
`src/shared/` and the constants in `src/sim/constants.ts` are the machine-readable
half of these amendments; this file is the human-readable why.

---

## The INTERFACE VOICE — the game talks like paperwork

**Date:** 2026-08-05 · branch `agent/architect/l2-industrial-voice`
**Ratified by:** Developer (Reinaldo)
**Amends:** GDD §4.7, folded in directly (not by reference) — the section is now
titled *"Tone and voice"* and names **two registers** where it previously held one
paragraph doing two jobs. **No mechanic, number, or rule changes.**

### The ratification, verbatim

The UI design handoff proposed that the interface speak as a mining authority —
contracts, rigs, operators, seals — rather than as a game menu, and flagged it as a
lore call rather than a design one. Asked to decide:

> "doesn't sound like a question to me"

Read as: it is a given. Adopt it.

### Why it landed in the GDD before any copy moved

The GDD's tone paragraph is **pinned verbatim into every player-facing-copy prompt**
— a standing content rule learned in the Assignment-4 codex pipeline, where lexical
retrieval provably never surfaced a tone section on its own (0/4 query types), so
tone is injected by hand or not at all. A copy sweep run against a tone nobody wrote
down produces four agents' four opinions. So the tone paragraph *is* the artifact:
amend it first, and the sweep that follows has something exact to obey.

### What changed

- **§4.7 now names two registers.** Register 1, **the emotional tone** — the
  Saturday-morning paragraph, judging art/VFX/audio and the shape of a moment — is
  **unchanged**. Register 2, **the interface voice**, is new: the claim's operating
  authority addressing a contracted operator. Procedural, unglamorous, faintly
  bureaucratic; it does not sell, congratulate, or wink.
- They are not in tension, and the reconciliation is the point: the game *looks* like
  a toy and *talks* like paperwork. Where they genuinely compete, register 1 wins on
  **moments**, register 2 wins on **words**.
- The voice block is written to be **pinned** — who speaks and to whom, five things
  the voice IS, six it is NOT, a vocabulary table (in *and* out), and worked examples
  of the same string in both registers. Vague adjectives ("gritty", "industrial") are
  exactly what fails the two-agents-one-game test, so there are none.
- **One rule outranks the voice: clarity always wins over flavour.** A refusal names
  its reason in the first three words; where the flavour word and the plain word
  compete on comprehension the plain word ships; and **length is part of clarity** —
  an in-register word that ellipsizes at 11px has traded information for flavour.
- **The match/machine scope line.** The authority speaks about the claim; it does not
  speak about the machine. Boot failures, WebGL, connection status, the connect
  trace, the build badge, the playtest log, numbers and clocks stay **plain** — when
  the machine has failed there is no claim for an authority to have jurisdiction over.
- **An accessibility clause.** An in-register headline may replace a plain one *only*
  when the line beneath states the outcome plainly (`CLAIM HELD` is permitted because
  `You took the claim.` sits under it). State is never carried by flavour alone.
- **A fixed-strings list** the voice does not get to revisit: `teamName()`'s
  `FRIENDLY A` / `ENEMY B` (ratified the same day, u3-01), every §2.5 wheel label and
  upgrade track, every settings row, `RUSH!`, the §2.1 slot states, bot and ship-class
  names, and **`HOME`** — the one deliberately warm word in the interface, load-bearing
  on register 1 ("the pitch is a clock, and a home", §1).

### Execution

`docs/copy-sweep-industrial-voice.md` is the string-by-string work order for l2-02:
every player-facing string by file with its current text and proposed replacement,
an explicit not-in-scope list, the five test assertions that move, the collisions,
and eight questions for the developer. **Roughly 19 strings move** — two end-screen
headlines, three door labels, two hints, four error lines, three lobby labels, four
machine-copy door references — concentrated on the main menu, the doors, and the
lobby.

The measured surprise, and the reason the sweep is small: most player-facing copy is
**already in this register**. All four onboarding prompts, every build-wheel refusal,
the ship-class blurbs, and the pause-menu confirm line were written this way before
anybody named it. The GDD specifies most of its own UI words, and the lore pivot
(v0.7) already moved the nouns. The ratification is less a change of direction than
a decision to stop making the exception for menus.

### Still open (flagged, not fixed)

The tone paragraph is mirrored outside the GDD in two places that both claim to quote
§4.7 verbatim and are now stale: **`style-guide.md` §8** (register 1 only, and still
pre-pivot — "when a *planet* dies"; frozen, Director-only by its own last line) and
**`content/codex/pipeline/tone.md`** (pins register 1 into every codex generation, so
the next run would reproduce the old voice). Neither is in the architect's write
scope. Questions 3 and 4 of the sweep doc.

---

## REPAIR has a 15-second COOLDOWN (per station)

**Date:** 2026-07-28 · branch `agent/gameplay/p12-repair-cooldown`
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.5, the *Repair reactor* bullet — specifically the
claim that "N taps are N independent purchases … resolving in full the instant
they're bought." A tap still resolves in full, but the *next* tap on that station
is now gated.

### The ratification, verbatim

> "Planet repair should have a cooldown of 15 seconds."

### What changed

- **`REPAIR_COOLDOWN_SECONDS = 15`** (new tunable in `src/sim/constants.ts`,
  held as seconds on `MiningStation.repairGate` and dt-decremented each tick like
  every other clock — the sim table is dt-parametric, so "stored in ticks" is
  honoured as "remaining sim-time on station state").
- After a **successful** repair purchase, `placeOrder` arms the station's
  `repairGate`. While it is `> 0`, further repair orders on THAT station are
  refused with a new `OrderResult`, **`'cooling-down'`**, spending nothing. The
  gate ticks down every tick in `updateStations`, independent of docking, damage,
  or the pre-existing repair *tell* — it is a pure time lockout.
- **Per station, not per player** (encoded now for the N>1-station future): one
  cooling reactor never blocks another; an ally at a shared reactor waits on the
  same clock.
- **Distinct from `repairCooldown`** (the 7.5 s `REPAIR_TELL_HOLD` that only paces
  bots and glows the renderer and never gated a press). The new `repairGate`
  genuinely refuses `placeOrder`, so a human can no longer tap 15 HP back every
  frame — repair is now a *rationed emergency patch*.
- **Bots inherit it** through the same order path; their p5-07b repair rationing
  composes on top. Turtle survivability drops slightly, by design; a harness
  sanity test (`buildings.test.ts`) shows a repair-spamming defender is rationed to
  ~one heal per 15 s window and resolution never stalls.
- **The wedge tells the truth (p4-17):** the Build wheel reads the remaining
  seconds straight off `station.repairGate` for a live "REPAIR in 12s" countdown,
  then re-arms to "+15 HP / 1 ORE" — no UI-side timer. *(Cross-lane follow-up: the
  UI wheel model / live-stage spec wire this readout; the sim seam is shipped.)*

---

## BOOST and PING are CUT

**Date:** 2026-07-27 · branch `agent/gameplay/p7-remove-boost-ping`
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.4, the controls table rows *"Boost | Space /
Shift | Left trigger | Button above left stick"* and *"Ping minimap | Middle
click | D-pad | Tap minimap"*, and the §2.2/§2.4 touch-controls prose *"a boost
button sits above the left stick; ping is a tap on the minimap"*. Both mechanics
are removed from the game entirely; the controls table drops to six verbs.

### The ratification, verbatim

> "Let's get rid of boost and ping. Just clutters UI and isn't needed."

### What was removed

- **BOOST** — the held speed/acceleration multiplier. `BOOST_MULTIPLIER` (was
  1.6×) and its use in `integrate` are gone; the `Intent.boost` field, the
  `'boost'` case in `resolveIntent`, and the `BoostAction` type are gone. A ship's
  top speed and acceleration are now class-base × engine tier, full stop (GDD
  §2.11/§2.5) — there is no longer a transient way to exceed the class ceiling.
- **PING** — the minimap ping action. `PingAction` and the sim's no-op `'ping'`
  case are gone. The abstract `Action` union drops from eight verbs to six:
  thrust, aim, fire, build, buildOrder, upgradeOrder.

### Ripple across the agent boundary

The `Action` union is the cross-lane contract (`@shared/types`), so the cut
reaches every layer that produced or consumed those two verbs — all removed on
this branch:

- **shared:** `BoostAction` / `PingAction` deleted from the `Action` union.
- **sim:** the movement multiplier, the intent field, the ping no-op.
- **net:** the `'boost'` / `'ping'` cases in `parseActions` (`wire.ts`); the
  wire / input-queue / loopback test fixtures re-pointed at surviving verbs.
- **bots:** the `boost()` steering factory and its two call sites (chase, flee),
  plus the now-dead `BOOST_CHASE_DISTANCE`.
- **platform:** the BOOST/PING keyboard/pad/touch bindings, the `TouchButtons`
  class (BOOST-hold + PING-gesture — deleted whole), the on-screen BOOST/PING
  buttons, `ControlState.boost`/`.ping`, and the two controls-strip rows.

**No snapshot layout changed.** BOOST and PING were *input actions*, never
encoded in the `World` snapshot, so the measured 510-byte projectile/snapshot
layout and its byte-pin tests (`src/net/snapshot.ts`, `snapshot.test.ts`) are
untouched. Client actions ride the JSON client-message frame, which simply
carries two fewer optional verbs — it has no fixed byte layout to pin.

### Bots — the escape retune the cut forced

Two behaviors leaned on boost: a bold chaser boosted to close a gap, and any bot
fleeing a threat boosted away. Dropping those is mostly free — but a chasing bot
*inherited* its chase-boost during the wedge-escape run (the escape thrust rode
the same tick's `boost(true)`), and that 1.6× burst turned out to be quietly
load-bearing for the standing "no bot stays wedged" invariant
(`tests/harness/unstuck.test.ts`, PR #146): it punched a hard-pinned hull out of
a late-wave asteroid pocket in a single escape cycle. At base speed the same hull
re-rolled a fresh random escape heading every 1.5 s and never built enough
tangential slide to leave the pocket — seed 19 wedged **16.5 s**, past the 12 s
ceiling.

Fix, in the bots' own tuning (the brief's point 2): **`ESCAPE_SECONDS` 1.5 →
2.0 s**. A longer committed run lets a pinned hull slide out at cruise instead of
re-rolling into another blocked lane — the same escape boost used to buy with raw
speed. Verified worst-wedge **16.5 s → 3.5 s across seeds 1–48** (the invariant
soaks 24), an order of magnitude under the ceiling.

### Balance (harness re-run on the final code)

Removing boost and retuning the escape is **balance-neutral** — the round-robin is
unchanged from the pre-cut baseline. Boost was never a rusher's tool (it parks at
range and holds the trigger), so cutting it moves nothing in the strategy sweep.

`balance` — 6 seeds × every rotation:

| Target | Verdict |
|---|---|
| Every match reaches an ending | **PASS** (72/72) |
| No ship class > 55% | **PASS** (top `hauler` 43.8%) |
| No strategy > 55% | **FAIL** — `rusher` 100% |
| Match length 10–15 min | **FAIL** — rusher mirrors end < 1 min |

The two FAILs are **pre-existing and orthogonal to this cut** — the undefended-core
/ rusher problem the shipped balance report already names (`tests/reports/balance-01.md`,
Finding 2: *"`rusher` wins ~97%, because nobody defends… Blocked on the bot trees"*).

`soak` — 30 real-roster (shipped-cast) matches, the honest experience:

| matches | ended | hangs | match length (median) | inside 10–15 min |
|---|---|---|---|---|
| 30 | 30 | 0 | 13:51 | 100.0% |

No wedge hangs at soak scale, and match length lands squarely in target with boost
gone.

### Constants removed / changed (`src/sim/constants.ts`, `src/bots/behaviors.ts`)

- `BOOST_MULTIPLIER` — removed (was 1.6×).
- `BOOST_CHASE_DISTANCE` (bots) — removed.
- `ESCAPE_SECONDS` (bots) — 1.5 → 2.0 s (see the escape retune above).

### Tests retired (deliberately)

- `src/platform/touch-buttons.test.ts` — deleted whole; it tested only the
  BOOST/PING button class, which is gone.
- BOOST/PING assertions and fixtures trimmed from `actions.test.ts`,
  `input.test.ts`, `touch.test.ts`, `touch-visuals.test.ts`,
  `input-parity.test.ts` (platform); `wire.test.ts`, `input-queue.test.ts`,
  `loopback.test.ts` (net); the abstract-verb-set assertions in
  `src/bots/harness.test.ts` and `tests/harness/match.test.ts`; and the BOOST/PING
  parity subtests in `tests/live-stage/input-parity.spec.ts`.

---

## Repair is a DISCRETE purchase, not a channel

**Date:** 2026-07-26 · branch `agent/gameplay/p5-repair-discrete`
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.5 ("Repair core… a *channel*, not a purchase.
Your ship must sit at your planet while core HP ticks back at a slow rate,
consuming ore as it goes… Any damage to your core or shield interrupts the
channel"), and the §2.8 baseline row ("Repair core | 2 HP/s channel · 1 ore =
5 HP · interrupted by damage"). Supersedes the channel line entirely. Everything
else in §2.5 — repair is the planet's *core* only, never the ship; ship hull is
never repairable; collapse (§2.3) shuts repair off for good — is unchanged.

### The ratification, verbatim

> "Repair shows how many hit points it's going to restore… each 1 ore repairs
> 15… but it's not on a loop."

### The model

One tap = one purchase. A press of the REPAIR CORE wedge spends
`REPAIR_ORE_COST` = **1 ore** (hold-first, then bank, like every other buy) and
restores `REPAIR_HP_PER_ORE` = **15 core HP**, clamped at the core max. No
channel, no continuous drain, no stacking: **N taps = N distinct purchases**,
each individually affordable-checked. There is no per-tick repair work left in
the sim — a purchase resolves in full inside `placeOrder`.

- **Near-full edge:** if the core is missing less than 15 HP, the tap still costs
  a whole ore and heals to full — the wheel SHOWS the real number, so the player
  chooses informed (developer, p5-08). Never overshoots the cap.
- **The developer's loop bug, killed:** the channel opened by one press used to
  drain ore every tick until the core filled or the bank emptied — one click,
  repeated spend. That path (`runRepairChannel`) is gone. A tap now maps to
  exactly one ore-spend, ever.
- **The heal is never interrupted.** With no channel to drop, a hit that lands
  after a repair does not undo the HP already banked into the core. "Pressure
  beats regeneration" (§2.6) still holds — for shields via `planet.sinceDamage`,
  and for repair through the *finite ore pool* (every HP bought back is a turret,
  shield, or upgrade not bought) **and** through the AI-pacing tell below (a bot
  cannot resume repairing while its core is under fire).
- **Refusals stay loud:** full core → `core-full`; empty/short bank →
  `cannot-afford`; collapse → `collapsed`. Each spends nothing.

### The repair tell, and how it PACES bots (not humans)

`Planet.repairing` stays a boolean tell, but its meaning changes from "a channel
is open" to "a repair was just bought and is still settling." A purchase lights it
and arms `Planet.repairCooldown` (a new *optional* `Planet` field, defaulting to
`0`); `maintainRepairTell` in `updatePlanets` ticks the cooldown down and releases
the tell when it hits zero **and** the core has been quiet that long — or clears it
early on a full core, the ship leaving, or collapse.

Why held rather than pulsed: it is a **ratified cross-lane signal**. The
renderer/observer glows the healed core from it, and the **bots read `!repairing`
to decide when to buy their next repair**. Under the retired channel the flag
stayed lit for the whole heal, so a bot filed *one* repair order and waited; a
naïve one-tick pulse would instead let a bot re-buy every tick (15 HP/tick). The
cooldown restores the old cadence: `REPAIR_TELL_HOLD = REPAIR_HP_PER_ORE / 2`, so
a bot files one 15-HP purchase per hold — the channel's old **~2 HP/s** rate — and
the "quiet core" release makes pressure beat repair for AI defenders too. **A
human is never gated by the tell**: `placeOrder` ignores it, so five rapid taps
are still five purchases (per the ratification). `src/shared/` is untouched; the
new `Planet.repairCooldown` is optional and server-internal (the net layer
reconstructs `repairing` from its own event shapes and does not carry it).

### Balance note (bot economy) — the reconciliation

Discrete repair is **3× more HP-per-ore** than the channel (1 ore ⁄ 15 HP vs the
old 1 ore ⁄ 5 HP) and no longer drains ore per tick, so the finite pool now buys
more core HP, and — crucially — a tap **snaps** the core up by a whole chunk
instead of trickling at 2 HP/s. Two suites caught the fallout of that, and the
ratified `1 ore ⁄ 15 HP` number **stays**; the reconciliation is elsewhere.

**1. Collapse lockstep → ration bot repair (`trees.test.ts`).** The bots repaired
"whenever the core is below full" (Easy's gate was `maxCoreHp − 1`). Under the
slow channel a core rarely reached exactly full at collapse; under cheap discrete
repair every well-off defender snaps its core to *exactly* `maxCoreHp` and pins on
the clamp. A field of such bots then reaches collapse at one identical HP and dies
in **entropy lockstep** — no survivor to crown, the match resolved only by the
last-to-die tiebreak (seed 1: `0` and `1`, both Easy Rusty/Bolt, at 100.0 HP,
dying together at t=850 → 8 eliminated). The measured resolution rate over 24
shipped-cast seeds was **22/24** (2 mutual-extinctions), vs the channel's 24/24.

The fix is the brief's point 1: repair is now a **ration**, not a top-up
(`repairTargetFraction`, `src/bots/behaviors.ts`). It is (a) **personality-
modulated** by `caution` — timid Rusty patches early, reckless Bolt lets its core
ride — and (b) **capped strictly below the ceiling**, so a repaired core settles
*below* `maxCoreHp` at a value that varies with its own damage history. There is
no longer a single HP the funded turtles all converge on, so they enter collapse
spread out and the match resolves. Resolution is back to **24/24**, and the
mutual-extinction path stays legal for genuinely identical cores
(`match-endgame.test.ts`, the do-nothing baseline, still 8-eliminated). The
`1 ore ⁄ 15 HP` price is untouched.

**2. Centre cage → a bigger commons eye (`harness/unstuck.test.ts`).** The cheaper
economy also shifts trajectories, and on one seed a bot was drawn into the very
centre and **sealed** there by the five shrinking commons rings (66 rocks within
200 u; zero escape corridor ≥ 8 u) — wedged >100 s, tripping the standing no-wedge
invariant. This is a latent geometry trap, not a repair bug: at
`commonsHoleFraction = 0.75` the innermost wave's eye (≈58 u) is small enough that
a full ring of body-radius rocks admits no ship-wide gap. Raising the eye to
**0.85** pushes that ring out to a radius whose circumference does admit a gap, so
the centre still draws players in (GDD §2.3) but never traps them. The 50-seed
soak's worst wedge fell from ~13 s (and, pre-ration, ~103 s) to **~4 s**, back in
the honest detect-and-escape band and on par with the channel branch (~3.9 s).

The round-robin is essentially unchanged by the reconciliation — Hard-dominant
per GDD §2.9 (warden top), match length median ~828 s vs the channel's ~819 s —
so this restores the ratified balance rather than reshaping it.

### Constants (`src/sim/constants.ts`, all TUNABLE)

- `REPAIR_HP_PER_ORE` = **15** — core HP restored per purchase (was the channel's
  `REPAIR.hpPerSecond` 2 / `orePerHp` 1⁄5 → 5 HP per ore).
- `REPAIR_ORE_COST` = **1** — ore spent per purchase (the "bare 1 under REPAIR
  CORE", now the whole price of a tap rather than a channel's opening unit).
- `REPAIR_TELL_HOLD` = **`REPAIR_HP_PER_ORE / 2`** (7.5 s) — how long the
  `repairing` tell holds, pacing AI repair to the retired channel's ~2 HP/s. Does
  not gate humans.

The old `REPAIR` object (`hpPerSecond`, `orePerHp`, `interruptedByDamage`) is
removed; only `src/sim` (and its tests) imported it.

### Tests updated to the ratified model (deliberately)

- `src/sim/buildings.test.ts` — the whole "repair channel" describe block was
  rewritten to the discrete model: 1 tap → +15 / −1 ore; hold-first funding;
  clamp math; the 5-tap case (5 taps = 5 ore, +75 HP, then zero drain); refuse
  cases (full core, empty/short bank, collapse, undocked); damage-does-not-cancel;
  a shield still standing in front of the core; the tell holding for its pacing
  window and under fire, releasing when quiet, and clearing on a full core;
  determinism.
- `tests/sim/repair-channel.test.ts` — the end-to-end field-report suite, updated
  from "the order opens a held channel" to "the order is one purchase that heals
  on the order tick." The loud-refusal and wheel-model pins are unchanged.
- `tests/sim/turret-parity.test.ts` — comment only (a repair still needs a wound).

---

## v0.3 — The mining laser goes away: PROJECTILES for everything

**Date:** 2026-07-26
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.3 (core loop / "hold fire on an asteroid… the same
beam that damages ships chips asteroids"), §4.1 (collision — "Beam: a
segment-vs-circle raycast … not a projectile"). Supersedes the v0.2 scope split's
"mining stays a beam." The GDD's mining description is amended by this entry; the
§2.3 **tractor rules are unchanged and sacred** — chunks fly to a ship with hold
space and stay put when the hold is full.

### The ratification, verbatim

> "I think mining laser should go away, it should be a projectile as well… that
> way we don't have laser + projectile, just projectile."

### Addendum (v0.3.1) — the funeral is total: the VISUAL and the WORD retire

**Date:** 2026-07-26 · branch `agent/gameplay/p2-beam-funeral`

The original v0.3 entry below retired the beam *as a mechanism* but deliberately
kept `Ship.beam` alive as a cross-agent seam (a "mining indicator tell"), so the
beam VFX line and the "your beam mines it" coach copy still shipped. Evidence
round p2-07 flagged that surviving tell. This addendum finishes the retirement —
the word "beam" no longer appears anywhere in the living `src/` code:

- **`Ship.beam` is deleted.** It is replaced by a bare boolean **`Ship.firing`**
  (true on any tick the trigger is engaged, mining or fighting). There is no shot
  geometry on a ship any more — its shots are drawn from the projectile pool.
  `miningTell()` in `src/sim/step.ts` is gone.
- **The `Beam` geometry type → `Muzzle`.** It is now used only by `Turret.muzzle`
  (a turret's muzzle flash is its tell; a turret's damage still rides a
  projectile). `combat-view.ts`'s `combatBeams()`/`CombatBeam` → `muzzleFlashes()`
  /`MuzzleFlash`, now turret-only.
- **The upgrade track `UpgradeTrack.Beam='beam'` → `UpgradeTrack.Power='power'`;**
  the ship stat `SHIP_STATS[c].beam` → `.power`; `BEAM_RANGE` → `WEAPON_RANGE`;
  `BEAM_DPS_CORE/SHIP` → `WEAPON_DPS_CORE/SHIP`; `VANGUARD_BEAM` → `VANGUARD_POWER`.
  The wheel row relabels **BEAM → POWER**; the coach copy becomes "Hold {fire} on
  the asteroid — your shots chip the rock."
- **Wire: the ship `aim` field is retired.** `aim` was the beam direction on the
  wire, read only to reconstruct remote beams; with the beam gone it was a dead
  field, so it is dropped. Ship record 15 B → 13 B, worst case **510 B → 494 B**
  (`docs/netcode-spike.md` re-derived; `snapshot.test.ts` re-pinned; the spike
  measurement artifact updated to match). The `firing` **flag** stays — sourced
  from `Ship.firing` and reconstructed for remote ships by `paintRemoteFiring`.
- **Goldens re-baselined.** The frozen scene loses the ship beam line the old
  draw produced; turret muzzle flashes remain.

### What changed

- **Mining is shooting.** There is now ONE weapon system. Holding fire looses a
  pooled projectile on the weapon cadence (`SHIP_WEAPON.fireInterval`); a shot
  that strikes an **asteroid** chips ore chunks (`Projectile.mineYield`), and a
  shot that strikes an enemy **ship / turret / shield / core** deals `damage`
  (GDD §2.4). One projectile carries both payloads; whatever it reaches first
  decides which applies. Auto-fire / hold-to-FIRE now mines *and* fights with the
  same verb.
- **The beam is deleted as a mechanism.** The segment-vs-circle raycast, the
  clamp-to-hit, `mineBeam`/`raycastBeam`/`segCircle`, and the continuous
  `mineAsteroid` are gone — no ray does any mining or damage; the projectile does.
  `Ship.beam` survives only as a **mining indicator tell**: non-null on a tick a
  ship is mining a rock, `null` while it shoots an enemy — exactly the v0.2
  contract. It carries no mechanical weight, but it is the signal the netcode
  "firing" bit (`src/net/snapshot.ts`) and the renderer read across the
  agent-ownership boundary, so the sim cannot drop it without breaking ratified
  consumers it does not own. **Follow-up (cross-agent, render + netcode):** retire
  the beam VFX draw and the `Ship.beam` field once render/net stop keying the
  "firing"/mining tell off it — the sim half is done; the field is kept as the
  seam. This is why the frozen-scene goldens still show a mining beam and have not
  been re-baselined here (item 5): the draw is render-owned.
- **"You cannot shoot through things" is now free.** A rock between you and an
  enemy eats the shot (and is mined) — projectile collision covers the guarantee
  the retired clamp-to-hit test used to pin, so those beam-geometry tests retire
  with the beam (see the PR body for each retired test and its replacement).
- **One beam, one stat survives.** The per-hit chip is the ship's continuous
  mining rate over one fire interval (`shipMineYield = shipMiningRate ×
  fireInterval`), so mining speed still rides the one beam stat exactly as weapon
  damage and projectile speed do (GDD §2.5). `MINING_YIELD_PER_HIT` is the
  Vanguard baseline, derived from `MINING_RATE × SHIP_WEAPON.fireInterval`.
- **Turrets are untouched** — a turret shot still hits only enemy ships, never
  rock or structures (p1-14 coverage intact).

### Mining feel — ore per minute (harness-measured, Vanguard at the face)

| | ore/min | note |
|---|---|---|
| Old (continuous beam) | 30.0 | `shipMiningRate` × 60, by construction |
| New (projectile) | ~28.7 | flat across mining standoffs; ~96% of old — a field takes ~4% longer |

Shots land one fire interval apart (the weapon is a pipeline; shot-travel time is
a one-off latency, not a rate cap), so ore/second at the mining face is
`mineYield ⁄ fireInterval = MINING_RATE`, a hair under in a finite window by the
last in-flight shot. "About as long as it does today," as the brief asks.

### Constants added (`src/sim/constants.ts`, all TUNABLE)

- `MINING_YIELD_PER_HIT` — Vanguard ore chipped per shot on a rock, `= MINING_RATE
  × SHIP_WEAPON.fireInterval` (0.175). `shipMineYield` (`src/sim/upgrades.ts`)
  scales it by the beam stat.
- `Projectile.mineYield` — per-shot chip carried on the pooled projectile (0 on
  turret and wire-decoded shots — the server is authoritative for ore).
- `BEAM_RANGE` kept (name unchanged for the bot/net/harness consumers that size
  standoffs from it) — now documented as the auto-aim engagement radius.

### Balance (harness round-robin, seeds 1–6, 8 seats)

See the PR body for the pasted table. The switch is mining-delivery only — the
targeting logic (`acquireNearest`) is identical for rock and hull, and combat was
already a projectile (v0.2) — so the round-robin is materially unchanged: the
ship-class ceiling stays under 55%, and the pre-existing undefended-core `rusher`
result (bot-defence work, `tests/reports/balance-01.md` Finding 2) is orthogonal
to the mining model, exactly as it was under v0.2.

---

## v0.2 — Combat becomes PROJECTILES (ship-vs-ship and ship-vs-structure)

**Date:** 2026-07-26
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.3 (core loop / "one beam, one stat"), §2.6 (siege
balance), §4.1 (collision — "Beam: a segment-vs-circle raycast … not a
projectile"). The GDD's combat description is amended by this entry.

### The ratification, verbatim

> "It's too easy right now to kill each other and there's no way to dodge. If we
> switch to a projectile there's a chance to dodge and it becomes a lot funner…
> and then we can also add upgrades to make them faster, stronger."

### Scope split — what changed and what did NOT

- **Mining stays a beam.** The mining laser vs asteroids/ore is *untouched*: the
  whole mining loop, the segment-vs-circle raycast, clamp-to-hit, and the
  tractoring rules are exactly as they were (GDD §4.1). `Ship.beam` is now a pure
  **mining** tell — it is non-null only on a tick a ship is actually cutting rock.
- **Ship-vs-ship and ship-vs-structure combat is a projectile.** Firing at
  anything that is not a rock looses a pooled projectile on the weapon cadence
  (`SHIP_WEAPON.fireInterval`) instead of an instant hitscan beam. The projectile
  has a finite muzzle speed and lifetime, so **a target at combat range strafing
  at full speed can evade it** — that dodge is the entire point, and it is pinned
  by a test (`src/sim/projectiles.test.ts`, "the dodge").
- **One beam, one stat survives.** Per-shot weapon damage is still the beam stat
  (`shipWeaponDamage = shipBeamShipDps × fireInterval`), and mining rate still
  scales off the same beam, so mining speed and weapon damage move together
  exactly as GDD §2.5 requires. What changed is only that the damage is
  *delivered* by a shot that can miss, not a ray that cannot.
- **Turrets fire projectiles too.** They already did (GDD §2.6); the firing,
  flight, collision and pool were unified into `src/sim/projectiles.ts`, shared by
  both shooters. A turret shot still hits only ships (p1-14 coverage rules
  intact); a ship shot is siege-capable (ships, turrets, shields, cores). Neither
  hits an asteroid — shots fly over rock; mining is the beam's job.

### Upgrade hooks (base tier now, tiers later)

Projectile **speed** and **damage** read from the ship's upgrade state, on the
same beam ladder as mining and weapon damage — "faster, stronger" rides the beam
track (`shipProjectileSpeed`, `shipWeaponDamage` in `src/sim/upgrades.ts`). This
brief wires the plumbing at the base tier; balancing new tiers is a follow-up the
harness will measure.

### Bots lead

Combat now has travel time, so a shot aimed where a strafing enemy *is* misses.
Bots aim on an **intercept course** (`leadAim`, threaded through
`aimAt`/`canHit`/`engage`) using the target's last-seen velocity and the hull's
own muzzle speed; a still target (a turret, a core) has zero velocity and the lead
collapses to a straight shot. The per-tier `aimJitter` still rides on top, so an
Easy bot leads *badly* and a Hard bot leads well — the difficulty ladder is intact.

### Wire / snapshot

Ship weapon shots ride the same `world.projectiles` pool the turret guns always
did, so they stream through the existing 6-byte projectile record with no format
change. The worst case was **re-derived** for two shooters (≤ 32 turret shots +
≤ 16 ship shots ≈ 48, under the 64-slot budget), so the measured 510-byte layout
is deliberately unchanged (`src/net/snapshot.ts`, `MAX_PROJECTILES`). The one
addition, at zero byte cost: a **shot-kind bit** in a previously-reserved `meta`
bit, so the renderer can size/tint a ship shot apart from a turret shot
(`SHOT_META`, pinned in `snapshot.test.ts`).

### Balance (harness re-run, seeds 1–6, 8 seats)

The projectile switch **improves termination** — every mirror now reaches an
ending (was 65.6% at the pre-existing baseline), and economic/combat mirrors land
in target: `miner` 12:18, `raider` 12:22, `turtle` 14:10, `idle` 14:10.

| Contestant | decided | win rate | mirror median |
|---|---|---|---|
| `rusher` | 24 | 100.0% ⚠ | 0:35 |
| `miner` | 24 | 0.0% | 12:18 |
| `raider` | 24 | 0.0% | 12:22 |
| `turtle` | 24 | 0.0% | 14:10 |

| Target | Verdict |
|---|---|
| Termination — every match ends | **PASS** (improved from FAIL) |
| No ship class > 55% | **PASS** (top `hauler` 43.8%) |
| No strategy > 55% | **FAIL** — `rusher` 100% |
| Match length 10–15 min | **FAIL** — rusher mirrors end < 1 min |

The two remaining failures are **pre-existing and orthogonal to the combat model**:
they are the undefended-core problem the shipped balance report already names
(`tests/reports/balance-01.md`, Finding 2: "`rusher` wins ~97%, because nobody
defends… **Blocked on the bot trees**"). The strategy sweep pits QA probes that do
exactly one thing against each other, and the shipped difficulty tiers still run
the do-nothing baseline, so a pure rusher sieging a core nobody defends still
wins — a shot at a *stationary* core does not benefit from the dodge. Fixing it is
bot-defence work, not a combat-model or constants change. The switch did not
collapse the round-robin further (rusher was already ~100%; ship-class balance
still passes), and it made the dodge real, which is what it set out to do.

### Constants added (`src/sim/constants.ts`, all TUNABLE)

- `SHIP_WEAPON` — `fireInterval` 0.35 s, base `projectileSpeed` 520 u/s, `range`
  300 u, `radius` 5.
- `PROJECTILE_CORE_FACTOR` — the 5:10 core:ship ratio a shot on a shield/core
  takes, so §2.8 balance is unchanged by the delivery mechanism.
