/**
 * tests/server/room-listed.test.ts — **PUBLIC / PRIVATE is the host's, and only
 * while the room is still a lobby.** OWNER: Netcode Engineer (a0-26 D1;
 * `docs/lobby-browser-plan.md` §2, Milestone B2/B3).
 *
 * The developer ruled the browser's privacy model: **public by default, with a
 * PRIVATE toggle**, and the toggle is **creator-only and lobby-phase only**. That
 * is three separate facts, and each of them is a way for a room to end up
 * published against its host's wishes:
 *
 *   1. a room nobody has touched must advertise itself as listable, because an
 *      open room nobody can find quietly becomes a solo match at RUSH! (a0-11);
 *   2. a **guest** must not be able to flip it, or one joiner could publish — or
 *      hide — a room that is not theirs;
 *   3. a flip after RUSH! must do nothing, because match shape is settled before
 *      the sim exists and a live room is not on anyone's list to begin with.
 *
 * What rides out on the heartbeat is asserted here too, because the flag is
 * worthless if the allocator never hears it: `roomLoads()` is the exact shape the
 * beat carries (`server/heartbeat.ts` `HeartbeatRoom`), and the encoding is
 * *absent means listed* — so a PUBLIC room spends no bytes and a Machine older
 * than a0-26 keeps listing exactly as it does today.
 *
 * The flag is **visibility, never reachability**: nothing here may change what a
 * room does with a code. That half is pinned at the foot of the file.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { encodeClientMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';

/** A socket that keeps what it was sent; this file asserts on the room's state. */
class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {
    /* nothing to tear down in-process */
  }
}

const NOW = 1_000_000;

describe('the PRIVATE toggle (a0-26 D1)', () => {
  let server: MatchServer;
  let code: string;

  beforeEach(() => {
    server = new MatchServer({ seed: 0x5eed, slots: 4 });
    server.update(NOW);
    code = server.createCode();
  });

  /** Seat a connection in the room; the first one to arrive is the creator. */
  const arrive = (): Connection => {
    const conn = server.connect(new FakeSocket());
    conn.receive(encodeClientMessage({ type: 'join', room: code }));
    return conn;
  };

  /** A `lobbyChoice` carrying a visibility opinion (and the two required fields). */
  const choose = (conn: Connection, listed?: boolean): void => {
    conn.receive(
      encodeClientMessage({
        type: 'lobbyChoice',
        shipClass: ShipClass.Vanguard,
        fireMode: 'manual',
        ...(listed !== undefined ? { listed } : {}),
      }),
    );
  };

  /** What the heartbeat would say about this room right now. */
  const load = (): { listed?: boolean } => server.roomLoads()[0]!;

  it('a room nobody has touched is listed — the ruled default', () => {
    arrive();
    expect(server.room(code)?.listed).toBe(true);
  });

  it('spends no heartbeat bytes on a public room — absent reads as listed', () => {
    arrive();
    expect('listed' in load()).toBe(false);
  });

  it('the creator flips it, and the next heartbeat carries it', () => {
    choose(arrive(), false);

    expect(server.room(code)?.listed).toBe(false);
    expect(load().listed).toBe(false);
  });

  it('the creator can flip it back', () => {
    const host = arrive();
    choose(host, false);
    choose(host, true);

    expect(server.room(code)?.listed).toBe(true);
    expect('listed' in load()).toBe(false);
  });

  it("ignores a guest's opinion — a joiner may not publish or hide the room", () => {
    arrive(); // the creator, who says nothing
    const guest = arrive();

    choose(guest, false);

    expect(server.room(code)?.listed).toBe(true);
  });

  it("ignores a guest trying to publish a room the host made private", () => {
    const host = arrive();
    const guest = arrive();
    choose(host, false);

    choose(guest, true);

    expect(server.room(code)?.listed).toBe(false);
  });

  it('leaves the flag alone when the message carries no opinion', () => {
    const host = arrive();
    choose(host, false);

    choose(host, undefined); // a plain hull pick, as every pre-a0-26 client sends

    expect(server.room(code)?.listed).toBe(false);
  });

  it('drops a non-boolean rather than coercing it — a truthy string is not consent', () => {
    const host = arrive();
    choose(host, false);

    // Straight down the wire, past the typed helper: this is what a stale or
    // hostile client actually sends, and the front door is what must refuse it.
    host.receive(
      JSON.stringify({
        type: 'lobbyChoice',
        shipClass: ShipClass.Vanguard,
        fireMode: 'manual',
        listed: 'yes',
      }),
    );

    expect(server.room(code)?.listed).toBe(false);
  });

  it('ignores a flip once the match is live — match shape is settled at RUSH!', () => {
    const host = arrive();
    // A room that cannot field two participants does not start (GDD §2.1), so
    // the host authors one bot seat — the a0-11 shape, seated only at RUSH!.
    host.receive(
      encodeClientMessage({
        type: 'lobbyChoice',
        shipClass: ShipClass.Vanguard,
        fireMode: 'manual',
        seats: ['open', 'bot', 'closed', 'closed'],
      }),
    );
    host.receive(encodeClientMessage({ type: 'startMatch' }));
    expect(server.room(code)?.state).toBe('live');

    choose(host, false);

    expect(server.room(code)?.listed).toBe(true);
  });

  it('is visibility, never reachability — a private room still takes its code', () => {
    const host = arrive();
    choose(host, false);

    const guest = server.connect(new FakeSocket());
    guest.receive(encodeClientMessage({ type: 'join', room: code }));

    // Two humans in the room: PRIVATE hides a room from the browser and does
    // nothing whatsoever to the code path a1-13 evidenced.
    expect(server.roomLoads()[0]?.players).toBe(2);
  });
});
