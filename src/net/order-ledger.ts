/**
 * src/net/order-ledger.ts — every predicted order, until authority answers for it.
 * OWNER: Netcode Engineer (GDD §2.5, §4.2; M10 action-echo brief).
 *
 * The developer's mobile playtest, in one sentence: *"every action happens twice."*
 * Shooting produced two sets of shots, a repair showed twice, and two taps on
 * TURRET built three turrets. One defect class underneath all of it — **a predicted
 * side effect and the authoritative echo of that same side effect were never
 * matched, so both existed.**
 *
 * Position never had this problem: a snapshot *overwrites* the ship, so authority's
 * answer replaces the prediction by construction. A side effect is different. It is
 * a *thing that came into being* — a build job, a turret, a shot — and a client that
 * makes one and a server that makes one make **two**, unless something says they are
 * the same thing. This module is that something for orders: a small ledger of "I
 * predicted this, and I am waiting to hear what you did with it", keyed by the
 * client sequence id the order carried out (`@shared/types` `OrderId`).
 *
 * Three outcomes, and the ledger exists so that all three are handled rather than
 * one:
 *
 *  1. **Accepted.** Authority ran the order and says what it produced
 *    ({@link OrderEcho}). The client's prediction is *adopted into* that answer —
 *    the predicted build job takes authority's id and authority's construction
 *    clock — so there is one job, not two, and it finishes when the server's does
 *    rather than ten seconds ahead of it.
 *  2. **Refused.** Authority ran it and did nothing — the ore was not there, the
 *    ring was full, the ship was not docked on the tick that actually got
 *    simulated. The prediction is rolled back, visibly: the ghost turret the player
 *    was watching assemble goes away, which is the truth arriving late rather than
 *    a lie left standing.
 *  3. **Silence.** No echo at all, because the order never reached the server or
 *    the answer never came back. Indistinguishable from a refusal *from here*, and
 *    treated as one after {@link OrderLedger.ttlTicks} — the TTL is the whole reason
 *    a dropped order cannot leave a phantom on screen for the rest of the match.
 *
 * The ledger holds records and decides; it never touches a `World`. The world edits
 * are `./prediction`'s, which owns it — the same split that keeps `./telemetry` a
 * counter rather than a renderer.
 */

import type { OrderId } from '@shared/types';
import type { Tick } from './transport';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * How long a prediction waits for its echo before it is rolled back, in ticks,
 * when nothing has been measured yet — 1.5 s at 60 Hz.
 *
 * The echo is one round trip plus the server's own tick, so the honest bound is
 * measured rather than assumed ({@link OrderLedger.setTtlFromRtt}); this is the
 * value a client opens on, before it has an RTT sample. Generous on purpose: a
 * rollback of an order the server *did* run is a worse artifact than a ghost that
 * lingers half a second longer, because the first one takes a turret away from a
 * player who paid for it.
 */
export const DEFAULT_ORDER_TTL_TICKS = 90;

/** The floor the measured TTL will not narrow below (0.5 s) — under this a clean
 *  LAN would start rolling back its own presses on ordinary scheduling jitter. */
export const MIN_ORDER_TTL_TICKS = 30;

/** The ceiling (3 s). Past this the connection is not slow, it is gone: the seat
 *  is a bot's and the grace window is running (GDD §4.2), and holding a phantom
 *  turret for longer than this helps nobody. */
export const MAX_ORDER_TTL_TICKS = 180;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** The two one-shot verbs an order id is minted for (GDD §2.4, §2.5). */
export type OrderVerb = 'buildOrder' | 'upgradeOrder';

/**
 * What authority did with one order — the server's answer, carried on its own
 * low-frequency channel (`./transport` `OrderEchoMessage`).
 *
 * `accepted: false` is a *statement*, not a missing field: the server ran the order
 * and the sim refused it (unaffordable, undocked, capped). It is what turns a
 * rolled-back prediction from a guess into a fact.
 */
export interface OrderEcho {
  readonly orderId: OrderId;
  /** True when the simulation actually acted on it. */
  readonly accepted: boolean;
  /** The authoritative tick the order was simulated on — the **birth tick** a
   *  spawned thing dates from, so a predicted build re-bases its construction
   *  clock onto the server's rather than finishing a round trip early. */
  readonly tick: Tick;
  /** The build job the order queued, when it queued one. Absent for the orders
   *  that spawn nothing: BANK, REPAIR, a ship upgrade, a turret-tier step. */
  readonly build?: {
    /** The authoritative `BuildJob.id`. */
    readonly id: number;
    /** Seconds of construction left, as authority holds them at `tick`. */
    readonly remaining: number;
    /** Seconds the job started with — the progress denominator. */
    readonly total: number;
  };
}

/** One order this client predicted and has not yet heard about. */
export interface PredictedOrder {
  readonly orderId: OrderId;
  readonly verb: OrderVerb;
  /** The `BuildItem` or `UpgradeTrack` asked for — carried for the log and for a
   *  test to name what was rolled back. */
  readonly what: string;
  /** The client tick the order was predicted on. */
  readonly tick: Tick;
  /** The tick past which an unanswered prediction is rolled back. */
  readonly deadline: Tick;
  /** The `BuildJob.id` the local sim gave this order, or null when the order
   *  spawned nothing locally (it was refused locally too, or it buys no entity). */
  buildId: number | null;
}

