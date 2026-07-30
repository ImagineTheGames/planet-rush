# Netcode Spike — Day 0 (Planet Rush)

**Owner:** Netcode Engineer · **GDD:** §4.2, §4.1, risks 3 & 4 · **Status:** decided

This spike **decides**, it does not confirm (GDD §3.5). The ~2 KB snapshot and
~40 KB/s numbers in GDD §4.2 are *inputs* to this spike, not conclusions from
it — treated like the balance constants in §2.8: hypotheses to falsify. Below,
one is busted and one holds.

Everything here is reproducible from the repo:

```
npx vitest run src/net/spike     # prints the MEASUREMENTS block; asserts wire invariants
npx tsc --noEmit                 # the whole spike type-checks under the strict config
```

The measured code lives in `src/net/spike/` (`snapshot.ts` wire layout +
`sim-standin.ts` workload + `bench.ts` harness); the `Transport` interface is in
`src/net/transport.ts`.

**Status since (prediction):** the client no longer waits for the wire. It runs
the same `step()` the server runs on its own input the moment that input is sent,
and reconciles the result against every snapshot — rewind to the snapshot's tick,
write authority over it, replay everything past `ackSeq`
(`src/net/prediction.ts`, GDD §4.2). Three things this document should record,
because they are measurements rather than intentions:

- **The replay is bounded by the round trip, not by a constant.** Pending input
  is exactly what the server has not yet simulated, so a client replays ~RTT
  ticks per snapshot: at the 100 ms link in `src/net/prediction.test.ts` that is
  ~6 steps, 30 times a second — ~180 extra sim steps/s against the 0.0146 ms/step
  measured below, i.e. **~2.6 ms of CPU per second**, 0.26% of one core.
- **The client's lead is emergent.** Nothing configures how far ahead of the
  server a client runs: replaying every unacknowledged input on top of each
  snapshot lands it exactly one round trip ahead, which is the lead that makes
  its input arrive *for* the tick it names. The tests watch late arrivals stop.
- **`ackSeq` had to change meaning.** It now names input the world has *run*, not
  input the server has *received*. Acknowledging on arrival tells a predicting
  client to retire a press whose effect has not happened yet.

**Status since (day 3):** `Transport` now has its first implementation —
`LocalLoopback` (`src/net/loopback.ts`), which runs the authoritative sim
in-process for offline play and speaks the protocol below with the wire
removed. The measured wire layout is promoted to `src/net/snapshot.ts` and
encodes the *real* `World` rather than the stand-in; `src/net/snapshot.test.ts`
pins it to the same 510-byte worst case measured here, so the bandwidth numbers
in this document cannot silently drift. Two spike items remain open and are
called out below rather than quietly closed: the **TCP head-of-line measurement
still needs a real lossy network**, which arrives with `WebSocketTransport`, and
the tick-rate headroom is still measured against the stand-in workload, not the
real sim plus server-side bot AI plus 8-socket fan-out.

**Status since (day 3, the server):** the decisions in this document are now
running code rather than a plan.

- **The 30 Hz broadcast decision is implemented as the room's snapshot divisor**
  (`server/room.ts`, one snapshot every 2 ticks of the 60 Hz sim), and static
  entities are diffed and sent as events at 10 Hz — they cost nothing per tick,
  exactly as §4.2 of the GDD assumes and this document's bandwidth table bills.
- **The wire layout measured here is what actually goes over the socket**, inside
  a 10-byte frame header (kind, version, tick, ackSeq — `src/net/wire.ts`). Frame
  overhead is therefore 10 B on top of the 510 B worst case, not the ~44 B
  transport overhead already billed above; the per-client numbers stand.
- **Control traffic is JSON, deliberately.** Join/lobby/events/match-end are a
  handful of messages per match, and input is the only frequent one — the
  measurement above says upstream is never the bottleneck, so a binary input
  encoding is recorded as a follow-up rather than done on spec.
- **The host decision is honoured by construction.** The server is a plain
  Dockerized Node process (`server/Dockerfile`) with a **dependency-free**
  RFC 6455 endpoint (`server/ws.ts`), so the runtime image is `node` plus one
  bundled file: nothing native to rebuild for the chosen ARM Ampere core, and
  nothing vendor-specific to port. Oracle Always Free → the €4 VPS remains an
  afternoon, which was the whole point (risk 1).

