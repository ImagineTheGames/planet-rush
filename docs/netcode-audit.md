# The netcode audit — what the booted client actually does at 150 ms

**Owner:** Netcode Engineer. **Status:** shipped (M10, `agent/netcode/m10-netcode-audit`).
**Ordered by the developer**, live from ~150 ms RTT:

> *"everything moves so erratically... jumpy projectiles/enemies, even I get
> server rollback a lot. Is EVERYTHING server sided? We need leeway —
> interpolation for clients and client-side prediction."*

This document answers that in the only way worth anything: **per entity class,
what the shipped client does, with a file and a line.** No aspirational claims —
several of the claims in the code's own comments were the thing that turned out
to be wrong, and §1 is how that was established.

Companion documents: `docs/netcode-spike.md` (the day-0 measurements — snapshot
size, tick rate, host) and `docs/playtest-log.md` (how a session gets handed
back). The permanent acceptance runs are `tests/net/latency-feel.test.ts`.

---

## 1. First: was the developer's build the one with the smoothing in it?

The brief asks this before anything else, because "we already fixed that" and
"the player still feels it" are only compatible if you check. Two answers, and
the second is the one that matters.

**a) Yes — the build had #238 in it.** PR #238 ("reconciliation feel at real
latency") merged as `d43a00f`; its deploy run (`30510772757`) went green at
**2026-07-30T03:17:11Z**, and the next merge to `main` was not until 11:20Z. Any
session in that window ran a bundle built from `d43a00f`. The live build at the
time of writing is `57bbc34` (`version.json`, 12:45Z), later still. So the
developer's console build stamp cannot have named a pre-#238 sha unless the
session predates 03:17Z.

**b) And it made no difference, because nothing on the client read it.** Fetching
the deployed bundle and grepping it:

```
$ curl -s https://imaginethegames.github.io/planet-rush/assets/index-BLwjRzah.js \
  | grep -o 'sampleRemotes\|renderOffset' | sort | uniq -c
      1 renderOffset
      1 sampleRemotes
```

One occurrence each — their own definitions:

```
…get rejectReason(){…}sampleRemotes(){return this.interpolator?.sample(this.clock())??[]}sendInput(t){…
…get lastSnapshotTick(){return this.snapshotTick}get renderOffset(){return this.offset}predict(t,e){…
```

**There is no call site.** The client renders straight off the predicted `World`
(`renderer.draw(world, …)`, `src/main.ts:1556`), and #238 shipped its smoothing
and its interpolation buffer as *seams for the render layer to adopt* — which
never happened, because the render layer is Platform's lane and the seam was
offered rather than wired. The correction offset was computed every reconcile and
discarded. The interpolation buffer was fed every snapshot and never sampled.

So the honest summary of the developer's report is: **they were running the fix,
and the fix was not connected to the screen.** Everything in §2 was measured with
that in mind.

---

## 2. Authority model, per entity class, as shipped

"As shipped" below means **the build the developer played** — `d43a00f`, the
column that explains the report. "Now" is this PR.

