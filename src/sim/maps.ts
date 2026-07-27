/**
 * src/sim/maps.ts — the ratified map registry. OWNER: Gameplay Engineer.
 *
 * Four maps, ratified by the developer off the layout board (map-layouts.html
 * r1+r2), `octagon` the default. A map is a *layout*, nothing more: it owns the
 * arena bounds and where the `N` home planets sit, and hands those to
 * `createWorld` (`./state`). Everything downstream — the ships that orbit each
 * planet, the fair home neighbourhoods stamped around them, the contested
 * central commons, collapse, win/loss — is the same code for every map
 * (`./waves`, `./match`). That is the whole point of the boundary: a new map is
 * geometry, not gameplay.
 *
 * Two invariants every map honours, so the registry can never smuggle in an
 * unfair or wall-hugging layout:
 *
 *  1. **Margin (field report P1).** Every planet — and, downstream, every ship,
 *     asteroid, chunk and wreck stamped around it — clears the arena wall by
 *     `WORLD_EDGE_MARGIN`. Each layout sizes its outermost planets to hug that
 *     margin, so the arena reads as space with a steel frame, not a box the
 *     planets touch.
 *  2. **Resource fairness (p1-09 field rule v0.1.2).** The home neighbourhoods
 *     are stamped as one seeded canonical pattern rotated onto each planet
 *     (`spawnHomeFields`), so every player's local ore is identical *by
 *     construction* — even on a deliberately asymmetric layout like `diamond`,
 *     where the planets are NOT congruent but their resources are. The commons
 *     is `N`-fold symmetric about the centre for every map. `maps.test.ts`
 *     proves both against the same seeded suite p1-09 established.
 *
 * Arena bounds are now PER MAP — square for `octagon`/`compass`, wide for
 * `oval`/`diamond`. The sim already routes bounds through `halfMin =
 * min(width, height)` everywhere it matters (the ring sizing here, the collapse
 * ring in `./match`, the margin clamp in `./constants`), so a wide arena costs
 * no special case.
 *
 * **Variable N (Milestone B, ratified 2026-07-26).** A lobby seats 2..8 players,
 * and each map answers a shrinking roster in one of two ways:
 *  - **regenerate** (`octagon`, `oval`) — the layout is parametric, so it places
 *    exactly `count` live homes at equal spacing for any N (octagon's ring at
 *    `2π/N` steps; oval's equal-chord solve for `count` points). No wasted board.
 *  - **derelict-fill** (`compass`, `diamond`) — the layout is an eight-point
 *    construction whose character (corner-cover vs edge-lane; outer/inner
 *    asymmetry) has no natural small-N form, so it always lays out all eight
 *    positions and marks the `8-N` unused ones `derelict`. A derelict is an
 *    unowned wreck (`createWorld` builds it dead, with lootable debris) — the
 *    board keeps its shape, and the live homes are the first `count` positions so
 *    slot 0's identity never moves. Resource fairness is a claim about the LIVE
 *    homes; each gets `homeFieldOre(activeN)`, and the commons stays symmetric
 *    about every board position (eight-fold), so it is fair from every live spoke.
 *
 * Fully deterministic and RNG-free: planet placement is pure geometry (the seed
 * threads through to the asteroid scatter in `./waves`, not to the layout), so
 * the same map builds the same board every time (GDD §4.8).
 */

import type { Vec2 } from '@shared/types';
import { PLANET, WORLD_EDGE_MARGIN, WORLD_SIZE } from './constants';
import type { Bounds } from './state';

// ---------------------------------------------------------------------------
// The MapDef contract
// ---------------------------------------------------------------------------

/**
 * Where one player's home sits: the planet centre, the ship's spawn point
 * (orbiting its planet inboard, GDD §2.1), and the outward spoke angle the
 * turret mount ring starts from. `createWorld` reads exactly this per slot and
 * builds the rest.
 */
export interface PlanetPlacement {
  /** Planet centre. */
  readonly planet: Vec2;
  /** Ship spawn — inboard of the planet, toward the field. */
  readonly ship: Vec2;
  /** Outward angle from the arena centre (radians). */
  readonly angle: number;
  /**
   * True for a board position that holds an unowned **derelict wreck**, not a
   * live home. The derelict-fill maps (`compass`, `diamond`) always lay out all
   * eight board positions and mark the `8 - N` unused ones derelict, so the
   * layout keeps its signature shape at any N (ratified 2026-07-26, Milestone B).
   * `octagon`/`oval` regenerate exactly `count` live homes and never set this, so
   * an absent flag reads as "a live home" — the same backward-compatible optional
   * discipline the sim uses everywhere. `createWorld` (`./state`) builds a live
   * ship + planet for every non-derelict placement and a match-start wreck for
   * each derelict one.
   */
  readonly derelict?: boolean;
}

