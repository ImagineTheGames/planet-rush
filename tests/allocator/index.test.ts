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
import {
  DirectProbeTargeter,
  FLY_PREFER_REGION_HEADER,
  FlyPreferRegionTargeter,
  type ProbeTargeter,
} from '../../allocator/probe-target';
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
  /** How a client is told to time a region (the picker, n3). Omitted → /regions
   *  publishes capacity alone, exactly as it did before there was a picker. */
  readonly probeTargeter?: ProbeTargeter;
}

/** A live server on an ephemeral port, plus a `now` the test controls. `logs`
 *  captures the placement lines the process would otherwise print. */
async function serve(opts: ServeOptions = {}): Promise<{
  base: string;
  registry: InMemoryRoomRegistry;
  now: { value: number };
  logs: string[];
  server: Server;
}> {
  const registry = new InMemoryRoomRegistry();
  const now = { value: 100_000 };
  const logs: string[] = [];
  const allocator = new Allocator({ registry, rng: mulberry32(1), secret: SECRET });
  const server = createAllocatorServer({
    allocator,
    registry,
    router: opts.router ?? new DirectRouter((m) => `wss://${m}.test/`),
    now: () => now.value,
    log: (line) => logs.push(line),
    ...(opts.secret !== undefined ? { secret: opts.secret } : {}),
    ...(opts.allowOrigins !== undefined ? { allowOrigins: opts.allowOrigins } : {}),
    ...(opts.probeTargeter !== undefined ? { probeTargeter: opts.probeTargeter } : {}),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, registry, now, logs, server };
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

  it('publishes where to TIME each region, from the deployment’s targeter', async () => {
    const { base, registry, now } = await fixture({
      probeTargeter: new DirectProbeTargeter((m) => `ws://${m}.test:8080/`),
    });
    registry.observe(heartbeat('m-1', 'iad', []), now.value);
    registry.observe(heartbeat('m-2', 'gru', []), now.value);

    const { regions } = await (await fetch(`${base}/regions`)).json();
    const target = (id: string): unknown =>
      regions.find((r: { region: string }) => r.region === id)?.probe;
    expect(target('iad')).toEqual({ url: 'http://m-1.test:8080/health' });
    expect(target('gru')).toEqual({ url: 'http://m-2.test:8080/health' });
  });

  it('behind the edge, every region shares one URL and differs by its steer', async () => {
    const { base, registry, now } = await fixture({
      probeTargeter: new FlyPreferRegionTargeter('https://gameserver.fly.dev/health'),
    });
    registry.observe(heartbeat('m-1', 'iad', []), now.value);
    registry.observe(heartbeat('m-2', 'gru', []), now.value);

    const { regions } = await (await fetch(`${base}/regions`)).json();
    for (const region of regions as { region: string; probe: { url: string; headers: Record<string, string> } }[]) {
      expect(region.probe.url).toBe('https://gameserver.fly.dev/health');
      expect(region.probe.headers[FLY_PREFER_REGION_HEADER]).toBe(region.region);
    }
  });

  it('with no targeter configured, answers exactly the capacity shape it always has', async () => {
    const { base, registry, now } = await fixture();
    registry.observe(heartbeat('m-1', 'iad', []), now.value);

    const { regions } = await (await fetch(`${base}/regions`)).json();
    expect(regions[0].probe).toBeUndefined();
    expect(regions[0]).toMatchObject({ region: 'iad', machines: 1 });
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
      // An allocate is a *create* (a0-26 Milestone A) — the room does not exist
      // until this ticket's join reaches the Machine.
      intent: 'create',
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

  it('hands back the shared gameserver connectUrl and NO fly-replay header under a FlyReplayRouter', async () => {
    // The machine-pin must NOT ride the JSON response: on the Fly edge a
    // `fly-replay` header there replays the POST at the gameserver and the client
    // never receives its {room, ticket}. The client dials the shared connectUrl and
    // the SOCKET hop pins it to the room's host (allocator/index.ts `decided`).
    const { base, registry, now } = await fixture({
      router: new FlyReplayRouter({ selfRegion: 'iad', connectUrl: 'wss://gs.test/play' }),
    });
    registry.observe(heartbeat('m-1', 'iad', []), now.value);

    const res = await fetch(`${base}/rooms`, { method: 'POST' });
    expect(res.status).toBe(201);
    expect(res.headers.get('fly-replay')).toBeNull();
    expect((await res.json()).connectUrl).toBe('wss://gs.test/play');
  });
});

/**
 * The ratified guarantee, over the wire: placement is *policy*, and the policy is
 * "the creator's region whenever it has capacity". The fleet in these tests is the
 * live one — iad ×2 + gru ×1 — and the creator is the developer in Minas Gerais,
 * whose requests arrive through Fly's gru edge (verified live: `Fly-Region: gru`).
 */
describe('POST /rooms — the creator lands in their own region (region placement)', () => {
  /** The live fleet's shape: two Virginia Machines and one São Paulo Machine. */
  function liveFleet(registry: InMemoryRoomRegistry, at: number, gruCapacity = 8): void {
    registry.observe(heartbeat('m-iad-a', 'iad', []), at);
    registry.observe(heartbeat('m-iad-b', 'iad', []), at);
    registry.observe(heartbeat('m-gru', 'gru', [], gruCapacity), at);
  }

  it('infers the region from Fly\'s edge header and prefers it', async () => {
    const { base, registry, now } = await fixture();
    liveFleet(registry, now.value);

    // No body at all — exactly what the shipped client now sends, since it has no
    // region picker to speak for the player.
    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'fly-region': 'gru' },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.machine).toBe('m-gru');
    expect(body.region).toBe('gru');
    expect(body.placement).toEqual({
      requested: 'gru',
      region: 'gru',
      reason: 'preferred',
      detail: 'gru — your region',
    });
  });

  it('falls back to the fleet — with the reason — when the creator region is full', async () => {
    const { base, registry, now } = await fixture();
    liveFleet(registry, now.value, 1);
    registry.observe(heartbeat('m-gru', 'gru', ['AAAA'], 1), now.value); // gru: 1/1

    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'fly-region': 'gru' },
    });
    const body = await res.json();

    // Never refuse capacity the fleet has: a placed match beats a refused one.
    expect(res.status).toBe(201);
    expect(body.region).toBe('iad');
    expect(body.placement).toEqual({
      requested: 'gru',
      region: 'iad',
      reason: 'region-full',
      detail: 'iad — gru full',
    });
  });

  it('still allocates when there is no header to read (off Fly, or a bare client)', async () => {
    const { base, registry, now } = await fixture();
    liveFleet(registry, now.value);

    const res = await fetch(`${base}/rooms`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.machine).toBeTruthy();
    expect(body.placement.reason).toBe('no-preference');
    expect(body.placement.requested).toBeUndefined();
  });

  it('lets a body-supplied region outrank the edge — a chosen region is a choice', async () => {
    const { base, registry, now } = await fixture();
    liveFleet(registry, now.value);

    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'fly-region': 'gru' },
      body: JSON.stringify({ region: 'iad' }),
    });
    const body = await res.json();

    expect(body.region).toBe('iad');
    expect(body.placement).toEqual({
      requested: 'iad',
      region: 'iad',
      reason: 'preferred',
      detail: 'iad — your region',
    });
  });

  it('falls back to the edge when the body\'s region is an empty string', async () => {
    const { base, registry, now } = await fixture();
    liveFleet(registry, now.value);

    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'fly-region': 'gru' },
      body: JSON.stringify({ region: '', size: 4 }),
    });
    expect((await res.json()).region).toBe('gru');
  });

  it('reads the region off the request id when the direct header is absent', async () => {
    const { base, registry, now } = await fixture();
    liveFleet(registry, now.value);

    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'fly-request-id': '01KYTQS8FBEA8JW7GYH7KQYPGE-gru' },
    });
    expect((await res.json()).machine).toBe('m-gru');
  });

  it('places a dfw request in iad — an unserved POP is a place, not a shrug (n9-01)', async () => {
    // The acceptance case, end to end and with nothing in the body: the developer
    // in Florida, whose requests arrive on the `dfw` POP, which this fleet has
    // never run a Machine in. Reproduced live on 2026-08-11 against
    // planet-rush-allocator.fly.dev — three of these returned iad, iad, **gru**,
    // with twelve free slots still sitting in iad.
    const { base, registry, now, logs } = await fixture();
    liveFleet(registry, now.value);

    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'fly-region': 'dfw' },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.region).toBe('iad');
    expect(body.placement).toEqual({
      requested: 'dfw',
      region: 'iad',
      reason: 'region-absent',
      detail: 'iad — no dfw machines',
    });
    // The operator's half: `fly logs` says which region and why, unchanged.
    expect(logs).toEqual([`room ${body.room} → ${body.machine} (iad — no dfw machines)`]);
  });

  it('places a dfw request in iad off the request id alone, with iad busier', async () => {
    // The same case through the fallback header, with the live shape that made
    // the third request cross the equator: both Virginia boxes carrying a room,
    // São Paulo idle. Load is a tie-break within a region, never a reason to
    // leave one. The request id is the real one this lane's machine was served.
    const { base, registry, now } = await fixture();
    registry.observe(heartbeat('m-iad-a', 'iad', ['AAAA']), now.value);
    registry.observe(heartbeat('m-iad-b', 'iad', ['BBBB']), now.value);
    registry.observe(heartbeat('m-gru', 'gru', []), now.value);

    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'fly-request-id': '01KZSDYDMAAWGP3E0ZER0NNXB7-dfw' },
    });
    const body = await res.json();

    expect(body.region).toBe('iad');
    expect(body.placement.requested).toBe('dfw');
  });

  it('sends a dfw request to gru only when iad has no slot left', async () => {
    // Crossing the continent stays possible — it is just a capacity decision now.
    const { base, registry, now } = await fixture();
    registry.observe(heartbeat('m-iad-a', 'iad', ['AAAA'], 1), now.value);
    registry.observe(heartbeat('m-iad-b', 'iad', ['BBBB'], 1), now.value);
    registry.observe(heartbeat('m-gru', 'gru', []), now.value);

    const res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'fly-region': 'dfw' },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.region).toBe('gru');
    expect(body.placement.reason).toBe('region-absent');
  });

  it('writes the decision to the process log, in the same words', async () => {
    const { base, registry, now, logs } = await fixture();
    liveFleet(registry, now.value);

    const res = await fetch(`${base}/rooms`, { method: 'POST', headers: { 'fly-region': 'gru' } });
    const body = await res.json();

    expect(logs).toEqual([`room ${body.room} → m-gru (gru — your region)`]);
  });

  it('logs nothing for a join — a join makes no placement decision', async () => {
    const { base, registry, now, logs } = await fixture();
    registry.observe(heartbeat('m-gru', 'gru', ['AAAA']), now.value);

    const res = await fetch(`${base}/rooms/AAAA/join`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.placement).toBeUndefined();
    expect(logs).toEqual([]);
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
    // /rooms takes POST (allocate) and GET (the a0-26 browse list) and nothing
    // else; a PUT is a method error, not a missing route.
    expect((await fetch(`${base}/rooms`, { method: 'PUT' })).status).toBe(405);
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
