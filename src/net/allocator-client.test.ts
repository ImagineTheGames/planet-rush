/**
 * src/net/allocator-client.test.ts — the one HTTP round trip before the socket.
 * OWNER: Netcode Engineer (GDD §4.2; M9 hosting, Task 9).
 *
 * No real network: `fetch` is injected, so every allocator answer — a minted
 * room, a 404 for a room that has ended, a 503 for a full fleet — is a fixture,
 * and the whole file runs in microseconds. The thing under test is a *decision
 * about where to open the socket*, not a socket.
 */

import { describe, expect, it } from 'vitest';
import {
  allocateRoom,
  allocatorUrlFromEnv,
  joinRoom,
  probeRoomLiveness,
  resolveFailureForJoinError,
} from './allocator-client';
import type { FetchLike, FetchResponse } from './allocator-client';

/** A `fetch` that answers with one canned response and records how it was called. */
function stubFetch(response: Partial<FetchResponse> & { status: number }): {
  fetch: FetchLike;
  calls: { url: string; method: string; body: string | undefined }[];
} {
  const calls: { url: string; method: string; body: string | undefined }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: response.json ?? ((): Promise<unknown> => Promise.resolve({})),
    } as FetchResponse);
  };
  return { fetch, calls };
}

/** The body the allocator returns on a successful allocate/join (allocator/index.ts). */
const OK_BODY = {
  room: 'QK7P',
  machine: 'm-abc',
  region: 'iad',
  ticket: 'payload.sig',
  expiresAt: 1_030_000,
  connectUrl: 'ws://m-abc:8080/',
};

describe('allocatorUrlFromEnv', () => {
  it('returns null when VITE_ALLOCATOR_URL is unset — the direct-connect path survives', () => {
    expect(allocatorUrlFromEnv({})).toBeNull();
    expect(allocatorUrlFromEnv({ VITE_ALLOCATOR_URL: '' })).toBeNull();
    expect(allocatorUrlFromEnv({ VITE_ALLOCATOR_URL: '   ' })).toBeNull();
  });

  it('trims the base URL and strips a trailing slash so paths join cleanly', () => {
    expect(allocatorUrlFromEnv({ VITE_ALLOCATOR_URL: 'https://alloc.example.com/' })).toBe(
      'https://alloc.example.com',
    );
    expect(allocatorUrlFromEnv({ VITE_ALLOCATOR_URL: '  https://alloc.example.com  ' })).toBe(
      'https://alloc.example.com',
    );
  });
});

describe('joinRoom', () => {
  it('POSTs to /rooms/:code/join and resolves the connect URL, room and ticket', async () => {
    const { fetch, calls } = stubFetch({ status: 200, json: () => Promise.resolve(OK_BODY) });
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');

    expect(calls).toEqual([
      { url: 'https://alloc.example.com/rooms/QK7P/join', method: 'POST', body: undefined },
    ]);
    expect(result).toEqual({
      ok: true,
      connection: {
        url: 'ws://m-abc:8080/',
        room: 'QK7P',
        ticket: 'payload.sig',
        machine: 'm-abc',
        region: 'iad',
        expiresAt: 1_030_000,
      },
    });
  });

  it('url-encodes the room code in the path', async () => {
    const { fetch, calls } = stubFetch({ status: 200, json: () => Promise.resolve(OK_BODY) });
    await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'a/b');
    expect(calls[0]?.url).toBe('https://alloc.example.com/rooms/a%2Fb/join');
  });

  it('maps a 404 to room-gone — the room has ended, do not retry', async () => {
    const { fetch } = stubFetch({ status: 404, json: () => Promise.resolve({ error: 'not-found' }) });
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('maps a 503 to no-capacity — the fleet is full', async () => {
    const { fetch } = stubFetch({ status: 503, json: () => Promise.resolve({ error: 'no-capacity' }) });
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(result).toEqual({ ok: false, reason: 'no-capacity' });
  });

  it('reports a thrown fetch as a network failure, never a room death', async () => {
    const fetch: FetchLike = () => Promise.reject(new Error('offline'));
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(result).toEqual({ ok: false, reason: 'network' });
  });

  it('rejects a 200 whose body is missing a ticket as a bad response', async () => {
    const { fetch } = stubFetch({
      status: 200,
      json: () => Promise.resolve({ room: 'QK7P', connectUrl: 'ws://x/' }),
    });
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(result).toEqual({ ok: false, reason: 'bad-response' });
  });

  it('falls back to a ws URL derived from the allocator host when connectUrl is null', async () => {
    // A defensive fallback for a body that carries no connectUrl at all. (On Fly
    // the allocator now populates connectUrl with the gameserver app's shared
    // endpoint, so this path is not the Fly path — it is the last-resort default.)
    const { fetch } = stubFetch({
      status: 200,
      json: () => Promise.resolve({ ...OK_BODY, connectUrl: null }),
    });
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(result.ok && result.connection.url).toBe('wss://alloc.example.com/');
  });

  it('derives an insecure ws:// URL from an http allocator base', async () => {
    const { fetch } = stubFetch({
      status: 200,
      json: () => Promise.resolve({ ...OK_BODY, connectUrl: null }),
    });
    const result = await joinRoom({ baseUrl: 'http://localhost:8080', fetch }, 'QK7P');
    expect(result.ok && result.connection.url).toBe('ws://localhost:8080/');
  });
});

describe('allocateRoom', () => {
  it('POSTs to /rooms with the requested shape and resolves the minted room', async () => {
    const { fetch, calls } = stubFetch({ status: 201, json: () => Promise.resolve(OK_BODY) });
    const result = await allocateRoom(
      { baseUrl: 'https://alloc.example.com', fetch },
      { region: 'iad', size: 4, mode: 'ffa' },
    );

    expect(calls[0]?.url).toBe('https://alloc.example.com/rooms');
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ region: 'iad', size: 4, mode: 'ffa' });
    expect(result.ok && result.connection.room).toBe('QK7P');
  });

  it('sends an empty body when no room shape is requested', async () => {
    const { fetch, calls } = stubFetch({ status: 201, json: () => Promise.resolve(OK_BODY) });
    await allocateRoom({ baseUrl: 'https://alloc.example.com', fetch });
    expect(calls[0]?.body).toBeUndefined();
  });

  it('maps a 503 (full fleet) to no-capacity', async () => {
    const { fetch } = stubFetch({ status: 503, json: () => Promise.resolve({ error: 'no-capacity' }) });
    const result = await allocateRoom({ baseUrl: 'https://alloc.example.com', fetch });
    expect(result).toEqual({ ok: false, reason: 'no-capacity' });
  });
});

