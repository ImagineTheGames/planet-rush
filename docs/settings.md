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

---

## MISMATCH summary

| # | Row | What is wrong | Where |
|---|-----|---------------|-------|
| 1 | **FIRE MODE** | Inert on the default control scheme. Under Tap Commander the row's value is discarded every frame and replaced by the pilot's own `tapMode`. The chip still shows AUTO-AIM / MANUAL and still toggles. | `src/main.ts:3531`, `src/main.ts:3532` |
| 2 | **CONTROLS** | Help says "you steer and aim yourself" on the sticks scheme. Under AUTO-AIM — the shipped default — no aim is emitted and the sim picks the target, so the player does not aim on any device. | `src/ui/settings.ts:384` vs `src/platform/actions.ts:162`, `src/platform/actions.ts:58` |
| 3 | **REDUCE VFX + all three volumes** | Not persisted. The header eyebrow reads CHANGES SAVE IMMEDIATELY; four of six rows are gone on reload. | `src/ui/settings.ts:562` vs `src/main.ts:1791`, `src/main.ts:7796` |
| 4 | **REDUCE VFX + all three volumes, on the MAIN MENU screen** | Reach nothing at all. No mixer call, no renderer (none exists yet), and the value is discarded when the match boots. | `src/main.ts:9472`, `src/main.ts:9480`, `src/main.ts:1791` |

Rows that are honest: none of the six is fully clean on every surface. MASTER,
SFX and MUSIC describe the mixer correctly (mismatches 3 and 4 are about where
the row is live, not about what the words claim); REDUCE VFX's help is true
wherever the row is live.

---

## The screen, and where it lives

There are **two** live settings screens, and they hold **separate state**:

| Surface | Model call | Settings value |
|---|---|---|
| Main menu → SETTINGS | `src/main.ts:8331` | `settings`, `src/main.ts:7796` |
| In-match pause → SETTINGS | `src/main.ts:3429` | `matchSettings`, `src/main.ts:1791` |

Both are built by `settingsModel` (`src/ui/settings.ts:576`) and both walk the
same row list, `SETTINGS_ROWS` (`src/ui/settings.ts:262`) — six rows, in this
order: FIRE MODE, CONTROLS, REDUCE VFX, MASTER VOLUME, SFX VOLUME, MUSIC VOLUME.

`SettingsState` (`src/ui/settings.ts:183`) holds only `reduceVfx` and the three
volumes. FIRE MODE and CONTROLS are not in it: they live as loose values beside
each screen and persist to storage (`src/main.ts:522`, `src/main.ts:530`).

Boot order matters. `boot()` awaits the menu at `src/main.ts:1086` before reading
`fireMode` (`src/main.ts:1735`) and `controlScheme` (`src/main.ts:1742`), so a
menu change to those two *does* carry into the match — through storage, not
through the object. `matchSettings` at `src/main.ts:1791` is a fresh
`createSettings()` (`src/ui/settings.ts:202`) and carries nothing.

A third settings code path exists in the lobby flow (`flowTapSettings`,
`src/ui/lobby-flow.ts:789`). It folds values into `FlowState.settings`, and no
`settingsModel` call site reads that field — it is not wired to a rendered
screen.

The header eyebrow is `CHANGES SAVE IMMEDIATELY` (`src/ui/settings.ts:562`).

---

## FIRE MODE

**Label** `FIRE MODE` (`src/ui/settings.ts:603`)
**Values** `AUTO-AIM` / `MANUAL` (`src/ui/settings.ts:604`)
**Default** `AUTO-AIM`, the same on every platform
(`src/platform/actions.ts:58`; asserted at `src/platform/actions.test.ts:28`)
**Persisted** yes — `planet-rush:fireMode` (`src/main.ts:522`), written at
`src/main.ts:3354` (pause) and `src/main.ts:9460` (menu); read back through
`readStoredFireMode` (`src/platform/actions.ts:74`), where a saved choice beats
the default.

### What it actually does

The value reaches the sim through one call: `mapActions(merged, mode)`
(`src/main.ts:3532`). Inside `mapActions` (`src/platform/actions.ts:155`):

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

