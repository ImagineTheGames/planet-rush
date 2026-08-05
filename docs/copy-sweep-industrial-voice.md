# Copy sweep — the industrial interface voice

**Status:** delivered spike · branch `agent/architect/l2-industrial-voice` · 2026-08-05
**Author:** Architect · **Scope:** inventory + decisions. **No copy changes ship in this PR.**
**Executed by:** l2-02 (UI Engineer) — this document is the work order.

---

## 0. What was decided, and where the decision lives

The developer ratified the industrial interface voice on 2026-08-05. Asked whether
the interface should speak as a mining authority rather than as a game menu, the
answer was:

> "doesn't sound like a question to me"

Read as: it is a given.

**The decision is in the GDD, not here.** `GDD.md` §4.7 was amended today and now
names **two registers** — the *emotional tone* (unchanged; judges art, VFX, audio,
the shape of a moment) and the *interface voice* (new; governs every word a player
reads). The voice block in §4.7 is written to be **pinned verbatim** into every
player-facing-copy task, the same way `content/codex/pipeline/tone.md` already pins
the tone paragraph.

That ordering is deliberate and it is the reason this brief was a GDD brief and not
a copy brief. The Assignment-4 codex pipeline established that **lexical retrieval
never surfaces a tone section on its own** (0/4 query types), so tone is injected by
hand or not at all. A copy sweep run against a tone nobody wrote down produces four
agents' four opinions. §4.7 first, then this list.

**This document is the string-by-string execution list.** It does not restate the
voice — read §4.7 for that. It answers three questions per string: what does it say
today, what should it say, and what breaks if you change it.

### The two registers, in one line each

- Register 1 — **the game looks like a toy.** Unchanged. Bright, punchy, cheeky; the
  station-death moment goes quiet for three seconds.
- Register 2 — **the game talks like paperwork.** New. The claim's operating
  authority addressing a contracted operator: procedural, unglamorous, faintly
  bureaucratic, never congratulatory.

They are not in tension. A claim office filing a status update while a rig burns is
colder and funnier than a game shouting "AWESOME!", and the ache in register 1 lands
harder when the interface declines to comment on it.

### The rule that outranks the voice

**Clarity always wins over flavour.** Stated in §4.7, repeated here because it is
the failure mode of every voice pass and because this document applies it three
times in anger (§3.1 `SETTINGS`, §3.2 the room *code* noun, §4 `HOME`). A player
under fire reading a refusal needs the reason, not the fiction.

---

## 1. How to read the tables

| Tag | Meaning |
|---|---|
| `[REQ]` | Required for consistency once the voice is adopted. |
| `[REC]` | Recommended — a real register lift, low risk. |
| `[OPT]` | Optional; listed so it is decided rather than forgotten. |
| `[HOLD]` | **Considered and rejected.** The reason is recorded so nobody re-litigates it. |
| `[FIXED]` | Ratified elsewhere. Not the voice's to touch. See §5. |

Line numbers are as of this branch (`53d2f20`). **Match on the string, not the
line** — every entry quotes the exact literal.

Every row's "current" text was read out of the source, not remembered. The grep
commands that produced this inventory are in §9 so the sweep is reproducible.

---

## 2. The headline finding: the codebase already half-speaks this voice

Before the list, the measurement that should change how l2-02 approaches the work.

Of the copy-bearing strings in `src/ui/`, the large majority are **already in
register** and need no change:

| Screen | Verdict |
|---|---|
| **Onboarding** (`onboarding.ts`, 4 prompts) | **Already compliant, all four.** Every prompt is a procedural imperative with the reason first: `'Your station is under attack — follow the arrow'`. Nothing to do. |
| **Settings** (`settings.ts`, 6 rows) | **Almost entirely `[FIXED]`.** Every row names a mechanic quoted verbatim in the GDD. The voice barely touches this screen. |
| **Build & Upgrade wheel refusals** (`build-wheel.ts`) | **Already compliant.** `REACTOR FULL`, `NEED 1 ORE`, `+15 HP`, `REPAIR in 12s` — reason first, three words, no flavour. This is the model the rest of the sweep should copy. |
| **Pause menu** (`pause-menu.ts`) | `[FIXED]` actions; the one prose line, `'Your station falls the moment you go.'`, is already the voice — flat, consequence-first, no plea. |
| **End-of-match subheads** (`end-of-match.ts`) | Already swept to `claim`/`reactor` by the lore pass. `'You took the claim.'` is the register's best existing example. |

**What this means for l2-02:** this is a *small* sweep with a *concentrated* blast
radius. The voice's real work is on **three screens** — the main menu, the doors,
and the lobby — plus **two end-screen headlines**. Everything else is either already
right, fixed by ratification, or machine copy. Resist the urge to touch more.

Why the codebase reads this way: the lore pivot (GDD v0.7, `docs/lore-copy-sweep.md`)
already moved the *nouns* — planet→station, core→reactor, system→claim. What it did
not move is the *register* — the game-menu words for the things surrounding the
fiction (room, victory, play). That residue is precisely this sweep.

---

## 3. The sweep — file by file

### 3.1 `src/ui/main-menu.ts` — the front door

