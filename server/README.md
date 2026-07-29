# The Planet Rush match server

**Owner:** Netcode Engineer · **GDD:** §4.2 (multiplayer), §4.1 (headless sim),
risk 1 (portability) · **Spike:** `docs/netcode-spike.md`

A small authoritative Node server. Clients send input ticks, this runs the one
true simulation and broadcasts state, clients interpolate. Bots fill empty slots
here rather than on anyone's client, so a three-human classroom match is still an
eight-planet war.

**It never imports PixiJS.** No GPU, no canvas, no window (GDD §4.1) — it
imports `src/sim/`, `src/bots/` and `src/net/`, and nothing else.

## Run it

```bash
# from the repository root
npx vite build --config server/vite.server.config.ts   # → server/dist/match-server.mjs
node server/dist/match-server.mjs                      # → ws://localhost:8080

# or as the container it deploys as
docker build -f server/Dockerfile -t planet-rush-server .
docker run --rm -p 8080:8080 planet-rush-server
curl localhost:8080/health
```

A two-player match against a server started exactly this way is what
`tests/net/online-2p.test.ts` runs on every CI push — real TCP, real handshake,
two predicting clients — so "it works locally" is a test result rather than a
memory.

## Deploying to Fly.io

The public host is Fly.io, one region — the day-0 spike (`docs/netcode-spike.md`)
optimised for zero-cost classroom scale and chose Oracle's free tier; the scope
then changed to public multiplayer, and Fly won on giving `wss://` for free at
its anycast edge with no certificate plumbing (`docs/hosting-plan.md` §1). The
image is unchanged — still the plain Node container above — so the portability
contract holds: this redeploys to a VPS in an afternoon.

Two apps, both in this repo's root:

| App | Config | What it is |
|---|---|---|
| `planet-rush-gameserver` | `fly.gameserver.toml` | The authoritative match fleet — two always-on Machines, autostop OFF (the fleet controller owns their lifecycle). |
| `planet-rush-allocator` | `fly.allocator.toml` | The always-on control plane — one Machine, never sleeps, places rooms. |

**The one shared secret.** The allocator signs each ticket with `ALLOCATOR_SECRET`;
this server verifies it with `TICKET_SECRET`. They must be the *same value*. Both
apps fail closed, so a mismatch refuses every join with no other symptom. The same
secret also authenticates this server's **fleet-membership** calls (`/register`,
`/fleet/heartbeat`, `/deregister`): each carries an `X-Fleet-Auth` HMAC over its
body (`src/net/fleet-auth.ts`), so a stranger cannot register a phantom Machine or
forge a heartbeat that hijacks a room code's routing. A gameserver with an
`ALLOCATOR_URL` but no `TICKET_SECRET` cannot sign, so it refuses to join the fleet
rather than beat requests the allocator would only 401.

**Fleet membership (M10).** A gameserver with `ALLOCATOR_URL` set joins the fleet
on boot: it `POST`s `/register` to the allocator (authenticated, retried while the
allocator is still coming up), then heartbeats its rooms and load every 5 s, then
`POST`s `/deregister` as it exits so the allocator forgets it at once instead of
waiting out its ~15 s liveness window. `GET /machines` on the allocator lists the
registered fleet — the operator's (and the deploy pipeline's) answer to "did the
Machines actually register?", the check the M10 live probe was missing. The drain
contract above still holds: a Machine cordons and empties its rooms *before* it
exits, so deregistering strands no live match.

```bash
# First deploy (from the repo root; FLY_API_TOKEN is in Actions secrets)
fly apps create planet-rush-gameserver
fly apps create planet-rush-allocator

SECRET=$(openssl rand -hex 32)                       # one value, both apps
fly secrets set --app planet-rush-gameserver TICKET_SECRET="$SECRET"
fly secrets set --app planet-rush-allocator ALLOCATOR_SECRET="$SECRET"

fly deploy --config fly.allocator.toml               # control plane first
fly deploy --config fly.gameserver.toml
fly scale count 2 --app planet-rush-gameserver       # the always-on floor
```

**Redeploying the match fleet — never hard-restart a Machine holding live
matches.** Cordon and drain each Machine first, so it stops taking new rooms and
its running matches finish, *then* roll:

```bash
# For each running Machine (fly machines list --app planet-rush-gameserver):
fly ssh console --app planet-rush-gameserver --machine <id> \
  -C "node -e \"fetch('http://127.0.0.1:8080/drain',{method:'POST'})\""
# …wait for its /health to report rooms: 0, then:
fly deploy --config fly.gameserver.toml              # strategy = rolling
```

The `[deploy] strategy = "rolling"` in `fly.gameserver.toml` replaces Machines one
at a time rather than all at once; the drain step is what keeps a replacement from
landing on players mid-match. The allocator carries no match state, so it
redeploys with a plain `fly deploy --config fly.allocator.toml`.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `MATCH_SEED` | random at boot | Fixes the seed, so a whole run is reproducible |

## The files

| File | What it is |
|---|---|
| `match-server.ts` | Rooms, codes, and connections. The registry and the front door. |
| `room.ts` | One room: the lobby, the fixed-timestep clock, snapshots, bots, and the reconnect-grace state machine. |
| `static-events.ts` | The half of the world that does not stream — and the fog rule that decides who is told a planet's health. |
| `ws.ts` | RFC 6455 in plain Node: handshake, framing, ping/pong. No dependencies. |
| `index.ts` | The process: HTTP listener, the 60 Hz loop, signals. Everything ambient lives here. |
| `vite.server.config.ts` | Bundles the above into one plain ESM file for the container. |
| `Dockerfile` | `node` + that one file. Nothing else. |

## Three properties worth knowing before changing anything

**Nothing ambient below `index.ts`.** No `Date.now()`, no `setInterval`, no
`Math.random()`, no socket implementation. The clock arrives as an argument to
`update()`, sockets arrive as a two-method `ServerSocket`, randomness arrives as
an injected seed. That is what makes this a plain portable Node process — and
why the tests can watch a sixty-second reconnect window pass in a microsecond
(`tests/server/`).

**The connection says who you are, never the message.** A client cannot name its
own slot. Everything inbound is validated by `src/net/wire.ts` before it reaches
a room: bounded action lists, finite-only vectors, no field defaulted into
something meaningful.

**Fog is enforced on the wire, not in the HUD.** Enemy planet health is scouted,
not broadcast (GDD §2.2), so the server sends a rival's core HP only to a client
whose ship is inside sensor range of it. A client that is never sent a number
cannot draw it, leak it, or free-ride on someone else's siege.

**The ack names input that has been run.** `ackSeq` on a snapshot is the newest
input from that client the *world has simulated*, not the newest the server has
received — the seq rides through `InputQueue` to the tick that consumes it. A
predicting client replays everything past the ack (`src/net/prediction.ts`), so
an ack issued on arrival would make it discard a press whose effect has not
happened yet, and the ship would stutter backwards on every correction.

## Still open

- **TCP head-of-line blocking under real loss** (risk 3). The spike argued it
  down on frame size; measuring it needs a lossy network and a full room.
- **A binary input encoding.** Input is JSON today, which the spike's numbers say
  is affordable (upstream is never the bottleneck). Worth doing, not urgent.
- **A root `.dockerignore`.** The build context is the repository, so
  `node_modules/` is uploaded and then ignored by the `COPY` lines. Harmless,
  but it costs seconds — and the root of the repo is the Platform Engineer's.
