/**
 * src/sim/maps.ts — the ratified map registry. OWNER: Gameplay Engineer.
 *
 * Six maps, `octagon` the default: the four radial boards ratified by the
 * developer off the layout board (map-layouts.html r1+r2), plus the two
 * **two-sided** boards of a0-12 (`line`, `crescents` — see "Two sides" below).
 * A map is a *layout*, nothing more: it owns the
 * arena bounds and where the `N` home stations sit, and hands those to
 * `createWorld` (`./state`). Everything downstream — the ships that orbit each
 * station, the fair home neighbourhoods stamped around them, the contested
 * central commons, collapse, win/loss — is the same code for every map
 * (`./waves`, `./match`). That is the whole point of the boundary: a new map is
 * geometry, not gameplay.
 *
 * Two invariants every map honours, so the registry can never smuggle in an
 * unfair or wall-hugging layout:
 *
 *  1. **Margin (field report P1).** Every station — and, downstream, every ship,
 *     asteroid, chunk and wreck stamped around it — clears the arena wall by
 *     `WORLD_EDGE_MARGIN`. Each layout sizes its outermost stations to hug that
 *     margin, so the arena reads as space with a steel frame, not a box the
 *     stations touch.
 *  2. **Resource fairness (p1-09 field rule v0.1.2).** The home neighbourhoods
 *     are stamped as one seeded canonical pattern rotated onto each station
 *     (`spawnHomeFields`), so every player's local ore is identical *by
 *     construction* — even on a deliberately asymmetric layout like `diamond`,
 *     where the stations are NOT congruent but their resources are. The commons
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
 * **Two sides (a0-12, 2026-08-08).** The four radial maps are FFA-shaped and
 * correct as such — equal spacing for any N, no wasted board, no near half and
 * no far half. `line` and `crescents` are the first maps with sides: four homes
 * in one cluster, four in the other, contested ground between them. The whole
 * construction is three rules, and they are stamped rather than tuned:
 *
 *  1. **One side is authored; the other is its point reflection** through the
 *     arena centre ({@link pointReflect}). Because `spawnHomeFields` stamps each
 *     neighbourhood by a *rotation*, a point reflection (rotation by π) carries
 *     the whole board — stations, ships, home fields, and the `N`-fold symmetric
 *     commons — onto itself exactly. Side equality is therefore not a tuning
 *     result but the same fact as "the stamp is a rotation."
 *  2. **Each side is symmetric about the axis between them**, so reflecting one
 *     side across the dividing midline lands on the other exactly too — the
 *     mirror a player actually sees. (Ore cannot be mirror-equal: the canonical
 *     rock pattern is chiral and a rotation stamp can never produce its mirror
 *     image. The exact statement about ORE is the point reflection of rule 1.
 *     `tests/sim/team-maps.test.ts` asserts both and says which is which.)
 *  3. **Live homes are ordered side-A-first, then side-B**, never alternating —
 *     see "Sides and slots" below.
 *
 * **Sides and slots — why the order is A,A,A,A,B,B,B,B.** The lobby alternates
 * teams by slot (`ui/lobby` `defaultTeamForSlot` = `index % 2`) but the sim does
 * NOT seat players on board positions in slot order: `createWorld`'s
 * `teamHomeSlots` regroups teammates onto *contiguous* live-home slots, so in a
 * 4v4 team 0 takes live homes 0..3 and team 1 takes 4..7. A map that put even
 * slots in one cluster and odd in the other would therefore hand each team two
 * homes on each side. The map's job is to make live homes `0..⌈N/2⌉-1` one side
 * and the rest the other ({@link twoSided}), and the shipped default lands as
 * four-versus-four with no change to the lobby, the transport, or the host's
 * ability to reassign sides by hand (GDD §2.1).
 *
 * **The outward angle on a two-sided board is the SIDE's axis, not the radius.**
 * `StationPlacement.angle` is what `spawnHomeFields` rotates a neighbourhood by,
 * so on `line` all four homes of a side declare the same outward angle and their
 * fields come out *parallel* — four neighbourhoods lying in front of a picket
 * line — instead of fanning inward and crowding each other's launch pockets. On
 * `line`'s column the radial reading puts a home's outermost rock **428.9 u**
 * from its neighbour against a **499.3 u** pocket floor — an illegal board; the
 * side-axis reading puts the same rock at **585.4 u**. Same fairness either way
 * (a rigid motion of one pattern is congruent whichever angle it uses), a legal
 * board only one way.
 *
 * Fully deterministic and RNG-free: station placement is pure geometry (the seed
 * threads through to the asteroid scatter in `./waves`, not to the layout), so
 * the same map builds the same board every time (GDD §4.8).
 */

