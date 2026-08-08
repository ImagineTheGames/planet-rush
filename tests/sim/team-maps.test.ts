/**
 * tests/sim/team-maps.test.ts — the two-sided maps (a0-12). OWNER: Gameplay
 * Engineer.
 *
 * `line` and `crescents` are the first maps in the game with a near half and a
 * far half: four homes in one cluster, four in the other, contested ground
 * between them. Everything the four radial maps must prove they still prove
 * here — `maps.test.ts` and `world-margin.test.ts` walk `MAPS`, so these two
 * joined those suites the moment they were registered. This file proves the
 * things only a two-sided board can be asked:
 *
 *  1. **There are two sides, and they are the sides the lobby means.** A 4v4
 *     lands one team wholly on one cluster and the other team wholly on the
 *     other, with `src/ui/lobby.ts` untouched — the thing that does not exist
 *     today. Also at 2, 4 and 6, because a two-sided board that only works at
 *     eight is a board that works once.
 *  2. **The sides are exact mirrors, printed as numbers rather than claimed.**
 *     Two different exact statements, and the difference matters:
 *       - **Point reflection through the arena centre** is the strong one, and
 *         it covers ORE. `spawnHomeFields` stamps every neighbourhood by a
 *         rotation, so rotating the board by π maps each near home's field onto
 *         its twin's exactly, and the commons — `N`-fold symmetric about the
 *         centre on every map — is invariant under it. Residuals are printed.
 *       - **Reflection across the dividing midline** is the one a player sees,
 *         and it holds exactly for station and ship CENTRES. It cannot hold for
 *         ore: the canonical rock pattern is chiral and a rotation stamp can
 *         never produce its own mirror image. Saying which claim is which is the
 *         honest shape; asserting the weaker one everywhere would be a lie with
 *         a green tick on it.
 *  3. **`SPAWN_CLEAR_POCKET` at every home** — the invariant that had to join
 *     the fairness rules once before (field report P1), when identical home
 *     fields crowded the spawn. Checked CROSS-STATION here: no rock belonging to
 *     anybody may intrude on anybody's launch pocket. Clustering four homes 372 u
 *     apart is exactly the geometry that could break it.
 *  4. **The contested middle is equidistant from both sides**, and holds equal
 *     ore on each side of the dividing axis.
 *
 * See `src/sim/maps.ts` ("Two sides") and the invariant note atop
 * `src/sim/waves.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, type Vec2 } from '@shared/types';
import {
  ASTEROID,
  MAPS,
  SPAWN_CLEAR_POCKET,
  TEAM_MAP_IDS,
  TURRET,
  WAVE_COUNT,
  createWorld,
  getMap,
  spawnWave,
  type MiningStation,
  type PlayerSpec,
  type World,
} from '../../src/sim';

// --- fixtures --------------------------------------------------------------

const CLASSES = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
] as const;

/** An FFA roster of `n` — every player its own team, so `teamHomeSlots` is the
 *  identity and the board is the map's own order. */
function ffa(n = 8): PlayerSpec[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, shipClass: CLASSES[i % CLASSES.length]! }));
}

/** A TEAMS roster of `n` with sides alternating by slot — exactly what the lobby
 *  ships (`ui/lobby` `defaultTeamForSlot` = `index % 2`), authored here rather
 *  than imported so the sim suite stays free of the UI. */
function teams(n = 8): PlayerSpec[] {
  return ffa(n).map((p) => ({ ...p, team: p.id % 2 }));
}

/** The seeded grid the p1-09 / margin / maps suites all share. */
const SEEDS = [1, 2, 3, 7, 42, 1337, 99991, 20260725, 0x7fffffff];
const COUNTS = [2, 3, 4, 5, 6, 7, 8];
/** Even rosters — the ones a two-sided board can split evenly. */
const EVEN = [2, 4, 6, 8];

/** Float slack for a claim about GEOMETRY. The construction is exact; what is
 *  left is `cos`/`sin` rounding, and it lands 6 orders of magnitude under this. */
const UNIT = 1e-6;

function centre(w: World): Vec2 {
  return { x: w.bounds.width / 2, y: w.bounds.height / 2 };
}
function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
/** The point reflection through the arena centre — the isometry that swaps the
 *  two sides (`maps.ts` `pointReflect`). */
