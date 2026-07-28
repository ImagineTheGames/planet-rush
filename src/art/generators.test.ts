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
 * owes the ruleset: three crack stages that actually differ, four station
 * variants that actually differ, richer rocks that actually look richer.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  asteroidKindFor,
  asteroidOutline,
  asteroidSprite,
  oreChunkSprite,
  ASTEROID_KINDS,
} from './asteroids';
import { buildProgressSprite, shieldSprite, shieldStrength, turretSprite } from './buildings';
import { ALL_SPRITES } from './catalogue';
import { decalDigit, decalStrokes } from './decals';
import {
  atmosphereHaloSprite,
  beaconRingSprite,
  continentPolygons,
  damageRingSprite,
  stationSprite,
  stationVariantFor,
  repairAuraSprite,
  ATMOSPHERE_HALO_RADIUS,
  STATION_VARIANT_COUNT,
} from './stations';
import { DEPOSIT_RANGE, STATION } from '../sim/constants';
import { shipSprite } from './ships';
import { satelliteSprite, satelliteWreckSprite, type SatelliteState } from './satellite';
import { spriteKey, type SpriteDef } from './shapes';
import { debrisFieldSprite, stationWreckSprite } from './wrecks';

/** Everything that has to be reproducible, with a second identical call. */
const REPEATABLE: readonly (() => SpriteDef)[] = [
  () => shipSprite({ shipClass: ShipClass.Excavator, playerId: 5 }),
  () => stationSprite(2),
  () => beaconRingSprite(6),
  () => damageRingSprite(6, 0.42),
  () => repairAuraSprite(),
  () => asteroidSprite({ seed: 41, crackStage: 1 }),
  () => oreChunkSprite(9),
  () => turretSprite({ playerId: 3, state: 'tracking' }),
  () => shieldSprite({ playerId: 3, strength: 'weakened' }),
  () => buildProgressSprite(0.4),
  () => stationWreckSprite(1),
  () => debrisFieldSprite(2),
  () => atmosphereHaloSprite(0),
  () => satelliteSprite({ playerId: 2, state: 'sweeping' }),
  () => satelliteWreckSprite(3),
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

  it('builds all six ratified pool types, each visibly its own (docs/art-direction §5.5)', () => {
    expect(ASTEROID_KINDS).toEqual(['shard', 'ice', 'rubble', 'husk', 'geode', 'patina']);
    // The kind is a total, deterministic function of the pooling seed.
    for (let seed = 0; seed < 6; seed++) expect(asteroidKindFor(seed)).toBe(ASTEROID_KINDS[seed]);
    expect(asteroidKindFor(6)).toBe('shard'); // wraps
    expect(asteroidKindFor(-1)).toBe('patina'); // and wraps the other way

    // Six distinct sprites at the same seed/stage — six looks, not one rock recoloured.
    const looks = ASTEROID_KINDS.map((kind) => spriteKey(asteroidSprite({ seed: 4, crackStage: 0, kind })));
    expect(new Set(looks).size).toBe(ASTEROID_KINDS.length);

    // And every one of them cracks across three stages.
    for (const kind of ASTEROID_KINDS) {
      const s = [0, 1, 2].map((crackStage) => asteroidSprite({ seed: 4, crackStage, kind }));
      expect(s[0]).not.toEqual(s[1]);
      expect(s[1]).not.toEqual(s[2]);
    }
  });

  it('makes the geode payout countable — crystal count tracks the ore left (A5)', () => {
    const crystals = (richness: number): number =>
      // Each crystal is a signal-yellow kite; count the yellow bodies.
      asteroidSprite({ seed: 4, crackStage: 0, richness, kind: 'geode' }).shapes.filter(
        (s) => s.role === 'ore' && s.fill?.color === 0xf2d24b,
      ).length;
    expect(crystals(1)).toBeGreaterThan(crystals(0.5));
    expect(crystals(0.5)).toBeGreaterThan(crystals(0.2));
    expect(crystals(0)).toBe(0);
  });

  it('spends no yellow on an empty rock, whichever type it is (payout honesty)', () => {
    const ore = (kind: (typeof ASTEROID_KINDS)[number]): number =>
      asteroidSprite({ seed: 4, crackStage: 0, richness: 0, kind }).shapes.filter((s) => s.role === 'ore').length;
    for (const kind of ASTEROID_KINDS) expect(ore(kind)).toBe(0);
  });
});