| Entity class | As shipped (`d43a00f`) | Now | Where |
|---|---|---|---|
| **Local ship** | Predicted + reconciled, correction **written straight into the world** — every reconcile moved the hull instantly, at whatever magnitude. The decaying offset existed and was never applied. | Predicted + reconciled, correction **blended over `RECONCILE_BLEND_FRAMES`** because the offset now reaches the world the renderer reads. | `prediction.ts:340` (offset), `presentation.ts:110` (applied), `session.ts:360` |
| **Remote ships** | Dead-reckoned by the client's own `step()` between snapshots, then **hard-snapped** by each snapshot 33 ms apart. The interpolation buffer was fed and never read. | Rendered from the interpolation buffer at `now − delay`, with bounded extrapolation on a gap. | `prediction.ts:802` (snap), `interpolation.ts:181`, `presentation.ts:119` |
| **Bots** | Identical to remote ships — a bot is a server-side seat in the same snapshot, with no client-side distinction anywhere. | Identical to remote ships. | `snapshot.ts:193` |
| **Projectiles — the firer's own** | **Doubled.** Predicted at the trigger (good), but re-created only from *unacknowledged* inputs, so the predicted shot died one RTT after firing and the server's copy of the same shot appeared behind it. | Predicted at the trigger and **carried** for its whole flight, in pool slots the wire cannot name; the authoritative twin is suppressed on arrival. | `prediction.ts:601`, `:642`, `:784` |
| **Projectiles — everyone else's** | **Server-snapped with zero velocity.** The 6-byte record carries position and owner, no velocity; a decoded shot therefore *stood still* for 33 ms and teleported. This is the report's "jumpy projectiles", exactly. | Interpolated on the same buffer as remote ships. Two snapshots are the velocity; no wire change. | `snapshot.ts:147`, `interpolation.ts:305` |
| **Projectiles — locally re-fired turrets** | **Duplicated.** `step()` runs the whole world, so a replaying client fires *everyone's* turrets locally, on top of the same shots arriving on the wire. | Culled: a locally-spawned shot that is not the firer's own is dropped every reconcile. | `prediction.ts:642` |
| **Ore chunks** | **Client-side fiction.** Not in the snapshot, not in the event stream. Each client spawns chunks from its own predicted hits; a remote player's shot chips nothing locally (a decoded shot has no `mineYield`). | Unchanged — see §6, gap 1. | `sim/projectiles.ts:393`, `sim/state.ts:593` |
| **Ore flights (deposit couriers)** | Client-side, derived from the same local `chunks` with `deposit` set. Cosmetic. | Unchanged. | `main.ts:2928` |
| **Turrets** | Server-authoritative via the entity-event stream at 10 Hz — spawn / update / destroy. Correct, and unaffected by any of the above. | Unchanged. | `entity-events.ts:152`, `room.ts` `DEFAULT_EVENT_INTERVAL_TICKS` |
| **Shields** | Server-authoritative, entity events. | Unchanged. | `entity-events.ts:156` |
| **Stations / reactors / wrecks** | Server-authoritative, entity events (including the scouted-HP fog the client has earned). | Unchanged. | `entity-events.ts:164`, `:165` |
| **Asteroids** | Server-authoritative, entity events. | Unchanged. | `entity-events.ts:148` |
| **Radar satellites** | **Not on the wire at all** — no snapshot field, no event kind, despite `state.ts` claiming they ride the event stream. A satellite standing on the server reached *neither* client, its owner's included: six ore bought a structure nobody could see, shoot, or take coverage from. | Server-authoritative on the entity-event stream — spawn / orbit-correction / destroy, HP scouted like a turret's. | `transport.ts:278` (`kind` union), `entity-events.ts` `applySatellite`, `server/static-events.ts` `satelliteEvent` |
| **HUD numbers (held / banked ore, upgrade tiers)** | Server-authoritative on their own low-frequency channel, staged into the reconcile for their tick so unacked mining replays on top. Correct. | Unchanged. | `transport.ts:329`, `prediction.ts` `stageEconomy` |
| **Wave clock / match phase / collapse** | Predicted locally off `world.time`, corrected only by the client rewinding to each snapshot's tick. | Unchanged. | `prediction.ts` `rewind` |

**The one-line answer to "is EVERYTHING server sided?"** Authority is server-side
and should stay that way — but *presentation* was server-side too, which is the
actual complaint. Nothing between two snapshots was smoothed, interpolated, or
predicted onto the screen; the client drew authority raw, 30 times a second.

---

## 3. The fourth finding: the lead ratchet

This one is not in the field report's words, but it is in its feel, and the
harness made it measurable.

The client's clock is `snapshotTick + pending`: rewind to authority, replay every
unacknowledged input, land wherever that puts you. On a clean wire that is exactly
right — the lead *is* the round trip, measured rather than guessed. On a **lossy**
one it is a ratchet:

1. A TCP retransmit stalls the ack stream for hundreds of ms (WebSocket is TCP —
   GDD §4.3b risk 3).
