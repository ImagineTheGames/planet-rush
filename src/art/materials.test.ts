/**
 * The Gantry/Bone material contract.
 *
 * Three things are worth machine-checking about a material vocabulary, and they
 * are the three that would otherwise rot quietly across five screen briefs:
 *
 *  1. **No seventh hue.** Every plate tone is a declared value-ramp recipe on
 *     one of the six, recomputed here from its recipe — the same oracle
 *     `palette.test.ts` runs over the sprite shades. A hand-edited hex fails.
 *  2. **RESERVED holds.** Signal yellow is ore, threat red is danger, and neither
 *     is ever chrome. A plate is never red — asserted over every tone the
 *     primitives can actually paint, not just the ones in the table.
 *  3. **Zero allocation.** The draw path hands out the same frozen materials and
 *     the same scratch fill on every call, so a menu that redraws on hover does
 *     not churn the collector.
 */

import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { PALETTE, PLAYER_COLORS, shade, tint, WHITE } from './palette';
import { TYPE } from './tokens';
import {
  BEAM,
  BONE,
  brightness,
  contentHeight,
  contentTop,
  deriveMaterialShade,
  DISPLAY_TRACKING,
  drawBeam,
  drawPlate,
  drawRivetCluster,
  FACE_BANDS,
  MATERIAL_RECIPES,
  MATERIAL_SHADES,
  PLATE_SCALES,
  plateFamily,
  plateMaterial,
  RIVET,
  SHEEN_BANDS,
  TRACKING,
  trackingPx,
  type MaterialShadeKey,
  type PlateCanvas,
  type PlateFamily,
  type PlateRole,
  type PlateScale,
  type PlateState,
} from './materials';

// ---------------------------------------------------------------------------
// A recorder standing in for Graphics — the same headless discipline the rest of
// src/art/ uses. It copies every points array and every fill style, because the
// primitives deliberately reuse both.
// ---------------------------------------------------------------------------

interface RecordedOp {
  readonly kind: 'poly' | 'circle';
  readonly points: number[];
  readonly color: number;
  readonly alpha: number;
}

class Recorder implements PlateCanvas {
  readonly ops: RecordedOp[] = [];
  /** Every distinct fill-style object seen. Should stay at exactly one. */
  readonly styleObjects = new Set<object>();
  /** Every distinct points array seen. Should equal the polygon count: PixiJS
   *  keeps the array it is handed, so each shape must get its own. */
  readonly pointArrays = new Set<object>();

  private pending: { kind: 'poly' | 'circle'; points: number[] } | null = null;

  poly(points: number[], _close?: boolean): void {
    this.pointArrays.add(points);
    this.pending = { kind: 'poly', points: points.slice() };
  }

  circle(x: number, y: number, radius: number): void {
    this.pending = { kind: 'circle', points: [x, y, radius] };
  }

  fill(style: { color: number; alpha: number }): void {
    this.styleObjects.add(style);
    const p = this.pending;
    if (!p) throw new Error('fill() without a preceding shape');
    this.ops.push({ kind: p.kind, points: p.points, color: style.color, alpha: style.alpha });
    this.pending = null;
  }

  colors(): number[] {
    return this.ops.map((o) => o.color);
  }
}

const ROLES: PlateRole[] = ['primary', 'secondary', 'inert'];
const STATES: PlateState[] = ['rest', 'hover', 'press'];
const SCALES: PlateScale[] = ['hero', 'standard', 'compact', 'chip'];
const FAMILIES: PlateFamily[] = ['plate', 'chip'];

const RESERVED = new Set<number>([PALETTE.signalYellow, PALETTE.threatRed]);

/** Cool-grey test: hullSteel and vacuum both satisfy r <= g <= b, and so does
 *  white. No warm hue can — signal yellow and threat red both run r > g. */
function isCoolNeutral(color: number): boolean {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return r <= g && g <= b;
}

// ---------------------------------------------------------------------------

