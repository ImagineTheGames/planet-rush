# Planet Rush
## Game Design Document — v0.7

**Course:** Multi-Agent AI for Game Development — Assignment #01
**Author:** Reinaldo Vieira
**Date:** July 23, 2026 (v0.6 consolidation: July 27, 2026)
**Status:** Draft v0.6 — revised after a six-agent design review board (see `gdd-review-kit/`), a technical review, and a full art-direction pass. Circulated for feedback. v0.5 converts the schedule from calendar days to milestones — the build is gated by playable increments, not time. **v0.6 folds every ratified build-time amendment back into this document's own sections** so the GDD is current, not drifting: projectile-only combat, discrete repair, atmosphere deposits, the two modes with the slot model, the four maps with lootable derelicts, turret tiers and lead, the boost/ping cut, the damage-ring grammar, the input-parity principle, and the ore-conservation guarantee. Each folded section carries an *(amended)* marker; `docs/design-amendments.md` stays as the ratification history and the human-readable "why." **v0.7 executes the ratified lore pivot — the eight "planets" are re-fictioned as deliberately-sited MINING STATIONS on a contested mining claim (see §0, the fiction glossary). It is a lift-and-shift: only the fiction and player-facing copy move, not a single mechanic, number, or rule; the game's TITLE keeps "Planet Rush" (brand); internal code identifiers are renamed to MiningStation (ratified 2026-07-27, superseding the earlier keep-planet line — see l1-03). The player-facing string swaps are enumerated in `docs/lore-copy-sweep.md` for the UI agent to execute, and the lore changelog is at the foot of this document.**

---

## 0. Fiction glossary — the mining-station lore *(new 2026-07-27 — the lore pivot; see the lore changelog at the foot and `docs/lore-copy-sweep.md`)*

> **The pivot in one line.** The arena is no longer "planets that happen to be equally spaced" — it is a contested **mining claim**, and the eight homes are deliberately-sited **mining facilities**. Equal spacing is now retro-justified (surveyed claim plots on a shared field), and *nothing mechanical changes* — this is a lift-and-shift of fiction only. **Internal code identifiers and the game's title keep `planet`;** only the fiction and player-facing copy move. This glossary is the term contract; `docs/lore-copy-sweep.md` is the player-facing execution list.

| Old fiction | New fiction | Mechanic / code (UNCHANGED) |
|---|---|---|
| planet (home) | **station** *(working placeholder — see below)* | `planet` in code, planet slots, cap tables |
| planet core / core | **reactor** (the station reactor) | constant `Core HP`, `core` in code, ring HP |
| atmosphere (bank radius) | the **collection field** | deposit radius (~4× radius) & 2 ore/s rate |
| repair core (ore tap) | **reactor patch** / industrial resupply | discrete 1-ore → 15-HP repair, no channel |
| turrets, shields | **installed defenses** | turret Mk I–III & shield mechanics |
| derelict | an **abandoned rig** (a derelict) | derelict/loot mechanics on compass & diamond |
| wreck | a **station wreck** / gutted rig | wreck-as-loot, ore-laden debris |
| asteroid field / arena | the contested **claim** | field geometry, rotational fairness |
| asteroid waves | **ore surges** of the collapsing belt | 5-wave metronome, spawn-toward-centre |
| collapse phase | the **claim closing in** — "the Crush" | shield/repair/ore shutoff at collapse |
| beacon ring | the claim **beacon** | ownership-ring mechanic |

**The antagonist, named.** The claim sits in a decaying asteroid belt that is eating itself: each **ore surge** (one asteroid wave) is flung inward, closer to the centre than the last, and when the belt is spent the claim's boundary contracts — the **collapse phase**, in fiction **"the Crush."** The Crush is the one coherent antagonist the waves *and* the collapse share — not a creature but a closing vice, which is why it maps cleanly onto the existing wave-metronome and collapse mechanics without inventing an enemy or a new system. (Art & Audio may *dress* the Crush as belt-fauna drawn to the noise of active mining — that is a VFX/SFX skin over the same mechanic, not a new one.)

**The working placeholder.** Until the developer ratifies the in-fiction noun for a home (from the PR body: **FACILITY / RIG / STATION / OUTPOST**, each with its one-line case), this document and `docs/lore-copy-sweep.md` use **FACILITY** as the working term. When one is picked, swap the fiction noun per the table above — code identifiers do not move.

---

## 1. Executive Summary

**Planet Rush** is a top-down 2D space arena game for 2–8 players online — in **Free-for-All or Teams** (amended, §2.1) — where every player pilots a single ship and owns a single home mining **station**. AI bots fill open slots. Matches last 10–15 minutes and end when only one station (in Teams, one side) is left standing.

The pitch is a clock, and a home. Your mining gun is also your weapon — a **dodgeable projectile** that chips rock and bites hulls with the same shot (amended, §2.3) — so every minute spent chipping ore out of the shared asteroid field is a minute you are not defending your station or attacking someone else's — one ship, three jobs, never enough time. And the stakes are homes: ships are cheap and respawn free, but facilities are not. When a station dies, its wreck stays on the map for the rest of the match, and its ore-laden debris becomes contested loot anyone can scavenge.

Matches are guaranteed to end: the asteroid field's total yield is finite, arriving in waves that spawn progressively closer to the map center, and when the last wave is exhausted the match enters its collapse phase — the claim closes in, shields stop regenerating, repair shuts off, and the contracting claim finishes whoever the players don't.

The game ships milestone by milestone, each one playable, built by a team of specialized Claude agents, with all art and audio agent-produced. It runs in desktop and mobile browsers (TypeScript + PixiJS/WebGL, PWA-installable), plays online over WebSockets, and plays offline against bots. Keyboard/mouse, gamepad, and touch are all supported.

**Genre:** Top-down arena shooter with a build-and-defend economy.
**Players:** 2–8 facilities per match, **Free-for-All or Teams** (amended, §2.1); a solo human plays against Easy/Medium/Hard bots that fill the open slots; fully playable solo and offline.
**Session length:** 10–15 minutes, enforced by the finite ore field and collapse phase.
**Platform:** Web browser, desktop and mobile, played at a URL — installable to the home screen as a PWA. Online and offline.
**Win condition:** Own the last surviving station **reactor** — in Teams, be the last side with a reactor standing. If the final reactors die in the same instant, the reactor (in Teams, the side) that reached zero last in the simulation's resolution order wins — whoever dies last, wins.
**Loss condition:** Your station reactor's HP reaches zero (in Teams, your whole side is eliminated when its last reactor dies).

---

## 2. Game Mechanics

### 2.1 Match setup *(amended 2026-07-27 — modes, slot model, variable size, four maps; amended 2026-08-05 — sides read FRIENDLY / ENEMY + letter; see `docs/design-amendments.md` and `docs/variable-slots-plan.md`)*

