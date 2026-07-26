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
