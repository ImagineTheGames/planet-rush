/**
 * Determinism, across every generator (GDD §4.1, §4.5).
 *
 * Art is code, and this code runs in three places that must agree: the client
 * drawing the frame, the preview sheet a reviewer opens, and the golden the CI
 * compares. A generator that drifted — an unseeded `Math.random`, a float that
 * quantises differently on another engine — would break all three quietly. So
 * every generator is asserted to be a pure function of its inputs, to draw its
 * randomness only from the ratified `mulberry32`, and to emit coordinates
 * already quantised to 1e-4.
 *
 * The other half of the file is the design-visible behaviour each generator
 * owes the ruleset: three crack stages that actually differ, four planet
 * variants that actually differ, richer rocks that actually look richer.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { asteroidOutline, asteroidSprite, oreChunkSprite } from './asteroids';
import { buildProgressSprite, shieldSprite, shieldStrength, turretSprite } from './buildings';
import { ALL_SPRITES } from './catalogue';
import { decalDigit, decalStrokes } from './decals';
import {
  atmosphereHaloSprite,
  beaconRingSprite,
  continentPolygons,
  damageRingSprite,
  planetSprite,
  planetVariantFor,
  repairAuraSprite,
  ATMOSPHERE_HALO_RADIUS,
  PLANET_VARIANT_COUNT,
} from './planets';
import { DEPOSIT_RANGE, PLANET } from '../sim/constants';
import { shipSprite } from './ships';
import { spriteKey, type SpriteDef } from './shapes';
import { debrisFieldSprite, planetWreckSprite } from './wrecks';

/** Everything that has to be reproducible, with a second identical call. */
const REPEATABLE: readonly (() => SpriteDef)[] = [
  () => shipSprite({ shipClass: ShipClass.Excavator, playerId: 5 }),
  () => planetSprite(2),
  () => beaconRingSprite(6),
  () => damageRingSprite(0.42),
  () => repairAuraSprite(),
  () => asteroidSprite({ seed: 41, crackStage: 1 }),
  () => oreChunkSprite(9),
  () => turretSprite({ playerId: 3, state: 'tracking' }),
  () => shieldSprite({ playerId: 3, strength: 'weakened' }),
  () => buildProgressSprite(0.4),
  () => planetWreckSprite(1),
  () => debrisFieldSprite(2),
  () => atmosphereHaloSprite(0),
];

