/**
 * src/net/session.test.ts — **the seat is yours while the match runs** (a0-72).
 * OWNER: Netcode Engineer (GDD §4.2).
 *
 * The developer, playing online on a phone:
 *
 *   *"on mobile i got disconnected because the screen went black, and when i went
 *   back i saw refused — the server would not take you back… that doesnt feel
 *   right to me, i should be able to join back if the match is still on-going no
 *   matter what"*
 *
 * The last sentence is the ruling this file holds the stack to, and the words that
 * matter in it are **no matter what**. Not "if you are quick enough", not "if the
 * grace window has not lapsed", not "if the pass you were handed a minute ago is
 * still warm". While the match runs and the seat is its owner's, they get back in.
 *
 * It is a real-stack file on purpose. Every piece of the rejoin was already unit
 * tested and green on the day the developer was refused — the reclaim door
 * (`tests/server/match-server.test.ts`), the redial (`./reconnect.test.ts`), the
 * welcome that carries the wallet (`./session.ts`) — because the thing that
 * refused them was **none of those pieces**: it was the 30-second ticket the
 * allocator signs, lapsing while the screen was off, in a gate none of those tests
 * reach. So this runs the shipped client (`createOnlineSession` →
 * `WebSocketTransport`) over real `node:net` sockets against the real `MatchServer`
 * running the real sim with **ticket enforcement armed**, and reproduces the way
 * the connection actually died: a page that stops running, and a socket that dies
 * behind it while nobody is listening.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { MatchServer } from '../../server/match-server';
import { HELD_FOR_MATCH } from '../../server/room';
import { attachWebSocketServer } from '../../server/ws';
import type { WsConnection } from '../../server/ws';
import { nodeWebSocket } from '../../tests/net/node-websocket';
import { signTicket } from './ticket';
import { createOnlineSession } from './session';
import type { OnlineSession } from './session';
import { VISIBILITY_STALE_MS, linkNotice, refusalTitle } from './link-loss';
import type { TicketRefresh, WebSocketLike } from './websocket-transport';

/** The allocator↔Machine key and the Machine's id, as a fleet deployment has them. */
const SECRET = 'a0-72-allocator-and-machine-share-this';
const MACHINE = 'a072machine01';

/**
 * How long a ticket lives in this file. Production is 30 s
 * (`allocator/allocator.ts` `DEFAULT_TICKET_TTL_MS`) and the developer's own log
 * shows `expiresInMs: 30060`; here it is 250 ms so the *lapse* — the only part of
 * that number this file is about — is reproduced in a quarter second instead of
 * half a minute. The TTL stays deliberately short: a pass that expires quickly is
 * the security property, and a0-72 re-mints it rather than stretching it.
 */
const TICKET_TTL_MS = 250;

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what: string, ok: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await sleep(10);
  }
}

/** A ticket the way the allocator signs one: this room, this Machine, ticking. */
function mintTicket(room: string, ttlMs = TICKET_TTL_MS): string {
  return signTicket({ room, machine: MACHINE, expiresAt: Date.now() + ttlMs }, SECRET);
}

/**
 * A **ticket-enforcing** match server on a real port, ticked in real time — the
 * fleet shape, which is the only shape in which the developer's refusal exists
 * (`MatchServer.admitsJoin` is a no-op without a secret).
 */