/** What the caller must do to the predicted world about one order. */
export type OrderOutcome =
  /** Authority agrees: keep the prediction, re-based onto the echo. */
  | { readonly kind: 'adopt'; readonly order: PredictedOrder; readonly echo: OrderEcho }
  /** Authority refused it, or never answered: take the prediction back. */
  | { readonly kind: 'rollback'; readonly order: PredictedOrder; readonly reason: 'refused' | 'expired' };

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/**
 * The client's outstanding predicted orders, and the id minter that names them.
 *
 * Ids are minted here rather than at the button, because the id has to survive the
 * one journey that matters — out on the wire and back — and the button does not
 * know about that journey. `./session` stamps them onto the action as it sends
 * (which is also the last moment before the same action is predicted locally, so
 * the two copies can never disagree about which id they are).
 */
export class OrderLedger {
  private readonly open = new Map<OrderId, PredictedOrder>();
  private counter = 0;
  private ttl = DEFAULT_ORDER_TTL_TICKS;

  /** Ids already settled, newest last — so a duplicate echo (the wire may say a
   *  thing twice) is recognized as one already answered rather than as unknown. */
  private readonly settled: OrderId[] = [];

  /**
   * The next order id.
   *
   * `player` namespaces it, so two clients in one room never mint the same number
   * and a server-side dedupe table keyed by id alone would still be correct — the
   * server keys per slot as well, but a protocol whose ids are globally unique is
   * one fewer thing to reason about in a log. 20 bits of counter is ~17 000 orders
   * at 60 Hz sustained, far past a 15-minute match's worth of taps (GDD §1).
   */
  mint(player: number): OrderId {
    this.counter = (this.counter + 1) & 0xf_ffff;
    return ((player & 0x7) << 20) | this.counter;
  }

  /** Orders still waiting on an echo, oldest first. */
  get pending(): readonly PredictedOrder[] {
    return [...this.open.values()];
  }

  /** The current TTL in ticks (`DEFAULT_ORDER_TTL_TICKS` until measured). */
  get ttlTicks(): number {
    return this.ttl;
  }

  /**
   * Size the TTL from a measured round trip, the same discipline the lead budget
   * and the jitter buffer follow (`./prediction`, `./interpolation`).
   *
   * An echo costs one round trip plus the tick the server was on when the order
   * landed, so `2 × RTT + 4 × jitter` is a deliberately loose bound on it: this
   * clock decides whether a *real* turret gets taken away from a player, so it errs
   * long. Clamped into `[MIN_ORDER_TTL_TICKS, MAX_ORDER_TTL_TICKS]`.
   */
  setTtlFromRtt(rttMs: number | null, jitterMs: number | null, dtMs: number): number {
    if (rttMs === null) return this.ttl;
    const ticks = Math.ceil((2 * rttMs + 4 * (jitterMs ?? 0)) / dtMs) + 12;
    this.ttl = Math.max(MIN_ORDER_TTL_TICKS, Math.min(MAX_ORDER_TTL_TICKS, ticks));
    return this.ttl;
  }

  /** Note that an order was predicted on `tick`. */
  record(orderId: OrderId, verb: OrderVerb, what: string, tick: Tick): PredictedOrder {
    const order: PredictedOrder = {
      orderId,
      verb,
      what,
      tick,
      deadline: tick + this.ttl,
      buildId: null,
    };
    this.open.set(orderId, order);
    return order;
  }

  /** Attach the local sim's build job to the order that produced it — the handle a
   *  rollback removes and an adoption rewrites. */
  attachBuild(orderId: OrderId, buildId: number): void {
    const order = this.open.get(orderId);
    if (order) order.buildId = buildId;
  }

  /**
   * Take one echo. Returns what to do about it, or null when the id is not one this
   * client is waiting on — an echo for an order already settled (a repeated frame),
   * or for a client that rebuilt its world since (a reclaim). Neither is an error
   * and neither may touch the world: acting on an unknown id is how a second
   * rollback would take away a turret the player still owns.
   */
  settle(echo: OrderEcho): OrderOutcome | null {
    const order = this.open.get(echo.orderId);
    if (!order) return null;
    this.close(echo.orderId);
    return echo.accepted
      ? { kind: 'adopt', order, echo }
      : { kind: 'rollback', order, reason: 'refused' };
  }

  /**
   * Every prediction whose deadline has passed with no answer, removed from the
   * ledger and handed back for rollback. Called once per reconcile with the client's
   * own clock — it is the client's clock the deadline was set against.
   */
  sweep(tick: Tick): readonly OrderOutcome[] {
    let out: OrderOutcome[] | null = null;
    for (const order of this.open.values()) {
      if (tick <= order.deadline) continue;
      (out ??= []).push({ kind: 'rollback', order, reason: 'expired' });
    }
    if (!out) return EMPTY;
    for (const outcome of out) this.close(outcome.order.orderId);
    return out;
  }

  /** Forget everything — a reclaim rebuilds the world, and a prediction about the
   *  old one has nothing left to be about (`./session` `beginPredicting`). */
  reset(): void {
    this.open.clear();
    this.settled.length = 0;
  }

  private close(orderId: OrderId): void {
    this.open.delete(orderId);
    this.settled.push(orderId);
    // A bounded memory of what has been answered: long enough that a duplicated
    // frame is recognized, short enough that it cannot grow with the match.
    if (this.settled.length > SETTLED_MEMORY) this.settled.shift();
  }

  /** True when this id has already been answered — the read that lets a caller
   *  tell "never heard of it" from "heard of it twice". */
  isSettled(orderId: OrderId): boolean {
    return this.settled.includes(orderId);
  }
}

/** Ids remembered after settling, so a repeated echo is identified rather than
 *  treated as unknown. Two seconds of the fastest plausible tapping. */
const SETTLED_MEMORY = 64;

/** The frozen empty result, so the common "nothing expired" sweep allocates
 *  nothing (GDD §4.3: zero per-frame allocations). */
const EMPTY: readonly OrderOutcome[] = Object.freeze([]);
