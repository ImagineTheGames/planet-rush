# Hosting plan — Planet Rush online (Fly.io)

**Owner:** Netcode Engineer · **GDD:** §4.2, risk 1 (portability) ·
**Spike:** `docs/netcode-spike.md` · **Status:** deployed topology ratified
(Task 11); spike measurements against the real host in progress (Task 12).

This document is the *deploy-shaped* companion to the netcode spike. The spike
decides the protocol (60 Hz sim / 30 Hz snapshot / ~510 B) and the workload
numbers; this one decides **where that process runs in public** and how it is
rolled, and it records why the host moved from the day-0 choice. Every claim here
is grounded in a committed file — `fly.gameserver.toml`, `fly.allocator.toml`,
`.github/workflows/deploy-server.yml`, `server/README.md`, `allocator/` — not in a
plan that could drift from them.

The hard requirement underneath everything (GDD §4.2, risk 1) is unchanged and
non-negotiable: **the server is a plain Dockerized Node process with zero
vendor-specific APIs**, so it redeploys elsewhere in an afternoon. Nothing below
weakens that; the Fly-ness lives entirely in environment variables and a router
switch, never in an import.

---

## §1 — Why Fly.io, and why not the day-0 host

The day-0 spike optimised for **zero-cost classroom scale** and chose a single
Oracle Always-Free VM (`docs/netcode-spike.md` → Host candidates). That analysis
was correct for the question it answered: one always-on server, no cost, no lock.
The **question then changed** — from one server to a public, multi-region-capable
**fleet with a control plane** (M9): an allocator that places rooms and signs
routing tickets, several match Machines, heartbeats, cordon-and-drain lifecycle,
and a reconnect room-liveness probe.

A single bare VM does not *have* the primitives a fleet needs, so on Oracle we
would have had to build them by hand. Fly already implements them:

| Fleet need | Fly | A bare VM (Oracle / Hetzner) |
|---|---|---|
| `wss://` for browser clients | anycast edge terminates TLS at the app hostname, free (`force_https`) | run caddy/traefik + obtain and rotate a certificate |
| Per-Machine identity a ticket routes to | `FLY_MACHINE_ID` / `FLY_REGION`, injected | hand-assign `MACHINE_ID` / `REGION` per host |
| Private allocator↔Machine link | 6PN private DNS (`*.internal`) | stand up and secure an overlay network |
| Route a client to its Machine | `fly-replay` from the allocator edge (`ALLOCATOR_ROUTER=fly`, `allocator/router.ts`) | per-Machine public URLs + our own routing |
| Machine lifecycle for the controller | a Machines API (`allocator/provider-fly.ts`) | script a VM API by hand |

**The portability contract is intact.** No file under `server/` or `allocator/`
imports a Fly SDK. `server/heartbeat.ts` reads `MACHINE_ID ?? FLY_MACHINE_ID`, and
the router's Fly-vs-direct behaviour is the `ALLOCATOR_ROUTER` env var — so the
**identical image** runs on the standing **€4 Hetzner fallback**, which supplies
the same values explicitly. Fly is the host that fits the fleet shape today; it is
not a dependency the code cannot leave. Cloudflare Durable Objects stays rejected
for the day-0 reason: it cannot ship as a plain Node process.

This supersession is also recorded, with the same framing, in
`docs/netcode-spike.md` → *Status since (hosting, 2026-07-25)*, and in
`server/README.md` → *Deploying to Fly.io*. It is a **scope change, not a
correction**: the scope grew from server to fleet, and the host followed it.

---

## Task 11 — the deployed topology

Two apps, one region (`iad`), both built from this repo's root:

| App | Config | Shape | Role |
|---|---|---|---|
| `planet-rush-gameserver` | `fly.gameserver.toml` | ≥2 Machines, always-on, autostop **off** | the authoritative match fleet |
| `planet-rush-allocator` | `fly.allocator.toml` | **exactly 1** Machine, never sleeps | the control plane that places rooms |

**Why two always-on match Machines, autostop off.** A single Machine makes the
whole game a single point of failure; Fly's autostop would evict a Machine
mid-match, and two systems starting Machines is worse than one — so the **fleet
controller** owns Machine lifecycle (cordon → drain → remove), not Fly autoscale.
The always-on floor is established by deploying two Machines
(`fly scale count 2`); `min_machines_running = 2` records the intent and only
binds the day autostop is ever turned on.

