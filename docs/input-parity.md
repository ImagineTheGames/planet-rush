# Input parity audit (v0.2.2 field report: "some controls only exist on PC")

**Contract:** input parity is not an accident. Every abstract `Action` the sim
accepts (GDD §2.4, `src/shared/types.ts`) must be reachable from **every** input
source, or be explicitly N/A with a reason. The sim never sees a device — it sees
the `Action` union — so a control that "only exists on PC" is a hole in this table,
not a device quirk.

This document is the audit the field report asked for, and it is backed by a test
(`src/platform/input-parity.test.ts`) that fails CI if any cell below regresses.
A future PC-only control fails a red test instead of reaching the developer's thumbs.

## The abstract actions (the rows)

Walked from `src/platform/actions.ts` (`ControlState` → `mapActions`) and pinned
against the `Action` union in `src/shared/types.ts`. Eight verbs:

| Action          | `ControlState` field | Notes |
|-----------------|----------------------|-------|
| `thrust`        | `thrust: Vec2`       | Analog steer, always emitted. |
| `aim`           | `aim: Vec2 \| null`  | Manual fire mode only; folded away in Auto-aim. |
| `fire`          | `fire: boolean`      | Held; one weapon mines and shoots (GDD §2.3). |
| `boost`         | `boost: boolean`     | Held (GDD §2.4). |
| `build`         | `build: boolean`     | Opens the Build & Upgrade wheel at your own planet (GDD §2.5). |
| `buildOrder`    | `order: BuildItem`   | One-shot: the wheel segment that spends. |
| `upgradeOrder`  | `upgrade: UpgradeTrack` | One-shot: the upgrade-panel row that spends. |
| `ping`          | `ping: Vec2 \| null` | One-shot minimap/position ping (GDD §2.4). |

## The parity table (rows × sources)

Source modules: keyboard/mouse + gamepad = `src/platform/input.ts`; touch =
`src/platform/touch.ts` (twin sticks) + `src/platform/touch-buttons.ts`
(contextual buttons) + `src/platform/wheel-input.ts` (wheel/panel presses).

| Action         | Keyboard / Mouse            | Gamepad                          | Touch |
|----------------|-----------------------------|----------------------------------|-------|
| `thrust`       | WASD / arrows               | Left stick                       | Left virtual stick |
| `aim`          | Mouse (relative to ship)    | Right stick                      | Right virtual stick (Manual) |
| `fire`         | Left mouse                  | Right trigger (btn 7)            | Right stick (Manual) / hold-to-FIRE button (Auto-aim) |
| `boost`        | Space / Shift               | Left trigger (btn 6)             | **Double-tap-and-hold left stick, or BOOST button** ✅ *(added p4)* |
| `build`        | E                           | Y / △ (btn 3)                    | BUILD button (at own planet) |
| `buildOrder`   | Click a wheel wedge         | Thrust-point + trigger confirm   | Thumb tap on a wheel wedge |
| `upgradeOrder` | Click an upgrade-panel row  | Thrust-point + trigger confirm   | Thumb tap on an upgrade-panel row |
| `ping`         | Middle click                | **D-pad (btn 12–15)** ✅ *(added p4)* | **PING button: tap = ship pos, drag = direction** ✅ *(added p4)* |

Every cell is filled. No N/A cells remain: all eight verbs are reachable from all
three sources.

## Tap Commander — the alternate scheme (a new row set, added p6)

The developer ratified an **optional** control scheme: *touching a location moves
there, and touching a target attacks it* — both PC (click) and mobile (touch),
mining included ("a rock is just a target"). The other schemes are untouched and
**default**; Tap Commander is a scheme selected in settings ("CONTROLS: Sticks /
Tap Commander"), persisted like the fire mode (`planet-rush:controlScheme`).

It is **not a fourth device** and it is **not a new action** — it is a *local
pilot* (`src/platform/tap-pilot.ts`) that turns the player's standing **order** (a
waypoint, or a locked target) into the SAME `thrust` / `aim` / `fire` the sticks
produce, and writes them into the same device-neutral `ControlState`. It files
input the way a bot does; the sim and the wire are untouched. Because it aims
explicitly at the *locked* target, the pilot's state is mapped in **Manual** fire
mode regardless of the player's fire-mode setting (an Auto-aim map would let the
sim pick the nearest target, not the one the player tapped).

So the eight-verb contract is unchanged — every verb still reaches the sim — but
**how** the movement/fire verbs are produced differs when the scheme is active:

| Action         | Under Tap Commander (the pilot) | Under Sticks (unchanged, default) |
|----------------|---------------------------------|-----------------------------------|
| `thrust`       | Pilot steers toward the waypoint / locked target, with arrival + range damping | The device's stick / WASD |
| `aim`          | Pilot aims at the locked target (Manual-mapped) | Mouse / right stick / aim stick |
| `fire`         | Pilot fires while a hostile lock is in range (mining a rock too) | Held fire binding |
| `build`        | **Unchanged** — E / Y / BUILD button | E / Y / BUILD button |
| `buildOrder`   | **Unchanged** — the wheel (device-agnostic) | The wheel |
| `upgradeOrder` | **Unchanged** — the upgrade wheel | The upgrade wheel |
| `boost`        | **Unchanged** — Space / LT / BOOST button | Space / LT / BOOST button |
| `ping`         | **Unchanged** — middle click / D-pad / PING button | middle click / D-pad / PING button |

