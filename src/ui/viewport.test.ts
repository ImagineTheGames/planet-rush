/**
 * src/ui/viewport.test.ts — the content box and the view-zoom ladder (a0-74).
 *
 * The two halves of "the screen you get depends on the screen you have": how much
 * of the *screen* the HUD is allowed to use, and how much of the *world* the
 * camera shows. Both are pure, so both are pinned here rather than in a screenshot.
 */
import { describe, it, expect } from 'vitest';
import {
  CONTENT_MAX_ASPECT,
  CONTENT_MIN_WIDTH,
  DEFAULT_VIEW_ZOOM,
  VIEW_ZOOM_STEPS,
  VIEW_ZOOM_STORAGE,
  cameraScale,
  contentBox,
  isUltrawide,
  nextViewZoom,
  parseViewZoom,
  storedViewZoom,
  viewWorldWidth,
  viewZoomLabel,
} from './viewport';
import { HUD_REFERENCE } from './instrument';

/** The profiles the three reports are actually about. */
const PROFILES = {
  desktop: { width: 1707, height: 898 }, // the developer's own window (a0-74)
  reference: { width: 1280, height: 720 }, // 16:9 exactly — the HUD's own frame
  golden: { width: 1280, height: 800 }, // the golden-suite desktop control
  phoneLandscape: { width: 844, height: 390 },
  phoneLandscapeSmall: { width: 798, height: 384 }, // the report's own phone
  phonePortrait: { width: 390, height: 844 },
  ultra21: { width: 2560, height: 1080 }, // 21:9
  ultra32: { width: 3840, height: 1080 }, // 32:9
} as const;

describe('contentBox — the cap is the HUD\'s own reference aspect', () => {
  it('is 16:9, derived from HUD_REFERENCE rather than typed', () => {
    expect(CONTENT_MAX_ASPECT).toBeCloseTo(16 / 9, 10);
    expect(CONTENT_MIN_WIDTH).toBe(HUD_REFERENCE.width);
  });

  it('is the whole viewport at 16:9 and narrower — nothing moves', () => {
    for (const vp of [PROFILES.reference, PROFILES.golden, PROFILES.phonePortrait]) {
      const box = contentBox(vp);
      expect(box).toEqual({ x: 0, y: 0, width: vp.width, height: vp.height });
      expect(isUltrawide(vp)).toBe(false);
    }
  });

  it('leaves every landscape phone alone, even though they are wider than 16:9', () => {
    // The trap a bare aspect cap falls into: a 844×390 phone is aspect 2.16, so a
    // pure cap would inset the one device with no width to give away.
    for (const vp of [PROFILES.phoneLandscape, PROFILES.phoneLandscapeSmall]) {
      expect(vp.width / vp.height).toBeGreaterThan(CONTENT_MAX_ASPECT);
      expect(contentBox(vp).width).toBe(vp.width);
      expect(contentBox(vp).x).toBe(0);
    }
  });

  it('binds a 21:9 and a 32:9 display to a centred reference-aspect box', () => {
    const a = contentBox(PROFILES.ultra21);
    expect(a.width).toBeCloseTo(1080 * CONTENT_MAX_ASPECT, 6); // 1920
    expect(a.x).toBeCloseTo((2560 - a.width) / 2, 6);
    expect(a.height).toBe(1080); // height is never capped

    const b = contentBox(PROFILES.ultra32);
    expect(b.width).toBeCloseTo(1080 * CONTENT_MAX_ASPECT, 6); // 1920 again
    expect(b.x).toBeCloseTo((3840 - b.width) / 2, 6);
    expect(b.width + 2 * b.x).toBeCloseTo(3840, 6); // centred, exactly
    expect(isUltrawide(PROFILES.ultra32)).toBe(true);
  });

  it('never insets a viewport narrower than the floor, however short it is', () => {
    // A short window (a browser at 1000×300 is aspect 3.3) is still under the
    // floor, so it keeps every pixel — the floor is what protects small screens.
    const box = contentBox({ width: 1000, height: 300 });
    expect(box.width).toBe(1000);
    expect(box.x).toBe(0);
  });

  it('is always centred and never wider than the viewport', () => {
    for (let w = 0; w <= 4000; w += 137) {
      for (const h of [0, 200, 390, 720, 1080, 1600]) {
        const box = contentBox({ width: w, height: h });
        expect(box.width).toBeLessThanOrEqual(w);
        expect(box.width).toBeGreaterThanOrEqual(0);
        expect(box.x).toBeCloseTo((w - box.width) / 2, 9);
        expect(box.height).toBe(h);
      }
    }
  });
});

describe('the view zoom ladder', () => {
  it('starts at the shipped view and only ever widens', () => {
    expect(DEFAULT_VIEW_ZOOM).toBe(1);
    expect(VIEW_ZOOM_STEPS[0]).toBe(1);
    for (const step of VIEW_ZOOM_STEPS) expect(step).toBeGreaterThanOrEqual(1);
    // Strictly increasing — a ladder that doubled back would make the button lie.
    for (let i = 1; i < VIEW_ZOOM_STEPS.length; i++) {
      expect(VIEW_ZOOM_STEPS[i] as number).toBeGreaterThan(VIEW_ZOOM_STEPS[i - 1] as number);
    }
  });

  it('scales the camera by the INVERSE — a bigger step means a smaller world root', () => {
    expect(cameraScale(1)).toBe(1);
    expect(cameraScale(2)).toBe(0.5);
    expect(cameraScale(1.5)).toBeCloseTo(2 / 3, 12);
  });

  it('closes the phone/desktop gap it was sized to close', () => {
    // The report's own numbers: 798 px of phone against 1707 px of desktop.
    const desktop = viewWorldWidth(PROFILES.desktop.width, 1);
    expect(viewWorldWidth(798, 1) / desktop).toBeCloseTo(0.467, 3);
    expect(viewWorldWidth(798, 2) / desktop).toBeCloseTo(0.935, 3);
    // …and past a 1280-wide desktop window outright.
    expect(viewWorldWidth(798, 2)).toBeGreaterThan(viewWorldWidth(1280, 1));
  });

  it('cycles one button through the ladder and wraps', () => {
    let step = DEFAULT_VIEW_ZOOM;
    const seen: number[] = [];
    for (let i = 0; i < VIEW_ZOOM_STEPS.length; i++) {
      seen.push(step);
      step = nextViewZoom(step);
    }
    expect(seen).toEqual([...VIEW_ZOOM_STEPS]);
    expect(step).toBe(DEFAULT_VIEW_ZOOM); // wrapped
  });

  it('labels each rung without trailing zeroes', () => {
    expect(viewZoomLabel(1)).toBe('1×');
    expect(viewZoomLabel(1.5)).toBe('1.5×');
    expect(viewZoomLabel(2)).toBe('2×');
  });

  it('round-trips through storage, and folds anything else to the default', () => {
    expect(VIEW_ZOOM_STORAGE).toBe('planet-rush:viewZoom');
    for (const step of VIEW_ZOOM_STEPS) {
      expect(parseViewZoom(storedViewZoom(step))).toBe(step);
    }
    for (const bad of [null, undefined, '', 'wide', '0', '-1', '3', 'NaN', 'Infinity']) {
      expect(parseViewZoom(bad)).toBe(DEFAULT_VIEW_ZOOM);
    }
  });

  it('never hands the renderer a scale of 0, NaN or Infinity', () => {
    for (const bad of [0, -1, 0.0001, NaN, Infinity, -Infinity, 99]) {
      const s = cameraScale(bad);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
    }
  });
});
