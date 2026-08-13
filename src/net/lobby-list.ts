/**
 * src/net/lobby-list.ts — the browse screen's two calls. OWNER: Netcode Engineer
 * (a0-26; `docs/lobby-browser-plan.md` §3 and §6, Milestone B6).
 *
 * JOIN has two modes — a code, and a list (the developer: *"joining has 2 mo[de]s,
 * code and browse a list of lobbies"*). The code half ships and is evidenced
 * (`a1-13`, room `B7GW`); this file is the read and the tap behind the other half:
 *
 *   • {@link readLobbyList} — `GET /rooms`, the allocator's list of rooms a
 *     stranger may walk into. One request per refresh, never a fan-out, and
 *     **CORS-simple**: a plain GET with no custom header, so a browser on GitHub
 *     Pages skips the preflight that would otherwise double the only cost this
 *     feature has (plan §6, Trap 11).
 *   • {@link joinListing} — `POST /listings/:id/join`, the JOIN button on a row.
 *
 * **A row carries no room code, and joining does not need one.** The list names
 * each room by a handle the allocator derives (`allocator/listing.ts`), so a
 * player reaches a public room without ever seeing or typing a code. What that is
 * worth is stated exactly where it is built, and it is a courtesy rather than
 * secrecy: anyone who can read the list can join every room in it.
 *
 * **The list decides nothing.** {@link readLobbyList} returns `null` for every
 * failure — 404, a thrown fetch, a body that is not JSON, a shape that is not a
 * listing — the same one-value doctrine `readRoomAdvert` documents, and for the
 * same reason twice over: a preview is up to ten seconds stale, and the
 * allocate/join round trip remains the only authority on whether a player gets in
 * (Trap 5). A browser that refused a join locally would be a second, weaker gate
 * saying the same thing worse.
 *
 * **The cost of leaving it open.** Measured for the deployed fleet at its ceiling:
 * one full listing is on the order of a kilobyte, and a browser polling every 5 s
 * is 12 requests/min — with **zero** while the tab is hidden, which is what an
 * "idle browser" overwhelmingly is. The numbers and the four rules that bound
 * them live in the plan's §6; the two this file can keep, it keeps (one request,
 * no custom header). The lifecycle rules — poll only on the BROWSE segment, stop
 * on a hidden tab — belong to the screen and land with it.
 */

import type { AllocatorClientConfig, ResolveFailure, ResolvedConnection } from './allocator-client';
import { connectionFromBody } from './allocator-client';

/**
 * One room, as the browse list publishes it — the client's read of the
 * allocator's `RoomListing` (`allocator/listing.ts`).
 *
 * `players` counts **humans** and `joinableSeats` is *free and open*: a seat the
 * host shut or put a bot in is not one. Neither is ever recomputed from `size`
 * (Traps 3 and 4), and `size` is deliberately not a denominator to print beside
 * the player count (Trap 2) — it is the room's shape, and a row that says "2 of 8"
 * is quoting a lobby number that compacts the moment the match starts.
 */
export interface LobbyListing {
  /** The join handle {@link joinListing} takes. Not a room code, and not
   *  convertible into one by anybody but the allocator that minted it. */
  readonly id: string;
  /** The claim owner's id, for the row to show in place of a code. Minted per
   *  room; the game has no accounts, so it names *this claim's host* and dies
   *  with the room rather than pretending to be a durable identity. */
  readonly owner: string;
  /** The region the room's host Machine runs in. The **ping** beside it on the
   *  row is the round trip this client times against that region itself
   *  (`./region-probe`) — never a number the server claims, and `—` rather than
   *  `0 ms` when it has not been measured (region-probe rule 1, Trap 6). */
  readonly region: string;
  /** Match size (N), when the listing carries it. */
  readonly size?: number;
  /** Match mode (`'ffa' | 'teams'`), when the listing carries it. */
  readonly mode?: string;
  /** Humans in the room right now. */
  readonly players: number;
  /** Seats a new human can still take. */
  readonly joinableSeats: number;
}

/** A listing and the instant the allocator built it. */
export interface LobbyList {
  readonly rooms: readonly LobbyListing[];
  /**
   * **The allocator's clock** when the listing was built, not this client's.
   *
   * The plan's card stamps `UPDATED 3s AGO` and the honest way to compute that is
   * from when *this* client received the answer — two machines' clocks differ by
   * however much they differ, and a stamp that subtracted `asOf` from a local
   * `Date.now()` would read as minutes-stale (or negative) on a device whose
   * clock is simply wrong. Keep it for what it is: the allocator's own account of
   * which snapshot a row came from, worth having in a log or a bug report.
   */
  readonly asOf: number;
}

/**
 * Read the lobby list, or `null` when there is nothing usable to read.
 *
 * `null` is one value for every failure on purpose (see the header). What it is
 * **not** is a reason to blank the screen: the plan's first card rule is that the
 * list never blanks, so a caller holds its last good listing and ages the stamp
 * (§3 rule 5). This function is the seam that makes that possible by never
 * returning a half-listing.
 *
 * A **malformed row is dropped, the listing is not** — one room whose Machine
 * sent something odd must not cost a player every other room on screen.
 */
