/**
 * Re-enter-fullscreen affordance tests (fullscreen-affordance.ts; field request
 * v0.1.1). Two things must hold: the button lands inside its declared top-right
 * anchor at every viewport ("no dead corners"), and its tap target is where it is
 * drawn. Geometry is pure (`writeAffordanceRect` / center), so placement needs no
 * canvas; a light construction smoke confirms the Pixi glyph builds headless.
 */
import { describe, it, expect } from 'vitest';
import {
  FullscreenAffordance,
  writeAffordanceRect,
  FS_AFFORDANCE_ANCHOR,
  FS_AFFORDANCE_ID,
  FS_AFFORDANCE_MARGIN,
  FS_AFFORDANCE_RADIUS,
} from './fullscreen-affordance';
import { LayoutRegistry, resolveAnchor, rectContains, type Rect } from '@platform/layout-registry';

function rect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

describe('writeAffordanceRect — the top-right corner', () => {
  it('hugs the top and right edges, inset by the margin', () => {
    const r = writeAffordanceRect(1280, 800, rect());
    expect(r.x + r.width).toBe(1280 - FS_AFFORDANCE_MARGIN);
    expect(r.y).toBe(FS_AFFORDANCE_MARGIN);
    expect(r.width).toBe(2 * FS_AFFORDANCE_RADIUS);
    expect(r.height).toBe(2 * FS_AFFORDANCE_RADIUS);
  });

  it('writes in place — no per-frame allocation', () => {
    const out = rect();
    expect(writeAffordanceRect(800, 600, out)).toBe(out);
  });

  it('follows a resize, staying in the right corner', () => {
    const out = rect();
    writeAffordanceRect(800, 600, out);
    expect(out.x + out.width).toBe(800 - FS_AFFORDANCE_MARGIN);
    writeAffordanceRect(1024, 600, out);
    expect(out.x + out.width).toBe(1024 - FS_AFFORDANCE_MARGIN);
  });
});

describe('placement — inside the declared top-right anchor (no dead corners)', () => {
  // Desktop and a range of phone-landscape logical viewports.
  const viewports = [
    { w: 1280, h: 800 },
    { w: 844, h: 390 }, // iPhone 12/13 landscape
    { w: 667, h: 375 }, // small phone landscape
  ];
  for (const { w, h } of viewports) {
    it(`sits inside top-right at ${w}×${h}`, () => {
      const reg = new LayoutRegistry();
      reg.beginFrame();
      reg.register(FS_AFFORDANCE_ID, FS_AFFORDANCE_ANCHOR, writeAffordanceRect(w, h, rect()));
      expect(reg.withinAnchor(FS_AFFORDANCE_ID, { width: w, height: h })).toBe(true);
    });
  }

  it('the declared zone is the top-right band', () => {
    const zone = resolveAnchor(FS_AFFORDANCE_ANCHOR, { width: 1000, height: 900 });
    // Right band starts at W/2; top band ends at H/3. The affordance rect must fit.
    expect(rectContains(zone, writeAffordanceRect(1000, 900, rect()))).toBe(true);
  });
});

describe('FullscreenAffordance — the Pixi view', () => {
  it('constructs headless (glyph geometry builds without a canvas) and starts hidden', () => {
    const a = new FullscreenAffordance();
    expect(a.label).toBe(FS_AFFORDANCE_ID);
    expect(a.visible).toBe(false);
  });

  it('update toggles visibility and corners itself in logical space', () => {
    const a = new FullscreenAffordance();
    a.update(true, 1280, 800);
    expect(a.visible).toBe(true);
    expect(a.position.x).toBe(1280 - FS_AFFORDANCE_MARGIN - FS_AFFORDANCE_RADIUS);
    expect(a.position.y).toBe(FS_AFFORDANCE_MARGIN + FS_AFFORDANCE_RADIUS);
    a.update(false, 1280, 800);
    expect(a.visible).toBe(false);
  });

  it('hitTest accepts a tap on the button and rejects one far away', () => {
    const a = new FullscreenAffordance();
    const w = 1280;
    const h = 800;
    const cx = w - FS_AFFORDANCE_MARGIN - FS_AFFORDANCE_RADIUS;
    const cy = FS_AFFORDANCE_MARGIN + FS_AFFORDANCE_RADIUS;
    expect(a.hitTest(cx, cy, w, h)).toBe(true);
    // Just past the radius on the x-axis — outside the circular target.
    expect(a.hitTest(cx - FS_AFFORDANCE_RADIUS - 2, cy, w, h)).toBe(false);
    // Bottom-left corner (where a stick lives) never hits the top-right button.
    expect(a.hitTest(20, h - 20, w, h)).toBe(false);
  });
});
