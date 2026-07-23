# Planet Rush
## Game Design Document — v0.4

**Course:** Multi-Agent AI for Game Development — Assignment #01
**Author:** Reinaldo Vieira
**Date:** July 22, 2026
**Status:** Draft v0.4 — revised after a six-agent design review board (see `gdd-review-kit/`), a technical review, and a full art-direction pass. Circulated for feedback. v0.4 adds mobile/cross-platform play (touch controls, PWA, playable-milestone definition, reconnect grace).

---

## 1. Executive Summary

**Planet Rush** is a top-down 2D space arena game for up to 8 players online (AI bots fill empty slots) where every player pilots a single ship and owns a single home planet. Matches last 10–15 minutes and end when only one planet is left standing.

The pitch is a clock, and a home. Your mining beam is also your weapon, so every minute spent carving ore out of the shared asteroid field is a minute you are not defending your planet or attacking someone else's — one ship, three jobs, never enough time. And the stakes are homes: ships are cheap and respawn free, but planets are not. When a planet dies, its wreck stays on the map for the rest of the match, and its ore-laden debris becomes contested loot anyone can scavenge.

Matches are guaranteed to end: the asteroid field's total yield is finite, arriving in waves that spawn progressively closer to the map center, and when the last wave is exhausted the match enters a collapse phase — shields stop regenerating, repair shuts off, and entropy finishes whoever the players don't.

The game ships in one week, built by a team of specialized Claude agents, with all art and audio agent-produced. It runs in desktop and mobile browsers (TypeScript + PixiJS/WebGL, PWA-installable), plays online over WebSockets, and plays offline against bots. Keyboard/mouse, gamepad, and touch are all supported.

**Genre:** Top-down arena shooter with a build-and-defend economy.
**Players:** 1–8 online; AI bots (Easy/Medium/Hard) fill empty slots; fully playable solo and offline.
**Session length:** 10–15 minutes, enforced by the finite ore field and collapse phase.
**Platform:** Web browser, desktop and mobile, played at a URL — installable to the home screen as a PWA. Online and offline.
**Win condition:** Own the last surviving planet core. If the final cores die in the same instant, the core that reached zero last in the simulation's resolution order wins — whoever dies last, wins.
**Loss condition:** Your planet core's HP reaches zero.

---

## 2. Game Mechanics

### 2.1 Match setup

Up to 8 planets are placed in a ring around a central asteroid field. Each player spawns in a ship orbiting their home planet with a small stock of **starting ore** (enough to make one meaningful opening choice: an early turret, a head start on upgrades, or banked safety) and **10 seconds of spawn protection** on ship and core, so no rush can end a match before anyone has flown. A match countdown ("RUSH!") starts the game. Empty slots are filled by AI bots; before the match, the host picks each bot's difficulty. In the lobby, every player also picks a **ship class** (section 2.11) and gets a unique **player color** from the 8-color roster — the color marks their ship trim, beam, shield tint, planet beacon ring, and HP bar.

### 2.2 What the player sees

The camera follows the player's ship from above. The HUD shows only what the player acts on. On screen at all times: the ship at center; **ore at a glance** (top left) — filled squares for what's in your hold, one square per cargo slot so upgrades visibly widen it, flashing when full, above your banked **ORE** total; **your own planet's HP** (top right, in your player color, mirrored as a bar over the planet itself); a narrow **hull bar in the owner's color floating over every ship**, yours included; the **ASTEROID WAVE clock** (top center) naming the wave number, the countdown to the next one, and match time; the Build & Upgrade wheel when near your own planet; a minimap (bottom right); and a **controls strip** along the bottom edge listing the active device's bindings. The controls strip is desktop-only — on touch, the visible controls (2.4) replace it entirely.

Ship stats — beam, engine, cargo, hull tiers — are deliberately **not** on the HUD. They appear only in the upgrade panel (2.5), where they are a spending decision rather than clutter.

**Enemy planet health is scouted, not broadcast.** You never see other players' HP bars from across the map — a rival planet's health appears as a damage ring over that planet only when your ship flies within sensor range of it. Knowing who is winning, who is wounded, and who is under siege is information you *earn* by scouting (or by reading the smoke — a burning planet is visible from further away than its numbers are). This is deliberate: a global HP scoreboard would let everyone free-ride on every attack; fog makes third-party awareness a skill.

Two elements of this HUD are *mechanics, not polish*, and are specified here so they cannot be cut as decoration:

- **The under-attack alarm.** When your core, shield, or turrets take sustained damage (not a single stray shot — a taunt-tap must not trigger it), you get an unmistakable alarm plus a screen-edge arrow pointing home. The whole design turns on the moment you're deep in the asteroid field and this alarm fires: the triangle decision, made audible.
- **Onboarding prompts** (section 2.10).

Asteroids visibly crack as they're mined and burst into ore chunks that drift toward nearby ships.

### 2.3 Core loop