**Still open, and still stated rather than quietly closed:** the TCP
head-of-line measurement needs a real lossy network with eight real clients —
the transport and the server that make that test possible now both exist, so it
is a test to run, not a thing to build. The tick-rate headroom is still measured
against the stand-in, not the real sim plus seven server-side bots plus the
8-socket fan-out; the honest place to close that is the M5 integration gate,
against the real bot trees rather than today's do-nothing baseline.

---

## MEASUREMENTS

Captured from a real run of `npx vitest run src/net/spike` on this hardware:

```
host CPU        : Intel(R) Core(TM) i9-14900HX (8 logical cores)
node           : v22.23.1
sim duration   : 30s simulated per rate
worst-case snap: 510 bytes (8 ships + 64 projectiles)

rate  broadcast  avg tick  max tick  budget  headroom  sustain  snap(live)  BW worst
20Hz  20Hz      0.0401ms  0.299ms   50.00ms 1247×     YES      330B        10.8KB/s
30Hz  30Hz      0.0249ms  0.373ms   33.33ms 1338×     YES      294B        16.2KB/s
60Hz  30Hz      0.0146ms  0.221ms   16.67ms 1138×     YES      396B        16.2KB/s
```

**Caveat, stated honestly:** this is a fast x86 laptop core (the dev/CI box),
not the target host. Two things load it further in production and are *not* in
this stand-in: (a) the real sim (`src/sim/`) plus server-side bot AI for up to 7
bots, and (b) fanning the broadcast out to 8 sockets. And an Oracle ARM Ampere
free core is materially slower than this i9. The headroom below is sized against
all three.

### 1. Snapshot size — MEASURED, not assumed

Wire layout (`src/net/spike/snapshot.ts`, little-endian, hand-packed):

| Section | Fields | Bytes |
|---|---|---|
| Header | `tick u32` · `shipCount u8` · `projCount u8` | 6 |
| Ship × 8 | `id u8` · `posX/posY i16` · `velX/velY i16` · `heading u16` · `hull u8` · `flags u8` = 13 ea | 104 |
| Projectile × 64 | `id u8` · `posX/posY i16` · `meta u8` = 6 ea | 384 |
| **Worst case** | 8 ships + 64 projectiles (GDD entity caps) | **494** |

> **Amendment (v0.3 laser funeral).** The ship record was 15 B / worst case
> **510 B** as originally measured, with a `heading u16` **and** an `aim u16`.
> When mining and combat became pooled projectiles the `aim` field (the old
> firing-ray direction) had nothing left to say — a ship points at `heading` and
> its shots stream in the projectile pool — so it was retired. Dropping 2 B × 8
> ships takes the ship record to 13 B and the worst case to **494 B**. The
> numbers below are the original day-0 measurement; the 16 B reduction only makes
> the bandwidth argument stronger. See `docs/design-amendments.md`.

Only ships and projectiles stream as binary; static entities (asteroids,
turrets, shields, wrecks) are events on join/change (GDD §4.2), so they cost
nothing per tick. Values are quantized to integers on the wire — the client
interpolates between snapshots at 60 fps render, so sub-unit precision is never
sent. Velocity is included so the client can dead-reckon a remote entity between
snapshots. Typical mid-match live snapshots measured **294–396 B** (fewer than
64 projectiles usually in flight).

### 2. Sustainable tick rate

The sim integrates at the fixed **60 Hz** timestep (GDD §4.1); the table's `hz`
is the server step/broadcast rate under test. At 60 Hz the stand-in step costs
**0.0146 ms** average / **0.221 ms** worst against a **16.67 ms** budget — a
**~1138× headroom** on this core, and every candidate rate is sustainable with
>1000× to spare. Even if the real sim + 7-bot AI + 8-socket fan-out is **50×**
heavier than this stand-in *and* the production ARM core is **5×** slower, that
leaves ≈ 1138 / 250 ≈ **4.5× headroom** at 60 Hz — still real-time.

### 3. Per-client bandwidth (measured size × candidate rates)

