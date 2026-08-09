/**
 * tests/server/room-cast.test.ts — the online room seats the CHARACTERS the host
 * picked, not merely their tiers. OWNER: Netcode Engineer (a0-06b; GDD §2.1
 * *amended 2026-08-07*, §2.9).
 *
 * THE BUG THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * a0-06 replaced the lobby's EASY / MEDIUM / HARD control with a character pick,
 * because a tier and a cast that can disagree is a control that lies: "before the
 * match, the host picks each bot's CHARACTER … and that character's difficulty is
 * **shown**". Offline that became unrepresentable — the seat stores one character
 * and the chip is derived from it.
 *
 * Online it survived, on the wire. `LobbyChoiceMessage` carried `botDifficulties`
 * and no character row, so `server/room.ts` `castFor` re-derived *a* character of
 * the named tier. There are **three Hard characters and one Hard tier**, so the
 * host who picked Sable got Vulture, and every existing test passed, because every
 * existing test asserted on the tier — which was right.
 *
 * **So every case below asserts on NAMES.** Asserting `botDifficulty === 'hard'`
 * is exactly what passes on the bug, and the tier assertions that remain here are
 * only ever the *second* half of a pair whose first half named a character.
 *
 * Driven through the real front door: `encodeClientMessage` → the server's own
 * `parseClientMessage` → `Room.receive`. The wire is the thing under test, so a
 * case that hand-built a `ClientMessage` and skipped the parser would prove the
 * room right about a message the wire might never deliver.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { PERSONALITIES, ROSTER, rosterAt, Difficulty } from '../../src/bots';
import type { PersonalityId } from '../../src/bots';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import { encodeWorldSnapshot } from '../../src/net/snapshot';
import type { LobbySlot, ServerMessage } from '../../src/net/transport';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';

/** The seed every room in this file is built with — one number, so "the same
 *  lobby twice" differs in nothing at all. */
const SEED = 0x5eed;

/** A socket that keeps what it was sent, and nothing else. */
class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {
    /* a room that closes a socket is another file's subject */
  }
  messages(): ServerMessage[] {
    const out: ServerMessage[] = [];
    for (const frame of this.frames) {
      const message = parseServerMessage(frame);
      if (message) out.push(message);
    }
    return out;
  }
}

interface Client {
  socket: FakeSocket;
  connection: Connection;
}