1. **Mine.** Fly to the asteroid field and hold fire on an asteroid. The same beam that damages ships chips asteroids into ore chunks, tractor-collected automatically by proximity. Your hold starts small — 2 ore — and grows only if you buy cargo upgrades; when it's full, chunks stay where they are for anyone. You decide how full to run: dart home early or risk hauling a full hold. Die and you drop half your hold where you exploded.
2. **Spend.** Fly home and convert ore into defenses, repairs, or ship upgrades — or bank it. Banked ore is safe; held ore is not.
3. **Fight.** Besiege rival planets or intercept enemy miners in the contested field.
4. **The clock ticks.** The field's total yield is finite. Ore arrives in five timed **asteroid waves** — named in full on the HUD so no player has to guess what is being counted — each spawning closer to the map center than the last, pulling every surviving player into a smaller and smaller contested space. After the final wave: **collapse phase** — no shield regeneration, no repair, no new ore. The match cannot stalemate; the ruleset guarantees an ending.

The loop is a triangle — mine / defend / attack — and every death, upgrade, and turret shifts where a player should be on it. That decision, made every few seconds with one ship, is the game.

### 2.4 Controls and actions

All input is expressed as abstract *actions*, so the simulation never sees a device:

| Action | Keyboard/Mouse | Gamepad | Touch |
|---|---|---|---|
| Thrust / steer | WASD | Left stick | Left virtual stick |
| Aim | Mouse cursor | Right stick | Right virtual stick (Manual mode) |
| Fire / Mine | Left mouse button | Right trigger | Right stick engaged, or hold-to-FIRE button (Auto-aim mode) |
| Open Build & Upgrade | E (near own planet) | Y / Triangle | BUILD button near own planet |
| Boost | Space / Shift | Left trigger | Button above left stick |
| Ping minimap | Middle click | D-pad | Tap minimap |

Gamepad support ships via the browser Gamepad API and is not on the cut list.

**The controls strip** runs along the bottom of the screen at all times: keys in signal yellow, actions in grey, swapping automatically when the player picks up a pad. It reads its labels from the same action map that drives the simulation, so it can never drift out of sync with the real bindings.

**Touch controls.** Two dynamic virtual sticks — one per screen half, appearing under the thumb wherever it lands rather than pinned to a fixed position. The left half is always thrust/steer. The right half morphs with the player's fire-mode setting (below): in Manual mode it is an aim stick that fires while engaged — aim and fire are one gesture, matching the game's central idea that your gun is your mining tool; in Auto-aim mode it is replaced entirely by a hold-to-FIRE button, and no aim stick is shown. A dedicated BUILD button appears near the player's own planet (the E-equivalent); a boost button sits above the left stick; ping is a tap on the minimap; menus and Rematch are plain taps. On touch, the controls strip (2.2) is not shown — the visible controls themselves are the binding legend, and onboarding prompts (2.10) get touch-specific wording through the same input-agnostic action-mapping layer.

**Fire modes.** Fire mode — Manual or Auto-aim — is a player setting on every platform, not a touch-only concession: on desktop and gamepad it governs whether aiming is manual (mouse cursor / right stick) or the beam auto-targets while fire is held. In Auto-aim, the beam engages the nearest valid target — asteroid, ship, turret, shield, or core — within beam range, checked across the full 360° around the ship, no front-arc restriction (`TUNABLE`); the player decides *when* to fire, positioning decides *what* gets hit. The default differs by platform because the best first-run experience differs by platform: Manual on desktop and gamepad, Auto-aim on touch — changeable at any time from settings or the pause menu.

### 2.5 Building, repair, and upgrades

Everything is bought from one place: the **Build & Upgrade wheel**, opened at your own planet. Five segments, each labeled in words and each naming its target — TURRET, SHIELD, **REPAIR CORE**, **UPGRADE SHIP**, BANK — with your live ore total in the hub. Four spend on your **planet**, one on your **ship**; the economy is the choice between those two, so every label names which.

**The only number on a segment is its cost.** No rates, no HP-per-ore, no effect text — a bare "3" under TURRET, a bare "1" under REPAIR CORE. The wheel says what a thing costs and what it acts on; the game teaches what it's worth. Four segments spend immediately; **UPGRADE SHIP** carries an arrow marking it as the one that opens a second screen — the upgrade panel, the only place ship stats are ever shown (current value → next tier → ore cost). The controls strip names the key "BUILD & UPGRADE," never just "BUILD," because a player who doesn't know upgrades exist will never look for them.

Built at your own planet, paid in ore. **Construction takes time** — a turret assembles over ~10 seconds, a shield over ~15 — so defenses are bought before the attack, not during it. Per-planet caps (baseline: 4 turrets, 2 shields) are design rules, not renderer limits.

- **Turret** (cheap): auto-fires at enemies in range. Deterrent, not wall — see 2.6.
- **Shield generator** (medium): a regenerating bubble over the core; regenerates only after ~8 seconds without taking damage; stacks to two.
- **Repair core** (expensive): repairs your **planet's core**, never your ship — a *channel*, not a purchase. Your ship must sit at your planet while core HP ticks back at a slow rate, consuming ore as it goes (baseline 1 ore per 5 HP — a tuning value, never printed on the wheel). Ship hull is not repairable at all: ships are cheap and respawn free. Any damage to your core or shield interrupts the channel. Repair money is money not spent on turrets or upgrades — and repair time is time not spent mining or attacking.
- **Ship upgrades** (escalating cost): beam power (mining speed and weapon damage — one beam, one stat), engine speed, cargo capacity (base hold 2, +2 per tier), hull HP. Upgrades persist through respawn. Bought from the **upgrade panel** — the one screen where ship stats are shown, each row giving current value, next tier, and ore cost, so upgrading is an explicit trade against turrets and repair. Upgrades *multiply* the class base stats (2.11), so a maxed Interceptor is still the fastest thing on the map and a maxed Hauler still the toughest. Every ore in the hold has five competing uses — turret, shield, repair, ship upgrade, or the bank — and that spending decision, repeated all match under time pressure, is the strategy layer.

