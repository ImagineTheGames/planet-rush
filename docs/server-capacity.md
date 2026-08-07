# Server capacity — how many rooms fit on one Machine

**Owner:** Netcode Engineer · **GDD:** §4.2, §4.3b risk 1 · **Brief:** m11-01 ·
**Companions:** `docs/netcode-spike.md` (protocol), `docs/hosting-plan.md` (topology)

Machines advertised a capacity of **32 rooms**. Nobody had measured it. This
document is the measurement, the instrument that took it, and the number the
fleet now advertises instead.

Everything here is reproducible from the repository:

```
# the curve below, on your own box, in ~13 minutes
npx vite-node tests/net/capacity/ramp-cli.ts -- \
  --local --start 4 --step 4 --max 40 --settle 20000 --sample 45000 --baseline 60000

# the CI gate — the same load, two points, ~65 s
npx vitest run tests/net/capacity/capacity-regression.test.ts
```

---

## The headline

| | |
|---|---|
| **What a room actually costs** | **4.7 ms of CPU per second of wall clock** (≈0.47% of one modern core), for a full 8-seat room: 1 human + 7 **Hard** bots, real sockets, 30 Hz snapshots. Range across the curve: 3.9 (wide incremental) – 4.7 (floor-subtracted at N=40) ms/s. |
| **What a room costs in memory** | **~1.2 MB**, over a ~63 MB process floor. Memory never binds. Not once, on any guest size. |
| **What one client actually receives** | **~4.0 KB/s** of snapshot payload — a quarter of the 15.8 KB/s the day-0 spike billed, and the first such reading taken off a real socket. |
| **Rooms on the guest we deploy today** (`shared-cpu-1x`, 6.25% of a core sustained) | **8** at 70% of quota. **The advertised 32 was ~4× the truth.** |
| **What the fleet now advertises** | **6 per Machine** (8, less a 25% margin) — `DEFAULT_MAX_ROOMS`, and `MAX_ROOMS` in `fly.gameserver.toml`. |
| **Where the loop itself gives up** | **Not on this axis.** 40 rooms held a median p99 loop lag of 5.5 ms on a full core. On `shared-cpu-1x` the **quota** binds five times sooner than the loop does. |

**The single most important sentence in this document:** on a shared-CPU guest,
the binding constraint is the **CPU quota**, not the event loop. The previous
capacity of 32 came from a measurement compared against the wrong budget — a
whole core's 16.67 ms frame, rather than the 6.25% of a core the guest is
actually metered at. 32 rooms is a perfectly reasonable number *for one full
core*. It is four times what a `shared-cpu-1x` can sustain.

---

## §1 — The instrument

`tests/net/capacity/`. It generates load the way the brief demands: **real wire,
no sim shortcuts.**

| file | what it is |
|---|---|
| `ws-load-client.ts` | RFC 6455 over `node:net` / `node:tls` — `ws://` **and** `wss://`, so the same harness measures localhost and the Fly edge. |
| `synthetic-match.ts` | One room = **1 human seat + 7 Hard bots**, opened the way a player opens one (allocate → ticket → `join` → `lobbyChoice` → `startMatch`) and then flown at 60 Hz with the trigger held, plus the 2 Hz latency probe the shipping client sends. |
| `target.ts` | Allocator door (`POST /rooms`, the production path) or direct dial, plus the `/health` reader. |
| `local-target.ts` | Spawns the **shipped bundle** (`server/dist/match-server.mjs`) as a child process, rebuilding it when stale. |
| `capacity-ramp.ts` | Baseline → add rooms → settle → sample → breach → confirm, and the markdown table. |
| `core-speed.ts` | Stamps the core each run used, timed on `src/sim/step` itself. |
| `guest-model.ts` | Quota arithmetic and cost per room, against Fly's published `iad` prices. |
| `capacity-regression.test.ts` | The CI-able subset (§6). |

### Four decisions that changed the answer