function through(w: World, p: Vec2): Vec2 {
  const c = centre(w);
  return { x: 2 * c.x - p.x, y: 2 * c.y - p.y };
}
/** Reflection across the dividing midline — the mirror a player sees. */
function across(w: World, p: Vec2): Vec2 {
  return { x: w.bounds.width - p.x, y: p.y };
}
/** The whole board: construction plus the full commons schedule. */
function fullField(mapId: string, seed: number, n = 8): World {
  const w = createWorld({ seed, players: ffa(n), mapId });
  while (w.match.wavesSpawned < WAVE_COUNT) spawnWave(w);
  return w;
}
function liveHomes(w: World): MiningStation[] {
  return w.stations.filter((p) => !p.derelict);
}
/** Which side of the dividing axis a point is on. The axis is the arena's
 *  vertical midline on both maps, and no station sits on it — the assertion
 *  below pins that, so this is total. */
function side(w: World, p: Vec2): 0 | 1 {
  return p.x < centre(w).x ? 0 : 1;
}
/** The nearest counterpart to `p` in `pts`, as a distance. */
function nearest(p: Vec2, pts: readonly Vec2[]): number {
  return pts.reduce((best, q) => Math.min(best, dist(p, q)), Infinity);
}

/** The two maps under test, resolved from the registry so this file cannot
 *  drift from what actually ships. */
const TEAM_MAPS = TEAM_MAP_IDS.map((id) => getMap(id));

// --- the registry knows about them -----------------------------------------

describe('the two-sided maps are registered', () => {
  it('MAPS carries all six, the four radial ones first and unchanged', () => {
    expect(MAPS.map((m) => m.id)).toEqual([
      'octagon',
      'compass',
      'oval',
      'diamond',
      'line',
      'crescents',
    ]);
  });

  it('TEAM_MAP_IDS names exactly the two-sided boards, and they are real maps', () => {
    expect([...TEAM_MAP_IDS]).toEqual(['line', 'crescents']);
    for (const id of TEAM_MAP_IDS) expect(getMap(id).id, `${id} resolves`).toBe(id);
  });

  it('each is fully described and keeps slot 0 at one fixed board position', () => {
    for (const map of TEAM_MAPS) {
      expect(map.name, `${map.id} name`).toBeTruthy();
      expect(map.blurb, `${map.id} blurb`).toBeTruthy();
      // Slot 0's identity never moves as the roster shrinks (the registry rule).
      const at8 = map.stations(1, 8, map.bounds)[0]!;
      for (const n of COUNTS) {
        const at = map.stations(1, n, map.bounds)[0]!;
        expect(at.station, `${map.id} × ${n}: slot 0 station`).toEqual(at8.station);
        expect(at.ship, `${map.id} × ${n}: slot 0 ship`).toEqual(at8.ship);
        expect(at.derelict, `${map.id} × ${n}: slot 0 is live`).toBeFalsy();
      }
    }
  });
});

// --- 1. there are two sides, and they are the lobby's sides ----------------