### 2.6 Siege balance: how a planet actually dies

The board's hardest question, answered as design rather than tuning:

- **Turrets deter; the ship defends.** A patient attacker can pick off turrets from the edge of their range — slowly, and while visibly ringing the owner's alarm. But turrets fighting *alongside the defender's ship* focus fire and kill attackers fast. An undefended planet falls to a determined siege; a defended planet is nearly uncrackable one-on-one.
- **Pressure beats regeneration.** Shields regenerate only after 8 undamaged seconds, and repair interrupts on any hit — so a defender cannot out-repair an attacker who keeps shooting. To recover, the defender must drive the attacker off first.
- **Two beats one.** Because sustained pressure keeps shields down, two attackers can crack what one cannot. In an 8-player match this is where temporary, unspoken alliances come from — and why being the leader is dangerous.
- **The economy is the siege engine of last resort.** Every turret, shield, and repair is paid from a *finite* ore pool. A turtle spends ore to stand still; when the field runs dry and collapse begins, the stockpile that was spent on staying alive is gone, and nothing regenerates.

The intended shape: attacking an occupied planet is a mistake, pulling the owner away (or waiting for the alarm to go unanswered) is the skill, and the endgame belongs to whoever managed the clock best.

### 2.7 Death, respawn, and debris

Respawning is **free and fast** (5 seconds at your home planet, upgrades intact) — the cost of dying is *time and position*: half your held ore drops where you exploded, and you respawn far from wherever you were needed. Banked ore is never lost to a ship death.

When a planet's core is destroyed, its owner is eliminated and gets an immediate **Rematch** button (plus spectate if they want to watch). The dead planet leaves a **wreck** that persists for the rest of the match, surrounded by ore-laden debris that *anyone* can scavenge. Small cargo holds mean nobody hauls a dead player's fortune away in one trip — wreck sites stay contested, and fights over a fresh wreck are a feature, not a bug.

### 2.8 Baseline constants (day-1 hypotheses, owned by QA thereafter)

These are starting values, not commitments — they exist so the Gameplay Engineer types design numbers on day 1 instead of inventing them, and so QA has a hypothesis to falsify. All are flagged `TUNABLE`.

| Constant | Notes | Baseline |
|---|---|---|
| Core HP | Naked-core kill time = 100 ÷ 5 = ~20 s of sustained beam | 100 |
| Beam vs core | DPS; the constant the whole match balances on | 5 |
| Beam vs ships/turrets | DPS | 10 |
| Mining rate | Ore per second of beam-on-asteroid | 0.5 |
| Ship hull | Base; upgradable | 50 |
| Starting ore | One meaningful opening choice | 3 |
| Spawn protection | Ship and core, match start | 10 s |
| Cargo hold | Base; +2 per upgrade tier, first tier cheap, escalating; cap 8 | 2 |
| Turret | Cost 3 · HP 30 · DPS 4 · build 10 s · cap 4 | — |
| Shield | Cost 5 · 40 HP · regen 2/s after 8 s undamaged · build 15 s · cap 2 | — |
| Repair core | Planet core only · 2 HP/s channel · 1 ore = 5 HP · interrupted by damage | — |
| Field yield | Total ore per match, in 5 asteroid waves, each closer to center | ~400 |
| Asteroid wave interval | Metronome of the match | ~150 s |
| Respawn | Free; time is the cost | 5 s |
| Sensor range | Distance at which an enemy planet's damage ring becomes visible | ~2× shield radius |

### 2.9 AI opponents (in-game)

Bots are hand-coded behavior trees running the same action interface as human input — no LLM calls at runtime. Bots are also **fog-honest**: they perceive only what a human in their cockpit could (same sensor range, same hidden enemy HP), so a Hard bot that knows you're wounded knows it because it scouted you. Difficulty changes visible competence, not cheats:

- **Easy** mines slowly, over-defends, attacks rarely, retreats at half hull.
- **Medium** balances the triangle, contests ore waves, and gangs up on the current leader.
- **Hard** plays like a good human: it evaluates targets by *threat, proximity, and opportunity* — it punishes whoever it can profitably punish (the miner far from home, the planet whose alarm went unanswered, the wreck nobody is guarding), times attacks to when you're seen mining far from home, and scavenges kill sites.

The seven bots are **characters, not difficulty labels**: Rusty (Easy, timid hoarder), Bolt (Easy, reckless rusher), Foreman (Medium, methodical miner), Patch (Medium, defensive fixer), Sable (Hard, opportunist raider), Vulture (Hard, wreck scavenger), Warden (Hard, territorial enforcer). Each has a name, a ship livery, and personality weights layered on its difficulty tree — so a solo match has a cast, and losing to Vulture feels different from losing to Warden.

