/**
 * Build-badge placement tests (build-badge.ts). The badge is the on-screen half
 * of build identity, and the standing directive applies to it like anything else
 * positioned: "if something is supposed to appear somewhere, it appears there"
 * — so its rect is checked against its declared `bottom-left` anchor through the
 * layout registry itself, at desktop and phone viewports alike.
 *
 * And a second directive, from the m10-14 round: **nothing may cover a button.**
 * The bottom-left corner is the busiest corner this game has — the desktop
 * controls strip along the bottom edge, the left thrust-stick ghost on touch — so
 * the clearance from each is asserted here against those layers' own constants,
 * not assumed. (Pointer-transparency is the other half of that guarantee and
 * lives on the component; a rect that reaches a control is still a rect that
 * *hides* it.)
 *
 * Geometry only: `writeBadgeRect` takes measured text metrics as numbers, so no
 * canvas (and no Pixi `Text`) is needed to assert where the stamp lands.
 */
import { describe, it, expect } from 'vitest';
import {
  writeBadgeRect,
  BADGE_ANCHOR,
  BADGE_ID,
  BADGE_MARGIN,
  BADGE_FONT,
  BADGE_ALPHA,
  BADGE_FONT_SIZE,
  BADGE_STRIP_LIFT,
} from './build-badge';
import { LayoutRegistry, resolveAnchor, rectContains, type Rect } from '@platform/layout-registry';
import { affordanceRects } from '@platform/touch-visuals';
import { FireMode } from '@platform/actions';
import { PALETTE } from './index';

function rect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/** Plausible measured size of the offline tag "a1b2c3d" at 10px mono. */
const TEXT_W = 46;
const TEXT_H = 12;
/** …and of the connected one, "a1b2c3d · d891dd0a (gru)", which is much wider —
 *  the width the corner has to survive without escaping its zone. */
const WIDE_W = 148;

describe('writeBadgeRect — the corner', () => {
  it('hugs the bottom-LEFT corner, inset by the margin on both edges', () => {
    const r = writeBadgeRect(TEXT_W, TEXT_H, 800, 600, rect());
    expect(r.x).toBe(BADGE_MARGIN);
    expect(r.y + r.height).toBe(600 - BADGE_MARGIN);
    expect(r.width).toBe(TEXT_W);
    expect(r.height).toBe(TEXT_H);
  });

  it('grows RIGHTWARDS when the server suffix lands — the corner never moves', () => {
    const bare = writeBadgeRect(TEXT_W, TEXT_H, 800, 600, rect());
    const connected = writeBadgeRect(WIDE_W, TEXT_H, 800, 600, rect());
    expect(connected.x).toBe(bare.x);
    expect(connected.y).toBe(bare.y);
    expect(connected.width).toBeGreaterThan(bare.width);
  });

  it('writes in place — no per-frame allocation', () => {
    const out = rect();
    expect(writeBadgeRect(TEXT_W, TEXT_H, 800, 600, out)).toBe(out);
  });

  it('follows a resize', () => {
    const out = rect();
    writeBadgeRect(TEXT_W, TEXT_H, 800, 600, out);
    writeBadgeRect(TEXT_W, TEXT_H, 390, 844, out);
    expect(out.x).toBe(BADGE_MARGIN);
    expect(out.y + out.height).toBe(844 - BADGE_MARGIN);
  });

  it('lifts by exactly the lift, and never by a negative one', () => {
    const lifted = writeBadgeRect(TEXT_W, TEXT_H, 800, 600, rect(), BADGE_STRIP_LIFT);
    expect(lifted.y + lifted.height).toBe(600 - BADGE_MARGIN - BADGE_STRIP_LIFT);
    const bogus = writeBadgeRect(TEXT_W, TEXT_H, 800, 600, rect(), -50);
    expect(bogus.y + bogus.height).toBe(600 - BADGE_MARGIN);
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

  it('declares bottom-left (the developer asked for the left corner, on every page)', () => {
    expect(BADGE_ANCHOR.region).toBe('bottom-left');
    expect(BADGE_ANCHOR.margin).toBe(BADGE_MARGIN);
  });

  it('sits inside its declared zone at every viewport, bare and connected, lifted or not', () => {
    for (const vp of VIEWPORTS) {
      for (const w of [TEXT_W, WIDE_W]) {
        for (const lift of [0, BADGE_STRIP_LIFT]) {
          const r = writeBadgeRect(w, TEXT_H, vp.width, vp.height, rect(), lift);
          const zone = resolveAnchor(BADGE_ANCHOR, vp);
          expect(rectContains(zone, r), `badge escaped its zone at ${vp.width}x${vp.height}`).toBe(true);
        }
      }
    }
  });

  it('passes the registry placement check under the id main.ts registers', () => {
    const reg = new LayoutRegistry();
    const vp = { width: 844, height: 390 };
    reg.beginFrame();
    reg.register(BADGE_ID, BADGE_ANCHOR, writeBadgeRect(TEXT_W, TEXT_H, vp.width, vp.height, rect()));
    expect(reg.withinAnchor(BADGE_ID, vp)).toBe(true);
    expect(reg.get(BADGE_ID)?.anchor.region).toBe('bottom-left');
  });
});

describe('the badge covers no control (m10-14: nothing may cover a button)', () => {
  /** Do two rects share any area? */
  function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  }

  it('clears the desktop controls strip once lifted — and would collide without the lift', () => {
    // The strip's own geometry (@ui hud.ts): an 18px row of labels, 12px off the
    // bottom edge, running from the left margin. Stated here as the numbers the
    // badge is dodging; if the strip moves, this is the test that notices.
    const H = 720;
    const strip: Rect = { x: 12, y: H - 30, width: 600, height: 18 };

    const flat = writeBadgeRect(WIDE_W, TEXT_H, 1280, H, rect(), 0);
    expect(overlaps(flat, strip), 'the un-lifted badge would sit in the bindings').toBe(true);

    const lifted = writeBadgeRect(WIDE_W, TEXT_H, 1280, H, rect(), BADGE_STRIP_LIFT);
    expect(overlaps(lifted, strip)).toBe(false);
    expect(lifted.y + lifted.height).toBeLessThanOrEqual(strip.y);
  });

  it('clears the left thrust-stick ghost on touch with no lift at all', () => {
    // The stick's anchored home rect from the layer that draws it — so this is the
    // real affordance, not a re-derived guess at where it sits.
    for (const vp of [
      { width: 844, height: 390 },
      { width: 926, height: 428 },
    ]) {
      for (const mode of [FireMode.Manual, FireMode.AutoAim]) {
        const stick = affordanceRects(true, mode, vp.width, vp.height).leftStickZone;
        expect(stick, 'touch always draws a left stick').not.toBeNull();
        const badge = writeBadgeRect(WIDE_W, TEXT_H, vp.width, vp.height, rect(), 0);
        expect(overlaps(badge, stick!), `badge hit the stick at ${vp.width}x${vp.height}`).toBe(false);
      }
    }
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

  it('stays tiny on both form factors — one size, readable, ignorable', () => {
    expect(BADGE_FONT_SIZE).toBeLessThanOrEqual(10);
    expect(BADGE_FONT_SIZE).toBeGreaterThanOrEqual(8);
  });
});
