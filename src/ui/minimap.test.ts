/**
 * Minimap tests (GDD §2.2; field request v0.2.2). The load-bearing contracts:
 *
 *  - **The fit** (map → minimap rect) preserves aspect and centres — the arena
 *    letterboxes into the corner square or the overlay, so a dot's screen place
 *    is right at either scale (./minimap `fitBounds` / `mapPoint`).
 *  - **Placement** — the collapsed square sits inside the `bottom-right` layout
 *    band and the expanded overlay inside `full`+margin, asserted against the
 *    registry's OWN resolver on both phone profiles, so "it appears where it's
 *    supposed to" is a test, not a hope (field request rule 3).
 *  - **The scene** — stations are owner-coloured (a wreck neutral), the local
 *    ship is highlighted and separated from the enemy dots, a spawn-protected
 *    ship dims, a dead ship drops off, ore hints are faint signal-yellow, and the
 *    collapse ring scales with the fit.
 *  - **Shape carries KIND, colour carries OWNER** (a0-88) — a ship, a station, a
 *    satellite and a rock are four different marks, and the assertions are made on
 *    the OUTLINE (a vertex count, which does not move when the radius does) rather
 *    than on size, because size is exactly the channel that failed the developer
 *    on a phone. Colour is asserted unchanged, mark for mark.
 *  - **The coverage rings are ONE region** (a0-88) — the union of the sensor discs,
 *    so touching discs read as a single lit silhouette instead of stacked circles
 *    that each look like an ornament around whatever they are centred on.
 *  - **The toggle is one code path for click and tap** — the input-parity
 *    contract this element signs (docs/input-parity.md): a click (PC) and a tap
 *    (mobile) both reach {@link Minimap.tap} and both flip the state, and the PC
 *    shortcut is `M` ({@link MINIMAP_TOGGLE_KEY}).
 *  - **The EXPANDED overlay is modal, the COLLAPSED corner is not** (u6-01) — a
 *    press outside the open overlay dismisses it *and is consumed*, so it never
 *    also flies the ship; a press that misses the corner square still falls
 *    through, because the player is flying. The asymmetry is asserted through the
 *    same boolean seam `main.ts:1503` gates gameplay on, on pointer AND touch.
 */
import { describe, it, expect } from 'vitest';
import { PALETTE } from '@render/index';
import { resolveAnchor, rectContains } from '@platform/layout-registry';
import type { AnchorSpec } from '@platform/layout-registry';
import { playerColor } from './station-hp';
import {
  Minimap,
  collapsedRect,
  expandedRect,
  fitBounds,
  mapPoint,
  markPolygon,
  minimapRect,
  minimapScene,
  pointInRect,
  sensedRegions,
  MINIMAP_TOGGLE_KEY,
  MINIMAP_MARGIN,
  MINIMAP_COLLAPSED_TOUCH,
  MINIMAP_COLLAPSED_DESKTOP,
  MINIMAP_FIRE_COLUMN,
  MINIMAP_STRIP_CLEARANCE,
  MINIMAP_DOT_ALPHA,
  MINIMAP_DERELICT_ALPHA,
  MINIMAP_SPAWN_PROTECT_ALPHA,
  MINIMAP_ORE_ALPHA,
  MINIMAP_REMEMBERED_ALPHA,
  MINIMAP_REMEMBERED_ORE_ALPHA,
} from './minimap';
import type { MinimapDot, MinimapFrame, MinimapShip, MinimapFog, MinimapCoverage } from './minimap';

/** The two phone profiles the field request pins the placement on — landscape
 *  logical space (post landscape-lock), a wider and a narrower handset. */
const PHONE_WIDE = { width: 844, height: 390 };
const PHONE_NARROW = { width: 568, height: 320 };
const DESKTOP = { width: 1280, height: 720 };

/** The registered anchors (kept in lock-step with minimap-view without importing
 *  the Pixi layer into a headless test). */
const COLLAPSED_ANCHOR: AnchorSpec = { region: 'bottom-right', margin: MINIMAP_MARGIN };
const EXPANDED_ANCHOR: AnchorSpec = { region: 'full', margin: MINIMAP_MARGIN };

/** A square arena with a handful of homes + one ship, the fixture the scene tests
 *  perturb one field of. */
const ARENA = { width: 1000, height: 1000 };

function frame(over: Partial<MinimapFrame> = {}): MinimapFrame {
  return {
    bounds: ARENA,
    stations: [{ owner: 0, x: 100, y: 100, alive: true }],
    ships: [],
    ...over,
  };
}

function ship(over: Partial<MinimapShip> = {}): MinimapShip {
  return { owner: 1, x: 500, y: 500, alive: true, local: false, spawnProtected: false, ...over };
}

// ---------------------------------------------------------------------------
// The fit
// ---------------------------------------------------------------------------

