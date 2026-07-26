/**
 * src/art/ships.ts — the four hulls, generated. OWNER: Art & Audio Agent.
 *
 * Style-guide §4 states the requirement as a *hard* test, so this file is
 * written to pass it mechanically rather than to be admired:
 *
 * > Each of the four silhouettes must be unambiguously distinguishable from the
 * > other three at **24×24 px**, in flat steel `#7E8894` with player colour
 * > removed.
 *
 * `shipSilhouette()` returns exactly that subject — steel fills only, no trim,
 * no decal — and `ships.test.ts` rasterizes all four at 24px (./raster) and
 * asserts pairwise Jaccard overlap below a threshold. If two hulls drift toward
 * each other, CI says so; nobody has to squint.
 *
 * ## The four shapes, and why each one is that shape
 *
 * | Class | Hull | The read |
 * |---|---|---|
 * | Interceptor | Quadfin    | A needle with **four spikes**. Nothing else on the map is thin. |
 * | Vanguard    | Anvil      | A **solid symmetric wedge** — the neutral default, no protrusions. |
 * | Excavator   | Pincer     | A **forked prow**: the notch between two mandibles is the tell. |
 * | Hauler      | Hammerhead | A **T**: a wide blunt bar out front on a narrow spine. |
 *
 * Thin / solid / notched / wide-barred is a four-way split that survives
 * greyscale and 24 pixels, because it is a split in *mass distribution*, not in
 * detail — detail is the first thing a small render throws away.
 *
 * ## Colour discipline (style-guide §3)
 *
 * Hulls stay steel. Player colour lives only on wing-tip trim, cockpit glass
 * and the engine ember — every one of those shapes carries `role: 'identity'`,
 * and the compliance test fails the build if a roster colour appears on any
 * other role, or if steel is ever swapped for a player colour. A livery is a
 * palette swap over these four silhouettes, never a new shape (§4), which is
 * why the bot personalities (GDD §2.9) need no art of their own here.
 *
 * ## Damage states (GDD §2.11 armor, §3.6 tells)
 *
 * A hull under fire is a tell like any other: three bands (`ok` → `scarred` →
 * `critical`), banded off remaining hull HP the same way an asteroid cracks off
 * remaining ore. Damage is drawn as **charred plating and split seams** over the
 * steel, and, at `critical`, a threat-red breach glow — the only warm colour on
 * a ship, and legal precisely because it is *damage* (style-guide §2). It is a
 * tell, not a mask: the scorch hugs the spine, avoids the cockpit, and sits
 * under the identity layer, so trim, number and player colour still read on a
 * burning ship. The silhouette is untouched — damage never changes which four
 * shapes a 24px render sees, so recognition survives being on fire.
 */

import { ShipClass } from '@shared/types';
import { hullDecal } from './decals';
import { DERIVED, PALETTE, playerColor } from './palette';
import {
  circle,
  fill,
  mirrorY,
  poly,
  polyline,
  sprite,
  stroke,
  type Shape,
  type SpriteDef,
} from './shapes';

// ---------------------------------------------------------------------------
// Hull geometry
// ---------------------------------------------------------------------------

/** An axis-aligned box, unit space, as `[cx, cy, halfW, halfH]`. */
type Box = readonly [number, number, number, number];

function boxPoly(b: Box): number[] {
  const [cx, cy, hw, hh] = b;
  return [cx - hw, cy - hh, cx + hw, cy - hh, cx + hw, cy + hh, cx - hw, cy + hh];
}

/**
 * One hull, as data. `plates` is the silhouette — the closed steel polygons a
 * 24px render sees. Everything else is detail that must never be load-bearing
 * for recognition.
 */
export interface HullGeometry {
  readonly shipClass: ShipClass;
  /** The hull's name (GDD §2.11): Quadfin, Anvil, Pincer, Hammerhead. */
  readonly hullName: string;
  /** Authoring half-extent — fins and prows overhang the collision radius. */
  readonly extent: number;
  /** Closed steel polygons. **This is the silhouette.** */
  readonly plates: readonly (readonly number[])[];
  /** Darker inset panels: depth only, never shape. */
  readonly panels: readonly (readonly number[])[];
  /** Lit top-edge slivers: depth only, never shape. */
  readonly highlights: readonly (readonly number[])[];
  /** Wing-tip trim — the *only* polygons that take player colour. */
  readonly trim: readonly (readonly number[])[];
  /** Cockpit glass: `[cx, cy, r]`. Player colour with a plasma glint. */
  readonly cockpit: readonly [number, number, number];
  /** Engine nozzles, back-to-front order. */
  readonly nozzles: readonly Box[];
  /** Where the number decal sits: `[cx, cy, size]`. */
  readonly decal: readonly [number, number, number];
}