describe('an online room seats the cast the host picked (a0-06b)', () => {
  let server: MatchServer;
  let now = 1_000_000;

  const connect = (): Client => {
    const socket = new FakeSocket();
    return { socket, connection: server.connect(socket) };
  };

  /** A host alone in a fresh room, with seats 1..7 set to BOT. */
  const hostAlone = (): Client => {
    const code = server.createCode();
    const host = connect();
    host.connection.receive(encodeClientMessage({ type: 'join', room: code }));
    host.connection.receive(
      encodeClientMessage({
        type: 'lobbyChoice',
        shipClass: ShipClass.Vanguard,
        fireMode: 'manual',
        // Seat 0 is the host's chair; the other seven are bots (a0-11 — a seat
        // left OPEN takes the field with nothing, so a cast needs BOT seats to
        // land in).
        seats: ['open', 'bot', 'bot', 'bot', 'bot', 'bot', 'bot', 'bot'],
      }),
    );
    return host;
  };

  /** Name a cast, in bot-seat order, and press RUSH!. */
  const castAndStart = (
    host: Client,
    cast: { personalities?: readonly PersonalityId[]; difficulties?: readonly ('easy' | 'medium' | 'hard')[] },
  ): void => {
    host.connection.receive(
      encodeClientMessage({
        type: 'lobbyChoice',
        shipClass: ShipClass.Vanguard,
        fireMode: 'manual',
        ...(cast.difficulties ? { botDifficulties: cast.difficulties } : {}),
        ...(cast.personalities ? { botPersonalities: cast.personalities } : {}),
      }),
    );
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
  };

  /** The characters the room really seated, in seat order. */
  const seated = (host: Client): (PersonalityId | undefined)[] =>
    host.connection
      .room!.lobbyState()
      .filter((s: LobbySlot) => s.isBot)
      .map((s) => s.botPersonality);

  beforeEach(() => {
    now = 1_000_000;
    // A fixed seed: room codes and every world are the same on every run — the
    // whole file's determinism case depends on nothing here reaching for a clock
    // or `Math.random()` (GDD §4.1).
    server = new MatchServer({ seed: SEED, graceMs: 60_000, asteroidCount: 12 });
    server.update(now);
  });

  // --- 1. Exactly those characters ---------------------------------------

  it('seats exactly the named characters, not just their tiers', () => {
    // All seven Hard, but a SPECIFIC seven: the point is that these three names
    // in this order are not the order the tier alone would have produced.
    const wanted: PersonalityId[] = [
      'warden',
      'sable',
      'warden',
      'vulture',
      'sable',
      'warden',
      'vulture',
    ];
    const host = hostAlone();
    castAndStart(host, { personalities: wanted, difficulties: wanted.map(() => 'hard') });

    expect(host.connection.room?.state).toBe('live');
    expect(seated(host)).toEqual(wanted);

    // …and the assertion that USED to be the whole test still holds — the tier is
    // shown, and it is the seated character's own rather than a second opinion.
    for (const slot of host.connection.room!.lobbyState().filter((s) => s.isBot)) {
      expect(slot.botDifficulty).toBe(PERSONALITIES[slot.botPersonality!].difficulty);
      expect(slot.botDifficulty).toBe('hard');
    }

    // The guard that makes this case mean something: the tier-derived cast the
    // room built before a0-06b is a DIFFERENT list, so a regression cannot pass
    // this test by ignoring `botPersonalities` and getting lucky.
    const hardTier = rosterAt(Difficulty.Hard);
    const tierDerived = wanted.map((_, i) => hardTier[i % hardTier.length]);
    expect(tierDerived).not.toEqual(wanted);
  });

  it('flies each seated character its own hull, so the silhouette matches the name (GDD §2.11)', () => {
    const wanted: PersonalityId[] = ['warden', 'sable', 'rusty', 'vulture'];
    const host = hostAlone();
    castAndStart(host, { personalities: wanted });

    const bots = host.connection.room!.lobbyState().filter((s) => s.isBot);
    // Only the first four seats were named; check those, by name and by hull.
    for (let i = 0; i < wanted.length; i++) {
      expect(bots[i]?.botPersonality).toBe(wanted[i]);
      expect(bots[i]?.shipClass).toBe(PERSONALITIES[wanted[i]!].shipClass);
    }
  });

  // --- 2. Duplicates travel ------------------------------------------------

  it('two Wardens in, two Wardens out — the wire carries a repeat rather than collapsing it', () => {
    // 8 slots, 7 characters, and only three of them Hard, so the developer's own
    // balanced 4v4 of Hard bots is impossible WITHOUT a repeat (a0-06).
    const wanted: PersonalityId[] = ['warden', 'warden'];
    const host = hostAlone();
    host.connection.receive(
      encodeClientMessage({
        type: 'lobbyChoice',
        shipClass: ShipClass.Vanguard,
        fireMode: 'manual',
        seats: ['open', 'bot', 'bot', 'closed', 'closed', 'closed', 'closed', 'closed'],
      }),
    );
    castAndStart(host, { personalities: wanted });

    const cast = seated(host);
    expect(cast).toEqual(['warden', 'warden']);
    expect(new Set(cast).size).toBe(1); // the same character, twice, on purpose
    // Two distinct SEATS holding it — a collapse would have left one bot.
    expect(host.connection.room!.lobbyState().filter((s) => s.isBot)).toHaveLength(2);
  });

  it('carries a repeat through the parser itself, and refuses a name that is not in the cast', () => {
    // The wire is the trust boundary, so the duplicate has to survive JSON and
    // the allow-list has to be the roster — not `in PERSONALITIES`, which admits
    // `constructor` and seats a bot whose personality row is a function (a0-06).
    const host = hostAlone();
    for (const bogus of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
      host.connection.receive(
        encodeClientMessage({
          type: 'lobbyChoice',
          shipClass: ShipClass.Vanguard,
          fireMode: 'manual',
          botPersonalities: [bogus as PersonalityId, 'warden'],
        }),
      );
    }
    castAndStart(host, { personalities: ['warden', 'warden'] });

    // Every bogus cast was dropped whole at the parser, so the only cast the room
    // ever heard is the legal one — and every seated character is a real one.
    for (const seat of seated(host)) {
      expect(ROSTER).toContain(seat);
    }
    expect(seated(host).slice(0, 2)).toEqual(['warden', 'warden']);
  });

  // --- 3. An old client still gets a sane cast -----------------------------

  it('seats the tier-derived cast for a client that sends no botPersonalities', () => {
    const host = hostAlone();
    castAndStart(host, { difficulties: ['hard', 'hard', 'hard', 'easy', 'easy', 'medium', 'medium'] });

    const cast = seated(host);
    expect(cast).toHaveLength(7);
    // Sane: every seat holds a real character, and it is one of the tier asked for.
    for (let i = 0; i < cast.length; i++) {
      const id = cast[i]!;
      expect(ROSTER).toContain(id);
      expect(host.connection.room!.lobbyState().filter((s) => s.isBot)[i]?.botDifficulty).toBe(
        PERSONALITIES[id].difficulty,
      );
    }
    // Byte-for-byte the pre-a0-06b behaviour: index modulo the tier's own list.
    expect(cast).toEqual([
      ...rosterAt(Difficulty.Hard).slice(0, 3),
      ...[0, 1].map((i) => rosterAt(Difficulty.Easy)[(i + 3) % rosterAt(Difficulty.Easy).length]),
      ...[0, 1].map((i) => rosterAt(Difficulty.Medium)[(i + 5) % rosterAt(Difficulty.Medium).length]),
    ]);
  });

  it('seats roster order for a client that sends neither row', () => {
    const host = hostAlone();
    castAndStart(host, {});
    expect(seated(host)).toEqual(ROSTER.slice(0, 7));
  });

  it('falls back per SEAT, not wholesale, when the cast names fewer bots than the room seats', () => {
    const host = hostAlone();
    castAndStart(host, {
      personalities: ['warden', 'warden', 'sable'],
      difficulties: ['hard', 'hard', 'hard', 'easy', 'easy', 'easy', 'easy'],
    });

    const cast = seated(host);
    // The three the host named, by name…
    expect(cast.slice(0, 3)).toEqual(['warden', 'warden', 'sable']);
    // …and the four they did not, by the tier they did name. This is the half of
    // the rule that a whole-array fallback would have got wrong in silence.
    for (const id of cast.slice(3)) {
      expect(PERSONALITIES[id!].difficulty).toBe('easy');
    }
  });

  it('ignores a cast from anyone but the room creator', () => {
    const host = hostAlone();
    const code = host.connection.room!.code;
    const guest = connect();
    guest.connection.receive(encodeClientMessage({ type: 'join', room: code }));
    guest.connection.receive(
      encodeClientMessage({
        type: 'lobbyChoice',
        shipClass: ShipClass.Vanguard,
        fireMode: 'manual',
        botPersonalities: ['rusty', 'rusty', 'rusty', 'rusty', 'rusty', 'rusty'],
      }),
    );
    castAndStart(host, { personalities: ['warden', 'sable', 'vulture'] });

    // The host's cast, untouched by the guest's — a joiner cannot re-cast a room
    // any more than they can re-side it.
    expect(seated(host).slice(0, 3)).toEqual(['warden', 'sable', 'vulture']);
  });

  // --- 4. Determinism ------------------------------------------------------

  it('same seed, same lobby, same match — twice, online', () => {
    const wanted: PersonalityId[] = ['warden', 'warden', 'sable', 'vulture', 'foreman', 'rusty', 'bolt'];

    const run = (): { cast: (PersonalityId | undefined)[]; frames: string[] } => {
      server = new MatchServer({ seed: SEED, graceMs: 60_000, asteroidCount: 12 });
      server.update(now);
      const host = hostAlone();
      castAndStart(host, { personalities: wanted });

      const room = host.connection.room!;
      const frames: string[] = [];
      // Run the world forward and keep the authoritative snapshot every 10 ticks.
      // Bytes rather than eyeballed positions: a cast that differs by one bot
      // diverges the whole world, and the snapshot is where that shows up.
      for (let i = 0; i < 12; i++) {
        now += 100;
        server.update(now);
        const world = room.world;
        if (world) frames.push(Buffer.from(encodeWorldSnapshot(world)).toString('base64'));
      }
      return { cast: seated(host), frames };
    };

    const before = now;
    const first = run();
    now = before;
    const second = run();

    expect(first.cast).toEqual(wanted);
    expect(second.cast).toEqual(first.cast);
    expect(second.frames).toEqual(first.frames);
    expect(first.frames.length).toBeGreaterThan(0); // the run is not vacuously equal
  });

  it('a DIFFERENT cast on the same seed plays differently, so the determinism claim is not vacuous', () => {
    const play = (cast: readonly PersonalityId[]): string => {
      server = new MatchServer({ seed: SEED, graceMs: 60_000, asteroidCount: 12 });
      server.update(now);
      const host = hostAlone();
      castAndStart(host, { personalities: cast });
      const room = host.connection.room!;
      for (let i = 0; i < 40; i++) {
        now += 100;
        server.update(now);
      }
      return Buffer.from(encodeWorldSnapshot(room.world!)).toString('base64');
    };

    const before = now;
    const allEasy = play(['rusty', 'rusty', 'rusty', 'rusty', 'rusty', 'rusty', 'rusty']);
    now = before;
    const allHard = play(['warden', 'warden', 'warden', 'warden', 'warden', 'warden', 'warden']);

    expect(allHard).not.toBe(allEasy);
  });
});
