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
| Room density → `DEFAULT_MAX_ROOMS` | **CLOSED** — measured; 64 → **32** | `tests/harness/fleet-density.test.ts`; `server/match-server.ts` |
| Sustained CPU gate (20 min, real guest, `loopLagMs`) | **INSTRUMENTED, OPEN** — `/health` reports `loopLagMs`; the 20-min live run is owed | `server/index.ts`; spike §3 |
| TCP head-of-line under real loss (risk 3) | **OPEN** — stack is end-to-end; needs a lossy link | spike §4 |
| Reconnect-resume, ship + cargo | **DONE in-process**, live pass owed | `tests/net/reconnect-resume.test.ts`; spike §5 |
| Client server-URL config | **DONE** | `src/net/server-url.ts`; spike §6 |

The two measured results in one line each:

- **Room cost is ~0.043 ms/tick for eight Hard bots** (the worst case — bot AI
  runs server-side and costs more than a human's input). At the new ceiling of
  **32 rooms** the fleet is ~1.4 ms/tick (~8% of the 16.67 ms budget) on the dev
  core; extrapolated to the ~5×-slower shared-cpu-1x Fly guest that is ~42% of
  budget — real headroom for a *hard* ceiling. 64 rooms landed near ~88% at the
  same extrapolation: too close to saturation to be a ceiling. The `loopLagMs`
  gate (below) is what reconciles the 5× *estimate* with the real guest and can
  raise the ceiling on a performance CPU.

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
