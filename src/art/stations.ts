/**
 * src/art/stations.ts — home worlds, generated. OWNER: Art & Audio Agent.
 *
 * Style-guide §5, and the rules are tight because a station is the one thing in
 * the match that does not respawn (GDD §2.7):
 *
 *  - **Oceans steel-blue, continents patina-green** — "Earth" stays inside the
 *    Cold Vacuum palette instead of importing a second one. Both are value
 *    shades of the six (./palette), so no new hue enters.
 *  - **The core is signal yellow.** It is the win condition, so it is one of the
 *    three things allowed to wear the reserved colour (§2).
 *  - **Four variants**, differing in *continent layout and ocean-to-land ratio
 *    only*. "Variety comes from arrangement, not from new colours" — so the
 *    variants are four seeds through one generator, not four hand-drawn worlds.
 *  - **Ownership is a beacon ring** in the player's colour, always visible.
 *  - **Health is a damage ring**, drawn only inside sensor range (GDD §2.2) —
 *    enemy station HP is scouted, never broadcast, and this file gives the
 *    renderer no way to draw a ring it wasn't asked for.
 *
 * Continents come from the ratified `mulberry32` (`@shared/types`) seeded by
 * variant, so a variant is byte-identical on every machine and every run — the
 * same determinism discipline the sim lives under (GDD §4.1).
 */

import { mulberry32 } from '@shared/types';
import { DEPOSIT_RANGE, STATION } from '../sim/constants';
import { DERIVED, PALETTE, playerColor } from './palette';
import { ringDamageShapes } from './rings';
import {
  annulusPoints,
  arcPoints,
  blob,
  circle,
  fill,
  poly,
  polyline,
  round,
  sprite,
  stroke,
  type Shape,
  type SpriteDef,
} from './shapes';

/** How many home-world looks exist (style-guide §5). Randomised per player. */
export const STATION_VARIANT_COUNT = 4;

/** Per-variant arrangement: the only thing that differs between worlds. */
interface VariantSpec {
  /** Landmass count. */
  readonly continents: number;
  /** Base landmass radius, as a fraction of the station radius. */
  readonly landRadius: number;
  /** How far a landmass centre may sit from the station centre. */
  readonly spread: number;
  /** Human-readable, for the preview sheet and failing-test messages. */
  readonly note: string;
}

const VARIANTS: readonly VariantSpec[] = [
  { continents: 3, landRadius: 0.42, spread: 0.46, note: 'Three broad continents — land-heavy.' },
  { continents: 5, landRadius: 0.3, spread: 0.55, note: 'Five mid landmasses — balanced.' },
  { continents: 2, landRadius: 0.54, spread: 0.34, note: 'Two supercontinents — one big coastline.' },
  { continents: 7, landRadius: 0.2, spread: 0.62, note: 'Seven islands — ocean-heavy.' },
];

/** The variant a player's home world uses. Wraps, so any slot is safe. */
export function stationVariantFor(playerId: number): number {
  const n = Math.trunc(playerId);
  return ((n % STATION_VARIANT_COUNT) + STATION_VARIANT_COUNT) % STATION_VARIANT_COUNT;
}

/** The one-line description of a variant's arrangement. */
export function stationVariantNote(variant: number): string {
  return VARIANTS[variant % VARIANTS.length]!.note;
}

// ---------------------------------------------------------------------------
// Continents
// ---------------------------------------------------------------------------

/** Keep a landmass vertex inside the disc, so no coastline runs off the limb. */
const LAND_LIMIT = 0.93;

function clampToDisc(points: readonly number[], limit: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    const d = Math.hypot(x, y);
    const k = d > limit ? limit / d : 1;
    out.push(round(x * k), round(y * k));
  }
  return out;
}

/**
 * The landmasses of one variant. Seeded from the variant index alone, so
 * variant 2 is the same world in every match, on every machine.
 */
