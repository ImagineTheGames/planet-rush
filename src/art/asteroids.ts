/**
 * src/art/asteroids.ts — the ratified asteroid pool, drawn. OWNER: Art & Audio Agent.
 *
 * docs/art-direction §5.5 ratified a **named pool of six** asteroids — and the
 * shipped game never used them, drawing one generic rock instead. This module
 * builds THOSE six, by silhouette and by behaviour, straight off the board cards:
 *
 *  - **A1 SHARD** — a hard angular chunk; yellow ore veins run the fracture
 *    lines and widen as you mine, until it splits. The cleanest read.
 *  - **A2 ICE-VEINED** — a rounded body threaded with cold plasma-frost veins
 *    that brighten as it nears breaking; embedded ore nuggets. Prettiest, softest.
 *  - **A3 RUBBLE** — a parent rock ringed by satellite pebbles that pop first
 *    for fast small payouts, then the core. Best moment-to-moment feedback.
 *  - **A4 HUSK** — half-mined already: an ore-rimmed cavity with a fat nugget
 *    left in it. The storytelling rock — someone was here before you.
 *  - **A5 GEODE** — a dark matrix studded with exposed ore crystals you can
 *    *count before you shoot* (three crystals = three ore). The strategic read.
 *  - **A6 PATINA** — a weathered drifter banded with teal oxidation that matches
 *    the stations, tying world and economy together.
 *
 * Two board requirements carry across every one of them (style-guide §6):
 *
 *  1. **Crack across three stages, from sim hp.** `crackStage` (0/1/2) swaps the
 *     art: intact → fissured → split-and-bursting. Each type cracks in its own
 *     way, but all three stages always differ.
 *  2. **Judge the payout before committing fire.** Ore presentation scales with
 *     `richness` (ore ÷ maxOre): a fat rock is visibly loaded, a poor one nearly
 *     bare, and an empty one carries no yellow at all. The board predates
 *     projectiles, but the read it demanded — *is this rock worth my beam time?* —
 *     is exactly the one a player still needs from across the field.
 *
 * The sim's `Asteroid` has no "type" field (`state.ts`), so which of the six a
 * rock is comes from its seed — `asteroidKindFor` — deterministically. The atlas
 * folds entity ids into a dozen seeds, so a ~200-rock field is a handful of
 * textures wearing all six looks, and nothing here needs the sim to change.
 *
 * Every rock is seeded (ratified `mulberry32`), so `asteroidSprite(...)` is
 * byte-identical across client, server and replay (GDD §4.1).
 */

import { mulberry32 } from '@shared/types';
import { DERIVED, PALETTE } from './palette';
import { LINE } from './tokens';
import {
  arcPoints,
  blob,
  circle,
  fill,
  poly,
  polyline,
  round,
  sprite,
  stroke,
  type Paint,
  type Shape,
  type SpriteDef,
} from './shapes';

/** The three visible mining stages (style-guide §6). */
export const CRACK_STAGES = 3;

/**
 * The body rim weight, in unit-radius, from `LINE.rock` — the first generator to
 * actually consume the token (a3-01).
 *
 * `LINE` quotes **px at board scale**, and the boards draw rocks with a flat
 * `stroke-width="3"` regardless of how big the rock is (scene-gallery.html, the
 * mining-run scene: four bodies of unit radius 25–42 all inked at 3). Their mean
 * radius is ≈ 35 px, which is also where the sim's asteroids sit (`ASTEROID`
 * radius 22–46), so the two scales line up and `LINE.rock` lands at 3/35 of a
 * unit radius. The generator had picked 0.05 before any of this was written down;
 * a dark body needs the heavier line more than a pale one did, which is why the
 * ink and the value levers were always meant to land together.
 */
const RIM_WEIGHT = round(LINE.rock / 35);

/**
 * The ratified pool (docs/art-direction §5.5), in board order A1..A6. The index
 * is the card number minus one, so `ASTEROID_KINDS[4]` is A5 GEODE.
 */
