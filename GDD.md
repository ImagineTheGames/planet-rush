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
**Loss condition:** Your station reactor's HP reaches zero — **and in Teams that ends *your* match, not just your side's** *(amended 2026-08-05 — "if your core dies you are out," developer ruling; see §2.7 and `docs/team-bots-plan.md` §8 Q1)*. Your **side** plays on for as long as any ally's reactor still stands, and the side is eliminated when its last one dies; but the player whose own reactor died is out from that moment — no respawn, no ship, no controls, and the Rematch/spectate buttons of §2.7. *(This sentence previously read "in Teams, your whole side is eliminated when its last reactor dies," which contradicted §2.7 and the shipped simulation by implying a player keeps flying while their team lives. §2.7 stands; the side-level rule above is the part that was right.)*

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

### 2.2 What the player sees *(amended 2026-07-27 — damage-ring grammar; boost/ping cut; amended 2026-08-05 — the side label over every hull; amended 2026-08-07 — the alarm sounds ONCE per engagement and only for your side's station, and the arrow carries the duration; see `docs/design-amendments.md`)*

The camera follows the player's ship from above. The HUD shows only what the player acts on. On screen at all times: the ship at center; **ore at a glance** (top left) — filled squares for what's in your hold, one square per cargo slot so upgrades visibly widen it, flashing when full, above your banked **ORE** total — *and the top-left readout is captioned `ORE` in so many letters (amended 2026-08-07: "should not say total, it should say ORE"; it read `TOTAL`, then briefly `BANKED`). The number under that caption is the **bank alone** and did not change; the Build wheel's hub prints hold + bank under a caption that also reads `ORE`, so the two can differ on screen at once — flagged in `docs/design-amendments.md`*; **your own station's HP** (top right, in your player color, mirrored as a bar over the station itself); a narrow **hull bar in the owner's color floating over every ship**, yours included; the **ASTEROID WAVE clock** (top center) naming the wave number, the countdown to the next one, and match time; the Build & Upgrade wheel when near your own station; a minimap (bottom right); and a **controls strip** along the bottom edge listing the active device's bindings. The controls strip is desktop-only — on touch, the visible controls (2.4) replace it entirely.

**In Teams, every name label carries its side, in words (amended 2026-08-05).** Beside each ship's and each owned station's name sits `FRIENDLY A` / `ENEMY B` — the viewer-relative wording of §2.1, tinted blue or red as reinforcement, one step dimmer than the name so it reads as the side rather than as the player. This is a HUD *mechanic*, not decoration: it exists because a Teams match was played in which it was "impossible to know who is on your team," and colour alone could not answer that. Free-for-All draws no side label, character for character as before.