### 2.10 Onboarding

The game's central mechanic — your gun is your mining tool — inverts player expectations, so it is taught, not assumed. Onboarding is **owned by the UI Engineer and built on days 1–2**, not deferred: contextual first-match prompts fire on triggers ("Hold fire on the asteroid — your beam mines it," "Hold full — fly home and press E," "Spend ore on defense — or UPGRADE SHIP to mine and hit harder," "Your planet is under attack — follow the arrow"). The upgrade prompt fires the first time the wheel opens, because upgrades are the half of the economy a player can most easily miss. The prompts are the day-1/day-2 milestones translated into player-facing language, they are input-agnostic for free via the action mapping (2.4), and they never appear again after each is completed once. No separate tutorial mode: the first match is the tutorial.

### 2.11 Ship classes

Players choose a hull in the lobby; the choice is locked for the match and sets all five core attributes: **top speed, acceleration, turn rate, armor (hull HP), and beam damage** (which is also mining speed — one beam, one stat). Four classes ship in week one. Baselines are day-1 hypotheses (TUNABLE), relative to the Vanguard:

| Class (hull) | Role · Speed / Accel / Turn / Hull / Beam / Cargo |
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

2. **Gameplay Engineer** — *Everything the player does is this agent's code.* Writes the simulation: ship physics, the shared shoot/mine beam, ore, building, construction timers, repair channel, siege rules, win/loss, and the baseline constants table.

3. **Bot Engineer** — *A solo player offline still gets a full 8-planet match with a memorable cast.* Writes the Easy/Medium/Hard behavior trees and the seven bot personalities against the same action interface a human uses.

4. **Platform Engineer** — *The game feels identical on a trackpad, an Xbox pad, and a phone screen, and it runs at 60 fps on a laptop — and on the developer's phone.* Owns the deterministic fixed-timestep loop, the input-action mapping (keyboard/mouse, gamepad, and touch), the dynamic virtual sticks, the device-aware controls strip, the PWA manifest and service worker, viewport/devicePixelRatio scaling, the `platform.ts` abstraction (the Capacitor seam), the determinism replay test, and the PixiJS render layer.

5. **Netcode Engineer** — *Eight people in four countries fight over the same asteroid and it feels like one room.* Owns the `Transport` interface and both of its implementations, the authoritative match server, snapshot encoding, client-side prediction and reconciliation, and the room/lobby protocol. Runs a **day-0 spike** before any of it is designed, and the spike *decides* rather than confirms: measure a real snapshot's size, establish the tick rate the sim can sustain, and evaluate candidate hosts against the one requirement that matters — holding a persistent WebSocket under load without sleeping — then pick one. The numbers in 4.2 are inputs to that spike, not conclusions from it. *Scope note:* netcode is the highest-variance work in the week and lands mid-week, so it is owned separately — a slip here cannot also stall input, rendering, and the game loop.

6. **Art & Audio Agent** — *Every mechanic in section 2 has a visible and audible tell.* Produces every visual and sound: procedural SVG/sprite ships (one livery per bot personality), planets, asteroids, wrecks, and UI in one palette; **a specified VFX set** — beam impacts, asteroid crack-and-burst, shield shimmer, turret muzzle flashes, explosions, thruster trails, spawn-protection glow, and the planet-death moment; synthesized SFX (jsfxr-style) including the under-attack alarm and the distinct rock-vs-hull beam sounds; and an ambient loop. Runs the day-0 concept mode (4.7).

7. **UI Engineer** — *The player always knows the triangle state, and a first-time player learns the game inside their first match — on a laptop or a phone.* Builds the HUD (ore squares + banked total, asteroid-wave clock, alarm, screen-edge arrow, over-ship hull bars, device-aware controls strip), thumb-scale HUD layout and safe-area-aware anchoring for touch devices, the fire-mode setting (Manual/Auto-aim) and its settings-menu UI, radial build menu, upgrade panel, minimap, main menu, settings, lobby with ship-class select and player colors, end-of-match summary with Rematch, **and the onboarding prompts (2.10)**.

8. **QA Agent** — *The clock the design promises is the clock the player gets — on desktop and in your hand.* Runs headless bot-vs-bot matches **with an enforced match timeout** (a hung match is a failed test, not a hung harness), owns the constants table from day 2 onward, writes sim unit tests and the determinism replay test, owns the mobile performance gate (4.3) and verifies every milestone (4.6) on the developer's phone before it ships, and files balance reports against two measurable targets: match length lands in 10–15 minutes, and no strategy exceeds a stated win-rate threshold across bot mirrors.

Coordination stays deliberately boring: agents communicate through shared interface files, PRs, and the Director's reviews. There is no runtime multi-agent system in the shipped game — the multi-agent system is the studio, not the product. Runtime token cost: zero.

---

## 4. Technical Strategy

### 4.1 Stack and platform path

