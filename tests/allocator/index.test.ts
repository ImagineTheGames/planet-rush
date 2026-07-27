/**
 * tests/allocator/index.test.ts — the allocator process, over a real socket
 * (Task 8). Everything below is exercised through `createAllocatorServer`: the
 * five HTTP routes, body parsing, the {@link AllocatorError}→status mapping, and
 * the {@link Router} seam writing either a `fly-replay` header or a connect URL.
 * The factory does not listen on import, so this file also pulls `index.ts` into
 * the typechecker without the process ever binding a port at module load.
 * OWNER: Netcode Engineer (docs/hosting-plan.md T8).
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mulberry32 } from '@shared/types';
import { InMemoryRoomRegistry, type Heartbeat } from '../../allocator/registry';
import { Allocator } from '../../allocator/allocator';
import { DirectRouter, FlyReplayRouter, type Router } from '../../allocator/router';
import { verifyTicket } from '../../src/net/ticket';
import { createAllocatorServer } from '../../allocator/index';

const SECRET = 'allocator-and-machine-share-this';

function heartbeat(machine: string, region: string, rooms: string[], capacity = 8): Heartbeat {
  return { machine, region, capacity, rooms: rooms.map((code) => ({ code, players: 1 })) };
}

/** A live server on an ephemeral port, plus a `now` the test controls. */
async function serve(
  router: Router = new DirectRouter((m) => `wss://${m}.test/`),
): Promise<{
  base: string;
  registry: InMemoryRoomRegistry;
  now: { value: number };
  server: Server;
}> {
  const registry = new InMemoryRoomRegistry();
  const now = { value: 100_000 };
  const allocator = new Allocator({ registry, rng: mulberry32(1), secret: SECRET });
  const server = createAllocatorServer({
    allocator,
    registry,
    router,
    now: () => now.value,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, registry, now, server };
}

let open: Server | null = null;
beforeEach(() => {
  open = null;
});
afterEach(async () => {
  if (open) await new Promise<void>((r) => open!.close(() => r()));
});

/** Start a server, remember it for teardown, return the fixture. */
async function fixture(router?: Router): ReturnType<typeof serve> {
  const f = await serve(router);
  open = f.server;
  return f;
}

describe('GET /health', () => {
  it('reports fleet occupancy and stays plain HTTP', async () => {
    const { base, registry, now } = await fixture();
    registry.observe(heartbeat('m-1', 'iad', ['AAAA']), now.value);
    registry.observe(heartbeat('m-2', 'iad', []), now.value);

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.machines).toBe(2);
    expect(body.rooms).toBe(1);
    expect(typeof body.uptimeSeconds).toBe('number');
  });
});

describe('GET /regions', () => {
  it('summarises live capacity per region', async () => {
    const { base, registry, now } = await fixture();
    registry.observe(heartbeat('m-1', 'iad', ['AAAA'], 8), now.value);
    registry.observe(heartbeat('m-2', 'lhr', [], 4), now.value);

    const res = await fetch(`${base}/regions`);
    expect(res.status).toBe(200);
    const { regions } = await res.json();
    const iad = regions.find((r: { region: string }) => r.region === 'iad');
    const lhr = regions.find((r: { region: string }) => r.region === 'lhr');
    expect(iad).toMatchObject({ machines: 1, capacity: 8, rooms: 1, free: 7 });
    expect(lhr).toMatchObject({ machines: 1, capacity: 4, rooms: 0, free: 4 });
  });
});