async function startFleetMachine(): Promise<{
  url: string;
  matches: MatchServer;
  stop(): Promise<void>;
}> {
  const matches = new MatchServer({
    seed: 0xa072,
    slots: 2,
    asteroidCount: 12,
    ticketSecret: SECRET,
    machineId: MACHINE,
  });
  const connections: WsConnection[] = [];
  const http: Server = createServer((_request, response) => {
    response.writeHead(200);
    response.end('ok');
  });
  attachWebSocketServer(http, (connection) => {
    connections.push(connection);
    const client = matches.connect(connection);
    connection.onMessage((frame) => client.receive(frame));
    connection.onClose(() => client.close(Date.now()));
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  const loop = setInterval(() => matches.update(Date.now()), 1000 / 60);
  return {
    url: `ws://127.0.0.1:${address.port}/play`,
    matches,
    stop: async (): Promise<void> => {
      clearInterval(loop);
      for (const connection of connections) connection.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/**
 * The socket a **backgrounded page** leaves behind, and the reason this file does
 * not simply hang up.
 *
 * A hang-up fires `onclose`, the transport redials within a second, and the rejoin
 * lands before anything can lapse — which is why every existing reconnect test was
 * green through the whole of the developer's bug. A suspended page runs no
 * handlers at all: the screen blanks, the tab is frozen, the radio drops the TCP
 * connection, and the client learns none of it. `transport.state` still reads
 * `open`. What the client does next happens *when the player comes back*, however
 * long that is — and that gap is the entire failure.
 */
function suspendableSocket(url: string): WebSocketLike & { suspend(): void } {
  const inner = nodeWebSocket(url);
  let suspended = false;
  const outer: WebSocketLike & { suspend(): void } = {
    binaryType: 'arraybuffer',
    send: (data) => {
      if (!suspended) inner.send(data);
    },
    close: () => inner.close(),
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    suspend: () => {
      suspended = true;
      // Frozen first, and only then does the connection die — so not one handler
      // on this object is ever called again.
      setTimeout(() => inner.close(), 20);
    },
  };
  inner.onopen = (e): void => {
    if (!suspended) outer.onopen?.(e);
  };
  inner.onmessage = (e): void => {
    if (!suspended) outer.onmessage?.(e);
  };
  inner.onerror = (e): void => {
    if (!suspended) outer.onerror?.(e);
  };
  inner.onclose = (e): void => {
    if (!suspended) outer.onclose?.(e);
  };
  return outer;
}

describe('session — rejoin while the match runs (a0-72)', () => {
  it('a dropped player can always come back while the match runs', async () => {
    const machine = await startFleetMachine();
    const room = 'RUSH';
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await machine.stop();
    };

    let live: (WebSocketLike & { suspend(): void }) | null = null;
    let mints = 0;
    const player = createOnlineSession({
      url: machine.url,
      room,
      shipClass: ShipClass.Interceptor,
      transport: {
        ticket: mintTicket(room),
        // What `allocatorTransport` wires to `POST /rooms/:code/join` in the real
        // client: a **current** pass for the same room, minted per redial.
        refreshTicket: async (): Promise<TicketRefresh> => {
          mints++;
          return { ok: true, ticket: mintTicket(room) };
        },
        // And what it wires to `GET /rooms/:code`: the room is still there.
        checkRoomAlive: async () => 'live' as const,
        connect: (url): WebSocketLike => {
          const socket = suspendableSocket(url);
          live = socket;
          return socket;
        },
        retryBaseMs: 100,
        retryMaxMs: 250,
      },
    });
    sessions.push(player);

    let welcomes = 0;
    const refusals: string[] = [];
    player.observe((message) => {
      if (message.type === 'welcome') welcomes++;
      if (message.type === 'joinError') refusals.push(message.reason);
    });

    await until('the welcome', () => welcomes > 0);
    const seat = player.you;
    // One human, one bot: a match that keeps running while its only player is away.
    player.chooseInLobby({ shipClass: ShipClass.Interceptor, seats: ['open', 'bot'] });
    await sleep(120);
    player.startMatch();

    const match = machine.matches.room(room);
    if (!match) throw new Error('the room never opened');
    await until('the match to start', () => match.world !== null && player.world !== null);

    // Stamp the wallet and a tier on authority, so "did the ship come back?" has an
    // answer a fresh spawn could not fake.
    const ship = match.world?.ships.find((s) => s.id === seat);
    if (!ship) throw new Error('no authoritative ship for the seat');
    ship.banked = 42;
    const track = Object.keys(ship.tiers)[0]!;
    (ship.tiers as Record<string, number>)[track] = 3;

    // --- The screen goes black ----------------------------------------------
    player.linkHidden();
    (live as unknown as { suspend(): void }).suspend();
    await until('the server to notice and seat a bot', () => match.lobbyState()[seat]?.isBot === true);

    // **The seat has no deadline on it.** Not a long one — none: an hour from now
    // it is still being held, and the sweep that runs every update will not take
    // it, because there is nothing to sweep past (`server/room.ts`
    // `HELD_FOR_MATCH`). This is the ruling in the one place it is decided.
    expect(match.seatHeldForMatch(seat)).toBe(true);
    expect(match.graceRemaining(seat, Date.now() + 3_600_000)).toBe(HELD_FOR_MATCH);
    expect(match.hasPendingReclaim).toBe(true);
    expect(match.state).toBe('live');

    // And the pass this client is holding goes stale while the screen is off —
    // the exact state the developer's phone came back in, and the one that used to
    // answer `bad-ticket`. The wait also clears `VISIBILITY_STALE_MS`, which is
    // what makes the return a *diagnosis* (`backgrounded`) rather than a tab that
    // blinked (`./link-loss` `shown`).
    await sleep(Math.max(TICKET_TTL_MS, VISIBILITY_STALE_MS) + 200);

    // --- …and the player comes back ------------------------------------------
    const backAt = Date.now();
    player.linkShown(backAt);
    // The overlay says the true thing while it works: held, not counting down.
    const backNotice = linkNotice(player.link);
    expect(player.link.heldForMatch).toBe(true);
    expect(backNotice.detail).toContain('for as long as the match runs');
    expect(backNotice.grace).toBe('');

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && welcomes < 2) {
      player.pollLink(Date.now());
      await sleep(50);
    }

    // THE RULING: the match was still running and the seat was still theirs, so
    // they are back in it. Not refused, not once.
    expect(refusals).toEqual([]);
    expect(welcomes).toBeGreaterThanOrEqual(2);
    expect(player.state).toBe('open');
    expect(mints).toBeGreaterThan(0); // …on a pass minted for the return, not for the first dial
    await until('the bot to hand the controls back', () => match.lobbyState()[seat]?.isBot === false);
    expect(match.seatHeldForMatch(seat)).toBe(false);

    // The wallet and the tiers survive, because the ship was never touched — only
    // the hands on it changed (GDD §4.2). Authority first: the same ship object.
    expect(match.world?.ships.find((s) => s.id === seat)).toBe(ship);
    expect(ship.cargo + ship.banked).toBeCloseTo(42, 9);
    expect((ship.tiers as Record<string, number>)[track]).toBe(3);

    // …and then what the player is actually flying, which is the half they see: the
    // reclaim `welcome` carries the wallet and `matchStart` stamps it onto the
    // rebuilt predicted ship (`./session` `beginPredicting`).
    await until(
      'the client to be flying its own wallet again',
      () => {
        const mine = player.world?.ships.find((s) => s.id === player.you);
        return mine !== undefined && mine.cargo + mine.banked > 0;
      },
      10_000,
    );
    const mine = player.world?.ships.find((s) => s.id === player.you);
    expect(mine).toBeDefined();
    expect(mine!.cargo + mine!.banked).toBeCloseTo(ship.cargo + ship.banked, 1);
    expect((mine!.tiers as Record<string, number>)[track]).toBe(3);
  }, 60_000);

  it('lets a returning owner in on a lapsed ticket, with no allocator to ask', async () => {
    // The half of the fix that does not depend on a third service being up. A phone
    // coming back through a captive portal, or an allocator having a bad afternoon,
    // still reaches the Machine that is holding its seat — and that Machine can
    // check the routing claim against its own room table instead of against a clock.
    const machine = await startFleetMachine();
    const room = 'HOLD';
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await machine.stop();
    };

    let live: (WebSocketLike & { suspend(): void }) | null = null;
    const player = createOnlineSession({
      url: machine.url,
      room,
      shipClass: ShipClass.Interceptor,
      transport: {
        ticket: mintTicket(room),
        // No `refreshTicket`, and no liveness probe: the direct shape, with nobody
        // to ask for a new pass.
        connect: (url): WebSocketLike => {
          const socket = suspendableSocket(url);
          live = socket;
          return socket;
        },
        retryBaseMs: 100,
        retryMaxMs: 250,
      },
    });
    sessions.push(player);

    let welcomes = 0;
    const refusals: string[] = [];
    player.observe((message) => {
      if (message.type === 'welcome') welcomes++;
      if (message.type === 'joinError') refusals.push(message.reason);
    });

    await until('the welcome', () => welcomes > 0);
    const seat = player.you;
    player.chooseInLobby({ shipClass: ShipClass.Interceptor, seats: ['open', 'bot'] });
    await sleep(120);
    player.startMatch();
    const match = machine.matches.room(room);
    if (!match) throw new Error('the room never opened');
    await until('the match to start', () => match.world !== null && player.world !== null);

    player.linkHidden();
    (live as unknown as { suspend(): void }).suspend();
    await until('the bot to take the seat', () => match.lobbyState()[seat]?.isBot === true);
    await sleep(Math.max(TICKET_TTL_MS, VISIBILITY_STALE_MS) + 200); // the pass lapses while the screen is off

    player.linkShown(Date.now());
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && welcomes < 2) {
      player.pollLink(Date.now());
      await sleep(50);
    }
    expect(refusals).toEqual([]);
    expect(welcomes).toBeGreaterThanOrEqual(2);
    await until('the bot to hand the controls back', () => match.lobbyState()[seat]?.isBot === false);
  }, 45_000);

  it('still refuses a forged or wrong-room ticket, lapsed or not', () => {
    // The exception a0-72 opens is exactly one door wide. Everything the ticket gate
    // was protecting is still protected: a doubt is still a refusal.
    const matches = new MatchServer({
      seed: 1,
      slots: 2,
      ticketSecret: SECRET,
      machineId: MACHINE,
    });
    const fresh = signTicket({ room: 'AAAA', machine: MACHINE, expiresAt: 1_000 }, SECRET);
    const forged = signTicket({ room: 'AAAA', machine: MACHINE, expiresAt: 1_000 }, 'not-the-key');
    const elsewhere = signTicket({ room: 'AAAA', machine: 'another-machine', expiresAt: 1_000 }, SECRET);
    const otherRoom = signTicket({ room: 'BBBB', machine: MACHINE, expiresAt: 1_000 }, SECRET);

    matches.update(500); // inside the window
    expect(matches.admitsJoin('AAAA', fresh)).toBe(true);
    expect(matches.admitsJoin('AAAA', forged)).toBe(false);
    expect(matches.admitsJoin('AAAA', elsewhere)).toBe(false);
    expect(matches.admitsJoin('AAAA', otherRoom)).toBe(false);
    expect(matches.admitsJoin('AAAA', undefined)).toBe(false);

    matches.update(2_000); // the pass has lapsed
    // A fresh join on a lapsed pass is refused exactly as it always was…
    expect(matches.admitsJoin('AAAA', fresh)).toBe(false);
    // …and so is a *reclaim* into a room this Machine does not host, because then
    // the routing claim is the one thing that cannot be checked.
    expect(matches.admitsJoin('AAAA', fresh, true)).toBe(false);
    // The door opens only once the room is genuinely here.
    matches.openRoom('AAAA');
    expect(matches.admitsJoin('AAAA', fresh, true)).toBe(true);
    // And never for a pass this Machine cannot vouch for.
    expect(matches.admitsJoin('AAAA', forged, true)).toBe(false);
    expect(matches.admitsJoin('AAAA', elsewhere, true)).toBe(false);
    expect(matches.admitsJoin('AAAA', otherRoom, true)).toBe(false);
  });

  it('says something true and specific when the match really is over', () => {
    // The refusal that survives the ruling, in the player's own terms. The old card
    // said "REFUSED — the server would not take you back" to everybody, including
    // the developer whose match was still running; what is left after a0-72 is a
    // refusal with a cause, and the cause is what the card names.
    expect(refusalTitle('match-over')).toBe('MATCH OVER — it finished while you were away');
    expect(refusalTitle('reclaim-unknown')).toBe('MATCH ENDED — that room is no longer running');
    expect(refusalTitle('reclaim-denied')).toBe('SEAT TAKEN — somebody else is flying it');
    expect(refusalTitle('reclaim-expired')).toContain('you left this match');
    // A reason this build has never heard of still prints the token rather than
    // inventing a sentence for it.
    expect(refusalTitle('some-future-reason')).toContain('some-future-reason');

    const refused = linkNotice({
      phase: 'expired',
      cause: 'backgrounded',
      silentMs: 90_000,
      graceRemainingMs: 0,
      attempts: 2,
      manualRedial: 'none',
      ending: 'join-rejected',
      heldForMatch: true,
      refusal: 'match-over',
    });
    expect(refused.title).toBe('MATCH OVER — it finished while you were away');
    expect(refused.detail).toContain('held the whole time the match ran');
    // Not one word of the sentence that was wrong.
    expect(refused.detail).not.toContain('reconnect window closed');
  });
});
