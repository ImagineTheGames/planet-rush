/**
 * tests/allocator/room-list.test.ts — **the lobby browser's list route**, and the
 * two ways a row is allowed to fail. OWNER: Netcode Engineer (a0-26;
 * `docs/lobby-browser-plan.md` §1, §3, §4; Milestones B4/B5).
 *
 * The developer asked for a browse list with a JOIN button on the row, and
 * refined what a row may say:
 *
 *   > *"a browse shouldn't show the room code, just the room owner id and
 *   > location / ping"*
 *
 * So the two properties this file exists to pin are: **a listing publishes no
 * room code**, and **a row is joinable anyway**. Everything else here is the
 * plan's exclusions (§1) and its staleness rules (§3), each asserted against an
 * **injected clock** — never `Date.now()` (Trap 12), because the whole staleness
 * envelope is only testable because every registry method takes `now`.
 *
 * The refusals are the reason the plan called a bad list *worse than no list*: a
 * photograph up to ten seconds old will be wrong, and the two ways it is wrong —
 * the room is gone, the seat was taken — must reach the player as two different
 * sentences.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mulberry32 } from '@shared/types';
import {
  DEFAULT_LIVENESS_MS,
  InMemoryRoomRegistry,
  type Heartbeat,
  type Room,
} from '../../allocator/registry';
import { Allocator, AllocatorError } from '../../allocator/allocator';
import { CODE_ALPHABET, CODE_LENGTH } from '../../src/net/room-code';
import { DirectRouter } from '../../allocator/router';
import { OWNER_TAG_LENGTH, listingId, ownerTag } from '../../allocator/listing';
import { verifyTicket } from '../../src/net/ticket';
import { createAllocatorServer } from '../../allocator/index';

const SECRET = 'allocator-and-machine-share-this';
const NOW = 100_000;

/** A room as a Machine's heartbeat states it — a lobby-phase room by default. */
function room(code: string, over: Partial<Room> = {}): Room {
  return { code, players: 1, size: 8, mode: 'ffa', joinableSeats: 7, ...over };
}

/** One Machine's beat. */
function beat(machine: string, region: string, rooms: Room[], capacity = 8): Heartbeat {
  return { machine, region, capacity, rooms };
}

/** An allocator over a registry the test feeds directly. */
function withFleet(beats: Heartbeat[], at = NOW): {
  reg: InMemoryRoomRegistry;
  alloc: Allocator;
} {
  const reg = new InMemoryRoomRegistry();
  for (const hb of beats) reg.observe(hb, at);
  return { reg, alloc: new Allocator({ registry: reg, rng: mulberry32(1), secret: SECRET }) };
}

/** Run `fn`, expect an AllocatorError, and return its reason. */
function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AllocatorError);
    return (e as AllocatorError).reason;
  }
  throw new Error('expected an AllocatorError, but nothing was thrown');
}

// ---------------------------------------------------------------------------
// What a row says
// ---------------------------------------------------------------------------

