/**
 * src/net/input-queue.test.ts — the ordering contract (GDD §4.2, §4.8).
 *
 * The queue is the only thing standing between a network's delivery order and
 * the simulation's resolution order. These are the rules it must never bend.
 */
import { describe, it, expect } from 'vitest';
import { InputQueue, MAX_FUTURE_TICKS } from './input-queue';
import type { Action } from '@shared/types';
import type { InputMessage } from './transport';

const FIRE: readonly Action[] = [{ type: 'fire', active: true, auto: false }];
const BUILD: readonly Action[] = [{ type: 'build', active: true }];
const LEFT: readonly Action[] = [{ type: 'thrust', dir: { x: -1, y: 0 } }];
const RIGHT: readonly Action[] = [{ type: 'thrust', dir: { x: 1, y: 0 } }];
const TURRET: readonly Action[] = [{ type: 'buildOrder', item: 'turret', orderId: 77 }];
const SHIELD: readonly Action[] = [{ type: 'buildOrder', item: 'shield', orderId: 78 }];

function input(tick: number, actions: readonly Action[] = FIRE, seq = tick): InputMessage {
  return { type: 'input', tick, seq, actions };
}

describe('InputQueue', () => {
  it('files input under the tick it names, not the tick it arrived on', () => {
    const q = new InputQueue();
    // Delivered backwards — the wire is allowed to do that.
    expect(q.accept(0, input(3, BUILD), 0)).toBe('queued');
    expect(q.accept(0, input(1, FIRE), 0)).toBe('queued');

    expect(q.take(1)).toEqual([{ id: 0, actions: FIRE, seq: 1 }]);
    expect(q.take(2)).toEqual([]);
    expect(q.take(3)).toEqual([{ id: 0, actions: BUILD, seq: 3 }]);
  });

  it('hands players to the sim in slot order, whatever order they arrived in', () => {
    const q = new InputQueue();
    for (const player of [5, 0, 3, 1]) q.accept(player, input(1), 0);

    expect(q.take(1).map((p) => p.id)).toEqual([0, 1, 3, 5]);
  });

  it('drops input for a tick the sim already ran — late is late', () => {
    const q = new InputQueue();
    expect(q.accept(0, input(7), 7)).toBe('late'); // exactly the simulated tick
    expect(q.accept(0, input(4), 7)).toBe('late'); // and everything behind it
    expect(q.take(4)).toEqual([]);
    expect(q.stats.late).toBe(2);
  });

  it('keeps the first message for a (player, tick) and ignores retransmits', () => {
    const q = new InputQueue();
    expect(q.accept(2, input(1, FIRE), 0)).toBe('queued');
    expect(q.accept(2, input(1, BUILD), 0)).toBe('duplicate');

    expect(q.take(1)).toEqual([{ id: 2, actions: FIRE, seq: 1 }]);
    expect(q.stats.duplicate).toBe(1);
  });

  it('carries the client sequence through to the tick that runs it', () => {
    // The seq is what a snapshot acknowledges, and it may only be acknowledged
    // once the sim has actually consumed the row (GDD §4.2 reconciliation): the
    // queue is where that number survives the wait between arrival and tick.
    const q = new InputQueue();
    q.accept(0, input(5, FIRE, 41), 0);
    q.accept(1, input(5, BUILD, 907), 0);

    expect(q.take(5).map((row) => row.seq)).toEqual([41, 907]);
  });

  it('refuses input beyond the future horizon instead of buffering it', () => {
    const q = new InputQueue();
    expect(q.accept(0, input(MAX_FUTURE_TICKS), 0)).toBe('queued');
    expect(q.accept(0, input(MAX_FUTURE_TICKS + 1), 0)).toBe('far-future');
    expect(q.accept(0, input(2 ** 31), 0)).toBe('far-future');
    // A client claiming an absurd tick costs the server exactly one bucket.
    expect(q.bufferedTicks).toBe(1);
  });

  it('rejects a non-integer tick rather than filing a fractional one', () => {
    const q = new InputQueue();
    expect(q.accept(0, input(1.5), 0)).toBe('late');
    expect(q.accept(0, input(Number.NaN), 0)).toBe('late');
    expect(q.bufferedTicks).toBe(0);
  });

  it('empties its buckets as the sim consumes them', () => {
    const q = new InputQueue();
    q.accept(0, input(1), 0);
    q.accept(1, input(1), 0);
    expect(q.bufferedTicks).toBe(1);
    q.take(1);
    expect(q.bufferedTicks).toBe(0);
    // Taken once means taken: a tick never replays.
    expect(q.take(1)).toEqual([]);
  });

  it('prunes everything the sim skipped past', () => {
    const q = new InputQueue();
    for (const tick of [1, 2, 3, 9]) q.accept(0, input(tick), 0);
    q.pruneThrough(3);
    expect(q.bufferedTicks).toBe(1);
    expect(q.take(9).map((p) => p.id)).toEqual([0]);
  });

  // ── Coalescing: two messages, one tick, nothing lost (M10 tick-alignment) ──

  it('merges a collision instead of dropping it, newest stick wins', () => {
    const q = new InputQueue();
    q.coalesce(0, { ...input(5, LEFT, 10) }, 0);
    expect(q.coalesce(0, { ...input(5, RIGHT, 11) }, 0)).toBe('queued');

    // The player is holding the stick to the right *now*; the older reading
    // described a position that has been superseded. And the ack names the newest
    // input whose effect is accounted for, so the client can retire both.
    expect(q.take(5)).toEqual([{ id: 0, actions: RIGHT, seq: 11 }]);
  });

  it('keeps every one-shot order in a collision, older first', () => {
    const q = new InputQueue();
    q.coalesce(0, { ...input(5, [...TURRET, ...LEFT], 10) }, 0);
    q.coalesce(0, { ...input(5, [...SHIELD, ...RIGHT], 11) }, 0);

    // Both purchases survive — a dropped `buildOrder` is a press the player made,
    // was charged for locally, and that authority never heard — while the stick
    // reading is still only the newest one.
    expect(q.take(5)).toEqual([{ id: 0, actions: [...TURRET, ...SHIELD, ...RIGHT], seq: 11 }]);
  });

  it('files a first arrival exactly as accept would', () => {
    const q = new InputQueue();
    expect(q.coalesce(0, input(5, LEFT, 10), 0)).toBe('queued');
    expect(q.take(5)).toEqual([{ id: 0, actions: LEFT, seq: 10 }]);
    expect(q.stats.duplicate).toBe(0);
  });

  it('merges a whole retransmit burst onto one tick without losing a press', () => {
    const q = new InputQueue();
    // Forty messages arriving at once after a stall, all re-filed onto tick 5 —
    // the case that used to discard 48 % of a player's input at 250 ms with 2 %
    // loss, keeping the *oldest* stick reading of the backlog.
    for (let i = 0; i < 40; i++) {
      const orders: readonly Action[] = i % 10 === 0 ? [{ type: 'buildOrder', item: 'turret', orderId: i }] : [];
      q.coalesce(0, input(5, [...orders, ...(i === 39 ? RIGHT : LEFT)], 100 + i), 0);
    }

    const [row] = q.take(5);
    expect(row!.seq).toBe(139);
    expect(row!.actions.filter((a) => a.type === 'buildOrder')).toHaveLength(4);
    expect(row!.actions.at(-1)).toEqual(RIGHT[0]);
    expect(q.stats.duplicate).toBe(0);
  });

  it('is still bounded: late is late and the far future is refused', () => {
    const q = new InputQueue();
    expect(q.coalesce(0, input(7), 7)).toBe('late');
    expect(q.coalesce(0, input(2 ** 31), 0)).toBe('far-future');
    expect(q.bufferedTicks).toBe(0);
  });

  it('keeps one player out of another player\'s row', () => {
    const q = new InputQueue();
    q.coalesce(0, input(5, LEFT, 10), 0);
    q.coalesce(1, input(5, RIGHT, 11), 0);
    expect(q.take(5)).toEqual([
      { id: 0, actions: LEFT, seq: 10 },
      { id: 1, actions: RIGHT, seq: 11 },
    ]);
  });
});
