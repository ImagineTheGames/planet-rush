/**
 * src/net/seat-memory.test.ts — the seat token between two page loads.
 * OWNER: Netcode Engineer (a0-133).
 *
 * The thing under test is a credential that has to survive a page and must not
 * survive anything else. So the two halves of this file are: *it comes back*, and
 * *it comes back only when it should* — a different room, a lapsed one, a garbled
 * one, a storage that throws. Everything a browser does badly is done here on
 * purpose, because a device that cannot remember its seat has to arrive as a
 * newcomer rather than take the dial down with it.
 */

import { describe, expect, it } from 'vitest';
import {
  SEAT_MEMORY_KEY,
  SEAT_MEMORY_TTL_MS,
  browserSeatMemory,
  memorySeatStorage,
  seatMemory,
} from './seat-memory';
import type { StorageLike } from './playtest-log-store';

const NOW = 1_700_000_000_000;

describe('seat memory — the credential that outlives the page', () => {
  it('hands back the seat the last page was flying', () => {
    const device = memorySeatStorage();
    seatMemory(device).remember({ room: 'BACK', seat: 3, token: 'the-secret' }, NOW);

    // A *second* wrapper over the same storage: the page is gone, the object is
    // gone, and all that is left is what was written down.
    const reload = seatMemory(device);
    expect(reload.recall('BACK', NOW + 30_000)).toEqual({
      room: 'BACK',
      seat: 3,
      token: 'the-secret',
    });
  });

  it('does not offer one room its credential for another', () => {
    // The room code is what the player types, and it is not the credential. A seat
    // in RUSH says nothing about a seat in BACK, and offering it would put a
    // guaranteed-refused reclaim in front of an ordinary join.
    const device = memorySeatStorage();
    seatMemory(device).remember({ room: 'RUSH', seat: 1, token: 'rush-token' }, NOW);
    expect(seatMemory(device).recall('BACK', NOW)).toBeNull();
    expect(seatMemory(device).recall('RUSH', NOW)?.token).toBe('rush-token');
  });

  it('forgets a credential older than the window, and drops the key with it', () => {
    const device = memorySeatStorage();
    seatMemory(device).remember({ room: 'BACK', seat: 0, token: 'stale' }, NOW);

    expect(seatMemory(device).recall('BACK', NOW + SEAT_MEMORY_TTL_MS)).not.toBeNull();
    expect(seatMemory(device).recall('BACK', NOW + SEAT_MEMORY_TTL_MS + 1)).toBeNull();
    // Not merely refused — removed. A key that can never be presented again is
    // just a secret sitting in a shared classroom device's storage.
    expect(device.getItem(SEAT_MEMORY_KEY)).toBeNull();
  });

  it('refuses a credential from the future', () => {
    // A device whose clock moved backwards between the write and the read cannot be
    // reasoned about, and the fallback costs nothing: an ordinary join, which is
    // where this client would have been anyway.
    const device = memorySeatStorage();
    seatMemory(device).remember({ room: 'BACK', seat: 0, token: 'tomorrow' }, NOW);
    expect(seatMemory(device).recall('BACK', NOW - 1)).toBeNull();
  });

  it('reads back nothing at all rather than guessing at a damaged entry', () => {
    const cases: Record<string, string> = {
      'not json at all': 'RUSH{',
      'a bare string': '"BACK"',
      'a future schema': JSON.stringify({ v: 99, room: 'BACK', seat: 1, token: 't', savedAt: NOW }),
      'no token': JSON.stringify({ v: 1, room: 'BACK', seat: 1, savedAt: NOW }),
      'an empty token': JSON.stringify({ v: 1, room: 'BACK', seat: 1, token: '', savedAt: NOW }),
      'a seat off the end': JSON.stringify({ v: 1, room: 'BACK', seat: 9, token: 't', savedAt: NOW }),
      'a fractional seat': JSON.stringify({ v: 1, room: 'BACK', seat: 1.5, token: 't', savedAt: NOW }),
      'no timestamp': JSON.stringify({ v: 1, room: 'BACK', seat: 1, token: 't' }),
    };
    for (const [what, blob] of Object.entries(cases)) {
      const device = memorySeatStorage();
      device.setItem(SEAT_MEMORY_KEY, blob);
      expect(seatMemory(device).recall('BACK', NOW), what).toBeNull();
    }
  });

  it('survives storage that throws on every call', () => {
    // Private mode, a disabled origin, a WebView with the quota exhausted. None of
    // it may reach the dial: a device that cannot remember simply does not.
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const memory = seatMemory(hostile);
    expect(() => memory.remember({ room: 'BACK', seat: 0, token: 't' }, NOW)).not.toThrow();
    expect(() => memory.forget('BACK')).not.toThrow();
    expect(memory.recall('BACK', NOW)).toBeNull();
  });

  it('drops the key when a write fails, rather than leaving a torn one', () => {
    // Storage that could not be *replaced* no longer describes this client, and the
    // next page presenting a half-written seat with confidence is worse than it
    // presenting nothing (`./playtest-log-store` set this rule).
    const cells = new Map<string, string>();
    let allowWrites = true;
    const flaky: StorageLike = {
      getItem: (key) => cells.get(key) ?? null,
      setItem: (key, value) => {
        if (!allowWrites) throw new Error('quota');
        cells.set(key, value);
      },
      removeItem: (key) => void cells.delete(key),
    };
    const memory = seatMemory(flaky);
    memory.remember({ room: 'BACK', seat: 2, token: 'first' }, NOW);
    allowWrites = false;
    memory.remember({ room: 'BACK', seat: 2, token: 'second' }, NOW);
    expect(cells.get(SEAT_MEMORY_KEY)).toBeUndefined();
  });

  it('forgets this room and leaves another room alone', () => {
    const device = memorySeatStorage();
    const memory = seatMemory(device);
    memory.remember({ room: 'RUSH', seat: 1, token: 'rush-token' }, NOW);
    // Hanging up on a match this device is not in must not erase the one it is.
    memory.forget('BACK');
    expect(memory.recall('RUSH', NOW)?.token).toBe('rush-token');
    memory.forget('RUSH');
    expect(memory.recall('RUSH', NOW)).toBeNull();
  });

  it('has no memory at all where the platform has no storage', () => {
    // Node, a server-side import, an origin that denies storage outright: `null` is
    // the honest answer, and the transport reads it as the pre-a0-133 behaviour.
    expect((globalThis as { localStorage?: unknown }).localStorage).toBeUndefined();
    expect(browserSeatMemory()).toBeNull();
  });

  it('uses the browser’s localStorage when there is one', () => {
    const device = memorySeatStorage();
    const globals = globalThis as { localStorage?: StorageLike };
    globals.localStorage = device;
    try {
      const memory = browserSeatMemory();
      expect(memory).not.toBeNull();
      memory?.remember({ room: 'BACK', seat: 4, token: 'browser' }, NOW);
      // Written to the one namespaced key, and readable by the next page load.
      expect(device.getItem(SEAT_MEMORY_KEY)).toContain('browser');
      expect(browserSeatMemory()?.recall('BACK', NOW)?.seat).toBe(4);
    } finally {
      delete globals.localStorage;
    }
  });
});
