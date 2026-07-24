/**
 * src/net/input-queue.ts — the ordered input tick buffer. OWNER: Netcode
 * Engineer (GDD §3.5, §4.2).
 *
 * The one rule this module exists to enforce: **the simulation consumes ordered
 * input ticks** (GDD §4.2). A transport may deliver a player's `InputMessage`
 * early, late, twice, or interleaved with another player's — none of that may
 * reach `step()`. Everything arriving is filed by tick here, and the sim reads
 * exactly one tick's worth at a time, with the players in a fixed order.
 *
 * Three properties, all of them load-bearing for the determinism replay
 * (GDD §4.8 — same inputs, same final state hash):
 *
 *  1. **Tick order.** Input is applied to the tick it names, never to "now".
 *  2. **Player order.** {@link InputQueue.take} always returns players sorted by
 *     `PlayerId`, so *arrival* order cannot change the sim's resolution order —
 *     two clients whose packets race produce one identical world.
 *  3. **Bounded.** Late input (a tick the sim already ran) is dropped rather
 *     than rewound, duplicates are dropped rather than re-applied, and input
 *     too far in the future is refused rather than buffered — so a stalled or
 *     hostile client can neither grow the server's memory nor force an
 *     unbounded catch-up loop.
 *
 * Shared deliberately: `LocalLoopback` (offline) and the WebSocket match server
 * (online) both file input through this same queue, which is what makes "the
 * sim consumes them identically offline as online" a fact rather than a hope.
 */

import type { Action, PlayerId } from '@shared/types';
import type { InputMessage, Tick } from './transport';
import type { Inputs, PlayerInput } from '../sim';

/**
 * How far ahead of the simulated tick input may be filed: 2 seconds at the
 * 60 Hz sim tick (GDD §4.1). Generous enough to absorb a client that runs a few
 * frames ahead of the server on a jittery link, tight enough that a client
 * claiming tick 4 billion is refused instead of buffered.
 */
export const MAX_FUTURE_TICKS = 120;

/** What the queue did with an offered message — the server's accounting. */
export type InputVerdict =
  /** Filed for its tick; it will be handed to the sim when that tick runs. */
  | 'queued'
  /** The sim already ran that tick: too late to matter, dropped (never rewound). */
  | 'late'
  /** This player already has input filed for that tick; the first one stands. */
  | 'duplicate'
  /** Beyond {@link MAX_FUTURE_TICKS} ahead of the sim: refused, not buffered. */
  | 'far-future';

/** Running counts, for server logging and for tests to assert against. */
export interface InputStats {
  queued: number;
  late: number;
  duplicate: number;
  farFuture: number;
}

/** No input for this tick — a frozen empty array, so the common idle case for
 *  a slot allocates nothing (GDD §4.3). */
const NO_INPUTS: Inputs = Object.freeze([]) as Inputs;

/**
 * A tick-indexed buffer of the input that has arrived but not yet been
 * simulated. Not part of the world tree — it is transport-side plumbing, so it
 * may use `Map` freely (the sim's plain-data rule applies to `World`, not here).
 */
export class InputQueue {
  private readonly pending = new Map<Tick, Map<PlayerId, readonly Action[]>>();
  private readonly counts: InputStats = { queued: 0, late: 0, duplicate: 0, farFuture: 0 };

  /**
   * File one client's input for the tick it names.
   *
   * @param player  the slot the message came from — taken from the *connection*,
   *                never from the message body: the server never trusts a client
   *                to say who it is.
   * @param message the client's `InputMessage`.
   * @param simTick the last tick the sim has already run.
   */
  accept(player: PlayerId, message: InputMessage, simTick: Tick): InputVerdict {
    const tick = message.tick;
    if (!Number.isInteger(tick) || tick <= simTick) return this.count('late');
    if (tick > simTick + MAX_FUTURE_TICKS) return this.count('far-future');

    let bucket = this.pending.get(tick);
    if (bucket === undefined) {
      bucket = new Map();
      this.pending.set(tick, bucket);
    }
    // First message for a (player, tick) wins. A second one is a retransmit or
    // a client changing its mind about a tick it already committed to; either
    // way the sim's view of that tick is already fixed, so honoring the later
    // one would make the result depend on delivery timing.
    if (bucket.has(player)) return this.count('duplicate');

    bucket.set(player, message.actions);
    return this.count('queued');
  }

  /**
   * Remove and return everything filed for `tick`, players in ascending slot
   * order. Returns the shared empty array when nobody sent anything — a tick
   * with no input is a legal tick (every ship simply holds its last intent,
   * which the sim already models as a neutral intent).
   */
  take(tick: Tick): Inputs {
    const bucket = this.pending.get(tick);
    if (bucket === undefined) return NO_INPUTS;
    this.pending.delete(tick);

    const out: PlayerInput[] = [];
    for (const [id, actions] of bucket) out.push({ id, actions });
    // Sorted, so packet races cannot reorder the sim (property 2 above).
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  /** Drop everything filed for ticks at or before `simTick` — the sim has moved
   *  past them and will never ask again. Called after a catch-up jump, where
   *  ticks are skipped rather than taken. */
  pruneThrough(simTick: Tick): void {
    for (const tick of this.pending.keys()) {
      if (tick <= simTick) this.pending.delete(tick);
    }
  }

  /** Ticks currently holding at least one player's input. */
  get bufferedTicks(): number {
    return this.pending.size;
  }

  /** Running verdict counts (a copy — callers cannot mutate the tally). */
  get stats(): InputStats {
    return { ...this.counts };
  }

  private count(verdict: InputVerdict): InputVerdict {
    if (verdict === 'queued') this.counts.queued++;
    else if (verdict === 'late') this.counts.late++;
    else if (verdict === 'duplicate') this.counts.duplicate++;
    else this.counts.farFuture++;
    return verdict;
  }
}