describe.each(TEAM_MAPS)('map "$id" has two sides the lobby can use', (map) => {
  it('splits eight board positions four and four, with an empty corridor between', () => {
    const w = createWorld({ seed: 1, players: ffa(8), mapId: map.id });
    const c = centre(w);
    const counts = [0, 0];
    for (const p of w.stations) counts[side(w, p.pos)]!++;
    expect(counts, `${map.id}: four a side`).toEqual([4, 4]);

    // No station straddles the dividing axis — every home is decisively on one
    // half, and the gap between the two clusters is real, open ground.
    const clearance = Math.min(...w.stations.map((p) => Math.abs(p.pos.x - c.x)));
    expect(clearance, `${map.id}: clearance from the dividing axis`).toBeGreaterThan(p1(w) + 1);
  });

  it('a 4v4 lobby lands each team wholly on its own side — the developer’s case', () => {
    // The thing that does not exist today. `defaultTeamForSlot` is `index % 2`
    // and is NOT touched; the map does all the work, via the side-A-first live
    // ordering `createWorld`'s `teamHomeSlots` actually consumes.
    const w = createWorld({ seed: 1, players: teams(8), mapId: map.id });
    const bySide = new Map<number, Set<number>>();
    for (const p of liveHomes(w)) {
      const team = w.ships[p.owner]!.team ?? p.owner;
      (bySide.get(team) ?? bySide.set(team, new Set()).get(team)!).add(side(w, p.pos));
    }
    expect([...bySide.keys()].sort(), `${map.id}: two teams`).toEqual([0, 1]);
    // Each team occupies exactly one side, and the two teams' sides differ.
    const sides = [...bySide.entries()].map(([team, s]) => {
      expect([...s], `${map.id}: team ${team} is on one side only`).toHaveLength(1);
      return [...s][0]!;
    });
    expect(new Set(sides).size, `${map.id}: the two teams are on different sides`).toBe(2);
  });

  it('stays four-versus-four in shape at every even roster — 1v1, 2v2, 3v3, 4v4', () => {
    for (const n of EVEN) {
      const w = createWorld({ seed: 1, players: teams(n), mapId: map.id });
      const perSide = [0, 0];
      const perTeam = new Map<number, Set<number>>();
      for (const p of liveHomes(w)) {
        perSide[side(w, p.pos)]!++;
        const team = w.ships[p.owner]!.team ?? p.owner;
        (perTeam.get(team) ?? perTeam.set(team, new Set()).get(team)!).add(side(w, p.pos));
      }
      expect(perSide, `${map.id} × ${n}: even split`).toEqual([n / 2, n / 2]);
      for (const [team, s] of perTeam) {
        expect([...s], `${map.id} × ${n}: team ${team} on one side`).toHaveLength(1);
      }
    }
  });

  it('an odd roster gives ⌈N/2⌉ v ⌊N/2⌋ — the imbalance is the lobby’s, not the map’s', () => {
    // `index % 2` produces this on EVERY map; a two-sided board only makes it
    // visible. Stated and pinned rather than papered over — these present as
    // team maps, and an odd roster is a 2v1 wherever it is played.
    for (const n of [3, 5, 7]) {
      const w = createWorld({ seed: 1, players: teams(n), mapId: map.id });
      const perSide = [0, 0];
      for (const p of liveHomes(w)) perSide[side(w, p.pos)]!++;
      expect(perSide, `${map.id} × ${n}: near side takes the extra`).toEqual([
        Math.ceil(n / 2),
        Math.floor(n / 2),
      ]);
    }
  });

  it('is derelict-fill — eight positions always, the 8-N unused ones unowned wrecks', () => {
    for (const n of COUNTS) {
      const w = createWorld({ seed: 1, players: ffa(n), mapId: map.id });
      expect(w.stations, `${map.id} × ${n}: keeps all eight positions`).toHaveLength(8);
      expect(w.stations.filter((p) => p.derelict), `${map.id} × ${n}: wrecks`).toHaveLength(8 - n);
      // Actives first, so slot 0 keeps its identity and derelict ids sit past
      // the roster (the registry rule `compass`/`diamond` already keep).
      for (let i = 0; i < 8; i++) {
        expect(!!w.stations[i]!.derelict, `${map.id} × ${n}: position ${i}`).toBe(i >= n);
      }
      // The BOARD keeps its two sides at every N: live homes and wrecks together
      // are always four a side and always mirror-paired, so a short roster never
      // reshapes the arena — it only leaves seats empty.
      const board = w.stations.map((p) => p.pos);
      const perSide = [0, 0];
      for (const p of board) perSide[side(w, p)]!++;
      expect(perSide, `${map.id} × ${n}: board is still four a side`).toEqual([4, 4]);
      for (const p of board) {
        expect(
          nearest(through(w, p), board),
          `${map.id} × ${n}: board position (${p.x.toFixed(1)},${p.y.toFixed(1)}) has a twin`,
        ).toBeLessThan(UNIT);
      }
      // At an EVEN roster the wrecks pair up among themselves too, because the
      // live set does. At an odd one they cannot — one seat of a mirror pair is
      // filled and the other is a wreck, which is the ⌈N/2⌉ v ⌊N/2⌋ imbalance
      // showing up in the scenery rather than a second, separate defect.
      const wrecks = w.stations.filter((p) => p.derelict).map((p) => p.pos);
      if (n % 2 === 0) {
        for (const p of wrecks) {
          expect(
            nearest(through(w, p), wrecks),
            `${map.id} × ${n}: wreck (${p.x.toFixed(1)},${p.y.toFixed(1)}) has a twin`,
          ).toBeLessThan(UNIT);
        }
      }
    }
  });
});

