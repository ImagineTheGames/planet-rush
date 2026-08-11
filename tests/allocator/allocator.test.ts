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

  it('honours the creator region even when a foreign Machine is emptier', () => {
    // The guarantee, stated as the case that would break it: least-loaded is the
    // rule *within* the preferred region, never a reason to leave it. Before the
    // region was requested at all, this fleet sent every creator to the idle
    // Virginia box — which is precisely the Brazil complaint.
    const { alloc } = withFleet([
      beat('m-iad', 'iad', [], 8), // load 0
      beat('m-gru', 'gru', ['AAAA', 'BBBB'], 8), // load 2, but it is *their* region
    ]);
    const a = alloc.allocate({ region: 'gru' }, 1000);
    expect(a.machine).toBe('m-gru');
    expect(a.region).toBe('gru');
  });
});

describe('Allocator.allocate — the placement is explainable', () => {
  it('says "your region" when the creator region took the room', () => {
    const { alloc } = withFleet([beat('m-iad', 'iad', []), beat('m-gru', 'gru', [])]);
    const a = alloc.allocate({ region: 'gru' }, 1000);

    expect(a.machine).toBe('m-gru');
    expect(a.placement).toEqual({
      requested: 'gru',
      region: 'gru',
      reason: 'preferred',
      detail: 'gru — your region',
    });
  });

  it('names the full region it fell back FROM', () => {
    const { alloc } = withFleet([
      beat('m-gru', 'gru', ['AAAA'], 1), // gru live, and full
      beat('m-iad', 'iad', [], 8),
    ]);
    const a = alloc.allocate({ region: 'gru' }, 1000);

    expect(a.machine).toBe('m-iad');
    expect(a.placement).toEqual({
      requested: 'gru',
      region: 'iad',
      reason: 'region-full',
      detail: 'iad — gru full',
    });
  });

  it('tells "that region is full" apart from "that region does not exist"', () => {
    // Different operator action: scale gru, versus create gru. A single
    // "fell back" reason would have hidden which one this fleet needs.
    const { alloc } = withFleet([beat('m-iad', 'iad', [], 8)]);
    const a = alloc.allocate({ region: 'gru' }, 1000);

    expect(a.machine).toBe('m-iad');
    expect(a.placement).toEqual({
      requested: 'gru',
      region: 'iad',
      reason: 'region-absent',
      detail: 'iad — no gru machines',
    });
  });

  it('does not claim a preference was honoured when none was expressed', () => {
    const { alloc } = withFleet([beat('m-iad', 'iad', [], 8)]);
    const a = alloc.allocate({}, 1000);

    expect(a.placement).toEqual({
      region: 'iad',
      reason: 'no-preference',
      detail: 'iad — no region preference',
    });
    expect(a.placement?.requested).toBeUndefined();
  });

  it('carries no placement on a join — a join places nothing', () => {
    const { alloc, reg } = withFleet([beat('m-gru', 'gru', ['AAAA'])]);
    expect(alloc.join('AAAA', 1000).placement).toBeUndefined();
    expect(reg.machines(1000)).toHaveLength(1);
  });

  it('reads a cordoned-out region as full, not absent — it IS live', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-gru', 'gru', [], 8), 1000);
    reg.observe(beat('m-iad', 'iad', [], 8), 1000);
    const alloc = new Allocator({
      registry: reg,
      rng: mulberry32(1),
      secret: SECRET,
      excludeMachine: (m) => m === 'm-gru',
    });
    const a = alloc.allocate({ region: 'gru' }, 1000);

    expect(a.machine).toBe('m-iad');
    expect(a.placement?.reason).toBe('region-full');
  });
});

