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
import {
  FS_AFFORDANCE_ANCHOR,
  FS_AFFORDANCE_ID,
  writeAffordanceRect,
} from '@render/fullscreen-affordance';
import { PING_BADGE_STACK_LIFT } from '../net/ping-badge';
import {
  ANCHOR_EDGES,
  CONTENT_BOUND_IDS,
  LAYOUT_RESERVATIONS,
  anchorEdges,
  anchorFrame,
  cornerRivals,
  describeCornerRival,
  describeReachViolation,
  edgeGap,
  reachViolations,
  reservationsFor,
  reservedPx,
  surfaceOf,
} from './anchor-reach';
import {
  glassCornerReserve,
  HUD_PAD,
  ORE_LABEL_LEADING,
  stationChromeHeight,
  stationHpBounds,
} from './hud-geometry';
import { contentBox } from './viewport';
import { hudMetrics, hudSpace, SCRIM_CORE } from './instrument';
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

  it("the banked total reserves the ore cluster's ground, plus the eyebrow above it", () => {
    // Two elements, one corner: `ore-hud` is the scrim GROUND and reaches the
    // margin; the numeral is a row inside it (a0-102 `oreCounterLayout`). The row
    // reads its container's rect rather than restating the arithmetic — so a
    // ground that grows because the player banked a fifth digit moves the
    // reservation with it.
    const m = hudMetrics(FRAME.width, FRAME.height);
    const ground: Rect = { x: 16, y: 16, width: 120, height: 90 };
    const ctx = { frame: FRAME, isTouch: true, boundsOf: (id: string) => (id === 'ore-hud' ? ground : undefined) };
    const pad = (1 - SCRIM_CORE) / 2;
    expect(reservedPx('banked-total', 'top', ctx)).toBeCloseTo(
      ground.height * pad + hudSpace(ORE_LABEL_LEADING, m),
      6,
    );
    expect(reservedPx('banked-total', 'left', ctx)).toBeCloseTo(ground.width * pad, 6);
  });

  it('a row whose container did not register reserves only what it can name', () => {
    // `ore-hud` absent (the HUD is hidden, or a caller handed one entry in): the
    // ground contributes nothing and the eyebrow still does. A rule about two
    // elements has nothing to say when only one of them is there — the same way
    // `./layout-exclusions` treats a missing half.
    const m = hudMetrics(FRAME.width, FRAME.height);
    expect(reservedPx('banked-total', 'top', { frame: FRAME, isTouch: true })).toBe(
      hudSpace(ORE_LABEL_LEADING, m),
    );
    expect(reservedPx('banked-total', 'left', { frame: FRAME, isTouch: true })).toBe(0);
  });

  it('an id with no row reserves nothing', () => {
    expect(reservedPx('station-hp', 'right', { frame: FRAME, isTouch: false })).toBe(0);
    expect(reservedPx('ore-hud', 'top', { frame: FRAME, isTouch: false })).toBe(0);
  });
});

/**
 * a0-125 D1 — the word the registry did not have.
 *
 * `station-hp` and `fullscreen-reenter` both declare `top-right`, and until a0-125
 * nothing anywhere could say that the first means the top-right of the CONTENT BOX
 * and the second the top-right of the GLASS. On a phone those are the same corner,
 * the button took 31% of the readout on 462 swept frames, and both halves of the
 * placement contract were green the whole time.
 */
