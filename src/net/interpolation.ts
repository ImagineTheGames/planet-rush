/**
 * src/net/interpolation.ts — the remote-entity interpolation buffer.
 * OWNER: Netcode Engineer (GDD §4.2; M10 reconcile-feel brief).
 *
 * *"REMOTE ENTITIES: interpolation buffer (render other ships ~100 ms in the
 * past, standard technique) so THEIR motion is smooth regardless of the
 * developer's RTT. Local ship stays predicted."* (M10 brief.)
 *
 * The local ship is *predicted* — simulated forward on the player's own input, at
 * zero latency (`./prediction`). Every *other* ship is not: the client has no
 * input for it, so between the 30 Hz snapshots it can only guess, and guessing
 * forward (dead-reckoning on last velocity) makes a remote ship overshoot and
 * snap back every time a fresh snapshot corrects it — the same rollback the local
 * ship's smoothing hides, but on someone else's hull where no offset can absorb
 * it. The fix is the standard one: don't render remote ships at *now*, render
 * them at `now − ` {@link INTERP_DELAY_MS}, *between two snapshots the client has
 * already received*, so their motion is played back as interpolation over known
 * states rather than extrapolation into unknown ones. One broadcast interval of
 * delay (~33 ms) plus headroom buys jitter immunity: a snapshot that arrives late
 * is still in the past relative to the render clock, so nothing stutters.
 *
 * This buffer is the net-side half. It ingests each decoded snapshot with the
 * wall-clock it arrived at ({@link RemoteInterpolator.record}) and answers, for
 * any render instant, where every remote ship *was* {@link INTERP_DELAY_MS} ago
 * ({@link RemoteInterpolator.sample}). The render layer (Platform's lane) draws
 * remote hulls from that answer while it keeps drawing the local hull from the
 * predicted world plus its decaying correction offset — the one seam this module
 * exists to feed. It never touches the predicted `World`: the simulation that
 * prediction rewinds and replays is left exactly as authoritative snapshots wrote
 * it, so nothing here can perturb what the local player reconciles against.
 *
 * No ambient clock — the arrival and render instants are passed in (the session's
 * injected `now`, `./session.ts`), so playback is reproducible and testable.
 */

import type { PlayerId } from '@shared/types';
import { dequantizeAngle } from './snapshot';
import type { DecodedSnapshot, ShipSnap } from './snapshot';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * How far in the past remote ships are rendered — the interpolation delay. A
 * little over one 30 Hz broadcast interval (~33 ms), so the render clock almost
 * always sits *between* two snapshots the client already holds and their motion is
 * interpolation, not a guess. Larger hides more jitter at the cost of remote ships
 * lagging their true position; 100 ms is the standard trade and what the brief
 * names.
 */
export const INTERP_DELAY_MS = 100;

/**
 * The longest the buffer will extrapolate past its newest snapshot before it
 * simply holds position. Reached only when snapshots stop arriving (a stall, a
 * spike past the delay's headroom); a brief velocity-based reach keeps a remote
 * ship moving rather than freezing mid-glide, but an unbounded one would fling it
 * across the map, so it is capped at roughly one broadcast interval.
 */
export const MAX_EXTRAPOLATION_MS = 40;

/** How long a snapshot stays useful for interpolation before it is pruned —
 *  comfortably past {@link INTERP_DELAY_MS} plus jitter, bounded so the buffer
 *  cannot grow with the match. */
export const RETAIN_MS = 1000;

/** Hard cap on buffered snapshots, a backstop for {@link RETAIN_MS} if arrival
 *  times ever misbehave (a clock that jumps). At 30 Hz, 64 covers ~2 s. */
export const MAX_ENTRIES = 64;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** One remote ship's render state at the sampled instant. Position and facing are
 *  interpolated; hull and flags are carried from the bracketing snapshot so the
 *  renderer can still draw the damage ring and the spawn glow. */
export interface InterpolatedShip {
  readonly id: PlayerId;
  readonly x: number;
  readonly y: number;
  /** Hull facing, radians. */
  readonly angle: number;
  readonly hull: number;
  readonly flags: number;
}

interface BufferedSnapshot {
  readonly tick: number;
  readonly receivedMs: number;
  readonly ships: readonly ShipSnap[];
}

// ---------------------------------------------------------------------------
// The buffer
// ---------------------------------------------------------------------------

export class RemoteInterpolator {
  private readonly buffer: BufferedSnapshot[] = [];
  private readonly local: PlayerId;
  private readonly delayMsValue: number;
  private readonly maxExtrapolationMs: number;
  private readonly retainMs: number;
  private readonly maxEntries: number;

  constructor(config: {
    /** The slot rendered by prediction, excluded from every {@link sample}. */
    readonly local: PlayerId;
    readonly delayMs?: number;
    readonly maxExtrapolationMs?: number;
    readonly retainMs?: number;
    readonly maxEntries?: number;
  }) {
    this.local = config.local;
    this.delayMsValue = config.delayMs ?? INTERP_DELAY_MS;
    this.maxExtrapolationMs = config.maxExtrapolationMs ?? MAX_EXTRAPOLATION_MS;
    this.retainMs = config.retainMs ?? RETAIN_MS;
    this.maxEntries = config.maxEntries ?? MAX_ENTRIES;
  }

  /** The interpolation delay in ms — remote ships render this far in the past. */
  get delayMs(): number {
    return this.delayMsValue;
  }