**Why exactly one allocator.** Its room registry is in-memory
(`InMemoryRoomRegistry`), so a second allocator would hold a *different* view of
the fleet and split heartbeats and reservations. Single instance, min = max = 1.
It is out of the gameplay path: once a client holds its ticket and socket, the
allocator can redeploy or vanish and every live match carries on — but a
*sleeping* allocator is a lobby that cannot open a room, so it never sleeps.

**The one shared secret, fail-closed.** The allocator signs each ticket with
`ALLOCATOR_SECRET`; each match server verifies it with `TICKET_SECRET`. They must
be the **same value** (set once per app via `fly secrets set`, provisioned on
first deploy by `.github/workflows/deploy-server.yml`). Both sides fail closed, so
a mismatch refuses every join with no other symptom. Enforcement is switched on
purely by the secret's *presence* (`server/match-server.ts`): unset, the same
binary is a plain single/self-hosted server with no ceremony.

**Deploy and redeploy.** The full runbook is `server/README.md` → *Deploying to
Fly.io*; the shape:

- **First deploy** — create both apps, provision the shared secret, deploy the
  allocator first (control plane), then the gameserver, then `fly scale count 2`.
- **Redeploy a fleet holding live matches** — **never hard-restart.** Cordon each
  Machine (`POST /drain` → it advertises zero capacity and takes no new rooms),
  wait for its `/health` to report `rooms: 0`, then roll. `[deploy] strategy =
  "rolling"` replaces Machines one at a time; the drain step keeps a replacement
  from landing on players mid-match. `/health` returns 200 even while draining, so
  Fly's own liveness check does not cull a Machine finishing its matches.
- **CI** — `.github/workflows/deploy-server.yml` builds and rolls on changes under
  `server/**`, `allocator/**`, `src/net/**`, `src/shared/**`, or the fly configs.

**Autoscale is shipped OFF.** The two always-on Machines carry the first deploy;
arming the controller's autoscale loop is a config change, not a code change
(`FLEET_AUTOSCALE`, `FLEET_IMAGE`, and `FLY_API_TOKEN` to select the real Fly
provider over the in-memory fake — see `fly.allocator.toml`).

---

## Task 12 — the measurements the spike still owed

Task 11 stood the fleet up; there is now a **real link** to measure against, which
closes (or honestly leaves open) the items the day-0 spike deferred because it had
only a loopback. All of it is recorded in `docs/netcode-spike.md` → *Status since
(hosting, 2026-07-25)*; the summary, with status:

| Item | Status | Where |
|---|---|---|
| Tick headroom against the **real** sim + server-side bot AI + fan-out | **CLOSED** — measured | `tests/harness/fleet-density.test.ts`; spike §1 |
| Room density → `DEFAULT_MAX_ROOMS` | **REOPENED and RE-CLOSED 2026-08-07; 32 → 6** — the first measurement gated the fleet against a whole core's frame, not the guest's 6.25% quota, and measured the sim rather than the wire | **`docs/server-capacity.md`**; `tests/net/capacity/`; `server/match-server.ts` |
| Sustained CPU gate (20 min, real guest, `loopLagMs`) | **INSTRUMENTED, OPEN** — `/health` reports `loopLagMs`; the 20-min live run is owed | `server/index.ts`; spike §3 |
| TCP head-of-line under real loss (risk 3) | **OPEN** — stack is end-to-end; needs a lossy link | spike §4 |
| Reconnect-resume, ship + cargo | **DONE in-process**, live pass owed | `tests/net/reconnect-resume.test.ts`; spike §5 |
| Client server-URL config | **DONE** | `src/net/server-url.ts`; spike §6 |

The two measured results in one line each:

