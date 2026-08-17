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
import { dequantizeAngle, projIsShipShot, projOwner } from './snapshot';
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

/**
 * The same cap for a **shot**, and it is five times the ship one on purpose
 * (a0-73).
 *
 * A ship is capped tight because extrapolating one is a *guess*: a pilot can
 * thrust, turn or stop inside the reach, so every millisecond past the last
 * snapshot is another millisecond of overshoot to snap back from — which is the
 * whole argument the module header opens with.
 *
 * A shot cannot do any of those things. It takes no input, carries no
 * acceleration, and flies one straight line at one constant speed from the
 * instant it leaves the barrel until it hits something or expires
 * (`src/sim/projectiles.ts`). Reaching forward along a velocity the wire handed
 * us is therefore not extrapolation in the risky sense at all — it is replaying
 * arithmetic the server is doing with the same two numbers. The only thing that
 * *can* go wrong is drawing a shot that has already landed, and the trade there is
 * not symmetric: a ghost dot for a few frames costs a player nothing, while a
 * frozen dot invites them to move into a line that is live (GDD §2.6 — the dodge
 * is the skill, and it is read off the line).
 *
 * 200 ms covers a six-snapshot loss burst at the 30 Hz broadcast rate. It is 58 %
 * of the shortest shot life in the game (a turret's `range / projectileSpeed` =
 * 343 ms) and 35 % of a stock ship shot's 577 ms, so a ghost can never outlive its
 * shot by more than a fraction of one flight. Past it the shot holds, because a
 * stall longer than this is a wire the acceptance gate should fail rather than one
 * the buffer should keep inventing a match for.
 */
export const MAX_SHOT_EXTRAPOLATION_MS = 200;

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
 *
 * `vx` / `vy` are the line the shot was fired on, off the wire (`./snapshot`
 * `ProjSnap`). They are both how this sample was placed and what the presentation
 * layer writes into the pool slot, so the world a renderer reads carries a shot's
 * real heading rather than whatever the slot's previous occupant left behind.
 */
