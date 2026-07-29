/**
 * The panel-chrome skin is the art direction's void material, spelled for the UI
 * layer. This test is the drift guard: it pins every tone in {@link ./chrome}
 * back to the exact `MATERIALS.void.shades` hex it was extracted from, so a hand
 * edit to either side that pulls the UI skin and the art tokens apart fails CI —
 * the same cross-check `button-theme.test` runs on the button space and the art
 * `compliance` suite runs on the sprite palette.
 */

import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../art/tokens';
import {
  PANEL_FILL,
  PANEL_FILL_ALPHA,
  PANEL_RULE,
  PANEL_RULE_ALPHA,
  PANEL_RULE_WIDTH,
  RADIUS,
  TEXT_MUTED,
} from './chrome';

/** The void shade the art direction files under a given `where` note. */
function voidShade(where: string): number {
  const shade = MATERIALS.void.shades.find((s) => s.where === where);
  expect(shade, `art tokens void.shades is missing "${where}"`).toBeDefined();
  return shade!.hex;
}

describe('chrome skin tokens trace to the art direction (ui-mockup / void material)', () => {
  it('panel fill is the void material s "HUD panel fill" shade', () => {
    expect(PANEL_FILL).toBe(voidShade('HUD panel fill'));
  });

  it('the rule is the void material s "HUD hairline / divider rule" shade', () => {
    expect(PANEL_RULE).toBe(voidShade('HUD hairline / divider rule'));
  });

  it('muted text is the void material s "Secondary (muted) HUD label text" shade', () => {
    expect(TEXT_MUTED).toBe(voidShade('Secondary (muted) HUD label text'));
  });

  it('the chrome tones are neutral — never the reserved ore/danger warmth', () => {
    // The whole point of the void material: chrome recedes, it never competes
    // with the two RESERVED signals (style-guide §2). None of the three is warm.
    for (const tone of [PANEL_FILL, PANEL_RULE, TEXT_MUTED]) {
      const r = (tone >> 16) & 0xff;
      const g = (tone >> 8) & 0xff;
      const b = tone & 0xff;
      // Cold: the blue channel is never the smallest — a signal-yellow or
      // threat-red tone would have blue as the runt.
      expect(b, `0x${tone.toString(16)} should be cold (blue not the runt)`).toBeGreaterThanOrEqual(
        Math.min(r, g),
      );
    }
  });
});

describe('panel treatment defaults are sane', () => {
  it('a floating panel is nearly-opaque but lets the world through', () => {
    expect(PANEL_FILL_ALPHA).toBeGreaterThan(0.5);
    expect(PANEL_FILL_ALPHA).toBeLessThanOrEqual(1);
  });

  it('the rule is a single crisp, solid hairline', () => {
    expect(PANEL_RULE_WIDTH).toBe(1);
    expect(PANEL_RULE_ALPHA).toBe(1);
  });
});

describe('the radius scale steps by surface size (card > panel > control > chip > bar)', () => {
  it('is strictly descending — a bigger surface rounds rounder', () => {
    const ladder = [RADIUS.card, RADIUS.panel, RADIUS.control, RADIUS.chip, RADIUS.bar];
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]!, `tier ${i} should be tighter than tier ${i - 1}`).toBeLessThan(ladder[i - 1]!);
    }
  });

  it('every tier is a positive radius', () => {
    for (const r of Object.values(RADIUS)) expect(r).toBeGreaterThan(0);
  });
});