| Line | Current | Proposed | |
|---|---|---|---|
| 77 | `label: 'PLAY'` | `label: 'TAKE A CONTRACT'` | `[REC]` — see Q1 |
| 78 | `label: 'CODEX'` | *(unchanged)* | `[HOLD]` |
| 79 | `label: 'SETTINGS'` | *(unchanged)* | `[HOLD]` |
| 84 | `MAIN_MENU_TITLE = 'PLANET RUSH'` | *(unchanged)* | `[FIXED]` — brand, GDD §0 |

**`PLAY` → `TAKE A CONTRACT` is the voice's thesis statement** and the single most
visible string in the game, which is why it is Q1 for the developer rather than an
architect's call. In favour: it is the first thing a player reads, it establishes
"you are a contracted operator" before any other word does, and it reads straight
into the three doors below it (a solo contract, an open claim, a joined claim). It
is unambiguous — nobody is confused about what a button called TAKE A CONTRACT does.
Against: it is four syllables where `PLAY` is one, and `PLAY` is the universal
affordance.

**`SETTINGS` stays — clarity beating flavour, on the record.** Considered and
rejected: `CONFIGURATION`, `RIG SETUP`, `OPERATOR PREFERENCES`. `SETTINGS` is the
word every player on every platform already knows, and a player who cannot find
settings cannot change the fire mode, which is a mechanic (§2.4). Flavour buys
nothing here and costs comprehension. Same reasoning retires `DONE` → anything.

**`CODEX` stays.** It is a document name, which is already in register, and it is
the shipped name of a shipped feature (`CODEX_TITLE`, `content/codex/codex-*.json`).

### 3.2 `src/ui/lobby-entry.ts` — the doors and the code pad

The concentration of work. Three door labels, three hints, four error lines, one
tagline.

| Line | Current | Proposed | |
|---|---|---|---|
| 98 | `label: 'PLAY SOLO'` | `label: 'SOLO CONTRACT'` | `[REC]` |
| 99 | `hint: 'Set up the match. Bots fill the seats, no connection needed.'` | `'Work the claim alone. Bots hold the other seats. No connection needed.'` | `[REC]` |
| 104 | `label: 'CREATE ROOM'` | `label: 'OPEN A CLAIM'` | `[REC]` |
| 105 | `hint: 'Set up the match and read the code out. They join you.'` | `'Open the claim and read the code out. They join you.'` | `[REC]` |
| 110 | `label: 'JOIN ROOM'` | `label: 'JOIN A CLAIM'` | `[REC]` |
| 111 | `hint: 'Type the code somebody is holding up.'` | *(unchanged)* | `[HOLD]` — already plain and correct |
| 195 | `short: \`A room code is ${ROOM_CODE_LENGTH} characters.\`` | `` `A claim code is ${ROOM_CODE_LENGTH} characters.` `` | `[REQ]` if 104/110 move |
| 198 | `unknown: 'No room with that code. Check it and try again.'` | `'No claim with that code. Check it and try again.'` | `[REQ]` — **and see the duplicate in §3.7** |
| 200 | `full: 'That room is full. Ask for a rematch, or play solo.'` | `'That claim is full. Ask for a rematch, or take a solo contract.'` | `[REQ]` — quotes the door label |
| 202 | `offline: 'Cannot reach the server. PLAY SOLO still works.'` | `'Cannot reach the server. SOLO CONTRACT still works.'` | `[REQ]` — quotes the door label |
| 432 | `ENTRY_TAGLINE = 'MINE · DEFEND · ATTACK'` | *(unchanged)* | `[HOLD]` |
| 444 | `'CONNECTING…'` | *(unchanged)* | `[HOLD]` — machine copy, §4 |
| 445 | `'ENTER THE ROOM CODE'` | `'ENTER THE CLAIM CODE'` | `[REQ]` if 104/110 move |

**"Room" is retired as a player-facing word for the shared match; "claim" replaces
it.** The room is the lobby-software word for the thing eight operators share; the
claim is the fiction's word for it, and it is already ratified (GDD §0).

**But the room *code* stays a "code."** Considered and rejected: `SEAL`, `CLAIM
SEAL`, `TICKET`. A player must type four characters read off somebody else's
screen; "code" is what that is, in every app they have ever used. "Enter the claim
seal" would make a first-timer guess. This is the clarity rule deciding against the
flavour word, and it is why §4.7's vocabulary table binds **seal** to the
allocator's existing `TICKET SIGNED` stamp instead of letting it eat "code."

**`MINE · DEFEND · ATTACK` stays.** It is the triangle — the design's own three
words (GDD §2.3), imperative, procedural, zero adjectives. It is already the voice.

### 3.3 `src/ui/lobby.ts` + `src/ui/lobby-view.ts` — the roster and its controls

