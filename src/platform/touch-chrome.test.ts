/**
 * The round Bone vocabulary (a0-23). Two things are worth a headless test here,
 * and they are the two things a golden cannot tell you:
 *
 *  1. **What the primitives actually paint** — every tone a step on the ratified
 *     Bone ramp, the rim lit along the TOP and shadowed along the BOTTOM, and no
 *     hue anywhere. A screenshot shows a reviewer that a ring looks fine; it
 *     cannot show them that the ring is `BONE.hi` rather than a hand-picked
 *     white that will drift next time somebody edits it.
 *  2. **That every arc is preceded by a `moveTo`** — the a0-21 defect. A bare
 *     `arc()` drags a chord in from wherever the pen was left, which is a stray
 *     rule across the control. It is invisible in review and obvious on a phone.
 */
import { describe, it, expect } from 'vitest';
import { Graphics } from 'pixi.js';
import { BONE } from '../art/materials';
import { PALETTE } from '@render/index';
import {
  TOUCH_ALPHA,
  TOUCH_CHROME,
  TOUCH_HALO,
  TOUCH_RIM,
  drawBoneRing,
  drawPressOverlay,
  drawRim,
  drawVoidHalo,
  nestedAlphas,
  strokeArc,
  type RoundCanvas,
} from './touch-chrome';

// ---------------------------------------------------------------------------
// A recorder — the structural `Graphics` these primitives are written against
// ---------------------------------------------------------------------------

type Call =
  | { op: 'circle'; x: number; y: number; r: number }
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'arc'; r: number; start: number; end: number }
  | { op: 'fill'; color: number; alpha: number }
  | { op: 'stroke'; color: number; alpha: number; width: number };

/** Records what a primitive drew. **Copies** each style object rather than
 *  retaining it — the primitives hand the same mutable scratch to every call
 *  (see `RoundCanvas`), so a recorder that keeps the reference records the last
 *  draw N times. That is the `PlateCanvas` trap, and it cost u7-01 a golden. */
class Recorder implements RoundCanvas {
  readonly calls: Call[] = [];
  circle(x: number, y: number, r: number): this {
    this.calls.push({ op: 'circle', x, y, r });
    return this;
  }
  moveTo(x: number, y: number): this {
    this.calls.push({ op: 'moveTo', x, y });
    return this;
  }
  arc(_x: number, _y: number, r: number, start: number, end: number): this {
    this.calls.push({ op: 'arc', r, start, end });
    return this;
  }
  fill(style: { color: number; alpha: number }): this {
    this.calls.push({ op: 'fill', color: style.color, alpha: style.alpha });
    return this;
  }
  stroke(style: { width: number; color: number; alpha: number }): this {
    this.calls.push({ op: 'stroke', color: style.color, alpha: style.alpha, width: style.width });
    return this;
  }
}

const RIM = {
  width: 4,
  lit: TOUCH_CHROME.rimLit,
  shadow: TOUCH_CHROME.rimShadow,
  litAlpha: 0.9,
  shadowAlpha: 0.7,
} as const;

/** Every hue the palette owns a *meaning* for. None of them may appear here. */
const RESERVED_HUES = [PALETTE.plasma, PALETTE.signalYellow, PALETTE.threatRed] as const;

