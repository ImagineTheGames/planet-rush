/**
 * tests/net/seat-storage.ts — a `Storage`, in memory, so a page reload is
 * simulable without a DOM. OWNER: Netcode Engineer (GDD §4.2; a0-133).
 *
 * The seat credential outlives its page by living in `localStorage`
 * (`src/net/seat-memory.ts`), and the case that matters is a phone whose tab was
 * discarded: the storage survives, the JavaScript heap does not. Testing that
 * needs the two separable — keep the object, throw the session away, build
 * another `SeatMemory` on top of it, which is exactly what a rebuilt page does to
 * the pair of them.
 *
 * It lives HERE and not in the module it tests because production has a real
 * `localStorage` and never wants a fake one: `browserSeatMemory()` is the only
 * thing the game constructs. An in-memory `Storage` exported from
 * `src/net/seat-memory.ts` is public surface with no public — the shape
 * `npm run dark-matter` exists to catch, after `matchAbundance` shipped tested,
 * green and uncalled. Same reason `node-websocket.ts` next door is a test file
 * rather than a second transport.
 *
 * Shared by `src/net/seat-memory.test.ts` (the store itself),
 * `src/net/websocket-transport.test.ts` (recall/remember/forget on a fake socket)
 * and `src/net/session.test.ts` (the returning player, against a real server).
 */

import type { StorageLike } from '../../src/net/playtest-log-store';

/**
 * A working `Storage` as a plain object — total, never throwing, one `Map`
 * behind it. Hand the SAME value to two `seatMemory()` calls to model a device
 * that kept its disk and lost its page.
 */
export function memorySeatStorage(): StorageLike {
  const cells = new Map<string, string>();
  return {
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => void cells.set(key, value),
    removeItem: (key) => void cells.delete(key),
  };
}
