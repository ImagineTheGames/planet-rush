/**
 * src/ui/build-wheel-view.test.ts — what the wheel's chrome must NOT contain.
 *
 * ── Why this file exists (a0-21) ────────────────────────────────────────────
 *
 * The developer, pointing at the build wheel: *"what is this line in the build
 * wheel, what happened here..."* A horizontal hairline ran from the hub's edge
 * out to the outer ring at the wheel's vertical centre, just under `OPEN ▸` —
 * through the MIDDLE of the UPGRADE SHIP wedge, which is the one segment it can
 * never be a boundary of (five segments put its real boundaries on the two
 * diagonals visible above and below it).
 *
 * It had been in the committed golden since the disc was built, and every
 * re-baseline since looked past it. That is the point of this file: **a golden
 * proves a frame is the frame we last approved; it cannot prove the frame does
 * not contain something nobody meant to draw.** A reviewer approves an image
 * without knowing what it should not contain, and this line was drawn in the
 * rim's own tone at the rim's own weight, so it read as deliberate.
 *
 * ── What it asserts ─────────────────────────────────────────────────────────
 *
 * Not pixels — geometry. {@link drawWheelRings} and {@link drawWheelSpokes} are
 * module-level and take a bare `Graphics`, which needs no DOM, so this suite
 * draws the real disc and then reads back every line Pixi actually put in the
 * path. The invariant is the one u11-01 already stated in prose and nothing
 * enforced: **the spokes are the ONLY things dividing one wedge from the next**,
 * so nothing else may cross a wedge face.
 */
import { describe, it, expect } from 'vitest';
import { Container, DOMAdapter, Graphics } from 'pixi.js';
import { wheelMetrics } from '../art/materials';
import { BuildWheelView, drawWheelRings, drawWheelSelection, drawWheelSpokes } from './build-wheel-view';
import { buildWheelModel, SEGMENT_ARC, WHEEL_ORDER, segmentAngle } from './build-wheel';
import type { BuildWheelSignals } from './build-wheel';
import { STOCK_TIERS, upgradeWedgeAngle, upgradeWedgeArc, upgradeWheelModel } from './upgrade-wheel';
import { wheelRadius } from './hud-geometry';
import { WHEEL_SELECTION } from './instrument';
import { ShipClass } from '@shared/types';

/** The desktop wheel radius the goldens are taken at, near enough. */
const R = 235;

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** The chrome as one Graphics, exactly as {@link BuildWheelView} draws it. */
function drawWheel(count = WHEEL_ORDER.length): { g: Graphics; inner: number } {
  const m = wheelMetrics(R);
  const inner = R * m.hub;
  const g = new Graphics();
  drawWheelRings(g, R, inner, m);
  drawWheelSpokes(g, inner, R, count, m);
  return { g, inner };
}

/**
 * Every straight line segment Pixi ended up with, in wheel-local coordinates.
 *
 * Read off the built path rather than off our own call list on purpose — the
 * a0-21 line was never in anyone's call list. It was a connector Pixi inserted
 * between an open path point and an `arc()`'s start, which is exactly the class
 * of mark that only shows up once you look at what was *built*.
 *
 * Circles and other shape primitives are left out: they are radially symmetric,
 * so they cannot bisect a wedge, and the vignette is made of them.
 */
function drawnSegments(g: Graphics): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (const ins of g.context.instructions) {
    const path = (ins.data as { path?: { shapePath: { shapePrimitives: { shape: unknown }[] } } })
      .path;
    if (!path) continue;
    for (const prim of path.shapePath.shapePrimitives) {
      const pts = (prim.shape as { points?: number[] }).points;
      if (!pts) continue;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const a = { x: pts[i] ?? NaN, y: pts[i + 1] ?? NaN };
        const b = { x: pts[i + 2] ?? NaN, y: pts[i + 3] ?? NaN };
        // A path re-opened after a stroke can carry a non-finite start point;
        // it draws nothing, so it is not evidence either way.
        if (!Number.isFinite(a.x + a.y + b.x + b.y)) continue;
        out.push([a, b]);
      }
    }
  }
  return out;
}

/** Points along one drawn segment, dense enough that a radius-long line cannot
 *  step over the face band it crosses. */
