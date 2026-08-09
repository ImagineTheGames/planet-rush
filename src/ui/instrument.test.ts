/**
 * src/ui/instrument.test.ts — the rule that governs the whole match HUD, as a test.
 *
 * `./instrument` is a written argument: the menus are made of metal, the HUD is
 * instruments on glass, and the plate does not cross over. An argument in a file
 * header holds until the next brief. These assertions are what makes it hold
 * afterwards — most of all the first block, which is the rule itself:
 *
 *   **nothing this module draws is opaque, and nothing it draws leaves its rect.**
 *
 * Those two together are "the world reads through, and the layout registry's
 * record of a scrimmed element is still the element". Everything else here pins
 * the parts of the ratified vocabulary that DID cross over — the one tracking
 * scale, the Bone value ramp, the gantry silhouette — back to
 * `../art/materials`, so the HUD and the menus can never drift into two dialects
 * of one direction, which is the exact failure the handoff was written to end.
 *
 * Headless: the draw primitives speak `PlateCanvas`, the three-method structural
 * slice of Pixi `Graphics`, so a recorder stands in for the canvas.
 */
import { describe, it, expect } from 'vitest';
import { BONE, MATERIAL_SHADES, TRACKING, trackingPx, TYPE_MIN } from '../art/materials';
import type { PlateCanvas } from '../art/materials';
import { PALETTE } from '../art/palette';
import {
  drawEdgeRule,
  drawScrim,
  drawTick,
  gantryPoly,
  hudMetrics,
  hudSpace,
  hudTracking,
  hudType,
  HUD_REFERENCE,
  HUD_SCALE_FLOOR,
  HUD_TRACKING,
  INSTRUMENT_KEY,
  INSTRUMENT_MID,
  INSTRUMENT_RADIUS,
  INSTRUMENT_RULE,
  INSTRUMENT_TICK,
  INSTRUMENT_TRACK,
  nestedAlphas,
  SCRIM,
  SCRIM_BANDS,
  SCRIM_COLOR,
  SCRIM_CORE,
  TICK_WIDTH,
  WHEEL_CHROME,
  WHEEL_FACE_ALPHA,
} from './instrument';

// ---------------------------------------------------------------------------
// A recorder for the PlateCanvas seam
// ---------------------------------------------------------------------------

interface Shape {
  points: number[];
  color: number;
  alpha: number;
}

/** Records every marked-and-filled shape. Copies the fill style, because the
 *  primitives are allowed to hand the same mutable object to every fill. */
class Recorder implements PlateCanvas {
  readonly shapes: Shape[] = [];
  private pending: number[] | null = null;

  poly(points: number[]): void {
    this.pending = points.slice();
  }

  circle(x: number, y: number, radius: number): void {
    this.pending = [x - radius, y - radius, x + radius, y - radius, x + radius, y + radius, x - radius, y + radius];
  }

  fill(style: { color: number; alpha: number }): void {
    if (!this.pending) return;
    this.shapes.push({ points: this.pending, color: style.color, alpha: style.alpha });
    this.pending = null;
  }

  /**
   * What a point on screen actually ends up covered by: the composite of every
   * recorded band whose rect contains it. This is the only honest way to ask
   * "how dark is the readout's own pixel" of a stack of nested translucent
   * bands — the band count and each band's alpha say nothing on their own.
   */
  coverageAt(x: number, y: number): number {
    let covered = 0;
    for (const s of this.shapes) {
      let lo = Infinity;
      let hi = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (let i = 0; i + 1 < s.points.length; i += 2) {
        lo = Math.min(lo, s.points[i]!);
        hi = Math.max(hi, s.points[i]!);
        top = Math.min(top, s.points[i + 1]!);
        bottom = Math.max(bottom, s.points[i + 1]!);
      }
      if (x < lo || x > hi || y < top || y > bottom) continue;
      covered += s.alpha * (1 - covered);
    }
    return covered;
  }

  /** The axis-aligned union of everything drawn. */
  bounds(): { x: number; y: number; right: number; bottom: number } {
    let x = Infinity;
    let y = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const s of this.shapes) {
      for (let i = 0; i + 1 < s.points.length; i += 2) {
        x = Math.min(x, s.points[i]!);
        right = Math.max(right, s.points[i]!);
        y = Math.min(y, s.points[i + 1]!);
        bottom = Math.max(bottom, s.points[i + 1]!);
      }
    }
    return { x, y, right, bottom };
  }
}