describe('Allocator.rooms — what the browser is shown', () => {
  it('publishes the owner id, the region and the seats — and never the code', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);

    const rows = alloc.rooms(NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: listingId('K7QM', SECRET),
      owner: ownerTag('K7QM', SECRET),
      region: 'iad',
      size: 8,
      mode: 'ffa',
      players: 1,
      joinableSeats: 7,
    });
    // The whole payload, not just the fields we happened to name: no code.
    expect(JSON.stringify(rows)).not.toContain('K7QM');
  });

  it('shows humans and open seats as the ad measures them — never as arithmetic', () => {
    // A host alone in an 8-seat room who authored bots and shut two chairs: the
    // room says 1 human and 3 open seats, and `size − players` is 7 (Trap 3).
    const { alloc } = withFleet([
      beat('m-1', 'iad', [room('K7QM', { players: 1, size: 8, joinableSeats: 3 })]),
    ]);

    expect(alloc.rooms(NOW)[0]).toMatchObject({ players: 1, joinableSeats: 3 });
  });

  it('carries the mode a room was shaped into', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('K7QM', { mode: 'teams' })])]);
    expect(alloc.rooms(NOW)[0]?.mode).toBe('teams');
  });

  it('lists every joinable room across the whole fleet, region by region', () => {
    const { alloc } = withFleet([
      beat('m-1', 'iad', [room('AAAA'), room('BBBB')]),
      beat('m-2', 'gru', [room('CCCC')]),
    ]);

    expect(alloc.rooms(NOW).map((r) => r.region).sort()).toEqual(['gru', 'iad', 'iad']);
  });

  it('is empty when the fleet has nothing to offer, rather than absent', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [])]);
    expect(alloc.rooms(NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The tokens — how a row names a room without naming its code
// ---------------------------------------------------------------------------

describe('the derived tokens (a0-26 — the row names a room, not a code)', () => {
  it('mints a stable handle per room, and a different one per room', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('AAAA'), room('BBBB')])]);

    const first = alloc.rooms(NOW);
    const again = alloc.rooms(NOW + 5_000);

    expect(first.map((r) => r.id)).toEqual(again.map((r) => r.id));
    expect(first[0]?.id).not.toBe(first[1]?.id);
  });

  it('survives an allocator restart — the tokens are derived, never stored', () => {
    // The registry is a cache that holds nothing a heartbeat cannot restate
    // (allocator/registry.ts). A rebuilt allocator on the same secret must agree,
    // or a browser's open row would break on every deploy.
    const before = withFleet([beat('m-1', 'iad', [room('K7QM')])]).alloc.rooms(NOW);
    const after = withFleet([beat('m-1', 'iad', [room('K7QM')])]).alloc.rooms(NOW);

    expect(before[0]?.id).toBe(after[0]?.id);
    expect(before[0]?.owner).toBe(after[0]?.owner);
  });

  it('is not the code in a different encoding — a different secret, a different token', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', 'iad', [room('K7QM')]), NOW);
    const other = new Allocator({ registry: reg, rng: mulberry32(1), secret: 'a-different-key' });

    expect(other.rooms(NOW)[0]?.id).not.toBe(listingId('K7QM', SECRET));
  });

  it('shows an owner id that cannot be mistaken for — or typed as — a code', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);
    const owner = alloc.rooms(NOW)[0]!.owner;

    expect(owner).toHaveLength(OWNER_TAG_LENGTH);
    expect(owner.length).not.toBe(CODE_LENGTH); // the keypad takes four
    for (const ch of owner) expect(CODE_ALPHABET).toContain(ch); // the legible deck
    expect(owner).not.toBe('K7QM');
  });

  it('keeps the two tokens independent — the visible one is not the join key', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);
    const [row] = alloc.rooms(NOW);

    expect(row?.owner).not.toBe(row?.id);
    expect(row?.id).not.toContain(row?.owner ?? '');
  });
});

// ---------------------------------------------------------------------------
// What the list refuses to show (plan §1)
// ---------------------------------------------------------------------------

describe('what a listing excludes, and why', () => {
  it('excludes a lease-only room — the boot gap is the biggest ghost-row source', () => {
    const { reg, alloc } = withFleet([beat('m-1', 'iad', [])]);
    reg.reserve('WXYZ', 'm-1', NOW, { size: 4, mode: 'ffa' });

    expect(alloc.rooms(NOW)).toEqual([]);
    // …and the *other* question still gets the other answer: a creator reaching
    // their own room through the gap is unaffected (Trap 1).
    expect(alloc.roomInfo('WXYZ', NOW)).toMatchObject({ joinable: true, size: 4 });
  });

  it('excludes a full room', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('FULL', { joinableSeats: 0 })])]);
    expect(alloc.rooms(NOW)).toEqual([]);
  });

  it('excludes a room whose Machine does not measure its seats at all', () => {
    // `roomInfo` answers "joinable" here, because the Machine backstops the dial.
    // A row has no backstop, so silence is an exclusion (isListable).
    const { alloc } = withFleet([
      beat('m-1', 'iad', [{ code: 'OLDM', players: 1 }]),
    ]);

    expect(alloc.rooms(NOW)).toEqual([]);
    expect(alloc.roomInfo('OLDM', NOW)?.joinable).toBe(true);
  });

  it('excludes a room whose host said PRIVATE — and leaves its code working', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('PRIV', { listed: false })])]);

    expect(alloc.rooms(NOW)).toEqual([]);
    // Unlisted is not unreachable: the code path a1-13 evidenced is untouched.
    expect(alloc.roomInfo('PRIV', NOW)).toMatchObject({ joinable: true });
    expect(alloc.join('PRIV', NOW).room).toBe('PRIV');
  });

  it('lists a room whose heartbeat omits the flag — absent reads as listed', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('OKAY')])]);
    expect(alloc.rooms(NOW)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// A dying Machine (plan §1's named failure mode)
// ---------------------------------------------------------------------------

describe('a Machine that dies mid-match', () => {
  it('keeps its rooms listed for exactly the liveness window, then drops them', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);

    expect(alloc.rooms(NOW + DEFAULT_LIVENESS_MS)).toHaveLength(1);
    expect(alloc.rooms(NOW + DEFAULT_LIVENESS_MS + 1)).toEqual([]);
  });

  it('drops them at once when the Machine deregisters — a rolled deploy shows no ghost', () => {
    const { reg, alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);

    reg.remove('m-1');

    expect(alloc.rooms(NOW)).toEqual([]);
  });

  it('cannot be more wrong than the allocator itself — the list dies on the placement clock', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);
    const past = NOW + DEFAULT_LIVENESS_MS + 1;

    expect(alloc.rooms(past)).toEqual([]);
    // The same instant the room stops being listed, it stops being locatable.
    expect(reasonOf(() => alloc.join('K7QM', past))).toBe('not-found');
  });
});

