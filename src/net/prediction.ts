/**
 * src/net/prediction.ts — client-side prediction and reconciliation.
 * OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * *"Client-side prediction makes input feel instant: your own ship simulates
 * locally the moment you press a key and reconciles against server authority —
 * available because the sim is deterministic and the client runs the same code
 * the server does."* (GDD §4.2.) This module is that sentence.
 *
 * **The loop, once per fixed 60 Hz tick:**
 *
 *  1. {@link PredictedMatch.predict} — the tick's actions are recorded as
 *     *pending* (sent, not yet known to have been simulated by anyone but us)
 *     and the local world is stepped with them. The ship moves on the frame the
 *     key went down, at zero latency, because nothing was waited for.
 *  2. A snapshot arrives, 30 Hz, describing tick `T` — already in the past by
 *     one network trip. {@link PredictedMatch.reconcile} rewinds the world to
 *     `T`, writes authority over it, throws away every pending input the server
 *     says it has now run (`ackSeq`), and **replays the rest** — landing back on
 *     the tick the player is actually flying, with the server's version of
 *     history underneath it.
 *
 * **What "rewind" means here.** The snapshot carries ships and projectiles and
 * nothing else (`./snapshot`), so it cannot restore a whole world by itself.
 * What it can do is put the world's clock back: this class keeps a tiny
 * per-tick checkpoint — tick, sim time, RNG state, entity counter, and where
 * prediction had put the local ship — so a rewind restores the scalars that
 * would otherwise compound. Without it, every reconcile would re-run N ticks of
 * `world.time` on top of the N it already ran, and the client would march into
 * the collapse phase minutes before the server did.
 *
 * **The replay steps the whole world, not just your ship.** That is deliberate:
 * the client owns one `step()` and it is the same one the server runs (GDD
 * §4.1) — carving a private ship-only integrator out of it would be the exact
 * duplicate-physics bug that makes prediction drift. The cost is that remote
 * ships coast through the replay on no input; they are overwritten by the next
 * snapshot 2 ticks later, and static entities are corrected by their own event
 * stream (`./entity-events`), so nothing drifts for long.
 *
 * **Three things the replay is not allowed to decide.** Replaying steps the whole
 * world, and `step()` resolves everything it touches — collisions, countdowns, the
 * tractor. Three of those results are lies told with confidence, so each is
 * re-asserted afterwards from the only source entitled to move it: **hull** is
 * authority's ({@link PredictedMatch.holdHull}), **death** is authority's
 * ({@link PredictedMatch.holdLifecycle}), and the **wallet** is the player's own
 * timeline re-anchored to authority's last statement, never the replay's re-derived
 * copy of either ({@link PredictedMatch.settleWallet}).
 *
 * **The correction is not shown as a jump.** Reconciling can move the local ship
 * — by a hair every snapshot (the wire quantizes positions to whole units) or by
 * a lot after real divergence. {@link PredictedMatch.renderOffset} carries that
 * displacement as a decaying visual offset the renderer adds, so the world is
 * authoritative *now* while the picture catches up over {@link RECONCILE_BLEND_FRAMES}
 * frames — the smooth correction the developer at ~150 ms asked for, where a
 * per-snapshot error too small to see must never read as a rollback. Past
 * {@link SNAP_THRESHOLD} it is not smoothed at all: a respawn or a genuine
 * teleport should look like one.
 */

import type { Action, PlayerId, Vec2 } from '@shared/types';
import {
  PROJECTILE,
  RESPAWN_S,
  SPAWN_PROTECTION_S,
  TICK_DT,
  refreshDerivedStats,
  stationOf,
  step,
} from '../sim';
import type { BuildJob, MiningStation, OreChunk, World } from '../sim';
import { ActionJournal } from './action-journal';
import { applyEntityEvent, respawnCountdown, respawnHold, respawnTicks } from './entity-events';
import type { ShipLifecycleData } from './entity-events';
import { StructureEcho } from './entity-echo';
import { OrderLedger } from './order-ledger';
import type { OrderEcho, OrderOutcome, OrderVerb } from './order-ledger';
import { LOCAL_SHOT_BASE } from './presentation';
import { MAX_PROJECTILES, SHIP_FLAG, SHOT_META, dequantizeAngle } from './snapshot';
import type { DecodedSnapshot } from './snapshot';
import type { EntityEventMessage, PlayerEconomy, Tick } from './transport';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Most unacknowledged inputs kept — two seconds of them at 60 Hz, the same
 * horizon `InputQueue` will accept from the future (`./input-queue`). Past this
 * the connection is not lagging, it is gone: a bot has the seat and the grace
 * window is running (GDD §4.2), so the oldest predictions are dropped rather
 * than replayed forever.
 */
export const MAX_PENDING_INPUTS = 120;

/**
 * The frame count a correction is blended out over — the developer's *"blend the
 * predicted state toward the authoritative one over N frames"* (M10 reconcile
 * brief), expressed as an exponential error decay with this as its time constant.
 * The offset falls to 1/e (~37 %) after this many frames and is effectively gone
 * (~5 %) after ~3× it — so at 60 fps a `RECONCILE_BLEND_FRAMES` of 6 lands the
 * picture on authority in ~100 ms without a single visible snap. It is the one
 * knob that decides whether a small per-snapshot divergence reads as *smooth* or
 * as the *"constant server rollback"* the developer reported at 150 ms RTT.
 */
export const RECONCILE_BLEND_FRAMES = 6;

/**
 * Most unsettled order receipts kept — what a refused order gives back
 * (`PredictedMatch.refund`, a0-52). One per outstanding press, and the order
 * ledger's TTL retires every record it opens within three seconds, so a player
 * would have to be pressing 20 times a second for this to bind. It exists so the
 * map is *provably* bounded rather than bounded by another module's good behaviour.
 */
export const MAX_OPEN_RECEIPTS = 64;

/**
 * Per-frame fraction of the visual correction offset that survives to the next
 * frame — the exponential-decay multiplier derived from
 * {@link RECONCILE_BLEND_FRAMES} (`e^(-1/N)` ≈ 0.846 at N = 6). Named separately
 * because {@link PredictedMatch.decayOffset} multiplies by it every tick and a
 * bare `0.846` there would be unreadable; tune {@link RECONCILE_BLEND_FRAMES},
 * not this.
 */
export const BLEND_DECAY = Math.exp(-1 / RECONCILE_BLEND_FRAMES);

/** Below this the offset is simply zeroed — chasing sub-pixel error costs more
 *  than it hides. */
export const SMOOTHING_EPSILON = 0.05;

/**
 * A correction larger than this is not smoothed — it is snapped, teleport-grade.
 * A respawn, a reclaim, or a resync moves the ship *because something happened*;
 * sliding it across the map would be a lie, and a slow one. Everything under it
 * is the smooth-correction regime {@link RECONCILE_BLEND_FRAMES} governs, so this
 * is also the ceiling the 150 ms latency harness (`prediction.test.ts`) asserts a
 * normal-flight correction never reaches.
 */
export const SNAP_THRESHOLD = 120;

/**
 * Most locally-predicted own shots kept alive across a reconcile.
 *
 * *"PROJECTILES — spawn predicted for the firer"* (M10 audit item 2b). A ship
 * fires every `SHIP_WEAPON.fireInterval` (0.35 s) and its shot lives
 * `range / speed` (~0.58 s), so **two** are in flight at once in the steady state;
 * this is that with room for the SPEED upgrade track and a burst, and it is a hard
 * cap so a pathological stream cannot grow the pool.
 */
export const MAX_PREDICTED_SHOTS = 8;

/**
 * The most ticks the client will run ahead of the newest snapshot it has applied
 * — the **lead budget**, and the audit's third fix (docs/netcode-audit.md).
 *
 * The client's clock is `snapshotTick + pending`: rewind to authority, replay
 * everything unacknowledged, land wherever that puts you. In a steady state that
 * is exactly right — the lead *is* the round trip, measured rather than guessed.
 * On a lossy wire it is a ratchet. A TCP retransmit stalls the ack stream for
 * hundreds of ms; the client keeps predicting and sending, so `pending` grows by
 * however long the stall lasted; the clock jumps forward by that much; and every
 * input after it is stamped for a tick that far in the future, so the *server*
 * holds it in its input queue until that tick comes round — which delays the next
 * ack, which keeps the queue long. The measured cost, at the developer's condition
 * with 2 % loss: a lead of 33 ticks (550 ms) at 150 ms RTT and 59 ticks (~1 s) at
 * 250 ms, held for the rest of the match. That is not rollback; it is the player's
 * own trigger arriving a second late, which is the other half of *"everything
 * moves so erratically"*.
 *
 * So the lead is bounded. This is the ceiling on that bound — 24 ticks, 400 ms,
 * enough for any playable wire; {@link PredictedMatch.leadBudget} narrows it to
 * the measured round trip plus a jitter allowance, and the excess is dropped
 * oldest-first. Dropping an unacknowledged input costs at most one small
 * correction (the server has almost always refused it as late anyway) and buys the
 * clock back.
 */
export const MAX_LEAD_TICKS = 24;

/**
 * The most pending inputs one reconcile will drop while pulling an over-budget
 * clock back.
 *
 * Trimming the lead moves the client's clock *backwards* by however many inputs it
 * drops, and the ship goes with it — so a stall that left the clock 45 ticks out
 * would, trimmed in one go, rewind the ship three quarters of a second of travel
 * on screen. That is the exact thing this audit exists to remove. So the clock
 * bleeds down instead: one tick per reconcile, 30 times a second, each step worth
 * a few world units and absorbed whole by the correction blend
 * ({@link RECONCILE_BLEND_FRAMES}). A second's worth of over-lead is gone inside
 * ~1.5 s and never once seen.
 */
export const MAX_TRIM_PER_RECONCILE = 4;

/** The floor the lead budget will not narrow below, whatever the wire measures:
 *  a client must be able to hold at least this many ticks of input in flight or a
 *  clean LAN would start trimming its own presses. Four ticks ≈ 67 ms. */
export const MIN_LEAD_TICKS = 4;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** One tick of local input, sent and awaiting the server's word on it. */
export interface PendingInput {
  readonly seq: number;
  readonly tick: Tick;
  readonly actions: readonly Action[];
}

/**
 * The scalars a rewind must put back, plus where prediction thought the local
 * ship was. Four numbers and a point per tick — the whole history buffer is
 * smaller than one snapshot.
 */
interface Checkpoint {
  tick: Tick;
  time: number;
  rngState: number;
  nextEntityId: number;
  /** Predicted local ship position at the end of this tick — the thing the
   *  authoritative snapshot is compared against to measure divergence. */
  x: number;
  y: number;
}

