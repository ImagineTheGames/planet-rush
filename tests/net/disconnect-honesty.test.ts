/**
 * tests/net/disconnect-honesty.test.ts — the zombie match, killed. OWNER: Netcode
 * Engineer (GDD §4.2; the developer's report, m10 disconnect honesty).
 *
 * *"Left browser, came back, disconnected — bots frozen but I could still move. I
 * should get kicked out and presented reconnect / abandon buttons."*
 *
 * `reconnect-resume.test.ts` proves the recovery works **when the client knows it
 * dropped**: it severs the socket and the transport's own `onclose` starts the
 * redial. This file is the case that report is actually about — the one where
 * nothing tells the client anything:
 *
 *   **the socket is destroyed while the page is frozen, so the client's handlers
 *   never run.** No `onclose`, no error, `transport.state` still `open`. Exactly
 *   what a backgrounded tab leaves behind, and the shape under which every earlier
 *   build kept predicting a world the server had already given to a bot.
 *
 * Two guarantees, over the real stack (real `node:net` sockets, the real RFC 6455
 * endpoint, the real `MatchServer` running the real sim):
 *
 *  1. The client **notices, freezes and says so** — and then gets the ship back.
 *  2. **ABANDON MATCH frees the seat**, rather than parking it empty behind a
 *     sixty-second window nobody is coming back through.
 *
 * The session's own clock is injected so the silence limit (`src/net/link-loss`
 * `SILENCE_FLOOR_MS`, 2.5 s) is crossed by moving a variable rather than by
 * sleeping — the wire, the server and the grace window all still run on real time.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import { SILENCE_FLOOR_MS, linkNotice } from '../../src/net/link-loss';
import type { WebSocketLike } from '../../src/net/websocket-transport';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

/**
 * A socket that can be **gagged**: the TCP connection dies (so the server sees a
 * drop and substitutes a bot, as it would for a real backgrounded phone) while the
 * page's own handlers never fire — no `onclose`, no `onerror`, no message. That
 * silence is the whole bug, reproduced.
 */
function gaggableSocket(url: string): WebSocketLike & { gag(): void } {
  const inner = nodeWebSocket(url);
  let gagged = false;
  const outer: WebSocketLike & { gag(): void } = {
    binaryType: 'arraybuffer',
    send: (data) => {
      if (!gagged) inner.send(data);
    },
    close: () => inner.close(),
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    gag: () => {
      gagged = true;
      inner.close(); // the OS tears the connection down; the frozen page is unaware
    },
  };
  inner.onopen = (e): void => {
    if (!gagged) outer.onopen?.(e);
  };
  inner.onmessage = (e): void => {
    if (!gagged) outer.onmessage?.(e);
  };
  inner.onclose = (e): void => {
    if (!gagged) outer.onclose?.(e);
  };
  inner.onerror = (e): void => {
    if (!gagged) outer.onerror?.(e);
  };
  return outer;
}

describe('a silently-killed socket (the backgrounded tab)', () => {
  it('is noticed, freezes the world, says why — and gets the ship back', async () => {
    const harness = await startMatchServer({ seed: 4242, slots: 2, asteroidCount: 12, graceMs: 15_000 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    // The session's clock, which the test moves; the wire's is the real one.
    let clock = Date.now();
    const sockets: (WebSocketLike & { gag(): void })[] = [];
    const connect = (url: string): WebSocketLike => {
      const socket = gaggableSocket(url);
      sockets.push(socket);
      return socket;
    };

    const alice = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Interceptor,
      now: () => clock,
      link: { graceWindowMs: 15_000 },
      transport: { connect, retryBaseMs: 200, retryMaxMs: 200, reconnectWindowMs: 15_000 },
    });
    const aliceSaw: string[] = [];
    alice.observe((m) => aliceSaw.push(m.type));
    sessions.push(alice);
    await until('alice to be seated', () => harness.matches.room('RUSH') !== undefined);

    const bob = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket },
    });
    const bobSaw: string[] = [];
    bob.observe((m) => bobSaw.push(m.type));
    sessions.push(bob);

    const room = harness.matches.room('RUSH');
    if (!room) throw new Error('the room was never created');
    await until('both seats filled', () => room.humanCount === 2);

    alice.startMatch();
    await until('the match to start', () => room.world !== null && alice.world !== null);
    const seat = alice.you;
    const world = alice.world!;

    // --- Flying, and the link is live ---------------------------------------
    const thrust = [{ type: 'thrust' as const, dir: { x: 1, y: 0 } }];
    for (let i = 0; i < 10; i++) {
      clock += 16;
      alice.pollLink(clock);
      alice.sendInput(thrust);
    }
    expect(alice.frozen).toBe(false);
    expect(linkNotice(alice.link).visible).toBe(false);
    const tickBeforeGag = world.tick;
    expect(tickBeforeGag).toBeGreaterThan(0);

    // --- The tab freezes. The socket dies. Nobody tells the client. ----------
    sockets[0]!.gag();
    await until('the server to substitute a bot', () => bobSaw.includes('playerSubstituted'));
    // The transport still believes everything is fine — this is the lie, on the
    // record: every earlier build had nothing but this to go on.
    expect(alice.state).toBe('open');

    // A few frames of the old behaviour: the client would happily keep flying.
    for (let i = 0; i < 5; i++) {
      clock += 16;
      alice.pollLink(clock);
      alice.sendInput(thrust);
    }
    const tickBeforeDetection = world.tick;

    // …and then the silence limit is crossed. Detection is by the clock and not by
    // any event, which is the point: no event was ever going to come.
    clock += SILENCE_FLOOR_MS;
    const lost = alice.pollLink(clock);
    expect(lost.phase === 'lost' || lost.phase === 'redialing').toBe(true);
    expect(alice.frozen).toBe(true);

    // THE FREEZE: not one further tick, however hard the player pushes the stick.
    for (let i = 0; i < 60; i++) {
      clock += 16;
      alice.sendInput(thrust);
    }
    expect(world.tick).toBe(tickBeforeDetection);

    // THE OVERLAY, saying what was actually detected and offering the way back.
    const notice = linkNotice(alice.link);
    expect(notice.visible).toBe(true);
    expect(notice.title + notice.detail).toContain('no server data for');
    expect(notice.grace).toMatch(/^\d+s$/);

    // --- RECONNECT: the redial the transport would never have made on its own -
    if (alice.link.phase === 'lost') expect(alice.reconnect(clock)).toBe(true);
    await until('alice to reclaim her seat', () => aliceSaw.includes('playerReclaimed'), 12_000);

    // Frames are flowing again, so the freeze lifts and the overlay comes down —
    // and the seat is hers, with the ship the bot was minding.
    await until('the client to see the link recover', () => {
      clock += 16;
      return alice.pollLink(clock).phase === 'live';
    });
    expect(alice.frozen).toBe(false);
    expect(linkNotice(alice.link).visible).toBe(false);
    expect(alice.you).toBe(seat);
    expect(room.lobbyState()[seat]!.isBot).toBe(false);

    // And the world moves again.
    const tickAfterReclaim = alice.world!.tick;
    for (let i = 0; i < 5; i++) {
      clock += 16;
      alice.sendInput(thrust);
    }
    expect(alice.world!.tick).toBeGreaterThan(tickAfterReclaim);
  }, 30_000);
});

