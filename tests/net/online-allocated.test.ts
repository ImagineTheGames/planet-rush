/**
 * tests/net/online-allocated.test.ts — the fleet door, end to end (M10 fleet
 * registration). OWNER: Netcode Engineer (GDD §4.2).
 *
 * `online-2p.test.ts` proves two clients can play against a match server they
 * dial *directly*. This proves the piece in front of it that the live wire probe
 * found missing: a match server that **registers with an allocator**, an allocator
 * that then **places a room on it**, and a client that reaches the room *only*
 * through the allocator's signed decision — no hard-coded server URL anywhere in
 * the client.
 *
 * Nothing here is mocked that ships: a real `node:http` allocator
 * (`createAllocatorServer`) authenticating a real registration (`src/net/fleet-auth`),
 * a real `MatchServer` enforcing the tickets the allocator signs, and clients that
 * are `allocateRoom` / `joinRoom` → `createOnlineSession`, exactly the browser's
 * path. The door, exercised as a door: register → allocate → play → join.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { ShipClass } from '@shared/types';
import { mulberry32 } from '@shared/types';
import { Allocator } from '../../allocator/allocator';
import { InMemoryRoomRegistry } from '../../allocator/registry';
import { DirectRouter } from '../../allocator/router';
import { createAllocatorServer } from '../../allocator/index';
import { buildRegistration } from '../../server/heartbeat';
import { FLEET_AUTH_HEADER, signFleetRequest } from '../../src/net/fleet-auth';
import { allocateRoom, joinRoom } from '../../src/net/allocator-client';
import type { AllocatorClientConfig, ResolvedConnection } from '../../src/net/allocator-client';
import { allocatorTransport, createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';
import type { MatchServerHarness } from './node-websocket';

const SECRET = 'allocator-and-machine-share-this';
const MACHINE = 'm-local';

/** The allocator process on an ephemeral port, routing every room to the one
 *  match server the test stood up. */
async function startAllocator(matchUrl: string): Promise<{ base: string; server: Server }> {
  const registry = new InMemoryRoomRegistry();
  const allocator = new Allocator({ registry, rng: mulberry32(7), secret: SECRET });
  const server = createAllocatorServer({
    allocator,
    registry,
    // One Machine in this fleet: route every room to its real ws URL.
    router: new DirectRouter(() => matchUrl),
    now: Date.now,
    secret: SECRET,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server };
}

/** What `server/index.ts` does on boot: POST /register, authenticated with the
 *  shared secret. Built from the same pieces the server uses, so the test drives
 *  the real door rather than a stand-in. */
async function registerMachine(allocatorBase: string, harness: MatchServerHarness): Promise<Response> {
  const body = JSON.stringify(
    buildRegistration({
      identity: { machine: MACHINE, region: 'iad' },
      capacity: harness.matches.capacity,
      draining: false,
    }),
  );
  return fetch(`${allocatorBase}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [FLEET_AUTH_HEADER]: signFleetRequest(body, SECRET) },
    body,
  });
}

/** Resolve a connection or fail loudly with the allocator's reason. */
function connectionOf(result: Awaited<ReturnType<typeof allocateRoom>>): ResolvedConnection {
  if (!result.ok) throw new Error(`allocator refused: ${result.reason}`);
  return result.connection;
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('the allocator door: a registered Machine, an allocated room, two clients', () => {
  it('registers, allocates, and plays — the client reaching the room only via the allocator', async () => {
    // A match server that ENFORCES tickets (it is a fleet member) and knows its id.
    const harness = await startMatchServer({
      seed: 4242,
      slots: 2,
      asteroidCount: 10,
      ticketSecret: SECRET,
      machineId: MACHINE,
    });
    const alloc = await startAllocator(harness.url);
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await new Promise<void>((r) => alloc.server.close(() => r()));
      await harness.stop();
    };
    const client: AllocatorClientConfig = { baseUrl: alloc.base, fetch };

    // --- The Machine joins the fleet (authenticated). Now it is placeable. ------
    expect((await registerMachine(alloc.base, harness)).status).toBe(204);
    const listed = await (await fetch(`${alloc.base}/machines`)).json();
    expect(listed.machines.map((m: { machine: string }) => m.machine)).toEqual([MACHINE]);

    // --- Client one ALLOCATES a new room. The room code and the ws URL both come
    //     from the allocator's signed decision — the client hard-codes neither. ---
    const first = connectionOf(await allocateRoom(client, { size: 2 }));
    expect(first.machine).toBe(MACHINE);
    expect(first.room).toMatch(/^[A-Z2-9]{4}$/);

    const alice = createOnlineSession({
      url: first.url,
      room: first.room,
      shipClass: ShipClass.Interceptor,
      transport: { connect: nodeWebSocket, ...allocatorTransport(first, client) },
    });
    sessions.push(alice);
    await until('the allocated room to exist on the Machine', () => harness.matches.room(first.room) !== undefined);
    const room = harness.matches.room(first.room);
    if (!room) throw new Error('the room was never created');
    // The ticket carried the requested size onto the Machine (variable-slots C1).
    expect(room.size).toBe(2);

    // --- Client two JOINS the same room, by code, through the allocator. --------
    const second = connectionOf(await joinRoom(client, first.room));
    expect(second.room).toBe(first.room);
    expect(second.machine).toBe(MACHINE);
    const bob = createOnlineSession({
      url: second.url,
      room: second.room,
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket, ...allocatorTransport(second, client) },
    });
    sessions.push(bob);
    await until('both seats filled', () => room.humanCount === 2);

    // --- RUSH! — the creator starts, both clients build the server's world. -----
    alice.startMatch();
    await until('both clients to have a world', () => alice.world !== null && bob.world !== null);
    expect(alice.world?.ships.map((s) => s.shipClass)).toEqual([ShipClass.Interceptor, ShipClass.Hauler]);
    expect(bob.world?.ships.length).toBe(2);

    // The match actually runs on the server behind the allocated connection.
    const authority = room.world;
    if (!authority) throw new Error('the room never started its match');
    await until('the server to simulate past its first second', () => authority.tick > 60);
  }, 30_000);

  it('refuses a join the allocator never signed — the Machine fails closed', async () => {
    const harness = await startMatchServer({
      seed: 99,
      slots: 2,
      ticketSecret: SECRET,
      machineId: MACHINE,
    });
    const alloc = await startAllocator(harness.url);
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await new Promise<void>((r) => alloc.server.close(() => r()));
      await harness.stop();
    };
    await registerMachine(alloc.base, harness);

    // A client that dials the Machine directly with NO allocator ticket: the join
    // is refused, so no room is ever created on the enforcing Machine.
    const rogue = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Interceptor,
      transport: { connect: nodeWebSocket }, // no ticket
    });
    sessions.push(rogue);
    // Give the refusal time to land, then confirm the room was never opened.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(harness.matches.room('RUSH')).toBeUndefined();
  }, 20_000);
});
