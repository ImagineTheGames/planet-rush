/**
 * src/ui/zoom-control.test.ts — the zoom-out button, on touch (a0-74).
 *
 * The placement claim is the one worth pinning mechanically: the control declares
 * `top-right`, and a declared anchor is a promise the layout registry checks. So
 * this drives the registry's OWN resolver (`@platform/layout-registry`
 * `resolveAnchor` / `rectContains`) at every profile in the device matrix rather
 * than restating the arithmetic.
 */
import { describe, it, expect } from 'vitest';
import { rectContains, resolveAnchor } from '@platform/layout-registry';
import { TOUCH_TARGET_MIN, HUD_PAD, stationChromeHeight } from './hud-geometry';
import { hudMetrics } from './instrument';
import {
  ZOOM_CONTROL_ANCHOR,
  ZOOM_CONTROL_HEIGHT,
  hitZoomControl,
  showZoomControl,
  zoomControlBounds,
  zoomControlLabel,
} from './zoom-control';
import { VIEW_ZOOM_STEPS } from './viewport';

/** The matrix, landscape-locked, including the shortest profile the HUD claims to
 *  run on (GDD §4.3) — which is the one that decided the placement. */
const PROFILES = [
  { name: '568x320 (shortest)', width: 568, height: 320 },
  { name: '798x384 (the report\'s phone)', width: 798, height: 384 },
  { name: '844x390 (iPhone landscape)', width: 844, height: 390 },
  { name: '915x412 (Pixel landscape)', width: 915, height: 412 },
  { name: '1280x800 (desktop control)', width: 1280, height: 800 },
] as const;

describe('the zoom control is on touch and nowhere else', () => {
  it('is not drawn off touch — desktop already has the wide view', () => {
    expect(showZoomControl(false)).toBe(false);
    for (const p of PROFILES) {
      expect(zoomControlBounds(p.width, p.height, false)).toBeNull();
    }
  });

  it('is drawn on touch at every profile', () => {
    expect(showZoomControl(true)).toBe(true);
    for (const p of PROFILES) {
      expect(zoomControlBounds(p.width, p.height, true)).not.toBeNull();
    }
  });
});

describe('where it sits', () => {
  it('stays inside its declared top-right anchor at every profile', () => {
    for (const p of PROFILES) {
      const rect = zoomControlBounds(p.width, p.height, true)!;
      const zone = resolveAnchor(ZOOM_CONTROL_ANCHOR, { width: p.width, height: p.height });
      expect({ profile: p.name, ok: rectContains(zone, rect) }).toEqual({
        profile: p.name,
        ok: true,
      });
    }
  });

  it('sits under the HOME cluster and never on it', () => {
    for (const p of PROFILES) {
      const rect = zoomControlBounds(p.width, p.height, true)!;
      const m = hudMetrics(p.width, p.height);
      const homeBottom = HUD_PAD + stationChromeHeight(m.scale);
      expect({ profile: p.name, clear: rect.y >= homeBottom }).toEqual({
        profile: p.name,
        clear: true,
      });
      // Right-aligned on the same margin HOME is, so the two read as one column.
      expect(rect.x + rect.width).toBe(p.width - HUD_PAD);
    }
  });

  it('clears the wave clock, which is what the same row could not do', () => {
    // The measurement that chose the placement. `top-center` is the clock's
    // declared zone (GDD §2.2), and on the shortest profile a control beside HOME
    // would have had 38 px of gap to live in.
    for (const p of PROFILES) {
      const rect = zoomControlBounds(p.width, p.height, true)!;
      const clock = resolveAnchor({ region: 'top-center' }, { width: p.width, height: p.height });
      expect({ profile: p.name, clear: rect.x >= clock.x + clock.width }).toEqual({
        profile: p.name,
        clear: true,
      });
    }
  });

  it('gives up its gap rather than its size when the band is short', () => {
    // 568×320 is the profile that decided the clamp: the preferred gap would push
    // the control 4 px past the `top-right` zone floor, so it takes less air —
    // and keeps every one of its 48 px.
    const short = zoomControlBounds(568, 320, true)!;
    const roomy = zoomControlBounds(844, 390, true)!;
    const m = hudMetrics(568, 320);
    const preferred = HUD_PAD + stationChromeHeight(m.scale) + 6;
    expect(short.y).toBeLessThan(preferred);
    expect(short.height).toBe(roomy.height);
    expect(short.height).toBe(TOUCH_TARGET_MIN);
  });

  it('keeps the platform touch floor, unscaled, even on the smallest screen', () => {
    // Every other HUD metric shrinks with the frame; a thumb does not.
    expect(ZOOM_CONTROL_HEIGHT).toBe(TOUCH_TARGET_MIN);
    for (const p of PROFILES) {
      const rect = zoomControlBounds(p.width, p.height, true)!;
      expect(rect.height).toBe(TOUCH_TARGET_MIN);
      expect(rect.width).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
    }
  });
});

describe('what it says, and what it takes', () => {
  it('reads VIEW over the live rung', () => {
    expect(zoomControlLabel(1)).toEqual({ caption: 'VIEW', value: '1×' });
    expect(zoomControlLabel(1.5)).toEqual({ caption: 'VIEW', value: '1.5×' });
    expect(zoomControlLabel(2)).toEqual({ caption: 'VIEW', value: '2×' });
    // Every rung on the ladder has a label — a new rung cannot ship unnamed.
    for (const step of VIEW_ZOOM_STEPS) {
      expect(zoomControlLabel(step).value).toMatch(/^\d+(\.\d+)?×$/);
    }
  });

  it('takes a press inside it, on every edge, and refuses one outside', () => {
    const rect = zoomControlBounds(844, 390, true)!;
    const { x, y, width: w, height: h } = rect;
    for (const [px, py] of [
      [x + w / 2, y + h / 2],
      [x, y],
      [x + w, y + h],
      [x, y + h],
      [x + w, y],
    ] as const) {
      expect(hitZoomControl(px, py, rect)).toBe(true);
    }
    for (const [px, py] of [
      [x - 1, y + h / 2],
      [x + w + 1, y + h / 2],
      [x + w / 2, y - 1],
      [x + w / 2, y + h + 1],
    ] as const) {
      expect(hitZoomControl(px, py, rect)).toBe(false);
    }
  });

  it('refuses every press when there is no control drawn', () => {
    expect(hitZoomControl(10, 10, null)).toBe(false);
    expect(hitZoomControl(10, 10, { x: 0, y: 0, width: 0, height: 0 })).toBe(false);
  });
});