**Two modes and a slot model (amended).** A match runs in one of two modes, chosen in the lobby: **Free-for-All** (every station is its own side) or **Teams** (facilities grouped by side, alliances made explicit). Under the hood these are one model — FFA is simply "teams-of-one," so the whole simulation asks "are these two enemies?" through a single predicate and Teams changes a table, not a code path. The lobby shows **8 physical slots**, each set to **open** (a competitive human seat), **bot** (AI-filled), or **closed** (excluded from the match entirely — no ship, no station, no color). The match size **N is the count of non-closed slots, 2–8**: closing slots is how a host runs a 3-station duel or a 2v2. In Teams the host assigns each slot a side; team sizes may be uneven (a 3v1 handicap or co-op-vs-bots is allowed — the lobby shows the split, never blocks it), and **friendly fire is off** (allies' shots pass through each other, and turrets and auto-aim ignore allies).

**N facilities are placed around a central asteroid field**, sized to the non-closed slot count. Each player spawns in a ship orbiting their home station with a small stock of **starting ore** (enough to make one meaningful opening choice: an early turret, a head start on upgrades, or banked safety) and **10 seconds of spawn protection** on ship and reactor, so no rush can end a match before anyone has flown. A match countdown ("RUSH!") starts the game. Open slots that no human takes are filled by AI bots; before the match, the host picks each bot's difficulty (and, in Teams, its side). In the lobby, every player also picks a **ship class** (section 2.11) and gets a unique **player color** from the 8-color roster — the color marks their ship trim, weapon fire, shield tint, station beacon ring, and HP bar. In Teams, per-player identity colors are kept and the side is shown as an added indicator (nameplate underline / shared beacon-ring motif), so a single ship stays individually legible on a chaotic screen.

**How a side is named: `WORD + LETTER`, the word relative to you (amended 2026-08-05).** A side is never called "Team A" to a player's face. It reads **`FRIENDLY A`**, **`ENEMY B`**, **`ENEMY C`**, **`ENEMY D`** — the same vocabulary on the lobby roster and over every hull in the match, from one formatter, so the two screens can never disagree. The two halves behave differently, and the difference is the design:

- **The letter is absolute.** Team 1 is `B` to everyone, always. It is the side's identity, it does not depend on who is looking, and it is what keeps three and four sides apart — two enemies are never both just "the enemy."
- **The word is relative to the viewer.** The same side reads `FRIENDLY` to its own members and `ENEMY` to everyone else, which is what answers the question a player actually asks ("is that one mine?"). A view with **no local player** — a spectator, a replay — has no "friendly," so it falls back to the neutral `TEAM <letter>` and never declares everyone hostile.

**Color reinforces the word; it never replaces it (amended 2026-08-05).** Blue for friendly, red for enemy, on the **team motif only** (the nameplate's side tag and the roster row's underline / side chip). The eight identity colors are untouched and stay per-slot (§5.2): they are how a player tells two *enemies* apart, which matters more at three and four sides, not less. Hulls take no side color at all. Because the words carry the whole meaning on their own, the readout survives with the hue removed — the color-blind-safe path this document already takes with the hull decal. In Free-for-All (teams-of-one) there is no side worth naming, so no side label is drawn anywhere.

**Four maps, fair at every N (amended).** Four hand-authored arena layouts ship in core scope — **octagon, compass, oval, diamond** — chosen in the lobby. Every layout is a **resource-fairness invariant**: the asteroid field is rotationally symmetric about the arena center by 2π/N, so per-player ore is exactly equal at any size. Small-N handling is a **hybrid** (developer-ratified): **octagon and oval regenerate** as true N-station arenas (equal gaps at any N); **compass and diamond always place 8 homes** and leave the `8−N` unused ones as **lootable derelicts** — abandoned rigs, unowned wrecks that carry a home ore field anyone can scavenge (§2.7), preserving each layout's signature geometry at any size. **Per-player ore density rises as N falls** (the finite field is split across fewer facilities), so a small match is a richer, more abundant board even though its wall-clock length lands in the same 10–15-minute target — an economy-feel difference QA re-baselines per size, not a clock change.

### 2.2 What the player sees *(amended 2026-07-27 — damage-ring grammar; boost/ping cut; amended 2026-08-05 — the side label over every hull; see `docs/design-amendments.md`)*

The camera follows the player's ship from above. The HUD shows only what the player acts on. On screen at all times: the ship at center; **ore at a glance** (top left) — filled squares for what's in your hold, one square per cargo slot so upgrades visibly widen it, flashing when full, above your banked **ORE** total; **your own station's HP** (top right, in your player color, mirrored as a bar over the station itself); a narrow **hull bar in the owner's color floating over every ship**, yours included; the **ASTEROID WAVE clock** (top center) naming the wave number, the countdown to the next one, and match time; the Build & Upgrade wheel when near your own station; a minimap (bottom right); and a **controls strip** along the bottom edge listing the active device's bindings. The controls strip is desktop-only — on touch, the visible controls (2.4) replace it entirely.

**In Teams, every name label carries its side, in words (amended 2026-08-05).** Beside each ship's and each owned station's name sits `FRIENDLY A` / `ENEMY B` — the viewer-relative wording of §2.1, tinted blue or red as reinforcement, one step dimmer than the name so it reads as the side rather than as the player. This is a HUD *mechanic*, not decoration: it exists because a Teams match was played in which it was "impossible to know who is on your team," and colour alone could not answer that. Free-for-All draws no side label, character for character as before.

Ship stats — weapon, engine, cargo, hull tiers — are deliberately **not** on the HUD. They appear only in the upgrade panel (2.5), where they are a spending decision rather than clutter.

**Enemy station health is scouted, not broadcast.** You never see other players' HP bars from across the map — a rival station's health appears as a damage ring over that station only when your ship flies within sensor range of it. Knowing who is winning, who is wounded, and who is under siege is information you *earn* by scouting (or by reading the smoke — a burning station is visible from further away than its numbers are). This is deliberate: a global HP scoreboard would let everyone free-ride on every attack; fog makes third-party awareness a skill.

**The damage-ring grammar (amended).** Every health ring — the reactor's and each shield layer's, yours and a scouted enemy's — reads by one rule: a **whole ring in the owner's color is the health that remains**, and a **threat-red segment fills it clockwise from twelve o'clock, proportional to the health *lost*.** A fully red ring is death, exactly. Because the reactor and its shields share the primitive, a besieged station reads outermost-first — **shields redden and die before the reactor begins to fill** — and red is *only ever damage*, never the station, so an enemy home still reads in its owner's color while it burns. (This corrects an earlier build where the ring read backwards — a shrinking red arc for HP remaining.)

Two elements of this HUD are *mechanics, not polish*, and are specified here so they cannot be cut as decoration:

- **The under-attack alarm.** When your reactor, shield, or turrets take sustained damage (not a single stray shot — a taunt-tap must not trigger it), you get an unmistakable alarm plus a screen-edge arrow pointing home. The whole design turns on the moment you're deep in the asteroid field and this alarm fires: the triangle decision, made audible.
- **Onboarding prompts** (section 2.10).

Asteroids visibly crack as they're mined and burst into ore chunks that drift toward nearby ships.

### 2.3 Core loop *(amended 2026-07-27 — projectile mining, atmosphere deposits; see `docs/design-amendments.md`)*

1. **Mine.** Fly to the asteroid field and hold fire on an asteroid. **The same projectile that bites a hull chips a rock into ore chunks** (amended) — one weapon, one trigger, and whatever the shot reaches first decides which payload applies — chunks tractor-collected automatically by proximity. Your hold starts small — 2 ore — and grows only if you buy cargo upgrades; when it's full, chunks stay where they are for anyone. You decide how full to run: dart home early or risk hauling a full hold. Die and you drop half your hold where you exploded.
2. **Spend.** Fly home and convert ore into defenses, repairs, or ship upgrades — or bank it. **You bank simply by flying into your own station's collection field** (amended): while your ship is inside that radius, the hold drains steadily into the safe banked total — no docking, no parking — and stops the instant you leave; ore chunks visibly courier from ship to station, one per unit banked. Docking closer still opens the Build & Upgrade wheel, whose BANK segment dumps the whole hold in one tap. Banked ore is safe; held ore is not.
3. **Fight.** Besiege rival facilities or intercept enemy miners in the contested field.
4. **The clock ticks.** The field's total yield is finite. Ore arrives in five timed **asteroid waves** — surges of the collapsing belt, named in full on the HUD so no player has to guess what is being counted — each spawning closer to the map center than the last, pulling every surviving player into a smaller and smaller contested space. After the final wave the claim closes in — **collapse phase** — no shield regeneration, no repair, no new ore. The match cannot stalemate; the ruleset guarantees an ending.

The loop is a triangle — mine / defend / attack — and every death, upgrade, and turret shifts where a player should be on it. That decision, made every few seconds with one ship, is the game.

### 2.4 Controls and actions *(amended 2026-07-27 — boost/ping cut, the parity principle, Tap Commander; see `docs/design-amendments.md` and `docs/input-parity.md`)*

All input is expressed as abstract *actions*, so the simulation never sees a device. The abstract set is **six verbs** — thrust, aim, fire, build, buildOrder, upgradeOrder (amended: an earlier build added a boost and a ping verb; both were cut, so the sim's whole vocabulary is these six):

| Action | Keyboard/Mouse | Gamepad | Touch |
|---|---|---|---|
| Thrust / steer | WASD | Left stick | Left virtual stick |
| Aim | Mouse cursor | Right stick | Right virtual stick (Manual mode) |
| Fire / Mine | Left mouse button | Right trigger | Right stick engaged, or hold-to-FIRE button (Auto-aim mode) |
| Open Build & Upgrade | E (near own station) | Y / Triangle | BUILD button near own station |

Gamepad support ships via the browser Gamepad API and is not on the cut list.

**The parity principle (amended).** Input parity is not an accident: **every abstract action must be reachable from every input source** — keyboard/mouse, gamepad, and touch — or be explicitly N/A with a reason. The sim sees the action union, never a device, so a control that "only exists on PC" is a hole in the table, not a device quirk; a CI test fails the build if any cell regresses. The same principle governs *modes*, not just verbs: the Manual/Auto-aim fire mode is a player choice on every platform with no fairness gating (below), and the offline and online sim run the identical code — the only sanctioned divergence is that an offline match may pause and a networked one may not (§4.2).

**Tap Commander — an optional alternate scheme (amended).** Ratified as an opt-in scheme (settings: "CONTROLS — Sticks / Tap Commander," persisted like the fire mode): **tap a spot to fly there, tap a target to attack it** — enemy, turret, reactor, or (because a rock is just a target) an asteroid to mine it; tap your own station to fly to its collection field or, in range, open the Build wheel. It is *not* a fourth device and *not* a new verb — a local pilot converts the player's standing order into the same thrust/aim/fire the sticks produce, so the six-verb contract is unchanged. The default scheme is the twin sticks. A **minimap toggle** (small corner ⇄ centered overlay; the `M` key on desktop, a tap on touch) is likewise a HUD control reachable identically on both platforms, not a sim verb.

**The controls strip** runs along the bottom of the screen at all times: keys in signal yellow, actions in grey, swapping automatically when the player picks up a pad. It reads its labels from the same action map that drives the simulation, so it can never drift out of sync with the real bindings.

**Touch controls.** Two dynamic virtual sticks — one per screen half, appearing under the thumb wherever it lands rather than pinned to a fixed position. The left half is always thrust/steer. The right half morphs with the player's fire-mode setting (below): in Manual mode it is an aim stick that fires while engaged — aim and fire are one gesture, matching the game's central idea that your gun is your mining tool; in Auto-aim mode it is replaced entirely by a hold-to-FIRE button, and no aim stick is shown. A dedicated BUILD button appears near the player's own station (the E-equivalent); menus and Rematch are plain taps. (Amended: the boost button and the minimap-ping tap are gone — both mechanics were cut.) On touch, the controls strip (2.2) is not shown — the visible controls themselves are the binding legend, and onboarding prompts (2.10) get touch-specific wording through the same input-agnostic action-mapping layer.

**Fire modes.** Fire mode — Manual or Auto-aim — is a player setting on every platform, not a touch-only concession: on desktop and gamepad it governs whether aiming is manual (mouse cursor / right stick) or the weapon auto-targets while fire is held. In Auto-aim, the weapon engages the nearest valid target — asteroid, ship, turret, shield, or reactor — within weapon range, checked across the full 360° around the ship, no front-arc restriction (`TUNABLE`); the player decides *when* to fire, positioning decides *what* gets hit. Because the weapon is now a travel-time projectile (amended, §2.3), auto-aim **leads a moving target** — it fires where the target is going, not where it is — so an orbiting enemy can still be hit, and a smart strafe can still slip a shot. The default differs by platform because the best first-run experience differs by platform: Manual on desktop and gamepad, Auto-aim on touch — changeable at any time from settings or the pause menu.

### 2.5 Building, repair, and upgrades *(amended 2026-07-27 — discrete repair, turret tiers, the DAMAGE/SPEED weapon split; amended 2026-07-28 — 15-second repair cooldown; see `docs/design-amendments.md`)*

Everything is bought from one place: the **Build & Upgrade wheel**, opened at your own station. Five segments, each labeled in words and each naming its target — TURRET, SHIELD, **REPAIR REACTOR**, **UPGRADE SHIP**, BANK — with your live ore total in the hub. Four spend on your **station**, one on your **ship**; the economy is the choice between those two, so every label names which.

**The only number on a segment is its cost** — with one ratified exception. No rates, no HP-per-ore, no effect text — a bare "3" under TURRET, a bare "1" under REPAIR REACTOR. The exception (amended): **REPAIR REACTOR also shows the HP a tap will restore**, because a discrete repair (below) heals a fixed chunk and a player patching a nearly-full reactor should see that the whole ore still buys only what's missing. The wheel says what a thing costs and what it acts on; the game teaches what it's worth. Four segments spend immediately; **UPGRADE SHIP** carries an arrow marking it as the one that opens a second screen — the upgrade panel, the only place ship stats are ever shown (current value → next tier → ore cost). The controls strip names the key "BUILD & UPGRADE," never just "BUILD," because a player who doesn't know upgrades exist will never look for them.

Built at your own station, paid in ore. **Construction takes time** — a turret assembles over ~10 seconds, a shield over ~15, a radar satellite over ~12 — so defenses are bought before the attack, not during it. Per-station caps (baseline: 4 turrets, 2 shields, **1 radar satellite** *(amended 2026-08-05 — the cap for the ratified radar satellite, feature f1, had no home in this document; the mechanic shipped in `src/sim/buildings.ts` and is unchanged by this amendment)*) are design rules, not renderer limits. **Queued construction counts against a cap**, so a player cannot buy past one by ordering several on the same tick — and neither can a bot (§2.9).

- **Turret** (cheap): auto-fires at enemies in range. Deterrent, not wall — see 2.6. **Turrets sit on a three-rung ladder — Mk I → Mk II → Mk III (amended):** the TURRET segment builds turrets until the ring is full (cap 4), then *upgrades the weakest standing turret* one mark. Each mark is tankier, harder-hitting, faster-firing, slightly longer-ranged, and better-aimed than the last — so a turtle can pour ore into a fortress ring, but a fully-Mk III ring of four costs most of a player's share of the field. The one invariant the ladder never breaks: **every mark's range stays under the ship's weapon reach**, so the pick-off skill of §2.6 exists at every tier.
- **Shield generator** (medium): a regenerating bubble over the reactor; regenerates only after ~8 seconds without taking damage; stacks to two.
- **Repair reactor** (cheap per tap): repairs your **station's reactor**, never your ship — **a discrete purchase, not a channel (amended).** One press of the REPAIR REACTOR segment spends **1 ore and restores 15 reactor HP**, clamped at the reactor max, resolving in full the instant it's bought. There is no continuous drain and no interrupt — a hit landing *after* a repair cannot undo HP already banked into the reactor. **Each repair then puts that reactor on a 15-second cooldown (amended 2026-07-28): the segment refuses the next repair on the same station until the cooldown expires, and the wedge counts the seconds down live ("REPAIR in 12s") before re-arming to "+15 HP / 1 ORE".** The cooldown is **per station, not per player**, so an ally patching a shared reactor waits on the same clock, and it makes repair a *rationed emergency patch* rather than a heal-tank tapped every frame. Ship hull is not repairable at all: ships are cheap and respawn free. "Pressure beats regeneration" (§2.6) still holds — through the *finite ore pool* (every HP bought back is a turret or upgrade not bought), the repair cooldown itself, and, for AI defenders, a pacing tell so that a reactor taking fire cannot resume repairing. Repair money is money not spent on turrets or upgrades — and repair time is time not spent mining or attacking. (Collapse still shuts repair off for good, §2.3.)
- **Ship upgrades** (escalating cost): **weapon**, now split into two tracks — **DAMAGE** (per-shot bite, which is also mining speed: one weapon, one stat) and **SPEED** (projectile muzzle velocity, so a faster shot is a harder-to-dodge shot) — plus engine speed, cargo capacity (base hold 2, +2 per tier), hull HP (amended). Upgrades persist through respawn. Bought from the **upgrade panel** — the one screen where ship stats are shown, each row giving current value, next tier, and ore cost, so upgrading is an explicit trade against turrets and repair. Upgrades *multiply* the class base stats (2.11), so a maxed Interceptor is still the fastest thing on the map and a maxed Hauler still the toughest. Every ore in the hold has five competing uses — turret, shield, repair, ship upgrade, or the bank — and that spending decision, repeated all match under time pressure, is the strategy layer.

### 2.6 Siege balance: how a station actually dies *(amended 2026-07-27 — turret tiers & lead, dodgeable projectiles, discrete repair; see `docs/design-amendments.md`)*

The board's hardest question, answered as design rather than tuning:

- **Turrets deter; the ship defends.** A patient attacker can pick off turrets from the edge of their range — slowly, and while visibly ringing the owner's alarm; **this skill survives every turret mark, because no mark out-ranges the ship's weapon (amended, §2.5).** But turrets fighting *alongside the defender's ship* focus fire and kill attackers fast. **Turret shots have travel time and lead their target** (amended): a low-mark ring aims loosely and re-reads a mover slowly, so a strafing attacker can make it miss — *upgrading a turret buys accuracy as well as bite*, and a Mk III ring tracks an orbiter far better than a Mk I one. An undefended station falls to a determined siege; a defended station is nearly uncrackable one-on-one.
- **Pressure beats regeneration.** Shields regenerate only after 8 undamaged seconds. A repair tap can no longer be *interrupted* (repair is a discrete purchase now, §2.5) — but every tap is an ore spent from a *finite* pool, and a defender pinned under fire is spending ore to stand still rather than to win; a well-aimed enemy keeping shields down still out-paces a defender's patch-ups. To recover, the defender must drive the attacker off first.
- **Two beats one.** Because sustained pressure keeps shields down, two attackers can crack what one cannot. In an 8-player match this is where temporary, unspoken alliances come from — and why being the leader is dangerous.
- **The economy is the siege engine of last resort.** Every turret, shield, and repair is paid from a *finite* ore pool. A turtle spends ore to stand still; when the field runs dry and collapse begins, the stockpile that was spent on staying alive is gone, and nothing regenerates.

The intended shape: attacking an occupied station is a mistake, pulling the owner away (or waiting for the alarm to go unanswered) is the skill, and the endgame belongs to whoever managed the clock best.

### 2.7 Death, respawn, and debris *(amended 2026-07-27 — lootable derelicts, ore conservation; see `docs/design-amendments.md` and `docs/variable-slots-plan.md`)*

Respawning is **free and fast** (5 seconds at your home station, upgrades intact) — the cost of dying is *time and position*: half your held ore drops where you exploded, and you respawn far from wherever you were needed. Banked ore is never lost to a ship death.

When a station's reactor is destroyed, its owner is eliminated and gets an immediate **Rematch** button (plus spectate if they want to watch). The dead station leaves a **wreck** that persists for the rest of the match, surrounded by ore-laden debris that *anyone* can scavenge — funded by the dead player's own banked fortune, so the thing they were saving becomes the thing their killers fight over. Small cargo holds mean nobody hauls a dead player's fortune away in one trip — wreck sites stay contested, and fights over a fresh wreck are a feature, not a bug.

**Lootable derelicts (amended).** The wreck-as-loot theme also seeds the board: on the compass and diamond maps at fewer than 8 players, the unused home slots are placed as **derelicts — abandoned rigs**: unowned wrecks carrying a home ore field anyone can scavenge from the opening whistle (§2.1). They are nobody's enemy and take no siege damage; they are contested loot, not opponents.

**Ore is conserved, exactly (amended).** Every unit of ore that moves in a match is accounted for — mined, dropped, looted, deposited, spent, or lost with a capped wreck — and the simulation asserts, every tick of a full match, that none has vanished or been minted. This closes a recurring class of "loot black hole" bug where a dead player's ore silently stopped counting; looted ore now banks 1:1 on every path. "Ore is ore": mined, death-dropped, and scavenged ore are one pool, read identically by the deposit drain.

### 2.8 Baseline constants (opening hypotheses, owned by QA thereafter) *(amended 2026-07-27 — weapon/repair/turret-tier rows; see `docs/design-amendments.md`)*

These are starting values, not commitments — they exist so the Gameplay Engineer types design numbers at M1 instead of inventing them, and so QA has a hypothesis to falsify. All are flagged `TUNABLE`.

| Constant | Notes | Baseline |
|---|---|---|
| Core HP | Naked-core kill time = 100 ÷ 5 = ~20 s of sustained fire | 100 |
| Weapon vs core | DPS (delivered by projectile now, §2.3); the constant the whole match balances on | 5 |
| Weapon vs ships/turrets | DPS (delivered by projectile now, §2.3) | 10 |
| Mining rate | Ore per second of fire-on-asteroid | 0.5 |
| Ship hull | Base; upgradable | 50 |
| Starting ore | One meaningful opening choice | 3 |
| Spawn protection | Ship and core, match start | 10 s |
| Cargo hold | Base; +2 per upgrade tier, first tier cheap, escalating; cap 8 | 2 |
| Turret (Mk I) | Cost 3 · HP 30 · DPS 4 · build 10 s · cap 4 · *upgradeable Mk I→III (amended)* | — |
| Turret Mk II / Mk III | +4 / +7 ore · HP 45/60 · DPS 6/8 · tighter aim; range stays under weapon reach (amended) | — |
| Shield | Cost 5 · 40 HP · regen 2/s after 8 s undamaged · build 15 s · cap 2 | — |
| Repair core | Station reactor only · **1 tap = 15 HP for 1 ore · discrete purchase, no channel** (amended) | — |
| Atmosphere deposit | Hold auto-banks inside own station's collection field (~4× station radius) at 2 ore/s (amended) | — |
| Field yield | Total ore per match, in 5 asteroid waves, each closer to center | ~400 |
| Asteroid wave interval | Metronome of the match | ~150 s |
| Respawn | Free; time is the cost | 5 s |
| Sensor range | Distance at which an enemy station's damage ring becomes visible | ~2× shield radius |

### 2.9 AI opponents (in-game) *(amended 2026-07-27 — projectile lead, team allegiance, slot model; see `docs/design-amendments.md`)*

Bots are hand-coded behavior trees running the same action interface as human input — no LLM calls at runtime. They fill the lobby's **open slots** and are assigned a side in Teams (§2.1), where they **respect allegiance** — a bot never targets an ally, its shots pass through allies, and its turrets ignore them. Because combat is a travel-time projectile now (§2.3), bots aim on an **intercept course**, leading a moving target by its last-seen velocity and their own muzzle speed; a still target collapses the lead to a straight shot, and per-tier aim jitter means a Hard bot leads well while an Easy bot leads badly — the difficulty ladder is intact. Bots are also **fog-honest**: they perceive only what a human in their cockpit could (same sensor range, same hidden enemy HP), so a Hard bot that knows you're wounded knows it because it scouted you. Difficulty changes visible competence, not cheats:

- **Easy** mines slowly, over-defends, attacks rarely, retreats at half hull.
- **Medium** balances the triangle, contests ore waves, and gangs up on the current leader.
- **Hard** plays like a good human: it evaluates targets by *threat, proximity, and opportunity* — it punishes whoever it can profitably punish (the miner far from home, the station whose alarm went unanswered, the wreck nobody is guarding), times attacks to when you're seen mining far from home, and scavenges kill sites.

**Allegiance is read, never re-implemented** *(amended 2026-08-05 — developer report p16-01, "team B bots was attacking each other"; this section promised the behaviour above but never said where the answer comes from).* A bot owns no notion of who its enemies are. Every friend/foe question it asks — the intruder in its home ring, the ship it breaks off from, the blockade it commits to fighting, the hull and the reactor it scores, the "current leader" it gangs up on, the hostile it prices into a mining approach — is the **same single predicate** the turrets, the auto-aim, the siege collision and the projectiles ask (§2.1), read off the perceived entity rather than derived again. Two things follow, and the second is the one that bites: allies stop being targets in every behavior at once rather than branch by branch, and **FFA cannot prove any of it** — FFA is teams-of-one, so "every other ship" and "every enemy ship" are the same set there, and a bot that has forgotten to ask looks perfect in a free-for-all forever. Any guarantee about allegiance must be tested with two slots sharing a side or it is not tested at all.

**Bots keep their own house** *(amended 2026-08-05 — developer report p15-02, "bots don't repair or rebuild"; this section previously said nothing about what a bot does with its ore).* A bot spends at the same wheel a human does and under the same rules: it patches its reactor as a **rationed emergency** — never under fire, because a siege cannot be out-repaired (§2.6), never past the repair cooldown (§2.5), and never quite to full, so a field of well-funded turtles does not arrive at collapse on one identical HP — and it **replaces the defenses it loses**, respecting every per-station cap including queued construction (§2.5). Crucially it will **fly home to do either**, rather than only spending when it happens to be docked for some other reason: how far it will break off for that is the character's territorial dial, so Patch crosses the map to patch its reactor and Bolt barely turns around. A Hard bot narrows this to the reactor alone and never above a live target — it replaces a shot-off turret on its next trip home, because a good human does not fly one for a turret.

The seven bots are **characters, not difficulty labels**: Rusty (Easy, timid hoarder), Bolt (Easy, reckless rusher), Foreman (Medium, methodical miner), Patch (Medium, defensive fixer), Sable (Hard, opportunist raider), Vulture (Hard, wreck scavenger), Warden (Hard, territorial enforcer). Each has a name, a ship livery, and personality weights layered on its difficulty tree — so a solo match has a cast, and losing to Vulture feels different from losing to Warden.

### 2.10 Onboarding

The game's central mechanic — your gun is your mining tool — inverts player expectations, so it is taught, not assumed. Onboarding is **owned by the UI Engineer and built across M1–M2**, not deferred: contextual first-match prompts fire on triggers ("Hold fire on the asteroid — your shots chip it into ore," "Hold full — fly into your collection field to bank, then press E to spend," "Spend ore on defense — or UPGRADE SHIP to mine and hit harder," "Your station is under attack — follow the arrow") *(amended 2026-07-27 — projectile mining, collection-field banking)*. The upgrade prompt fires the first time the wheel opens, because upgrades are the half of the economy a player can most easily miss. The prompts are the M1/M2 milestones translated into player-facing language, they are input-agnostic for free via the action mapping (2.4), and they never appear again after each is completed once. No separate tutorial mode: the first match is the tutorial.

### 2.11 Ship classes *(amended 2026-07-27 — "one weapon, one stat"; see `docs/design-amendments.md`)*

Players choose a hull in the lobby; the choice is locked for the match and sets all five core attributes: **top speed, acceleration, turn rate, armor (hull HP), and weapon power** (which is also mining speed — one weapon, one stat). Four classes ship in core scope. Baselines are opening hypotheses (TUNABLE), relative to the Vanguard:

| Class (hull) | Role · Speed / Accel / Turn / Hull / Power / Cargo |
|---|---|
| Interceptor (Quadfin) | Scout, miner-hunter · 130% / 120% / 140% / 35 / 8 / 2 |
| Vanguard (Anvil) | All-rounder, onboarding default · 100% / 100% / 100% / 50 / 10 / 2 |
| Excavator (Pincer) | Mining engine, close bruiser · 90% / 100% / 80% / 55 / 13 / 2 |
| Hauler (Hammerhead) | Logistics, siege tank · 85% / 80% / 85% / 70 / 9 / 3 |

The intended rock-paper-scissors around the triangle: the Interceptor catches miners in the open but melts against turrets; the Excavator out-earns everyone but can't run; the Hauler hauls three ore and tanks sieges but arrives late; the Vanguard does everything second-best and is the pre-selected default so onboarding never blocks on the choice. Bot personalities map to hulls (Bolt/Sable fly Interceptors, Foreman/Warden Excavators, Rusty/Patch Haulers, Vulture a Vanguard) — so a silhouette on the minimap is information. Four classes, and no others. QA gains a third measurable target: **no class exceeds a 55% win rate** in mirror-vs-field harness runs.

---

## 3. AI Architecture (the agent team that builds the game)

Planet Rush is developed by seven specialized Claude agents plus a coordinating director, orchestrated through Claude Code. Each agent owns files, not vibes: a directory it writes to, interfaces it must honor, and a definition of done tied to something a player can see or feel.

1. **Director** — *Keeps everything the other agents build speaking the same design language.* Reviews every other agent's output against this GDD, the shared TypeScript interfaces, and the tone paragraph (4.7), and ratifies all interface changes. *Escalation path:* any agent may propose an interface change as a pull request at any time; the Director approves or rejects asynchronously, so no agent ever stalls waiting for a synchronous review — the single-writer lock is on ratification, not on proposing.

2. **Gameplay Engineer** — *Everything the player does is this agent's code.* Writes the simulation: ship physics, the shared shoot/mine projectile weapon, ore, building, construction timers, discrete repair, siege rules, win/loss, and the baseline constants table.

3. **Bot Engineer** — *A solo player offline still gets a full 8-station match with a memorable cast.* Writes the Easy/Medium/Hard behavior trees and the seven bot personalities against the same action interface a human uses.

4. **Platform Engineer** — *The game feels identical on a trackpad, an Xbox pad, and a phone screen, and it runs at 60 fps on a laptop — and on the developer's phone.* Owns the deterministic fixed-timestep loop, the input-action mapping (keyboard/mouse, gamepad, and touch), the dynamic virtual sticks, the device-aware controls strip, the PWA manifest and service worker, viewport/devicePixelRatio scaling, the `platform.ts` abstraction (the Capacitor seam), the determinism replay test, and the PixiJS render layer.

5. **Netcode Engineer** — *Eight people in four countries fight over the same asteroid and it feels like one room.* Owns the `Transport` interface and both of its implementations, the authoritative match server, snapshot encoding, client-side prediction and reconciliation, and the room/lobby protocol. Runs an **M0 spike** before any of it is designed, and the spike *decides* rather than confirms: measure a real snapshot's size, establish the tick rate the sim can sustain, and evaluate candidate hosts against the one requirement that matters — holding a persistent WebSocket under load without sleeping — then pick one. The numbers in 4.2 are inputs to that spike, not conclusions from it. *Scope note:* netcode is the highest-variance work in the build and lands mid-sequence, so it is owned separately — a slip here cannot also stall input, rendering, and the game loop.

6. **Art & Audio Agent** — *Every mechanic in section 2 has a visible and audible tell.* Produces every visual and sound: procedural SVG/sprite ships (one livery per bot personality), facilities, asteroids, wrecks, and UI in one palette; **a specified VFX set** — shot impacts, asteroid crack-and-burst, shield shimmer, turret muzzle flashes, explosions, thruster trails, spawn-protection glow, and the station-death moment; synthesized SFX (jsfxr-style) including the under-attack alarm and the distinct rock-vs-hull impact sounds; and an ambient loop. Runs the M0 concept mode (4.7).

7. **UI Engineer** — *The player always knows the triangle state, and a first-time player learns the game inside their first match — on a laptop or a phone.* Builds the HUD (ore squares + banked total, asteroid-wave clock, alarm, screen-edge arrow, over-ship hull bars, device-aware controls strip), thumb-scale HUD layout and safe-area-aware anchoring for touch devices, the fire-mode setting (Manual/Auto-aim) and its settings-menu UI, radial build menu, upgrade panel, minimap, main menu, settings, lobby with ship-class select and player colors, end-of-match summary with Rematch, **and the onboarding prompts (2.10)**.

8. **QA Agent** — *The clock the design promises is the clock the player gets — on desktop and in your hand.* Runs headless bot-vs-bot matches **with an enforced match timeout** (a hung match is a failed test, not a hung harness), owns the constants table from M2 onward, writes sim unit tests and the determinism replay test, owns the mobile performance gate (4.3) and verifies every milestone (4.6) on the developer's phone before it ships, and files balance reports against two measurable targets: match length lands in 10–15 minutes, and no strategy exceeds a stated win-rate threshold across bot mirrors.

Coordination stays deliberately boring: agents communicate through shared interface files, PRs, and the Director's reviews. There is no runtime multi-agent system in the shipped game — the multi-agent system is the studio, not the product. Runtime token cost: zero.

---

## 4. Technical Strategy

### 4.1 Stack and platform path

- **Language:** TypeScript throughout — client, server, and bots share one codebase and one set of types. Agents write and test plain text files; no engine-editor tooling in the loop.
- **Renderer:** PixiJS (WebGL2), drawing a 2D top-down scene. Sprites are batched and pooled from M1.
- **PWA:** a manifest and service worker make the client installable to the home screen and playable fullscreen; the service worker caches the app shell, so the game is offline-capable against bots by the same mechanism that makes it installable. Store packaging (Capacitor) is designed for, not built, in this build.
- **Platform abstraction:** all platform-specific calls — fullscreen, vibration, storage, orientation — go through one `platform.ts` interface; game code never touches a bare browser global directly. This is the Capacitor seam: wrapping it for native store packaging is a post-v0.1 task, not a rewrite.
- **Collision:** hand-written, no physics engine. Every colliding body is a circle, so:
  - **Broad phase:** uniform-grid spatial hash, cell size ≈ 2× largest radius; test same + adjacent cells only.
  - **Narrow phase:** `dx² + dy² < (r1+r2)²`. No square roots.
  - **Weapon fire:** the ship's gun and every turret fire **pooled projectiles** with a finite muzzle speed and lifetime, same circle test *(amended 2026-07-27 — the segment-vs-circle mining/weapon beam is retired; travel time is the mechanic that makes a shot dodgeable, §2.3)*. One ship shot chips a rock or bites a hull, whichever it reaches first; a shot despawns on hit.
  - **Turret shots:** pooled projectiles, same circle test — turrets lead their target and their aim tightens with tier (§2.6).
  - **Movement:** Euler integration with drag. Ship-vs-asteroid reflects; a projectile despawns on hit.
  
  Roughly 250 lines, and we own every float operation — which is what makes the CI replay test (4.8) meaningful.
- **Animation:** procedural, no libraries. Ship rotation is a transform, thrusters are alpha oscillation, explosions are pooled particles, asteroid cracks are sprite swaps at damage thresholds, UI uses tweens.
- **Simulation:** deterministic fixed-timestep (60 Hz), fully decoupled from rendering. **The match server never imports PixiJS** — it runs the sim with no GPU, no canvas, no window, and so does the QA harness. **Determinism policy:** netcode is authoritative state-sync, not lockstep; determinism is asserted per build by a CI replay test (same inputs, same final state hash), with a table-based math fallback if it ever fails.

### 4.2 Multiplayer: in core scope *(amended 2026-07-27 — no-pause-online, room config advertisement; see `docs/design-amendments.md` and `docs/variable-slots-plan.md`)*

Online multiplayer is in core scope. A small **authoritative Node.js match server** over WebSockets holds all simulation authority: clients send input ticks, the server runs the one true sim and broadcasts state, clients interpolate. Rooms are created from the lobby with a shareable code; bots fill open slots server-side, so a classroom match of a few humans is still a full arena.

**Rooms advertise their configuration (amended).** Because a match now has a mode, a size, and joinable-seat count (§2.1), a room **publishes that config** — mode, size, and how many seats are still open — so a player is never routed into a lobby that doesn't fit (a full room, or the wrong mode). This rides the room advertisement/heartbeat, not the per-tick snapshot: allegiance and size are static match config, fixed at match start, so they cost the streamed snapshot **zero bytes** and travel with the match-start roster instead.

**No pause online (amended).** A match in progress has a pause overlay (RESUME / SETTINGS / EXIT-to-menu, EXIT behind a confirm), reached the same way on both platforms (ESC on desktop, a corner button on touch). But **pause is the transport's, not the overlay's: offline the sim freezes while the overlay is up and resumes exactly where it left off; online it does not — an eight-way authoritative match cannot stop for one player, so the overlay shows over a still-running sim.** The whole distinction is one `pausable` flag (offline true, networked false) — the sim runs identically either way, which is the offline/online half of the parity principle (§2.4).

**"Host" is a lobby word, not a network role.** The player who creates a room picks the bot difficulties and is otherwise a client like any other. There are no listen servers and no peer-to-peer: browsers cannot accept incoming connections.

**Hosting: decided by the M0 spike, not by this document.** The requirement is narrow and testable — hold a persistent WebSocket for a full match under 8-player load, without sleeping or dropping connections, at zero or near-zero cost. Candidates to evaluate: Oracle Cloud Always Free (always-on ARM), Cloudflare Durable Objects (WebSocket-native, one object per room), and a low-cost VPS as the paid baseline. The Netcode Engineer benchmarks them and picks one; the choice is recorded in the repo, not here.

Regardless of the winner, the server ships as a **plain Dockerized Node process with no vendor-specific APIs**, so it redeploys elsewhere in an afternoon. That portability is the actual requirement — the host is replaceable, and the spec treats it that way (risk 1).

**What goes over the wire.** Static entities — asteroids, turrets, shields, wrecks — are sent as **events**, on join and on change. Only ships and projectiles stream as **binary snapshots**. Server ticks at 20–30 Hz; clients render at 60 with interpolation. **Client-side prediction** makes input feel instant: your own ship simulates locally the moment you press a key and reconciles against server authority — available because the sim is deterministic and the client runs the same code the server does.

**The `Transport` interface** has two implementations: `LocalLoopback` (solo, offline) and `WebSocketTransport` (online). The simulation consumes ordered input ticks and never knows which one it is talking to. The server deploys from GitHub Actions, so the developer's travel connectivity never gates the classroom's ability to play. If scope runs over, the cut list (4.9) degrades multiplayer to 2 players + bots rather than cutting it.

**Reconnect grace.** On a mid-match disconnect, a bot substitutes for the player immediately, so the match keeps its shape and the room doesn't stall. The player may rejoin the same match by room code within ~60 seconds (`TUNABLE`) and reclaim their ship, with all upgrades intact. This is motivated by mobile play, where screen lock, app backgrounding, and cellular drops are routine in a way they are not on desktop.

### 4.3 Named constraints

1. **Bounded scope, milestone-gated.** Four map layouts *(amended 2026-07-27, §2.1 — was "one map layout")*, four buildables, elimination-only — the ranked cut list enforces scope; milestones gate progress, not calendar time. The ranked cut list (4.9) is the enforcement instrument — cuts are decided now, in daylight, not at 2 a.m. on M7.
2. **Spotty internet while traveling (primary constraint).** (a) The solo/offline game is a complete product on its own; (b) the dev environment is fully local; (c) agent work is batched into bursts with Director briefs prepared offline; (d) server deploys run in the cloud via Actions, so a hotel-Wi-Fi push is enough to update both the game and the server.
3. **Browser performance budget.** 8 ships, up to 32 turrets (design cap 4 × 8 facilities), ~200 asteroids, hundreds of projectiles at 60 fps on integrated graphics: object pooling, spatial hash collisions, instanced sprites, zero per-frame allocations in the sim. **Mobile gate:** 60 fps on the developer's own phone — the primary mobile test device — at the same entity counts, with a 30 fps floor on a 3-year-old mid-range Android; sustained drops below the floor auto-engage the "reduce VFX" setting. Entity counts are unchanged for mobile — the same pooling and batching disciplines are what make the phone target feasible. Verified by the M5 performance gate, not assumed.
4. **Runtime token cost must be zero.** All in-game AI is behavior trees; LLMs build the game but never run it.

### 4.3b Named risks

Keeping online multiplayer in core scope is a deliberate bet. These are the ways it can go wrong, each with the thing that stops it becoming fatal:

| # | Risk | Why it's real | Mitigation |
|---|---|---|---|
| 1 | **Free hosting tiers change without warning** | Free tiers are withdrawn, throttled, or quietly halved with no announcement, and some close idle WebSockets outright. Whichever host the spike picks can move under us mid-build. | The server is a plain Dockerized Node process with no vendor-specific APIs, so it redeploys anywhere in an afternoon. A ~4 EUR/month VPS is the standing paid fallback. The portability is the mitigation — not the vendor. |
| 2 | **Netcode slips and eats the back half** | It's the highest-variance work in the plan and it lands on M3–M4, where an overrun cascades into integration (M5) and balance (M6). | Three layers. The cut list degrades 8 players to 2 players + bots rather than cutting online. The offline solo game is complete and ships regardless. And the Netcode Engineer is a separate agent, so a netcode slip can't also stall input, rendering, and the loop. |
| 3 | **WebSocket is TCP — head-of-line blocking** | One dropped packet stalls everything queued behind it. At 8 players on a small map this is *probably* fine; nobody has measured it. | The M0 spike measures it before the design locks. If it bites, geckos.io (UDP over WebRTC) drops in behind the same `Transport` interface — transport work, not a rewrite. |
| 4 | **The bandwidth numbers in 4.2 are arithmetic, not measurements** | ~40 KB/s per client and ~2 KB snapshots come from *assumed* entity counts and tick rates. No one has run it. | Explicitly an M0 spike deliverable, treated like the balance constants in 2.8: a hypothesis for QA to falsify, not a fact to build on. |
| 5 | **PixiJS perf at target entity counts is unverified** | 8 ships, 32 turrets, ~200 asteroids and hundreds of projectiles at 60 fps on integrated graphics is a claim, not a result. | Pooling, spatial hashing and instanced sprites from M1, not retrofitted. The M5 integration gate verifies it on real hardware, with "reduce VFX" already in the settings menu as the escape hatch. |
| 6 | **Server dies, and with it all online play** | Free tier, single instance, no redundancy. | Offline solo-vs-bots is a first-class mode, not a fallback — it needs no server, no internet, and is the mode the developer builds against while travelling. A dead server costs the classroom a session, never the deliverable. |
| 7 | **Mobile browser quirks** | Audio unlock requires a user gesture, fullscreen API behaves differently across mobile browsers, and Safari enforces tight WebGL memory limits — any of which can silently break a build that only tested on desktop. | The developer's phone is a first-class test device from M1; every milestone (4.6) is phone-verified before it ships, so quirks surface the milestone they're introduced, not at M6. |

### 4.4 Token budget

Budget assumes Claude Code sessions across the build (M0 pre-production through M7), batched for offline gaps. Figures are input+output combined, with headroom.

| Agent | Main deliverables | Est. tokens |
|---|---|---|
| Director | Briefs, interface + tone contracts, PR reviews | 3.0 M |
| Gameplay Engineer | Sim: collision, projectile weapon, ore, building, repair, siege, win/loss | 6.0 M |
| Bot Engineer | 3-difficulty behavior trees + 7 personalities | 3.5 M |
| Platform Engineer | Game loop, input mapping (incl. touch), controls strip, PWA/service worker, Pixi render layer | 4.5 M |
| Netcode Engineer | M0 spike, Transport, match server, snapshots, prediction | 4.5 M |
| Art & Audio Agent | Concept boards + sprites, VFX set, SFX, alarm, palette | 5.0 M |
| UI Engineer | HUD, build menu, upgrade panel, lobby, onboarding, rematch, fire-mode/settings UI | 4.5 M |
| QA Agent | Headless harness (with timeout), tests, balance to targets, mobile perf gate | 4.0 M |
| Contingency (~20%) | Rework, integration bugs, balance passes | 6.5 M |
| **Total** | | **~41.5 M tokens** |

Front-loaded on the Gameplay Engineer (M1–M3), mid-loaded on the Netcode Engineer (M3–M4, plus the M0 spike), back-loaded on QA (M5–M7). Headless QA matches consume no tokens — they're compiled code.

### 4.5 API constraints and mitigations

- **Rate/usage limits + offline gaps:** planned bursts; Director briefs make sessions resumable; all state lives in the repo, never in a conversation.
- **Context limits:** the codebase is split along agent ownership lines; interfaces are the contract, so no agent needs the whole repo in context.
- **Asset generation:** art is generated as code (SVG/procedural sprites) — reproducible, diffable, license-clean, regenerable offline.

### 4.6 The milestone plan

| Milestone | Playable check |
|---|---|
| M0 | Concept boards + tone locked into style-guide.md; repo, CI, Pages, server deploy pipeline live; **Netcode spike:** real snapshot size measured, sustainable tick rate established, host benchmarked and chosen (pre-production — not a playable build; phone verification starts at M1) |
| M1 | Ship flies, shoots, mines; two-number ore HUD; first onboarding prompts; touch controls (twin sticks, fire-mode setting) ship alongside keyboard/mouse and gamepad — playable at the public URL — phone-verified |
| M2 | Facilities, reactors, turrets, shields, discrete repair, build menu, under-attack alarm; win/loss + last-to-die rule fires vs. do-nothing bots — phone-verified |
| M3 | WebSocket transport + authoritative server deployed; 2-player online match works — phone-verified |
| M4 | 8-slot lobby with room codes, ship-class select, player colors; Easy/Medium/Hard bots with personalities fill empty slots, online and offline — phone-verified |
| M5 | **Integration milestone:** full 8-slot online match end-to-end; 60 fps performance gate on integrated graphics and on the developer's phone; first balance pass against the constants table; art/VFX/audio replace placeholders — phone-verified |
| M6 | QA balance passes to the 10–15 min target; gamepad and touch verified; onboarding polished — phone-verified |
| M7 | Polish, main menu + settings + end-of-match/rematch flow, tagged v0.1 release for the classroom — phone-verified |

### 4.6a Playable milestones

> A **playable milestone** is a tagged, CI-green build, live at the public URL, that a first-time player can open on a phone browser and verify that milestone's player-facing checks in under 2 minutes — touch and keyboard both working — announced by a phone ping containing the play URL and a 2-line "what to test" note.

The seven milestones above (M1–M7) are the playable milestones; M0 is pre-production and the netcode spike, not itself a player-facing build. Each milestone gains a `test_notes` field in `milestones.json`; the deploy workflow pings ntfy on tag with the URL and those notes — Planet Rush Studio's existing milestones.json → ping plumbing is reused as-is, not rebuilt.

**On-demand deploys.** Saying "deploy now" to the Director pushes the current `main` to the `/dev` URL and fires the same ping, with no tag required — so a milestone can be phone-verified mid-cycle, not just at its scheduled end.

### 4.7 Pre-production: concept iteration and tone

Before production, the Art & Audio Agent runs the M0 concept mode, delivering instantly viewable HTML/SVG artifacts: two to three **theme boards** showing the *same* scene (ship, defended station, asteroid field, HUD, open build menu); **level layout variants** (one SVG, three station-ring/field arrangements — spacing tunes the triangle, since travel time home is the defense tax); and **UI mockups** in the two leading themes.

The boards are judged against a **tone paragraph**, written into this GDD so the choice has criteria instead of vibes:

> *Planet Rush is a Saturday-morning space brawl: fast, bright, and a little cheeky. Ships are toys, explosions are fireworks, bots are cartoon rivals with names. But homes are the one serious thing in it — when a station dies, the game goes briefly quiet, the wreck stays on the map all match, and nobody jokes for three seconds. Arcade on the surface, a small ache underneath.*

The developer picks a winner (one revision round max), frozen into `style-guide.md` — a contract like the interfaces, changeable only through the Director. Concept iteration is deliberately not a standing loop: after M2 the game is playable, and iterating on the real build beats iterating on pictures. Budget: ~1.0 M tokens inside the Art & Audio line.

### 4.8 Source control, CI, and classroom distribution

Everything lives in one GitHub repository from M0: code, this GDD, `style-guide.md`, agent briefs, and all generated assets (which are code, so the whole game is reproducible from a clone). Agents work in short-lived branches scoped to briefs; the Director merges to `main` via PR review — the same channel as the escalation path in section 3.

GitHub Actions runs four jobs. **CI on every push:** typecheck, unit tests, the determinism replay test, the ore-conservation invariant *(amended 2026-07-27, §2.7 — the economy must balance exactly every tick of a full match)*, and a headless bot smoke match (with timeout) — a commit that breaks or hangs the game cannot merge. **Deploy on green `main`:** the web client to GitHub Pages, the match server to its free-tier host — one public URL the whole classroom can open and play, solo or together. **Release on tag:** the stable classroom link serves the latest *tagged* build, with `main`'s newest on a `/dev` path, so experiments never break the link the class is using.

Git is offline-first: commit locally all day, push in a burst, and the cloud does the building — a phone-hotspot push updates both game and server.

### 4.9 Ranked cut list

If scope runs over, features die in this order — decided now, not by whoever is tired at M7:

*(Amended 2026-07-27: the original list opened with **minimap ping** and **boost**. Both were cut from the game outright (§2.4) — they are gone, not deferred, so they no longer head this list.)*

1. Ambient music loop (SFX and the alarm are mechanics; they stay)
2. Bot personality flavor (liveries/behavior quirks — names stay)
3. End-of-match summary reduces to a plain winner screen (Rematch button stays)
4. Online lobby degrades from 8 players to 2 players + bots (multiplayer itself is never cut)
5. Third theme board (pick from two)
6. PWA installability (mobile-browser play survives without it)
7. Landscape orientation lock

Not cuttable: the triangle (mine/defend/attack), the finite field and collapse phase, onboarding prompts, the under-attack alarm, gamepad support, offline solo mode, 2-player online, touch controls (twin sticks), the auto-aim fire mode, and mobile-browser playability.

## 5. Art Direction

The visual direction was chosen at M0 and frozen into `style-guide.md` — the contract the Art & Audio and UI agents build against, changeable only through the Director (4.7). This chapter is that reference.

### 5.1 Cold Vacuum — the chosen direction

**Cold Vacuum** is the frozen direction: gunmetal hulls, teal patina for corrosion, signal yellow for anything that matters, and a cold plasma-blue for the weapon fire *(amended 2026-07-27 — the weapon is a projectile now, §2.3; plasma tints the shots, not a hitscan beam)*. Industrial and grubby, but in vacuum rather than in a mine shaft — no rust, no amber, no cave.

The palette is small on purpose, because every colour has a job:

| Role | Hex | Job |
|---|---|---|
| Vacuum | `#0D1015` | Background. Near-black, so every entity carries its own contrast. |
| Hull steel | `#7E8894` | All ships, all players. Hulls never take player colour. |
| Patina | `#4FA08B` | Corrosion, continents, repair. The "old system" tint. |
| Signal yellow | `#F2D24B` | Ore, hazard stripes, costs. **Reserved.** |
| Plasma | `#4DC3FF` | Weapon fire (projectile shots), cockpits, energy. |
| Threat red | `#B23A3A` | Damage, alarms, enemy fire. |

The rule that carries the most weight: **signal yellow means ore or danger, and nothing else.** Nothing decorative is ever yellow, so a player scanning a chaotic screen can trust it.

### 5.2 Player colour and identity *(amended 2026-08-05 — the side motif's blue/red)*

Eight players, eight colours — humans and bots alike. The rule is that **hulls stay steel**; player colour lives only on wing tips, cockpit, engine flame, weapon-fire tint, station beacon ring and HP bar. This keeps every ship reading as the same industrial fleet while remaining instantly identifiable, and it means a livery is a palette swap rather than a new sprite. Every ship also carries its player number as a hull decal, so identity never depends on colour alone — which is the colourblind-safe path and costs nothing.

**The team motif is the one place a second colour layer is allowed (amended 2026-08-05).** In Teams the side tag beside a name, and the roster row's underline and side chip, are drawn **blue for friendly and red for enemy** — plasma `#4DC3FF` and a declared lift of threat red toward white (the enemy-fire ramp's own rung, so no seventh hue enters the palette; raw threat red is too dim to read at 11px against Vacuum). It is reinforcement over a **word** that already says the side (§2.1), so nothing is lost with the hue removed, and it never reaches a hull, a trim, a beacon ring or an HP bar — those stay the player's identity colour, because at three and four sides that colour is what tells two enemies apart.

### 5.3 Ship classes

Four hulls, four silhouettes, four playstyles (2.11). Silhouette is deliberately doing the work: because bot personalities map to hulls, recognising a shape at 24 pixels tells you who you are dealing with before you can read a name. That is also why the hull stays steel — the shape must carry the information.

### 5.4 Facilities

A home **station** is a mining installation staking a claimed **planetoid** — the round body is randomised per player from four variants so no two home claims look identical. Oceans are steel-blue and continents patina-green, which keeps the planetoid inside the Cold Vacuum palette instead of importing a second one. The **reactor** stays signal yellow — it is the win condition, so it obeys the yellow rule. Ownership shows as a beacon ring in the player's colour, always visible; health shows as a damage ring, visible only within sensor range (2.2). **The ring grammar (amended, §2.2):** a whole ring in the owner's colour is the health remaining, and threat-red *fills* it clockwise from twelve o'clock as HP is lost — a fully red ring is death; the reactor and its shields share the primitive, so shields redden and die before the reactor begins to fill, and red is only ever the damage, never the station. *(Lore-pivot note: the existing round-body art reads as the claimed planetoid the station sits on; whether facilities gain additional industrial dressing — rigs, gantries, docking arms — beyond that body is an Art follow-up flagged in the lore changelog, not a mechanic and not this pass's job.)*

