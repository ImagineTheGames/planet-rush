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
});
