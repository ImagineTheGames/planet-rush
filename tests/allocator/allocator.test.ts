/**
 * tests/allocator/allocator.test.ts — the allocation logic (Task 5). The
 * allocator answers the one question a single Machine cannot: *which* Machine?
 * These tests pin the five moving parts the brief names — region selection,
 * capacity check, code minting, atomic reservation, ticket issuance — and the
 * one property that must never break: the allocator is out of the gameplay path,
 * so it only *reads* the fleet (learned from heartbeats) and *reserves* codes; it
 * never provisions a Machine. OWNER: Netcode Engineer (docs/hosting-plan.md T5).
 */

import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@shared/types';
import { InMemoryRoomRegistry, type Heartbeat } from '../../allocator/registry';
import { makeRoomCode } from '../../src/net/room-code';
import { verifyTicket } from '../../src/net/ticket';
import { Allocator, AllocatorError, DEFAULT_TICKET_TTL_MS } from '../../allocator/allocator';

const SECRET = 'allocator-and-machine-share-this';

/** A heartbeat with the boilerplate filled in — only the interesting bits vary. */
function beat(
  machine: string,
  region: string,
  rooms: string[],
  capacity = 8,
): Heartbeat {
  return { machine, region, capacity, rooms: rooms.map((code) => ({ code, players: 1 })) };
}

/** Run `fn`, expect it to throw an AllocatorError, and return its reason. */
function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AllocatorError);
    return (e as AllocatorError).reason;
  }
  throw new Error('expected an AllocatorError, but nothing was thrown');
}

/** An allocator wired to a registry seeded with `beats`, all heard at `now`. */
function withFleet(beats: Heartbeat[], now = 1000, seed = 1): {
  reg: InMemoryRoomRegistry;
  alloc: Allocator;
} {
  const reg = new InMemoryRoomRegistry();
  for (const hb of beats) reg.observe(hb, now);
  const alloc = new Allocator({ registry: reg, rng: mulberry32(seed), secret: SECRET });
  return { reg, alloc };
}

describe('Allocator.allocate — placing a new room', () => {
  it('places onto a live Machine and returns a verifiable ticket for it', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [])]);
    const a = alloc.allocate({}, 1000);

    expect(a.machine).toBe('m-1');
    expect(a.region).toBe('iad');
    expect(a.room).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(a.expiresAt).toBe(1000 + DEFAULT_TICKET_TTL_MS);

    // The ticket the client will carry names exactly this room+Machine and
    // verifies under the shared secret — it is the allocator's signed decision.
    const claims = verifyTicket(a.ticket, SECRET, 1000);
    expect(claims).toEqual({ room: a.room, machine: 'm-1', expiresAt: a.expiresAt });
  });

  it('reserves the minted code so a heartbeat gap still locates the room', () => {
    const { reg, alloc } = withFleet([beat('m-1', 'iad', [])]);
    const a = alloc.allocate({}, 1000);
    // The room does not exist on m-1 yet (it boots when the client joins), but
    // the reservation covers the gap: locate finds it immediately.
    expect(reg.locate(a.room, 1000)).toBe('m-1');
    expect(reg.reservations(1000).map((r) => r.room)).toEqual([a.room]);
  });

  it('throws no-capacity when the fleet is empty', () => {
    const { alloc } = withFleet([]);
    expect(reasonOf(() => alloc.allocate({}, 1000))).toBe('no-capacity');
  });

  it('throws no-capacity when every live Machine is full', () => {
    // capacity 2, both rooms taken.
    const { alloc } = withFleet([beat('m-1', 'iad', ['AAAA', 'BBBB'], 2)]);
    expect(reasonOf(() => alloc.allocate({}, 1000))).toBe('no-capacity');
  });

  it('counts an outstanding reservation against capacity (atomic, no overflow)', () => {
    // capacity 1: the first allocate fills it via a reservation the heartbeat has
    // not yet confirmed; the second must see the Machine as full.
    const { alloc } = withFleet([beat('m-1', 'iad', [], 1)]);
    const first = alloc.allocate({}, 1000);
    expect(first.machine).toBe('m-1');
    expect(reasonOf(() => alloc.allocate({}, 1000))).toBe('no-capacity');
  });

  it('mints a code that does not collide with a room already on the fleet', () => {
    // Force a collision: pre-seed the registry with the exact code the rng will
    // draw first, and assert the allocator skips past it to a fresh one.
    const firstDraw = makeRoomCode(mulberry32(7));
    const { alloc } = withFleet([beat('m-1', 'iad', [firstDraw])], 1000, 7);
    const a = alloc.allocate({}, 1000);
    expect(a.room).not.toBe(firstDraw);
  });

  it('does not collide with an outstanding reservation either', () => {
    // Two back-to-back allocations onto a roomy Machine must get distinct codes.
    const { alloc } = withFleet([beat('m-1', 'iad', [], 8)]);
    const a = alloc.allocate({}, 1000);
    const b = alloc.allocate({}, 1000);
    expect(a.room).not.toBe(b.room);
  });
});