2. The client keeps predicting and sending, so `pending` grows by the stall.
3. Its clock jumps forward by that much, and every later input is stamped for a
   tick that far in the future.
4. So the **server** holds those inputs in its own queue until that tick comes
   round — which delays the next ack, which keeps `pending` long.

Measured in `tests/net/latency-harness.ts`, 20 s of two-client flight, 2 % loss:

| Wire | Lead before | Lead now | Measured RTT before | Now |
|---|---|---|---|---|
| 150 ms, no jitter, no loss | 12 t | 12 t | 171 ms | 171 ms |
| 150 ms ±30 ms, 2 % loss | **33 t (550 ms)** | 18–21 t | 472 ms | 350–400 ms |
| 250 ms ±30 ms, 2 % loss | **59 t (~1 s)** | 26 t | 902 ms | 367–417 ms |

Half a second to a second of input latency, on top of the wire, held for the rest
of the match. That is the player's own trigger arriving late — the other half of
*"everything moves so erratically."*

**The fix is a bounded lead** (`prediction.ts` `MAX_LEAD_TICKS`), sized from the
measured **RTT floor** rather than the mean (the mean contains the client's own
queueing, so sizing from it chases its own tail — `telemetry.ts` `RTT_FLOOR_WINDOW`).
The excess is dropped oldest-first, at most `MAX_TRIM_PER_RECONCILE` per
reconcile: trimming it in one step would rewind the ship on screen, which is the
very thing this audit exists to remove. Bled instead, a second of over-lead is
gone in ~1.5 s and never once seen (`snap 0` in every capture below).

---

## 4. Telemetry captures

Produced by `tests/net/latency-harness.ts` — the real server, the real sessions,
the real wire codec, on a virtual clock, so these are reproducible to the digit.
Eight seconds of two-client flight, client 0. Columns: measured round trip
(mean/max), RTT variance, correction magnitude (mean/max, world units),
misprediction rate, lead (mean/max ticks), visual snaps.

**0 ms — the control.** Nothing may be wrong here at all.

```
  +  0s  rtt   33/  33ms  jit   0ms  corr 0.5/1.0u  mispred   0%  lead 1/1t  snap 0  (10 recon)
  +  1s  rtt   33/  33ms  jit   0ms  corr 0.5/1.0u  mispred   0%  lead 1/1t  snap 0  (30 recon)
  +  2s  rtt   42/  50ms  jit   0ms  corr 0.6/1.3u  mispred   7%  lead 2/2t  snap 0  (30 recon)
  +  3s  rtt   50/  50ms  jit   0ms  corr 0.4/0.8u  mispred   0%  lead 2/2t  snap 0  (30 recon)
  +  4s  rtt   49/  50ms  jit   1ms  corr 0.6/1.2u  mispred  13%  lead 2/2t  snap 0  (30 recon)
  +  5s  rtt   33/  33ms  jit   0ms  corr 0.6/1.1u  mispred   3%  lead 1/1t  snap 0  (30 recon)
  +  6s  rtt   33/  33ms  jit   0ms  corr 0.5/0.9u  mispred   0%  lead 1/1t  snap 0  (30 recon)
  +  7s  rtt   33/  33ms  jit   0ms  corr 0.5/1.0u  mispred   3%  lead 1/1t  snap 0  (30 recon)
  summary: rtt ~39ms  jitter 0ms  worst corr 1.3u  mispred 4%  snaps 0  over 220 reconciles
```

**150 ms ±30 ms, 2 % loss — the developer's condition.** 36 retransmit stalls
injected.