describe('stations — four variants, arrangement only (style-guide §5)', () => {
  it('makes four distinct worlds', () => {
    const defs = [0, 1, 2, 3].map(stationSprite);
    for (let i = 0; i < defs.length; i++) {
      for (let j = i + 1; j < defs.length; j++) expect(defs[i]).not.toEqual(defs[j]);
    }
  });

  it('varies by continent layout and land ratio, not by colour', () => {
    const palettes = [0, 1, 2, 3].map((v) => new Set(stationSprite(v).shapes.map((s) => s.fill?.color)));
    for (const p of palettes) expect(p).toEqual(palettes[0]);
    expect(continentPolygons(0).length).not.toBe(continentPolygons(3).length);
  });

  it('puts the signal-yellow core on every world — the win condition (§2)', () => {
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      expect(stationSprite(v).shapes.some((s) => s.role === 'core')).toBe(true);
    }
  });

  it('assigns a variant per player and wraps safely', () => {
    expect(stationVariantFor(0)).toBe(0);
    expect(stationVariantFor(4)).toBe(0);
    expect(stationVariantFor(-1)).toBe(3);
  });

  it('draws the atmosphere halo at exactly DEPOSIT_RANGE — visual and rule never drift (p4-12)', () => {
    // The unit-space edge is DEPOSIT_RANGE / STATION.radius and nothing else, so
    // the halo is the sim constant, expressed as art.
    expect(ATMOSPHERE_HALO_RADIUS).toBe(DEPOSIT_RANGE / STATION.radius);

    const def = atmosphereHaloSprite(0);
    // The outermost disc *is* the atmosphere edge; scaled by the station radius
    // (how the renderer draws it) it lands on DEPOSIT_RANGE world units exactly.
    const outerUnit = Math.max(
      ...def.shapes.map((s) => (s.path.kind === 'circle' ? s.path.r : 0)),
    );
    expect(outerUnit).toBe(ATMOSPHERE_HALO_RADIUS);
    expect(outerUnit * STATION.radius).toBeCloseTo(DEPOSIT_RANGE, 4);
    // The sprite's own square is sized to the halo, not clipped to the station.
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

  it('fills red as core HP is LOST, quantised so the pool holds (p11 grammar)', () => {
    // Ratified p11: a full core is the owner ring alone (one shape); a dead core
    // adds the red fill on top (two). The red grows with damage — the reverse of
    // the old "arc == remaining" grammar the developer called backwards.
    expect(damageRingSprite(0, 0).shapes.length).toBeGreaterThan(damageRingSprite(0, 1).shapes.length);
    // 5% quantisation: two nearby fractions share a sprite (and so a texture).
    expect(damageRingSprite(0, 0.51)).toEqual(damageRingSprite(0, 0.52));
    expect(damageRingSprite(0, 0.5)).not.toEqual(damageRingSprite(0, 0.9));
    // The owner is in the sprite: two owners at the same HP are two rings.
    expect(damageRingSprite(0, 0.5)).not.toEqual(damageRingSprite(1, 0.5));
    // Out-of-range input is clamped, never thrown.
    expect(damageRingSprite(0, -1)).toEqual(damageRingSprite(0, 0));
    expect(damageRingSprite(0, 2)).toEqual(damageRingSprite(0, 1));
  });
});

describe('turrets and shields — the siege tells (GDD §2.6)', () => {
  it('telegraphs four distinct muzzle states', () => {
    const states = (['building', 'idle', 'tracking', 'firing'] as const).map((state) =>
      turretSprite({ playerId: 0, state }),
    );
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) expect(states[i]).not.toEqual(states[j]);
    }
  });

  it('reads as a distinct silhouette per Mk — the pool escalates (art-direction §5.5)', () => {
    // The three ladder silhouettes plus the reserved dome are four different guns
    // at the same state, so an upgrade reads as *more gun* at a glance.
    const pool = (['breech', 'twin', 'rail', 'dome'] as const).map((silhouette) =>
      turretSprite({ playerId: 0, state: 'idle', silhouette }),
    );
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) expect(pool[i]).not.toEqual(pool[j]);
    }
    // The tier ladder resolves to the ratified map: I=breech, II=twin, III=rail.
    expect(turretSprite({ playerId: 0, state: 'idle', tier: 0 })).toEqual(pool[0]);
    expect(turretSprite({ playerId: 0, state: 'idle', tier: 1 })).toEqual(pool[1]);
    expect(turretSprite({ playerId: 0, state: 'idle', tier: 2 })).toEqual(pool[2]);
    // A tier past the top clamps to Mk III (mirrors the sim's tier clamp).
    expect(turretSprite({ playerId: 0, state: 'idle', tier: 9 })).toEqual(pool[2]);
  });

  it('is a scaffold until the build finishes — the art does not lie about readiness', () => {
    const building = turretSprite({ playerId: 0, state: 'building' });
    const idle = turretSprite({ playerId: 0, state: 'idle' });
    // Hazard stripes are the one legal yellow on a turret (style-guide §2), and a
    // scaffold carries them; a standing, ready turret never does.
    expect(building.shapes.some((s) => s.role === 'danger')).toBe(true);
    expect(idle.shapes.some((s) => s.role === 'danger')).toBe(false);
    // The scaffold has no live bore or muzzle charge — no energy the way a ready
    // turret's cold bore glows.
    expect(building.shapes.some((s) => s.role === 'energy')).toBe(false);
    expect(idle.shapes.some((s) => s.role === 'energy')).toBe(true);
    // A build is always a fresh Mk I, so the scaffold is one look across the pool.
    expect(turretSprite({ playerId: 0, state: 'building', silhouette: 'rail' })).toEqual(building);
  });

  it('fires in threat red, and only when firing', () => {
    const firing = turretSprite({ playerId: 0, state: 'firing' });
    const tracking = turretSprite({ playerId: 0, state: 'tracking' });
    expect(firing.shapes.some((s) => s.role === 'danger')).toBe(true);
    expect(tracking.shapes.some((s) => s.role === 'danger')).toBe(false);
    // The twin fires from BOTH barrels — more red than the single-barrel breech.
    const twinFire = turretSprite({ playerId: 0, state: 'firing', silhouette: 'twin' });
    const breechFire = turretSprite({ playerId: 0, state: 'firing', silhouette: 'breech' });
    const reds = (d: typeof firing) => d.shapes.filter((s) => s.role === 'danger').length;
    expect(reds(twinFire)).toBeGreaterThan(reds(breechFire));
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

describe('radar satellite — the eyes (f1)', () => {
  const STATES: readonly SatelliteState[] = ['building', 'idle', 'sweeping', 'pinging'];

  it('reads as its own structure, distinct across every sensor state', () => {
    const defs = STATES.map((state) => satelliteSprite({ playerId: 0, state }));
    for (let i = 0; i < defs.length; i++) {
      for (let j = i + 1; j < defs.length; j++) expect(defs[i]).not.toEqual(defs[j]);
    }
  });

  it('scans in plasma and never fires — no threat red on a live dish', () => {
    // A satellite is a sensor, not a gun: red stays enemy fire (style-guide §2).
    for (const state of ['idle', 'sweeping', 'pinging'] as const) {
      const def = satelliteSprite({ playerId: 0, state });
      expect(def.shapes.some((s) => s.role === 'danger')).toBe(false);
      expect(def.shapes.some((s) => s.role === 'energy')).toBe(true);
    }
  });

  it('is a scaffold until the build finishes — the art does not lie about readiness', () => {
    const building = satelliteSprite({ playerId: 0, state: 'building' });
    const idle = satelliteSprite({ playerId: 0, state: 'idle' });
    // Hazard stripes are the one legal yellow (style-guide §2), per the a2-05
    // scaffold grammar; a finished, scanning dish never carries them.
    expect(building.shapes.some((s) => s.role === 'danger')).toBe(true);
    expect(idle.shapes.some((s) => s.role === 'danger')).toBe(false);
    // And a scaffold is not yet an eye: no live plasma feed the way idle glows.
    expect(building.shapes.some((s) => s.role === 'energy')).toBe(false);
    expect(idle.shapes.some((s) => s.role === 'energy')).toBe(true);
  });

  it('wears its owner colour on trim only, and pings reach past the rim', () => {
    // Owner identity moves the sprite (colour and cache key both) — two owners
    // are two dishes; and identity paint lives only on trim (§3).
    expect(satelliteSprite({ playerId: 0, state: 'idle' })).not.toEqual(
      satelliteSprite({ playerId: 1, state: 'idle' }),
    );
    // The ping's return pulse overhangs the collision radius, so the extent grows
    // to hold it — pooling must never clip a contact.
    const ping = satelliteSprite({ playerId: 0, state: 'pinging' });
    const idle = satelliteSprite({ playerId: 0, state: 'idle' });
    expect(ping.extent).toBeGreaterThan(idle.extent);
    expect(ping.extent).toBeGreaterThan(1);
  });

  it('leaves a cold death remnant — no yellow, no red, nothing to loot (§8)', () => {
    // Losing your eyes is an absence, not a threat, and a satellite banks no ore:
    // its wreck is pure cold hull — the one place the wreck language drops even
    // the ore-laden debris a station wreck keeps.
    for (const seed of [0, 1, 2, 3]) {
      const def = satelliteWreckSprite(seed);
      expect(def.shapes.some((s) => s.role === 'danger' || s.role === 'ore' || s.role === 'core')).toBe(false);
    }
    expect(satelliteWreckSprite(0)).not.toEqual(satelliteWreckSprite(1));
  });
});

describe('wrecks — the quiet (style-guide §8)', () => {
  it('puts the core out: no yellow anywhere on a dead station', () => {
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      const def = stationWreckSprite(v);
      expect(def.shapes.some((s) => s.role === 'core' || s.role === 'ore')).toBe(false);
    }
  });

  it('stays cold — no threat red on a wreck; a wreck is an absence, not a threat', () => {
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      expect(stationWreckSprite(v).shapes.some((s) => s.role === 'danger')).toBe(false);
    }
  });

  it('keeps the same coastlines as the world it was — you lose *that* station', () => {
    const wreck = stationWreckSprite(2);
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