describe('ABANDON MATCH', () => {
  it('frees the seat instead of parking it behind a window nobody will use', async () => {
    const harness = await startMatchServer({ seed: 77, slots: 2, asteroidCount: 12, graceMs: 30_000 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const alice = createOnlineSession({
      url: harness.url,
      room: 'QUIT',
      shipClass: ShipClass.Interceptor,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(alice);
    await until('alice to be seated', () => harness.matches.room('QUIT') !== undefined);

    const bob = createOnlineSession({
      url: harness.url,
      room: 'QUIT',
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket },
    });
    const bobSaw: { type: string; graceSeconds?: number; player?: number }[] = [];
    bob.observe((m) => {
      if (m.type === 'playerSubstituted') {
        bobSaw.push({ type: m.type, graceSeconds: m.graceSeconds, player: m.player });
      } else bobSaw.push({ type: m.type });
    });
    sessions.push(bob);

    const room = harness.matches.room('QUIT');
    if (!room) throw new Error('the room was never created');
    await until('both seats filled', () => room.humanCount === 2);
    alice.startMatch();
    await until('the match to start', () => room.world !== null);
    const seat = alice.you;

    // The player presses ABANDON MATCH.
    alice.leave();

    // The peer is told, exactly as it is told about a drop — a bot has the seat, so
    // the match keeps its shape (GDD §4.2 step 1).
    await until('bob to see the substitution', () => bobSaw.some((m) => m.type === 'playerSubstituted'));
    const substitution = bobSaw.find((m) => m.type === 'playerSubstituted');
    expect(substitution?.player).toBe(seat);
    // …and the one difference that is the whole feature: no window. The seat is a
    // bot's for the rest of the match rather than held empty for thirty seconds.
    expect(substitution?.graceSeconds).toBe(0);
    expect(room.graceRemaining(seat, Date.now())).toBe(0);
    expect(room.hasPendingReclaim).toBe(false);
    expect(room.lobbyState()[seat]!.isBot).toBe(true);
    expect(alice.link.ending).toBe('left');
  }, 30_000);

  it('a plain drop still holds the seat — the grace rule is untouched', async () => {
    const harness = await startMatchServer({ seed: 78, slots: 2, asteroidCount: 12, graceMs: 30_000 });
    const sessions: OnlineSession[] = [];
    let aliceSocket: WebSocketLike | null = null;
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const alice = createOnlineSession({
      url: harness.url,
      room: 'DROP',
      shipClass: ShipClass.Interceptor,
      transport: {
        connect: (url) => (aliceSocket = nodeWebSocket(url)),
        // Long enough that the redial does not land before the assertions below.
        retryBaseMs: 5_000,
        retryMaxMs: 5_000,
      },
    });
    sessions.push(alice);
    await until('alice to be seated', () => harness.matches.room('DROP') !== undefined);

    const bob = createOnlineSession({
      url: harness.url,
      room: 'DROP',
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(bob);

    const room = harness.matches.room('DROP');
    if (!room) throw new Error('the room was never created');
    await until('both seats filled', () => room.humanCount === 2);
    alice.startMatch();
    await until('the match to start', () => room.world !== null);
    const seat = alice.you;

    (aliceSocket as unknown as WebSocketLike).close();
    await until('the seat to be held', () => room.hasPendingReclaim);
    expect(room.graceRemaining(seat, Date.now())).toBeGreaterThan(0);
  }, 30_000);
});
