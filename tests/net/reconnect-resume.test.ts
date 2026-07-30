/**
 * tests/net/reconnect-resume.test.ts — the ship-comes-back-with-cargo guarantee,
 * end to end (GDD §4.2). OWNER: Netcode Engineer.
 *
 * The reconnect-grace rule is the load-bearing promise of mobile online play: a
 * screen lock or a cellular hand-off drops the socket, a bot flies the seat so the
 * match keeps its shape, and within ~60 s the player rejoins by room code and
 * takes the controls back — *same ship, same hull, same cargo, same banked ore,
 * same upgrades, because the ship was never touched, only the hands on it changed*
 * (GDD §4.2). Its pieces are unit-tested (`src/net/reconnect.test.ts`,
 * `server/room` reclaim), but the promise is a property of the *whole stack*: it
 * only holds if a real socket death drives a real bot substitution, and a real
 * redial carries the real reclaim token back over a real wire to the same seat.
 *
 * So this test kills the underlying TCP socket mid-match — a network blip, not a
 * deliberate leave — and lets `WebSocketTransport`'s own backoff redial and
 * reclaim, exactly as it would in a browser. The proof the ship survived is object
 * identity: the authoritative `Ship` the player reclaims is the *same object* it
 * flew before the drop, so its cargo, banked ore and upgrade tiers are the ones it
 * had — the world was never rebuilt, only its pilot swapped and swapped back.
 *
 * (Against a real deployed Fly Machine this is the same handshake over `wss://`;
 * the live-deploy run is recorded as still open in docs/netcode-spike.md.)
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { oreResidual } from '../../src/sim';
import { createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import type { WelcomeMessage } from '../../src/net/transport';
import type { WebSocketLike } from '../../src/net/websocket-transport';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('reconnect-resume', () => {
  it('a dropped player reclaims the same ship, cargo and upgrades intact', async () => {
    const harness = await startMatchServer({ seed: 909, slots: 2, asteroidCount: 12, graceMs: 10_000 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    // Wrap the socket factory so the test holds the live socket and can sever it
    // to simulate a network drop (the transport makes a new one on redial).
    let aliceSocket: WebSocketLike | null = null;
    const capturingConnect = (url: string): WebSocketLike => {
      const ws = nodeWebSocket(url);
      aliceSocket = ws;
      return ws;
    };

    // A ~250 ms first retry leaves a clear window where a bot flies the seat before
    // the reclaim lands — long enough to observe the substitution, short enough
    // that the bot cannot dock and spend the banked ore we are about to stamp.
    const alice = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Interceptor,
      transport: { connect: capturingConnect, retryBaseMs: 250, retryMaxMs: 250, reconnectWindowMs: 10_000 },
    });
    const aliceSaw: string[] = [];
    const aliceWelcomes: WelcomeMessage[] = [];
    alice.observe((m) => {
      aliceSaw.push(m.type);
      if (m.type === 'welcome') aliceWelcomes.push(m);
    });
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

    // --- RUSH!, then stamp the ship so its survival is observable -------------
    alice.startMatch();
    await until('the match to start', () => room.world !== null && alice.world !== null);
    const seat = alice.you; // welcome has arrived, so this is her real seat

    const ship = room.world?.ships.find((s) => s.id === seat);
    if (!ship) throw new Error('no authoritative ship for alice');
    // Cargo and an upgrade, planted directly on authority: banked ore that a fresh
    // spawn would not have, and a tier a fresh spawn would not carry. Held cargo is
    // left at zero on purpose — a ship parked at its home station auto-drains its
    // hold into the bank (`__oreDepositStage`), which would creep `banked` off its
    // forged value; the held-ore *channel* is proved by wire↔client equality below.
    ship.banked = 42;
    const track = Object.keys(ship.tiers)[0]!;
    (ship.tiers as Record<string, number>)[track] = 3;
    const stampedShip = ship;

    // The conservation baseline, sampled AFTER the direct stamp (which mints ore
    // off the ledger — this test forges a wallet rather than earning it). The
    // reconnect must not move it a further inch: bot flight, substitution and
    // reclaim are all conservation-neutral, so the residual is invariant across
    // the whole cycle (`src/sim/ore-ledger`). A nonzero *delta* would mean the
    // reclaim path minted or destroyed ore — the exact leak this guards.
    const residualBaseline = oreResidual(room.world!);

    // --- The drop: sever the live socket, no goodbye ------------------------
    if (!aliceSocket) throw new Error('never captured alice’s socket');
    (aliceSocket as WebSocketLike).close();

    // The server holds the seat and a bot takes the controls (GDD §4.2 step 1);
    // Bob, still connected, is told over the wire that his rival was substituted.
    await until('a bot to substitute for alice', () => bobSaw.includes('playerSubstituted'));
    expect(room.lobbyState()[seat]!.isBot).toBe(true);
    expect(room.graceRemaining(seat, Date.now())).toBeGreaterThan(0);

    // --- The return: the transport redials inside grace and reclaims --------
    // Wait on the wire message, not just the server flag: the seat flips before
    // the freshly reconnected socket has delivered the frame that says so.
    await until('alice to reclaim her seat', () => aliceSaw.includes('playerReclaimed'), 12_000);
    expect(alice.state).toBe('open');
    expect(room.lobbyState()[seat]!.isBot).toBe(false);
    expect(alice.you).toBe(seat);

    // The ship is the *same object* she left — never removed, never rebuilt — so
    // its hull, cargo, banked ore and upgrade tier are exactly as she left them.
    const reclaimed = room.world?.ships.find((s) => s.id === seat);
    expect(reclaimed).toBe(stampedShip);
    expect(reclaimed?.shipClass).toBe(ShipClass.Interceptor);
    expect(reclaimed?.banked).toBe(42);
    expect((reclaimed?.tiers as Record<string, number>)[track]).toBe(3);

    // --- The wallet rode the wire (QA m10 "economy-not-on-wire") -------------
    // Server-authority identity is not enough: the *client* rebuilds a fresh,
    // naked world on reclaim, and the streaming snapshot never carries cargo,
    // bank or tiers (`src/net/snapshot`). The reclaim `welcome` must, so the
    // reconnecting client is handed back the economy it earned (GDD §4.2). Bank
    // and tier are the forged values; the hold rides its own field and is proved
    // by the client↔wire equality below.
    const reclaimWelcome = aliceWelcomes.at(-1);
    expect(reclaimWelcome?.economy, 'reclaim welcome carries the wallet').toBeDefined();
    expect(reclaimWelcome?.economy?.banked).toBe(42);
    expect(reclaimWelcome?.economy?.tiers[track]).toBe(3);
    expect(typeof reclaimWelcome?.economy?.held).toBe('number');

    // ...and the client stamped every wallet field exactly as the wire delivered
    // it — not a naked reclaim. Deterministic: this client sends no input after
    // reclaim, and reconciliation never overwrites the wallet (`./prediction`).
    const clientShip = alice.world?.ships.find((s) => s.id === seat);
    expect(clientShip, 'client has a predicted ship for the reclaimed seat').toBeDefined();
    expect(clientShip?.cargo).toBe(reclaimWelcome?.economy?.held);
    expect(clientShip?.banked).toBe(42);
    expect((clientShip?.tiers as Record<string, number>)[track]).toBe(3);

    // --- Conservation holds across the reconnect ----------------------------
    // The authoritative ledger's residual is exactly where it was before the
    // drop: the substitution and reclaim moved no ore off the books.
    expect(oreResidual(room.world!)).toBeCloseTo(residualBaseline, 6);
  }, 30_000);
});
