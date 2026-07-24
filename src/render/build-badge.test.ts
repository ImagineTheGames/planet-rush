/**
 * Build-badge placement tests (build-badge.ts). The badge is the on-screen half
 * of build identity, and the standing directive applies to it like anything else
 * positioned: "if something is supposed to appear somewhere, it appears there"
 * — so its rect is checked against its declared `bottom-right` anchor through
 * the layout registry itself, at desktop and phone viewports alike.
 *
 * Geometry only: `writeBadgeRect` takes measured text metrics as numbers, so no
 * canvas (and no Pixi `Text`) is needed to assert where the stamp lands.
 */
import { describe, it, expect } from 'vitest';
import { writeBadgeRect, BADGE_ANCHOR, BADGE_ID, BADGE_MARGIN, BADGE_FONT, BADGE_ALPHA } from './build-badge';
import { LayoutRegistry, resolveAnchor, rectContains, type Rect } from '@platform/layout-registry';
import { PALETTE } from './index';

function rect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/** Plausible measured size of "a1b2c3d · 09:07Z" at 10px mono. */
const TEXT_W = 92;
const TEXT_H = 12;

describe('writeBadgeRect — the corner', () => {
  it('hugs the bottom-right corner, inset by the margin on both edges', () => {
    const r = writeBadgeRect(TEXT_W, TEXT_H, 800, 600, rect());
    expect(r.x + r.width).toBe(800 - BADGE_MARGIN);
    expect(r.y + r.height).toBe(600 - BADGE_MARGIN);
    expect(r.width).toBe(TEXT_W);
    expect(r.height).toBe(TEXT_H);
  });

  it('writes in place — no per-frame allocation', () => {
    const out = rect();
    expect(writeBadgeRect(TEXT_W, TEXT_H, 800, 600, out)).toBe(out);
  });

  it('follows a resize', () => {
    const out = rect();
    writeBadgeRect(TEXT_W, TEXT_H, 800, 600, out);
    writeBadgeRect(TEXT_W, TEXT_H, 390, 844, out);
    expect(out.x + out.width).toBe(390 - BADGE_MARGIN);
    expect(out.y + out.height).toBe(844 - BADGE_MARGIN);
  });
});

describe('badge placement vs its declared anchor', () => {
  // Desktop, laptop, phone landscape, phone portrait.
  const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ];

  it('declares bottom-right', () => {
    expect(BADGE_ANCHOR.region).toBe('bottom-right');
    expect(BADGE_ANCHOR.margin).toBe(BADGE_MARGIN);
  });

  it('sits inside its declared zone at every viewport', () => {
    for (const vp of VIEWPORTS) {
      const r = writeBadgeRect(TEXT_W, TEXT_H, vp.width, vp.height, rect());
      const zone = resolveAnchor(BADGE_ANCHOR, vp);
      expect(rectContains(zone, r), `badge escaped its zone at ${vp.width}x${vp.height}`).toBe(true);
    }
  });

  it('passes the registry placement check under the id main.ts registers', () => {
    const reg = new LayoutRegistry();
    const vp = { width: 844, height: 390 };
    reg.beginFrame();
    reg.register(BADGE_ID, BADGE_ANCHOR, writeBadgeRect(TEXT_W, TEXT_H, vp.width, vp.height, rect()));
    expect(reg.withinAnchor(BADGE_ID, vp)).toBe(true);
    expect(reg.get(BADGE_ID)?.anchor.region).toBe('bottom-right');
  });
});

describe('badge styling — the frozen art contract (style-guide §1/§2)', () => {
  it('is muted hull steel, never RESERVED signal yellow or threat red', () => {
    expect(PALETTE.hullSteel).toBe(0x7e8894);
    expect(BADGE_ALPHA).toBeLessThan(1);
  });

  it('is set in a mono stack ending in the generic monospace family', () => {
    expect(BADGE_FONT).toMatch(/monospace$/);
    expect(BADGE_FONT).toContain('IBM Plex Mono');
  });
});