**1. A child process, not in-process.** Every other fixture under `tests/net/`
runs `MatchServer` in-process, and for behaviour that is the right trade. For a
*lag* measurement it is not merely imprecise, it is meaningless: the harness's own
60 Hz driver and socket reads would sit inside the very event loop whose lateness
is the result, and harness cost would be reported as server cost. So the thing
measured is the artifact the container runs.

**2. The harness does not decode.** Snapshots are counted and sized, never turned
back into ships and projectiles. At thirty rooms a decoding harness does more work
per second than the process it is measuring and the curve becomes a picture of the
harness. (The CI gate decodes a handful of frames deliberately — see §6.)

**3. The harness answers pings.** `server/ws.ts` keepalives every 20 s and hangs
up on a socket that has not ponged in 15 s. A load client that ignores opcode 0x9
sheds its own load a third of a minute into every step, which reads as "the server
shed load" and is really "the harness was rude."

**4. Marginal, not average.** A room costs `(cpu(N) − cpu(0)) / N`. The empty
process is not free — a listener, a 60 Hz interval, a lag probe, ~5.9 ms/s — and
on a guest metered at 6.25% of a core that floor is 9% of the entire budget.
Billing it to the rooms would understate how many fit.

### Three traps, all of which produced a wrong number first

These are recorded because each one produced a plausible, confidently wrong
measurement before it was caught.

- **`loopLagMs` has a two-minute memory.** It is a p99 over 256 samples at 2 Hz
  (`server/heartbeat.ts`). That is right for an alarm — it catches rising load
  fast — and wrong for attributing a cost to *this* N, because it keeps the
  previous step's construction spike for ~128 s. The first run read **27.9 ms at
  two rooms** and "confirmed" a breach that was entirely the room-construction
  transient. The fix: median of the step's window, a settle before it, and a
  second longer window before a breach is believed.
- **A short CPU window measures the transient.** The same two rooms read **11.1%
  of a core** over a 6 s window after a 3 s settle, and **3.4%** over a 300 s
  window. Room construction (`createWorld` plus the opening `fullEntityState`
  broadcast) was inside the short one. Settle long, sample long.
- **A cold V8 outspends a loaded one.** The CI gate's first shape measured 4 rooms
  five seconds after boot (106 ms/s) and 12 rooms forty seconds later (101 ms/s) —
  a *negative* cost per room. That is not measurement noise, it is the JIT
  finishing. The gate now warms up under real load for 20 s before its first
  window, and differences two *loaded* points rather than subtracting an empty
  floor.

---

## §2 — Rooms vs loop lag, rooms vs CPU

Measured 2026-08-07. Target: the shipped bundle as a child process on
**Intel Core Ultra 9 285H**, 0.0152 ms per 8-station sim step. Ramp: start 4,
step 4, ceiling 40 · settle 20 s · sample 45 s per step. The safety line was
lifted for this run so the whole curve would be collected rather than stopping at
the first breach.

**Baseline (0 rooms):** p99 loop lag 0.89 ms · CPU 0.6% of a core · RSS 62.7 MB

| rooms | live | loop lag median (ms) | loop lag max (ms) | CPU (% of core) | CPU/room (ms/s) | RSS (MB) | snapshot B/s per client |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 4 | 1.00 | 1.03 | 5.5 | 12.30 | 96.5 | 4230 |
| 8 | 8 | 1.02 | 1.03 | 6.3 | 7.09 | 101.5 | 4225 |
| 12 | 12 | 3.29 | 4.02 | 8.3 | 6.44 | 104.0 | 4157 |
| 16 | 16 | 6.54 | 6.54 | 9.9 | 5.79 | 106.3 | 4112 |
| 20 | 20 | 6.50 | 6.54 | 11.7 | 5.57 | 106.1 | 4113 |
| 24 | 24 | 4.06 | 4.81 | 13.2 | 5.26 | 107.3 | 4050 |
| 28 | 28 | 6.84 | 20.09 | 14.8 | 5.09 | 108.8 | 4026 |
| 32 | 32 | 6.84 | 20.09 | 16.5 | 4.96 | 108.8 | 4029 |
| 36 | 36 | 10.61 | 10.61 | 17.6 | 4.72 | 110.5 | 4008 |
| 40 | 40 | 5.52 | 5.52 | 19.5 | 4.72 | 110.5 | 3991 |

