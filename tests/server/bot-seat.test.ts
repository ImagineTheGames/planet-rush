/**
 * tests/server/bot-seat.test.ts — **a bot flies the seat it is actually in.**
 * OWNER: Netcode Engineer (a0-11 compaction, `server/room.ts` `startMatch`).
 *
 * THE BUG THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * a0-11 made RUSH! *compact* the roster: a seat nobody is in takes the field with
 * nothing, so the survivors are renumbered `0..N-1` before the world is built.
 * The bots, though, were constructed one line **above** that renumbering — and a
 * bot carries the seat id it was built with for the rest of the match
 * (`createBot`'s `BotSeat`, read by `src/bots/harness` `thinkOnce`).
 *
 * So in any room where an OPEN seat sat below a BOT seat — host in chair 0, chair
 * 1 left open for a friend who never came, bots in 2 and 3 — every bot spent the
 * match perceiving a *different* seat than the one it was flying. Worse, it
 * perceived one that no longer existed: `perceive` answers a missing ship with a
 * blind view (`self === null` ⇒ it sees no ships, no rocks, nothing), and
 * `inputsFor` filed that blind decision against a real ship anyway. A bot that
 * cannot see is not a difficulty, it is a broken seat.
 *
 * Every case below is about the identity `bot.seat.id === slot.player`, and the
 * one consequence that makes it worth pinning: **the view a bot gets is its own**.
 *
 * Kept honest by the second case: the host's cast still lands in the same seats,
 * because compaction preserves slot order and `castFor` spends the picks in that
 * order either way (a0-06b — the row this fix must not disturb).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { PERSONALITIES, perceive } from '../../src/bots';
import type { PersonalityId } from '../../src/bots';
import { encodeClientMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import type { LobbySeatState } from '../../src/net/transport';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';

/** A socket that keeps what it was sent, and nothing else — this file asserts on
 *  the room's own state, never on what a client was told. */
class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {
    /* nothing to tear down in-process */
  }
}

describe('a bot flies the seat it was compacted into (a0-11)', () => {
  let server: MatchServer;

  beforeEach(() => {
    server = new MatchServer({ seed: 0x5171, graceMs: 60_000, asteroidCount: 12 });
    server.update(1_000_000);
  });

  /**
   * A host alone in a room of `seats.length` chairs, authored exactly as given,
   * and started. The interesting shape is an OPEN chair *below* a BOT chair —
   * that is the arrangement compaction actually renumbers.
   */
  const startRoom = (
    seats: readonly LobbySeatState[],
    cast?: readonly PersonalityId[],
  ): Connection => {
    const code = server.createCode();
    const host = server.connect(new FakeSocket());
    host.receive(encodeClientMessage({ type: 'join', room: code }));
    host.receive(
      encodeClientMessage({
        type: 'lobbyChoice',
        shipClass: ShipClass.Vanguard,
        fireMode: 'manual',
        seats: [...seats],
        ...(cast ? { botPersonalities: [...cast] } : {}),
      }),
    );
    host.receive(encodeClientMessage({ type: 'startMatch' }));
    return host;
  };

  it('gives every bot the seat id its own ship flies under', () => {
    // Chair 1 is the friend who never came: OPEN, and therefore not in the match
    // at all (GDD §2.1 amended). The two bots behind it are compacted down onto
    // seats 1 and 2, and this is the assertion that used to fail — they kept 2
    // and 3.
    const host = startRoom(['open', 'open', 'bot', 'bot']);
    const room = host.room!;
    expect(room.state).toBe('live');
    expect(room.size, 'the open chair is not in the match').toBe(3);
    expect(room.world!.ships.map((s) => s.id)).toEqual([0, 1, 2]);

    for (const player of [1, 2]) {
      const bot = room.botAt(player);
      expect(bot, `seat ${player} is flown by a bot`).not.toBeNull();
      expect(bot!.seat.id, `the bot in seat ${player} knows it is in seat ${player}`).toBe(player);
    }
  });

  it('gives every bot a view of its OWN ship, not a blind one', () => {
    // The consequence, stated as the thing a player would actually notice. Before
    // the fix the bot in the last chair perceived a ship that does not exist, and
    // `perceive` answers that with a view that sees nothing at all — a bot flying
    // an eight-station war with the lights off.
    const host = startRoom(['open', 'open', 'bot', 'bot']);
    const room = host.room!;
    const world = room.world!;

    for (const player of [1, 2]) {
      const bot = room.botAt(player)!;
      const view = perceive(world, bot.seat.id);
      expect(view.self.id, `seat ${player} perceives itself`).toBe(player);
      expect(view.self.alive, `seat ${player} is alive in its own view`).toBe(true);
      expect(view.self.station, `seat ${player} can see its own home`).not.toBeNull();
      // Not a blind view: an eight-hundred-unit arena with three stations in it
      // has *something* to look at, and a blind view has exactly nothing.
      expect(
        view.ships.length + view.asteroids.length,
        `seat ${player} sees the arena it is in`,
      ).toBeGreaterThan(0);
    }
  });

  it('still seats the host CAST in the same chairs (a0-06b is not disturbed)', () => {
    // Compaction preserves slot order and `castFor` spends the picks in that
    // order, so moving the seating below the renumbering must not move a single
    // character. Two named characters, an OPEN chair in the middle of the room,
    // and the same answer as before: pick 0 in the first bot chair, pick 1 in the
    // second — by NAME, because the tier alone cannot tell Sable from Vulture.
    const cast: PersonalityId[] = ['sable', 'patch'];
    const host = startRoom(['open', 'open', 'bot', 'bot'], cast);
    const room = host.room!;

    expect(room.botAt(1)!.seat.personality).toBe('sable');
    expect(room.botAt(2)!.seat.personality).toBe('patch');
    // …and the roster the clients are shown agrees, tier derived from the name.
    const bots = room.lobbyState().filter((s) => s.isBot);
    expect(bots.map((s) => s.botPersonality)).toEqual(cast);
    expect(bots.map((s) => s.botDifficulty)).toEqual(cast.map((c) => PERSONALITIES[c].difficulty));
    expect(bots.map((s) => s.shipClass)).toEqual(cast.map((c) => PERSONALITIES[c].shipClass));
  });

  it('leaves a room that needs no compaction exactly as it was', () => {
    // The control: every chair is in the match, so nothing is renumbered and the
    // seat ids are what they always were. A fix that renumbered something here
    // would be a fix that moved the common case.
    const host = startRoom(['open', 'bot', 'bot', 'bot']);
    const room = host.room!;
    expect(room.size).toBe(4);
    for (const player of [1, 2, 3]) expect(room.botAt(player)!.seat.id).toBe(player);
  });
});
