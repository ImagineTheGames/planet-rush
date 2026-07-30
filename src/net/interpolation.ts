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
import type { DecodedSnapshot, ProjSnap, ShipSnap } from './snapshot';

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

// --- The adaptive jitter buffer (M10 audit item 2d) -------------------------
//
// *"jitter buffer sized from measured RTT variance, not a constant."* The delay
// above is the standard opening value; these three turn it into a range the
// buffer moves inside, driven by the RTT variance `NetTelemetry` measures.

/**
 * The floor the adaptive delay will not go below: one 30 Hz broadcast interval
 * (~33 ms) plus a little, so even on a perfect wire the render clock still lands
 * *between* two snapshots and playback is interpolation rather than a guess.
 * A client on a clean LAN pays this and nothing more.
 */
export const MIN_DELAY_MS = 45;

/**
 * The ceiling. Past this, delay stops buying smoothness and starts costing
 * fairness — a remote ship a quarter-second in the past is a ship you cannot lead
 * a shot at (GDD §2.6 is a game of leading moving targets). A wire jittery enough
 * to want more than this is one the acceptance gate should fail, not one the
 * buffer should quietly absorb.
 */
export const MAX_DELAY_MS = 250;

/**
 * How many standard-ish deviations of measured RTT variance the delay covers,
 * on top of {@link MIN_DELAY_MS}. Two: an arrival later than twice the smoothed
 * jitter estimate is rare enough that catching it costs more delay for everyone
 * than it saves in the tail. `delay = clamp(MIN + JITTER_COVERAGE × jitter)`.
 */
export const JITTER_COVERAGE = 2;

/**
 * How fast the delay is allowed to move, ms per adjustment. A jitter buffer that
 * re-sizes instantly is itself a source of stutter: every remote ship's render
 * clock jumps with it. Bounding the step means the buffer *slides* to its new
 * size over a few snapshots instead of snapping to it.
 */
export const DELAY_SLEW_MS = 2;

/**
 * The delay a measured RTT variance asks for — the sizing rule, exported on its
 * own so the audit doc and its tests can quote one function rather than a
 * paragraph. `null` (no measurement yet) opens at {@link INTERP_DELAY_MS}, the
 * standard value, because a client with no measurement is not a client on a clean
 * wire — it is a client that does not know yet.
 */
export function jitterDelayMs(rttJitterMs: number | null): number {
  if (rttJitterMs === null) return INTERP_DELAY_MS;
  const wanted = MIN_DELAY_MS + JITTER_COVERAGE * rttJitterMs;
  return Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, wanted));
}

/**
 * The longest a shot may plausibly travel between two snapshots before the two
 * records cannot be the same shot — the fastest muzzle in the game (a turret's
 * 700 u/s, `src/sim/constants`) with headroom for a late snapshot, plus the wire's
 * ~1-unit position quantization.
 *
 * Projectile records are keyed by **pool slot**, and slots are recycled: a shot
 * that lands frees its slot for the next one fired. Interpolating across that
 * reuse would drag a bright dot across the whole arena in 33 ms. So a pair whose
 * positions are further apart than this is read as *two different shots in one
 * slot* and is not interpolated — the newer one is drawn where it is.
 */
export function maxShotStep(spanMs: number): number {
  return 700 * (spanMs / 1000) * 1.5 + 4;
}

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

/**
 * One shot's render state at the sampled instant. `slot` is the pool slot the
 * wire named, so the presentation layer can write it straight back into the
 * client's projectile pool; `meta` is carried verbatim (owner in the low bits,
 * ship-vs-turret kind in bit 3) so the renderer keeps tinting the two apart.
 */
export interface InterpolatedShot {
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly meta: number;
}

interface BufferedSnapshot {
  readonly tick: number;
  readonly receivedMs: number;
  readonly ships: readonly ShipSnap[];
  readonly projectiles: readonly ProjSnap[];
}