```
  +  0s  rtt  167/ 183ms  jit  33ms  corr 0.7/1.4u  mispred  20%  lead 11/15t  snap 0  (20 recon)
  +  1s  rtt  370/ 617ms  jit  34ms  corr 0.6/1.1u  mispred  10%  lead 18/20t  snap 0  (31 recon)
  +  2s  rtt  467/ 767ms  jit  47ms  corr 0.6/1.5u  mispred  18%  lead 21/41t  snap 0  (28 recon)
  +  3s  rtt  297/ 367ms  jit  34ms  corr 0.4/1.1u  mispred   6%  lead 16/17t  snap 0  (18 recon)
  +  4s  rtt  724/1067ms  jit 106ms  corr 0.7/1.5u  mispred  19%  lead 25/47t  snap 0  (43 recon)
  +  5s  rtt  587/1067ms  jit  72ms  corr 0.7/1.8u  mispred  19%  lead 27/49t  snap 0  (21 recon)
  +  6s  rtt  563/ 883ms  jit  81ms  corr 0.6/1.4u  mispred  15%  lead 25/44t  snap 0  (40 recon)
  +  7s  rtt  353/ 433ms  jit  48ms  corr 0.6/1.4u  mispred  11%  lead 19/21t  snap 0  (19 recon)
  summary: rtt ~441ms  jitter 48ms  worst corr 1.8u  mispred 15%  snaps 0  over 220 reconciles
```

**250 ms ±30 ms, 2 % loss — "meant to work on slower connections."**

```
  +  0s  rtt  292/ 300ms  jit  17ms  corr 0.7/1.3u  mispred  18%  lead 15/21t  snap 0  (22 recon)
  +  1s  rtt  565/ 983ms  jit  67ms  corr 0.7/1.1u  mispred   7%  lead 22/24t  snap 0  (29 recon)
  +  2s  rtt  926/1200ms  jit  98ms  corr 0.7/1.5u  mispred  17%  lead 33/67t  snap 0  (30 recon)
  +  3s  rtt  424/ 467ms  jit  60ms  corr 0.5/0.9u  mispred   0%  lead 24/24t  snap 0  (17 recon)
  +  4s  rtt 1056/1233ms  jit 106ms  corr 0.7/1.3u  mispred  16%  lead 36/64t  snap 0  (25 recon)
  +  5s  rtt  972/1700ms  jit 123ms  corr 0.8/1.6u  mispred  31%  lead 31/57t  snap 0  (39 recon)
  +  6s  rtt  935/1217ms  jit 138ms  corr 0.8/1.7u  mispred  32%  lead 30/56t  snap 0  (41 recon)
  +  7s  rtt  491/ 983ms  jit  85ms  corr 0.7/1.4u  mispred  18%  lead 24/24t  snap 0  (28 recon)
  summary: rtt ~707ms  jitter 85ms  worst corr 1.7u  mispred 19%  snaps 0  over 231 reconciles
```

**How to read the RTT column honestly.** It is send→ack, so it contains the
client's own queueing: an input stamped for a future tick cannot be acknowledged
until the server reaches that tick. On a stalled wire it therefore reads far above
the link's real latency, which is why the *floor* (`rttMinMs`) and not the mean is
what the lead budget is sized from. The wire's latency is the floor; the excess is
the lead, and §3 is about spending less of it.

**The number that matters most is the last one on every line: `snap 0`.** Not one
correction in any run was large enough to teleport the hull. Every one of them was
blended out over ~100 ms.

---

## 5. The named thresholds (the acceptance gate)

Enforced by `tests/net/latency-feel.test.ts`, permanently, on every CI run. Each
is an exported constant in that file with the paragraph that justifies it, so
moving one is a visible diff on a named number rather than an edit to an
assertion.

| Threshold | Value | What it means |
|---|---|---|
| `MAX_CORRECTION_UNITS` | 4 u | Worst single correction anywhere in the run. Perfect prediction still reconciles by ~1.4 u (the wire quantizes position to whole units, both axes). |
| `MAX_MEAN_CORRECTION_UNITS` | 1.5 u | The typical reconcile — feel is an average, not a worst case. |
| `MAX_VISUAL_SNAPS` | **0** | Corrections big enough to teleport the hull. In normal flight there is nothing a snap could be except a bug. |
| `MAX_MEAN_LEAD_TICKS` | 32 t (~530 ms) | How far ahead of its newest snapshot the client runs on average. The steady-state budget is 24 t; the allowance covers the stall windows where the client is correctly ahead of a frame that is simply old. Guards the ratchet: 33 t / 59 t before the fix. |
| `MAX_PEAK_LEAD_TICKS` | 120 t | The runaway bound. |
| `MAX_MISPREDICTION_RATE` | 0.5 | A dropped input is a tick the client ran and the server did not, so some is inevitable on a lossy wire; a majority would mean the two sims are not running the same physics. |

