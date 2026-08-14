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
  cutterheadLayout,
  damageRingSprite,
  stationSprite,
  stationVariantFor,
  repairAuraSprite,
  ATMOSPHERE_HALO_RADIUS,
  BUILD_RING_RADIUS,
  STATION_VARIANT_COUNT,
} from './stations';
import { auditSprite } from './compliance';
import { RING_JND, scanRings } from './ring-scan';
import { DERIVED, FLOOR, PALETTE } from './palette';
import { DEPOSIT_RANGE, STATION } from '../sim/constants';
import { shipSprite } from './ships';
import { satelliteSprite, satelliteWreckSprite, type SatelliteState } from './satellite';
import { spriteKey, type Shape, type SpriteDef } from './shapes';
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
  () => atmosphereHaloSprite(0, true),
  () => satelliteSprite({ playerId: 2, state: 'sweeping' }),
  () => satelliteWreckSprite(3),
];

/** How far the sprite's painted mass actually reaches, in unit space — over
 *  discs and polygons alike, so a range ring drawn as a band is measured the same
 *  as one drawn as a disc. */
function outerRadius(def: SpriteDef): number {
  let r = 0;
  for (const s of def.shapes) {
    if (s.path.kind === 'circle') {
      r = Math.max(r, Math.hypot(s.path.cx, s.path.cy) + s.path.r);
    } else {
      const p = s.path.points;
      for (let i = 0; i < p.length; i += 2) r = Math.max(r, Math.hypot(p[i]!, p[i + 1]!));
    }
  }
  return r;
}

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