export function continentPolygons(variant: number): number[][] {
  const spec = VARIANTS[variant % VARIANTS.length]!;
  // Seed mixes the variant into a fixed odd constant — distinct variants get
  // well-separated streams rather than adjacent ones.
  const rng = mulberry32((0x9e3779b9 ^ (variant * 0x85ebca6b)) >>> 0);
  const lands: number[][] = [];
  for (let i = 0; i < spec.continents; i++) {
    // Golden-angle placement keeps landmasses from clumping on one hemisphere,
    // with a seeded jitter so they never look like a rosette either.
    const angle = i * 2.399963 + rng.next() * 0.9;
    const dist = spec.spread * (0.35 + rng.next() * 0.65);
    const cx = Math.cos(angle) * dist;
    const cy = Math.sin(angle) * dist;
    const r = spec.landRadius * (0.78 + rng.next() * 0.5);
    const wobble = 0.22 + rng.next() * 0.16;
    const phase = rng.next() * Math.PI * 2;
    const pts = blob(
      cx,
      cy,
      11,
      (_, a) => r * (1 + Math.sin(a * 3 + phase) * wobble + Math.cos(a * 5 - phase) * wobble * 0.5),
    );
    lands.push(clampToDisc(pts, LAND_LIMIT));
  }
  return lands;
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

/**
 * A home world at unit radius: ocean disc, patina continents, limb shading, and
 * the signal-yellow core at the centre. No ownership and no health — those are
 * separate rings (below) so the renderer can obey the fog rule (GDD §2.2).
 */
export function stationSprite(variant: number): SpriteDef {
  const v = variant % STATION_VARIANT_COUNT;
  const shapes: Shape[] = [
    // Ocean.
    circle(0, 0, 1, fill(DERIVED.oceanSteel, 'material')),
    // Continents: a shade offset behind gives every coastline a south-east
    // shadow, which is what stops the landmasses reading as flat stickers.
    ...continentPolygons(v).map((p) =>
      poly(p.map((n) => round(n + 0.03)), fill(DERIVED.continentShade, 'material')),
    ),
    ...continentPolygons(v).map((p) => poly(p, fill(PALETTE.patina, 'material'))),
    ...continentPolygons(v).map((p) => poly(p, stroke(DERIVED.continentLight, 0.015, 'material', 0.5))),
    // Limb: dark on the south-east rim, a thin lit edge on the north-west.
    poly(
      annulusPoints(0, 0, 1, 0.82, -Math.PI * 0.35, Math.PI * 0.6, 28),
      fill(DERIVED.oceanDeep, 'material', 0.55),
    ),
    poly(
      annulusPoints(0, 0, 1, 0.93, Math.PI * 0.75, Math.PI * 1.35, 20),
      fill(DERIVED.hullLight, 'material', 0.22),
    ),
    // The core: the win condition, and the reason yellow is allowed here (§2).
    circle(0, 0, 0.34, fill(PALETTE.signalYellow, 'core', 0.16)),
    circle(0, 0, 0.22, fill(PALETTE.signalYellow, 'core')),
    circle(0, 0, 0.11, fill(DERIVED.coreHot, 'core')),
  ];
  return sprite(`station/v${v}`, 1, shapes);
}

/**
 * The ownership beacon (style-guide §5): a ring in the player's colour outside
 * the station's limb, **always visible**. Four gaps make it read as a beacon
 * rather than an outline, and give it a shape a colourblind player can still
 * pick out next to a neighbouring slot's ring.
 */
export function beaconRingSprite(playerId: number): SpriteDef {
  const color = playerColor(playerId);
  const shapes: Shape[] = [];
  for (let i = 0; i < 4; i++) {
    const from = i * (Math.PI / 2) + 0.22;
    const to = (i + 1) * (Math.PI / 2) - 0.22;
    shapes.push(poly(annulusPoints(0, 0, 1.16, 1.09, from, to, 10), fill(color, 'identity', 0.9)));
  }
  // Four station pips at the gaps, so the ring reads at minimap scale too.
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2);
    shapes.push(circle(round(Math.cos(a) * 1.125), round(Math.sin(a) * 1.125), 0.05, fill(color, 'identity')));
  }
  return sprite(`station/beacon/p${playerId}`, 1.2, shapes);
}

/**
 * The scouted health ring (GDD §2.2, style-guide §5), in the ratified p11
 * grammar: a whole ring in the OWNER's colour is the health you still have, and
 * a threat-red segment FILLS it — from twelve o'clock, clockwise — as HP is
 * lost. A fully red ring is core death, exactly. Drawn only when the viewer's
 * ship is within sensor range — this function has no opinion about that, it just
 * makes the ring the renderer asks for, so fog stays a decision the sim/UI owns.
 *
 * One primitive with the shield layers ({@link ringDamageShapes}), so a scouted
 * rival reads in THEIR colour by exactly the same verb as your own home.
 *
 * @param playerId The core's owner — the base ring wears their roster colour.
 * @param fraction Core HP REMAINING, 0..1 (1 = whole owner ring, 0 = fully red).
 */
export function damageRingSprite(playerId: number, fraction: number): SpriteDef {
  const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  // Quantised to 5% steps: a ring that re-generates on every HP tick would
  // defeat the texture pool (GDD §4.3), and no player reads finer than that.
  const step = Math.round(f * 20) / 20;
  const shapes = ringDamageShapes({ playerId, lost: 1 - step, outer: 1.06, inner: 0.98 });
  return sprite(`station/damage/p${playerId}/${Math.round(step * 100)}`, 1.1, shapes);
}

/**
 * The repair channel's tell (GDD §2.5): a patina bloom over the core while the
 * owner's ship sits home and ore ticks into HP. Patina is the repair colour by
 * contract (style-guide §1, "corrosion, continents, **the repair channel**").
 */
