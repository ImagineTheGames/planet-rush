/**
 * src/net/ — networking. OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * One seam, two implementations. `Transport` (`./transport`, the ratified
 * sketch the day-0 spike produced) is everything the game knows about the
 * network; `LocalLoopback` (`./loopback`) runs the authoritative sim in-process
 * for solo/offline play, and `WebSocketTransport` will speak to the match
 * server for online play. The simulation consumes ordered input ticks and never
 * knows which one it is talking to (GDD §4.2) — enforced by `./input-queue`,
 * which both transports and the server file input through.
 *
 * The client's entry point is `./session`: `createLocalSession()` for offline,
 * and one `sendInput()` per fixed tick from the game loop. Binary snapshot
 * encoding — the measured 510-byte worst case from docs/netcode-spike.md — is
 * in `./snapshot`.
 *
 * Online is here too: `./wire` is how the protocol is spelled on a socket (JSON
 * for words, binary frames for snapshots) and is shared with `server/`, and
 * `./websocket-transport` is the client end — one persistent socket, and a
 * redial that reclaims the seat a bot is holding (GDD §4.2 reconnect grace).
 *
 * And `./prediction` is why online feels like a game rather than a telegram:
 * the client runs the same `step()` the server runs, one tick ahead per input
 * in flight, and reconciles the result against each snapshot — rewind, overwrite
 * with authority, replay everything the server has not yet run (GDD §4.2). The
 * static half of the world that does not stream arrives as events and is applied
 * by `./entity-events`. The one piece of *ship* state that does not stream either
 * — the wallet: held ore, banked ore, upgrade tiers — rides its own low-frequency
 * channel to its own slot (`./transport` `EconomyMessage`), because a rewind cannot
 * put a hold back the way it puts a position back (GDD §4.2, docs/netcode-spike.md
 * "The wallet on the wire").
 *
 * And three modules make that reconciliation *feel* right at real latency (M10):
 * `./telemetry` instruments it — misprediction rate, correction magnitude, and
 * measured RTT, sampled per second and handed back through COPY LOG; `./interpolation`
 * renders other ships ~100 ms in the past so their motion is smooth at any RTT
 * while the local ship stays predicted; and `./latency-transport` wraps any
 * transport in a configurable one-way delay + jitter, so the developer's ~150 ms
 * condition is a test that runs instantly rather than a feel only reproduced live.
 *
 * The M10 **audit** (docs/netcode-audit.md) added the fourth, and it is the one
 * that made the other three visible to a player: `./presentation`. Those three
 * modules were seams offered to the render layer, and the render layer never took
 * them — the deployed bundle carried `renderOffset` and `sampleRemotes` with no
 * call site anywhere. So the presented frame is written over the world the renderer
 * already reads, once per tick, and taken straight back off before anything
 * simulates. Between apply and restore the world is a picture; outside it, the
 * simulation, byte for byte.
 *
 * And one module group exists so a *playtest* can be reported rather than described:
 * `./playtest-log` is a bounded, local-only ring of the session's real events (build
 * sha, the whole connection lifecycle, the per-second net telemetry, match events,
 * our own console errors), `./playtest-log-capture` feeds it the console,
 * `./playtest-log-attach` feeds it a live session, `./playtest-log-export` puts it on
 * the clipboard (with a download fallback), and `./playtest-log-button` is the one
 * COPY LOG affordance that offers it — on the pause menu and on every error screen.
 * Nothing in that group uploads anything; the developer chooses what to paste.
 *
 * Alongside it, `./connect-trace` and `./connect-trace-view` are the connecting
 * screen said out loud (M10): the five things `CONNECTING…` used to cover —
 * allocate, ticket, dial, hand-off, seat — each named as it happens, or stopped on
 * the exact refusal with RETRY and COPY LOG on the panel itself. Same division as
 * the button: a pure model here, one DOM panel over the canvas, and `src/ui/`'s own
 * screens untouched.
 */

export * from './transport';
export * from './input-queue';
export * from './snapshot';
export * from './entity-events';
export * from './prediction';
export * from './telemetry';
export * from './interpolation';
export * from './presentation';
export * from './reconnect';
export * from './wire';
export * from './loopback';
export * from './latency-transport';
export * from './playtest-log';
export * from './playtest-log-capture';
export * from './playtest-log-export';
export * from './playtest-log-button';
export * from './playtest-log-attach';
export * from './connect-trace';
export * from './connect-trace-view';
export * from './allocator-client';
export * from './server-url';
export * from './websocket-transport';
export * from './session';
