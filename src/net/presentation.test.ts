/**
 * src/net/presentation.test.ts — the picture is a picture, and the simulation is
 * untouched (`./presentation`, M10 netcode audit).
 *
 * The module's whole contract is one invariant, so it is asserted first and from
 * several directions: **between `apply` and `restore` the world is a picture;
 * outside that window it is byte-for-byte what prediction left.** If that ever
 * stops being true, the presented offset compounds into the simulation and the
 * audit's fix becomes the audit's bug.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld } from '../sim';
import type { World } from '../sim';
import { LOCAL_SHOT_BASE, PresentationLayer } from './presentation';
import { SHOT_META } from './snapshot';
import type { InterpolatedShip, InterpolatedShot } from './interpolation';

const LOCAL = 0;
const REMOTE = 1;

function world(): World {
  return createWorld({
    seed: 5,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Interceptor },
    ],
    asteroidCount: 4,
  });
}

function shipOf(w: World, id: number): World['ships'][number] {
  const ship = w.ships.find((s) => s.id === id);
  if (!ship) throw new Error(`no ship ${id}`);
  return ship;
}

const remoteAt = (x: number, y: number, angle = 1.25): InterpolatedShip => ({
  id: REMOTE,
  x,
  y,
  angle,
  hull: 40,
  flags: 1,
});

const shotAt = (slot: number, x: number, y: number, owner = REMOTE): InterpolatedShot => ({
  slot,
  x,
  y,
  meta: owner | SHOT_META.shipKind,
});

const NOTHING = { localOffset: { x: 0, y: 0 }, remotes: [], shots: [] };

describe('the local ship', () => {
  it('is drawn where it was, and simulated where it is', () => {
    const w = world();
    const layer = new PresentationLayer(LOCAL);
    const ship = shipOf(w, LOCAL);
    const truth = { x: ship.pos.x, y: ship.pos.y };

    layer.apply(w, { ...NOTHING, localOffset: { x: -12, y: 7 } });
    // The picture: the hull is still catching up to a correction that already
    // landed in the world.
    expect(ship.pos.x).toBeCloseTo(truth.x - 12);
    expect(ship.pos.y).toBeCloseTo(truth.y + 7);

    layer.restore(w);
    expect(ship.pos.x).toBe(truth.x);
    expect(ship.pos.y).toBe(truth.y);
  });

  it('is not touched at all once the offset has decayed to nothing', () => {
    const w = world();
    const layer = new PresentationLayer(LOCAL);
    const ship = shipOf(w, LOCAL);
    const truth = { ...ship.pos };

    layer.apply(w, NOTHING);
    expect(ship.pos).toEqual(truth);
  });
});

describe('remote ships', () => {
  it('are drawn from the interpolation buffer and restored to the simulation', () => {
    const w = world();
    const layer = new PresentationLayer(LOCAL);
    const remote = shipOf(w, REMOTE);
    const simulated = { x: remote.pos.x, y: remote.pos.y, angle: remote.angle };

    layer.apply(w, { ...NOTHING, remotes: [remoteAt(400, 250)] });
    expect(remote.pos.x).toBe(400);
    expect(remote.pos.y).toBe(250);
    expect(remote.angle).toBeCloseTo(1.25);

    layer.restore(w);
    expect(remote.pos.x).toBe(simulated.x);
    expect(remote.pos.y).toBe(simulated.y);
    expect(remote.angle).toBe(simulated.angle);
  });

  it('are left where the simulation has them when the buffer has nothing to say', () => {
    const w = world();
    const layer = new PresentationLayer(LOCAL);
    const remote = shipOf(w, REMOTE);
    const simulated = { ...remote.pos };

    layer.apply(w, NOTHING);
    expect(remote.pos).toEqual(simulated);
  });
});

describe('streamed shots', () => {
  it('are placed by the playback clock, not by the newest snapshot', () => {
    const w = world();
    const layer = new PresentationLayer(LOCAL);

    layer.apply(w, { ...NOTHING, shots: [shotAt(3, 100, 120)] });
    const shot = w.projectiles[3]!;
    expect(shot.active).toBe(true);
    expect(shot.pos.x).toBe(100);
    expect(shot.pos.y).toBe(120);
    expect(shot.kind).toBe('ship');
    expect(shot.owner).toBe(REMOTE);
  });

  it('are cleared from the picture when the playback clock has passed them', () => {
    const w = world();
    const layer = new PresentationLayer(LOCAL);

    layer.apply(w, { ...NOTHING, shots: [shotAt(3, 100, 120)] });
    layer.restore(w);
    layer.apply(w, { ...NOTHING, shots: [] });
    expect(w.projectiles[3]?.active ?? false).toBe(false);
  });

  it('never touch the slots the firer\'s own predicted shots live in', () => {
    const w = world();
    const layer = new PresentationLayer(LOCAL);
    // One predicted own shot, in the reserved range the wire cannot name.
    while (w.projectiles.length <= LOCAL_SHOT_BASE) {
      w.projectiles.push({
        id: 0,
        active: false,
        owner: -1,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        damage: 0,
        radius: 5,
        life: 0,
      });
    }
    const mine = w.projectiles[LOCAL_SHOT_BASE]!;
    mine.active = true;
    mine.owner = LOCAL;
    mine.kind = 'ship';
    mine.pos.x = 777;
    mine.pos.y = 888;

    layer.apply(w, { ...NOTHING, shots: [shotAt(0, 10, 20), shotAt(1, 30, 40)] });

    expect(mine.active).toBe(true);
    expect(mine.pos.x).toBe(777);
    expect(mine.pos.y).toBe(888);
  });
});

describe('the invariant', () => {
  it('restores every field exactly, over repeated apply/restore cycles', () => {
    const w = world();
    const layer = new PresentationLayer(LOCAL);
    // The pool only ever grows (so does the sim's own `takeProjectile`), so the
    // invariant is about the values in it, not its length: every *live* shot, and
    // every ship, comes back exactly.
    const snapshotOf = (): string =>
      JSON.stringify({
        ships: w.ships.map((s) => [s.pos.x, s.pos.y, s.angle]),
        shots: w.projectiles
          .filter((p) => p.active)
          .map((p) => [p.pos.x, p.pos.y, p.owner, p.kind ?? null]),
      });

    const truth = snapshotOf();
    for (let i = 0; i < 5; i++) {
      layer.apply(w, {
        localOffset: { x: i * 3 - 6, y: 4 - i },
        remotes: [remoteAt(100 + i, 200 - i, i * 0.4)],
        shots: [shotAt(i, 10 * i, 5 * i), shotAt(i + 1, 3 * i, 2 * i)],
      });
      layer.restore(w);
      expect(snapshotOf()).toBe(truth);
    }
  });

  it('refuses to stash the picture as if it were the simulation', () => {
    const w = world();
    const layer = new PresentationLayer(LOCAL);
    const ship = shipOf(w, LOCAL);
    const truth = { x: ship.pos.x, y: ship.pos.y };

    layer.apply(w, { ...NOTHING, localOffset: { x: 10, y: 0 } });
    // A second apply with no restore between — the offset must not compound, and
    // the stash must still hold the *simulation's* position.
    layer.apply(w, { ...NOTHING, localOffset: { x: 10, y: 0 } });
    expect(ship.pos.x).toBeCloseTo(truth.x + 10);

    layer.restore(w);
    expect(ship.pos.x).toBe(truth.x);
  });

  it('reports whether the world is currently a picture', () => {
    const w = world();
    const layer = new PresentationLayer(LOCAL);
    expect(layer.isPresented).toBe(false);
    layer.apply(w, { ...NOTHING, remotes: [remoteAt(1, 2)] });
    expect(layer.isPresented).toBe(true);
    layer.restore(w);
    expect(layer.isPresented).toBe(false);
    // And restoring twice is harmless — callers restore unconditionally.
    layer.restore(w);
    expect(layer.isPresented).toBe(false);
  });
});
