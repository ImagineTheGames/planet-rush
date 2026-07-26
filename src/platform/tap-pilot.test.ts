/**
 * src/platform/tap-pilot.test.ts — the Tap Commander pilot, headless.
 *
 * The pilot is pure geometry over a device-neutral control state (tap-pilot.ts),
 * so its whole contract unit-tests without a browser: it converges to a waypoint,
 * damps at arrival, holds firing range against a locked target, and drops a lock
 * when the target dies. A crude Euler integrator stands in for the sim's ship
 * physics — enough to prove the pilot *drives toward* its order, which is all the
 * pilot is responsible for (the sim owns the real motion).
 */
import { describe, it, expect } from 'vitest';
import { createControlState } from './actions';
import {
  TapPilot,
  pickTapTarget,
  TAP_SLOP,
  type TapCandidate,
  type ResolvedTarget,
  type PilotShip,
} from './tap-pilot';

const cand = (over: Partial<TapCandidate>): TapCandidate => ({
  kind: 'ship',
  id: 0,
  pos: { x: 0, y: 0 },
  radius: 16,
  hostile: true,
  ...over,
});

describe('pickTapTarget — tap → lock or empty-space move (developer §2)', () => {
  it('empty space selects nothing (a move order)', () => {
    const cs = [cand({ id: 1, pos: { x: 0, y: 0 }, radius: 16 })];
    expect(pickTapTarget(cs, { x: 500, y: 500 })).toBeNull();
  });

  it('a tap inside an entity locks it', () => {
    const rock = cand({ kind: 'asteroid', id: 7, pos: { x: 100, y: 100 }, radius: 30 });
    expect(pickTapTarget([rock], { x: 110, y: 105 })).toBe(rock);
  });

  it('the slop radius forgives a near-miss on a small target', () => {
    const rock = cand({ kind: 'asteroid', id: 7, pos: { x: 0, y: 0 }, radius: 8 });
    // Just outside the body but inside body+slop.
    expect(pickTapTarget([rock], { x: 8 + TAP_SLOP - 1, y: 0 })).toBe(rock);
    expect(pickTapTarget([rock], { x: 8 + TAP_SLOP + 5, y: 0 })).toBeNull();
  });

  it('overlapping hits resolve to the nearest centre', () => {
    const planet = cand({ kind: 'planet', id: 1, pos: { x: 0, y: 0 }, radius: 64, hostile: false });
    const rock = cand({ kind: 'asteroid', id: 2, pos: { x: 20, y: 0 }, radius: 20 });
    // A tap right on the rock centre is inside both, but nearer the rock.
    expect(pickTapTarget([planet, rock], { x: 20, y: 0 })).toBe(rock);
  });
});

/** Integrate the pilot for `steps`, applying its thrust as a simple velocity so
 *  the ship actually moves toward its order. Returns the final ship position and
 *  whether the pilot still holds an order. */
function fly(
  pilot: TapPilot,
  start: Vec2Mut,
  resolve: () => ResolvedTarget | null,
  steps: number,
  speed = 12,
): { pos: Vec2Mut; hasOrder: boolean; lastFire: boolean } {
  const ship: PilotShip = { pos: start, radius: 16 };
  const state = createControlState();
  let lastFire = false;
  for (let i = 0; i < steps; i++) {
    resetState(state);
    pilot.writeInto(state, ship, resolve());
    start.x += state.thrust.x * speed;
    start.y += state.thrust.y * speed;
    lastFire = state.fire;
  }
  return { pos: start, hasOrder: pilot.currentOrder !== null, lastFire };
}

type Vec2Mut = { x: number; y: number };
function resetState(s: ReturnType<typeof createControlState>): void {
  s.thrust.x = 0;
  s.thrust.y = 0;
  s.aim = null;
  s.fire = false;
}

describe('TapPilot — waypoint (tap empty space → move there)', () => {
  it('thrusts toward the waypoint', () => {
    const pilot = new TapPilot();
    pilot.orderMove({ x: 300, y: 0 });
    const state = createControlState();
    pilot.writeInto(state, { pos: { x: 0, y: 0 }, radius: 16 }, null);
    expect(state.thrust.x).toBeGreaterThan(0);
    expect(state.thrust.y).toBeCloseTo(0, 6);
  });

  it('converges to the waypoint and clears the order on arrival', () => {
    const pilot = new TapPilot();
    pilot.orderMove({ x: 400, y: 120 });
    const out = fly(pilot, { x: 0, y: 0 }, () => null, 200);
    expect(Math.hypot(out.pos.x - 400, out.pos.y - 120)).toBeLessThanOrEqual(30);
    expect(out.hasOrder).toBe(false); // arrived → order cleared
  });

  it('damps at arrival — thrust magnitude shrinks as the ship nears the point', () => {
    const pilot = new TapPilot({ slowRadius: 160, arriveRadius: 10 });
    pilot.orderMove({ x: 200, y: 0 });
    const far = createControlState();
    pilot.writeInto(far, { pos: { x: 0, y: 0 }, radius: 16 }, null); // 200 away → full
    const near = createControlState();
    pilot.writeInto(near, { pos: { x: 160, y: 0 }, radius: 16 }, null); // 40 away → damped
    expect(Math.hypot(far.thrust.x, far.thrust.y)).toBeCloseTo(1, 5);
    expect(Math.hypot(near.thrust.x, near.thrust.y)).toBeLessThan(0.5);
  });

  it('a fresh move order replaces a lock', () => {
    const pilot = new TapPilot();
    pilot.lockTarget({ kind: 'ship', id: 3 });
    expect(pilot.lockedRef).not.toBeNull();
    pilot.orderMove({ x: 10, y: 10 });
    expect(pilot.lockedRef).toBeNull();
    expect(pilot.waypoint).toEqual({ x: 10, y: 10 });
  });
});

