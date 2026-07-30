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
import { INTERP_DELAY_MS, MAX_EXTRAPOLATION_MS, RemoteInterpolator } from './interpolation';
import { dequantizeAngle } from './snapshot';
import type { DecodedSnapshot, ShipSnap } from './snapshot';

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
