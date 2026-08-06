/**
 * src/ui/gantry.test.ts — the Gantry/Bone frame, headless.
 *
 * Two things are asserted here that nowhere else can be:
 *
 *  1. **The derivation reproduces its own sample.** The handoff is a single
 *     1280×720 desktop drawing. If `frameMetrics` cannot hand back that drawing's
 *     own numbers at that viewport, it is not a derivation of the ratified look —
 *     it is a second design wearing its name.
 *  2. **The look survives a phone.** The handoff has no `@media` block, no
 *     viewport meta, and the words mobile / touch / phone / portrait appear
 *     nowhere in it. Everything below 1280×720 is ours, so it is tested rather
 *     than assumed: proportional margins and beams, a thumb floor that outranks
 *     any scaled-down metric, and safe-area insets nothing draws under.
 */

import { describe, it, expect } from 'vitest';
import {
  BEAM,
  PLATE_SCALES,
  RIVET,
  ROW,
  TOUCH_MIN,
  TYPE_MIN,
  VALUE_CHIP,
  beamContentInset,
  frameMetrics,
  plateHeight,
  plateTypeSize,
  rowHeight,
  typeSize,
  valueChipHeight,
} from '../art/materials';
import { beamContent, countPrimaries, gantryFrame, singlePrimary, stackPlates } from './gantry';

/** The handoff's own reference. */
const DESKTOP = { width: 1280, height: 720 };
/** The Playwright desktop control — taller than the reference, same numbers. */
const DESKTOP_TALL = { width: 1280, height: 800 };
/** iPhone 390×844 held portrait → the landscape lock hands the menus 844×390. */
const PHONE = { width: 844, height: 390 };
/** Pixel 412×915 held portrait → 915×412. */
const PIXEL = { width: 915, height: 412 };

describe('the derivation reproduces the ratified desktop sample', () => {
  it('hands back the handoff\'s own numbers at 1280×720', () => {
    const m = frameMetrics(DESKTOP.width, DESKTOP.height);
    expect(m.scale).toBe(1);
    expect(m.plateScale).toBe(1);
    expect(m.margin).toBe(BEAM.margin); // 44
    expect(m.beam).toBe(BEAM.height); // 92
    expect(m.gutter).toBe(BEAM.gutter); // 28
    expect(plateHeight('hero', m)).toBe(PLATE_SCALES.hero.height); // 80
    expect(plateHeight('standard', m)).toBe(PLATE_SCALES.standard.height); // 72
    expect(plateHeight('compact', m)).toBe(PLATE_SCALES.compact.height); // 56
    expect(rowHeight(m)).toBe(ROW.height); // 64
  });

  it('does not grow past the sample on a 4K desktop', () => {
    const m = frameMetrics(3840, 2160);
    expect(m.scale).toBe(1);
    expect(m.margin).toBe(BEAM.margin);
    expect(m.beam).toBe(BEAM.height);
  });

  it('reads the SHORT axis, so a tall desktop is still the reference', () => {
    const m = frameMetrics(DESKTOP_TALL.width, DESKTOP_TALL.height);
    expect(m.margin).toBe(BEAM.margin);
    expect(m.beam).toBe(BEAM.height);
  });

  it('places the content band 120px down, exactly as the handoff draws it', () => {
    const frame = gantryFrame(DESKTOP);
    expect(frame.header.height).toBe(BEAM.height);
    expect(frame.band.y).toBe(BEAM.height + BEAM.gutter);
    expect(frame.content.x).toBe(BEAM.margin);
  });

  it('is the ONE number the −/+ stepper does not keep, and it says so', () => {
    // The handoff's 40px stepper is under the thumb floor. It adapts everywhere —
    // a viewport cannot tell you whether the screen in front of it is a
    // touchscreen — which is a named, deliberate 8px change, not a drift.
    expect(VALUE_CHIP.height).toBeLessThan(TOUCH_MIN);
    expect(valueChipHeight(frameMetrics(DESKTOP.width, DESKTOP.height))).toBe(TOUCH_MIN);
  });
});

describe('the same look on a phone', () => {
  for (const [name, vp] of [
    ['iPhone, portrait-held', PHONE],
    ['Pixel, portrait-held', PIXEL],
  ] as const) {
    describe(name, () => {
      const m = frameMetrics(vp.width, vp.height);

      it('shrinks the frame proportionally instead of keeping the desktop numbers', () => {
        expect(m.scale).toBeLessThan(1);
        expect(m.margin).toBeLessThan(BEAM.margin);
        expect(m.margin).toBeGreaterThan(0);
        expect(m.beam).toBeLessThan(BEAM.height);
        expect(m.gutter).toBeLessThan(BEAM.gutter);
      });

      it('leaves the majority of the screen to content', () => {
        const frame = gantryFrame(vp);
        expect(frame.band.height).toBeGreaterThan(vp.height * 0.5);
      });

      it('floors every pressable at the thumb minimum', () => {
        expect(plateHeight('hero', m)).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(plateHeight('standard', m)).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(plateHeight('compact', m)).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(rowHeight(m)).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(valueChipHeight(m)).toBeGreaterThanOrEqual(TOUCH_MIN);
      });

      it('keeps the plate hierarchy — a floored plate is not a flattened one', () => {
        // The linear scale would put the hero at 43px and every plate under the
        // floor, which would make all three the same height and delete the size
        // half of the primary's read.
        expect(plateHeight('hero', m)).toBeGreaterThan(plateHeight('standard', m));
        expect(plateHeight('standard', m)).toBeGreaterThan(plateHeight('compact', m));
      });

      it('keeps type legible rather than scaling it into a smudge', () => {
        // A 12px eyebrow scaled linearly to this viewport is ~6.5px.
        expect(typeSize(12, m)).toBeGreaterThanOrEqual(TYPE_MIN);
        expect(plateTypeSize(13, m)).toBeGreaterThanOrEqual(TYPE_MIN);
        // …and it does not scale UP: the wordmark still shrinks with the frame.
        expect(typeSize(46, m)).toBeLessThan(46);
      });
    });
  }
});

