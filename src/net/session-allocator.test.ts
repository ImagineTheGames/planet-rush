/**
 * src/net/session-allocator.test.ts — the seam where an allocator's decision
 * becomes an online session. OWNER: Netcode Engineer (GDD §4.2; M9 Task 9/9b).
 *
 * `allocatorTransport` is small on purpose, but it owns the one mistake that is
 * easy and silent: binding the reconnect probe to the room the *player typed*
 * rather than the room the allocator *minted*. These tests pin the ticket and,
 * above all, that the probe asks about the resolved room.
 */

import { describe, expect, it } from 'vitest';
import { allocatorTransport } from './session';
import type { FetchLike, ResolvedConnection } from './allocator-client';

const CONNECTION: ResolvedConnection = {
  url: 'ws://m-abc:8080/',
  room: 'MINTED', // the allocator minted this; the player never typed it
  ticket: 'payload.sig',
  machine: 'm-abc',
  region: 'iad',
  expiresAt: 1_030_000,
};

describe('allocatorTransport', () => {
  it('carries the signed ticket onto the transport', () => {
    const overrides = allocatorTransport(CONNECTION, { baseUrl: 'https://alloc.example.com' });
    expect(overrides.ticket).toBe('payload.sig');
  });

  it('binds the liveness probe to the minted room, not whatever the caller had', async () => {
    const calls: string[] = [];
    const fetch: FetchLike = (url) => {
      calls.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    };
    const overrides = allocatorTransport(CONNECTION, {
      baseUrl: 'https://alloc.example.com',
      fetch,
    });

    const liveness = await overrides.checkRoomAlive?.();
    expect(liveness).toBe('live');
    // The probe asked about MINTED — the resolved room — not any other code.
    expect(calls).toEqual(['https://alloc.example.com/rooms/MINTED']);
  });

  it('reports a 404 room as gone through the bound probe', async () => {
    const fetch: FetchLike = () =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    const overrides = allocatorTransport(CONNECTION, {
      baseUrl: 'https://alloc.example.com',
      fetch,
    });
    expect(await overrides.checkRoomAlive?.()).toBe('gone');
  });
});
