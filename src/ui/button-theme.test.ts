/**
 * src/ui/button-theme.test.ts — the style contract, made enforceable.
 * OWNER: UI Engineer.
 *
 * The v0.2.2 field report: menu buttons in gray that read as *disabled* while
 * being fully clickable (SETTINGS on the main menu, one of the two end-screen
 * buttons). The fix was to funnel every menu button through the one
 * {@link ./button-theme} contract; this test is the fence around it.
 *
 * The contract has exactly three looks — PRIMARY, STANDARD, DISABLED — and every
 * button on every screen resolves to one of them through {@link buttonStyle}. So
 * walking this enumerable space walks every appearance a registered interactive
 * control can take, and the invariant is simply: **an ENABLED control may never
 * land in the disabled token region.** Reintroduce a gray-active button — here,
 * or by editing the tokens — and it fails before it reaches a screenshot.
 */
import { describe, it, expect } from 'vitest';
import { TEXT_DIM, TEXT_PRIMARY } from './typography';
import {
  BUTTON_STYLES,
  DISABLED_LABEL,
  DISABLED_LABEL_ALPHA,
  ENABLED_LABEL_MIN_ALPHA,
  buttonStyle,
  usesDisabledTokens,
  type ButtonVariant,
} from './button-theme';

const VARIANTS: ButtonVariant[] = ['primary', 'standard'];

describe('button-theme — the one style contract (field report v0.2.2)', () => {
  it('every ENABLED variant is unmistakably active — never the disabled costume', () => {
    // This is the whole point: walk each enabled look a control can take and
    // prove none of them borrows the gray/dim vocabulary of "disabled".
    for (const variant of VARIANTS) {
      const style = buttonStyle(variant);
      expect(usesDisabledTokens(style)).toBe(false);
      // Full-contrast label, at full opacity — the gray label was the bug.
      expect(style.label).toBe(TEXT_PRIMARY);
      expect(style.label).not.toBe(DISABLED_LABEL);
      expect(style.labelAlpha).toBeGreaterThanOrEqual(ENABLED_LABEL_MIN_ALPHA);
      // A visible border, always.
      expect(style.strokeWidth).toBeGreaterThanOrEqual(2);
      expect(style.strokeAlpha).toBeGreaterThan(0.5);
    }
  });

  it('DISABLED is the only look in the disabled token region — and it is dim', () => {
    const disabled = buttonStyle('primary', true);
    expect(disabled).toBe(buttonStyle('standard', true)); // variant-independent
    expect(usesDisabledTokens(disabled)).toBe(true);
    expect(disabled.label).toBe(DISABLED_LABEL);
    expect(disabled.label).toBe(TEXT_DIM);
    expect(disabled.labelAlpha).toBe(DISABLED_LABEL_ALPHA);
    expect(disabled.labelAlpha).toBeLessThan(ENABLED_LABEL_MIN_ALPHA);
  });

  it('PRIMARY vs STANDARD differ in EMPHASIS, never in vitality', () => {
    const primary = buttonStyle('primary');
    const standard = buttonStyle('standard');
    // Same vitality signals: full-contrast label and a 2px border on both.
    expect(standard.label).toBe(primary.label);
    expect(standard.labelAlpha).toBe(primary.labelAlpha);
    expect(standard.strokeWidth).toBe(primary.strokeWidth);
    // Emphasis differs: primary is plasma, standard is steel.
    expect(standard.fill).not.toBe(primary.fill);
    expect(standard.stroke).not.toBe(primary.stroke);
  });

  it('the enumerated BUTTON_STYLES table matches the resolver, exhaustively', () => {
    expect(BUTTON_STYLES.primary).toBe(buttonStyle('primary'));
    expect(BUTTON_STYLES.standard).toBe(buttonStyle('standard'));
    expect(BUTTON_STYLES.disabled).toBe(buttonStyle('primary', true));
    // Exactly one look in the table sits in the disabled region — no more.
    const inRegion = Object.values(BUTTON_STYLES).filter(usesDisabledTokens);
    expect(inRegion).toEqual([BUTTON_STYLES.disabled]);
  });

  it('usesDisabledTokens catches both ways an enabled button could look dead', () => {
    // A dim label…
    expect(usesDisabledTokens({ ...BUTTON_STYLES.standard, label: DISABLED_LABEL })).toBe(true);
    // …or a faded one.
    expect(usesDisabledTokens({ ...BUTTON_STYLES.standard, labelAlpha: 0.3 })).toBe(true);
  });
});