// ---------------------------------------------------------------------------
// The buffer
// ---------------------------------------------------------------------------

export class RemoteInterpolator {
  private readonly buffer: BufferedSnapshot[] = [];
  private readonly local: PlayerId;
  private delayMsValue: number;
  private readonly maxExtrapolationMs: number;
  private readonly retainMs: number;
  private readonly maxEntries: number;

  /** True when {@link delayMs} is driven by measured RTT variance rather than
   *  pinned to the value the caller passed in. */
  private readonly adaptive: boolean;
  private readonly slewMs: number;

  constructor(config: {
    /** The slot rendered by prediction, excluded from every {@link sample}. */
    readonly local: PlayerId;
    /** Fixed interpolation delay. Passing one turns {@link resize} into a no-op —
     *  the buffer is pinned, which is what a reproducible test wants. Omitted, the
     *  buffer opens at {@link INTERP_DELAY_MS} and sizes itself from measured
     *  jitter (audit item 2d). */
    readonly delayMs?: number;
    readonly maxExtrapolationMs?: number;
    readonly retainMs?: number;
    readonly maxEntries?: number;
    /** Per-adjustment slew limit, ms. Default {@link DELAY_SLEW_MS}. */
    readonly slewMs?: number;
  }) {
    this.local = config.local;
    this.adaptive = config.delayMs === undefined;
    this.delayMsValue = config.delayMs ?? INTERP_DELAY_MS;
    this.maxExtrapolationMs = config.maxExtrapolationMs ?? MAX_EXTRAPOLATION_MS;
    this.retainMs = config.retainMs ?? RETAIN_MS;
    this.maxEntries = config.maxEntries ?? MAX_ENTRIES;
    this.slewMs = config.slewMs ?? DELAY_SLEW_MS;
  }

  /** The interpolation delay in ms — remote ships render this far in the past. */
  get delayMs(): number {
    return this.delayMsValue;
  }

  /**
   * Re-size the jitter buffer from the RTT variance the instrument has measured
   * (`./telemetry` {@link TelemetryReadout.rttJitterMs}), slew-limited so the
   * render clock slides rather than jumps. A no-op on a buffer constructed with an
   * explicit `delayMs`.
   *
   * Called once per applied reconcile (`./session`), which is 30 times a second:
   * at {@link DELAY_SLEW_MS} per step the buffer can travel its whole legal range
   * in ~3.5 s, fast enough to follow a route change and slow enough that no single
   * frame moves visibly.
   */
  resize(rttJitterMs: number | null): number {
    if (!this.adaptive) return this.delayMsValue;
    const target = jitterDelayMs(rttJitterMs);
    const step = Math.max(-this.slewMs, Math.min(this.slewMs, target - this.delayMsValue));
    this.delayMsValue += step;
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
    this.buffer.push({
      tick: snapshot.tick,
      receivedMs,
      ships: snapshot.ships,
      projectiles: snapshot.projectiles,
    });
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
    const at = this.bracket(nowMs);
    if (at === null) return [];
    if (at.mode === 'hold') return this.snap(at.a);
    if (at.mode === 'extrapolate') return this.extrapolate(at.a, at.renderMs);
    return this.lerp(at.a, at.b, at.frac);
  }

  /**
   * Where every shot in the streamed projectile pool was {@link delayMs} ago — the
   * same three regimes as {@link sample}, on the same buffer and the same clock.
   *
   * Shots are the one entity class the client *cannot* dead-reckon from the wire:
   * the 6-byte projectile record carries position and owner but **no velocity**
   * (`./snapshot`), deliberately, because a client that sees the whole board can
   * watch a shot fly. The catch is that "watch it fly" was never implemented — a
   * decoded shot sat still at its snapshot position and teleported on the next one,
   * 33 ms later, which is exactly the *"jumpy projectiles"* in the field report.
   * Interpolating between two known positions is the missing half, and it needs no
   * wire change: two snapshots *are* the velocity.
   *
   * The local player's own ship shots are absent from this stream by the time it
   * gets here — the reconcile path suppresses them so the firer sees their own
   * predicted shot instead of a copy trailing one round trip behind
   * (`./prediction`, audit item 2b).
   */
  sampleShots(nowMs: number): InterpolatedShot[] {
    const at = this.bracket(nowMs);
    if (at === null) return [];
    if (at.mode !== 'interpolate') return shotsOf(at.a);
    return this.lerpShots(at.a, at.b, at.frac);
  }

