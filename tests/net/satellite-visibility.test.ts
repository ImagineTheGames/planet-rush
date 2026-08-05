/**
 * tests/net/satellite-visibility.test.ts — does a radar satellite ever reach a
 * client? OWNER: Netcode Engineer (netcode audit §6 gap 2; RATIFIED feature f1).
 *
 * `src/sim/state.ts` says a satellite "is a static-ish structure the client
 * rebuilds from entity events". The audit found no `'satellite'` member on
 * `EntityEventMessage['kind']` and no producer in `server/static-events.ts`, and
 * wrote the gap down. This file is that claim put under a real socket rather than
 * a grep: the server is given a satellite through its own construction path, and
 * both clients are asked whether they ever hear about it.
 *
 * The whole stack under the wire is shipping code — `MatchServer` on the
 * hand-rolled RFC 6455 endpoint, two `createOnlineSession` clients, the real
 * codec — so the answer this records is the answer the booted client gives.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { SATELLITE } from '../../src/sim';
import type { World } from '../../src/sim';
import { createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import { netBudget } from './budgets';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';

/** Satellites standing at player `seat`'s station in `world`, or -1 when that
 *  world has no such station (which would be a different failure entirely). */
function satelliteCount(world: World | null, seat: number): number {
  const station = world?.stations.find((s) => s.owner === seat);
  if (!station) return -1;
  return station.satellites?.length ?? 0;
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('a radar satellite in an online match', () => {
  it('reaches both clients on the entity-event stream, and leaves when it dies', async () => {
    const harness = await startMatchServer({ seed: 4242, slots: 2, asteroidCount: 10 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const alice = createOnlineSession({
      url: harness.url,
      room: 'RADAR',
      shipClass: ShipClass.Interceptor,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(alice);
    await until('alice to be seated', () => harness.matches.room('RADAR') !== undefined);

    const bob = createOnlineSession({
      url: harness.url,
      room: 'RADAR',
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(bob);
    const room = harness.matches.room('RADAR');
    if (!room) throw new Error('the room was never created');
    await until('both seats to be filled', () => room.humanCount === 2);

    alice.startMatch();
    await until('both clients to have a world', () => alice.world !== null && bob.world !== null);

    const authority = room.world;
    if (!authority) throw new Error('the room never started its match');
    const station = authority.stations.find((s) => s.owner === 0);
    if (!station) throw new Error("no station for alice's seat");

    // Neither client has one yet, and neither does the server: the baseline the
    // rest of this test moves off.
    expect(satelliteCount(authority, 0)).toBe(0);
    expect(satelliteCount(alice.world, 0)).toBe(0);
    expect(satelliteCount(bob.world, 0)).toBe(0);

    // Build one on the server, through the sim's own construction path rather
    // than by minting a literal: a job with a hair of time left, which the next
    // tick completes into a real satellite in its orbit band. Twelve seconds of
    // real build time is the feature's, not this test's, business.
    station.builds.push({
      id: authority.nextEntityId++,
      kind: 'satellite',
      slot: 0,
      remaining: 1 / 60,
      total: SATELLITE.buildTime,
    });
    await until('the server to finish building it', () => satelliteCount(authority, 0) === 1);

    // Wait for the entity-event stream to say so — the exact claim this file makes —
    // instead of for several of its 10 Hz intervals. "600 ms" is how long that takes
    // on this hardware; the question the test asks is whether it happens at all, and
    // phrasing it as a duration turns a gap in the stream into a slow machine.
    await until(
      'the satellite to reach both clients on the entity-event stream',
      () => satelliteCount(alice.world, 0) === 1 && satelliteCount(bob.world, 0) === 1,
      5_000,
      () => `alice ${satelliteCount(alice.world, 0)}, bob ${satelliteCount(bob.world, 0)}`,
    );

    // The owner sees their own satellite…
    expect(satelliteCount(alice.world, 0)).toBe(1);
    // …and so does the rival, who has to be able to hunt it (feature f1: it is a
    // legitimate high-value siege target, so it cannot be invisible to the only
    // player with a reason to shoot it).
    expect(satelliteCount(bob.world, 0)).toBe(1);

    // It orbits on both clients rather than sitting where it appeared: the sim
    // advances `orbitAngle` every tick, and the client runs the same sim.
    const clientSat = alice.world?.stations.find((s) => s.owner === 0)?.satellites?.[0];
    const serverSat = station.satellites?.[0];
    if (!clientSat || !serverSat) throw new Error('the satellite went missing mid-test');
    expect(clientSat.id).toBe(serverSat.id);
    expect(clientSat.owner).toBe(0);
    expect(Math.hypot(clientSat.pos.x - serverSat.pos.x, clientSat.pos.y - serverSat.pos.y)).toBeLessThan(40);

    // And when it dies it leaves — the ghost is the half of this gap that gives
    // a client sensor coverage authority stopped granting it (GDD §2.2).
    serverSat.hp = 0;
    await until('the server to drop the dead satellite', () => satelliteCount(authority, 0) === 0);
    await until(
      'the death to reach both clients, so neither is left with a ghost',
      () => satelliteCount(alice.world, 0) === 0 && satelliteCount(bob.world, 0) === 0,
      5_000,
      () => `alice ${satelliteCount(alice.world, 0)}, bob ${satelliteCount(bob.world, 0)}`,
    );
    expect(satelliteCount(alice.world, 0)).toBe(0);
    expect(satelliteCount(bob.world, 0)).toBe(0);
  }, netBudget({
    work: 'boot a server → seat two clients → RUSH! → complete a satellite through the sim’s own build path → wait for it on both clients → kill it → wait for the ghost to clear on both',
    measuredSeconds: 1.5,
  }));
});
