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

  it('drops the lock the frame the target dies (resolver returns null) and reverts to auto-engage', () => {
    const pilot = new TapPilot();
    pilot.lockTarget({ kind: 'ship', id: 5 });
    const state = createControlState();
    pilot.writeInto(state, { pos: { x: 0, y: 0 }, radius: 16 }, null); // dead → gone
    expect(pilot.currentOrder).toBeNull(); // the lock is dropped (developer §2)
    // The ship does not go passive: with no lock the pilot auto-engages, holding the
    // trigger for the sim's Auto-aim ladder (developer p9-02 §1). Aim stays null (the
    // sim acquires), and no thrust is written — the ship coasts while it fights.
    expect(state.fire).toBe(true);
    expect(state.aim).toBeNull();
    expect(state.thrust.x).toBe(0);
    expect(state.thrust.y).toBe(0);
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

// The tractor pickup radius the wiring feeds the pilot (the sim's
// TRACTOR_PICKUP_RADIUS, aliasing TRACTOR.range). Named here so the pilot stays
// sim-free while the test asserts against the same number the wiring uses.
const PICKUP_RADIUS = 120;
/** A fire range comfortably past the rock hold, mirroring the wiring's
 *  `WEAPON_RANGE * 0.82` — so a rock held inside the pickup radius is well in range. */
const WEAPON_FIRE = 220;

describe('TapPilot — auto-engage is the default (no lock → fly/idle + fire the ladder pick, developer p9-02 §1)', () => {
  it('holds the trigger while flying a waypoint, and the waypoint still progresses (movement ⟂ fire)', () => {
    const pilot = new TapPilot();
    pilot.orderMove({ x: 400, y: 0 });
    const state = createControlState();
    pilot.writeInto(state, { pos: { x: 0, y: 0 }, radius: 16 }, null);
    // Fires (holds the trigger for the sim's Auto-aim ladder) AND thrusts toward the
    // waypoint — the two are independent, like a twin-stick player.
    expect(state.fire).toBe(true);
    expect(state.thrust.x).toBeGreaterThan(0);
    // Aim stays null: the sim acquires the target across the full 360° in Auto-aim.
    expect(state.aim).toBeNull();
    // And the waypoint order still stands and converges (it did not fire in place).
    const out = fly(pilot, { x: 0, y: 0 }, () => null, 8);
    expect(out.pos.x).toBeGreaterThan(0);
    expect(out.lastFire).toBe(true);
  });

  it('holds the trigger while idle (no order) and coasts — no thrust', () => {
    const pilot = new TapPilot();
    const state = createControlState();
    pilot.writeInto(state, { pos: { x: 0, y: 0 }, radius: 16 }, null);
    expect(state.fire).toBe(true);
    expect(state.thrust.x).toBe(0);
    expect(state.thrust.y).toBe(0);
    expect(state.aim).toBeNull();
    expect(pilot.currentOrder).toBeNull();
  });

  it('a friendly own-planet fly-to is a lock, not auto-engage: it never fires', () => {
    const pilot = new TapPilot();
    pilot.lockTarget({ kind: 'planet', id: 0 });
    const friendly: ResolvedTarget = { pos: { x: 600, y: 0 }, radius: 64, hostile: false, standoff: 40 };
    const state = createControlState();
    pilot.writeInto(state, { pos: { x: 0, y: 0 }, radius: 16 }, friendly);
    // The lock path runs and returns before auto-engage — a friendly hold holds fire.
    expect(state.fire).toBe(false);
  });
});

describe('TapPilot — an asteroid lock holds INSIDE the tractor pickup radius (developer p9-02 §2 range fix)', () => {
  const rockAt = (x: number, y: number, radius = 30): ResolvedTarget => ({
    pos: { x, y },
    radius,
    hostile: true,
    mineable: true, // the wiring marks a rock lock mineable
  });

  it('closes to a hold whose CENTRE sits inside the tractor pickup radius (assert the number)', () => {
    const pilot = new TapPilot({ pickupRadius: PICKUP_RADIUS, fireRange: WEAPON_FIRE, engageRange: 130 });
    pilot.lockTarget({ kind: 'asteroid', id: 9 });
    const rock = rockAt(1200, 0, 30);
    const out = fly(pilot, { x: 0, y: 0 }, () => rock, 500);
    const centreDist = Math.abs(1200 - out.pos.x);
    // The whole point of the fix: the ship's centre ends up within the grab range, so
    // the chipped ore actually reaches the hold (it does NOT sit back at combat range).
    expect(centreDist).toBeLessThanOrEqual(PICKUP_RADIUS);
    // Still holding + firing on the rock (it is a mine, not an arrival).
    expect(out.hasOrder).toBe(true);
    expect(out.lastFire).toBe(true);
  });

  it('holds NEARER than the combat standoff would — and leaves the enemy hold unchanged', () => {
    const rock = rockAt(1200, 0, 30);
    const enemy: ResolvedTarget = { pos: { x: 1200, y: 0 }, radius: 30, hostile: true }; // same body, not mineable

    const rockPilot = new TapPilot({ pickupRadius: PICKUP_RADIUS, engageRange: 130, fireRange: WEAPON_FIRE });
    rockPilot.lockTarget({ kind: 'asteroid', id: 1 });
    const rockOut = fly(rockPilot, { x: 0, y: 0 }, () => rock, 500);

    const enemyPilot = new TapPilot({ pickupRadius: PICKUP_RADIUS, engageRange: 130, fireRange: WEAPON_FIRE });
    enemyPilot.lockTarget({ kind: 'ship', id: 2 });
    const enemyOut = fly(enemyPilot, { x: 0, y: 0 }, () => enemy, 500);

    const rockCentre = Math.abs(1200 - rockOut.pos.x);
    const enemyCentre = Math.abs(1200 - enemyOut.pos.x);
    // The rock is grabbed close; the enemy is still held at the combat standoff, well
    // outside the pickup radius (the fix touches ONLY mineable targets).
    expect(rockCentre).toBeLessThan(enemyCentre);
    expect(enemyCentre).toBeGreaterThan(PICKUP_RADIUS);
  });
});

describe('TapPilot — a lock overrides the auto-engage ladder (developer p9-02 §1)', () => {
  it('a hostile lock aims EXPLICITLY (not the blind auto-engage trigger)', () => {
    const pilot = new TapPilot({ fireRange: 220 });
    pilot.lockTarget({ kind: 'ship', id: 5 });
    const state = createControlState();
    pilot.writeInto(state, { pos: { x: 0, y: 0 }, radius: 16 }, { pos: { x: 100, y: 0 }, radius: 16, hostile: true });
    // The lock path writes an explicit aim — the tell that it, not the null-aim
    // auto-engage, is driving this frame (so the wiring maps it in Manual).
    expect(state.aim).not.toBeNull();
    expect(state.aim!.x).toBeGreaterThan(0);
    expect(state.fire).toBe(true);
  });
});

describe('TapPilot — determinism (same orders + frames → identical control states)', () => {
  it('two pilots fed identical orders and resolves write byte-identical state each frame', () => {
    const mk = (): TapPilot => new TapPilot({ pickupRadius: PICKUP_RADIUS });
    const a = mk();
    const b = mk();
    const rock: ResolvedTarget = { pos: { x: 500, y: 120 }, radius: 30, hostile: true, mineable: true };
    const script: Array<() => void> = [
      () => { a.orderMove({ x: 400, y: 0 }); b.orderMove({ x: 400, y: 0 }); },
      () => { a.lockTarget({ kind: 'asteroid', id: 3 }); b.lockTarget({ kind: 'asteroid', id: 3 }); },
    ];
    const shipA = { pos: { x: 0, y: 0 }, radius: 16 };
    const shipB = { pos: { x: 0, y: 0 }, radius: 16 };
    const sa = createControlState();
    const sb = createControlState();
    for (let i = 0; i < 40; i++) {
      if (script[i]) script[i]!();
      resetState(sa);
      resetState(sb);
      const resolve = i >= 1 ? rock : null; // the lock is placed on frame 1
      a.writeInto(sa, shipA, i >= 1 ? resolve : null);
      b.writeInto(sb, shipB, i >= 1 ? resolve : null);
      expect(sa).toEqual(sb);
      shipA.pos.x += sa.thrust.x * 12;
      shipA.pos.y += sa.thrust.y * 12;
      shipB.pos.x += sb.thrust.x * 12;
      shipB.pos.y += sb.thrust.y * 12;
    }
  });
});