Per frame on the wire ≈ 510 B payload + ~44 B overhead (4 B WebSocket server→
client header + ~40 B IPv4/TCP):

| Broadcast rate | Worst-case down (per client) | vs 40 KB/s budget |
|---|---|---|
| 20 Hz | **10.8 KB/s** | 27% |
| 30 Hz | **16.2 KB/s** | 41% |
| 60 Hz (not used) | 32.5 KB/s | 81% |

Upstream (client → server) is one small `InputMessage` per client tick — a
handful of `Action`s; binary-encodable to tens of bytes, tens of KB/s at most,
never the bottleneck. Server aggregate egress at 30 Hz ≈ 8 × 16.2 = **~1.04
Mbps**, ≈ **117 MB per 15-min match** — negligible against any host's transfer
allowance (Oracle Always Free alone gives 10 TB/month).

---

## ANALYSIS

### The two GDD §4.2 hypotheses, adjudicated

- **~2 KB snapshot → BUSTED.** Measured worst case is **510 B**, ~3.9× smaller;
  typical live is ~300–400 B. The assumption over-estimated; the real number is
  comfortably smaller.
- **~40 KB/s per-client budget → CONFIRMED.** Worst case at the chosen 30 Hz is
  **16.2 KB/s** (41% of budget). Even a 60 Hz broadcast would stay under. The
  budget holds with room to spare.

### TCP head-of-line blocking (risk 3)

Cannot be fully characterized without a real lossy network (that lands with the
day-3 transport), but the size argument is favorable: a 510 B snapshot fits in a
single sub-MTU TCP segment, so one snapshot ≈ one segment. A dropped segment
stalls only ~1 RTT until retransmit, and because snapshots are **full state**,
not deltas, the very next snapshot fully recovers — a lost frame is a skipped
interpolation target, not desync. HoL risk at 8 players is therefore **low but
unmeasured**; flagged for the day-3 real-network test. If it bites, geckos.io
(UDP over WebRTC) drops in behind the same `Transport` interface — transport
work, not a rewrite.

**Update, and the honest half of it.** Two clients now play a real match over a
real socket (`tests/net/online-2p.test.ts`) — TCP, handshake, framing, the lot —
so the *stack* is measured end to end. Loopback TCP does not drop packets, so
risk 3 itself is **still unmeasured**, and this document will keep saying so
until it is run over a lossy link. What did change is the cost of a stall:
prediction means a client whose snapshot is late keeps flying its own ship at
60 Hz on its own input, and the snapshot that eventually arrives is corrected
against rather than waited for. A head-of-line stall is now a *stale rival* for
its duration, not a frozen game.

### Host candidates (GDD §4.2 criteria)

Criteria: hold a persistent WebSocket for a full match under 8-player load,
**no sleeping**, **~zero cost**, **no vendor lock**. Overarching hard
requirement (GDD §4.2, risk 1): the server ships as a **plain Dockerized Node
process with zero vendor-specific APIs**, so it redeploys elsewhere in an
afternoon. *I cannot load-test today* — this reasons from each provider's
documented free-tier terms and the criteria, and says so.

| Candidate | Persistent WS / no sleep | ~Zero cost | No vendor lock (plain Docker Node) | Verdict |
|---|---|---|---|---|
| **Oracle Cloud Always Free (ARM Ampere A1)** | Yes — a real always-on VM; you own the process, nothing sleeps | Yes — Always Free (not a trial): up to 4 OCPU / 24 GB + 10 TB/mo egress | Yes — it's a bare VM; the Docker Node process runs identically anywhere | **PRIMARY** |
| **Cloudflare Durable Objects** | Yes — WebSocket-native, hibernatable, one DO per room maps cleanly | Partial — DOs are on the free Workers plan but with request/duration caps; a 15-min 60 Hz authoritative loop fights the request-scoped/duration-billed model | **No — Workers runtime, not Node; no Docker; `DurableObjectState`/`WebSocketPair`/bindings are vendor APIs. Porting off = rewrite** | **REJECTED** — best WS routing, but fails the hard portability requirement |
| **Low-cost VPS (~€4/mo, e.g. Hetzner CX22/CAX11)** | Yes — always-on, full root, nothing sleeps | Near — ~€4/month, not free | Yes — bare VM, identical Docker Node deploy | **FALLBACK** (GDD's standing paid baseline) |

**Why Oracle primary, not the VPS:** zero-cost is an explicit criterion, and
Oracle Always Free meets no-sleep + no-lock while costing nothing. Its honest
risks — ARM "out of host capacity" at provisioning time in busy regions, and
Oracle's right to reclaim *idle* Always-Free compute (low 7-day CPU/net/memory
utilization) — are exactly what the fallback exists for. Because the server is a
plain Docker Node process, moving to the VPS is an afternoon, which is the actual
requirement (risk 1): **portability is the mitigation, not the vendor.** A quiet
game server is kept warm by its own match traffic and a trivial heartbeat.