- **Language:** TypeScript throughout — client, server, and bots share one codebase and one set of types. Agents write and test plain text files; no engine-editor tooling in the loop.
- **Renderer:** PixiJS (WebGL2), drawing a 2D top-down scene. Sprites are batched and pooled from day 1.
- **PWA:** a manifest and service worker make the client installable to the home screen and playable fullscreen; the service worker caches the app shell, so the game is offline-capable against bots by the same mechanism that makes it installable. Store packaging (Capacitor) is designed for, not built, this week.
- **Platform abstraction:** all platform-specific calls — fullscreen, vibration, storage, orientation — go through one `platform.ts` interface; game code never touches a bare browser global directly. This is the Capacitor seam: wrapping it for native store packaging is a post-week task, not a rewrite.
- **Collision:** hand-written, no physics engine. Every colliding body is a circle, so:
  - **Broad phase:** uniform-grid spatial hash, cell size ≈ 2× largest radius; test same + adjacent cells only.
  - **Narrow phase:** `dx² + dy² < (r1+r2)²`. No square roots.
  - **Beam:** a segment-vs-circle raycast per tick, not a projectile — exact, and immune to tunnelling.
  - **Turret shots:** pooled projectiles, same circle test.
  - **Movement:** Euler integration with drag. Ship-vs-asteroid reflects; a projectile despawns on hit.
  
  Roughly 250 lines, and we own every float operation — which is what makes the CI replay test (4.8) meaningful.
- **Animation:** procedural, no libraries. Ship rotation is a transform, thrusters are alpha oscillation, explosions are pooled particles, asteroid cracks are sprite swaps at damage thresholds, UI uses tweens.
- **Simulation:** deterministic fixed-timestep (60 Hz), fully decoupled from rendering. **The match server never imports PixiJS** — it runs the sim with no GPU, no canvas, no window, and so does the QA harness. **Determinism policy:** netcode is authoritative state-sync, not lockstep; determinism is asserted per build by a CI replay test (same inputs, same final state hash), with a table-based math fallback if it ever fails.

### 4.2 Multiplayer: in scope for week one

Online multiplayer ships in week one. A small **authoritative Node.js match server** over WebSockets holds all simulation authority: clients send input ticks, the server runs the one true sim and broadcasts state, clients interpolate. Rooms are created from the lobby with a shareable code; bots fill empty slots server-side, so a 3-human classroom match is still an 8-planet war.

**"Host" is a lobby word, not a network role.** The player who creates a room picks the bot difficulties and is otherwise a client like any other. There are no listen servers and no peer-to-peer: browsers cannot accept incoming connections.

**Hosting: decided by the day-0 spike, not by this document.** The requirement is narrow and testable — hold a persistent WebSocket for a full match under 8-player load, without sleeping or dropping connections, at zero or near-zero cost. Candidates to evaluate: Oracle Cloud Always Free (always-on ARM), Cloudflare Durable Objects (WebSocket-native, one object per room), and a low-cost VPS as the paid baseline. The Netcode Engineer benchmarks them and picks one; the choice is recorded in the repo, not here.

Regardless of the winner, the server ships as a **plain Dockerized Node process with no vendor-specific APIs**, so it redeploys elsewhere in an afternoon. That portability is the actual requirement — the host is replaceable, and the spec treats it that way (risk 1).

**What goes over the wire.** Static entities — asteroids, turrets, shields, wrecks — are sent as **events**, on join and on change. Only ships and projectiles stream as **binary snapshots**. Server ticks at 20–30 Hz; clients render at 60 with interpolation. **Client-side prediction** makes input feel instant: your own ship simulates locally the moment you press a key and reconciles against server authority — available because the sim is deterministic and the client runs the same code the server does.

**The `Transport` interface** has two implementations: `LocalLoopback` (solo, offline) and `WebSocketTransport` (online). The simulation consumes ordered input ticks and never knows which one it is talking to. The server deploys from GitHub Actions, so the developer's travel connectivity never gates the classroom's ability to play. If the week runs long, the cut list (4.9) degrades multiplayer to 2 players + bots rather than cutting it.

**Reconnect grace.** On a mid-match disconnect, a bot substitutes for the player immediately, so the match keeps its shape and the room doesn't stall. The player may rejoin the same match by room code within ~60 seconds (`TUNABLE`) and reclaim their ship, with all upgrades intact. This is motivated by mobile play, where screen lock, app backgrounding, and cellular drops are routine in a way they are not on desktop.

### 4.3 Named constraints

1. **One-week build window.** One map layout, one ship type, four buildables, elimination-only. The ranked cut list (4.9) is the enforcement instrument — cuts are decided now, in daylight, not at 2 a.m. on day 7.
2. **Spotty internet while traveling (primary constraint).** (a) The solo/offline game is a complete product on its own; (b) the dev environment is fully local; (c) agent work is batched into bursts with Director briefs prepared offline; (d) server deploys run in the cloud via Actions, so a hotel-Wi-Fi push is enough to update both the game and the server.
3. **Browser performance budget.** 8 ships, up to 32 turrets (design cap 4 × 8 planets), ~200 asteroids, hundreds of projectiles at 60 fps on integrated graphics: object pooling, spatial hash collisions, instanced sprites, zero per-frame allocations in the sim. **Mobile gate:** 60 fps on the developer's own phone — the primary mobile test device — at the same entity counts, with a 30 fps floor on a 3-year-old mid-range Android; sustained drops below the floor auto-engage the "reduce VFX" setting. Entity counts are unchanged for mobile — the same pooling and batching disciplines are what make the phone target feasible. Verified by the day-5 performance gate, not assumed.
4. **Runtime token cost must be zero.** All in-game AI is behavior trees; LLMs build the game but never run it.

