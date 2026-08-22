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
import { HELD_FOR_MATCH, SEAT_SILENCE_MS } from '../../server/room';
import { attachWebSocketServer } from '../../server/ws';
import type { WsConnection } from '../../server/ws';
import { nodeWebSocket } from '../../tests/net/node-websocket';
import { signTicket } from './ticket';
import { createOnlineSession } from './session';
import type { OnlineSession } from './session';
import { VISIBILITY_STALE_MS, linkNotice, refusalTitle } from './link-loss';
import { memorySeatStorage, seatMemory } from './seat-memory';
import type { TicketRefresh, WebSocketLike } from './websocket-transport';
import { createServer as createTcpServer, connect as tcpConnect } from 'node:net';
import type { Socket } from 'node:net';
import { attachLinkLoss } from './link-loss-attach';
import { LINK_LOSS_BUTTON_IDS, LINK_LOSS_ROOT_ID, LINK_LOSS_TITLE_ID } from './link-loss-view';
import type { LinkLossDom } from './link-loss-view';
import type { TraceElement } from './connect-trace-view';

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

// ---------------------------------------------------------------------------
// a0-132 — when the line drops, say so. On both screens.
// ---------------------------------------------------------------------------

/**
 * **The cut that sends nothing.** Two TCP connections that stay open while not one
 * byte crosses between them — a screen that locked, a tab in the background, a
 * phone in a tunnel, a cellular handover that failed.
 *
 * This is the drop GDD §4.2 puts reconnect grace in scope *for*, and it is not the
 * drop the rest of this suite stages. A hang-up (`suspendableSocket` above, or QA's
 * `context.setOffline`) sends a FIN, and a FIN is a *message*: both ends learn
 * within a millisecond. A real mobile drop sends no message at all, which is
 * precisely what makes it hard — the only evidence either end ever gets is that
 * nothing is arriving any more.
 */
function blackholeProxy(targetPort: number): {
  listen(): Promise<number>;
  cut(): void;
  stop(): void;
} {
  const pairs: { near: Socket; far: Socket }[] = [];
  let cut = false;
  const server = createTcpServer((near) => {
    const far = tcpConnect(targetPort, '127.0.0.1');
    pairs.push({ near, far });
    near.on('data', (chunk) => {
      if (!cut) far.write(chunk);
    });
    far.on('data', (chunk) => {
      if (!cut) near.write(chunk);
    });
    // Nothing is propagated on error or close either: a blackhole that forwarded a
    // hang-up would be the FIN case wearing this one's name.
    near.on('error', () => {});
    far.on('error', () => {});
  });
  return {
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (address === null || typeof address === 'string') throw new Error('no port');
          resolve(address.port);
        });
      }),
    cut: () => {
      cut = true;
    },
    stop: () => {
      for (const pair of pairs) {
        pair.near.destroy();
        pair.far.destroy();
      }
      server.close();
    },
  };
}

/**
 * A page whose game root is **fullscreen** — which on touch is the ordinary state
 * of a match, because PLAY enters fullscreen on `#app` (`@platform/fullscreen`).
 *
 * Small enough to read, and it models exactly the one thing that matters: a
 * document has a `body`, and it may also have a `fullscreenElement`, and those are
 * two different parents. What it deliberately does NOT model is painting — no fake
 * DOM can, which is why this bug survived a green unit suite and had to be
 * photographed (a0-131) before anyone knew it was there. What this can hold the code
 * to is the rule that decides the painting: **the card is appended to the element in
 * the top layer, not to a sibling of it.**
 */
function fullscreenPage(): {
  dom: LinkLossDom;
  gameRoot: FakeElement;
  body: FakeElement;
  /** Where the overlay actually is, by element id, or null if it is nowhere. */
  parentOf(id: string): string | null;
  enterFullscreen(): void;
  leaveFullscreen(): void;
} {
  const byId = new Map<string, FakeElement>();
  const body = new FakeElement('body', byId);
  const gameRoot = new FakeElement('app', byId);
  body.appendChild(gameRoot);
  let fullscreen: FakeElement | null = gameRoot;
  const dom: LinkLossDom = {
    createElement: (): TraceElement => new FakeElement('', byId) as unknown as TraceElement,
    getElementById: (id: string): TraceElement | null =>
      (byId.get(id) as unknown as TraceElement) ?? null,
    get body(): TraceElement {
      return body as unknown as TraceElement;
    },
    get fullscreenElement(): FakeElement | null {
      return fullscreen;
    },
    addEventListener: (): void => {},
  };
  return {
    dom,
    gameRoot,
    body,
    parentOf: (id) => byId.get(id)?.parent?.id ?? null,
    enterFullscreen: () => {
      fullscreen = gameRoot;
    },
    leaveFullscreen: () => {
      fullscreen = null;
    },
  };
}