/** What one reconcile did, for the tests and for the instrument (`./telemetry`). */
export interface ReconcileReport {
  /** false when the snapshot was stale (an older tick than one already applied)
   *  and was therefore ignored — snapshots are full state, so the newest wins. */
  applied: boolean;
  /** Distance between where prediction had the local ship at the snapshot's tick
   *  and where authority actually had it. The number that must converge. */
  error: number;
  /** Pending inputs replayed on top of the authoritative state. */
  replayed: number;
  /** Pending inputs retired because the server has now simulated them. */
  acknowledged: number;
  /**
   * Pending inputs **dropped** because the client had run further ahead of
   * authority than {@link PredictedMatch.leadBudget} allows — the clock being
   * pulled back after a stall. Zero on a healthy wire; a burst of them is the
   * signature of a retransmit having just cleared.
   */
  trimmed: number;
  /**
   * True when the client could not rewind — a snapshot from before its history,
   * or from a tick it has not predicted yet (a join mid-match, a long stall) —
   * and took authority wholesale instead of correcting toward it.
   */
  resynced: boolean;
  /**
   * **Ticks between where this client predicted the acknowledged input and where
   * the server actually ran it** — `ackTick − predictedTick`, and null when the ack
   * names an input this client no longer holds a record of (the first snapshots of a
   * match, or an ack for something a lead trim already dropped).
   *
   * Zero is the whole point of the number. A client stamps an input with the tick it
   * predicted it at; the server files it under that tick and runs it there. When it
   * cannot — the message arrived after that tick had already been simulated, so it was
   * re-filed onto the next free one (`server/room.ts` `acceptInput`) — every prediction
   * built on that input is standing at the wrong instant, and reconciliation pays the
   * difference back on every snapshot for as long as it lasts. That is a *systematic*
   * correction rather than a stochastic one, and it looks exactly like the constant
   * small error the developer reported, which is why it is measured directly instead of
   * inferred from a magnitude (`./telemetry` `appliedDeltaMean`; the M10 tick-alignment
   * instrument).
   *
   * Positive means the server ran the press *later* than the client did, which is the
   * only direction a late re-file can go. Negative would mean authority ran an input
   * before the client predicted it — impossible over a wire, and worth a raised eyebrow
   * if it ever shows up.
   */
  appliedDelta: number | null;
  /**
   * True when the correction was **hard-snapped** rather than blended: it cleared
   * {@link SNAP_THRESHOLD}, so the ship teleported on screen instead of sliding
   * back over {@link RECONCILE_BLEND_FRAMES}. This is the event a player calls
   * "server rollback", and the M10 acceptance gate counts it directly rather than
   * inferring it from a magnitude (`./telemetry` `visualSnaps`).
   */
  snapped: boolean;
}

/** How to stand up a predicted match. */
export interface PredictedMatchConfig {
  /** The client's world, built from `matchStart`'s arguments — the same call
   *  the server made (GDD §4.2). */
  readonly world: World;
  /** The slot this client is flying: the one ship it may predict. */
  readonly localPlayer: PlayerId;
  /** Fixed timestep. Default the sim's canonical 60 Hz tick (GDD §4.1). */
  readonly dt?: number;
  /** Default {@link MAX_PENDING_INPUTS}. */
  readonly maxPending?: number;
}

// ---------------------------------------------------------------------------
// The predicted match
// ---------------------------------------------------------------------------

export class PredictedMatch {
  /** The world the renderer draws: predicted forward of the last snapshot. */
  readonly world: World;

  private readonly local: PlayerId;
  private readonly dt: number;
  private readonly maxPending: number;

  private readonly queue: PendingInput[] = [];
  private readonly history: Checkpoint[] = [];

  private snapshotTick: Tick = -1;
  private error = 0;
  /** Ticks the client may run ahead of authority before the oldest pending inputs
   *  are dropped. Opens at the ceiling and is narrowed from measured RTT by the
   *  session ({@link setLeadBudget}). */
  private lead_budget = MAX_LEAD_TICKS;
  private readonly offset: Vec2 = { x: 0, y: 0 };
  /** Predicted orders awaiting authority's word, and their TTL clock — the whole
   *  of "one entity, never two" for anything the wheel buys (`./order-ledger`). */
  private readonly ledger = new OrderLedger();
  /** What the player did and what authority said about it, for the pasted log
   *  (`./action-journal`, M10 tick-alignment brief item 3). */
  private readonly journal = new ActionJournal();
  /** The other half of "one entity, never two": a predicted turret and the
   *  authoritative turret it becomes are one turret (`./entity-echo`). */
  private readonly structures = new StructureEcho();
  /** Every ship's hull as authority last stated it — the only source there is
   *  ({@link holdHull}). Empty until the first snapshot. */
  private readonly hull = new Map<PlayerId, number>();
  /**
   * The last death authority stated for each ship, and the tick it says that ship
   * comes back ({@link holdLifecycle}).
   *
   * A record is entered on a death and retired when **authority** states the revival
   * that ends it — deliberately *not* when this client's own countdown runs out. The
   * respawn tick is the only thing that can put a replay back on authority's
   * revival, and a reconcile keeps rewinding to ticks before that deadline for a
   * whole round trip after the ship has already launched: snapshots are 30 Hz and
   * describe a tick the client passed `lead` ticks ago, so a client that threw the
   * deadline away the moment it fired revived the ship at the first replayed tick
   * instead, from home, while authority still had it lying at the death site. That is
   * a 15-unit correction that repeats every reconcile for a round trip — the small,
   * *surviving* half of the t=63 s signature.
   */
  private readonly lifecycle = new Map<PlayerId, ShipLifecycleData>();
  /**
   * The tick authority last stated a revival at, per ship — the guard that stops a
   * snapshot describing an *earlier* tick from digging the ship up again.
   *
   * Snapshots are 30 Hz and a round trip behind, so at the instant authority revives
   * a ship there are still frames in flight describing ticks when it was dead. Their
   * `alive` bit is perfectly honest about the tick they describe and says nothing
   * about now, and building a fresh five-second countdown out of one would bury a
   * ship that had just launched.
   */
  private readonly revivedAt = new Map<PlayerId, Tick>();
  /** The newest authoritative wallet the server has volunteered, waiting for the
   *  reconcile of its own tick (`./transport` EconomyMessage). */
  private staged: { tick: Tick; economy: PlayerEconomy } | null = null;
  /**
   * The local hold and bank at the end of every **predicted** tick — the player's
   * own timeline of their wallet, and the ruler authority's word is measured
   * against ({@link settleWallet}).
   *
   * Written by {@link predict} and by nothing else. The replay deliberately does
   * not append to it: a replayed tick re-derives movement this trail already
   * records, and letting it write would make the ruler grow every time it was
   * read. {@link history} cannot serve here for exactly that reason — it is
   * cleared and rebuilt by every rewind.
   */
  private readonly wallet: { tick: Tick; cargo: number; banked: number }[] = [];
  /**
   * What each outstanding predicted order actually took out of the wallet — the
   * receipt a rollback hands back (a0-52; see {@link applyOrderOutcome}).
   *
   * Keyed by `OrderId` and populated from the sim's own ore journal on the tick
   * the order was predicted (`src/sim/ore-journal`), so the hold/bank split is
   * the one `spendOre` really drew rather than a guess made here. Entries are
   * removed the moment the order settles either way; the map is bounded by the
   * ledger's TTL, which retires every record it holds.
   */
  private readonly receipts = new Map<number, { cargo: number; banked: number; tick: Tick }>();
  /** Whether authority has ever stated this seat's wallet. Until it has, the wallet
   *  is prediction's outright — the offline/loopback shape, where the sim the client
   *  is running IS authority ({@link holdInflow}). */
  private heard = false;

  constructor(config: PredictedMatchConfig) {
    this.world = config.world;
    this.local = config.localPlayer;
    this.dt = config.dt ?? TICK_DT;
    this.maxPending = config.maxPending ?? MAX_PENDING_INPUTS;
    this.checkpoint();
    this.markWallet();
  }

  // --- Read-only surface --------------------------------------------------

  /** The tick this client has predicted through — the tick its next input
   *  belongs to, minus one. */
  get tick(): Tick {
    return this.world.tick;
  }

  /** Inputs sent that the server has not said it ran. In steady state this is
   *  the round trip expressed in ticks, and it is exactly what replay costs. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** Unacknowledged input, oldest first — the replay list. */
  get pending(): readonly PendingInput[] {
    return this.queue;
  }

  /** How far prediction was out at the last reconcile, in world units. */
  get lastError(): number {
    return this.error;
  }

  /** Ticks this client is running ahead of the newest snapshot it has applied.
   *  Negative would mean it is behind the server, which reconcile does not
   *  allow to persist. */
  get lead(): number {
    return this.snapshotTick < 0 ? 0 : this.world.tick - this.snapshotTick;
  }

  /** Tick of the newest snapshot applied, or -1 before the first one. */
  get lastSnapshotTick(): Tick {
    return this.snapshotTick;
  }

  /** The current lead budget, in ticks (`MAX_LEAD_TICKS` until measured). */
  get leadBudget(): number {
    return this.lead_budget;
  }

  /**
   * Size the lead budget from a measured round trip.
   *
   * The client must hold enough input in flight to cover one round trip plus the
   * wire's wobble — that is what makes an input arrive *just* before the tick it
   * is stamped for. Anything past that is not headroom, it is latency the player
   * pays on their own trigger. So the budget is `RTT + 2 × jitter` in ticks with a
   * couple of ticks of margin, clamped into
   * `[MIN_LEAD_TICKS, MAX_LEAD_TICKS]`, and everything older is dropped at the next
   * reconcile.
   */
  setLeadBudget(rttMs: number | null, jitterMs: number | null): number {
    if (rttMs === null) return this.lead_budget;
    const ticks = Math.ceil((rttMs + 2 * (jitterMs ?? 0)) / (this.dt * 1000)) + 2;
    this.lead_budget = Math.max(MIN_LEAD_TICKS, Math.min(MAX_LEAD_TICKS, ticks));
    return this.lead_budget;
  }

  /**
   * Visual-only displacement the renderer adds to the local ship, decaying to
   * zero over a few frames. The world is already correct; this is the picture
   * agreeing with it politely instead of teleporting.
   */
  get renderOffset(): Vec2 {
    return this.offset;
  }

  // --- Predict ------------------------------------------------------------

  /**
   * Run one tick locally on this client's own input, and remember it.
   *
   * Called once per fixed tick, immediately after the same actions go out on the
   * wire. Only the local slot is fed: the client has no idea what anyone else
   * pressed this tick, and inventing an answer would be worse than the truth
   * (every other ship coasts on its last known velocity until the next snapshot,
   * 2 ticks away).
   */
  predict(seq: number, actions: readonly Action[]): Tick {
    const tick = this.world.tick + 1;
    this.queue.push({ seq, tick, actions });
    // A client whose acks have stopped arriving is not lagging, it has dropped;
    // the seat is a bot's until it reclaims (GDD §4.2). Bound the buffer rather
    // than replay a minute of history when it comes back.
    while (this.queue.length > this.maxPending) this.queue.shift();

    // A one-shot order is predicted exactly once, here, on the tick it was
    // pressed — and its local side effect is entered in the ledger so authority's
    // echo has something to be *about* (`./order-ledger`).
    const orders = identifiedOrders(actions);
    const before = orders.length > 0 ? buildIdsOf(stationOf(this.world, this.local)) : null;
    // The weapon's own clock, read either side of the step. It only ever counts
    // *down* (`src/sim/step.ts`) except on the tick a shot leaves the barrel, when
    // it is re-armed to the fire interval — so a cooldown that went *up* is a shot,
    // exactly, and it is the only evidence of one this client will ever have (the
    // firer's own shots are drawn from prediction, never from the wire —
    // {@link harvestOwnShots}).
    const cooldownBefore = this.localShip()?.weaponCooldown ?? 0;
    // The hold as this tick found it: what a predicted tick may take out of it is
    // the player's own business, what it puts in is authority's ({@link holdInflow}).
    const holdBefore = this.localShip()?.cargo ?? null;
    // How much of the sim's ore journal predates this tick, so the spend this tick
    // makes can be read back off it ({@link receipts}, a0-52).
    const journalBefore = orders.length > 0 ? (this.world.oreJournal?.events.length ?? 0) : 0;

    step(this.world, [{ id: this.local, actions }], this.dt);
    if (orders.length > 0) this.takeReceipts(orders, journalBefore, tick);

    this.holdInflow(holdBefore);
    if ((this.localShip()?.weaponCooldown ?? 0) > cooldownBefore) {
      this.journal.record({ kind: 'volley', tick, inFlight: this.ownShotCount() });
    }
    for (const order of orders) {
      this.journal.record({
        kind: 'order',
        tick,
        orderId: order.orderId,
        verb: order.verb,
        what: order.what,
      });
    }
    if (before) this.ledgeOrders(orders, before, tick);
    this.holdHull();
    this.holdLifecycle();
    this.checkpoint();
    // The one place the player's own wallet timeline is written down: this tick
    // mined, banked or spent, and the trail is what lets the next reconcile add
    // that movement back on top of authority's figure ({@link settleWallet}).
    this.markWallet();
    this.decayOffset();
    return tick;
  }