### 4.3b Named risks

Keeping online multiplayer in week one is a deliberate bet. These are the ways it can go wrong, each with the thing that stops it becoming fatal:

| # | Risk | Why it's real | Mitigation |
|---|---|---|---|
| 1 | **Free hosting tiers change without warning** | Free tiers are withdrawn, throttled, or quietly halved with no announcement, and some close idle WebSockets outright. Whichever host the spike picks can move under us mid-week. | The server is a plain Dockerized Node process with no vendor-specific APIs, so it redeploys anywhere in an afternoon. A ~4 EUR/month VPS is the standing paid fallback. The portability is the mitigation — not the vendor. |
| 2 | **Netcode slips and eats the back half** | It's the highest-variance work in the plan and it lands on days 3–4, where an overrun cascades into integration (day 5) and balance (day 6). | Three layers. The cut list degrades 8 players to 2 players + bots rather than cutting online. The offline solo game is complete and ships regardless. And the Netcode Engineer is a separate agent, so a netcode slip can't also stall input, rendering, and the loop. |
| 3 | **WebSocket is TCP — head-of-line blocking** | One dropped packet stalls everything queued behind it. At 8 players on a small map this is *probably* fine; nobody has measured it. | The day-0 spike measures it before the design locks. If it bites, geckos.io (UDP over WebRTC) drops in behind the same `Transport` interface — transport work, not a rewrite. |
| 4 | **The bandwidth numbers in 4.2 are arithmetic, not measurements** | ~40 KB/s per client and ~2 KB snapshots come from *assumed* entity counts and tick rates. No one has run it. | Explicitly a day-0 spike deliverable, treated like the balance constants in 2.8: a hypothesis for QA to falsify, not a fact to build on. |
| 5 | **PixiJS perf at target entity counts is unverified** | 8 ships, 32 turrets, ~200 asteroids and hundreds of projectiles at 60 fps on integrated graphics is a claim, not a result. | Pooling, spatial hashing and instanced sprites from day 1, not retrofitted. The day-5 integration gate verifies it on real hardware, with "reduce VFX" already in the settings menu as the escape hatch. |
| 6 | **Server dies, and with it all online play** | Free tier, single instance, no redundancy. | Offline solo-vs-bots is a first-class mode, not a fallback — it needs no server, no internet, and is the mode the developer builds against while travelling. A dead server costs the classroom a session, never the deliverable. |
| 7 | **Mobile browser quirks** | Audio unlock requires a user gesture, fullscreen API behaves differently across mobile browsers, and Safari enforces tight WebGL memory limits — any of which can silently break a build that only tested on desktop. | The developer's phone is a first-class test device from day 1; every milestone (4.6) is phone-verified before it ships, so quirks surface the day they're introduced, not at day 6. |

### 4.4 Token budget

Budget assumes Claude Code sessions over 7 days plus a half-day of pre-production, batched for offline gaps. Figures are input+output combined, with headroom.

| Agent | Main deliverables | Est. tokens |
|---|---|---|
| Director | Briefs, interface + tone contracts, PR reviews | 3.0 M |
| Gameplay Engineer | Sim: collision, beam, ore, building, repair, siege, win/loss | 6.0 M |
| Bot Engineer | 3-difficulty behavior trees + 7 personalities | 3.5 M |
| Platform Engineer | Game loop, input mapping (incl. touch), controls strip, PWA/service worker, Pixi render layer | 4.5 M |
| Netcode Engineer | Day-0 spike, Transport, match server, snapshots, prediction | 4.5 M |
| Art & Audio Agent | Concept boards + sprites, VFX set, SFX, alarm, palette | 5.0 M |
| UI Engineer | HUD, build menu, upgrade panel, lobby, onboarding, rematch, fire-mode/settings UI | 4.5 M |
| QA Agent | Headless harness (with timeout), tests, balance to targets, mobile perf gate | 4.0 M |
| Contingency (~20%) | Rework, integration bugs, balance passes | 6.5 M |
| **Total** | | **~41.5 M tokens** |

Front-loaded on the Gameplay Engineer (days 1–3), mid-loaded on the Netcode Engineer (days 3–4, plus the day-0 spike), back-loaded on QA (days 5–7). Headless QA matches consume no tokens — they're compiled code.

### 4.5 API constraints and mitigations

- **Rate/usage limits + offline gaps:** planned bursts; Director briefs make sessions resumable; all state lives in the repo, never in a conversation.
- **Context limits:** the codebase is split along agent ownership lines; interfaces are the contract, so no agent needs the whole repo in context.
- **Asset generation:** art is generated as code (SVG/procedural sprites) — reproducible, diffable, license-clean, regenerable offline.

### 4.6 Seven-day plan

