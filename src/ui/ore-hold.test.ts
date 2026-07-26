/**
 * Under-ship ore-hold indicator tests (field rule). The held-ore squares moved
 * out of the top-left and under the ship: a compact hold indicator that follows
 * the local ship in screen space, one pip per cargo slot, visible while carrying
 * or mining, hidden when the hold is empty and idle. Position-tested against the
 * layout registry's own resolver across QA's phone profiles, the same headless
 * discipline the M2 overlays get in hud-geometry.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { resolveAnchor, rectContains } from '@platform/layout-registry';
import type { AnchorSpec, Viewport } from '@platform/layout-registry';
import {
  holdShown,
  oreHoldModel,
  oreHoldRowWidth,
  oreHoldBounds,
  ORE_HOLD_PIP,
  ORE_HOLD_PIP_GAP,
  ORE_HOLD_SHIP_GAP,
} from './ore-hold';
import { ORE_HOLD_ANCHOR } from './ore-hold-view';

describe('holdShown — when the under-ship indicator is visible', () => {
  it('shows while the hold has ore', () => {
    expect(holdShown(1, 2, false)).toBe(true);
    expect(holdShown(0.5, 2, false)).toBe(true); // a partial chunk still counts
  });

  it('shows while mining even with an empty hold (teaches capacity)', () => {
    expect(holdShown(0, 2, true)).toBe(true);
  });

  it('hides when the hold is empty and the ship is idle', () => {
    expect(holdShown(0, 2, false)).toBe(false);
  });

  it('never shows without a hold (cargoCap 0 ⇒ nothing to carry)', () => {
    expect(holdShown(0, 0, true)).toBe(false);
    expect(holdShown(3, 0, false)).toBe(false);
  });
});

describe('oreHoldModel — pips from sim hold, placed under the ship', () => {
  it('is null when hidden', () => {
    expect(oreHoldModel(0, 2, false, 200, 300, 14)).toBeNull();
  });

  it('draws one pip per cargo slot, filled per whole ore held', () => {
    const m = oreHoldModel(1, 2, false, 200, 300, 14)!;
    expect(m.slots).toBe(2);
    expect(m.filled).toBe(1);
  });

  it('shares the top-left model’s slot/fill rule (clamp + floor)', () => {
    // Never overflow the row; fractional ore floors to whole pips — the same rule
    // oreHudModel enforces for the total, so the two ore readouts cannot disagree.
    expect(oreHoldModel(5, 2, false, 0, 0, 10)!.filled).toBe(2);
    expect(oreHoldModel(1.9, 3, false, 0, 0, 10)!.filled).toBe(1);
  });

  it('flags a full hold so the row can flash (GDD §2.2)', () => {
    expect(oreHoldModel(2, 2, false, 0, 0, 10)!.full).toBe(true);
    expect(oreHoldModel(1, 2, false, 0, 0, 10)!.full).toBe(false);
  });

  it('centres the row on the ship and floats it below the hull', () => {
    const shipX = 400;
    const shipY = 300;
    const radius = 14;
    const m = oreHoldModel(1, 2, false, shipX, shipY, radius)!;
    expect(m.x).toBe(shipX);
    // Top edge is below the ship's bottom by the clearance gap.
    expect(m.y).toBe(shipY + radius + ORE_HOLD_SHIP_GAP);
    const b = oreHoldBounds(m);
    // The row is horizontally centred on the ship.
    expect(b.x + b.width / 2).toBeCloseTo(shipX, 6);
    // And it genuinely sits *under* the ship (top below the ship centre).
    expect(b.y).toBeGreaterThan(shipY);
  });
});

describe('oreHoldRowWidth — pips plus inter-pip gaps', () => {
  it('is empty for zero slots', () => {
    expect(oreHoldRowWidth(0)).toBe(0);
  });

  it('sums pips and the gaps between them', () => {
    expect(oreHoldRowWidth(1)).toBe(ORE_HOLD_PIP);
    expect(oreHoldRowWidth(2)).toBe(2 * ORE_HOLD_PIP + ORE_HOLD_PIP_GAP);
    expect(oreHoldRowWidth(8)).toBe(8 * ORE_HOLD_PIP + 7 * ORE_HOLD_PIP_GAP);
  });
});

// ---------------------------------------------------------------------------
// Placement — registered `full`, so like the health bars it must never leave the
// screen. The ship is at the viewport centre (the follow camera), so we test the
// worst realistic case: a maxed hold (8 slots, GDD §2.8 cap) under the ship.
// ---------------------------------------------------------------------------

interface Profile {
  readonly name: string;
  readonly vp: Viewport;
}

const PROFILES: readonly Profile[] = [
  { name: 'iphone/portrait', vp: { width: 390, height: 844 } },
  { name: 'iphone/landscape', vp: { width: 844, height: 390 } },
  { name: 'pixel/portrait', vp: { width: 412, height: 915 } },
  { name: 'pixel/landscape', vp: { width: 915, height: 412 } },
  { name: 'desktop', vp: { width: 1280, height: 800 } },
  { name: 'iphone-se/portrait', vp: { width: 375, height: 667 } },
  { name: 'small/portrait', vp: { width: 320, height: 568 } },
];

const FULL: AnchorSpec = ORE_HOLD_ANCHOR;

describe('ore-hold placement (position-tested, phone profiles)', () => {
  const MAX_SLOTS = 8; // GDD §2.8 cargo cap
  const SHIP_RADIUS = 14;

  for (const { name, vp } of PROFILES) {
    it(`stays on screen under the centred ship at ${name}`, () => {
      const m = oreHoldModel(MAX_SLOTS, MAX_SLOTS, false, vp.width / 2, vp.height / 2, SHIP_RADIUS)!;
      const zone = resolveAnchor(FULL, vp);
      expect(
        rectContains(zone, oreHoldBounds(m)),
        `${name}: hold row escapes the "full" zone`,
      ).toBe(true);
    });
  }

  it('registers under `full`, the same anchor the health-bar layer uses', () => {
    // It follows the ship anywhere on screen, so no third-width band can hold it —
    // `full` is the honest region, mirroring the health bars and the alarm arrow.
    expect(FULL.region).toBe('full');
  });
});