**Tap Commander (`tap`) — INERT.** This is the default scheme on every platform.
`src/main.ts:3531` computes the mode from the pilot's own order and
`src/main.ts:3532` passes that instead of the row's value:

```ts
const tapMode = tapPilot.lockedRef ? FireMode.Manual : FireMode.AutoAim;
const actions = mapActions(merged, tap ? tapMode : fireMode);
```

The player's `fireMode` is not read on this branch. And the trigger is not
theirs either: with no lock the pilot holds it unconditionally
(`state.fire = true`, `src/platform/tap-pilot.ts:376`); with a lock it fires on a
hostile in range (`src/platform/tap-pilot.ts:429`). The no-lock line is the
default path — reading only the lock branch is what made the row look honest.

The row is inert on every other surface under `tap` too:

- Touch furniture: `liveOnGlassControls` returns the same three falses for both
  modes (`src/ui/live-controls.ts:97`–`src/ui/live-controls.ts:100`).
- Controls strip: `describeBindings` returns early on `tap` without reading
  `mode` (`src/platform/actions.ts:312`–`src/platform/actions.ts:319`).
- Onboarding prompts: `lessonFor` returns `copy.tap` before the mode is
  consulted (`src/ui/onboarding.ts:447`).

**Sticks (`sticks`) — LIVE.** All of the above branches on the mode:
`src/main.ts:3532` passes the player's value; the aim stick / FIRE button swap on
touch (`src/ui/live-controls.ts:104`, `src/ui/live-controls.ts:105`); the strip
drops its Aim row in AUTO-AIM (`src/platform/actions.ts:324`).

### The wire

`fireMode` rides every `lobbyChoice` (`src/ui/lobby-flow.ts:360`,
`src/net/session.ts:311`) and the server decodes it — but no file under
`server/*.ts` references it, and the offline loopback drops it on the floor
(`chooseInLobby(message.shipClass)`, `src/net/loopback.ts:176`). The mode is
applied client-side only.

### Current help text

`src/ui/settings.ts:355`. It branches on the scheme (a0-89):

- `tap` — *"TAP COMMANDER aims and fires for you. Switch CONTROLS to aim
  yourself."* **True.**
- `sticks` — *"AUTO-AIM locks the nearest target and leads it while you fire.
  MANUAL leaves the aim to you."* **True** — `weaponLead` at `src/sim/step.ts:680`
  is the lead, and firing is the player's on this scheme.

The help is honest on both branches. **MISMATCH 1 is the row, not the words**: a
toggle that shows a value and changes nothing is still telling the default-scheme
player something false, in a language the help cannot correct.

**Pending rename.** The row is called FIRE MODE and it controls aiming. GDD §4.7
lists FIRE MODE / AUTO-AIM / MANUAL as fixed strings, and the developer has
called for AUTO-FIRE / MANUAL. That ratification is being handled separately;
this file documents the name as it stands today.

---

## CONTROLS

**Label** `CONTROLS` (`src/ui/settings.ts:619`)
**Values** `TAP COMMANDER` (`src/ui/settings.ts:125`), or the default scheme's
word for the device in front of the player (`src/ui/settings.ts:117`):
`STICKS` on touch, `TWIN STICKS` with a pad connected, `KEYBOARD + MOUSE`
otherwise. Picked by `controlsValue` (`src/ui/settings.ts:129`); the device by
`controlsDevice` (`src/ui/settings.ts:156`), where touch beats a pad and a pad
beats the keyboard.
**Default** `tap` — Tap Commander, on every platform
(`src/platform/actions.test.ts:28` covers the paired fire-mode default; the
scheme resolves through `parseControlScheme`, `src/ui/settings.ts:91`).
**Persisted** yes — `planet-rush:controlScheme` (`src/main.ts:530`), written at
`src/main.ts:3360` (pause) and `src/main.ts:9468` (menu).

### What it actually does

`const tap = controlScheme === 'tap'` (`src/main.ts:3494`) gates the whole input
path for the frame. Under `tap`:

1. The human devices' thrust, aim and fire are zeroed
   (`src/main.ts:3496`–`src/main.ts:3499`). BUILD is left alone.
2. `tapPilot.writeInto(...)` writes thrust, aim and fire from the standing order
   (`src/main.ts:3506`), and those are copied into the merged state
   (`src/main.ts:3507`–`src/main.ts:3510`).
3. A click/tap becomes a move or a lock (`src/main.ts:2369`,
   `src/main.ts:2372`).
4. Toggling the row clears the standing order (`src/main.ts:3359`).

Under `sticks` none of that runs and the devices drive the ship directly.

The scheme also changes what the player is shown: the row set in the controls
strip (`src/platform/actions.ts:312`), the on-glass furniture
(`src/ui/live-controls.ts:97`), and the onboarding lesson
(`src/ui/onboarding.ts:447`).

### Per control scheme

Live on both — it *is* the scheme. Inert on nothing.

### Current help text

`src/ui/settings.ts:384`:

> *"TAP COMMANDER flies the ship for you: tap where to go, tap what to hit. On
> {STICKS_LABELS[device]} you steer and aim yourself."*

The device half is right — the sentence names the one device the player has, from
the same lookup the value chip uses, so panel and pill cannot disagree.

**MISMATCH 2: the second clause is false under AUTO-AIM.** AUTO-AIM is the
shipped default (`src/platform/actions.ts:58`), and on the sticks scheme in
AUTO-AIM no `aim` action is emitted (`src/platform/actions.ts:162`), the sim
acquires the target itself (`src/sim/step.ts:675`), the strip drops the Aim row
(`src/platform/actions.ts:324`), and on touch the aim stick is replaced by a FIRE
button (`src/ui/live-controls.ts:104`). A player switching to STICKS on the
defaults steers and fires; they do not aim. "You steer and aim yourself" is only
true once they also set FIRE MODE to MANUAL.

---

## REDUCE VFX

**Label** `REDUCE VFX` (`src/ui/settings.ts:628`)
**Values** `ON` / `OFF` (`src/ui/settings.ts:629`)
**Default** `OFF` (`src/ui/settings.ts:202`)
**Persisted** **no.** Toggled at `src/main.ts:3364` (pause) and
`src/main.ts:9472` (menu); neither writes storage, and there is no
`planet-rush:` key for it. Rebuilt from `createSettings()` on every boot
(`src/main.ts:1791`, `src/main.ts:7796`) — **MISMATCH 3**.

### What it actually does

One flag with two ways to flip it (`src/main.ts:2676`):

```ts
const reduceVfx = flags.freeze ? false : vfxQuality.sample(frameSeconds) || matchSettings.reduceVfx;
```

`vfxQuality` is the auto-reducer (`VfxAutoQuality`, `src/platform/vfx-quality.ts:60`),
which engages on a sustained fps drop (`sample`, `src/platform/vfx-quality.ts:89`).
The player's flag ORs with it, so ON pins the reduced look permanently. `?debug=1`
freeze mode forces it off so golden frames stay byte-deterministic.

The flag then goes two places:

- `renderer.setReduceVfx(reduceVfx)` (`src/main.ts:2677` →
  `src/render/index.ts:779`), which sheds the backdrop nebula
  (`src/render/index.ts:782`), swaps the station atmosphere halo for its cheaper
  tier (`src/render/index.ts:1129`), and drops the impact glow while keeping the
  muzzle flash line (`src/render/index.ts:1525`).
- `vfxField.quality` (`src/main.ts:2683`), scaled to `REDUCED_VFX_DENSITY = 0.5`
  (`src/main.ts:656`) — every burst's particle budget is halved. Effects thin;
  none disappears.

### Per control scheme

Scheme-independent. Identical on Tap Commander, sticks and keyboard + mouse —
nothing in the path above reads `controlScheme`.

### Current help text

`src/ui/settings.ts:393`:

> *"Thins the effects that carry no information, to hold the frame rate. The game
> does this on its own when the rate drops; ON keeps them thin all the time."*