// ---------------------------------------------------------------------------
// Joining from a row (the developer: "there should be a join button")
// ---------------------------------------------------------------------------

describe('Allocator.joinListing — a public room is joinable from the list', () => {
  it('signs a ticket for the room the handle names, with a join intent', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);
    const [row] = alloc.rooms(NOW);

    const allocation = alloc.joinListing(row!.id, NOW);

    expect(allocation.room).toBe('K7QM');
    expect(allocation.machine).toBe('m-1');
    expect(allocation.region).toBe('iad');
    // `join`, so a room that died inside this heartbeat is refused at the Machine
    // rather than silently re-created (Milestone A).
    expect(verifyTicket(allocation.ticket, SECRET, NOW)?.intent).toBe('join');
  });

  it('reaches the room without the player ever holding its code first', () => {
    // The row is the only thing the caller had; the code comes back *from* the
    // join, exactly as it does for a host who allocates one.
    const { alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);
    const rows = alloc.rooms(NOW);

    expect(JSON.stringify(rows)).not.toContain('K7QM');
    expect(alloc.joinListing(rows[0]!.id, NOW).room).toBe('K7QM');
  });

  it('refuses a handle for a room that is gone — honestly, not silently', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);
    const [row] = alloc.rooms(NOW);

    // The Machine stops beating; the row a player is still looking at is dead.
    expect(reasonOf(() => alloc.joinListing(row!.id, NOW + DEFAULT_LIVENESS_MS + 1))).toBe(
      'not-found',
    );
  });

  it('refuses a handle that names nothing at all', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);
    expect(reasonOf(() => alloc.joinListing('not-a-real-handle', NOW))).toBe('not-found');
  });

  it('says FULL, not GONE, when the row was right and the seat was taken', () => {
    const { reg, alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);
    const [row] = alloc.rooms(NOW);

    // The last seat fills between beats — the staleness the plan measured at up
    // to 5 s + the client's poll.
    reg.observe(beat('m-1', 'iad', [room('K7QM', { players: 8, joinableSeats: 0 })]), NOW + 5_000);

    expect(reasonOf(() => alloc.joinListing(row!.id, NOW + 5_000))).toBe('room-full');
  });

  it('refuses a handle whose room has since gone PRIVATE — the code still works', () => {
    const { reg, alloc } = withFleet([beat('m-1', 'iad', [room('K7QM')])]);
    const [row] = alloc.rooms(NOW);

    reg.observe(beat('m-1', 'iad', [room('K7QM', { listed: false })]), NOW + 5_000);

    // The handle's authority is "join this room while it is publicly open", and
    // that is exactly the authority the host just withdrew. The code is a
    // different authority and is untouched.
    expect(reasonOf(() => alloc.joinListing(row!.id, NOW + 5_000))).toBe('not-found');
    expect(alloc.join('K7QM', NOW + 5_000).room).toBe('K7QM');
  });
});

// ---------------------------------------------------------------------------
// The route itself, over a real socket
// ---------------------------------------------------------------------------