### 5.5 Turrets and asteroids

Turrets must read as cannons at a glance and telegraph their threat while spinning, and read their mark (Mk I → III, §2.5) as a distinct visual tell. Asteroids are the economy, so they must crack visibly across three stages and let a player judge a payout before committing fire.

### 5.6 Typography

**Audiowide** for the wordmark, headings and menu confirmations — rounded retro-techno, the one face in the shortlist that is playful without being a toy, which is precisely the tone paragraph's brief. **Oxanium** for HUD numerals and body text: it was designed for game interfaces, holds up at 12px, and shares Audiowide's squared geometry without competing with it. Both are OFL licensed and self-hosted in the repo, so they render offline and carry no licence risk (4.5). This document is typeset in them.

### 5.7 The interface

The HUD shows only what the player acts on: ore squares and banked total, the asteroid wave clock, your own station's health, hull bars over ships, in Teams the side each name is on (`FRIENDLY A` / `ENEMY B`, §2.2), and a controls strip that names the active device's bindings. Ship stats live in the upgrade panel and nowhere else. Enemy station health is scouted, never broadcast.

### 5.8 The game in play

The ruleset's distinct moments, drawn before M1. Each one is a legibility test: if a moment doesn't read at a glance, that's a design bug found in pre-production rather than at M6.