| Day | Milestone (playable check) |
|---|---|
| 0 (half-day) | Concept boards + tone locked into style-guide.md; repo, CI, Pages, server deploy pipeline live; **Netcode spike:** real snapshot size measured, sustainable tick rate established, host benchmarked and chosen (pre-production — not a playable build; phone verification starts at day 1) |
| 1 | Ship flies, shoots, mines; two-number ore HUD; first onboarding prompts; touch controls (twin sticks, fire-mode setting) ship alongside keyboard/mouse and gamepad — playable at the public URL — phone-verified |
| 2 | Planets, cores, turrets, shields, repair channel, build menu, under-attack alarm; win/loss + last-to-die rule fires vs. do-nothing bots — phone-verified |
| 3 | WebSocket transport + authoritative server deployed; 2-player online match works — phone-verified |
| 4 | 8-slot lobby with room codes, ship-class select, player colors; Easy/Medium/Hard bots with personalities fill empty slots, online and offline — phone-verified |
| 5 | **Integration day:** full 8-slot online match end-to-end; 60 fps performance gate on integrated graphics and on the developer's phone; first balance pass against the constants table; art/VFX/audio replace placeholders — phone-verified |
| 6 | QA balance passes to the 10–15 min target; gamepad and touch verified; onboarding polished — phone-verified |
| 7 | Polish, main menu + settings + end-of-match/rematch flow, tagged v0.1 release for the classroom — phone-verified |

### 4.6a Playable milestones

> A **playable milestone** is a tagged, CI-green build, live at the public URL, that a first-time player can open on a phone browser and verify that day's player-facing checks in under 2 minutes — touch and keyboard both working — announced by a phone ping containing the play URL and a 2-line "what to test" note.

The seven day-milestones above (days 1–7) are the playable milestones; day 0 is pre-production and the netcode spike, not itself a player-facing build. Each milestone gains a `test_notes` field in `milestones.json`; the deploy workflow pings ntfy on tag with the URL and those notes — Planet Rush Studio's existing milestones.json → ping plumbing is reused as-is, not rebuilt.

**On-demand deploys.** Saying "deploy now" to the Director pushes the current `main` to the `/dev` URL and fires the same ping, with no tag required — so a milestone can be phone-verified mid-day, not just at its scheduled end.

### 4.7 Pre-production: concept iteration and tone

Before production, the Art & Audio Agent runs a half-day concept mode (day 0), delivering instantly viewable HTML/SVG artifacts: two to three **theme boards** showing the *same* scene (ship, defended planet, asteroid field, HUD, open build menu); **level layout variants** (one SVG, three planet-ring/field arrangements — spacing tunes the triangle, since travel time home is the defense tax); and **UI mockups** in the two leading themes.

The boards are judged against a **tone paragraph**, written into this GDD so the choice has criteria instead of vibes:

> *Planet Rush is a Saturday-morning space brawl: fast, bright, and a little cheeky. Ships are toys, explosions are fireworks, bots are cartoon rivals with names. But homes are the one serious thing in it — when a planet dies, the game goes briefly quiet, the wreck stays on the map all match, and nobody jokes for three seconds. Arcade on the surface, a small ache underneath.*

The developer picks a winner (one revision round max), frozen into `style-guide.md` — a contract like the interfaces, changeable only through the Director. Concept iteration is deliberately not a standing loop: after day 2 the game is playable, and iterating on the real build beats iterating on pictures. Budget: ~1.0 M tokens inside the Art & Audio line.

### 4.8 Source control, CI, and classroom distribution

Everything lives in one GitHub repository from day 0: code, this GDD, `style-guide.md`, agent briefs, and all generated assets (which are code, so the whole game is reproducible from a clone). Agents work in short-lived branches scoped to briefs; the Director merges to `main` via PR review — the same channel as the escalation path in section 3.

GitHub Actions runs four jobs. **CI on every push:** typecheck, unit tests, the determinism replay test, and a headless bot smoke match (with timeout) — a commit that breaks or hangs the game cannot merge. **Deploy on green `main`:** the web client to GitHub Pages, the match server to its free-tier host — one public URL the whole classroom can open and play, solo or together. **Release on tag:** the stable classroom link serves the latest *tagged* build, with `main`'s newest on a `/dev` path, so experiments never break the link the class is using.

Git is offline-first: commit locally all day, push in a burst, and the cloud does the building — a phone-hotspot push updates both game and server.

### 4.9 Ranked cut list

If the week runs long, features die in this order — decided now, not by whoever is tired on day 7:

1. Minimap ping
2. Boost
3. Ambient music loop (SFX and the alarm are mechanics; they stay)
4. Bot personality flavor (liveries/behavior quirks — names stay)
5. End-of-match summary reduces to a plain winner screen (Rematch button stays)
6. Online lobby degrades from 8 players to 2 players + bots (multiplayer itself is never cut)
7. Third theme board (pick from two)
8. PWA installability (mobile-browser play survives without it)
9. Landscape orientation lock

Not cuttable: the triangle (mine/defend/attack), the finite field and collapse phase, onboarding prompts, the under-attack alarm, gamepad support, offline solo mode, 2-player online, touch controls (twin sticks), the auto-aim fire mode, and mobile-browser playability.

## 5. Art Direction

The visual direction was chosen on day 0 and frozen into `style-guide.md` — the contract the Art & Audio and UI agents build against, changeable only through the Director (4.7). This chapter is that reference.

### 5.1 Cold Vacuum — the chosen direction