describe('safe areas and degenerate viewports', () => {
  it('stops the beams at the inset — a beam is never drawn under a notch', () => {
    const insets = { top: 10, bottom: 20, left: 44, right: 30 };
    const frame = gantryFrame(PHONE, insets);
    expect(frame.header.x).toBe(44);
    expect(frame.header.y).toBe(10);
    expect(frame.header.x + frame.header.width).toBe(PHONE.width - 30);
    expect(frame.footer.y + frame.footer.height).toBe(PHONE.height - 20);
  });

  it('insets a footer\'s content by the page margin on top of the safe area', () => {
    const frame = gantryFrame(PHONE, { left: 44 });
    const strip = beamContent(frame.footer, frame.metrics, 'footer');
    expect(strip.x).toBe(44 + frame.metrics.margin);
  });

  it('starts a HEADER\'s content clear of the rivets bolted through it', () => {
    // The rivets are hardware and do not scale, so on a phone the derived 24px
    // margin puts the eyebrow's first two letters underneath them — which is
    // exactly what u7-01's first phone golden showed.
    const phone = frameMetrics(PHONE.width, PHONE.height);
    const rivetRight = RIVET.inset + (RIVET.perCluster * RIVET.pitch - RIVET.gap);
    expect(phone.margin).toBeLessThan(rivetRight);
    expect(beamContentInset(phone, 'header')).toBeGreaterThan(rivetRight);
    expect(beamContentInset(phone, 'footer')).toBe(phone.margin);

    // …and on the desktop the rule reproduces the handoff's own 44px margin,
    // because that is where the two numbers meet.
    const desktop = frameMetrics(DESKTOP.width, DESKTOP.height);
    expect(beamContentInset(desktop, 'header')).toBe(BEAM.margin);
  });

  it('gives way — beams before content — on a viewport too short for both', () => {
    const frame = gantryFrame({ width: 320, height: 60 });
    expect(frame.header.height + frame.footer.height).toBeLessThanOrEqual(60);
    expect(frame.band.height).toBeGreaterThanOrEqual(0);
  });

  it('yields zero-extent rects on a comically small viewport, never backwards ones', () => {
    for (const vp of [{ width: 4, height: 4 }, { width: 0, height: 0 }]) {
      const frame = gantryFrame(vp);
      for (const r of [frame.header, frame.footer, frame.content, frame.band]) {
        expect(r.width).toBeGreaterThanOrEqual(0);
        expect(r.height).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('stackPlates', () => {
  const band = { x: 100, y: 200, width: 800, height: 400 };

  it('centres a stack of unequal heights and keeps them in order', () => {
    const rects = stackPlates(band, 600, [80, 72, 72], 15);
    expect(rects.map((r) => r.height)).toEqual([80, 72, 72]);
    expect(rects.every((r) => r.width === 600)).toBe(true);
    expect(rects.every((r) => r.x === 100 + (800 - 600) / 2)).toBe(true);
    const total = 80 + 72 + 72 + 2 * 15;
    expect(rects[0]!.y).toBeCloseTo(200 + (400 - total) / 2, 6);
    expect(rects[2]!.y + rects[2]!.height).toBeCloseTo(rects[0]!.y + total, 6);
  });

  it('caps the column at the band rather than overflowing it sideways', () => {
    const rects = stackPlates(band, 5000, [80], 15);
    expect(rects[0]!.width).toBe(800);
  });

  it('compresses proportionally rather than running off the bottom', () => {
    const short = { x: 0, y: 0, width: 800, height: 120 };
    const rects = stackPlates(short, 600, [80, 72, 72], 15);
    const bottom = rects[2]!.y + rects[2]!.height;
    expect(bottom).toBeLessThanOrEqual(short.height + 0.5);
    // Ratios survive the squeeze — the hero is still the tallest.
    expect(rects[0]!.height).toBeGreaterThan(rects[1]!.height);
    expect(rects[1]!.height).toBeCloseTo(rects[2]!.height, 6);
  });

  it('yields zero-extent rects when there is no room at all', () => {
    const rects = stackPlates({ x: 0, y: 0, width: 800, height: 0 }, 600, [80, 72, 72], 15);
    for (const r of rects) expect(r.height).toBe(0);
  });
});

describe('the one-primary rule', () => {
  it('counts bright plates', () => {
    expect(countPrimaries(['primary', 'secondary', 'secondary'])).toBe(1);
    expect(countPrimaries(['inert', 'inert'])).toBe(0);
    expect(countPrimaries(['primary', 'primary'])).toBe(2);
  });

  it('allows one or none, and refuses two', () => {
    expect(singlePrimary(['primary', 'secondary'])).toBe(true);
    expect(singlePrimary(['inert', 'inert'])).toBe(true);
    // The screen the handoff explicitly forbids: two bright plates, between which
    // brightness can no longer say which one is the action.
    expect(singlePrimary(['primary', 'secondary', 'primary'])).toBe(false);
  });
});