/** The three things this file asks of an element, and a parent pointer so a test
 *  can ask the question the whole bug turns on: *which box are you inside?* */
class FakeElement {
  hidden = false;
  parent: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  private idValue = '';
  private markup = '';

  constructor(
    id: string,
    private readonly byId: Map<string, FakeElement>,
  ) {
    this.id = id;
  }

  get id(): string {
    return this.idValue;
  }

  set id(value: string) {
    this.idValue = value;
    if (value) this.byId.set(value, this);
  }

  get innerHTML(): string {
    return this.markup;
  }

  /**
   * Writing markup is what makes the card's own ids addressable — the product binds
   * its button listeners through `getElementById` right after this write
   * (`./link-loss-view` `render`), so a fake that stored the string and registered
   * nothing would let a card with no working buttons pass.
   *
   * A regex, not a parser, and deliberately: every element this overlay gives an id
   * to is `<tag id="x">text</tag>` with no nesting, which is the one shape this has
   * to read.
   */
  set innerHTML(value: string) {
    this.markup = value;
    for (const child of this.children.slice()) this.remove(child);
    for (const [, id, text] of value.matchAll(/id="([^"]+)"[^>]*>([^<]*)/g)) {
      const child = new FakeElement(id!, this.byId);
      child.markup = text!;
      child.parent = this;
      this.children.push(child);
    }
  }

  addEventListener(): void {}

  appendChild(child: unknown): void {
    const element = child as FakeElement;
    element.parent?.remove(element);
    element.parent = this;
    this.children.push(element);
    // Re-registered on the way in, not just on construction: `rehome` MOVES the
    // card between two parents, and a move must leave every id inside it findable —
    // that is the difference between re-parenting a subtree and deleting one.
    for (const found of element.withIds()) this.byId.set(found.id, found);
  }

  /** Unlink `child`, which stays in the document (this is the move half of
   *  `appendChild`). With no argument, detach *this* — the teardown half — and give
   *  up the ids, because nothing in the page can address it any more. */
  remove(child?: FakeElement): void {
    if (child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      return;
    }
    this.parent?.remove(this);
    this.parent = null;
    for (const found of this.withIds()) {
      if (this.byId.get(found.id) === found) this.byId.delete(found.id);
    }
  }

  withIds(): FakeElement[] {
    const out = this.id ? [this as FakeElement] : [];
    for (const child of this.children) out.push(...child.withIds());
    return out;
  }
}

