# docs/settings.md — what each setting actually does

Every row of the settings screen, traced to the code that implements it. Not the
design intent, not the help text — the line that runs.

Written 2026-08-19 (a0-91). It exists because the FIRE MODE help shipped a
sentence saying the player chooses when to fire, and two readers checked it
against `fireShip()` (`src/sim/step.ts:671`), saw `intent.fire` required in both
branches, and called it true. It is false on the default control scheme, because
`TapPilot` writes `fire` itself (`src/platform/tap-pilot.ts:376`). Nothing on
disk said so, so the sentence survived two reviews.

**Before you write copy that says what a setting does, read this file and check
it still matches the code.** Every behavioural claim below carries a
`file.ts:line`. Re-run the trace rather than trusting the sentence.

**Amended 2026-08-19 (a0-93 and a0-92)**: mismatches 2, 3 and 4 are FIXED.
CONTROLS' help no longer claims an aim the shipped default never emits (a60bbe9);
the four rows that did not persist now do, through the same seam as the other
two, and the main menu's volume rows reach the mixer (91828dfe). All three are
struck below rather than deleted, so the next reader can still see the shape of
the defect. **Mismatch 1 still stands.** Both fixes moved code under this file
and every `file.ts:line` has been re-traced against the merged tree.

**Amended 2026-08-19 (a0-95)**: the dead third path in the lobby flow is
DELETED, not merely flagged (commit 5dd02c75) — see FIRE MODE's section note and
checklist item 5. This file is a trace of what the code does, so it no longer
describes a function that does not exist.

**Amended 2026-08-19 (a0-100b): mismatch 1 is FIXED (1aad98b2), and this table
now has nothing left standing.** FIRE MODE is no longer a toggle that reaches
nothing under the default scheme: under Tap Commander the row is SHOWN, LOCKED
and reads AUTO-FIRE, and the developer ruled it so after reading the code path
and a0-96's measurement — *"you're right in tap commander manual fire does
nothing. so we should disable the selection for fire mode when tap commander is
active and set fire mode to Auto-Fire but still have it grayed out so people
can't toggle it"*. All four are struck rather than deleted, so the next reader
can still see the shape of each defect. Every `file.ts:line` below has been
re-traced against the merged tree.

---

## MISMATCH summary

| # | Row | What is wrong | Where |
|---|-----|---------------|-------|
| ~~1~~ | ~~**FIRE MODE**~~ | ~~Inert on the default control scheme. Under Tap Commander the row's value is discarded every frame and replaced by the pilot's own `tapMode`. The chip still shows AUTO-AIM / MANUAL and still toggles.~~ **FIXED 1aad98b2 (a0-100b)** — under Tap Commander the row is locked, reads AUTO-FIRE, draws in the disabled tokens and refuses a press; on the sticks it is live and unchanged. The value is still discarded on that branch, and that is now the POINT rather than the defect: nothing on screen claims otherwise. Held by `the fire mode row cannot be toggled under tap commander` (`src/ui/settings.test.ts`). | `src/main.ts:3662`, `src/main.ts:3663`; the lock at `src/ui/settings.ts:465` |
| ~~2~~ | ~~**CONTROLS**~~ | ~~Help says "you steer and aim yourself" on the sticks scheme. Under AUTO-AIM — the shipped default — no aim is emitted and the sim picks the target, so the player does not aim on any device.~~ **FIXED a60bbe9 (a0-93)** — the row now says who flies the ship, which holds in either fire mode. Held by `the controls help does not claim aiming the player does not do` (`src/ui/settings.test.ts`). | `src/ui/settings.ts:697` vs `src/platform/actions.ts:162`, `src/platform/actions.ts:58` |
| ~~3~~ | ~~**REDUCE VFX + all three volumes**~~ | ~~Not persisted. The header eyebrow reads CHANGES SAVE IMMEDIATELY; four of six rows are gone on reload.~~ **FIXED 91828dfe (a0-92)** — all four persist through `SETTINGS_STORAGE` and are read back at boot. | `src/ui/settings.ts:269`, `src/ui/settings.ts:348` |
| ~~4~~ | ~~**REDUCE VFX + all three volumes, on the MAIN MENU screen**~~ | ~~Reach nothing at all. No mixer call, no renderer (none exists yet), and the value is discarded when the match boots.~~ **FIXED 91828dfe (a0-92)** — the menu's volume rows push the mix, and both rows write the store the match boots from. REDUCE VFX still reaches no renderer on the menu, because there is none to reach; it is no longer discarded. | `src/main.ts:9780`–`src/main.ts:9796` |

