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
import { MAX_PROJECTILES, SHIP_FLAG, dequantizeAngle } from './snapshot';
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
   * True when the client could not rewind — a snapshot from before its history,
   * or from a tick it has not predicted yet (a join mid-match, a long stall) —
   * and took authority wholesale instead of correcting toward it.
   */
  resynced: boolean;
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
      return { applied: false, error: this.error, replayed: 0, acknowledged: 0, resynced: false };
    }
    this.snapshotTick = snapshot.tick;

    // A copy, not the live vector: `absorb` measures how far this reconcile
    // moved the ship, and the ship is about to move.
    const before = { ...this.localShipPos() };
    const checkpoint = this.rewind(snapshot.tick);
    const authoritative = snapshot.ships.find((s) => s.id === this.local);
    this.error =
      checkpoint && authoritative
        ? Math.hypot(checkpoint.x - authoritative.posX, checkpoint.y - authoritative.posY)
        : 0;

    applySnapshot(this.world, snapshot);
    // The wallet is corrected here, in the same breath as position and hull, and
    // *before* the replay: unacked mining is then re-earned on top of authority's
    // figure instead of on top of the client's own compounding one (`stageEconomy`).
    this.applyStagedEconomy(snapshot.tick);

    const acknowledged = this.retire(ackSeq);
    for (const input of this.queue) {
      step(this.world, [{ id: this.local, actions: input.actions }], this.dt);
      this.checkpoint();
    }

    // Remote firing is the one thing the replay cannot produce: a ship the
    // client has no input for never fires, so the flag on the wire is the only
    // evidence its trigger is down. Painted after the replay, because `step()`
    // clears it every tick (`src/sim/step.ts`).
    paintRemoteFiring(this.world, snapshot, this.local);

    this.absorb(before);
    return {
      applied: true,
      error: this.error,
      replayed: this.queue.length,
      acknowledged,
      resynced: checkpoint === null,
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

  /** Turn the displacement a correction just caused into a decaying visual
   *  offset — unless it is big enough that it should be seen. */
  private absorb(before: Vec2): void {
    const after = this.localShipPos();
    const dx = before.x - after.x;
    const dy = before.y - after.y;
    if (Math.hypot(dx, dy) > SNAP_THRESHOLD) {
      this.offset.x = 0;
      this.offset.y = 0;
      return;
    }
    this.offset.x += dx;
    this.offset.y += dy;
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
export function applySnapshot(world: World, snapshot: DecodedSnapshot): void {
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
  for (const snap of snapshot.projectiles) {
    const projectile = poolSlot(world, snap.id);
    if (!projectile) continue;
    projectile.active = true;
    projectile.owner = snap.meta & 0x7;
    projectile.pos.x = snap.posX;
    projectile.pos.y = snap.posY;
    // Velocity is not streamed for shots — six bytes each, and a client that
    // sees the whole board can watch them fly. A slot the client was already
    // flying keeps its heading and is merely corrected; a slot it has never seen
    // starts still and is placed again 2 ticks later. What it must *not* do is
    // expire between snapshots, so the clock is wound back on every one.
    projectile.life = PROJECTILE.life;
  }
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
