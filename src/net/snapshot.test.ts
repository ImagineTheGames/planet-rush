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
import { ShipClass } from '@shared/types';
import { MAPS, createWorld, step } from '../sim';
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
  POS_SCALE,
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
    // 494 B IS the day-0 spike's measurement, and this line is now the only thing
    // holding the live encoder to it. Until n7-01 this file also imported the
    // spike's own `WORST_CASE_BYTES` and asserted the two agreed; the spike was
    // deleted as dead code, so the literal carries that guard alone. It is a
    // measured number, not a magic one — docs/netcode-spike.md §1 bills every
    // bandwidth figure against it (494 after the v0.3 laser funeral dropped the
    // ship `aim` field; 510 as first measured). Changing it changes that
    // document's arithmetic, which is the point of pinning it here.
    expect(WORST_CASE_BYTES).toBe(494);
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
      { id: 2, active: true, owner: 3, pos: { x: 120, y: -40 }, vel: { x: 5, y: 5 }, damage: 1, radius: 4, life: 1 },
    );

    const decoded = decodeSnapshot(encodeWorldSnapshot(w));
    // An untagged shot decodes as a turret shot (meta = owner, kind bit clear).
    expect(decoded.projectiles).toEqual([{ id: 1, posX: 120, posY: -40, meta: 3 }]);
  });

  it('tags a ship weapon shot in the reserved meta bit, turret shots clear it (amendment v0.2)', () => {
    const w = world();
    w.projectiles.push(
      { id: 1, active: true, owner: 2, pos: { x: 10, y: 10 }, vel: { x: 1, y: 0 }, damage: 1, radius: 5, life: 1, kind: 'ship' },
      { id: 2, active: true, owner: 5, pos: { x: 20, y: 20 }, vel: { x: 1, y: 0 }, damage: 1, radius: 4, life: 1, kind: 'turret' },
    );

    const [ship, turret] = decodeSnapshot(encodeWorldSnapshot(w)).projectiles;
    // Same 6-byte record — the kind rides a previously-reserved bit, no byte cost.
    expect(projOwner(ship!.meta)).toBe(2);
    expect(projIsShipShot(ship!.meta)).toBe(true);
    expect(projOwner(turret!.meta)).toBe(5);
    expect(projIsShipShot(turret!.meta)).toBe(false);
    // And the layout is still exactly the post-funeral worst case.
    expect(WORST_CASE_BYTES).toBe(494);
  });
});