**Reading it.**

- **CPU is linear and clean.** 0.6% → 19.5% across 0 → 40 rooms. The `CPU/room`
  column falls as N rises because the fixed floor is being amortised over more
  rooms; the asymptote — the number worth planning on — is **~4.7 ms/s per room**.
  The straight incremental across the widest span, `(19.5 − 5.5) / 36`, is
  **3.9 ms/s**. Everything below uses the conservative 4.7.
- **Loop lag is flat and noisy, and never the constraint here.** It wanders
  between 1 and 11 ms with occasional 20 ms spikes, and at 40 rooms it was 5.5 ms
  — *lower* than at 16. The spikes are the asteroid-wave metronome and the host's
  own scheduler, not saturation: at 40 rooms the process was using 19.5% of one
  core. **A full core does not run out of loop before it runs out of ramp.**
- **Memory is a non-issue.** 1.2 MB per room. Even the 256 MB guest would hold
  118 rooms on memory alone.
- **~4.0 KB/s per client, drifting *down* as rooms are added.** Not a throttle —
  the later rooms in the ramp were younger, and a young match has fewer
  projectiles in flight than a mature one. This is a **new measurement against the
  spike**, and it is the first one taken off a real socket in a real room rather
  than off a bench: `docs/netcode-spike.md` bills **15.8 KB/s** per client (its own
  bench reports 278–380 B live snapshots at 30 Hz, and a 494 B worst case at 8
  ships + 64 projectiles). Measured here, a live 8-seat room streams about **a
  quarter** of that. The worst case is real and the encoder is unchanged; the
  difference is how rarely a real match has that many projectiles in the air at
  once. Either way the conclusion is the same and it is not close: bandwidth was
  never the bottleneck, CPU is.

### The lag axis needs a quiet host

An earlier run on the same box measured **5.84 ms p99 on the completely empty
process** over a 300 s window. A p99 reports the worst few of 256 samples, and a
laptop under WSL2 supplies those spikes for free. When that happens the 10 ms
safety line is unreachable before a single room exists and the lag column is
measuring the host, so `capacity-ramp.ts` now detects it (`baselineExceedsLimit`)
and says so in its own report rather than emitting a confident, meaningless N. The
CPU axis has no such floor, which is why it carries the conclusion here and why
the CI gate is a CPU gate.

---

## §3 — The decision table: rooms per Machine, and what a room costs

Fly `iad` prices, read from <https://fly.io/docs/about/pricing> on **2026-08-07**.
Quotas: a shared size is metered at **n × 6.25% of a core sustained** — bursting
above that runs on credit, and a match is a twelve-minute sustained load, so burst
is margin, not capacity. A performance CPU is a dedicated core.

**Inputs:** 4.72 ms CPU/s per room · process floor 5.93 ms CPU/s · 1.2 MB per room
over a 63 MB floor · **core slowdown ×1** · **headroom 70%** of the sustained quota.

| guest (iad) | sustained quota | RAM | $/mo | rooms (CPU) | rooms (RAM) | **rooms** | bound by | $/room/mo |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| shared-cpu-1x | 6.25% of a core | 256 MB | $1.94 | 8 | 118 | **8** | cpu | $0.24 |
| **shared-cpu-1x** *(deployed today)* | 6.25% of a core | 512 MB | $3.19 | 8 | 290 | **8** | cpu | $0.40 |
| shared-cpu-1x | 6.25% of a core | 1024 MB | $5.70 | 8 | 633 | **8** | cpu | $0.71 |
| **shared-cpu-2x** *(one size up)* | 12.5% of a core | 512 MB | $3.89 | 17 | 290 | **17** | cpu | **$0.23** |
| shared-cpu-2x | 12.5% of a core | 1024 MB | $6.39 | 17 | 633 | **17** | cpu | $0.38 |
| shared-cpu-4x | 25% of a core | 1024 MB | $7.78 | 35 | 633 | **35** | cpu | $0.22 |
| shared-cpu-8x | 50% of a core | 2048 MB | $15.55 | 72 | 1318 | **72** | cpu | $0.22 |
| performance-1x | 100% of a core | 2048 MB | $31.00 | 147 | 1318 | **147** | cpu | $0.21 |