/** What N nested translucent bands of the same colour actually add up to on
 *  screen: each one composites over the ones beneath it. */
function composited(alphas: readonly number[]): number {
  let covered = 0;
  for (const a of alphas) covered += a * (1 - covered);
  return covered;
}

// ---------------------------------------------------------------------------
// THE RULE — no plates over gameplay
// ---------------------------------------------------------------------------

describe('the rule: no plates over gameplay', () => {
  const RECT = { x: 40, y: 12, w: 300, h: 60 };

  const scrim = (anchor: 'top' | 'bottom' | 'center', peak: number): Recorder => {
    const r = new Recorder();
    drawScrim(r, RECT.x, RECT.y, RECT.w, RECT.h, anchor, peak);
    return r;
  };

  for (const anchor of ['top', 'bottom', 'center'] as const) {
    it(`a ${anchor}-anchored scrim never reaches opacity — the world reads through`, () => {
      const r = scrim(anchor, SCRIM.overlay); // the heaviest one the HUD spends
      expect(r.shapes.length).toBeGreaterThan(1);
      // No single band is opaque…
      for (const s of r.shapes) expect(s.alpha).toBeLessThan(1);
      // …and neither is the whole stack of them, which is the assertion that
      // matters: a scrim is a shadow, and a shadow you cannot see through is a
      // plate wearing a shadow's name.
      expect(composited(r.shapes.map((s) => s.alpha))).toBeCloseTo(SCRIM.overlay, 6);
      expect(composited(r.shapes.map((s) => s.alpha))).toBeLessThan(0.9);
    });

    it(`a ${anchor}-anchored scrim draws nothing outside its own rect`, () => {
      // The layout registry records what an element DREW. If a scrim bled past
      // the panel it backs, every scrimmed element on the HUD would register
      // bigger than the rect `hud-geometry` computed for it, and the anchor
      // contract would be asserting the wrong box.
      const b = scrim(anchor, SCRIM.corner).bounds();
      expect(b.x).toBeGreaterThanOrEqual(RECT.x - 1e-9);
      expect(b.y).toBeGreaterThanOrEqual(RECT.y - 1e-9);
      expect(b.right).toBeLessThanOrEqual(RECT.x + RECT.w + 1e-9);
      expect(b.bottom).toBeLessThanOrEqual(RECT.y + RECT.h + 1e-9);
    });
  }

  it('a scrim is only ever vacuum — never a tint, never a hue', () => {
    for (const peak of Object.values(SCRIM)) {
      const r = scrim('top', peak);
      for (const s of r.shapes) expect(s.color).toBe(PALETTE.vacuum);
    }
    expect(SCRIM_COLOR).toBe(PALETTE.vacuum);
  });

  it('the faintest band is the widest and the strongest the narrowest — a falloff, not a box', () => {
    const r = scrim('top', SCRIM.corner);
    const widthOf = (s: Shape): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < s.points.length; i += 2) {
        lo = Math.min(lo, s.points[i]!);
        hi = Math.max(hi, s.points[i]!);
      }
      return hi - lo;
    };
    for (let i = 1; i < r.shapes.length; i++) {
      expect(widthOf(r.shapes[i]!)).toBeLessThanOrEqual(widthOf(r.shapes[i - 1]!) + 1e-9);
    }
    // The outermost band — the one whose edge sits on the rect boundary — is the
    // faint one, which is why that boundary is invisible.
    expect(r.shapes[0]!.alpha).toBeLessThan(SCRIM.corner);
  });

  it('a top-anchored scrim is darkest at the top and a bottom-anchored one at the bottom', () => {
    const topOf = (s: Shape): number => {
      let lo = Infinity;
      for (let i = 1; i < s.points.length; i += 2) lo = Math.min(lo, s.points[i]!);
      return lo;
    };
    const bottomOf = (s: Shape): number => {
      let hi = -Infinity;
      for (let i = 1; i < s.points.length; i += 2) hi = Math.max(hi, s.points[i]!);
      return hi;
    };
    const top = scrim('top', SCRIM.corner).shapes;
    // Every band shares the anchored edge; only the far edge climbs toward it.
    for (const s of top) expect(topOf(s)).toBeCloseTo(RECT.y, 6);
    expect(bottomOf(top[top.length - 1]!)).toBeLessThan(bottomOf(top[0]!));

    const bottom = scrim('bottom', SCRIM.corner).shapes;
    for (const s of bottom) expect(bottomOf(s)).toBeCloseTo(RECT.y + RECT.h, 6);
    expect(topOf(bottom[bottom.length - 1]!)).toBeGreaterThan(topOf(bottom[0]!));
  });

  it('the stated peak is a plateau the readout sits on, not a sliver through it', () => {
    // The regression this pins is the one the shipped baseline had, and it is
    // invisible in the constants: SCRIM.corner said 0.55 while the top-left ore
    // cluster's actual core was 12px wide and 5px tall inside a 58×54 rect, so
    // `TOTAL` over a lit asteroid kept ~80% of the rock and ghosted. A scrim that
    // reaches its peak nowhere the type is has not darkened the type.
    //
    // The cluster's real reference rect: `drawOreChrome` at hudMetrics 1.
    const r = new Recorder();
    const [x, y, w, h] = [16, 16, 58, 54];
    drawScrim(r, x, y, w, h, 'center', SCRIM.corner);

    const cx = x + w / 2;
    const cy = y + h / 2;
    expect(r.coverageAt(cx, cy)).toBeCloseTo(SCRIM.corner, 6);
    // …and, the point of the plateau, still the peak a quarter of the way out to
    // each edge — which is where the label's own glyphs are.
    for (const [dx, dy] of [
      [-0.29, -0.29],
      [0.29, -0.29],
      [-0.29, 0.29],
      [0.29, 0.29],
    ] as const) {
      expect(r.coverageAt(cx + dx * w, cy + dy * h)).toBeCloseTo(SCRIM.corner, 6);
    }

    // The boundary stays invisible: one faint band on the rect's own edge.
    expect(r.coverageAt(x, cy)).toBeLessThan(SCRIM.corner / 4);
    expect(r.coverageAt(cx, y)).toBeLessThan(SCRIM.corner / 4);
  });

  it('steps its falloff finely enough not to band over a lit asteroid', () => {
    // GDD §5.4 counts banding as a bug wherever a gradient is stepped: "a
    // gradient whose steps the eye can find is not one soft edge but several hard
    // ones". A scrim is a stepped gradient over the brightest thing on the
    // screen, so the two terms that decide whether a step is findable — how much
    // coverage it adds, and how far apart the steps sit — are pinned here.
    const r = new Recorder();
    const [w, h] = [58, 54];
    drawScrim(r, 0, 0, w, h, 'center', SCRIM.corner);
    expect(r.shapes.length).toBe(SCRIM_BANDS);

    // Coverage per step, against the ~134-luminance swing of a lit asteroid over
    // vacuum: 4 luminance steps is the practical floor for "invisible".
    const perStep = SCRIM.corner / SCRIM_BANDS;
    expect(perStep * 134).toBeLessThan(4.5);

    // And the steps themselves land less than a pixel apart on the smallest rect
    // the HUD draws one on, so there is no edge to find in the first place.
    const taper = Math.min(h * 0.6, (w * (1 - SCRIM_CORE)) / 2);
    expect(taper / (SCRIM_BANDS - 1)).toBeLessThan(1);
    expect(((h * (1 - SCRIM_CORE)) / 2) / (SCRIM_BANDS - 1)).toBeLessThan(1);
  });

  it('the prompt scrim leaves the build wheel behind it legible', () => {
    // The number that carries the brief's whole judgement call. The prompt sits
    // over the wheel's bottom wedges on a landscape phone because there is no
    // clear air at 390px of height (hud-geometry `promptBand`), so what is behind
    // it has to survive it. A third of the wedge is not "reads through".
    const r = scrim('center', SCRIM.prompt);
    const throughput = 1 - composited(r.shapes.map((s) => s.alpha));
    expect(throughput).toBeGreaterThan(0.3);
  });

  it('nothing on the glass is chamfered or rounded — a surface is square', () => {
    expect(INSTRUMENT_RADIUS).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// What DID cross over, pinned to the ratified vocabulary
// ---------------------------------------------------------------------------

describe('the ratified vocabulary, carried across intact', () => {
  it('there is exactly ONE tracking scale, and this is it', () => {
    // The handoff's diagnosis: "one tracking scale replaces the six that had
    // drifted in". If this file ever grows its own tier, the HUD and the menus
    // become two dialects again and this fails.
    expect(HUD_TRACKING).toBe(TRACKING);
    expect(Object.keys(HUD_TRACKING).sort()).toEqual(['eyebrow', 'label', 'name']);
    for (const tier of ['eyebrow', 'label', 'name'] as const) {
      expect(hudTracking(tier, 13)).toBe(trackingPx(TRACKING[tier], 13));
    }
  });

  it('tracking scales with the type, so a resize carries it', () => {
    expect(hudTracking('name', 22)).toBeCloseTo(hudTracking('name', 11) * 2, 9);
  });

  it('every tone the HUD spends is a step on the Bone ramp — no seventh hue', () => {
    // `materials.test.ts` recomputes each of these from its recipe on `hullSteel`,
    // so pinning to the ramp's own constants is what stops a hand-picked hex
    // smuggling a colour onto the glass (style-guide §1/§2).
    expect(INSTRUMENT_RULE).toBe(BONE.lo);
    expect(INSTRUMENT_TICK).toBe(BONE.hi);
    expect(INSTRUMENT_KEY).toBe(BONE.hi);
    expect(INSTRUMENT_MID).toBe(BONE.mid);
    expect(INSTRUMENT_TRACK).toBe(MATERIAL_SHADES.rulePlate);
  });

  it('no tone is signal yellow or threat red — chrome is neither ore nor danger', () => {
    const reserved = [PALETTE.signalYellow, PALETTE.threatRed];
    for (const tone of [INSTRUMENT_RULE, INSTRUMENT_TICK, INSTRUMENT_KEY, INSTRUMENT_MID, INSTRUMENT_TRACK]) {
      expect(reserved).not.toContain(tone);
    }
  });

  // -------------------------------------------------------------------------
  // The wheel's chrome (u11-01) — the half of the direction u7-02 left behind
  // -------------------------------------------------------------------------

  describe('WHEEL_CHROME — the build wheel spends no colour on its chrome', () => {
    it('is drawn entirely from the Bone ramp — no seventh hue, and no hand-picked hex', () => {
      // The defect this brief closes, stated as constants: the hub chevron was
      // `PALETTE.plasma`, `OPEN ▸` and the index diamond were a local
      // `0xdce3ec`, and the wedge faces were raw `hullSteel`. Every one of them
      // is now a declared step that `../art/materials.test.ts` recomputes from
      // its recipe on hull steel, so the wheel cannot drift off the ramp again
      // without that test going red first.
      expect(WHEEL_CHROME.nameReady).toBe(BONE.hi);
      expect(WHEEL_CHROME.nameInert).toBe(MATERIAL_SHADES.tickSteel);
      expect(WHEEL_CHROME.secondary).toBe(BONE.lo);
      expect(WHEEL_CHROME.affordance).toBe(BONE.mid);
      expect(WHEEL_CHROME.mark).toBe(BONE.hi);
      expect(WHEEL_CHROME.face).toBe(BONE.fill);
      expect(WHEEL_CHROME.divider).toBe(MATERIAL_SHADES.hairline);
      expect(WHEEL_CHROME.press).toBe(BONE.hi);
    });

    it('spends none of the three colours a match has jobs for', () => {
      // Plasma is the one that actually happened, and it is the one with the most
      // to lose: it means ENERGY on this very screen (the shield overbar stands in
      // front of a reactor in it). Yellow and red are the RESERVED pair — the
      // wheel spends them on cost numerals and on a rejected press, neither of
      // which is chrome, and neither of which is in this object.
      const spoken = [PALETTE.plasma, PALETTE.signalYellow, PALETTE.threatRed, PALETTE.patina];
      for (const [role, tone] of Object.entries(WHEEL_CHROME)) {
        expect(spoken, `${role} spends a colour that already has a job`).not.toContain(tone);
      }
    });

    it('every tone is a cool neutral — brightness is the only channel it uses', () => {
      // Bone is a value ramp on hull steel, so no channel may run warmer than the
      // blue one; the same oracle `../art/materials.test.ts` runs over the plate
      // vocabulary and `lobby.test.ts` runs over the stat pips.
      for (const [role, tone] of Object.entries(WHEEL_CHROME)) {
        const r = (tone >> 16) & 0xff;
        const g = (tone >> 8) & 0xff;
        const b = tone & 0xff;
        expect(b >= g && g >= r, `${role} is not a cool neutral`).toBe(true);
        // …and nowhere near the accent it replaces. Plasma leads blue over red by
        // 178; the whole Bone ramp leads by at most 22. `wheel-chrome.spec.ts`
        // reads the SAME 60-level gap off real pixels on the booted client.
        expect(b - r, `${role} leans blue like the accent it replaced`).toBeLessThan(60);
      }
    });

    it('ranks the wheel by brightness, because that is all Bone has to rank with', () => {
      // The hierarchy, in one assertion: what you act on is brightest, the word
      // under the mark is next, what you only read is below that, and what is
      // refused is dimmest. Get this backwards and the wheel still contains no
      // hue and still reads as noise.
      const luma = (c: number): number =>
        0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff);
      expect(luma(WHEEL_CHROME.nameReady)).toBeGreaterThan(luma(WHEEL_CHROME.affordance));
      expect(luma(WHEEL_CHROME.affordance)).toBeGreaterThan(luma(WHEEL_CHROME.secondary));
      expect(luma(WHEEL_CHROME.secondary)).toBeGreaterThan(luma(WHEEL_CHROME.nameInert));
      expect(luma(WHEEL_CHROME.nameInert)).toBeGreaterThan(luma(WHEEL_CHROME.face));
      // The mark and the primary word are deliberately the SAME step: the index
      // diamond and the hub chevron are one object drawn twice, and a wedge you
      // can press is the same order of "act on this" as the mark that says where.
      expect(WHEEL_CHROME.mark).toBe(WHEEL_CHROME.nameReady);
    });

    it('a wedge face stays a lift over the glass, never a plate on top of it', () => {
      // The rule the whole wheel is built on — no plates over gameplay, the world
      // reads through. A face that reached for opacity to carry its state would
      // buy the state and lose the game behind it, so the separation has to come
      // out of a fill that is still mostly transparent at its strongest.
      expect(WHEEL_FACE_ALPHA.ready).toBeLessThan(0.4);
      expect(WHEEL_FACE_ALPHA.inert).toBeLessThan(WHEEL_FACE_ALPHA.ready);
      // …and the two states have to be far enough apart to READ as two states.
      // Threefold, measured the way an eye measures it: as the lift each one puts
      // over the disc it is drawn on, not as a ratio of raw alphas.
      const disc = 19; // faceShade at 0.88 over the fight, per-channel, ≈ level 19
      const lift = (a: number): number => a * (((BONE.fill >> 16) & 0xff) - disc);
      expect(lift(WHEEL_FACE_ALPHA.ready)).toBeGreaterThan(lift(WHEEL_FACE_ALPHA.inert) * 2.5);
    });
  });

  it('the tick is the plate\'s own 3px bar, drawn centred on its row', () => {
    const r = new Recorder();
    drawTick(r, 100, 50, 30);
    expect(r.shapes).toHaveLength(1);
    const s = r.shapes[0]!;
    expect(s.color).toBe(BONE.hi);
    const xs = s.points.filter((_, i) => i % 2 === 0);
    const ys = s.points.filter((_, i) => i % 2 === 1);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(TICK_WIDTH);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(50, 9);
  });
});

// ---------------------------------------------------------------------------
// The rule (the edge), and the gantry silhouette
// ---------------------------------------------------------------------------

describe('drawEdgeRule — the beam accent, reduced to one line', () => {
  it('fades out at both ends: the full-width segment is the faintest', () => {
    const r = new Recorder();
    drawEdgeRule(r, 0, 100, 400);
    expect(r.shapes.length).toBeGreaterThan(4);
    const widthOf = (s: Shape): number => {
      const xs = s.points.filter((_, i) => i % 2 === 0);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(widthOf(r.shapes[0]!)).toBeCloseTo(400, 6);
    for (let i = 1; i < r.shapes.length; i++) {
      expect(widthOf(r.shapes[i]!)).toBeLessThan(widthOf(r.shapes[i - 1]!) + 1e-9);
      expect(r.shapes[i]!.alpha).toBeGreaterThan(0);
    }
    // …and it is a rule, not a fill: never opaque, never wider than asked.
    expect(composited(r.shapes.map((s) => s.alpha))).toBeLessThan(1);
  });

  it('stays inside the span it was given, and inside its own thickness', () => {
    const r = new Recorder();
    drawEdgeRule(r, 25, 60, 200, 2);
    const b = r.bounds();
    expect(b.x).toBeGreaterThanOrEqual(25 - 1e-9);
    expect(b.right).toBeLessThanOrEqual(225 + 1e-9);
    expect(b.y).toBeCloseTo(60, 9);
    expect(b.bottom).toBeCloseTo(62, 9);
  });

  it('every segment is centred on the same line — a rule, not a wedge', () => {
    const r = new Recorder();
    drawEdgeRule(r, 0, 0, 300);
    for (const s of r.shapes) {
      const xs = s.points.filter((_, i) => i % 2 === 0);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(150, 6);
    }
  });
});

describe('gantryPoly — two corners cut, never four', () => {
  it('cuts the top-right and the bottom-left and leaves the other two square', () => {
    const poly = gantryPoly(0, 0, 100, 60, 10);
    expect(poly).toEqual([0, 0, 90, 0, 100, 10, 100, 60, 10, 60, 0, 50]);
    // The two square corners are present as literal points…
    expect(poly.slice(0, 2)).toEqual([0, 0]); // top-left
    expect(poly.slice(6, 8)).toEqual([100, 60]); // bottom-right
  });

  it('never eats more than half the shape, however small it is drawn', () => {
    const poly = gantryPoly(0, 0, 20, 8, 40);
    const ys = poly.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBe(8);
    expect(poly).toHaveLength(12);
  });

  it('degenerates to a plain box at zero chamfer', () => {
    expect(gantryPoly(3, 4, 10, 5, 0)).toEqual([3, 4, 13, 4, 13, 9, 3, 9]);
  });
});

// ---------------------------------------------------------------------------
// Metrics — the look is ratified, the numbers adapt
// ---------------------------------------------------------------------------

describe('hudMetrics — the frame, on the screens the game actually runs on', () => {
  it('resolves to exactly 1 at the reference, so the ratified sample survives its own derivation', () => {
    expect(hudMetrics(HUD_REFERENCE.width, HUD_REFERENCE.height).scale).toBe(1);
    // …and on the desktop control, which is taller than the reference.
    expect(hudMetrics(1280, 800).scale).toBe(1);
  });

  it('never scales chrome UP on a big monitor', () => {
    expect(hudMetrics(3840, 2160).scale).toBe(1);
  });

  it('floors at 0.75 on a phone — a HUD number is read under fire', () => {
    // 844×390 raw is 0.54; the floor wins. Compare with the MENU frame, which is
    // allowed all the way down to 0.25 because its own thumb floor catches it.
    expect(hudMetrics(844, 390).scale).toBe(HUD_SCALE_FLOOR);
    expect(hudMetrics(320, 568).scale).toBe(HUD_SCALE_FLOOR);
  });

  it('keeps every HUD type size at or above the 11px floor', () => {
    // style-guide §7: "Oxanium must remain legible at 12px — verify at the mobile
    // thumb-scale layout, not just desktop." TYPE_MIN is the shared floor.
    const phone = hudMetrics(844, 390);
    for (const ref of [9, 11, 12, 13, 14, 15, 16, 18, 22, 24]) {
      expect(hudType(ref, phone)).toBeGreaterThanOrEqual(TYPE_MIN);
      expect(hudType(ref, phone)).toBeLessThanOrEqual(Math.max(TYPE_MIN, ref));
    }
  });

  it('is monotonic: a bigger reference size is never drawn smaller', () => {
    const phone = hudMetrics(844, 390);
    let previous = 0;
    for (const ref of [11, 13, 15, 16, 22, 24]) {
      const px = hudType(ref, phone);
      expect(px).toBeGreaterThanOrEqual(previous);
      previous = px;
    }
  });

  it('keeps spacing positive, so a compressed layout still separates its pieces', () => {
    for (const ref of [4, 6, 18, 22, 40]) {
      expect(hudSpace(ref, hudMetrics(320, 320))).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('nestedAlphas — the solve behind every falloff here', () => {
  it('composites to exactly the coverage it was asked for', () => {
    for (const peak of [0.2, 0.5, SCRIM.prompt, SCRIM.overlay]) {
      const targets = Array.from({ length: SCRIM_BANDS }, (_, i) => (peak * (i + 1)) / SCRIM_BANDS);
      expect(composited(nestedAlphas(targets))).toBeCloseTo(peak, 9);
    }
  });

  it('drops targets that would go backwards rather than painting a negative alpha', () => {
    expect(nestedAlphas([0.4, 0.2, 0.6])).toHaveLength(2);
    for (const a of nestedAlphas([0.4, 0.2, 0.6])) expect(a).toBeGreaterThan(0);
  });
});