describe('Allocator.allocate — region selection', () => {
  it('prefers a Machine in the requested region', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', []), beat('m-2', 'lhr', [])]);
    expect(alloc.allocate({ region: 'lhr' }, 1000).machine).toBe('m-2');
    expect(alloc.allocate({ region: 'iad' }, 1000).machine).toBe('m-1');
  });

  it('falls back to another region when the requested one has no capacity', () => {
    // Requested region is full; a room still places rather than failing.
    const { alloc } = withFleet([
      beat('m-1', 'iad', ['AAAA'], 1), // iad full
      beat('m-2', 'lhr', [], 8), // lhr free
    ]);
    const a = alloc.allocate({ region: 'iad' }, 1000);
    expect(a.machine).toBe('m-2');
    expect(a.region).toBe('lhr');
  });

  it('spreads load onto the least-loaded candidate', () => {
    const { alloc } = withFleet([
      beat('m-1', 'iad', ['AAAA', 'BBBB'], 8), // load 2
      beat('m-2', 'iad', ['CCCC'], 8), // load 1 — should win
    ]);
    expect(alloc.allocate({}, 1000).machine).toBe('m-2');
  });
});

describe('Allocator.join — reaching an existing room', () => {
  it('issues a ticket for the Machine that hosts the room', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', ['K7QM'])]);
    const j = alloc.join('K7QM', 1000);
    expect(j.room).toBe('K7QM');
    expect(j.machine).toBe('m-1');
    expect(j.region).toBe('iad');
    expect(verifyTicket(j.ticket, SECRET, 1000)).toEqual({
      room: 'K7QM',
      machine: 'm-1',
      expiresAt: j.expiresAt,
    });
  });

  it('locates a room that exists only as a reservation (still booting)', () => {
    const { reg, alloc } = withFleet([beat('m-1', 'iad', [])]);
    reg.reserve('WXYZ', 'm-1', 1000); // placed, not yet heartbeat-confirmed
    const j = alloc.join('WXYZ', 1000);
    expect(j.machine).toBe('m-1');
    expect(j.region).toBe('iad');
  });

  it('throws not-found for a room no live Machine hosts', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', ['K7QM'])]);
    expect(reasonOf(() => alloc.join('ZZZZ', 1000))).toBe('not-found');
  });

  it('does not create a reservation — join is read-only against the fleet', () => {
    const { reg, alloc } = withFleet([beat('m-1', 'iad', ['K7QM'])]);
    alloc.join('K7QM', 1000);
    expect(reg.reservations(1000)).toEqual([]);
  });

  it('adds no players and never provisions — a fresh join to a full room still works', () => {
    // Capacity is a placement concern, not a join concern: an existing room at
    // capacity is still joinable (spectators/reclaim are the room's call).
    const { alloc } = withFleet([beat('m-1', 'iad', ['K7QM'], 1)]);
    expect(alloc.join('K7QM', 1000).machine).toBe('m-1');
  });
});

describe('Allocator — ticket lifetime is clock-driven and configurable', () => {
  it('expires the ticket at now + a custom ttl', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', 'iad', []), 1000);
    const alloc = new Allocator({
      registry: reg,
      rng: mulberry32(1),
      secret: SECRET,
      ticketTtlMs: 5_000,
    });
    const a = alloc.allocate({}, 2000);
    expect(a.expiresAt).toBe(7_000);
    expect(verifyTicket(a.ticket, SECRET, 6_999)).not.toBeNull();
    expect(verifyTicket(a.ticket, SECRET, 7_000)).toBeNull();
  });
});

describe('Allocator.regions — the capacity summary a region picker reads', () => {
  it('aggregates live Machines per region', () => {
    const { alloc } = withFleet([
      beat('m-1', 'iad', ['AAAA'], 8),
      beat('m-2', 'iad', [], 8),
      beat('m-3', 'lhr', ['BBBB', 'CCCC'], 4),
    ]);
    const regions = alloc.regions(1000);
    const iad = regions.find((r) => r.region === 'iad');
    const lhr = regions.find((r) => r.region === 'lhr');

    expect(iad).toEqual({ region: 'iad', machines: 2, capacity: 16, rooms: 1, free: 15 });
    expect(lhr).toEqual({ region: 'lhr', machines: 1, capacity: 4, rooms: 2, free: 2 });
  });

  it('counts an outstanding reservation as occupied capacity', () => {
    const { reg, alloc } = withFleet([beat('m-1', 'iad', [], 4)]);
    reg.reserve('WXYZ', 'm-1', 1000);
    const iad = alloc.regions(1000).find((r) => r.region === 'iad');
    expect(iad).toEqual({ region: 'iad', machines: 1, capacity: 4, rooms: 1, free: 3 });
  });

  it('is empty when no Machine is live', () => {
    const { alloc } = withFleet([]);
    expect(alloc.regions(1000)).toEqual([]);
  });
});