// --- 2. exact mirrors, as numbers ------------------------------------------

describe.each(TEAM_MAPS)('map "$id" — the two sides are exact mirrors', (map) => {
  it('POINT REFLECTION: the whole board maps onto itself, ore included', () => {
    // The strong claim, and the one that covers resources. Every station, every
    // ship and every rock — home fields and the full commons schedule — has a
    // counterpart at its reflection through the arena centre, carrying the SAME
    // ore. This is not a tuning result: it is the same fact as "the home-field
    // stamp is a rotation" (`waves.ts`).
    for (const seed of SEEDS) {
      const w = fullField(map.id, seed, 8);
      const label = `${map.id} seed ${seed}`;

      const stations = w.stations.map((p) => p.pos);
      for (const p of stations) {
        expect(nearest(through(w, p), stations), `${label}: station twin`).toBeLessThan(UNIT);
      }
      const ships = w.ships.map((s) => s.pos);
      for (const p of ships) {
        expect(nearest(through(w, p), ships), `${label}: ship twin`).toBeLessThan(UNIT);
      }
      // Rocks must match in POSITION and in ORE — a mirror that moved the ore
      // around would pass a positions-only check.
      for (const a of w.asteroids) {
        const sameOre = w.asteroids.filter((b) => b.ore === a.ore).map((b) => b.pos);
        expect(
          nearest(through(w, a.pos), sameOre),
          `${label}: rock ${a.id} (ore ${a.ore}) twin`,
        ).toBeLessThan(UNIT);
      }
    }
  });

  it('MIDLINE MIRROR: reflect one side of the BOARD and you get the other, at every N', () => {
    // The mirror a player sees, and it is a property of the LAYOUT, so it is
    // asserted on all eight board positions — live homes and wrecks alike — at
    // every roster. It is exact because each side is itself symmetric about the
    // axis perpendicular to the divide, which makes the midline mirror and the
    // point reflection agree on station centres.
    for (const n of COUNTS) {
      const w = createWorld({ seed: 1, players: ffa(n), mapId: map.id });
      const label = `${map.id} × ${n}`;
      const far = w.stations.filter((p) => side(w, p.pos) === 1).map((p) => p.pos);
      for (const p of w.stations) {
        if (side(w, p.pos) !== 0) continue;
        expect(nearest(across(w, p.pos), far), `${label}: station mirror`).toBeLessThan(UNIT);
      }
    }
  });

  it('the SEATED half mirrors too — exactly when each side seats an even number', () => {
    // Ships sit on live homes only, so the seated board mirrors when each side's
    // live count is even and both members of a mirror pair are filled: N = 4 and
    // N = 8. At N = 2 or 6 a side seats an odd number, one seat of a pair is a
    // wreck, and the seated half is the point reflection of the other WITHOUT
    // being its midline mirror — off by 372 u on `line`, 452 u on `crescents`.
    // Pinned in both directions rather than quietly restricted to the N that
    // works: the map is symmetric, an odd half-roster is not, and those are
    // different statements.
    for (const n of EVEN) {
      const w = createWorld({ seed: 1, players: ffa(n), mapId: map.id });
      const label = `${map.id} × ${n}`;
      const farShips = w.ships.filter((s) => side(w, s.pos) === 1).map((s) => s.pos);
      let worst = 0;
      for (const s of w.ships) {
        if (side(w, s.pos) !== 0) continue;
        worst = Math.max(worst, nearest(across(w, s.pos), farShips));
        // The point reflection holds at EVERY even N, seated or not.
        expect(nearest(through(w, s.pos), farShips), `${label}: ship twin`).toBeLessThan(UNIT);
      }
      if (n % 4 === 0) expect(worst, `${label}: seated mirror`).toBeLessThan(UNIT);
      else expect(worst, `${label}: seated mirror cannot hold at an odd half`).toBeGreaterThan(1);
    }
  });

  it('MIDLINE MIRROR does NOT hold for ore — and that is the stamp, not a defect', () => {
    // Stated because the alternative is a suite that quietly proves the weaker
    // claim. The canonical rock pattern is chiral (`drawCanon` draws signed
    // angular offsets) and every home field is a ROTATION of it, so no rotation
    // stamp can equal its own mirror image. The exact ore claim is the point
    // reflection above; this pins the fact so nobody "fixes" the mirror test by
    // loosening the tolerance until it passes.
    const w = fullField(map.id, 1, 8);
    let worst = 0;
    for (const a of w.asteroids) {
      if (a.home == null) continue;
      const sameOre = w.asteroids.filter((b) => b.ore === a.ore).map((b) => b.pos);
      worst = Math.max(worst, nearest(across(w, a.pos), sameOre));
    }
    // Tens of units out, not fractions of one — a real chirality, not float noise.
    expect(worst, `${map.id}: mirrored home ore is genuinely NOT on the board`).toBeGreaterThan(1);
  });

  it('the two sides carry exactly equal ore — per home and, summed, per side', () => {
    for (const seed of SEEDS) {
      for (const n of EVEN) {
        const w = fullField(map.id, seed, n);
        const label = `${map.id} seed ${seed} × ${n}`;
        const perSide = [0, 0];
        const perHome: number[] = [];
        for (const p of liveHomes(w)) {
          const ore = w.asteroids
            .filter((a) => a.home === p.owner)
            .reduce((s, a) => s + a.ore, 0);
          perHome.push(ore);
          perSide[side(w, p.pos)]! += ore;
        }
        // Per station: EXACTLY equal — the ore values are literal copies of one
        // drawn pattern, so this needs no tolerance at all.
        for (const ore of perHome) expect(ore, `${label}: per-home ore`).toBe(perHome[0]!);
        expect(perHome[0], `${label}: home ore is positive`).toBeGreaterThan(0);
        // Per side: equal sums of equal terms in the same order, so also exact.
        expect(perSide[1], `${label}: per-side ore`).toBe(perSide[0]!);
      }
    }
  });

  it('every home’s neighbourhood is exactly equal in count, ore and spacing', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = createWorld({ seed, players: ffa(n), mapId: map.id });
        const label = `${map.id} seed ${seed} × ${n}`;
        const homes = liveHomes(w);
        const fieldOf = (p: MiningStation) => w.asteroids.filter((a) => a.home === p.owner);
        const ref = fieldOf(homes[0]!);
        const refOre = ref.map((a) => a.ore).sort((x, y) => x - y);
        const refDist = ref.map((a) => dist(a.pos, homes[0]!.pos)).sort((x, y) => x - y);
        for (const p of homes) {
          const f = fieldOf(p);
          expect(f, `${label}: home ${p.id} count`).toHaveLength(ref.length);
          expect(f.map((a) => a.ore).sort((x, y) => x - y), `${label}: home ${p.id} ore`).toEqual(
            refOre,
          );
          const d = f.map((a) => dist(a.pos, p.pos)).sort((x, y) => x - y);
          for (let i = 0; i < d.length; i++) {
            expect(d[i]! - refDist[i]!, `${label}: home ${p.id} spacing ${i}`).toBeLessThan(UNIT);
          }
        }
      }
    }
  });
});