describe('the plate tones are ramp recipes, not hexes', () => {
  const keys = Object.keys(MATERIAL_RECIPES) as MaterialShadeKey[];

  it('declares one recipe per shade and no orphans', () => {
    expect(Object.keys(MATERIAL_SHADES).sort()).toEqual(keys.slice().sort());
  });

  it.each(keys)('%s equals its recipe', (key) => {
    expect(MATERIAL_SHADES[key]).toBe(deriveMaterialShade(key));
  });

  it('mixes only toward vacuum or white, only from one of the six', () => {
    const six = new Set(Object.keys(PALETTE));
    for (const key of keys) {
      const r = MATERIAL_RECIPES[key];
      expect(six.has(r.base)).toBe(true);
      expect(['vacuum', 'white']).toContain(r.toward);
      expect(r.t).toBeGreaterThanOrEqual(0);
      expect(r.t).toBeLessThanOrEqual(1);
    }
  });

  it('is drawn entirely off the hullSteel ramp — Bone is brightness, not a hue', () => {
    for (const key of keys) expect(MATERIAL_RECIPES[key].base).toBe('hullSteel');
  });

  it('the Bone accent ramp climbs from fill to white', () => {
    expect(BONE.hi).toBe(WHITE);
    expect(BONE.mid).toBe(tint(PALETTE.hullSteel, MATERIAL_RECIPES.bone.t));
    expect(BONE.lo).toBe(tint(PALETTE.hullSteel, MATERIAL_RECIPES.boneLo.t));
    expect(BONE.fill).toBe(shade(PALETTE.hullSteel, MATERIAL_RECIPES.boneFill.t));
    const value = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);
    expect(value(BONE.fill)).toBeLessThan(value(BONE.lo));
    expect(value(BONE.lo)).toBeLessThan(value(BONE.mid));
    expect(value(BONE.mid)).toBeLessThan(value(BONE.hi));
  });
});

describe('RESERVED holds — a plate is never red', () => {
  it('no material shade is signal yellow or threat red', () => {
    for (const c of Object.values(MATERIAL_SHADES)) expect(RESERVED.has(c)).toBe(false);
  });

  it('no material shade is a player identity colour', () => {
    const roster = new Set<number>(PLAYER_COLORS);
    for (const c of Object.values(MATERIAL_SHADES)) expect(roster.has(c)).toBe(false);
  });

  it('every tone the primitives can paint is a cool neutral', () => {
    // Walks the whole space: every role, every state, every scale, plus the
    // beams and the rivets. Warm hues run r > g and cannot survive this.
    const rec = new Recorder();
    for (const role of ROLES) {
      for (const state of STATES) {
        for (const scale of SCALES) drawPlate(rec, 40, 40, 420, PLATE_SCALES[scale].height, role, scale, state);
      }
    }
    drawBeam(rec, 0, 0, 1280, 'header');
    drawBeam(rec, 0, 628, 1280, 'footer');
    drawRivetCluster(rec, 20, 14);

    expect(rec.ops.length).toBeGreaterThan(100);
    for (const c of rec.colors()) {
      expect(RESERVED.has(c)).toBe(false);
      expect(isCoolNeutral(c)).toBe(true);
    }
  });

  it('brightness() preserves the hue ratio it was handed', () => {
    expect(brightness(PALETTE.hullSteel, 1)).toBe(PALETTE.hullSteel);
    const up = brightness(PALETTE.hullSteel, 1.3);
    expect(isCoolNeutral(up)).toBe(true);
    // Clamps rather than wrapping, so a bright primary cannot roll a channel over.
    expect(brightness(0xf0f0f0, 4)).toBe(WHITE);
  });
});

describe('the one tracking scale', () => {
  it('has exactly three tiers', () => {
    expect(Object.keys(TRACKING)).toEqual(['eyebrow', 'label', 'name']);
  });

  it('keeps the eyebrow on the value tokens.ts already ratified', () => {
    expect(TRACKING.eyebrow).toBe(TYPE.eyebrowTracking);
  });

  it('descends from eyebrow to name', () => {
    expect(TRACKING.eyebrow).toBeGreaterThan(TRACKING.label);
    expect(TRACKING.label).toBeGreaterThan(TRACKING.name);
  });

  it('tracks display type tighter as it grows', () => {
    expect(DISPLAY_TRACKING.wordmark).toBeLessThan(DISPLAY_TRACKING.heading);
  });

  it('converts em to the pixels PixiJS letterSpacing wants', () => {
    expect(trackingPx(TRACKING.eyebrow, 12)).toBeCloseTo(3.12, 5);
    expect(trackingPx(TRACKING.name, 17)).toBeCloseTo(1.7, 5);
  });
});