---

*End of v0.7. This document is the Assignment #01 deliverable and the contract the build agents work against.*

*Changes from the first draft, in response to a six-agent design review board: the ore economy is bounded and ends in a collapse phase, so the match is structurally guaranteed to terminate; starting ore and spawn protection replace the naked-core opening; the siege model is stated as design rather than deferred to tuning (turrets deter / the ship defends / pressure beats regeneration / two beats one); core repair replaces the mine layer; ties resolve last-to-die; respawn is free with time as the cost; Hard bots target by threat rather than weakness, and are fog-honest; onboarding is designed, owned and scheduled; online multiplayer was promoted into week-one scope; a baseline constants table gives day 1 real numbers; a tone paragraph gives day 0 real criteria; day 5 became an integration and performance gate; and a ranked cut list decides in daylight what dies if the week runs long.*

*Changes since, from technical review: PixiJS replaces Three.js; collision is hand-written circles with no physics engine; multiplayer runs on a dedicated authoritative server, with the host chosen by a day-0 spike rather than assumed; a Netcode Engineer was split out as the eighth agent; and six risks are named with mitigations. Scope was cut to exactly one platform — a browser game, online and offline. There are no stretch goals in this document.*

*Changes in v0.4: mobile/cross-platform play added as first-class scope — touch controls (dynamic twin sticks; Manual and Auto-aim fire modes with mode-morphing right-side control), PWA installability with a Capacitor-ready platform seam, a formal playable-milestone definition with phone-verification and ntfy pings, a mobile performance gate, a reconnect-grace rule for drop-prone mobile connections, and a seventh named risk (mobile browser quirks). Multiplayer architecture re-evaluated against Photon/Nakama/gRPC alternatives and reaffirmed: authoritative TypeScript WebSocket server, one deterministic codebase.*