/** A ratified arena layout. */
export interface MapDef {
  /** Stable id — the boot/picker key and the registry lookup. */
  readonly id: string;
  /** Display name (GDD §5 — the picker labels these). */
  readonly name: string;
  /** One-line character note for the picker. */
  readonly blurb: string;
  /** This map's default arena bounds (square or wide). `createWorld` uses these
   *  unless a caller overrides `bounds` (the QA harness runs cramped worlds). */
  readonly bounds: Bounds;
  /**
   * The `count` home placements for this arena, deterministic and RNG-free. The
   * `seed` is part of the ratified signature so a future map may vary its layout
   * by seed; the four shipped maps are pure geometry and ignore it. `bounds` is
   * the arena actually in play (may differ from `this.bounds` on a QA world).
   */
  planets(seed: number, count: number, bounds: Bounds): PlanetPlacement[];
}

/** The default map until the picker (m8-02) lands: "The Ring". */
export const DEFAULT_MAP_ID = 'octagon';

// ---------------------------------------------------------------------------
// Shared arena bounds
// ---------------------------------------------------------------------------

/** A square arena (octagon, compass) — the default `WORLD_SIZE` on both sides. */
const SQUARE: Bounds = { width: WORLD_SIZE, height: WORLD_SIZE };
/** A wide arena (oval, diamond) — the same short side as the square, stretched
 *  along x so a wide layout has room to breathe without touching the walls. */
const WIDE: Bounds = { width: 3200, height: 2000 };

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

/** Arena centre. */
function centre(bounds: Bounds): Vec2 {
  return { x: bounds.width / 2, y: bounds.height / 2 };
}

/**
 * Turn a list of polar home positions (radius from centre + outward angle) into
 * placements, spawning each ship inboard of its planet by `PLANET.orbitOffset`
 * along the same spoke — the ship "orbiting its home planet, between the planet
 * and the field" (GDD §2.1). The layout-agnostic path every map but `octagon`
 * uses; `octagon` reproduces the historical ring math directly so the default
 * board is byte-for-byte what it always was.
 */
function fromPolar(bounds: Bounds, homes: readonly { r: number; angle: number }[]): PlanetPlacement[] {
  const c = centre(bounds);
  return homes.map(({ r, angle }) => {
    const shipR = Math.max(0, r - PLANET.orbitOffset);
    return {
      planet: { x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r },
      ship: { x: c.x + Math.cos(angle) * shipR, y: c.y + Math.sin(angle) * shipR },
      angle,
    };
  });
}

/**
 * Take a full eight-position board and activate the first `count` of them; the
 * rest become unowned **derelict wrecks**, so the layout keeps its shape at any
 * N (the derelict-fill maps `compass`/`diamond`, ratified 2026-07-26). The active
 * placements come first so they line up with the dense `0..N-1` player roster
 * (`createWorld`): ship `i` and its live home are `full[i]`, and the identity of
 * slot 0's board position never moves as N changes. `count` is clamped to the
 * board size; config validation (`./match-config`) already caps N at eight.
 */
function derelictFill(full: PlanetPlacement[], count: number): PlanetPlacement[] {
  const active = Math.max(0, Math.min(count, full.length));
  return full.map((p, i) => (i < active ? p : { ...p, derelict: true }));
}

/**
 * Largest planet-centre radius that still clears the arena wall by
 * `WORLD_EDGE_MARGIN` on the tighter arena dimension — what a map's outermost
 * planets sit at to "hug the spawn margin." Uses `halfMin` so a wide arena's
 * outer ring is bounded by its short side, never poking through the top/bottom.
 */
function marginRadius(bounds: Bounds): number {
  const halfMin = Math.min(bounds.width, bounds.height) / 2;
  return halfMin - PLANET.radius - WORLD_EDGE_MARGIN;
}

// ---------------------------------------------------------------------------
// oval — 8 points on an ellipse, equal neighbour chords (solved iteratively)
// ---------------------------------------------------------------------------

/**
 * Angular parameters `t_i` for `count` points on the ellipse `(a cos t,
 * b sin t)` whose consecutive chords are all equal. There is no closed form for
 * an eccentric ellipse, so it is relaxed: start from a uniform spacing and, each
 * pass, nudge every point along the curve toward the midpoint of its two
 * neighbours' pull until the chord imbalance vanishes. Deterministic (fixed
 * gain, fixed pass count, pure arithmetic — no RNG, no `Date`), so the brief's
 * "solve iteratively, don't hardcode approximations" costs the layout no
 * determinism.
 *
 * Memoised by `(a, b, count)` because `createWorld` runs it on every world build
 * and the answer depends only on those three — a pure-function cache, nothing
 * enters the world state, so replay is untouched (GDD §4.8).
 */