Plus the tunables the fixes are built on, all named in code:

| Tunable | Value | File |
|---|---|---|
| `RECONCILE_BLEND_FRAMES` | 6 (~100 ms) | `prediction.ts` |
| `SNAP_THRESHOLD` | 120 u | `prediction.ts` |
| `MAX_LEAD_TICKS` / `MIN_LEAD_TICKS` | 24 / 4 | `prediction.ts` |
| `MAX_TRIM_PER_RECONCILE` | 4 | `prediction.ts` |
| `MAX_PREDICTED_SHOTS` | 8 | `prediction.ts` |
| `INTERP_DELAY_MS` (opening) | 100 ms | `interpolation.ts` |
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | 45 / 250 ms | `interpolation.ts` |
| `JITTER_COVERAGE` / `DELAY_SLEW_MS` | 2× / 2 ms | `interpolation.ts` |
| `JITTER_GAIN` / `RTT_FLOOR_WINDOW` | 16 / 10 s | `telemetry.ts` |

**The jitter buffer is a measurement now, not a constant** (brief item 2d):
`delay = clamp(MIN_DELAY_MS + 2 × smoothed RTT variance, 45 ms, 250 ms)`, slewed
2 ms per adjustment so it slides rather than jumps. Measured in the gate: a clean
wire settles at **45 ms** (a LAN client stops paying the standard 100 ms), a
jittery one at **97–198 ms**. The ceiling is a design limit, not a technical one —
past a quarter-second, a remote ship is one you cannot lead a shot at, and GDD
§2.6 is a game of leading moving targets. A wire that wants more than that should
fail the gate, not be quietly absorbed.

**On modelling loss.** WebSocket is TCP, so a lost segment is not a dropped
message — it is a *stall*: the message and everything behind it wait for a
retransmit, then arrive in a burst at link rate. The harness models that (head-of-line
blocking, `RETRANSMIT_FACTOR` = 3 RTTs, `DRAIN_SPACING_MS` = 1 ms), because it is
what actually happens to this game on a lossy link (GDD §4.3b risk 3).

---

## 6. Known gaps this audit found and did **not** close

Stated plainly rather than left for the next report.

1. **Ore chunks are client-side fiction online.** They are in neither the snapshot
   nor the event stream, so each client spawns them from its own predicted hits
   and a remote player's shot chips nothing on your screen. The *economy* is
   correct regardless — held and banked ore ride their own authoritative channel
   and the ore-conservation invariant runs server-side (GDD §2.7) — so this is a
   visual divergence, not a scoring one: you may see a rock burst that another
   player does not. Closing it means either an ore-chunk event kind or a mine-hit
   event; both are wire changes and neither is in this brief's priority list.

2. ~~**Radar satellites never reach a client online.**~~ **Closed** — see §6a.

3. **The lead is bounded, not clock-synchronised.** A proper fix estimates the
   server's current tick and targets a lead of one one-way delay; what ships here
   bounds the symptom from the measured RTT floor. The bound is worth its keep
   (§3), but a client that spent a stall far ahead still pays a short recovery.

4. **There is no netgraph.** #238's module comments say a `?debug=1` netgraph
   reads `NetTelemetry.live` per frame; grepping the client for it returns
   nothing, in `main.ts`, `debug-hook.ts` or `src/ui/`. It was never built. This
   audit corrected the comments rather than build it, because the *instrument*
   does reach a human by a route that works — COPY LOG copies every finalized
   second into the playtest log (`playtest-log-attach.ts`), which is what QA and
   the developer actually hand back. A netgraph would be a nicer live read and is
   worth having; it is a `?debug=1` HUD overlay, so it belongs to Platform or UI,
   not to this lane.

   (Noting the pattern, since it is the same one §1 is about: three of the four
   things #238's comments claimed about how its numbers reached a screen were not
   true. A comment describing another lane's adoption of your seam is a *plan*,
   not a fact, and should be written as one.)