**Cold Vacuum** is the frozen direction: gunmetal hulls, teal patina for corrosion, signal yellow for anything that matters, and a cold plasma-blue cutting torch for the beam. Industrial and grubby, but in vacuum rather than in a mine shaft — no rust, no amber, no cave.

The palette is small on purpose, because every colour has a job:

| Role | Hex | Job |
|---|---|---|
| Vacuum | `#0D1015` | Background. Near-black, so every entity carries its own contrast. |
| Hull steel | `#7E8894` | All ships, all players. Hulls never take player colour. |
| Patina | `#4FA08B` | Corrosion, continents, repair. The "old system" tint. |
| Signal yellow | `#F2D24B` | Ore, hazard stripes, costs. **Reserved.** |
| Plasma | `#4DC3FF` | Beams, cockpits, energy. |
| Threat red | `#B23A3A` | Damage, alarms, enemy fire. |

The rule that carries the most weight: **signal yellow means ore or danger, and nothing else.** Nothing decorative is ever yellow, so a player scanning a chaotic screen can trust it.

### 5.2 Player colour and identity

Eight players, eight colours — humans and bots alike. The rule is that **hulls stay steel**; player colour lives only on wing tips, cockpit, engine flame, beam tint, planet beacon ring and HP bar. This keeps every ship reading as the same industrial fleet while remaining instantly identifiable, and it means a livery is a palette swap rather than a new sprite. Every ship also carries its player number as a hull decal, so identity never depends on colour alone — which is the colourblind-safe path and costs nothing.

### 5.3 Ship classes

Four hulls, four silhouettes, four playstyles (2.11). Silhouette is deliberately doing the work: because bot personalities map to hulls, recognising a shape at 24 pixels tells you who you are dealing with before you can read a name. That is also why the hull stays steel — the shape must carry the information.

### 5.4 Planets

Earthlike, and randomised per player from four variants so no two home worlds look identical. Oceans are steel-blue and continents patina-green, which keeps "Earth" inside the Cold Vacuum palette instead of importing a second one. The core stays signal yellow — it is the win condition, so it obeys the yellow rule. Ownership shows as a beacon ring in the player's colour, always visible; health shows as a damage ring, visible only within sensor range (2.2).

### 5.5 Turrets and asteroids

Turrets must read as cannons at a glance and telegraph their threat while spinning. Asteroids are the economy, so they must crack visibly across three stages and let a player judge a payout before committing beam time.

### 5.6 Typography

**Audiowide** for the wordmark, headings and menu confirmations — rounded retro-techno, the one face in the shortlist that is playful without being a toy, which is precisely the tone paragraph's brief. **Oxanium** for HUD numerals and body text: it was designed for game interfaces, holds up at 12px, and shares Audiowide's squared geometry without competing with it. Both are OFL licensed and self-hosted in the repo, so they render offline and carry no licence risk (4.5). This document is typeset in them.

### 5.7 The interface

The HUD shows only what the player acts on: ore squares and banked total, the asteroid wave clock, your own planet's health, hull bars over ships, and a controls strip that names the active device's bindings. Ship stats live in the upgrade panel and nowhere else. Enemy planet health is scouted, never broadcast.

### 5.8 The game in play

The ruleset's distinct moments, drawn before day 1. Each one is a legibility test: if a moment doesn't read at a glance, that's a design bug found in pre-production rather than on day 6.


---

*End of v0.4. This document is the Assignment #01 deliverable and the contract the build agents work against.*

*Changes from the first draft, in response to a six-agent design review board: the ore economy is bounded and ends in a collapse phase, so the match is structurally guaranteed to terminate; starting ore and spawn protection replace the naked-core opening; the siege model is stated as design rather than deferred to tuning (turrets deter / the ship defends / pressure beats regeneration / two beats one); core repair replaces the mine layer; ties resolve last-to-die; respawn is free with time as the cost; Hard bots target by threat rather than weakness, and are fog-honest; onboarding is designed, owned and scheduled; online multiplayer was promoted into week-one scope; a baseline constants table gives day 1 real numbers; a tone paragraph gives day 0 real criteria; day 5 became an integration and performance gate; and a ranked cut list decides in daylight what dies if the week runs long.*

*Changes since, from technical review: PixiJS replaces Three.js; collision is hand-written circles with no physics engine; multiplayer runs on a dedicated authoritative server, with the host chosen by a day-0 spike rather than assumed; a Netcode Engineer was split out as the eighth agent; and six risks are named with mitigations. Scope was cut to exactly one platform — a browser game, online and offline. There are no stretch goals in this document.*

*Changes in v0.4: mobile/cross-platform play added as first-class scope — touch controls (dynamic twin sticks; Manual and Auto-aim fire modes with mode-morphing right-side control), PWA installability with a Capacitor-ready platform seam, a formal playable-milestone definition with phone-verification and ntfy pings, a mobile performance gate, a reconnect-grace rule for drop-prone mobile connections, and a seventh named risk (mobile browser quirks). Multiplayer architecture re-evaluated against Photon/Nakama/gRPC alternatives and reaffirmed: authoritative TypeScript WebSocket server, one deterministic codebase.*

*Open questions for the build: exact wave pacing curve, whether spectators get a ghost-ping ability, and alliance signalling in 8-player matches.*