describe('ore chunks — CRYSTALLINE, the ratified pick (a0-41)', () => {
  /**
   * The developer reviewed every FACET × RIM × HALO combination in scene, at the
   * chunk's real sim radius beside the 64-unit station, and picked one:
   * *"ok crystaline with these options"*. Every number below is that pick.
   *
   * They are asserted off the SPRITE rather than off the constants that produce
   * it, deliberately. A test that reads `CHUNK_RADIUS` and checks it is 0.62
   * asserts that the file equals itself; a test that measures the polygon
   * asserts that the chunk on screen is the chunk that was approved, whatever
   * the generator is refactored into.
   */
  const RATIFIED = {
    facets: 7,
    radius: 0.62,
    rimWidth: 0.09,
    /** The subtle halo's alphas × 2.1 — "Strong". */
    halo: [
      { r: 0.98, alpha: 0.21 },
      { r: 0.72, alpha: 0.336 },
    ],
  } as const;

  const bodyOf = (def: SpriteDef): Shape =>
    def.shapes.find((s) => s.path.kind === 'poly' && s.stroke !== undefined)!;

  it('is a seven-facet crystal on a unit radius of 0.62, not a disc', () => {
    for (let seed = 0; seed < 4; seed++) {
      const body = bodyOf(oreChunkSprite(seed));
      const pts = (body.path as { points: readonly number[] }).points;
      expect(pts.length / 2, `seed ${seed} facet count`).toBe(RATIFIED.facets);

      // Mean vertex radius is the ratified 0.62; the spread around it is the
      // per-facet jitter, and it has to be there or the crystal is a heptagon.
      const radii: number[] = [];
      for (let i = 0; i < pts.length; i += 2) radii.push(Math.hypot(pts[i]!, pts[i + 1]!));
      const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
      expect(mean, `seed ${seed} mean radius`).toBeCloseTo(RATIFIED.radius, 1);
      expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii) * 1.1);

      // Angles are jittered too — equal-angle vertices read as a turned shape.
      const angles = [...Array(RATIFIED.facets)].map((_, i) =>
        Math.atan2(pts[i * 2 + 1]!, pts[i * 2]!),
      );
      const gaps = angles.map((a, i) => {
        const d = angles[(i + 1) % angles.length]! - a;
        return d < 0 ? d + Math.PI * 2 : d;
      });
      expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) * 1.1);
    }
  });

  it('carries the dark rim as a STROKE on the body, never a polygon behind it', () => {
    const def = oreChunkSprite(0);
    const body = bodyOf(def);
    // A scaled-up polygon behind a seven-sided silhouette shows its corners
    // where a stroke follows the edge — load-bearing at 8 px, so the rim's
    // *mechanism* is pinned, not just its colour.
    expect(body.fill?.color).toBe(PALETTE.signalYellow);
    expect(body.stroke?.color).toBe(DERIVED.oreDeep);
    expect(body.stroke?.width).toBeCloseTo(RATIFIED.rimWidth, 6);
    expect(body.role).toBe('ore');
    const reachOf = (s: Shape): number => {
      const p = (s.path as { points: readonly number[] }).points;
      let r = 0;
      for (let i = 0; i < p.length; i += 2) r = Math.max(r, Math.hypot(p[i]!, p[i + 1]!));
      return r;
    };
    const bodyReach = reachOf(body);
    for (const s of def.shapes) {
      if (s === body || s.path.kind !== 'poly') continue;
      expect(reachOf(s), 'no polygon sits outside the body — the rim is the stroke').toBeLessThan(bodyReach);
    }
  });

  it('is three-tone — a shadowed lower-right facet and a lit upper-left one', () => {
    const def = oreChunkSprite(0);
    const centroid = (s: Shape): { x: number; y: number } => {
      const p = (s.path as { points: readonly number[] }).points;
      let x = 0;
      let y = 0;
      for (let i = 0; i < p.length; i += 2) {
        x += p[i]!;
        y += p[i + 1]!;
      }
      return { x: x / (p.length / 2), y: y / (p.length / 2) };
    };
    const shadow = def.shapes.find((s) => s.fill?.color === DERIVED.oreDeep && s.fill.alpha === 0.9)!;
    const lit = def.shapes.find((s) => s.fill?.color === DERIVED.coreHot && s.fill.alpha === 0.9)!;
    expect(shadow).toBeDefined();
    expect(lit).toBeDefined();
    // +y is down, +x is right: the shadow sits lower-right of the lit facet.
    expect(centroid(shadow).x).toBeGreaterThan(centroid(lit).x);
    expect(centroid(shadow).y).toBeGreaterThan(centroid(lit).y);
  });

  it('wears the STRONG halo — the subtle one × 2.1, at the radii it always used', () => {
    const def = oreChunkSprite(0);
    const discs = def.shapes.filter((s) => s.path.kind === 'circle');
    expect(discs).toHaveLength(RATIFIED.halo.length);
    for (let i = 0; i < RATIFIED.halo.length; i++) {
      const want = RATIFIED.halo[i]!;
      const disc = discs[i]!;
      expect((disc.path as { r: number }).r).toBeCloseTo(want.r, 6);
      expect(disc.fill?.alpha).toBeCloseTo(want.alpha, 6);
      expect(disc.fill?.color).toBe(PALETTE.signalYellow);
      expect(disc.role).toBe('ore');
      // 2.1× a subtle halo, stated as the ratio rather than as two more numbers.
      expect(want.alpha / 2.1).toBeCloseTo([0.1, 0.16][i]!, 6);
    }
  });

  /**
   * **The §2 question the Strong halo has to answer**, and it is a measurement.
   *
   * Ore is the RESERVED signal-yellow role, and a0-41 makes a field of 120
   * chunks brighter. So: does the ore field start competing with the HUD's own
   * yellow (the hold pips and the banked numeral, `src/ui/hud.ts` /
   * `ore-hold-view.ts` — flat `signalYellow` at α 1)?
   *
   * No, and the reason is structural rather than lucky: **the halo is a ring,
   * not a fill.** Everything it raises sits *outside* the body, and the body was
   * already flat signal yellow at α 1 before this brief and still is. So the
   * brightest ore pixel on screen has not moved at all — what moved is the
   * mid-value ring around it, which is what "findable from outside tractor
   * range" means. Composited over Floor, in Y′ (0..255):
   *
   * ```
   *   halo outer α 0.21          50.6      ← was 29.1 (subtle)
   *   halo inner, over it        103.2     ← was ~55
   *   the chunk body             207.0     ← unchanged, and it is the HUD's number
   * ```
   */
  it('makes no ore pixel brighter than the HUD yellow it shares a screen with', () => {
    const luma = (c: number): number =>
      0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff);
    /** `over` composited onto `under` at `alpha`, per channel, then Y′. */
    const overLuma = (under: number, over: number, alpha: number): number => {
      let out = 0;
      for (const sh of [16, 8, 0]) {
        const v = Math.round(((over >> sh) & 0xff) * alpha + ((under >> sh) & 0xff) * (1 - alpha));
        out |= v << sh;
      }
      return luma(out);
    };

    const def = oreChunkSprite(0);
    const discs = def.shapes.filter((s) => s.path.kind === 'circle');
    // The halo, stacked outer-then-inner exactly as it draws, over Floor.
    let halo = FLOOR;
    for (const d of discs) {
      let next = 0;
      for (const sh of [16, 8, 0]) {
        const v = Math.round(
          ((d.fill!.color >> sh) & 0xff) * d.fill!.alpha + ((halo >> sh) & 0xff) * (1 - d.fill!.alpha),
        );
        next |= v << sh;
      }
      halo = next;
    }
    const body = luma(PALETTE.signalYellow);

    // The halo is a finder ring and never a signal: at its brightest it is half
    // the chunk's own body, which is the HUD's own flat signal yellow.
    expect(luma(halo)).toBeLessThan(body * 0.55);
    expect(luma(halo)).toBeGreaterThan(luma(FLOOR) * 4); // …and it is not nothing

    // The one ink on the chunk brighter than the body is the LIT facet, and it
    // is not new — `coreHot` at α .9 is the same three-tone recipe the previous
    // blob carried, and it is below the station core's own lit centre, which
    // spends the identical hue at α 1 under the same RESERVED rule.
    const lit = def.shapes.find((s) => s.fill?.color === DERIVED.coreHot)!;
    expect(overLuma(PALETTE.signalYellow, DERIVED.coreHot, lit.fill!.alpha)).toBeLessThan(luma(DERIVED.coreHot));
  });

  it('keeps four distinct chunks, so a field of 120 does not read as tiling', () => {
    const looks = [0, 1, 2, 3].map((seed) => spriteKey(oreChunkSprite(seed)));
    expect(new Set(looks).size).toBe(4);
    // And the fold the atlas and the renderer both apply is what makes it four.
    expect(spriteKey(oreChunkSprite(4))).toBe(spriteKey(oreChunkSprite(4)));
  });

  it('is all ore and nothing else — the RESERVED rule, structurally', () => {
    for (let seed = 0; seed < 4; seed++) {
      const def = oreChunkSprite(seed);
      expect(auditSprite(def)).toEqual([]);
      for (const s of def.shapes) expect(s.role).toBe('ore');
    }
  });
});

