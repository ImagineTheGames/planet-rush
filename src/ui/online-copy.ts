/**
 * src/ui/online-copy.ts — the words the online front door and the reconnect
 * overlay say, and the region concept the lobby models. OWNER: UI Engineer
 * (M3/online step 3; GDD §2.1, §4.2, §4.8 risk 7).
 *
 * This is the one place the network layer's *reasons* become a *player's words*.
 * The net layer never phrases anything — `src/net` returns a `ResolveFailure`, a
 * `StopReason`, a `RoomLiveness`; this module is where each becomes a sentence the
 * player can act on. Keeping every string here (pure, DOM-free, unit-tested)
 * means the screens that show them — the front door ({@link ./lobby-entry}) and
 * the connection overlay ({@link ./connection-status}) — never mint copy of their
 * own, so a message reads the same wherever it appears.
 *
 * ---------------------------------------------------------------------------
 * THREE FAILURES, THREE DIFFERENT ACTIONS — NEVER "CONNECTION FAILED"
 * ---------------------------------------------------------------------------
 * The allocator can refuse a room for reasons that call for **different player
 * actions**, and collapsing them into one message tells the player to do the
 * wrong thing (M3 brief):
 *
 *   • `no-capacity` (503) — the *fleet* is full. Nothing is wrong with the code
 *     or the connection; wait a moment and try the same thing again.
 *   • `not-found` (404)   — no room has that code. The connection is fine; the
 *     *code* is wrong, so the fix is to check it and re-type — not to retry.
 *   • `network`           — `fetch` never reached the allocator: offline, DNS,
 *     TLS. Says nothing about any room — check the connection and retry, and
 *     SOLO still works in the meantime (the offline promise, §4.8 risk 6).
 *   • `bad-response`      — a 2xx (or other) the client could not read. The
 *     server answered but not sanely; retrying is the only sensible move.
 *
 * A tap on a lobby-browser ROW can fail one further way — `room-full`, the seat
 * that went to somebody else while the player was reading the card — and means
 * something different by `not-found`, because a row is not something you typed.
 * {@link listingFailureMessage} is that table (u17-01).
 *
 * ---------------------------------------------------------------------------
 * A LOST SERVER IS NOT A LOST CONNECTION
 * ---------------------------------------------------------------------------
 * When the transport gives up, `decideReconnect` (`src/net/reconnect`) says why,
 * and the two whys are *different events* a player would file different bugs
 * about (M3 brief):
 *
 *   • `room-gone`     — the Machine died and took the room with it. The match is
 *     over for everyone; there is nothing to rejoin.
 *   • `grace-elapsed` — the room is fine and went on without us: we were away
 *     past the reconnect window and a stand-in kept the ship.
 *
 * ---------------------------------------------------------------------------
 * REGION — MODELLED, NOT YET SHOWN
 * ---------------------------------------------------------------------------
 * One region at launch, so the picker and its ping display are **suppressed by
 * config**: {@link regionPickerVisible} is `false` for a single region and the
 * whole selector never draws. The model is here so that the day a second region
 * lands, un-hiding the picker plus the {@link crossRegionWarning} is the entire
 * UI change — no new plumbing.
 */

import type { ResolveFailure } from '../net/allocator-client';
import type { ListingJoinFailure } from '../net/lobby-list';
import type { StopReason } from '../net/reconnect';

// ---------------------------------------------------------------------------
// Allocator failures → a message and the action it calls for
// ---------------------------------------------------------------------------

/**
 * What the button under a failure message should do. The distinction is the whole
 * point of not collapsing the failures:
 *   • `retry`     — attempt the *same* thing again (fleet full, offline, bad
 *                   answer): the request was reasonable, the world was not ready.
 *   • `edit-code` — the code is wrong; go back to the keypad and fix it. Retrying
 *                   an unknown code verbatim only asks the same 404 again.
 */
export type OnlineErrorAction = 'retry' | 'edit-code';

/** A refusal, phrased for a player: what happened and what to do about it. */
export interface OnlineErrorCopy {
  readonly reason: ResolveFailure;
  /** One sentence, in words to act on — never an error code (a player who cannot
   *  read the message cannot act). */
  readonly message: string;
  readonly action: OnlineErrorAction;
}

const ONLINE_ERROR_COPY: Readonly<Record<ResolveFailure, OnlineErrorCopy>> = {
  'no-capacity': {
    reason: 'no-capacity',
    message: 'The servers are full right now. Try again in a moment.',
    action: 'retry',
  },
  'not-found': {
    reason: 'not-found',
    message: 'No claim with that code. Check it and try again.',
    action: 'edit-code',
  },
  network: {
    reason: 'network',
    message: 'Can’t reach the servers. Check your connection — SOLO still works.',
    action: 'retry',
  },
  'bad-response': {
    reason: 'bad-response',
    message: 'The server hit a snag answering. Try again.',
    action: 'retry',
  },
};

/**
 * The full copy for an allocator failure. Total over {@link ResolveFailure}, so a
 * new failure kind cannot slip through as a blank message — the compiler flags the
 * missing case here rather than the player seeing an empty overlay.
 */
