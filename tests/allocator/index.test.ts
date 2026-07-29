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
import { DEFAULT_LIVENESS_MS, InMemoryRoomRegistry, type Heartbeat } from '../../allocator/registry';
import { Allocator } from '../../allocator/allocator';
import { DirectRouter, FlyReplayRouter, type Router } from '../../allocator/router';
import { verifyTicket } from '../../src/net/ticket';
import { FLEET_AUTH_HEADER, signFleetRequest } from '../../src/net/fleet-auth';
import { createAllocatorServer } from '../../allocator/index';

const SECRET = 'allocator-and-machine-share-this';

function heartbeat(machine: string, region: string, rooms: string[], capacity = 8): Heartbeat {
  return { machine, region, capacity, rooms: rooms.map((code) => ({ code, players: 1 })) };
}

/** POST init that authenticates the body with the shared secret (M10). */
function authPost(body: unknown): RequestInit {
  const raw = JSON.stringify(body);
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [FLEET_AUTH_HEADER]: signFleetRequest(raw, SECRET),
    },
    body: raw,
  };
}

/** Options a fixture is stood up with (all optional — the defaults reproduce the
 *  pre-M10 open server). */
interface ServeOptions {
  readonly router?: Router;
  /** Turn on fleet-write authentication (M10). Omitted → those routes stay open. */
  readonly secret?: string;
  /** Browser origins the CORS layer grants (M10). */
  readonly allowOrigins?: readonly string[];
}

/** A live server on an ephemeral port, plus a `now` the test controls. */
async function serve(opts: ServeOptions = {}): Promise<{
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
    router: opts.router ?? new DirectRouter((m) => `wss://${m}.test/`),
    now: () => now.value,
    ...(opts.secret !== undefined ? { secret: opts.secret } : {}),
    ...(opts.allowOrigins !== undefined ? { allowOrigins: opts.allowOrigins } : {}),
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
async function fixture(opts: ServeOptions = {}): ReturnType<typeof serve> {
  const f = await serve(opts);
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
    const { base, registry, now } = await fixture({ router: new FlyReplayRouter({ selfRegion: 'iad' }) });
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

// ---------------------------------------------------------------------------
// M10 — fleet registration, its authentication, and CORS
// ---------------------------------------------------------------------------

describe('POST /register — a Machine announces itself (M10)', () => {
  it('registers an authenticated Machine so it becomes placeable and listed', async () => {
    const { base, registry, now } = await fixture({ secret: SECRET });

    const res = await fetch(`${base}/register`, authPost({ machine: 'm-1', region: 'iad', capacity: 32 }));
    expect(res.status).toBe(204);
    // The registry now knows m-1, with the capacity it announced and no rooms yet.
    const fleet = registry.machines(now.value);
    expect(fleet).toHaveLength(1);
    expect(fleet[0]).toMatchObject({ machine: 'm-1', region: 'iad', capacity: 32 });
    expect(fleet[0]?.rooms).toEqual([]);
  });

  it('fails closed on a missing or wrong auth proof (401)', async () => {
    const { base, registry, now } = await fixture({ secret: SECRET });
    const body = { machine: 'm-evil', region: 'iad', capacity: 32 };

    // No proof at all.
    const unsigned = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(unsigned.status).toBe(401);

    // A proof made under the wrong secret.
    const raw = JSON.stringify(body);
    const forged = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [FLEET_AUTH_HEADER]: signFleetRequest(raw, 'wrong') },
      body: raw,
    });
    expect(forged.status).toBe(401);

    // Nothing was registered by either attempt.
    expect(registry.machines(now.value)).toEqual([]);
  });

  it('400s a well-authenticated but malformed registration', async () => {
    const { base } = await fixture({ secret: SECRET });
    const res = await fetch(`${base}/register`, authPost({ machine: 'm-1' })); // no region/capacity
    expect(res.status).toBe(400);
  });
});