describe('Allocator.allocate — an unserved POP falls back to its NEAREST region (n9-01)', () => {
  /**
   * The developer's case, by name. From Florida the anycast POP is `dfw`; the
   * fleet has run `iad ×2 + gru ×1` since 2026-07-30 and has never had a `dfw`
   * Machine. Before this, `dfw` meant *no opinion*: the whole fleet went into one
   * pool and the room went wherever load — and then a machine-id string
   * comparison — happened to send it. Live on 2026-08-11, three consecutive
   * `POST /rooms` from a `dfw` POP answered `iad`, `iad`, **`gru`**, with twelve
   * free slots still in `iad`.
   */
  const FLORIDA_POP = 'dfw';

  it('places a dfw request in iad, not gru', () => {
    const { alloc } = withFleet([beat('m-gru', 'gru', [], 8), beat('m-iad', 'iad', [], 8)]);
    const a = alloc.allocate({ region: FLORIDA_POP }, 1000);

    expect(a.region).toBe('iad');
    expect(a.machine).toBe('m-iad');
    // `region-absent` is still the truth of it — we run nothing in Dallas — and it
    // still reads differently from `region-full`. What changed is where the room
    // went, not what the allocator calls it.
    expect(a.placement).toEqual({
      requested: 'dfw',
      region: 'iad',
      reason: 'region-absent',
      detail: 'iad — no dfw machines',
    });
  });

  it('places a dfw request in iad even when gru is emptier', () => {
    // The live case exactly: two outstanding rooms in Virginia, an idle São Paulo
    // box, and a Florida creator. Load is a tie-break WITHIN a region, never a
    // reason to cross a continent.
    const { alloc } = withFleet([
      beat('m-iad-1', 'iad', ['AAAA'], 8),
      beat('m-iad-2', 'iad', ['BBBB'], 8),
      beat('m-gru', 'gru', [], 8), // idle, and 6,400 km further away
    ]);
    const a = alloc.allocate({ region: FLORIDA_POP }, 1000);
    expect(a.region).toBe('iad');
  });

  it('reaches gru from dfw only when iad genuinely cannot take the room', () => {
    // Crossing the continent is a CAPACITY decision. iad is full to its ceiling,
    // so a placed match in São Paulo still beats a refused one.
    const { alloc } = withFleet([
      beat('m-iad', 'iad', ['AAAA'], 1), // full
      beat('m-gru', 'gru', [], 8),
    ]);
    const a = alloc.allocate({ region: FLORIDA_POP }, 1000);
    expect(a.region).toBe('gru');
    expect(a.placement?.reason).toBe('region-absent');
  });

  it('still honours a region the picker actually sent — inference never outranks it', () => {
    // The brief's boundary: this governs only the case where nothing was sent. A
    // player who deliberately chose São Paulo gets São Paulo.
    const { alloc } = withFleet([beat('m-iad', 'iad', [], 8), beat('m-gru', 'gru', [], 8)]);
    const a = alloc.allocate({ region: 'gru' }, 1000);
    expect(a.region).toBe('gru');
    expect(a.placement?.reason).toBe('preferred');
  });

  it('picks the nearest region with room, not merely the nearest region', () => {
    // Three regions, the nearest one full: the fallback must walk the ranking
    // rather than give up on geography and spread across everything.
    const { alloc } = withFleet([
      beat('m-iad', 'iad', ['AAAA'], 1), // nearest to dfw — and full
      beat('m-lhr', 'lhr', [], 8), // 5,900 km from iad
      beat('m-gru', 'gru', [], 8), // 7,600 km from iad, further from dfw than lhr
    ]);
    expect(alloc.allocate({ region: FLORIDA_POP }, 1000).region).toBe('lhr');
  });

  it('a full region falls back to its nearest neighbour too, not to the whole fleet', () => {
    // Same rule, the other reason. `region-full` used to spread fleet-wide; a
    // London creator whose region is full belongs in Frankfurt, not Sydney.
    const { alloc } = withFleet([
      beat('m-lhr', 'lhr', ['AAAA'], 1), // the creator's region, full
      beat('m-syd', 'syd', [], 8),
      beat('m-fra', 'fra', [], 8),
    ]);
    const a = alloc.allocate({ region: 'lhr' }, 1000);
    expect(a.region).toBe('fra');
    expect(a.placement?.reason).toBe('region-full');
  });

  it('an UNKNOWN pop keeps the old whole-fleet spread — no guess, no wrong continent', () => {
    // What the next person adding a region inherits: a code with no row in
    // region-geo.ts degrades to exactly the behaviour that shipped before it, and
    // the reason still says `region-absent`.
    const { alloc } = withFleet([
      beat('m-iad', 'iad', ['AAAA', 'BBBB'], 8), // load 2
      beat('m-gru', 'gru', [], 8), // load 0 — least-loaded of the whole fleet
    ]);
    const a = alloc.allocate({ region: 'zzz' }, 1000);
    expect(a.region).toBe('gru');
    expect(a.placement?.reason).toBe('region-absent');
  });
});

