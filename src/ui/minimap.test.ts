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
  minimapRect,
  minimapScene,
  pointInRect,
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
import type { MinimapFrame, MinimapShip, MinimapFog, MinimapCoverage } from './minimap';

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