- **Room cost is ~0.043 ms/tick for eight Hard bots** (the worst case — bot AI
  runs server-side and costs more than a human's input). At the then-ceiling of
  **32 rooms** the fleet is ~1.4 ms/tick (~8% of the 16.67 ms budget) on the dev
  core, ~42% extrapolated to a ~5×-slower shared core.

  > **SUPERSEDED 2026-08-07 — `docs/server-capacity.md`.** That paragraph compares
  > against **one whole core's frame**; a `shared-cpu-1x` is metered at **6.25% of
  > a core sustained**, so ~42% of a core is ~7× the quota the Machine is billed
  > for. Measured over the real wire a room costs **4.7 ms of CPU per second**
  > (the sim-only figure misses fan-out, encode and the control path by 1.7×), so
  > **8 rooms fit that guest and 6 is advertised** — `MAX_ROOMS` in
  > `fly.gameserver.toml`, `DEFAULT_MAX_ROOMS` in `server/match-server.ts`.
  > Memory never binds (a room is ~1.2 MB), and going one guest size up is 22%
  > more money for 2.1× the rooms — a table, and the developer's call.

- **The load signal is on the front door.** `/health` now reports `loopLagMs`
  (p99 event-loop lag). The gate: one 8-player match for a **full 20 minutes**
  against the deployed Machine, polling `/health`; a breach of **~8 ms** means the
  shared core has spent its burst credit and the app moves to a **performance CPU
  size** — affordable at one region and the trade this guest sizing anticipates.
  The duration *is* the test; a short run passes on burst credit and proves
  nothing.

---

## Task 13 — the socket-hop machine-pin, and the two flags that arm it

A fleet of ≥2 match Machines behind one anycast hostname needs a client's
WebSocket to reach the *specific* Machine hosting its room. The allocator can't
put that routing on the allocate response — a `fly-replay` header on the `POST
/rooms` JSON makes the edge replay the *POST*, so the client never receives its
`{room, ticket}`. So the pin moved to the **socket hop**: the client dials the
shared `connectUrl` (`wss://planet-rush-gameserver.fly.dev/play`) with its signed
ticket on the URL (`?ticket=`), the edge lands the upgrade on *some* Machine, and
a Machine that is not the ticket's host answers the upgrade with `fly-replay
instance=<host>` **before** the 101, so the edge re-delivers it to the host
(`server/upgrade-router.ts`, `server/ws.ts`; proven over a real socket in
`tests/server/upgrade-replay.test.ts`).

**The pin has two halves, one per app, and they are useless apart:**

| Half | App | Flag | Effect if unset |
|---|---|---|---|
| Allocator emits the shared `connectUrl` | `planet-rush-allocator` | `ALLOCATOR_ROUTER = "fly"` | client gets a direct per-Machine URL (wrong on Fly) |
| Gameserver arms the upgrade guard | `planet-rush-gameserver` | `MATCH_ROUTER = "fly"` | **the guard is never built — every wrong-Machine upgrade completes locally → `joinError: bad-ticket`** |

**The lottery bug (M10).** The allocator half was armed; the gameserver half was
not — `fly.gameserver.toml` never set `MATCH_ROUTER`, so `armReplayGuard`
(`server/upgrade-router.ts`) returned `undefined` and the pin code shipped **dead**.
Behind a 2-Machine fleet that is a coin flip: the upgrade lands on the room's host
→ welcome; it lands on the other Machine → `bad-ticket`, surfacing to the player as
a stuck "connecting" screen. The repo's own probe against the **live** fleet caught
it exactly — `node tests/net/wire-probe.mjs https://planet-rush-allocator.fly.dev 6`
returned **4/6 welcome, 2/6 `bad-ticket`**, each failure a room allocated to one
Machine whose upgrade the edge dropped on the other.

**The fix** is the missing flag: `fly.gameserver.toml` now sets `MATCH_ROUTER =
"fly"`, and `tests/server/fleet-config.test.ts` asserts **both** halves stay armed
so this asymmetry cannot silently return. Off Fly (the €4 Hetzner fallback, solo,
every direct-dial test) neither flag is set and every upgrade completes locally,
exactly as before — the portability contract is untouched (no Fly SDK; the flags
are plain env vars a VPS omits). It takes effect on the next gameserver **redeploy**
(`deploy-server.yml` rolls on `fly.gameserver.toml` changes); re-run the probe
against the live fleet after the roll to confirm **6/6**.

**Client honesty (M10).** A refused join is now *terminal*, not a drop:
`WebSocketTransport` surfaces `joinError` as `closeReason = 'join-rejected'` with
the server's `rejectReason` and stops — rather than redialling the same ticket into
the same lottery for the whole grace window and leaving a spinner that never
resolves (`src/net/websocket-transport.ts`). The menu's RETRY (a *fresh* allocate,
one per tap) / BACK affordance on that state is a UI-lane follow-up.

