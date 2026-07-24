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
 * Landing later: client-side prediction and reconciliation against snapshots,
 * so an online client renders a predicted world instead of a snapshot-fed one
 * (GDD §4.2, M4–M5).
 */

export * from './transport';
export * from './input-queue';
export * from './snapshot';
export * from './wire';
export * from './loopback';
export * from './websocket-transport';
export * from './session';