  // --- Orders -------------------------------------------------------------

  /** The outstanding predicted orders and their TTL clock (`./order-ledger`). */
  get orders(): OrderLedger {
    return this.ledger;
  }

  /**
   * Take authority's word on one order and put the predicted world in line with it
   * (`./transport` OrderEchoMessage). Returns what was done, or null when the id is
   * not one this client is waiting on.
   */
  settleOrder(echo: OrderEcho): OrderOutcome | null {
    const outcome = this.ledger.settle(echo);
    this.journal.record({
      kind: 'echo',
      tick: this.world.tick,
      orderId: echo.orderId,
      outcome: outcome === null ? 'unknown' : outcome.kind === 'adopt' ? 'adopt' : 'refused',
      waited: outcome === null ? null : this.world.tick - outcome.order.tick,
    });
    if (outcome) this.applyOrderOutcome(outcome);
    return outcome;
  }

  /** What the player did and what authority said about it, since the last drain
   *  (`./action-journal`). Read by the playtest log; empty offline. */
  get actions(): ActionJournal {
    return this.journal;
  }

  /**
   * Enter this tick's identified orders in the ledger, each with the build job the
   * local sim just gave it — the handle a rollback removes and an adoption rewrites.
   *
   * Two orders on one tick are attributed in creation order, which is the sim's own
   * order (`placeOrder` pushes as it validates), so the pairing is exact rather than
   * heuristic.
   */
  private ledgeOrders(orders: readonly IdentifiedOrder[], before: readonly number[], tick: Tick): void {
    const station = stationOf(this.world, this.local);
    const after = station?.builds ?? [];
    let next = 0;
    for (const order of orders) {
      this.ledger.record(order.orderId, order.verb, order.what, tick);
      while (next < after.length && before.includes(after[next]!.id)) next++;
      if (next < after.length) this.ledger.attachBuild(order.orderId, after[next++]!.id);
    }
  }

  /**
   * File what this tick's orders actually cost, from the sim's own ore journal
   * (`src/sim/ore-journal`) — the receipt {@link applyOrderOutcome} hands back
   * when authority refuses the order (a0-52).
   *
   * **Only the unambiguous case is filed**, and that is deliberate. The journal
   * lists every ore movement of the tick — a chunk arriving, the atmosphere drain,
   * each spend — and pairing several spends to several orders on one tick would be
   * a heuristic. A tick carries one order in practice (`predict`'s callers mint one
   * id per press, and the two order screens are one press each), so exactly one
   * order plus exactly one spend is attributed and anything else is left alone: the
   * order still rolls back, it simply refunds nothing, which is today's behaviour
   * and no worse than it.
   *
   * The journal is READ, never drained — the playtest log drains it
   * (`./playtest-log-attach`), and two readers racing over one ring would leave
   * each of them with half a match.
   */
  private takeReceipts(orders: readonly IdentifiedOrder[], from: number, tick: Tick): void {
    const events = this.world.oreJournal?.events;
    if (!events || orders.length !== 1) return;
    // Two guards, and each covers the other's blind spot. The INDEX says "appended
    // by the step just run" — but the journal is a bounded ring, and a session with
    // nothing draining it (no playtest log attached) sits at capacity, where an
    // append evicts and the length does not move. `Math.min` turns that into an
    // empty scan rather than a read of somebody else's events. The TICK then says
    // "and it is this tick's", which is what stops a clock pulled backwards by
    // `trimLead` from re-using a tick number and collecting a stale receipt.
    // Failing either way costs the refund, never pays a wrong one — the only
    // direction this may fail in, since a refund that fires twice is free ore.
    let spend: { hold: number; bank: number; holdAfter: number; bankAfter: number } | null = null;
    for (let i = Math.min(from, events.length); i < events.length; i++) {
      const e = events[i]!;
      if (e.flow !== 'spent' || e.player !== this.local || e.tick !== this.world.tick) continue;
      if (spend) return; // two spends on one tick: ambiguous, so nothing is filed
      spend = e;
    }
    if (!spend) return; // refused locally, or an order that spends nothing (BANK)
    this.receipts.set(orders[0]!.orderId, {
      cargo: spend.hold - spend.holdAfter,
      banked: spend.bank - spend.bankAfter,
      tick,
    });
    // Bounded like every other buffer here. The ledger settles or sweeps every
    // record it opens, so this should never bind; it is the backstop that keeps a
    // long match from paying for an id that somehow never came back.
    while (this.receipts.size > MAX_OPEN_RECEIPTS) {
      const oldest = this.receipts.keys().next();
      if (oldest.done) break;
      this.receipts.delete(oldest.value);
    }
  }

  /**
   * Give a refused order's price back — **a rollback that takes the turret away
   * has to give the ore back with it** (a0-52).
   *
   * The rollback below already removes the half-built ghost, which is the visible
   * half of the truth arriving late. The wallet was the invisible half, and it was
   * missing: `spendOre` had charged this client on the tick of the press, and
   * nothing ever put it back. Authority does not close the gap on its own, because
   * a refused order does not move the server's wallet and *"a wallet that has not
   * moved sends nothing"* (`server/room.ts` `syncEconomy`) — so the client sat on a
   * balance short by the price of a thing it never got, until the player happened
   * to mine again. On a wallet that was already too thin to buy the turret, that is
   * a build wheel that goes on refusing purchases the player can actually afford.
   *
   * Two writes, and both are needed:
   *
   *  - **the ship**, so the number on screen is right now rather than eventually;
   *  - **the trail** ({@link wallet}), by the same delta and from the order's own
   *    tick, so the refunded price stops reading as outflow. Without this second
   *    write the very next statement stamped *before* the press would subtract the
   *    refund straight back out ({@link outflowSince}) and the ore would vanish a
   *    second time, which is the compounding {@link rebaseWallet} exists to stop.
   *
   * The hold is refilled only to its cap and the remainder goes to the bank: the
   * ore is the player's either way, and a hold that has taken on a chunk since the
   * press has no room for a full refund. Authority's next statement settles the
   * split for good.
   */
  private refund(orderId: number): void {
    const receipt = this.receipts.get(orderId);
    this.receipts.delete(orderId);
    if (!receipt) return;
    const ship = this.localShip();
    if (!ship) return;
    const toHold = Math.max(0, Math.min(receipt.cargo, ship.cargoCap - ship.cargo));
    const toBank = receipt.cargo - toHold + receipt.banked;
    ship.cargo += toHold;
    ship.banked += toBank;
    this.rebaseWallet(receipt.tick, toHold, toBank);
  }

  /**
   * Make the predicted world agree with one settled order.
   *
   *  - **adopt** — the predicted build job *becomes* authority's: it takes the
   *    authoritative id and, more importantly, the authoritative construction
   *    clock, wound forward by however far this client is running ahead of the tick
   *    the echo was read at. That is what makes an online turret take the sim's real
   *    ten seconds (GDD §2.5) instead of finishing one round trip early — and it is
   *    the same job, so it is never two turrets. An accepted order this client did
   *    *not* predict (it refused the press locally, on a wallet a snapshot has since
   *    corrected) gains authority's job outright: the ore was spent, so the player
   *    gets the thing.
   *  - **rollback** — the prediction is taken back, visibly. The half-built ghost
   *    the player was watching disappears, which is the truth arriving late.
   */
  private applyOrderOutcome(outcome: OrderOutcome): void {
    const station = stationOf(this.world, this.local);
    if (!station) return;
    const predicted = outcome.order.buildId;

    if (outcome.kind === 'rollback') {
      if (predicted !== null) removeBuild(station, predicted);
      // …and the price with it: the ore bought nothing, so it comes back
      // ({@link refund}).
      this.refund(outcome.order.orderId);
      return;
    }

    // Adopted: the order really was paid for, so the receipt is retired unspent.
    this.receipts.delete(outcome.order.orderId);
    const build = outcome.echo.build;
    if (!build) return; // an accepted order that spawns nothing — nothing to align
    const kind = buildKindOf(outcome.order.what);
    if (!kind) return; // an echo naming a job for an item that queues none
    // Authority read `remaining` at `echo.tick`; this client is `lead` ticks past
    // that and has already run those ticks of construction, so the clock is wound
    // forward by exactly that much. Never past completion: the entity event for the
    // finished thing is what completes it, and finishing early is the bug.
    const lead = Math.max(0, this.world.tick - outcome.echo.tick);
    const remaining = Math.max(0, build.remaining - lead * this.dt);
    const ghost = predicted === null ? undefined : station.builds.find((j) => j.id === predicted);
    // The mount the local sim reserved, kept: it is where the client has been
    // drawing the half-built turret, and moving it now would be a visible jump for
    // no gain (the ring is the same ring on both sides — the sim picks the lowest
    // free slot from the same rules).
    const slot = ghost?.slot ?? 0;
    if (predicted !== null) removeBuild(station, predicted);
    if (station.builds.some((j) => j.id === build.id)) return;
    station.builds.push({ id: build.id, kind, slot, remaining, total: build.total });
  }

  // --- Reconcile ----------------------------------------------------------