*Changes in v0.5: the schedule is milestone-based — M0-M7 replace calendar days; the one-week window is retired in favor of scope-bounded, playable-increment gating. No mechanical changes.*

*Changes in v0.6 (consolidation): every ratified build-time amendment is folded back into the sections above, in the GDD's own voice, each marked "(amended)"; the ratification history and the "why" stay in `docs/design-amendments.md`, `docs/variable-slots-plan.md`, and `docs/input-parity.md`. The mechanical changes folded: **combat and mining are one dodgeable projectile** — the hitscan beam is retired, shots have travel time, and auto-aim, bots, and turrets all lead a moving target (§1, §2.3, §2.4, §2.6, §2.9, §4.1); **weapon upgrades split into DAMAGE and SPEED** (§2.5); **repair is a discrete purchase** — 1 ore restores 15 core HP, no channel, no interrupt (§2.5, §2.6, §2.8); **turrets are upgradeable Mk I→III** with tier-scaled lead/accuracy, every mark kept under the ship's weapon reach (§2.5, §2.6, §2.8); **banking is by atmosphere** — the hold auto-drains inside your own planet's atmosphere, no dock-and-park (§2.3, §2.5, §2.8, §2.10); **two modes (FFA / Teams) over a slot model** (open / bot / closed), variable 2–8 size, friendly fire off, rooms advertise their config (§1, §2.1, §2.9, §4.2); **four maps, fair at every N**, with lootable derelicts filling the unused slots on compass/diamond at small N (§2.1, §2.7, §4.3); **the damage-ring grammar** — owner-colour ring, threat-red fills as HP is lost, shields before core (§2.2, §5.4); **boost and minimap ping are cut** from the game entirely (§2.2, §2.4, §4.9); **the input-parity principle** — every action reachable from every input source — plus the optional Tap Commander scheme and the minimap toggle (§2.4); **no pause online** — the sim freezes only in an offline match (§2.4, §4.2); and **ore is conserved exactly**, asserted in CI every tick, closing the loot-black-hole class of bug (§2.7, §4.8). No new mechanics were invented in this pass — it only makes the document say what the developer already ratified.*

