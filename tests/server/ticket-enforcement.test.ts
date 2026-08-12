/**
 * tests/server/ticket-enforcement.test.ts — a Machine refuses any join it was
 * not sent. OWNER: Netcode Engineer (M9 fleet membership; GDD §4.2).
 *
 * The moment there is more than one Machine behind an allocator, "which Machine
 * hosts this room?" becomes a decision an attacker would love to make: name
 * someone else's Machine, name a room you were never allocated. The allocator
 * makes that decision and signs it into a ticket (`src/net/ticket.ts`); a
 * Machine that enforces admits only a join carrying a ticket it can verify.
 *
 * The switch is one thing and one thing only: a `TICKET_SECRET`. Set, and the
 * gate is closed and **fails closed** — a missing, forged, tampered, expired, or
 * misaddressed ticket is refused, and refused *before* a room is even created.
 * Unset — the solo/offline path, or a self-hosted single Machine — and every
 * join is admitted with no ceremony, because there is no routing decision to
 * sign. Both halves are pinned below.
 *
 * The regression this file exists to catch (brief, Task 7 Step 3b): the ticket
 * has to survive `parseClientMessage`, which rebuilds a join from a fixed list
 * of fields and drops the rest. A ticket the parser ignores never reaches the
 * Machine, and a Machine that fails closed then refuses *every* join. So these
 * tests drive the real wire path — `encodeClientMessage` in, the server's own
 * parser out — and a passing "valid ticket is admitted" proves the ticket
 * arrived intact.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { signTicket } from '../../src/net/ticket';
import type { ServerMessage } from '../../src/net/transport';
import { MAX_TICKET_LENGTH, encodeClientMessage, parseClientMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';

const SECRET = 'allocator-and-machine-share-this';
const MACHINE = 'iad-7';
const NOW = 1_000_000;
/** A room code the seeded server will not have minted — the ticket names it and
 *  the client joins it, so an admitted join opens exactly this room. */
const ROOM = 'K7QM';

/** A socket that keeps what it was sent — the whole network layer, for a test. */
class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  closed = false;

  send(frame: WireFrame): void {
    this.frames.push(frame);
  }

  close(): void {
    this.closed = true;
  }

  /** The `joinError` courtesy frames (outside the ratified `ServerMessage` union). */
  errors(): { type: string; reason: string }[] {
    return this.frames
      .filter((f): f is string => typeof f === 'string')
      .map((f) => JSON.parse(f) as { type: string; reason: string })
      .filter((m) => m.type === 'joinError');
  }

  /** Did the server welcome this socket into a seat? */
  welcomed(): boolean {
    return this.frames
      .filter((f): f is string => typeof f === 'string')
      .some((f) => (JSON.parse(f) as ServerMessage).type === 'welcome');
  }
}