describe('POST /fleet/heartbeat', () => {
  it('ingests a heartbeat so the fleet becomes known', async () => {
    const { base, registry, now } = await fixture();
    const res = await fetch(`${base}/fleet/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(heartbeat('m-1', 'iad', ['AAAA'])),
    });
    expect(res.status).toBe(204);
    expect(registry.locate('AAAA', now.value)).toBe('m-1');
  });

  it('rejects a malformed heartbeat with 400', async () => {
    const { base } = await fixture();
    const res = await fetch(`${base}/fleet/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: 'm-1' }), // missing region/capacity/rooms
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-JSON body with 400', async () => {
    const { base } = await fixture();
    const res = await fetch(`${base}/fleet/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /rooms — allocate a new room', () => {
  it('places a room onto a live Machine and returns a verifiable ticket', async () => {
    const { base, registry, now } = await fixture();
    registry.observe(heartbeat('m-1', 'iad', []), now.value);

    const res = await fetch(`${base}/rooms`, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.machine).toBe('m-1');
    expect(body.region).toBe('iad');
    expect(body.room).toMatch(/^[A-Z2-9]{4}$/);
    expect(body.connectUrl).toBe('wss://m-1.test/'); // DirectRouter
    expect(verifyTicket(body.ticket, SECRET, now.value)).toEqual({
      room: body.room,
      machine: 'm-1',
      expiresAt: body.expiresAt,
    });
    // The room is reserved, so it is immediately joinable through the boot gap.
    expect(registry.locate(body.room, now.value)).toBe('m-1');
  });

  it('honours a requested region in the JSON body', async () => {
    const { base, registry, now } = await fixture();
    registry.observe(heartbeat('m-1', 'iad', []), now.value);
    registry.observe(heartbeat('m-2', 'lhr', []), now.value);

    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region: 'lhr' }),
    });
    expect((await res.json()).machine).toBe('m-2');
  });

  it('returns 503 when the fleet has no capacity', async () => {
    const { base } = await fixture(); // empty fleet
    const res = await fetch(`${base}/rooms`, { method: 'POST' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('no-capacity');
  });

  it('sets a fly-replay header instead of a URL under a FlyReplayRouter', async () => {
    const { base, registry, now } = await fixture(new FlyReplayRouter({ selfRegion: 'iad' }));
    registry.observe(heartbeat('m-1', 'iad', []), now.value);

    const res = await fetch(`${base}/rooms`, { method: 'POST' });
    expect(res.headers.get('fly-replay')).toBe('instance=m-1');
    expect((await res.json()).connectUrl).toBeNull();
  });
});

describe('POST /rooms — the requested match config (Task C1/C3)', () => {
  it('signs the body\'s size and mode into the ticket', async () => {
    const { base, registry, now } = await fixture();
    registry.observe(heartbeat('m-1', 'iad', []), now.value);

    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ size: 4, mode: 'teams' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(verifyTicket(body.ticket, SECRET, now.value)).toMatchObject({ size: 4, mode: 'teams' });
  });

  it('still allocates a default room when the body names no size', async () => {
    const { base, registry, now } = await fixture();
    registry.observe(heartbeat('m-1', 'iad', []), now.value);
    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region: 'iad' }),
    });
    expect(res.status).toBe(201);
    expect(verifyTicket((await res.json()).ticket, SECRET, now.value)?.size).toBeUndefined();
  });
});

describe('GET /rooms/:code — advertise a room before dialing (Task C3)', () => {
  it('reports the room\'s advertised config', async () => {
    const { base, registry, now } = await fixture();
    registry.observe(
      {
        machine: 'm-1',
        region: 'iad',
        capacity: 8,
        rooms: [{ code: 'K7QM', players: 1, size: 4, mode: 'ffa', joinableSeats: 3 }],
      },
      now.value,
    );

    const res = await fetch(`${base}/rooms/K7QM`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: 'K7QM',
      machine: 'm-1',
      region: 'iad',
      size: 4,
      mode: 'ffa',
      joinableSeats: 3,
      joinable: true,
    });
  });

  it('404s a code no live Machine hosts', async () => {
    const { base } = await fixture();
    const res = await fetch(`${base}/rooms/ZZZZ`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not-found');
  });

  it('405s a POST to the room-info path (that shape is GET-only)', async () => {
    const { base } = await fixture();
    // POST /rooms/:code (no /join) is a method error, not a missing route.
    const res = await fetch(`${base}/rooms/K7QM`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('POST /rooms/:code/join — reach an existing room', () => {
  it('issues a ticket for the Machine hosting the code', async () => {
    const { base, registry, now } = await fixture();
    registry.observe(heartbeat('m-1', 'iad', ['K7QM']), now.value);

    const res = await fetch(`${base}/rooms/K7QM/join`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.room).toBe('K7QM');
    expect(body.machine).toBe('m-1');
    expect(verifyTicket(body.ticket, SECRET, now.value)?.machine).toBe('m-1');
  });

  it('returns 404 for a code no live Machine hosts', async () => {
    const { base } = await fixture();
    const res = await fetch(`${base}/rooms/ZZZZ/join`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not-found');
  });
});

describe('unknown routes', () => {
  it('404s an unknown path', async () => {
    const { base } = await fixture();
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('405s a known path with the wrong method', async () => {
    const { base } = await fixture();
    // /rooms is POST-only; GET is a method error, not a missing route.
    expect((await fetch(`${base}/rooms`)).status).toBe(405);
  });
});