5. **`main.ts` still renders straight off the world.** That is deliberate — the
   render layer is Platform's lane, and this audit fixed the feel from inside
   `src/net/` by writing the presented frame over the world for the render window
   (`presentation.ts`). If Platform later adopts `sampleRemotes()` /
   `sampleShots()` / `renderOffset` directly, the presentation layer should be
   retired in the same PR, not left applying a second copy.

---

## 6a. The gap that got closed after all: radar satellites

Gap 2 was written down as "proposed rather than taken unilaterally, because it is
a wire change." That reasoning was wrong on its own terms — `EntityEventMessage`
lives in `src/net/transport.ts`, which is this lane's file, not a `src/shared/`
contract. The producer (`server/static-events.ts`) and the consumer
(`src/net/entity-events.ts`) are both this lane's too. So it was closed.

**First it was measured, not grepped.** `tests/net/satellite-visibility.test.ts`
stands a satellite up on the server through the sim's own construction path and
asks both clients whether they ever hear about it. Before the fix, both answered
zero — including the satellite's *owner*. Feature f1 sells a satellite for six
ore, above a shield, as a sensor source and a legitimate siege target; online it
was six ore for a structure nobody could see, shoot, or take coverage from.

**What ships now** is the same shape the other static entities already had:
`'satellite'` on the `kind` union, spawn events in the join and reclaim burst
(`fullEntityState`), spawn/destroy from `StaticEntityTracker`, and HP on the
scouted `FogTracker` channel rather than the public diff — a satellite's damage
is a besieger's earned read, exactly as a turret's is (GDD §2.2).

**One thing is not like the others, and it is the interesting part.** A satellite
is the only static entity that *moves*, and `sim/buildings.ts` **integrates**
`orbitAngle` per tick rather than deriving it from `world.time`. A reconcile
rewinds the clock and replays, and a rewind restores scalars, not structures — so
every replayed tick advances the client's orbit a *second* time and its satellite
outruns the server's. Phase-locking at spawn is therefore not enough. The
producer corrects it with an `update`, throttled by `ORBIT_ANNOUNCE_RADIANS`
(0.125 rad): the server's own orbit crosses that threshold at a fixed rate, so one
satellite costs ~2 updates a second rather than the 10 a per-diff announcement
would, and 0.125 rad is ~14 u of arc at orbit radius — under what the eye catches.
`tests/server/satellite-events.test.ts` pins both halves: that the correction
happens, and that it does not degrade into a stream.

That leaves **ore chunks** (gap 1) as the one entity class still drawn from client
fiction online, and it stays open for the reason stated there.

---

## 7. What a QA run should look at (`online-feel`)

For the follow-up gate riding the next evidence round, on the live fleet:

- **Press COPY LOG and paste it.** That is the whole instrument path in the
  shipped client: every finalized second is already in the playtest log, now
  carrying `jitter`, `snap` and `lead` alongside the #238 numbers
  (`docs/playtest-log.md`). There is **no on-screen netgraph** — see §6, gap 4.
- The verdict belongs in numbers, not vibes: **worst correction (u), visual snaps,
  mean lead (ticks), RTT and its variance**, at the capture's real distance
  profile. The thresholds in §5 are what to compare against.
- The three things to *watch* for, since they are the three that were broken:
  another ship's motion between snapshots (should be a glide, not a stutter), a
  shot in flight (should travel, not blink), and your own hull after a correction
  (should slide, not jump).
- **One thing to buy:** a RADAR satellite, on one client. The *other* player must
  see it orbiting (§6a — until this PR nobody could, not even its owner), and it
  should glide around the rim rather than tick. Shoot it down and it must vanish
  on both screens.

---

*Written against `57bbc34` (live at the time of the audit); fixes land on
`agent/netcode/m10-netcode-audit`.*
