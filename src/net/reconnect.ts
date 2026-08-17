/**
 * src/net/reconnect.ts — should we keep trying, and if not, why not.
 * OWNER: Netcode Engineer (GDD §4.2; M9 hosting, Task 9b).
 *
 * From inside a closed socket two failures are indistinguishable, and they could
 * not mean more different things:
 *
 *   • **The client dropped.** A screen lock, a tunnel, a cellular hand-off. The
 *     room is fine, a bot is flying the ship, and the seat is held for ~60 s
 *     (GDD §4.2). Retrying is exactly right — the whole reconnect-grace rule
 *     exists so this recovers.
 *   • **The Machine died.** The room went with it. There is nothing to reclaim
 *     and no amount of retrying will conjure a room back into existence.
 *
 * A phone cannot tell these apart on its own; the allocator can, because it knows
 * whether the room still exists across the whole fleet — a 404 is a room that has
 * ended (`src/net/allocator-client.ts`). This module is where that knowledge, plus
 * the elapsed grace, becomes a single verdict: {@link decideReconnect}.
 *
 * **Pure and clockless.** Elapsed time is a *parameter*, not a reading — so a
 * sixty-second window is a test that runs in nanoseconds, and this file reads no
 * clock, opens no socket, and imports nothing. It only compares the numbers and
 * the one string it is handed.
 */

import type { RoomCode } from './transport';

/**
 * What the allocator last told us about the room behind a dead socket.
 *
 *   • `'live'`    — the allocator resolved the code to a Machine: the room is up,
 *                   a bot has our seat, and it is ours to reclaim for as long as
 *                   the match runs (a0-72 — no longer "inside the window").
 *   • `'gone'`    — the allocator answered 404: no Machine hosts the code. The
 *                   room has ended; there is nothing to reclaim, ever.
 *   • `'unknown'` — we never asked, or the ask *itself* failed (the allocator was
 *                   unreachable — which is not the same as the room being gone).
 *                   Treated as "maybe live": keep trying within the window rather
 *                   than abandon a room that is very probably fine.
 */
export type RoomLiveness = 'live' | 'gone' | 'unknown';

/**
 * The reconnect-grace window (GDD §4.2, ~60 s TUNABLE) — **the fallback, since
 * a0-72, for a room whose liveness we could not establish.**
 *
 * When the allocator answers, its answer decides ({@link decideReconnect}): a live
 * room is retried however long the player was away, because the seat is held for
 * the life of the match. This number is what is left when nobody could be asked —
 * the direct-connect path with no probe wired, or an allocator that is down.
 *
 * Mirrors `RECONNECT_WINDOW_MS` in `./websocket-transport`, restated here so the
 * pure decision layer needs no import from the transport that consumes it.
 */
export const DEFAULT_GRACE_WINDOW_MS = 60_000;

/** Why we stopped trying — the half of the verdict a screen turns into words.
 *   • `'room-gone'`     — the room has ended; offer a new match, not a retry.
 *   • `'grace-elapsed'` — the seat is a bot's now; the match went on without us. */
export type StopReason = 'room-gone' | 'grace-elapsed';

/** Keep dialling, or stop (with the reason the UI needs to say the right thing). */
export type ReconnectDecision =
  | { readonly action: 'retry' }
  | { readonly action: 'stop'; readonly reason: StopReason };

/** Everything the verdict turns on, all supplied by the caller (no clock read here). */
export interface ReconnectContext {
  /** Milliseconds since the drop. The *caller* measures it; this module compares it. */
  readonly elapsedMs: number;
  /** The grace window to judge `elapsedMs` against; defaults live at the call site. */
  readonly graceWindowMs: number;
  /** The allocator's latest word on the room, or `'unknown'` if we could not ask. */
  readonly roomLiveness: RoomLiveness;
  /** The room in question — carried for callers that log or branch on it; the
   *  decision itself does not read it. Optional so a bare numeric test needs no code. */
  readonly room?: RoomCode;
}

/**
 * The verdict. Order matters, and since a0-72 the *room* decides before the clock
 * in both directions:
 *
 *  1. **`'gone'` stops, always.** "No Machine hosts this code" is true now and in
 *     fifty seconds alike — waiting out a window against a room that has ended is
 *     the bug Task 9b removed.
 *  2. **`'live'` retries, always** — the a0-72 ruling, in one line: *"i should be
 *     able to join back if the match is still on-going no matter what"*. A client
 *     that gave up on the clock while the allocator was telling it the room was
 *     right there would be refusing a seat the server is holding. The seat is held
 *     for the life of the match (`server/room.ts` `HELD_FOR_MATCH`), so the honest
 *     client-side rule is the same one: keep asking while there is something to ask.
 *     This does not loop forever — a room that will not have us answers `joinError`
 *     and the transport ends terminally on the server's own word
 *     (`./websocket-transport` `rejectJoin`), which is a truthful ending rather
 *     than an arithmetic one.
 *  3. **`'unknown'` falls back to the window.** We could not ask, so we keep the
 *     old conservative rule; at the boundary the window is *closed* (`>=`).
 */
export function decideReconnect(ctx: ReconnectContext): ReconnectDecision {
  if (ctx.roomLiveness === 'gone') return { action: 'stop', reason: 'room-gone' };
  if (ctx.roomLiveness === 'live') return { action: 'retry' };
  if (ctx.elapsedMs >= ctx.graceWindowMs) return { action: 'stop', reason: 'grace-elapsed' };
  return { action: 'retry' };
}
