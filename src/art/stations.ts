/**
 * src/art/stations.ts — THE CUTTERHEAD. OWNER: Art & Audio Agent.
 *
 * The developer picked **Direction D — The Cutterhead** on 2026-08-07T16:53Z,
 * from `docs/art-direction/facility-concepts-r2.html`. That board is the visual
 * truth for everything in this file; round 1 (`facility-concepts.html`) is denied
 * history and nothing here is sourced from it.
 *
 * Round 1 was denied in full with one sentence — *"none of these look like a
 * mining space station"* — and the board's own diagnosis of why is the standing
 * brief for this generator:
 *
 *  - all three round-1 directions were **the same object**: a round planetoid
 *    with machinery arranged around it, so the body carried the silhouette and
 *    the machinery was dressing laid over a world;
 *  - **nothing was visibly extracting anything** — no cut face, no teeth, no hole;
 *  - **there was no ore you could see** — no bin with a level in it, no spill;
 *  - **nothing moved** — no chute, no conveyor, no barge;
 *  - **the outlines were radially symmetric**, which is what planets are and what
 *    working plants never are.
 *
 * So the home is no longer a planetoid. It is a **rotary bore head** clamped onto
 * the claim by eight anchor lugs, seen down its own throat: sixteen teeth bite
 * *inward* at a rock face with ore seams in it, the fresh kerf is the bright arc
 * where it is cutting right now, and what it wins is lifted out on a chute into an
 * ore circuit that rings the deck — two hoppers with their levels showing, a
 * smelter, a radiator comb hung outboard, an apron where the barge takes the
 * product away, and a **spoil boom** that throws the waste clear of the circle.
 * The first thing a viewer finds in the middle is rock being cut with ore in it,
 * and one long arm leaves the disc entirely. That arm is not decoration: it is the
 * mark that keeps the silhouette out of round 1's failure.
 *
 * Everything below is drawn **against the board's own geometry**, authored in the
 * board's units (body radius = `STATION.radius` = 64) and divided down to unit
 * space by {@link u}, so a mark can be checked against the board by reading the
 * number. Nothing about the rings moved: the core stack is still `0.34 / 0.22 /
 * 0.11 R`, the damage ring still `0.98–1.06 R`, the beacon ring still `1.09–1.16 R`
 * with four gaps and four pips, the collection field still `4R` and the build ring
 * still `2.5R`. A pick was buildable without moving a ring, and none moved.
 *
 * The rules that outrank the board, and where this file diverges from it:
 *
 *  - **No seventh hue** (style-guide §1). Every colour is one of the six or a
 *    declared value-ramp shade (./palette). The board's recess hex `#2D3239` is
 *    exactly `shade(hullSteel, 0.72)` and enters as `DERIVED.hullWell`; its
 *    claim-rock hex `#5A626B` does **not** enter, because a3-01 has just moved
 *    the whole rock family onto the dark half of the ramp to match the scene
 *    gallery (`rockBody` `#484E57`, luma 77, against `#5A626B`'s 97). The claim
 *    this machine is clamped to is made of the same rock as every asteroid in the
 *    field, so it is drawn in the rock family — see the PR body for the numbers.
 *  - **Signal yellow is ore or danger and nothing else** (§2). On this body it is
 *    ore in a hopper, ore on a conveyor, an ore seam in the face, molten ore in
 *    the smelter, hazard tape at the apron's loading edge, and the core. Every one
 *    of those carries the matching {@link PaintRole}, so `compliance.ts` proves it.
 *  - **Hulls never take player colour** (§3). The roster colour touches the lug
 *    keyways, the apron blocks and the barge marker — trim marks, never the steel
 *    — and the beacon ring does the ownership work at any zoom.
 *
 * **Four variants**, still "arrangement, not colour": the deck furniture rotates
 * as one set, the claim rim and the cut face are seeded blobs, the hoppers carry
 * different levels and the kerf is cutting somewhere else. Four seeds through one
 * generator, `mulberry32` from `@shared/types`, so a variant is byte-identical on
 * every machine and every run (GDD §4.1).
 *
 * The derelict is the same layout under a cold palette map plus a damage mask —
 * see {@link cutterheadShapes} and `./wrecks`.
 */

import { mulberry32 } from '@shared/types';
import { DEPOSIT_RANGE, STATION } from '../sim/constants';
import { DERIVED, PALETTE, WHITE, playerColor } from './palette';
import { ringDamageShapes } from './rings';
import { LINE } from './tokens';
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
  type Paint,
  type Shape,
  type SpriteDef,
} from './shapes';

/** How many facility looks exist (style-guide §5). Randomised per player. */
export const STATION_VARIANT_COUNT = 4;

/**
 * The board's authoring unit: its body radius, in its own coordinates. Every
 * number in this file is a board number, so it can be read straight off
 * `facility-concepts-r2.html`, and {@link u} is the only place the conversion
 * happens.
 */
const BOARD_R = 64;

/** A board coordinate in unit space (station radius = 1). */
function u(n: number): number {
  return round(n / BOARD_R);
}