describe('session — when the line drops, both sides are told (a0-132)', () => {
  it('a dropped client learns it is dropped', async () => {
    // > *"do we have any indication when a player loses connection…"* (developer,
    // > 2026-08-17). a0-131 pointed a camera at it and the answer was no: thirty
    // > seconds after the joiner's link was cut its screen was frame-for-frame
    // > identical to the moment of the cut.
    //
    // The reason is not that nothing was detected. Everything was: the watchdog
    // fires, the sim freezes, the model composes the right words. The card is then
    // appended to `body` while the game root is in the browser's **top layer**, and
    // the top layer outranks every z-index there is — so the player is shown a
    // full-viewport scrim they cannot see, over a world that has stopped, with no
    // way to tell that from a crash.
    //
    // Real stack, real socket, and the cut that sends no FIN, because a client that
    // is never told its socket died is the only case worth testing here.
    const machine = await startFleetMachine();
    const room = 'DARK';
    const sessions: OnlineSession[] = [];
    const proxy = blackholeProxy(Number(new URL(machine.url).port));
    const proxyPort = await proxy.listen();
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      proxy.stop();
      await machine.stop();
    };

    const player = createOnlineSession({
      url: `ws://127.0.0.1:${proxyPort}/play`,
      room,
      shipClass: ShipClass.Interceptor,
      transport: {
        ticket: mintTicket(room, 60_000),
        connect: (url): WebSocketLike => nodeWebSocket(url),
        retryBaseMs: 200,
        retryMaxMs: 500,
      },
    });
    sessions.push(player);

    let welcomes = 0;
    player.observe((message) => {
      if (message.type === 'welcome') welcomes++;
    });
    await until('the welcome', () => welcomes > 0);
    player.chooseInLobby({ shipClass: ShipClass.Interceptor, seats: ['open', 'bot'] });
    await sleep(150);
    player.startMatch();
    const match = machine.matches.room(room);
    if (!match) throw new Error('the room never opened');
    await until('the match to start', () => match.world !== null && player.world !== null);

    // The screen the player is actually looking at: a match, fullscreen, which is
    // what a phone is in for every second of every online game it plays.
    const page = fullscreenPage();
    let menus = 0;
    const overlay = attachLinkLoss({
      session: player,
      dom: page.dom,
      onMenu: () => {
        menus++;
      },
    });

    // --- the line goes dead, and says nothing ---------------------------------
    const cutAt = Date.now();
    proxy.cut();

    // The render loop keeps running while the sim is frozen — that is the whole
    // reason `main.ts` polls this on the RENDER frame (`src/net/link-loss-attach`).
    const deadline = cutAt + 20_000;
    while (Date.now() < deadline && page.parentOf(LINK_LOSS_ROOT_ID) === null) {
      overlay.poll(Date.now());
      await sleep(50);
    }
    const toldAfterMs = Date.now() - cutAt;

    // 1. IT IS TOLD, AND PROMPTLY. Silence is the only evidence there is, so this
    //    cannot be instant — but it is seconds, not the half-minute a TCP keepalive
    //    would take, and well inside the time a player spends deciding the game has
    //    crashed (`src/net/link-loss` SILENCE_FLOOR_MS).
    expect(overlay.status().phase).not.toBe('live');
    expect(toldAfterMs).toBeLessThan(10_000);

    // 2. **AND IT IS TOLD WHERE THE PLAYER IS LOOKING.** The card is inside the
    //    fullscreen game root, not a sibling of it in `body`. This is the assertion
    //    a0-131's photograph is of: with the card in `body`, everything above this
    //    line still passes and the screen is still blank.
    expect(page.parentOf(LINK_LOSS_ROOT_ID)).toBe('app');

    // 3. In words, and with something to press. A frozen screen that says nothing is
    //    indistinguishable from a crash, and the player's next move is to close the
    //    tab — which is how you lose the seat for good (a0-133).
    const title = page.dom.getElementById(LINK_LOSS_TITLE_ID)?.innerHTML ?? '';
    expect(title.length).toBeGreaterThan(0);
    expect(page.dom.getElementById(LINK_LOSS_BUTTON_IDS.reconnect)).not.toBeNull();
    expect(page.dom.getElementById(LINK_LOSS_BUTTON_IDS.abandon)).not.toBeNull();
    expect(menus).toBe(0); // nothing has been decided for the player

    // 4. And it follows the player out of fullscreen and back in, because they can
    //    leave it at any moment and the card must not stay behind in the box that is
    //    no longer painted (the same rule, in the other direction).
    page.leaveFullscreen();
    overlay.poll(Date.now());
    expect(page.parentOf(LINK_LOSS_ROOT_ID)).toBe('body');
    page.enterFullscreen();
    overlay.poll(Date.now());
    expect(page.parentOf(LINK_LOSS_ROOT_ID)).toBe('app');

    overlay.dispose();
  }, 60_000);

  it('the room learns that a player left', async () => {
    // > *"…like for the other players that remained in match… we need something to
    // > indicate that so other players know"* (developer, 2026-08-17).
    //
    // QA's note on the host's screen is the exact shape of this bug: *the only
    // visible change is the other ship going still*. A ship that stops is
    // indistinguishable from a player who stopped moving, and the difference is
    // whether the fight in front of you is one you can win.
    //
    // The room's telling is not missing — `vacate` broadcasts `playerSubstituted`
    // and every client renders it (a0-76). The room simply does not FIND OUT. Its
    // only notice was the socket closing, and a screen lock, a backgrounded tab and
    // a cellular drop close nothing: measured on this stack, the room learned at
    // **t+34.8 s**, when `server/ws.ts`'s keepalive finally reaped a socket nobody
    // was behind. Thirty seconds of a match in which one player is gone, nobody has
    // been told, and no bot is flying the empty ship.
    const machine = await startFleetMachine();
    const room = 'GONE';
    const sessions: OnlineSession[] = [];
    const proxy = blackholeProxy(Number(new URL(machine.url).port));
    const proxyPort = await proxy.listen();
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      proxy.stop();
      await machine.stop();
    };

    const open = (url: string): OnlineSession =>
      createOnlineSession({
        url,
        room,
        shipClass: ShipClass.Interceptor,
        transport: {
          ticket: mintTicket(room, 60_000),
          connect: (target): WebSocketLike => nodeWebSocket(target),
          retryBaseMs: 200,
          retryMaxMs: 500,
        },
      });

    // The one who stays, on a healthy wire…
    const stays = open(machine.url);
    sessions.push(stays);
    let staysWelcomed = 0;
    stays.observe((message) => {
      if (message.type === 'welcome') staysWelcomed++;
    });
    await until('the host welcome', () => staysWelcomed > 0);

    // …and the one who is about to vanish, on a wire that can be cut.
    const leaves = open(`ws://127.0.0.1:${proxyPort}/play`);
    sessions.push(leaves);
    let leavesWelcomed = 0;
    leaves.observe((message) => {
      if (message.type === 'welcome') leavesWelcomed++;
    });
    await until('the joiner welcome', () => leavesWelcomed > 0);

    stays.chooseInLobby({ shipClass: ShipClass.Interceptor, seats: ['open', 'open'] });
    await sleep(200);
    stays.startMatch();
    const match = machine.matches.room(room);
    if (!match) throw new Error('the room never opened');
    await until(
      'the match to start',
      () => match.world !== null && stays.world !== null && leaves.world !== null,
    );
    const emptied = leaves.you;

    // **Both clients fly, because a match is a conversation.** Nothing here is
    // scenery: `sendInput` every frame is what the real loop does (`src/main.ts`),
    // and it is the signal the room's watchdog reads. Without it a headless test
    // would have BOTH seats silent, the healthy one would be substituted along with
    // the dropped one, and the test would pass for the wrong reason — which is
    // exactly what happened the first time this was written.
    const frames = setInterval(() => {
      stays.sendInput([]);
      leaves.sendInput([]);
    }, 33);
    cleanup = async (): Promise<void> => {
      clearInterval(frames);
      for (const session of sessions) session.close();
      proxy.stop();
      await machine.stop();
    };
    await sleep(300);

    // What the remaining player is told about the other seat, and when.
    const told: { atMs: number; heldForMatch: boolean }[] = [];
    const cutAt = Date.now();
    stays.observe((message) => {
      if (message.type !== 'playerSubstituted') return;
      if (message.player !== emptied) return;
      told.push({ atMs: Date.now() - cutAt, heldForMatch: message.heldForMatch === true });
    });

    // --- the line goes dead, and says nothing ---------------------------------
    proxy.cut();
    // A literal timeout, not one derived from the constant under test: on the code
    // this test was written against there is no such constant, and a deadline of
    // `undefined + 10_000` is `NaN`, which no clock is ever greater than. A test
    // whose failure mode is "hangs forever" is not a failing test.
    await until('the room to notice a player is gone', () => told.length > 0, 45_000);

    // 1. THE ROOM FINDS OUT ON ITS OWN CLOCK, not on a middlebox's. Comfortably
    //    inside the thirty seconds QA photographed, and nowhere near the 34.8 s the
    //    keepalive takes — which is the entire point, because the keepalive is still
    //    there and would still eventually fire. Stated as a bare number first, so
    //    the failure on unfixed code reads as the measurement it is.
    expect(told).toHaveLength(1);
    expect(told[0]!.atMs).toBeLessThan(20_000);
    expect(told[0]!.atMs).toBeLessThan(SEAT_SILENCE_MS + 5_000);

    // 2. …and it is patient enough not to be trigger-happy: a seat is never taken
    //    from a player over a stall the room already covers as ordinary
    //    (`INTENT_HOLD_TICKS`), which is what stops this from being a worse bug than
    //    the one it fixes.
    expect(told[0]!.atMs).toBeGreaterThanOrEqual(SEAT_SILENCE_MS - 1_000);

    // 3. WHAT HAPPENS TO THE ABANDONED SHIP, said on the wire rather than left for
    //    peers to infer from a ship that stopped: a bot has the controls, so the
    //    match keeps its shape (GDD §4.2)…
    expect(told[0]!.heldForMatch).toBe(true);
    await until('the substitute to take the controls', () => match.lobbyState()[emptied]?.isBot === true);

    // …and the seat is still its owner's, for as long as the match runs (a0-72).
    //    Nothing here forfeits anything: the ship, the cargo and the upgrades are
    //    waiting for them, and the same `playerSubstituted` is what tells the other
    //    players that the thing now flying it is not the person who was.
    expect(match.seatHeldForMatch(emptied)).toBe(true);
    expect(match.graceRemaining(emptied, Date.now() + 3_600_000)).toBe(HELD_FOR_MATCH);
    expect(match.state).toBe('live');

    // 4. **And the player who stayed is still playing.** The half of this that could
    //    make it a worse bug than the one it fixes: a room that judges silence must
    //    not mistake a flying player for a gone one. Held well past the window that
    //    took the other seat, on the same clock, over the same room.
    await sleep(SEAT_SILENCE_MS + 2_000);
    expect(stays.state).toBe('open');
    expect(match.lobbyState()[stays.you]?.isBot).toBe(false);
    expect(match.seatHeldForMatch(stays.you)).toBe(false);
    expect(told).toHaveLength(1); // and still exactly one telling, not a repeat every update
  }, 60_000);
});

