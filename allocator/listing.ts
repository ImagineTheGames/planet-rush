/**
 * allocator/listing.ts — what a browse row is, and how it names a room without
 * naming its code. OWNER: Netcode Engineer (a0-26; `docs/lobby-browser-plan.md`
 * §1 and §4, plus the developer's two refinements on top of D1).
 *
 * The plan's §1 decided the seam — the allocator lists, from the heartbeats it
 * already learns the fleet from — and §4 decided the columns. The developer then
 * refined the row twice:
 *
 *   > *"a browse shouldn't show the room code, just the room owner id and
 *   > location / ping"*
 *   > *"there should be a join button to join it"*
 *
 * Those two together are the whole of this file, because they are in tension: a
 * row must be **joinable** without ever being **readable as a code**. So a
 * listing carries two derived tokens instead of the code, and neither is the code
 * in a different field:
 *
 *   • {@link listingId} — the **join handle**. It is what `POST
 *     /listings/:id/join` takes, and it resolves *only* against the current
 *     listing: heartbeat-confirmed, joinable, and still listed. A code is an
 *     unbounded authority — it works from anywhere, for the whole life of the
 *     room, including after the host flips PRIVATE and after the match starts,
 *     and it is typeable into the keypad by anyone who reads it off a stream. A
 *     handle is exactly the authority the browse screen actually confers: *join
 *     this room while it is publicly open*. The moment the room stops being
 *     listed, the handle stops working; the code would not have.
 *   • {@link ownerTag} — the **owner id** the row shows. The game has no accounts
 *     and nothing carries a player's name to the ad (§4: "Host name / player
 *     names — nothing carries them"), so there is no durable identity to publish
 *     and this one does not pretend to be one: it names *this claim's host*, it
 *     is stable for the room's life, and it dies with the room. Six characters
 *     against a code's four, from the same legible deck, so it can never be
 *     mistaken for a code or typed into the keypad as one.
 *
 * **This is a courtesy, not secrecy, and the plan is right about that (Trap 7).**
 * Anyone who can read the listing can join every room in it — that is what
 * publishing a room means, and the toggle that opts out of it is the PRIVATE one.
 * What the handle buys is narrower and worth stating exactly: the browse payload
 * is not a code-harvesting feed, a screenshot of the list hands nobody a code, and
 * a stale row cannot be typed back in as one. Nothing here makes a listed room
 * private.
 *
 * **Derived, never stored.** Both tokens are an HMAC of the room code under the
 * allocator's own secret, so the registry stays what its header says it is — a
 * cache that holds nothing a heartbeat cannot restate. An allocator that restarts
 * mints the *same* handles for the same rooms one beat later, and a second
 * allocator instance sharing the secret agrees without sharing any state at all.
 * There is no handle table to keep, expire, or lose.
 *
 * **Pure and clockless.** `node:crypto` and the arguments, nothing else — no new
 * dependency, no clock, no global state.
 */

import { createHmac } from 'node:crypto';
import type { RoomCode } from '../src/net/transport';
import { CODE_ALPHABET, CODE_LENGTH } from '../src/net/room-code';

/**
 * Characters in a join handle. 16 base64url characters is 96 bits of HMAC — far
 * past any point where guessing one is cheaper than guessing the 4-character code
 * it stands for, which matters because the handle is a join key and the room it
 * opens is somebody's match.
 */
export const LISTING_ID_LENGTH = 16;

/**
 * Characters in an owner tag. **Six, where a code is four** ({@link CODE_LENGTH}),
 * from the same 32-character legible deck: long enough not to collide across a
 * fleet's worth of rooms, and a different length on purpose — a player who reads
 * an owner id off a row and types it into the CODE keypad must be stopped by the
 * shape of the thing, not by an error message.
 */
export const OWNER_TAG_LENGTH = 6;

/**
 * One room, as the browse list publishes it. **The code is not here**, and that
 * is the point of the file above.
 *
 * Every field is something the ad actually measures (plan §4 of the
 * measurements): `players` counts **humans** and `joinableSeats` is *free and
 * open* — a seat the host shut or put a bot in is not one — so neither is ever
 * recomputed from `size` (Traps 3 and 4). `size` rides for the same reason the
 * room ad carries it: it is the room's shape, not a denominator to print beside
 * the player count (Trap 2).
 */
export interface RoomListing {
  /** The join handle — what a JOIN button posts back ({@link listingId}). */
  readonly id: string;
  /** The claim's owner id, for the row to show ({@link ownerTag}). */
  readonly owner: string;
  /** The datacentre the room's host Machine runs in. The row's *location*; the
   *  **ping** beside it is the round trip the client itself times against that
   *  region (`src/net/region-probe.ts`), never a number the server claims. */
  readonly region: string;
  /** Match size (N) — the seat count the room was opened at. */
  readonly size?: number;
  /** Match mode (`'ffa' | 'teams'`). */
  readonly mode?: string;
  /** Humans in the room right now. */
  readonly players: number;
  /** Seats a new human can still take — free **and** open. */
  readonly joinableSeats: number;
}

/**
 * The join handle for a room code, under the allocator's secret. Deterministic,
 * one-way, and truncated: the same code always yields the same handle, and the
 * handle cannot be turned back into the code by anyone who does not hold the
 * secret (which is the allocator and the Machines it already shares one with).
 *
 * The `listing:` prefix domain-separates this from {@link ownerTag}, so the two
 * tokens a row carries are independent: seeing one tells you nothing about the
 * other, and a row that prints the owner id has not printed the join key.
 */
export function listingId(code: RoomCode, secret: string): string {
  return createHmac('sha256', secret)
    .update(`listing:${code}`)
    .digest('base64url')
    .slice(0, LISTING_ID_LENGTH);
}

/**
 * The owner id for a room code — the tag a row shows in place of the code.
 * Rendered into the same legible deck the codes use ({@link CODE_ALPHABET},
 * "chosen for legibility — do not improve it"), because this is the one token in
 * the pair a human actually reads off a screen.
 *
 * Six characters is 32⁶ ≈ 1.07 billion, so two live rooms sharing a tag is not a
 * thing a fleet of twelve will see. Nothing routes on it — the handle does — so a
 * collision would cost two rows the same label and nothing more.
 */
export function ownerTag(code: RoomCode, secret: string): string {
  const digest = createHmac('sha256', secret).update(`owner:${code}`).digest();
  let tag = '';
  for (let i = 0; i < OWNER_TAG_LENGTH; i++) {
    tag += CODE_ALPHABET[digest[i]! % CODE_ALPHABET.length];
  }
  return tag;
}