/**
 * How far past the collision radius the art reaches. The spoil boom's truss ends
 * at 1.68 R and its tailings drift to ~1.85 — the arm leaving the circle is the
 * whole anti-planetoid move, so the sprite is authored wide enough to hold it.
 */
export const STATION_ART_EXTENT = 1.95;

const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Board-unit geometry helpers
// ---------------------------------------------------------------------------

/** A polar point in board units, as `[x, y]`. Degrees; +y is south on screen. */
function pol(r: number, deg: number): [number, number] {
  const a = deg * RAD;
  return [r * Math.cos(a), r * Math.sin(a)];
}

/** A closed polygon from `[radius, degrees]` pairs, in unit space. */
function polarPoly(spec: readonly (readonly [number, number])[]): number[] {
  const out: number[] = [];
  for (const [r, deg] of spec) {
    const [x, y] = pol(r, deg);
    out.push(u(x), u(y));
  }
  return out;
}

/** Points along an arc in board units, converted to unit space. */
function arcB(r: number, fromDeg: number, toDeg: number, segments: number): number[] {
  return arcPoints(0, 0, u(r), fromDeg * RAD, toDeg * RAD, segments);
}

/** A radial line from `r0` to `r1` at `deg`, in unit space. */
function spoke(r0: number, r1: number, deg: number): number[] {
  const [x0, y0] = pol(r0, deg);
  const [x1, y1] = pol(r1, deg);
  return [u(x0), u(y0), u(x1), u(y1)];
}

/**
 * Place a shape authored in local board coordinates onto the deck: rotate by
 * `deg`, then translate to `(cx, cy)` board units. This is how the board's own
 * `<g transform="translate(…) rotate(…)">` furniture is expressed here.
 */
function placed(local: readonly number[], cx: number, cy: number, deg: number): number[] {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  const out: number[] = [];
  for (let i = 0; i < local.length; i += 2) {
    const x = local[i]!;
    const y = local[i + 1]!;
    out.push(u(cx + x * c - y * s), u(cy + x * s + y * c));
  }
  return out;
}

/** A rectangle in local board coordinates, as flat points. */
function rectPts(x: number, y: number, w: number, h: number): number[] {
  return [x, y, x + w, y, x + w, y + h, x, y + h];
}

// ---------------------------------------------------------------------------
// The two palettes: a working rig, and a cold one
// ---------------------------------------------------------------------------

/**
 * The colour map a cutterhead is painted through. The derelict is the *same*
 * geometry read through the second one — which is exactly what the board does
 * (`#bD` and `#bDd` differ by a substitution table and a damage mask, not by a
 * redraw), and it is why a wreck is unmistakably *that* station, gone cold.
 */
interface RigPalette {
  /** Outboard structure: cutter ring, lugs, truss rails, furniture shells. */
  readonly steel: number;
  /** The deck plate itself. */
  readonly plate: number;
  /** Panel gaps, the bore housing, spokes. */
  readonly deep: number;
  /** Lit edges — the north limb of every ring. */
  readonly lit: number;
  /** The outline ink every mark sits inside. */
  readonly ink: number;
  /** A recess cut into a plate: the throat, a hopper well. */
  readonly well: number;
  /** The claim rock this machine is clamped to. */
  readonly rock: number;
  /** Rock shadow and rock ink. */
  readonly rockDark: number;
  /** Ore, at full value. Dulled on a derelict — nobody has turned it lately. */
  readonly ore: number;
  /** Shadowed ore. */
  readonly oreDim: number;
  /** Corrosion. A working rig has a little; a derelict has the rest. */
  readonly patina: number;
  /** Alpha the corrosion is laid down at. */
  readonly patinaAlpha: number;
}

const LIVE: RigPalette = {
  steel: PALETTE.hullSteel,
  plate: DERIVED.hullShadow,
  deep: DERIVED.hullDark,
  lit: DERIVED.hullLight,
  ink: DERIVED.decalInk,
  well: DERIVED.hullWell,
  rock: DERIVED.rockBody,
  rockDark: DERIVED.rockFissure,
  ore: PALETTE.signalYellow,
  oreDim: DERIVED.oreDeep,
  patina: DERIVED.continentShade,
  patinaAlpha: 0.38,
};

/**
 * The cold map (style-guide §8, GDD §2.7). Every structural value drops one to
 * three stops down the same ramp, the ore goes dull, and the corrosion doubles.
 * No threat red anywhere: red is the under-attack tell, and a wreck is not a
 * threat — it is an absence, and it has to still read as one twelve minutes later.
 */
const DEAD: RigPalette = {
  steel: DERIVED.wreckCrust,
  plate: DERIVED.wreckBody,
  deep: DERIVED.hullWell,
  lit: DERIVED.hullShadow,
  ink: DERIVED.decalInk,
  well: DERIVED.rockFissure,
  rock: DERIVED.rockBody,
  rockDark: DERIVED.rockFissure,
  ore: DERIVED.oreDeep,
  oreDim: DERIVED.oreDeep,
  patina: PALETTE.patina,
  patinaAlpha: 0.5,
};

