/**
 * tests/allocator/registry.test.ts — the room registry is a cache, not a
 * database. These tests pin the two behaviours the brief calls out: the fleet
 * is *learned* from heartbeats (so an allocator that restarts comes back whole
 * within one heartbeat interval), and the one thing the registry genuinely owns
 * is the leased reservation — the gap between "go to Machine X" and "Machine X
 * has a room to show for it". OWNER: Netcode Engineer (docs/hosting-plan.md T3).
 */

import { describe, it, expect } from 'vitest';
import {
  InMemoryRoomRegistry,
  DEFAULT_LIVENESS_MS,
  DEFAULT_RESERVATION_TTL_MS,
  type Heartbeat,
} from '../../allocator/registry';

/** A heartbeat with the boilerplate filled in — only the interesting bits vary. */
function beat(machine: string, rooms: string[], capacity = 8): Heartbeat {
  return {
    machine,
    region: 'iad',
    capacity,
    rooms: rooms.map((code) => ({ code, players: 1 })),
  };
}

describe('InMemoryRoomRegistry — learning the fleet from heartbeats', () => {
  it('knows nothing until a heartbeat arrives', () => {
    const reg = new InMemoryRoomRegistry();
    expect(reg.machines(1000)).toEqual([]);
    expect(reg.locate('WXYZ', 1000)).toBeNull();
  });

  it('learns a machine and its rooms from one heartbeat', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', ['WXYZ', 'ABCD']), 1000);

    const fleet = reg.machines(1000);
    expect(fleet).toHaveLength(1);
    expect(fleet[0]?.machine).toBe('m-1');
    expect(fleet[0]?.lastSeen).toBe(1000);
    expect(fleet[0]?.rooms.map((r) => r.code)).toEqual(['WXYZ', 'ABCD']);
    expect(reg.locate('WXYZ', 1000)).toBe('m-1');
    expect(reg.locate('ABCD', 1000)).toBe('m-1');
  });

  it('replaces a machine\'s room set on each heartbeat (state, not accumulation)', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', ['WXYZ']), 1000);
    reg.observe(beat('m-1', ['ABCD']), 2000); // WXYZ ended, ABCD started

    expect(reg.locate('ABCD', 2000)).toBe('m-1');
    expect(reg.locate('WXYZ', 2000)).toBeNull();
    expect(reg.machines(2000)).toHaveLength(1);
  });

  it('a fresh registry comes back whole after one round of heartbeats (restart)', () => {
    // Model an allocator restart: nothing persisted, yet after the fleet's next
    // heartbeats the new registry knows every machine and room — this is why the
    // launch footprint carries no stateful service.
    const rebuilt = new InMemoryRoomRegistry();
    rebuilt.observe(beat('m-1', ['WXYZ']), 5000);
    rebuilt.observe(beat('m-2', ['ABCD', 'EFGH']), 5000);

    expect(rebuilt.machines(5000).map((m) => m.machine).sort()).toEqual(['m-1', 'm-2']);
    expect(rebuilt.locate('EFGH', 5000)).toBe('m-2');
  });
});

describe('InMemoryRoomRegistry — liveness (the cache expires)', () => {
  it('drops a machine that has not been heard from within the liveness window', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', ['WXYZ']), 1000);

    const stillLive = 1000 + DEFAULT_LIVENESS_MS;
    expect(reg.machines(stillLive)).toHaveLength(1);
    expect(reg.locate('WXYZ', stillLive)).toBe('m-1');

    const stale = 1000 + DEFAULT_LIVENESS_MS + 1;
    expect(reg.machines(stale)).toEqual([]);
    expect(reg.locate('WXYZ', stale)).toBeNull();
  });

  it('a renewed heartbeat keeps a machine live', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', ['WXYZ']), 1000);
    reg.observe(beat('m-1', ['WXYZ']), 1000 + DEFAULT_LIVENESS_MS); // renew before expiry

    const laterButRenewed = 1000 + DEFAULT_LIVENESS_MS + 1;
    expect(reg.machines(laterButRenewed)).toHaveLength(1);
  });

  it('honours a custom liveness window', () => {
    const reg = new InMemoryRoomRegistry({ livenessMs: 100 });
    reg.observe(beat('m-1', ['WXYZ']), 0);
    expect(reg.machines(100)).toHaveLength(1);
    expect(reg.machines(101)).toEqual([]);
  });
});