const ellipseCache = new Map<string, readonly number[]>();
function ellipseEqualChord(a: number, b: number, count: number): readonly number[] {
  const key = `${a}|${b}|${count}`;
  const hit = ellipseCache.get(key);
  if (hit) return hit;

  const t = Array.from({ length: count }, (_, i) => (2 * Math.PI * i) / count);
  const px = (u: number): number => a * Math.cos(u);
  const py = (u: number): number => b * Math.sin(u);
  const chord = (i: number): number => {
    const j = (i + 1) % count;
    return Math.hypot(px(t[i]!) - px(t[j]!), py(t[i]!) - py(t[j]!));
  };

  // Jacobi relaxation: move point i toward whichever neighbour it is farther
  // from, scaled by the fractional chord imbalance. The gain is small and the
  // pass count generous so it converges well under the 0.5% tolerance the test
  // pins, and stops (imbalance → 0 ⇒ no motion) rather than oscillating.
  const PASSES = 6000;
  const GAIN = 0.05;
  for (let pass = 0; pass < PASSES; pass++) {
    const c = t.map((_, i) => chord(i));
    const mean = c.reduce((s, x) => s + x, 0) / count;
    const next = t.slice();
    for (let i = 0; i < count; i++) {
      const cPrev = c[(i - 1 + count) % count]!;
      const cNext = c[i]!;
      // cNext > cPrev ⇒ point i is crowded against i-1: step it toward i+1
      // (increasing t), which grows the short chord and shrinks the long one.
      next[i] = t[i]! + (GAIN * (cNext - cPrev)) / mean;
    }
    for (let i = 0; i < count; i++) t[i] = next[i]!;
  }

  const frozen: readonly number[] = t.slice();
  ellipseCache.set(key, frozen);
  return frozen;
}

// ---------------------------------------------------------------------------
// The four ratified maps
// ---------------------------------------------------------------------------

/**
 * "The Ring" (DEFAULT). Square arena; the historical 8-planet ring. Planets sit
 * on one circle at exact `2π/count` steps, the ring sized to hug the spawn
 * margin (`PLANET.ringFraction`, clamped to the wall margin). Equality is by
 * construction — equal neighbour gaps, equal centre distance — which is why it
 * is the fair default. Reproduces `createWorld`'s original placement exactly
 * (planets on `planetRing`, ships on the inner `ringRadius`), so adopting the
 * registry changed no pixel of the shipped board.
 */
const octagon: MapDef = {
  id: 'octagon',
  name: 'The Ring',
  blurb: 'Eight planets, one circle, equal gaps — fair by construction.',
  bounds: SQUARE,
  planets(_seed, count, bounds) {
    const c = centre(bounds);
    const halfMin = Math.min(bounds.width, bounds.height) / 2;
    const ringRadius = halfMin * 2 * PLANET.ringFraction;
    const planetRing = Math.min(ringRadius + PLANET.orbitOffset, marginRadius(bounds));
    const out: PlanetPlacement[] = [];
    for (let i = 0; i < count; i++) {
      const theta = (2 * Math.PI * i) / Math.max(1, count);
      out.push({
        planet: { x: c.x + Math.cos(theta) * planetRing, y: c.y + Math.sin(theta) * planetRing },
        ship: { x: c.x + Math.cos(theta) * ringRadius, y: c.y + Math.sin(theta) * ringRadius },
        angle: theta,
      });
    }
    return out;
  },
};

/**
 * "The Compass". Square arena; planets at the 4 corners + 4 edge midpoints of an
 * inner square, so every adjacent step is exactly half a side — neighbour gaps
 * are equal *exactly*, not just to tolerance. The eight sit on the same 45°
 * spokes as the octagon but at two radii: corners hug the spawn margin, edge
 * midpoints sit a factor `1/√2` closer. Corner homes get wall cover, edge homes
 * get open routes.
 */
const compass: MapDef = {
  id: 'compass',
  name: 'The Compass',
  blurb: 'Corners for cover, edges for lanes — every gap the same.',
  bounds: SQUARE,
  planets(_seed, count, bounds) {
    // Inner square: corners at radius `rc` (hug the margin), so its side is
    // `rc·√2` and the edge midpoints sit at `rc/√2`. Adjacent corner↔edge steps
    // are then all exactly `rc/√2` = half the side.
    const rc = marginRadius(bounds);
    const re = rc / Math.SQRT2;
    const homes: { r: number; angle: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      // Even spokes (0°, 90°, …) are edge midpoints; odd (45°, …) are corners.
      homes.push({ r: i % 2 === 0 ? re : rc, angle });
    }
    // Derelict-fill (ratified): the compass is an eight-point construction (its
    // corner-cover / edge-lane character has no natural 2..7 truncation), so at
    // N<8 it keeps all eight positions and the `8-N` unused ones become unowned
    // wrecks rather than reshaping the board.
    return derelictFill(fromPolar(bounds, homes), count);
  },
};