// ---------------------------------------------------------------------------
// Variants — arrangement, not colour
// ---------------------------------------------------------------------------

/** What actually differs between two home claims. */
interface VariantSpec {
  /** Rotation of the whole deck-furniture set, degrees. The strongest tell. */
  readonly deckPhase: number;
  /** Bearing the cutter is currently opening, degrees (the kerf's start). */
  readonly kerfFrom: number;
  /** Ore level in each hopper, 0..1 — a bin you can read at a glance. */
  readonly hoppers: readonly [number, number];
  /** How many ore seams run through the cut face. */
  readonly seams: number;
  /** Human-readable, for the contact sheet and failing-test messages. */
  readonly note: string;
}

const VARIANTS: readonly VariantSpec[] = [
  { deckPhase: 0, kerfFrom: -64, hoppers: [0.82, 0.45], seams: 6, note: 'Circuit east — hoppers 82/45, cutting the east face.' },
  { deckPhase: 96, kerfFrom: 52, hoppers: [0.34, 0.88], seams: 5, note: 'Circuit south — hoppers 34/88, cutting the south face.' },
  { deckPhase: 187, kerfFrom: 148, hoppers: [0.61, 0.19], seams: 7, note: 'Circuit west — hoppers 61/19, cutting the west face.' },
  { deckPhase: 274, kerfFrom: -152, hoppers: [0.12, 0.7], seams: 4, note: 'Circuit north — hoppers 12/70, a nearly-empty rig.' },
];

/** The variant a player's home uses. Wraps, so any slot is safe. */
export function stationVariantFor(playerId: number): number {
  const n = Math.trunc(playerId);
  return ((n % STATION_VARIANT_COUNT) + STATION_VARIANT_COUNT) % STATION_VARIANT_COUNT;
}

/** The one-line description of a variant's arrangement. */
export function stationVariantNote(variant: number): string {
  return VARIANTS[variant % VARIANTS.length]!.note;
}

// ---------------------------------------------------------------------------
// The layout: everything seeded, computed once, shared by the rig and its wreck
// ---------------------------------------------------------------------------

/** A scattered mark on the deck or in the plume: board polar position + radius. */
interface Mote {
  readonly r: number;
  readonly deg: number;
  readonly size: number;
}

/**
 * One facility's arrangement — the seeded half of the drawing, kept apart from
 * the painting so a wreck is recognisably *that* station rather than a generic
 * dead disc. Losing a stranger's rig and losing the one you spent the match next
 * to should not look identical.
 */
export interface CutterheadLayout {
  readonly variant: number;
  readonly spec: VariantSpec;
  /** The claim rock's irregular outline, board units. */
  readonly rim: readonly (readonly [number, number])[];
  /** Lit facets on the rim — the only thing that catches light out there. */
  readonly facets: readonly (readonly (readonly [number, number])[])[];
  /** The cut face at the bottom of the bore. */
  readonly face: readonly (readonly [number, number])[];
  /** Ore seams in the face, as `[fromR, fromDeg, toR, toDeg]`. */
  readonly seams: readonly (readonly [number, number, number, number])[];
  /** Ore spilled across the deck circuit — the rig is full of the stuff. */
  readonly deckOre: readonly Mote[];
  /** Ore thrown clear of the kerf, right where it is cutting. */
  readonly kerfOre: readonly Mote[];
  /** Corrosion blooms. */
  readonly patina: readonly Mote[];
  /** The spoil plume: waste rock, with a little ore the rig missed. */
  readonly tailings: readonly Mote[];
}