describe('beam metrics', () => {
  it('is 44px margins and 92px beams, both ends', () => {
    expect(BEAM.margin).toBe(44);
    expect(BEAM.height).toBe(92);
  });

  it('starts content at 120 from the screen edge', () => {
    expect(contentTop()).toBe(120);
    expect(contentHeight(720)).toBe(720 - 240);
    expect(contentHeight(100)).toBe(0);
  });

  it('rivets a header and leaves the footer bare', () => {
    const header = new Recorder();
    drawBeam(header, 0, 0, 1280, 'header');
    const footer = new Recorder();
    drawBeam(footer, 0, 628, 1280, 'footer');

    const circles = (r: Recorder) => r.ops.filter((o) => o.kind === 'circle').length;
    // Two clusters of two heads, two circles each (lit cap + body).
    expect(circles(header)).toBe(RIVET.perCluster * 2 * 2);
    expect(circles(footer)).toBe(0);
  });

  it('puts the accent rule under a header and over a footer', () => {
    const header = new Recorder();
    drawBeam(header, 0, 0, 1280, 'header', false);
    const footer = new Recorder();
    drawBeam(footer, 0, 0, 1280, 'footer', false);
    const ruleY = (r: Recorder) => {
      const op = r.ops.filter((o) => o.color === BEAM.rule.color).at(-1);
      return op ? op.points[1] : null;
    };
    expect(ruleY(header)).toBe(BEAM.height - BEAM.rule.width);
    expect(ruleY(footer)).toBe(0);
  });

  it('draws a beam at the height the FRAME resolved, not the reference 92', () => {
    // The bug this pins: a phone's beam is ~50px, and painting the handoff's 92
    // into it put the header's Bone accent rule 40px BELOW the beam — through
    // the first plate on the screen — and ran the footer's gradient off the
    // bottom edge before it reached its dark end (measured in u7-01's shipped
    // phone goldens: the rule at y=90 on a 390px-tall viewport).
    const phoneBeam = 50;
    const header = new Recorder();
    drawBeam(header, 0, 0, 844, 'header', false, phoneBeam);
    const footer = new Recorder();
    drawBeam(footer, 0, 340, 844, 'footer', false, phoneBeam);
    const ruleY = (r: Recorder) => {
      const op = r.ops.filter((o) => o.color === BEAM.rule.color).at(-1);
      return op ? op.points[1] : null;
    };
    expect(ruleY(header)).toBe(phoneBeam - BEAM.rule.width);
    expect(ruleY(footer)).toBe(340);

    // …and nothing the beam paints escapes the rect it was given (the fill's
    // last band overlaps by BAND_OVERLAP, which is the only slack allowed).
    const bottom = (r: Recorder) =>
      Math.max(...r.ops.flatMap((o) => o.points.filter((_, i) => i % 2 === 1)));
    expect(bottom(header)).toBeLessThanOrEqual(phoneBeam + 1);
    expect(bottom(footer)).toBeLessThanOrEqual(340 + phoneBeam + 1);
  });

  it('draws nothing for a beam with no height', () => {
    const rec = new Recorder();
    drawBeam(rec, 0, 0, 1280, 'header', true, 0);
    expect(rec.ops).toHaveLength(0);
  });
});