  /** Snapshots currently held for interpolation. */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /**
   * Ingest one decoded snapshot with the wall-clock it arrived at. Out-of-order
   * and duplicate ticks are dropped — the same full-state-newest-wins rule the
   * reconcile loop follows (`./prediction`), so the buffer stays monotonic and a
   * late-arriving stale frame can never rewind playback.
   */
  record(snapshot: DecodedSnapshot, receivedMs: number): void {
    const newest = this.buffer[this.buffer.length - 1];
    if (newest && snapshot.tick <= newest.tick) return;
    this.buffer.push({ tick: snapshot.tick, receivedMs, ships: snapshot.ships });
    this.prune(receivedMs);
  }

  /**
   * Where every remote ship was {@link delayMs} ago, at render instant `nowMs`.
   *
   * Three regimes, all standard:
   *  - **interpolate** — the render clock falls between two buffered snapshots
   *    (the common case): lerp each ship present in the earlier one toward the
   *    later, shortest-arc on the heading.
   *  - **hold** — the render clock is older than the oldest snapshot (startup,
   *    before the buffer has filled to the delay): draw the oldest as-is.
   *  - **extrapolate** — the render clock is newer than the newest snapshot
   *    (snapshots have stalled): reach forward on last velocity, capped at
   *    {@link MAX_EXTRAPOLATION_MS}, then hold.
   *
   * The local slot is never returned — it stays predicted.
   */
  sample(nowMs: number): InterpolatedShip[] {
    if (this.buffer.length === 0) return [];
    const renderMs = nowMs - this.delayMsValue;

    const oldest = this.buffer[0]!;
    if (renderMs <= oldest.receivedMs) return this.snap(oldest);

    const newest = this.buffer[this.buffer.length - 1]!;
    if (renderMs >= newest.receivedMs) return this.extrapolate(newest, renderMs);

    // Find the bracketing pair [a, b] with a.receivedMs <= renderMs < b.receivedMs.
    let a = oldest;
    let b = newest;
    for (let i = 1; i < this.buffer.length; i++) {
      const entry = this.buffer[i]!;
      if (entry.receivedMs > renderMs) {
        a = this.buffer[i - 1]!;
        b = entry;
        break;
      }
    }
    const span = b.receivedMs - a.receivedMs;
    const frac = span > 0 ? (renderMs - a.receivedMs) / span : 0;
    return this.lerp(a, b, frac);
  }

  // --- Internals ----------------------------------------------------------

  /** Draw one buffered snapshot with no interpolation (the hold regime). */
  private snap(entry: BufferedSnapshot): InterpolatedShip[] {
    const out: InterpolatedShip[] = [];
    for (const s of entry.ships) {
      if (s.id === this.local) continue;
      out.push({ id: s.id, x: s.posX, y: s.posY, angle: dequantizeAngle(s.heading), hull: s.hull, flags: s.flags });
    }
    return out;
  }

  /** Reach forward from the newest snapshot on last velocity, capped. */
  private extrapolate(entry: BufferedSnapshot, renderMs: number): InterpolatedShip[] {
    const dtSec = Math.min(renderMs - entry.receivedMs, this.maxExtrapolationMs) / 1000;
    const out: InterpolatedShip[] = [];
    for (const s of entry.ships) {
      if (s.id === this.local) continue;
      out.push({
        id: s.id,
        x: s.posX + s.velX * dtSec,
        y: s.posY + s.velY * dtSec,
        angle: dequantizeAngle(s.heading),
        hull: s.hull,
        flags: s.flags,
      });
    }
    return out;
  }

  /** Interpolate every ship present in `a` toward its state in `b`. */
  private lerp(a: BufferedSnapshot, b: BufferedSnapshot, frac: number): InterpolatedShip[] {
    const out: InterpolatedShip[] = [];
    for (const s of a.ships) {
      if (s.id === this.local) continue;
      const next = b.ships.find((o) => o.id === s.id);
      if (!next) {
        // Present at the base instant but gone by the next snapshot (it died or
        // dropped out). Render its last known state rather than pop it early.
        out.push({ id: s.id, x: s.posX, y: s.posY, angle: dequantizeAngle(s.heading), hull: s.hull, flags: s.flags });
        continue;
      }
      out.push({
        id: s.id,
        x: s.posX + (next.posX - s.posX) * frac,
        y: s.posY + (next.posY - s.posY) * frac,
        angle: lerpAngle(dequantizeAngle(s.heading), dequantizeAngle(next.heading), frac),
        // Discrete fields take the nearer snapshot's value — hull and the flag bits
        // are not quantities to average.
        hull: frac < 0.5 ? s.hull : next.hull,
        flags: frac < 0.5 ? s.flags : next.flags,
      });
    }
    return out;
  }

  /** Drop snapshots older than {@link retainMs} behind the newest arrival, and
   *  enforce the hard entry cap. Always keeps at least the two most recent so a
   *  bracket survives even after a long idle. */
  private prune(nowMs: number): void {
    while (
      this.buffer.length > 2 &&
      nowMs - this.buffer[0]!.receivedMs > this.retainMs
    ) {
      this.buffer.shift();
    }
    while (this.buffer.length > this.maxEntries) this.buffer.shift();
  }
}

/** Shortest-arc angle interpolation, radians. */
function lerpAngle(a: number, b: number, frac: number): number {
  const TAU = Math.PI * 2;
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta < -Math.PI) delta += TAU;
  const result = a + delta * frac;
  return ((result % TAU) + TAU) % TAU;
}
