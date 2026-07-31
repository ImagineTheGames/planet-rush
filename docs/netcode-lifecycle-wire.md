# Entity lifecycle on the wire — the death, the ore, the bar, and the ping

**Owner:** Netcode Engineer. **Status:** shipped (M10, `agent/netcode/m10-lifecycle-wire`).
**Ordered by the developer**, from two live playtest logs (build `f0a6347`, rooms
`8JZE` and `RXS3`, gru client, ~100 ms):

> at t=63 s corr jumps 0.5 → 288 → 509 units with mispred=1.0 for FIVE SECONDS, one
> snap that does not take
>
> *"ore goes super fast to base online"* · *"HP bars/numbers flicker"* · *"dead
> enemies linger"* · speedtest 24 ms, game showed 95 then 215 sustained · rtt stepped
> 108 → 174 at one transient and never came back down

Six symptoms. **Five of them are one bug**, and the sixth is the instrument that
could not see it.

Companions: `docs/netcode-audit.md` (the M10 audit), `docs/netcode-tick-alignment.md`
(the constant-correction hunt this follows), `docs/netcode-spike.md` (day-0 wire
measurements), `docs/playtest-log.md` (how a session is handed back).
Permanent acceptance runs: `tests/net/lifecycle-latency.test.ts`,
`tests/net/rtt-decomposition.test.ts`, `tests/net/latency-feel.test.ts`.

---

## 1. Five seconds is not a coincidence

`RESPAWN_S` is 5. The capture's `mispred=1.0` lasts exactly that long, twice, in two
independent recordings. The snapshot spends **one bit** on `alive` (`src/net/snapshot.ts`
`SHIP_FLAG`) and says nothing about the five-second clock behind it — `Ship.respawnTimer`
was on no channel at all. And `step()`'s very first act on a dead ship is:

```ts
ship.respawnTimer -= dt;
if (ship.respawnTimer <= 0) respawn(ship);
```

A client's copy of that timer starts at **zero**. So every dead ship — the player's own
and every rival's — was revived by the client on its very next predicted tick, at its
home station, while authority had it lying at the death site for five more seconds.

That is not a misprediction. The two sims were simulating **different ships**, which is
why the correction grew instead of converging and why the one snap did not take. On a
rival's hull the identical bug is the other half of the report: *"dead enemies linger"* —
a corpse the client had quietly resurrected and went on drawing.

### The fix: the lifecycle is stated

| Piece | Where |
|---|---|
| `ShipLifecycleData` — the death tick, the site, and `respawnTick` | `src/net/entity-events.ts` |
| `kind: 'ship'` on the event channel (additive; unknown kinds were already dropped) | `src/net/transport.ts`, `src/net/wire.ts` |
| `ShipLifecycleTracker` — the `alive`-flag differ, sampled **every tick** and sent **ahead of the snapshot** | `server/static-events.ts`, `server/room.ts` |
| Anyone currently dead, stated up front in the full-state burst a joining or reclaiming client gets | `server/static-events.ts` `fullEntityState` |
| `holdLifecycle` / `seedRespawnClocks` — the corpse held, the countdown restored at every rewind | `src/net/prediction.ts` |
| The snapshot's own `alive` bit as the backstop when an event is lost | `src/net/prediction.ts` `readLifecycle` |

Death and respawn are **events**: they happen a handful of times a match and they carry
a *tick*, not a position. A few hundred bytes a match against a ~15 KB/s snapshot
stream. Sent every tick rather than on the 10 Hz static cadence, because a client that
learns about a death 100 ms late has spent 100 ms flying a ghost — which is the thing
being fixed.

### Three things had to be exact

1. **A rewind cannot restore a clock that is not on the wire.** The replay inherited
   whatever the *present* had, and present tense on a corpse is zero — so the replay
   launched the ship from home at its first replayed tick. The countdown is now seeded
   at the tick the world was rewound to, and `respawn()` fires *inside* the replay at
   the tick it fired at on the server.
2. **The death record outlives the client's own countdown.** Snapshots describe a tick
   the client passed `lead` ticks ago, so reconciles keep rewinding to before the
   deadline for a whole round trip after the ship has launched. Retiring the record at
   the deadline turned the fault into a 15-unit correction that repeated on every
   snapshot and converged on nothing.
3. **`5 / (1/60)` is exactly 300, and three hundred subtractions of `dt` from five
   seconds do not reach zero.** The sim takes 301. A closed form cannot predict an
   accumulating float, so the stated deadline is computed by *running* that countdown
   (`respawnTicks`), and the held timer sits half a tick inside its interval
   (`respawnHold`) so no rounding can move the revival a tick either way. A one-tick
   disagreement costs the whole death-site-to-home distance as a correction.

### What the gate says now

`tests/net/lifecycle-latency.test.ts` — the full two-client match on the shipping
stack, with a death injected at a named frame (the harness gained a `kill` hook,
because two ships circling at 250 ms rarely land a killing blow inside a 20-second run
and a gate that only sometimes tests a death is not a gate):

