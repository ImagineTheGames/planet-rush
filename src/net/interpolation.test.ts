/**
 * src/net/interpolation.test.ts — the remote-entity interpolation buffer
 * (`./interpolation`, M10 reconcile-feel brief).
 *
 * The buffer's whole job is to make a remote ship's motion depend on the *stream*
 * of snapshots it has already received, not on the local player's RTT — so the
 * cases that matter are the three playback regimes (interpolate between two known
 * frames, hold before the buffer has filled, extrapolate briefly when it starves)
 * plus the one invariant the local ship must keep: it is predicted, never
 * interpolated, so it never appears here.
 */

import { describe, expect, it } from 'vitest';
import {
  DELAY_SLEW_MS,
  INTERP_DELAY_MS,
  MAX_DELAY_MS,
  MAX_EXTRAPOLATION_MS,
  MAX_SHOT_EXTRAPOLATION_MS,
  MIN_DELAY_MS,
  RemoteInterpolator,
  jitterDelayMs,
} from './interpolation';
import { dequantizeAngle } from './snapshot';
import type { DecodedSnapshot, ProjSnap, ShipSnap } from './snapshot';

const LOCAL = 0;
const REMOTE = 1;

function ship(id: number, x: number, y: number, extra: Partial<ShipSnap> = {}): ShipSnap {
  return { id, posX: x, posY: y, velX: 0, velY: 0, heading: 0, hull: 100, flags: 1, ...extra };
}

function snap(tick: number, ships: ShipSnap[]): DecodedSnapshot {
  return { tick, ships, projectiles: [] };
}

/** A heading (u16) that dequantizes to `radians`. */
function heading(radians: number): number {
  return Math.round((radians * 65536) / (2 * Math.PI)) & 0xffff;
}