export function repairAuraSprite(): SpriteDef {
  return sprite('station/repair-aura', 1.1, [
    circle(0, 0, 1.04, fill(PALETTE.patina, 'material', 0.14)),
    poly(annulusPoints(0, 0, 1.04, 0.96, 0, Math.PI * 2, 40), fill(PALETTE.patina, 'material', 0.5)),
    ...[0, 1, 2].map((i) =>
      polyline(
        arcPoints(0, 0, 0.7, i * 2.094 + 0.2, i * 2.094 + 0.9, 8),
        stroke(DERIVED.continentLight, 0.05, 'material', 0.7),
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// The atmosphere halo (p4-12) — the deposit range, made visible
// ---------------------------------------------------------------------------

/**
 * The halo's outer edge, in **unit space** (station radius = 1) — derived from
 * the sim's `DEPOSIT_RANGE` and nothing else, so the air the player sees and the
 * radius the rule uses are one number. The renderer draws the sprite scaled by
 * the station radius (`spriteGraphics(def, station.radius)`), which lands this edge
 * on exactly `DEPOSIT_RANGE` world units; `generators.test.ts` asserts the
 * product, and the `DEPOSIT_RANGE` doc-comment (sim) promises the same. Change
 * the sim constant and the halo follows — the two can never drift apart.
 *
 * `STATION.radius` is the same unit the sim measures `DEPOSIT_RANGE` in (both are
 * centre-to-centre world units), so the ratio is exact for a home world.
 */
export const ATMOSPHERE_HALO_RADIUS = DEPOSIT_RANGE / STATION.radius;

/**
 * The atmosphere halo (p4-12; GDD §2.3): a soft, low-opacity air-glow around a
 * player's **own** station, reaching to exactly `DEPOSIT_RANGE` — the radius
 * inside which a ship's hold auto-deposits (ratified p4: "just be in that
 * atmosphere"). The halo *is* the affordance: enemy stations get none, because
 * you cannot deposit there, so a ring of your own colour is the visible answer
 * to "where do I unload?".
 *
 * It reads as air, not a UI circle (the brief): concentric discs in the player's
 * colour, densest at the station limb and thinning to nothing at the atmosphere
 * edge — a radial gradient approximated in the flat-fill IR. Drawn behind the
 * station, so only the outward glow past the limb is seen; the dense inner discs
 * fall behind the ocean body. Player colour ⇒ role `identity` (style-guide §3),
 * the same channel the beacon ring wears.
 *
 * The alpha here is the **bright, ore-flowing** density. The renderer breathes it
 * gently on `world.time` and, while a deposit is actually flowing, holds it near
 * full — an idle halo is dimmed to a hush, a depositing one brightens (pairs with
 * the ore-flight couriers). Static-render discipline: the renderer bakes this to a
 * single texture once per owner (`cacheAsTexture`) and thereafter only fades the
 * one quad — the gradient is never re-rasterised, and the five stacked translucent
 * discs never re-blend per frame (that overdraw was the mobile frame-budget cost
 * this VFX was tuned to shed, GDD §4.3 risk 5).
 *
 * On a device the auto-reducer has throttled (`reduced`), the full gradient's
 * fill is too dear even baked, so the halo drops to the **simpler ring** the tier
 * promises: one thin edge band at `DEPOSIT_RANGE`, in the same identity colour.
 * A thin annulus blends only its own band, not a full-disc quad, so the slow
 * profile buys its frame time back while the affordance — "your air reaches to
 * here" — still reads.
 */
export function atmosphereHaloSprite(playerId: number, reduced = false): SpriteDef {
  const color = playerColor(playerId);
  const r = ATMOSPHERE_HALO_RADIUS;
  if (reduced) {
    // The reduced tier: a soft double band hugging the atmosphere edge, marking
    // exactly where the deposit range ends. Two thin annuli (not a filled disc)
    // so the fill is a hair of the gradient's — the whole point of the tier.
    return sprite(`station/atmosphere/p${playerId}/reduced`, round(r), [
      poly(annulusPoints(0, 0, round(r), round(r * 0.9), 0, Math.PI * 2, 44), fill(color, 'identity', 0.09)),
      poly(annulusPoints(0, 0, round(r * 0.88), round(r * 0.82), 0, Math.PI * 2, 44), fill(color, 'identity', 0.06)),
    ]);
  }
  // [fraction of the halo radius, fill alpha] — largest/faintest first so the
  // discs stack back-to-front into a limb-bright, edge-faint gradient. The
  // outermost disc sits at the full radius: the atmosphere edge is DEPOSIT_RANGE.
  const stops: readonly (readonly [number, number])[] = [
    [1.0, 0.035], // the atmosphere edge — exactly DEPOSIT_RANGE
    [0.8, 0.05],
    [0.6, 0.065],
    [0.4, 0.08],
    [0.26, 0.1], // 0.26·4 ≈ r 1.04: laps just over the station limb, no seam
  ];
  return sprite(
    `station/atmosphere/p${playerId}`,
    round(r),
    stops.map(([frac, alpha]) => circle(0, 0, round(r * frac), fill(color, 'identity', alpha))),
  );
}
