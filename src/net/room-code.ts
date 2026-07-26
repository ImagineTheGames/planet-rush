/**
 * src/net/room-code.ts — the room-code rules, in one place. OWNER: Netcode
 * Engineer (GDD §4.2).
 *
 * A room code is read off one player's screen and typed into another's phone,
 * so the rules that make it typable — a short length and an alphabet with no
 * look-alikes — are a small contract that more than one caller needs to obey.
 * The match server mints codes for the rooms it holds; once there is an
 * allocator standing in front of several match servers (docs/hosting-plan.md),
 * it mints codes too. Two copies of "what is a legal code" is one copy too many,
 * so the rules live here and both callers draw from them.
 *
 * This module is **pure and clockless**: generation takes an injected {@link Rng}
 * (the ratified `mulberry32`, `@shared/types`) and nothing else — no
 * `Math.random()`, no `Date.now()`. Given the same stream it yields the same
 * code, which is what lets a seeded server and a seeded test agree.
 *
 * (`src/ui/lobby.ts` keeps its own mirror of these rules on purpose: the client
 * bundle must not import server code. That mirror and this module must not
 * drift — see the note there.)
 */

import type { Rng } from '@shared/types';
import type { RoomCode } from './transport';

/**
 * The alphabet room codes are drawn from. No `O`/`0`, no `I`/`1`: a code is
 * read off one player's screen and typed into another's phone, so the letters
 * that are ambiguous in that game of telephone are simply not in the deck.
 * Thirty-two characters, chosen for legibility — do not "improve" it.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Room code length. 32^4 ≈ 1M codes — far more than a classroom needs, short
 *  enough to read aloud. */
export const CODE_LENGTH = 4;

/**
 * Draw one room code from an injected random stream. This is the primitive; a
 * caller that needs an *unused* code (the server, the allocator) wraps this in
 * its own bounded-retry collision check against the rooms it already knows.
 *
 * The `Math.min/Math.max` clamp is a belt against a misbehaving `Rng` that
 * returns exactly `1` — `mulberry32` never does (it yields `[0, 1)`), so this
 * changes no behaviour for the ratified source, it only refuses to index off
 * the end of the alphabet for a broken one.
 *
 * @param rng    A deterministic random source (`@shared/types` `mulberry32`).
 * @param length How many characters; defaults to {@link CODE_LENGTH}.
 */
export function makeRoomCode(rng: Rng, length = CODE_LENGTH): RoomCode {
  let code = '';
  for (let i = 0; i < length; i++) {
    const pick = Math.floor(rng.next() * CODE_ALPHABET.length);
    code += CODE_ALPHABET[Math.min(Math.max(pick, 0), CODE_ALPHABET.length - 1)];
  }
  return code;
}