  /**
   * Take one authoritative snapshot and put the predicted world back on top of
   * it: rewind, overwrite, retire what the server has run, replay the rest.
   *
   * @param snapshot the decoded snapshot (`./snapshot`).
   * @param ackSeq   the newest local input the server has **simulated** — not
   *                 merely received (`./input-queue`, `server/room.ts`).
   * @param ackTick  the tick that input was simulated *at*, when the server states
   *                 one (`./transport` `SnapshotMessage.ackTick`). Compared against
   *                 the tick this client predicted the same input at to produce
   *                 {@link ReconcileReport.appliedDelta}; omitted, the report says
   *                 null and the alignment instrument simply has nothing to add.
   */
  reconcile(snapshot: DecodedSnapshot, ackSeq: number, ackTick?: Tick): ReconcileReport {
    // Snapshots are full state, not deltas, so an older one has nothing to add —
    // and applying it would drag the world backwards (docs/netcode-spike.md).
    if (snapshot.tick <= this.snapshotTick) {
      return {
        applied: false,
        error: this.error,
        replayed: 0,
        acknowledged: 0,
        trimmed: 0,
        resynced: false,
        snapped: false,
        appliedDelta: null,
      };
    }
    this.snapshotTick = snapshot.tick;

    // A copy, not the live vector: `absorb` measures how far this reconcile
    // moved the ship, and the ship is about to move.
    const before = { ...this.localShipPos() };
    const tickBefore = this.world.tick;
    // The firer's own shots are the client's to draw, so they are lifted out
    // before authority flattens the pool and put back after the replay
    // (`settleShots`, audit item 2b).
    const carried = this.harvestOwnShots();
    // Every hold and bank as the *player's own timeline* left them, read before the
    // replay runs: the wallet is restored from these afterwards, and the hold is
    // also the ledger behind the conserved courier telegraph
    // ({@link FrozenClocks.hold}, {@link settleWallet}).
    const hold = this.world.ships.map((ship) => ship.cargo);
    const bank = this.world.ships.map((ship) => ship.banked);
    const checkpoint = this.rewind(snapshot.tick);
    const authoritative = snapshot.ships.find((s) => s.id === this.local);
    this.error =
      checkpoint && authoritative
        ? Math.hypot(checkpoint.x - authoritative.posX, checkpoint.y - authoritative.posY)
        : 0;

    const wireSlots = applySnapshot(this.world, snapshot, { suppressShipShotsFrom: this.local });
    // Who authority currently has dead, read off the same flag bits — the backstop
    // under the lifecycle event channel ({@link readLifecycle}).
    this.readLifecycle(snapshot);
    // The respawn countdown as it stood *at the tick the world was just rewound to*,
    // so the replay below revives a corpse on authority's tick rather than on its
    // first replayed one ({@link seedRespawnClocks}).
    this.seedRespawnClocks(snapshot.tick);

    // Read *before* the retire below throws the acked inputs away: the tick this
    // client predicted `ackSeq` at is in that queue and nowhere else.
    const appliedDelta = this.alignmentOf(ackSeq, ackTick);
    const acknowledged = this.retire(ackSeq);
    // Pull the clock back if a stall pushed it too far ahead. Done *before* the
    // replay, so the world lands at `snapshotTick + leadBudget` at worst and the
    // next input is stamped for a tick the server will reach promptly.
    const trimmed = this.trimLead();
    // The construction and repair clocks as they stood before any of this — put
    // back after the replay, because a replay must not spend them twice
    // ({@link freezeClocks}).
    const clocks = freezeClocks(this.world, hold);
    const clocksAt = tickBefore;
    for (const input of this.queue) {
      // **A one-shot order is never replayed.** The rewind puts the world's
      // *clock* back — tick, time, RNG, entity counter — but it cannot put a
      // structure back: `station.builds` is not in the checkpoint, and could not
      // be without copying the whole world every tick. So the build job an order
      // created before this reconcile is still standing when the replay reaches
      // that same order, and running it again queues a second one. At 30 Hz
      // snapshots and 150 ms RTT an unacknowledged tap is replayed four or five
      // times before its ack lands — which is the client-side half of *"I built 2
      // but 3 got built"*, and it is charged for every time.
      //
      // Replay exists to put the ship back where the player's hands have taken it.
      // Thrust, aim and fire are the only verbs that answer that question; an order
      // is a *fact already established*, owned from here on by the ledger and
      // authority's echo of it (`./order-ledger`).
      step(this.world, [{ id: this.local, actions: withoutOrders(input.actions) }], this.dt);
      this.checkpoint();
    }
    // The wallet, before the chunk field it is paid from is put back: the replay's
    // holds are discarded and authority's word is re-anchored onto the player's own
    // timeline ({@link settleWallet}). Ahead of `thawClocks` because the courier
    // debt is measured against the hold this leaves behind ({@link depositDebt}).
    this.settleWallet(hold, bank, snapshot.tick);
    // Put the construction and repair clocks back where the replay found them,
    // moved on by the *net* time this reconcile actually advanced the world — which
    // in a steady state is nothing at all.
    thawClocks(this.world, clocks, (this.world.tick - clocksAt) * this.dt);
    // Anything predicted long enough ago that authority should have answered by now
    // and did not — the order never arrived, or its echo never came back. Rolled
    // back, so a dropped press cannot leave a phantom assembling forever.
    for (const outcome of this.ledger.sweep(this.world.tick)) {
      // A prediction authority never answered at all. One is a lost message; a run
      // of them is a wire that is not carrying orders, and either way the player
      // watched a half-built ghost disappear.
      this.journal.record({
        kind: 'expiry',
        tick: this.world.tick,
        orderId: outcome.order.orderId,
        what: outcome.order.what,
        waited: this.world.tick - outcome.order.tick,
      });
      this.applyOrderOutcome(outcome);
    }

    // Remote firing is the one thing the replay cannot produce: a ship the
    // client has no input for never fires, so the flag on the wire is the only
    // evidence its trigger is down. Painted after the replay, because `step()`
    // clears it every tick (`src/sim/step.ts`).
    paintRemoteFiring(this.world, snapshot, this.local);
    // Hull is authority's, and the replay just ran a whole world's worth of
    // collisions over it. Put authority's numbers back ({@link holdHull}).
    this.readHull(snapshot);
    this.holdHull();
    // …and so is death. The replay just ran `respawnTimer -= dt` once per pending
    // input over a countdown it has already spent, so a corpse the replay revived
    // is put back in the ground here, on authority's clock ({@link holdLifecycle}).
    this.holdLifecycle();
    this.settleShots(wireSlots, carried);

    const snapped = this.absorb(before);
    return {
      applied: true,
      error: this.error,
      replayed: this.queue.length,
      acknowledged,
      trimmed,
      resynced: checkpoint === null,
      snapped,
      appliedDelta,
    };
  }

  /**
   * Apply one static-entity event to the predicted world (`./entity-events`).
   *
   * With one step in front of it: a structure this client predicted into existence
   * steps aside for the authoritative one the moment authority names it, so a tap
   * that bought one turret leaves one turret standing and not two (`./entity-echo`).
   */
  applyEvent(message: EntityEventMessage): boolean {
    // A ship's death or respawn is not a structure and has no echo to reconcile —
    // it is authority stating a lifecycle, and it is held from here on
    // ({@link holdLifecycle}).
    if (message.kind === 'ship') return this.applyLifecycle(message);
    this.structures.reconcileSpawn(this.world, message);
    return applyEntityEvent(this.world, message);
  }

  /** True while this ship is dead — the client is showing a death and running a
   *  respawn countdown for it, and is predicting nothing on its behalf. Read off the
   *  world, which the lifecycle wire is what keeps honest ({@link holdLifecycle}). */
  isDead(player: PlayerId): boolean {
    const ship = this.shipOf(player);
    return ship ? !ship.alive : false;
  }

  /**
   * Seconds left on a ship's respawn countdown as authority stated it, or null when
   * that ship is not on a countdown (it is flying, or it was eliminated and is not
   * coming back). This is the number the death presentation counts down — the same
   * `Ship.respawnTimer` an offline match shows, sourced from authority instead of
   * from a local guess (GDD §2.7, §2.4 parity).
   */
  respawnIn(player: PlayerId): number | null {
    const ship = this.shipOf(player);
    if (!ship || ship.alive) return null;
    const record = this.lifecycle.get(player);
    if (!record || record.eliminated || record.respawnTick < 0) return null;
    return respawnCountdown(record, this.world.tick, this.dt);
  }

  /** The structure-echo bookkeeping — which ids authority has named so far. */
  get structureEcho(): StructureEcho {
    return this.structures;
  }

  // --- The wallet ---------------------------------------------------------

  /**
   * Take authority's word on the local wallet as of `tick`, to be written into the
   * world at the reconcile for that tick (`./transport` EconomyMessage).
   *
   * Staged rather than applied on arrival, because *when* it lands decides whether
   * the player's own unacked mining survives. The server sends it immediately ahead
   * of the snapshot for the same tick, so by the time that snapshot is reconciled
   * the wallet for that exact tick is already here — and a statement about tick `T`
   * is only meaningful against what this client's own timeline held at `T`
   * ({@link settleWallet}). Applying it on arrival instead would stamp a wallet from
   * tick `T` onto a world predicted to `T + RTT` and drop that window's earnings on
   * every snapshot.
   *
   * A wallet for a tick the client has already reconciled past is applied at the
   * next reconcile (the newest word always wins; the ticks between are replayed
   * over it). Only the newest staged wallet is kept — this is full state, not a
   * diff, so an older one has nothing left to say.
   */
  stageEconomy(economy: PlayerEconomy, tick: Tick): void {
    // From the first statement on, this seat's hold fills on authority's word rather
    // than on a local guess ({@link holdInflow}).
    this.heard = true;
    if (this.staged && this.staged.tick > tick) return;
    this.staged = { tick, economy };
  }

  /** Tick of the wallet waiting to be applied, or -1 when none is — the read that
   *  makes "staged, not stamped" observable to a test. */
  get stagedEconomyTick(): Tick {
    return this.staged?.tick ?? -1;
  }

  // --- Internals ----------------------------------------------------------

  /**
   * Settle the wallet after a replay — **the hold the player reads has one owner.**
   *
   * *"Picked up ore, the HUD flashed a FULL hold, then corrected to the real
   * amount."* Held ore was flapping between two writers, the same fault the hull
   * had (M10 {@link holdHull}) with the sign reversed: instead of a bar popping
   * back up, a hold that climbed to the cap and stayed there.
   *
   * The mechanism is the chunk field. A rewind restores the world's *scalars*; it
   * does not restore `world.chunks`, and `thawClocks` deliberately puts the chunk
   * field back exactly as the replay found it ({@link FrozenClocks.chunks}) — so a
   * chunk the replay tractors into the hold is *returned to the field afterwards*
   * while the ore it paid stays in `cargo`. Every reconcile re-loots the same
   * restored chunk, and at 150 ms there are five a snapshot: a single 1-ore chunk
   * measured **2.0 in a 2-slot hold within two frames**, pinned at the cap until
   * authority's own statement finally arrived to drag it back down. That drop is
   * the "correction" the developer watched, and it is also, from the seat of a
   * player who has just banked, ore that visibly went missing.
   *
   * So the hold and the chunk field are treated as the one accounting system they
   * are: **whatever the reconcile does to the chunks, it does to the wallet.** The
   * replay's wallet work is discarded wholesale, exactly as its chunk work is —
   * sound for the same reason {@link settleShots} gives, since every tick a replay
   * re-runs was predicted once already and its earnings are in `hold`/`bank`
   * already. What is left is one writer per source:
   *
   *  - **the player's own predicted ticks** move the wallet, so a pickup shows the
   *    instant the tractor closes and the deposit telegraph keeps its beat;
   *  - **authority's word** re-anchors it — `authority's figure at tick T` plus
   *    `whatever this client's own timeline has done since T` ({@link wallet}),
   *    which is nothing at all when the two agree, and exactly the disagreement
   *    when they do not.
   *
   * Nothing races, so the number only moves when the player earns or spends, or
   * when the server says something new. The trail is rebased by the same
   * correction, or the next statement would charge for this one twice.
   */
  private settleWallet(hold: readonly number[], bank: readonly number[], tick: Tick): void {
    for (let i = 0; i < this.world.ships.length; i++) {
      const ship = this.world.ships[i]!;
      const cargo = hold[i];
      const banked = bank[i];
      if (cargo !== undefined) ship.cargo = cargo;
      if (banked !== undefined) ship.banked = banked;
    }
    if (!this.staged || this.staged.tick > tick) return;
    const { economy, tick: at } = this.staged;
    this.staged = null;

    const ship = this.shipOf(this.local);
    // The player's own timeline as it stands right now, read before authority's
    // figure is written over it.
    const mine = ship ? { cargo: ship.cargo, banked: ship.banked } : null;
    // Tiers (and the ceilings they scale) are authority's outright — there is no
    // "since then" to preserve on a number the player buys once.
    applyPlayerEconomy(this.world, this.local, economy);
    if (!ship || !mine) return;
    const spent = this.outflowSince(at);
    if (!spent) return; // a statement older than the trail: take it exactly as read

    // Held: authority's level, less what has left the hold since — never plus what
    // arrived, which is authority's to state ({@link holdInflow}).
    const held = Math.min(Math.max(economy.held - spent.cargo, 0), ship.cargoCap);
    // Banked: every direction of it is the player's own — the drain fills it and an
    // order empties it, and both run a lead ahead of the tick being stated.
    const safe = Math.max(economy.banked + spent.banked, 0);
    this.rebaseWallet(at, held - mine.cargo, safe - mine.banked);
    ship.cargo = held;
    ship.banked = safe;
  }