Ship stats — weapon, engine, cargo, hull tiers — are deliberately **not** on the HUD. *(Amended 2026-08-05: they appear on **two** screens, neither of which is the HUD — the upgrade panel during the match, where they are a spending decision rather than clutter, and the lobby's ship-select before it, as pips **and** numbers. See §2.5 and §2.11.)*

**Enemy station health is scouted, not broadcast.** You never see other players' HP bars from across the map — a rival station's health appears as a damage ring over that station only when your ship flies within sensor range of it. Knowing who is winning, who is wounded, and who is under siege is information you *earn* by scouting (or by reading the smoke — a burning station is visible from further away than its numbers are). This is deliberate: a global HP scoreboard would let everyone free-ride on every attack; fog makes third-party awareness a skill.

**The damage-ring grammar (amended).** Every health ring — the reactor's and each shield layer's, yours and a scouted enemy's — reads by one rule: a **whole ring in the owner's color is the health that remains**, and a **threat-red segment fills it clockwise from twelve o'clock, proportional to the health *lost*.** A fully red ring is death, exactly. Because the reactor and its shields share the primitive, a besieged station reads outermost-first — **shields redden and die before the reactor begins to fill** — and red is *only ever damage*, never the station, so an enemy home still reads in its owner's color while it burns. (This corrects an earlier build where the ring read backwards — a shrinking red arc for HP remaining.)

Two elements of this HUD are *mechanics, not polish*, and are specified here so they cannot be cut as decoration:

- **The under-attack alarm.** When your reactor, shield, or turrets take sustained damage (not a single stray shot — a taunt-tap must not trigger it), you get an unmistakable alarm plus a screen-edge arrow pointing home. The whole design turns on the moment you're deep in the asteroid field and this alarm fires: the triangle decision, made audible.

  **The sound announces; the arrow sustains** *(amended 2026-08-07 — "also for the alarm, it should only play once, and not keep playing (and should only play for your station not others)…", developer, from real play; see `docs/design-amendments.md`)*. The alarm **sounds once per engagement** — one klaxon when the sustained-damage pressure first crosses the trigger — and does **not** repeat for as long as the siege lasts; it sounds again only after it has released and a *new* attack re-engages it. The minimum hold and the lower release threshold keep their numbers and become the **re-trigger guard**, so an attacker who dodges out and comes straight back cannot machine-gun the klaxon. What that moves is which half of this sentence carries the *duration*: the **screen-edge arrow remains for the whole attack**, and is therefore no longer decoration paired with the sound but the standing half of the tell. Both halves are still mechanics and neither is cuttable (§4.9). Music and SFX duck for the **sting**, not the siege — a mix pinned down under an alarm that is no longer sounding is quiet for nothing.

  **It is your side's alarm, and nobody else's** *(same amendment)*. It rings only for damage to a station on **your own side** — your home, and in Teams an ally's — never for an enemy's or a neutral's, and never for the endgame's core decay, which is the claim closing in rather than an attacker (§2.3). "Your side" is read from the same allegiance table the whole simulation asks (§2.1), on the seat **the server actually seated this client at** — not the seat the client assumed at boot.
- **Onboarding prompts** (section 2.10).

Asteroids visibly crack as they're mined and burst into ore chunks that drift toward nearby ships.

### 2.3 Core loop *(amended 2026-07-27 — projectile mining, atmosphere deposits; see `docs/design-amendments.md`)*

1. **Mine.** Fly to the asteroid field and hold fire on an asteroid. **The same projectile that bites a hull chips a rock into ore chunks** (amended) — one weapon, one trigger, and whatever the shot reaches first decides which payload applies — chunks tractor-collected automatically by proximity. Your hold starts small — 2 ore — and grows only if you buy cargo upgrades; when it's full, chunks stay where they are for anyone. You decide how full to run: dart home early or risk hauling a full hold. Die and you drop half your hold where you exploded.
2. **Spend.** Fly home and convert ore into defenses, repairs, or ship upgrades — or bank it. **You bank simply by flying into your own station's collection field** (amended): while your ship is inside that radius, the hold drains steadily into the safe banked total — no docking, no parking — and stops the instant you leave; ore chunks visibly courier from ship to station, one per unit banked. Docking closer still opens the Build & Upgrade wheel, whose BANK segment dumps the whole hold in one tap. Banked ore is safe; held ore is not.
3. **Fight.** Besiege rival facilities or intercept enemy miners in the contested field.
4. **The clock ticks.** The field's total yield is finite. Ore arrives in five timed **asteroid waves** — surges of the collapsing belt, named in full on the HUD so no player has to guess what is being counted — each spawning closer to the map center than the last, pulling every surviving player into a smaller and smaller contested space. After the final wave the claim closes in — **collapse phase** — no shield regeneration, no repair, no new ore. The match cannot stalemate; the ruleset guarantees an ending.

The loop is a triangle — mine / defend / attack — and every death, upgrade, and turret shifts where a player should be on it. That decision, made every few seconds with one ship, is the game.

### 2.4 Controls and actions *(amended 2026-07-27 — boost/ping cut, the parity principle, Tap Commander; amended 2026-08-06 — the CONTROLS settings row names the DEVICE, not the internal scheme name; see `docs/design-amendments.md` and `docs/input-parity.md`)*

All input is expressed as abstract *actions*, so the simulation never sees a device. The abstract set is **six verbs** — thrust, aim, fire, build, buildOrder, upgradeOrder (amended: an earlier build added a boost and a ping verb; both were cut, so the sim's whole vocabulary is these six):

| Action | Keyboard/Mouse | Gamepad | Touch |
|---|---|---|---|
| Thrust / steer | WASD | Left stick | Left virtual stick |
| Aim | Mouse cursor | Right stick | Right virtual stick (Manual mode) |
| Fire / Mine | Left mouse button | Right trigger | Right stick engaged, or hold-to-FIRE button (Auto-aim mode) |
| Open Build & Upgrade | E (near own station) | Y / Triangle | BUILD button near own station |

Gamepad support ships via the browser Gamepad API and is not on the cut list.

**The parity principle (amended).** Input parity is not an accident: **every abstract action must be reachable from every input source** — keyboard/mouse, gamepad, and touch — or be explicitly N/A with a reason. The sim sees the action union, never a device, so a control that "only exists on PC" is a hole in the table, not a device quirk; a CI test fails the build if any cell regresses. The same principle governs *modes*, not just verbs: the Manual/Auto-aim fire mode is a player choice on every platform with no fairness gating (below), and the offline and online sim run the identical code — the only sanctioned divergence is that an offline match may pause and a networked one may not (§4.2).

**What the CONTROLS row says — the device, never the internal name (amended 2026-08-06).** The settings screen's CONTROLS row used to print the default scheme's *internal* name, `STICKS`, on every device, and a developer screenshot caught it on a PC: *"this is wrong for pc, it should be KEYBOARD + MOUSE or MOUSE ONLY and not sticks (there are no sticks, unless someone is playing with gamepad… then wen can call it TWIN STICKS (but only if gamepad detected)."* The row now names the hardware in front of the player: **`STICKS` on touch** (the virtual sticks are real and on the glass), **`TWIN STICKS` when a gamepad is genuinely detected** — connection, not last use, and a disconnect reverts it — and **`KEYBOARD + MOUSE` on a desktop without a pad**. Not "MOUSE ONLY": the binding table above gives thrust as `WASD`, so a player cannot move without the keyboard and that wording would swap one false label for another. `TAP COMMANDER` is unchanged on every device. **This is a wording change and nothing else** — a lift-and-shift exactly like the lore pivot: the scheme's internal name, the `ControlScheme` type, and the persisted `planet-rush:controlScheme` value all still say `sticks`, because renaming the stored value would seat an unknown scheme for anyone who has already saved a preference. It supersedes p6-01's flat "CONTROLS: STICKS / TAP COMMANDER" wording wherever this document repeats it (see §5.7's fixed-string list).

**Tap Commander — an optional alternate scheme (amended).** Ratified as an opt-in scheme (settings: "CONTROLS — Sticks / Tap Commander," persisted like the fire mode; the row's player-facing *word* for the default scheme is per-device since 2026-08-06, above): **tap a spot to fly there, tap a target to attack it** — enemy, turret, reactor, or (because a rock is just a target) an asteroid to mine it; tap your own station to fly to its collection field or, in range, open the Build wheel. It is *not* a fourth device and *not* a new verb — a local pilot converts the player's standing order into the same thrust/aim/fire the sticks produce, so the six-verb contract is unchanged. The default scheme is the twin sticks. A **minimap toggle** (small corner ⇄ centered overlay; the `M` key on desktop, a tap on touch) is likewise a HUD control reachable identically on both platforms, not a sim verb.

**The controls strip** runs along the bottom of the screen at all times: keys in signal yellow, actions in grey, swapping automatically when the player picks up a pad. It reads its labels from the same action map that drives the simulation, so it can never drift out of sync with the real bindings.

**Touch controls.** Two dynamic virtual sticks — one per screen half, appearing under the thumb wherever it lands rather than pinned to a fixed position. The left half is always thrust/steer. The right half morphs with the player's fire-mode setting (below): in Manual mode it is an aim stick that fires while engaged — aim and fire are one gesture, matching the game's central idea that your gun is your mining tool; in Auto-aim mode it is replaced entirely by a hold-to-FIRE button, and no aim stick is shown. A dedicated BUILD button appears near the player's own station (the E-equivalent); menus and Rematch are plain taps. (Amended: the boost button and the minimap-ping tap are gone — both mechanics were cut.) On touch, the controls strip (2.2) is not shown — the visible controls themselves are the binding legend, and onboarding prompts (2.10) get touch-specific wording through the same input-agnostic action-mapping layer.

**Fire modes.** Fire mode — Manual or Auto-aim — is a player setting on every platform, not a touch-only concession: on desktop and gamepad it governs whether aiming is manual (mouse cursor / right stick) or the weapon auto-targets while fire is held. In Auto-aim, the weapon engages the nearest valid target — asteroid, ship, turret, shield, or reactor — within weapon range, checked across the full 360° around the ship, no front-arc restriction (`TUNABLE`); the player decides *when* to fire, positioning decides *what* gets hit. Because the weapon is now a travel-time projectile (amended, §2.3), auto-aim **leads a moving target** — it fires where the target is going, not where it is — so an orbiting enemy can still be hit, and a smart strafe can still slip a shot. The default differs by platform because the best first-run experience differs by platform: Manual on desktop and gamepad, Auto-aim on touch — changeable at any time from settings or the pause menu.

### 2.5 Building, repair, and upgrades *(amended 2026-07-27 — discrete repair, turret tiers, the DAMAGE/SPEED weapon split; amended 2026-07-28 — 15-second repair cooldown; amended 2026-08-05 — the upgrade panel is no longer the ONLY place ship stats appear: ship-select carries them too, as pips AND numbers; **amended 2026-08-06 — every capped wedge shows its count over its cap; the upgrade wheel takes the same grammar and pips each track's ladder position**; **amended 2026-08-07 — a build wedge's cost is ONE number again: the cost, yellow if payable and red if not. The `cost/held` half of the 2026-08-06 amendment is RETRACTED by the developer**; see `docs/design-amendments.md`)*

Everything is bought from one place: the **Build & Upgrade wheel**, opened at your own station. Five segments, each labeled in words and each naming its target — TURRET, SHIELD, **REPAIR REACTOR**, **UPGRADE SHIP**, BANK — with your live ore total in the hub. Four spend on your **station**, one on your **ship**; the economy is the choice between those two, so every label names which.

**The only number on a segment is its cost** — with one ratified exception. No rates, no HP-per-ore, no effect text — a bare "3" under TURRET, a bare "1" under REPAIR REACTOR. The exception (amended): **REPAIR REACTOR also shows the HP a tap will restore**, because a discrete repair (below) heals a fixed chunk and a player patching a nearly-full reactor should see that the whole ore still buys only what's missing. The wheel says what a thing costs and what it acts on; the game teaches what it's worth. Four segments spend immediately; **UPGRADE SHIP** carries an arrow marking it as the one that opens a second screen — the upgrade panel, which shows a ship's current value → next tier → ore cost. The controls strip names the key "BUILD & UPGRADE," never just "BUILD," because a player who doesn't know upgrades exist will never look for them.

**What a wedge says, and what it still may not *(amended 2026-08-06 — the ratified Gantry/Bone build wheel, `docs/design/gantry-bone-handoff.md`; executed by u7-02. Amended again 2026-08-07 — the first bullet below is the developer RETRACTING their own 2026-08-06 wording; executed by a0-03)*.** The developer ratified the design's build-wheel screen, and it settles two things this section previously left the wheel poorer for:

- **The cost is ONE number — the cost — and its COLOUR says whether you can pay it *(amended 2026-08-07)*.** A wedge reads `5`, not `5/2`: **signal yellow when the price is payable, threat red when it is not** (`style-guide.md` §2.1, which is unchanged — the same carve-out, the same two colours). For one day this bullet read *"the cost reads `cost/held` — `3/4`, `5/4`,"* on the argument that restating the hub's live total at the point of decision is what lets the wheel drop any "you need 2 more" copy. The developer withdrew it looking at the shipped screen: *"i was wrong about this we don't need to show ore need as 5/2 .. just need the needed amount in yellow, and red if insufficient."* The colour was already carrying that message; the denominator was a second, dimmer copy of it, and of a number the hub prints anyway. So this section's older sentence — *"the only number on a segment is its cost"* — is once again true character for character, and the hub is once again the one place the wheel says how much ore you have.
- **Every capped wedge shows its count over its cap** — `2 / 4 BUILT`, `0 / 2 BUILT`, `0 / 1 BUILT`. **Untouched by the 2026-08-07 retraction, which points only at the cost numeral.** Previously only the radar satellite did this, and turret and shield capped *silently*: the wedge greyed out and the player was left guessing whether the ring was full or the bank was empty. Two per-station caps are design rules (above), so they are worth showing; and because **the count includes queued construction**, the number a player reads is exactly the number the cap is enforced on. It is also the re-arm tell — when a turret is shot down the count drops and the wedge lights again.

**Neither is a number on a segment, and that distinction is load-bearing.** The count ships as a *label* — a string, not a number — and so does the cost line, because `FULL` shares its slot. The rule this section states — a segment's only number is its cost — is what stops a rate, a DPS, or a stat leaking onto the wheel, and it is enforced structurally (`src/ui/build-wheel.test.ts` asserts a segment's numeric fields are exactly its angle and its cost, and that no cost label contains a `/`). The wheel gained one line of copy and no new number. **UPGRADE SHIP still carries its arrow rather than a price**, and the wheel is still the only place a player buys anything.

**The upgrade wheel says it almost the same way *(amended 2026-08-06 — same ratified direction, executed by u7-06; the first bullet flagged OPEN 2026-08-07)*.** The screen behind UPGRADE SHIP is the same radial control, so it speaks the same grammar rather than a second one a player has to learn between two presses — with one clause now out of step with the wheel in front of it, marked below:

- **Its cost reads `cost/held`** — `12/8`: what the next tier costs over what the player can actually spend, so a dimmed track says why it is dimmed where the decision is made rather than in the hub at the other end of the screen. A finished ladder quotes **`MAX`** where a capped build wedge quotes `FULL` — no price, because there is nothing left to buy. **⚠ OPEN, flagged 2026-08-07 by a0-03 and not resolved by it.** The 2026-08-06 wording of this bullet was *"exactly the change above, for exactly the reason above"* — and "the change above" has since been retracted for the build wheel. The developer's retraction came with a screenshot of the *build* wheel and names only that screen's numerals, so a0-03 changed only that screen; but `style-guide.md` §2.1 is explicit that the two wheels are **one control** a player crosses in a single press, and a grammar that changes across that press is the drift that section exists to prevent. Either this bullet loses its denominator too, or it needs a reason to keep one. **The developer's call, on the two screenshots in a0-03's PR.**
- **Each track shows its position on its ladder, as pips** — `●●○`. Not a new idea: this wheel already drew exactly that on its WEAPON wedge, summarising the two tracks behind it. It just did not draw it for the tracks in front of it, so a player could see how many DAMAGE rungs were left and not how many ENGINE ones were. "How much of this ladder is left" is half of a comparison between two upgrades, and this is the screen where that comparison is made.
- **The WEAPON wedge says `OPEN ▸`**, in the cost slot, in the same words and the same place as UPGRADE SHIP on the wheel in front of it. Both mean "there is another screen behind this"; they should not look different.

**And nothing here is a new number either.** Every line above ships as a *label* — the stat line, `cost/held`, the pips — so an upgrade wedge's numeric fields are still exactly what they were: its cost, its tier, its ladder length and its angle (`src/ui/upgrade-wheel.test.ts` asserts it). What the panel has always shown it still shows: **current value → next tier → ore cost**, unchanged. The prices themselves are no longer a second copy of the simulation's table — the wheel reads `UPGRADES` directly, so it cannot print a price the sim does not charge.

**Where ship stats appear — two screens now, not one *(amended 2026-08-05)*.** This document used to say the upgrade panel was "the only place ship stats are ever shown." It is not, and has not been since the developer was asked whether ship stats could appear on the lobby's ship-select screen and answered: ***"both pips and numbers."*** So there are exactly two places, and they answer different questions:

- **Ship-select, before the match** (the lobby's four hull tiles, §2.11) shows each hull's stats **as pips AND as numbers, together** — a coarse five-pip bar so four hulls can be compared at a glance, and the actual figure beside it for the player who wants it. Never one or the other; the bar answers *"which of these is the fast one?"* and the figure answers *"by how much."* This is a **comparison**, made once, before the match.
- **The upgrade panel, during the match** (above) is unchanged and shows what it has always shown: current value → next tier → ore cost. This is a **spending decision**, made repeatedly, against turrets and repair.

Two rules keep this from becoming clutter creep. The stats on ship-select are read from the **simulation's own class table**, never a hand-copied one — a screen that prints a stat the sim does not implement is worse than a screen with no stats. And the **Build & Upgrade wheel is untouched**: a segment's only number is still its cost (plus REPAIR REACTOR's ratified HP exception above), and UPGRADE SHIP still carries an arrow rather than a number. "Stats are allowed on ship-select" is a statement about ship-select.

Built at your own station, paid in ore. **Construction takes time** — a turret assembles over ~10 seconds, a shield over ~15, a radar satellite over ~12 — so defenses are bought before the attack, not during it. Per-station caps (baseline: 4 turrets, 2 shields, **1 radar satellite** *(amended 2026-08-05 — the cap for the ratified radar satellite, feature f1, had no home in this document; the mechanic shipped in `src/sim/buildings.ts` and is unchanged by this amendment)*) are design rules, not renderer limits. **Queued construction counts against a cap**, so a player cannot buy past one by ordering several on the same tick — and neither can a bot (§2.9).

- **Turret** (cheap): auto-fires at enemies in range. Deterrent, not wall — see 2.6. **Turrets sit on a three-rung ladder — Mk I → Mk II → Mk III (amended):** the TURRET segment builds turrets until the ring is full (cap 4), then *upgrades the weakest standing turret* one mark. Each mark is tankier, harder-hitting, faster-firing, slightly longer-ranged, and better-aimed than the last — so a turtle can pour ore into a fortress ring, but a fully-Mk III ring of four costs most of a player's share of the field. The one invariant the ladder never breaks: **every mark's range stays under the ship's weapon reach**, so the pick-off skill of §2.6 exists at every tier.
- **Shield generator** (medium): a regenerating bubble over the reactor; regenerates only after ~8 seconds without taking damage; stacks to two.
- **Repair reactor** (cheap per tap): repairs your **station's reactor**, never your ship — **a discrete purchase, not a channel (amended).** One press of the REPAIR REACTOR segment spends **1 ore and restores 15 reactor HP**, clamped at the reactor max, resolving in full the instant it's bought. There is no continuous drain and no interrupt — a hit landing *after* a repair cannot undo HP already banked into the reactor. **Each repair then puts that reactor on a 15-second cooldown (amended 2026-07-28): the segment refuses the next repair on the same station until the cooldown expires, and the wedge counts the seconds down live ("REPAIR in 12s") before re-arming to "+15 HP / 1 ORE".** The cooldown is **per station, not per player**, so an ally patching a shared reactor waits on the same clock, and it makes repair a *rationed emergency patch* rather than a heal-tank tapped every frame. Ship hull is not repairable at all: ships are cheap and respawn free. "Pressure beats regeneration" (§2.6) still holds — through the *finite ore pool* (every HP bought back is a turret or upgrade not bought), the repair cooldown itself, and, for AI defenders, a pacing tell so that a reactor taking fire cannot resume repairing. Repair money is money not spent on turrets or upgrades — and repair time is time not spent mining or attacking. (Collapse still shuts repair off for good, §2.3.)
- **Ship upgrades** (escalating cost): **weapon**, now split into two tracks — **DAMAGE** (per-shot bite, which is also mining speed: one weapon, one stat) and **SPEED** (projectile muzzle velocity, so a faster shot is a harder-to-dodge shot) — plus engine speed, cargo capacity (base hold 2, +2 per tier), hull HP (amended). Upgrades persist through respawn. Bought from the **upgrade panel** — the one screen where ship stats are shown *during a match* (ship-select shows them before it, above), each row giving current value, next tier, and ore cost, so upgrading is an explicit trade against turrets and repair. Upgrades *multiply* the class base stats (2.11), so a maxed Interceptor is still the fastest thing on the map and a maxed Hauler still the toughest. Every ore in the hold has five competing uses — turret, shield, repair, ship upgrade, or the bank — and that spending decision, repeated all match under time pressure, is the strategy layer.

### 2.6 Siege balance: how a station actually dies *(amended 2026-07-27 — turret tiers & lead, dodgeable projectiles, discrete repair; see `docs/design-amendments.md`)*

The board's hardest question, answered as design rather than tuning:

- **Turrets deter; the ship defends.** A patient attacker can pick off turrets from the edge of their range — slowly, and while visibly ringing the owner's alarm; **this skill survives every turret mark, because no mark out-ranges the ship's weapon (amended, §2.5).** But turrets fighting *alongside the defender's ship* focus fire and kill attackers fast. **Turret shots have travel time and lead their target** (amended): a low-mark ring aims loosely and re-reads a mover slowly, so a strafing attacker can make it miss — *upgrading a turret buys accuracy as well as bite*, and a Mk III ring tracks an orbiter far better than a Mk I one. An undefended station falls to a determined siege; a defended station is nearly uncrackable one-on-one.
- **Pressure beats regeneration.** Shields regenerate only after 8 undamaged seconds. A repair tap can no longer be *interrupted* (repair is a discrete purchase now, §2.5) — but every tap is an ore spent from a *finite* pool, and a defender pinned under fire is spending ore to stand still rather than to win; a well-aimed enemy keeping shields down still out-paces a defender's patch-ups. To recover, the defender must drive the attacker off first.
- **Two beats one.** Because sustained pressure keeps shields down, two attackers can crack what one cannot. In an 8-player match this is where temporary, unspoken alliances come from — and why being the leader is dangerous.
- **The economy is the siege engine of last resort.** Every turret, shield, and repair is paid from a *finite* ore pool. A turtle spends ore to stand still; when the field runs dry and collapse begins, the stockpile that was spent on staying alive is gone, and nothing regenerates.

The intended shape: attacking an occupied station is a mistake, pulling the owner away (or waiting for the alarm to go unanswered) is the skill, and the endgame belongs to whoever managed the clock best.

### 2.7 Death, respawn, and debris *(amended 2026-07-27 — lootable derelicts, ore conservation; see `docs/design-amendments.md` and `docs/variable-slots-plan.md`)*

Respawning is **free and fast** (5 seconds at your home station, upgrades intact) — the cost of dying is *time and position*: half your held ore drops where you exploded, and you respawn far from wherever you were needed. Banked ore is never lost to a ship death.

When a station's reactor is destroyed, its owner is eliminated and gets an immediate **Rematch** button (plus spectate if they want to watch). **This holds in Teams** *(amended 2026-08-05 — see §1)*: a player whose own reactor dies is out even while their side plays on, so a 2v2 can become two ships against one while both sides still hold a reactor. The dead station leaves a **wreck** that persists for the rest of the match, surrounded by ore-laden debris that *anyone* can scavenge — funded by the dead player's own banked fortune, so the thing they were saving becomes the thing their killers fight over. Small cargo holds mean nobody hauls a dead player's fortune away in one trip — wreck sites stay contested, and fights over a fresh wreck are a feature, not a bug.

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

### 2.11 Ship classes *(amended 2026-07-27 — "one weapon, one stat"; amended 2026-08-05 — the lobby's hull tiles now SHOW this table, as pips and numbers; see `docs/design-amendments.md`)*

Players choose a hull in the lobby; the choice is locked for the match and sets all five core attributes: **top speed, acceleration, turn rate, armor (hull HP), and weapon power** (which is also mining speed — one weapon, one stat). Four classes ship in core scope. Baselines are opening hypotheses (TUNABLE), relative to the Vanguard:

| Class (hull) | Role · Speed / Accel / Turn / Hull / Power / Cargo |
|---|---|
| Interceptor (Quadfin) | Scout, miner-hunter · 130% / 120% / 140% / 35 / 8 / 2 |
| Vanguard (Anvil) | All-rounder, onboarding default · 100% / 100% / 100% / 50 / 10 / 2 |
| Excavator (Pincer) | Mining engine, close bruiser · 90% / 100% / 80% / 55 / 13 / 2 |
| Hauler (Hammerhead) | Logistics, siege tank · 85% / 80% / 85% / 70 / 9 / 3 |

**The lobby shows this table *(amended 2026-08-05 — supersedes "no ship stats on ship-select")*.** Each hull tile in ship-select carries these six columns for its own hull, every one of them as a **pip bar and a number at the same time**: the bar is scaled across the four hulls, so the roster's slowest reads one pip and its fastest reads five and a player can rank four tiles without reading a digit; the number beside it is the figure itself, so nothing is hidden behind a coarse bar. Both are derived from the same value, read out of the simulation's class table, so a tile can never show four pips beside a number that means three. Where a phone tile is too short to carry everything, it gives up its role blurb first and its hull nickname second — **never its stats**. The four hulls' identity is still carried by silhouette and by the words on the tile (§5.3); the stats are what let a player compare rather than guess.

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

### 4.7 Tone and voice: what the game feels like, and what it says *(amended 2026-08-05 — the section now names **two registers**: the emotional tone, and the **interface voice**. The execution inventory is `docs/copy-sweep-industrial-voice.md`. **Amended 2026-08-06 — the tone paragraph itself is replaced: the register is now clean, modern, futura sci-fi, not Saturday-morning cartoon. The ache is untouched. The audio execution list is `docs/audio-revoice-spec.md`; the VFX and bot-naming consequences are explicitly UNRATIFIED and listed there as open questions.**)*

Before production, the Art & Audio Agent runs the M0 concept mode, delivering instantly viewable HTML/SVG artifacts: two to three **theme boards** showing the *same* scene (ship, defended station, asteroid field, HUD, open build menu); **level layout variants** (one SVG, three station-ring/field arrangements — spacing tunes the triangle, since travel time home is the defense tax); and **UI mockups** in the two leading themes.

**Two registers, one game (amended).** This section used to hold one paragraph doing two jobs. It now names both explicitly, because they are judged by different agents against different artifacts and one of them changed:

- **Register 1 — the emotional tone.** What the game *feels* like: art, VFX, audio, pacing, the shape of a moment. Judged against the tone paragraph below. **Amended 2026-08-06 — the register is now clean, modern, futura sci-fi.**
- **Register 2 — the interface voice.** What the game *says*: every word a player reads on a button, a label, a prompt, a refusal, or an end screen. **Ratified 2026-08-05; untouched by the 2026-08-06 tone amendment.**

They are not in tension, and the reconciliation is the point: the game *looks* like machinery and *talks* like paperwork *(amended 2026-08-06 — this line said "looks like a toy"; the tone paragraph it was describing has been replaced)*. A claim office filing a status update while a rig burns is colder than a game shouting "AWESOME!", and the ache in register 1 lands harder when the interface refuses to comment on it. Where the two ever genuinely compete, register 1 wins on **moments** (a death, a wave, an explosion) and register 2 wins on **words**.

#### Register 1 — the emotional tone *(amended 2026-08-06 — clean, modern, futura sci-fi replaces Saturday-morning cartoon; the ache is untouched)*

The boards, and every asset after them, are judged against a **tone paragraph**, written into this GDD so the choice has criteria instead of vibes:

> *Planet Rush is a clean, modern science-fiction brawl: fast, precise, and cold. Ships are machines, explosions are pressure failures, bots are operators with names and habits. But homes are the one serious thing in it — when a station dies, the game goes briefly quiet, the wreck stays on the map all match, and nobody jokes for three seconds. Engineered on the surface, a small ache underneath.*

**Why it changed (amended 2026-08-06).** The paragraph it replaces read *"a Saturday-morning space brawl: fast, bright, and a little cheeky. Ships are toys, explosions are fireworks, bots are cartoon rivals with names… Arcade on the surface, a small ache underneath."* Three ratified decisions had already moved the game off that ground without anyone updating it: the **lore pivot** (§0 — the eight homes are mining facilities on a contested claim, not a playground), the **interface voice** (below — the game speaks as a mining authority, which is the opposite of "a little cheeky"), and the **Gantry/Bone material direction** (machined steel, rivets, bevelled plates). The report that forced the amendment — *"they all sound toony, and not sci-fi, they should have a clean sci-fi sound not this cartoony retro sound.. it needs to be modern/futura"* (developer, 2026-08-05, on the in-match sounds) — is the third symptom of the same stale paragraph rather than an audio defect. The audio implemented §4.7 faithfully and says so in its own source: `src/art/audio/synth.ts` documents the `square` oscillator as *"Hollow and arcade — the default voice of a toy (tone contract, §8),"* and the bank uses `square` 21 times and `saw` 7 times across its 89 voices. Re-voicing without amending this paragraph would have put the audio permanently at war with its own written contract.

**What did NOT change, and cannot be traded away.**

- **The ache, character for character.** The middle sentence is carried over verbatim. The station-death beat — *the game goes briefly quiet, the wreck stays on the map all match, nobody jokes for three seconds* — is a **mechanic of tone, not polish**; it is protected in the mixer rather than in gameplay code, it is not cuttable (§4.9), and a clean palette makes it land harder, not softer. A quiet that follows a precise, cold soundscape is a bigger drop than one that follows a firework.
- **Every mechanic gets a visible AND audible tell** (§3.6, §5.8). Legibility is not what changed. An asset pass that makes two mechanics harder to tell apart has failed this section, not satisfied it.

**What the register is, concretely — this table is part of the contract.** *Clean* means an asset carries the material it needs and no ornament. *Modern* means it reads as equipment built this century, not as a 1980s cabinet. *Futura* is the developer's word for forward-looking: engineered, not retro-futurist. Industrial rather than toy; precise rather than cheeky. Because the paragraph is **pinned into prompts**, vague adjectives fail the test — so the same asset is written out in both registers, and an agent's job is to know which column it is producing:

| Asset | Old register (retired) | New register (this contract) |
|---|---|---|
| A ship exploding | A firework: a bang, then a bright sparkle over the top of it | A pressure failure: a hard concussive front, a metallic shear, debris settling. No sparkle |
| A shot chipping rock | A cartoon chip — a wobbling, chirping tick | A cutting tool on stone: one flat percussive bite, no pitch movement in it |
| A purchase landing | A rising arcade arpeggio, the brightest thing in the bank | Two struck notes rising a fifth — a machine acknowledging, once |
| A refused purchase | A buzzer: the "nope" | Two notes a minor second apart, resolving nowhere |
| A bot | A cartoon rival with a name | An operator with a name, a hull, and habits you learn |
| The under-attack alarm | An unmistakable klaxon | **An unmistakable klaxon.** Legibility outranks register, always (§2.2) |
| A station dying | Briefly quiet, wreck all match, nobody jokes | **Identical.** The one beat this amendment protects rather than restyles |

**Where the register is allowed to lose.** Two rules outrank it, in this order: a **mechanic's legibility** (§2.2's alarm, §3.6's audible tells, §5.4's ring grammar) and the **frozen Cold Vacuum palette** (§5.1 — no new hue enters the game on a tone amendment). An asset that would read better in the new register but worse as information stays as it is, and the trade is recorded so nobody re-litigates it.

**Blast radius — deliberately bounded (amended 2026-08-06).** The developer's report was about **sound**, so this amendment ratifies the register and applies it to **audio only**. The per-sound execution list is `docs/audio-revoice-spec.md`, implemented under s7-02; no sound changed in the amendment itself. The paragraph also governs **VFX** ("explosions are fireworks") and **bot naming** ("cartoon rivals with names"), and both of those consequences are **open, unratified, and must not be acted on** until the developer rules — they are written up as explicit questions in that document. No agent restyles an explosion or renames a bot off this amendment.

The developer picks a winner (one revision round max), frozen into `style-guide.md` — a contract like the interfaces, changeable only through the Director. Concept iteration is deliberately not a standing loop: after M2 the game is playable, and iterating on the real build beats iterating on pictures. Budget: ~1.0 M tokens inside the Art & Audio line.

#### Register 2 — the interface voice *(new, amended 2026-08-05)*

**The ratification.** The UI design handoff proposed that the interface speak as a mining authority — contracts, rigs, operators, seals — rather than as a game menu, and flagged it as a lore call. Asked to decide, the developer's answer was: *"doesn't sound like a question to me."* Read as: it is a given. It is also a natural continuation of the ratified lore pivot (§0) — the eight homes are already mining facilities on a contested claim, so this catches the words up with a decision already made.

**This block is the pinned prompt.** Everything from *"Who speaks"* to *"The clarity rule"* below is injected **verbatim** into every player-facing-copy task, the same way `content/codex/pipeline/tone.md` pins register 1. It is written to be pinnable: concrete enough that two agents writing two different screens produce copy that sounds like one game. Copy work quotes it; it does not interpret it.

**Who speaks, and to whom.** The interface is **the claim's operating authority** addressing a **contracted operator**. Not a narrator, not a coach, not the game. The player holds a licence to work a plot; the interface is the office that issued it. It logs, prices, permits, and refuses. It has no stake in whether the operator wins.

**What the voice IS:**

1. **Procedural.** It states status, cost, condition, and — when it refuses — the reason. Nothing else.
2. **Unglamorous.** No adjective that praises, hypes, or dramatises. `CLAIM HELD`, not `GLORIOUS VICTORY`.
3. **Faintly bureaucratic.** Where a game reaches for the nouns of play (room, level, score), the authority reaches for the nouns of work and paperwork (claim, sector, yield, contract, seal, log).
4. **Terse and present-tense.** Second person, imperative for instructions. The interface has a word budget and spends it on the reason, not the fiction.
5. **Indifferent.** It is not on the operator's side. This — not jokes — is where the game's cheek lives in register 2.

**What the voice is NOT:**

1. **Not congratulatory.** It does not cheer, praise, or exclaim. It never says "Nice", "Great", "Awesome", or "!" — with exactly one sanctioned exception, `RUSH!` (§2.1, GDD-verbatim).
2. **Not menacing.** Indifferent, not hostile. No grimdark, no threats, no "DOOM". The authority does not care enough to menace.
3. **Not chatty and never winking.** No jokes in a string. The humour is structural — the flat voice over a brawl that is anything but flat — not lexical. *(Amended 2026-08-06: this read "over a toy-bright brawl." The joke is the indifference, not the toy, so the amendment costs register 2 exactly one adjective.)*
4. **Not a naval or space-opera register.** The operator is not "Commander", "Captain", or "Pilot". This is a mining company, not a fleet.
5. **Not worldbuilding.** A button never explains the fiction. If a string is teaching lore instead of naming an action, it is the wrong string.
6. **Not decorative punctuation.** No ellipses for mood, no em-dash flourishes where a full stop works. (`—` is fine where it separates a fact from its reason, which is most of the existing copy.)

**The clarity rule — the one that outranks everything above.** **Clarity always wins over flavour.** A player under fire reading a refusal needs the reason, not the fiction. Concretely:

- A refusal names its reason in the **first three words**. `NEED 1 ORE`, `REACTOR FULL`, `REPAIR IN 12s`.
- If the flavour word and the plain word compete on comprehension, **the plain word ships** — and the copy sweep records that it was considered and rejected, so nobody re-litigates it.
- A word a first-time player has to learn before they can act is a bug. The voice may rename the *world*; it may not rename the *verb*.
- **Length is part of clarity.** The HUD runs at 11–15px and nameplates truncate at 12 characters (`NAMEPLATE_MAX_CHARS`). A longer in-register word that ellipsizes has traded information for flavour, which this rule forbids. Measure before you ship it.

**Vocabulary — in and out.** The register's lexicon. Where a word already has a fixed meaning in the §0 fiction glossary, **the glossary wins** (notably: a home is a **station**; a **rig** is hardware or an abandoned derelict, never the player's home).

| Reach for | Instead of | Note |
|---|---|---|
| **claim** (the match's arena and its lobby) | room, arena, level, system | The room-code *noun* stays "code" — see the clarity rule. |
| **operator** (the player) | player, pilot, commander, captain | Bots are operators too; where the interface must distinguish humans from bots, it says so plainly. |
| **contract** (a match you take) | game, session, match-type | "Match" stays where it names the live thing being timed (`MATCH 8:42`). |
| **sector** (a map / arena layout) | map, level | The four map display names are unchanged (§2.1). |
| **yield** (ore abundance) | ore density, richness | `YIELD · RICH`. |
| **seal / signed** (an authorisation stamp) | — | Bound to the allocator's existing ticket stamp (`TICKET SIGNED`). It does **not** replace "code". |
| **station · reactor · collection field · abandoned rig · the claim · the Crush** | planet, core, atmosphere, derelict | Already ratified in §0; listed here so the voice does not reinvent them. |
| **held / lost / offline / refused** | victory, defeat, error, oops | Outcome words are stated, not celebrated. |

**Worked examples — the same string in both registers.** Copy work should be able to tell which column it is writing without asking.

| Game-menu register (wrong) | Interface voice (right) | Why |
|---|---|---|
| `VICTORY` | `CLAIM HELD` | States the outcome; does not congratulate. |
| `DEFEAT` | `CLAIM LOST` | Same sentence shape as the win. The authority files both identically. |
| `You win! Great flying!` | `You took the claim.` | Already shipped and already correct — the flat report *is* the voice. |
| `PLAY SOLO` | `SOLO CONTRACT` | A thing you take, not a thing you do. |
| `CREATE ROOM` / `JOIN ROOM` | `OPEN A CLAIM` / `JOIN A CLAIM` | The claim is the shared object; "room" is a lobby-software word. |
| `WAITING FOR THE HOST` | `WAITING FOR THE CLAIM HOLDER` | "Host" is the network word; the holder is the fiction's word. |
| `Oops! Couldn't find that room 😕` | `No room with that code. Check it and try again.` | Shipped and correct: fact, then instruction, no apology, no emoji. |
| `Nice repair!` (never) | `+15 HP` | The authority prices the work. It does not compliment it. |
| `LEVEL: The Compass` | `SECTOR · THE COMPASS` | The layout is surveyed ground, not a level. |
| `ORE · RICH` | `YIELD · RICH` | "Yield" is the word a survey uses (§2.8, "Field yield"). |

**Where the voice applies.** Main menu; the doors and room-code entry; the lobby (roster, mode/yield toggles, sector picker, ship-select tiles, hints); settings row *titles*; the Build & Upgrade wheel's non-fixed copy and every refusal line; HUD labels; onboarding prompts; the pause menu; end-of-match headlines and cause lines.

**Ship-select is in scope for its words and out of scope for its figures (§2.5, §2.11).** Since 2026-08-05 the lobby's hull tiles carry each hull's six stats as pips **and** numbers, so this is now a screen the voice shares with a block of data. The split is the match/machine line applied literally: the tile's *prose* — its hull nickname and role blurb — is register 2 and already reads that way; the **stat figures, their units, and their pip bars are numbers and are never re-fictioned**; and the **stat row labels obey the clarity rule** — the plain word ships, because a player comparing four hulls in the lobby is doing arithmetic, not reading fiction. A stat label is not an opportunity.

**Where it does NOT apply — the match/machine line.** *The authority speaks about the claim. It does not speak about the machine.* Anything describing hardware, the network, the build, or a developer seam stays **plain and diagnostic**, because when the machine has failed there is no claim to have an authority:

- the wordmark **`PLANET RUSH`** — brand, kept per §0;
- the **build badge / build stamp** (`src/platform/build-info.ts`);
- **boot and WebGL failure copy** (`src/platform/boot-error.ts`) — troubleshooting steps, not fiction;
- **connection and server copy** (`src/ui/connection-status.ts`, `src/ui/online-copy.ts`, region-latency hints) — a dropped socket is a machine fact; only door labels quoted inside these strings move with their doors;
- the **playtest log / COPY LOG** and every debug seam, test id, layout id, and telemetry field;
- **numbers, units, and clocks** — never re-fictioned.

**Fixed strings the voice does not get to revisit.** Each is already ratified elsewhere; re-wording one is a new decision, not a copy pass:

- **`teamName()` — `FRIENDLY A` / `ENEMY B`** (ratified 2026-08-05, §2.1; shipped as u3-01, and §2.1/§2.2/§5.2/§5.7 now carry the folded text). Settled.
- Every **Build & Upgrade wheel segment label** — `TURRET`, `SHIELD`, `RADAR`, `REPAIR REACTOR`, `UPGRADE SHIP`, `BANK` — and every upgrade track name, quoted verbatim in §2.5.
- Every **settings row**: `FIRE MODE` / `MANUAL` / `AUTO-AIM`, `CONTROLS` / `TAP COMMANDER`, `REDUCE VFX` (§2.4, §4.3). *(Amended 2026-08-06 — the CONTROLS row's word for the DEFAULT scheme is no longer the fixed `STICKS`: it is the device in front of the player, `STICKS` / `TWIN STICKS` / `KEYBOARD + MOUSE`, ratified in §2.4 and superseding p6-01. Those three are themselves fixed strings; the voice does not get to revisit them either.)*
- **Pause and end-screen actions** named in §4.2 / §2.7: `RESUME`, `SETTINGS`, `EXIT TO MENU`, `REMATCH`, `SPECTATE`.
- **`RUSH!`** (§2.1) and the slot-state words `OPEN` / `BOT` / `CLOSED` (§2.1).
- **Bot character names, ship class names, player colour names, and the four map display names.**
- **The navigation verbs — `BACK`, `CLOSE`, `DONE`, `JOIN` (the keypad's submit), and `ERASE`.** A player uses these before reading a line of fiction, and every in-register synonym (`RETURN`, `DISMISS`, `FILE`, `SUBMIT`, `RELEASE`) loses on comprehension. The authority renames the world; it does not rename the way out of a screen. This is the clarity rule's floor.
- **`HOME`** on the HUD, and `HOME LOST`. This is the one deliberately warm word in the interface, and it is load-bearing on register 1 — "the pitch is a clock, and a home" (§1). The authority is allowed exactly one word it does not own.

**Accessibility — the voice must never make a state ambiguous.** Non-negotiable, and it is the failure mode of every voice pass:

- An **error or refusal must be readable as a plain sentence** with the fiction stripped out. If deleting the flavour word removes the meaning, the string is wrong.
- **State is never carried by flavour alone.** A player must not have to know what a "seal" is to learn that a seat is unavailable.
- An in-register **headline may only replace a plain one when the line beneath it states the outcome plainly** — `CLAIM HELD` is permitted because `You took the claim.` sits under it, and because colour and layout already carry the result. A headline change that leaves the outcome to inference is rejected.
- Screen-reader and colourblind paths are unchanged: the voice adds no new information channel and removes none. Nothing that was legible without colour becomes dependent on it.

**Propagation.** The tone paragraph is mirrored in two places outside this document — `style-guide.md` §8 and `content/codex/pipeline/tone.md` — because lexical retrieval provably never surfaces a tone section on its own (0/4 query types in the Assignment-4 codex pipeline), so it is pinned by hand. **Both mirrors must gain register 2.** *(Amended 2026-08-06: `style-guide.md` §8 is now current — it carries the new tone paragraph and no longer quotes the pre-pivot "when a **planet** dies" wording. `content/codex/pipeline/tone.md` is **still stale** and still quotes the retired Saturday-morning paragraph; a mirror is quoted verbatim by definition, so a stale one is as damaging as a stale GDD. The replacement text is written out ready to paste in `docs/audio-revoice-spec.md` §9, as a task for the owning agent — the mirrors are the Director's and Art's files, not the architect's.)* Also recorded as a task and a developer question in `docs/copy-sweep-industrial-voice.md`.

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

### 5.4 Facilities *(amended 2026-08-05 — two rings, and only two)*

**Exactly two rings are drawn around your own station, and none around anyone else's.** They mark the only two radii a player has to know: the **collection field** at the deposit radius (§2.3 — inside it your hold banks itself) and the **build ring** at docking distance (§2.5 — inside it the Build & Upgrade wheel is live and the touch BUILD button lights up). Both are affordances rather than information, which is why a rival's station gets neither: you cannot bank there and you cannot build there, so the answer to "where do I unload / where can I build" is only ever drawn around your own home.

They are deliberately different *kinds* of boundary, so neither can be mistaken for the other or for a third rule: the collection field is a soft haze in the owner's colour closed by one continuous band at its edge, and the build ring is short **plasma** dashes — the same colour the BUILD button wears, so the ring in the world and the button on the thumb read as one affordance. Dashes against a continuous band keep them apart with colour removed, as §5.2's identity rules require. **The haze must be a haze:** it is drawn as a gradient, and a gradient whose steps the eye can find is not one soft edge but several hard ones. A developer counted five rings around their station in a screenshot (2026-08-05) and reasonably asked what each meant; the answer was that four of them were banding. Any step in it that reads as its own boundary is a bug, and CI counts them.

A home **station** is a mining installation staking a claimed **planetoid** — the round body is randomised per player from four variants so no two home claims look identical. Oceans are steel-blue and continents patina-green, which keeps the planetoid inside the Cold Vacuum palette instead of importing a second one. The **reactor** stays signal yellow — it is the win condition, so it obeys the yellow rule. Ownership shows as a beacon ring in the player's colour, always visible; health shows as a damage ring, visible only within sensor range (2.2). **The ring grammar (amended, §2.2):** a whole ring in the owner's colour is the health remaining, and threat-red *fills* it clockwise from twelve o'clock as HP is lost — a fully red ring is death; the reactor and its shields share the primitive, so shields redden and die before the reactor begins to fill, and red is only ever the damage, never the station. *(Lore-pivot note: the existing round-body art reads as the claimed planetoid the station sits on; whether facilities gain additional industrial dressing — rigs, gantries, docking arms — beyond that body is an Art follow-up flagged in the lore changelog, not a mechanic and not this pass's job.)*

### 5.5 Turrets and asteroids

Turrets must read as cannons at a glance and telegraph their threat while spinning, and read their mark (Mk I → III, §2.5) as a distinct visual tell. Asteroids are the economy, so they must crack visibly across three stages and let a player judge a payout before committing fire.

### 5.6 Typography

**Audiowide** for the wordmark, headings and menu confirmations — rounded retro-techno, the one face in the shortlist that is playful without being a toy, which is precisely the tone paragraph's brief. **Oxanium** for HUD numerals and body text: it was designed for game interfaces, holds up at 12px, and shares Audiowide's squared geometry without competing with it. Both are OFL licensed and self-hosted in the repo, so they render offline and carry no licence risk (4.5). This document is typeset in them.

### 5.7 The interface

The HUD shows only what the player acts on: ore squares and banked total, the asteroid wave clock, your own station's health, hull bars over ships, in Teams the side each name is on (`FRIENDLY A` / `ENEMY B`, §2.2), and a controls strip that names the active device's bindings. Ship stats are not on the HUD: they live on the two screens named in §2.5 — the upgrade panel in the match, and ship-select before it, where they read as pips **and** numbers *(amended 2026-08-05)*. Enemy station health is scouted, never broadcast.

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

*Amended 2026-08-05 (the interface voice): §4.7 is split into **two named registers** — the **emotional tone** (the tone paragraph, unchanged, judging art/VFX/audio and the shape of a moment) and the **interface voice** (new, developer-ratified: the interface speaks as the claim's operating authority addressing a contracted operator — procedural, unglamorous, faintly bureaucratic, and never congratulatory). The voice block is written to be **pinned verbatim** into every player-facing-copy task, the same way the tone paragraph already is, and it carries a hard subordinate rule — **clarity always wins over flavour** — plus an explicit match/machine scope line (the authority speaks about the claim, never about the network, the build, or a boot failure) and a list of fixed strings the voice does not get to revisit (`teamName()`'s ratified `FRIENDLY A` / `ENEMY B`, every §2.5 wheel label, every settings row, `RUSH!`, the navigation verbs `BACK` / `CLOSE` / `DONE` / `JOIN` / `ERASE`, and `HOME`). **No mechanic, number, or rule changes.** The string-by-string execution list is `docs/copy-sweep-industrial-voice.md`; the two out-of-document mirrors of the tone paragraph (`style-guide.md` §8 and `content/codex/pipeline/tone.md`) still carry register 1 only, and are flagged there. Reconciled on merge with the same day's other two ratifications, both of which landed first and neither of which this one touches: `teamName()`'s `FRIENDLY A` / `ENEMY B` (§2.1, u3-01) is listed among the fixed strings as **shipped**, and **ship stats on ship-select as pips and numbers** (§2.5, §2.11, u4-01) is reconciled explicitly — the hull tile's prose is in the voice's scope, while its figures, units and pip bars sit on the plain side of the match/machine line.*

*Amended 2026-08-06 (the tone contract): §4.7's **tone paragraph is replaced**. The register is now **clean, modern, futura sci-fi** — industrial rather than toy, precise rather than cheeky — in place of *"a Saturday-morning space brawl … ships are toys, explosions are fireworks, bots are cartoon rivals with names … Arcade on the surface."* The trigger was a developer report on the in-match sounds (*"they all sound toony, and not sci-fi … it needs to be modern/futura"*), but the root cause was the paragraph, not the audio: three already-ratified decisions — the lore pivot (§0), the interface voice (§4.7 register 2), and the Gantry/Bone material direction — had each moved the game off that ground without updating the sentence every asset is judged against, and the bank was built faithfully against the stale contract (`src/art/audio/synth.ts` documents `square` as "the default voice of a toy (tone contract, §8)"). **Two things are explicitly preserved:** the station-death beat is carried over **verbatim** — briefly quiet, the wreck all match, nobody jokes for three seconds — because it is a mechanic of tone and not cuttable (§4.9); and the mandate that every mechanic gets a visible **and** audible tell is untouched, so a re-voice that makes two mechanics harder to tell apart has failed §4.7 rather than satisfied it. **No mechanic, number, or rule changes, and no asset changes in this amendment.** §4.7 gains a worked old-register/new-register table so the paragraph stays pinnable, a precedence rule (legibility, then the frozen palette, then the register), and a **bounded blast radius**: the amendment is applied to **audio only** — the per-sound execution list is `docs/audio-revoice-spec.md`, implemented under s7-02 — while the paragraph's **VFX** and **bot-naming** consequences are recorded as **open, unratified developer questions** in that document and may not be acted on until ruled. The `style-guide.md` §8 mirror is updated in the same pass (and loses its stale pre-pivot "when a planet dies" wording); the `content/codex/pipeline/tone.md` mirror is **still stale** and is flagged with ready-to-paste replacement text in `docs/audio-revoice-spec.md` §9.*

*Open questions for the build: exact wave pacing curve, whether spectators get a ghost-ping ability, and cross-team alliance signalling in large matches. (Two docs outside the GDD still carry stale references the consolidation could not touch under this brief's write-scope: `style-guide.md` says "repair channel" and underspecifies the damage-ring fill grammar, and `docs/mobile-cross-platform-amendment.md` still lists boost and minimap-ping as live — both should be reconciled by the Director/Art next pass.)*