**Why Cloudflare DO is rejected despite being the most WebSocket-native option:**
it is the *only* candidate that cannot ship as a plain Dockerized Node process.
Its code targets Cloudflare's Workers runtime with vendor-specific APIs, so a
tier change or outage (risk 1) would force a rewrite rather than a redeploy —
the precise failure mode the hard requirement exists to prevent. It also fits
the game-loop shape poorly: DOs are event/alarm-driven and duration-billed, not
a home for a continuous 60 Hz authoritative loop. Kept on the bench as a future
option *only if* it were ever fronted by a portable Node origin.

Deploy path is unchanged either way: GitHub Actions builds the Docker image and
pushes to whichever host wins (GDD §4.2, §4.8), so a hotel-Wi-Fi push updates
the server.

---

## DECISION: sim 60 Hz / snapshot broadcast 30 Hz · snapshot budget 512 B (measured 510 B worst case) · host = Oracle Cloud Always Free (ARM Ampere A1), fallback = ~€4/mo Hetzner VPS — both run the identical Dockerized Node process, so switching is an afternoon (risk 1).

> **The host line above is superseded — Oracle → Fly.io.** See
> *Status since (hosting, 2026-07-25)* below for the change and, more to the
> point, *why it is a scope change and not a correction*. Everything else in the
> DECISION stands and has since been measured against the real workload.

---

## Status since (hosting, 2026-07-25)

This is the spike closing the items it left **explicitly open** — the ones the
day-3 notes above promised as "a test to run, not a thing to build". The document
keeps its habit: what has been measured is stated as a number, and what still
needs the live link is stated as *open*, not quietly closed. Full context lives in
`docs/hosting-plan.md`; the reproducible pieces live in the repo:

```
npx vitest run tests/harness/fleet-density.test.ts   # room density + real-workload tick cost
npx vitest run tests/net                              # online play + reconnect-resume, real socket
```

### The host supersession — Oracle → Fly, and why it is a scope change

The day-0 analysis chose Oracle Always Free for a **single** always-on server:
one bare VM, zero cost, no vendor lock, portable by construction. That analysis
was not wrong for the question it answered. The question then changed. M9 turned
"one server" into a **fleet**: an allocator control plane, several match Machines,
per-room routing with signed tickets, heartbeats, cordon-and-drain lifecycle, and
a reconnect room-liveness probe (`allocator/`, `src/net/allocator-client.ts`,
`server/heartbeat.ts`). A single bare VM does not *have* the primitives that fleet
needs, so on Oracle we would have had to *build* them by hand:

| Fleet needs | Fly gives it | On a bare Oracle VM |
|---|---|---|
| Per-Machine identity a ticket routes to | `FLY_MACHINE_ID` / `FLY_REGION`, injected (`server/heartbeat.ts` falls back to them) | hand-assign and distribute `MACHINE_ID` / `REGION` per host |
| Private allocator↔Machine link | 6PN private DNS (`*.internal`) — `ALLOCATOR_URL=http://planet-rush-allocator.internal:8080` | stand up and secure our own overlay network |
| `wss://` for clients | anycast edge terminates TLS at the app hostname, free | run caddy/traefik + distribute a certificate |
| Machine lifecycle for the controller | a Machines API the fleet controller drives (`allocator/provider-fly.ts`) | script VM create/destroy against a VM API by hand |

