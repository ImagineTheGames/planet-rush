/**
 * src/net/snapshot.test.ts — the wire format, against the real sim
 * (GDD §4.2; docs/netcode-spike.md).
 *
 * Two things are being defended here. First, that the spike layout and the
 * production layout still agree byte-for-byte — the worst case is a number the
 * bandwidth budget is billed against, so it must not silently drift. (It is now
 * 494 B, down from the day-0 measured 510 B: the v0.3 laser funeral retired the
 * ship `aim` field — see docs/design-amendments.md and docs/netcode-spike.md.)
 * Second, that a snapshot encoded from a real `World` decodes back to what the
 * server saw, at wire precision: quantization is allowed to lose an eighth of a
 * unit ({@link POS_SCALE}), it is not allowed to lose a ship.
 *
 * The wire's *precision* is defended here too, and it is not a free parameter: it
 * is the floor under every client-side prediction error there is (the M10
 * constant-correction hunt — see the note on `POS_SCALE`), and it is bounded from
 * the other side by the widest arena the game ships. Both ends are pinned below,
 * so a future map that outgrows the wire fails the build instead of clamping a
 * ship onto a wall.
 */
import { describe, it, expect } from 'vitest';
import { ShipClass, UpgradeTrack } from '@shared/types';
import {
  MAPS,
  SHIP_WEAPON,
  SHOT_SPEED_STEPS,
  TURRET,
  TURRET_TIERS,
  createWorld,
  fireShipProjectile,
  fireTurretProjectile,
  shipTopSpeed,
  shotSpeed,
  step,
  stockTiers,
} from '../sim';
import {
  decodeSnapshot,
  dequantizeAngle,
  encodeWorldSnapshot,
  HEADER_BYTES,
  MAX_PROJECTILES,
  MAX_SHIPS,
  PROJECTILE_BYTES,
  projIsShipShot,
  projOwner,
  SHIP_BYTES,
  SHIP_FLAG,
  snapshotWorld,
  MAX_WIRE_COORD,
  MAX_WIRE_SHOT_SPEED,
  POS_SCALE,
  SHOT_SPEED_QUANT,
  WORST_CASE_BYTES,
} from './snapshot';

function world() {
  return createWorld({
    seed: 99,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Interceptor },
    ],
    bounds: { width: 1000, height: 1000 },
    asteroidCount: 8,
  });
}

describe('snapshot wire layout', () => {
  it('still costs exactly what the spike measured', () => {
    expect(WORST_CASE_BYTES).toBe(HEADER_BYTES + MAX_SHIPS * SHIP_BYTES + MAX_PROJECTILES * PROJECTILE_BYTES);
    // This literal is the only thing holding the live encoder to a measured
    // number. Until n7-01 this file also imported the day-0 spike's own
    // `WORST_CASE_BYTES` and asserted the two agreed; the spike was deleted as dead
    // code, so the literal carries that guard alone. It is a measured number, not a
    // magic one — docs/netcode-spike.md §1 bills every bandwidth figure against it,
    // which is the point of pinning it here: changing it changes that document's
    // arithmetic, and a red line here is what says so.
    //
    // 510 as first measured · 494 when the v0.3 laser funeral dropped the ship
    // `aim` field · **622 since a0-73**, when the projectile record grew the 2
    // bytes of heading and speed that let a remote shot fly the line it was fired
    // on rather than freeze wherever the packets are not (`./snapshot` `ProjSnap`).
    expect(WORST_CASE_BYTES).toBe(622);
  });

  it('stays far under the ~2 KB the GDD assumed (risk 4)', () => {
    expect(WORST_CASE_BYTES).toBeLessThan(2048);
  });

  it('encodes a real world at the size its entity count implies', () => {
    const w = world();
    const buf = encodeWorldSnapshot(w);
    expect(buf.byteLength).toBe(HEADER_BYTES + 2 * SHIP_BYTES);
    expect(buf.byteLength).toBeLessThan(WORST_CASE_BYTES);
  });
});