  /**
   * What this client's own timeline has done to the local wallet since `tick`:
   * `cargo` is the ore that has **left** the hold (the drain, an order's price —
   * inflow is not counted, see {@link settleWallet}), `banked` is the net movement
   * of the bank in either direction.
   *
   * Null when the trail does not reach back to `tick` at all, which is a statement
   * this client can no longer place against its own history — the caller then takes
   * authority's figure outright rather than measure against a ruler that starts in
   * the wrong place.
   */
  private outflowSince(tick: Tick): { cargo: number; banked: number } | null {
    let from = -1;
    for (let i = 0; i < this.wallet.length; i++) {
      const entry = this.wallet[i]!;
      if (entry.tick <= tick && (from < 0 || entry.tick > this.wallet[from]!.tick)) from = i;
    }
    if (from < 0) return null;
    let cargo = 0;
    for (let i = from + 1; i < this.wallet.length; i++) {
      cargo += Math.max(0, this.wallet[i - 1]!.cargo - this.wallet[i]!.cargo);
    }
    const first = this.wallet[from]!;
    const last = this.wallet[this.wallet.length - 1]!;
    return { cargo, banked: last.banked - first.banked };
  }

  /**
   * Undo the ore a predicted tick tractored into the local hold — **what enters
   * the hold is authority's to say.**
   *
   * This is not the usual "the client is a round trip ahead" trade, and that is the
   * whole reason it can be given away for free. The chunk field is deliberately
   * lifted out of the rewind and put back exactly as the replay found it
   * ({@link FrozenClocks.chunks}, the M10 courier fix), so it advances one tick per
   * *predicted* tick and no faster — the client's chunks and authority's chunks
   * drift along the same clock, and the two sides collect the same chunk at very
   * nearly the same moment. Predicting the pickup therefore wins the player almost
   * nothing, while paying for it twice: with the tick of slop in either direction
   * the geometry allows, a client that collects **early** double-counts when
   * authority's statement lands on top, and a client that collects **late** adds a
   * unit authority already counted — and, since a wallet that has not moved sends
   * nothing (`server/room.ts` `syncEconomy`), *nothing ever comes to correct it*.
   * That is the developer's FULL hold: a 1-ore chunk reading 2.0 in a 2-slot hold.
   *
   * Ore leaving the hold is the opposite case and stays predicted: the atmosphere
   * drain runs on the ship's own position and an order's price is paid on the
   * player's own thumb, both a lead ahead of the tick authority is describing. Those
   * must show at once or the banking beat and the build wheel go dead
   * ({@link settleWallet}).
   *
   * Only while authority is actually speaking about the wallet. A transport that
   * never states one is a transport where prediction *is* authority (offline, and
   * the loopback the parity tests run), and there the hold is the client's alone.
   */
  private holdInflow(before: number | null): void {
    if (!this.heard || before === null) return;
    const ship = this.localShip();
    if (ship && ship.cargo > before) ship.cargo = before;
  }

  /** Append this predicted tick's wallet to the trail, bounded like the input
   *  queue it is read against ({@link wallet}). */
  private markWallet(): void {
    const ship = this.localShip();
    if (!ship) return;
    this.wallet.push({ tick: this.world.tick, cargo: ship.cargo, banked: ship.banked });
    while (this.wallet.length > this.maxPending + 1) this.wallet.shift();
  }

  /**
   * Re-base the trail onto the timeline a correction just created: entries from
   * `tick` on are shifted by the correction, older ones are dropped.
   *
   * Without this the ruler and the world would disagree by exactly the correction,
   * and the *next* statement would re-apply it as if it were the player's own
   * earnings — one nudge compounding into a drift, which is the class of bug this
   * whole path exists to end.
   */
  private rebaseWallet(tick: Tick, cargo: number, banked: number): void {
    for (let i = this.wallet.length - 1; i >= 0; i--) {
      const entry = this.wallet[i]!;
      if (entry.tick < tick) {
        this.wallet.splice(i, 1);
        continue;
      }
      entry.cargo += cargo;
      entry.banked += banked;
    }
  }

  /**
   * Put the world's clock back to `tick` and return the checkpoint it was
   * restored from, or null when there is nothing to restore from — a snapshot
   * older than this client's history, or newer than anything it has predicted
   * (a join mid-match, or a tab that was asleep). In that case the clock is set
   * to the snapshot's tick outright and every pending input is abandoned: they
   * describe a timeline that no longer exists.
   */
  private rewind(tick: Tick): Checkpoint | null {
    const found = this.history.find((c) => c.tick === tick) ?? null;
    if (found) {
      this.world.tick = found.tick;
      this.world.time = found.time;
      this.world.rngState = found.rngState;
      this.world.nextEntityId = found.nextEntityId;
    } else {
      this.world.tick = tick;
      this.world.time = tick * this.dt;
      this.queue.length = 0;
    }
    this.history.length = 0;
    return found;
  }

  /**
   * Drop the oldest pending inputs beyond the lead budget, and report how many.
   *
   * These are inputs the client sent, the server has not acknowledged, and the
   * client has now decided not to keep waiting on: they are older than one lead
   * budget, which means the server has either already refused them as late or is
   * about to. Keeping them would only hold the clock out where a stall left it.
   *
   * At most {@link MAX_TRIM_PER_RECONCILE} per reconcile — see that constant for
   * why the clock bleeds rather than snaps back.
   */
  private trimLead(): number {
    let dropped = 0;
    while (this.queue.length > this.lead_budget && dropped < MAX_TRIM_PER_RECONCILE) {
      this.queue.shift();
      dropped++;
    }
    return dropped;
  }

  /**
   * How far apart the two copies of one input stand, in ticks: the tick authority
   * says it ran `ackSeq` at, minus the tick this client predicted that same seq at.
   *
   * Null when there is nothing to compare — no `ackTick` from the server (a wire
   * older than the field, or an offline transport), an ack for input this client has
   * already retired or trimmed, or the opening snapshots of a match before anything
   * has been acknowledged at all. Null rather than 0, because "aligned" and "not
   * measured" are different findings and the instrument must not average them
   * together ({@link ReconcileReport.appliedDelta}).
   */
  private alignmentOf(ackSeq: number, ackTick: Tick | undefined): number | null {
    if (ackTick === undefined || ackTick <= 0 || ackSeq <= 0) return null;
    for (const input of this.queue) {
      if (input.seq === ackSeq) return ackTick - input.tick;
    }
    return null;
  }

  /** Drop every pending input the server has told us it simulated. */
  private retire(ackSeq: number): number {
    let dropped = 0;
    while (this.queue.length > 0 && this.queue[0]!.seq <= ackSeq) {
      this.queue.shift();
      dropped++;
    }
    return dropped;
  }

  /** Record the world's rewindable scalars for the tick just simulated. */
  private checkpoint(): void {
    const pos = this.localShipPos();
    this.history.push({
      tick: this.world.tick,
      time: this.world.time,
      rngState: this.world.rngState,
      nextEntityId: this.world.nextEntityId,
      x: pos.x,
      y: pos.y,
    });
    while (this.history.length > this.maxPending + 1) this.history.shift();
  }

  /**
   * Turn the displacement a correction just caused into a decaying visual
   * offset — unless it is big enough that it should be seen. Returns whether it
   * was seen: true means the ship teleported on screen this reconcile, which is
   * the counter the acceptance gate is written against (`./telemetry`).
   */
  private absorb(before: Vec2): boolean {
    const after = this.localShipPos();
    const dx = before.x - after.x;
    const dy = before.y - after.y;
    if (Math.hypot(dx, dy) > SNAP_THRESHOLD) {
      this.offset.x = 0;
      this.offset.y = 0;
      return true;
    }
    this.offset.x += dx;
    this.offset.y += dy;
    return false;
  }

  // --- The firer's own shots ------------------------------------------------

  /**
   * Lift the local player's own in-flight ship shots out of the pool before
   * authority flattens it.
   *
   * A shot is spawned the instant the trigger goes down — that is what makes the
   * weapon feel connected — and until this audit it then *died with its own input*:
   * reconciliation clears the pool and only the still-unacknowledged ticks are
   * replayed, so a shot stopped being re-created the moment the server confirmed
   * the tick that fired it. One round trip after firing, the predicted shot
   * vanished and the server's copy of the same shot — a whole RTT behind it, and
   * standing still between snapshots because the wire carries no velocity —
   * appeared in its place. That is the *"jumpy projectiles"* in the field report,
   * seen from the shooting end: not one shot, but two, neither of them right.
   *
   * So the firer's shots become the firer's business. Carried across the
   * reconcile, re-placed afterwards in pool slots the wire cannot name
   * ({@link LOCAL_SHOT_BASE}), they fly their whole life on this client's own
   * physics, and the authoritative copies are suppressed on arrival
   * ({@link applySnapshot} `suppressShipShotsFrom`). Damage stays entirely the
   * server's word — a predicted shot is a picture of a shot.
   */
  private harvestOwnShots(): CarriedShot[] {
    const out: CarriedShot[] = [];
    const seen = new Set<number>();
    for (const p of this.world.projectiles) {
      if (!p.active || p.owner !== this.local || p.kind !== 'ship') continue;
      // A duplicate already standing in the pool must not be re-seeded, or the
      // list carries it forward for the rest of the match.
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({
        id: p.id,
        x: p.pos.x,
        y: p.pos.y,
        vx: p.vel.x,
        vy: p.vel.y,
        damage: p.damage,
        radius: p.radius,
        life: p.life,
        mineYield: p.mineYield,
      });
      if (out.length >= MAX_PREDICTED_SHOTS) break;
    }
    return out;
  }