---

## Task 14 — the pin was never live: a build-context bug wearing a netcode costume

Task 13 shipped the socket-hop pin and the `MATCH_ROUTER = "fly"` flag that arms
it, and both are still exactly right in the repository. The join lottery came back
anyway — the Director's live probe answered `{"type":"joinError","reason":"bad-ticket"}`
on 1 join in 3. The cause was not in the netcode at all:

**`server/upgrade-router.ts` imports `../allocator/router`, and `server/Dockerfile`
never copied `allocator/`.** From the commit that introduced the pin, the gameserver
image failed at its own `RUN npx tsc --noEmit`:

```
server/upgrade-router.ts(29,33): error TS2307:
  Cannot find module '../allocator/router' or its corresponding type declarations.
```

So **every `flyctl deploy --config fly.gameserver.toml` since has failed.** The
allocator app kept deploying — its Dockerfile does copy what it needs — which left
the fleet in a half-updated state that looks exactly like the Task 13 bug and is a
different bug entirely:

| Half | State on the live fleet | Consequence |
|---|---|---|
| Allocator | current, `ALLOCATOR_ROUTER = "fly"` | hands out the shared `connectUrl` |
| Gameserver | **pre-pin image**, `MATCH_ROUTER` never applied | no upgrade guard → the coin flip stands |

`MATCH_ROUTER` is set in `fly.gameserver.toml`, and an env change only reaches a
Machine through a deploy — so the flag that Task 13 added has never run on a
Machine either. The pin has been correct in the repo and absent from production
the whole time, which is why every unit test stayed green: they all ran against
sources that were present on disk.

**Fixed:** `server/Dockerfile` now `COPY allocator ./allocator` (build-time only —
the runtime stage still ships one bundled file). **Guarded:**
`tests/server/docker-context.test.ts` reads the Dockerfiles and the sources
together and fails if any directory a build stage imports from is not a directory
that stage copies. It is the same class of guard as `tests/server/fleet-config.test.ts`:
two files that must agree, with nothing but a live deploy to notice when they stop.

**The lesson for this document.** Twice now the pin has been right and production
has been wrong, and both times the only instrument that could see it was a probe
someone ran by hand. So the probe has a CI home now: `tests/net/live-pin.probe.mjs
--local` stands up a two-Machine fleet behind a Fly-shaped edge
(`tests/net/local-fleet.ts`, `tests/net/fly-edge.ts`), aims half the rounds at the
**wrong** Machine on purpose, and fails the build unless every round welcomed *and*
at least one round actually exercised the pin — because a green run that never took
the wrong hop proves nothing, which is how this went unnoticed. The deterministic
form of the same check is `tests/net/live-pin.test.ts`, on every `npm test`, and it
includes a test that *reproduces* `bad-ticket` with the pin disarmed, so the harness
is shown catching the bug before it is trusted to report a pass.

Against the live fleet the manual form is unchanged and still the last word:

```
node tests/net/live-pin.probe.mjs https://planet-rush-allocator.fly.dev 6
```

Run it after the next gameserver deploy actually goes green — that deploy is the
thing that has been missing, and until it rolls, the fleet is still pre-pin.

---

## Task 15 — region placement is a guarantee, not luck

**Ratified by the developer:** *"we shouldn't have that."* The fleet has run
`iad ×2 + gru ×1` since 2026-07-30, and `Allocator.pickMachine` has preferred a
requested region since Task 5 — but a creator in Minas Gerais still landed in
Virginia every single time. Two causes, both of them the same shape (*nobody
stated where the creator was*):

1. **The client stated the wrong thing.** `src/main.ts` held
   `onlineRegions = [{ id: 'iad', label: 'US East' }]` — one entry, picker
   suppressed by `regionPickerVisible` — and sent `onlineRegions[0].id` on every
   `POST /rooms`. A hard-coded `iad` is not a preference; it is a pin, and it
   outranked everything below.
