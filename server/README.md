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