function samples([a, b]: [Pt, Pt]): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len));
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Smallest angular distance from `angle` to any of the five segment boundaries,
 *  in radians. The boundaries sit half an arc off each segment centre. */
function offBoundary(angle: number, count: number): number {
  const arc = (2 * Math.PI) / count;
  let best = Math.PI;
  for (let i = 0; i < count; i++) {
    const b = -Math.PI / 2 + arc * (i + 0.5);
    let d = Math.abs(((angle - b + Math.PI) % (2 * Math.PI)) - Math.PI + 2 * Math.PI) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    best = Math.min(best, d);
  }
  return best;
}

/** Distance from a point to a drawn segment — how close a line passes to a probe. */
function distanceToSegment(p: Pt, [a, b]: [Pt, Pt]): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

describe('the wheel disc draws nothing across a wedge face', () => {
  /**
   * The general law, and the one u11-01 asserted only in prose: between the hub
   * ring and the disc rim, the five spokes are the whole of the chrome.
   *
   * The band is the middle 70% of the face, which keeps the rim arcs, the index
   * diamond and the hub ring — all legitimately drawn at one end or the other —
   * out of the question being asked, and still catches anything that spans the
   * face. The a0-21 line spanned all of it.
   */
  it('puts no line on the face except the five segment boundaries', () => {
    const { g, inner } = drawWheel();
    const span = R - inner;
    const lo = inner + span * 0.15;
    const hi = R - span * 0.15;
    // A spoke is 1.5 px wide at this radius; a whole degree is ~3 px out at the
    // rim, so this tolerance is generous to a boundary and still damning of a
    // line 18° off one.
    const tol = (2 * Math.PI) / 360;

    const strays: string[] = [];
    for (const seg of drawnSegments(g)) {
      for (const p of samples(seg)) {
        const rad = Math.hypot(p.x, p.y);
        if (rad < lo || rad > hi) continue;
        const angle = Math.atan2(p.y, p.x);
        if (offBoundary(angle, WHEEL_ORDER.length) <= tol) continue;
        const deg = ((angle * 180) / Math.PI + 360) % 360;
        strays.push(`r=${rad.toFixed(1)} at ${deg.toFixed(1)}°`);
      }
    }
    expect(strays.slice(0, 4)).toEqual([]);
  });

  /**
   * The report itself, named. The line the developer saw ran horizontally out of
   * the hub's left edge to the rim — 180°, dead in the interior of UPGRADE SHIP
   * (segment 4, centred at 198°). Probing that ray directly means this test says
   * out loud what it is defending, and would fail on its own if the general law
   * above were ever relaxed.
   */
  it('leaves the UPGRADE SHIP wedge unbisected at nine o’clock', () => {
    const { g, inner } = drawWheel();
    const segments = drawnSegments(g);
    // Nine o'clock is inside segment 4's arc but is not its centre and is nowhere
    // near either of its boundaries — the line was a bisector of a segment, not
    // an edge of one.
    const upgrade = segmentAngle(WHEEL_ORDER.indexOf('upgrade'));
    expect(Math.abs(upgrade - Math.PI)).toBeLessThan(SEGMENT_ARC / 2);

    for (const t of [0.25, 0.5, 0.75]) {
      const probe = { x: -(inner + (R - inner) * t), y: 0 };
      const nearest = Math.min(...segments.map((s) => distanceToSegment(probe, s)));
      expect(nearest).toBeGreaterThan(2);
    }
  });

  /** The spokes themselves are still drawn — the guard above must not be
   *  satisfiable by drawing nothing at all. */
  it('still draws one spoke per segment boundary', () => {
    const { g, inner } = drawWheel();
    const span = R - inner;
    const mid = inner + span / 2;
    const arc = (2 * Math.PI) / WHEEL_ORDER.length;
    const segments = drawnSegments(g);
    for (let i = 0; i < WHEEL_ORDER.length; i++) {
      const a = -Math.PI / 2 + arc * (i + 0.5);
      const probe = { x: Math.cos(a) * mid, y: Math.sin(a) * mid };
      const nearest = Math.min(...segments.map((s) => distanceToSegment(probe, s)));
      expect(nearest).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// The highlighted wedge (u16-01) — a NEW layer that draws inside a wedge face
// ---------------------------------------------------------------------------
//
// The law above says nothing crosses a wedge face. The selection highlight is
// the first thing in this wheel's life that is *supposed* to draw across one —
// so it needs the law restated rather than exempted, and the restatement is the
// interesting one:
//
//   > the highlight may cover the wedge it is on, and NOTHING else.
//
// A highlight that leaks into a neighbour is worse than no highlight, because it
// tells the player a press will land somewhere it will not. And this is exactly
// the class of defect a golden cannot answer: a 0.26-alpha white lift spread one
// wedge too far still photographs as "the highlight is there".

/** The selection layer alone, at `angle`, as a bare Graphics. */
function drawSelection(angle: number, presence = 1): { g: Graphics; inner: number } {
  const m = wheelMetrics(R);
  const inner = R * m.hub;
  const g = new Graphics();
  drawWheelSelection(g, R, inner, m, angle, SEGMENT_ARC, presence);
  return { g, inner };
}

/**
 * The furthest any drawn ink reaches from the wheel's centre.
 *
 * Deliberately not `getLocalBounds()`: that is an axis-aligned box, and the
 * corner of a box around a quadrant is a good deal further out than any pixel in
 * it — the question here is a RADIUS. Circles count, unlike in
 * {@link drawnSegments}, because the bloom behind the selected name is one and it
 * is precisely the thing that can reach past the rim.
 */
function maxReach(g: Graphics): number {
  let worst = 0;
  for (const ins of g.context.instructions) {
    const path = (ins.data as { path?: { shapePath: { shapePrimitives: { shape: unknown }[] } } })
      .path;
    if (!path) continue;
    for (const prim of path.shapePath.shapePrimitives) {
      const shape = prim.shape as { points?: number[]; x?: number; y?: number; radius?: number };
      if (shape.points) {
        for (let i = 0; i + 1 < shape.points.length; i += 2) {
          const x = shape.points[i] ?? 0;
          const y = shape.points[i + 1] ?? 0;
          if (Number.isFinite(x + y)) worst = Math.max(worst, Math.hypot(x, y));
        }
      } else if (typeof shape.radius === 'number') {
        worst = Math.max(worst, Math.hypot(shape.x ?? 0, shape.y ?? 0) + shape.radius);
      }
    }
  }
  return worst;
}

/** How far `angle` is from the highlight's centre, radians, unsigned. */
function offCentre(angle: number, centre: number): number {
  let d = Math.abs(((angle - centre + Math.PI) % (2 * Math.PI)) - Math.PI + 2 * Math.PI) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

describe('the highlight covers the wedge it is on, and nothing else', () => {
  /** Half a wedge, plus the widest the edge-line bloom is allowed to reach past
   *  the boundary it sits on ({@link WHEEL_SELECTION}), plus a degree of slack
   *  for the polygonisation of an arc. Anything beyond this is a leak. */
  const REACH =
    SEGMENT_ARC / 2 +
    ((WHEEL_SELECTION.edgeDegrees / 2) * WHEEL_SELECTION.edgeGlowSpread * Math.PI) / 180 +
    Math.PI / 180;

  for (let i = 0; i < WHEEL_ORDER.length; i++) {
    it(`stays on wedge ${i} (${WHEEL_ORDER[i]})`, () => {
      const centre = segmentAngle(i);
      const { g } = drawSelection(centre);
      const strays: string[] = [];
      for (const seg of drawnSegments(g)) {
        for (const p of samples(seg)) {
          const rad = Math.hypot(p.x, p.y);
          if (rad < 1) continue; // a path's own origin point draws nothing
          const off = offCentre(Math.atan2(p.y, p.x), centre);
          if (off <= REACH) continue;
          strays.push(`r=${rad.toFixed(1)} at ${((off * 180) / Math.PI).toFixed(1)}° off centre`);
        }
      }
      expect(strays.slice(0, 4)).toEqual([]);
    });
  }

  it('stays inside the ring — never over the hub, never out past the rim', () => {
    // The bloom behind the name is scaled off the type, and on the phone profile
    // an unclamped one reaches past the rim into the halo: a glow with no wheel
    // under it, on the one part of this screen that is meant to have no edge.
    for (const radius of [235, 140, 90]) {
      const m = wheelMetrics(radius);
      const inner = radius * m.hub;
      const g = new Graphics();
      drawWheelSelection(g, radius, inner, m, segmentAngle(0), SEGMENT_ARC, 1);
      expect(maxReach(g), `the highlight spills past the rim at r=${radius}`).toBeLessThanOrEqual(
        radius + 0.5,
      );
    }
  });

  it('draws the two edge lines ON the wedge\'s own boundaries', () => {
    // The design's 1.6° slivers (`5a:56`). They land exactly on the hairline
    // spokes, which is what stops the highlight reading as a wedge that has
    // grown — and it is why the law above is about leaks rather than about
    // boundaries.
    const centre = segmentAngle(0);
    const { g, inner } = drawSelection(centre);
    const segments = drawnSegments(g);
    const mid = inner + (R - inner) / 2;
    for (const boundary of [centre - SEGMENT_ARC / 2, centre + SEGMENT_ARC / 2]) {
      const probe = { x: Math.cos(boundary) * mid, y: Math.sin(boundary) * mid };
      const nearest = Math.min(...segments.map((s) => distanceToSegment(probe, s)));
      expect(nearest, `no edge line on the boundary at ${boundary.toFixed(2)} rad`).toBeLessThan(1);
    }
  });

  it('draws NOTHING at all when nothing is selected', () => {
    // The resting wheel — a mouse that has not crossed it, a thumb that is not
    // down. Every existing baseline of this screen depends on this being a
    // genuine no-op rather than a transparent layer.
    const { g } = drawSelection(segmentAngle(0), 0);
    expect(g.visible).toBe(false);
    expect(drawnSegments(g)).toEqual([]);
  });

  it('lands BETWEEN two wedges mid-sweep, which is the whole 140 ms', () => {
    // Half an arc past wedge 0 is the boundary it shares with wedge 1. A
    // highlight that could only ever be drawn at a wedge centre would have no
    // sweep to animate.
    const between = segmentAngle(0) + SEGMENT_ARC / 2;
    const { g, inner } = drawSelection(between);
    const segments = drawnSegments(g);
    const mid = inner + (R - inner) / 2;
    // Its own centre line now runs down the boundary between the two wedges…
    const probe = { x: Math.cos(between) * mid, y: Math.sin(between) * mid };
    const nearestToCentre = Math.min(...segments.map((s) => distanceToSegment(probe, s)));
    expect(nearestToCentre).toBeGreaterThan(1);
    // …and its edges sit on the two OUTER boundaries, one in each wedge.
    for (const edge of [between - SEGMENT_ARC / 2, between + SEGMENT_ARC / 2]) {
      const p = { x: Math.cos(edge) * mid, y: Math.sin(edge) * mid };
      expect(Math.min(...segments.map((s) => distanceToSegment(p, s)))).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// The UPGRADE wheel's selection (a0-51) — the wheel that drew none at all
// ---------------------------------------------------------------------------
//
// Everything above measures the highlight as a bare `drawWheelSelection` call:
// where its ink lands, given an angle and an arc. That is the right question for
// the layer, and it is blind to the two things the developer actually reported
// — *"it doesnt have the selection animation or graphics only the top most one
// has it"*:
//
//   1. `drawUpgradeWheel` never called it. The layer was correct and unused, so
//      the wheel behind UPGRADE SHIP drew no highlight anywhere.
//   2. The sweep's angles came from the BUILD wheel's five wedges, so even once
//      drawn the highlight only landed correctly on index 0 — twelve o'clock,
//      the one angle a fifth-of-a-turn stride and a quarter-turn stride share.
//
// Neither is visible in a unit test of the drawing function, so these drive the
// REAL `BuildWheelView` — its own `update()`, its own models, its own pooled
// nodes — and read back what the view put in its containers.
//
// The view is a Pixi scene graph, which is headless right up to the moment a
// `Text` is measured: `Text.height` reaches for a 2D canvas that does not exist
// in a node test. The adapter below is the whole of the workaround — a stub
// `measureText` — and it is not a mock of anything under test: no assertion here
// reads a text size, and the wedge stack's own measurements are held to the arc
// in `hud-geometry.test.ts` against the real metrics.

const stubTextContext = {
  font: '',
  measureText(text: string) {
    return {
      width: text.length * 7,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 7,
    };
  },
};
const stubCanvas = { width: 1, height: 1, getContext: () => stubTextContext };
DOMAdapter.set({
  ...DOMAdapter.get(),
  createCanvas: () => stubCanvas as unknown as HTMLCanvasElement,
} as never);

/** The viewport the two wheels are driven at — a desktop, so the wheel resolves
 *  the profile the design states its numbers at. */
const VIEW = { width: 1280, height: 800 };

/** A docked, funded ship: the Build wheel is open, so the Upgrade wheel is
 *  allowed to be in front of it (GDD §2.5 — it lives behind the arrow). */
const OPEN_SIGNALS: BuildWheelSignals = {
  requested: true,
  docked: true,
  shipAlive: true,
  stationAlive: true,
  cargo: 20,
  banked: 79,
  turrets: 0,
  shields: 0,
  satellites: 0,
  coreHp: 60,
  maxCoreHp: 100,
};

/** One frame of the real view with the Upgrade wheel in front, pointing at
 *  `selected` (or at nothing). `time` stays 0 on purpose: with no clock the view
 *  settles its sweep, which is the frozen-frame path the goldens shoot. */
function drawUpgrade(selected: number | null): BuildWheelView {
  const view = new BuildWheelView(VIEW.width, VIEW.height);
  view.update(
    buildWheelModel(OPEN_SIGNALS),
    upgradeWheelModel({
      open: true,
      weaponOpen: false,
      shipClass: ShipClass.Vanguard,
      tiers: STOCK_TIERS,
      ore: 99,
      selected,
    }),
    0,
  );
  return view;
}

/** The Graphics layers a wheel group owns directly, in draw order. */
function graphicsLayers(group: Container): Graphics[] {
  return group.children.filter((c): c is Graphics => c instanceof Graphics);
}

/** How much ink each of a group's layers is carrying. */
function inkPerLayer(group: Container): number[] {
  return graphicsLayers(group).map((g) => (g.visible ? drawnSegments(g).length : 0));
}

describe('upgrade wheel draws its selection', () => {
  const COUNT = 4; // HULL, ENGINE, CARGO, WEAPON — the wheel in the report
  const ARC = upgradeWedgeArc(COUNT);
  /** Half a wedge plus the edge bloom's own spread, at THIS wheel's arc. */
  const REACH =
    ARC / 2 +
    ((WHEEL_SELECTION.edgeDegrees / 2) * WHEEL_SELECTION.edgeGlowSpread * Math.PI) / 180 +
    Math.PI / 180;

  it('emits a highlight layer when the model has a selection, and none when it does not', () => {
    // The first defect, stated as the difference it makes: exactly one layer of
    // the upgrade group gains ink when a wedge is pointed at. Before this, none
    // did — `drawUpgradeWheel` called neither `drawWheelSelection` nor
    // `selectionOf`, so a model with `selected` set drew precisely the resting
    // frame.
    const resting = inkPerLayer(drawUpgrade(null).panelNode);
    const lit = inkPerLayer(drawUpgrade(2).panelNode);
    expect(lit.length).toBe(resting.length);

    const gained = lit.map((n, i) => n - (resting[i] ?? 0));
    expect(gained.filter((d) => d > 0)).toHaveLength(1);
    expect(gained.filter((d) => d < 0)).toEqual([]);
  });

  it('marks the pointed-at wedge selected and the rest receded, in the drawn readback', () => {
    // The wedge treatment — the other half of u16-01, and the half the ?debug=1
    // seam carries to a live-stage test (`lastUpgradeWedges`).
    const wedges = drawUpgrade(1).debugUpgradeWedges();
    expect(wedges).toHaveLength(COUNT);
    expect(wedges.map((w) => w.selected)).toEqual([false, true, false, false]);

    // …and a resting wheel says nobody is pointing at it, so every existing
    // baseline of this screen is untouched by this deliverable.
    expect(drawUpgrade(null).debugUpgradeWedges().map((w) => w.selected)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('lands the highlight on EVERY wedge, not only the top one', () => {
    // The second defect, and the developer's own words. Index 0 is twelve
    // o'clock on a wheel of any size, so a highlight driven by the Build wheel's
    // five wedges looked right there and drifted 18° further off per index —
    // 54° by the last wedge, more than half a wedge away.
    const resting = inkPerLayer(drawUpgrade(null).panelNode);
    for (let i = 0; i < COUNT; i++) {
      const view = drawUpgrade(i);
      const layers = graphicsLayers(view.panelNode);
      const index = inkPerLayer(view.panelNode).findIndex((n, j) => n > (resting[j] ?? 0));
      expect(index, `no highlight was drawn for wedge ${i}`).toBeGreaterThanOrEqual(0);

      const centre = upgradeWedgeAngle(i, COUNT);
      const strays: string[] = [];
      for (const seg of drawnSegments(layers[index]!)) {
        for (const p of samples(seg)) {
          if (Math.hypot(p.x, p.y) < 1) continue; // a path's own origin draws nothing
          const off = offCentre(Math.atan2(p.y, p.x), centre);
          if (off <= REACH) continue;
          strays.push(`${((off * 180) / Math.PI).toFixed(1)}° off wedge ${i}`);
        }
      }
      expect(strays.slice(0, 4), `the highlight is not on wedge ${i}`).toEqual([]);
    }
  });

  it('is drawn at the wheel it is over — the upgrade arc, not the Build wheel\'s', () => {
    // The highlight's own width is the tell that the arc travelled with it: at
    // 2π/5 it would be a fifth of a turn wide on a wheel cut into quarters, and
    // the two edge lines would sit inside the wedge instead of on its spokes.
    const resting = inkPerLayer(drawUpgrade(null).panelNode);
    const view = drawUpgrade(1);
    const layers = graphicsLayers(view.panelNode);
    const index = inkPerLayer(view.panelNode).findIndex((n, j) => n > (resting[j] ?? 0));
    const centre = upgradeWedgeAngle(1, COUNT);
    const r = wheelRadius(VIEW.width, VIEW.height);
    const m = wheelMetrics(r);
    const inner = r * m.hub;
    const mid = inner + (r - inner) / 2;

    const segments = drawnSegments(layers[index]!);
    for (const boundary of [centre - ARC / 2, centre + ARC / 2]) {
      const probe = { x: Math.cos(boundary) * mid, y: Math.sin(boundary) * mid };
      const nearest = Math.min(...segments.map((s) => distanceToSegment(probe, s)));
      expect(nearest, `no edge line on the upgrade wedge's boundary`).toBeLessThan(1);
    }
    // And the Build wheel's boundary, a fifth of a turn out, carries nothing:
    // that is the same wheel's ink at the wrong wheel's geometry.
    const wrong = centre + SEGMENT_ARC / 2;
    const probe = { x: Math.cos(wrong) * mid, y: Math.sin(wrong) * mid };
    expect(Math.min(...segments.map((s) => distanceToSegment(probe, s)))).toBeGreaterThan(1);
  });

  it('leaves the Build wheel drawing its own selection, at its own five wedges', () => {
    // The shared machine is parameterised, not re-pointed: the wheel in front
    // keeps the geometry it always had.
    const view = new BuildWheelView(VIEW.width, VIEW.height);
    const shut = upgradeWheelModel({
      open: false,
      weaponOpen: false,
      shipClass: ShipClass.Vanguard,
      tiers: STOCK_TIERS,
      ore: 99,
    });
    view.update(buildWheelModel({ ...OPEN_SIGNALS, selected: 3 }), shut, 0);
    expect(view.debugBuildWedges().map((w) => w.selected)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);

    const r = wheelRadius(VIEW.width, VIEW.height);
    const m = wheelMetrics(r);
    const inner = r * m.hub;
    const mid = inner + (r - inner) / 2;
    const centre = segmentAngle(3);
    const ink = graphicsLayers(view.wheelNode).flatMap((g) => (g.visible ? drawnSegments(g) : []));
    for (const boundary of [centre - SEGMENT_ARC / 2, centre + SEGMENT_ARC / 2]) {
      const probe = { x: Math.cos(boundary) * mid, y: Math.sin(boundary) * mid };
      expect(Math.min(...ink.map((s) => distanceToSegment(probe, s)))).toBeLessThan(1);
    }
  });
});
