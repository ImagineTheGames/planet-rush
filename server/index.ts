/**
 * server/ — the authoritative match server. OWNER: Netcode Engineer
 * (GDD §3.5, §4.2).
 *
 * A plain Dockerized Node process with no vendor-specific APIs (redeploys
 * anywhere in an afternoon — risk 1). Holds all simulation authority: clients
 * send input ticks, the server runs the one true sim (imports src/sim/, never
 * PixiJS) and broadcasts state. Bots fill empty slots server-side.
 *
 * Placeholder only — no server yet (day-0 scaffold; lands day 3).
 */
export const SERVER_PLACEHOLDER = true;