/** Deterministic arrangement for a variant. Seeded by variant and nothing else. */
export function cutterheadLayout(variant: number): CutterheadLayout {
  const v = ((Math.trunc(variant) % STATION_VARIANT_COUNT) + STATION_VARIANT_COUNT) % STATION_VARIANT_COUNT;
  const spec = VARIANTS[v]!;
  // Distinct variants get well-separated streams rather than adjacent ones.
  const rng = mulberry32((0x9e3779b9 ^ (v * 0x85ebca6b)) >>> 0);

  // The claim rim: 17 vertices, deliberately irregular. "The outlines were
  // radially symmetric. That is what planets are, and what working plants never
  // are" — so the rock this machine bit into is not a circle.
  const rim: [number, number][] = [];
  for (let i = 0; i < 17; i++) {
    const deg = (i / 17) * 360 + (rng.next() - 0.5) * 8;
    rim.push([58 + rng.next() * 6, deg]);
  }

  // Five lit facets, sitting on the rim.
  const facets: [number, number][][] = [];
  for (let i = 0; i < 5; i++) {
    const at = i * 72 + rng.next() * 40;
    const span = 10 + rng.next() * 7;
    const near = 48 + rng.next() * 5;
    const far = 57 + rng.next() * 4;
    facets.push([
      [far, at - span],
      [far, at + span * 0.4],
      [near, at + span],
      [near, at - span * 0.6],
    ]);
  }

  // The cut face: the ore body at the bottom of the throat, seen down the bore.
  const face: [number, number][] = [];
  for (let i = 0; i < 15; i++) {
    const deg = (i / 15) * 360 + (rng.next() - 0.5) * 9;
    face.push([21.5 + rng.next() * 4.5, deg]);
  }

  // Ore seams running through it — the reason this hole is here. Deliberately
  // CHORDAL: a seam that ran straight out from the centre would turn the core
  // into a sunburst, and a vein in rock does not point at anything.
  const seams: [number, number, number, number][] = [];
  for (let i = 0; i < spec.seams; i++) {
    const deg = (i / spec.seams) * 360 + rng.next() * 26;
    const lean = (rng.next() < 0.5 ? -1 : 1) * (14 + rng.next() * 14);
    seams.push([17.5 + rng.next() * 1.8, deg, 22.8 + rng.next() * 2, deg + lean]);
  }

  const motes = (n: number, rLo: number, rHi: number, degLo: number, degHi: number, sLo: number, sHi: number): Mote[] => {
    const out: Mote[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        r: rLo + rng.next() * (rHi - rLo),
        deg: degLo + rng.next() * (degHi - degLo),
        size: sLo + rng.next() * (sHi - sLo),
      });
    }
    return out;
  };

  const deckOre = motes(11, 38.5, 47.5, 0, 360, 1, 1.7);
  const kerfOre = motes(10, 16.5, 23, spec.kerfFrom, spec.kerfFrom + 108, 1.4, 2.6);
  const patina = motes(4, 46, 54, 0, 360, 3, 5.5);
  // The plume rides the spoil boom's bearing (100°) and fans out behind it.
  const tailings = motes(17, 92, 120, 84, 122, 0.85, 2.2);

  return { variant: v, spec, rim, facets, face, seams, deckOre, kerfOre, patina, tailings };
}

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

/** How a cutterhead is drawn: which layout, whose colours, and dead or working. */
export interface CutterheadOptions {
  readonly variant: number;
  /** Owner, for the trim marks. Ignored when `dead` — a wreck has no owner. */
  readonly playerId?: number;
  /** Draw the derelict: cold palette, damage mask, core out. */
  readonly dead?: boolean;
}

/**
 * The whole facility body, back to front, in unit space. Exported because the
 * derelict (./wrecks) is this same drawing under {@link DEAD} plus its own
 * damage mask — one geometry, two palettes, which is how the board itself does it.
 */