describe('probeRoomLiveness', () => {
  it('GETs /rooms/:code and reads live when a Machine hosts it', async () => {
    const { fetch, calls } = stubFetch({
      status: 200,
      json: () => Promise.resolve({ code: 'QK7P', joinable: true }),
    });
    const liveness = await probeRoomLiveness({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(calls).toEqual([
      { url: 'https://alloc.example.com/rooms/QK7P', method: 'GET', body: undefined },
    ]);
    expect(liveness).toBe('live');
  });

  it('reads gone on a 404 — the witness that says stop retrying', async () => {
    const { fetch } = stubFetch({ status: 404, json: () => Promise.resolve({ error: 'not-found' }) });
    expect(
      await probeRoomLiveness({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P'),
    ).toBe('gone');
  });

  it('reads unknown when the allocator itself is unreachable — not a room death', async () => {
    const fetch: FetchLike = () => Promise.reject(new Error('offline'));
    expect(
      await probeRoomLiveness({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P'),
    ).toBe('unknown');
  });

  it('reads unknown on a 5xx — the allocator is sick, which says nothing about the room', async () => {
    const { fetch } = stubFetch({ status: 500, json: () => Promise.resolve({ error: 'internal' }) });
    expect(
      await probeRoomLiveness({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P'),
    ).toBe('unknown');
  });
});

describe('resolveFailureForJoinError', () => {
  // The M10 lottery: the ticket lost the socket coin flip. A fresh allocate (the
  // front door's retry) mints a fresh ticket to a correctly-pinned Machine, so the
  // action must be retry, never edit-code — the room code was never the problem.
  it('routes a refused ticket to a retry-able failure, not edit-code', () => {
    expect(resolveFailureForJoinError('bad-ticket')).toBe('bad-response');
  });

  // A room that exists but cannot seat us right now: full, or already in-match.
  // "Try again in a moment" (no-capacity) is the honest action, and a fresh
  // allocate gets a room that can.
  it('routes a room that will not seat us now to no-capacity', () => {
    expect(resolveFailureForJoinError('room-full')).toBe('no-capacity');
    expect(resolveFailureForJoinError('match-live')).toBe('no-capacity');
  });

  // The one reason where retrying the SAME code is pointless: the code is wrong.
  // Route it to not-found so the front door says "check it", exactly as a 404 does.
  it('routes a bad room code to not-found (edit the code, do not retry it)', () => {
    expect(resolveFailureForJoinError('bad-room-code')).toBe('not-found');
  });

  // Total by construction: the wire reason is `string`, so a refusal this client
  // predates must still land as a retry-able error — never an unhandled join that
  // strands the player on "connecting" (the whole point of the M10 client honesty).
  it('defaults an unrecognised reason to a retry-able failure', () => {
    expect(resolveFailureForJoinError('reclaim-expired')).toBe('bad-response');
    expect(resolveFailureForJoinError('some-reason-shipped-after-this-client')).toBe('bad-response');
    expect(resolveFailureForJoinError('')).toBe('bad-response');
  });
});
