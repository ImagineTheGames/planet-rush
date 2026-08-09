/**
 * tests/server/room-radio.test.ts — **the same radio seam, on the server.**
 * OWNER: Netcode Engineer (b2-02; `docs/team-bots-plan.md` §2, Stage 2; GDD §2.9,
 * §4.2).
 *
 * THE SILENCE THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * `src/bots/radio.ts` is the team callout channel — Layer B, everything the ally
 * klaxon does not carry — and `createBots` opens one ring per side because it is
 * the only function offline that sees a whole lineup at once. `server/room.ts`
 * does not: it seats bots **one at a time**, at RUSH! and again whenever a pilot
 * drops, so every online bot took `createBot`'s quiet default of `radio: null`.
 * An online Teams match therefore ran with Layer B silent — allies never heard
 * each other's `help` or `siege` — and the same two bots fought differently
 * depending on whether a server had dealt their seats. `src/bots/harness` names
 * the seam and whose it is: *"wiring a shared channel through the server's slot
 * table is netcode's file, not this one."*
 *
 * WHAT EACH CASE IS FOR
 * ---------------------------------------------------------------------------
 *  1. Two bots on a side share **one ring**, and its members are their two seats.
 *  2. A **human ally is not on the channel** — the parity rule, not an oversight:
 *     `send` draws one number from the sender's seeded stream per member, so a
 *     human's seat on the roster would shift every ally's aim and make an online
 *     bot fight differently than the identical offline lineup does.
 *  3. **FFA is untouched**, structurally: a side of one gets `null`, with no mode
 *     check anywhere.
 *  4. A `help` call from one bot is **readable by its ally**, through the same
 *     `receive` a tree calls, and not before the tier's latency has passed.
 *  5. A **stand-in joins the side's channel** when a pilot drops (GDD §4.2), and
 *     the chatter already in flight survives the re-open.
 *  6. …and **leaves it** when that pilot reclaims their seat.
 *
 * Every case drives the real front door — `encodeClientMessage` → the server's
 * own parser → `Room.receive` — and reads the room's own bots back through
 * `botAt`. Nothing here constructs a `TeamRadio` to assert on; the ring under
 * test is always the one the room opened.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { PlayerId } from '@shared/types';
import { receive, send, tuningFor } from '../../src/bots';
import type { Bot, PersonalityId } from '../../src/bots';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import type { LobbySeatState, ServerMessage } from '../../src/net/transport';
import type { MatchMode } from '../../src/sim';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';
import type { MatchRoom } from '../../server/room';

/** A socket that keeps what it was sent, and can read it back as messages. */
class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {
    /* nothing to tear down in-process */
  }
  messages(): ServerMessage[] {
    const out: ServerMessage[] = [];
    for (const frame of this.frames) {
      const message = parseServerMessage(frame);
      if (message) out.push(message);
    }
    return out;
  }
  /** The reclaim token this seat's `welcome` issued (GDD §4.2). */
  reclaimToken(): string | undefined {
    for (const message of this.messages()) {
      if (message.type === 'welcome' && message.reclaimToken) return message.reclaimToken;
    }
    return undefined;
  }
}

/** One seated client: the socket the room writes to, and the connection it
 *  routes by. */
interface Client {
  readonly socket: FakeSocket;
  readonly connection: Connection;
}

/** The shape a case asks for: who is in which chair, and which side each fights
 *  for. `seats` is the host's OPEN / BOT / CLOSED authoring (a0-11). */
interface Lineup {
  readonly seats: readonly LobbySeatState[];
  readonly teams: readonly number[];
  readonly mode?: MatchMode;
  /** Extra humans to seat, after the host, before RUSH!. */
  readonly guests?: number;
  readonly cast?: readonly PersonalityId[];
}

