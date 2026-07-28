/**
 * src/art/vfx/shots.test.ts — the DAMAGE-tier shot ramp is legal and legible.
 *
 * The ramp is the developer's ratified "power you can see" (p11-06): a shooter's
 * weapon tier tints its shot. This test holds the ramp to the two rules that make
 * it safe (style-guide §2) and the one that makes it useful:
 *
 *  - it never spends a reserved hue (no rung is signal yellow or a yellow shade);
 *  - "whose shot" stays instant (own fire stays plasma, enemy fire stays threat
 *    red — the tier ramp modulates *within* each side's family, never across it);
 *  - "how strong" reads at a glance (each rung is brighter than the one below).
 *
 * The rung colours are also audited structurally through the catalogue by
 * `compliance.test.ts`; this file covers the ramp's own shape and monotonicity.
 */

import { describe, it, expect } from 'vitest';
import { ALLOWED_COLORS, PALETTE, WHITE } from '../palette';
import { RED_FAMILY, YELLOW_FAMILY, auditSprite } from '../compliance';
import {
  SHOT_FAMILIES,
  SHOT_MAX_TIER,
  SHOT_TIERS,
  SHOT_TIER_COLORS,
  clampShotTier,
  shotGlowScale,
  shotSprite,
  shotTierColor,
} from './shots';

/** Perceived luminance of a packed RGB (Rec. 601 weights) — the "how bright". */
function luminance(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe('DAMAGE-tier shot ramp', () => {
  it('has a base plus three upgrade rungs, both families the same depth', () => {
    expect(SHOT_MAX_TIER).toBe(3);
    expect(SHOT_TIERS).toEqual([0, 1, 2, 3]);
    for (const family of SHOT_FAMILIES) {
      expect(SHOT_TIER_COLORS[family]).toHaveLength(SHOT_MAX_TIER + 1);
    }
  });

  it('starts each family at its own base hue — whose shot stays instant', () => {
    expect(shotTierColor('own', 0)).toBe(PALETTE.plasma);
    expect(shotTierColor('enemy', 0)).toBe(PALETTE.threatRed);
  });

  it('keeps every rung on the palette allow-list (a declared shade, no seventh hue)', () => {
    for (const family of SHOT_FAMILIES) {
      for (const tier of SHOT_TIERS) {
        expect(ALLOWED_COLORS.has(shotTierColor(family, tier))).toBe(true);
      }
    }
  });

  it('never spends signal yellow — the ramp brightens toward white, not toward gold', () => {
    for (const family of SHOT_FAMILIES) {
      for (const tier of SHOT_TIERS) {
        expect(YELLOW_FAMILY.has(shotTierColor(family, tier))).toBe(false);
      }
    }
  });

  it('keeps enemy fire in the threat-red family and own fire out of it', () => {
    for (const tier of SHOT_TIERS) {
      expect(RED_FAMILY.has(shotTierColor('enemy', tier))).toBe(true);
      expect(RED_FAMILY.has(shotTierColor('own', tier))).toBe(false);
    }
  });

  it('brightens monotonically with the tier — a stronger shot reads hotter', () => {
    for (const family of SHOT_FAMILIES) {
      for (let tier = 1; tier <= SHOT_MAX_TIER; tier++) {
        const lower = luminance(shotTierColor(family, tier - 1));
        const upper = luminance(shotTierColor(family, tier));
        expect(upper).toBeGreaterThan(lower);
      }
    }
    // ...but no rung reaches pure white — the hue is still legible at the top.
    for (const family of SHOT_FAMILIES) {
      expect(shotTierColor(family, SHOT_MAX_TIER)).not.toBe(WHITE);
    }
  });

  it('grows the glow with the tier, from the shot radius outward', () => {
    expect(shotGlowScale(0)).toBe(1);
    for (let tier = 1; tier <= SHOT_MAX_TIER; tier++) {
      expect(shotGlowScale(tier)).toBeGreaterThan(shotGlowScale(tier - 1));
    }
  });

  it('clamps a missing/over-max/NaN tier to the nearest rung', () => {
    expect(clampShotTier(-3)).toBe(0);
    expect(clampShotTier(99)).toBe(SHOT_MAX_TIER);
    expect(clampShotTier(Number.NaN)).toBe(0);
    expect(clampShotTier(2.9)).toBe(2);
    // A shot far past the top ladder still tints as the hottest rung, never crashes.
    expect(shotTierColor('enemy', 42)).toBe(shotTierColor('enemy', SHOT_MAX_TIER));
  });

  it('bakes a palette-compliant sprite for every rung — glow over a bright core', () => {
    for (const family of SHOT_FAMILIES) {
      for (const tier of SHOT_TIERS) {
        const def = shotSprite(family, tier);
        expect(def.shapes).toHaveLength(2); // glow + core
        expect(auditSprite(def)).toEqual([]);
        // The sprite carries the rung's colour, on the family's role.
        const role = family === 'own' ? 'energy' : 'danger';
        expect(def.shapes.every((s) => s.role === role)).toBe(true);
        expect(def.shapes.every((s) => s.fill?.color === shotTierColor(family, tier))).toBe(true);
      }
    }
  });
});