export function resolveFailureCopy(reason: ResolveFailure): OnlineErrorCopy {
  return ONLINE_ERROR_COPY[reason];
}

/** Just the sentence — for a caller that only needs the words (e.g. the entry
 *  screen's error line). */
export function resolveFailureMessage(reason: ResolveFailure): string {
  return ONLINE_ERROR_COPY[reason].message;
}

// ---------------------------------------------------------------------------
// …and the two refusals only a BROWSE ROW can earn (u17-01)
// ---------------------------------------------------------------------------

/**
 * The same job for a tap on a row in the lobby browser
 * (`src/net/lobby-list.ts` `joinListing`), which can fail two ways a typed code
 * cannot — and means something different by one of the ways it shares.
 *
 * n10-01 built the route and left these two lines to the UI lane in as many
 * words; they are here rather than in `./lobby-browser` for the same reason every
 * other refusal is here: one place turns a network reason into a sentence, so the
 * browse screen and the front door cannot end up wording the same failure twice.
 *
 *   • `room-full` (409) — the claim is there and its last seat went to somebody
 *     else while the player was looking at the card. **This is the answer to "what
 *     does a player see when they press JOIN on a room that filled up?"**
 *   • `not-found` (404) — on the code path this means *you mistyped it*, and the
 *     copy above says so ("Check it and try again"). On a ROW there is nothing to
 *     check: the player did not type anything, and a row that 404s is a claim that
 *     has ended or gone private. Same status, different fact, different sentence —
 *     which is exactly why this table exists instead of a cast.
 *
 * Total over {@link ListingJoinFailure}, so a new failure kind cannot reach a
 * player as a blank line.
 */
const LISTING_ERROR_COPY: Readonly<Record<ListingJoinFailure, string>> = {
  'room-full': 'That claim filled up while you were looking. Pick another.',
  'not-found': 'That claim has closed. Pick another, or press SOLO.',
  'no-capacity': ONLINE_ERROR_COPY['no-capacity'].message,
  network: ONLINE_ERROR_COPY.network.message,
  'bad-response': ONLINE_ERROR_COPY['bad-response'].message,
};

/** The sentence for a refused row join. */
export function listingFailureMessage(reason: ListingJoinFailure): string {
  return LISTING_ERROR_COPY[reason];
}

// ---------------------------------------------------------------------------
// A match that ended under us → distinct copy per event
// ---------------------------------------------------------------------------

/** How a match ended for this player, as words: a headline and one supporting
 *  line, kept apart because they are different events (see the file header). */
export interface ReconnectEndedCopy {
  readonly reason: StopReason;
  readonly headline: string;
  readonly detail: string;
}

const RECONNECT_ENDED_COPY: Readonly<Record<StopReason, ReconnectEndedCopy>> = {
  'room-gone': {
    reason: 'room-gone',
    headline: 'MATCH ENDED',
    detail: 'Lost the server. SOLO still works offline.',
  },
  'grace-elapsed': {
    reason: 'grace-elapsed',
    headline: 'AWAY TOO LONG',
    detail: 'You were away too long — a stand-in kept your ship.',
  },
};

/** The copy for a terminal reconnect verdict (`decideReconnect` → `stop`). Total
 *  over {@link StopReason}. */
export function reconnectEndedCopy(reason: StopReason): ReconnectEndedCopy {
  return RECONNECT_ENDED_COPY[reason];
}

// ---------------------------------------------------------------------------
// Region — present in the model, suppressed on screen at one region
// ---------------------------------------------------------------------------

/** A datacentre the fleet can place a room in. `pingMs` is the last measured
 *  round trip, or `null` when it has not been measured — the picker shows it only
 *  once there is more than one region to choose between. */
export interface RegionInfo {
  readonly id: string;
  readonly label: string;
  readonly pingMs?: number | null;
}

/**
 * Whether to draw the region picker at all. `false` for a single region — the
 * launch configuration — so the selector and its ping display never appear. The
 * moment a second region is configured this flips to `true` with no other change,
 * which is exactly the "present in the code, hidden on screen" contract.
 */
export function regionPickerVisible(regions: readonly RegionInfo[]): boolean {
  return regions.length > 1;
}

/** Round trip past which a region is "far" and worth warning about. TUNABLE. */
export const CROSS_REGION_PING_WARN_MS = 150;

/**
 * A one-line warning when the selected region is a slow hop away, or `''` when
 * there is nothing to warn about — one region (nothing to compare), no ping yet,
 * or a comfortable ping. Suppressed at launch by {@link regionPickerVisible}
 * being `false`; kept here so a second region needs only to un-hide the picker.
 */
export function crossRegionWarning(
  regions: readonly RegionInfo[],
  selectedId: string,
  thresholdMs: number = CROSS_REGION_PING_WARN_MS,
): string {
  if (!regionPickerVisible(regions)) return '';
  const selected = regions.find((r) => r.id === selectedId);
  const ping = selected?.pingMs;
  if (ping === null || ping === undefined || ping < thresholdMs) return '';
  return `This region is a slow hop away (~${Math.round(ping)}ms). Expect some lag.`;
}