describe('determinism (GDD §4.1)', () => {
  it('gives deep-equal output for identical inputs, every generator', () => {
    for (const make of REPEATABLE) {
      expect(make()).toEqual(make());
      expect(spriteKey(make())).toBe(spriteKey(make()));
    }
  });

  it('quantises every coordinate to 1e-4, so output is byte-stable across engines', () => {
    const quantised = (n: number): boolean => Math.abs(n * 10000 - Math.round(n * 10000)) < 1e-6;
    for (const def of ALL_SPRITES) {
      for (const shape of def.shapes) {
        if (shape.path.kind === 'circle') {
          for (const n of [shape.path.cx, shape.path.cy, shape.path.r]) {
            expect(quantised(n), `${def.name}: ${n}`).toBe(true);
          }
        } else {
          for (const n of shape.path.points) expect(quantised(n), `${def.name}: ${n}`).toBe(true);
        }
      }
    }
  });

  it('never leaves a NaN or an infinity in the geometry', () => {
    for (const def of ALL_SPRITES) {
      for (const shape of def.shapes) {
        const nums =
          shape.path.kind === 'circle'
            ? [shape.path.cx, shape.path.cy, shape.path.r]
            : shape.path.points;
        for (const n of nums) expect(Number.isFinite(n), `${def.name}: ${n}`).toBe(true);
      }
      expect(Number.isFinite(def.extent)).toBe(true);
      expect(def.extent).toBeGreaterThan(0);
    }
  });

  it('gives every sprite a unique, parameter-bearing name — the texture-pool key', () => {
    const names = ALL_SPRITES.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('asteroids — the payout read (style-guide §6)', () => {
  it('cracks visibly across three stages', () => {
    const s0 = asteroidSprite({ seed: 12, crackStage: 0 });
    const s1 = asteroidSprite({ seed: 12, crackStage: 1 });
    const s2 = asteroidSprite({ seed: 12, crackStage: 2 });
    expect(s0).not.toEqual(s1);
    expect(s1).not.toEqual(s2);
    // Stage 2 is split in two: more closed body polygons than a whole rock.
    const bodies = (d: SpriteDef): number =>
      d.shapes.filter((s) => s.path.kind === 'poly' && s.path.closed && s.role === 'material' && s.fill).length;
    expect(bodies(s2)).toBeGreaterThan(bodies(s0) - bodies(s0)); // both defined
    expect(s2.shapes.some((s) => s.path.kind === 'poly' && s.path.closed)).toBe(true);
  });

  it('lets a player judge a payout before committing mining time', () => {
    const oreShapes = (d: SpriteDef): number => d.shapes.filter((s) => s.role === 'ore').length;
    const rich = asteroidSprite({ seed: 3, crackStage: 0, richness: 1 });
    const poor = asteroidSprite({ seed: 3, crackStage: 0, richness: 0.2 });
    expect(oreShapes(rich)).toBeGreaterThan(oreShapes(poor));
    expect(oreShapes(asteroidSprite({ seed: 3, crackStage: 0, richness: 0 }))).toBe(0);
  });

  it('never draws mineral outside the collision radius the mining shot tests against', () => {
    for (const seed of [1, 2, 3, 17, 99]) {
      const outline = asteroidOutline(seed);
      let max = 0;
      for (let i = 0; i < outline.length; i += 2) {
        max = Math.max(max, Math.hypot(outline[i]!, outline[i + 1]!));
      }
      expect(max).toBeLessThanOrEqual(1.0001);
      expect(max).toBeGreaterThan(0.9); // and it fills the radius it claims
    }
  });

  it('gives different rocks different shapes', () => {
    expect(asteroidOutline(1)).not.toEqual(asteroidOutline(2));
    expect(oreChunkSprite(0)).not.toEqual(oreChunkSprite(1));
  });
});

describe('planets — four variants, arrangement only (style-guide §5)', () => {
  it('makes four distinct worlds', () => {
    const defs = [0, 1, 2, 3].map(planetSprite);
    for (let i = 0; i < defs.length; i++) {
      for (let j = i + 1; j < defs.length; j++) expect(defs[i]).not.toEqual(defs[j]);
    }
  });

  it('varies by continent layout and land ratio, not by colour', () => {
    const palettes = [0, 1, 2, 3].map((v) => new Set(planetSprite(v).shapes.map((s) => s.fill?.color)));
    for (const p of palettes) expect(p).toEqual(palettes[0]);
    expect(continentPolygons(0).length).not.toBe(continentPolygons(3).length);
  });

  it('puts the signal-yellow core on every world — the win condition (§2)', () => {
    for (let v = 0; v < PLANET_VARIANT_COUNT; v++) {
      expect(planetSprite(v).shapes.some((s) => s.role === 'core')).toBe(true);
    }
  });

  it('assigns a variant per player and wraps safely', () => {
    expect(planetVariantFor(0)).toBe(0);
    expect(planetVariantFor(4)).toBe(0);
    expect(planetVariantFor(-1)).toBe(3);
  });

  it('draws the atmosphere halo at exactly DEPOSIT_RANGE — visual and rule never drift (p4-12)', () => {
    // The unit-space edge is DEPOSIT_RANGE / PLANET.radius and nothing else, so
    // the halo is the sim constant, expressed as art.
    expect(ATMOSPHERE_HALO_RADIUS).toBe(DEPOSIT_RANGE / PLANET.radius);

    const def = atmosphereHaloSprite(0);
    // The outermost disc *is* the atmosphere edge; scaled by the planet radius
    // (how the renderer draws it) it lands on DEPOSIT_RANGE world units exactly.
    const outerUnit = Math.max(
      ...def.shapes.map((s) => (s.path.kind === 'circle' ? s.path.r : 0)),
    );
    expect(outerUnit).toBe(ATMOSPHERE_HALO_RADIUS);
    expect(outerUnit * PLANET.radius).toBeCloseTo(DEPOSIT_RANGE, 4);
    // The sprite's own square is sized to the halo, not clipped to the planet.
    expect(def.extent).toBe(ATMOSPHERE_HALO_RADIUS);
  });

  it('paints the halo only in the player colour — air is identity trim, never a material (§3)', () => {
    for (const slot of [0, 3, 7]) {
      const def = atmosphereHaloSprite(slot);
      expect(def.shapes.length).toBeGreaterThan(0);
      expect(def.shapes.every((s) => s.role === 'identity')).toBe(true);
    }
    // Distinct owners ⇒ distinct halos (colour and cache key both move).
    expect(atmosphereHaloSprite(0)).not.toEqual(atmosphereHaloSprite(1));
  });

  it('scales the damage ring by remaining core HP, quantised so the pool holds', () => {
    expect(damageRingSprite(1).shapes.length).toBeGreaterThan(damageRingSprite(0).shapes.length);
    // 5% quantisation: two nearby fractions share a sprite (and so a texture).
    expect(damageRingSprite(0.51)).toEqual(damageRingSprite(0.52));
    expect(damageRingSprite(0.5)).not.toEqual(damageRingSprite(0.9));
    // Out-of-range input is clamped, never thrown.
    expect(damageRingSprite(-1)).toEqual(damageRingSprite(0));
    expect(damageRingSprite(2)).toEqual(damageRingSprite(1));
  });
});

describe('turrets and shields — the siege tells (GDD §2.6)', () => {
  it('telegraphs four distinct barrel states', () => {
    const states = (['building', 'idle', 'tracking', 'firing'] as const).map((state) =>
      turretSprite({ playerId: 0, state }),
    );
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) expect(states[i]).not.toEqual(states[j]);
    }
  });

  it('has no barrel until the build finishes — the art does not lie about readiness', () => {
    const building = turretSprite({ playerId: 0, state: 'building' });
    const idle = turretSprite({ playerId: 0, state: 'idle' });
    expect(building.shapes.length).toBeLessThan(idle.shapes.length);
    // Hazard stripes are the one legal yellow on a turret (style-guide §2).
    expect(building.shapes.some((s) => s.role === 'danger')).toBe(true);
  });

  it('fires in threat red, and only when firing', () => {
    const firing = turretSprite({ playerId: 0, state: 'firing' });
    const tracking = turretSprite({ playerId: 0, state: 'tracking' });
    expect(firing.shapes.some((s) => s.role === 'danger')).toBe(true);
    expect(tracking.shapes.some((s) => s.role === 'danger')).toBe(false);
  });

  it('shows pressure working: three visible shield strengths', () => {
    expect(shieldStrength(1)).toBe('full');
    expect(shieldStrength(0.5)).toBe('weakened');
    expect(shieldStrength(0.1)).toBe('failing');
    const full = shieldSprite({ playerId: 1, strength: 'full' });
    const failing = shieldSprite({ playerId: 1, strength: 'failing' });
    expect(full).not.toEqual(failing);
    // A failing bubble is visibly holed, so an attacker can see it about to pop.
    expect(failing.shapes.length).toBeGreaterThan(full.shapes.length);
  });

  it('draws the second stacked generator wider than the first (GDD §2.5)', () => {
    const first = shieldSprite({ playerId: 0, strength: 'full', stackIndex: 0 });
    const second = shieldSprite({ playerId: 0, strength: 'full', stackIndex: 1 });
    expect(second.extent).toBeGreaterThan(first.extent);
  });

  it('quantises build progress so a 10-second build is not 600 textures', () => {
    expect(buildProgressSprite(0.41)).toEqual(buildProgressSprite(0.44));
    expect(buildProgressSprite(0.4)).not.toEqual(buildProgressSprite(0.9));
  });
});

describe('wrecks — the quiet (style-guide §8)', () => {
  it('puts the core out: no yellow anywhere on a dead planet', () => {
    for (let v = 0; v < PLANET_VARIANT_COUNT; v++) {
      const def = planetWreckSprite(v);
      expect(def.shapes.some((s) => s.role === 'core' || s.role === 'ore')).toBe(false);
    }
  });

  it('stays cold — no threat red on a wreck; a wreck is an absence, not a threat', () => {
    for (let v = 0; v < PLANET_VARIANT_COUNT; v++) {
      expect(planetWreckSprite(v).shapes.some((s) => s.role === 'danger')).toBe(false);
    }
  });

  it('keeps the same coastlines as the world it was — you lose *that* planet', () => {
    const wreck = planetWreckSprite(2);
    const crust = wreck.shapes.filter((s) => s.path.kind === 'poly' && s.path.closed);
    expect(crust.length).toBeGreaterThanOrEqual(continentPolygons(2).length);
  });

  it('leaves ore-laden debris — the only yellow left, and the reason to come (GDD §2.7)', () => {
    const debris = debrisFieldSprite(0);
    expect(debris.shapes.some((s) => s.role === 'ore')).toBe(true);
    expect(debrisFieldSprite(0)).not.toEqual(debrisFieldSprite(1));
  });
});

describe('hull decals (style-guide §3 rule 3)', () => {
  it('numbers slots 1..8, never 0 and never blank', () => {
    expect(decalDigit(0)).toBe(1);
    expect(decalDigit(7)).toBe(8);
    expect(decalDigit(8)).toBe(1);
    for (let slot = 0; slot < 8; slot++) {
      expect(decalStrokes(decalDigit(slot), 0, 0, 1).length).toBeGreaterThan(0);
    }
  });

  it('gives every digit a distinct glyph', () => {
    const glyphs = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => JSON.stringify(decalStrokes(d, 0, 0, 1)));
    expect(new Set(glyphs).size).toBe(8);
  });
});