2. **Nothing else stated anything.** Remove the pin and the allocator has no
   region at all, so it spreads across the whole fleet and the tie-break
   (least-loaded, then machine id) sends the same creator to the same Virginia
   box — the coin flip the developer described.

### The policy, as shipped

| Input | Wins when | Reason returned |
|---|---|---|
| Request body `region` | The client named one (a real picker) | `preferred` / `region-full` / `region-absent` |
| `Fly-Region` header | The body named none | as above |
| `Fly-Request-Id` suffix | Neither of the above is readable | as above |
| nothing | Off Fly, or a bare caller | `no-preference` |

**Capacity semantics are unchanged and deliberately so:** the creator's region
wins *whenever it has a free slot*, and a full one falls back across the whole
fleet rather than refusing. A placed match beats a refused one.

### The header, verified live (not assumed)

The brief required the header name be confirmed against Fly rather than guessed.
Read from Fly's own header echo on 2026-07-31, from the developer's network:

```
$ curl -s https://debug.fly.dev/
Fly-Request-Id: 01KYTQS8FBEA8JW7GYH7KQYPGE-gru
Fly-Region: gru
Fly-Client-Ip: 201.77.129.150
```

So `fly-region` is the header, and the request id's trailing `-gru` is the same
fact by a second route — kept as a fallback so a future rename degrades to an odd
parse instead of silently re-pinning every creator to Virginia.
`allocator/edge-region.ts` accepts only three lowercase letters, so a hostile
header cannot reach a log line or a `/machines` reply.

**A forged header buys nothing.** The region is a preference: it can only ask for
a region the fleet already has, and a full one falls back anyway. It has exactly
the power the body's `region` field has had since Task 5, and that is
client-supplied too.

### Explainable, on both sides of the wire

Every allocate now answers with *why*:

```json
"placement": { "requested": "gru", "region": "gru",
               "reason": "preferred", "detail": "gru — your region" }
```

- the allocator writes the same line to its own log
  (`room H3HX → d891dd0a1443e8 (gru — your region)`), which is where `fly logs`
  answers "why did that creator get Virginia?";
- the client copies `detail` into the **session log** (`connect`/`ticket` step),
  so a downloaded DOWNLOAD LOG file carries the machine id *and* the reason.

A `join` carries no placement and logs none: it goes where the room already is,
and there is nothing to explain.

---

## Task 16 — an unserved POP is a place, not a shrug

**Found by a0-29 and flagged rather than fixed** (docs/region-picker.md §8): the
region *ping* was inverted by concurrency, and while proving that, the lab found
the other half. Task 15 taught the allocator to read the edge POP; it did not
teach it what to do with a POP the fleet runs nothing in.

From Florida the anycast POP is `dfw`. The fleet is `iad ×2 + gru ×1`. So
`pickMachine` returned `region-absent` and put **the whole fleet** in one pool,
where placement fell through to load and then — hosts being idle — to a `<` on
the machine id. A US creator could land in São Paulo on a string comparison.

### Before: measured live, not argued

Three consecutive `POST /rooms` against `planet-rush-allocator.fly.dev` from this
lane's machine (Davenport, Florida — Charter/Spectrum; the POP was `dfw`, per
`fly-request-id: 01KZSDYDMAAWGP3E0ZER0NNXB7-dfw`), with **no body at all**, which
is exactly what the client sends when the region survey measures nothing:

| # | region | machine | `placement.detail` |
|---|---|---|---|
| 1 | `iad` | `0800d5b6d62328` | `iad — no dfw machines` |
| 2 | `iad` | `6836293b5161d8` | `iad — no dfw machines` |
| 3 | **`gru`** | `d891dd0a1443e8` | `gru — no dfw machines` |

`/regions` at the same moment: **`iad` 2 machines / 12 free**, `gru` 1 / 6 free.
So the third room crossed the equator with twelve free slots in Virginia — the
first two reservations weighted the two `iad` hosts to 1 each, `gru` was still 0,
and the flat pool did the rest. Requests 1 and 2 stayed in Virginia only because
`0800…` and `6836…` sort ahead of `d891…`; a `gru` Machine whose id began with a
`0` would have taken the very first room.

### After: the fallback is ranked by distance