### What the table says

**1. Buying RAM is buying nothing.** A room is 1.2 MB. `shared-cpu-1x` at 1 GB
costs 79% more than at 256 MB and holds exactly the same 8 rooms — $0.71 a room
against $0.24. The fleet's current 512 MB is already more than three times what 8
rooms need. Every dollar of headroom should go to CPU.

**2. One size up is strictly better, and cheaper per room.** `shared-cpu-2x` at
512 MB is **$3.89** against the deployed `shared-cpu-1x` at 512 MB's **$3.19** —
22% more money for **2.1× the rooms**, so $0.23 a room against $0.40. There is no
trade here; the current size is simply the worst value on the board, because its
fixed process floor (5.9 ms/s) eats 9% of a 6.25% quota and only 5% of a 12.5% one.

**3. Above `shared-cpu-2x`, price per room is flat (~$0.22).** Fly charges shared
CPU close to linearly, so the choice between 2x, 4x and 8x is **not** a cost
decision. It is a blast-radius decision: one `shared-cpu-8x` Machine holding 72
rooms is 72 matches that end together when it dies, against six `shared-cpu-2x`
Machines that lose 17 each. The fleet already runs ≥2 always-on Machines for
exactly this reason (`docs/hosting-plan.md`, Task 11).

**4. `performance-1x` is not the value play it looks like.** $0.21 a room is the
cheapest cell, but only if all 147 rooms are full — $31/month buys nothing at a
classroom's occupancy, where a $3.89 Machine holding 17 is the honest size.

**The recommendation, for the developer to accept or reject:** move the fleet to
**`shared-cpu-2x` / 512 MB** and advertise **12** rooms per Machine. It doubles
real capacity, lowers cost per room, keeps two Machines and the blast radius small,
and costs the project **$1.40 a month**. This is a **deploy decision and it is not
made here** — `fly.gameserver.toml` still says `shared-cpu-1x`, and the advertised
capacity committed in §5 is the one that is honest for that size.

### Sensitivity: the core we have not measured

Every number above carries **core slowdown ×1** — it assumes a Fly shared vCPU's
underlying core is as fast, per clock, as an Intel Core Ultra 9 285H. It is
probably not. The whole table scales inversely:

| assumed slowdown | ms/s per room | rooms on `shared-cpu-1x` | rooms on `shared-cpu-2x` |
|---|---:|---:|---:|
| ×1 (measured core) | 4.7 | 8 | 17 |
| ×1.5 | 7.1 | 4 | 10 |
| ×2 | 9.4 | 3 | 7 |

This is the one number in this document that is **assumed rather than measured**,
and it is the reason §7 exists. Until the hosted run lands, the 25% margin on the
advertised capacity plus Fly's burst credit are what absorb it.

---

## §4 — What the old number got wrong

`DEFAULT_MAX_ROOMS = 32` was not invented; it was measured, by
`tests/harness/fleet-density.test.ts`, and its own comment states the method:
32 rooms of 8 Hard bots cost "~1.5 ms/tick on the i9 dev core (~9% of the 16.67 ms
budget)", and a "~5×-slower" guest would land "near ~45% of budget".

Two things were wrong with that, and the second is the one that matters.

- **It measured the sim, not the room.** 1.5 ms/tick for 32 rooms is 0.047 ms per
  room-tick — 2.8 ms/s per room. Over the real wire a room costs 4.7 ms/s: bot
  trees, snapshot encoding and socket writes at 30 Hz, static diffs at 10 Hz, the
  JSON control path and the latency probe are all real and none of them are in a
  bare `step()`. A 1.7× understatement, and the smaller of the two errors.