```
  death at 100 ms: dead 291f  worst corr 0.1u  snaps 0  signature 0s
  death at 250 ms: dead 281f  worst corr 0.1u  snaps 1  signature 0s
```

`signature` counts consecutive seconds of the capture's own shape (`mispred ≥ 1.0` with
`corrMax > 100`). It was five, twice. It is zero. `dead 291f` of a 300-frame respawn
window is the client honouring the death for all of it bar the round trip the news
spends in flight — the old client managed one or two frames. The single snap at 250 ms
is the **respawn itself**, asserted to land within a second of the revival: a hull that
really did move from a death site to a home station, which `SNAP_THRESHOLD` exists to
leave unsmoothed. With the wire removed, four of the eight assertions fail.

## 2. "Ore goes super fast to base online"

The deposit courier is a position integrated one tick at a time
(`src/sim/step.ts` `updateDepositFlight`, GDD §2.3). A rewind restores the world's
scalars; it does not restore `world.chunks`. So **every replayed tick flew every
courier again** — `lead` of those per snapshot, thirty times a second, which at 150 ms
is about ten times too fast and turns the banking beat into a line snapping into the
station.

Worse, the replay did not only move couriers, it **spawned** them: the drain ran again
over the same integer boundary of the hold, minting a duplicate sprite per reconcile it
survived — the conserved-telegraph rule (one sprite per unit banked, field report p8)
broken from the client's side.

The chunk field is now lifted out of the rewind and put back **exactly as the replay
found it** — not advanced by the reconcile's net clock change, which is the one
difference from every other frozen clock: a build countdown owes the world whatever time
really passed, while a courier's flight is a presentation the player watches, one frame
per predicted tick. Minus the couriers the net drain still owes, measured against the
hold *the player's own timeline* reached: read at the top of the reconcile, before
authority's wallet is written over it. Reading it after measures the replay's own
re-drain and mints the duplicate all over again.

Gate: `src/net/lifecycle.test.ts` — the online flight takes the same number of ticks as
the offline one **within one tick**, at 100 ms and 250 ms, and the courier count is the
whole units that left the hold, no more and no fewer.

> A fixture note worth keeping: the first cut of that test loaded 3 ore into a hold whose
> `cargoCap` is 2, and `refreshDerivedStats` — which every reconcile calls on the wallet
> it applies — clamped it. The test was measuring the clamp, and one unit of ore vanished
> at the first snapshot instead of flying home. It parks a *full* hold now.

## 3 & 4. The strobing bar and the corpse that outlived it

The same fault as §1, seen from the renderer. A remote ship's body was drawn from the
interpolation buffer, ~100 ms in the past; its hull, its life and its trigger were read
straight off the world, where they are the *newest snapshot*. Two clocks on one entity.

- **The bar** shows while an entity is damaged **or in combat**, and in-combat is
  `Ship.firing` — a flag `step()` clears every tick and only the wire can set (a client
  has no input for a rival, so its replay never fires that gun). Snapshots land 30 times
  a second against 60 drawn frames: the flag was true on the frames a reconcile touched
  and false on the ones between. A bar strobing at 30 Hz over an enemy holding its
  trigger down, with the hull number beside it moving on a third clock again.
- **The corpse** cleared the moment authority's newest snapshot said dead, while the
  body was still being drawn a hundred milliseconds back.

`hull`, `alive`, `eliminated` and `firing` are now presented from the **same
interpolation sample the position came from** (`src/net/presentation.ts` `presentRemote`),
stashed and restored with it. The flags are carried, not blended — the buffer takes them
from the nearer bracketing snapshot — so each moves at most once per snapshot interval
and only forward. Spawn protection stays where it is: its edges are already resolved
against the client's own countdown, and re-deriving a three-second glow from a flag bit
would re-arm it rather than sharpen it.

Both tests fail with those four lines removed. The bar is judged by the HUD's real
`combatantGetsBar` predicate over a presented world, and the corpse must clear one
interpolation delay after the death arrives, inside a frame either way.

## 5. The round trip is three numbers

**Reported for the Director/developer, as the brief asks.** The composite RTT the client
could measure is `input → the snapshot that acks it`, and that path is *made of the
game*: the input is stamped for a future tick, the server holds it in its queue until
that tick comes round, and the ack rides the next 30 Hz broadcast. A client nine ticks
ahead measures its own lead and calls it the network. Hence 24 ms on a speedtest and 215
ms in the game, both honest.

| Stage | How it is measured | Fix if it is the culprit |
|---|---|---|
| **NETWORK** | a `ping`/`pong` pair the room answers **in its socket handler**, never on a tick boundary (`server/room.ts` `receive`). 2 Hz, ~30 B each way | a region — the allocator's business (`src/net/allocator-client.ts`) |
| **SERVER**, tick queue | `PongMessage.queueMs`: receive → apply for this client's newest simulated input, measured in **sim ticks** so no new clock is plumbed | the lead budget (§6) |
| **SERVER**, loop | `PongMessage.loopLagMs`: how far past its deadline the room's tick loop ran, smoothed — the same overshoot `/health` reports, read from the loop that steps *this* match | **a machine size — a Director/developer decision, not a code fix** |
| **CLIENT** | frame scheduling delay: how much later than the fixed tick interval this device produced a tick's input | the device, or the render budget |