  /**
   * Decide, once per reconcile, which shots the client is drawing.
   *
   * After the replay the pool holds three kinds of thing: slots authority named,
   * shots the replay itself re-fired (this client's own, and every turret in range
   * of anything — `step()` runs the whole world, so the client fires *everyone's*
   * turrets locally), and nothing else. Only the first is authoritative. The second
   * is a duplicate of a shot already on the wire, drawn a round trip ahead of it,
   * and it is the other half of the field report's jumpiness. So:
   *
   *  - a slot the wire named stays exactly as authority wrote it;
   *  - a locally-spawned shot is dropped — with one exception;
   *  - the exception is the local player's own ship shots, which are re-placed
   *    above {@link LOCAL_SHOT_BASE} where no snapshot can reach them.
   *
   * **A shot the replay fires is always a duplicate, so it is always dropped.**
   *
   * The carry list is *complete* by construction: every tick the replay re-runs was
   * predicted once already ({@link predict} steps before any snapshot for that tick
   * can arrive), so every own shot the replay could possibly produce was produced
   * then and is already carried. Keeping the replay's copy as well was the old rule,
   * guarded by an id match — and the guard leaked, because a rewind restores
   * `nextEntityId` and a re-fired shot can come back numbered differently. Measured
   * before this: five own shots alive on a screen whose sim can hold two, and one id
   * standing in two pool slots at once. The rule is now the simple one, and it needs
   * no id matching at all: **carried in, replayed out.**
   */
  private settleShots(wireSlots: ReadonlySet<number>, carried: readonly CarriedShot[]): void {
    const keep = carried;

    for (let slot = 0; slot < this.world.projectiles.length; slot++) {
      const p = this.world.projectiles[slot]!;
      if (!p.active || wireSlots.has(slot)) continue;
      p.active = false;
    }

    for (let i = 0; i < keep.length && i < MAX_PREDICTED_SHOTS; i++) {
      const shot = keep[i]!;
      if (shot.life <= 0) continue;
      const p = localShotSlot(this.world, LOCAL_SHOT_BASE + i);
      p.id = shot.id;
      p.active = true;
      p.owner = this.local;
      p.kind = 'ship';
      p.pos.x = shot.x;
      p.pos.y = shot.y;
      p.vel.x = shot.vx;
      p.vel.y = shot.vy;
      p.damage = shot.damage;
      p.radius = shot.radius;
      p.life = shot.life;
      if (shot.mineYield !== undefined) p.mineYield = shot.mineYield;
    }
    // Slots past the ones refilled hold last reconcile's shots; a shot that has
    // landed or expired must not linger.
    for (let i = Math.min(keep.length, MAX_PREDICTED_SHOTS); i < MAX_PREDICTED_SHOTS; i++) {
      const p = this.world.projectiles[LOCAL_SHOT_BASE + i];
      if (p) p.active = false;
    }
  }

  // --- Hull is authority's --------------------------------------------------

  /**
   * Take every hull number off the snapshot and remember it.
   *
   * The wire carries one byte of hull per ship every snapshot (`./snapshot`), for
   * *all* eight seats, so this is a complete statement of who is hurt and by how
   * much — there is nothing for a client to add to it.
   */
  private readHull(snapshot: DecodedSnapshot): void {
    for (const snap of snapshot.ships) this.hull.set(snap.id, snap.hull);
  }

  /**
   * **No client ever applies damage to a hull it draws.**
   *
   * *"My health went down then back up after taking damage."* That is prediction
   * doing exactly what it was built to do, on the one quantity it must not touch.
   * `step()` runs the whole world including collisions, so a shot the client can
   * see arriving takes HP off locally the frame it lands. The server then reports
   * the hull it actually has — one round trip *earlier* in the fight, before that
   * shot resolved — and `applySnapshot` writes it back. The bar drops and pops back
   * up, thirty times a second, on every exchange.
   *
   * And it is not a cosmetic disagreement, because the reconcile is *right*: the
   * snapshot is authority and the local guess was a guess. Damage is decided by
   * geometry the client does not have — a remote ship's position is a jitter buffer
   * in the past (`./interpolation`), its shots are drawn from the same buffer, and
   * spawn protection, shields and allegiance are all resolved server-side against
   * state this client only half knows. A hull the client predicts is wrong more
   * often than it is right, and being wrong about HP reads as a lie about the fight.
   *
   * So hull is *held* at authority's last word: written by the snapshot, re-asserted
   * after every predicted tick and after every replay, and never moved by anything
   * local. There is nothing here to blend, which is the point — the bar only ever
   * moves in the direction and by the amount the server says, so it never rewinds
   * and there is no correction for the smoothing rules to hide (the position
   * correction they *do* hide is `renderOffset`, above).
   *
   * A ship the client has never had a snapshot for is left alone: it is holding its
   * spawn hull, which is the right answer until authority speaks.
   */
  private holdHull(): void {
    if (this.hull.size === 0) return;
    for (const ship of this.world.ships) {
      const authoritative = this.hull.get(ship.id);
      if (authoritative !== undefined) ship.hull = authoritative;
    }
  }

  // --- Death is authority's too (M10 lifecycle wire) ------------------------

  /**
   * Take one lifecycle event — a death or a respawn — and enter it in the record
   * that holds it from here on (`./entity-events` {@link ShipLifecycleData}).
   *
   * A **death** stops the ship where it fell and starts the countdown authority is
   * running. A **respawn** retires the record, and from that tick on the ship is an
   * ordinary predicted ship again: the local one resumes prediction from the state
   * the sim's own `respawn()` produced (home, full hull, spawn protection — the same
   * deterministic state authority produced at the same tick), and a remote one goes
   * back to being interpolated off the wire.
   */
  private applyLifecycle(message: EntityEventMessage): boolean {
    const data = message.data as ShipLifecycleData | null;
    if (!data || typeof data.id !== 'number' || typeof data.alive !== 'boolean') return false;
    if (!applyEntityEvent(this.world, message)) return false;
    if (data.alive) {
      this.lifecycle.delete(data.id);
      this.revivedAt.set(data.id, data.tick);
    } else {
      this.lifecycle.set(data.id, data);
    }
    this.holdLifecycle();
    return true;
  }

  /**
   * The backstop under the lifecycle event channel: every ship the snapshot's own
   * `alive` bit says is dead and this client has no death event for.
   *
   * An event can be lost, or simply not have arrived yet, or belong to a death that
   * happened before this client joined — and in every one of those cases the old
   * client revived the ship locally on its next tick, which is the whole bug. The
   * flag bit is on every snapshot, thirty times a second, so it is enough on its own
   * to know *that* a ship is dead; what it cannot say is *when* it comes back, so a
   * record built from it assumes the death was fresh as of this snapshot. That
   * over-estimates the countdown by at most the age of the death when the client
   * first saw it, and the authoritative respawn — event or flag — ends it exactly
   * either way.
   *
   * The bit going *set* is authoritative in the other direction, and retires the
   * record: whatever this client believed about a countdown, the ship is flying.
   */
  private readLifecycle(snapshot: DecodedSnapshot): void {
    const ticks = respawnTicks(RESPAWN_S, this.dt);
    for (const snap of snapshot.ships) {
      if ((snap.flags & SHIP_FLAG.alive) !== 0) {
        // Authority has it flying as of this tick, so any death it describes is over.
        // Guarded on the death's own tick all the same: a record newer than the frame
        // in hand is news the frame cannot contradict.
        const record = this.lifecycle.get(snap.id);
        if (record && record.tick <= snapshot.tick) this.lifecycle.delete(snap.id);
        this.revivedAt.set(snap.id, Math.max(this.revivedAt.get(snap.id) ?? -1, snapshot.tick));
        continue;
      }
      // A record this frame cannot contradict: it is counting down toward a revival
      // the frame is older than, and an elimination has no deadline to outlive at all.
      // Past that deadline with the ship *still* dead, the revival never happened —
      // the news was lost, or a second death landed on the same slot — and this frame
      // is the freshest word there is, so the record is rebuilt from it.
      const record = this.lifecycle.get(snap.id);
      if (record && (record.eliminated || snapshot.tick <= record.respawnTick)) continue;
      // A frame from before a revival this client has already seen. It is telling
      // the truth about its own tick and nothing about now ({@link revivedAt}).
      if ((this.revivedAt.get(snap.id) ?? -1) >= snapshot.tick) continue;
      const eliminated = (snap.flags & SHIP_FLAG.eliminated) !== 0;
      this.lifecycle.set(snap.id, {
        id: snap.id,
        alive: false,
        tick: snapshot.tick,
        x: snap.posX,
        y: snap.posY,
        respawnTick: eliminated ? -1 : snapshot.tick + ticks,
        eliminated,
      });
    }
  }

  /**
   * **No client ever revives a ship it draws** — the lifecycle half of
   * {@link holdHull}, and for the same reason.
   *
   * `step()` runs the whole world, and its very first act on a dead ship is to take
   * `dt` off `respawnTimer` and revive it at zero. The timer is not on the wire, so
   * a client's copy starts at zero, so *every* dead ship — the local one and every
   * rival — came back on the client's next tick while authority still had five
   * seconds to run. For the local slot that is a ghost fighting a corpse and a
   * correction of hundreds of units that cannot converge until authority catches up
   * (the developer's t=63 s capture); for a rival it is a dead enemy that never
   * stops being drawn.
   *
   * So a corpse is *held*: stopped where it died, hull at zero, trigger off, and its
   * countdown recomputed from authority's respawn tick against this client's own
   * clock every time it is asserted. Recomputed rather than decremented on purpose —
   * a rewind/replay spends the same tick several times ({@link freezeClocks} is the
   * general form of that problem), and a countdown derived from a tick number cannot
   * be spent twice however many times the world is stepped over it.
   *
   * The hold ends one tick *before* the stated deadline, at which point the timer it
   * last wrote is exactly `dt` — so the sim's own countdown takes the last step and
   * `respawn()` fires at `respawnTick` itself, the same tick authority's iterative
   * countdown lands on. Not a tick earlier (a ghost) and not a tick later (a corpse
   * authority has already flown away from): the same code, at the same tick, from the
   * same state, on both sides of the wire (GDD §2.4 parity).
   */
  private holdLifecycle(): void {
    if (this.lifecycle.size === 0) return;
    for (const [id, record] of this.lifecycle) {
      const ship = this.shipOf(id);
      if (!ship) continue;
      // Past the deadline this client is holding it to: the revival belongs to
      // `step()` now. The record stays — a reconcile keeps rewinding to ticks before
      // the deadline for a round trip yet, and it is the only thing that can put the
      // replay's revival back on authority's tick ({@link seedRespawnClocks}).
      if (this.releasable(record)) continue;
      ship.alive = false;
      ship.hull = 0;
      ship.firing = false;
      ship.vel.x = 0;
      ship.vel.y = 0;
      ship.pos.x = record.x;
      ship.pos.y = record.y;
      ship.eliminated = record.eliminated;
      ship.respawnTimer = respawnHold(record, this.world.tick, this.dt);
    }
  }

  /** True once the world's clock has reached the deadline a death record states, so
   *  the sim's own countdown owns the revival from here ({@link holdLifecycle}). An
   *  elimination is never releasable: there is no revival behind it (GDD §2.7). */
  private releasable(record: ShipLifecycleData): boolean {
    if (record.eliminated || record.respawnTick < 0) return false;
    return this.world.tick >= record.respawnTick;
  }

  /**
   * Put every held countdown back to what it was **at `tick`** — the tick the world
   * has just been rewound to, before the replay runs over it.
   *
   * This is the lifecycle's answer to the problem {@link freezeClocks} solves for
   * construction: the respawn clock is not on the wire, so a rewind cannot restore it
   * from the snapshot and the replay inherits whatever the *present* had. Present
   * tense on a corpse means zero, and `step()`'s first act on a dead ship with a zero
   * timer is to revive it — so the replay launched the ship from home at the first
   * tick it replayed, however many ticks short of authority's revival that was, and
   * the reconcile then reported the death site against home as a fresh correction.
   * Every snapshot for the rest of a round trip did it again: the *same* 15-unit
   * error, repeated, converging on nothing.
   *
   * Seeded from the stated respawn tick, the replay counts the same clock down that
   * authority counted and `respawn()` fires inside the replay at exactly the tick it
   * fired at on the server.
   */
  private seedRespawnClocks(tick: Tick): void {
    if (this.lifecycle.size === 0) return;
    for (const record of this.lifecycle.values()) {
      const ship = this.shipOf(record.id);
      if (!ship || ship.alive) continue;
      ship.respawnTimer = respawnHold(record, tick, this.dt);
    }
  }

