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
// The two rings around your own station (a4-01) — the ranges, made visible
// ---------------------------------------------------------------------------

/**
 * TWO rings around your own home, and exactly two, because there are exactly two
 * radii a player has to know about (field report 2026-08-05, with a screenshot:
 * *"theres a bunch of rings around the station (planet) we only need 2"*):
 *
 *  - the **atmosphere edge** at `DEPOSIT_RANGE` — inside it your hold empties
 *    itself into the bank ({@link ATMOSPHERE_HALO_RADIUS});
 *  - the **build ring** at `STATION.dockRange` — inside it the Build & Upgrade
 *    wheel is live ({@link BUILD_RING_RADIUS}).
 *
 * Both radii already existed and already drove the sim; neither moves here. What
 * changed is that the atmosphere used to *look* like five rings (a five-step
 * gradient whose every step was a findable edge) and the build radius was drawn
 * nowhere at all — so the player could count five boundaries and none of them was
 * the one that gates building.
 *
 * The two are deliberately different **kinds** of boundary, so they can never be
 * mistaken for the same rule stated twice, and so they still separate with colour
 * removed (style-guide §3 rule 4 — form carries information, colour is the fast
 * read):
 *
 * | | atmosphere edge | build ring |
 * |---|---|---|
 * | radius | `DEPOSIT_RANGE` (4·station radius) | `STATION.dockRange` (2.5·) |
 * | form | one continuous soft band | short dashes, a threshold scale |
 * | colour | the owner's roster colour (`identity`) | plasma (`energy`) |
 * | reads as | "your air reaches to here" | "your hands reach to here" |
 *
 * Plasma is the game's interactive/energy colour (style-guide §1) and is already
 * what the BUILD button wears, so the ring in the world and the button on the
 * thumb are visibly the same affordance — cross the plasma dashes and the plasma
 * button lights up ({@link ../ui/build-button}).
 *
 * `ring-scan.ts` measures both as a player sees them and `generators.test.ts`
 * asserts the count, so the next well-meaning gradient cannot quietly add a third.
 */

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
 * The build ring's radius, in the same **unit space** — `STATION.dockRange` and
 * nothing else, so the dashes the player flies across and the radius the wheel
 * gates on are one number. `STATION.dockRange` is the sim's own docking test
 * (`isDocked`, src/sim/buildings.ts), which is what the Build & Upgrade wheel
 * opens on (GDD §2.5, "your ship must sit at your station") and what lights the
 * BUILD button. Comfortably inside {@link ATMOSPHERE_HALO_RADIUS} — 2.5 station
 * radii against 4 — which is the rule (`DEPOSIT_RANGE > STATION.dockRange`)
 * showing itself: you are in your air well before you are in reach.
 */
export const BUILD_RING_RADIUS = STATION.dockRange / STATION.radius;

// --- The atmosphere gradient ------------------------------------------------
//
// Steps, and the profile they approximate. The count is the fix: the shipped
// halo used five, whose cumulative alpha stepped by ~0.067 a band — sixteen
// levels of a channel against Vacuum, which is not a gradient, it is four extra
// rings. At 40 steps over the same alpha range each step is ~0.0045, about ONE
// level: under 8-bit quantisation, and a quarter of `RING_JND` (./ring-scan).
// The whole stack is baked to one texture per owner by the renderer, so the cost
// of the extra discs is paid once, at match start, and never per frame.

/** Discs in the gradient. See the note above for why it is this many. */
const HALO_STEPS = 40;
/** Innermost disc, as a fraction of the halo radius. 0.26·4 ≈ 1.04 unit — laps
 *  just over the station limb, so the halo never seams against the ocean body. */
const HALO_INNER = 0.26;
/** Composited alpha at the innermost disc (mostly hidden behind the station). */
const HALO_INNER_ALPHA = 0.17;
/** Composited alpha where the air runs out, just inside the edge band. */
const HALO_EDGE_ALPHA = 0.025;
/** Falloff shape: >1 thins the air faster on the way out, which is what makes it
 *  read as an atmosphere rather than a flat translucent disc. */
const HALO_FALLOFF = 1.25;

/** Target composited alpha at radius fraction `t` (1 = the atmosphere edge). */
function haloAlphaAt(t: number): number {
  const s = (t - HALO_INNER) / (1 - HALO_INNER);
  const k = s <= 0 ? 1 : s >= 1 ? 0 : Math.pow(1 - s, HALO_FALLOFF);
  return HALO_EDGE_ALPHA + (HALO_INNER_ALPHA - HALO_EDGE_ALPHA) * k;
}

/**
 * The gradient as stacked discs, largest (and faintest) first.
 *
 * Each disc's own alpha is *derived* from the target profile rather than
 * authored: a disc lands on everything the larger ones already painted, so
 * hitting a wanted composite `A` over an existing `below` needs
 * `(A − below) / (1 − below)`. Authoring the per-disc alphas by hand is what let
 * the old five-stop table compose into steps nobody intended.
 */
function haloGradient(color: number, r: number): Shape[] {
  const out: Shape[] = [];
  let below = 0;
  for (let i = 0; i < HALO_STEPS; i++) {
    const t = 1 - (i / (HALO_STEPS - 1)) * (1 - HALO_INNER);
    const want = haloAlphaAt(t);
    out.push(circle(0, 0, round(r * t), fill(color, 'identity', round((want - below) / (1 - below)))));
    below = want;
  }
  return out;
}

