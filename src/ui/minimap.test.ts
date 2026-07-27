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
 *  - **The scene** — planets are owner-coloured (a wreck neutral), the local
 *    ship is highlighted and separated from the enemy dots, a spawn-protected
 *    ship dims, a dead ship drops off, ore hints are faint signal-yellow, and the
 *    collapse ring scales with the fit.
 *  - **The toggle is one code path for click and tap** — the input-parity
 *    contract this element signs (docs/input-parity.md): a click (PC) and a tap
 *    (mobile) both reach {@link Minimap.tap} and both flip the state, and the PC
 *    shortcut is `M` ({@link MINIMAP_TOGGLE_KEY}).
 */
import { describe, it, expect } from 'vitest';
import { PALETTE } from '@render/index';
import { resolveAnchor, rectContains } from '@platform/layout-registry';
import type { AnchorSpec } from '@platform/layout-registry';
import { playerColor } from './planet-hp';
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
  MINIMAP_ACTION_RESERVE_FRACTION,
  MINIMAP_BOTTOM_SAFE_FRACTION,
  MINIMAP_DOT_ALPHA,
  MINIMAP_DERELICT_ALPHA,
  MINIMAP_SPAWN_PROTECT_ALPHA,
  MINIMAP_ORE_ALPHA,
} from './minimap';
import type { MinimapFrame, MinimapShip } from './minimap';

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
    planets: [{ owner: 0, x: 100, y: 100, alive: true }],
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

  it('reserves the bottom-right ACTION corner — its right edge clears the fire column', () => {
    // The extreme bottom-right is the FIRE / aim thumb (touch) and the desktop
    // "no touch affordance" probe (REGION_FIRE, x ≥ 0.7·W). The square is pulled
    // left of it, so its right edge sits at/inside W·(1 - action reserve): it never
    // draws onto the fire control nor reads as one. (PR #147: the collapsed square
    // overlapped the FIRE button on touch and lit REGION_FIRE on desktop.)
    for (const [name, vp, touch] of [
      ['phone-wide', PHONE_WIDE, true],
      ['desktop', DESKTOP, false],
    ] as const) {
      const rect = collapsedRect(vp, touch);
      const reservedRightEdge = vp.width * (1 - MINIMAP_ACTION_RESERVE_FRACTION);
      expect(rect.x + rect.width, `${name}: right edge clears the action column`).toBeLessThanOrEqual(
        reservedRightEdge + 0.5,
      );
      // Still in the RIGHT half — it is a bottom-RIGHT map, not a centred one.
      expect(rect.x + rect.width, `${name}: still in the right half`).toBeGreaterThan(vp.width / 2);
    }
  });

  it('touch: the collapsed square lifts off the very-bottom strip band', () => {
    // A steel frame in the y ≥ 0.95·H band reads as a controls strip to the "strip
    // ABSENT on touch" probe (REGION_STRIP_MID). The square's bottom stays above
    // the strip-safe line so it never does.
    const rect = collapsedRect(PHONE_WIDE, true);
    expect(rect.y + rect.height).toBeLessThanOrEqual(PHONE_WIDE.height * MINIMAP_BOTTOM_SAFE_FRACTION + 0.5);
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
  it('an owned planet takes its owner colour; a wreck goes neutral steel + dim', () => {
    const scene = minimapScene(
      frame({
        planets: [
          { owner: 2, x: 0, y: 0, alive: true },
          { owner: 3, x: 1000, y: 1000, alive: false },
        ],
      }),
      RECT,
    );
    expect(scene.planetDots[0]!.color).toBe(playerColor(2));
    expect(scene.planetDots[0]!.alpha).toBe(MINIMAP_DOT_ALPHA);
    expect(scene.planetDots[1]!.color).toBe(PALETTE.hullSteel);
    expect(scene.planetDots[1]!.alpha).toBe(MINIMAP_DERELICT_ALPHA);
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

  it('places a planet dot at the projected map position', () => {
    const scene = minimapScene(frame({ planets: [{ owner: 0, x: 250, y: 750, alive: true }] }), RECT);
    // scale 0.2, offset 0 → (50, 150).
    expect(scene.planetDots[0]!.x).toBeCloseTo(50);
    expect(scene.planetDots[0]!.y).toBeCloseTo(150);
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