/** A hull half mirrored into a whole, so no shape can be accidentally asymmetric. */
function pair(upper: readonly number[]): readonly (readonly number[])[] {
  return [upper, mirrorY(upper)];
}

// --- Interceptor (Quadfin) — narrow, swept, four fins ----------------------

const QUADFIN_BODY = [
  1.14, 0, 0.6, 0.085, 0.1, 0.11, -0.52, 0.12, -0.8, 0.09, -0.88, 0,
  -0.8, -0.09, -0.52, -0.12, 0.1, -0.11, 0.6, -0.085,
];
const QUADFIN_FIN_FWD = [0.36, 0.08, -0.02, 0.62, -0.18, 0.7, -0.14, 0.1];
const QUADFIN_FIN_AFT = [-0.5, 0.1, -0.64, 0.54, -0.82, 0.5, -0.78, 0.08];

const QUADFIN: HullGeometry = {
  shipClass: ShipClass.Interceptor,
  hullName: 'Quadfin',
  extent: 1.15,
  plates: [QUADFIN_BODY, ...pair(QUADFIN_FIN_FWD), ...pair(QUADFIN_FIN_AFT)],
  panels: [boxPoly([-0.2, 0, 0.34, 0.05])],
  highlights: [[0.62, 0.11, 0.1, 0.15, 0.1, 0.08, 0.66, 0.05]],
  trim: [
    [-0.08, 0.66, -0.34, 0.7, -0.3, 0.52, -0.13, 0.5],
    mirrorY([-0.08, 0.66, -0.34, 0.7, -0.3, 0.52, -0.13, 0.5]),
  ],
  cockpit: [0.42, 0, 0.11],
  nozzles: [[-0.86, 0.055, 0.06, 0.045], [-0.86, -0.055, 0.06, 0.045]],
  decal: [-0.36, 0, 0.2],
};

// --- Vanguard (Anvil) — the neutral, symmetric default ---------------------

const ANVIL_BODY = [
  1.02, 0, 0.34, 0.2, -0.3, 0.3, -0.52, 0.54, -0.82, 0.5, -0.74, 0.18, -0.5, 0.06,
  -0.5, -0.06, -0.74, -0.18, -0.82, -0.5, -0.52, -0.54, -0.3, -0.3, 0.34, -0.2,
];

const ANVIL: HullGeometry = {
  shipClass: ShipClass.Vanguard,
  hullName: 'Anvil',
  extent: 1.05,
  plates: [ANVIL_BODY],
  panels: [boxPoly([-0.16, 0, 0.24, 0.18]), [0.9, 0, 0.5, 0.13, 0.5, -0.13]],
  highlights: [[1.02, 0, 0.34, 0.2, -0.3, 0.3, -0.28, 0.23, 0.34, 0.13, 0.9, 0.015]],
  trim: [
    [-0.52, 0.54, -0.82, 0.5, -0.8, 0.4, -0.55, 0.44],
    mirrorY([-0.52, 0.54, -0.82, 0.5, -0.8, 0.4, -0.55, 0.44]),
  ],
  cockpit: [0.3, 0, 0.16],
  nozzles: [[-0.7, 0.27, 0.06, 0.08], [-0.7, -0.27, 0.06, 0.08]],
  decal: [-0.3, 0, 0.26],
};

// --- Excavator (Pincer) — front-heavy mandibles, notched prow --------------

const PINCER_BODY = [
  0.42, 0.36, -0.26, 0.46, -0.68, 0.38, -0.8, 0.14, -0.8, -0.14, -0.68, -0.38,
  -0.26, -0.46, 0.42, -0.36,
];
const PINCER_MANDIBLE = [0.36, 0.42, 1.02, 0.4, 1.14, 0.22, 0.62, 0.12, 0.34, 0.16];

const PINCER: HullGeometry = {
  shipClass: ShipClass.Excavator,
  hullName: 'Pincer',
  extent: 1.16,
  plates: [PINCER_BODY, ...pair(PINCER_MANDIBLE)],
  panels: [boxPoly([-0.36, 0, 0.28, 0.24])],
  highlights: [[0.42, 0.36, -0.26, 0.46, -0.26, 0.36, 0.42, 0.27]],
  trim: [
    [1.02, 0.4, 1.14, 0.22, 0.94, 0.2, 0.86, 0.36],
    mirrorY([1.02, 0.4, 1.14, 0.22, 0.94, 0.2, 0.86, 0.36]),
  ],
  cockpit: [0.16, 0, 0.19],
  nozzles: [[-0.82, 0.2, 0.08, 0.14], [-0.82, -0.2, 0.08, 0.14]],
  decal: [-0.44, 0, 0.3],
};

// --- Hauler (Hammerhead) — a wide blunt bar on a narrow spine --------------