export function cutterheadShapes(options: CutterheadOptions): Shape[] {
  const dead = options.dead === true;
  const P = dead ? DEAD : LIVE;
  const L = cutterheadLayout(options.variant);
  const phase = L.spec.deckPhase;
  const own = dead ? undefined : playerColor(options.playerId ?? 0);
  const shapes: Shape[] = [];

  const mat = (color: number, alpha = 1): Paint => fill(color, 'material', alpha);
  const line = (color: number, w: number, alpha = 1): Paint => stroke(color, u(w), 'material', alpha);
  const ore = (color: number, alpha = 1): Paint => fill(color, 'ore', alpha);
  const oreLine = (color: number, w: number, alpha = 1): Paint => stroke(color, u(w), 'ore', alpha);

  // --- The claim: the rock this machine is clamped to ------------------------
  // Drawn in the rock family, not the board's lighter hex — see the file header —
  // and inked at `LINE.rock` like every other rock in the game (a3-01, Lever A),
  // because the irregular edge of the ground is what keeps this silhouette out of
  // round 1's "radially symmetric = planet" failure and it has to be findable.
  shapes.push(poly(polarPoly(L.rim), mat(P.rock)));
  shapes.push(poly(polarPoly(L.rim), line(P.rockDark, LINE.rock, 0.9)));
  shapes.push(poly(polarPoly(L.rim.map(([r, d]) => [r * 0.9, d + 3] as const)), mat(P.rockDark, 0.55)));
  for (const f of L.facets) shapes.push(poly(polarPoly(f), mat(P.lit, 0.22)));

  // --- Deck plate ------------------------------------------------------------
  shapes.push(circle(0, 0, u(52), mat(P.plate)));
  shapes.push(circle(0, 0, u(52), line(P.ink, LINE.sprite)));
  for (let i = 0; i < 8; i++) shapes.push(polyline(spoke(40, 52, i * 45 + phase), line(P.deep, 3.4, 0.9)));
  shapes.push(polyline(arcB(47, 0, 360, 48), line(P.deep, 1.2, 0.6)));
  // The limb: lit along the north edge, inked along the south. One light source,
  // stated once, and every ring below obeys it.
  shapes.push(polyline(arcB(50, -164, -16, 22), line(P.lit, 2.6, 0.8)));
  shapes.push(polyline(arcB(50, 16, 164, 22), line(P.ink, 2.8, 0.75)));

  // --- Cutter ring and its sixteen tooth pips --------------------------------
  shapes.push(polyline(arcB(55, 0, 360, 56), line(P.steel, 6.5)));
  for (let i = 0; i < 16; i++) {
    const [x, y] = pol(55, i * 22.5 + phase);
    shapes.push(circle(u(x), u(y), u(1.5), mat(P.ink, 0.9)));
  }

  // --- Eight anchor lugs: what clamps the head to the claim -------------------
  // Two are snapped off a derelict — a rig that has come loose from its claim.
  const lugGone = dead ? [2, 5] : [];
  for (let i = 0; i < 8; i++) {
    if (lugGone.includes(i)) continue;
    const a = i * 45 + phase;
    shapes.push(
      poly(polarPoly([[50, a - 15], [62.5, a - 11], [62.5, a + 11], [50, a + 15]]), mat(P.steel)),
      poly(polarPoly([[50, a - 15], [62.5, a - 11], [62.5, a + 11], [50, a + 15]]), line(P.ink, 1.8)),
      poly(polarPoly([[61.1, a - 10], [61.1, a + 10], [57.5, a + 9.4], [57.5, a - 9.4]]), mat(P.lit, 0.55)),
    );
    for (const s of [-6, 6]) {
      const [bx, by] = pol(54.5, a + s);
      shapes.push(circle(u(bx), u(by), u(1.7), mat(P.ink)));
    }
    // The keyway: the roster colour, on the seat a turret bolts to. Eight of
    // them around the rim, so ownership survives the beacon ring being cropped.
    if (own !== undefined) {
      shapes.push(poly(polarPoly([[59.6, a - 2.1], [59.6, a + 2.1], [53.4, a + 2.4], [53.4, a - 2.4]]), fill(own, 'identity', 0.95)));
    }
  }

  // --- The throat: a hole, with a working face at the bottom of it ------------
  shapes.push(circle(0, 0, u(30), mat(P.ink)));
  shapes.push(circle(0, 0, u(26.5), mat(P.well)));
  // A hole is lit on its FAR wall, so the bright lip is the south one — the
  // opposite of every convex ring above. That inversion is what makes it read
  // as depth rather than as another disc.
  shapes.push(polyline(arcB(28.2, 20, 160, 20), line(P.lit, 2.6, 0.7)));
  shapes.push(polyline(arcB(28.2, -166, -14, 20), line(PALETTE.vacuum, 2.8, 0.85)));

  if (dead) {
    // The core is out and the throat is dark. Dark steel where signal yellow
    // used to be is the single strongest thing this palette can say.
    shapes.push(circle(0, 0, u(21), mat(P.well)));
    shapes.push(circle(0, 0, u(9), mat(PALETTE.vacuum)));
    shapes.push(circle(0, 0, u(9), line(P.deep, 1.6)));
  } else {
    // The cut face, its seams, and the core at the bottom of the bore.
    shapes.push(poly(polarPoly(L.face), mat(P.rock)));
    shapes.push(poly(polarPoly(L.face.map(([r, d]) => [r * 0.78, d - 4] as const)), mat(P.lit, 0.2)));
    for (const [r0, d0, r1, d1] of L.seams) {
      const [x0, y0] = pol(r0, d0);
      const [x1, y1] = pol(r1, d1);
      const seg = [u(x0), u(y0), u(x1), u(y1)];
      shapes.push(polyline(seg, oreLine(P.ore, 2.2, 0.85)));
      shapes.push(polyline(seg, oreLine(P.oreDim, 0.9, 0.9)));
    }
    shapes.push(circle(0, 0, u(25.4), line(P.ink, 2)));
    // The core: the win condition, and the reason yellow is allowed here (§2).
    // Radii unchanged from the shipped sprite — 0.34 / 0.22 / 0.11 R.
    shapes.push(
      circle(0, 0, 0.34, fill(PALETTE.signalYellow, 'core', 0.16)),
      circle(0, 0, 0.22, fill(PALETTE.signalYellow, 'core')),
      circle(0, 0, 0.11, fill(DERIVED.coreHot, 'core')),
    );
    // The kerf: the bright arc where it is cutting RIGHT NOW, and the ore it is
    // throwing. This is the mark that makes the object a machine at work.
    shapes.push(polyline(arcB(24, L.spec.kerfFrom, L.spec.kerfFrom + 108, 16), oreLine(P.oreDim, 4, 0.95)));
    for (const m of L.kerfOre) {
      const [x, y] = pol(m.r, m.deg);
      shapes.push(circle(u(x), u(y), u(m.size), ore(P.ore, 0.95)));
    }
  }

  // --- The bore housing and the sixteen inward teeth --------------------------
  shapes.push(polyline(arcB(34, 0, 360, 40), line(P.deep, 9)));
  shapes.push(polyline(arcB(38, -160, -20, 20), line(P.lit, 2, 0.55)));
  shapes.push(polyline(arcB(30, -160, -20, 20), line(PALETTE.vacuum, 2, 0.5)));

  // Three teeth are gone from a derelict — the machine stopped mid-bite.
  const toothGone = dead ? [3, 4, 11] : [];
  for (let i = 0; i < 16; i++) {
    if (toothGone.includes(i)) continue;
    const a = i * 22.5 + phase;
    shapes.push(
      poly(polarPoly([[33, a + 0.6], [22.5, a + 5.4], [22.5, a + 10.6], [33, a + 15.4]]), mat(P.lit)),
      poly(polarPoly([[33, a + 0.6], [22.5, a + 5.4], [22.5, a + 10.6], [33, a + 15.4]]), line(P.ink, 1.2)),
      poly(polarPoly([[22.5, a + 5.4], [22.5, a + 10.6], [25.6, a + 11.4], [25.6, a + 4.6]]), mat(dead ? P.lit : WHITE, dead ? 0.5 : 0.35)),
    );
  }
  shapes.push(polyline(arcB(38.6, 0, 360, 44), line(P.ink, 1.8, 0.8)));

  // --- The ore circuit: the deck truss that carries what the head wins ---------
  // Four arcs with gaps where the furniture sits, exactly as the board runs them.
  const TRUSS: readonly (readonly [number, number])[] = [[8, 40], [48, 132], [138, 222], [228, 312]];
  for (const [from, to] of TRUSS) {
    shapes.push(polyline(arcB(47.5, from + phase, to + phase, Math.max(4, Math.round((to - from) / 4))), line(P.steel, 1.6)));
    shapes.push(polyline(arcB(40.5, from + phase, to + phase, Math.max(4, Math.round((to - from) / 4))), line(P.steel, 1.6)));
    const rungs = Math.max(2, Math.round((to - from) / 7));
    for (let i = 0; i <= rungs; i++) {
      shapes.push(polyline(spoke(40.4, 47.4, from + phase + ((to - from) * i) / rungs), line(P.plate, 1.1)));
    }
  }

  // --- Ore, visibly, on the circuit -------------------------------------------
  for (const m of L.deckOre) {
    const [x, y] = pol(m.r, m.deg + phase);
    shapes.push(circle(u(x), u(y), u(m.size), ore(P.ore, dead ? 0.8 : 0.95)));
  }

  // --- The throat chute: the path from the hole to the circuit -----------------
  shapes.push(
    polyline([...pol(34.7, 8.2 + phase).map(u), ...pol(47.6, 24.8 + phase).map(u)], line(P.steel, 1.8)),
    polyline([...pol(27.7, 21.3 + phase).map(u), ...pol(42.7, 35.8 + phase).map(u)], line(P.steel, 1.8)),
    polyline([...pol(39.5, 16.1 + phase).map(u), ...pol(33.5, 28.7 + phase).map(u)], line(P.plate, 1.1)),
    polyline([...pol(44.9, 22.3 + phase).map(u), ...pol(39.6, 33.9 + phase).map(u)], line(P.plate, 1.1)),
  );
  for (let i = 0; i < 4; i++) {
    const [x, y] = pol(35 + i * 2.6, 14 + i * 3.4 + phase);
    shapes.push(circle(u(x), u(y), u(1.2 + (i % 2) * 0.6), ore(P.ore, dead ? 0.8 : 1)));
  }

  // --- Deck furniture: store, process, ship out ------------------------------
  // Each sits on the truss at its own bearing; the stub arms tie it to the deck.
  const stubAt = (deg: number): void => {
    for (const off of [-4.6, 4.6]) {
      shapes.push(polyline(spoke(44, 51, deg + off), line(P.steel, 1.5)));
    }
  };

  // Two hoppers, and you can read how full each one is from across the map.
  const hopper = (deg: number, level: number, w: number, h: number): void => {
    const cx = pol(47, deg + phase)[0];
    const cy = pol(47, deg + phase)[1];
    const rot = deg + phase - 90;
    const shellPts = placed(rectPts(-w / 2, -h / 2, w, h), cx, cy, rot);
    shapes.push(poly(shellPts, mat(P.steel)), poly(shellPts, line(P.ink, 1.6)));
    shapes.push(polyline(placed([-w / 2 + 1, -h / 2 + 1, w / 2 - 1, -h / 2 + 1], cx, cy, rot), line(P.lit, 1.4, 0.8)));
    const iw = w - 6;
    const ih = h - 6;
    shapes.push(poly(placed(rectPts(-iw / 2, -ih / 2, iw, ih), cx, cy, rot), mat(P.well)));
    const fillH = round(ih * level);
    if (fillH > 0.1) {
      shapes.push(poly(placed(rectPts(-iw / 2, ih / 2 - fillH, iw, fillH), cx, cy, rot), ore(P.ore)));
      shapes.push(poly(placed(rectPts(-iw / 2, ih / 2 - fillH, iw, Math.min(1.4, fillH)), cx, cy, rot), ore(dead ? P.oreDim : DERIVED.coreHot, 0.8)));
    }
    // The gauge ticks on the outside — how a tank wears its level.
    for (let i = 0; i < 4; i++) {
      const ty = -ih / 2 + (ih * i) / 3;
      shapes.push(polyline(placed([w / 2 - 2.2, ty, w / 2 + 1.6, ty], cx, cy, rot), line(P.lit, 0.9, 0.75)));
    }
    for (const [bx, by] of [[-w / 2 + 2, -h / 2 + 2], [w / 2 - 2, -h / 2 + 2], [-w / 2 + 2, h / 2 - 2], [w / 2 - 2, h / 2 - 2]] as const) {
      const p = placed([bx, by], cx, cy, rot);
      shapes.push(circle(p[0]!, p[1]!, u(1.15), mat(P.ink)));
    }
  };

  stubAt(45 + phase);
  hopper(45, L.spec.hoppers[0], 25, 13);
  stubAt(140 + phase);
  // On a derelict this one has split and run its ore onto the deck (below).
  hopper(140, dead ? 0.1 : L.spec.hoppers[1], 22, 12.5);

  // The smelter: molten ore in the slot. Out on a derelict.
  {
    const deg = 225 + phase;
    const [cx, cy] = pol(46, deg);
    const rot = deg - 90;
    stubAt(deg);
    const shell = placed([-11, -6, -5, -11, 5, -11, 11, -6, 11, 6, 5, 11, -5, 11, -11, 6], cx, cy, rot);
    shapes.push(poly(shell, mat(P.steel)), poly(shell, line(P.ink, 1.7)));
    shapes.push(polyline(placed([-9, -8.4, 8, -8.4], cx, cy, rot), line(P.lit, 1.3, 0.8)));
    shapes.push(poly(placed(rectPts(-6.5, -3, 13, 6), cx, cy, rot), dead ? mat(P.well) : ore(P.ore)));
    if (!dead) shapes.push(poly(placed(rectPts(-5, -1.6, 10, 3.2), cx, cy, rot), ore(DERIVED.coreHot)));
    for (const [bx, by] of [[-8.4, -7.4], [8.4, -7.4], [-8.4, 7.4], [8.4, 7.4]] as const) {
      const p = placed([bx, by], cx, cy, rot);
      shapes.push(circle(p[0]!, p[1]!, u(1.3), mat(P.ink)));
    }
  }

  // The apron and the barge: product leaves here. Hazard tape at the loading
  // edge is one of the five things signal yellow is allowed to be (§2), so it
  // carries role `danger` and the audit proves it.
  {
    const deg = -42 + phase;
    const [cx, cy] = pol(47, deg);
    const rot = deg - 90;
    stubAt(deg);
    const apron = placed([-13, -8, 13, -8, 15, 8, -15, 8], cx, cy, rot);
    shapes.push(poly(apron, mat(P.plate)), poly(apron, line(P.ink, 1.5)));
    // Hazard tape at the loading edge — one of the five things signal yellow is
    // allowed to be. A derelict has none: nothing is being loaded, so nothing is
    // a hazard, and a wreck carries no `danger` role at all (style-guide §8 —
    // red and the whole danger vocabulary are the under-attack tell, and a wreck
    // is an absence, not a threat).
    if (!dead) {
      for (let i = 0; i < 4; i++) {
        const x = -11.6 + i * 6;
        shapes.push(poly(placed([x, 8, x + 3.12, 5.4, x, 2.8, x + 1.69, 5.4], cx, cy, rot), fill(PALETTE.signalYellow, 'danger', 0.95)));
      }
    }
    if (own !== undefined) {
      shapes.push(
        poly(placed(rectPts(-11, -6.4, 3, 3), cx, cy, rot), fill(own, 'identity')),
        poly(placed(rectPts(8, -6.4, 3, 3), cx, cy, rot), fill(own, 'identity')),
      );
    }
    if (!dead) {
      const [bx, by] = pol(74, deg + 2);
      const brot = deg + 172;
      const hull = placed([-16, -8, 10, -8, 17, 0, 10, 8, -16, 8], bx, by, brot);
      shapes.push(poly(hull, mat(P.steel)), poly(hull, line(P.ink, 1.5)));
      shapes.push(poly(placed(rectPts(-13, -5, 9, 10), bx, by, brot), mat(P.well)));
      shapes.push(poly(placed(rectPts(-12.2, -4.2, 7.4, 8.4), bx, by, brot), ore(PALETTE.signalYellow)));
      shapes.push(poly(placed(rectPts(-2, -5.4, 7, 10.8), bx, by, brot), mat(P.plate)));
      if (own !== undefined) shapes.push(poly(placed(rectPts(6, -3, 3.2, 6), bx, by, brot), fill(own, 'identity')));
    }
  }

  // The radiator comb: heat rejected, hung outboard where nothing else is.
  {
    const base = -110 + phase;
    shapes.push(polyline(spoke(43, 52, base), line(P.plate, 4)));
    for (let i = 0; i < 7; i++) {
      const a = base - 16 + i * 5.3;
      shapes.push(polyline(spoke(56.2, 70.1, a + 2), line(P.plate, 2.6)));
      shapes.push(polyline(spoke(56.2, 70.1, a + 2), line(P.lit, 0.8, 0.55)));
    }
  }

  // The spoil boom: the arm that leaves the circle, and the waste it throws.
  {
    const base = 100 + phase;
    const plate = polarPoly([[52, base - 12], [52, base + 12], [64, base + 10], [64, base - 8]]);
    shapes.push(poly(plate, mat(P.plate)), poly(plate, line(P.ink, 1.6)));
    // Broken mid-span on a derelict, its outer half adrift.
    const tip = dead ? 84 : 107.5;
    for (const off of [-5, 5]) {
      shapes.push(polyline(spoke(60, tip, base + off), line(P.steel, 1.8)));
    }
    const rungs = dead ? 2 : 5;
    for (let i = 1; i <= rungs; i++) {
      const r = 60 + ((tip - 60) * i) / (rungs + 1);
      shapes.push(polyline([...pol(r, base - 5).map(u), ...pol(r, base + 5).map(u)], line(P.plate, 1.1)));
    }
    if (dead) {
      // The outer half, adrift and turned.
      for (const off of [-2, 8]) {
        shapes.push(polyline(spoke(96, 118, base + off + 14), line(P.steel, 1.8)));
      }
    }
    for (const m of L.tailings) {
      const [x, y] = pol(m.r, m.deg + phase);
      shapes.push(circle(u(x), u(y), u(m.size), mat(P.rock, 0.75)));
    }
    for (let i = 0; i < 6; i++) {
      const m = L.tailings[i * 2]!;
      const [x, y] = pol(m.r * 0.94, m.deg + phase + 3);
      shapes.push(circle(u(x), u(y), u(m.size * 0.7), ore(P.oreDim, 0.8)));
    }
  }

  // --- Corrosion -------------------------------------------------------------
  for (const m of L.patina) {
    const [x, y] = pol(m.r, m.deg + phase);
    shapes.push(poly(blob(u(x), u(y), 6, (i) => u(m.size) * (0.7 + ((i * 37) % 11) / 24)), mat(P.patina, P.patinaAlpha)));
  }

  if (dead) {
    // The split hopper's spill: the only bright yellow left on a wreck, and the
    // reason anyone comes here at all (GDD §2.7).
    const spill = 140 + phase;
    for (let i = 0; i < 9; i++) {
      const m = L.deckOre[i]!;
      const [x, y] = pol(40 + m.r * 0.24, spill - 22 + ((m.deg % 44) - 8));
      shapes.push(poly(blob(u(x), u(y), 5, () => u(m.size * 1.7)), ore(PALETTE.signalYellow, 0.9)));
    }
  }

  return shapes;
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

/**
 * A working facility at unit radius. No ownership ring and no health ring —
 * those are separate sprites so the renderer can obey the fog rule (GDD §2.2).
 *
 * @param variant Which of the four arrangements (see {@link cutterheadLayout}).
 * @param playerId Owner, for the trim marks only. Steel never takes it (§3).
 */
export function stationSprite(variant: number, playerId = 0): SpriteDef {
  const v = stationVariantFor(variant);
  const p = ((Math.trunc(playerId) % 8) + 8) % 8;
  return sprite(`station/v${v}/p${p}`, STATION_ART_EXTENT, cutterheadShapes({ variant: v, playerId: p }));
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
 * The health ring (GDD §2.2, style-guide §5), in the ratified p11 grammar: a
 * whole ring in the OWNER's colour is the health you still have, and a
 * threat-red segment FILLS it — from twelve o'clock, clockwise — as HP is lost.
 * A fully red ring is core death, exactly. Drawn on every station, at every
 * range (GDD §2.2, amended 2026-08-07) — this function has never had an opinion
 * about that, it just makes the ring the renderer asks for.
 *
 * One primitive with the shield layers ({@link ringDamageShapes}), so a rival
 * reads in THEIR colour by exactly the same verb as your own home.
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
 * The repair tell (GDD §2.5): a patina bloom over the reactor while the owner's
 * ship sits home and ore ticks into HP. Patina is the repair colour by contract
 * (style-guide §1, "corrosion, continents, **the repair channel**").
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
 *  - the **collection field** at `DEPOSIT_RANGE` — inside it your hold empties
 *    itself into the bank ({@link ATMOSPHERE_HALO_RADIUS});
 *  - the **build ring** at `STATION.dockRange` — inside it the Build & Upgrade
 *    wheel is live ({@link BUILD_RING_RADIUS}).
 *
 * Both radii already existed and already drove the sim; neither moves here. What
 * changed is that the collection field used to *look* like five rings (a five-step
 * gradient whose every step was a findable edge) and the build radius was drawn
 * nowhere at all — so the player could count five boundaries and none of them was
 * the one that gates building.
 *
 * The two are deliberately different **kinds** of boundary, so they can never be
 * mistaken for the same rule stated twice, and so they still separate with colour
 * removed (style-guide §3 rule 4 — form carries information, colour is the fast
 * read):
 *
 * | | collection field | build ring |
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
 *  just over the station limb, so the halo never seams against the deck. */
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
 * The own-station range rings (p4-12, a4-01; GDD §2.3, §2.5): the collection
 * field out to exactly `DEPOSIT_RANGE`, and the build ring at exactly
 * `STATION.dockRange`. Drawn around a player's **own** station and nowhere else —
 * both are affordances ("where do I unload?", "where can I build?"), and neither
 * question has an answer at a rival's home, so a rival's home gets neither ring.
 *
 * The field reads as air, not a UI circle (the p4 brief): a genuinely smooth
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