- **It compared against a whole core.** "45% of budget" is 45% of *one full core*.
  A `shared-cpu-1x` is metered at **6.25%** of one. 45% of a core is seven times
  the guest's entire sustained quota — the Machine would have been throttled long
  before the loop noticed, and every room on it together, which is exactly the
  failure mode the brief names.

Neither is a careless mistake; both are what happens when a number is measured
against the budget you can see (a frame) instead of the budget you are billed for
(a quota). It is corrected in §5 and the CI gate in §6 exists so it cannot drift
back.

---

## §5 — The advertised capacity, and where it lives

The allocator packs seat-weighted against whatever a Machine advertises
(`allocator/allocator.ts`), so the advertised number is a **promise**, not an
ambition. Margin comes off before it is published: **25%**, because the measured N
is where the loop *starts* to lose, taken on one machine with a synthetic pilot who
never opens a build wheel, and a fleet meets worse.

```
shared-cpu-1x, 6.25% of a core sustained
  quota                       62.5 ms CPU/s
  × 70% headroom              43.75 ms/s
  − process floor              5.93 ms/s
  ÷ 4.72 ms/s per room     =   8 rooms
  − 25% margin             =   6 rooms   ← advertised
```

Committed in two places, both of which now cite this document:

- **`server/match-server.ts` → `DEFAULT_MAX_ROOMS = 6`.** The fail-safe default:
  a Machine that is told nothing advertises what the guest the fleet actually
  deploys on can sustain. Under-advertising costs capacity; over-advertising costs
  every player on the Machine at once.
- **`fly.gameserver.toml` → `MAX_ROOMS = "6"`**, set explicitly so the number is
  visible at the deploy rather than inherited invisibly, and so raising the guest
  size is a two-line diff with the table above beside it.

**Anything not on `shared-cpu-1x` must set `MAX_ROOMS`.** The €4 Hetzner fallback
(`docs/hosting-plan.md`) has a real core or two and should be started with
`MAX_ROOMS=100` or thereabouts; the default is deliberately wrong for it, in the
safe direction.

No allocator change: it already packs seat-weighted against the advertised
capacity, which is why this is a number and not a code change.

---

## §6 — The CI-able subset

`tests/net/capacity/capacity-regression.test.ts`, ~65 s, in the ordinary
`npm test` run. It exists because a room that quietly gets twice as expensive
halves the fleet, and until now nothing would have noticed until players did.

It runs the **same** harness — real sockets, 1 human + 7 Hard bots — at two loaded
points (4 rooms, then 12) and asserts four things:

1. **The load is real.** It decodes snapshots off the wire and requires eight ships
   and projectiles in flight. A capacity measurement taken against rooms whose bots
   never woke would pass forever, getting *cheaper* as the bug got worse.
2. **Nothing dropped.** Every room still seated, still flying, still sending input.
3. **The loop stays inside the 33 ms tick budget** at twelve rooms.
4. **The marginal CPU per room, normalised to a bare sim step timed in the same
   process.** Absolute milliseconds are not portable across runners; the *ratio* is
   a property of the server's code. Budget: **12×**. Observed 1.7–5× depending on
   how wide the two sample points are — which is why the budget is coarse and the
   precise number comes from the full ramp, not from CI. It catches a doubling, not
   a 10% drift, and it is honest about that.

**On "dockerized".** The brief says a dockerized server. What Docker adds over this
is a namespace and a cgroup around `node server/dist/match-server.mjs` — and that
file, built by the command `server/Dockerfile` runs, is exactly what the test
spawns. Docker is not installed on every runner, so requiring it converts the gate
into a skip, which is strictly worse than measuring the same process one layer
down. The cgroup half — the actual quota — is not emulated locally either way, and
is measured on the real guest by §7.

---

## §7 — The hosted run: clone → measure → destroy

**Status: NOT RUN. Blocked on credentials, not on work.** This lane has egress to
fly.io (the price table above was fetched live) but no `flyctl` and no
`FLY_API_TOKEN`, so no Machine can be created or destroyed and no Grafana panel can
be screenshotted. The harness already takes a hosted target; what follows is a
runbook, not a plan.