// ---------------------------------------------------------------------------
// a0-133 — a correct code, a live match, and the door said REFUSED
// ---------------------------------------------------------------------------

/**
 * **The path a phone must use was the one that refused it.**
 *
 * a0-131 pointed two real browsers at one real match and came back with a pair of
 * findings that only make sense read together:
 *
 *   • *verified* — the client whose **socket** returns is put back into the running
 *     match, caught up and playing. That is the test above this one, and it has
 *     been green since a0-72.
 *   • *failed* — a **fresh client** typing the correct code into that same live
 *     match is told `REFUSED: match-live — that match already started`.
 *
 * A phone that sleeps long enough does not resume a socket. The tab is discarded,
 * the page is rebuilt from nothing, and the player types the four letters again —
 * so the working path is the one they cannot reach, and the one they must use is
 * the one that turns them away. That is the developer's own report of 2026-08-17,
 * and their ruling stands: *"i should be able to join back if the match is still
 * on-going no matter what."*
 *
 * **What was actually missing was not a rule but a credential.** The room has
 * always been able to tell a returning player from a stranger, and has never
 * refused one: `server/room.ts` `join` sends anything carrying a `reclaim` to the
 * reclaim door, which checks the per-seat token the room minted at `welcome` —
 * *"The room code is shared with the whole classroom by design, so it cannot be
 * the credential. The token is."* The `match-live` refusal is only ever reached by
 * a request with **no** credential at all. And a rebuilt page had none, because the
 * token lived in a private field of the transport it lost.
 *
 * So this test drives the *front door*: a session object that has never seen this
 * match, dialling with the code, on a device that kept the seat token
 * (`./seat-memory`). And in the same run it drives the stranger who types the same
 * correct code with nothing to present, because "let the returning player in" is
 * only the right fix if it is still a closed door to everybody else.
 */
