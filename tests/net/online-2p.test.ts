/**
 * tests/net/online-2p.test.ts — two players, one room, one authoritative
 * server, over a real socket (GDD §4.2, milestone M3).
 *
 * Everything below this test is the shipping stack and none of it is mocked: a
 * `node:http` listener with the hand-rolled RFC 6455 endpoint (`server/ws.ts`)
 * on top, `MatchServer` running the real sim behind it, and two clients that are
 * `createOnlineSession` — `WebSocketTransport`, the wire codec, prediction, and
 * reconciliation, exactly as a browser would run them. The browser-shaped
 * `WebSocket` and the server harness are the shared `./node-websocket` helper.
 *
 * What it proves, and why each part is worth a real socket rather than a fake:
 *
 *  - **The lobby happens.** Two clients join by code, pick different hulls, and
 *    the creator starts the match — over TCP, in the order a real network
 *    delivers it.
 *  - **Both clients build the server's world.** `matchStart` carries the seed
 *    and roster, so each client's `createWorld` produces the arena the server is
 *    simulating: same rocks, and each ship in the hull its player picked.
 *  - **Prediction tracks authority.** Each client flies its own ship at zero
 *    latency and reconciles against 30 Hz snapshots; the residual error is the
 *    wire's quantization, not drift.
 *  - **Each sees the other.** The remote ship moves on this client's screen
 *    because snapshots move it, and it is where the server says it is.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { PlayerId } from '@shared/types';
import type { Action } from '@shared/types';
import { createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import type { World } from '../../src/sim';
import { netBudget } from './budgets';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';
import { simSeconds, waitForTicks } from './sim-clock';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** How much match this test needs under thrust before a ship has measurably
 *  travelled. Counted in the sim's own fixed steps, not in wall seconds, so the
 *  runner's CPU cannot decide how much flight the assertions below get
 *  (`./sim-clock.ts`). */
const FLIGHT_TICKS = simSeconds(1.5);

const THRUST = (x: number, y: number): readonly Action[] => [{ type: 'thrust', dir: { x, y } }];

function shipOf(world: World, id: PlayerId): World['ships'][number] {
  const ship = world.ships.find((s) => s.id === id);
  if (!ship) throw new Error(`no ship ${id}`);
  return ship;
}

