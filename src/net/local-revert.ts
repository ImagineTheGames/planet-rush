/**
 * src/net/local-revert.ts — a room with nobody else in it plays locally. OWNER:
 * Netcode Engineer (a0-11; GDD §4.2 *amended 2026-08-07*).
 *
 * The developer, 2026-08-07:
 *
 * > *"creating an online match with only bots should also revert back to offline
 * > match (so we don't waste money for no reason on servers)"*
 *
 * If, at RUSH!, the only human in the room is the host, the match is one person
 * against some bots. Every ship in it is simulated by code that already runs in
 * the browser, and the round trip to a Machine in another country buys that match
 * exactly nothing — it costs a room on a Fly guest, and it costs the player their
 * own latency for the privilege.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES, AND WHY EACH ONE IS A RULE
 * ---------------------------------------------------------------------------
 *
 *  1. **Decided at RUSH!, never at room creation.** A host may open a room, read
 *     the code out, wait, and have somebody walk in. "Is anyone else here?" is
 *     only answerable at the instant the match starts, so that is where
 *     {@link playsLocally} is asked — and it is asked about the roster as it
 *     stands, not about which door the player came through.
 *  2. **The match is identical either way.** Same seed, same arena, same cast,
 *     same sides. This is a *transport* decision: `bootOfflineMatch` takes the
 *     same config the online path would have been built from, and determinism
 *     (GDD §4.8) is what makes "the same match" a fact rather than a hope. The
 *     one thing that does move is the local player's **seat number**, because the
 *     sim's roster is dense and the lobby's is not ({@link localSeat}).
 *  3. **The player is told, once, quietly.** They pressed a button that said
 *     online and got a local match; saying nothing would be a confusing
 *     optimisation rather than a considerate one. {@link LOCAL_REVERT_TELL} is
 *     that line, and `./local-revert-view` draws it as a line — not a dialog,
 *     because there is no decision for them to make.
 *  4. **The room is released.** Closing the socket is what frees the code, empties
 *     the room, lets `server/match-server.ts` sweep it (`humanCount === 0`), and
 *     lets the fleet controller drain and stop a Machine that is now holding
 *     nothing. A saving that stops at "we didn't send input" is a saving on paper:
 *     the room is what costs money ({@link ROOM_COST_NOTE}).
 *
 * ---------------------------------------------------------------------------
 * AND WHAT IT COSTS THE PLAYER: REJOIN
 * ---------------------------------------------------------------------------
 * A locally-booted match **cannot be rejoined by room code**, because the room it
 * would be rejoined into no longer exists — that is the whole point. Nothing
 * advertises otherwise: the room code is a lobby affordance (`src/ui/lobby`
 * `LobbyState.online`), the match this boots is an offline one, and an offline
 * match has never shown a code or a reconnect overlay (`./link-loss` runs online
 * only, where there is a link to lose). The reconnect-grace rule (GDD §4.2) is
 * about a *drop*, and there is no socket here to drop.
 *
 * DOM-free and transport-free on purpose, like `./link-loss` beside it: the model
 * decides, the caller performs. That is what lets the decision be tested without a
 * server, a canvas or a clock.
 */

import type { RoomCode } from './transport';

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * The roster at the moment RUSH! is pressed, counted the way GDD §2.1 (*amended
 * 2026-08-07*) counts it.
 *
 * Deliberately two plain numbers rather than the lobby's own state: `src/ui`
 * imports `src/net`, never the other way round, and the question this module
 * answers genuinely needs nothing else. The caller counts through the lobby's own
 * `isParticipant`, so there is still exactly one definition of "in the match".
 */
export interface RoomCensus {
  /** People in seats, including the host. Never zero — somebody pressed RUSH!. */
  readonly humans: number;
  /** Seats the host set to BOT. */
  readonly bots: number;
}

/**
 * Whether this match should boot on `LocalLoopback` instead of the room's socket.
 *
 * True exactly when **the host is the only human**. One human and some bots is a
 * solo match wearing a room code; two humans is a match that needs an authority
 * neither of them owns, whatever the bot count.
 *
 * Note what is *not* here. Not "the room was created offline" — the door does not
 * decide this, the roster does. Not "there are no bots" — a solo player with
 * seven bots is the case that costs the most and saves the most. Not "the room is
 * empty" — a room with nobody in it cannot have pressed RUSH!.
 */