export type AsteroidKind = 'shard' | 'ice' | 'rubble' | 'husk' | 'geode' | 'patina';
export const ASTEROID_KINDS: readonly AsteroidKind[] = [
  'shard',
  'ice',
  'rubble',
  'husk',
  'geode',
  'patina',
];

/**
 * Which of the six a rock is, from its seed. Deterministic and total: the sim
 * carries no type field, so the look is a pure function of the pooling seed the
 * atlas already computes, and every seed lands on exactly one of the six.
 */
export function asteroidKindFor(seed: number): AsteroidKind {
  const n = ASTEROID_KINDS.length;
  return ASTEROID_KINDS[(((Math.trunc(seed) % n) + n) % n)]!;
}

/** Everything a rock's look depends on. All of it is sim state the renderer has. */
export interface AsteroidSpriteOptions {
  /** The asteroid's entity id — the only randomness source. Same id, same rock. */
  readonly seed: number;
  /** 0 intact · 1 fissured · 2 spent (`Asteroid.crackStage`). */
  readonly crackStage: number;
  /**
   * Ore remaining as a fraction of what it spawned with, 0..1. Drives the amount
   * of ore drawn, which is how a player judges a payout before committing fire.
   */
  readonly richness?: number;
  /** Force a pool type. Omitted ⇒ derived from the seed (`asteroidKindFor`). */
  readonly kind?: AsteroidKind;
}

function rockRng(seed: number, salt: number) {
  return mulberry32(((seed * 0x27d4eb2d) ^ (salt * 0x165667b1)) >>> 0);
}

// ---------------------------------------------------------------------------
// Silhouettes — a distinct body per pool card
// ---------------------------------------------------------------------------

/** Scale a flat point list so its furthest vertex sits exactly on the unit circle. */
function normalizeToUnit(points: readonly number[]): number[] {
  let max = 0;
  for (let i = 0; i < points.length; i += 2) max = Math.max(max, Math.hypot(points[i]!, points[i + 1]!));
  const k = max > 0 ? 1 / max : 1;
  return points.map((n) => round(n * k));
}

/** The per-card silhouette parameters — vertex count, jaggedness, and aspect. */
interface OutlineSpec {
  readonly vLo: number;
  readonly vRange: number;
  readonly jLo: number;
  readonly jHi: number;
  readonly wave: number;
  readonly sx: number;
  readonly sy: number;
  /** Final radius as a fraction of the unit circle (rubble's core is small). */
  readonly scale: number;
}

const OUTLINE: Record<AsteroidKind, OutlineSpec> = {
  // Few vertices, wide radius swing: a sharp, faceted chunk.
  shard: { vLo: 7, vRange: 2, jLo: 0.6, jHi: 1.18, wave: 0.03, sx: 1, sy: 1, scale: 1 },
  // Many vertices, tight radius swing: a smooth boulder.
  ice: { vLo: 13, vRange: 3, jLo: 0.9, jHi: 1.04, wave: 0.05, sx: 1, sy: 1, scale: 1 },
  // A compact core; the pebbles that make it a cluster are added as features.
  rubble: { vLo: 8, vRange: 3, jLo: 0.8, jHi: 1.1, wave: 0.06, sx: 1, sy: 1, scale: 0.6 },
  // A rounded rock; the cavity that gives it its bite is a feature, not silhouette.
  husk: { vLo: 10, vRange: 3, jLo: 0.82, jHi: 1.08, wave: 0.06, sx: 1, sy: 1, scale: 1 },
  // Blocky, low vertex count: reads as crystalline matrix.
  geode: { vLo: 8, vRange: 2, jLo: 0.74, jHi: 1.06, wave: 0.04, sx: 1, sy: 1, scale: 1 },
  // Stretched: an old drifter, longer than it is tall.
  patina: { vLo: 10, vRange: 3, jLo: 0.82, jHi: 1.06, wave: 0.06, sx: 1.2, sy: 0.82, scale: 1 },
};