describe('GET /rooms — the list route', () => {
  let open: Server | null = null;

  beforeEach(() => {
    open = null;
  });
  afterEach(async () => {
    if (open) await new Promise<void>((r) => open!.close(() => r()));
  });

  /** A live allocator on an ephemeral port, with a clock the test moves. */
  async function serve(): Promise<{
    base: string;
    registry: InMemoryRoomRegistry;
    now: { value: number };
  }> {
    const registry = new InMemoryRoomRegistry();
    const now = { value: NOW };
    const server = createAllocatorServer({
      allocator: new Allocator({ registry, rng: mulberry32(1), secret: SECRET }),
      registry,
      router: new DirectRouter((m) => `wss://${m}.test/`),
      now: () => now.value,
      log: () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    open = server;
    const { port } = server.address() as AddressInfo;
    return { base: `http://127.0.0.1:${port}`, registry, now };
  }

  it('answers { rooms, asOf } and puts no room code on the wire', async () => {
    const { base, registry, now } = await serve();
    registry.observe(beat('m-1', 'iad', [room('K7QM')]), now.value);

    const res = await fetch(`${base}/rooms`);
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).not.toContain('K7QM');
    const body = JSON.parse(text);
    expect(body.asOf).toBe(now.value);
    expect(body.rooms).toEqual([
      {
        id: listingId('K7QM', SECRET),
        owner: ownerTag('K7QM', SECRET),
        region: 'iad',
        size: 8,
        mode: 'ffa',
        players: 1,
        joinableSeats: 7,
      },
    ]);
  });

  it('is CORS-simple — a plain GET, no custom header, and the grant rides out', async () => {
    // The game is served from GitHub Pages; every allocator call is cross-origin.
    // A GET with no custom request header skips the preflight, and a preflight
    // would double the only cost this feature has (Trap 11).
    const { base, registry, now } = await serve();
    registry.observe(beat('m-1', 'iad', [room('K7QM')]), now.value);

    const res = await fetch(`${base}/rooms`, { headers: { origin: 'http://localhost:5173' } });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('leaves POST /rooms alone, and still refuses a PUT', async () => {
    const { base, registry, now } = await serve();
    registry.observe(beat('m-1', 'iad', []), now.value);

    // Same path, three verbs, dispatched on method (Trap 10).
    expect((await fetch(`${base}/rooms`, { method: 'POST' })).status).toBe(201);
    expect((await fetch(`${base}/rooms`)).status).toBe(200);
    expect((await fetch(`${base}/rooms`, { method: 'PUT' })).status).toBe(405);
  });

  it('empties out when the fleet goes quiet, rather than erroring', async () => {
    const { base, registry, now } = await serve();
    registry.observe(beat('m-1', 'iad', [room('K7QM')]), now.value);

    now.value += DEFAULT_LIVENESS_MS + 1;
    const res = await fetch(`${base}/rooms`);

    expect(res.status).toBe(200);
    expect((await res.json()).rooms).toEqual([]);
  });

  it('refuses a heartbeat whose listed flag is not a boolean', async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/fleet/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        machine: 'm-1',
        region: 'iad',
        capacity: 8,
        rooms: [{ code: 'K7QM', players: 1, listed: 'yes' }],
      }),
    });

    // Coercing this one would publish a room whose host asked not to be.
    expect(res.status).toBe(400);
  });

  describe('POST /listings/:id/join', () => {
    it('joins the room a row names, and answers with the same shape a code join does', async () => {
      const { base, registry, now } = await serve();
      registry.observe(beat('m-1', 'iad', [room('K7QM')]), now.value);
      const { rooms } = await (await fetch(`${base}/rooms`)).json();

      const res = await fetch(`${base}/listings/${rooms[0].id}/join`, { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.room).toBe('K7QM'); // the code reaches the joiner — it must
      expect(body.connectUrl).toBe('wss://m-1.test/');
      expect(verifyTicket(body.ticket, SECRET, now.value)).toMatchObject({
        room: 'K7QM',
        machine: 'm-1',
        intent: 'join',
      });
    });

    it('404s a row that is gone', async () => {
      const { base, registry, now } = await serve();
      registry.observe(beat('m-1', 'iad', [room('K7QM')]), now.value);
      const { rooms } = await (await fetch(`${base}/rooms`)).json();

      now.value += DEFAULT_LIVENESS_MS + 1;
      const res = await fetch(`${base}/listings/${rooms[0].id}/join`, { method: 'POST' });

      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('not-found');
    });

    it('409s a row whose seat was taken — a different sentence from a dead one', async () => {
      const { base, registry, now } = await serve();
      registry.observe(beat('m-1', 'iad', [room('K7QM')]), now.value);
      const { rooms } = await (await fetch(`${base}/rooms`)).json();

      registry.observe(beat('m-1', 'iad', [room('K7QM', { joinableSeats: 0 })]), now.value);
      const res = await fetch(`${base}/listings/${rooms[0].id}/join`, { method: 'POST' });

      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('room-full');
    });

    it('refuses a GET on the join path', async () => {
      const { base } = await serve();
      expect((await fetch(`${base}/listings/anything/join`)).status).toBe(405);
    });
  });
});