All four land in the per-second sample and in a pasted log as `net`, `netMin`, `srvq`,
`srvlag`, `cli`, `cliMax`, beside the composite `rtt` that stays exactly where it was.
A log reading `rtt 215` next to `net 26` says the wire was never the problem, in one
glance — a sentence no single number could say.

**What the harness measures on a clean 100 ms wire:** `net` tracks the wire to within
the two frames of sampling quantization a probe carries at either end; the composite is
the wire *plus* the queue wait, and `network + queue` accounts for it within the
broadcast interval the ack rides home on. On a 250 ms wire with jitter and loss the two
*floors* differ by a broadcast interval of pure queue wait. The harness's own server
reports `loopLagMs < 1` — it advances one tick per frame, so it is never late; that is
the shape of a healthy reading, and the number the machine-size question gets asked
with. **No CPU-starvation finding is claimed here**: the Director's server poll during
room `RXS3` showed loop lag flat at 1.8–2.9 ms all match, which is a host that is not
starving. If a future capture shows `srvlag` climbing with bot count, that is the
shared-cpu-1x question, and it is the developer's call to make.

**The displayed ping shows NETWORK** (`TransportSession.networkPingMs`, for m10-17's
lobby/HUD readout) — and shows its *floor* over the recent window rather than the newest
sample. One retransmit stalls the probe along with everything else on the socket, and a
780 ms flash on a 250 ms connection is noise presented as information; the wobble is
already measured, on its own line, as jitter. Never the composite: telling a player on a
24 ms connection that they have a 215 ms one is a lie the client has no business telling.

## 6. The lead ratchet

Second capture, room `RXS3`, correlated with the Director's server poll:

> client rtt stepped **108 → 174** at one transient and NEVER came back down — flat
> plateau, jitter unchanged at 8 ms, recon 21 then 39, lead **5 → 9**, server loop lag
> flat 1.8–2.9 ms all match

Real network degradation is spiky. A plateau on a wire whose jitter never moved, with a
server that never lagged, is the client doing it to itself — and the numbers close on
each other exactly:

```
174 ms (composite)  −  24 ms (wire)  =  150 ms  =  9 ticks  =  the stuck lead
```

The composite sized the lead budget; the lead inflated the composite. One hiccup widened
the ceiling to **14 ticks**, the stuck lead of 9 sat comfortably under it, and `trimLead`
had nothing to do for the rest of the match. `rttFloorMs` — the least composite RTT over
a 10-second window — was supposed to prevent exactly this, and cannot: when *every*
sample in the window carries the same queue wait, so does their minimum.

**The fix is the input.** The budget is sized from `networkFloorMs`, which has no tick in
it at all (`src/net/session.ts`, `src/net/prediction.ts` `setLeadBudget`), with the
composite floor kept as the fallback for a server too old to answer a ping. Sized from
the wire, the same 9-tick lead is *over* budget and bleeds off at up to four ticks per
reconcile. The decay the brief asks for is that floor's own window: a 10-second minimum
cannot be raised by a transient, and follows a genuine improvement within N stable
seconds.

The harness gained a scripted stall — one 500 ms head-of-line block at a named instant,
which a loss-rate profile cannot express (relentless stalls test a steady state; a
ratchet is a step that never comes back, and you need a clean wire either side of a
single step to see one):

```
  lead: baseline 6.6t → peak 32t → +10s 5.7t  (budget 10t, net 117ms)
```

**Honest limitation of that gate.** It passes on the old sizing too. The harness's wire
recovers perfectly and its stalled backlog drains at line rate, so the ack stream resumes
at once, some input always arrives having waited for nothing, and the composite floor
stays honest — the plateau needs a budget wide enough to *permit* the inflated lead
indefinitely, which is what a real client's never-zero queue wait gave it. So the
regression that would have caught this is asserted where the fault actually lives: the
instrument keeps two floors and only one of them is the wire
(`src/net/telemetry.test.ts`), and the budget arithmetic is asserted against the
capture's own numbers — 174 ms permits a 9-tick lead, 24 ms does not
(`tests/net/rtt-decomposition.test.ts`).

## What is not in this pass

- **No machine-size change.** The numbers are reported above; the decision is the
  Director's and the developer's (GDD §4.2 hosting criteria, docs/netcode-spike.md).
- **No wire-format change.** `ping`/`pong` are text frames like every other
  non-snapshot message; the binary snapshot layout and `WIRE_VERSION` are untouched.
- **No `src/sim` change.** Death, respawn and the deposit courier are the sim's, and
  this pass reads them — the parity principle is the whole argument (GDD §2.4).
- **No live-stage evidence PNG.** Playwright cannot launch a browser in this lane (no
  `libnss3`, no root); every claim above is a CI gate instead.