export interface InterpolatedShot {
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  /** Muzzle velocity, world units per second. */
  readonly vx: number;
  readonly vy: number;
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
  private readonly shotReachMs: number;
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
    /** How far a SHOT may fly past the newest (or before the oldest) snapshot,
     *  ms. Default {@link MAX_SHOT_EXTRAPOLATION_MS} — deliberately far longer
     *  than `maxExtrapolationMs`, for the reason written on that constant. */
    readonly shotReachMs?: number;
    readonly retainMs?: number;
    readonly maxEntries?: number;
    /** Per-adjustment slew limit, ms. Default {@link DELAY_SLEW_MS}. */
    readonly slewMs?: number;
  }) {
    this.local = config.local;
    this.adaptive = config.delayMs === undefined;
    this.delayMsValue = config.delayMs ?? INTERP_DELAY_MS;
    this.maxExtrapolationMs = config.maxExtrapolationMs ?? MAX_EXTRAPOLATION_MS;
    this.shotReachMs = config.shotReachMs ?? MAX_SHOT_EXTRAPOLATION_MS;
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
      // The firer's own shots are dropped **here**, on the way in, so every
      // playback path below is covered by construction rather than by four
      // remembering to do it (`withoutOwnShots`).
      projectiles: withoutOwnShots(snapshot.projectiles, this.local),
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
   * **A shot advances along its own heading, in every regime** (a0-73). The
   * developer, from a live online match: *"other players shots dont follow the
   * direction they were fired in."* They did not. This method used to have exactly
   * one way of moving a shot — chord-interpolation between two snapshots that
   * bracket it — and no way at all when there was no such pair. The chord itself is
   * fine: measured against the ray the sim fired the shot on, an interpolated dot
   * sits **0.026 u** off it on average (evidence/a0-73-remote-shots). The failure
   * was everything either side of the chord, and it was a *freeze*:
   *
   *  - the first snapshot a shot appears in has no earlier record to pair with, so
   *    the dot sat at the muzzle for a bracket — one frozen frame per shot, on the
   *    frame a player reads the line to decide whether to move into it;
   *  - the last one has no later record, so it sat again;
   *  - and for the whole of any gap in the stream — packet loss, a mobile radio, a
   *    backgrounded tab — every shot on screen stopped dead. Measured at a 200 ms
   *    gap: **104 world units** behind where its own heading had it, a third of the
   *    ship weapon's entire 300-unit reach, and then a 104-unit teleport when the
   *    stream resumed.
   *
   * A frozen shot's cross-track error is zero — it is *on* its line, just not
   * *travelling* it — and that distinction is worth nothing to the player the brief
   * is about. Shots are the one entity where the heading IS the gameplay, so a dot
   * that honours its line only while the packets flow is a fairness defect, not a
   * smoothness one.
   *
   * So the wire carries the velocity now (`./snapshot` `ProjSnap`, 2 B per shot)
   * and every regime here uses it. Where a bracketing pair exists the chord still
   * wins — it is anchored at two known positions and cannot drift — and the
   * velocity is used to *validate* the pair instead ({@link lerpShots}). Everywhere
   * else the shot flies, forward or backward, capped by
   * {@link MAX_SHOT_EXTRAPOLATION_MS}.
   *
   * The local player's own ship shots are absent from this stream by the time it
   * gets here — the reconcile path suppresses them so the firer sees their own
   * predicted shot instead of a copy trailing one round trip behind
   * (`./prediction`, audit item 2b).
   */
  sampleShots(nowMs: number): InterpolatedShot[] {
    const at = this.bracket(nowMs);
    if (at === null) return [];
    if (at.mode === 'interpolate') return this.lerpShots(at.a, at.b, at.frac, at.renderMs);
    // Hold and extrapolate are the same arithmetic with opposite signs: the render
    // clock is before the only snapshot we have, or after it. A shot flies a
    // straight line either way, so it is reached to rather than held at.
    return flyShots(at.a, at.renderMs - at.a.receivedMs, this.shotReachMs);
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
   * Interpolate every shot present in both snapshots, in the same pool slot and on
   * the same fired line. A slot present in only one of the two is a shot with no
   * pair to chord across — freshly fired, or landed between the two frames — and it
   * **flies its own heading** to the render instant rather than sitting where its
   * one packet put it (a0-73).
   */
  private lerpShots(
    a: BufferedSnapshot,
    b: BufferedSnapshot,
    frac: number,
    renderMs: number,
  ): InterpolatedShot[] {
    const out: InterpolatedShot[] = [];
    const span = b.receivedMs - a.receivedMs;
    const maxStep = maxShotStep(span);
    for (const s of a.projectiles) {
      const next = b.projectiles.find((o) => o.id === s.id);
      // Three ways the same pool slot can hold two DIFFERENT shots across a pair,
      // and all three must refuse the chord — one dot lerped between two shots is
      // a dot travelling a line neither of them flew.
      //
      //  - the meta changed: a different owner, or a turret shot where a ship shot
      //    was;
      //  - the VELOCITY changed (a0-73, and the sharpest of the three): a shot's
      //    muzzle vector is constant for its whole life, so the same shot encodes
      //    to the identical quantized pair every snapshot and two independent
      //    shots agreeing to within 1.4° AND 4 u/s is a coincidence, not a match.
      //    This is the guard that catches a recycled slot whose new shot happens to
      //    spawn near where the old one died — mining, where a shot dies on a rock
      //    a few tens of units out and the freed slot is taken by the next one
      //    fired, which `maxShotStep` alone is far too coarse to see;
      //  - the positions are further apart than any muzzle in the game could carry
      //    a shot in this span.
      //
      // The slot has to clear all three to be chorded.
      const sameShot =
        next !== undefined &&
        next.meta === s.meta &&
        next.velX === s.velX &&
        next.velY === s.velY &&
        sq(next.posX - s.posX) + sq(next.posY - s.posY) <= maxStep * maxStep;
      if (!sameShot) {
        // No chord to draw. One dot cannot be two shots, so it is drawn as
        // whichever of them the render clock is NEARER to — the same rule the ship
        // lerp uses for a discrete field, for the same reason — and flown along
        // that shot's own heading to the instant being rendered. Before a0-73 this
        // branch could only park the dot at a stored position; now it is the one
        // place in the method that has two candidate lines rather than none, and it
        // picks one and travels it instead of averaging them into a third that
        // neither shot flew.
        const pick = next && frac >= 0.5 ? next : s;
        const from = next && frac >= 0.5 ? b : a;
        out.push(flyShot(pick, renderMs - from.receivedMs, this.shotReachMs));
        continue;
      }
      const dx = next.posX - s.posX;
      const dy = next.posY - s.posY;
      out.push({ slot: s.id, x: s.posX + dx * frac, y: s.posY + dy * frac, vx: s.velX, vy: s.velY, meta: s.meta });
    }
    // Shots that appear only in the later frame: freshly fired. Flown BACK from
    // their first known position to the render instant, so the dot is already
    // travelling its line on the frame it appears rather than standing at the
    // muzzle for a bracket. The reach is negative and bounded by the span, so the
    // worst it can do is show a shot up to one broadcast interval early — against
    // the certainty, before this, of showing it a whole interval late and still.
    for (const s of b.projectiles) {
      if (a.projectiles.some((o) => o.id === s.id)) continue;
      out.push(flyShot(s, Math.max(renderMs - b.receivedMs, -span), this.shotReachMs));
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

/**
 * One shot flown along its own muzzle velocity by `dtMs`, clamped to `reachMs` in
 * both directions — the whole of "advance a remote shot by the heading it was
 * fired on" (a0-73), in one place so every regime in {@link RemoteInterpolator}
 * does it identically.
 *
 * A negative `dtMs` reaches backward, which is the same straight line read the
 * other way: the render clock sits before the only record we hold of this shot.
 */
function flyShot(shot: ProjSnap, dtMs: number, reachMs: number): InterpolatedShot {
  const dt = Math.max(-reachMs, Math.min(reachMs, dtMs)) / 1000;
  return {
    slot: shot.id,
    x: shot.posX + shot.velX * dt,
    y: shot.posY + shot.velY * dt,
    vx: shot.velX,
    vy: shot.velY,
    meta: shot.meta,
  };
}

/** One buffered frame's shots, each flown by the same offset — the hold and the
 *  extrapolate regimes, which are one operation with opposite signs. */
function flyShots(entry: BufferedSnapshot, dtMs: number, reachMs: number): InterpolatedShot[] {
  return entry.projectiles.map((p) => flyShot(p, dtMs, reachMs));
}

/**
 * One snapshot's projectiles with the **local player's own ship shots removed** —
 * the fix for *"shooting produces 2 sets of shots"* (M10 action-echo).
 *
 * The firer draws their own shots from prediction, spawned the instant the trigger
 * went down and flown on this client's own physics; the reconcile path suppresses
 * authority's copy of them for exactly that reason (`./prediction` `applySnapshot`
 * `suppressShipShotsFrom`). But suppression there only ever touched the *world* —
 * the snapshot handed to this buffer was the raw decode, own shots and all, and the
 * presentation layer then drew everything the buffer sampled straight into the pool
 * slots the wire owns (`./presentation`). So the predicted volley and the
 * authoritative volley were both on screen, one round trip apart, in different pool
 * slots, neither aware of the other. Two sets of shots from one trigger pull — and
 * the module header above has claimed since it was written that they were "absent
 * from this stream by the time it gets here", which they were not.
 *
 * Dropped on ingest rather than on sample, so `hold`, `extrapolate` and
 * `interpolate` cannot disagree about it, and so the buffered *history* a later
 * frame lerps through is already clean. Allocates only when there is something to
 * drop — a client that is not shooting keeps the decoder's own array.
 */
function withoutOwnShots(projectiles: readonly ProjSnap[], local: PlayerId): readonly ProjSnap[] {
  let kept: ProjSnap[] | null = null;
  for (let i = 0; i < projectiles.length; i++) {
    const shot = projectiles[i]!;
    if (projIsShipShot(shot.meta) && projOwner(shot.meta) === local) {
      kept ??= projectiles.slice(0, i);
      continue;
    }
    kept?.push(shot);
  }
  return kept ?? projectiles;
}

const sq = (v: number): number => v * v;

/** Shortest-arc angle interpolation, radians. */
function lerpAngle(a: number, b: number, frac: number): number {
  const TAU = Math.PI * 2;
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta < -Math.PI) delta += TAU;
  const result = a + delta * frac;
  return ((result % TAU) + TAU) % TAU;
}