Rows that are honest: **all six**, since a0-100b. MASTER, SFX and MUSIC are clean on both
surfaces — the words describe the mixer correctly and the row is live wherever it
is drawn. REDUCE VFX is clean too, with one honest gap: on the main menu it
stores rather than shows, because the renderer it thins is built after that
screen closes. CONTROLS' words have been true everywhere since a0-93 — the row
itself was never the problem, only what its help borrowed from FIRE MODE's.

**Nothing is standing.** Mismatch 1 was FIRE MODE's alone and it was never a
copy fix — the row was inert under the default scheme, so no wording could make
the chip honest. The repair was therefore the ROW: it is locked where the value
reaches nothing, and it says which word is true where. Read the four struck rows
above as four fixed defects, and the shapes they took, not as a clear file: a
row that shows a value the game never reads is the pattern, and it can come back
anywhere on this screen.

---

## The screen, and where it lives

There are **two** live settings screens, and they hold **separate state**:

| Surface | Model call | Settings value |
|---|---|---|
| Main menu → SETTINGS | `src/main.ts:8636` | `settings`, `src/main.ts:8096` |
| In-match pause → SETTINGS | `src/main.ts:3514` | `matchSettings`, `src/main.ts:1832` |

They are still two values and must stay two: the menu is torn down before the
match world exists, so an object shared between them cannot survive the trip.
Since a0-92 they agree by both reading and writing **storage** — the same
mechanism FIRE MODE and CONTROLS have always used.

Both are built by `settingsModel` (`src/ui/settings.ts:906`) and both walk the
same row list, `SETTINGS_ROWS` (`src/ui/settings.ts:546`) — six rows, in this
order: FIRE MODE, CONTROLS, REDUCE VFX, MASTER VOLUME, SFX VOLUME, MUSIC VOLUME.

`SettingsState` (`src/ui/settings.ts:183`) holds only `reduceVfx` and the three
volumes. FIRE MODE and CONTROLS are not in it: they live as loose values beside
each screen. All six persist, and all six keys are named in one table,
`SETTINGS_STORAGE` (`src/ui/settings.ts:269`) — `src/main.ts` points its own
`FIRE_MODE_KEY` (`src/main.ts:543`) and `CONTROL_SCHEME_KEY`
(`src/main.ts:551`) at the first two strings.

Boot order matters. `boot()` awaits the menu at `src/main.ts:1118` before reading
`fireMode` (`src/main.ts:1772`) and `controlScheme` (`src/main.ts:1779`), so a
menu change to those two *does* carry into the match — through storage, not
through the object. Since a0-92 the other four ride exactly that: `matchSettings`
at `src/main.ts:1832` is `loadSettings(platform.storage)`
(`src/ui/settings.ts:348`), not a fresh `createSettings()`, and the audio engine
itself boots at the saved mix (`src/main.ts:856`).

One path writes them. `commitSettings` (`src/ui/settings.ts:423`) folds a REDUCE
VFX or volume press, persists the value (`saveSettings`,
`src/ui/settings.ts:362`) and pushes the mix into the engine (`applyVolumes`,
`src/ui/settings.ts:382`). Both screens call it and nothing else does — the pause
screen at `src/main.ts:3457`, the menu at `src/main.ts:9792` — which is what
stops one screen quietly growing a shorter path again, the shape of both
mismatch 3 and mismatch 4.