describe('RemoteInterpolator', () => {
  it('interpolates a remote ship between the two bracketing snapshots', () => {
    const interp = new RemoteInterpolator({ local: LOCAL });
    interp.record(snap(0, [ship(REMOTE, 0, 0)]), 1000);
    interp.record(snap(2, [ship(REMOTE, 100, 40)]), 1100);

    // Render clock at 1150 → renderMs = 1050 (the INTERP_DELAY into the past),
    // exactly halfway between the 1000 and 1100 arrivals.
    const out = interp.sample(1050 + INTERP_DELAY_MS);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(REMOTE);
    expect(out[0]!.x).toBeCloseTo(50, 6);
    expect(out[0]!.y).toBeCloseTo(20, 6);
  });

  it('never returns the local ship — it stays predicted', () => {
    const interp = new RemoteInterpolator({ local: LOCAL });
    interp.record(snap(0, [ship(LOCAL, 0, 0), ship(REMOTE, 0, 0)]), 1000);
    interp.record(snap(2, [ship(LOCAL, 500, 0), ship(REMOTE, 100, 0)]), 1100);

    const out = interp.sample(1050 + INTERP_DELAY_MS);
    expect(out.map((s) => s.id)).toEqual([REMOTE]);
  });

  it('interpolates heading on the shortest arc', () => {
    const interp = new RemoteInterpolator({ local: LOCAL });
    interp.record(snap(0, [ship(REMOTE, 0, 0, { heading: heading(0) })]), 1000);
    interp.record(snap(2, [ship(REMOTE, 0, 0, { heading: heading(Math.PI / 2) })]), 1100);

    const out = interp.sample(1050 + INTERP_DELAY_MS);
    // Halfway from 0 to π/2 is π/4, the short way.
    expect(out[0]!.angle).toBeCloseTo(Math.PI / 4, 2);
  });

  it('holds the oldest snapshot before the buffer has filled to the delay', () => {
    const interp = new RemoteInterpolator({ local: LOCAL });
    interp.record(snap(0, [ship(REMOTE, 7, 3)]), 1000);

    // Render clock so recent that renderMs is before the oldest arrival: there is
    // nothing yet to interpolate toward, so the oldest is drawn as-is (no guess).
    const out = interp.sample(1000 + INTERP_DELAY_MS - 50);
    expect(out[0]!.x).toBe(7);
    expect(out[0]!.y).toBe(3);
  });

  it('extrapolates on velocity past the newest snapshot, capped', () => {
    const interp = new RemoteInterpolator({ local: LOCAL });
    interp.record(snap(0, [ship(REMOTE, 0, 0)]), 1000);
    interp.record(snap(2, [ship(REMOTE, 100, 0, { velX: 200 })]), 1100); // 200 u/s

    // renderMs 20 ms past the newest (nowMs = 1100 + INTERP_DELAY + 20): reach
    // forward 20 ms on 200 u/s = +4 units.
    const near = interp.sample(1100 + INTERP_DELAY_MS + 20);
    expect(near[0]!.x).toBeCloseTo(100 + 200 * 0.02, 6);

    // Far past the newest: extrapolation is capped at MAX_EXTRAPOLATION_MS so the
    // ship reaches forward a bounded amount and then holds, never flung.
    const far = interp.sample(1100 + INTERP_DELAY_MS + 5000);
    expect(far[0]!.x).toBeCloseTo(100 + 200 * (MAX_EXTRAPOLATION_MS / 1000), 6);
  });

  it('drops out-of-order and duplicate ticks so playback never rewinds', () => {
    const interp = new RemoteInterpolator({ local: LOCAL });
    interp.record(snap(5, [ship(REMOTE, 50, 0)]), 1000);
    interp.record(snap(3, [ship(REMOTE, 30, 0)]), 1010); // stale tick — ignored
    interp.record(snap(5, [ship(REMOTE, 55, 0)]), 1020); // duplicate tick — ignored
    expect(interp.bufferedCount).toBe(1);
  });

  it('returns nothing before any snapshot has been recorded', () => {
    expect(new RemoteInterpolator({ local: LOCAL }).sample(9999)).toEqual([]);
  });

  it('prunes stale snapshots but always keeps a bracket', () => {
    const interp = new RemoteInterpolator({ local: LOCAL, retainMs: 200 });
    interp.record(snap(0, [ship(REMOTE, 0, 0)]), 1000);
    interp.record(snap(2, [ship(REMOTE, 10, 0)]), 1100);
    interp.record(snap(4, [ship(REMOTE, 20, 0)]), 1200);
    // 1000 is now >200 ms behind the newest (1200) and is pruned, but the two most
    // recent always survive so an interpolation bracket still exists.
    interp.record(snap(6, [ship(REMOTE, 30, 0)]), 1400);
    expect(interp.bufferedCount).toBeGreaterThanOrEqual(2);
    expect(interp.bufferedCount).toBeLessThan(4);
    // Angle carried through as a real value.
    const out = interp.sample(1350 + INTERP_DELAY_MS);
    expect(typeof out[0]!.angle).toBe('number');
    expect(dequantizeAngle(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Shots (M10 netcode audit item 2b)
// ---------------------------------------------------------------------------

describe('streamed shots', () => {
  /** One shot on the wire. `vx`/`vy` default to the muzzle velocity implied by
   *  the 20-units-per-33 ms these tests fly their shots at (~600 u/s, a real
   *  speed), so a test that does not care about the heading still gets a
   *  consistent one. */
  const shot = (
    id: number,
    x: number,
    y: number,
    meta = 0b1001,
    velX = 600,
    velY = 0,
  ): ProjSnap => ({
    id,
    posX: x,
    posY: y,
    velX,
    velY,
    meta,
  });
  const frame = (tick: number, projectiles: ProjSnap[]): DecodedSnapshot => ({
    tick,
    ships: [],
    projectiles,
  });

  it('fly between snapshots instead of standing still and teleporting', () => {
    // The field report's "jumpy projectiles": the 6-byte record carries no
    // velocity, so before this a decoded shot sat at one position for 33 ms and
    // jumped to the next. Two snapshots ARE the velocity.
    const buffer = new RemoteInterpolator({ local: 0, delayMs: 100 });
    buffer.record(frame(2, [shot(1, 0, 0)]), 1_000);
    // 20 units in one 33 ms broadcast interval — ~600 u/s, a real muzzle speed.
    buffer.record(frame(4, [shot(1, 20, 0)]), 1_033);

    const half = buffer.sampleShots(1_116.5);
    expect(half).toHaveLength(1);
    expect(half[0]!.x).toBeCloseTo(10, 0);
    expect(half[0]!.slot).toBe(1);
    expect(half[0]!.meta).toBe(0b1001);
  });

  it('does not drag a recycled pool slot across the map', () => {
    // The slot a landed shot freed is reused by the next one fired. Interpolating
    // across that reuse would draw one bright dot travelling the whole arena.
    const buffer = new RemoteInterpolator({ local: 0, delayMs: 100 });
    buffer.record(frame(2, [shot(1, 0, 0)]), 1_000);
    buffer.record(frame(4, [shot(1, 900, 900, 0b1001, 424, 424)]), 1_033);

    // The render clock sits at frac 0.5 of the bracket, so the newer of the two
    // shots is the one drawn — flown back along ITS heading to the render instant
    // (16.5 ms before the frame arrived), never halfway between two unrelated
    // shots.
    const sampled = buffer.sampleShots(1_016.5 + 100);
    expect(sampled[0]!.x).toBeCloseTo(900 - 424 * 0.0165, 1);
    expect(sampled[0]!.y).toBeCloseTo(900 - 424 * 0.0165, 1);

    // …and early in the bracket it is the OLDER shot that is still live, so that
    // is the one drawn, on its own line.
    const early = buffer.sampleShots(1_005 + 100);
    expect(early[0]!.x).toBeCloseTo(600 * 0.005, 1);
    expect(early[0]!.y).toBeCloseTo(0, 5);
  });

  it('does not interpolate a slot whose owner or kind changed', () => {
    const buffer = new RemoteInterpolator({ local: 0, delayMs: 100 });
    buffer.record(frame(2, [shot(1, 0, 0, 0b1001)]), 1_000);
    buffer.record(frame(4, [shot(1, 10, 0, 0b1010)]), 1_033);

    // Early in the bracket the older shot is the live one: drawn on its own line,
    // never lerped toward a position that belongs to a different shooter's shot.
    const sampled = buffer.sampleShots(1_105);
    expect(sampled[0]!.meta).toBe(0b1001);
    expect(sampled[0]!.x).toBeCloseTo(600 * 0.005, 1);
  });

  it('does not interpolate a slot whose shot changed HEADING — the recycle a distance guard is too coarse to see', () => {
    // Mining: a shot dies on a rock a few tens of units out and the slot it frees
    // is taken by the same ship's next shot, fired somewhere else entirely. Same
    // owner, same kind, and only ~20 u apart — inside `maxShotStep`, so before the
    // wire carried a heading the two were indistinguishable and the dot crabbed
    // from one shot's position toward the other's.
    const buffer = new RemoteInterpolator({ local: 0, delayMs: 100 });
    buffer.record(frame(2, [shot(1, 0, 0, 0b1001, 600, 0)]), 1_000);
    buffer.record(frame(4, [shot(1, 18, 4, 0b1001, 0, 600)]), 1_033);

    // Drawn off the older record on ITS heading (+x), never dragged toward the
    // newer one's (18, 4) — which a chord would have done, at 5 u off the line the
    // shot was actually fired on.
    const sampled = buffer.sampleShots(1_105);
    expect(sampled[0]!.x).toBeCloseTo(600 * 0.005, 1);
    expect(sampled[0]!.y).toBeCloseTo(0, 5);

    // …and once the render clock is past the halfway mark it is the newer shot
    // that is live, drawn on ITS heading (+y). Either way one dot travels one real
    // line; what never happens is a dot on the line between the two.
    const late = buffer.sampleShots(1_128);
    expect(late[0]!.x).toBeCloseTo(18, 5);
    expect(late[0]!.y).toBeCloseTo(4 - 600 * 0.005, 1);
  });

  it('a shot that appears only in the later frame is already travelling, not parked at the muzzle', () => {
    const buffer = new RemoteInterpolator({ local: 0, delayMs: 100 });
    buffer.record(frame(2, [shot(1, 0, 0)]), 1_000);
    buffer.record(frame(4, [shot(1, 20, 0), shot(2, 500, 500, 0b1001, 600, 0)]), 1_033);

    const sampled = buffer.sampleShots(1_116.5);
    expect(sampled.map((s) => s.slot).sort()).toEqual([1, 2]);
    // Slot 2 is freshly fired: no earlier record to chord across, so it is flown
    // BACK along its own heading to the render instant (16.5 ms before the frame
    // arrived) instead of standing at 500 for a whole bracket.
    const fresh = sampled.find((s) => s.slot === 2)!;
    expect(fresh.x).toBeCloseTo(500 - 600 * 0.0165, 1);
    expect(fresh.y).toBeCloseTo(500, 5);
  });

  it('a remote shot keeps the heading it was fired on', () => {
    // a0-73, and the developer's whole report: "other players shots dont follow
    // the direction they were fired in."
    //
    // A shot arrives on a diagonal at 600 u/s. Then the snapshots STOP — packet
    // loss, a mobile radio, a backgrounded tab. Before the wire carried a heading
    // this dot stopped dead with them, because the only thing that had ever moved
    // it was the next packet: at a 200 ms gap it sat 104 world units behind where
    // its own heading had it, a third of the ship weapon's entire reach, and then
    // teleported when the stream came back. A player reading that line to decide
    // whether to move into it was reading a lie (GDD §2.6 — the dodge is the
    // skill, and it is read off the line).
    const buffer = new RemoteInterpolator({ local: 0, delayMs: 100 });
    const vx = 600 * Math.cos(Math.PI / 4);
    const vy = 600 * Math.sin(Math.PI / 4);
    buffer.record(frame(2, [shot(1, 0, 0, 0b1001, vx, vy)]), 1_000);
    buffer.record(frame(4, [shot(1, vx * 0.0333, vy * 0.0333, 0b1001, vx, vy)]), 1_033);

    // …and nothing more arrives. Sample across the whole silence.
    const anchor = buffer.sampleShots(1_133); // last instant the pair still brackets
    const path = [1_150, 1_180, 1_220, 1_260].map((t) => buffer.sampleShots(t)[0]!);

    for (const dot of [anchor[0]!, ...path]) {
      // ON its own line: the cross product against the fired heading is zero.
      const cross = Math.abs(dot.x * (vy / 600) - dot.y * (vx / 600));
      expect(cross).toBeLessThan(0.001);
      // …and carrying that heading, so anything reading the world gets it too.
      expect(dot.vx).toBeCloseTo(vx, 6);
      expect(dot.vy).toBeCloseTo(vy, 6);
    }

    // TRAVELLING it, not frozen on it — the half of the defect a cross-track
    // measurement alone reports as clean. Each sample is strictly further along
    // than the last, at the speed the wire named.
    const along = [anchor[0]!, ...path].map((d) => (d.x * vx + d.y * vy) / 600);
    for (let i = 1; i < along.length; i++) expect(along[i]!).toBeGreaterThan(along[i - 1]!);
    // 127 ms of silence past the newest snapshot at 600 u/s ≈ 76 u further on.
    expect(along[along.length - 1]! - along[0]!).toBeCloseTo(600 * 0.127, 0);

    // And it does NOT drift toward the next packet's position. The stream resumes
    // somewhere else entirely — a recycled slot, a different shooter — and the
    // dot's history is untouched by it: everything above was sampled and asserted
    // before this frame existed.
    buffer.record(frame(40, [shot(1, -900, 700, 0b1001, -600, 0)]), 1_400);
    const after = buffer.sampleShots(1_260)[0]!;
    expect(after.x).toBeCloseTo(path[path.length - 1]!.x, 6);
    expect(after.y).toBeCloseTo(path[path.length - 1]!.y, 6);
  });

  it('stops reaching once the silence is longer than a shot can be trusted to still exist', () => {
    // Dead reckoning a shot is replayed arithmetic, not a guess — but the shot may
    // have landed, so the reach is capped (`MAX_SHOT_EXTRAPOLATION_MS`) and then it
    // holds. A ghost dot for a few frames costs a player nothing; a shot invented
    // for a whole second would.
    const buffer = new RemoteInterpolator({ local: 0, delayMs: 0 });
    buffer.record(frame(2, [shot(1, 0, 0, 0b1001, 600, 0)]), 1_000);

    const capped = buffer.sampleShots(1_000 + MAX_SHOT_EXTRAPOLATION_MS);
    const beyond = buffer.sampleShots(5_000);
    expect(capped[0]!.x).toBeCloseTo(600 * (MAX_SHOT_EXTRAPOLATION_MS / 1000), 6);
    expect(beyond[0]!.x).toBe(capped[0]!.x);
  });
});

describe('the jitter buffer sizes itself (audit item 2d)', () => {
  it('asks for the standard delay before anything has been measured', () => {
    expect(jitterDelayMs(null)).toBe(INTERP_DELAY_MS);
  });

  it('asks for less on a clean wire and more on a jittery one, inside its range', () => {
    expect(jitterDelayMs(0)).toBe(MIN_DELAY_MS);
    expect(jitterDelayMs(20)).toBe(MIN_DELAY_MS + 2 * 20);
    // Clamped at both ends: a pathological measurement cannot make remote ships
    // unleadable (GDD §2.6 is a game of leading moving targets).
    expect(jitterDelayMs(10_000)).toBe(MAX_DELAY_MS);
  });

  it('slides to its new size rather than jumping there', () => {
    const buffer = new RemoteInterpolator({ local: 0 });
    const opened = buffer.delayMs;
    const after = buffer.resize(0);
    expect(after).toBeLessThan(opened);
    expect(opened - after).toBeLessThanOrEqual(DELAY_SLEW_MS);

    // ...and it gets there eventually.
    for (let i = 0; i < 200; i++) buffer.resize(0);
    expect(buffer.delayMs).toBe(MIN_DELAY_MS);
  });

  it('is pinned when a caller passed an explicit delay — a reproducible test wants one', () => {
    const buffer = new RemoteInterpolator({ local: 0, delayMs: 80 });
    buffer.resize(0);
    buffer.resize(500);
    expect(buffer.delayMs).toBe(80);
  });
});