export function playsLocally(census: RoomCensus): boolean {
  return census.humans <= 1;
}

/**
 * The seat the local player flies in the **locally booted** match.
 *
 * The lobby's seats are sparse the moment one is left open or shut; the sim's
 * roster is dense `0..N-1` by ratified design (`configToPlayers`, spike Trap 6).
 * The host is a participant, so their dense index is simply the number of
 * participants sitting below them — which the lobby answers with `denseSeatIndex`.
 * This exists so the boot path has one named place to get it wrong in, rather than
 * assuming the host is always seat 0 (they usually are; "usually" is not a rule).
 *
 * Folded to 0 for anything that is not a real index, because the local player must
 * always have a ship: a boot with no seat is a black screen.
 */
export function localSeat(denseIndex: number | null | undefined): number {
  if (denseIndex === null || denseIndex === undefined) return 0;
  if (!Number.isFinite(denseIndex) || denseIndex < 0) return 0;
  return Math.floor(denseIndex);
}

// ---------------------------------------------------------------------------
// The release
// ---------------------------------------------------------------------------

/** The little the release needs of a live session — closing it is the whole act. */
export interface ReleasableRoom {
  readonly code: RoomCode;
  close(): void;
}

/** What was actually given back, for the log and for the tell. */
export interface RoomRelease {
  /** The code that is now free for the next classroom to type. */
  readonly room: RoomCode;
  /** True once {@link releaseRoom} has closed the socket. */
  readonly released: boolean;
}

/**
 * Hand the room back.
 *
 * Closing the socket is the entire mechanism, and it is enough because every
 * layer above already reacts to it: the room frees the seat
 * (`server/room.ts` `disconnect` — in lobby phase a seat simply empties, with no
 * grace window to wait out), `server/match-server.ts` deletes a room with no
 * humans and no pending reclaim on its next sweep, the code goes back into
 * circulation, and the fleet controller can cordon, drain and **stop** a Machine
 * that is no longer hosting anything (`allocator/fleet-controller.ts`).
 *
 * Called before the local match boots, not after: a room held open across the
 * hand-off would be a room held for the length of a match nobody is playing in it.
 */
export function releaseRoom(room: ReleasableRoom | null | undefined): RoomRelease | null {
  if (!room) return null;
  room.close();
  return { room: room.code, released: true };
}

/**
 * What a held room actually costs, in one sentence, so the saving is a number and
 * not a feeling (m11-01, `docs/server-capacity.md`; `fly.gameserver.toml`).
 *
 * A room is the unit the fleet is packed by. A `shared-cpu-1x` Machine advertises
 * **6** of them and costs **$3.19/month** in `iad`, so one room is **~$0.53/month**
 * of Machine — and a room in progress also pins its Machine open: the fleet
 * controller will not stop a host that is still hosting anything, so the last idle
 * room on a Machine is holding the whole $3.19. In CPU it is ~4.7 ms/s for a full
 * 8-seat room, measured over the real wire, against a guest metered at 62.5 ms/s
 * sustained.
 */
export const ROOM_COST_NOTE =
  'a room is 1/6th of a shared-cpu-1x Machine ($3.19/mo, iad) — ~$0.53/mo, ~4.7 ms of CPU per second, ' +
  'and it keeps that Machine from being drained and stopped while it is held';

// ---------------------------------------------------------------------------
// The tell
// ---------------------------------------------------------------------------

/**
 * The one line the player reads.
 *
 * Interface voice (GDD §4.7 register 2): it states what happened and why, in that
 * order, and asks nothing. It says **NOBODY JOINED** rather than "no server
 * needed", because the player's question is about the room they opened, not about
 * our hosting bill. It is a line, never a dialog — the match is already starting,
 * and a modal over it would make a considerate optimisation feel like an error.
 */
export const LOCAL_REVERT_TELL = 'NOBODY JOINED — PLAYING LOCALLY';