~~A third settings code path exists in the lobby flow (`flowTapSettings`,
`src/ui/lobby-flow.ts:789`). It folds values into `FlowState.settings`, and no
`settingsModel` call site reads that field — it is not wired to a rendered
screen.~~ **DELETED 2026-08-19 (a0-95, commit 5dd02c75.)** The Director ruled on
it: the handler, the `FlowState.settings` field, `FlowState.settingsReturn` and
the flow's whole `settings` screen are gone from `src/ui/lobby-flow.ts`. There
are now exactly **two** settings screens and **one** write path, which is what
the rest of this section describes. `src/main.ts` never called any of it — it
imports one symbol from that module, `wireFireMode` (`src/main.ts:294`), which
spells a fire mode for the wire and touches no setting.

The header eyebrow is `CHANGES SAVE IMMEDIATELY` (`src/ui/settings.ts:892`).

---

## FIRE MODE

**Label** `FIRE MODE` (`src/ui/settings.ts:937`) — unchanged on both schemes. GDD
§4.7 lists it among the fixed strings, and with the values honest per scheme
there is nothing left for a rename to fix (a0-100b closed the pending rename that
used to sit at the bottom of this section).
**Values** — **they follow the SCHEME**, not the stored mode alone
(`fireModeValue`, `src/ui/settings.ts:493`; drawn at `src/ui/settings.ts:939`):

| Scheme | Chip | Live? |
|---|---|---|
| Tap Commander (`tap`, the default) | `AUTO-FIRE` | **no — LOCKED** |
| Sticks | `AUTO-AIM` / `MANUAL` | yes |

**Default** `AUTO-AIM`, the same on every platform
(`src/platform/actions.ts:58`; asserted at `src/platform/actions.test.ts:28`).
It is what the SAVE holds; on the default scheme the chip reads AUTO-FIRE over it,
because the scheme fires whatever the save says.
**Persisted** yes — `planet-rush:fireMode` (`src/ui/settings.ts:269`, wired at
`src/main.ts:543`), written by `commitFireMode` (`src/ui/settings.ts:520`) and by
nothing else: the pause screen at `src/main.ts:3437`, the menu at
`src/main.ts:9767`, the `F` shortcut at `src/main.ts:7154`. Read back through
`readStoredFireMode` (`src/platform/actions.ts:74`), where a saved choice beats
the default.

### What it actually does

The value reaches the sim through one call: `mapActions(merged, mode)`
(`src/main.ts:3663`). Inside `mapActions` (`src/platform/actions.ts:155`):

- **MANUAL** — the `aim` action is emitted (`src/platform/actions.ts:162`) and
  `fire.auto` is false. `fireShip` sends the shot straight down the barrel
  (`src/sim/step.ts:687`).
- **AUTO-AIM** — no `aim` action is emitted, `fire.auto` is true, and `fireShip`
  fires at the target the sim acquired across the full 360°
  (`src/sim/step.ts:675`–`src/sim/step.ts:681`). Nothing in range holds fire
  (`src/sim/step.ts:678`).

So the row changes **aiming**, not firing. `intent.fire` is required in both
branches (`src/sim/step.ts:673`) — which is the reading that produced the wrong
finding twice, because it says nothing about who *writes* `intent.fire`.

### Per control scheme

**Tap Commander (`tap`) — LOCKED, and it says so.** This is the default scheme on
every platform. The row is drawn, it reads `AUTO-FIRE`, it is dim, and a press
refuses instead of toggling. Why:

`src/main.ts:3662` computes the mode from the pilot's own order and
`src/main.ts:3663` passes that instead of the row's value:

```ts
const tapMode = tapPilot.lockedRef ? FireMode.Manual : FireMode.AutoAim;
const actions = mapActions(merged, tap ? tapMode : fireMode);
```

The player's `fireMode` is not read on this branch. And the trigger is not
theirs either: with no lock the pilot holds it unconditionally
(`state.fire = true`, `src/platform/tap-pilot.ts:376`); with a lock it fires on a
hostile in range (`src/platform/tap-pilot.ts:429`). The no-lock line is the
default path — reading only the lock branch is what made the row look honest.