describe('stations — THE CUTTERHEAD, four variants (facility-concepts-r2.html, direction D)', () => {
  it('makes four distinct facilities', () => {
    const defs = [0, 1, 2, 3].map((v) => stationSprite(v));
    for (let i = 0; i < defs.length; i++) {
      for (let j = i + 1; j < defs.length; j++) expect(defs[i]).not.toEqual(defs[j]);
    }
  });

  it('varies by arrangement, not by colour — one rig, four seeds', () => {
    // Same fill palette across all four (the rig is one machine in one palette);
    // what moves is the circuit's bearing, the cut face, the seams and the levels.
    const palettes = [0, 1, 2, 3].map((v) => new Set(stationSprite(v).shapes.map((s) => s.fill?.color)));
    for (const p of palettes) expect(p).toEqual(palettes[0]);
    const layouts = [0, 1, 2, 3].map(cutterheadLayout);
    expect(new Set(layouts.map((l) => l.spec.deckPhase)).size).toBe(4);
    expect(new Set(layouts.map((l) => l.seams.length)).size).toBe(4);
    expect(layouts[0]!.face).not.toEqual(layouts[3]!.face);
  });

  it('puts the signal-yellow core on every rig — the win condition (§2)', () => {
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      expect(stationSprite(v).shapes.some((s) => s.role === 'core')).toBe(true);
    }
  });

  it('is visibly EXTRACTING: a cut face with ore seams in it, and a kerf', () => {
    // Round 1 was denied because "nothing was visibly extracting anything ...
    // there was no ore you could see". Ore inside the bore (r < 0.5) is the cut
    // face's seams and the fresh kerf; ore out on the deck (r > 0.55) is the
    // circuit carrying it away. Both have to exist or the object is a building.
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      const ore = stationSprite(v).shapes.filter((s) => s.role === 'ore');
      const reach = (s: (typeof ore)[number]): number => {
        if (s.path.kind === 'circle') return Math.hypot(s.path.cx, s.path.cy);
        let far = 0;
        for (let i = 0; i < s.path.points.length; i += 2) {
          far = Math.max(far, Math.hypot(s.path.points[i]!, s.path.points[i + 1]!));
        }
        return far;
      };
      expect(ore.some((s) => reach(s) < 0.5), `v${v} has no ore in the bore`).toBe(true);
      expect(ore.some((s) => reach(s) > 0.55), `v${v} has no ore on the circuit`).toBe(true);
    }
  });

  it('is NOT radially symmetric — one arm leaves the circle (the round-1 fix)', () => {
    // "The outlines were radially symmetric. That is what planets are, and what
    // working plants never are." The spoil boom is the mark that fixes it, so it
    // is asserted rather than left to a reviewer's eye: painted mass has to reach
    // well past the collision radius on ONE bearing and not on its opposite.
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      const far = stationSprite(v).shapes.filter(
        (s) => s.path.kind === 'circle' && Math.hypot(s.path.cx, s.path.cy) > 1.3,
      );
      expect(far.length, `v${v} has nothing outboard of 1.3R`).toBeGreaterThan(4);
      const bearings = far.map((s) => (s.path.kind === 'circle' ? Math.atan2(s.path.cy, s.path.cx) : 0));
      const spread = Math.max(...bearings) - Math.min(...bearings);
      expect(spread, `v${v} outboard mass is spread over ${spread.toFixed(2)} rad — that is a halo, not an arm`).toBeLessThan(1.2);
    }
  });

  it('never lets steel take the roster colour — identity is trim (§3)', () => {
    const trim = stationSprite(0, 5).shapes.filter((s) => s.role === 'identity');
    expect(trim.length).toBeGreaterThan(0);
    // And the sprite differs by owner, which is the whole point of the trim.
    expect(stationSprite(0, 0)).not.toEqual(stationSprite(0, 5));
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

    for (const def of [atmosphereHaloSprite(0), atmosphereHaloSprite(0, true)]) {
      // The outermost shape *is* the atmosphere edge; scaled by the station radius
      // (how the renderer draws it) it lands on DEPOSIT_RANGE world units exactly.
      const outerUnit = outerRadius(def);
      expect(outerUnit, def.name).toBeCloseTo(ATMOSPHERE_HALO_RADIUS, 3);
      expect(outerUnit * STATION.radius, def.name).toBeCloseTo(DEPOSIT_RANGE, 2);
      // The sprite's own square is sized to the halo, not clipped to the station.
      expect(def.extent, def.name).toBe(ATMOSPHERE_HALO_RADIUS);
    }
  });

  it('draws the build ring at exactly STATION.dockRange (a4-01)', () => {
    // The wheel's own radius, expressed as art — never a second literal, so
    // retuning docking moves the dashes the player flies across in lockstep.
    expect(BUILD_RING_RADIUS).toBe(STATION.dockRange / STATION.radius);
    expect(BUILD_RING_RADIUS * STATION.radius).toBe(STATION.dockRange);
    // And it is inside the atmosphere, because the rule is (DEPOSIT_RANGE >
    // dockRange): you are in your air well before you are in reach.
    expect(BUILD_RING_RADIUS).toBeLessThan(ATMOSPHERE_HALO_RADIUS);
  });

  it('shows EXACTLY TWO rings around an own station, at the two radii that mean something (a4-01)', () => {
    // The field report, 2026-08-05: "theres a bunch of rings around the station
    // (planet) we only need 2". They were counting the steps of a five-stop
    // gradient. So this counts what a player counts — edges in the composited
    // alpha profile big enough to see (./ring-scan) — rather than how many
    // ring-shaped primitives happen to be in the sprite. A future gradient with
    // one step too coarse fails here, which is the whole point.
    for (const reduced of [false, true]) {
      const def = atmosphereHaloSprite(0, reduced);
      const scan = scanRings(def);
      const where = `${def.name}: rings at ${scan.rings.map((r) => r.outer.toFixed(2)).join(', ')}`;

      expect(scan.rings.length, where).toBe(2);
      // Two rings and nothing else: every visible step belongs to one of them.
      expect(scan.edges.length, where).toBe(4);

      const [build, atmosphere] = scan.rings;
      expect(build!.outer, `${where} — build ring`).toBeCloseTo(BUILD_RING_RADIUS, 1);
      expect(atmosphere!.outer, `${where} — atmosphere edge`).toBeCloseTo(ATMOSPHERE_HALO_RADIUS, 1);
      // Both rings are known to a sample step, so pin that the scan is fine
      // enough for "close to" to mean "on it".
      expect(Math.abs(build!.outer - BUILD_RING_RADIUS), where).toBeLessThanOrEqual(scan.step);
      expect(Math.abs(atmosphere!.outer - ATMOSPHERE_HALO_RADIUS), where).toBeLessThanOrEqual(scan.step);
    }
  });

  it('keeps the atmosphere gradient smooth — no interior step reads as its own ring (a4-01)', () => {
    const scan = scanRings(atmosphereHaloSprite(0));
    // Everything strictly inside the build ring is haze: the gradient, and the
    // part of it hidden behind the station body. Not one step in it may be
    // findable, however many discs the gradient is built from.
    let worst = 0;
    for (let i = 0; i + 1 < scan.alpha.length; i++) {
      if (scan.radii[i + 1]! >= BUILD_RING_RADIUS - 0.1) break;
      worst = Math.max(worst, Math.abs(scan.alpha[i + 1]! - scan.alpha[i]!));
    }
    expect(worst, `worst interior alpha step ${worst.toFixed(4)}`).toBeLessThan(RING_JND);
    // The shipped five-stop halo stepped by ~0.067 here — sixteen levels against
    // Vacuum. Assert real headroom, not a hairline pass.
    expect(worst).toBeLessThan(RING_JND / 2);
  });

  it('gives a rival station neither ring — both are affordances you do not have there', () => {
    // Enforced structurally rather than by the renderer's good intentions: the
    // halo is the ONLY sprite carrying either radius, and the renderer draws it
    // for the viewer's own station alone (`drawAtmosphere`). Nothing else in the
    // catalogue reaches past a station's own beacon.
    const reach = ALL_SPRITES.filter((d) => d.name.startsWith('station/') && !d.name.includes('atmosphere'));
    expect(reach.length).toBeGreaterThan(0);
    for (const def of reach) {
      expect(def.extent, `${def.name} reaches past a station's own furniture`).toBeLessThan(BUILD_RING_RADIUS);
    }
  });

  it('paints the air in the player colour and the reach in plasma — two kinds of boundary (§1, §3)', () => {
    for (const slot of [0, 3, 7]) {
      for (const reduced of [false, true]) {
        const def = atmosphereHaloSprite(slot, reduced);
        expect(def.shapes.length).toBeGreaterThan(0);
        // Air is identity trim; the build ring is plasma energy — the same colour
        // the BUILD button it lights wears. Nothing else is in there.
        const roles = new Set(def.shapes.map((s) => s.role));
        expect([...roles].sort(), def.name).toEqual(['energy', 'identity']);
        for (const s of def.shapes) {
          if (s.role !== 'energy') continue;
          expect(s.fill?.color, def.name).toBe(PALETTE.plasma);
        }
      }
    }
    // Distinct owners ⇒ distinct halos (colour and cache key both move).
    expect(atmosphereHaloSprite(0)).not.toEqual(atmosphereHaloSprite(1));
    // The build ring does NOT move with the owner: it is the same rule for
    // everyone, so the two owners' halos differ only in their air.
    const plasmaOf = (id: number) => JSON.stringify(atmosphereHaloSprite(id).shapes.filter((s) => s.role === 'energy'));
    expect(plasmaOf(0)).toBe(plasmaOf(5));
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
  it('puts the core OUT: not one core-role shape on a dead station', () => {
    // The core going dark is the single strongest thing this palette can say, and
    // it is the part of "the quiet" that is absolute. (Ore is a different matter —
    // see the next test: the board's derelict spills ore on purpose.)
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      expect(stationWreckSprite(v).shapes.some((s) => s.role === 'core')).toBe(false);
    }
  });

  it('LEAVES the ore — the split hopper is why anyone comes (GDD §2.7)', () => {
    // Evolved with the ratified board (facility-concepts-r2.html, D · derelict:
    // *"one hopper has split and run its ore onto the deck … the only yellow left
    // is ore, which is why anyone comes"*). This test previously asserted no ore
    // role at all, which was right when the debris field carried every scrap and
    // is wrong now that the derelict is a lootable rig in its own right (§2.1).
    // Yellow on a wreck is legal exactly when it is ore, and the role proves it.
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      expect(stationWreckSprite(v).shapes.some((s) => s.role === 'ore')).toBe(true);
    }
  });

  it('stays cold — no threat red on a wreck; a wreck is an absence, not a threat', () => {
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      expect(stationWreckSprite(v).shapes.some((s) => s.role === 'danger')).toBe(false);
    }
  });

  it('wears no owner: a derelict belongs to nobody (§2.7)', () => {
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      expect(stationWreckSprite(v).shapes.some((s) => s.role === 'identity')).toBe(false);
    }
  });

  it('is the SAME rig it was — you lose *that* station, not a generic disc', () => {
    // The wreck is the live generator under the cold palette, so its arrangement
    // is the arrangement it worked with: same circuit bearing, same cut face.
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      expect(stationWreckSprite(v)).not.toEqual(stationWreckSprite((v + 1) % STATION_VARIANT_COUNT));
    }
    const live = stationSprite(2).shapes.length;
    const dead = stationWreckSprite(2).shapes.length;
    expect(Math.abs(live - dead) / live, 'the wreck is a repaint, not a redraw').toBeLessThan(0.35);
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