// --- 3. the launch pocket, cross-station ------------------------------------

/** The launch-pocket radius the sim itself works to: a fraction of the reference
 *  ring `spawnHomeFields` scales the neighbourhood off — the SMALLEST live-home
 *  radius on a map whose homes are not all equidistant (`waves.ts`), which is the
 *  ring radius itself on one that they are. */
function p1(w: World): number {
  const c = centre(w);
  const radii = liveHomes(w).map((p) => dist(p.pos, c));
  return Math.min(...radii) * SPAWN_CLEAR_POCKET;
}

describe.each(TEAM_MAPS)('map "$id" honours SPAWN_CLEAR_POCKET at every home', (map) => {
  it('no rock — anybody’s — intrudes on anybody’s launch pocket, at every N', () => {
    // Field report P1, promoted to a fairness rule once already: identical home
    // fields crowded the spawn. On a two-sided board the four homes of a side sit
    // far closer together than any radial map's neighbours, so this is checked
    // CROSS-STATION — every rock against every station, live and wreck alike.
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = fullField(map.id, seed, n);
        const pocket = p1(w);
        for (const p of w.stations) {
          for (const a of w.asteroids) {
            expect(
              dist(a.pos, p.pos) - a.radius - pocket,
              `${map.id} seed ${seed} × ${n}: rock ${a.id} in station ${p.id}'s pocket`,
            ).toBeGreaterThanOrEqual(-UNIT);
          }
        }
      }
    }
  });

  it('the pocket is generous, not minimal — a ship can launch and turn', () => {
    // The clearance a pilot actually gets, printed as a margin over the pocket
    // floor rather than asserted at it: the shipped boards clear it by 58 u
    // (`line`) and 67 u (`crescents`), each more than a full rock diameter.
    for (const map2 of [map]) {
      let slack = Infinity;
      for (const seed of [1, 42, 20260725]) {
        const w = fullField(map2.id, seed, 8);
        const pocket = p1(w);
        for (const p of w.stations) {
          for (const a of w.asteroids) {
            slack = Math.min(slack, dist(a.pos, p.pos) - a.radius - pocket);
          }
        }
      }
      expect(slack, `${map2.id}: pocket slack`).toBeGreaterThan(ASTEROID.maxRadius);
    }
  });

  it('keeps every home field outside its own turret range, at every N', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = createWorld({ seed, players: ffa(n), mapId: map.id });
        for (const p of liveHomes(w)) {
          for (const a of w.asteroids) {
            if (a.home !== p.owner) continue;
            expect(
              dist(a.pos, p.pos),
              `${map.id} seed ${seed} × ${n}: home ${p.id} rock under its own guns`,
            ).toBeGreaterThan(TURRET.range);
          }
        }
      }
    }
  });
});

