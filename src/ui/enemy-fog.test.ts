/**
 * Enemy-planet fog tests (GDD §2.2 "scouted, not broadcast"). The load-bearing
 * contract — the reason the rule exists — is *sensor-range ring visibility*:
 *  - an enemy planet's damage ring is readable ONLY within sensor range;
 *  - outside it, the health is not merely undrawn but **unknown** (`null`), so
 *    no consumer can leak a number the player never earned;
 *  - a burning planet's smoke is a binary tell readable farther than the ring,
 *    and carries no number;
 *  - identity (owner) and a dead planet's wreck are visible at any range.
 */
import { describe, it, expect } from 'vitest';
import {
  enemyPlanetFog,
  enemyPlanetsFog,
  RING_RANGE,
  SMOKE_RANGE,
  SMOKE_CORE_FRACTION,
  RING_CRITICAL_FRACTION,
} from './enemy-fog';
import type { EnemyPlanet } from './enemy-fog';
import { SENSOR_RANGE } from '../sim/constants';

/** A healthy enemy planet at the origin, with per-test overrides. */
function planet(over: Partial<EnemyPlanet> = {}): EnemyPlanet {
  return { owner: 3, pos: { x: 0, y: 0 }, coreHp: 100, maxCoreHp: 100, ...over };
}

/** A ship `d` world units due east of the origin (where the planet sits). */
function shipAt(d: number) {
  return { x: d, y: 0 };
}

describe('enemy-fog — the fog tracks the sim, not a second constant', () => {
  it('reveals the ring at exactly the sim-defined sensor range and no farther', () => {
    expect(RING_RANGE).toBe(SENSOR_RANGE);
  });
});

describe('enemy-fog — sensor-range ring visibility (GDD §2.2)', () => {
  it('shows the damage ring when the ship is inside sensor range', () => {
    const fog = enemyPlanetFog(shipAt(RING_RANGE - 1), planet({ coreHp: 40 }));
    expect(fog.ringVisible).toBe(true);
    expect(fog.coreFraction).toBeCloseTo(0.4, 5);
  });

  it('shows the ring right up to the sensor-range boundary (inclusive)', () => {
    const fog = enemyPlanetFog(shipAt(RING_RANGE), planet());
    expect(fog.ringVisible).toBe(true);
    expect(fog.coreFraction).toBe(1);
  });

  it('hides the ring the moment the ship is past sensor range', () => {
    const fog = enemyPlanetFog(shipAt(RING_RANGE + 1), planet({ coreHp: 40 }));
    expect(fog.ringVisible).toBe(false);
  });

  it('does not merely undraw a fogged planet — its health is UNKNOWN, not zero', () => {
    // The whole point of the rule: no free-riding on a number you never scouted.
    const fog = enemyPlanetFog(shipAt(RING_RANGE * 3), planet({ coreHp: 5, maxCoreHp: 100 }));
    expect(fog.ringVisible).toBe(false);
    expect(fog.coreFraction).toBeNull();
    expect(fog.shieldFraction).toBeNull();
    expect(fog.hasShield).toBe(false);
    // Critically wounded — but you cannot know that from across the map.
    expect(fog.critical).toBe(false);
  });

  it('reveals a scouted shield fraction only inside the ring', () => {
    const near = enemyPlanetFog(
      shipAt(10),
      planet({ shieldHp: 45, maxShieldHp: 90 }),
    );
    expect(near.hasShield).toBe(true);
    expect(near.shieldFraction).toBeCloseTo(0.5, 5);

    const far = enemyPlanetFog(
      shipAt(RING_RANGE + 50),
      planet({ shieldHp: 45, maxShieldHp: 90 }),
    );
    expect(far.hasShield).toBe(false);
    expect(far.shieldFraction).toBeNull();
  });

  it('flags a scouted critical core, and never an unscouted one', () => {
    const crit = RING_CRITICAL_FRACTION * 100 - 1; // below the critical fraction
    const near = enemyPlanetFog(shipAt(10), planet({ coreHp: crit }));
    expect(near.critical).toBe(true);

    const far = enemyPlanetFog(shipAt(RING_RANGE + 10), planet({ coreHp: crit }));
    expect(far.critical).toBe(false);
    expect(far.coreFraction).toBeNull();
  });
});