**The portability contract is intact, which is the whole point of risk 1.** The
game server is *still* a plain Dockerized Node process with zero vendor-specific
APIs — nothing in `server/` imports a Fly SDK; the Fly-ness is entirely in
environment variables (`fly.gameserver.toml`) that a plain VPS supplies explicitly
instead. `server/heartbeat.ts` reads `MACHINE_ID ?? FLY_MACHINE_ID`, so the same
image runs on Fly and on the **€4 Hetzner fallback, which remains the standing
paid baseline** — the afternoon-to-redeploy escape hatch the day-0 doc insisted on
is exactly as open as it was. Fly is not a lock-in; it is the host that already
*implements* the fleet shape the single-server host would have made us implement.
Cloudflare DO stays rejected for the same reason as day 0 (not a plain Node
process). So: **scope grew from server to fleet; the host followed the scope.**

### 1. Tick headroom against the REAL workload — CLOSED

Day 0 flagged the headroom as measured against the *stand-in* sim, not "the real
sim plus server-side bot AI plus 8-socket fan-out". `tests/harness/fleet-density.test.ts`
now measures the real thing: real `MatchRoom`s (the exact object `server/index.ts`
hosts), each running eight **Hard** bots — the worst case, because a bot runs its
behaviour tree server-side every tick and costs *more* than a human's one dequeued
input. The real snapshot **encode** runs every broadcast tick regardless of socket
count, so it is billed; the per-socket **send** fan-out is the cheap half a human
seat trades *into* (bot → human swaps a behaviour tree for one buffer copy), so a
bot-only room is the true CPU ceiling.

Measured on the same i9-14900HX dev core the day-0 table used:

```
per room, 8 Hard bots, steady-state (past spawn protection, live combat):
  ~0.043 ms per room per 60 Hz tick
32-room fleet (the new DEFAULT_MAX_ROOMS):
  mean 1.4 ms/tick  (8.3% of the 16.67 ms budget) · p99 2.9 ms (17.6%)
64-room fleet (the previous ceiling), for comparison:
  mean 2.95 ms/tick (18%)  · p99 6.8 ms (41%)
```

The day-0 "50× heavier real workload" fear was pessimistic: the real room is
~0.043 ms/tick, so eight Hard bots + encode are **~3× the stand-in step**, not
50×. Headroom holds with room to spare — closed.

### 2. Room density, MEASURED → DEFAULT_MAX_ROOMS 64 → 32

The old `DEFAULT_MAX_ROOMS = 64` comment cited the spike's *stand-in* estimate.
The measurement replaces it. Extrapolating the fleet cost to the deploy target —
a shared-cpu-1x Fly guest, taken at the day-0 §2 estimate of **~5× slower** than
this dev core:

```
32 rooms @5×:  mean ~7.0 ms/tick (~42% of budget)  ← chosen ceiling, real headroom
64 rooms @5×:  mean ~14.7 ms/tick (~88% of budget) ← too close to saturation
```

At 64 the estimated target core sits at ~88% of the tick budget on the *sustained*
(mean) cost — the number the `/health` `loopLagMs` gate watches — with no margin
for memory, socket fan-out, GC, or a noisy shared neighbour. That is not a *hard*
ceiling; it is a coin toss. **32** lands near ~42%, a ~2.3× margin, so
`server/match-server.ts` now sets `DEFAULT_MAX_ROOMS = 32` with the measurement in
its comment. **Still open, and stated:** the 5× is a documented *estimate*, not a
measurement of the real guest — item 4 is what turns it into a number, and the
`fly.gameserver.toml` guest comment still reads "≤64", which the live gate will
reconcile (raise the ceiling on a performance CPU, or ratify 32 on the shared one).

*How the CI backstop applies the 5× without lying about the runner.* The
extrapolation gate (`fleet-density.test.ts` Gate 2) has to hold on GitHub's
runners too, not just the i9 — and a bare `mean × 5 < 16.67 ms` does not: the
runner is itself ~3× slower than this i9, so the raw ×5 double-counts *its* own
slowness and reads ~19.7 ms against the 16.67 ms budget (the red job this note
descends from). The factor is defined i9→Fly-guest, so it is only valid relative
to the i9. The test therefore times a fixed reference workload on whatever core is
running it, ratios that against the i9 baseline (~2.9 ms), and scales the factor:
a K×-slower measuring core has already paid part of the penalty, so the remaining
slowdown from *there* is `5 / K`. The asserted `mean × (5/K)` is then invariant to
the measuring machine — it always evaluates to the i9-mean × 5 — so the gate stays
a real regression backstop (a room that got heavier still trips it, on any core)
without becoming either a CI false-fail or a slow-core no-op. It is a *backstop*,
not the answer: the honest deploy-target number is still item 4's live gate.