That is also **why the word is AUTO-FIRE here and nowhere else**: on this scheme
the game really does pull the trigger, with no target chosen and no range test.

What the lock is made of, all of it in the model and none of it in a view:

- `fireModeLocked(scheme)` (`src/ui/settings.ts:465`) — one answer, four readers.
- `commitFireMode` (`src/ui/settings.ts:520`) refuses the press: the mode comes
  back untouched, **nothing is written**, and `moved` is false. The seated value
  is not overwritten to Auto-aim either — a MANUAL chosen on the sticks is still
  there when the player switches back.
- `settingsModel` (`src/ui/settings.ts:906`) marks the row `disabled`
  (`src/ui/settings.ts:950`), drops `on`, and pins the plate at `rest` so it does
  not sink under a press that does nothing.
- `settings-view` draws the label and the value in `./button-theme`'s ratified
  DISABLED tokens (`src/ui/button-theme.ts:69`, `src/ui/button-theme.ts:72`) —
  the only place this directory allows the gray. The row's `?` stays bright: it
  is the one live control on the row, and the reason for the lock is behind it
  (the p4-03 rule that a disabled control carries its reason).
- Both screens still cue: `detent` when the press moved something, `reject` when
  it did not (`src/main.ts:3439`, `src/main.ts:9769`) — the same refusal a volume
  slider at its rail gives, so the press is answered rather than swallowed.

The row is inert on every other surface under `tap` too, which is the rest of the
reason it is locked rather than merely re-worded:

- Touch furniture: `liveOnGlassControls` returns the same three falses for both
  modes (`src/ui/live-controls.ts:97`–`src/ui/live-controls.ts:100`).
- Controls strip: `describeBindings` returns early on `tap` without reading
  `mode` (`src/platform/actions.ts:312`–`src/platform/actions.ts:319`).
- Onboarding prompts: `lessonFor` returns `copy.tap` before the mode is
  consulted (`src/ui/onboarding.ts:447`).

**Sticks (`sticks`) — LIVE, and unchanged.** All of the above branches on the
mode: `src/main.ts:3663` passes the player's value; the aim stick / FIRE button
swap on touch (`src/ui/live-controls.ts:104`, `src/ui/live-controls.ts:105`); the
strip drops its Aim row in AUTO-AIM (`src/platform/actions.ts:324`).

**And this is why the chip does NOT say AUTO-FIRE here.** On the sticks, Auto-aim
moves the AIM and nothing else: `mapActions` drops the `aim` action and flags
`fire.auto` (`src/platform/actions.ts:162`), while `fire.active` is still whatever
the player was holding — the FIRE button on touch, the trigger on a pad, the left
mouse button on a PC (`describeBindings`, `src/platform/actions.ts:324`). Calling
that AUTO-FIRE would put a fresh false word on the screen in the exact place
a0-89 removed one.

### The wire

`fireMode` rides every `lobbyChoice` (`src/ui/lobby-flow.ts:360`,
`src/net/session.ts:311`) and the server decodes it — but no file under
`server/*.ts` references it, and the offline loopback drops it on the floor
(`chooseInLobby(message.shipClass)`, `src/net/loopback.ts:177`). The mode is
applied client-side only. The lock does not change this: what rides the wire is
the stored value, and under `tap` the stored value is what the player last chose
on the sticks — the scheme, not the mode, decides what the ship does.

### Current help text

`src/ui/settings.ts:657`. It branches on the scheme (a0-89), and the tap branch
now has a job of its own (a0-100b):

- `tap` — *"TAP COMMANDER aims and fires for you. This row is locked on AUTO-FIRE
  — switch CONTROLS to {STICKS_LABELS[device]} to fire yourself."* **True**, and
  it is where the disabled row's reason lives. It used to explain CONTROLS
  instead, because the row had nothing true to say about itself — the developer
  caught that on screen. The way out names the ONE scheme the player would switch
  to, in the same word the CONTROLS chip shows (`STICKS_LABELS`,
  `src/ui/settings.ts:117`), so the two rows cannot disagree about the device.
