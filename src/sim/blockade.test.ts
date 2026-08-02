/**
 * src/sim/blockade.test.ts — the cornered geometry, checked against arithmetic
 * (p15 ratified: "a blockaded bot FIGHTS — no dithering").
 *
 * The behavior half of the rule is gated in `src/bots/cornered.test.ts`; this
 * file gates the half that is not behavior at all — four positions and two
 * speeds in, a verdict out. Everything here is closed-form, so the assertions
 * are against numbers computed by hand rather than against "what the code does
 * today":
 *
 *  - on-line vs off-line, ahead vs behind, short of vs past the destination;
 *  - the tangent–arc–tangent detour length, against its own closed form;
 *  - the relative-speed clause, which is the one the screenshot turns on;
 *  - determinism — the same query twice is the same bits twice (GDD §4.8).
 */

import { describe, it, expect } from 'vitest';
import { BLOCKADE, WEAPON_RANGE } from './constants';
import { corneredReading, detourExtra, detourIsCheap, pathBlock } from './blockade';

const HOME = { x: 1000, y: 1000 };
const SHIP = { x: 1000, y: 1700 }; // 700 units due south of home

describe('pathBlock — is the threat ON the path?', () => {
  it('reads a threat parked squarely on the line (the screenshot)', () => {
    const threat = { x: 1000, y: 1350 }; // dead centre of the run home
    const r = pathBlock(SHIP, HOME, threat);
    expect(r.span).toBeCloseTo(700, 9);
    expect(r.along).toBeCloseTo(350, 9);
    expect(r.offset).toBeCloseTo(0, 9);
    expect(r.blocking).toBe(true);
  });

  it('does not read a threat standing off the lane', () => {
    // Same distance down the run, but a corridor-and-a-bit off to the side.
    const threat = { x: 1000 + BLOCKADE.corridor + 1, y: 1350 };
    const r = pathBlock(SHIP, HOME, threat);
    expect(r.offset).toBeCloseTo(BLOCKADE.corridor + 1, 9);
    expect(r.blocking).toBe(false);
  });

  it('holds right up to the corridor edge and lets go one unit past it', () => {
    const onEdge = pathBlock(SHIP, HOME, { x: 1000 + BLOCKADE.corridor, y: 1350 });
    const justOut = pathBlock(SHIP, HOME, { x: 1000 + BLOCKADE.corridor + 1, y: 1350 });
    expect(onEdge.blocking).toBe(true);
    expect(justOut.blocking).toBe(false);
  });

  it('ignores a threat behind the ship — that is a chase, not a blockade', () => {
    const r = pathBlock(SHIP, HOME, { x: 1000, y: 1900 });
    expect(r.along).toBeLessThan(0);
    expect(r.blocking).toBe(false);
  });

  it('ignores a threat past the destination — that is a siege, not a blockade', () => {
    const r = pathBlock(SHIP, HOME, { x: 1000, y: 900 });
    expect(r.along).toBeGreaterThan(r.span);
    expect(r.blocking).toBe(false);
  });

  it('blocks nothing when the ship is already at its destination', () => {
    const r = pathBlock(HOME, HOME, { x: 1000, y: 1350 });
    expect(r.span).toBe(0);
    expect(r.blocking).toBe(false);
  });
});

describe('detourExtra — what going around actually costs', () => {
  it('costs nothing when the straight line already clears the threat', () => {
    // Well off to one side: no arc to ride.
    expect(detourExtra(SHIP, HOME, { x: 1000 + 900, y: 1350 })).toBe(0);
  });

  it('matches the tangent–arc–tangent closed form for a threat on the midpoint', () => {
    const threat = { x: 1000, y: 1350 }; // midpoint: d1 = d2 = 350, θ = π
    const r = BLOCKADE.corridor;
    const d = 350;
    const tangent = Math.sqrt(d * d - r * r);
    const arc = Math.PI - 2 * Math.acos(r / d);
    const expected = 2 * tangent + r * arc - 700;

    expect(detourExtra(SHIP, HOME, threat)).toBeCloseTo(expected, 9);
    // And it is a real, non-trivial price: hundreds of units on a 700-unit run.
    expect(expected).toBeGreaterThan(150);
  });

  it('has no answer at all when the ship is already inside the threat corridor', () => {
    // 100 units off a blockader whose corridor is the weapon's whole reach.
    const threat = { x: 1000, y: 1600 };
    expect(detourExtra(SHIP, HOME, threat)).toBe(Number.POSITIVE_INFINITY);
  });

  it('gets cheaper the further off the line the threat drifts', () => {
    const near = detourExtra(SHIP, HOME, { x: 1000, y: 1350 });
    const mid = detourExtra(SHIP, HOME, { x: 1120, y: 1350 });
    const far = detourExtra(SHIP, HOME, { x: 1240, y: 1350 });
    expect(mid).toBeLessThan(near);
    expect(far).toBeLessThan(mid);
  });
});