### 3. Sustained CPU gate (20 min on the real guest) — INSTRUMENTED, OPEN

The load signal is now on the front door: `/health` reports `loopLagMs`, the p99
event-loop lag over the recent window (`server/index.ts`, `server/heartbeat.ts`).
That is the reading a short burst hides — a shared vCPU passes for a minute on
burst credit, then falls to its low baseline once the credit is spent, and only a
*sustained* watch catches it. The gate: run **one 8-player match for a full 20
minutes** against the deployed Fly Machine and poll `/health`; healthy is a few ms,
and a breach of **~8 ms** is the sign the shared core has run out of credit, at
which point the app moves to a **performance CPU size** — affordable at one region
and exactly the trade `fly.gameserver.toml` anticipates. **Open, and honestly so:**
the 20-minute duration *is* the test (a short run passes on burst credit and proves
nothing), and it must run on the real guest, which this repo's CI cannot stand up.
The instrument is shipped and the procedure is fixed; the number is owed.

### 4. TCP head-of-line on a REAL lossy network — STILL OPEN, still stated

Unchanged in status from day 0, and this document will keep saying so until it is
run over a genuinely lossy link. What *is* now true: the full online stack runs
end to end over a real socket — `tests/net/online-2p.test.ts` (two clients, real
`node:http` + RFC 6455 + `MatchServer`) and `tests/net/reconnect-resume.test.ts`
(item 5) — so there is nothing left to *build* to run the HoL test; there is only a
lossy link to run it *over*. **Loopback and a LAN socket do not drop packets**, so
risk 3 itself remains unmeasured. The way to close it is fixed: put a lossy shaper
in the path (a `tc netem` egress rule, or a delay/drop proxy) between eight real
clients and the deployed Machine, and watch whether a dropped TCP segment's ~1-RTT
retransmit stall is, as argued, only a *stale rival* rather than a freeze —
prediction keeps the local ship at 60 Hz, and the next full-state snapshot recovers
without a delta chain. If it bites at 8 players, geckos.io (UDP/WebRTC) drops in
behind the same `Transport` seam. Owed, not assumed.

### 5. Reconnect-resume, end to end — DONE in-process, live run OPEN

The ship-comes-back-with-cargo guarantee (GDD §4.2) now has an end-to-end proof
over a real socket: `tests/net/reconnect-resume.test.ts` kills the underlying TCP
socket mid-match (a blip, not a deliberate leave), lets `WebSocketTransport`'s own
backoff redial and reclaim, and asserts the reclaimed authoritative `Ship` is the
**same object** the player flew — so its hull, cargo, banked ore and upgrade tiers
are exactly as left, because the world was never rebuilt, only its pilot swapped
and swapped back. Against a deployed Fly Machine this is the identical handshake
over `wss://`; that **live-deploy pass is the open half** — the guarantee is proven
against the real stack in-process, not yet against the real network.

### 6. Client server-URL config — DONE

`src/net/server-url.ts` resolves the direct-connect match-server URL from, in
order: a `?server=` query override (repoint a shipped build at a staging Machine
or a colleague's laptop **without rebuilding** — testing's one knob), the
build-time `VITE_SERVER_URL` default a production build bakes in, then a
same-origin fallback for dev and the simplest self-host. Pure and injected like
the rest of `src/net/`, tested in `src/net/server-url.test.ts`. The allocator path
is unaffected — a fleet's URL still comes from the signed `ResolvedConnection`
(`src/net/allocator-client.ts`); this is the seam the single/self-hosted server and
local dev dial through.

## Reconciliation feel at real latency (M10)