| File · line | Current | Proposed | |
|---|---|---|---|
| `lobby-view.ts:153` | `roomLabel = 'ROOM'` | `'CLAIM'` | `[REQ]` if §3.2 moves |
| `lobby-view.ts:543` | `` `ORE · ${ABUNDANCE_LABELS[...]}` `` | `` `YIELD · ${...}` `` | `[REC]` |
| `lobby.ts:180–182` | `SCARCE` / `STANDARD` / `RICH` | *(unchanged)* | `[HOLD]` — already survey words |
| `lobby-view.ts:538` | `` `MODE · ${MODE_LABELS[...]}` `` | *(unchanged)* | `[HOLD]` |
| `lobby-view.ts:671` | `'WAITING FOR THE HOST'` | `'WAITING FOR THE CLAIM HOLDER'` | `[REC]` — **width check, trap 4** |
| `lobby-view.ts:689` | `` `${humanCount} PLAYING · ${botCount} BOTS` `` | *(unchanged)* | `[HOLD]` |
| `lobby-view.ts:362` | `'out of the match'` | *(unchanged)* | `[HOLD]` |
| `lobby-view.ts:503` | `'OPEN'` (empty seat) | *(unchanged)* | `[FIXED]` — §2.1 slot state |
| `lobby.ts:1175` | `'CLOSED'` | *(unchanged)* | `[FIXED]` — §2.1 slot state |
| `lobby.ts:83` | `RUSH_LABEL = 'RUSH!'` | *(unchanged)* | `[FIXED]` — GDD §2.1 verbatim |
| `lobby.ts:162` | `teamName()` → `TEAM A` | **`FRIENDLY A` / `ENEMY B`** | `[FIXED]` — **§6, do not touch** |
| `lobby.ts:226` | `DEFAULT_PLAYER_NAME = 'YOU'` | *(unchanged)* | `[HOLD]` |
| `lobby.ts:267–285` | ship class blurbs | *(unchanged)* | `[HOLD]` — already in register |
| `lobby.ts:191–198` | colour names (`AZURE`…) | *(unchanged)* | `[FIXED]` — identity roster, §2.1 |
| `lobby.ts:93–95` | `EASY` / `MEDIUM` / `HARD` | *(unchanged)* | `[FIXED]` — GDD §2.9 |
| `lobby.ts:113–114` | `FFA` / `TEAMS` | *(unchanged)* | `[FIXED]` — GDD §2.1 |

**`ORE ·` → `YIELD ·` is the cleanest win in the sweep.** "Yield" is the word GDD
§2.8 already uses for the same quantity (*"Field yield — total ore per match"*), it
is what a survey calls it, and it frees `ORE` to mean only the resource — which
matters because signal yellow is reserved for ore (§5.1) and using the same word for
a lobby *setting* and a HUD *quantity* is a small, real ambiguity.

**`3 PLAYING · 5 BOTS` stays, deliberately.** `OPERATORS` is the ratified player
noun and this looks like its natural home — but bots are operators too in the
fiction, so `3 OPERATORS · 5 BOTS` blurs exactly the distinction the line exists to
draw. The plain word is doing real work. `[HOLD]`.

**Ship class blurbs are already the voice.** *"Scout and miner-hunter. Catches
miners in the open; melts against turrets."* Two fragments, a capability and a
weakness, no adjective of praise. Cite these to any agent unsure what the register
sounds like in a full sentence.

### 3.4 `src/ui/end-of-match.ts` — the two headlines

| Line | Current | Proposed | |
|---|---|---|---|
| 126 | `victory: 'VICTORY'` | `'CLAIM HELD'` | `[REC]` — see Q2 |
| 127 | `defeat: 'DEFEAT'` | `'CLAIM LOST'` | `[REC]` — see Q2 |
| 128 | `draw: 'DRAW'` | *(unchanged)* | `[OPT]` → `'NO CLAIMANT'` |
| 129 | `eliminated: 'ELIMINATED'` | *(unchanged)* | `[HOLD]` |
| 86–88 | `REMATCH` / `SPECTATE` / `BACK TO MENU` | *(unchanged)* | `[FIXED]` — GDD §2.7, §4.9 |
| 152–156, 177, 185, 187 | subheads / cause lines | *(unchanged)* | `[HOLD]` — already in register |

`VICTORY` / `DEFEAT` is the purest example of the register the developer rejected —
they are scoreboard words, and they *celebrate*. `CLAIM HELD` / `CLAIM LOST` states
the same outcome in the same sentence shape for both players: the authority files a
win and a loss identically, which is the whole character of the voice.

**This change is only permitted because of the line underneath it.** §4.7's
accessibility clause requires that an in-register headline sit above a plainly-stated
outcome. It does: `'You took the claim.'` (152) and `'${player} took the claim.'`
(154) already say who won, and `accentFor()` already carries the result in colour.
A headline swap that left the outcome to inference would be rejected. Verify this
pairing survives — see trap 2.

`ELIMINATED` stays: it is plain, it is not celebratory, and `CONTRACT TERMINATED`
is the corporate-joke register §4.7 explicitly forbids ("never winking").

### 3.5 `src/ui/hud.ts` + friends — the in-match chrome