**Never run this against `planet-rush-gameserver`.** It is the live fleet and it may
have players on it. The whole procedure is a throwaway clone.

```bash
# 0. Names that cannot be confused with production.
GS=planet-rush-gs-scratch
AL=planet-rush-alloc-scratch
SECRET=$(openssl rand -hex 32)

# 1. Clone the two configs, changing ONLY the app name and (for a size sweep) the
#    guest. Keep primary_region = "iad" so the price table applies.
sed "s/^app = .*/app = \"$GS\"/" fly.gameserver.toml > /tmp/fly.gs-scratch.toml
sed "s/^app = .*/app = \"$AL\"/" fly.allocator.toml  > /tmp/fly.al-scratch.toml
#    …and point the scratch gameserver at the scratch allocator:
sed -i "s|planet-rush-allocator.internal|$AL.internal|" /tmp/fly.gs-scratch.toml
#    …and lift the room ceiling so the ramp can push past the advertised one:
sed -i 's/^  MAX_ROOMS = .*/  MAX_ROOMS = "200"/' /tmp/fly.gs-scratch.toml

# 2. Create, share the secret (both sides fail closed on a mismatch), deploy the
#    control plane first.
fly apps create $GS && fly apps create $AL
fly secrets set --app $AL ALLOCATOR_SECRET=$SECRET
fly secrets set --app $GS TICKET_SECRET=$SECRET
fly deploy --config /tmp/fly.al-scratch.toml --app $AL
fly deploy --config /tmp/fly.gs-scratch.toml --app $GS

# 3. ONE Machine. The ramp measures a Machine, not a fleet; two would halve the
#    load each one sees and the curve would be a lie by a factor of two.
fly scale count 1 --app $GS
fly machine list --app $GS          # confirm exactly one, and note its id

# 4. Ramp it, through the allocator — the door a player uses.
npx vite-node tests/net/capacity/ramp-cli.ts -- \
  --allocator https://$AL.fly.dev \
  --health    https://$GS.fly.dev/health \
  --start 2 --step 2 --max 40 \
  --settle 140000 --sample 30000 --confirm 60000 --limit 10 \
  --out docs/runs/shared-cpu-1x.md

# 5. Repeat one size up. `fly scale vm` and re-ramp; nothing else changes.
fly scale vm shared-cpu-2x --memory 512 --app $GS
npx vite-node tests/net/capacity/ramp-cli.ts -- \
  --allocator https://$AL.fly.dev --health https://$GS.fly.dev/health \
  --start 2 --step 2 --max 60 --settle 140000 --sample 30000 --limit 10 \
  --out docs/runs/shared-cpu-2x.md

# 6. Grafana, for the rooms-vs-CPU screenshots the brief asks for:
#    fly.io/apps/$GS/metrics → CPU + memory, window = the ramp's wall clock.
#    Save into evidence/m11-01/.

# 7. DESTROY. Both apps. This is not optional and it is not "later".
fly apps destroy $GS --yes
fly apps destroy $AL --yes
fly apps list | grep scratch        # must be empty
```

**Why `--settle 140000` on the hosted run and 20 s locally.** On a quiet Machine
the lag axis becomes usable, and the brief's gate is stated on it ("`loopLagMs`
crosses 10 ms sustained"). `loopLagMs` is a p99 over a 128 s window, so a step's
readings only describe *that* step once the previous step's construction spike has
aged out of the window — 140 s. That makes a 20-step ramp about an hour per guest
size. That is the price of the word "sustained".

**What the hosted run is expected to change.** The CPU-per-room figure, by the
core-slowdown factor in §3 — and therefore the advertised capacity, most likely
downward, from 6 toward 3–4 on `shared-cpu-1x`. Nothing else in this document
should move: the linearity, the memory irrelevance, the ~4 KB/s per client and the
"quota binds before the loop does" conclusion are all properties of the software,
not of the host.

---

## Changelog

- **2026-08-07** — First measurement. Harness built, local curve to 40 rooms taken,
  advertised capacity corrected 32 → 6, CI gate added, hosted runbook written and
  blocked on a Fly token.