function shipDistance(a: World, b: World, id: PlayerId): number {
  return Math.hypot(shipOf(a, id).pos.x - shipOf(b, id).pos.x, shipOf(a, id).pos.y - shipOf(b, id).pos.y);
}

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('a two-player online match', () => {
  it('runs end-to-end against a locally-run server, each client predicting its own ship', async () => {
    const harness = await startMatchServer({ seed: 4242, slots: 2, asteroidCount: 10 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    // --- Lobby: two clients, one shared room code, two different hulls -------
    const alice = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Interceptor,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(alice);
    await until('alice to be seated', () => harness.matches.room('RUSH') !== undefined);

    const bob = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(bob);
    const room = harness.matches.room('RUSH');
    if (!room) throw new Error('the room was never created');
    await until('both seats to be filled', () => room.humanCount === 2);
    // Two humans in a two-seat room: no bots, so what follows is purely the two
    // clients and the authority between them.
    expect(room.lobbyState().every((slot) => !slot.isBot)).toBe(true);

    // --- RUSH! — the room creator starts the match (GDD §2.1, §4.2) ---------
    alice.startMatch();
    await until('both clients to have a world', () => alice.world !== null && bob.world !== null);

    const authority = room.world;
    if (!authority) throw new Error('the room never started its match');
    // Each client built the server's arena from `matchStart`: the same seed, so
    // the same field, and each seat in the hull its player chose in the lobby.
    for (const session of sessions) {
      expect(session.world?.asteroids.length).toBe(authority.asteroids.length);
      expect(session.world?.ships.map((s) => s.shipClass)).toEqual([
        ShipClass.Interceptor,
        ShipClass.Hauler,
      ]);
    }

    // --- Play: both ships fly, at 60 Hz, in opposite directions -------------
    // Thrust is tangential to the ring on purpose: pointed outward, each ship
    // would fly straight into its own station and the test would be measuring
    // collision response rather than the network.
    const start = [{ ...shipOf(authority, 0).pos }, { ...shipOf(authority, 1).pos }];
    // Sampled while the hands are on the controls, because that is the only
    // time there is anything in flight to be ahead by.
    let leadWhileFlying = 0;
    let pendingWhileFlying = 0;
    const flying = setInterval(() => {
      alice.sendInput(THRUST(0, 1));
      bob.sendInput(THRUST(0, -1));
      leadWhileFlying = Math.max(leadWhileFlying, alice.prediction?.lead ?? 0);
      pendingWhileFlying = Math.max(pendingWhileFlying, alice.prediction?.pendingCount ?? 0);
    }, 1000 / 60);
    // Ninety fixed steps of flight, counted on the server's OWN clock rather than on
    // a stopwatch. `await sleep(1_500)` bought 90 ticks here and fewer on the runner,
    // where the server's 60 Hz `setInterval` competes with two client sessions on two
    // shared cores — so every assertion below it (`tick > 60`, travelled > 20 units)
    // was partly an assertion about CI's CPU. This buys the same simulation anywhere.
    await waitForTicks(() => authority.tick, FLIGHT_TICKS, { what: 'two ships under thrust' });
    clearInterval(flying);

    // Let the last inputs land and the last snapshots come back — which is a
    // *condition*, not a duration: the client is caught up exactly when it has no
    // unacknowledged input left, and that is the same fact `lead === 0` asserts
    // below. Waiting 200 ms instead was waiting for the usual case.
    await until(
      'the last inputs to be acknowledged, so neither client is still ahead',
      () => (alice.prediction?.pendingCount ?? 1) === 0 && (bob.prediction?.pendingCount ?? 1) === 0,
      5_000,
      () => `alice pending ${alice.prediction?.pendingCount}, bob pending ${bob.prediction?.pendingCount}`,
    );

    const aliceWorld = alice.world;
    const bobWorld = bob.world;
    if (!aliceWorld || !bobWorld) throw new Error('a client lost its world');

    // The match actually ran, on the server, off both clients' input: each ship
    // has travelled, in the direction its own player was pushing.
    expect(authority.tick).toBeGreaterThan(60);
    expect(shipOf(authority, 0).pos.y - start[0]!.y).toBeGreaterThan(20);
    expect(shipOf(authority, 1).pos.y - start[1]!.y).toBeLessThan(-20);

    for (const [session, seat] of [
      [alice, 0],
      [bob, 1],
    ] as const) {
      const prediction = session.prediction;
      if (!prediction) throw new Error(`seat ${seat} is not predicting`);
      // Prediction is tracking authority, not drifting from it: the residual is
      // the wire's integer quantization (`src/net/snapshot.ts`), which is what
      // "reconciles" has to mean if the word is to mean anything.
      expect(prediction.lastError).toBeLessThan(3);
    }
    // While the hands were on the controls the client ran ahead of the server by
    // the input it had in flight — that lead is what makes a press arrive *for*
    // the tick it names rather than after it. Hands off, it settles back onto
    // the server's own tick, because there is nothing left to be ahead by.
    expect(pendingWhileFlying).toBeGreaterThan(0);
    expect(leadWhileFlying).toBeGreaterThan(0);
    expect(alice.prediction?.lead).toBe(0);

    // Each client can see the other player's ship, in the place the server has
    // it: the remote half of the world arrives entirely by snapshot.
    expect(shipDistance(aliceWorld, authority, 1)).toBeLessThan(40);
    expect(shipDistance(bobWorld, authority, 0)).toBeLessThan(40);
    // …and they are not merely *drawing* it at the spawn point.
    expect(shipOf(aliceWorld, 1).pos.y).toBeLessThan(start[1]!.y - 10);
  }, netBudget({
    work: 'boot a server → seat two clients by room code → RUSH! → 90 SIM ticks of two-way thrust at 60 Hz → drain the input queues → assert travel, prediction error, lead and the remote view',
    measuredSeconds: 1.9,
  }));
});
