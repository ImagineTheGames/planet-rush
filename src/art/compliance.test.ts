/**
 * The RESERVED rule, enforced across the whole art set (style-guide §2):
 *
 * > **Signal yellow `#F2D24B` means ore or danger, and nothing else. Ever.**
 *
 * This is the test that makes the style guide a contract rather than a document.
 * It walks every sprite in the catalogue — every hull, every livery, every crack
 * stage, every turret state — and checks every colour on every shape against the
 * roles the guide allows it on. It also re-derives every shade from its recipe,
 * so the "no seventh material colour" rule holds against a hand-edited hex, and
 * cross-checks the palette against the render layer's copy so the two can never
 * drift into two different Cold Vacuums.
 */

import { describe, expect, it } from 'vitest';
import { PALETTE as RENDER_PALETTE, PLAYER_COLORS as RENDER_ROSTER } from '@render/index';
import { ALL_SPRITES, ART_CATALOGUE } from './catalogue';
import { assertPaletteCompliance, auditAll, auditSprite, formatViolations } from './compliance';
import {
  ALLOWED_COLORS,
  DERIVED,
  DERIVED_RECIPES,
  PALETTE,
  PLAYER_COLORS,
  derive,
  hex,
  type DerivedKey,
} from './palette';
import { circle, fill, sprite, spriteColors } from './shapes';
import {
  MATERIALS,
  PALETTE as TOKENS,
  PLAYER_ROSTER,
  WHITE as TOKEN_WHITE,
  type MaterialName,
  type PaletteKey,
} from './tokens';

describe('tokens.ts is the art-direction single source (a2-01)', () => {
  it('owns the six hexes: palette.ts re-exports them, never re-declares them', () => {
    expect(TOKENS).toEqual({
      vacuum: 0x0d1015,
      hullSteel: 0x7e8894,
      patina: 0x4fa08b,
      signalYellow: 0xf2d24b,
      plasma: 0x4dc3ff,
      threatRed: 0xb23a3a,
    });
    // Not a copy that could drift — the very same object flows through the art
    // layer and (via the cross-check below) the render layer.
    expect(PALETTE).toBe(TOKENS);
    expect(PLAYER_COLORS).toBe(PLAYER_ROSTER);
  });

  it('grounds the allow-list: the six + white all trace back to tokens', () => {
    for (const c of Object.values(TOKENS)) expect(ALLOWED_COLORS.has(c)).toBe(true);
    expect(ALLOWED_COLORS.has(TOKEN_WHITE)).toBe(true);
    for (const c of PLAYER_ROSTER) expect(ALLOWED_COLORS.has(c)).toBe(true);
  });

  it('names every palette colour in exactly one material family (steel/ice/ember/void)', () => {
    const claimed = new Map<PaletteKey, MaterialName>();
    for (const name of Object.keys(MATERIALS) as MaterialName[]) {
      for (const base of MATERIALS[name].bases) {
        expect(claimed.has(base), `${base} claimed by two families`).toBe(false);
        expect(Object.keys(TOKENS)).toContain(base);
        claimed.set(base, name);
      }
    }
    expect([...claimed.keys()].sort()).toEqual(Object.keys(TOKENS).sort());
  });
});