describe('InMemoryRoomRegistry — reservations (the one owned thing)', () => {
  it('a reservation locates a room before any heartbeat mentions it', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', []), 1000); // machine is live but hosts nothing yet

    // Allocator: "go to m-1 for WXYZ" — the room does not exist on m-1 yet.
    const res = reg.reserve('WXYZ', 'm-1', 1000);
    expect(res.room).toBe('WXYZ');
    expect(res.machine).toBe('m-1');
    expect(res.expiresAt).toBe(1000 + DEFAULT_RESERVATION_TTL_MS);

    expect(reg.locate('WXYZ', 1000)).toBe('m-1'); // covered by the lease
    expect(reg.reservations(1000).map((r) => r.room)).toEqual(['WXYZ']);
  });

  it('a confirming heartbeat retires the reservation (Machine X has a room to show)', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', []), 1000);
    reg.reserve('WXYZ', 'm-1', 1000);

    // m-1's next heartbeat now lists WXYZ — the gap the lease covered is closed.
    reg.observe(beat('m-1', ['WXYZ']), 2000);

    expect(reg.reservations(2000)).toEqual([]); // lease retired
    expect(reg.locate('WXYZ', 2000)).toBe('m-1'); // still located, now by reality
  });

  it('only the reserving machine confirming retires the lease', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', []), 1000);
    reg.observe(beat('m-2', []), 1000);
    reg.reserve('WXYZ', 'm-1', 1000);

    // A *different* machine reporting WXYZ does not fulfil m-1's lease.
    reg.observe(beat('m-2', ['WXYZ']), 2000);
    expect(reg.reservations(2000).map((r) => r.machine)).toEqual(['m-1']);
  });

  it('a reservation lapses at its TTL and stops covering the room', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', []), 1000);
    reg.reserve('WXYZ', 'm-1', 1000);

    // Expiry follows the ticket.ts convention: alive while now < expiresAt,
    // lapsed at the deadline instant (now >= expiresAt).
    const alive = 1000 + DEFAULT_RESERVATION_TTL_MS - 1;
    expect(reg.locate('WXYZ', alive)).toBe('m-1');

    const lapsed = 1000 + DEFAULT_RESERVATION_TTL_MS;
    expect(reg.locate('WXYZ', lapsed)).toBeNull();
    expect(reg.reservations(lapsed)).toEqual([]);
  });

  it('re-reserving a room re-points the lease to a new machine', () => {
    const reg = new InMemoryRoomRegistry();
    reg.reserve('WXYZ', 'm-1', 1000);
    reg.reserve('WXYZ', 'm-2', 1500); // m-1 fell over; re-place onto m-2

    expect(reg.locate('WXYZ', 1500)).toBe('m-2');
    expect(reg.reservations(1500)).toHaveLength(1);
  });

  it('reality wins over intent: a heartbeat locates even with a stale lease TTL', () => {
    const reg = new InMemoryRoomRegistry();
    reg.observe(beat('m-1', ['WXYZ']), 1000);
    reg.reserve('WXYZ', 'm-1', 1000);

    // Long after the lease would lapse, the room is still hosted and located.
    const wayLater = 1000 + DEFAULT_RESERVATION_TTL_MS + 1;
    reg.observe(beat('m-1', ['WXYZ']), wayLater); // keep the machine live
    expect(reg.locate('WXYZ', wayLater)).toBe('m-1');
  });

  it('honours a custom reservation TTL', () => {
    const reg = new InMemoryRoomRegistry({ reservationTtlMs: 50 });
    reg.reserve('WXYZ', 'm-1', 0);
    expect(reg.locate('WXYZ', 49)).toBe('m-1');
    expect(reg.locate('WXYZ', 50)).toBeNull(); // deadline instant is lapsed
  });
});
