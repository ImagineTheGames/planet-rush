# Netcode Spike — Day 0 (Planet Rush)

**Owner:** Netcode Engineer · **GDD:** §4.2, §4.1, risks 3 & 4 · **Status:** decided

This spike **decides**, it does not confirm (GDD §3.5). The ~2 KB snapshot and
~40 KB/s numbers in GDD §4.2 are *inputs* to this spike, not conclusions from
it — treated like the balance constants in §2.8: hypotheses to falsify. Below,
one is busted and one holds.

**The spike's own code was deleted on 2026-08-10 (n7-01), and this section says
so rather than leaving a command that no longer runs.** `src/net/spike/`
(`snapshot.ts` wire layout + `sim-standin.ts` workload + `bench.ts` harness) was
the scaffolding that produced the MEASUREMENTS block below. It had been dead
since day 3, when the wire layout was promoted into `src/net/snapshot.ts` and
started encoding the real `World`; a dark-matter scan found it unreachable from
every deployed entry point and it went. **The numbers below are unchanged and
still stand** — they are a day-0 record of a measurement that was made, not a
claim that can be re-run today:

```
git show 111db86:src/net/spike/bench.ts     # the harness, and its two siblings
npx vitest run src/net/snapshot.test.ts     # the wire layout that SHIPPED, still pinned
npx tsc --noEmit                            # strict, whole repo
```