- `sticks` — *"AUTO-AIM locks the nearest target and leads it while you fire.
  MANUAL leaves the aim to you."* **True** — `weaponLead` at `src/sim/step.ts:680`
  is the lead, and firing is the player's on this scheme.

**~~MISMATCH 1~~ — struck by `1aad98b2` (a0-100b).** It was never a copy fix: the
row reached nothing under the default scheme, so no wording could make a live
chip honest, and the developer ruled the row itself — *"disable the selection for
fire mode when tap commander is active and set fire mode to Auto-Fire but still
have it grayed out so people can't toggle it"* (2026-08-19), after a0-96
photographed one press moving **0 pixels of 4,096,000** on a frozen match frame
against a null re-shot, where the same press on the sticks moved 18,935.

Held by `the fire mode row cannot be toggled under tap commander`
(`src/ui/settings.test.ts`), which asks `TapPilot` whether the game fires by
itself and `mapActions` whether the player still pulls the trigger, and fails the
build if either answer stops matching the word on the chip.

---

## CONTROLS

**Label** `CONTROLS` (`src/ui/settings.ts:964`)
**Values** `TAP COMMANDER` (`src/ui/settings.ts:125`), or the default scheme's
word for the device in front of the player (`src/ui/settings.ts:117`):
`STICKS` on touch, `TWIN STICKS` with a pad connected, `KEYBOARD + MOUSE`
otherwise. Picked by `controlsValue` (`src/ui/settings.ts:129`); the device by
`controlsDevice` (`src/ui/settings.ts:156`), where touch beats a pad and a pad
beats the keyboard.
**Default** `tap` — Tap Commander, on every platform
(`src/platform/actions.test.ts:28` covers the paired fire-mode default; the
scheme resolves through `parseControlScheme`, `src/ui/settings.ts:91`).
**Persisted** yes — `planet-rush:controlScheme` (`src/ui/settings.ts:269`, wired
at `src/main.ts:551`), written at
`src/main.ts:3446` (pause) and `src/main.ts:9777` (menu).

### What it actually does

`const tap = controlScheme === 'tap'` (`src/main.ts:3625`) gates the whole input
path for the frame. Under `tap`:

1. The human devices' thrust, aim and fire are zeroed
   (`src/main.ts:3627`–`src/main.ts:3630`). BUILD is left alone.
2. `tapPilot.writeInto(...)` writes thrust, aim and fire from the standing order
   (`src/main.ts:3637`), and those are copied into the merged state
   (`src/main.ts:3638`–`src/main.ts:3641`).
3. A click/tap becomes a move or a lock (`src/main.ts:2446`,
   `src/main.ts:2449`).
4. Toggling the row clears the standing order (`src/main.ts:3445`).

Under `sticks` none of that runs and the devices drive the ship directly.

The scheme also changes what the player is shown: the row set in the controls
strip (`src/platform/actions.ts:312`), the on-glass furniture
(`src/ui/live-controls.ts:97`), and the onboarding lesson
(`src/ui/onboarding.ts:447`).

### Per control scheme

Live on both — it *is* the scheme. Inert on nothing.

### Current help text

`src/ui/settings.ts:697`:

> *"TAP COMMANDER flies the ship for you: tap where to go, tap what to hit. On
> {STICKS_LABELS[device]} you fly it yourself."*

The device half is right — the sentence names the one device the player has, from
the same lookup the value chip uses, so panel and pill cannot disagree.

Both halves are true in either fire mode, which is the point: this row chooses
who flies the ship, and nothing FIRE MODE does can falsify that.