  /** One ship by player id, or null. A ship's id is its player id (`src/sim`). */
  private shipOf(player: PlayerId): World['ships'][number] | null {
    return this.world.ships.find((s) => s.id === player) ?? null;
  }

  private decayOffset(): void {
    this.offset.x *= BLEND_DECAY;
    this.offset.y *= BLEND_DECAY;
    if (Math.abs(this.offset.x) < SMOOTHING_EPSILON) this.offset.x = 0;
    if (Math.abs(this.offset.y) < SMOOTHING_EPSILON) this.offset.y = 0;
  }

  /** The local ship, or null before the world has one. */
  private localShip(): World['ships'][number] | null {
    return this.world.ships.find((s) => s.id === this.local) ?? null;
  }

  /** The firer's own live ship shots — what a volley line reports, and the number
   *  a "my shot came out twice" report is about. */
  private ownShotCount(): number {
    let n = 0;
    for (const p of this.world.projectiles) {
      if (p.active && p.owner === this.local && p.kind === 'ship') n++;
    }
    return n;
  }

  private localShipPos(): Vec2 {
    const ship = this.world.ships.find((s) => s.id === this.local);
    return ship ? ship.pos : ORIGIN;
  }
}

const ORIGIN: Vec2 = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// Orders — the predicted half of "one entity, never two"
// ---------------------------------------------------------------------------

/** One identified order lifted out of a tick's actions. */
interface IdentifiedOrder {
  readonly orderId: number;
  readonly verb: OrderVerb;
  /** The `BuildItem` or `UpgradeTrack` asked for. */
  readonly what: string;
}

/** No order in this tick — the overwhelmingly common case, allocating nothing. */
const NO_ORDERS: readonly IdentifiedOrder[] = Object.freeze([]);

/** The identified one-shot orders in one tick's actions. An order with no id is
 *  ignored here on purpose: nothing can be matched to an echo that will never name
 *  it, and offline play mints none (`@shared/types` `OrderId`). */
function identifiedOrders(actions: readonly Action[]): readonly IdentifiedOrder[] {
  let out: IdentifiedOrder[] | null = null;
  for (const action of actions) {
    if (action.type === 'buildOrder' && typeof action.orderId === 'number') {
      (out ??= []).push({ orderId: action.orderId, verb: 'buildOrder', what: action.item });
    } else if (action.type === 'upgradeOrder' && typeof action.orderId === 'number') {
      (out ??= []).push({ orderId: action.orderId, verb: 'upgradeOrder', what: action.track });
    }
  }
  return out ?? NO_ORDERS;
}

/**
 * The same tick's actions with every one-shot order removed — what the replay
 * runs. Returns the caller's own array untouched on a tick that carried none,
 * which is almost every tick (GDD §4.3: no per-frame allocation).
 */
function withoutOrders(actions: readonly Action[]): readonly Action[] {
  let kept: Action[] | null = null;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    if (action.type === 'buildOrder' || action.type === 'upgradeOrder') {
      kept ??= actions.slice(0, i);
      continue;
    }
    kept?.push(action);
  }
  return kept ?? actions;
}

/** The build jobs standing at a station right now, by id — the "before" of the
 *  one-tick diff that pairs an order with the job it created. */
function buildIdsOf(station: MiningStation | null): number[] {
  const out: number[] = [];
  for (const job of station?.builds ?? []) out.push(job.id);
  return out;
}

/** Drop one build job from a station by id. */
function removeBuild(station: MiningStation, id: number): void {
  const index = station.builds.findIndex((j) => j.id === id);
  if (index >= 0) station.builds.splice(index, 1);
}

/** The `BuildJob` kind a wheel item queues, or null for the items that queue
 *  nothing (BANK, REPAIR) and for an upgrade track. */
function buildKindOf(what: string): BuildJob['kind'] | null {
  return what === 'turret' || what === 'shield' || what === 'satellite' ? what : null;
}

// ---------------------------------------------------------------------------
// Structural clocks — the reason a turret appeared "instantly" online
// ---------------------------------------------------------------------------

/**
 * *"Turrets built instantly."*
 *
 * A turret assembles over ten seconds, and it is a **countdown integrated one tick
 * at a time** (`sim/buildings.ts` `advanceConstruction`: `job.remaining -= dt`).
 * Reconciliation rewinds the world's *clock* and replays every unacknowledged
 * input on top of authority — and `step()` steps the whole world, so every one of
 * those replayed ticks takes another `dt` off that countdown. The ticks were
 * already spent once when they were first predicted; the replay spends them again.
 *
 * The arithmetic is brutal. Snapshots arrive 30 times a second and each one replays
 * the whole pending queue — one round trip's worth of input. At 150 ms that is
 * about 10 ticks, so construction runs at roughly **ten times** its real rate; at
 * 250 ms with a stall behind it, faster still. A ten-second turret lands in under a
 * second, which is precisely what the developer saw, and it is not a display bug:
 * the *simulation* finished it early, so the entity was real and the entity events
 * for the server's copy then arrived on top of a turret the client already had.
 *
 * The fix is to make a reconcile mean what it says. Rewinding is supposed to undo
 * time, not just re-label it, so anything the sim integrates against `dt` and the
 * checkpoint cannot restore is **frozen across the whole rewind/replay** and then
 * moved on by the *net* time the reconcile actually advanced — which in a steady
 * state is zero, and after a lead trim is slightly negative. Construction then runs
 * at exactly one second per second online, the same as offline (GDD §2.5, and the
 * §2.4 parity principle: the offline and online sim run the identical code).
 *
 * Deliberately narrow. It covers the two clocks the developer's report names — the
 * construction countdown, and the repair gate and tell (`REPAIR in 12s` would
 * otherwise re-arm ten times too fast, which is *"my repair showed twice"* from the
 * other side). Position, velocity and everything else the *player's own input*
 * determines is left to the replay, because re-running it is exactly what the
 * replay is for.
 */
interface FrozenClocks {
  /** `[stationIndex, jobIndex, remaining]` per build job in flight. */
  readonly builds: number[];
  /** `[repairGate, repairCooldown]` per station, in station order. */
  readonly repair: number[];
  /** Seconds until each ship's weapon may fire again, in ship order. */
  readonly weapon: number[];
  /**
   * **"Ore goes super fast to base online."**
   *
   * The ore-flight courier is the same class of clock as a construction countdown,
   * expressed as a position instead of a number — and it is the one the developer
   * could actually *see*. Banking inside your own collection field spins off one
   * courier per whole unit banked and flies it home at `DEPOSIT.flightSpeed`
   * (`src/sim/step.ts` `updateDepositFlight`, GDD §2.3), integrated one tick at a
   * time. A rewind restores the world's scalars; it does not restore `world.chunks`.
   * So every replayed tick flew each courier *again*, on top of the flight it had
   * already made — and there are `lead` of those per snapshot, thirty times a
   * second. At 150 ms the couriers travelled about ten times too fast and the whole
   * deposit read as a line snapping instantly into the station instead of the beat
   * the design asks a player to watch.
   *
   * Worse, the replay does not only *move* couriers, it **spawns** them: the drain
   * runs again over the same integer boundary of the hold, so an unacknowledged
   * second of banking emitted its couriers once per reconcile it survived. That is
   * the conserved-telegraph rule (one sprite per unit banked) broken from the
   * client's side.
   *
   * So the chunk field is lifted out of the rewind/replay entirely and put back
   * **exactly as the replay found it** — not advanced by the reconcile's net clock
   * change, which is the one difference from every other clock here. A build
   * countdown is a fact about the world and owes the world whatever time really
   * passed; a courier's flight is a *presentation* the player watches, and what the
   * player watched is one frame per predicted tick. Letting a reconcile that nudges
   * the clock two ticks forward also nudge the courier two ticks along its line is
   * how the animation ends up shorter online than off — a smaller version of the
   * same bug, paid once per lead adjustment instead of once per replayed tick.
   *
   * The chunks a replay spawned are discarded with the rest of its chunk work, minus
   * the couriers the net drain still owes ({@link FrozenClocks.hold}): the ore a
   * replayed tick telegraphs was already banked and already couriered when that tick
   * was first predicted. Online and offline then run the same flight at the same
   * speed (GDD §2.4 parity), and the courier stream stays the conserved one sprite
   * per unit banked it is specified to be.
   *
   * Mined chunks ride along for free, and should: they drift and are tractored on
   * the same per-tick integration, so the replay was over-flying those too.
   */
  readonly chunks: readonly OreChunk[];
  /** `[x, y, vx, vy, amount]` per entry of {@link chunks}, in the same order. */
  readonly chunkState: number[];
  /**
   * Each ship's hold as the replay found it, in ship order — both the value the
   * wallet is restored to afterwards ({@link PredictedMatch.settleWallet}) and the
   * ledger behind the conserved telegraph.
   *
   * A courier is spawned on the hold's integer boundaries (`src/sim/step.ts`
   * `updateDeposits`), and a reconcile can still move the hold *without* any
   * predicted tick crossing one: authority's statement lands at the end of the
   * reconcile and may take ore out of the hold that this client's own timeline had
   * not drained yet. That is a boundary crossed nowhere the player could see it, and
   * discarding the replay's chunk work whole would silently eat the sprite it owes —
   * one unit of ore that banks with nothing flying home for it. Comparing the hold
   * this was read at against the hold the reconcile settles on says exactly how many
   * couriers are owed, and that many of the ones the replay spawned are kept.
   *
   * Read at the top of the reconcile, from the player's own timeline — the one
   * quantity here that is *not* re-derived by the replay, because the replay's
   * wallet work is thrown away ({@link PredictedMatch.settleWallet}).
   */
  readonly hold: readonly number[];
}

function freezeClocks(world: World, hold: readonly number[]): FrozenClocks {
  const builds: number[] = [];
  const repair: number[] = [];
  // The weapon cooldown is the same class of clock as the construction countdown,
  // and it is the one the developer *shot* at: `weaponCooldown -= dt` every tick,
  // re-spent by every replayed tick, so a client at 150 ms drains it about ten
  // times too fast and its predicted ship fires a far denser stream than the ship
  // authority is flying. Two sets of shots, and the extra set is the client's own
  // invention rather than a copy of anything (GDD §2.8: the fire interval is a
  // balance constant, not a suggestion).
  const weapon: number[] = [];
  for (const ship of world.ships) weapon.push(ship.weaponCooldown ?? 0);
  for (let s = 0; s < world.stations.length; s++) {
    const station = world.stations[s]!;
    for (let j = 0; j < station.builds.length; j++) {
      builds.push(s, j, station.builds[j]!.remaining);
    }
    repair.push(station.repairGate ?? 0, station.repairCooldown ?? 0);
  }
  // The chunk field, held by reference plus the four numbers a tick of flight
  // moves. One small array per reconcile against a few dozen chunks — the same
  // trade the rest of this function already makes.
  const chunks = world.chunks.slice();
  const chunkState: number[] = [];
  for (const chunk of chunks) {
    chunkState.push(chunk.pos.x, chunk.pos.y, chunk.vel.x, chunk.vel.y, chunk.amount);
  }
  return { builds, repair, weapon, chunks, chunkState, hold };
}