describe('session — a returning player comes back through the front door (a0-133)', () => {
  it('a returning player is let back into a live match', async () => {
    const machine = await startFleetMachine();
    const room = 'BACK';
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await machine.stop();
    };

    // **The device**, as against the page. This is the whole of what a0-133 adds:
    // one storage cell that outlives the JavaScript heap, exactly as a phone's
    // `localStorage` outlives the tab that is discarded when the screen stays black
    // (`./seat-memory` `browserSeatMemory`). The test injects it for the same
    // reason every clock and socket in `src/net` is injected.
    const device = memorySeatStorage();

    let live: (WebSocketLike & { suspend(): void }) | null = null;
    const phone = createOnlineSession({
      url: machine.url,
      room,
      shipClass: ShipClass.Interceptor,
      transport: {
        ticket: mintTicket(room),
        seatMemory: seatMemory(device),
        connect: (url): WebSocketLike => {
          const socket = suspendableSocket(url);
          live = socket;
          return socket;
        },
        retryBaseMs: 100,
        retryMaxMs: 250,
      },
    });
    sessions.push(phone);

    let welcomes = 0;
    phone.observe((message) => {
      if (message.type === 'welcome') welcomes++;
    });
    await until('the welcome', () => welcomes > 0);
    const seat = phone.you;
    phone.chooseInLobby({ shipClass: ShipClass.Interceptor, seats: ['open', 'bot'] });
    await sleep(120);
    phone.startMatch();

    const match = machine.matches.room(room);
    if (!match) throw new Error('the room never opened');
    await until('the match to start', () => match.world !== null && phone.world !== null);

    // Stamp authority's ship, so "the same seat came back" has an answer a fresh
    // spawn could not fake.
    const ship = match.world?.ships.find((s) => s.id === seat);
    if (!ship) throw new Error('no authoritative ship for the seat');
    ship.banked = 42;
    const track = Object.keys(ship.tiers)[0]!;
    (ship.tiers as Record<string, number>)[track] = 3;

    // --- The screen goes black, and this time the page does not survive it ----
    phone.linkHidden();
    (live as unknown as { suspend(): void }).suspend();
    await until('the server to notice and seat a bot', () => match.lobbyState()[seat]?.isBot === true);
    expect(match.seatHeldForMatch(seat)).toBe(true);
    expect(match.state).toBe('live');

    // A discarded tab runs no handlers and says nothing on the wire — it does not
    // hang up politely and it certainly does not press ABANDON MATCH. `close()` is
    // that: this object stops existing, in silence. The seat stays held for the
    // life of the match (a0-72), which is the state the room is in when the player
    // picks the phone back up.
    phone.close();
    await sleep(200);
    expect(match.seatHeldForMatch(seat)).toBe(true);

    // --- A stranger types the same correct code ------------------------------
    // First, the door that must stay shut. Same four letters, same Machine, a valid
    // ticket — and nothing whatever to say the seat is theirs. This is the refusal
    // a0-131 photographed, and it is still exactly right.
    const strangerRefusals: string[] = [];
    const stranger = createOnlineSession({
      url: machine.url,
      room,
      shipClass: ShipClass.Interceptor,
      transport: {
        ticket: mintTicket(room),
        // A different device: no credential, and nowhere one could have come from.
        seatMemory: null,
        connect: nodeWebSocket,
        retryBaseMs: 100,
        retryMaxMs: 250,
      },
    });
    sessions.push(stranger);
    stranger.observe((message) => {
      if (message.type === 'joinError') strangerRefusals.push(message.reason);
    });
    await until('the stranger to be turned away', () => strangerRefusals.length > 0);
    expect(strangerRefusals).toEqual(['match-live']);
    expect(stranger.rejectReason).toBe('match-live');
    // …and the room is untouched by the knock: the seat is still being held for
    // the player it belongs to, and no bot handed anything over.
    expect(match.seatHeldForMatch(seat)).toBe(true);
    expect(match.lobbyState()[seat]?.isBot).toBe(true);

    // --- …and now the player comes back --------------------------------------
    // A **fresh client**, and every word of that matters: a new session object, a
    // new socket, a new ticket, and not one byte of the connection that dropped.
    // The only thing it shares with the phone that went dark is the device it is
    // running on — and therefore the seat token that device wrote down. This is a
    // page reload with the code typed in again, which is the only path a slept
    // phone has.
    const returningRefusals: string[] = [];
    let returningWelcomes = 0;
    const returning = createOnlineSession({
      url: machine.url,
      room,
      shipClass: ShipClass.Interceptor,
      transport: {
        ticket: mintTicket(room),
        seatMemory: seatMemory(device),
        connect: nodeWebSocket,
        retryBaseMs: 100,
        retryMaxMs: 250,
      },
    });
    sessions.push(returning);
    returning.observe((message) => {
      if (message.type === 'welcome') returningWelcomes++;
      if (message.type === 'joinError') returningRefusals.push(message.reason);
    });

    // THE RULING: the match was still running and the seat was still theirs, so
    // they are back in it. Through the front door, on a client that had to be told
    // the room code by a human, and not refused once on the way.
    await until(
      'the door to answer the returning player',
      () => returningWelcomes > 0 || returningRefusals.length > 0,
      15_000,
    );
    // On the code this test was written against, the answer here is
    // `[ 'match-live' ]` — the refusal a0-131 photographed, reproduced by the only
    // client a slept phone can be.
    expect(returningRefusals).toEqual([]);
    expect(returningWelcomes).toBeGreaterThan(0);
    expect(returning.you).toBe(seat);
    expect(returning.state).toBe('open');

    await until('the bot to hand the controls back', () => match.lobbyState()[seat]?.isBot === false);
    expect(match.seatHeldForMatch(seat)).toBe(false);

    // The same ship, not a new one: authority never rebuilt it, so the wealth and
    // the upgrade tier the player left the field with are the ones they are flying
    // (GDD §4.2 — "reclaim their ship, with all upgrades intact").
    expect(match.world?.ships.find((s) => s.id === seat)).toBe(ship);
    expect(ship.cargo + ship.banked).toBeCloseTo(42, 9);
    expect((ship.tiers as Record<string, number>)[track]).toBe(3);

    // …and the half the player actually sees: the reclaim `welcome` carries the
    // wallet and `matchStart` stamps it onto the world this fresh client builds.
    await until(
      'the returning client to be flying its own wallet again',
      () => {
        const mine = returning.world?.ships.find((s) => s.id === returning.you);
        return mine !== undefined && mine.cargo + mine.banked > 0;
      },
      10_000,
    );
    const mine = returning.world?.ships.find((s) => s.id === returning.you);
    expect(mine).toBeDefined();
    expect(mine!.cargo + mine!.banked).toBeCloseTo(ship.cargo + ship.banked, 1);
    expect((mine!.tiers as Record<string, number>)[track]).toBe(3);
  }, 60_000);

  it('a remembered seat that the room has forgotten falls back to an ordinary join', async () => {
    // The cost of a credential that outlives its page: it also outlives its match.
    // A player who was in this room's **lobby**, reloaded, and came back is holding
    // a seat the room freed the moment their socket closed — so the reclaim is
    // refused, and that refusal must not cost them the ordinary join they would
    // have had before a0-133 existed. One extra round trip, then the lobby, and the
    // player is never told about any of it.
    const machine = await startFleetMachine();
    const room = 'STAL';
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await machine.stop();
    };

    const device = memorySeatStorage();
    const first = createOnlineSession({
      url: machine.url,
      room,
      shipClass: ShipClass.Interceptor,
      transport: {
        ticket: mintTicket(room),
        seatMemory: seatMemory(device),
        connect: nodeWebSocket,
        retryBaseMs: 100,
        retryMaxMs: 250,
      },
    });
    sessions.push(first);
    let seated = 0;
    first.observe((message) => {
      if (message.type === 'welcome') seated++;
    });
    await until('the first welcome', () => seated > 0);
    // The credential is written down…
    expect(seatMemory(device).recall(room, Date.now())).not.toBeNull();
    // …and then the page goes away in a lobby, where a seat is simply freed
    // (`server/room.ts` `vacate` — there is no match to hold it for).
    first.close();
    const match = machine.matches.room(room);
    if (!match) throw new Error('the room never opened');
    await until('the seat to free', () => match.lobbyState().every((slot) => !slot.ready));

    const refusals: string[] = [];
    let welcomes = 0;
    const second = createOnlineSession({
      url: machine.url,
      room,
      shipClass: ShipClass.Interceptor,
      transport: {
        ticket: mintTicket(room),
        seatMemory: seatMemory(device),
        connect: nodeWebSocket,
        retryBaseMs: 100,
        retryMaxMs: 250,
      },
    });
    sessions.push(second);
    second.observe((message) => {
      if (message.type === 'welcome') welcomes++;
      if (message.type === 'joinError') refusals.push(message.reason);
    });

    await until('the second client to be seated anyway', () => welcomes > 0, 15_000);
    // Not one word of the stale credential's refusal reached the player…
    expect(refusals).toEqual([]);
    expect(second.state).toBe('open');
    // …and the seat it is now holding is one the room gave it in this handshake,
    // written down in place of the one that had gone stale.
    const remembered = seatMemory(device).recall(room, Date.now());
    expect(remembered?.seat).toBe(second.you);
  }, 45_000);
});