describe('the tones are the ratified Bone ramp, and nothing else', () => {
  it('every chrome tone is a declared point on the ramp (no hand-picked hex)', () => {
    expect(TOUCH_CHROME.rimLit).toBe(BONE.hi);
    expect(TOUCH_CHROME.rimShadow).toBe(BONE.lo);
    expect(TOUCH_CHROME.hintLit).toBe(BONE.mid);
    expect(TOUCH_CHROME.hintShadow).toBe(BONE.lo);
    expect(TOUCH_CHROME.face).toBe(BONE.fill);
    expect(TOUCH_CHROME.label).toBe(BONE.hi);
    expect(TOUCH_CHROME.sub).toBe(BONE.mid);
    expect(TOUCH_CHROME.press).toBe(BONE.hi);
    expect(TOUCH_CHROME.scrim).toBe(PALETTE.vacuum);
  });

  it('spends no hue at all — that is the whole point of taking the thumbs off plasma', () => {
    for (const tone of Object.values(TOUCH_CHROME)) {
      expect(RESERVED_HUES).not.toContain(tone);
    }
  });

  it('the brightest step is reserved for the thing you can press now', () => {
    // Bone's mechanism: the actionable thing is the bright thing. A hint must
    // therefore never be as bright as a live control, or the ramp says nothing.
    expect(TOUCH_ALPHA.hintLit).toBeLessThan(TOUCH_ALPHA.liveLit);
    expect(TOUCH_ALPHA.actionLit).toBeLessThanOrEqual(TOUCH_ALPHA.primaryLit);
    expect(TOUCH_ALPHA.actionFace).toBeLessThan(TOUCH_ALPHA.primaryFace);
  });

  it('does not lose the read: every state is at least as opaque as the plasma it replaced', () => {
    // The numbers that shipped in plasma, from the file this replaces: a 3px
    // ring at 0.18 idle and 0.4 live, a 0.5 knob fill, a 4px FIRE ring at 0.85.
    // Bone's `hi` is the ramp's white endpoint, so equal alpha already buys more
    // luminance against vacuum — but the alphas are not allowed to go backwards
    // either, because a0-20's fair objection was that a ring over a firefight is
    // where a brightness-only direction is hardest to read.
    expect(TOUCH_ALPHA.hintLit).toBeGreaterThanOrEqual(0.18);
    expect(TOUCH_ALPHA.liveLit).toBeGreaterThanOrEqual(0.4);
    expect(TOUCH_ALPHA.knobFace + TOUCH_ALPHA.knobScrim).toBeGreaterThanOrEqual(0.5);
    expect(TOUCH_ALPHA.actionLit).toBeGreaterThanOrEqual(0.85);
    // …and the rim weights are unchanged: the weights were never the complaint.
    expect(TOUCH_RIM).toEqual({ stick: 3, knob: 2, fire: 4, build: 5 });
  });
});

describe('drawRim — a machined lip, lit on top and shadowed underneath', () => {
  it('lights the TOP half and shadows the BOTTOM half (screen y points down)', () => {
    const r = new Recorder();
    drawRim(r, 40, RIM);
    const arcs = r.calls.filter((c): c is Extract<Call, { op: 'arc' }> => c.op === 'arc');
    expect(arcs).toHaveLength(2);
    // π → 2π is the top half in screen space; 0 → π is the bottom.
    expect(arcs[0]).toMatchObject({ start: Math.PI, end: 2 * Math.PI });
    expect(arcs[1]).toMatchObject({ start: 0, end: Math.PI });

    const strokes = r.calls.filter((c): c is Extract<Call, { op: 'stroke' }> => c.op === 'stroke');
    expect(strokes[0]).toMatchObject({ color: RIM.lit, alpha: RIM.litAlpha, width: RIM.width });
    expect(strokes[1]).toMatchObject({ color: RIM.shadow, alpha: RIM.shadowAlpha });
  });

  it('every arc is preceded by a moveTo onto it — no stray chord (a0-21)', () => {
    const r = new Recorder();
    drawRim(r, 40, RIM);
    r.calls.forEach((call, i) => {
      if (call.op !== 'arc') return;
      const prev = r.calls[i - 1];
      expect(prev, 'an arc with nothing before it drags a chord in').toBeDefined();
      expect(prev!.op).toBe('moveTo');
    });
  });

  it('the moveTo lands exactly on the arc it opens', () => {
    const r = new Recorder();
    const radius = 40;
    strokeArc(r, radius, Math.PI, 2 * Math.PI, 3, TOUCH_CHROME.rimLit, 1);
    const move = r.calls[0] as Extract<Call, { op: 'moveTo' }>;
    expect(move.op).toBe('moveTo');
    expect(Math.hypot(move.x, move.y)).toBeCloseTo(radius);
    expect(move.x).toBeCloseTo(Math.cos(Math.PI) * radius);
    expect(move.y).toBeCloseTo(Math.sin(Math.PI) * radius);
  });
});

describe('drawBoneRing — scrim, then face, then rim', () => {
  it('a hint is rim only: the fight reads straight through it', () => {
    const r = new Recorder();
    drawBoneRing(r, 64, { rim: RIM });
    expect(r.calls.filter((c) => c.op === 'fill')).toHaveLength(0);
    expect(r.calls.filter((c) => c.op === 'stroke')).toHaveLength(2);
  });

  it('a solid control lays the scrim first, then the Bone lift, then the rim', () => {
    const r = new Recorder();
    drawBoneRing(r, 42, { scrim: 0.5, face: 0.16, rim: RIM });
    const fills = r.calls.filter((c): c is Extract<Call, { op: 'fill' }> => c.op === 'fill');
    expect(fills.map((f) => f.color)).toEqual([TOUCH_CHROME.scrim, TOUCH_CHROME.face]);
    expect(fills.map((f) => f.alpha)).toEqual([0.5, 0.16]);
    // The rim goes on last so nothing is painted over it.
    expect(r.calls[r.calls.length - 1]!.op).toBe('stroke');
  });

  it('the scrim is an absence of the world, never a tint', () => {
    const r = new Recorder();
    drawBoneRing(r, 42, { scrim: 0.5, rim: RIM });
    const fill = r.calls.find((c): c is Extract<Call, { op: 'fill' }> => c.op === 'fill')!;
    expect(fill.color).toBe(PALETTE.vacuum);
  });

  it('zero coverage draws nothing at all (no invisible fill in the display list)', () => {
    const r = new Recorder();
    drawBoneRing(r, 42, { scrim: 0, face: 0, rim: RIM });
    expect(r.calls.filter((c) => c.op === 'fill')).toHaveLength(0);
  });
});