describe('palette (style-guide §1, §3.1)', () => {
  it('is the six frozen colours, exactly', () => {
    expect(PALETTE).toEqual({
      vacuum: 0x0d1015,
      hullSteel: 0x7e8894,
      patina: 0x4fa08b,
      signalYellow: 0xf2d24b,
      plasma: 0x4dc3ff,
      threatRed: 0xb23a3a,
    });
  });

  it('is the same Cold Vacuum the render layer draws with — one palette, not two', () => {
    expect(PALETTE).toEqual(RENDER_PALETTE);
    expect([...PLAYER_COLORS]).toEqual([...RENDER_ROSTER]);
  });

  it('is the eight-slot roster, clear of ore yellow and danger red', () => {
    expect(PLAYER_COLORS).toHaveLength(8);
    expect(new Set(PLAYER_COLORS).size).toBe(8);
    expect(PLAYER_COLORS).not.toContain(PALETTE.signalYellow);
    expect(PLAYER_COLORS).not.toContain(PALETTE.threatRed);
  });

  it('admits no seventh hue: every shade recomputes from its declared recipe', () => {
    for (const key of Object.keys(DERIVED_RECIPES) as DerivedKey[]) {
      expect(DERIVED[key], `${key} (${hex(DERIVED[key])}) ≠ its recipe ${hex(derive(key))}`).toBe(derive(key));
      // And the recipe is a *value* operation on one of the six — never a mix
      // of two hues, which is how a seventh colour would sneak in.
      expect(['vacuum', 'white']).toContain(DERIVED_RECIPES[key].toward);
      expect(Object.keys(PALETTE)).toContain(DERIVED_RECIPES[key].base);
    }
  });
});

describe('the RESERVED rule across the whole catalogue (style-guide §2)', () => {
  it('covers a catalogue worth checking', () => {
    expect(ALL_SPRITES.length).toBeGreaterThan(60);
    // Every generator family is represented, so "compliant" means the art set,
    // not a sample of it.
    const names = ALL_SPRITES.map((d) => d.name).join(' ');
    for (const family of ['ship/', 'planet/', 'asteroid/', 'ore/', 'turret/', 'shield/', 'wreck/', 'build/']) {
      expect(names, `catalogue has no ${family} sprites`).toContain(family);
    }
  });

  it('passes: no yellow outside ore, core and danger; no red outside danger', () => {
    const violations = auditAll(ALL_SPRITES);
    expect(violations.length, `\n${formatViolations(violations)}`).toBe(0);
    expect(() => assertPaletteCompliance(ALL_SPRITES)).not.toThrow();
  });

  it('uses only allow-listed colours everywhere', () => {
    for (const def of ALL_SPRITES) {
      for (const color of spriteColors(def)) {
        expect(ALLOWED_COLORS.has(color), `${def.name} uses ${hex(color)}`).toBe(true);
      }
    }
  });

  it('keeps every entity legible against Vacuum — nothing is painted the background', () => {
    for (const entry of ART_CATALOGUE) {
      const colors = spriteColors(entry.def);
      const onlyVacuum = colors.length > 0 && colors.every((c) => c === PALETTE.vacuum);
      expect(onlyVacuum, `${entry.def.name} is invisible on Vacuum`).toBe(false);
    }
  });

  // --- The audit has to be able to fail, or it proves nothing --------------

  it('catches yellow used as decoration', () => {
    const bad = sprite('test/bad-yellow', 1, [circle(0, 0, 1, fill(PALETTE.signalYellow, 'material'))]);
    const v = auditSprite(bad);
    expect(v.map((x) => x.rule)).toContain('reserved-yellow');
  });

  it('catches threat red used as a friendly accent', () => {
    const bad = sprite('test/bad-red', 1, [circle(0, 0, 1, fill(PALETTE.threatRed, 'identity'))]);
    expect(auditSprite(bad).map((x) => x.rule)).toContain('reserved-red');
  });

  it('catches a hull repainted in a player colour', () => {
    const bad = sprite('test/bad-hull', 1, [circle(0, 0, 1, fill(PLAYER_COLORS[0], 'material'))]);
    expect(auditSprite(bad).map((x) => x.rule)).toContain('identity-trim');
  });

  it('catches a seventh colour', () => {
    const bad = sprite('test/bad-hue', 1, [circle(0, 0, 1, fill(0xff00ff, 'material'))]);
    expect(auditSprite(bad).map((x) => x.rule)).toContain('allow-list');
    expect(() => assertPaletteCompliance([bad])).toThrow(/palette violation/);
  });
});