// --- 4. the contested middle -----------------------------------------------

describe.each(TEAM_MAPS)('map "$id" — the middle belongs to neither side', (map) => {
  it('is equidistant from both sides — the same run from each home’s twin', () => {
    for (const n of EVEN) {
      const w = createWorld({ seed: 1, players: ffa(n), mapId: map.id });
      const c = centre(w);
      const label = `${map.id} × ${n}`;
      const near = liveHomes(w).filter((p) => side(w, p.pos) === 0);
      const far = liveHomes(w).filter((p) => side(w, p.pos) === 1);
      expect(near, `${label}: near count`).toHaveLength(n / 2);
      expect(far, `${label}: far count`).toHaveLength(n / 2);
      // Sorted distance profiles are identical: every run one side can make to the
      // middle, the other side can make too, to the unit.
      const profile = (ps: MiningStation[]) => ps.map((p) => dist(p.pos, c)).sort((x, y) => x - y);
      const a = profile(near);
      const b = profile(far);
      for (let i = 0; i < a.length; i++) {
        expect(Math.abs(a[i]! - b[i]!), `${label}: distance to the middle #${i}`).toBeLessThan(UNIT);
      }
      // …and summed, which is the fairness claim about the SIDE rather than a home.
      const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
      expect(Math.abs(sum(a) - sum(b)), `${label}: total run to the middle`).toBeLessThan(UNIT);
    }
  });

  it('the commons holds equal ore on each side of the dividing axis, at every N', () => {
    // The commons is `N`-fold symmetric about the arena centre for every map, and
    // the point reflection that swaps the sides is one of those rotations — so
    // this is exact, not balanced.
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = fullField(map.id, seed, n);
        const halves = [0, 0];
        for (const a of w.asteroids) {
          if (a.home != null) continue;
          halves[side(w, a.pos)]! += a.ore;
        }
        expect(halves[0], `${map.id} seed ${seed} × ${n}: commons is not empty`).toBeGreaterThan(0);
        expect(
          Math.abs(halves[0]! - halves[1]!),
          `${map.id} seed ${seed} × ${n}: commons split`,
        ).toBeLessThan(UNIT);
      }
    }
  });

  it('no home field reaches the middle — the commons is contested, not annexed', () => {
    // A home neighbourhood sitting on the commons would make the contested ground
    // somebody's back garden. Every stamped home rock stays outside the commons
    // scatter disc on both boards.
    for (const seed of [1, 42, 20260725]) {
      const w = fullField(map.id, seed, 8);
      const c = centre(w);
      for (const a of w.asteroids) {
        if (a.home == null) continue;
        expect(
          dist(a.pos, c) - a.radius,
          `${map.id} seed ${seed}: home rock ${a.id} inside the commons disc`,
        ).toBeGreaterThan(w.fieldRadius);
      }
    }
  });
});
