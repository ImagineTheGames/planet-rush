/**
 * src/net/seat-memory.ts — **the seat token, given a life longer than the page.**
 * OWNER: Netcode Engineer (GDD §4.2; a0-133).
 *
 * The reconnect-grace rule has always had a credential. When the room seats a
 * player it mints a per-seat secret and hands it over in the `welcome`
 * (`./transport` `WelcomeMessage.reclaimToken`), and that secret — never the room
 * code — is what the reclaim door checks: *"The room code is shared with the whole
 * classroom by design, so it cannot be the credential. The token is."*
 * (`server/room.ts` `reclaim`).
 *
 * So the room can tell a returning player from a stranger, and it never refused
 * one. What it refused was a client that could not *say* it was returning:
 * `WebSocketTransport` kept the token in a private field and nowhere else, so it
 * lived exactly as long as the JavaScript heap it was in. That is fine for the
 * failure the transport was written against — a socket that drops while the page
 * keeps running — and it is precisely wrong for the failure the developer
 * reported on 2026-08-17:
 *
 *   *"on mobile i got disconnected because the screen went black, and when i went
 *   back i saw refused… i should be able to join back if the match is still
 *   on-going no matter what"*
 *
 * A phone that sleeps long enough does not resume a socket. The tab is discarded,
 * the page is rebuilt from scratch, and what comes back is a **fresh client**
 * typing a correct room code — with an empty token, which makes it a stranger at
 * the door of a live match (`server/room.ts` `join` → `'match-live'`). The path
 * that worked was the one a phone cannot use.
 *
 * This module is the whole of the missing half: the credential written down, so
 * the next page can present it. Nothing here invents identity the game does not
 * have — no account, no device fingerprint, no trusting the code alone. It is the
 * same secret, from the same welcome, read back by the same device.
 *
 * ── `localStorage`, and why not `sessionStorage` ────────────────────────────
 * The sibling store next door picks the other one, for a reason that does not
 * apply here: a playtest log's lifetime is a *tab's* (`./playtest-log-store`).
 * The lifetime this needs is a **match's**, and a match routinely outlives the
 * tab it was opened in — a backgrounded page discarded under memory pressure, a
 * browser killed and reopened, an app switched away from for two minutes. Those
 * are the cases, so `sessionStorage` would be storage that dies exactly when it
 * is needed. The cost of the longer-lived key is a stale credential, and that is
 * paid for twice: an entry expires on its own ({@link SEAT_MEMORY_TTL_MS}), and a
 * credential the server does not honour is dropped and retried as a plain join
 * (`./websocket-transport` `retryAsNewcomer`).
 *
 * **One seat, not a ledger.** A player is in one match at a time, so the key holds
 * the last seat this device took and its room; a recall for any other code misses.
 * A ledger of every room ever entered would be a longer-lived record of the same
 * secrets for no behaviour anyone can reach.
 *
 * **Total, silent, never throwing** — the discipline `./playtest-log-store` set.
 * Private mode denies storage on access, some WebViews throw on the property
 * read itself, and none of that may take down a dial: a device that cannot
 * remember its seat simply arrives as it did before this file existed.
 */

import type { PlayerId } from '@shared/types';
import type { RoomCode } from './transport';
import type { StorageLike } from './playtest-log-store';

/** The one key, namespaced like every other key this client owns, with the schema
 *  version inside the blob rather than in the key — a stale-schema entry is read
 *  and rejected (then overwritten), instead of orphaning a key per deploy. */
export const SEAT_MEMORY_KEY = 'planet-rush:seat';

/** The blob's schema version. Bump when the shape below changes; anything else is
 *  rejected on read, which is the same thing as having forgotten. */
const SEAT_MEMORY_VERSION = 1;

/**
 * How long a written seat is worth presenting, ms — **six hours**.
 *
 * Not a rule about the match: the match's own end is what actually invalidates a
 * seat, and the server says so in its own words (`'match-over'`). This is hygiene,
 * so a credential cannot sit in a shared classroom device's storage for a week
 * waiting to be presented to a room that happens to be dealt the same four
 * letters. Generously longer than any match this game can produce (GDD §1: *"Matches
 * last 10–15 minutes"*; the longest ever measured, a SCARCE field on a four-minute
 * wave interval, ran 18:24) and far shorter than "forever".
 */
export const SEAT_MEMORY_TTL_MS = 6 * 60 * 60 * 1_000;

/** What a client needs to prove it is the player coming back: which room, which
 *  seat in it, and the secret that seat was issued. */
export interface SeatCredential {
  readonly room: RoomCode;
  readonly seat: PlayerId;
  readonly token: string;
}

/**
 * Somewhere to keep one seat credential across page loads.
 *
 * An interface rather than a `Storage` because everything in `src/net` takes its
 * ambient dependencies injected: a test hands over a plain object, the browser
 * hands over `localStorage`, and a platform with neither hands over nothing at all
 * ({@link browserSeatMemory} returns `null`).
 */