describe('Allocator.allocate — placement never turns on a machine id (n9-01)', () => {
  it('sends a dfw creator to iad however the machine ids sort', () => {
    // The coin flip, stated as the test that would have caught it. Under the old
    // rule an idle fleet tied on load and `<` on the id decided — so a gru box
    // whose id sorted first took the room. Rename the machines so an id sort
    // gives the opposite answer, and the placement must not move.
    const aFirst = withFleet([beat('aaa-gru', 'gru', [], 8), beat('zzz-iad', 'iad', [], 8)]);
    const zFirst = withFleet([beat('zzz-gru', 'gru', [], 8), beat('aaa-iad', 'iad', [], 8)]);

    expect(aFirst.alloc.allocate({ region: 'dfw' }, 1000).region).toBe('iad');
    expect(zFirst.alloc.allocate({ region: 'dfw' }, 1000).region).toBe('iad');
  });

  it('breaks a within-region tie on headroom, not on the id', () => {
    // Same region, same load, different size of host. The bigger box has more
    // room left once this match lands, which is a fact about capacity; its id
    // sorts last, which is a fact about nothing.
    const { alloc } = withFleet([beat('a-small', 'iad', [], 2), beat('z-large', 'iad', [], 8)]);
    expect(alloc.allocate({ region: 'iad' }, 1000).machine).toBe('z-large');
  });

  it('breaks a headroom tie on heartbeat freshness, not on the id', () => {
    // Identical hosts, one heard from more recently: prefer the view least likely
    // to be about to lapse. `a-stale` would win an id sort.
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('a-stale', 'iad', [], 8), 1000);
    reg.observe(beat('z-fresh', 'iad', [], 8), 9000);
    const alloc = new Allocator({ registry: reg, rng: mulberry32(1), secret: SECRET });

    expect(alloc.allocate({ region: 'iad' }, 9000).machine).toBe('z-fresh');
  });

  it('leaves the incumbent standing when two hosts are indistinguishable', () => {
    // Everything the registry knows is equal, so there is no decision left — only
    // a deterministic record of one. The host the fleet learned about first keeps
    // it, and that is heartbeat-arrival order, not alphabetical order.
    const later = withFleet([beat('z-first', 'iad', [], 8), beat('a-second', 'iad', [], 8)]);
    expect(later.alloc.allocate({}, 1000).machine).toBe('z-first');

    const swapped = withFleet([beat('a-first', 'iad', [], 8), beat('z-second', 'iad', [], 8)]);
    expect(swapped.alloc.allocate({}, 1000).machine).toBe('a-first');
  });
});

describe('Allocator.allocate — size-aware fleet density (Task F1)', () => {
  // A heartbeat whose rooms carry a per-room match size, so the allocator can
  // weight each by its seats instead of counting one flat unit per room.
  function sizedBeat(
    machine: string,
    rooms: { code: string; size: number }[],
    capacity: number,
  ): Heartbeat {
    return {
      machine,
      region: 'iad',
      capacity,
      rooms: rooms.map((r) => ({ code: r.code, players: r.size, size: r.size })),
    };
  }

  it('prefers a host with free seat capacity over one with fewer rooms-but-full-seats', () => {
    // m-full holds THREE full 8-seat rooms (24 seats); m-roomy holds FIVE 2-seat
    // rooms (10 seats). Counting rooms flat would send the next room to m-full
    // (3 rooms < 5); weighting by seats sends it to m-roomy, which is the host
    // with real seat headroom. Same room capacity on both, so only the weighting
    // decides.
    const { alloc } = withFleet([
      sizedBeat('m-full', [
        { code: 'AAAA', size: 8 },
        { code: 'BBBB', size: 8 },
        { code: 'CCCC', size: 8 },
      ], 8),
      sizedBeat('m-roomy', [
        { code: 'DDDD', size: 2 },
        { code: 'EEEE', size: 2 },
        { code: 'FFFF', size: 2 },
        { code: 'GGGG', size: 2 },
        { code: 'HHHH', size: 2 },
      ], 8),
    ]);
    expect(alloc.allocate({}, 1000).machine).toBe('m-roomy');
  });

  it('packs small rooms past a flat room count — the ceiling is seats, not rooms', () => {
    // capacity 4 room-equivalents. SIX 2-seat rooms weigh 6·(2/8) = 1.5 < 4, so a
    // seventh room still places; a flat "6 rooms ≥ 4 capacity" count would have
    // refused. Small matches genuinely pack tighter onto one host.
    const { alloc } = withFleet([
      sizedBeat('m-1', [
        { code: 'R1', size: 2 },
        { code: 'R2', size: 2 },
        { code: 'R3', size: 2 },
        { code: 'R4', size: 2 },
        { code: 'R5', size: 2 },
        { code: 'R6', size: 2 },
      ], 4),
    ]);
    expect(alloc.allocate({}, 1000).machine).toBe('m-1');
  });

  it('an outstanding reservation weighs its requested size, not one flat room', () => {
    // A 2-seat room reserved during its boot gap counts as a quarter-room of load,
    // so a small-room machine is not treated as a full one before it even boots.
    const { reg, alloc } = withFleet([sizedBeat('m-1', [], 4)]);
    reg.reserve('BOOT', 'm-1', 1000, { size: 2 });
    const iad = alloc.regions(1000).find((r) => r.region === 'iad');
    expect(iad).toEqual({ region: 'iad', machines: 1, capacity: 4, rooms: 0.25, free: 3.75 });
  });

  it('counts an unknown-size room as a full room — the conservative default', () => {
    // An older Machine (or a room whose heartbeat omits size) must never be
    // under-counted into over-packing, so it weighs a whole room. capacity 2 with
    // two such rooms is therefore full — byte-identical to the pre-F1 flat count.
    const { alloc } = withFleet([beat('m-1', 'iad', ['AAAA', 'BBBB'], 2)]);
    expect(reasonOf(() => alloc.allocate({}, 1000))).toBe('no-capacity');
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