describe('a served room seats its bots on a shared channel (b2-02)', () => {
  let server: MatchServer;
  let now = 1_000_000;

  const connect = (): Client => {
    const socket = new FakeSocket();
    return { socket, connection: server.connect(socket) };
  };

  beforeEach(() => {
    now = 1_000_000;
    // Fixed seed, injected clock: nothing in this file reaches for a wall clock
    // or `Math.random()` (GDD §4.1). Four chairs, so every lineup below fills the
    // room exactly and no case is quietly also a compaction case.
    server = new MatchServer({ seed: 0x5eed, slots: 4, graceMs: 60_000, asteroidCount: 12 });
    server.update(now);
  });

  /** Stand a room up in the given shape and press RUSH!. Returns the room and
   *  every client in seat order. */
  const start = (lineup: Lineup): { room: MatchRoom; clients: Client[] } => {
    const code = server.createCode();
    const host = connect();
    host.connection.receive(encodeClientMessage({ type: 'join', room: code }));
    const clients = [host];
    for (let i = 0; i < (lineup.guests ?? 0); i++) {
      const guest = connect();
      guest.connection.receive(encodeClientMessage({ type: 'join', room: code }));
      clients.push(guest);
    }
    host.connection.receive(
      encodeClientMessage({
        type: 'lobbyChoice',
        shipClass: ShipClass.Vanguard,
        fireMode: 'manual',
        seats: [...lineup.seats],
        mode: lineup.mode ?? 'teams',
        teams: [...lineup.teams],
        ...(lineup.cast ? { botPersonalities: [...lineup.cast] } : {}),
      }),
    );
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    const room = host.connection.room;
    if (!room) throw new Error('the room never started');
    expect(room.state).toBe('live');
    return { room, clients };
  };

  /** The bot in a seat, or a failed expectation naming the seat. */
  const botIn = (room: MatchRoom, player: PlayerId): Bot => {
    const bot = room.botAt(player);
    expect(bot, `seat ${player} is flown by a bot`).not.toBeNull();
    return bot!;
  };

  // --- 1 & 2. One ring per side, and who is on it -------------------------

  it('shares ONE ring between the bots on a side, and gives a lone bot none', () => {
    // Four chairs: the host in 0, bots in 1, 2, 3. Sides are interleaved on
    // purpose — 0 and 2 against 1 and 3 — so a ring that happened to group
    // "the last two seats" could not pass by accident.
    const { room } = start({
      seats: ['open', 'bot', 'bot', 'bot'],
      teams: [0, 1, 0, 1],
    });

    const lonely = botIn(room, 2); // side 0: a bot, and a HUMAN ally
    const first = botIn(room, 1); // side 1: two bots
    const second = botIn(room, 3);

    // The two bots of side 1 hold the SAME object, not two equal ones: a callout
    // filed by either has to land where the other reads.
    expect(first.brain.radio, 'side 1 has a channel').not.toBeNull();
    expect(first.brain.radio).toBe(second.brain.radio);
    expect(first.brain.radio!.members).toEqual([1, 3]);

    // …and side 0's bot has nobody to talk to, because its only ally is a human.
    // That is the PARITY rule, not a gap: `send` draws one number from the
    // sender's seeded stream per member, so putting a human's seat on the roster
    // would shift every ally's aim and make this bot fight differently than the
    // identical lineup does offline (`createBots`).
    expect(lonely.brain.radio, 'a human ally is not on the channel').toBeNull();
  });

  it('gives a whole all-bot side one ring, in ascending seat order', () => {
    const { room } = start({
      seats: ['open', 'bot', 'bot', 'bot'],
      teams: [0, 1, 1, 1],
    });
    const members = botIn(room, 1).brain.radio!.members;
    expect(members).toEqual([1, 2, 3]);
    for (const seat of [2, 3]) expect(botIn(room, seat).brain.radio).toBe(botIn(room, 1).brain.radio);
  });

  // --- 3. The FFA control -------------------------------------------------

  it('changes nothing in FFA — a side of one has nobody to talk to', () => {
    // The same three bots, the same chairs, the same seed. Only the mode differs,
    // and the room asks nothing about it: in FFA a side IS a seat, so every side
    // has one member and `teamRadio` answers `null` (plan §2.5). No mode flag
    // anywhere in a tree, and none here either.
    const { room } = start({
      seats: ['open', 'bot', 'bot', 'bot'],
      teams: [0, 1, 0, 1], // a stale TEAMS array, which FFA overrides outright
      mode: 'ffa',
    });
    for (const seat of [1, 2, 3]) {
      expect(botIn(room, seat).brain.radio, `seat ${seat} is on its own side`).toBeNull();
    }
  });

  // --- 4. A call actually travels ----------------------------------------

  it('carries one bot’s call to its ally, and not before the latency', () => {
    const { room } = start({
      seats: ['open', 'bot', 'bot', 'bot'],
      teams: [0, 0, 1, 1],
      // Named, so the tier — and therefore the latency and the freshness window
      // this case measures against — is a stated number rather than a default.
      cast: ['rusty', 'warden', 'warden'],
    });
    const caller = botIn(room, 2);
    const ally = botIn(room, 3);
    expect(caller.brain.radio).toBe(ally.brain.radio);

    const radio = caller.brain.radio!;
    const tuning = tuningFor(caller.seat.personality);
    const at = 12; // sim seconds — an arbitrary honest instant
    // Spoken through the channel's own API, exactly as `callHelp` does: a fact
    // about the sender's own ship, legal under any fog (`src/bots/radio` §2.2).
    // The RNG is pinned to 1 so nobody misses it — this case is about the wiring,
    // and `src/bots/team-radio.test.ts` owns the miss roll.
    const call = send(
      radio,
      { kind: 'help', from: caller.seat.id, about: caller.seat.id, pos: { x: 100, y: 200 }, seenAt: at },
      tuning.callLatency,
      tuning.callMissChance,
      { next: () => 1 },
    );
    expect(call, 'the call was filed on a live channel').not.toBeNull();

    // Not readable in the tick it was sent — the determinism floor, which is why
    // seat order can never reach a decision (`src/bots/radio` rule 1).
    const fresh = tuningFor(ally.seat.personality).memorySeconds;
    expect(receive(ally.brain.radio, ally.seat.id, at, fresh)).toHaveLength(0);

    // …and readable once it has, by the ALLY and through the ally's own brain.
    const heard = receive(ally.brain.radio, ally.seat.id, at + tuning.callLatency, fresh);
    expect(heard).toHaveLength(1);
    expect(heard[0]!.kind).toBe('help');
    expect(heard[0]!.from).toBe(caller.seat.id);
    expect(heard[0]!.pos).toEqual({ x: 100, y: 200 });

    // The enemy side hears none of it: a different side is a different ring.
    const enemy = botIn(room, 1);
    expect(enemy.brain.radio).not.toBe(radio);
    expect(receive(enemy.brain.radio, enemy.seat.id, at + 10, fresh)).toHaveLength(0);
  });

  // --- 5 & 6. The seat that changes hands (GDD §4.2) ---------------------

  it('puts a stand-in on its side’s channel when a pilot drops', () => {
    // Two humans, two bots, one each per side: neither bot has an ally that is a
    // bot, so both start with no channel at all.
    const { room, clients } = start({
      seats: ['open', 'open', 'bot', 'bot'],
      teams: [0, 1, 0, 1],
      guests: 1,
    });
    const ally = botIn(room, 3); // side 1, alone
    expect(ally.brain.radio, 'a side with one bot has no channel').toBeNull();

    // The guest in seat 1 loses its connection. A bot takes the controls at once
    // (GDD §4.2) — and side 1 now has two bots on it, so it has a voice.
    clients[1]!.connection.close(now);
    const substitute = botIn(room, 1);
    expect(substitute.brain.radio, 'the stand-in can hear its ally').not.toBeNull();
    expect(substitute.brain.radio).toBe(ally.brain.radio);
    expect(substitute.brain.radio!.members).toEqual([1, 3]);

    // Side 0 is untouched: its human is still flying, so its bot is still alone.
    expect(botIn(room, 2).brain.radio).toBeNull();
  });

  it('carries the chatter already in flight across the re-open', () => {
    // A guest and two bots on one side, the host alone on the other. The two bots
    // have a ring from the opening whistle; when the guest drops, its stand-in
    // joins them and the side needs a WIDER ring — a new object, because
    // `TeamRadio.members` is fixed at construction.
    const { room, clients } = start({
      seats: ['open', 'open', 'bot', 'bot'],
      teams: [0, 1, 1, 1],
      guests: 1,
    });
    const first = botIn(room, 2);
    const second = botIn(room, 3);
    const before = first.brain.radio!;
    expect(before.members).toEqual([2, 3]);

    const tuning = tuningFor(first.seat.personality);
    const at = 4;
    send(
      before,
      { kind: 'siege', from: 2, about: 2, pos: { x: 7, y: 9 }, seenAt: at },
      tuning.callLatency,
      tuning.callMissChance,
      { next: () => 1 },
    );
    expect(before.calls).toHaveLength(1);

    // The guest's phone locks mid-siege.
    clients[1]!.connection.close(now);
    const substitute = botIn(room, 1);
    const after = substitute.brain.radio!;
    expect(after, 'a wider side needs a wider ring').not.toBe(before);
    expect(after.members).toEqual([1, 2, 3]);
    expect(first.brain.radio, 'every bot on the side moved to it').toBe(after);
    expect(second.brain.radio).toBe(after);

    // …and the siege call that was in flight is still in flight. The side did not
    // stop existing because one of its pilots did.
    const fresh = tuningFor(second.seat.personality).memorySeconds;
    const heard = receive(after, 3, at + tuning.callLatency, fresh);
    expect(heard.map((c) => c.kind)).toEqual(['siege']);
    expect(heard[0]!.from).toBe(2);
    // The sequence carried too, so the total order `receive` sorts by is
    // continuous across the change rather than restarting at zero.
    expect(after.seq).toBe(before.seq);

    // The stand-in was not there to hear it, and does not pretend it was — the
    // `heardBy` mask was rolled among the members of the moment (`src/bots/radio`).
    expect(receive(after, 1, at + tuning.callLatency, fresh)).toHaveLength(0);
  });

  it('takes a reclaimed seat back off the channel', () => {
    const { room, clients } = start({
      seats: ['open', 'open', 'bot', 'bot'],
      teams: [0, 1, 0, 1],
      guests: 1,
    });
    const token = clients[1]!.socket.reclaimToken();
    if (!token) throw new Error('the guest was never issued a reclaim token');

    clients[1]!.connection.close(now);
    const ally = botIn(room, 3);
    expect(ally.brain.radio!.members).toEqual([1, 3]);

    // The pilot comes back inside the window: the stand-in lets go of the
    // controls, and the side is a lone bot again. Leaving the empty seat on the
    // roster would cost the survivor a miss roll per call for a seat that can no
    // longer hear one.
    const back = connect();
    back.connection.receive(
      encodeClientMessage({ type: 'join', room: room.code, reclaim: 1, reclaimToken: token }),
    );
    expect(room.botAt(1), 'the pilot has the controls back').toBeNull();
    expect(ally.brain.radio, 'a side of one bot is silent again').toBeNull();
  });
});