/**
 * "The Oval". Wide arena; 8 points on an ellipse solved so all neighbour chords
 * are equal (`ellipseEqualChord`, iterative — no hardcoded approximation). The
 * ellipse is sized to hug the spawn margin on both axes, so it fills the wide
 * arena without touching the walls. Planets sit at varying centre distances (an
 * ellipse is not a circle), so their home fields are stamped congruently in each
 * planet's own frame (`spawnHomeFields`) — resources stay equal even though the
 * distances to the commons differ.
 */
const oval: MapDef = {
  id: 'oval',
  name: 'The Oval',
  blurb: 'A wide ellipse, eight equal strides around the rim.',
  bounds: WIDE,
  planets(_seed, count, bounds) {
    const a = bounds.width / 2 - WORLD_EDGE_MARGIN - PLANET.radius;
    const b = bounds.height / 2 - WORLD_EDGE_MARGIN - PLANET.radius;
    // Regenerate (ratified): the equal-chord solver is parametric, so the oval is
    // a true `count`-planet ellipse at any N — solve directly for `count` points
    // whose neighbour chords are all equal, not eight-then-slice (which would
    // cluster contiguous slots and break the equal-stride shape below eight).
    const ts = ellipseEqualChord(a, b, count);
    const homes = ts.map((t) => {
      const x = a * Math.cos(t);
      const y = b * Math.sin(t);
      return { r: Math.hypot(x, y), angle: Math.atan2(y, x) };
    });
    // Order by angle so slot 0..N-1 walk the rim — neighbours are adjacent slots.
    homes.sort((p, q) => norm(p.angle) - norm(q.angle));
    return fromPolar(bounds, homes);
  },
};

/**
 * "Double Diamond" (veteran). Wide arena; an outer diamond N/E/S/W hugging the
 * (short-side) margin plus an inner diamond offset 45° at roughly two-thirds
 * radius — sized so even the inner homes' neighbourhoods still clear their own
 * turret range. Deliberately asymmetric: the inner homes sit closer to the
 * commons and are exposed on all sides, the outer homes are farther out with a
 * wall at their back. Both diamonds are 4-fold symmetric; slots alternate
 * outer/inner (slot 0 outer, 1 inner, …), so the local player (slot 0) always
 * spawns on an outer home and the bots fill the rest alternating.
 *
 * The resource-fairness invariant still holds: home fields are stamped
 * congruently per planet, so every player's local ore is identical even though
 * their positions are not — the map is unfair in *ground*, never in *ore*.
 */
const diamond: MapDef = {
  id: 'diamond',
  name: 'Double Diamond',
  blurb: 'Outer wall-backs and exposed inner homes — for veterans.',
  bounds: WIDE,
  planets(_seed, count, bounds) {
    const rOut = marginRadius(bounds);
    // Inner ring at ~2/3 of the outer — pulled out from a literal half so the
    // inner homes' neighbourhood (stamped inboard) still clears turret range;
    // still comfortably closer to the commons than the outer ring.
    const rIn = rOut * 0.65;
    const homes: { r: number; angle: number }[] = [];
    for (let k = 0; k < 4; k++) {
      const cardinal = -Math.PI / 2 + (k * Math.PI) / 2; // N, E, S, W
      const diagonal = -Math.PI / 4 + (k * Math.PI) / 2; // NE, SE, SW, NW
      homes.push({ r: rOut, angle: cardinal }); // outer (even slots)
      homes.push({ r: rIn, angle: diagonal }); // inner (odd slots)
    }
    // Derelict-fill (ratified): the double diamond's whole character is its 4-fold
    // outer/inner asymmetry — an eight-point construction with no natural small-N
    // form — so at N<8 it keeps all eight positions and the unused ones become
    // wrecks. Actives still come first, so slot 0 remains an outer home at any N.
    return derelictFill(fromPolar(bounds, homes), count);
  },
};

/** Angle in `[0, 2π)`. */
function norm(a: number): number {
  const two = 2 * Math.PI;
  return ((a % two) + two) % two;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** The four ratified maps, `octagon` first (the default). */
export const MAPS: readonly MapDef[] = [octagon, compass, oval, diamond];

/** Look a map up by id, falling back to the default for an unknown id — boot
 *  must never crash on a stale saved map key. */
export function getMap(id: string = DEFAULT_MAP_ID): MapDef {
  return MAPS.find((m) => m.id === id) ?? octagon;
}