import type { Vec2 } from '@shared/types';
import { STATION, WORLD_EDGE_MARGIN, WORLD_SIZE } from './constants';
import type { Bounds } from './state';

// ---------------------------------------------------------------------------
// The MapDef contract
// ---------------------------------------------------------------------------

/**
 * Where one player's home sits: the station centre, the ship's spawn point
 * (orbiting its station inboard, GDD §2.1), and the outward spoke angle the
 * turret mount ring starts from. `createWorld` reads exactly this per slot and
 * builds the rest.
 */
export interface StationPlacement {
  /** Station centre. */
  readonly station: Vec2;
  /** Ship spawn — inboard of the station, toward the field. */
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
   * ship + station for every non-derelict placement and a match-start wreck for
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
  stations(seed: number, count: number, bounds: Bounds): StationPlacement[];
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
 * placements, spawning each ship inboard of its station by `STATION.orbitOffset`
 * along the same spoke — the ship "orbiting its home station, between the station
 * and the field" (GDD §2.1). The layout-agnostic path every map but `octagon`
 * uses; `octagon` reproduces the historical ring math directly so the default
 * board is byte-for-byte what it always was.
 */
function fromPolar(bounds: Bounds, homes: readonly { r: number; angle: number }[]): StationPlacement[] {
  const c = centre(bounds);
  return homes.map(({ r, angle }) => {
    const shipR = Math.max(0, r - STATION.orbitOffset);
    return {
      station: { x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r },
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
function derelictFill(full: StationPlacement[], count: number): StationPlacement[] {
  const active = Math.max(0, Math.min(count, full.length));
  return full.map((p, i) => (i < active ? p : { ...p, derelict: true }));
}

/**
 * Farthest a station centre may sit from the arena centre **along one axis** and
 * still clear that wall by `WORLD_EDGE_MARGIN` — the rectangular form of
 * {@link marginRadius}, for the two-sided maps whose clusters are placed in x
 * and y rather than on a ring. Clamped at zero so a degenerate QA arena collapses
 * to the centre instead of going negative.
 */
function marginLimit(extent: number): number {
  return Math.max(0, extent / 2 - STATION.radius - WORLD_EDGE_MARGIN);
}

/**
 * One home, placed in cartesian coordinates with an outward `angle` that need
 * NOT be its radial direction — on a two-sided board the outward direction is
 * the side's own axis (see the file header). The ship spawns `STATION.orbitOffset`
 * *inboard* of the station along that same axis, which is the identical
 * "orbiting its station, between the station and the field" relationship
 * {@link fromPolar} gives a radial map (GDD §2.1).
 */
function facing(x: number, y: number, angle: number): StationPlacement {
  return {
    station: { x, y },
    ship: { x: x - Math.cos(angle) * STATION.orbitOffset, y: y - Math.sin(angle) * STATION.orbitOffset },
    angle,
  };
}

/**
 * A home's twin on the far side: the **point reflection** of `p` through the
 * arena centre. Station and ship centres are mirrored through the centre and the
 * outward angle turns by π, so the far side is the near side rotated by half a
 * turn.
 *
 * That specific isometry is chosen because `spawnHomeFields` stamps every
 * neighbourhood by a rotation: rotating the board by π maps each near home's
 * field exactly onto its twin's, and the commons — already `N`-fold symmetric
 * about the centre for every map — is invariant under it. So "the two sides are
 * equal" needs no tolerance and no tuning; it is the same fact as "the stamp is
 * a rotation" (`tests/sim/team-maps.test.ts` prints the residuals).
 */
function pointReflect(bounds: Bounds, p: StationPlacement): StationPlacement {
  const c = centre(bounds);
  const through = (v: Vec2): Vec2 => ({ x: 2 * c.x - v.x, y: 2 * c.y - v.y });
  return { station: through(p.station), ship: through(p.ship), angle: norm(p.angle + Math.PI) };
}

/**
 * Build a two-sided board from one side's homes: `near` is authored, the far
 * side is its point reflection ({@link pointReflect}), and the result is ordered
 * so the live homes split evenly across the two sides.
 *
 * The order is **side-A-first, then side-B**, never alternating, because
 * `createWorld`'s `teamHomeSlots` seats a team on *contiguous* live-home slots
 * (file header, "Sides and slots"). Live homes `0..⌈N/2⌉-1` are the near side and
 * the rest the far side, so:
 *
 *  - **even N** — the sides are equal and exact mirrors: 4v4 at eight, 3v3, 2v2,
 *    and a 1v1 duel straight across the middle at two;
 *  - **odd N** — the extra player joins the near side, giving the ⌈N/2⌉ v ⌊N/2⌋
 *    the lobby's `index % 2` produces on ANY map. A two-sided board does not
 *    invent that imbalance, it just makes it visible; these read as team maps.
 *
 * Everything else is derelict-fill, exactly as `compass`/`diamond` (ratified
 * 2026-07-26): a two-sided layout has no natural 2..7 form — halve it and it is
 * no longer two lines facing each other — so all eight positions are always laid
 * out and the `8-N` unused ones become unowned wrecks. Actives come first, so
 * slot 0 is always the near side's first home and its identity never moves.
 */
function twoSided(bounds: Bounds, near: readonly StationPlacement[], count: number): StationPlacement[] {
  const far = near.map((p) => pointReflect(bounds, p));
  const perSide = near.length;
  const live = Math.max(0, Math.min(count, perSide * 2));
  const liveNear = Math.ceil(live / 2);
  const liveFar = live - liveNear;
  const out: StationPlacement[] = [];
  for (let i = 0; i < liveNear; i++) out.push(near[i]!);
  for (let i = 0; i < liveFar; i++) out.push(far[i]!);
  for (let i = liveNear; i < perSide; i++) out.push({ ...near[i]!, derelict: true });
  for (let i = liveFar; i < perSide; i++) out.push({ ...far[i]!, derelict: true });
  return out;
}

/**
 * Largest station-centre radius that still clears the arena wall by
 * `WORLD_EDGE_MARGIN` on the tighter arena dimension — what a map's outermost
 * stations sit at to "hug the spawn margin." Uses `halfMin` so a wide arena's
 * outer ring is bounded by its short side, never poking through the top/bottom.
 */
function marginRadius(bounds: Bounds): number {
  const halfMin = Math.min(bounds.width, bounds.height) / 2;
  return halfMin - STATION.radius - WORLD_EDGE_MARGIN;
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
 * "The Ring" (DEFAULT). Square arena; the historical 8-station ring. Stations sit
 * on one circle at exact `2π/count` steps, the ring sized to hug the spawn
 * margin (`STATION.ringFraction`, clamped to the wall margin). Equality is by
 * construction — equal neighbour gaps, equal centre distance — which is why it
 * is the fair default. Reproduces `createWorld`'s original placement exactly
 * (stations on `stationRing`, ships on the inner `ringRadius`), so adopting the
 * registry changed no pixel of the shipped board.
 */
const octagon: MapDef = {
  id: 'octagon',
  name: 'The Ring',
  blurb: 'Eight stations, one circle, equal gaps — fair by construction.',
  bounds: SQUARE,
  stations(_seed, count, bounds) {
    const c = centre(bounds);
    const halfMin = Math.min(bounds.width, bounds.height) / 2;
    const ringRadius = halfMin * 2 * STATION.ringFraction;
    const stationRing = Math.min(ringRadius + STATION.orbitOffset, marginRadius(bounds));
    const out: StationPlacement[] = [];
    for (let i = 0; i < count; i++) {
      const theta = (2 * Math.PI * i) / Math.max(1, count);
      out.push({
        station: { x: c.x + Math.cos(theta) * stationRing, y: c.y + Math.sin(theta) * stationRing },
        ship: { x: c.x + Math.cos(theta) * ringRadius, y: c.y + Math.sin(theta) * ringRadius },
        angle: theta,
      });
    }
    return out;
  },
};

/**
 * "The Compass". Square arena; stations at the 4 corners + 4 edge midpoints of an
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
  stations(_seed, count, bounds) {
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
 * arena without touching the walls. Stations sit at varying centre distances (an
 * ellipse is not a circle), so their home fields are stamped congruently in each
 * station's own frame (`spawnHomeFields`) — resources stay equal even though the
 * distances to the commons differ.
 */
const oval: MapDef = {
  id: 'oval',
  name: 'The Oval',
  blurb: 'A wide ellipse, eight equal strides around the rim.',
  bounds: WIDE,
  stations(_seed, count, bounds) {
    const a = bounds.width / 2 - WORLD_EDGE_MARGIN - STATION.radius;
    const b = bounds.height / 2 - WORLD_EDGE_MARGIN - STATION.radius;
    // Regenerate (ratified): the equal-chord solver is parametric, so the oval is
    // a true `count`-station ellipse at any N — solve directly for `count` points
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
 * congruently per station, so every player's local ore is identical even though
 * their positions are not — the map is unfair in *ground*, never in *ore*.
 */
const diamond: MapDef = {
  id: 'diamond',
  name: 'Double Diamond',
  blurb: 'Outer wall-backs and exposed inner homes — for veterans.',
  bounds: WIDE,
  stations(_seed, count, bounds) {
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

// ---------------------------------------------------------------------------
// The two-sided maps (a0-12) — four homes a side, open ground between
// ---------------------------------------------------------------------------

/**
 * How far out along x each picket line of `line` stands, as a fraction of the
 * arena's x margin limit. 0.77 puts the two lines **2027 u apart** — four times
 * the commons's own width (512 u) and the largest empty span on any board — so
 * the corridor between them reads as the thing the map is about.
 */
const LINE_STANDOFF = 0.77;
/** Half-length of a picket line, as a fraction of the arena's y margin limit.
 *  0.78, not 1.0: a home's neighbourhood is stamped in FRONT of it with a lateral
 *  spread of `homeConeOuter`, and the outermost home's outermost rock has to clear
 *  the wall margin on its own — at 0.78 it clears by 32 u, at 0.87 it would be
 *  clamped and the two sides would stop being exact mirrors. */
const LINE_HALF_LENGTH = 0.78;

/**
 * "The Line". Wide arena; **four homes abreast facing four homes abreast** across
 * a corridor of open ground four times as wide as the commons is across. Each side
 * is a straight picket line of four evenly spaced homes, and the far side is the
 * near side turned half a turn (the file header's rule 1), so the two lines are
 * exact mirrors of each other about the arena's vertical midline.
 *
 * Its character is the corridor. Nothing on this board is ambiguous about which
 * half it is in: there is no wrap-around, no flank that leads behind the enemy
 * without crossing the middle, and the commons sits alone in a 2027 u gap with
 * nothing else in it — the nearest enemy home is **5.4×** farther than the nearest
 * ally (2027 u against 372 u), the widest such gap in the set. The four homes of a
 * side are close enough (`marginLimit(height) × 0.52` apart) that their turret
 * envelopes overlap, so a line genuinely covers itself — the first board in the set
 * where standing next to your team-mate is worth something.
 *
 * Every home on a side declares the SAME outward angle (the side's axis, ±x), so
 * the four neighbourhoods are parallel translations of one pattern rather than a
 * fan converging on the arena centre. That is what keeps the launch pockets clear
 * on a column; see the file header.
 */
const line: MapDef = {
  id: 'line',
  name: 'The Line',
  blurb: 'Four abreast facing four, across a corridor of open ground.',
  bounds: WIDE,
  stations(_seed, count, bounds) {
    const c = centre(bounds);
    const x = marginLimit(bounds.width) * LINE_STANDOFF;
    const half = marginLimit(bounds.height) * LINE_HALF_LENGTH;
    // Four evenly spaced homes: ±half and ±half/3. Authored as two mirror PAIRS
    // about the dividing midline, inner pair first — so the live set stays
    // symmetric about that midline at every even N (a 2v2 is the inner four,
    // head on) and slot 0 is always the near line's inner-upper home.
    const near = [half / 3, -half / 3, half, -half].map((dy) =>
      facing(c.x - x, c.y + dy, Math.PI),
    );
    return twoSided(bounds, near, count);
  },
};

/** Half-angle of the inner pair of each crescent, radians. With
 *  {@link CRESCENT_OUTER} at three times this the four homes of a side sit at
 *  equal 2×{@link CRESCENT_INNER} steps along the rim — the octagon's equal-gap
 *  virtue, applied inside a side instead of around the whole board. */
const CRESCENT_INNER = (16 * Math.PI) / 180;
/** Half-angle of the outer pair of each crescent, radians. Three times the inner,
 *  which leaves 84° of empty rim above and below the two crescents against 32°
 *  between team-mates, and keeps every home a full 613 u clear of the dividing
 *  axis: nearest ally 505 u, nearest enemy 1226 u. Past 45° the crescents' tips
 *  would come closer to each other than to their own far end and the two halves
 *  would stop reading as halves — which is what sets the ceiling here, not taste. */
const CRESCENT_OUTER = 3 * CRESCENT_INNER;

/**
 * "The Crescents". Square arena; **two arcs of four facing each other across the
 * bowl.** Every home sits on one circle hugging the spawn margin, so this is the
 * only two-sided board where all eight are exactly equidistant from the contested
 * middle — the commons is reached by the same run from any home, and the sides
 * are equal in ground as well as in ore.
 *
 * Its character is the bowl and the shoulder. A crescent's four homes stand 32°
 * apart with 84° of empty rim beyond each end, so a side is a wall you stand
 * inside: your team-mate is always the nearest station to you (505 u) and the
 * nearest enemy is **2.4×** farther (1226 u), with a 1226 u corridor down the
 * middle holding no station at all. Flanking means going the long way round an
 * open rim in full view, or going straight through the middle.
 *
 * Because all eight radii are equal, `spawnHomeFields` takes its single-ring
 * path — the identical arena-frame rotation stamp the default `octagon` uses —
 * so the fairness argument here is the shortest one in the file: the eight
 * neighbourhoods are eight rotations of one pattern about one centre.
 */
const crescents: MapDef = {
  id: 'crescents',
  name: 'The Crescents',
  blurb: 'Two arcs of four across the bowl — shoulder to shoulder, or the long way round.',
  bounds: SQUARE,
  stations(_seed, count, bounds) {
    const r = marginRadius(bounds);
    // The near crescent, centred on due west. Inner pair first (the two homes
    // facing most directly across the bowl), so a 2v2 is head-on and slot 0 is
    // always the near crescent's upper-inner home.
    const near = [-CRESCENT_INNER, CRESCENT_INNER, -CRESCENT_OUTER, CRESCENT_OUTER].map((d) =>
      fromPolar(bounds, [{ r, angle: Math.PI + d }])[0]!,
    );
    return twoSided(bounds, near, count);
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

/** The ratified maps, `octagon` first (the default): the four radial FFA boards,
 *  then the two two-sided team boards (a0-12). */
export const MAPS: readonly MapDef[] = [octagon, compass, oval, diamond, line, crescents];

/** The two-sided boards — four homes a side, contested ground between them. A
 *  named set rather than a flag on `MapDef`, because "has sides" is a fact about
 *  these two layouts that the picker and the team tests want to ask about, not a
 *  new field every future map has to answer. */
export const TEAM_MAP_IDS: readonly string[] = [line.id, crescents.id];

/** Look a map up by id, falling back to the default for an unknown id — boot
 *  must never crash on a stale saved map key. */
export function getMap(id: string = DEFAULT_MAP_ID): MapDef {
  return MAPS.find((m) => m.id === id) ?? octagon;
}