/**
 * A pool card's body outline, normalised into the unit circle.
 *
 * **Unit radius = the sim's collision radius.** A rock whose art bulged past it
 * would show mineral a mining shot passes straight through — "why didn't that
 * hit?" is a bug the art can cause on its own — so every silhouette is scaled to
 * claim no more mass than the sim will back.
 */
function outlineFor(seed: number, kind: AsteroidKind): number[] {
  const spec = OUTLINE[kind];
  const rng = rockRng(seed, 1);
  const verts = spec.vLo + Math.floor(rng.next() * (spec.vRange + 1));
  const phase = rng.next() * Math.PI * 2;
  const jitter: number[] = [];
  for (let i = 0; i < verts; i++) jitter.push(spec.jLo + rng.next() * (spec.jHi - spec.jLo));
  const raw = blob(0, 0, verts, (i, a) => jitter[i]! * (1 + Math.sin(a * 2 + phase) * spec.wave));
  const aspected = raw.map((n, idx) => (idx % 2 === 0 ? n * spec.sx : n * spec.sy));
  const unit = normalizeToUnit(aspected);
  return spec.scale === 1 ? unit : unit.map((n) => round(n * spec.scale));
}

/**
 * The generic rock outline (the SHARD-family base). Kept exported and unchanged
 * in contract — the collision-radius test reads it back directly — while the
 * other five cards get their own silhouettes through {@link outlineFor}.
 */
export function asteroidOutline(seed: number): number[] {
  return outlineFor(seed, 'shard');
}

/**
 * The body's radius at an arbitrary angle, read back off the outline. Cracks,
 * craters and ore are placed against *this* rather than a nominal radius of 1 —
 * a rock is an irregular polygon, and detail that assumes a circle spills off
 * the short side of it into empty space.
 */
function outlineRadiusAt(outline: readonly number[], angle: number): number {
  const n = outline.length / 2;
  const t = (((angle / (Math.PI * 2)) % 1) + 1) % 1;
  const f = t * n;
  const i = Math.floor(f) % n;
  const j = (i + 1) % n;
  const k = f - Math.floor(f);
  const r = (idx: number): number => Math.hypot(outline[idx * 2]!, outline[idx * 2 + 1]!);
  return r(i) * (1 - k) + r(j) * k;
}

// ---------------------------------------------------------------------------
// Shared damage: fissures and the stage-2 split
// ---------------------------------------------------------------------------

/** Fracture lines, added stage by stage so damage accumulates visibly. */
function fissures(seed: number, stage: number, outline: readonly number[]): Shape[] {
  if (stage <= 0) return [];
  const rng = rockRng(seed, 3);
  const ink = stroke(DERIVED.rockFissure, 0.07, 'material', 0.95);
  const out: Shape[] = [];
  for (let i = 0; i < stage * 2; i++) {
    const a = rng.next() * Math.PI * 2;
    const across = a + Math.PI * (0.6 + rng.next() * 0.8);
    // Stop short of the rim so a crack reads as splitting the rock rather than
    // as a line drawn across the vacuum behind it.
    const r0 = outlineRadiusAt(outline, a) * (0.82 + rng.next() * 0.1);
    const r1 = outlineRadiusAt(outline, across) * (0.82 + rng.next() * 0.1);
    const kink = (rng.next() - 0.5) * 0.5;
    out.push(
      polyline(
        [
          round(Math.cos(a) * r0),
          round(Math.sin(a) * r0),
          round(kink),
          round(-kink),
          round(Math.cos(across) * r1),
          round(Math.sin(across) * r1),
        ],
        ink,
      ),
    );
  }
  return out;
}

/**
 * The stage-2 split: the body pulls apart along a horizontal seam with Vacuum
 * showing through — the "about to burst" read (GDD §2.3). Returns the whole
 * outline unsplit at stages 0–1, and two pulled-apart halves at stage 2.
 */