| File · line | Current | Proposed | |
|---|---|---|---|
| `hud.ts:614` | `stationLabel = 'HOME'` | *(unchanged)* | `[FIXED]` — **§4, the sanctioned exception** |
| `hud.ts:904` | `'HOME LOST'` | *(unchanged)* | `[FIXED]` — same |
| `hud.ts:576` | `totalLabel = 'TOTAL'` | `'BANKED'` | `[OPT]` |
| `hud.ts:776` | `'COLLAPSE'` | *(unchanged)* | `[OPT]` → `'THE CRUSH'`, see Q5 |
| `hud.ts:780` | `'FINAL WAVE'` | *(unchanged)* | `[HOLD]` |
| `hud.ts:771/781/784` | `WAVE 3/5 · Mid Field`, `NEXT 1:23`, `MATCH 8:42` | *(unchanged)* | `[FIXED]` — clocks and numbers, §4.7 |
| `build-wheel-view.ts:261/417` | hub `'ORE'` | *(unchanged)* | `[FIXED]` — GDD §2.5 |
| `build-wheel-view.ts:699/700` | `'YOUR SHIP'` / `'YOUR STATION'` | *(unchanged)* | `[HOLD]` — already in register |
| `respawn-countdown.ts:73` | `` `RESPAWNING ${seconds}...` `` | *(unchanged)* | `[HOLD]`, see below |
| `controls-strip.ts:54` | `'Build & Upgrade — get closer to your station'` | *(unchanged)* | `[HOLD]` — already in register |
| `wave-clock.ts:29–33` | `Outer Drift` … `Claim Fall` | *(unchanged)* | `[FIXED]` — ratified interface, lore sweep §3 |
| `map-picker-view.ts:218` | `'VETERAN'` | *(unchanged)* | `[OPT]` |
| `nameplates.ts` | `(EASY)` suffix, `P1` decals | *(unchanged)* | `[FIXED]` — §5.2 identity |

**`TOTAL` → `BANKED` is `[OPT]`, not `[REC]`.** It is more precise (GDD §2.3 says
"banked total") and slightly more in register, but the string is asserted in
`affordability.test.ts` and three live-stage specs, and the win is small. l2-02's
call; if in doubt, leave it.

**`RESPAWNING 3...` stays.** Considered and rejected: `HULL IN 3`, `NEW HULL 3`,
`DISPATCH IN 3`. Respawning is a word every player knows, the string appears at the
worst possible moment to make somebody parse new vocabulary, and GDD §2.7 uses
"respawn" as the mechanic's name. Clarity rule.

**Every wheel segment label is `[FIXED]`** — `TURRET`, `SHIELD`, `RADAR`, `REPAIR
REACTOR`, `UPGRADE SHIP`, `BANK` (`build-wheel.ts:343–353`) and every upgrade track
(`upgrade-wheel.ts:156–202, 504`) are quoted verbatim in GDD §2.5. So are the
refusal lines' shapes; they are also already the best copy in the game.

One nit worth a line: `build-wheel.ts:452` renders `` `REPAIR in ${n}s` `` —
lower-case `in` inside an otherwise all-caps wedge. `[OPT]` case fix to `REPAIR IN
${n}s`; it is asserted in `build-wheel.test.ts` and `tests/live-stage/repair-wedge.spec.ts`,
so it is a two-file change for a typographic consistency win. Not a voice change.

### 3.6 `src/ui/settings.ts` — the screen the voice does not touch

Recorded in full so l2-02 does not go looking.

| Line | Current | |
|---|---|---|
| 221–222 | `'FIRE MODE'` / `'AUTO-AIM'` / `'MANUAL'` | `[FIXED]` — GDD §2.4 verbatim |
| 231–232 | `'CONTROLS'` / `'TAP COMMANDER'` / `'STICKS'` | `[FIXED]` — ratified p6-01, GDD §2.4 |
| 238–239 | `'REDUCE VFX'` / `ON` / `OFF` | `[FIXED]` — GDD §4.3 verbatim |
| 254 | `'SETTINGS'` / `'DONE'` | `[HOLD]` — §3.1 |
| 258–260 | `MASTER` / `SFX` / `MUSIC VOLUME` | `[HOLD]` — plain, universal |

**Every row of the settings screen names a ratified mechanic.** That is not an
accident of this sweep — it is what happens when a GDD specifies its own UI strings.
Nothing here moves.

### 3.7 Machine copy — quoted here to mark it OUT of scope

These strings are **not in scope** (§4 draws the line), but three of them must
still change because they quote a door label that is moving. That is the trap the
executing agent will otherwise miss.

| File · line | Current | Action |
|---|---|---|
| `connection-status.ts:129` | `'Lost the match server. PLAY SOLO still works offline.'` | `[REQ]` **door-label sync only** → `SOLO CONTRACT` |
| `online-copy.ts:92` | `'Can't reach the servers. Check your connection — PLAY SOLO still works.'` | `[REQ]` **door-label sync only** |
| `online-copy.ts:133` | `'Lost the server. PLAY SOLO still works offline.'` | `[REQ]` **door-label sync only** |
| `online-copy.ts:87` | `'No room with that code. Check it and try again.'` | `[REQ]` — **duplicate of `lobby-entry.ts:198`** |
| `connection-status.ts:98–132` | `CONNECTING` / `RECONNECTING` / `DISCONNECTED`, `'Reaching the match server…'`, `'A stand-in is holding your ship — 42s to rejoin.'` | **out of scope** — machine copy, and already good |
| `online-copy.ts:82/97/132/137/138/189` | server-full, snag, `MATCH ENDED`, `AWAY TOO LONG`, region-latency hint | **out of scope** |
| `net/connect-trace.ts:145–263` | `ALLOCATING ROOM…`, `ROOM Q5RN · TICKET SIGNED`, `DIALING MACHINE …`, `REFUSED: …`, `DOWNLOAD LOG to report this.` | **out of scope** — diagnostic seam |
| `platform/boot-error.ts:73–118` | WebGL / boot failure copy | **out of scope** — troubleshooting, not fiction |
| `platform/build-info.ts` | build badge / stamp | **out of scope** — explicitly plain per §4.7 |

