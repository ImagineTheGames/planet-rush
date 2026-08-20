/**
 * src/ui/anchor-reach.test.ts — the reach check's own suite. OWNER: UI Engineer.
 *
 * `./minimap.test.ts` runs the check over the whole registry at every profile;
 * this file tests the check itself — the table, the arithmetic, and the two
 * numbers it mirrors out of modules it cannot import (see `./anchor-reach`'s
 * header on why it stays Pixi-free).
 */
import { describe, expect, it } from 'vitest';
import type { AnchorRegion, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { resolveAnchor, rectContains } from '@platform/layout-registry';
import { BADGE_STRIP_LIFT } from '@render/build-badge';
import { PING_BADGE_STACK_LIFT } from '../net/ping-badge';
import {
  ANCHOR_EDGES,
  LAYOUT_RESERVATIONS,
  anchorEdges,
  describeReachViolation,
  edgeGap,
  reachViolations,
  reservationsFor,
  reservedPx,
} from './anchor-reach';
import { stationChromeHeight, TOTAL_LABEL_H } from './hud-geometry';
import { hudMetrics, hudSpace } from './instrument';
import { MINIMAP_FIRE_COLUMN, MINIMAP_STRIP_CLEARANCE } from './minimap';
import { ZOOM_CONTROL_GAP } from './zoom-control';

const ALL_REGIONS: readonly AnchorRegion[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'bottom-strip',
  'left-half-bottom',
  'right-half-bottom',
  'center',
  'full',
];

const VP: Viewport = { width: 798, height: 384 };
const FRAME: Rect = { x: 0, y: 0, width: VP.width, height: VP.height };

describe('ANCHOR_EDGES — which regions promise an edge', () => {
  it('has a row for every region in the ratified vocabulary', () => {
    // A region added upstairs with no row here would silently promise nothing,
    // which is the failure mode this whole module exists to retire.
    expect(Object.keys(ANCHOR_EDGES).sort()).toEqual([...ALL_REGIONS].sort());
  });

  it('the four corners promise both of their edges', () => {
    expect(anchorEdges('top-left')).toEqual(['left', 'top']);
    expect(anchorEdges('top-right')).toEqual(['right', 'top']);
    expect(anchorEdges('bottom-left')).toEqual(['left', 'bottom']);
    expect(anchorEdges('bottom-right')).toEqual(['right', 'bottom']);
  });

  it('the two edge-named bands promise the one edge they name', () => {
    expect(anchorEdges('top-center')).toEqual(['top']);
    expect(anchorEdges('bottom-center')).toEqual(['bottom']);
  });

  it('zone regions promise nothing, and the exemptions are exactly these five', () => {
    const exempt = ALL_REGIONS.filter((r) => anchorEdges(r).length === 0);
    expect(exempt.sort()).toEqual(
      ['bottom-strip', 'center', 'full', 'left-half-bottom', 'right-half-bottom'].sort(),
    );
  });

  it("`bottom-strip`'s zone already pins it, which is why it is exempt", () => {
    // The exemption is only honest if containment does the job instead. A rect
    // inside the band is within `stripHeight` of the bottom edge by construction.
    const zone = resolveAnchor({ region: 'bottom-strip', margin: 0 }, VP, { stripHeight: 48 });
    const inside: Rect = { x: 0, y: zone.y, width: VP.width, height: zone.height };
    expect(rectContains(zone, inside)).toBe(true);
    expect(edgeGap(inside, FRAME, 'bottom')).toBeLessThanOrEqual(48);
  });
});

describe('edgeGap — clear space to one side of the frame', () => {
  const r: Rect = { x: 10, y: 20, width: 100, height: 50 };
  it('measures each side against the frame, not the origin', () => {
    const frame: Rect = { x: 5, y: 5, width: 200, height: 200 };
    expect(edgeGap(r, frame, 'left')).toBe(5);
    expect(edgeGap(r, frame, 'top')).toBe(15);
    expect(edgeGap(r, frame, 'right')).toBe(95);
    expect(edgeGap(r, frame, 'bottom')).toBe(135);
  });

  it('goes negative when the element hangs off — containment\'s finding, not ours', () => {
    const frame: Rect = { x: 0, y: 0, width: 50, height: 50 };
    expect(edgeGap(r, frame, 'right')).toBe(-60);
    // …and this module stays silent about it: reach only fails on too much air.
    const entry: LayoutEntry = {
      id: 'overflowing',
      anchor: { region: 'bottom-right', margin: 0 },
      bounds: r,
    };
    expect(reachViolations([entry], { width: 50, height: 50 })).toEqual([]);
  });
});

describe('reachViolations', () => {
  const square = (fromRight: number, fromBottom: number): LayoutEntry => ({
    id: 'probe',
    anchor: { region: 'bottom-right', margin: 12 },
    bounds: {
      x: VP.width - fromRight - 80,
      y: VP.height - fromBottom - 80,
      width: 80,
      height: 80,
    },
  });

  it('is silent when the element sits exactly on its margin', () => {
    expect(reachViolations([square(12, 12)], VP)).toEqual([]);
  });

  it('reports each missed edge separately', () => {
    const v = reachViolations([square(132, 52)], VP);
    expect(v.map((x) => x.edge)).toEqual(['right', 'bottom']);
    expect(v[0]!.gap).toBe(132);
    expect(v[0]!.allowed).toBe(12);
    expect(v[1]!.gap).toBe(52);
  });

  it('skips regions that promise no edge rather than passing them vacuously', () => {
    const overlay: LayoutEntry = {
      id: 'onboarding',
      anchor: { region: 'full', margin: 16 },
      bounds: { x: 300, y: 150, width: 200, height: 40 },
    };
    expect(reachViolations([overlay], VP)).toEqual([]);
  });

  it('honours the tolerance, so sub-pixel rounding never trips it', () => {
    expect(reachViolations([square(12.4, 12.4)], VP)).toEqual([]);
    expect(reachViolations([square(12.6, 12)], VP)).toHaveLength(1);
  });

  it('measures against the frame `frameFor` names, not the viewport', () => {
    const box: Rect = { x: 200, y: 0, width: 398, height: 384 };
    const entry: LayoutEntry = {
      id: 'boxed',
      anchor: { region: 'bottom-right', margin: 12 },
      bounds: { x: 506, y: 292, width: 80, height: 80 },
    };
    expect(reachViolations([entry], VP, { frameFor: () => box })).toEqual([]);
    expect(reachViolations([entry], VP).map((v) => v.edge)).toEqual(['right']);
  });

  it('the message names the element, the edge, the numbers and the reason', () => {
    const v = reachViolations([{ ...square(132, 12), id: 'minimap' }], VP, { isTouch: true })[0]!;
    const line = describeReachViolation(v);
    expect(line).toContain('"minimap"');
    expect(line).toContain('bottom-right');
    expect(line).toContain('132.0');
    expect(line).toContain('right edge');
  });
});

describe('LAYOUT_RESERVATIONS — every declared gap, and every number it mirrors', () => {
  it('every row carries an argument', () => {
    for (const r of LAYOUT_RESERVATIONS) {
      expect(r.why.length, `${r.id}/${r.edge} has no reason`).toBeGreaterThan(40);
    }
  });

  it('no row claims a negative allowance', () => {
    for (const r of LAYOUT_RESERVATIONS) {
      for (const isTouch of [true, false]) {
        expect(r.px({ frame: FRAME, isTouch })).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('the two badge lifts equal the constants they mirror', () => {
    // `./anchor-reach` cannot import these: both modules carry PixiJS and that
    // file is deliberately Pixi-free. So the mirror is pinned here instead —
    // change `BADGE_STRIP_LIFT` at the drawing end and this fails, rather than
    // the reservation quietly under-claiming and the sweep going red for the
    // wrong reason.
    expect(reservedPx('build-badge', 'bottom', { frame: FRAME, isTouch: false })).toBe(
      BADGE_STRIP_LIFT,
    );
    expect(reservedPx('net-ping', 'bottom', { frame: FRAME, isTouch: false })).toBe(
      BADGE_STRIP_LIFT + PING_BADGE_STACK_LIFT,
    );
  });

  it('the strip reservations vanish on touch, where no strip is drawn', () => {
    expect(reservedPx('build-badge', 'bottom', { frame: FRAME, isTouch: true })).toBe(0);
    expect(reservedPx('minimap', 'bottom', { frame: FRAME, isTouch: true })).toBe(0);
    expect(reservedPx('net-ping', 'bottom', { frame: FRAME, isTouch: true })).toBe(
      PING_BADGE_STACK_LIFT,
    );
  });

  it('the minimap reserves exactly the desktop strip clearance and nothing else', () => {
    expect(reservedPx('minimap', 'bottom', { frame: FRAME, isTouch: false })).toBe(
      MINIMAP_STRIP_CLEARANCE,
    );
  });

  it('the fire column is reserved by FIRE being there, not by the build being touch', () => {
    // The whole of a0-103. `isTouch` buys nothing on the right edge — the button
    // has to actually be drawn, which under Tap Commander (a0-30's default
    // everywhere) and in Manual mode it is not.
    for (const isTouch of [true, false]) {
      expect(reservedPx('minimap', 'right', { frame: FRAME, isTouch })).toBe(0);
      expect(reservedPx('minimap', 'right', { frame: FRAME, isTouch, fireCorner: false })).toBe(0);
    }
    expect(
      reservedPx('minimap', 'right', { frame: FRAME, isTouch: true, fireCorner: true }),
    ).toBe(MINIMAP_FIRE_COLUMN);
    // …and the row that says so carries the argument, so the 132 px is never a
    // number nothing explains again.
    const [row] = reservationsFor('minimap', 'right');
    expect(row?.why).toContain('FIRE');
  });

  it("the zoom control reserves HOME's chrome plus its own air, at any scale", () => {
    for (const frame of [FRAME, { x: 0, y: 0, width: 1280, height: 720 }] as const) {
      const m = hudMetrics(frame.width, frame.height);
      expect(reservedPx('zoom-control', 'top', { frame, isTouch: true })).toBeCloseTo(
        stationChromeHeight(m.scale) + hudSpace(ZOOM_CONTROL_GAP, m),
        6,
      );
    }
  });

  it('the banked total reserves exactly the TOTAL eyebrow above it', () => {
    const m = hudMetrics(FRAME.width, FRAME.height);
    expect(reservedPx('banked-total', 'top', { frame: FRAME, isTouch: true })).toBe(
      hudSpace(TOTAL_LABEL_H, m),
    );
  });

  it('an id with no row reserves nothing', () => {
    expect(reservedPx('station-hp', 'right', { frame: FRAME, isTouch: false })).toBe(0);
    expect(reservedPx('ore-hud', 'top', { frame: FRAME, isTouch: false })).toBe(0);
  });
});