**Tap semantics:** tap empty space = move there (a waypoint marker until arrival or
the next order); tap an entity = LOCK it (enemy ship / turret / core = attack, an
asteroid = mine, your own planet = fly to its atmosphere); a new order replaces the
old; a lock clears on target death or an explicit empty-space move. The lock-on
**reticle** and **waypoint marker** are world-tracking screen affordances the UI
seam draws (p6-02); the platform lane owns their state and registers their layout
contract (`tap-lock-reticle`, `tap-waypoint-marker`; `full` anchor).

The pilot's convergence, range-hold, arrival damping, and lock-clear-on-death are
unit-tested headless (`src/platform/tap-pilot.test.ts`); the shipped wiring — a tap
becomes an order that flies the ship and fires on a lock — is proven on the real
booted client by `tests/live-stage/tap-commander.spec.ts` (the `?debug=1`
`__tapCommanderStage` seam).

## Gaps this audit found (and closed)

The field report named two. The audit surfaced a third — a legend that lied.

1. **`boost` had no touch binding.** Touch could steer, aim, fire, build, buy and
   (nominally) ping, but never boost. Closed with the field-report-recommended
   affordance: **double-tap-and-hold the left stick** (thumb never leaves the
   stick — `TouchController`, clock-driven so it unit-tests headless), plus a
   discoverable **BOOST button** (`touch-buttons.ts` + `touch-visuals.ts`). Haptic
   `tap` on engage.

2. **`ping` had no touch binding.** Closed with a **PING button** (`touch-buttons.ts`):
   a tap pings your ship's own position; a drag from the button pings a direction
   (the alarm-arrow language in reverse). Emits the same `ping` action every other
   device does.

3. **`ping` on gamepad was a *phantom*.** `describeBindings()` advertised "D-pad"
   for the gamepad ping row, but `GamepadSource` never read the D-pad and never set
   `ControlState.ping` — the legend named a binding the code did not implement, so
   a controller player who followed the on-screen legend got nothing. This is
   exactly the "a control only exists on PC (mouse)" class of bug, one layer down.
   Closed by wiring the D-pad (buttons 12–15) to a directional ping in
   `GamepadSource`, rising-edge so a held D-pad pings once rather than every frame.

## Minimap toggle — a UI control, not a sim verb (added p6)

The minimap (GDD §2.2; field request v0.2.2) toggles between a small bottom-right
corner square and a centred overlay. This is a **HUD control, not one of the eight
abstract actions** — the simulation never sees it (it changes nothing on the
`ControlState` / `Action` union; it flips a `src/ui` view state). So it is *not* a
row in the parity table above and *not* pinned in `input-parity.test.ts`, for the
same reason Tap Commander is "not a new action": the sim contract is unchanged.

But it carries the same *reachability* obligation the table exists to enforce — a
control that "only exists on PC" is the bug this document was written for — so it
is recorded here and backed by its own CI test:

| Control          | Keyboard / Mouse            | Gamepad                          | Touch |
|------------------|-----------------------------|----------------------------------|-------|
| Minimap toggle   | Click the map · **`M` key** | Click via the pointer (as PC)    | Tap the map |

- **One code path, both platforms.** A PC click and a mobile tap both route to
  `Hud.minimapTap` → `Minimap.tap` (`src/ui/minimap.ts`), the *same* pure hit test
  — the two platforms cannot diverge. `main.ts` routes the canvas `pointerdown` to
  it (mouse and touch alike) before the sticks, so a press on the map never also
  flies the ship.
- **`M` on PC** is the desktop keyboard convenience over the click, mirroring the
  `F` (fire mode) and `C` (control scheme) shortcuts — `MINIMAP_TOGGLE_KEY` in
  `src/ui/minimap.ts`, wired in `main.ts`'s keydown handler.
- **Its CI test** is `src/ui/minimap.test.ts` (runs under `npm test`): it asserts
  click (PC) and tap (mobile) reach the same toggle, and that the shortcut is `M`.
  `tests/live-stage/minimap.spec.ts` proves the toggle under REAL input on the
  booted client (the p1a rule).
- **No ping here.** Pings are cut from the game (p7-01/02), so the minimap draws no
  ping markers and tapping it is a toggle, not a ping — distinct from the `ping`
  rows above, which predate the cut.

## Known follow-ups for gameplay / render (flagged, not invented)

Per the brief, the platform wires against the interface; it does not invent sim
behavior. Two items belong to gameplay/render, not to this lane:

- **No render-side ping display exists yet.** The sim treats `ping` as a no-op
  (`src/sim/step.ts` — "pinging the minimap is UI-side") and `src/net/wire.ts`
  serialises it across the wire, but nothing in `src/render` / `src/ui` draws a
  ping for the local player *or* for other players yet. The platform now emits the
  action from all three devices; **gameplay must land the visualisation** so a ping
  "renders for all players" as the field report expects.

- **`ping.at` coordinate space is not yet unified.** The new touch and gamepad
  producers anchor the ping on the local ship's **world** position (tap = ship
  position; drag / D-pad = ship position offset in the pointed direction), which is
  the space "render for all players" needs — every player's camera differs, so a
  screen-space ping only makes sense on the pinger's own screen. The pre-existing
  keyboard middle-click producer still writes a **screen-space** point
  (`clientX/clientY`), which is latent-wrong for multiplayer display. It is left
  as-is to avoid a behavioural regression while ping is unrendered; **whoever lands
  ping rendering should reconcile the keyboard producer to world space** (the
  `PingAction` doc already says "map-space position"). Tracked here rather than
  silently changed.
