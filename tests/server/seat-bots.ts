/**
 * tests/server/seat-bots.ts — "the host filled the room with bots". OWNER:
 * Netcode Engineer (a0-11; GDD §2.1 *amended 2026-08-07*).
 *
 * Most cases in this directory are not about the lobby at all — they are about
 * fog, input gaps, order idempotence, the latency probe — and they all need the
 * same thing first: a room with a match in it. Until a0-11 that was free, because
 * `startMatch` turned every seat without a socket into a bot, so one human
 * pressing start produced an eight-station war.
 *
 * That rule is gone. A seat left OPEN is an empty chair and takes the field with
 * nothing; bots go where the **host put them** (`server/room.ts` `startMatch`).
 * So a test that wants a full arena now has to ask for one, exactly as the
 * shipping client does — the host's roster rides its own `lobbyChoice`
 * (`src/net/transport` `LobbyChoiceMessage.seats`).
 *
 * Send this **right after the creator's `join`**, before any `lobbyChoice` the
 * case makes for itself: the room keeps a seat's authored state until it is told
 * otherwise, so a later choice that names a hull and no seats leaves the roster
 * alone — but a later choice from *here* would overwrite that hull with the
 * placeholder below.
 */

import { ShipClass } from '@shared/types';
import { encodeClientMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import type { LobbySeatState } from '../../src/net/transport';

/** Seats in a room unless the case says otherwise (GDD §2.1). */
const DEFAULT_SEATS = 8;

/**
 * A `lobbyChoice` that sets every seat from `humans` upward to BOT.
 *
 * `humans` is how many low seats to leave OPEN for people — the room seats
 * joiners from the lowest free chair, so those are the ones they land in. The
 * hull is the onboarding default (GDD §2.11) and is deliberately uninteresting:
 * a case that cares about the hull sends its own choice afterwards.
 */
export function seatBots(humans = 1, size = DEFAULT_SEATS): WireFrame {
  const seats: LobbySeatState[] = Array.from({ length: size }, (_, i) =>
    i < humans ? 'open' : 'bot',
  );
  return encodeClientMessage({
    type: 'lobbyChoice',
    shipClass: ShipClass.Vanguard,
    fireMode: 'manual',
    seats,
  });
}
