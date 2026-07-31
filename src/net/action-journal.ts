/**
 * src/net/action-journal.ts — what the player *did*, and what authority said about
 * it. OWNER: Netcode Engineer (GDD §4.2; M10 tick-alignment, brief item 3).
 *
 * *"Session log gains the action events (fire volley, build order, echo
 * match/mismatch, prediction expiry) so the developer's next paste shows the echo
 * machinery in numbers."*
 *
 * The per-second telemetry (`./telemetry`) says how far prediction was from
 * authority and how well the clocks line up. It cannot say *what happened*: a
 * player who reports "I tapped twice and got three turrets" or "my shot didn't come
 * out" is describing discrete events, and an average of thirty reconciles is the
 * wrong instrument for a discrete event. This is the right one — a small ring of the
 * four things the M10 echo machinery is made of:
 *
 *  - **volley** — the local ship's trigger produced a shot. The firer draws its own
 *    shots from prediction (`./prediction` `harvestOwnShots`), so this is the only
 *    record that a shot ever existed on this screen.
 *  - **order** — a one-shot purchase went out with an id on it (`./order-ledger`).
 *  - **echo** — authority answered one: adopted, refused, or about an id this client
 *    was not waiting on. The *mismatch* cases are the whole reason the channel
 *    exists, and they are one word each in a pasted log.
 *  - **expiry** — a prediction that was never answered at all, rolled back at its
 *    TTL. One of these is a lost message; a run of them is a wire that is not
 *    carrying orders.
 *
 * **Bounded and drained.** The ring holds {@link JOURNAL_CAPACITY} events and the
 * log takes them once (`./playtest-log-attach`), so a fifteen-minute match cannot
 * grow it and a paste is never a wall of duplicates. Nothing here reads a clock: an
 * event is stamped with the *sim tick* it happened on, which is the coordinate the
 * rest of this lane argues in.
 */

import type { OrderVerb } from './order-ledger';
import type { Tick } from './transport';

/** How many events the ring keeps before the oldest falls off. Two hundred is a
 *  couple of minutes of ordinary play (a volley every ~20 ticks, an order every few
 *  seconds) and a few seconds of frantic tapping — past which the newest events are
 *  the ones a report is about anyway. */
export const JOURNAL_CAPACITY = 200;

/** What authority did with an order this client predicted (`./order-ledger`
 *  `OrderOutcome`), plus the case where it named one we never predicted. */
export type EchoOutcome =
  /** Authority accepted it: the prediction is adopted into its answer. */
  | 'adopt'
  /** Authority refused it: the prediction is taken back, visibly. */
  | 'refused'
  /** An echo for an id this client is not waiting on — a repeated frame, or an
   *  order from before a reclaim rebuilt the world. Neither is an error, and both
   *  are worth seeing in a log that is trying to explain a missing turret. */
  | 'unknown';

/** One thing the player did, or one thing authority said about it. */
export type ActionEvent =
  | {
      readonly kind: 'volley';
      readonly tick: Tick;
      /** The firer's own predicted shots alive after this one spawned — the number
       *  that must not climb past what the fire interval allows (`./prediction`
       *  `MAX_PREDICTED_SHOTS`). */
      readonly inFlight: number;
    }
  | {
      readonly kind: 'order';
      readonly tick: Tick;
      readonly orderId: number;
      readonly verb: OrderVerb;
      /** The `BuildItem` or `UpgradeTrack` asked for. */
      readonly what: string;
    }
  | {
      readonly kind: 'echo';
      readonly tick: Tick;
      readonly orderId: number;
      readonly outcome: EchoOutcome;
      /** Ticks between predicting the order and authority's answer landing — the
       *  round trip as the *wheel* experiences it, which is not the same number as
       *  the stick's (`./telemetry` RTT is measured on input acks). Null when the
       *  echo is about an order this client never predicted. */
      readonly waited: number | null;
    }
  | {
      readonly kind: 'expiry';
      readonly tick: Tick;
      readonly orderId: number;
      readonly what: string;
      /** Ticks the client waited before giving up — the TTL as it stood, which is
       *  itself sized from the measured wire (`./order-ledger` `setTtlFromRtt`). */
      readonly waited: number;
    };

/**
 * A bounded ring of {@link ActionEvent}s, written by the prediction loop and read
 * once by whoever is logging.
 */
export class ActionJournal {
  private readonly events: ActionEvent[] = [];
  private readonly capacity: number;
  /** Events dropped because nobody drained the ring in time — reported rather than
   *  hidden, so a paste can never imply a quiet match when it was a full one. */
  private lost = 0;

  constructor(capacity: number = JOURNAL_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  /** Note one event. Cheap and allocation-free past the event object itself, which
   *  is why the prediction loop can call it on the ticks something happens. */
  record(event: ActionEvent): void {
    this.events.push(event);
    while (this.events.length > this.capacity) {
      this.events.shift();
      this.lost++;
    }
  }

  /** Everything recorded since the last drain, oldest first, and the ring is empty
   *  afterwards. */
  drain(): readonly ActionEvent[] {
    if (this.events.length === 0) return EMPTY;
    return this.events.splice(0, this.events.length);
  }

  /** Events currently waiting, without taking them — for a test, and for anything
   *  that wants to look without consuming. */
  get pending(): readonly ActionEvent[] {
    return this.events;
  }

  /** How many events fell off the ring before anyone read them. */
  get dropped(): number {
    return this.lost;
  }
}

const EMPTY: readonly ActionEvent[] = Object.freeze([]);