Note the deliberate residue: after this sweep the lobby says **CLAIM** while the
connect trace says **ROOM**. That is the match/machine line working as designed —
the trace is a diagnostic surface reporting on the allocator, and the allocator has
rooms. If the developer wants them unified, that is Q6, not a silent fix.

### 3.8 The codex — 40 KB of prose, out of scope, and it needs a decision

`content/codex/codex-{bots,ships,systems,strategy}.json` — ~41 KB of player-facing
long-form prose, generated against GDD v0.7 with `"tone_pinned": true` and three
critic loops. The first entry opens:

> *"Planet Rush is a Saturday-morning space brawl with one serious rule underneath
> it…"*

It quotes register 1 directly. **Out of scope for l2-02**, and the recommendation is
to leave the corpus alone (see Q4) — but two things must happen regardless, and
neither is a copy change:

1. `content/codex/pipeline/tone.md` must gain register 2, or the *next* codex
   generation will silently reproduce the old voice. That file is the pipeline's,
   not the architect's.
2. The corpus's `generated.against` provenance says `GDD.md v0.7`. §4.7 has moved
   under it. Whoever owns the pipeline decides whether that is a re-stamp or a
   regeneration.

The codex is also *prose*, not chrome. §4.7's voice governs buttons, labels, and
refusals — the authority's own utterances. A codex entry is a document *about* the
claim, which can reasonably keep the narrator's register. Making that explicit is Q4.

---

## 4. Where the voice stops — the match/machine line

The scope line §4.7 draws, restated with its rationale because it is the part an
executing agent is most likely to over-apply:

> **The authority speaks about the claim. It does not speak about the machine.**

A dropped WebSocket, a failed WebGL context, a build hash, and a downloadable log
are facts about hardware. When the machine has failed there is no claim for an
authority to have jurisdiction over, and a player staring at a black screen needs
troubleshooting steps, not fiction. So: boot errors, connection status, region
latency, the connect trace, the build badge, the playtest log, every test id and
layout id, and all numbers, units and clocks stay **plain**.

The one crossing is mechanical, not editorial: **machine copy that quotes a door
label must follow the door.** Four strings do (§3.7).

**And one exception runs the other way — `HOME`.** The HUD's own-station label
(`hud.ts:614`) is warm, not industrial, and it stays. It is load-bearing on register
1: *"The pitch is a clock, and a home"* (GDD §1). The authority is allowed exactly
one word it does not own, and this is it. `HOME LOST` is the same word doing the
ache's work at the moment register 1 exists for. Any agent proposing `STATION` /
`STATION LOST` should be pointed at §4.7's fixed-strings list.

---

## 5. Collisions — decisions to surface, not absorb

### 5.1 `teamName()` — settled, and the voice does not get to revisit it

The developer ratified `FRIENDLY A` / `ENEMY B` on 2026-08-05, refining m10's
`TEAM A`. **u3-01 is implementing it on `agent/ui/u3-friendly-enemy-sides`** —
`teamName(team, viewerTeam)` gained a viewer argument, `SIDE_WORDS = { friendly:
'FRIENDLY', enemy: 'ENEMY' }`, and the now-dead `TEAM_WORD` export was dropped
(commits `6568c07`, `1625874`).

**That wording is fixed.** An industrial-voice pass would plausibly reach for
`CLAIMANT`, `RIVAL`, `COMPETING OPERATOR` — all of them worse, and all of them
reopening a decision made today for a stated reason (a player complained they could
not tell which side was theirs; `FRIENDLY A` answers that directly). The voice takes
no view. `lobby.ts:162`, `nameplates.ts:276`, `lobby-view.ts:479` are off-limits.

