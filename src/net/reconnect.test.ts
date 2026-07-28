/**
 * src/net/reconnect.test.ts — the one decision a phone gets wrong if nobody
 * tells it the difference. OWNER: Netcode Engineer (GDD §4.2, M9 Task 9b).
 *
 * Two dead sockets, two opposite truths: "I dropped, my seat is held" vs "the
 * room died, there is nothing to hold." The allocator is the only witness that
 * can tell them apart (a 404 is a room that has ended), and `decideReconnect`
 * is where that witness turns into "keep trying" or "stop, and here is why".
 * Pure and clockless — every clock in this file is a number literal.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_GRACE_WINDOW_MS, decideReconnect } from './reconnect';
import type { ReconnectContext } from './reconnect';

/** A context with the grace window pre-filled; each test overrides what it tests. */
function ctx(over: Partial<ReconnectContext>): ReconnectContext {
  return { elapsedMs: 0, graceWindowMs: DEFAULT_GRACE_WINDOW_MS, roomLiveness: 'unknown', ...over };
}

describe('decideReconnect', () => {
  it('retries a fresh drop whose room is confirmed live', () => {
    expect(decideReconnect(ctx({ elapsedMs: 2_000, roomLiveness: 'live' }))).toEqual({
      action: 'retry',
    });
  });

  it('retries while the room is unknown — a probe we could not make is not a death', () => {
    // The allocator was unreachable, not the room: assume recoverable and keep
    // trying inside the window rather than abandoning a match that is probably fine.
    expect(decideReconnect(ctx({ elapsedMs: 2_000, roomLiveness: 'unknown' }))).toEqual({
      action: 'retry',
    });
  });

  it('stops the instant the allocator says the room is gone, mid-window', () => {
    // The whole point of Task 9b: a 404 means no Machine hosts the code, so no
    // amount of retrying will produce one. Do not burn the rest of the window.
    expect(
      decideReconnect(ctx({ elapsedMs: 1, roomLiveness: 'gone' })),
    ).toEqual({ action: 'stop', reason: 'room-gone' });
  });

  it('stops when the grace window closes on a still-live room', () => {
    // The room is fine, but the seat is a bot's now for the rest of the match.
    expect(
      decideReconnect(ctx({ elapsedMs: DEFAULT_GRACE_WINDOW_MS, roomLiveness: 'live' })),
    ).toEqual({ action: 'stop', reason: 'grace-elapsed' });
  });

  it('treats the window as closed at the exact boundary (>=, not >)', () => {
    expect(decideReconnect(ctx({ elapsedMs: 60_000, graceWindowMs: 60_000 })).action).toBe('stop');
    expect(decideReconnect(ctx({ elapsedMs: 59_999, graceWindowMs: 60_000 })).action).toBe('retry');
  });

  it('reports room-gone even past the window — the more actionable reason wins', () => {
    // Both conditions hold; a dead room is the one worth telling the player about
    // (nothing to reclaim), so it takes precedence over "your grace ran out".
    expect(
      decideReconnect(ctx({ elapsedMs: 120_000, roomLiveness: 'gone' })),
    ).toEqual({ action: 'stop', reason: 'room-gone' });
  });

  it('defaults its grace window to the sixty-second reconnect rule (GDD §4.2)', () => {
    expect(DEFAULT_GRACE_WINDOW_MS).toBe(60_000);
  });
});