describe('ticket enforcement — a Machine refuses any join it was not sent', () => {
  /** Mint a ticket the way the allocator would, against this test's clock. */
  const mint = (over: Partial<{ room: string; machine: string; expiresAt: number }> = {}): string =>
    signTicket(
      { room: ROOM, machine: MACHINE, expiresAt: NOW + 30_000, ...over },
      SECRET,
    );

  // --- The switch is the secret, and nothing else -------------------------

  describe('with no TICKET_SECRET — the solo / self-hosted path', () => {
    let server: MatchServer;

    beforeEach(() => {
      server = new MatchServer({ seed: 0x5eed });
      server.update(NOW);
    });

    it('is not enforcing, and admits a plain join with no ticket at all', () => {
      expect(server.enforcingTickets).toBe(false);
      const socket = new FakeSocket();
      const conn = server.connect(socket);
      conn.receive(encodeClientMessage({ type: 'join', room: ROOM }));

      expect(socket.welcomed()).toBe(true);
      expect(socket.errors()).toHaveLength(0);
      expect(server.roomCount).toBe(1);
    });
  });

  // --- Enforcing: the ticket decides --------------------------------------

  describe('with a TICKET_SECRET set — a fleet Machine', () => {
    let server: MatchServer;

    beforeEach(() => {
      server = new MatchServer({ seed: 0x5eed, ticketSecret: SECRET, machineId: MACHINE });
      server.update(NOW);
    });

    const attempt = (ticket: string | undefined, room = ROOM): FakeSocket => {
      const socket = new FakeSocket();
      const conn: Connection = server.connect(socket);
      conn.receive(
        encodeClientMessage({ type: 'join', room, ...(ticket !== undefined ? { ticket } : {}) }),
      );
      return socket;
    };

    it('admits a join bearing a valid ticket for this room and this Machine', () => {
      expect(server.enforcingTickets).toBe(true);
      const socket = attempt(mint());

      expect(socket.welcomed()).toBe(true);
      expect(socket.errors()).toHaveLength(0);
      expect(server.roomCount).toBe(1);
    });

    it('refuses a join with no ticket — and opens no room (fails closed)', () => {
      const socket = attempt(undefined);

      expect(socket.welcomed()).toBe(false);
      expect(socket.errors()[0]?.reason).toBe('bad-ticket');
      // The gate is before room creation: an unsent join cannot spend memory.
      expect(server.roomCount).toBe(0);
    });

    it('refuses a ticket signed under a different secret', () => {
      const forged = signTicket(
        { room: ROOM, machine: MACHINE, expiresAt: NOW + 30_000 },
        'not-the-shared-secret',
      );
      const socket = attempt(forged);

      expect(socket.errors()[0]?.reason).toBe('bad-ticket');
      expect(server.roomCount).toBe(0);
    });

    it('refuses a tampered ticket — one edited byte breaks the signature', () => {
      const ticket = mint();
      // Flip a character in the payload segment; the HMAC no longer matches.
      const tampered = `${ticket.slice(0, 1) === 'A' ? 'B' : 'A'}${ticket.slice(1)}`;
      const socket = attempt(tampered);

      expect(socket.errors()[0]?.reason).toBe('bad-ticket');
      expect(server.roomCount).toBe(0);
    });

    it('refuses a ticket that has expired at the server clock', () => {
      const socket = attempt(mint({ expiresAt: NOW })); // expiresAt <= now is stale

      expect(socket.errors()[0]?.reason).toBe('bad-ticket');
      expect(server.roomCount).toBe(0);
    });

    it('refuses a ticket minted for a different room', () => {
      // The ticket is well-signed but names ABCD; the client joins K7QM.
      const socket = attempt(mint({ room: 'ABCD' }), ROOM);

      expect(socket.errors()[0]?.reason).toBe('bad-ticket');
      expect(server.roomCount).toBe(0);
    });

    it('refuses a ticket minted for a different Machine', () => {
      const socket = attempt(mint({ machine: 'ord-2' }));

      expect(socket.errors()[0]?.reason).toBe('bad-ticket');
      expect(server.roomCount).toBe(0);
    });
  });

  // --- a0-26 Milestone A: a join-intent ticket may not create a room -------

  /**
   * The measured failure this closes (`spikes/lobby-browser/measure-listing.ts`
   * §2): a host opens a room and closes the tab in the lobby, the room is swept
   * on the next update, and for up to one heartbeat the allocator still hands out
   * a ticket for it. Today that ticket *creates the room again* and the player
   * sits alone in an empty lobby. Nothing errors. With the intent claim, a ticket
   * the allocator signed as a `join` is refused on an unknown code, and — the
   * half that matters most — **no room is created**.
   */
  describe('the dead-room refusal (a0-26 Milestone A)', () => {
    const intended = (
      server: MatchServer,
      intent: 'create' | 'join' | undefined,
    ): FakeSocket => {
      const socket = new FakeSocket();
      const ticket = signTicket(
        {
          room: ROOM,
          machine: MACHINE,
          expiresAt: NOW + 30_000,
          ...(intent !== undefined ? { intent } : {}),
        },
        SECRET,
      );
      server.connect(socket).receive(encodeClientMessage({ type: 'join', room: ROOM, ticket }));
      return socket;
    };

    it('refuses a join-intent ticket for a room this Machine does not host — and creates nothing', () => {
      const server = new MatchServer({ seed: 0x5eed, ticketSecret: SECRET, machineId: MACHINE });
      server.update(NOW);

      const socket = intended(server, 'join');

      expect(socket.welcomed()).toBe(false);
      expect(socket.errors()[0]?.reason).toBe('room-gone');
      // The whole point: the dead row was not silently resurrected.
      expect(server.roomCount).toBe(0);
      expect(server.roomLoads()).toEqual([]);
    });

    it('admits a join-intent ticket for a room that is really there', () => {
      const server = new MatchServer({ seed: 0x5eed, ticketSecret: SECRET, machineId: MACHINE });
      server.update(NOW);
      // The host arrives first, on a create-intent ticket, and the room exists.
      expect(intended(server, 'create').welcomed()).toBe(true);

      const guest = intended(server, 'join');

      expect(guest.welcomed()).toBe(true);
      expect(guest.errors()).toHaveLength(0);
      expect(server.roomCount).toBe(1);
    });

    it('opens the room on a create-intent ticket, exactly as HOST always has', () => {
      const server = new MatchServer({ seed: 0x5eed, ticketSecret: SECRET, machineId: MACHINE });
      server.update(NOW);

      const socket = intended(server, 'create');

      expect(socket.welcomed()).toBe(true);
      expect(server.roomCount).toBe(1);
    });

    it('opens the room on a ticket with no intent at all — a pre-a0-26 client', () => {
      const server = new MatchServer({ seed: 0x5eed, ticketSecret: SECRET, machineId: MACHINE });
      server.update(NOW);

      const socket = intended(server, undefined);

      expect(socket.welcomed()).toBe(true);
      expect(server.roomCount).toBe(1);
    });

    it('changes nothing on a Machine with no ticket secret — the self-hosted path', () => {
      const server = new MatchServer({ seed: 0x5eed });
      server.update(NOW);
      // A join-intent ticket cannot even be checked here (no secret to verify
      // under), and an unticketed join is how solo/self-hosted has always worked.
      const socket = new FakeSocket();
      server.connect(socket).receive(encodeClientMessage({ type: 'join', room: ROOM }));

      expect(socket.welcomed()).toBe(true);
      expect(server.roomCount).toBe(1);
    });
  });

  // --- Step 3b: the parser must carry the ticket through ------------------

  describe('parseClientMessage carries the ticket (Task 7 Step 3b)', () => {
    it('round-trips a bounded ticket verbatim through the front door', () => {
      const ticket = mint();
      const parsed = parseClientMessage(encodeClientMessage({ type: 'join', room: ROOM, ticket }));
      expect(parsed).toEqual({ type: 'join', room: ROOM, ticket });
    });

    it('drops a join whose ticket is longer than the wire will bound', () => {
      const overlong = 'x'.repeat(MAX_TICKET_LENGTH + 1);
      expect(
        parseClientMessage(encodeClientMessage({ type: 'join', room: ROOM, ticket: overlong })),
      ).toBeNull();
    });

    it('keeps a plain join a plain join — no ticket field appears', () => {
      const parsed = parseClientMessage(encodeClientMessage({ type: 'join', room: ROOM }));
      expect(parsed).toEqual({ type: 'join', room: ROOM });
      expect(parsed && 'ticket' in parsed).toBe(false);
    });
  });
});