**Merge-order note for l2-02:** u3-01 touches `src/ui/lobby.ts` and
`src/ui/nameplates.ts`. This sweep touches `src/ui/lobby.ts` (nothing — every
lobby.ts row above is `[FIXED]` or `[HOLD]`) and `src/ui/lobby-view.ts` (lines 153,
543, 671). The file overlap is `lobby-view.ts:479` (u3's team chip) vs. 153/543/671
(this sweep) — different regions, no textual conflict expected. **Rebase on u3-01
after it merges** rather than racing it.

### 5.2 Tests that assert on the strings being changed

Verified by grep, not assumed. The exact set — five assertions, in four files:

| Test | Line | Asserts | Breaks if |
|---|---|---|---|
| `src/ui/end-of-match.test.ts` | 63 | `expect(victory.headline).toBe('VICTORY')` | §3.4 lands |
| `src/ui/main-menu.test.ts` | 32 | `toEqual(['PLAY', 'CODEX', 'SETTINGS'])` | §3.1 lands |
| `src/ui/menu-nav.test.ts` | 85 | `toEqual(['PLAY'])` | §3.1 lands |
| `src/ui/menu-nav.test.ts` | 99–100 | `e.via === 'PLAY SOLO'`, `e.via === 'CREATE ROOM'` | §3.2 lands |
| `tests/mobile/landscape-lock.spec.ts` | 337, 357 | `'PLAY'` / `'PLAY SOLO'` as **assertion-message text only** | never — cosmetic |

And one that **survives the rename by design**, worth copying: `lobby-entry.test.ts:213`
asserts `expect(ENTRY_ERRORS.offline).toContain('SOLO')` — a substring, not the
sentence. `'Cannot reach the server. SOLO CONTRACT still works.'` still passes. That
is the right way to pin "this error must point at the offline door" without pinning
the prose, and step 2's guard test should be written in the same spirit.

**None of these is a decision to surface.** Each is a test that pins the *current*
copy as documentation, and updating it alongside the string is the normal cost of a
copy change. They are listed so l2-02 updates them in the same commit rather than
letting CI find them.

**The one that is more than a test update: `src/ui/menu-nav.ts`.** The nav graph
hardcodes `via: 'PLAY SOLO'` (line 136), `via: 'CREATE ROOM'` (139), `via: 'JOIN
ROOM'` (134, 145), `via: 'PLAY'` (127) as hand-written strings — **it does not read
the label constants.** So the door labels exist in two places, and the second one is
a documentation graph nobody will think to grep. Change both, or the nav map starts
lying. (Deriving `via` from `ENTRY_DOORS` would fix this permanently and is arguably
the better change — flagged as Q7, since `menu-nav.ts` is deliberately a
hand-authored map and collapsing it may not be wanted.)

### 5.3 The Playwright suite is safe — measured, not assumed

`PLAY SOLO` and `CREATE ROOM` appear in **13 and 14 files** respectively across
`tests/live-stage/`, `tests/live-stage-online/`, `tests/mobile/` and `tests/net/`,
which looks like a catastrophic coupling. It is not.

Checked: the e2e specs drive the UI by **door id**, not by label —
`doorPoint(page, 'solo')` (`unified-play-flow.spec.ts:208`), and
`main-menu.spec.ts:281` resolves the door through a `page.evaluate` seam. Every
other occurrence is a comment or an assertion *message*. **No Playwright spec
selects on the door text.** The rename is a unit-test change plus `menu-nav.ts`,
not an e2e rewrite.

This is worth stating loudly because the raw grep count would reasonably scare an
executing agent into asking for a smaller scope.

### 5.4 The tone paragraph lives in three places; two are not mine to edit

`GDD.md` §4.7 is amended. The two mirrors are not:

| File | State | Owner |
|---|---|---|
| `GDD.md` §4.7 | **amended** (this branch) | Director |
| `style-guide.md` §8 | register 1 only — **and it still quotes the pre-pivot "when a *planet* dies"** | Director / Art (frozen contract) |
| `content/codex/pipeline/tone.md` | register 1 only | codex pipeline |

Both mirrors describe themselves as quoting §4.7 *verbatim*, so both are now
provably stale. `style-guide.md` was already flagged for the lore sweep in the GDD
v0.7 changelog and this makes it doubly so. Neither is in the architect's write
scope (docs/ and spikes/), and `style-guide.md` is *"changeable only through the
Director"* by its own last line. **Q3.**

### 5.5 Duplicate copy that will drift

`'No room with that code. Check it and try again.'` exists twice —
`lobby-entry.ts:198` and `online-copy.ts:87` — with no shared constant. Change one
and the other silently disagrees. Fix both (§3.2, §3.7); consider hoisting to one
constant, though that is a refactor and this sweep is not the place to smuggle one.

---

## 6. The task breakdown for l2-02 — needs-ordered, with TDD steps

Each step is independently shippable and green. **Do them in this order**; step 0 is
not optional.

### Step 0 — rebase, don't race
`agent/ui/u3-friendly-enemy-sides` is in flight and owns `lobby.ts` / `nameplates.ts`.
Wait for it to merge, then branch from `main`. Nothing in this sweep needs `lobby.ts`,
so there is no reason to fight over it. Re-verify §5.1's file-overlap claim after the
merge — u3's final diff may have grown.

### Step 1 — the end-screen headlines (smallest, highest signal)
1. **RED:** in `src/ui/end-of-match.test.ts`, change line 63 to
   `expect(victory.headline).toBe('CLAIM HELD')` and add
   `expect(endOfMatchModel(over(2, 5)).headline).toBe('CLAIM LOST')` — `over(you,
   winner)` and `eliminated(you)` are the file's existing helpers (lines 26–27), so
   no new fixture is needed. Run `npm test -- --run end-of-match`. It fails.
2. **GREEN:** edit `HEADLINES` (`end-of-match.ts:126–127`).
3. **GUARD (do not skip — this is the accessibility clause):** add a test asserting
   that for both `victory` and `defeat` the model's `subhead` is non-empty and names
   the claim, so a future edit cannot leave `CLAIM HELD` as the *only* statement of
   the outcome. §4.7 permits the headline swap **only** on that condition; encode it.
4. Re-run `tests/live-stage/end-screens.spec.ts` — it does not assert the headline
   text (checked), but it renders the screen, so confirm no layout overflow: `CLAIM
   HELD` is 10 chars vs `VICTORY`'s 7 at heading size.

### Step 2 — the doors and the code pad
1. **RED:** update `src/ui/menu-nav.test.ts:99–100` to the new labels; update
   `src/ui/lobby-entry.test.ts` for any hint/error assertions (grep first — as of
   this branch there are none on the literals in §3.2, but that may change).
2. **GREEN:** edit `ENTRY_DOORS` labels + hints (`lobby-entry.ts:98–111`),
   `ENTRY_ERRORS` (195–202), `promptLine` (445).
3. **SYNC — the step that gets forgotten:** `menu-nav.ts:134/136/139/145` `via`
   strings; `connection-status.ts:129`; `online-copy.ts:87/92/133`.
4. **GUARD:** add a test asserting no rendered string in `ENTRY_ERRORS` +
   `ONLINE_COPY` + `CONNECTION_*` contains the substring `PLAY SOLO`. That is the
   cheapest possible defence against the door-label-quoted-in-machine-copy trap
   recurring, and it will fail loudly the next time somebody renames a door.
5. Run the full `tests/live-stage/` + `tests/live-stage-online/` suites. Per §5.3
   they should pass untouched; if one fails on a text selector, §5.3 was wrong about
   that spec and it needs recording, not patching around.

### Step 3 — the lobby controls
1. **RED:** no test asserts `'ORE ·'`, `'WAITING FOR THE HOST'`, or `'ROOM'`
   (checked). Add coverage rather than changing it blind: a `lobby-view` model or
   golden test that pins the toggle label and the rush hint.
2. **GREEN:** `lobby-view.ts:153` (`ROOM` → `CLAIM`), `543` (`ORE ·` → `YIELD ·`),
   `671` (host → claim holder).
3. **MEASURE (trap 4):** `WAITING FOR THE CLAIM HOLDER` is 28 chars against
   `WAITING FOR THE HOST`'s 20, rendered at `FONT_BODY` 11px in `rushHint`. Measure
   the drawn width against `layout.rushHint` before committing. If it overflows or
   ellipsizes, **the clarity rule forbids shipping it** — fall back to
   `WAITING FOR THE HOLDER`, or keep `HOST`. Do not ship a truncated word.
4. Re-run `src/ui/lobby-geometry.test.ts` and the lobby live-stage specs.

### Step 4 — the front door (only after Q1 is answered)
`PLAY` → `TAKE A CONTRACT` is Q1 and touches `main-menu.ts:77`,
`main-menu.test.ts:32`, `menu-nav.ts:127`, `menu-nav.test.ts:85`, plus a width check
on the primary button at `FONT_HEADING`. **Do not do this on the architect's
recommendation alone** — it is the game's most-read string.

### Step 5 — the optionals, or not at all
`TOTAL` → `BANKED`; `REPAIR in` → `REPAIR IN`; `DRAW` → `NO CLAIMANT`; the
`VETERAN` tag. Each is a one-line change with a two-to-four-file test tail. Ship
them together or skip them together; do not dribble them into unrelated PRs.

### Definition of done for l2-02
- `npx tsc --noEmit` clean; `npm test -- --run` green; the `tests/live-stage*`
  suites green.
- Every `[REQ]` row applied, every `[REC]` row applied or explicitly declined in the
  PR body with a reason.
- The two guard tests from steps 1 and 2 exist.
- No `[FIXED]` string moved. Grep the diff for `FRIENDLY`, `ENEMY`, `RUSH!`,
  `REPAIR REACTOR`, `HOME`, `TAP COMMANDER` and confirm zero hits.

---

## 7. Traps

1. **Register 2 is not permission to rewrite register 1.** The tone paragraph is
   unchanged. If a diff touches VFX language, audio direction, or the
   station-death quiet, it is out of scope.
2. **`CLAIM HELD` is only legal because of the subhead.** §4.7's accessibility
   clause is a condition, not a nicety. If a future refactor drops or empties
   `subheadFor()`, the headline must revert. Step 1's guard test is what makes that
   enforceable instead of aspirational.
3. **The door labels exist twice** — `ENTRY_DOORS` and `menu-nav.ts`'s hand-written
   `via` graph (§5.2). The second one has no test failure to warn you if you skip
   it *and* you skip `menu-nav.test.ts`, so the nav map can silently start lying.
4. **Longer in-register words truncate.** `rushHint` is 11px, nameplates cap at 12
   characters (`NAMEPLATE_MAX_CHARS`), and HUD labels run 11–15px. A word that
   ellipsizes has traded information for flavour, which §4.7 forbids. Measure before
   committing; this is why step 3 has a MEASURE substep and not a hope.
5. **Machine copy quotes door labels in four places** (§3.7). The grep that finds
   them is `grep -rn "PLAY SOLO" src/ --include=*.ts | grep -v test`. Run it *after*
   the rename and expect zero rendered hits.
6. **`'No room with that code.'` is duplicated across two files** (§5.5). Fixing one
   is worse than fixing neither, because the disagreement is invisible.
7. **The raw grep counts for `PLAY SOLO` / `CREATE ROOM` look terrifying and are
   not** (§5.3). 13–14 files each, ~all comments and assertion messages; the e2e
   specs select on door *id*. Don't descope on the strength of a `grep -l`.
8. **`ORE` is a reserved word, twice over.** Signal yellow means ore or danger and
   nothing else (§5.1), and `ORE` is a GDD-verbatim wheel-hub label (§2.5). The
   `ORE ·` → `YIELD ·` change is specifically to *stop* the lobby using it for a
   setting; it is not licence to touch the hub or the HUD.
9. **Don't sweep the codex on the way past** (§3.8). It is 41 KB, it is generated,
   and regenerating it is a pipeline run with three critic loops — a token cost and
   a separate decision (Q4).
10. **`style-guide.md` is frozen and says so.** Its §8 is now stale in two ways
    (register 2 missing, "when a *planet* dies" pre-pivot), and it is still the
    Director's file. Flag, don't edit. (Q3.)

---

## 8. QUESTIONS FOR THE DEVELOPER

1. **`PLAY` → `TAKE A CONTRACT`?** The front door and the single most-read string in
   the game. In favour: it establishes "you are a contracted operator" before any
   other word, and it reads straight into the three doors beneath it. Against: four
   syllables vs. one, and `PLAY` is the universal affordance. *Architect
   recommendation: **yes** — it is where the voice either lands or doesn't, and
   `TAKE A CONTRACT` is unambiguous. Blocking step 4 only.*

2. **`VICTORY` / `DEFEAT` → `CLAIM HELD` / `CLAIM LOST`?** These are the scoreboard
   words the ratification was aimed at, and the subheads underneath already state
   the outcome plainly. *Architect recommendation: **yes**, proceeding on it as
   `[REC]`. Say so if you'd rather keep them.*

3. **The two out-of-document mirrors of the tone paragraph** — `style-guide.md` §8
   (frozen, Director-only, and still says "when a *planet* dies") and
   `content/codex/pipeline/tone.md` (pins register 1 into every generation). Both
   claim to quote §4.7 verbatim and both are now stale. Who updates them, and in
   this cycle or next? *Recommendation: `pipeline/tone.md` this cycle — otherwise
   the next codex generation reproduces the old voice — and `style-guide.md` folded
   into its already-pending lore sweep.*

4. **Does the voice retro-apply to the codex?** ~41 KB across four files, generated
   with `tone_pinned: true` against GDD v0.7, opening *"Planet Rush is a
   Saturday-morning space brawl…"*. *Recommendation: **no.** A codex entry is a
   document about the claim, not the authority speaking; the interface voice governs
   chrome. Keep the corpus, add register 2 to the pipeline's tone file so future
   entries know the difference, and re-stamp the provenance. Regenerating is a real
   token cost for a register question the codex may not even have.*

5. **HUD `COLLAPSE` → `THE CRUSH`?** Carried forward unanswered from
   `docs/lore-copy-sweep.md` Q4, and the voice does not change the answer.
   *Recommendation: keep `COLLAPSE` — it names a mechanic that shuts off repair and
   shields, and legibility wins.*

6. **Does adopting "rigs" in the vocabulary reopen the home-noun?** The handoff's
   illustrative lexicon was *"contracts, rigs, operators, seals."* But the shipped
   code says **station** (`target: 'station'`, `'YOUR STATION'`, `'Your station is
   under attack'`), GDD §0 fixes it, and §0 already spends "rig" on *abandoned rig*
   = a derelict. *Recommendation: **no — home stays STATION.*** §4.7 binds "rig" to
   hardware and derelicts. Renaming the home noun now would be a second full lore
   sweep across `src/`, `content/codex/`, and `milestones.json` for no mechanical
   gain. Say the word if you disagree — it is your fiction, but it is not a copy
   pass.

7. **Should `menu-nav.ts`'s `via` labels derive from `ENTRY_DOORS`** instead of being
   hand-written? It would permanently close trap 3. *Recommendation: leave it —
   `menu-nav.ts` is deliberately a hand-authored map of the whole flow, including
   edges with no button (`'(host started)'`, `'(match over)'`), so half of it can't
   derive from anything. Update both by hand and keep the guard test.*

8. **The lobby will say `CLAIM` while the connect trace says `ROOM`** (§3.7). That is
   the match/machine line working as intended — the trace reports on the allocator,
   and the allocator has rooms. *Recommendation: accept the seam. Flag it if you'd
   rather the trace moved too; it's a diagnostic surface, so it would be a small
   change with no clarity cost either way.*

---

## 9. Reproducing this inventory

Every row above came out of a grep, not memory. The sweep is re-runnable:

```sh
# Display copy across every non-test UI module — ALL-CAPS labels and sentence-case prose.
for f in $(ls src/ui/*.ts | grep -v '\.test\.ts'); do
  grep -nE "'[A-Z][A-Z0-9 &?!,.:%/'-]{2,}'|'[A-Z][a-z][^']*[ ,.—][^']*'" "$f" \
    | grep -vE "^[0-9]+: *(\*|//)" | grep -vE "import |from '|@link"
done

# Which tests assert on a given literal (run per candidate string).
grep -rn "'VICTORY'" src/ui/*.test.ts tests/

# Door labels quoted inside other copy — must be zero rendered hits after the rename.
grep -rn "PLAY SOLO" src/ --include=*.ts | grep -v '\.test\.ts'

# How the e2e specs actually select a door (the §5.3 finding).
grep -rn "doorPoint\|soloDoor" tests/live-stage/ tests/live-stage-online/
```

The first pattern over-matches type-union literals (`'ffa'`, `'closed'`) and
under-matches template strings; both were reconciled by hand against the files.
Treat it as a net, not an oracle.

---

## 10. What this sweep is worth

Roughly **19 strings move.** Two headlines, three door labels, two door hints, four
error lines, three lobby labels, four machine-copy door references, and one prompt
line — plus five test assertions and four `menu-nav` graph edges. Perhaps 12 more sit
in `[OPT]`.

The other ~90 player-facing strings do not move, and the reason is the interesting
part: the GDD specifies most of its own UI words, the lore pivot already moved the
nouns, and the copy that was written free-hand — the onboarding prompts, the wheel
refusals, the ship blurbs, `'Your station falls the moment you go.'` — was written
in this voice before anybody named it. The ratification is less a change of
direction than a decision to stop making the exception for menus.