describe('encode → decode against the sim', () => {
  it('round-trips every ship at wire precision', () => {
    const w = world();
    // Fly a while so positions, velocities and facings are all non-trivial.
    for (let tick = 1; tick <= 30; tick++) {
      step(w, [
        {
          id: 0,
          actions: [
            { type: 'thrust', dir: { x: 0.8, y: -0.6 } },
            { type: 'fire', active: true, auto: true },
          ],
        },
      ]);
    }

    const decoded = decodeSnapshot(encodeWorldSnapshot(w));
    expect(decoded.tick).toBe(w.tick);
    expect(decoded.ships).toHaveLength(w.ships.length);

    for (let i = 0; i < w.ships.length; i++) {
      const ship = w.ships[i]!;
      const wire = decoded.ships[i]!;
      expect(wire.id).toBe(ship.id);
      // Fixed-point quantized: within half a wire step (1/16 u) of the truth,
      // and the client interpolates the rest at 60 fps render (GDD §4.2).
      const step_ = 1 / (2 * POS_SCALE);
      expect(Math.abs(wire.posX - ship.pos.x)).toBeLessThanOrEqual(step_);
      expect(Math.abs(wire.posY - ship.pos.y)).toBeLessThanOrEqual(step_);
      expect(Math.abs(wire.velX - ship.vel.x)).toBeLessThanOrEqual(step_);
      expect(Math.abs(wire.hull - ship.hull)).toBeLessThanOrEqual(0.5);
      // Facing survives to well under a tenth of a degree.
      const angle = ((ship.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      expect(Math.abs(dequantizeAngle(wire.heading) - angle)).toBeLessThan(0.001);
    }
  });

  it('carries every shipped arena inside the range the wire can represent', () => {
    // `POS_SCALE` buys precision by spending range: the `i16` reaches
    // `32767 / POS_SCALE` world units, and a coordinate past that is *clamped*,
    // which would pin a ship to a wall for the rest of the match. Positions are
    // measured from the arena corner, so the widest map's far corner is the
    // number to clear — with room left for a ship kicked past the boundary.
    const widest = Math.max(...MAPS.map((m) => Math.max(m.bounds.width, m.bounds.height)));
    expect(widest).toBeLessThan(MAX_WIRE_COORD);
    // And with real headroom, not by a hair: a map that only just fits is a map
    // one collision knock-back away from clamping.
    expect(widest).toBeLessThan(MAX_WIRE_COORD * 0.85);
  });

  it('round-trips a coordinate to an eighth of a unit, sign included', () => {
    const w = world();
    // Sub-unit motion is the case the old whole-unit wire could not carry at all:
    // a ship a third of a unit from a grid line decoded onto the line.
    w.ships[0]!.pos.x = 1200.376;
    w.ships[0]!.pos.y = -3.94;
    w.ships[0]!.vel.x = 12.3;

    const wire = decodeSnapshot(encodeWorldSnapshot(w)).ships[0]!;
    expect(wire.posX).toBe(1200.375); // 9603 / 8, exactly representable
    expect(wire.posY).toBe(-4); // −31.52 → −32 eighths, the nearest step
    expect(wire.velX).toBe(12.25);
    // Every decoded value lands on the fixed-point grid — no float slop.
    expect(wire.posX * POS_SCALE).toBe(Math.round(wire.posX * POS_SCALE));
  });

  it('carries the flags the renderer cannot infer from numbers', () => {
    const w = world();
    step(w, [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }]);

    const [firing, idle] = snapshotWorld(w).ships;
    expect(firing!.flags & SHIP_FLAG.firing).toBeTruthy();
    expect(idle!.flags & SHIP_FLAG.firing).toBeFalsy();
    // Both are alive, spawn-protected, and in the match at tick 1 (GDD §2.1).
    for (const s of [firing!, idle!]) {
      expect(s.flags & SHIP_FLAG.alive).toBeTruthy();
      expect(s.flags & SHIP_FLAG.spawnProtected).toBeTruthy();
      expect(s.flags & SHIP_FLAG.eliminated).toBeFalsy();
    }
  });

  it('streams only live projectile slots, keyed by pool slot', () => {
    const w = world();
    // The pool is sparse by design (sim/state.ts): dead slots are reused, so a
    // decoder must never see them.
    w.projectiles.push(
      { id: 1, active: false, owner: 0, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, damage: 1, radius: 4, life: 0 },
      { id: 2, active: true, owner: 3, pos: { x: 120, y: -40 }, vel: { x: 368, y: 368 }, damage: 1, radius: 4, life: 1 },
    );

    const decoded = decodeSnapshot(encodeWorldSnapshot(w));
    expect(decoded.projectiles).toHaveLength(1);
    const [only] = decoded.projectiles;
    // An untagged shot decodes as a turret shot (meta = owner, kind bit clear).
    expect(only!.id).toBe(1);
    expect(only!.posX).toBe(120);
    expect(only!.posY).toBe(-40);
    expect(only!.meta).toBe(3);
    // …and it carries the line it was fired on (a0-73). Velocity round-trips
    // through the wire's polar step rather than exactly, so it is compared to the
    // precision `SHOT_ANGLE_SCALE` and `SHOT_SPEED_QUANT` promise: a (368, 368)
    // muzzle is a 520 u/s shot at 45°, and comes back inside half a unit per axis.
    expect(only!.velX).toBeCloseTo(368, 0);
    expect(only!.velY).toBeCloseTo(368, 0);
  });

  it('tags a ship weapon shot in the reserved meta bit, turret shots clear it (amendment v0.2)', () => {
    const w = world();
    w.projectiles.push(
      { id: 1, active: true, owner: 2, pos: { x: 10, y: 10 }, vel: { x: 1, y: 0 }, damage: 1, radius: 5, life: 1, kind: 'ship' },
      { id: 2, active: true, owner: 5, pos: { x: 20, y: 20 }, vel: { x: 1, y: 0 }, damage: 1, radius: 4, life: 1, kind: 'turret' },
    );

    const [ship, turret] = decodeSnapshot(encodeWorldSnapshot(w)).projectiles;
    // The kind still rides a previously-reserved bit, at no byte cost.
    expect(projOwner(ship!.meta)).toBe(2);
    expect(projIsShipShot(ship!.meta)).toBe(true);
    expect(projOwner(turret!.meta)).toBe(5);
    expect(projIsShipShot(turret!.meta)).toBe(false);
    // And the layout is still exactly the worst case the doc bills against.
    expect(WORST_CASE_BYTES).toBe(622);
  });
});

describe("the wire's shot-speed ceiling", () => {
  /**
   * The speed byte carries 0 … {@link MAX_WIRE_SHOT_SPEED} (1020 u/s) and the
   * encoder clamps to it. A clamp is not a fix — a clamped shot keeps its heading
   * and loses its speed, so the receiver draws it on the right line moving too
   * slowly and reconciliation jerks it forward every snapshot, which is a0-73's
   * own bug wearing a different coat. What makes the ceiling safe is that nothing
   * the game can fire comes near it, and that is a claim about the *sim*, not the
   * codec — so it is asserted against the sim's real fire paths rather than
   * asserted about the constants by hand.
   *
   * Every muzzle in the game is walked: the ship weapon at every hull × every
   * SPEED tier, and the turret gun at every Mk. Each is fired through the real
   * `fire*Projectile` and the resulting pool slot is measured, so a shot that one
   * day *does* inherit its shooter's velocity is caught here — that matters,
   * because inheritance is how a speed exceeds its muzzle value and the headroom
   * would not survive it (see the assertion at the end).
   */
  it('no shot the game can fire overflows the wire', () => {
    const w = world();
    const shooter = w.ships[0]!;
    const fired: { what: string; speed: number }[] = [];

    // ── Every ship weapon: 4 hulls × every rung of the SPEED ladder ──────────
    for (const shipClass of Object.values(ShipClass)) {
      for (let tier = 0; tier < SHOT_SPEED_STEPS.length; tier++) {
        // Fire it for real, from a ship travelling flat out along +x. If a shot
        // ever inherits the hull's velocity, this is the case that shows it.
        Object.assign(shooter, { shipClass, tiers: { ...stockTiers(), [UpgradeTrack.Speed]: tier } });
        const top = shipTopSpeed(shooter);
        shooter.vel.x = top;
        shooter.vel.y = 0;
        w.projectiles.length = 0;
        fireShipProjectile(w, shooter, { x: 1, y: 0 });

        const shot = w.projectiles.find((p) => p.active)!;
        const speed = Math.hypot(shot.vel.x, shot.vel.y);
        // The shot leaves at its muzzle speed and NOTHING else: no inheritance,
        // so the fastest ship shot is the fastest muzzle, full stop.
        expect(speed).toBeCloseTo(shotSpeed(shooter), 6);
        fired.push({ what: `${shipClass} SPEED tier ${tier}`, speed });
      }
    }

    // ── Every turret Mk ─────────────────────────────────────────────────────
    for (let tier = 0; tier < TURRET_TIERS.length; tier++) {
      w.projectiles.length = 0;
      fireTurretProjectile(
        w,
        { id: 1, owner: 0, slot: 0, pos: { x: 0, y: 0 }, radius: TURRET.radius, hp: TURRET.hp, maxHp: TURRET.hp, angle: 0, cooldown: 0, targetId: null, muzzle: null, tier },
        0.7,
      );
      const shot = w.projectiles.find((p) => p.active)!;
      fired.push({ what: `turret ${TURRET_TIERS[tier]!.label}`, speed: Math.hypot(shot.vel.x, shot.vel.y) });
    }

    // ── The ceiling holds for every one of them, through the real encoder ────
    for (const { what, speed } of fired) {
      expect(speed, what).toBeLessThan(MAX_WIRE_SHOT_SPEED);
      // Not just under it — under it with room, so a retune has somewhere to go
      // before this test is the only thing standing between a player and a shot
      // that wraps to a standstill.
      expect(speed, what).toBeLessThan(MAX_WIRE_SHOT_SPEED * 0.85);
      // And the number actually survives the round trip: encoded at this speed,
      // a shot comes back at this speed (to the byte's step), never wrapped to a
      // near-zero velocity by the top of the range.
      const w2 = world();
      w2.projectiles.length = 0;
      w2.projectiles.push({ id: 1, active: true, owner: 0, pos: { x: 10, y: 10 }, vel: { x: speed, y: 0 }, damage: 1, radius: 5, life: 1, kind: 'ship' });
      const decoded = decodeSnapshot(encodeWorldSnapshot(w2)).projectiles[0]!;
      // Half a quantization step is the whole error the speed byte is allowed
      // (598 u/s rounds to 600); a wrap would be off by hundreds.
      const roundTrip = Math.hypot(decoded.velX, decoded.velY);
      expect(Math.abs(roundTrip - speed), `${what} (round-tripped at ${roundTrip})`).toBeLessThanOrEqual(
        SHOT_SPEED_QUANT / 2 + 1e-9,
      );
    }

    // The fastest thing in the list, named: a turret's flat 700 u/s, which is
    // 69 % of the ceiling. (The fastest ship shot is 520 × 1.3 = 676.)
    const fastest = fired.reduce((a, b) => (b.speed > a.speed ? b : a));
    expect(fastest.speed).toBe(TURRET.projectileSpeed);
    expect(fastest.speed).toBe(700);
    expect(Math.max(...SHOT_SPEED_STEPS.map((m) => SHIP_WEAPON.projectileSpeed * m))).toBe(676);

    // ── Why the no-inheritance assertion above is load-bearing ───────────────
    // The headroom is comfortable only because a shot's speed IS its muzzle
    // speed. Add the fastest hull the game can build (an Interceptor at ENGINE
    // Mk III) to the fastest ship muzzle and the sum is over the ceiling — so
    // "shots inherit the shooter's velocity" is a change that would silently
    // start wrapping shots to a standstill, and the per-shot equality above is
    // what fails first if anyone makes it.
    const fastestHull = Math.max(
      ...Object.values(ShipClass).map((c) =>
        shipTopSpeed({ shipClass: c, tiers: { ...stockTiers(), [UpgradeTrack.Engine]: 3 } }),
      ),
    );
    expect(676 + fastestHull).toBeGreaterThan(MAX_WIRE_SHOT_SPEED);
  });

  it('clamps an over-ceiling shot to the ceiling rather than wrapping it to a standstill', () => {
    // Unreachable from the sim (the test above is why), so this pins the codec's
    // behaviour at the edge: the byte would take `round(2000/4) = 500` and keep
    // the low 8 bits — 244, a 976 u/s shot — or, at 1024 u/s exactly, a 0 that
    // decodes as a shot standing still. Clamping instead means the worst a
    // retune can do is stream a *slow* shot on the right line, which is visible
    // and recoverable, rather than a stopped or randomly-slower one.
    const w = world();
    w.projectiles.length = 0;
    w.projectiles.push(
      { id: 1, active: true, owner: 0, pos: { x: 0, y: 0 }, vel: { x: 2000, y: 0 }, damage: 1, radius: 5, life: 1, kind: 'ship' },
      { id: 2, active: true, owner: 1, pos: { x: 0, y: 0 }, vel: { x: 0, y: 1024 }, damage: 1, radius: 5, life: 1, kind: 'ship' },
    );

    const [fast, wrapper] = decodeSnapshot(encodeWorldSnapshot(w)).projectiles;
    expect(fast!.velX).toBe(MAX_WIRE_SHOT_SPEED);
    expect(fast!.velY).toBeCloseTo(0, 6);
    // The heading survives the clamp — only the magnitude is lost.
    expect(wrapper!.velY).toBe(MAX_WIRE_SHOT_SPEED);
    expect(wrapper!.velX).toBeCloseTo(0, 6);
  });
});