const HAMMER_HEAD = [0.5, 0.78, 0.92, 0.66, 0.96, -0.66, 0.5, -0.78];
const HAMMER_SPINE = [0.56, 0.28, -0.5, 0.32, -0.5, -0.32, 0.56, -0.28];
const HAMMER_STERN = [-0.44, 0.5, -0.86, 0.42, -0.86, -0.42, -0.44, -0.5];

const HAMMERHEAD: HullGeometry = {
  shipClass: ShipClass.Hauler,
  hullName: 'Hammerhead',
  extent: 1.0,
  plates: [HAMMER_HEAD, HAMMER_SPINE, HAMMER_STERN],
  panels: [boxPoly([0.7, 0, 0.14, 0.5]), boxPoly([-0.66, 0, 0.14, 0.3])],
  highlights: [[0.5, 0.78, 0.92, 0.66, 0.9, 0.56, 0.5, 0.66]],
  trim: [
    [0.9, 0.64, 0.93, 0.36, 0.82, 0.36, 0.78, 0.66],
    mirrorY([0.9, 0.64, 0.93, 0.36, 0.82, 0.36, 0.78, 0.66]),
  ],
  cockpit: [0.28, 0, 0.16],
  nozzles: [[-0.88, 0.26, 0.07, 0.13], [-0.88, -0.26, 0.07, 0.13], [-0.88, 0, 0.07, 0.09]],
  decal: [-0.12, 0, 0.34],
};

/** The four hulls (GDD §2.11). Four classes ship, and no others. */
export const HULLS: Readonly<Record<ShipClass, HullGeometry>> = {
  [ShipClass.Interceptor]: QUADFIN,
  [ShipClass.Vanguard]: ANVIL,
  [ShipClass.Excavator]: PINCER,
  [ShipClass.Hauler]: HAMMERHEAD,
};

/** The four classes in lobby order. */
export const SHIP_CLASSES: readonly ShipClass[] = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
];

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

/**
 * The **silhouette test subject** (style-guide §4): steel plates only, flat,
 * with player colour and every scrap of detail removed. This is what gets
 * rasterized at 24px in CI, and it is deliberately the same geometry the full
 * sprite is built from — so the thing tested is the thing shipped.
 */
export function shipSilhouette(shipClass: ShipClass): SpriteDef {
  const hull = HULLS[shipClass];
  const steel = fill(PALETTE.hullSteel, 'material');
  return sprite(
    `ship/${shipClass}/silhouette`,
    hull.extent,
    hull.plates.map((p) => poly(p, steel)),
  );
}

/**
 * How beaten a hull looks. Three bands, so the pool stays small (a texture per
 * class × slot × band, not per HP point) and the read is coarse enough to trust
 * at a glance: whole, hurt, or about to go.
 */
export type DamageState = 'ok' | 'scarred' | 'critical';

/**
 * Band remaining-hull fraction (1 = full, 0 = dead) into a {@link DamageState}.
 * Thirds, mirroring the asteroid's three crack stages — a ship reads its own
 * health on the same scale the world reads a rock's payout.
 */
export function damageStateFor(hullFraction: number): DamageState {
  if (hullFraction > 0.66) return 'ok';
  if (hullFraction > 0.33) return 'scarred';
  return 'critical';
}

/**
 * Charred plating and split seams over the steel — and, at `critical`, a
 * threat-red breach. Authored in raw unit space (not scaled by `extent`) and
 * hugging the spine, so the same marks land on the body of a needle Interceptor
 * and a wide Hauler alike. Returns nothing for an intact hull, so a healthy
 * ship's sprite is byte-for-byte what it always was.
 */
function damageShapes(state: DamageState): Shape[] {
  if (state === 'ok') return [];
  const char = fill(DERIVED.wreckBody, 'material', 0.9); // charred steel
  const seam = stroke(DERIVED.rockFissure, 0.03, 'material', 0.95); // split plating
  const out: Shape[] = [
    poly(boxPoly([0.14, 0.05, 0.13, 0.05]), char),
    poly(boxPoly([-0.28, -0.06, 0.15, 0.05]), char),
    polyline([0.28, 0.03, 0.1, -0.03, -0.06, 0.04], seam),
  ];
  if (state === 'critical') {
    out.push(
      poly(boxPoly([-0.04, 0.1, 0.1, 0.045]), char),
      // A glowing breach. Threat red is legal here because this *is* damage —
      // the one warm colour a hull may ever wear (style-guide §2, role danger).
      circle(-0.02, -0.01, 0.11, fill(PALETTE.threatRed, 'danger', 0.5)),
      circle(-0.02, -0.01, 0.055, fill(PALETTE.threatRed, 'danger', 0.85)),
      polyline([-0.02, -0.12, 0.04, -0.02, -0.08, 0.05, 0, 0.13], seam),
    );
  }
  return out;
}