export async function readLobbyList(config: AllocatorClientConfig): Promise<LobbyList | null> {
  const doFetch = config.fetch ?? defaultFetch(config);
  let payload: unknown;
  try {
    // No init at all: a bare GET is what keeps this request CORS-simple.
    const response = await doFetch(`${config.baseUrl}/rooms`);
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as { rooms?: unknown; asOf?: unknown };
  if (!Array.isArray(body.rooms)) return null;
  return {
    rooms: body.rooms.map(toListing).filter((row): row is LobbyListing => row !== null),
    asOf: typeof body.asOf === 'number' ? body.asOf : 0,
  };
}

/**
 * Why joining from a row did not land a connection. The allocator's own failures
 * ({@link ResolveFailure}) plus the one only a **row** can earn:
 *
 *   • `'room-full'` — 409: the claim is there and its last seat went to somebody
 *     else while the player was looking at the card. Distinct from `'not-found'`,
 *     which is the claim being *gone*, because those are two different sentences
 *     to say to a player and a list that conflated them would be lying about one.
 *
 * A superset of `ResolveFailure` rather than an extension of it: the entry
 * screen's existing copy table stays total over the union it was written for, and
 * the browse screen adds the one line this adds.
 */
export type ListingJoinFailure = ResolveFailure | 'room-full';

/** A row tap either lands a connection or names why it could not. */
export type ListingJoinResult =
  | { readonly ok: true; readonly connection: ResolvedConnection }
  | { readonly ok: false; readonly reason: ListingJoinFailure };

/**
 * **The JOIN button on a row** (the developer: *"there should be a join button to
 * join it"*): `POST /listings/:id/join`.
 *
 * The connection this lands is the *same* {@link ResolvedConnection} a typed code
 * lands — same parser, same ticket, same socket, same connect trace, same failure
 * paths after it — so nothing downstream of the JOIN screen learns that a row
 * exists. The room's code comes back **in the answer**, because the code is what a
 * `join` names on the socket; what the browse screen withheld was every *other*
 * room's code, which is the part that made a list a code-harvesting screen.
 *
 * A refusal here is the honest end of a stale row (plan §3): the row is gone
 * (404), or its seat was taken (409). Neither is a dead end — the caller returns
 * to the list, refreshes, and says which of the two happened.
 */
export async function joinListing(
  config: AllocatorClientConfig,
  id: string,
): Promise<ListingJoinResult> {
  const doFetch = config.fetch ?? defaultFetch(config);
  let response;
  try {
    response = await doFetch(`${config.baseUrl}/listings/${encodeURIComponent(id)}/join`, {
      method: 'POST',
    });
  } catch {
    // fetch threw: offline, DNS, TLS. The allocator was never reached, which says
    // nothing at all about the room — never report that as a dead row.
    return { ok: false, reason: 'network' };
  }
  if (!response.ok) return { ok: false, reason: failureFor(response.status) };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'bad-response' };
  }
  const connection = connectionFromBody(config, payload);
  return connection === null ? { ok: false, reason: 'bad-response' } : { ok: true, connection };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Map the allocator's refusal status onto the sentence the row will say. */
function failureFor(status: number): ListingJoinFailure {
  if (status === 404) return 'not-found'; // the claim is gone, or has gone private
  if (status === 409) return 'room-full'; // the claim is there; the seat is not
  if (status === 503) return 'no-capacity';
  return 'bad-response';
}

/**
 * One row, or `null` when it is not usable. Every field a row *prints* must be
 * present and well-typed — a row cannot honestly show a seat count it does not
 * have, and `size − players` is not an answer (Trap 3). `size` and `mode` are
 * optional, so a listing from an allocator that omits them still draws.
 */
function toListing(value: unknown): LobbyListing | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const { id, owner, region, players, joinableSeats, size, mode } = row;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof owner !== 'string' || typeof region !== 'string') return null;
  if (typeof players !== 'number' || typeof joinableSeats !== 'number') return null;
  return {
    id,
    owner,
    // Normalised to the SAME form `/regions` is read in (`./region-probe`
    // `toFleetRegion`), because a row's ping is found by matching this string
    // against that list. Two spellings of Virginia are two regions to a lookup and
    // one region to everyone else, and the row would print the em dash for a
    // measurement it is holding (n11-01). Both ends of the join normalise, so
    // neither has to trust the other's casing.
    region: normaliseRegion(region),
    ...(typeof size === 'number' ? { size } : {}),
    ...(typeof mode === 'string' ? { mode } : {}),
    players,
    joinableSeats,
  };
}

/** A region code in the one form this client compares them in: trimmed, lower
 *  case. The display layer upper-cases it back (`./region-probe`
 *  `formatRegionPing`), so nothing a player reads changes. */
function normaliseRegion(region: string): string {
  return region.trim().toLowerCase();
}

/** The platform `fetch`, resolved lazily; injected in every test. Mirrors
 *  `./allocator-client`'s own resolver rather than reaching into it, because a
 *  module that throws on import would be a module the menu cannot load. */
function defaultFetch(config: AllocatorClientConfig): NonNullable<AllocatorClientConfig['fetch']> {
  const f = (globalThis as { fetch?: NonNullable<AllocatorClientConfig['fetch']> }).fetch;
  if (!f) throw new Error(`no fetch available for ${config.baseUrl}; inject one`);
  return f;
}