describe('nestedAlphas — nested translucent fills compound', () => {
  it('each band carries the increment, not the target', () => {
    const a = nestedAlphas([0.5, 0.75]);
    expect(a[0]).toBeCloseTo(0.5);
    expect(a[1]).toBeCloseTo(0.5); // 0.5 + 0.5·(1−0.5) = 0.75 ✓
  });

  it('replays to the requested cumulative coverage', () => {
    const targets = [0.02, 0.08, 0.18, 0.32, 0.5];
    const alphas = nestedAlphas(targets);
    let under = 0;
    alphas.forEach((a, i) => {
      under = under + a * (1 - under);
      expect(under).toBeCloseTo(targets[i]!);
    });
  });

  it('never asks for a negative or >1 alpha, even on a non-monotonic target list', () => {
    for (const a of nestedAlphas([0.6, 0.2, 1, 1.4])) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});

describe('drawVoidHalo — the primary announces itself by DARKENING, not by glowing', () => {
  it('is made of vacuum only (a glow is the one thing this project keeps removing)', () => {
    const r = new Recorder();
    drawVoidHalo(r, 38);
    const fills = r.calls.filter((c): c is Extract<Call, { op: 'fill' }> => c.op === 'fill');
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) expect(f.color).toBe(PALETTE.vacuum);
  });

  it('lies entirely OUTSIDE the rim — the hit rect never grows (theme-coverage §6 trap 3)', () => {
    const r = new Recorder();
    const radius = 38;
    drawVoidHalo(r, radius);
    for (const c of r.calls) {
      if (c.op !== 'circle') continue;
      expect(c.r).toBeGreaterThan(radius);
      expect(c.r).toBeLessThanOrEqual(radius + TOUCH_HALO.reach);
    }
  });

  it('deepens inward and has no edge of its own at the outside', () => {
    const r = new Recorder();
    drawVoidHalo(r, 38);
    const circles = r.calls.filter((c): c is Extract<Call, { op: 'circle' }> => c.op === 'circle');
    // Painted outermost-first, so radii decrease…
    for (let i = 1; i < circles.length; i++) {
      expect(circles[i]!.r).toBeLessThan(circles[i - 1]!.r);
    }
    // …and the outermost band is the faintest, so the pool has a soft shoulder.
    const fills = r.calls.filter((c): c is Extract<Call, { op: 'fill' }> => c.op === 'fill');
    expect(fills[0]!.alpha).toBeLessThan(fills[fills.length - 1]!.alpha);
    expect(fills[0]!.alpha).toBeLessThan(0.1);
  });
});

describe('drawPressOverlay — a press is an alpha change, never a redraw', () => {
  it('draws at full strength so the caller can dial it with node alpha', () => {
    const r = new Recorder();
    drawPressOverlay(r, 42, 4);
    const fill = r.calls.find((c): c is Extract<Call, { op: 'fill' }> => c.op === 'fill')!;
    const stroke = r.calls.find((c): c is Extract<Call, { op: 'stroke' }> => c.op === 'stroke')!;
    expect(fill.alpha).toBe(1);
    expect(stroke.alpha).toBe(1);
    expect(fill.color).toBe(TOUCH_CHROME.press);
    expect(stroke.color).toBe(TOUCH_CHROME.press);
  });

  it('goes BRIGHT rather than blue (u11-01, on a wedge; the same call here)', () => {
    expect(TOUCH_CHROME.press).toBe(BONE.hi);
    expect(TOUCH_CHROME.press).not.toBe(PALETTE.plasma);
  });
});

describe('PixiJS Graphics satisfies RoundCanvas as-is', () => {
  it('a real Graphics takes every primitive without an adapter', () => {
    const g = new Graphics();
    const canvas: RoundCanvas = g;
    expect(() => {
      drawBoneRing(canvas, 42, { scrim: 0.5, face: 0.2, rim: RIM });
      drawVoidHalo(canvas, 38);
      drawPressOverlay(canvas, 42, 4);
    }).not.toThrow();
    expect(g.context.instructions.length).toBeGreaterThan(0);
  });
});
