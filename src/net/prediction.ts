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
import { PROJECTILE, SPAWN_PROTECTION_S, TICK_DT, refreshDerivedStats, step } from '../sim';
import type { World } from '../sim';
import { applyEntityEvent } from './entity-events';
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

/** What one reconcile did, for the HUD, the tests, and the netgraph. */
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
  /** The newest authoritative wallet the server has volunteered, waiting for the
   *  reconcile of its own tick (`./transport` EconomyMessage). */
  private staged: { tick: Tick; economy: PlayerEconomy } | null = null;

  constructor(config: PredictedMatchConfig) {
    this.world = config.world;
    this.local = config.localPlayer;
    this.dt = config.dt ?? TICK_DT;
    this.maxPending = config.maxPending ?? MAX_PENDING_INPUTS;
    this.checkpoint();
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

    step(this.world, [{ id: this.local, actions }], this.dt);
    this.checkpoint();
    this.decayOffset();
    return tick;
  }

  // --- Reconcile ----------------------------------------------------------

  /**
   * Take one authoritative snapshot and put the predicted world back on top of
   * it: rewind, overwrite, retire what the server has run, replay the rest.
   *
   * @param snapshot the decoded snapshot (`./snapshot`).
   * @param ackSeq   the newest local input the server has **simulated** — not
   *                 merely received (`./input-queue`, `server/room.ts`).
   */
  reconcile(snapshot: DecodedSnapshot, ackSeq: number): ReconcileReport {
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
      };
    }
    this.snapshotTick = snapshot.tick;

    // A copy, not the live vector: `absorb` measures how far this reconcile
    // moved the ship, and the ship is about to move.
    const before = { ...this.localShipPos() };
    // The firer's own shots are the client's to draw, so they are lifted out
    // before authority flattens the pool and put back after the replay
    // (`settleShots`, audit item 2b).
    const carried = this.harvestOwnShots();
    const checkpoint = this.rewind(snapshot.tick);
    const authoritative = snapshot.ships.find((s) => s.id === this.local);
    this.error =
      checkpoint && authoritative
        ? Math.hypot(checkpoint.x - authoritative.posX, checkpoint.y - authoritative.posY)
        : 0;

    const wireSlots = applySnapshot(this.world, snapshot, { suppressShipShotsFrom: this.local });
    // The wallet is corrected here, in the same breath as position and hull, and
    // *before* the replay: unacked mining is then re-earned on top of authority's
    // figure instead of on top of the client's own compounding one (`stageEconomy`).
    this.applyStagedEconomy(snapshot.tick);

    const acknowledged = this.retire(ackSeq);
    // Pull the clock back if a stall pushed it too far ahead. Done *before* the
    // replay, so the world lands at `snapshotTick + leadBudget` at worst and the
    // next input is stamped for a tick the server will reach promptly.
    const trimmed = this.trimLead();
    for (const input of this.queue) {
      step(this.world, [{ id: this.local, actions: input.actions }], this.dt);
      this.checkpoint();
    }

    // Remote firing is the one thing the replay cannot produce: a ship the
    // client has no input for never fires, so the flag on the wire is the only
    // evidence its trigger is down. Painted after the replay, because `step()`
    // clears it every tick (`src/sim/step.ts`).
    paintRemoteFiring(this.world, snapshot, this.local);
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
    };
  }

  /** Apply one static-entity event to the predicted world (`./entity-events`). */
  applyEvent(message: EntityEventMessage): boolean {
    return applyEntityEvent(this.world, message);
  }

  // --- The wallet ---------------------------------------------------------

  /**
   * Take authority's word on the local wallet as of `tick`, to be written into the
   * world at the reconcile for that tick (`./transport` EconomyMessage).
   *
   * Staged rather than applied on arrival, because *when* it lands decides whether
   * the player's own unacked mining survives. The server sends it immediately
   * ahead of the snapshot for the same tick, so by the time that snapshot is
   * reconciled the correct wallet is already here: rewind, write authority (ships,
   * hull, and now the wallet), then replay — and the ore the client tractored in
   * during the ticks the server has not simulated yet is added back on top, once.
   * Applying it on arrival instead would stamp a wallet from tick `T` onto a world
   * predicted to `T + RTT` and drop that window's earnings on every snapshot.
   *
   * A wallet for a tick the client has already reconciled past is applied at the
   * next reconcile (the newest word always wins; the ticks between are replayed
   * over it). Only the newest staged wallet is kept — this is full state, not a
   * diff, so an older one has nothing left to say.
   */
  stageEconomy(economy: PlayerEconomy, tick: Tick): void {
    if (this.staged && this.staged.tick > tick) return;
    this.staged = { tick, economy };
  }

  /** Tick of the wallet waiting to be applied, or -1 when none is — the read that
   *  makes "staged, not stamped" observable to a test. */
  get stagedEconomyTick(): Tick {
    return this.staged?.tick ?? -1;
  }

  // --- Internals ----------------------------------------------------------

  /** Write the staged wallet if it describes this snapshot's tick or an earlier
   *  one; a wallet from the future stays staged until its tick arrives. */
  private applyStagedEconomy(tick: Tick): void {
    if (!this.staged || this.staged.tick > tick) return;
    applyPlayerEconomy(this.world, this.local, this.staged.economy);
    this.staged = null;
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
   */
  private trimLead(): number {
    let dropped = 0;
    while (this.queue.length > this.lead_budget) {
      this.queue.shift();
      dropped++;
    }
    return dropped;
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
    for (const p of this.world.projectiles) {
      if (!p.active || p.owner !== this.local || p.kind !== 'ship') continue;
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
   * The replay re-fires those own shots too, and they come back with the *same*
   * entity id, because `rewind` restores `nextEntityId` and the sim is
   * deterministic — so the duplicate is identified exactly, by id, and not by a
   * distance heuristic. A shot the replay produced that the carry list has never
   * seen (a correction changed what the trigger did) joins the carry list instead.
   */
  private settleShots(wireSlots: ReadonlySet<number>, carried: readonly CarriedShot[]): void {
    const keep: CarriedShot[] = [...carried];
    const known = new Set(carried.map((c) => c.id));

    for (let slot = 0; slot < this.world.projectiles.length; slot++) {
      const p = this.world.projectiles[slot]!;
      if (!p.active || wireSlots.has(slot)) continue;
      if (p.owner === this.local && p.kind === 'ship' && !known.has(p.id) && keep.length < MAX_PREDICTED_SHOTS) {
        known.add(p.id);
        keep.push({
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
      }
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

  private decayOffset(): void {
    this.offset.x *= BLEND_DECAY;
    this.offset.y *= BLEND_DECAY;
    if (Math.abs(this.offset.x) < SMOOTHING_EPSILON) this.offset.x = 0;
    if (Math.abs(this.offset.y) < SMOOTHING_EPSILON) this.offset.y = 0;
  }

  private localShipPos(): Vec2 {
    const ship = this.world.ships.find((s) => s.id === this.local);
    return ship ? ship.pos : ORIGIN;
  }
}

const ORIGIN: Vec2 = { x: 0, y: 0 };

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
    // Velocity is not streamed for shots — six bytes each, and a client that
    // sees the whole board can watch them fly. A slot the client was already
    // flying keeps its heading and is merely corrected; a slot it has never seen
    // starts still and is placed again 2 ticks later. What it must *not* do is
    // expire between snapshots, so the clock is wound back on every one.
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