export interface SeatMemory {
  /** The credential for this room, or null — no entry, another room's entry, an
   *  unreadable one, or one past {@link SEAT_MEMORY_TTL_MS}. */
  recall(room: RoomCode, nowMs: number): SeatCredential | null;
  /** Write this seat down, replacing whatever was there. */
  remember(credential: SeatCredential, nowMs: number): void;
  /** Drop the entry, if it is this room's. A `forget` for a room we do not hold
   *  leaves the other room's credential alone — hanging up on one match must not
   *  erase another. */
  forget(room: RoomCode): void;
}

/** The stored shape. Kept flat and boring: it is read by a future build. */
interface StoredSeat {
  readonly v: number;
  readonly room: string;
  readonly seat: number;
  readonly token: string;
  readonly savedAt: number;
}

/** A slot index the wire could carry — the same bound `./wire` enforces on a
 *  `reclaim` field, restated here because storage is no more trusted than a
 *  socket is. */
function isSlot(value: unknown): value is PlayerId {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 8;
}

/** Parse a stored blob, or null if it is anything other than exactly what we
 *  wrote: a wrong version, a hand-edited key, a half-written value, another
 *  origin's collision. Nothing here throws and nothing here guesses. */
function parse(text: string | null): StoredSeat | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const seat = raw as Record<string, unknown>;
  if (seat['v'] !== SEAT_MEMORY_VERSION) return null;
  if (typeof seat['room'] !== 'string' || seat['room'].length === 0) return null;
  if (!isSlot(seat['seat'])) return null;
  if (typeof seat['token'] !== 'string' || seat['token'].length === 0) return null;
  if (typeof seat['savedAt'] !== 'number' || !Number.isFinite(seat['savedAt'])) return null;
  return {
    v: SEAT_MEMORY_VERSION,
    room: seat['room'],
    seat: seat['seat'],
    token: seat['token'],
    savedAt: seat['savedAt'],
  };
}

/**
 * Wrap a `Storage` as a {@link SeatMemory} — total, silent, never throwing.
 *
 * Every failure mode collapses to the same honest answer: *we do not remember*.
 * A write that fails takes the key with it rather than leaving a torn value for
 * the next page to present, for the same reason `./playtest-log-store` does:
 * storage that could not be replaced is storage that no longer describes this
 * client, and a confident stale credential is worse than none.
 */
export function seatMemory(storage: StorageLike): SeatMemory {
  const read = (): StoredSeat | null => {
    try {
      return parse(storage.getItem(SEAT_MEMORY_KEY));
    } catch {
      return null; // private mode, a disabled origin, a WebView with no storage
    }
  };
  const drop = (): void => {
    try {
      storage.removeItem(SEAT_MEMORY_KEY);
    } catch {
      /* Nothing more to try, and nothing that depends on it having worked. */
    }
  };
  return {
    recall(room: RoomCode, nowMs: number): SeatCredential | null {
      const stored = read();
      if (!stored) return null;
      if (stored.room !== room) return null;
      // Age is measured against the clock the caller supplies, and a *negative*
      // age counts as expired too: a device whose clock moved backwards between
      // the write and the read cannot be reasoned about, and the fallback for a
      // refused credential is an ordinary join, which is where this client would
      // have been anyway.
      const age = nowMs - stored.savedAt;
      if (age < 0 || age > SEAT_MEMORY_TTL_MS) {
        drop();
        return null;
      }
      return { room: stored.room, seat: stored.seat, token: stored.token };
    },
    remember(credential: SeatCredential, nowMs: number): void {
      const blob: StoredSeat = {
        v: SEAT_MEMORY_VERSION,
        room: credential.room,
        seat: credential.seat,
        token: credential.token,
        savedAt: nowMs,
      };
      try {
        storage.setItem(SEAT_MEMORY_KEY, JSON.stringify(blob));
      } catch {
        drop();
      }
    },
    forget(room: RoomCode): void {
      const stored = read();
      if (stored && stored.room !== room) return;
      drop();
    },
  };
}

/**
 * The browser's `localStorage` as a {@link SeatMemory}, or `null` where there is
 * none — node, a server-side import, an origin that denies storage outright.
 *
 * `null` is the honest answer, and the transport takes it as "this device cannot
 * remember its seat", which is exactly the behaviour that shipped before a0-133.
 * The property access itself is inside the `try`: on some WebViews *reading*
 * `window.localStorage` is what throws, not calling a method on it.
 */
export function browserSeatMemory(): SeatMemory | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function' ||
      typeof storage.removeItem !== 'function'
    ) {
      return null;
    }
    return seatMemory(storage);
  } catch {
    return null;
  }
}

/**
 * An in-memory {@link StorageLike}, for tests that need a page reload to be
 * simulable without a DOM: keep the object, throw the session away, build another
 * one on top of it — which is what a discarded tab does to the pair of them.
 */
export function memorySeatStorage(): StorageLike {
  const cells = new Map<string, string>();
  return {
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => void cells.set(key, value),
    removeItem: (key) => void cells.delete(key),
  };
}