describe('detourIsCheap — the relative-speed clause', () => {
  const extra = 200; // a typical arc around a mid-path blockader

  it('is free when there is no detour to fly', () => {
    expect(detourIsCheap(0, 100, 999)).toBe(true);
  });

  it('is never cheap against a blockader at least as fast as you', () => {
    // The screenshot's own case: a wounded Hauler cannot go around a Vanguard.
    expect(detourIsCheap(extra, 221, 260)).toBe(false);
    expect(detourIsCheap(extra, 260, 260)).toBe(false);
  });

  it('is cheap for a fast ship slipping past a slow one inside the budget', () => {
    // 200 units of arc at a 130 u/s margin ⇒ ~1.5 s, inside the 2.5 s budget.
    expect(detourIsCheap(extra, 351, 221)).toBe(true);
  });

  it('stops being cheap once the arc outruns the budget at that margin', () => {
    // Same margin, a much longer way around.
    expect(detourIsCheap(1000, 351, 221)).toBe(false);
  });

  it('is never cheap when there is no tangent path', () => {
    expect(detourIsCheap(Number.POSITIVE_INFINITY, 999, 1)).toBe(false);
  });
});

describe('corneredReading — both clauses, or nothing', () => {
  const slowShip = 221; // Hauler
  const fastShip = 338; // Interceptor

  it('corners a slow ship whose home is behind a faster blockader', () => {
    const r = corneredReading({
      from: SHIP,
      to: HOME,
      threat: { x: 1000, y: 1350 },
      ownSpeed: slowShip,
      threatSpeed: fastShip,
    });
    expect(r.blocking).toBe(true);
    expect(r.detourCheap).toBe(false);
    expect(r.cornered).toBe(true);
  });

  it('does not corner a fast ship that can simply go around a slow one', () => {
    const r = corneredReading({
      from: SHIP,
      to: HOME,
      threat: { x: 1150, y: 1350 },
      ownSpeed: fastShip,
      threatSpeed: slowShip,
    });
    expect(r.blocking).toBe(true);
    expect(r.detourCheap).toBe(true);
    expect(r.cornered).toBe(false);
  });

  it('does not corner on an off-line threat, however fast it is', () => {
    const r = corneredReading({
      from: SHIP,
      to: HOME,
      threat: { x: 1000 + WEAPON_RANGE * 2, y: 1350 },
      ownSpeed: slowShip,
      threatSpeed: fastShip,
    });
    expect(r.blocking).toBe(false);
    expect(r.cornered).toBe(false);
    // A non-blocking read short-circuits: no detour is computed or charged for.
    expect(r.detour).toBe(0);
    expect(r.detourCheap).toBe(true);
  });
});

describe('determinism — the geometry is pure arithmetic (GDD §4.8)', () => {
  it('produces bit-identical readings over a swept board, twice', () => {
    function sweep(): string {
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        for (let j = 0; j < 40; j++) {
          const r = corneredReading({
            from: SHIP,
            to: HOME,
            threat: { x: 800 + i * 17, y: 900 + j * 23 },
            ownSpeed: 221 + i,
            threatSpeed: 200 + j,
          });
          out.push(`${r.along},${r.offset},${r.detour},${r.cornered ? 1 : 0}`);
        }
      }
      return out.join('|');
    }
    expect(sweep()).toBe(sweep());
  });

  it('touches no clock and no RNG — a reading depends only on its arguments', () => {
    const q = {
      from: SHIP,
      to: HOME,
      threat: { x: 1000, y: 1350 },
      ownSpeed: 221,
      threatSpeed: 260,
    };
    const first = corneredReading(q);
    for (let i = 0; i < 100; i++) corneredReading({ ...q, threat: { x: 1234, y: 5678 } });
    expect(corneredReading(q)).toEqual(first);
  });
});