describe('TapPilot — target (tap an entity → lock, close, hold, fire)', () => {
  const hostileAt = (x: number, y: number, radius = 16): ResolvedTarget => ({
    pos: { x, y },
    radius,
    hostile: true,
  });

  it('aims at the locked target and fires once in range', () => {
    const pilot = new TapPilot({ fireRange: 220 });
    pilot.lockTarget({ kind: 'ship', id: 5 });
    const state = createControlState();
    // 100 apart (surface gap ≈ 100 − 16 − 16 = 68 < fireRange) → in range.
    pilot.writeInto(state, { pos: { x: 0, y: 0 }, radius: 16 }, hostileAt(100, 0));
    expect(state.aim).not.toBeNull();
    expect(state.aim!.x).toBeGreaterThan(0);
    expect(state.fire).toBe(true);
  });

  it('holds fire while still far out of range', () => {
    const pilot = new TapPilot({ fireRange: 220, engageRange: 150 });
    pilot.lockTarget({ kind: 'ship', id: 5 });
    const state = createControlState();
    pilot.writeInto(state, { pos: { x: 0, y: 0 }, radius: 16 }, hostileAt(1000, 0));
    expect(state.fire).toBe(false); // out of range, but still closing
    expect(state.thrust.x).toBeGreaterThan(0);
  });

  it('closes to and holds firing range against a stationary target', () => {
    const pilot = new TapPilot({ engageRange: 150, rangeHysteresis: 32, fireRange: 220 });
    pilot.lockTarget({ kind: 'ship', id: 5 });
    const target = hostileAt(1200, 0);
    const out = fly(pilot, { x: 0, y: 0 }, () => target, 400);
    const surface = Math.abs(1200 - out.pos.x) - 16 - 16;
    // Settled within the standoff dead-band, not sitting on top of the target.
    expect(surface).toBeGreaterThan(150 - 40);
    expect(surface).toBeLessThan(150 + 60);
    expect(out.hasOrder).toBe(true); // a lock is never "arrived"; it holds
    expect(out.lastFire).toBe(true); // and keeps firing while held in range
  });

  it('backs off when it has drifted too close to a hostile', () => {
    const pilot = new TapPilot({ engageRange: 150, rangeHysteresis: 32 });
    pilot.lockTarget({ kind: 'ship', id: 5 });
    const state = createControlState();
    // Surface gap ≈ 40 − 32 = 8, well inside 150 − hysteresis → thrust away.
    pilot.writeInto(state, { pos: { x: 0, y: 0 }, radius: 16 }, hostileAt(72, 0));
    expect(state.thrust.x).toBeLessThan(0); // away from the target at +x
  });

  it('drops the lock the frame the target dies (resolver returns null)', () => {
    const pilot = new TapPilot();
    pilot.lockTarget({ kind: 'ship', id: 5 });
    const state = createControlState();
    pilot.writeInto(state, { pos: { x: 0, y: 0 }, radius: 16 }, null); // dead → gone
    expect(pilot.currentOrder).toBeNull();
    expect(state.fire).toBe(false);
  });

  it('an own-planet fly-to holds at its atmosphere and never fires', () => {
    const pilot = new TapPilot();
    pilot.lockTarget({ kind: 'planet', id: 0 });
    const friendly: ResolvedTarget = { pos: { x: 600, y: 0 }, radius: 64, hostile: false, standoff: 40 };
    const out = fly(pilot, { x: 0, y: 0 }, () => friendly, 300);
    // Flew to the planet's atmosphere (near it), fired nothing on the way.
    expect(Math.abs(600 - out.pos.x) - 64 - 16).toBeLessThan(120);
    expect(out.lastFire).toBe(false);
    // A friendly hold emits no aim (nothing to shoot at).
    const state = createControlState();
    pilot.writeInto(state, { pos: { x: 500, y: 0 }, radius: 16 }, friendly);
    expect(state.aim).toBeNull();
  });
});