**~~MISMATCH 2~~ — struck by `a60bbe9` (a0-93).** The row used to end *"you steer
and aim yourself"*, and that clause was false under AUTO-AIM. AUTO-AIM is the
shipped default (`src/platform/actions.ts:58`), and on the sticks scheme in
AUTO-AIM no `aim` action is emitted (`src/platform/actions.ts:162`), the sim
acquires the target itself (`src/sim/step.ts:675`), the strip drops the Aim row
(`src/platform/actions.ts:324`), and on touch the aim stick is replaced by a FIRE
button (`src/ui/live-controls.ts:104`). A player switching to STICKS on the
defaults steers and fires; they do not aim, until they also set FIRE MODE to
MANUAL.

The sentence went wrong by reaching into the row below it for a behaviour this
row's own value cannot hold true. `the controls help does not claim aiming the
player does not do` (`src/ui/settings.test.ts`) now asks `mapActions` whether an
`aim` survives the seated default and fails the build if the copy disagrees.

---

## REDUCE VFX

**Label** `REDUCE VFX` (`src/ui/settings.ts:974`)
**Values** `ON` / `OFF` (`src/ui/settings.ts:975`)
**Default** `OFF` (`src/ui/settings.ts:202`)
**Persisted** yes, since a0-92 — `planet-rush:reduceVfx`
(`src/ui/settings.ts:269`), written as the words `on` / `off`
(`storedReduceVfx`, `src/ui/settings.ts:300`) by `commitSettings` from the pause
screen (`src/main.ts:3457`) and the menu (`src/main.ts:9792`), read back by
`loadSettings` (`src/ui/settings.ts:348`) at `src/main.ts:1832` (match) and
`src/main.ts:8096` (menu). Anything but the literal `on` — an absent key, a stale
one — folds to OFF, the first-run default.

~~**Persisted** **no.** Toggled at the pause screen and the menu; neither writes
storage, and there is no `planet-rush:` key for it. Rebuilt from
`createSettings()` on every boot~~ — **~~MISMATCH 3~~, fixed 91828dfe.**

### What it actually does

One flag with two ways to flip it (`src/main.ts:2753`):

```ts
const reduceVfx = flags.freeze ? false : vfxQuality.sample(frameSeconds) || matchSettings.reduceVfx;
```

`vfxQuality` is the auto-reducer (`VfxAutoQuality`, `src/platform/vfx-quality.ts:60`),
which engages on a sustained fps drop (`sample`, `src/platform/vfx-quality.ts:89`).
The player's flag ORs with it, so ON pins the reduced look permanently. `?debug=1`
freeze mode forces it off so golden frames stay byte-deterministic.

The flag then goes two places:

- `renderer.setReduceVfx(reduceVfx)` (`src/main.ts:2754` →
  `src/render/index.ts:779`), which sheds the backdrop nebula
  (`src/render/index.ts:782`), swaps the station atmosphere halo for its cheaper
  tier (`src/render/index.ts:1129`), and drops the impact glow while keeping the
  muzzle flash line (`src/render/index.ts:1525`).
- `vfxField.quality` (`src/main.ts:2760`), scaled to `REDUCED_VFX_DENSITY = 0.5`
  (`src/main.ts:677`) — every burst's particle budget is halved. Effects thin;
  none disappears.

### Per control scheme

Scheme-independent. Identical on Tap Commander, sticks and keyboard + mouse —
nothing in the path above reads `controlScheme`.

### Current help text

`src/ui/settings.ts:708`:

> *"Thins the effects that carry no information, to hold the frame rate. The game
> does this on its own when the rate drops; ON keeps them thin all the time."*

**True on every scheme**, and true of the code: "thins" matches the 0.5 budget
scale rather than a cut, and the second clause matches the OR at
`src/main.ts:2753`. The row's two old problems are gone: it survives a reload
(mismatch 3) and it is written from the main menu (mismatch 4). What remains is
the one honest gap — on the menu the flag is stored, not shown, because the
renderer it thins does not exist yet on that screen.

---

## MASTER VOLUME / SFX VOLUME / MUSIC VOLUME

**Labels** `MASTER VOLUME`, `SFX VOLUME`, `MUSIC VOLUME`
(`src/ui/settings.ts:1034`)
**Values** ten discrete steps, silent to full (`VOLUME_STEPS = 10`,
`src/ui/settings.ts:191`); drawn as filled pips, not a number
(`src/ui/settings.ts:992`).
**Defaults** master `0.8`, sfx `0.8`, music `0.6` (`src/ui/settings.ts:199`).
**Persisted** yes, since a0-92 — same seam and same call as REDUCE VFX, one key
per channel (`planet-rush:masterVolume` / `:sfxVolume` / `:musicVolume`,
`src/ui/settings.ts:269`). Each is written as a **whole number of notches**,
`0..VOLUME_STEPS`, not a fraction (`storedVolume`, `src/ui/settings.ts:321`): the
level the player set round-trips exactly instead of arriving back off-grid. A
step count from another ladder is clamped onto this one and a junk value folds to
the channel's default (`parseVolume`, `src/ui/settings.ts:332`).

A slider already at its end refuses audibly rather than silently — the press
moves nothing, so `commitSettings` reports `moved: false` and neither screen
writes, pushes or detents (`src/main.ts:3459`, `src/main.ts:9794`).

~~**Persisted** **no** — same as REDUCE VFX, and same citation (mismatch 3).~~
**Fixed 91828dfe.**

### What they actually do

A nudge on either screen lands in `commitSettings` (`src/main.ts:3457` in-match,
`src/main.ts:9792` on the menu), folds through `adjustVolume`
(`src/ui/settings.ts:236`), is written to storage, and `applyVolumes`
(`src/ui/settings.ts:382`) pushes **all three** levels into the mixer — all three
every time, so no bus can drift from the pips drawn against it:

| Row | Engine call | Node |
|---|---|---|
| MASTER | `setMasterVolume` (`src/art/audio/engine.ts:474`) | the `master` gain, `src/art/audio/graph.ts:196` |
| SFX | `setSfxVolume` (`src/art/audio/engine.ts:489`) | the `sfx` bus, `src/art/audio/graph.ts:264` |
| MUSIC | `setMusicVolume` (`src/art/audio/engine.ts:494`) | the `music` bus |

The graph is four gains (`src/art/audio/graph.ts:10`–`src/art/audio/graph.ts:16`):
`sfx`, `alarm`, `ambient` and `music` sum into `duck`, `duck` into `master`
(`src/art/audio/graph.ts:200`), `master` into the destination
(`src/art/audio/graph.ts:196`). The death sting is the one path around the duck
and still lands in `master` (`src/art/audio/graph.ts:218`), tracking the `sfx`
level.

Two facts worth having, and neither belongs in a tooltip:

- **MASTER really does cover everything**, alarm included — every path ends at
  `master`.
- **The alarm has its own bus with no slider**, fixed at `0.9`
  (`src/art/audio/graph.ts:108`, `src/art/audio/graph.ts:204`). SFX does not move
  it. Nor does anything move the ambient bed except MASTER.

### Per control scheme

Scheme-independent. No audio path reads `controlScheme`.

### Current help text

`src/ui/settings.ts:723`–`src/ui/settings.ts:725`:

| Row | Help | True? |
|---|---|---|
| MASTER VOLUME | *"Every sound the game makes."* | Yes — everything routes through `master`. |
| SFX VOLUME | *"Weapons, impacts, engines, menus."* | Yes — all four ride the `sfx` bus. It does not claim to be exhaustive, and the alarm and ambient bed it omits are correctly omitted. |
| MUSIC VOLUME | *"The soundtrack."* | Yes. |

All three are true on every scheme. The earlier versions taught the alarm's
routing from two directions and were cut in a0-87; the routing is unchanged and
`src/art/audio/audio.test.ts` still holds it.

---

## ~~MISMATCH 4, in full: the main-menu screen is decorative for four rows~~ — fixed 91828dfe (a0-92)

**What it was.** On the main menu, `case 'reduceVfx'` and `case 'volume'` folded
a new `SettingsState` into the menu-local `settings` and then called `render()`.
That was all: no mixer call, so the menu's own cues kept playing at the graph's
construction defaults (`src/art/audio/graph.ts:105`); no renderer; and no
handover, because `matchSettings` was a fresh `createSettings()`. The pips moved,
the chip flipped, the detent cue fired, nothing else happened, and the header
said CHANGES SAVE IMMEDIATELY.

**What it is now** (`src/main.ts:9780`–`src/main.ts:9796`). Both cases collapse
into the one `commitSettings` call the pause screen makes, against a sink holding
the platform's storage and the menu's own audio engine
(`settingsSink`, `src/main.ts:8099`; `MenuContext.mixer`, `src/main.ts:7780`,
supplied at `src/main.ts:1058`):

- **The mixer is reached.** A MASTER nudge on the menu changes what the menu is
  playing, on the screen where it was made — which is the reason a player reaches
  for the volume there. The engine also *boots* at the saved mix
  (`src/main.ts:856`), so the first cue of a session is already at the player's
  level rather than the shipped default.
- **There is still no renderer**, and that is correct rather than outstanding:
  `new Renderer(...)` is at `src/main.ts:1520`, after the menu is awaited at
  `src/main.ts:1118`. REDUCE VFX on the menu has nothing on that screen to thin.
- **The value is handed over.** It is written to storage on the press, and
  `matchSettings` (`src/main.ts:1832`) reads that store at boot — so the flag the
  menu set is the flag the match runs with. Not by sharing an object: the two
  screens still hold separate state, and the menu is gone before the match world
  exists.

FIRE MODE and CONTROLS on the menu screen were never part of mismatch 4: they
write the same storage keys the match reads at boot (`src/main.ts:9767`,
`src/main.ts:9777` → `src/main.ts:1772`, `src/main.ts:1779`). FIRE MODE's press
now folds through `commitFireMode` there like everywhere else, so the menu obeys
the same lock the pause screen does (a0-100b) — the store it writes is unchanged.

**Held by** `src/ui/settings.test.ts` — *every row the header promises to save
survives a reload* and *the menu volume rows reach the mixer*. Both fail on the
code as it stood before 91828dfe.

---

## How to re-verify

**Nothing is open.** 1 was fixed in 1aad98b2, 2 in a60bbe9, 3 and 4 in 91828dfe.
That is not a reason to trust the sentences below it: three of the four defects
were shipped by somebody who had checked, and the fourth survived two reviews. So
the checks stand, and there is now a fifth. Before shipping copy about a setting:

1. **Find where the value is consumed**, not where it is stored.
   `grep -n '<field>' src/main.ts` and follow it to the call that changes
   something the player can see or hear.
2. **Check both control schemes.** `src/main.ts:3625` is the fork. Anything
   downstream of `if (tap)` may never see the setting.
3. **For anything about firing**, read `src/platform/tap-pilot.ts:376` before
   `src/platform/tap-pilot.ts:429`. The first is the default.
4. **Check both screens.** A row can be live in the pause menu and dead on the
   main menu; they hold different state (`src/main.ts:1832` vs
   `src/main.ts:8096`) and always will. What they share is the STORE, not the
   object: `SETTINGS_STORAGE` (`src/ui/settings.ts:269`) is the whole list of
   what carries from one screen to the other, and a value that is not written
   there does not carry.
5. **There is no path in the lobby flow — it was deleted.** `flowTapSettings`
   folded values into a `FlowState.settings` nothing read; a0-95 removed the
   handler, both fields and the flow's `settings` screen (commit 5dd02c75). If
   you find a settings value reached through `src/ui/lobby-flow.ts` again, it is
   new and it is the same defect coming back. Every live path is above.
6. **Ask whether the row can be pressed at all on this scheme** (a0-100b). FIRE
   MODE is locked under Tap Commander, and a sentence about what its two values
   do is a sentence about a choice the default-scheme player does not have. The
   answer is `fireModeLocked` (`src/ui/settings.ts:465`) and the row's own
   `disabled` flag — not a guess from the row's name.