/** What a ship sprite needs to know about the player flying it. */
export interface ShipSpriteOptions {
  readonly shipClass: ShipClass;
  /** Slot 0..7 — picks the roster colour and the hull number decal. */
  readonly playerId: number;
  /** Spawn-protected ships get a plasma shell (GDD §2.1, 10 s). */
  readonly spawnProtected?: boolean;
  /** How beaten the hull looks (GDD §2.11 armor). Defaults to `'ok'`. */
  readonly damage?: DamageState;
}

/**
 * A full ship: steel hull, player-colour trim, cockpit, engine embers, and the
 * number decal. Deterministic — same options, deep-equal sprite.
 */
export function shipSprite(options: ShipSpriteOptions): SpriteDef {
  const { shipClass, playerId } = options;
  const hull = HULLS[shipClass];
  const id = playerColor(playerId);
  const protectedShell = options.spawnProtected === true;
  const damage = options.damage ?? 'ok';

  const steel = fill(PALETTE.hullSteel, 'material');
  const panel = fill(DERIVED.hullShadow, 'material');
  const lit = fill(DERIVED.hullLight, 'material', 0.85);
  const identity = fill(id, 'identity');
  // One crisp, dark ink outline — the darkest sanctioned steel shade (GAP-
  // ANALYSIS Lever A). A tighter, darker rim than the old soft `hullDark` is
  // what makes the four silhouettes snap at gameplay zoom.
  const rim = stroke(DERIVED.decalInk, 0.035, 'material', 0.95);

  const shapes: (Shape | null)[] = [
    // Spawn-protection shell sits behind the hull so the ship stays readable
    // through it (GDD §2.1 — a tell, not a mask).
    protectedShell ? circle(0, 0, hull.extent * 1.12, fill(PALETTE.plasma, 'energy', 0.16)) : null,
    protectedShell
      ? circle(0, 0, hull.extent * 1.12, stroke(PALETTE.plasma, 0.05, 'energy', 0.5))
      : null,

    ...hull.plates.map((p) => poly(p, steel)),
    ...hull.plates.map((p) => poly(p, rim)),
    ...hull.panels.map((p) => poly(p, panel)),
    ...hull.highlights.map((p) => poly(p, lit)),

    // Battle damage sits on the plating, under the identity layer below, so a
    // burning hull still reads its player colour and number (a tell, not a mask).
    ...damageShapes(damage),

    // Engine nozzles: dark wells with a player-colour ember at the throat.
    ...hull.nozzles.map((n) => poly(boxPoly(n), fill(DERIVED.hullDark, 'material'))),
    ...hull.nozzles.map((n) =>
      poly(boxPoly([n[0] - n[2] * 0.5, n[1], n[2] * 0.35, n[3] * 0.7]), fill(id, 'identity', 0.9)),
    ),

    // Wing-tip trim and cockpit glass — the whole of the identity layer (§3.2).
    ...hull.trim.map((p) => poly(p, identity)),
    circle(hull.cockpit[0], hull.cockpit[1], hull.cockpit[2], identity),
    circle(hull.cockpit[0], hull.cockpit[1], hull.cockpit[2], stroke(DERIVED.hullDark, 0.03, 'material', 0.8)),
    circle(
      hull.cockpit[0] + hull.cockpit[2] * 0.28,
      hull.cockpit[1] - hull.cockpit[2] * 0.24,
      hull.cockpit[2] * 0.42,
      fill(PALETTE.plasma, 'energy', 0.75),
    ),

    // The number decal: identity that survives greyscale (§3 rule 3).
    ...hullDecal(playerId, hull.decal[0], hull.decal[1], hull.decal[2]),
  ];

  // The key carries only what changes the look, so healthy ships keep their
  // original `ship/<class>/p<id>` name (and pooled texture) untouched.
  const dmg = damage === 'ok' ? '' : `/${damage}`;
  const suffix = protectedShell ? '/protected' : '';
  return sprite(
    `ship/${shipClass}/p${playerId}${dmg}${suffix}`,
    hull.extent * (protectedShell ? 1.14 : 1),
    shapes,
  );
}

/**
 * A ship drawn as a wreck-adjacent debris hull — the steel left over when a
 * ship explodes. Cold, unlit, no identity: the player is gone from it.
 */
export function shipHulkSprite(shipClass: ShipClass): SpriteDef {
  const hull = HULLS[shipClass];
  const dead = fill(DERIVED.wreckCrust, 'material');
  const seam = stroke(DERIVED.rockFissure, 0.04, 'material', 0.9);
  return sprite(`ship/${shipClass}/hulk`, hull.extent, [
    ...hull.plates.map((p) => poly(p, dead)),
    ...hull.plates.map((p) => poly(p, seam)),
    polyline([-0.2, -0.3, 0.05, 0.02, -0.15, 0.32], seam),
  ]);
}