**True on every scheme**, and true of the code: "thins" matches the 0.5 budget
scale rather than a cut, and the second clause matches the OR at
`src/main.ts:2676`. The row's only problem is that it does not survive a reload
(mismatch 3) and does nothing from the main menu (mismatch 4).

---

## MASTER VOLUME / SFX VOLUME / MUSIC VOLUME

**Labels** `MASTER VOLUME`, `SFX VOLUME`, `MUSIC VOLUME`
(`src/ui/settings.ts:686`)
**Values** ten discrete steps, silent to full (`VOLUME_STEPS = 10`,
`src/ui/settings.ts:191`); drawn as filled pips, not a number
(`src/ui/settings.ts:644`).
**Defaults** master `0.8`, sfx `0.8`, music `0.6` (`src/ui/settings.ts:199`).
**Persisted** **no** — same as REDUCE VFX, and same citation (mismatch 3). A
slider already at its end refuses audibly rather than silently
(`src/main.ts:3371`, `src/main.ts:9479`).

### What they actually do

In-match, a nudge lands at `src/main.ts:3367`, folds through `adjustVolume`
(`src/ui/settings.ts:236`), and `applyAudioMix()` (`src/main.ts:3373`) pushes all
three into the mixer (`src/main.ts:3383`–`src/main.ts:3385`):

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

`src/ui/settings.ts:408`–`src/ui/settings.ts:410`:

| Row | Help | True? |
|---|---|---|
| MASTER VOLUME | *"Every sound the game makes."* | Yes — everything routes through `master`. |
| SFX VOLUME | *"Weapons, impacts, engines, menus."* | Yes — all four ride the `sfx` bus. It does not claim to be exhaustive, and the alarm and ambient bed it omits are correctly omitted. |
| MUSIC VOLUME | *"The soundtrack."* | Yes. |

All three are true on every scheme. The earlier versions taught the alarm's
routing from two directions and were cut in a0-87; the routing is unchanged and
`src/art/audio/audio.test.ts` still holds it.

---

## MISMATCH 4, in full: the main-menu screen is decorative for four rows

On the main menu, `case 'reduceVfx'` (`src/main.ts:9471`) and `case 'volume'`
(`src/main.ts:9475`) fold a new `SettingsState` into the menu-local `settings`
(`src/main.ts:9472`, `src/main.ts:9480`) and then call `render()`. That is all.

- No mixer call. The in-match handler's `applyAudioMix()` (`src/main.ts:3373`)
  has no counterpart here, so the menu's own cues — which do go through the same
  engine (`src/main.ts:1026`) — keep playing at the graph's construction defaults
  (`src/art/audio/graph.ts:105`).
- No renderer. `new Renderer(...)` is at `src/main.ts:1488`, after the menu is
  awaited at `src/main.ts:1086`, so there is nothing for REDUCE VFX to reach.
- No handover. `matchSettings` is a fresh `createSettings()`
  (`src/main.ts:1791`); the menu's `settings` object is never read by the match.

The pips move, the chip flips, the detent cue fires. Nothing else happens, and
the header says CHANGES SAVE IMMEDIATELY.

FIRE MODE and CONTROLS on the menu screen are fine: they write the same storage
keys the match reads at boot (`src/main.ts:9460`, `src/main.ts:9468` →
`src/main.ts:1735`, `src/main.ts:1742`).

---

## How to re-verify

None of the four mismatches is a copy fix — each needs the owning agent. What a
writer can do is check the sentence before shipping it:

1. **Find where the value is consumed**, not where it is stored.
   `grep -n '<field>' src/main.ts` and follow it to the call that changes
   something the player can see or hear.
2. **Check both control schemes.** `src/main.ts:3494` is the fork. Anything
   downstream of `if (tap)` may never see the setting.
3. **For anything about firing**, read `src/platform/tap-pilot.ts:376` before
   `src/platform/tap-pilot.ts:429`. The first is the default.
4. **Check both screens.** A row can be live in the pause menu and dead on the
   main menu; they hold different state (`src/main.ts:1791` vs
   `src/main.ts:7796`).