describe('fitBounds — arena → rect, aspect preserved and centred', () => {
  it('fits a square arena into a square rect edge-to-edge', () => {
    const t = fitBounds({ width: 1000, height: 1000 }, { x: 10, y: 20, width: 100, height: 100 });
    expect(t.scale).toBeCloseTo(0.1);
    expect(t.offsetX).toBeCloseTo(10);
    expect(t.offsetY).toBeCloseTo(20);
    // Opposite corner lands on the far rect edge.
    const far = mapPoint(t, 1000, 1000);
    expect(far.x).toBeCloseTo(110);
    expect(far.y).toBeCloseTo(120);
  });

  it('letterboxes a wide arena into a square rect (centred vertically)', () => {
    // 2:1 arena into a 100×100 rect → scale by width, 50px of vertical slack split.
    const t = fitBounds({ width: 2000, height: 1000 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(t.scale).toBeCloseTo(0.05);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeCloseTo(25); // (100 - 1000*0.05)/2
  });

  it('degenerate bounds yield a zero scale, not a divide-by-zero', () => {
    const t = fitBounds({ width: 0, height: 0 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(t.scale).toBe(0);
    expect(Number.isFinite(t.offsetX)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Placement — the layout-registry contract, on both phone profiles
// ---------------------------------------------------------------------------

describe('placement — the drawn rect sits inside its declared anchor zone', () => {
  for (const [name, vp] of [
    ['phone-wide', PHONE_WIDE],
    ['phone-narrow', PHONE_NARROW],
  ] as const) {
    it(`collapsed square is inside bottom-right on ${name} (touch)`, () => {
      const rect = collapsedRect(vp, true);
      const zone = resolveAnchor(COLLAPSED_ANCHOR, vp);
      expect(rectContains(zone, rect)).toBe(true);
      expect(rect.width).toBeGreaterThan(0);
    });

    it(`expanded overlay is inside full+margin on ${name} (touch)`, () => {
      const rect = expandedRect(vp, true);
      const zone = resolveAnchor(EXPANDED_ANCHOR, vp);
      expect(rectContains(zone, rect)).toBe(true);
      expect(rect.width).toBeGreaterThan(0);
    });
  }

  it('collapsed square is inside bottom-right on desktop (with strip clearance)', () => {
    const rect = collapsedRect(DESKTOP, false);
    const zone = resolveAnchor(COLLAPSED_ANCHOR, DESKTOP);
    expect(rectContains(zone, rect)).toBe(true);
  });

  it('is REALLY small on touch — smaller than desktop (the developer spec)', () => {
    const touch = collapsedRect(PHONE_WIDE, true);
    const desktop = collapsedRect(DESKTOP, false);
    expect(touch.width).toBeLessThan(desktop.width);
    expect(touch.width).toBeLessThanOrEqual(MINIMAP_COLLAPSED_TOUCH);
    expect(desktop.width).toBeLessThanOrEqual(MINIMAP_COLLAPSED_DESKTOP);
  });

  it('expanded overlay leaves a bottom band clear so it never blocks the controls', () => {
    const rect = expandedRect(PHONE_WIDE, true);
    // The overlay bottom must sit well above the viewport bottom (thumb reserve).
    expect(rect.y + rect.height).toBeLessThan(PHONE_WIDE.height - MINIMAP_MARGIN);
  });

  it('minimapRect selects collapsed vs expanded by state', () => {
    expect(minimapRect('collapsed', PHONE_WIDE, true)).toEqual(collapsedRect(PHONE_WIDE, true));
    expect(minimapRect('expanded', PHONE_WIDE, true)).toEqual(expandedRect(PHONE_WIDE, true));
  });

  it('desktop hugs the true bottom-right corner (only the strip lifts it)', () => {
    // No fire button on desktop (field report v0.2.4): the square takes the corner,
    // its right edge at the right margin and its bottom edge only lifted above the
    // controls strip. Well inside the right half — a bottom-RIGHT map.
    const rect = collapsedRect(DESKTOP, false);
    expect(rect.x + rect.width).toBeCloseTo(DESKTOP.width - MINIMAP_MARGIN, 5);
    expect(rect.y + rect.height).toBeCloseTo(DESKTOP.height - MINIMAP_MARGIN - MINIMAP_STRIP_CLEARANCE, 5);
    expect(rect.x + rect.width).toBeGreaterThan(DESKTOP.width / 2);
  });

  it('touch sits in the bottom-right band, LEFT of the fire column (clear of FIRE)', () => {
    // The hold-to-FIRE button owns the extreme touch corner (GDD §2.4). The map
    // wins the bottom-right band but stays clear of the fire column, so its right
    // edge sits at/inside W − margin − fire column. (PR #147: the map used to
    // overlap the FIRE button; now it is held left of it.)
    for (const vp of [PHONE_WIDE, PHONE_NARROW] as const) {
      const rect = collapsedRect(vp, true);
      const fireLeftEdge = vp.width - MINIMAP_MARGIN - MINIMAP_FIRE_COLUMN;
      expect(rect.x + rect.width, 'right edge clears the fire column').toBeLessThanOrEqual(
        fireLeftEdge + 0.5,
      );
      // Still in the RIGHT half — a bottom-RIGHT map, not a centred one.
      expect(rect.x + rect.width, 'still in the right half').toBeGreaterThan(vp.width / 2);
    }
  });

  it('respects safe-area insets by pulling the corner further in', () => {
    const plain = collapsedRect(PHONE_WIDE, true);
    const inset = collapsedRect(PHONE_WIDE, true, { right: 40, bottom: 40 });
    // The inset square's right/bottom edges are pulled in from the plain one.
    expect(inset.x + inset.width).toBeLessThan(plain.x + plain.width);
    expect(inset.y + inset.height).toBeLessThan(plain.y + plain.height);
  });
});

// ---------------------------------------------------------------------------
// The scene — what the minimap shows (dots and colours only)
// ---------------------------------------------------------------------------

const RECT = { x: 0, y: 0, width: 200, height: 200 };

describe('minimapScene — sim state → dots', () => {
  it('an owned station takes its owner colour; a wreck goes neutral steel + dim', () => {
    const scene = minimapScene(
      frame({
        stations: [
          { owner: 2, x: 0, y: 0, alive: true },
          { owner: 3, x: 1000, y: 1000, alive: false },
        ],
      }),
      RECT,
    );
    expect(scene.stationDots[0]!.color).toBe(playerColor(2));
    expect(scene.stationDots[0]!.alpha).toBe(MINIMAP_DOT_ALPHA);
    expect(scene.stationDots[1]!.color).toBe(PALETTE.hullSteel);
    expect(scene.stationDots[1]!.alpha).toBe(MINIMAP_DERELICT_ALPHA);
  });

  it('the local ship is separated into ownDot, highlighted (larger + own flag)', () => {
    const scene = minimapScene(
      frame({ ships: [ship({ owner: 1 }), ship({ owner: 0, local: true })] }),
      RECT,
    );
    expect(scene.ownDot).not.toBeNull();
    expect(scene.ownDot!.own).toBe(true);
    // Not also in the enemy list.
    expect(scene.shipDots.every((d) => !d.own)).toBe(true);
    expect(scene.shipDots).toHaveLength(1);
    // The own dot reads larger than an enemy dot at the same rect scale.
    expect(scene.ownDot!.radius).toBeGreaterThan(scene.shipDots[0]!.radius);
  });

  it('a spawn-protected ship dims; a dead ship drops off the map', () => {
    const scene = minimapScene(
      frame({
        ships: [
          ship({ owner: 1, spawnProtected: true }),
          ship({ owner: 2, alive: false }),
          ship({ owner: 3 }),
        ],
      }),
      RECT,
    );
    // Owner 2 (dead) is gone; owners 1 and 3 remain.
    expect(scene.shipDots).toHaveLength(2);
    const protectedDot = scene.shipDots.find((d) => d.color === playerColor(1))!;
    const normalDot = scene.shipDots.find((d) => d.color === playerColor(3))!;
    expect(protectedDot.alpha).toBe(MINIMAP_SPAWN_PROTECT_ALPHA);
    expect(normalDot.alpha).toBe(MINIMAP_DOT_ALPHA);
  });

  it('ore-field hints are faint signal-yellow (the reserved ore colour)', () => {
    const scene = minimapScene(frame({ oreHints: [{ x: 500, y: 500 }] }), RECT);
    expect(scene.oreDots).toHaveLength(1);
    expect(scene.oreDots[0]!.color).toBe(PALETTE.signalYellow);
    expect(scene.oreDots[0]!.alpha).toBe(MINIMAP_ORE_ALPHA);
  });

  it('the collapse ring is threat-red and scales with the fit; absent otherwise', () => {
    const noRing = minimapScene(frame(), RECT);
    expect(noRing.collapseRing).toBeNull();

    const ringed = minimapScene(frame({ collapse: { x: 500, y: 500, radius: 400 } }), RECT);
    expect(ringed.collapseRing).not.toBeNull();
    expect(ringed.collapseRing!.color).toBe(PALETTE.threatRed);
    // 200px rect over a 1000-unit arena → scale 0.2, centre at the rect centre.
    expect(ringed.collapseRing!.radius).toBeCloseTo(400 * 0.2);
    expect(ringed.collapseRing!.x).toBeCloseTo(100);
    expect(ringed.collapseRing!.y).toBeCloseTo(100);
  });

  it('places a station dot at the projected map position', () => {
    const scene = minimapScene(frame({ stations: [{ owner: 0, x: 250, y: 750, alive: true }] }), RECT);
    // scale 0.2, offset 0 → (50, 150).
    expect(scene.stationDots[0]!.x).toBeCloseTo(50);
    expect(scene.stationDots[0]!.y).toBeCloseTo(150);
  });
});

// ---------------------------------------------------------------------------
// Fog of war (RATIFIED feature f1) — the minimap renders ONLY the sensed-state
// ---------------------------------------------------------------------------

/** A coverage disc (map space). */
function disc(x: number, y: number, radius: number): MinimapCoverage {
  return { x, y, radius };
}

/** A fog descriptor: coverage discs + a remembered-station bitmask + the
 *  remembered-ore ids (`../sim/sensing` `SensoryMemory`). */
function fog(coverage: MinimapCoverage[], rememberedMask = 0, rememberedOre?: number[]): MinimapFog {
  return { coverage, rememberedMask, ...(rememberedOre ? { rememberedOre: new Set(rememberedOre) } : {}) };
}

describe('minimapScene fog — sensed / remembered / fogged tri-state (feature f1)', () => {
  it('with NO fog everything renders (backward compatible)', () => {
    const scene = minimapScene(
      frame({
        stations: [
          { owner: 0, x: 100, y: 100, alive: true, id: 0 },
          { owner: 1, x: 900, y: 900, alive: true, id: 1 },
        ],
        ships: [ship({ owner: 1, x: 900, y: 900 })],
        oreHints: [{ x: 500, y: 500 }],
      }),
      RECT,
    );
    expect(scene.fogged).toBe(false);
    expect(scene.stationDots).toHaveLength(2);
    expect(scene.shipDots).toHaveLength(1);
    expect(scene.oreDots).toHaveLength(1);
    expect(scene.coverage).toHaveLength(0);
  });

  it('a station under CURRENT coverage draws at full; the scene is flagged fogged', () => {
    const scene = minimapScene(
      frame({
        stations: [{ owner: 0, x: 100, y: 100, alive: true, id: 0 }],
        fog: fog([disc(100, 100, 300)]),
      }),
      RECT,
    );
    expect(scene.fogged).toBe(true);
    expect(scene.stationDots).toHaveLength(1);
    expect(scene.stationDots[0]!.alpha).toBe(MINIMAP_DOT_ALPHA);
  });

  it('a REMEMBERED but uncovered station draws DIMMED (persistent geography)', () => {
    const scene = minimapScene(
      frame({
        stations: [{ owner: 1, x: 900, y: 900, alive: true, id: 3 }],
        // coverage nowhere near (900,900), but the mask remembers station id 3.
        fog: fog([disc(100, 100, 300)], 1 << 3),
      }),
      RECT,
    );
    expect(scene.stationDots).toHaveLength(1);
    expect(scene.stationDots[0]!.alpha).toBe(MINIMAP_REMEMBERED_ALPHA);
  });

  it('a NEVER-seen station (not remembered, not covered) is FOGGED — no dot', () => {
    const scene = minimapScene(
      frame({
        stations: [{ owner: 1, x: 900, y: 900, alive: true, id: 3 }],
        fog: fog([disc(100, 100, 300)], 0),
      }),
      RECT,
    );
    expect(scene.stationDots).toHaveLength(0);
  });

  it('a live enemy ship shows only under CURRENT coverage; the local ship always shows', () => {
    const covered = minimapScene(
      frame({
        stations: [],
        ships: [ship({ owner: 1, x: 500, y: 500 }), ship({ owner: 0, x: 100, y: 100, local: true })],
        fog: fog([disc(500, 500, 200)]),
      }),
      RECT,
    );
    // Enemy inside the disc → a dot; local ship → its own dot (cockpit knowledge).
    expect(covered.shipDots).toHaveLength(1);
    expect(covered.ownDot, 'the local ship is always its own dot even outside coverage').not.toBeNull();
  });

  it('the satellite-killed moment: a live dot DISAPPEARS the tick its coverage dies', () => {
    const enemyAt = frame({
      stations: [],
      ships: [ship({ owner: 1, x: 800, y: 800 })],
    });
    // A satellite's LARGE disc covers the distant enemy → it draws.
    const withCoverage = minimapScene({ ...enemyAt, fog: fog([disc(800, 800, 300)]) }, RECT);
    expect(withCoverage.shipDots, 'covered enemy is on the map').toHaveLength(1);
    // Kill the satellite → coverage collapses to empty → the enemy drops the same read.
    const afterKill = minimapScene({ ...enemyAt, fog: fog([]) }, RECT);
    expect(afterKill.shipDots, 'the distant enemy vanishes when its coverage dies').toHaveLength(0);
  });

  it('radar satellites: enemy shows only when sensed, the viewer own always', () => {
    const scene = minimapScene(
      frame({
        stations: [],
        satellites: [
          { owner: 0, x: 100, y: 100, alive: true, local: true }, // own → always
          { owner: 1, x: 500, y: 500, alive: true, local: false }, // enemy, sensed
          { owner: 2, x: 900, y: 900, alive: true, local: false }, // enemy, fogged
          { owner: 1, x: 500, y: 500, alive: false, local: false }, // dead → gone
        ],
        fog: fog([disc(500, 500, 200)]),
      }),
      RECT,
    );
    // own (always) + the sensed enemy = 2; the fogged enemy and the dead one drop.
    expect(scene.satelliteDots).toHaveLength(2);
    expect(scene.satelliteDots.some((d) => d.own)).toBe(true);
  });

  it('ore hints show only where the player currently senses', () => {
    const scene = minimapScene(
      frame({
        stations: [],
        oreHints: [
          { x: 500, y: 500 }, // inside coverage
          { x: 900, y: 900 }, // fogged
        ],
        fog: fog([disc(500, 500, 200)]),
      }),
      RECT,
    );
    expect(scene.oreDots).toHaveLength(1);
  });

  // Ore is STATIC geography (a rock never moves, it only depletes), so it takes
  // the same tri-state a station does — the developer report p15, "radar built,
  // fog stayed": a field scouted once must not go dark again when you fly home.
  it('a REMEMBERED ore field stays on the map, DIMMED, once coverage moves off it', () => {
    const scene = minimapScene(
      frame({
        stations: [],
        oreHints: [
          { x: 500, y: 500, id: 11 }, // under coverage right now
          { x: 900, y: 900, id: 22 }, // scouted earlier, coverage long gone
          { x: 20, y: 900, id: 33 }, // never seen
        ],
        fog: fog([disc(500, 500, 200)], 0, [22]),
      }),
      RECT,
    );
    expect(scene.oreDots, 'the never-scouted field stays fogged').toHaveLength(2);
    const alphas = scene.oreDots.map((d) => d.alpha).sort();
    expect(alphas).toEqual([MINIMAP_REMEMBERED_ORE_ALPHA, MINIMAP_ORE_ALPHA].sort());
    expect(MINIMAP_REMEMBERED_ORE_ALPHA).toBeLessThan(MINIMAP_ORE_ALPHA);
  });

  it('a remembered field re-entering coverage brightens back to full', () => {
    const scene = minimapScene(
      frame({
        stations: [],
        oreHints: [{ x: 500, y: 500, id: 11 }],
        fog: fog([disc(500, 500, 200)], 0, [11]), // remembered AND covered
      }),
      RECT,
    );
    expect(scene.oreDots[0]!.alpha).toBe(MINIMAP_ORE_ALPHA);
  });

  it('an ore hint with no id is never remembered (older feeds gate exactly as before)', () => {
    const scene = minimapScene(
      frame({
        stations: [],
        oreHints: [{ x: 900, y: 900 }],
        fog: fog([disc(500, 500, 200)], 0, [22]),
      }),
      RECT,
    );
    expect(scene.oreDots).toHaveLength(0);
  });

  it('the satellite-killed moment does NOT erase the fields it mapped', () => {
    const field = frame({
      stations: [],
      oreHints: [{ x: 800, y: 800, id: 7 }],
    });
    const lit = minimapScene({ ...field, fog: fog([disc(800, 800, 300)], 0, [7]) }, RECT);
    expect(lit.oreDots[0]!.alpha).toBe(MINIMAP_ORE_ALPHA);
    // Coverage collapses with the satellite; the rock it found is still known.
    const afterKill = minimapScene({ ...field, fog: fog([], 0, [7]) }, RECT);
    expect(afterKill.oreDots).toHaveLength(1);
    expect(afterKill.oreDots[0]!.alpha).toBe(MINIMAP_REMEMBERED_ORE_ALPHA);
  });

  it('projects coverage discs into screen space (faintly-visible radar reach)', () => {
    const scene = minimapScene(frame({ stations: [], fog: fog([disc(500, 500, 400)]) }), RECT);
    // 200px rect over a 1000-unit arena → scale 0.2, centred origin 0.
    expect(scene.coverage).toHaveLength(1);
    expect(scene.coverage[0]!.x).toBeCloseTo(100);
    expect(scene.coverage[0]!.y).toBeCloseTo(100);
    expect(scene.coverage[0]!.radius).toBeCloseTo(400 * 0.2);
  });

  it('the collapse ring stays visible through fog (match-critical exception)', () => {
    const scene = minimapScene(
      frame({
        stations: [],
        collapse: { x: 500, y: 500, radius: 400 },
        // No coverage anywhere — everything else is fogged, but the ring still draws.
        fog: fog([]),
      }),
      RECT,
    );
    expect(scene.collapseRing, 'the collapse ring is drawn regardless of coverage').not.toBeNull();
  });

  it('both states fog IDENTICALLY — the same slice is revealed collapsed and expanded (brief item 2)', () => {
    // A mixed scene: one covered station + one remembered-only + one never-seen; a
    // covered enemy + a fogged enemy; a covered satellite + a fogged one; ore in and
    // out of coverage. The fog decision is in MAP space (before the rect projection),
    // so the SET that survives must not depend on which rect it is drawn into.
    const scene = frame({
      stations: [
        { owner: 0, x: 100, y: 100, alive: true, id: 0 }, // covered
        { owner: 1, x: 900, y: 900, alive: true, id: 1 }, // remembered only
        { owner: 2, x: 500, y: 20, alive: true, id: 2 }, // never seen → fogged
      ],
      ships: [
        ship({ owner: 1, x: 120, y: 120 }), // covered
        ship({ owner: 2, x: 900, y: 900 }), // fogged
        ship({ owner: 0, x: 500, y: 500, local: true }), // own — always
      ],
      satellites: [
        { owner: 3, x: 110, y: 110, alive: true, local: false }, // covered enemy
        { owner: 3, x: 950, y: 950, alive: true, local: false }, // fogged enemy
      ],
      oreHints: [
        { x: 130, y: 130 }, // covered
        { x: 950, y: 100 }, // fogged
      ],
      fog: fog([disc(100, 100, 200)], 1 << 1),
    });
    const collapsed = minimapScene(scene, minimapRect('collapsed', PHONE_WIDE, true));
    const expanded = minimapScene(scene, minimapRect('expanded', PHONE_WIDE, true));

    // The rects differ (the whole point of the two states)…
    expect(collapsed.rect).not.toEqual(expanded.rect);
    // …but the fog gate reveals the exact same slice in both.
    expect(collapsed.fogged).toBe(true);
    expect(expanded.fogged).toBe(true);
    expect(collapsed.stationDots.length).toBe(expanded.stationDots.length);
    expect(collapsed.shipDots.length).toBe(expanded.shipDots.length);
    expect(collapsed.satelliteDots.length).toBe(expanded.satelliteDots.length);
    expect(collapsed.oreDots.length).toBe(expanded.oreDots.length);
    expect(collapsed.coverage.length).toBe(expanded.coverage.length);
    expect(!!collapsed.ownDot).toBe(!!expanded.ownDot);
    // And it is the right slice: covered + remembered station (not the never-seen);
    // covered enemy (own is ownDot); covered satellite; covered ore.
    expect(collapsed.stationDots).toHaveLength(2);
    expect(collapsed.shipDots).toHaveLength(1);
    expect(collapsed.ownDot).not.toBeNull();
    expect(collapsed.satelliteDots).toHaveLength(1);
    expect(collapsed.oreDots).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Shape carries KIND, colour carries OWNER (a0-88)
// ---------------------------------------------------------------------------
//
// The developer, from a live match on a phone: *"the minimap shows two circles.
// ships should be a different icon though to differentiate."* Every body was a
// filled circle, so only SIZE and COLOUR told them apart — and colour was already
// spoken for (roster identity, style-guide §3). These tests pin the second
// channel, and they pin it WITHOUT reference to size: the discriminator is the
// mark's outline, which is scale-invariant.

/** Vertices in a mark's outline — 3 for a triangle, 4 for a square/diamond, and
 *  `null` for a circle, which is drawn with the circle primitive. The count does
 *  not move when the radius does, which is exactly why the assertions below use
 *  it instead of comparing sizes. */
function outlineVertices(dot: MinimapDot): number | null {
  const poly = markPolygon(dot);
  return poly === null ? null : poly.length / 2;
}

/** Even-odd point-in-polygon over a flat `[x0,y0,…]` loop. */
function inPolygon(loop: readonly number[], px: number, py: number): boolean {
  let inside = false;
  const n = loop.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = loop[i * 2] as number;
    const yi = loop[i * 2 + 1] as number;
    const xj = loop[j * 2] as number;
    const yj = loop[j * 2 + 1] as number;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe('minimapScene — shape is KIND, colour is OWNER (a0-88)', () => {
  it('a ship and a station do not share a shape', () => {
    const scene = minimapScene(
      frame({
        stations: [{ owner: 2, x: 200, y: 200, alive: true }],
        ships: [ship({ owner: 3, x: 800, y: 800 })],
      }),
      RECT,
    );
    const station = scene.stationDots[0]!;
    const vessel = scene.shipDots[0]!;

    // Both carry a KIND, and the kinds are different ones.
    expect(station.shape).toBeDefined();
    expect(vessel.shape).toBeDefined();
    expect(vessel.shape).not.toBe(station.shape);
    expect(station.shape).toBe('square');
    expect(vessel.shape).toBe('triangle');

    // ...and the difference is NOT size. The marks are told apart by the outline
    // they are drawn as — a count of vertices, which does not change when the
    // radius does. Force the two to exactly the same radius and the distinction
    // survives intact, which a size-based read could not.
    expect(outlineVertices(vessel)).toBe(3);
    expect(outlineVertices(station)).toBe(4);
    const r = 7;
    expect(outlineVertices({ ...vessel, radius: r })).toBe(3);
    expect(outlineVertices({ ...station, radius: r })).toBe(4);
    expect(outlineVertices({ ...vessel, radius: r })).not.toBe(outlineVertices({ ...station, radius: r }));
  });

  it('OWNERSHIP COLOUR is untouched — shape is the only new channel', () => {
    const scene = minimapScene(
      frame({
        stations: [
          { owner: 2, x: 100, y: 100, alive: true },
          { owner: 3, x: 900, y: 100, alive: false },
        ],
        ships: [ship({ owner: 5, x: 500, y: 500 }), ship({ owner: 0, x: 400, y: 400, local: true })],
        satellites: [{ owner: 6, x: 700, y: 300, alive: true, local: false }],
        oreHints: [{ x: 600, y: 600 }],
      }),
      RECT,
    );
    // Exactly the colours §3 assigned, mark for mark — a wreck still neutral steel,
    // ore still the reserved signal yellow.
    expect(scene.stationDots[0]!.color).toBe(playerColor(2));
    expect(scene.stationDots[1]!.color).toBe(PALETTE.hullSteel);
    expect(scene.shipDots[0]!.color).toBe(playerColor(5));
    expect(scene.ownDot!.color).toBe(playerColor(0));
    expect(scene.satelliteDots[0]!.color).toBe(playerColor(6));
    expect(scene.oreDots[0]!.color).toBe(PALETTE.signalYellow);
  });

  it('every kind on the map gets its own mark: ship / station / satellite / ore', () => {
    const scene = minimapScene(
      frame({
        stations: [{ owner: 2, x: 100, y: 100, alive: true }],
        ships: [ship({ owner: 3, x: 500, y: 500 })],
        satellites: [{ owner: 4, x: 700, y: 300, alive: true, local: false }],
        oreHints: [{ x: 600, y: 600 }],
      }),
      RECT,
    );
    const kinds = [
      scene.shipDots[0]!.shape,
      scene.stationDots[0]!.shape,
      scene.satelliteDots[0]!.shape,
      scene.oreDots[0]!.shape,
    ];
    expect(kinds).toEqual(['triangle', 'square', 'diamond', 'circle']);
    expect(new Set(kinds).size).toBe(4); // four kinds, four marks, no collisions
  });

  it('the local ship is a triangle too — same KIND, louder (larger + own)', () => {
    const scene = minimapScene(
      frame({ ships: [ship({ owner: 1 }), ship({ owner: 0, x: 300, y: 300, local: true })] }),
      RECT,
    );
    expect(scene.ownDot!.shape).toBe('triangle');
    expect(scene.shipDots[0]!.shape).toBe('triangle');
    // Mine is bigger, as it always was — but size is now the "which one is me"
    // channel only, never the "what kind of thing is this" one.
    expect(scene.ownDot!.radius).toBeGreaterThan(scene.shipDots[0]!.radius);
  });

  it("a ship's triangle points along its heading — the thing a dot threw away", () => {
    const east = minimapScene(frame({ ships: [ship({ angle: 0 })] }), RECT).shipDots[0]!;
    const south = minimapScene(frame({ ships: [ship({ angle: Math.PI / 2 })] }), RECT).shipDots[0]!;
    const eastPoly = markPolygon(east)!;
    const southPoly = markPolygon(south)!;
    // The nose is vertex 0. Facing 0 puts it to the RIGHT of the mark's centre and
    // level with it; facing +π/2 puts it BELOW and level horizontally (screen axes).
    expect(eastPoly[0]!).toBeGreaterThan(east.x);
    expect(eastPoly[1]!).toBeCloseTo(east.y);
    expect(southPoly[1]!).toBeGreaterThan(south.y);
    expect(southPoly[0]!).toBeCloseTo(south.x);
    // Same ship, same place, same size — only the facing turned.
    expect(south.x).toBeCloseTo(east.x);
    expect(south.radius).toBeCloseTo(east.radius);
  });

  it('a feed with no heading still gets a SHIP-shaped mark (nose right)', () => {
    // Kind does not depend on the heading being fed: an older feed loses the
    // facing, never the "this is a vessel".
    const dot = minimapScene(frame({ ships: [ship()] }), RECT).shipDots[0]!;
    expect(dot.shape).toBe('triangle');
    expect(dot.angle).toBe(0);
    expect(markPolygon(dot)![0]!).toBeGreaterThan(dot.x);
  });

  it('a WRECK keeps the station square — what says "spent" is the steel and the dim', () => {
    const scene = minimapScene(
      frame({ stations: [{ owner: 3, x: 500, y: 500, alive: false }] }),
      RECT,
    );
    // A derelict is still an installation. Changing its KIND on death would make
    // shape mean two things at once, which is the bug this brief is about.
    expect(scene.stationDots[0]!.shape).toBe('square');
    expect(scene.stationDots[0]!.color).toBe(PALETTE.hullSteel);
    expect(scene.stationDots[0]!.alpha).toBe(MINIMAP_DERELICT_ALPHA);
  });

  it('ore is drawn with the circle primitive, not a tessellated one', () => {
    const scene = minimapScene(frame({ oreHints: [{ x: 500, y: 500 }] }), RECT);
    expect(scene.oreDots[0]!.shape).toBe('circle');
    expect(markPolygon(scene.oreDots[0]!)).toBeNull();
  });

  it('each mark carries about the ink its circle did — a new shape, not a louder one', () => {
    const scene = minimapScene(
      frame({
        stations: [{ owner: 2, x: 100, y: 100, alive: true }],
        ships: [ship({ owner: 3, x: 500, y: 500 })],
        satellites: [{ owner: 4, x: 700, y: 300, alive: true, local: false }],
      }),
      RECT,
    );
    for (const dot of [scene.stationDots[0]!, scene.shipDots[0]!, scene.satelliteDots[0]!]) {
      const circleArea = Math.PI * dot.radius * dot.radius;
      expect(polygonArea(markPolygon(dot)!) / circleArea).toBeGreaterThan(0.75);
      expect(polygonArea(markPolygon(dot)!) / circleArea).toBeLessThan(1.25);
    }
  });
});

/** |signed area| of a flat `[x0,y0,…]` polygon (the shoelace). */
function polygonArea(loop: readonly number[]): number {
  let a = 0;
  const n = loop.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += (loop[j * 2] as number) * (loop[i * 2 + 1] as number) - (loop[i * 2] as number) * (loop[j * 2 + 1] as number);
  }
  return Math.abs(a) / 2;
}

// ---------------------------------------------------------------------------
// The sensed region — one merged shape, not N circles (a0-88)
// ---------------------------------------------------------------------------
//
// *"also it shows a circle around my ship and a circle around the station not sure
// what the station circle is but it's unneeded"* — the rings ARE information
// (radar coverage, feature f1), so the fix is not to cut one. What made them
// unreadable is that a circle centred on a body reads as a property OF that body,
// and the overlapping washes double-blended into a lens that advertised "two
// separate circles". Drawing the UNION removes both readings at once.

describe('sensedRegions — the union of the coverage discs', () => {
  it('two SEPARATE discs stay two lobes', () => {
    const loops = sensedRegions([
      { x: 0, y: 0, radius: 10 },
      { x: 100, y: 0, radius: 10 },
    ]);
    expect(loops).toHaveLength(2);
  });

  it('two OVERLAPPING discs merge into ONE silhouette — the honest picture', () => {
    // This is the developer's own frame: your ship near your home, both sensing.
    const regions = sensedRegions([
      { x: 0, y: 0, radius: 30 },
      { x: 40, y: 0, radius: 30 },
    ]);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toEqual([]);
    const loop = regions[0]!.outline;
    // The merged outline encloses the whole of both discs...
    expect(inPolygon(loop, -25, 0)).toBe(true); // deep in the left disc
    expect(inPolygon(loop, 65, 0)).toBe(true); // deep in the right disc
    expect(inPolygon(loop, 20, 0)).toBe(true); // the overlap
    // ...and nothing that neither disc reaches.
    expect(inPolygon(loop, 20, 45)).toBe(false); // above the waist
    expect(inPolygon(loop, -45, 0)).toBe(false);
    expect(inPolygon(loop, 85, 0)).toBe(false);
  });

  it('the merged outline has a WAIST — it is not a circle pretending to be two', () => {
    const loop = sensedRegions([
      { x: 0, y: 0, radius: 30 },
      { x: 40, y: 0, radius: 30 },
    ])[0]!.outline;
    // The boundary at the join sits nearer the axis than either disc's own top.
    let waist = Infinity;
    for (let i = 0; i < loop.length; i += 2) {
      if (Math.abs((loop[i] as number) - 20) < 1.5) waist = Math.min(waist, Math.abs(loop[i + 1] as number));
    }
    expect(waist).toBeLessThan(30);
  });

  it('a disc wholly inside another contributes nothing — one clean boundary', () => {
    const loops = sensedRegions([
      { x: 0, y: 0, radius: 50 },
      { x: 5, y: 0, radius: 10 },
    ]);
    expect(loops).toHaveLength(1);
    // Every vertex is on the BIG disc, so the small one drew no arc at all.
    const loop = loops[0]!.outline;
    for (let i = 0; i < loop.length; i += 2) {
      expect(Math.hypot(loop[i] as number, loop[i + 1] as number)).toBeCloseTo(50, 5);
    }
  });

  it('exact duplicates collapse to one outline (no double-stroked ring)', () => {
    const loops = sensedRegions([
      { x: 10, y: 10, radius: 20 },
      { x: 10, y: 10, radius: 20 },
    ]);
    expect(loops).toHaveLength(1);
  });

  it('a lone disc is a closed circle; nothing at all is nothing', () => {
    expect(sensedRegions([])).toEqual([]);
    const loops = sensedRegions([{ x: 0, y: 0, radius: 12 }]);
    expect(loops).toHaveLength(1);
    const only = loops[0]!.outline;
    expect(only.length / 2).toBeGreaterThan(8);
    for (let i = 0; i < only.length; i += 2) {
      expect(Math.hypot(only[i] as number, only[i + 1] as number)).toBeCloseTo(12, 5);
    }
  });

  it('a three-disc chain is one region; break the chain and it is two', () => {
    const chained = sensedRegions([
      { x: 0, y: 0, radius: 20 },
      { x: 30, y: 0, radius: 20 },
      { x: 60, y: 0, radius: 20 },
    ]);
    expect(chained).toHaveLength(1);
    const broken = sensedRegions([
      { x: 0, y: 0, radius: 20 },
      { x: 30, y: 0, radius: 20 },
      { x: 200, y: 0, radius: 20 },
    ]);
    expect(broken).toHaveLength(2);
  });

  it('a RING of discs leaves a pocket, and the pocket is a hole, not a second region', () => {
    // Four of a side's ships spread out on patrol (GDD §2.2, amended 2026-08-13:
    // in TEAMS the fog lifts under a teammate exactly as under you, so all four
    // discs are on one map). Their sensor radius is the shipped 520 (§2.8) and
    // they sit 900 apart, so neighbouring discs overlap but the middle of the
    // square — 636 from every one of them — is inside none.
    const patrol = [
      { x: 0, y: 0, radius: 520 },
      { x: 900, y: 0, radius: 520 },
      { x: 900, y: 900, radius: 520 },
      { x: 0, y: 900, radius: 520 },
    ];
    const regions = sensedRegions(patrol);
    expect(regions).toHaveLength(1); // one lit silhouette...
    expect(regions[0]!.holes).toHaveLength(1); // ...with an unlit pocket in it

    // The pocket really is the part nobody senses: its centre is outside every
    // disc, and it is inside the region's outer boundary.
    const mid = { x: 450, y: 450 };
    for (const d of patrol) {
      expect(Math.hypot(mid.x - d.x, mid.y - d.y)).toBeGreaterThan(d.radius);
    }
    expect(inPolygon(regions[0]!.outline, mid.x, mid.y)).toBe(true);
    expect(inPolygon(regions[0]!.holes[0]!, mid.x, mid.y)).toBe(true);

    // And a point that IS sensed is inside the region but outside the pocket.
    expect(inPolygon(regions[0]!.outline, 450, 0)).toBe(true);
    expect(inPolygon(regions[0]!.holes[0]!, 450, 0)).toBe(false);
  });

  it('a disc parked INSIDE a pocket is its own region — nesting, not a hole', () => {
    // A radar satellite (§2.8: 900) would swallow the ring whole, so this is the
    // small case: a station's own 300 disc, alone in the middle of the patrol.
    const regions = sensedRegions([
      { x: 0, y: 0, radius: 520 },
      { x: 900, y: 0, radius: 520 },
      { x: 900, y: 900, radius: 520 },
      { x: 0, y: 900, radius: 520 },
      { x: 450, y: 450, radius: 60 },
    ]);
    expect(regions).toHaveLength(2);
    const island = regions.find((r) => Math.abs(r.outline[0]! - 510) < 1e-6);
    expect(island).toBeDefined(); // the little disc, drawn on its own
    expect(island!.holes).toEqual([]); // and NOT swallowed by the pocket
    const ringed = regions.find((r) => r !== island)!;
    expect(ringed.holes).toHaveLength(1); // the pocket is still the ring's
  });

  it('degenerate discs are dropped rather than drawn', () => {
    expect(sensedRegions([{ x: 0, y: 0, radius: 0 }])).toEqual([]);
    expect(sensedRegions([{ x: NaN, y: 0, radius: 5 }])).toEqual([]);
  });

  it('the scene carries the region only when the map is FOGGED', () => {
    const clear = minimapScene(frame({ ships: [ship({ local: true })] }), RECT);
    expect(clear.fogged).toBe(false);
    expect(clear.sensedRegion).toEqual([]);

    const fogged = minimapScene(
      frame({ ships: [ship({ local: true })], fog: fog([disc(500, 500, 300)]) }),
      RECT,
    );
    expect(fogged.fogged).toBe(true);
    expect(fogged.sensedRegion).toHaveLength(1);
  });

  it("the developer's frame: ship disc + station disc read as ONE lit region", () => {
    // A ship sitting near its own home — the two discs the screenshot showed as
    // two mystery circles. Coverage radii are the shipped ones (GDD §2.8: ship
    // sensor 520, station sensor 300).
    const scene = minimapScene(
      frame({
        stations: [{ owner: 0, x: 500, y: 500, alive: true, id: 0 }],
        ships: [ship({ owner: 0, x: 620, y: 500, local: true })],
        fog: fog([disc(620, 500, 520), disc(500, 500, 300)], 1),
      }),
      RECT,
    );
    expect(scene.coverage).toHaveLength(2); // two sensors, as before...
    expect(scene.sensedRegion).toHaveLength(1); // ...one thing drawn
  });

  it('gaining an ally does not move a stretch of rim the ally never reached', () => {
    // The union cannot SUBTRACT: a place you could see alone is a place you can
    // still see with teammates. The boundary is drawn as a chord polygon, though,
    // and every chord sits a sagitta inside the true arc — so if the vertices are
    // spaced along each free ARC rather than pinned to the DISC, clipping one side
    // of your ship's rim re-phases the chords all the way round it. The edge line
    // then slides by a fraction of a pixel down boundary that never moved, and its
    // anti-aliased fringe drops back under the "lit?" threshold wherever it was
    // already marginal — two pixels of the human's own sight went dark on exactly
    // this, in `tests/mobile/team-fog-offline.spec.ts`.
    const mine = { x: 0, y: 0, radius: 50 };
    const alone = sensedRegions([mine, { x: 90, y: 0, radius: 50 }]);
    // A teammate arrives and clips the FAR side — a quarter turn away from the
    // stretch of rim this test watches, and never touching it.
    const withAlly = sensedRegions([mine, { x: 90, y: 0, radius: 50 }, { x: 0, y: 90, radius: 50 }]);

    /** Every drawn vertex sitting on `mine`'s rim, on the arc around angle π. */
    const westRim = (regions: ReturnType<typeof sensedRegions>): string[] => {
      const pts: string[] = [];
      for (const region of regions) {
        for (const loop of [region.outline, ...region.holes]) {
          for (let i = 0; i < loop.length; i += 2) {
            const x = loop[i] as number;
            const y = loop[i + 1] as number;
            if (Math.abs(Math.hypot(x - mine.x, y - mine.y) - mine.radius) > 1e-6) continue;
            if (Math.abs(Math.atan2(y - mine.y, x - mine.x)) < Math.PI - 0.6) continue;
            pts.push(`${x.toFixed(9)},${y.toFixed(9)}`);
          }
        }
      }
      return pts.sort();
    };

    const before = westRim(alone);
    expect(before.length).toBeGreaterThan(4); // the stretch really is tessellated
    expect(westRim(withAlly)).toEqual(before); // …and drawn to the same points
  });
});

// ---------------------------------------------------------------------------
// pointInRect
// ---------------------------------------------------------------------------

describe('pointInRect', () => {
  const r = { x: 10, y: 20, width: 100, height: 50 };
  it('is inclusive of the edges and rejects points outside', () => {
    expect(pointInRect(10, 20, r)).toBe(true);
    expect(pointInRect(110, 70, r)).toBe(true);
    expect(pointInRect(60, 45, r)).toBe(true);
    expect(pointInRect(9, 45, r)).toBe(false);
    expect(pointInRect(60, 71, r)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The toggle — one code path for click (PC) and tap (mobile)
// ---------------------------------------------------------------------------

/** The centre of a rect — where a click/tap lands to hit it. */
function centre(r: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

describe('Minimap — toggle + hit test', () => {
  it('starts collapsed and toggles / expands / collapses', () => {
    const m = new Minimap();
    expect(m.state).toBe('collapsed');
    expect(m.expanded).toBe(false);
    m.toggle();
    expect(m.state).toBe('expanded');
    m.toggle();
    expect(m.state).toBe('collapsed');
    m.expand();
    expect(m.expanded).toBe(true);
    m.expand(); // idempotent
    expect(m.expanded).toBe(true);
    m.collapse();
    expect(m.expanded).toBe(false);
  });

  it('a tap on the collapsed corner expands; a tap on the overlay collapses', () => {
    const m = new Minimap();
    const collapsed = centre(collapsedRect(PHONE_WIDE, true));
    expect(m.tap(collapsed.x, collapsed.y, PHONE_WIDE, true)).toBe(true);
    expect(m.state).toBe('expanded');

    const overlay = centre(expandedRect(PHONE_WIDE, true));
    expect(m.tap(overlay.x, overlay.y, PHONE_WIDE, true)).toBe(true);
    expect(m.state).toBe('collapsed');
  });

  it('a tap that misses the surface neither toggles nor consumes', () => {
    const m = new Minimap();
    // Top-left corner is nowhere near the bottom-right collapsed square.
    expect(m.tap(0, 0, PHONE_WIDE, true)).toBe(false);
    expect(m.state).toBe('collapsed');
  });

  it('input parity: click (PC) and tap (mobile) reach the SAME toggle', () => {
    // PC: a click at the desktop collapsed square, isTouch=false.
    const pc = new Minimap();
    const pcHit = centre(collapsedRect(DESKTOP, false));
    expect(pc.tap(pcHit.x, pcHit.y, DESKTOP, false)).toBe(true);
    expect(pc.state).toBe('expanded');

    // Mobile: a tap at the touch collapsed square, isTouch=true. Same method, same
    // outcome — the two platforms cannot diverge (docs/input-parity.md).
    const mobile = new Minimap();
    const mobileHit = centre(collapsedRect(PHONE_WIDE, true));
    expect(mobile.tap(mobileHit.x, mobileHit.y, PHONE_WIDE, true)).toBe(true);
    expect(mobile.state).toBe('expanded');
  });

  it('the PC keyboard shortcut is M', () => {
    expect(MINIMAP_TOGGLE_KEY).toBe('KeyM');
  });

  it('hitTest tracks the active state (corner when collapsed, overlay when expanded)', () => {
    const m = new Minimap();
    const corner = centre(collapsedRect(PHONE_WIDE, true));
    const overlay = centre(expandedRect(PHONE_WIDE, true));
    // Collapsed: hits the corner, not (necessarily) the centred overlay area.
    expect(m.hitTest(corner.x, corner.y, PHONE_WIDE, true)).toBe(true);
    m.expand();
    // Expanded: the overlay centre is now the live surface.
    expect(m.hitTest(overlay.x, overlay.y, PHONE_WIDE, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The expanded overlay is MODAL — u6-01 ("with the radar open, a press outside
// it flies your ship")
//
// The pre-existing coverage above asserts a press ON the overlay toggles, and it
// passed while the defect shipped — so it never had a chance to catch this. What
// follows pins the *other* press: while EXPANDED, a press OUTSIDE the overlay
// must collapse it AND report the event consumed, so it never also reaches
// gameplay. And the asymmetry that keeps the fix from eating flight input: while
// COLLAPSED, a press that misses the corner square must still fall through.
// ---------------------------------------------------------------------------

/** A press point provably OUTSIDE both minimap rects for a viewport — the far
 *  left edge, which neither the bottom-right corner square nor the centred
 *  overlay ever reaches. Asserted rather than assumed, so a geometry change
 *  cannot quietly turn "outside" into "inside" and make these tests vacuous. */
function outsideBothRects(viewport: { width: number; height: number }, isTouch: boolean): { x: number; y: number } {
  const p = { x: 4, y: Math.round(viewport.height / 2) };
  expect(pointInRect(p.x, p.y, collapsedRect(viewport, isTouch)), 'fixture point misses the corner square').toBe(
    false,
  );
  expect(pointInRect(p.x, p.y, expandedRect(viewport, isTouch)), 'fixture point misses the overlay').toBe(false);
  return p;
}

/**
 * The dispatch seam `main.ts` presses through, modelled: `main.ts:1503` calls
 * `Hud.minimapTap` → {@link Minimap.tap} and, **only when it returns `false`**,
 * lets the press fall through to the code below it — the Tap-Commander pilot that
 * flies the ship, and (on touch) the dynamic stick bound to the same canvas, which
 * the `stopImmediatePropagation` on a consumed press is what stops.
 *
 * So the bug under test is not "did the model collapse" — it is "did gameplay see
 * this press". Routing through the same boolean is how these tests ask that
 * question rather than inspecting the minimap alone.
 */
class PressRouter {
  /** Move orders the Tap-Commander pilot would have taken from these presses. */
  shipOrders = 0;
  /** Virtual sticks that would have engaged under these presses. */
  sticksEngaged = 0;

  constructor(
    private readonly minimap: Minimap,
    private readonly viewport: { width: number; height: number },
    private readonly isTouch: boolean,
  ) {}

  /** Route one press; returns whether the minimap consumed it. */
  press(x: number, y: number): boolean {
    if (this.minimap.tap(x, y, this.viewport, this.isTouch)) return true; // consumed → return, as main.ts does
    this.shipOrders++; // the pilot takes the order (main.ts, the Tap Commander block)
    if (this.isTouch) this.sticksEngaged++; // …and the stick under the finger engages
    return false;
  }

  /** Nothing downstream of the minimap saw a press. */
  get gameplayUntouched(): boolean {
    return this.shipOrders === 0 && this.sticksEngaged === 0;
  }
}

describe('Minimap — the EXPANDED overlay is modal (u6-01)', () => {
  // Pointer (PC) and touch run the SAME assertions, because ONE code path serves
  // both (docs/input-parity.md): a divergence here would be a parity hole, not a
  // device quirk.
  const PROFILES = [
    { name: 'pointer (desktop)', viewport: DESKTOP, isTouch: false },
    { name: 'touch (landscape phone)', viewport: PHONE_WIDE, isTouch: true },
    { name: 'touch (narrow phone)', viewport: PHONE_NARROW, isTouch: true },
  ] as const;

  for (const { name, viewport, isTouch } of PROFILES) {
    describe(name, () => {
      it('expanded + a press OUTSIDE collapses, and reports the event CONSUMED', () => {
        const m = new Minimap();
        m.expand();
        const out = outsideBothRects(viewport, isTouch);

        expect(m.tap(out.x, out.y, viewport, isTouch), 'the press is consumed').toBe(true);
        expect(m.state, 'the overlay dismissed').toBe('collapsed');
      });

      it('expanded + a press OUTSIDE never reaches gameplay — no ship order, no stick', () => {
        // The actual bug: `false` meant "not consumed", so the same press flew the
        // ship / engaged a stick under the open overlay. Asserted through the seam
        // main.ts presses (main.ts:1503), not by reading the minimap's own state.
        const m = new Minimap();
        m.expand();
        const router = new PressRouter(m, viewport, isTouch);
        const out = outsideBothRects(viewport, isTouch);

        expect(router.press(out.x, out.y), 'the minimap claimed the press').toBe(true);
        expect(router.shipOrders, 'the ship took no order').toBe(0);
        expect(router.sticksEngaged, 'no virtual stick engaged').toBe(0);
        expect(router.gameplayUntouched).toBe(true);
        expect(m.state).toBe('collapsed');
      });

      it('COLLAPSED + a press outside still FALLS THROUGH — the fix never eats flight input', () => {
        // The asymmetry, guarded. A glance widget that consumed every press while
        // the player is flying would be a worse bug than the one being fixed.
        const m = new Minimap();
        const router = new PressRouter(m, viewport, isTouch);
        const out = outsideBothRects(viewport, isTouch);

        expect(router.press(out.x, out.y), 'the press is NOT consumed').toBe(false);
        expect(m.state, 'and nothing toggled').toBe('collapsed');
        expect(router.shipOrders, 'gameplay got the press, as it must').toBe(1);
      });

      it('a press ON the overlay still collapses and consumes (unchanged)', () => {
        const m = new Minimap();
        m.expand();
        const router = new PressRouter(m, viewport, isTouch);
        const on = centre(expandedRect(viewport, isTouch));

        expect(router.press(on.x, on.y)).toBe(true);
        expect(m.state).toBe('collapsed');
        expect(router.gameplayUntouched).toBe(true);
      });

      it('a press on the corner square still expands and consumes (unchanged)', () => {
        const m = new Minimap();
        const router = new PressRouter(m, viewport, isTouch);
        const corner = centre(collapsedRect(viewport, isTouch));

        expect(router.press(corner.x, corner.y)).toBe(true);
        expect(m.state).toBe('expanded');
        expect(router.gameplayUntouched).toBe(true);
      });

      it('the full round trip: open on the corner, dismiss with a press anywhere', () => {
        const m = new Minimap();
        const router = new PressRouter(m, viewport, isTouch);
        const corner = centre(collapsedRect(viewport, isTouch));
        const out = outsideBothRects(viewport, isTouch);

        router.press(corner.x, corner.y);
        expect(m.state).toBe('expanded');
        router.press(out.x, out.y);
        expect(m.state).toBe('collapsed');
        // …and the map is a glance widget again: the very next press off it flies.
        router.press(out.x, out.y);
        expect(router.shipOrders, 'only the post-dismissal press reached gameplay').toBe(1);
      });
    });
  }

  it('the M shortcut is unaffected — it toggles from either state', () => {
    // `M` drives `toggle()` (main.ts's keydown handler), which the modal press
    // path does not touch: it still opens a collapsed map and closes an open one.
    const m = new Minimap();
    m.toggle();
    expect(m.state).toBe('expanded');
    m.toggle();
    expect(m.state).toBe('collapsed');

    // …including closing an overlay that a press opened, and opening one a press
    // dismissed — the two paths share one state and cannot disagree.
    const corner = centre(collapsedRect(DESKTOP, false));
    m.tap(corner.x, corner.y, DESKTOP, false);
    expect(m.state).toBe('expanded');
    m.toggle();
    expect(m.state).toBe('collapsed');
  });

  it('parity: pointer and touch agree on every answer, press for press', () => {
    // One code path serves both, so the two must produce identical verdicts for
    // the same sequence — the contract docs/input-parity.md signs for this element.
    const sequence = (viewport: { width: number; height: number }, isTouch: boolean): boolean[] => {
      const m = new Minimap();
      const corner = centre(collapsedRect(viewport, isTouch));
      const out = outsideBothRects(viewport, isTouch);
      const on = centre(expandedRect(viewport, isTouch));
      return [
        m.tap(out.x, out.y, viewport, isTouch), // collapsed + outside → falls through
        m.tap(corner.x, corner.y, viewport, isTouch), // on the corner → opens
        m.tap(out.x, out.y, viewport, isTouch), // expanded + outside → dismisses
        m.tap(corner.x, corner.y, viewport, isTouch), // on the corner → opens
        m.tap(on.x, on.y, viewport, isTouch), // expanded + on it → dismisses
        m.tap(out.x, out.y, viewport, isTouch), // collapsed again → falls through
      ];
    };
    const pc = sequence(DESKTOP, false);
    const touch = sequence(PHONE_WIDE, true);
    expect(pc).toEqual([false, true, true, true, true, false]);
    expect(touch).toEqual(pc);
  });
});