/** The edge band's thickness, as a fraction of the halo radius (≈5 world units)
 *  — thick enough to read as air condensing at the limb of the atmosphere, thin
 *  enough that it is unmistakably a boundary and not another disc. */
const HALO_EDGE_BAND = 0.022;
/** The edge band's own alpha, over whatever the gradient has already laid down.
 *  This is the ONE step in the atmosphere the eye is meant to find. */
const HALO_EDGE_BAND_ALPHA = 0.2;

/** The single unambiguous atmosphere boundary: one band, outer edge exactly at
 *  `DEPOSIT_RANGE`. Identity colour, like the beacon ring — this is your air. */
function atmosphereEdgeBand(color: number, r: number): Shape {
  return poly(
    annulusPoints(0, 0, round(r), round(r * (1 - HALO_EDGE_BAND)), 0, Math.PI * 2, 64),
    fill(color, 'identity', HALO_EDGE_BAND_ALPHA),
  );
}

// --- The build ring ---------------------------------------------------------

/** Dashes around the build ring. Enough to read as a measured threshold rather
 *  than a solid wall, few enough that each dash is a confident mark. */
const BUILD_RING_DASHES = 12;
/** Dash length as a fraction of the pitch — the rest is gap. */
const BUILD_RING_DUTY = 0.62;
/** Band thickness in unit space (≈3.5 world units): a crisp line, deliberately
 *  thinner than the atmosphere's soft edge band. */
const BUILD_RING_WIDTH = 0.055;
/** Alpha. High, because the renderer breathes the whole halo down toward ~0.5
 *  while it is idle and this ring has to stay legible through that. */
const BUILD_RING_ALPHA = 0.8;

/**
 * The build ring: dashed plasma at exactly `STATION.dockRange`, its OUTER edge
 * on the radius — the same convention the atmosphere band uses, so both rings
 * mean "the rule ends at the outside of this band".
 *
 * Plasma on role `energy` (style-guide §1: beams, cockpits, **energy**) — the
 * colour the BUILD button and every other interactive affordance already wear,
 * and pointedly *not* the owner's identity colour, which is what the atmosphere
 * and the beacon ring use. Dashes against the atmosphere's continuous band give
 * the pair a second, colour-free channel of difference.
 */
function buildRangeRing(): Shape[] {
  const outer = round(BUILD_RING_RADIUS);
  const inner = round(outer - BUILD_RING_WIDTH);
  const pitch = (Math.PI * 2) / BUILD_RING_DASHES;
  const span = pitch * BUILD_RING_DUTY;
  const out: Shape[] = [];
  for (let i = 0; i < BUILD_RING_DASHES; i++) {
    const from = i * pitch - span / 2;
    out.push(
      poly(annulusPoints(0, 0, outer, inner, from, from + span, 6), fill(PALETTE.plasma, 'energy', BUILD_RING_ALPHA)),
    );
  }
  return out;
}

/**
 * The own-station range rings (p4-12, a4-01; GDD §2.3, §2.5): the atmosphere out
 * to exactly `DEPOSIT_RANGE`, and the build ring at exactly `STATION.dockRange`.
 * Drawn around a player's **own** station and nowhere else — both are affordances
 * ("where do I unload?", "where can I build?"), and neither question has an answer
 * at a rival's world, so a rival's world gets neither ring.
 *
 * The atmosphere reads as air, not a UI circle (the p4 brief): a genuinely smooth
 * gradient, densest behind the station and thinning outward, closed by ONE soft
 * band at the edge. It used to be five discs whose steps the eye could count, and
 * a player counted them and asked what each one meant — see the header of this
 * section, and {@link HALO_STEPS} for the arithmetic that replaced them.
 *
 * The alpha here is the **bright, ore-flowing** density. The renderer breathes it
 * gently on `world.time` and, while a deposit is actually flowing, holds it near
 * full — an idle halo is dimmed to a hush, a depositing one brightens (pairs with
 * the ore-flight couriers). The build ring breathes with it, which is why it is
 * the brightest thing in the sprite: your home's air and your home's reach are one
 * object, and they fade together rather than arguing.
 *
 * Static-render discipline: the renderer bakes this to a single texture once per
 * owner (`cacheAsTexture`) and thereafter only fades the one quad — the gradient
 * is never re-rasterised, and its stacked translucent discs never re-blend per
 * frame (that overdraw was the mobile frame-budget cost this VFX was tuned to
 * shed, GDD §4.3 risk 5).
 *
 * On a device the auto-reducer has throttled (`reduced`), the full gradient's
 * fill is too dear even baked, so the halo drops to the **rings alone**: the same
 * edge band at `DEPOSIT_RANGE` and the same dashed build ring, with the haze
 * between them dropped. Thin annuli blend only their own bands, not a full-disc
 * quad, so the slow profile buys its frame time back while both affordances still
 * read — and the tier answers exactly the same two questions as the full one,
 * which is what "coherent" has to mean here.
 */
export function atmosphereHaloSprite(playerId: number, reduced = false): SpriteDef {
  const color = playerColor(playerId);
  const r = ATMOSPHERE_HALO_RADIUS;
  if (reduced) {
    return sprite(`station/atmosphere/p${playerId}/reduced`, round(r), [
      atmosphereEdgeBand(color, r),
      ...buildRangeRing(),
    ]);
  }
  return sprite(`station/atmosphere/p${playerId}`, round(r), [
    ...haloGradient(color, r),
    atmosphereEdgeBand(color, r),
    ...buildRangeRing(),
  ]);
}