*Changes in v0.7 (the lore pivot): the fiction is lifted and shifted from "planets" to **mining facilities** on a contested **mining claim** — a fiction-only change with **no mechanical, numeric, or rule change anywhere in the document**. A new §0 fiction glossary fixes the term contract: planet→**station** (a working placeholder; the developer ratifies FACILITY / RIG / STATION / OUTPOST from the PR body), core→**reactor**, atmosphere→the **collection field**, ore-repair→an industrial **reactor patch**, derelict→**abandoned rig**, and the collapse/waves are re-fictioned as the belt's inward **ore surges** and the claim closing in — **"the Crush,"** the one named antagonist the waves and the collapse share. Every GDD section was swept for fiction language; mechanics text, the baseline constants (values and row names), and all code identifiers were left untouched (code keeps `planet` and `core`). The player-facing string swaps are enumerated for the UI agent in `docs/lore-copy-sweep.md`. Open lore follow-ups, each a developer/Art call, not this pass's job: the game **title** "Planet Rush" is kept as the brand (§0); whether facilities gain industrial art dressing beyond the claimed-planetoid body is an Art follow-up (§5.4); and `style-guide.md` + `docs/mobile-cross-platform-amendment.md` still speak the old planet fiction and need the same sweep next pass.*

*Open questions for the build: exact wave pacing curve, whether spectators get a ghost-ping ability, and cross-team alliance signalling in large matches. (Two docs outside the GDD still carry stale references the consolidation could not touch under this brief's write-scope: `style-guide.md` says "repair channel" and underspecifies the damage-ring fill grammar, and `docs/mobile-cross-platform-amendment.md` still lists boost and minimap-ping as live — both should be reconciled by the Director/Art next pass.)*