function bodyPieces(stage: number, outline: readonly number[]): number[][] {
  if (stage < 2) return [outline as number[]];
  const gap = 0.15;
  const pieces: number[][] = [];
  for (const sign of [1, -1]) {
    const pts: number[] = [];
    for (let i = 0; i < outline.length; i += 2) {
      const x = outline[i]!;
      const y = outline[i + 1]!;
      // Vertices on the seam belong to both halves, so neither piece loses its
      // flat face and the split reads as one rock in two bits.
      if (sign > 0 ? y >= -0.02 : y <= 0.02) pts.push(round(x), round(y + sign * gap));
    }
    if (pts.length >= 6) pieces.push(pts);
  }
  // A degenerate split (a nearly-flat outline) would erase the body; fall back
  // to the whole rock so stage 2 is never empty.
  return pieces.length ? pieces : [outline as number[]];
}

/** Steel-grey shaded craters — mass, not decoration. Placed against the outline. */
function craters(rng: ReturnType<typeof rockRng>, count: number, outline: readonly number[]): Shape[] {
  const facet = fill(DERIVED.rockShadow, 'material', 0.8);
  const out: Shape[] = [];
  for (let i = 0; i < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const rim = outlineRadiusAt(outline, a);
    const r = round(rim * (0.1 + rng.next() * 0.14));
    const d = round((0.15 + rng.next() * 0.42) * (rim - r));
    out.push(circle(round(Math.cos(a) * d), round(Math.sin(a) * d), r, facet));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ore marks — the payout read, one presentation per card
// ---------------------------------------------------------------------------

/** How many ore marks a rock of this richness shows. Zero ore ⇒ no yellow at all. */
function oreCount(richness: number, most: number): number {
  return Math.max(0, Math.round(Math.max(0, Math.min(1, richness)) * most));
}

/** A solid ore nugget: a signal-yellow blob with a shaded lower facet. */
function nugget(cx: number, cy: number, r: number, rng: ReturnType<typeof rockRng>): Shape[] {
  const phase = rng.next() * Math.PI * 2;
  const body = blob(cx, cy, 6, (_, a) => r * (0.86 + Math.sin(a * 2 + phase) * 0.12));
  return [
    poly(body, fill(PALETTE.signalYellow, 'ore')),
    poly(
      body.map((n, i) => (i % 2 === 0 ? round((n - cx) * 0.5 + cx + r * 0.18) : round((n - cy) * 0.5 + cy + r * 0.18))),
      fill(DERIVED.oreDeep, 'ore', 0.9),
    ),
  ];
}

/** An A5 crystal: a countable faceted diamond of exposed ore, dark-lipped. */
function crystal(cx: number, cy: number, r: number, angle: number): Shape[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // A kite: long point out, short waist. Rotated so a cluster doesn't line up.
  const local: [number, number][] = [
    [0, -r],
    [r * 0.62, 0],
    [0, r],
    [-r * 0.62, 0],
  ];
  const pts: number[] = [];
  for (const [lx, ly] of local) pts.push(round(cx + lx * c - ly * s), round(cy + lx * s + ly * c));
  // One lit half and one shadowed half give the crystal a facet at any size.
  const lit: number[] = [pts[0]!, pts[1]!, pts[2]!, pts[3]!, pts[6]!, pts[7]!];
  return [
    poly(pts, fill(PALETTE.signalYellow, 'ore')),
    poly(lit, fill(DERIVED.oreDeep, 'ore', 0.85)),
    poly(pts, stroke(DERIVED.rockFissure, 0.03, 'material', 0.9)),
  ];
}

/** Forked ore veins running the fracture lines (A1). They widen as damage rises. */
function veins(seed: number, richness: number, stage: number): Shape[] {
  const rng = rockRng(seed, 2);
  const count = oreCount(richness, 5);
  const out: Shape[] = [];
  const w = 0.09 + stage * 0.03; // mining widens the veins (board A1)
  const ink = stroke(PALETTE.signalYellow, w, 'ore', 0.95);
  const under = stroke(DERIVED.oreDeep, w + 0.05, 'ore', 0.8);
  for (let i = 0; i < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = rng.next() * 0.42;
    const cx = Math.cos(a) * d;
    const cy = Math.sin(a) * d;
    const dir = rng.next() * Math.PI * 2;
    const len = 0.22 + rng.next() * 0.3;
    const bend = (rng.next() - 0.5) * 1.1;
    const pts = [
      round(cx - Math.cos(dir) * len * 0.5),
      round(cy - Math.sin(dir) * len * 0.5),
      round(cx + Math.cos(dir + bend) * len * 0.15),
      round(cy + Math.sin(dir + bend) * len * 0.15),
      round(cx + Math.cos(dir) * len * 0.5),
      round(cy + Math.sin(dir) * len * 0.5),
    ];
    out.push(polyline(pts, under), polyline(pts, ink));
  }
  return out;
}

/** Scatter `count` nuggets over the body, inside the outline. */
function scatterNuggets(
  seed: number,
  count: number,
  outline: readonly number[],
  rMin: number,
  rMax: number,
): Shape[] {
  const rng = rockRng(seed, 2);
  const out: Shape[] = [];
  for (let i = 0; i < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const rim = outlineRadiusAt(outline, a);
    const d = rng.next() * rim * 0.6;
    const r = rMin + rng.next() * (rMax - rMin);
    out.push(...nugget(round(Math.cos(a) * d), round(Math.sin(a) * d), r, rng));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The six cards
// ---------------------------------------------------------------------------

/**
 * One rock at one crack stage. Unit radius = the sim's collision radius, so the
 * renderer scales by `Asteroid.radius` and nothing else.
 */
export function asteroidSprite(options: AsteroidSpriteOptions): SpriteDef {
  const stage = Math.max(0, Math.min(CRACK_STAGES - 1, Math.trunc(options.crackStage)));
  // Richness defaults to "as full as this stage implies", so a caller that only
  // knows the stage still gets an honest payout read.
  const richness = options.richness ?? 1 - stage / CRACK_STAGES;
  const kind = options.kind ?? asteroidKindFor(options.seed);
  const outline = outlineFor(options.seed, kind);
  const rng = rockRng(options.seed, 4);

  const rim = stroke(DERIVED.rockFissure, RIM_WEIGHT, 'material', 0.9);
  const bodyInk: Paint = fill(kind === 'geode' ? DERIVED.rockShadow : DERIVED.rockBody, 'material');

  const shapes: Shape[] = [];

  // --- Body (whole, or split at stage 2) ------------------------------------
  for (const piece of bodyPieces(stage, outline)) shapes.push(poly(piece, bodyInk), poly(piece, rim));

  // --- Per-card material features -------------------------------------------
  if (kind === 'geode') {
    // Dark crevices between the crystals, so the matrix reads as studded rock.
    const crev = stroke(DERIVED.rockFissure, 0.045, 'material', 0.85);
    for (let i = 0; i < 3; i++) {
      const a = rng.next() * Math.PI * 2;
      const rr = outlineRadiusAt(outline, a) * 0.7;
      shapes.push(polyline([0, 0, round(Math.cos(a) * rr), round(Math.sin(a) * rr)], crev));
    }
  } else if (kind === 'patina') {
    // Teal oxidation bands wrapping the drifter (board A6): concentric arcs, the
    // way weathering wraps a rounded body. Patina is a material colour, so the
    // world and the economy share a hue without spending any yellow.
    const band = stroke(PALETTE.patina, 0.08, 'material', 0.85);
    const under = stroke(DERIVED.continentShade, 0.12, 'material', 0.7);
    const spin = rng.next() * Math.PI * 2;
    for (const rr of [0.44, 0.72]) {
      const from = spin + (rng.next() - 0.5) * 0.6;
      const pts = arcPoints(0, 0, rr, from, from + 1.7 + rng.next() * 0.6, 10);
      shapes.push(polyline(pts, under), polyline(pts, band));
    }
  } else if (kind === 'rubble') {
    // Satellite pebbles that pop first: fewer of them as the crack stage climbs.
    const pebbleInk = fill(DERIVED.rockShadow, 'material');
    const prng = rockRng(options.seed, 6);
    const pebbles = Math.max(2, 5 - stage * 2);
    for (let i = 0; i < pebbles; i++) {
      const a = prng.next() * Math.PI * 2;
      const d = 0.6 + prng.next() * 0.22;
      const r = round(0.12 + prng.next() * 0.08);
      const cx = round(Math.cos(a) * d);
      const cy = round(Math.sin(a) * d);
      shapes.push(poly(blob(cx, cy, 6, (_, ang) => r * (0.85 + Math.sin(ang * 2) * 0.12)), pebbleInk));
      shapes.push(circle(cx, cy, r, stroke(DERIVED.rockFissure, 0.03, 'material', 0.8)));
    }
  }

  // Craters everywhere except the geode (its crystals are the surface detail).
  if (kind !== 'geode') shapes.push(...craters(rng, stage === 0 ? 3 : 2, outline));

  // At stage 2 the split *is* the damage read, so no crack lines over it.
  shapes.push(...fissures(options.seed, stage === 2 ? 0 : stage, outline));

  // --- Per-card ore (the payout read) ---------------------------------------
  shapes.push(...oreFor(kind, options.seed, richness, stage, outline));

  return sprite(
    `asteroid/${kind}/${options.seed}/s${stage}/r${Math.round(richness * 10)}`,
    1,
    shapes,
  );
}

/** The ore presentation for a card — the whole "judge before you fire" read. */
function oreFor(
  kind: AsteroidKind,
  seed: number,
  richness: number,
  stage: number,
  outline: readonly number[],
): Shape[] {
  switch (kind) {
    case 'shard':
      return veins(seed, richness, stage);
    case 'ice':
      return [...frostVeins(seed, stage, outline), ...scatterNuggets(seed, oreCount(richness, 5), outline, 0.06, 0.1)];
    case 'rubble':
      return rubbleOre(seed, richness);
    case 'husk':
      return huskOre(seed, richness, outline);
    case 'geode':
      return geodeCrystals(seed, richness, outline);
    case 'patina':
      return scatterNuggets(seed, oreCount(richness, 5), outline, 0.06, 0.09);
  }
}

/** A2 frost: cold plasma veins that brighten as the rock nears breaking. */
function frostVeins(seed: number, stage: number, outline: readonly number[]): Shape[] {
  const rng = rockRng(seed, 7);
  const alpha = 0.5 + stage * 0.25; // brighten as it nears breaking (board A2)
  const ink = stroke(PALETTE.plasma, 0.05, 'energy', Math.min(1, alpha));
  const glow = stroke(DERIVED.plasmaDim, 0.09, 'energy', Math.min(1, alpha * 0.7));
  const out: Shape[] = [];
  for (let i = 0; i < 2; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = outlineRadiusAt(outline, a) * 0.7;
    const cx = Math.cos(a) * r * 0.3;
    const cy = Math.sin(a) * r * 0.3;
    const dir = rng.next() * Math.PI * 2;
    const len = 0.5 + rng.next() * 0.3;
    const bend = (rng.next() - 0.5) * 1.4;
    const pts = [
      round(cx - Math.cos(dir) * len * 0.5),
      round(cy - Math.sin(dir) * len * 0.5),
      round(cx + Math.cos(dir + bend) * len * 0.2),
      round(cy + Math.sin(dir + bend) * len * 0.2),
      round(cx + Math.cos(dir) * len * 0.5),
      round(cy + Math.sin(dir) * len * 0.5),
    ];
    out.push(polyline(pts, glow), polyline(pts, ink));
  }
  return out;
}

/** A3 ore: flecks riding the satellite pebbles, so they pay out first. */
function rubbleOre(seed: number, richness: number): Shape[] {
  const count = oreCount(richness, 5);
  const prng = rockRng(seed, 6); // same stream the pebbles use → flecks sit on them
  const orng = rockRng(seed, 2);
  const out: Shape[] = [];
  for (let i = 0; i < count; i++) {
    const a = prng.next() * Math.PI * 2;
    const d = 0.6 + prng.next() * 0.22;
    prng.next(); // consume the pebble radius draw, keeping the stream aligned
    out.push(...nugget(round(Math.cos(a) * d), round(Math.sin(a) * d), 0.06, orng));
  }
  return out;
}

/** A4 ore: an ore-rimmed cavity with a fat nugget, plus flecks when it is rich. */
function huskOre(seed: number, richness: number, outline: readonly number[]): Shape[] {
  const count = oreCount(richness, 4);
  if (count <= 0) return []; // a spent husk is just a dark hole — no yellow left
  const rng = rockRng(seed, 2);
  const a = rng.next() * Math.PI * 2;
  const rim = outlineRadiusAt(outline, a);
  const cx = round(Math.cos(a) * rim * 0.28);
  const cy = round(Math.sin(a) * rim * 0.28);
  const cr = round(rim * 0.34);
  const out: Shape[] = [
    // The mouth of the cavity: dark inside, ore-rimmed — someone dug here.
    circle(cx, cy, cr, fill(PALETTE.vacuum, 'material')),
    circle(cx, cy, round(cr * 1.02), stroke(DERIVED.rockFissure, 0.04, 'material', 0.9)),
    circle(cx, cy, cr, stroke(PALETTE.signalYellow, 0.05, 'ore', 0.9)),
    // The fat nugget left behind.
    ...nugget(cx, cy, round(cr * 0.5), rng),
  ];
  // Richer husks still carry a fleck or two around the mouth.
  for (let i = 1; i < count; i++) {
    const fa = rng.next() * Math.PI * 2;
    out.push(...nugget(round(cx + Math.cos(fa) * cr * 1.3), round(cy + Math.sin(fa) * cr * 1.3), 0.05, rng));
  }
  return out;
}

/** A5 ore: exposed crystals you can count — three crystals mean three ore. */
function geodeCrystals(seed: number, richness: number, outline: readonly number[]): Shape[] {
  const count = oreCount(richness, 4);
  if (count <= 0) return [];
  const rng = rockRng(seed, 2);
  const out: Shape[] = [];
  // Space the crystals evenly so they stay countable, jittered just enough not
  // to look printed. A ring of exposed studs — the strategic, pre-commit read.
  const base = rng.next() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = base + (i / count) * Math.PI * 2 + (rng.next() - 0.5) * 0.4;
    const rim = outlineRadiusAt(outline, a);
    const d = rim * (0.3 + rng.next() * 0.25);
    out.push(...crystal(round(Math.cos(a) * d), round(Math.sin(a) * d), round(rim * 0.22), a + rng.next()));
  }
  return out;
}

/**
 * A loose ore chunk (GDD §2.3): the thing your mining shot knocks out of a rock and
 * your tractor pulls in. Unambiguously ore — signal yellow, no other colour on
 * it — because it is the payoff the whole triangle turns on.
 */
export function oreChunkSprite(seed = 0): SpriteDef {
  const rng = rockRng(seed, 5);
  const phase = rng.next() * Math.PI * 2;
  const body = blob(0, 0, 7, (_, a) => 0.5 + Math.sin(a * 2 + phase) * 0.09 + rng.next() * 0.08);
  // A halo, so a loose chunk is findable against Vacuum from outside tractor
  // range — the thing the whole triangle is played for should never be missed.
  return sprite(`ore/chunk/${seed}`, 1.05, [
    circle(0, 0, 0.98, fill(PALETTE.signalYellow, 'ore', 0.1)),
    circle(0, 0, 0.72, fill(PALETTE.signalYellow, 'ore', 0.16)),
    poly(body, fill(PALETTE.signalYellow, 'ore')),
    // A shadowed lower-right facet and a lit upper-left one: the chunk reads as
    // a solid nugget rather than a flat yellow dot at any size.
    poly(body.map((n) => round(n * 0.62 + 0.14)), fill(DERIVED.oreDeep, 'ore', 0.9)),
    poly(body.map((n) => round(n * 0.34 - 0.16)), fill(DERIVED.coreHot, 'ore', 0.9)),
  ]);
}