  // --- Internals ----------------------------------------------------------

  /**
   * Locate the render instant in the buffer: which pair of snapshots surrounds it,
   * and how far between them it sits. Null before the first snapshot.
   */
  private bracket(
    nowMs: number,
  ):
    | { mode: 'hold' | 'extrapolate'; a: BufferedSnapshot; b: BufferedSnapshot; frac: number; renderMs: number }
    | { mode: 'interpolate'; a: BufferedSnapshot; b: BufferedSnapshot; frac: number; renderMs: number }
    | null {
    if (this.buffer.length === 0) return null;
    const renderMs = nowMs - this.delayMsValue;

    const oldest = this.buffer[0]!;
    if (renderMs <= oldest.receivedMs)
      return { mode: 'hold', a: oldest, b: oldest, frac: 0, renderMs };

    const newest = this.buffer[this.buffer.length - 1]!;
    if (renderMs >= newest.receivedMs)
      return { mode: 'extrapolate', a: newest, b: newest, frac: 0, renderMs };

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
    return { mode: 'interpolate', a, b, frac, renderMs };
  }

  /**
   * Interpolate every shot present in both snapshots, in the same pool slot and
   * with the same owner and kind. A slot present in only one of the two is drawn
   * where it is: a shot that has just spawned, or one that landed between the two
   * frames and must still be seen for the rest of its playback.
   */
  private lerpShots(a: BufferedSnapshot, b: BufferedSnapshot, frac: number): InterpolatedShot[] {
    const out: InterpolatedShot[] = [];
    const span = b.receivedMs - a.receivedMs;
    const maxStep = maxShotStep(span);
    for (const s of a.projectiles) {
      const next = b.projectiles.find((o) => o.id === s.id);
      // A slot whose meta changed is a *recycled* slot, not the same shot moving:
      // different owner or a turret shot where a ship shot was. Never lerp those.
      if (!next || next.meta !== s.meta) {
        out.push({ slot: s.id, x: s.posX, y: s.posY, meta: s.meta });
        continue;
      }
      const dx = next.posX - s.posX;
      const dy = next.posY - s.posY;
      if (dx * dx + dy * dy > maxStep * maxStep) {
        // Same slot, same owner, but further apart than any shot can fly in this
        // span — the slot was recycled by the same shooter. Draw the newer one.
        out.push({ slot: next.id, x: next.posX, y: next.posY, meta: next.meta });
        continue;
      }
      out.push({ slot: s.id, x: s.posX + dx * frac, y: s.posY + dy * frac, meta: s.meta });
    }
    // Shots that appear only in the later frame: freshly fired. Draw them at their
    // first known position rather than making the player wait a frame for them.
    for (const s of b.projectiles) {
      if (a.projectiles.some((o) => o.id === s.id)) continue;
      out.push({ slot: s.id, x: s.posX, y: s.posY, meta: s.meta });
    }
    return out;
  }

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

/** One buffered frame's shots, uninterpolated — the hold and extrapolate regimes.
 *  Shots are not extrapolated at all: with no velocity on the wire there is
 *  nothing to extrapolate *along*, and a stalled stream is exactly when guessing a
 *  shot's position would put a bright dot through a hull that never was hit. */
function shotsOf(entry: BufferedSnapshot): InterpolatedShot[] {
  return entry.projectiles.map((p) => ({ slot: p.id, x: p.posX, y: p.posY, meta: p.meta }));
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