describe('whose box does it go in — LayoutSurface (a0-125)', () => {
  /** The profile a0-122, a0-118, a0-114 and a0-111 all measured on. */
  const PHONE: Viewport = { width: 798, height: 384 };
  /** 32:9 — where the content box sits hundreds of px inside the glass (a0-74). */
  const ULTRAWIDE: Viewport = { width: 3840, height: 1080 };
  const glassRect = (vp: Viewport): Rect => ({ x: 0, y: 0, width: vp.width, height: vp.height });

  it('the HUD chrome is content-bound and the host chrome is not', () => {
    for (const id of CONTENT_BOUND_IDS) expect(surfaceOf(id)).toBe('content');
    // The three `main.ts` lays out against the logical viewport — the frame they
    // promised, and the frame the affordance's own margin 12 is measured from.
    expect(surfaceOf(FS_AFFORDANCE_ID)).toBe('glass');
    expect(surfaceOf('build-badge')).toBe('glass');
    expect(surfaceOf('net-ping')).toBe('glass');
  });

  it('anchorFrame hands each id the box it was laid out in', () => {
    const glass = glassRect(ULTRAWIDE);
    const content = contentBox(ULTRAWIDE);
    expect(anchorFrame('station-hp', glass, content)).toBe(content);
    expect(anchorFrame(FS_AFFORDANCE_ID, glass, content)).toBe(glass);
    // The case that hid the defect for so long: on a phone the two boxes ARE the
    // same rect, so the distinction costs nothing and says nothing — until two
    // elements reach the same corner from opposite sides of it.
    const phoneGlass = glassRect(PHONE);
    const phoneContent = contentBox(PHONE);
    expect(phoneContent).toEqual(phoneGlass);
  });

  it('the a0-125 D1 pair is exactly what cornerRivals names, before the fix', () => {
    // The pre-a0-125 geometry, stated as the two entries the registry really held:
    // HOME hard against the content box's right edge at HUD_PAD, the button hard
    // against the glass at its own margin 12.
    const glass = glassRect(PHONE);
    const content = contentBox(PHONE);
    const hp = stationHpBounds(content.width);
    const before: LayoutEntry[] = [
      { id: 'station-hp', anchor: { region: 'top-right', margin: HUD_PAD }, bounds: { ...hp, x: content.x + hp.x } },
      {
        id: FS_AFFORDANCE_ID,
        anchor: FS_AFFORDANCE_ANCHOR,
        bounds: writeAffordanceRect(PHONE.width, PHONE.height, { x: 0, y: 0, width: 0, height: 0 }),
      },
    ];
    // Both halves of a0-103's contract pass on this frame. That is the finding.
    for (const e of before) {
      expect(rectContains(resolveAnchor(e.anchor, PHONE), e.bounds)).toBe(true);
    }
    expect(reachViolations(before, PHONE, { isTouch: true, frameFor: (id) => (surfaceOf(id) === 'content' ? content : undefined) })).toEqual([]);

    const rivals = cornerRivals(before, glass, content);
    expect(rivals).toHaveLength(1);
    expect(rivals[0]!.region).toBe('top-right');
    expect(new Set([rivals[0]!.surfaceA, rivals[0]!.surfaceB])).toEqual(new Set(['glass', 'content']));
    // a0-122's own measurement: 44x30 of a 140x30 readout.
    expect(rivals[0]!.overlap.width).toBeCloseTo(44, 6);
    expect(rivals[0]!.overlap.height).toBeCloseTo(30, 6);
    expect(describeCornerRival(rivals[0]!)).toContain('top-right');
  });

  it('…and nothing it names once the column has stepped aside', () => {
    const glass = glassRect(PHONE);
    const content = contentBox(PHONE);
    const reserve = glassCornerReserve(PHONE.width, content.x + content.width, true);
    expect(reserve).toBeGreaterThan(0);
    const hp = stationHpBounds(content.width);
    const after: LayoutEntry[] = [
      {
        id: 'station-hp',
        anchor: { region: 'top-right', margin: HUD_PAD },
        bounds: { ...hp, x: content.x + hp.x - reserve },
      },
      {
        id: FS_AFFORDANCE_ID,
        anchor: FS_AFFORDANCE_ANCHOR,
        bounds: writeAffordanceRect(PHONE.width, PHONE.height, { x: 0, y: 0, width: 0, height: 0 }),
      },
    ];
    expect(cornerRivals(after, glass, content)).toEqual([]);
    // …and the gap it now leaves is a DECLARED one, not drift: the reach check
    // still passes, because the reservation row speaks for exactly this many px.
    expect(
      reachViolations(after, PHONE, {
        isTouch: true,
        affordanceUp: true,
        frameFor: (id) => (surfaceOf(id) === 'content' ? content : undefined),
      }),
    ).toEqual([]);
    // With the button down, the same gap is unexplained and the check says so —
    // which is what stops the column from quietly staying out of its corner.
    expect(
      reachViolations(after, PHONE, {
        isTouch: true,
        affordanceUp: false,
        frameFor: (id) => (surfaceOf(id) === 'content' ? content : undefined),
      }).map((v) => `${v.id}|${v.edge}`),
    ).toEqual(['station-hp|right']);
  });

  it('the two corners are hundreds of px apart at 32:9, and the reserve is zero', () => {
    // Both of the reasons a0-125 was told to preserve, as one assertion: the
    // ultrawides are clean because the content box is nowhere near the glass, so a
    // fix that moved something on all four profiles would be the bug.
    const content = contentBox(ULTRAWIDE);
    expect(glassCornerReserve(ULTRAWIDE.width, content.x + content.width, true)).toBe(0);
    expect(reservedPx('station-hp', 'right', { frame: content, glassWidth: ULTRAWIDE.width, isTouch: true, affordanceUp: true })).toBe(0);
  });

  it('HOME and the VIEW chip reserve the same number, so the column stays a column', () => {
    const content = contentBox(PHONE);
    const ctx = { frame: content, glassWidth: PHONE.width, isTouch: true, affordanceUp: true };
    const home = reservedPx('station-hp', 'right', ctx);
    expect(home).toBeGreaterThan(0);
    expect(reservedPx('zoom-control', 'right', ctx)).toBe(home);
    // …and nothing at all while the button is down (a0-103: reserved when the
    // element is there, and not otherwise).
    const down = { ...ctx, affordanceUp: false };
    expect(reservedPx('station-hp', 'right', down)).toBe(0);
    expect(reservedPx('zoom-control', 'right', down)).toBe(0);
  });

  it('an element with no edge promise is never a rival', () => {
    // `full` and `center` name a zone and claim no bezel, so two of them sharing a
    // region is not the question this check asks (ANCHOR_EDGES, the header's §1).
    const glass: Rect = { x: 0, y: 0, width: 798, height: 384 };
    const entries: LayoutEntry[] = [
      { id: 'onboarding', anchor: { region: 'full', margin: 16 }, bounds: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'ore-hud', anchor: { region: 'full', margin: 16 }, bounds: { x: 0, y: 0, width: 100, height: 100 } },
    ];
    expect(cornerRivals(entries, glass, glass)).toEqual([]);
  });
});
