# Lore copy sweep — "planets" → mining facilities

## 0. RATIFIED EXCEPTION — THE FOUR ENTRY DOORS ARE PLAIN, AND NOT YOURS (2026-08-07)

Before executing anything below, or any other copy pass: **the four buttons on the
entry screen are outside every voice and fiction sweep.** They are `CAMPAIGN`,
`SOLO`, `HOST`, `JOIN`, and so are the plain hints under them. The developer,
2026-08-07, reading the screen the industrial-voice sweep had produced:

> *"you took this too far, its too complicated, you can switch it back to how it
> was CAMPAIGN, SOLO, HOST, JOIN... its way too complex for new players to
> understand"*

This list never contained those four strings — the doors were re-worded by
`docs/copy-sweep-industrial-voice.md` §3.2, which is where the exception is
recorded in full, and where a voice pass must read it. It is repeated here because
this document is the other list a copy agent opens, and the entry screen is the one
screen a player meets before they have played anything: it says what the button
does and nothing else.

Delivered by **a0-15** (UI). Enforced by `src/ui/lobby-entry.test.ts` (the four
words, pinned with the quote) and `src/ui/voice-door-labels.test.ts` (no refusal
may name a door that is not on the screen). Everything else below is unaffected.

---

**Status:** delivered spike (branch `agent/architect/l1-station-lore`). This is the
execution list the **UI Engineer** runs in a follow-up: every *player-facing* string
that says "planet" or leans on the old fiction, with its replacement. The fiction
rewrite of the GDD itself is already done (GDD v0.7, §0 glossary + section sweep);
this doc is the code-side companion.

**One hard constraint (ratified):** *internal code identifiers keep `planet`.* Variable
names, type names, function names, CSS classes, sprite/atlas keys, the `target: 'planet'`
field, file names — none of them move. Churning them buys no player value. Only the
literal text a human **reads on screen or hears** changes. Every entry below is a
rendered string; code comments and identifiers around it are explicitly left alone.

---

## 1. Term contract (mirror of GDD §0 glossary)

The GDD is truth; this table is its operational form. The **home-noun is a placeholder**
until the developer ratifies it (see §2); every other new term below is a fixed choice
made in this spike and can be used immediately.

| Old fiction word (on screen) | New fiction word | Placeholder? |
|---|---|---|
| planet (your home) | **station** | **YES** — see §2 |
| core / planet core (win object) | **reactor** | no — fixed |
| atmosphere (bank radius) | **collection field** | no — fixed |
| repair core (the ore tap) | **repair reactor** | no — fixed |
| the system / the arena (locale) | the **claim** | no — fixed |
| derelict (unused slot) | **abandoned rig** | no — fixed |
| collapse (end phase) | keep **COLLAPSE** *(flavor: "the Crush")* | no — fixed |
| asteroid wave | keep — already on-theme (ore surges of the belt) | no |

> Wherever a replacement below reads **station / FACILITY**, substitute the ratified
> home-noun (§2) at execution time. Everything else is final.

---

## 2. The naming pass — DEVELOPER PICKS ONE (from the PR body)

The home-noun is the only open decision. Four candidates, one-line case each; the sweep
uses **FACILITY** as the working placeholder until you pick.

| Candidate | The one-line case |
|---|---|
| **FACILITY** | Literal — it is exactly the word the pivot brief used ("mining facilities"); unambiguous and safe; reads slightly corporate/flat, and it's three syllables for HUD lines. |
| **RIG** | Punchiest — one syllable, grubby-industrial, great on a cramped HUD ("YOUR RIG", "RIG UNDER ATTACK"); the most "toy" of the set, best fit for the Saturday-morning tone. *Caveat:* collides with "abandoned **rig**" for derelicts — pick a different derelict word if RIG wins (see §6 Q2). |
| **STATION** | Familiar sci-fi, reads clean; but "station" implies habitation/dock, not extraction, so it undersells the mining premise. |
| **OUTPOST** | Frontier/claim flavor, pairs naturally with "contested claim"; two syllables, evocative of staking remote ground. |

**Architect recommendation:** **RIG** for tone and HUD economy (resolve the derelict
collision per §6 Q2), with **FACILITY** as the safe literal if you'd rather not touch the
derelict word. Either way the swap is mechanical once ratified.

**Antagonist (named in this spike, no developer pick required):** the collapsing belt +
end phase are re-fictioned as **"the Crush"** — the claim's boundary contracting inward.
It rides existing mechanics only (the 5-wave metronome and the collapse phase); no new
system. Art/Audio may *skin* it as belt-fauna drawn to mining noise. See GDD §0.

---

## 3. The sweep — file by file