What survives the deletion is the part that matters: `src/net/snapshot.test.ts`
holds the live encoder to a measured worst case (`toBe(622)` since a0-73, 494 B
before it), so the bandwidth arithmetic in §1 below cannot drift without a red
test. The `Transport` interface is in `src/net/transport.ts`.

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
pins it to a measured worst case (510 B here, 622 B today — §1's amendments), so
the bandwidth numbers in this document cannot silently drift. Two spike items remain open and are
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

Captured from a real run of the spike bench on this hardware (day 0, by
`npx vitest run src/net/spike` — a command that worked when this was written and
that the deletion above retired; the capture is kept verbatim):

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

Wire layout (measured in the deleted `src/net/spike/snapshot.ts`; the shipping
one is `src/net/snapshot.ts`, which encodes the real `World` in the same
little-endian hand-packed record and is pinned to the same total):

| Section | Fields | Bytes |
|---|---|---|
| Header | `tick u32` · `shipCount u8` · `projCount u8` | 6 |
| Ship × 8 | `id u8` · `posX/posY i16` · `velX/velY i16` · `heading u16` · `hull u8` · `flags u8` = 13 ea | 104 |
| Projectile × 64 | `id u8` · `posX/posY i16` · `heading u8` · `speed u8` · `meta u8` = 8 ea | 512 |
| **Worst case** | 8 ships + 64 projectiles (GDD entity caps) | **622** |

> **Amendment (v0.3 laser funeral).** The ship record was 15 B / worst case
> **510 B** as originally measured, with a `heading u16` **and** an `aim u16`.
> When mining and combat became pooled projectiles the `aim` field (the old
> firing-ray direction) had nothing left to say — a ship points at `heading` and
> its shots stream in the projectile pool — so it was retired. Dropping 2 B × 8
> ships takes the ship record to 13 B and the worst case to **494 B**. The
> numbers below are the original day-0 measurement; the 16 B reduction only makes
> the bandwidth argument stronger. See `docs/design-amendments.md`.

> **Amendment (a0-73, remote shot heading — wire v3).** The projectile record was
> 6 B and carried **no velocity in any form**, so a client could only ever place a
> remote shot where a packet put it: chord-interpolated while two snapshots
> bracketed it, and *frozen* at the head of a flight, at the tail of one, and for
> the whole of any gap in the stream. Measured at a 200 ms gap, a shot finished it
> **104 world units** behind where its own heading had it — a third of the ship
> weapon's entire reach — which is the developer's *"other players shots dont
> follow the direction they were fired in."* The record now carries one byte of
> heading (1.406°/step) and one of speed (4 u/s per step): **8 B, worst case
> 622 B**, and `WIRE_VERSION` goes to 3 because the record *stride* moved. Polar
> rather than an `i16` velocity pair because a shot is a straight line at a
> constant speed — 2 B instead of 4. The bandwidth table in §3 is re-billed against
> 622 B below; the day-0 decision (30 Hz, 512 B budget) is unchanged in kind and
> the worst case is now 26 % above that budget line while still 47 % of the
> per-client one. Measurement, both columns and the per-shot cost:
> `evidence/a0-73-remote-shots/audit.txt`.

Only ships and projectiles stream as binary; static entities (asteroids,
turrets, shields, wrecks) are events on join/change (GDD §4.2), so they cost
nothing per tick. Values are quantized to fixed-point integers on the wire.
Positions and velocities carry **eighths of a world unit** (`POS_SCALE`, M10
tick-alignment) in the same two bytes the day-0 layout measured: the original
whole-unit rounding put a permanent half-unit lie under client-side prediction and
produced a correction on every snapshot of every match — see
`docs/netcode-tick-alignment.md`. The byte cost is unchanged, so every bandwidth
number below still stands. Velocity is included so the client can dead-reckon a
remote entity between snapshots. Typical mid-match live snapshots measured **294–396 B** (fewer than
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

Per frame on the wire ≈ payload + ~44 B overhead (4 B WebSocket server→client
header + ~40 B IPv4/TCP). The day-0 column is the 510 B payload as first measured;
the a0-73 column is the shipping 622 B one (§1's amendment), and it is what a
client is billed today:

| Broadcast rate | Worst-case down, day-0 (510 B) | a0-73 (622 B) | vs 40 KB/s budget |
|---|---|---|---|
| 20 Hz | **10.8 KB/s** | **13.0 KB/s** | 32% |
| 30 Hz | **16.2 KB/s** | **19.5 KB/s** | 49% |
| 60 Hz (not used) | 32.5 KB/s | 39.0 KB/s | 98% |

Measured rather than worst-cased, on an 8-ship match firing into a rock field
(8.7 concurrent shots on average, peak 14): a snapshot is **179.9 B** and a client
takes **5.68 KB/s**, against 162.4 B / 5.17 KB/s before a0-73 — the two extra
bytes cost a real match **+0.51 KB/s**, or 35 bytes over a whole ship shot's
0.577-second flight (`evidence/a0-73-remote-shots/`).

Upstream (client → server) is one small `InputMessage` per client tick — a
handful of `Action`s; binary-encodable to tens of bytes, tens of KB/s at most,
never the bottleneck. Server aggregate egress at 30 Hz ≈ 8 × 19.5 = **~1.25
Mbps** worst case, ≈ **140 MB per 15-min match** (8 × 16.2 = ~1.04 Mbps / 117 MB
before a0-73) — negligible against any host's transfer allowance either way
(Oracle Always Free alone gives 10 TB/month).

---

## ANALYSIS

### The two GDD §4.2 hypotheses, adjudicated

- **~2 KB snapshot → BUSTED.** Measured worst case was **510 B** on day 0 and is
  **622 B** today (a0-73), still ~3.2× smaller than the assumption; typical live is
  ~180–400 B. The assumption over-estimated; the real number is comfortably
  smaller, and it has room to grow into.
- **~40 KB/s per-client budget → CONFIRMED.** Worst case at the chosen 30 Hz was
  **16.2 KB/s** (41% of budget) on day 0 and is **19.5 KB/s** (49%) since a0-73.
  Even a 60 Hz broadcast would stay under, barely. The budget holds.

### TCP head-of-line blocking (risk 3)

Cannot be fully characterized without a real lossy network (that lands with the
day-3 transport), but the size argument is favorable: a snapshot fits in a single
sub-MTU TCP segment at 510 B, at 494 B, and at today's 622 B alike — so one
snapshot ≈ one segment. A dropped segment
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

> **The 512 B budget line is EXCEEDED, deliberately, and is recorded here rather
> than quietly re-drawn (a0-73).** The measured worst case is **622 B**. 512 was a
> round number set just above a 510 B measurement, not a constraint anything
> enforces — the constraints this spike actually adjudicated are the GDD's ~2 KB
> snapshot (still busted, 3.2×) and its ~40 KB/s per-client budget (still
> confirmed, 49 %), and both hold. The two bytes bought a remote shot the heading
> it was fired on, which is a fairness rule (GDD §2.6) rather than a smoothness
> one. Everything else on this line — 60 Hz sim, 30 Hz broadcast, the host
> reasoning — is untouched.

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

> **SUPERSEDED 2026-08-07 by `docs/server-capacity.md` (m11-01): 32 → 6.** Keep
> reading this section — the arithmetic below is correct and the section is left
> standing rather than edited, because *how* it was wrong is the lesson. It gates
> the fleet against **one whole core's 16.67 ms frame**. The guest is metered at
> **6.25% of a core sustained**, so "~42% of budget" is nearly seven times the
> quota the Machine is actually billed for; it would throttle long before the loop
> noticed. It also measures the *sim* — over a real socket a room costs 1.7× again
> (4.7 ms of CPU per second, not 2.8). Both corrections point the same way, and the
> ceiling now tracks the quota: **8 rooms fit a shared-cpu-1x, 6 is advertised.**
> The "5× target-core factor" flagged as open below is *still* open and is still
> the largest remaining assumption.

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
corrections sit at the wire's quantization floor with a ~1 %
misprediction rate — the felt rollback was the *presentation* of tiny corrections
(a local snap, and un-interpolated remote ships stuttering), not the sim
disagreeing.

> **Follow-up (M10 tick-alignment).** That floor was ~1 unit at the time, and the
> developer went on to report a correction on *every* sampled second. It turned out
> the floor itself was the fault: the wire rounded positions to whole units. It now
> carries eighths, the ticks the wire loses are no longer dropped, and steady-state
> straight-line flight at 250 ms reconciles at **0.06 u** — see
> `docs/netcode-tick-alignment.md`.

**Capture** (reproduce: `npx vitest run src/net/reconcile-capture.test.ts` —
moved out of `src/net/spike/` by n7-01, because it tests only shipping modules;
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

## The wallet on the wire (M10, QA "economy-not-on-wire")

QA's live online gates passed create and two-clients and failed **reconnect**: a
reclaimed seat got its ship back *naked*. The cause was a layout decision from this
spike, working as designed. The 30 Hz snapshot carries ships and projectiles only —
510 measured bytes then, 622 now — because a ship's **wallet** (held ore, banked ore, upgrade
tiers, the DAMAGE/SPEED weapon tiers among them) is match-lifetime state a client
maintains by *deterministic replay of its own input*: same `step()`, same result, no
bytes. That reasoning holds exactly as long as the player is flying.

Two places it does not, one loud and one quiet:

1. **A reclaim** (the QA failure). The substitute bot mines and banks on the
   authoritative ship while the reclaiming client rebuilds a **fresh** world from
   the seed (`src/net/session` `beginPredicting`). No input history reproduces a
   wallet the *bot* earned, so the returning ship is tier-0 with an empty hold.
2. **Normal flight** (found while fixing 1, and never reported because it is
   invisible until it bites). Reconciliation rewinds the clock and replays every
   unacknowledged input on top of authority, but the snapshot carries no wallet, so
   a rewind cannot put the hold back the way it puts the position back: ore
   tractored in during those ticks is re-earned once per reconcile it survives. The
   error grows with RTT instead of decaying, and it is not cosmetic — the buy button
   reads the *predicted* bank, so a client one ore richer than authority sends an
   upgrade the server refuses, and from then on the two disagree about the ship's
   stats too.

**Decision: the wallet gets its own low-frequency channel, not a snapshot field.**
Widening the measured binary layout would tax every tick of every client for state
that moves on a handful of them, and it would put a *rival's* cargo on a client that
has no business knowing it. Instead:

- the reclaim `welcome` carries the wallet, because that statement must land before
  the client has a world to predict in (`WelcomeMessage.economy`);
- thereafter an `EconomyMessage` states the whole wallet to the owning slot alone,
  on the ticks it moves, immediately **ahead of** that tick's snapshot. The client
  stages it and writes it inside that snapshot's reconcile, so its own unacked
  mining replays *on top of* authority's figure (`src/net/prediction`
  `stageEconomy`) rather than on top of its own compounding one.

**Measured cost.** 136 B typical / 168 B worst case as a JSON text frame (five
upgrade tracks, fractional held ore) against the snapshot stream's 16.2 KB/s at
30 Hz (19.5 KB/s since a0-73). Worst case — a client mining continuously, so the
hold changes every tick — adds ~5.0 KB/s, taking one client's downstream to
~21 KB/s (**53%** of the 40 KB/s budget, from 41%); on today's layout that is
~24.5 KB/s (**61%**, from 49%). Typical is far below that: a wallet that has not moved sends
nothing, and nothing about flying, shooting or being shot at moves a wallet. It is
state, not a diff, so a dropped frame is corrected by the next one rather than
desyncing the client.

Proofs: `tests/server/economy-wire.test.ts` (what is sent, when, to whom),
`src/net/prediction.test.ts` "the wallet on the wire" (the re-base lands under the
replay, and the ceilings the tiers scale are recomputed),
`tests/net/reconnect-resume.test.ts` (welcome → client, over a real socket, then the
channel keeps it true), and `tests/net/economy-conservation.test.ts` — the ore
ledger's conservation law (`src/sim/ore-ledger`) sampled **every tick** of a
drop → substitute-earns → reclaim cycle, so handing a wallet across a wire is proven
to neither mint nor destroy ore.

### Still open, gathered in one place (the day-0 habit)

- **Risk 3 (TCP HoL)** — unmeasured until run over a real lossy link (item 4).
- **Sustained CPU** — `loopLagMs` shipped; the 20-minute live gate is owed (item 3).
- **The 5× target-core factor** — an estimate feeding DEFAULT_MAX_ROOMS = 32; the
  live gate measures the real guest and reconciles the ceiling (and the
  `fly.gameserver.toml` "≤64" comment) up or down.
- **Reconnect-resume live** — proven in-process; the deployed `wss://` pass owed
  (item 5).