/**
 * Put the frozen clocks back, advanced by `elapsed` seconds of *net* progress.
 *
 * A job the replay finished (and therefore removed) is simply not restored: its
 * index is gone, and re-inserting a completed job would be a worse lie than letting
 * the entity-event stream correct the turret it became.
 */
function thawClocks(world: World, clocks: FrozenClocks, elapsed: number): void {
  for (let i = 0; i < clocks.builds.length; i += 3) {
    const station = world.stations[clocks.builds[i]!];
    const job = station?.builds[clocks.builds[i + 1]!];
    if (job) job.remaining = Math.max(0, clocks.builds[i + 2]! - elapsed);
  }
  for (let s = 0; s < world.stations.length; s++) {
    const station = world.stations[s]!;
    const gate = clocks.repair[s * 2];
    const tell = clocks.repair[s * 2 + 1];
    if (gate === undefined || tell === undefined) continue;
    station.repairGate = Math.max(0, gate - elapsed);
    station.repairCooldown = Math.max(0, tell - elapsed);
  }
  for (let i = 0; i < world.ships.length; i++) {
    const held = clocks.weapon[i];
    if (held !== undefined) world.ships[i]!.weaponCooldown = Math.max(0, held - elapsed);
  }
  // The chunk field as the replay found it — position for position, velocity for
  // velocity, and *not* flown on by `elapsed` ({@link FrozenClocks.chunks}): a
  // courier's flight is one tick per tick the player watched, and no more.
  //
  // Held by object identity rather than by id, because the rewind puts
  // `world.nextEntityId` back too — so a chunk the replay spawned can legitimately
  // carry the same id as one the client predicted before the reconcile.
  const held = new Set<OreChunk>(clocks.chunks);
  const spawned: OreChunk[] = [];
  for (const chunk of world.chunks) {
    if (chunk.deposit === true && !held.has(chunk)) spawned.push(chunk);
  }
  const owed = depositDebt(world, clocks);
  world.chunks.length = 0;
  for (let i = 0; i < clocks.chunks.length; i++) {
    const chunk = clocks.chunks[i]!;
    const at = i * 5;
    chunk.pos.x = clocks.chunkState[at]!;
    chunk.pos.y = clocks.chunkState[at + 1]!;
    chunk.vel.x = clocks.chunkState[at + 2]!;
    chunk.vel.y = clocks.chunkState[at + 3]!;
    chunk.amount = clocks.chunkState[at + 4]!;
    world.chunks.push(chunk);
  }
  // The couriers the net drain owes, newest first-served: their boundaries were
  // crossed inside the replay and nowhere else, so this is the only place their
  // sprite can come from ({@link FrozenClocks.hold}).
  for (let i = Math.max(0, spawned.length - owed); i < spawned.length; i++) {
    world.chunks.push(spawned[i]!);
  }
}

/**
 * How many deposit couriers the replay owes the player: the whole units that left
 * a hold across this reconcile, summed over every ship
 * ({@link FrozenClocks.hold}).
 *
 * Zero whenever the reconcile left the holds where it found them, which is the
 * steady state — the boundary is crossed in a predicted tick, the courier is spawned
 * there, and it survives the reconcile untouched like any other chunk.
 */
function depositDebt(world: World, clocks: FrozenClocks): number {
  let owed = 0;
  for (let i = 0; i < world.ships.length; i++) {
    const before = clocks.hold[i];
    if (before === undefined) continue;
    owed += Math.max(0, Math.floor(before) - Math.floor(world.ships[i]!.cargo));
  }
  return owed;
}

/** One of the firer's own predicted shots, held across a reconcile. */
interface CarriedShot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly damage: number;
  readonly radius: number;
  readonly life: number;
  readonly mineYield: number | undefined;
}

/** The reserved pool slot at `index`, allocating up to it. Unlike {@link poolSlot}
 *  this one is deliberately *above* the wire's reach, so it never returns null. */
function localShotSlot(world: World, index: number): World['projectiles'][number] {
  while (world.projectiles.length <= index) {
    world.projectiles.push({
      id: 0,
      active: false,
      owner: -1,
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      damage: 0,
      radius: PROJECTILE.radius,
      life: 0,
    });
  }
  return world.projectiles[index]!;
}

// ---------------------------------------------------------------------------
// Authority → world
// ---------------------------------------------------------------------------

/**
 * Write one authoritative wallet onto a client world's ship: held ore, banked ore,
 * and every upgrade track the client recognizes (`./transport` PlayerEconomy).
 *
 * The tiers are followed by a recompute of the stats they scale — max hull and
 * cargo capacity are *stored* on a ship rather than derived per read (`src/sim`
 * `refreshDerivedStats`), so a reclaimed DAMAGE-3 hull that only had its `tiers`
 * relabelled would fly with tier-0 ceilings and mis-predict the next fight. A
 * track the client's build does not know is ignored rather than invented.
 *
 * Returns false when the world has no ship for that slot — a wallet for a seat
 * this client has not built yet, which the caller re-stages or drops.
 */
export function applyPlayerEconomy(
  world: World,
  player: PlayerId,
  economy: PlayerEconomy,
): boolean {
  const ship = world.ships.find((s) => s.id === player);
  if (!ship) return false;
  ship.cargo = economy.held;
  ship.banked = economy.banked;
  for (const track of Object.keys(ship.tiers)) {
    const tier = economy.tiers[track];
    if (typeof tier === 'number') (ship.tiers as Record<string, number>)[track] = tier;
  }
  refreshDerivedStats(ship);
  return true;
}

/**
 * Write one decoded snapshot over a client world's ships and projectiles.
 *
 * Exported because it is useful on its own — a spectator or a client that has
 * given up predicting can render straight off it — and because it is the half
 * of reconciliation worth testing in isolation.
 *
 * Only what the wire carries is written. Everything else on a ship — cargo,
 * banked ore, upgrade tiers, the respawn timer — is *not* streamed (it is either
 * the player's own predicted state or it belongs to the upgrade/lobby channel),
 * so it is left exactly where prediction put it rather than being zeroed by
 * something that never knew about it.
 */
export function applySnapshot(
  world: World,
  snapshot: DecodedSnapshot,
  options: {
    /**
     * Drop the wire's copy of this player's own **ship** shots. The firer draws
     * those from prediction (`PredictedMatch.harvestOwnShots`), and writing
     * authority's copy as well would put two of every shot on their screen, one
     * round trip apart. Omitted — a spectator, or a client that has stopped
     * predicting — every shot on the wire is written, which is correct for a
     * viewer who fired none of them.
     */
    readonly suppressShipShotsFrom?: PlayerId;
  } = {},
): ReadonlySet<number> {
  for (const snap of snapshot.ships) {
    const ship = world.ships.find((s) => s.id === snap.id);
    if (!ship) continue;
    ship.pos.x = snap.posX;
    ship.pos.y = snap.posY;
    ship.vel.x = snap.velX;
    ship.vel.y = snap.velY;
    ship.angle = dequantizeAngle(snap.heading);
    ship.hull = snap.hull;
    ship.alive = (snap.flags & SHIP_FLAG.alive) !== 0;
    ship.eliminated = (snap.flags & SHIP_FLAG.eliminated) !== 0;
    // Spawn protection is a countdown on the wire's one bit. The bit's *edges*
    // are what a player reads (the glow is on or it is off), so a clear flag
    // ends it exactly and a set flag only starts it if prediction had it over
    // already — an arriving client that missed the first ticks is briefly
    // generous with its own glow, and never with anyone's damage.
    if ((snap.flags & SHIP_FLAG.spawnProtected) === 0) ship.spawnProtect = 0;
    else if (ship.spawnProtect <= 0) ship.spawnProtect = SPAWN_PROTECTION_S;
  }

  // The pool is sparse and slot-keyed (`src/sim/state.ts`): the snapshot names
  // the live slots, so every slot it does not name holds a shot that has landed
  // or expired. Clearing first is what makes that true.
  for (const projectile of world.projectiles) projectile.active = false;
  const wireSlots = new Set<number>();
  for (const snap of snapshot.projectiles) {
    if (
      options.suppressShipShotsFrom !== undefined &&
      (snap.meta & SHOT_META.ownerMask) === options.suppressShipShotsFrom &&
      (snap.meta & SHOT_META.shipKind) !== 0
    ) {
      continue;
    }
    const projectile = poolSlot(world, snap.id);
    if (!projectile) continue;
    wireSlots.add(snap.id);
    projectile.active = true;
    projectile.owner = snap.meta & 0x7;
    projectile.kind = (snap.meta & SHOT_META.shipKind) !== 0 ? 'ship' : 'turret';
    projectile.pos.x = snap.posX;
    projectile.pos.y = snap.posY;
    // The line the shot was fired on, off the wire (a0-73). This used to read
    // "velocity is not streamed for shots… a slot the client was already flying
    // keeps its heading and is merely corrected", and both halves were wrong in the
    // same direction: a slot the client had *never* flown started at rest, and a
    // slot it had flown kept the heading of whatever shot used it BEFORE — the pool
    // is slot-keyed and `takeProjectile` hands out the lowest free slot, so that
    // previous occupant is routinely a different shooter aiming somewhere else.
    // Every replayed tick then carried the shot along that stale line. Authority
    // knows the answer and now says it.
    projectile.vel.x = snap.velX;
    projectile.vel.y = snap.velY;
    // What a streamed shot must *not* do is expire between snapshots, so the clock
    // is wound back on every one.
    projectile.life = PROJECTILE.life;
  }
  return wireSlots;
}

/**
 * The pool slot a snapshot names, growing the pool to reach it.
 *
 * A client's pool only grows when *it* fires something, and a client predicts
 * nobody's turret but the ones on its own screen — so an arriving shot can name
 * a slot this world has never allocated. Bounded by the encoder's own cap, so a
 * malformed snapshot cannot make a client allocate a megabyte of shots.
 */
function poolSlot(world: World, index: number): World['projectiles'][number] | null {
  if (index >= MAX_PROJECTILES) return null;
  while (world.projectiles.length <= index) {
    world.projectiles.push({
      id: 0,
      active: false,
      owner: -1,
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      damage: 0,
      radius: PROJECTILE.radius,
      life: 0,
    });
  }
  return world.projectiles[index] ?? null;
}

/**
 * Give every ship but the local one its firing tell back from the wire.
 *
 * The snapshot spends one flag bit on "firing"; there is no geometry to
 * reconstruct any more (the laser retired to a projectile — the client sees a
 * remote ship's shots in the streamed projectile pool, GDD §4.2). So this just
 * copies the flag onto `Ship.firing` for each remote ship. The *local* ship is
 * left alone: its `firing` came out of the real fire step during replay.
 */
function paintRemoteFiring(world: World, snapshot: DecodedSnapshot, local: PlayerId): void {
  for (const snap of snapshot.ships) {
    if (snap.id === local) continue;
    const ship = world.ships.find((s) => s.id === snap.id);
    if (!ship) continue;
    ship.firing = (snap.flags & SHIP_FLAG.firing) !== 0;
  }
}