`allocator/region-geo.ts` holds the coordinates, `Allocator.pickMachine` applies
them. The stated region still wins outright whenever it has a slot; when it
cannot take the room, the fallback walks the **regions that still have a slot**,
nearest first. `dfw` → `iad` at 1,882 km, against 8,244 km to `gru`.

**Crossing a continent is a capacity decision, never a default.** `gru` is still
reachable from `dfw` — when `iad` has no slot left, a placed match beats a
refused one, exactly as before.

**The reasons did not change.** `region-absent` is still `region-absent`
(we genuinely run nothing in Dallas) and still reads differently from
`region-full`: one says *create that region*, the other says *scale it*. What
changed is where the room goes, not what the allocator calls it.

### Coordinates, not a POP→region table

A static `dfw → iad` table is smaller and auditable, and it was the first answer.
Rejected for two reasons a table cannot fix:

1. **Every row silently encodes today's fleet.** Add `cdg` and every European row
   is wrong, with nothing in the file saying which.
2. **A table has one answer per POP, not a ranking** — so it cannot answer
   placement's second question: *`iad` is full, which region is next-nearest?*

Coordinates encode only facts about the world, which do not change when the fleet
does; the nearest region is derived per request against whichever regions are
live *and have capacity*. One table to maintain (where places are), not one per
fleet shape. It also gets answers a hand-written table would likely have got
wrong: on this two-region fleet `jnb` and `syd` resolve to `gru`, not `iad`
(Johannesburg is 7,439 km from São Paulo against 13,094 km to Ashburn).

### What the table covers, and what an unknown POP inherits

**Covered: all 35 regions Fly publishes as of 2026-08** — `ams arn atl bog bom
bos cdg den dfw ewr eze fra gdl gig gru hkg iad jnb lax lhr mad mia nrt ord otp
phx qro scl sea sin sjc syd waw yul yyz` — each keyed by the IATA code it is
named for and carrying that airport's coordinates, so every row is checkable
against a public source. Fly's POP codes and region codes are one namespace,
which is why one table serves both sides: the `from` is an edge POP (possibly one
we run nothing in), the candidates are the regions the fleet is actually in.

**An unknown code answers `undefined`, and that is deliberate.** No guess, no
nearest-by-alphabet, no silent default. `pickMachine` then does exactly what it
did before this task existed: whole-fleet spread, still reported as
`region-absent`. Likewise a *fleet* region with no row can still take a room —
it just never wins on the grounds of being close.

**So: adding a region to the fleet means adding its row to
`allocator/region-geo.ts`.** The cost of forgetting is a fallback to the old
behaviour, not a wrong continent.

### The tie-break no longer has a name in it

`leastLoaded` ranked hosts by load and then by `machine.id <`. That comparison is
what made the flat pool a coin flip, so it is gone. In order now:

1. **lower load** (full-room-equivalents — the spread rule);
2. **more free capacity** — same load, bigger host: the one with the most
   headroom left once this room lands;
3. **fresher heartbeat** — among equals, the host least likely to be a view about
   to lapse;
4. **incumbency** — the host the fleet learned about first keeps it. Pool order is
   heartbeat-arrival order, which is deterministic for a seeded test without
   comparing one character of anybody's id.

By rule 4 the two candidates are in the same region and identical on every fact
the registry holds, so there is no decision left to make.

### Out of scope, deliberately

- **a0-29's serial probe and the client picker** — the *measurement* was fixed
  there; this is the server's *choice*, and it only governs the case where the
  client sent nothing.
- **A stated region still wins.** The body's `region` is read before the edge
  header (`allocator/index.ts`), and a stated region reaching `pickMachine` is
  `preferred` before any of this runs.

---

## Still open (kept, not closed)

The spike's discipline: state what remains open rather than quietly closing it.
The live-host items are owed, not assumed —

- the **20-minute sustained-CPU** run against the real guest (`loopLagMs`);
- **TCP head-of-line** measured over a genuinely lossy link (risk 3);
- the **reconnect-resume** guarantee verified against a deployed `wss://` Machine;
- the **5× target-core factor** feeding `DEFAULT_MAX_ROOMS = 32` replaced by a
  measurement of the real guest (which also reconciles the `fly.gameserver.toml`
  "≤64 rooms" guest comment up or down).

The instruments and the procedures for each are shipped; the numbers wait on a
live run this repo's CI cannot stand up.
