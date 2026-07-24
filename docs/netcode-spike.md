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
| Ship × 8 | `id u8` · `posX/posY i16` · `velX/velY i16` · `heading u16` · `aim u16` · `hull u8` · `flags u8` = 15 ea | 120 |
| Projectile × 64 | `id u8` · `posX/posY i16` · `meta u8` = 6 ea | 384 |
| **Worst case** | 8 ships + 64 projectiles (GDD entity caps) | **510** |

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