A developer playing live from Brazil (gru edge) against the single-region iad
fleet — ~150–180 ms RTT — reported *"constant server rollback."* At that latency
the reconciliation *policy* is the game feel, so this milestone made the feel
measurable, smooth, and permanently guarded. The one-line finding: **the rollback
was never physics divergence.** Instrumented at the developer's exact condition,
corrections sit at the wire's ~1-unit quantization floor with a ~1 %
misprediction rate — the felt rollback was the *presentation* of tiny corrections
(a local snap, and un-interpolated remote ships stuttering), not the sim
disagreeing.

**Capture** (reproduce: `npx vitest run src/net/spike/reconcile-capture.test.ts`;
`NetTelemetry` fed through a real client↔authority round trip over an
artificially delayed wire at one-way 3 frames + 0–2 jitter, 30 Hz broadcast):

```
net telemetry — last 9s
  +  0s  rtt  151/ 167ms  corr 0.4/1.1u  mispred   4%  (27 recon)
  +  1s  rtt  147/ 167ms  corr 0.6/0.9u  mispred   0%  (30 recon)
  +  2s  rtt  158/ 167ms  corr 0.5/1.0u  mispred   0%  (30 recon)
  +  3s  rtt  154/ 167ms  corr 0.4/1.0u  mispred   3%  (30 recon)
  +  4s  rtt  150/ 167ms  corr 0.0/0.0u  mispred   0%  (31 recon)
  +  5s  rtt  151/ 167ms  corr 0.0/0.0u  mispred   0%  (30 recon)
  +  6s  rtt  153/ 167ms  corr 0.0/0.0u  mispred   0%  (30 recon)
  +  7s  rtt  151/ 167ms  corr 0.0/0.0u  mispred   0%  (29 recon)
  summary: rtt ~152ms  worst corr 1.1u  mispred 1%  over 238 reconciles
```

**What shipped** (all behind the one `Transport` seam, no protocol change):

1. **Telemetry** (`src/net/telemetry.ts`, `NetTelemetry`) — misprediction rate,
   correction magnitude, and RTT sampled per wall-clock second. RTT is *measured*
   off the ack the reconcile loop already carries (send→first-ack round trip), so
   no new wire field and no server clock. Wired into `TransportSession`; a
   `?debug=1` netgraph reads `session.telemetry.live` per frame and
   `.format()` dumps the capture above.
2. **Smooth corrections** (`src/net/prediction.ts`) — the visual correction offset
   now blends out over a named `RECONCILE_BLEND_FRAMES` (exponential error decay,
   time-constant 6 frames ≈ 100 ms), and only a divergence past `SNAP_THRESHOLD`
   (120 u, teleport-grade: respawn / reclaim / resync) is hard-snapped. Below it,
   nothing the developer sees is a jump.
3. **Remote interpolation** (`src/net/interpolation.ts`, `RemoteInterpolator`) —
   other ships render `INTERP_DELAY_MS` (100 ms) in the past, played back *between*
   received snapshots rather than dead-reckoned forward, so their motion is smooth
   at any local RTT. The local ship stays predicted. Fed by `TransportSession`; the
   render layer samples it (that wiring is Platform's lane — see the PR).
4. **Latency harness** (`src/net/latency-transport.ts` + the permanent test in
   `src/net/prediction.test.ts`) — the developer's ~150 ms + jitter is now a
   standing assertion: normal flight never produces a correction ≥ `SNAP_THRESHOLD`.

**Region note (Director decision, not acted on here).** The fleet is single-region
iad; a gru client eats the whole ~150 ms. The telemetry above is the input to
"does a gru Machine earn its keep?" — multi-region seams already exist (allocator
region hints, router). Out of scope for M10 by the brief.

### Still open, gathered in one place (the day-0 habit)

- **Risk 3 (TCP HoL)** — unmeasured until run over a real lossy link (item 4).
- **Sustained CPU** — `loopLagMs` shipped; the 20-minute live gate is owed (item 3).
- **The 5× target-core factor** — an estimate feeding DEFAULT_MAX_ROOMS = 32; the
  live gate measures the real guest and reconciles the ceiling (and the
  `fly.gameserver.toml` "≤64" comment) up or down.
- **Reconnect-resume live** — proven in-process; the deployed `wss://` pass owed
  (item 5).