Each row: exact **old** literal → **new** literal. `[REQ]` = fiction change required for
consistency; `[REC]` = recommended flavor lift; `[OPT]` = optional. Line numbers are as
of this branch — the UI agent should match on the string, not the line.

### `src/ui/build-wheel.ts` — build-wheel labels
| Line | Old | New | |
|---|---|---|---|
| 273 | `'REPAIR CORE'` | `'REPAIR REACTOR'` | [REQ] |
| 329 | `'CORE FULL'` | `'REACTOR FULL'` | [REQ] |
| 327 | `'NO REPAIR'` | *(unchanged)* | — |

> The `target: 'planet'` on the same object (line 273) is a **code identifier — do not touch.**
> Only the `label` string moves.

### `src/ui/build-wheel-view.ts` — wedge sub-label (rendered)
| Line | Old | New | |
|---|---|---|---|
| 686 | `'YOUR PLANET'` | `'YOUR FACILITY'` | [REQ] |

> The sibling `'YOUR SHIP'` has no fiction word — unchanged. The literal lives here, not in
> `build-wheel.ts` (which only sets `target: 'planet'`, unrendered).

### `src/ui/onboarding.ts` — coach prompt
| Line | Old | New | |
|---|---|---|---|
| 94 | `'Your planet is under attack — follow the arrow'` | `'Your station is under attack — follow the arrow'` | [REQ] |

> Line 74 (`'Hold {fire} on the asteroid — your shots chip the rock'`) is **on-theme —
> keep.** Comments at lines 22/24/26/54 are not rendered — leave them.

### `src/ui/pause-menu.ts` — exit confirm line
| Line | Old | New | |
|---|---|---|---|
| 209 | `'Your planet falls the moment you go.'` | `'Your station falls the moment you go.'` | [REQ] |

### `src/ui/controls-strip.ts` — desktop legend hint
| Line | Old | New | |
|---|---|---|---|
| 54 | `'Build & Upgrade — get closer to your planet'` (`BUILD_AWAY_HINT`) | `'Build & Upgrade — get closer to your station'` | [REQ] |

> Comments at 49/71/72 reference `planet` — not rendered, leave.

### `src/ui/end-of-match.ts` — end-screen headlines / cause lines
| Line | Old | New | |
|---|---|---|---|
| 152 | `'You took the system.'` | `'You took the claim.'` | [REC] |
| 154 | `` `${playerLabel(outcome.winner)} took the system.` `` | `` `${playerLabel(outcome.winner)} took the claim.` `` | [REC] |
| 156 | `'No core survived the collapse.'` | `'No reactor survived the collapse.'` | [REQ] |
| 177 | `'Your core is gone — but the fight goes on.'` | `'Your reactor is gone — but the fight goes on.'` | [REQ] |
| 185 | `'your core was destroyed.'` | `'your reactor was destroyed.'` | [REQ] |
| 187 | `'the collapse closed over your core.'` | `'the collapse closed over your reactor.'` | [REQ] |

> "system" → "claim" ties the end screen to the mining-claim premise. If you adopt the
> "Crush" flavor, line 187 may read `'the Crush closed over your reactor.'` [OPT].

### `src/ui/wave-clock.ts` — asteroid-wave names (`WAVE_NAMES`)
The set `Outer Drift → Far Belt → Mid Field → Inner Ring → Core Fall` is an outer→inner
progression that **already fits** the collapsing-belt fiction — keep four of five.
| Line | Old | New | |
|---|---|---|---|
| 33 | `'Core Fall'` | `'Claim Fall'` | [REC] |

> Only `Core Fall` clashes now that "core" = the reactor. `Claim Fall` keeps the "final,
> innermost wave" meaning without the reactor collision. The array's own comment calls it
> a *tunable, ratified interface* — safe to change. `Outer Drift`/`Far Belt`/`Mid Field`/
> `Inner Ring`: **keep.**

### `src/ui/hud.ts` — wave-clock collapse state
| Line | Old | New | |
|---|---|---|---|
| 748 | `'COLLAPSE'` | *(keep — clear mechanic label)* | [OPT → `'THE CRUSH'`] |

> Recommendation: **keep `COLLAPSE`** for legibility; only swap to `'THE CRUSH'` if you
> want the antagonist name on the HUD. `COLLAPSE_CORE_DECAY` (imports/comments) is code — leave.

### `milestones.json` — milestone `test_notes` + two `title` fields
These are tester/ntfy notes. Most are **archival** (past tags already pinged); the value
is in *future* tags and re-tags. Apply the word swaps below to any note that will be
re-pinged; normalizing the archival ones is [OPT] consistency. Swap rules:

- `planet` → `station` (e.g. `:20`/`:50` titles "planets, turrets, war" → "facilities, turrets, war"; `:41` "every home planet" → "every home station"; `:56` "over every ship and planet" → "over every ship and station"; `:66` "wedge on planet rims" → "wedge on station rims").
- `your planet atmosphere` (`:61`) → `your station's collection field`.
- `core` (win object) → `reactor` (`:21`/`:26`/`:41`/`:56`/`:66`/`:31` "last core standing" → "last reactor standing"; "your core" → "your reactor").
- **Keep** `asteroid`, `wreck` (a wreck is a station wreck — on-theme), map/field words.

> **Bonus catch for QA (out of my lore scope, flagged not fixed):** several of these notes
> also carry *stale mechanics* words from before ratified amendments — `beam` (`:16`),
> `laser` (`:56`), and `repair channel` (`:21`/`:26`/`:91`, now a *discrete* purchase per
> GDD §2.5). Worth a separate normalization pass; not part of the lore swap.

---

## 4. Deliberately NOT changed

- **Game title `PLANET RUSH`** — the brand/wordmark. Recurs in `main-menu.ts:59`,
  `main-menu-view.ts:49`, `lobby-view.ts:115`, `lobby-entry-view.ts:103`,
  `lobby-entry.ts:362`, and the boot/error/build banners (`platform/boot-error.ts:90/108`,
  `platform/build-info.ts:116`). Kept per GDD §0 (title keeps `planet`). *Renaming the
  product is a separate, bigger decision — see §6 Q1.*
- **Map display names** — `The Ring / The Compass / The Oval / Double Diamond`
  (`sim/maps.ts`): no fiction word, all on-theme. Keep.
- **All code identifiers** — `planet`/`core` in variables, types, `target: 'planet'`,
  sprite/atlas/`beacon ring` keys, CSS. Keep (the whole point of the constraint).
- **Bot personality `blurb` fields** (`src/bots/personalities.ts:320/338`) — contain
  "planet"/"wreck" but are **never rendered** (confirmed); leave until/unless they ship.

---

## 5. Traps for the executing agent

1. **Match the string, not the line number** — line numbers drift; every entry above is
   the exact literal.
2. **`build-wheel.ts:273` has both a rendered label and a code field on one line** —
   change `label: 'REPAIR CORE'` → `'REPAIR REACTOR'`; **do not** touch `target: 'planet'`.
3. **`'YOUR PLANET'` lives in `build-wheel-view.ts:686`, not `build-wheel.ts`** — the wheel
   file only sets the unrendered `target`. Grepping `build-wheel.ts` for `PLANET` finds
   only comments.
4. **Golden/screenshot tests** — the build-wheel and end-of-match strings are likely
   asserted in unit or live-stage snapshots. Changing `REPAIR CORE`→`REPAIR REACTOR` and
   `YOUR PLANET`→`YOUR FACILITY` will red those tests; regenerate goldens as part of the
   same PR, don't leave them for CI to discover.
5. **`WAVE_NAMES` is a ratified interface** — QA/Art may key off the array; announce the
   `Core Fall`→`Claim Fall` change in the PR body.
6. **Do the placeholder substitution last** — pick the home-noun (§2) first, then a single
   find/replace of `station`/`FACILITY` in the *new* column resolves every home string at
   once.

---

## 6. QUESTIONS FOR THE DEVELOPER

1. **Home-noun:** ratify one of FACILITY / RIG / STATION / OUTPOST (§2). Architect pick:
   **RIG** (tone + HUD), else **FACILITY** (safe literal).
2. **If RIG wins, the derelict word collides** — "abandoned **rig**" for a derelict reads
   oddly when your home is also a rig. Alternatives for derelict: **abandoned claim /
   dead rig / gutted rig / derelict** (keep as-is). Pick one, or accept "abandoned rig".
3. **The game title `PLANET RUSH`** — kept as the brand this pass. Do you want it pivoted
   (e.g. *Claim Rush / Rig Rush*) or is the title deliberately staying as the product
   name while the in-fiction noun moves? (Renaming touches 8 files + store/PWA manifest +
   marketing — a bigger call than this sweep.)
4. **HUD collapse label** — keep `COLLAPSE`, or show `THE CRUSH` (the named antagonist)?
   Architect pick: keep `COLLAPSE` for legibility.
5. **Station art dressing** — GDD §5.4 keeps the round claimed-planetoid body as the
   station's visual. Do you want Art to add industrial dressing (rigs/gantries/docking
   arms), or is the claimed-planetoid look enough? (Art follow-up, not this sweep.)
6. **Sibling docs still speak the old fiction** — `style-guide.md` (tone paragraph +
   "repair channel") and `docs/mobile-cross-platform-amendment.md` need the same sweep.
   In scope for a follow-up, or leave them for the Director/Art next pass? (Flagged in
   GDD v0.7 changelog.)