describe('enemy-fog — the smoke tier (GDD §2.2 "reading the smoke")', () => {
  it('shows smoke on a burning planet from beyond the ring', () => {
    const burning = SMOKE_CORE_FRACTION * 100 - 5; // clearly below the smoke line
    const fog = enemyPlanetFog(shipAt(RING_RANGE + 20), planet({ coreHp: burning }));
    // Past the ring — the number is fogged — but the smoke still reads.
    expect(fog.ringVisible).toBe(false);
    expect(fog.coreFraction).toBeNull();
    expect(fog.smoking).toBe(true);
  });

  it('carries no number with the smoke — only the binary "burning" fact', () => {
    const fog = enemyPlanetFog(shipAt(RING_RANGE + 20), planet({ coreHp: 10 }));
    expect(fog.smoking).toBe(true);
    expect(fog.coreFraction).toBeNull(); // still no readable health
  });

  it('does not smoke a healthy planet — smoke never leaks "this planet is fine"', () => {
    const fog = enemyPlanetFog(shipAt(RING_RANGE + 20), planet({ coreHp: 100 }));
    expect(fog.smoking).toBe(false);
  });

  it('stops showing smoke once the ship is beyond smoke range', () => {
    const fog = enemyPlanetFog(shipAt(SMOKE_RANGE + 1), planet({ coreHp: 10 }));
    expect(fog.smoking).toBe(false);
    expect(fog.ringVisible).toBe(false);
    expect(fog.coreFraction).toBeNull();
  });
});

describe('enemy-fog — what is never fogged', () => {
  it('always reports the owner and position, at any range', () => {
    const far = enemyPlanetFog(shipAt(RING_RANGE * 5), planet({ owner: 6 }));
    expect(far.owner).toBe(6);
    expect(far.pos).toEqual({ x: 0, y: 0 });
    expect(far.distance).toBeCloseTo(RING_RANGE * 5, 5);
  });

  it('shows a dead planet as a wreck at any range, carrying no HP', () => {
    const wreck = enemyPlanetFog(shipAt(RING_RANGE * 4), planet({ alive: false, coreHp: 0 }));
    expect(wreck.destroyed).toBe(true);
    expect(wreck.ringVisible).toBe(false);
    expect(wreck.coreFraction).toBeNull();
    expect(wreck.smoking).toBe(false);
  });

  it('treats coreHp<=0 as destroyed even if `alive` was left true', () => {
    const wreck = enemyPlanetFog(shipAt(10), planet({ coreHp: 0 }));
    expect(wreck.destroyed).toBe(true);
    expect(wreck.ringVisible).toBe(false);
  });
});

describe('enemy-fog — batch over every rival planet', () => {
  it('fogs each planet independently by its own distance', () => {
    const ship = { x: 0, y: 0 };
    const fogs = enemyPlanetsFog(ship, [
      planet({ owner: 1, pos: { x: RING_RANGE - 10, y: 0 }, coreHp: 30 }), // in range
      planet({ owner: 2, pos: { x: RING_RANGE + 200, y: 0 }, coreHp: 30 }), // fogged
    ]);
    expect(fogs[0]!.ringVisible).toBe(true);
    expect(fogs[0]!.coreFraction).toBeCloseTo(0.3, 5);
    expect(fogs[1]!.ringVisible).toBe(false);
    expect(fogs[1]!.coreFraction).toBeNull();
  });

  it('reveals nothing for an empty field', () => {
    expect(enemyPlanetsFog({ x: 0, y: 0 }, [])).toEqual([]);
  });
});