describe('Allocator.allocate — the room config it signs and advertises (Task C1/C3)', () => {
  it('signs the requested size and mode into the ticket', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [])]);
    const a = alloc.allocate({ size: 4, mode: 'teams' }, 1000);
    // The Machine trusts the ticket, so the size/mode ride on it, tamper-proof.
    const claims = verifyTicket(a.ticket, SECRET, 1000);
    expect(claims).toMatchObject({ room: a.room, machine: 'm-1', size: 4, mode: 'teams' });
  });

  it('records the size and mode on the reservation, so the boot gap is advertisable', () => {
    const { reg, alloc } = withFleet([beat('m-1', 'iad', [])]);
    const a = alloc.allocate({ size: 6, mode: 'ffa' }, 1000);
    const lease = reg.reservations(1000).find((r) => r.room === a.room);
    expect(lease).toMatchObject({ size: 6, mode: 'ffa' });
  });

  it('leaves a default allocate byte-identical to before — no size/mode on the ticket', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [])]);
    const a = alloc.allocate({}, 1000);
    // `toEqual` is exact: an unrequested config adds no keys to the claims.
    expect(verifyTicket(a.ticket, SECRET, 1000)).toEqual({
      room: a.room,
      machine: 'm-1',
      expiresAt: a.expiresAt,
    });
  });

  it('drops an out-of-range or non-integer size rather than minting an unbuildable room', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [])]);
    for (const bad of [1, 9, 0, -3, 4.5, Number.NaN]) {
      const a = alloc.allocate({ size: bad }, 1000);
      expect(verifyTicket(a.ticket, SECRET, 1000)?.size).toBeUndefined();
    }
  });

  it('drops an unknown mode', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [])]);
    const a = alloc.allocate({ mode: 'battle-royale' }, 1000);
    expect(verifyTicket(a.ticket, SECRET, 1000)?.mode).toBeUndefined();
  });
});

describe('Allocator.roomInfo — advertise a room before dialing (Task C3)', () => {
  it('reports a live room\'s size, mode, and free seats from the heartbeat', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(
      {
        machine: 'm-1',
        region: 'iad',
        capacity: 8,
        rooms: [{ code: 'K7QM', players: 2, size: 4, mode: 'ffa', joinableSeats: 2 }],
      },
      1000,
    );
    const alloc = new Allocator({ registry: reg, rng: mulberry32(1), secret: SECRET });
    expect(alloc.roomInfo('K7QM', 1000)).toEqual({
      code: 'K7QM',
      machine: 'm-1',
      region: 'iad',
      size: 4,
      mode: 'ffa',
      joinableSeats: 2,
      joinable: true,
    });
  });

  it('refuses a full room in the advertisement: joinable is false at zero free seats', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(
      {
        machine: 'm-1',
        region: 'iad',
        capacity: 8,
        rooms: [{ code: 'FULL', players: 4, size: 4, mode: 'ffa', joinableSeats: 0 }],
      },
      1000,
    );
    const alloc = new Allocator({ registry: reg, rng: mulberry32(1), secret: SECRET });
    expect(alloc.roomInfo('FULL', 1000)?.joinable).toBe(false);
  });

  it('advertises a still-booting room from its reservation (the gap before the first heartbeat)', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', [])]);
    const a = alloc.allocate({ size: 4, mode: 'teams' }, 1000);
    // No heartbeat has confirmed the room yet — only the reservation knows it.
    const info = alloc.roomInfo(a.room, 1000);
    expect(info).toMatchObject({ machine: 'm-1', region: 'iad', size: 4, mode: 'teams' });
    expect(info?.joinable).toBe(true); // nobody has reached it yet
  });

  it('returns null for a code no live Machine hosts or has reserved', () => {
    const { alloc } = withFleet([beat('m-1', 'iad', ['K7QM'])]);
    expect(alloc.roomInfo('ZZZZ', 1000)).toBeNull();
  });
});

describe('Allocator.allocate — the cordon placement seam', () => {
  it('never places a new room on a cordoned (draining) Machine', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('drain', 'iad', [], 8), 1000);
    reg.observe(beat('keep', 'iad', [], 8), 1000);
    // 'drain' is cordoned — it heartbeats free slots but is on its way out.
    const alloc = new Allocator({
      registry: reg,
      rng: mulberry32(1),
      secret: SECRET,
      excludeMachine: (m) => m === 'drain',
    });

    // Every placement lands on the one un-cordoned Machine (each reservation
    // counts against its capacity, so stay under the 8-slot ceiling).
    for (let i = 0; i < 5; i++) {
      expect(alloc.allocate({}, 1000).machine).toBe('keep');
    }
  });

  it('refuses with no-capacity when the only Machine is cordoned', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('drain', 'iad', [], 8), 1000);
    const alloc = new Allocator({
      registry: reg,
      rng: mulberry32(1),
      secret: SECRET,
      excludeMachine: () => true,
    });
    expect(reasonOf(() => alloc.allocate({}, 1000))).toBe('no-capacity');
  });

  it('still JOINS an existing room on a cordoned Machine — a drain never strands a match', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('drain', 'iad', ['WXYZ'], 8), 1000);
    const alloc = new Allocator({
      registry: reg,
      rng: mulberry32(1),
      secret: SECRET,
      excludeMachine: () => true,
    });
    // join ignores the cordon: the live match on 'drain' is still reachable.
    expect(alloc.join('WXYZ', 1000).machine).toBe('drain');
  });
});