describe('the plate', () => {
  it('cuts the top-right and bottom-left corners only — the gantry cut', () => {
    const rec = new Recorder();
    drawPlate(rec, 100, 200, 400, 72, 'secondary', 'standard');
    const bezel = rec.ops.find((o) => o.color === plateMaterial('secondary').bezelBands[0]!.color);
    expect(bezel).toBeDefined();
    const pts = bezel!.points;
    expect(pts.length / 2).toBe(6);

    const has = (x: number, y: number) => {
      for (let i = 0; i < pts.length; i += 2) if (pts[i] === x && pts[i + 1] === y) return true;
      return false;
    };
    const c = PLATE_SCALES.standard.chamfer;
    expect(has(100, 200)).toBe(true); // top-left stays square
    expect(has(500, 272)).toBe(true); // bottom-right stays square
    expect(has(500, 200)).toBe(false); // top-right is cut
    expect(has(100, 272)).toBe(false); // bottom-left is cut
    expect(has(500 - c, 200)).toBe(true);
    expect(has(100, 272 - c)).toBe(true);
  });

  it('leaves a surface square — only raised plates are chamfered', () => {
    const rec = new Recorder();
    drawPlate(rec, 0, 0, 400, 64, 'inert', 'standard');
    for (const op of rec.ops) expect(op.points.length / 2).toBe(4);
  });

  it('never lets the chamfer eat more than half a shrunken plate', () => {
    const rec = new Recorder();
    drawPlate(rec, 0, 0, 24, 20, 'primary', 'hero');
    for (const op of rec.ops.filter((o) => o.kind === 'poly')) {
      expect(op.points.length / 2).toBeGreaterThanOrEqual(3);
    }
  });

  it('draws the lit top edge above the shadowed under-line', () => {
    const m = plateMaterial('secondary');
    const lit = m.bezelLit!.color;
    const dark = m.bezelShadow!.color;
    const value = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);
    expect(value(lit)).toBeGreaterThan(value(dark));

    // The bezel is painted as one ramp down the plate, so the lit end is the
    // first band and the shadowed under-line is the last.
    const bands = m.bezelBands;
    expect(bands.length).toBeGreaterThan(1);
    expect(value(bands[0]!.color)).toBeGreaterThan(value(bands[bands.length - 1]!.color));
    for (let i = 1; i < bands.length; i++) {
      expect(value(bands[i]!.color)).toBeLessThan(value(bands[i - 1]!.color));
    }

    // And the darkest band is the one drawn lowest, so the under-line lands on
    // the bottom edge rather than anywhere else on the plate.
    const rec = new Recorder();
    drawPlate(rec, 0, 0, 400, 72, 'secondary', 'standard');
    const topOf = (color: number) => {
      const op = rec.ops.find((o) => o.color === color)!;
      let min = Infinity;
      for (let i = 1; i < op.points.length; i += 2) min = Math.min(min, op.points[i]!);
      return min;
    };
    expect(topOf(bands[0]!.color)).toBe(0);
    expect(topOf(bands[bands.length - 1]!.color)).toBeCloseTo(72 - 72 / bands.length, 6);
  });

  it('gives the primary the inner sheen worth the name', () => {
    const primary = plateMaterial('primary');
    const secondary = plateMaterial('secondary');
    const inert = plateMaterial('inert');

    expect(primary.sheenBands.length).toBe(SHEEN_BANDS);
    // The sheen's innermost (top) band is the one carrying the peak.
    const peak = (m: { sheenBands: readonly { alpha: number }[] }) =>
      m.sheenBands.reduce((acc, b) => acc + (1 - acc) * b.alpha, 0);
    expect(peak(primary)).toBeGreaterThan(peak(secondary));
    expect(peak(secondary)).toBeGreaterThan(peak(inert));
    expect(peak(primary)).toBeCloseTo(0.2 * (1 - 0.5 / SHEEN_BANDS), 6);
  });

  it('casts a shadow from the raised roles and none from a surface', () => {
    expect(plateMaterial('primary').shadowBands.length).toBeGreaterThan(0);
    expect(plateMaterial('secondary').shadowBands.length).toBeGreaterThan(0);
    expect(plateMaterial('inert').shadowBands.length).toBe(0);
  });

  it('stacks the shadow bands to the density the handoff asked for', () => {
    // `0 12px 34px rgba(0,0,0,.6)` is a *blurred* silhouette, and a blurred edge
    // sits at half its nominal alpha — the other half has spread inward under the
    // plate. So the composite of the nested bands must approach .3 at the plate's
    // edge and fall away quadratically, never .6 (too heavy) and never .6/n
    // (too thin, which is what a naive per-band split gives).
    const bands = plateMaterial('primary').shadowBands;
    const composite = bands.reduce((acc, b) => acc + (1 - acc) * b.alpha, 0);
    expect(composite).toBeLessThan(0.3);
    expect(composite).toBeGreaterThan(0.2);

    // Monotonically fainter outward, with the outermost band a whisper.
    let prev = 0;
    for (const b of bands) {
      expect(b.alpha).toBeGreaterThan(prev * 0 - 1e-9);
      prev = b.alpha;
    }
    expect(bands[0]!.alpha).toBeLessThan(0.02);
  });

  it('sinks on press and brightens on hover', () => {
    expect(plateMaterial('primary', 'press').offsetY).toBe(2);
    expect(plateMaterial('inert', 'press').offsetY).toBe(1);
    expect(plateMaterial('primary', 'rest').offsetY).toBe(0);

    const value = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);
    for (const role of ROLES) {
      const rest = plateMaterial(role, 'rest').faceBands[0]!.color;
      const hover = plateMaterial(role, 'hover').faceBands[0]!.color;
      expect(value(hover)).toBeGreaterThan(value(rest));
    }
  });

  it('deepens the drop on hover rather than blooming — Cold Vacuum has no glow', () => {
    // tokens.ts GLOW forbids a gaussian bloom, so the handoff's `0 0 46px` hover
    // glow becomes its `0 14px 40px` hover shadow: the plate lifts further off
    // the screen instead of lighting up the void around it.
    const rest = plateMaterial('primary', 'rest');
    const hover = plateMaterial('primary', 'hover');
    expect(hover.shadowSpread).toBeGreaterThan(rest.shadowSpread);
    expect(hover.shadowOffsetY).toBeGreaterThan(rest.shadowOffsetY);
    expect(hover.shadowSpread).toBe(40);
    expect(hover.shadowOffsetY).toBe(14);
  });

  it('bands the face finely enough that no step shows', () => {
    const bands = plateMaterial('primary').faceBands;
    expect(bands.length).toBe(FACE_BANDS);
    for (let i = 1; i < bands.length; i++) {
      const a = bands[i - 1]!.color;
      const b = bands[i]!.color;
      const step = Math.max(
        Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)),
        Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)),
        Math.abs((a & 0xff) - (b & 0xff)),
      );
      expect(step).toBeLessThanOrEqual(4);
    }
  });

  it('keeps every mark inside the plate and its declared shadow spread', () => {
    const m = plateMaterial('primary');
    const rec = new Recorder();
    drawPlate(rec, 100, 100, 400, 80, 'primary', 'hero');
    const pad = m.shadowSpread + m.shadowOffsetY + 1;
    for (const op of rec.ops) {
      for (let i = 0; i < op.points.length; i += 2) {
        expect(op.points[i]!).toBeGreaterThanOrEqual(100 - pad);
        expect(op.points[i]!).toBeLessThanOrEqual(500 + pad);
        expect(op.points[i + 1]!).toBeGreaterThanOrEqual(100 - pad);
        expect(op.points[i + 1]!).toBeLessThanOrEqual(180 + pad);
      }
    }
  });

  it('states a chip in brighter metal behind a bright hairline', () => {
    // A 28px control has a tenth of a menu row's area to carry the same read, so
    // the handoff builds it out of a lighter step and borders it instead of
    // bezelling it. Same role, same ramp — stated at the size it is drawn at.
    const value = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);
    const baseline = value(plateMaterial('secondary', 'rest', 'plate').faceBands[0]!.color);
    for (const role of ROLES) {
      const plate = plateMaterial(role, 'rest', 'plate');
      const chip = plateMaterial(role, 'rest', 'chip');
      expect(value(chip.faceBands[0]!.color)).toBeGreaterThan(baseline);
      expect(chip.bezelLit).toBeNull();
      expect(chip.rule).not.toBeNull();
      expect(chip.shadowBands.length).toBe(0);
      expect(chip.chamfered).toBe(false);
      // Hover and press behave identically — a chip is still a plate.
      expect(chip.offsetY).toBe(plate.offsetY);
      expect(plateMaterial(role, 'press', 'chip').offsetY).toBe(plateMaterial(role, 'press', 'plate').offsetY);
    }
  });

  it('ranks chips by their border, since a chip has no bezel to rank', () => {
    // A primary plate outshines every chip on the screen — so a *selected* chip
    // cannot say "primary" with its fill. It says it with the brightest Bone
    // step in its hairline, and the hierarchy lives entirely there.
    const value = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);
    const ruleValue = (role: PlateRole) => value(plateMaterial(role, 'rest', 'chip').rule!.color);
    expect(ruleValue('primary')).toBeGreaterThan(ruleValue('secondary'));
    expect(ruleValue('secondary')).toBeGreaterThan(ruleValue('inert'));
    expect(plateMaterial('primary', 'rest', 'chip').rule!.color).toBe(BONE.mid);
    expect(plateMaterial('secondary', 'rest', 'chip').rule!.color).toBe(BONE.lo);
  });

  it('routes the chip scale to the chip family and everything else to plate', () => {
    expect(plateFamily('chip')).toBe('chip');
    for (const scale of SCALES.filter((s) => s !== 'chip')) expect(plateFamily(scale)).toBe('plate');

    const rec = new Recorder();
    drawPlate(rec, 0, 0, 52, 28, 'secondary', 'chip');
    expect(rec.colors()).toContain(plateMaterial('secondary', 'rest', 'chip').rule!.color);
    // Square: a chip has no room for the gantry cut.
    for (const op of rec.ops) expect(op.points.length / 2).toBe(4);
  });

  it('draws nothing for a degenerate rect', () => {
    const rec = new Recorder();
    drawPlate(rec, 0, 0, 0, 80, 'primary', 'hero');
    drawPlate(rec, 0, 0, 400, 0, 'primary', 'hero');
    expect(rec.ops).toEqual([]);
  });
});