describe('POST /fleet/heartbeat — now authenticated (M10)', () => {
  it('ingests a signed heartbeat and rejects an unsigned one', async () => {
    const { base, registry, now } = await fixture({ secret: SECRET });

    const ok = await fetch(`${base}/fleet/heartbeat`, authPost(heartbeat('m-1', 'iad', ['AAAA'])));
    expect(ok.status).toBe(204);
    expect(registry.locate('AAAA', now.value)).toBe('m-1');

    const unsigned = await fetch(`${base}/fleet/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(heartbeat('m-2', 'iad', ['BBBB'])),
    });
    expect(unsigned.status).toBe(401);
    expect(registry.locate('BBBB', now.value)).toBeNull();
  });
});

describe('POST /deregister — a Machine leaves the fleet (M10)', () => {
  it('forgets a Machine at once, authenticated and fail-closed', async () => {
    const { base, registry, now } = await fixture({ secret: SECRET });
    registry.observe(heartbeat('m-1', 'iad', ['AAAA']), now.value);

    // Unsigned deregister is refused — a stranger cannot evict a live Machine.
    const unsigned = await fetch(`${base}/deregister`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: 'm-1' }),
    });
    expect(unsigned.status).toBe(401);
    expect(registry.machines(now.value)).toHaveLength(1);

    // Signed deregister removes it immediately.
    const res = await fetch(`${base}/deregister`, authPost({ machine: 'm-1' }));
    expect(res.status).toBe(204);
    expect(registry.machines(now.value)).toEqual([]);
  });
});

describe('GET /machines — the operator (and the deploy check) reads the fleet (M10)', () => {
  it('lists live Machines with their region, capacity, and room count', async () => {
    const { base, now } = await fixture({ secret: SECRET });
    // Empty before anyone registers — the machines:0 the live probe kept seeing.
    expect((await (await fetch(`${base}/machines`)).json()).machines).toEqual([]);

    await fetch(`${base}/register`, authPost({ machine: 'm-1', region: 'iad', capacity: 32 }));
    const res = await fetch(`${base}/machines`);
    expect(res.status).toBe(200);
    const { machines } = await res.json();
    expect(machines).toHaveLength(1);
    expect(machines[0]).toMatchObject({ machine: 'm-1', region: 'iad', capacity: 32, rooms: 0 });
    expect(machines[0].lastSeen).toBe(now.value);
  });
});

describe('the door as a door: register → allocate → 503-when-empty → heartbeat-expiry (M10)', () => {
  it('walks the whole membership lifecycle through the real HTTP routes', async () => {
    const { base, now } = await fixture({ secret: SECRET });

    // 1) Empty fleet: an allocate cannot be answered — 503, no capacity.
    expect((await fetch(`${base}/rooms`, { method: 'POST' })).status).toBe(503);

    // 2) A Machine registers itself (authenticated). Now the fleet has capacity.
    expect((await fetch(`${base}/register`, authPost({ machine: 'm-1', region: 'iad', capacity: 8 }))).status).toBe(204);
    expect((await (await fetch(`${base}/machines`)).json()).machines).toHaveLength(1);

    // 3) An allocate now places a room and mints a ticket for m-1.
    const placed = await fetch(`${base}/rooms`, { method: 'POST' });
    expect(placed.status).toBe(201);
    expect((await placed.json()).machine).toBe('m-1');

    // 4) The Machine goes silent. Past the liveness window (and its reservation's
    //    TTL) the registry expires it, and an allocate falls back to 503 — the
    //    same empty-fleet answer, reached this time by a missed heartbeat.
    now.value += DEFAULT_LIVENESS_MS + 1;
    expect((await (await fetch(`${base}/machines`)).json()).machines).toEqual([]);
    expect((await fetch(`${base}/rooms`, { method: 'POST' })).status).toBe(503);
  });
});

describe('CORS — the browser can reach the client routes (M10)', () => {
  const PAGES = 'https://imaginethegames.github.io';

  it('answers an OPTIONS preflight with 204 and the allowed verbs + origin', async () => {
    const { base } = await fixture({ allowOrigins: [PAGES] });
    const res = await fetch(`${base}/rooms`, {
      method: 'OPTIONS',
      headers: {
        origin: PAGES,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(PAGES);
    expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
    expect(res.headers.get('access-control-allow-headers')).toMatch(/content-type/);
  });

  it('echoes Access-Control-Allow-Origin on the actual allocate for an allowed origin', async () => {
    const { base, registry, now } = await fixture({ allowOrigins: [PAGES] });
    registry.observe(heartbeat('m-1', 'iad', []), now.value);
    const res = await fetch(`${base}/rooms`, { method: 'POST', headers: { origin: PAGES } });
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe(PAGES);
    expect(res.headers.get('vary')).toMatch(/Origin/i);
  });

  it('grants any localhost dev origin without configuration', async () => {
    const { base } = await fixture();
    const res = await fetch(`${base}/health`, { headers: { origin: 'http://localhost:5173' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('withholds the grant from an origin that is not allow-listed', async () => {
    const { base } = await fixture({ allowOrigins: [PAGES] });
    const res = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
