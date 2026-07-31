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
import type { PlayerInput } from '../sim';

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

/** What a filed message keeps until its tick runs: the actions, and the client
 *  sequence number that will be acknowledged when they are simulated. */
interface FiledInput {
  readonly actions: readonly Action[];
  readonly seq: number;
}

/** Running counts, for server logging and for tests to assert against. */
export interface InputStats {
  queued: number;
  late: number;
  duplicate: number;
  farFuture: number;
}

/**
 * One player's input row for a tick, carrying the client sequence number it was
 * filed under.
 *
 * The sim only ever reads `id` and `actions` — this is a plain {@link PlayerInput}
 * as far as `step()` is concerned. The extra field exists for the authority that
 * runs the sim: the moment a row is handed to `step()`, its `seq` is the newest
 * input from that client the world has *actually simulated*, which is exactly
 * what a snapshot's `ackSeq` must mean for client-side reconciliation to line up
 * (GDD §4.2). Acknowledging on arrival instead would tell a predicting client
 * that input it can still feel in its own hands has already been accounted for.
 */
export interface AppliedInput extends PlayerInput {
  readonly seq: number;
}

/** A tick's worth of {@link AppliedInput} rows — an `Inputs` the sim can eat. */
export type AppliedInputs = readonly AppliedInput[];

/** No input for this tick — a frozen empty array, so the common idle case for
 *  a slot allocates nothing (GDD §4.3). */
const NO_INPUTS: AppliedInputs = Object.freeze([]) as AppliedInputs;

/**
 * A tick-indexed buffer of the input that has arrived but not yet been
 * simulated. Not part of the world tree — it is transport-side plumbing, so it
 * may use `Map` freely (the sim's plain-data rule applies to `World`, not here).
 */
export class InputQueue {
  private readonly pending = new Map<Tick, Map<PlayerId, FiledInput>>();
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

    bucket.set(player, { actions: message.actions, seq: message.seq });
    return this.count('queued');
  }

  /**
   * File one client's input for `tick`, **merging** with anything already filed
   * for that (player, tick) instead of refusing it.
   *
   * ── WHY THIS EXISTS (M10 tick-alignment, measured) ──
   *
   * {@link accept} keeps the first message for a pair and drops every later one,
   * which is right when two messages *claim* one tick — they cannot both be that
   * tick's input. It is catastrophically wrong for the case the server actually
   * hits, which is a **retransmit burst**: a TCP stall holds thirty or forty of a
   * client's input messages and then delivers them at line rate, every one of them
   * naming a tick the sim has already run. Re-filed onto the next unsimulated tick
   * (`server/room.ts` `acceptInput`) they all collide on that one tick — so the
   * first one is queued and *the rest are dropped as duplicates*. Measured on the
   * latency harness at 250 ms with 2 % loss: **582 of 1200 input messages
   * discarded, 48 % of everything the player pressed**, and the one that survived
   * was the *oldest* of the burst, so the ship was steered by the stalest stick in
   * the backlog while the client had long since moved on.
   *
   * So a collision merges rather than drops, on the one rule that is true of both
   * kinds of action:
   *
   *  - **continuous verbs — thrust, aim, fire — come from the newest message.**
   *    They are a *state*, not an event: the player is holding a stick right now,
   *    and the freshest reading of it is the only one worth simulating. The older
   *    ones described a stick position that has already been superseded.
   *  - **one-shot orders — `buildOrder`, `upgradeOrder` — are kept from every
   *    message, in arrival order.** They are *events*: each one is a purchase the
   *    player made and was charged for locally, so dropping one is a press that
   *    silently does nothing (the wheel that "sometimes doesn't work"). Running
   *    two on one tick is exactly what a player who tapped twice inside 16 ms
   *    would get offline, and the per-slot idempotence table stops a *redelivered*
   *    order from being run twice regardless (`server/room.ts` `consumeOrders`).
   *
   * The seq kept is the newest, because it is the newest input whose effect is now
   * accounted for — which is what `ackSeq` promises a reconciling client, and what
   * lets that client retire the whole burst instead of holding a queue the server
   * has already answered.
   *
   * Ordering stays deterministic for the same reason {@link accept}'s first-wins
   * rule did: a WebSocket delivers one client's messages in send order (TCP), so
   * "newest" is the same message on every run.
   */
  coalesce(player: PlayerId, message: InputMessage, simTick: Tick): InputVerdict {
    const tick = message.tick;
    if (!Number.isInteger(tick) || tick <= simTick) return this.count('late');
    if (tick > simTick + MAX_FUTURE_TICKS) return this.count('far-future');

    const bucket = this.pending.get(tick);
    const filed = bucket?.get(player);
    if (bucket === undefined || filed === undefined) return this.accept(player, message, simTick);

    bucket.set(player, {
      actions: mergeTickActions(filed.actions, message.actions),
      seq: Math.max(filed.seq, message.seq),
    });
    return this.count('queued');
  }

  /**
   * Remove and return everything filed for `tick`, players in ascending slot
   * order. Returns the shared empty array when nobody sent anything — a tick
   * with no input is a legal tick (every ship simply holds its last intent,
   * which the sim already models as a neutral intent).
   */
  take(tick: Tick): AppliedInputs {
    const bucket = this.pending.get(tick);
    if (bucket === undefined) return NO_INPUTS;
    this.pending.delete(tick);

    const out: AppliedInput[] = [];
    for (const [id, filed] of bucket) out.push({ id, actions: filed.actions, seq: filed.seq });
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

// ---------------------------------------------------------------------------
// Merging two messages that landed on one tick
// ---------------------------------------------------------------------------

/**
 * Whether an action is a **one-shot order** — an event the player performed once,
 * rather than a stick position that a newer reading supersedes.
 *
 * The two verbs are the wheel's: `buildOrder` and `upgradeOrder` (GDD §2.4's six
 * verbs; `@shared/types`). Everything else — thrust, aim, fire — is continuous by
 * construction, which is what makes "keep the newest" the right rule for them and
 * the wrong rule for these.
 */
function isOneShot(action: Action): boolean {
  return action.type === 'buildOrder' || action.type === 'upgradeOrder';
}

/**
 * One tick's actions from two messages that landed on the same tick: the newer
 * message's continuous verbs, preceded by every one-shot order from both, older
 * first ({@link InputQueue.coalesce} carries the reasoning).
 *
 * Returns one of the caller's own arrays untouched in the two common shapes — no
 * orders anywhere (the newer array is the answer) and nothing but orders in the
 * older one — so the merge allocates only when it actually has something to merge
 * (GDD §4.3: no per-frame allocation on the paths that run every frame; this one
 * runs only on a collision).
 */
export function mergeTickActions(
  older: readonly Action[],
  newer: readonly Action[],
): readonly Action[] {
  const carried = older.filter(isOneShot);
  if (carried.length === 0) return newer;
  return [...carried, ...newer];
}