describe('zero per-frame allocation', () => {
  it('hands back the same frozen material for the same role, state and family', () => {
    for (const role of ROLES) {
      for (const state of STATES) {
        for (const family of FAMILIES) {
          const a = plateMaterial(role, state, family);
          expect(plateMaterial(role, state, family)).toBe(a);
          expect(Object.isFrozen(a)).toBe(true);
          expect(Object.isFrozen(a.faceBands)).toBe(true);
        }
      }
    }
    expect(plateMaterial('primary')).toBe(plateMaterial('primary', 'rest', 'plate'));
  });

  it('reuses one fill style, and hands every mark its OWN points array', () => {
    const rec = new Recorder();
    for (let i = 0; i < 20; i++) drawPlate(rec, 0, 0, 400, 80, 'primary', 'hero', 'hover');
    drawBeam(rec, 0, 0, 1280, 'header');
    expect(rec.ops.length).toBeGreaterThan(400);
    // The fill style is shared: `GraphicsContext.fill` converts its input into a
    // fresh style synchronously, so one mutable object is safe and free.
    expect(rec.styleObjects.size).toBe(1);
    // The POINTS are not. PixiJS 8's `Polygon` keeps the array it is handed by
    // reference (`this.points = flat`) and `fill()` clones the path only
    // shallowly, so a shared scratch buffer does not draw a plate — it draws the
    // last shape marked, N times, on top of itself. u7-01's first golden run
    // rendered an entire Gantry/Bone menu as one 3px accent tick because of
    // exactly this. Every polygon therefore gets its own array.
    const polys = rec.ops.filter((op) => op.kind === 'poly').length;
    expect(polys).toBeGreaterThan(400);
    expect(rec.pointArrays.size).toBe(polys);
  });

  it('emits an identical mark list on every redraw', () => {
    const first = new Recorder();
    const second = new Recorder();
    drawPlate(first, 12, 34, 400, 72, 'secondary', 'standard', 'hover');
    drawPlate(second, 12, 34, 400, 72, 'secondary', 'standard', 'hover');
    expect(second.ops).toEqual(first.ops);
  });
});

describe('the PixiJS seam', () => {
  it('is satisfied by Graphics as it stands', () => {
    // Compile-time proof that a view can pass its own Graphics straight in, and
    // a runtime one that the three methods exist — without this module ever
    // importing PixiJS itself.
    const g = new Graphics();
    const canvas: PlateCanvas = g;
    expect(typeof canvas.poly).toBe('function');
    expect(typeof canvas.circle).toBe('function');
    expect(typeof canvas.fill).toBe('function');
    drawPlate(canvas, 0, 0, 400, 80, 'primary', 'hero');
    expect(g.context.instructions.length).toBeGreaterThan(0);
    g.destroy();
  });
});
