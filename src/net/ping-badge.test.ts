/**
 * The in-match ping stamp (ping-badge.ts) — where it lands and what colour it is.
 * OWNER: Netcode Engineer (ratified developer: "the player's OWN ping in a corner
 * of the HUD — small, mono, no box").
 *
 * Geometry only, like `@render/build-badge`'s own suite: {@link writePingRect}
 * takes measured text metrics as numbers, so the corner is asserted with no
 * canvas and no Pixi `Text`. The two claims worth a test are that it stacks
 * *above* the build stamp instead of on top of it — the corner it shares is the
 * busiest one this game has — and that the grade colours are the palette's, not
 * invented hues (style-guide §1: no seventh material colour).
 */
import { describe, it, expect } from 'vitest';
import {
  PING_BADGE_ANCHOR,
  PING_BADGE_ID,
  PING_BADGE_STACK_LIFT,
  PING_GRADE_COLORS,
  writePingRect,
} from './ping-badge';
import { BADGE_MARGIN, BADGE_STRIP_LIFT, writeBadgeRect } from '@render/build-badge';
import { LayoutRegistry, resolveAnchor, rectContains, type Rect } from '@platform/layout-registry';
import { PALETTE } from '@render/index';

function rect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/** Plausible measured size of "245ms" at 10px mono, and of the build stamp. */
const PING_W = 34;
const PING_H = 12;
const STAMP_W = 46;
const STAMP_H = 12;

describe('writePingRect — the corner', () => {
  it('hugs the bottom-LEFT corner, inset by the same margin as the build stamp', () => {
    const r = writePingRect(PING_W, PING_H, 800, 600, rect());
    expect(r.x).toBe(BADGE_MARGIN);
    expect(r.y + r.height).toBe(600 - BADGE_MARGIN);
  });

  it('writes in place — no per-frame allocation', () => {
    const out = rect();
    expect(writePingRect(PING_W, PING_H, 800, 600, out)).toBe(out);
  });

  it('follows a resize, and a phone viewport', () => {
    const out = rect();
    writePingRect(PING_W, PING_H, 800, 600, out);
    writePingRect(PING_W, PING_H, 844, 390, out);
    expect(out.x).toBe(BADGE_MARGIN);
    expect(out.y + out.height).toBe(390 - BADGE_MARGIN);
  });

  it('never lifts by a negative amount', () => {
    const bogus = writePingRect(PING_W, PING_H, 800, 600, rect(), -50);
    expect(bogus.y + bogus.height).toBe(600 - BADGE_MARGIN);
  });
});

describe('the stack — a ping must not land on the sha', () => {
  it('sits clear ABOVE the build stamp at its own lift', () => {
    const stamp = writeBadgeRect(STAMP_W, STAMP_H, 800, 600, rect());
    const ping = writePingRect(PING_W, PING_H, 800, 600, rect(), PING_BADGE_STACK_LIFT);
    // Its bottom edge is above the stamp's top edge: two lines, not one pile.
    expect(ping.y + ping.height).toBeLessThanOrEqual(stamp.y);
  });

  it('stays clear when the desktop controls strip lifts the pair together', () => {
    const stamp = writeBadgeRect(STAMP_W, STAMP_H, 800, 600, rect(), BADGE_STRIP_LIFT);
    const ping = writePingRect(
      PING_W,
      PING_H,
      800,
      600,
      rect(),
      BADGE_STRIP_LIFT + PING_BADGE_STACK_LIFT,
    );
    expect(ping.y + ping.height).toBeLessThanOrEqual(stamp.y);
    // …and both are still off the bottom edge the strip owns.
    expect(stamp.y + stamp.height).toBeLessThan(600 - BADGE_MARGIN);
  });
});

describe('the declared placement', () => {
  it('lands inside the zone its own anchor resolves to — the registry contract', () => {
    const viewport = { width: 800, height: 600 };
    const reg = new LayoutRegistry();
    reg.beginFrame();
    reg.register(PING_BADGE_ID, PING_BADGE_ANCHOR, writePingRect(PING_W, PING_H, 800, 600, rect()));
    const entry = reg.entries().find((e) => e.id === PING_BADGE_ID);
    expect(entry).toBeDefined();
    expect(rectContains(resolveAnchor(PING_BADGE_ANCHOR, viewport), entry!.bounds)).toBe(true);
  });
});

describe('the grade colours', () => {
  it('are the Cold Vacuum palette and nothing else (style-guide §1)', () => {
    expect(PING_GRADE_COLORS.good).toBe(PALETTE.patina);
    expect(PING_GRADE_COLORS.fair).toBe(PALETTE.signalYellow);
    expect(PING_GRADE_COLORS.poor).toBe(PALETTE.threatRed);
  });

  it('are three DISTINCT colours — the grade must survive being read at a glance', () => {
    const hues = new Set(Object.values(PING_GRADE_COLORS));
    expect(hues.size).toBe(3);
  });
});
