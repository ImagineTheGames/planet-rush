/**
 * src/ui/button-theme.ts — the ONE button style contract. OWNER: UI Engineer.
 *
 * The v0.2.2 field report: the main menu drew PLAY as a bright primary and
 * SETTINGS in gray that read as *inactive*; the same stray gray sat on the
 * settings buttons and on one of the two end-screen buttons. Cause: every menu
 * screen carried its own hand-rolled `drawButton`, and each spelled the
 * non-primary case as a hull-steel label — a **dim gray label**. But gray/dim is
 * the vocabulary of *disabled*, and this directory already ratified the rule
 * that **disabled always carries its reason** (the p4-03 rule; see
 * {@link ./affordability} and the lobby RUSH hint). A standard button that is
 * fully clickable must never borrow the disabled costume.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * There are exactly two ENABLED looks and one DISABLED look:
 *
 *   PRIMARY   — the screen's one headline action (PLAY, RUSH!, REMATCH). Plasma.
 *   STANDARD  — everything else the player can do right now (SETTINGS, MAIN
 *               MENU, BACK, DONE). Steel. **Full-contrast label, visible
 *               border** — just as unmistakably active as PRIMARY.
 *   DISABLED  — cannot be acted on *this instant* (a guest's RUSH before the
 *               host starts). Dim/gray, and the caller must show the reason
 *               (p4-03). This is the ONLY place gray is allowed.
 *
 * The visual gap between PRIMARY and STANDARD is **emphasis, never vitality**:
 * both wear a full-contrast chalk label and a 2px border; they differ only in
 * hue (plasma vs steel) and fill weight. Nothing here is signal yellow
 * (reserved: ore) or threat red (reserved: danger) — see style-guide §1/§2.
 *
 * Pure data + one resolver. No Pixi, no DOM — every menu view imports
 * {@link buttonStyle} and applies the tokens it returns, so a face/colour change
 * is one edit here and the style-contract test ({@link ./button-theme.test})
 * walks this whole space to prove no ENABLED look ever falls into the disabled
 * token region. A future gray-active button is now unrepresentable without
 * editing this file, and editing it to reintroduce one fails CI.
 */

import { PALETTE } from '@render/index';
import { TEXT_DIM, TEXT_PRIMARY } from './typography';

/** The two enabled looks. DISABLED is not a variant — it is the state below. */
export type ButtonVariant = 'primary' | 'standard';

/** The resolved visual tokens a view draws a single button from. */
export interface ButtonStyle {
  /** Body fill colour. */
  readonly fill: number;
  readonly fillAlpha: number;
  /** Border colour, width, opacity — a border is always *visible* when enabled. */
  readonly stroke: number;
  readonly strokeWidth: number;
  readonly strokeAlpha: number;
  /** Label colour and opacity. Full-contrast when enabled; dim only when disabled. */
  readonly label: number;
  readonly labelAlpha: number;
}

// ---------------------------------------------------------------------------
// The disabled token region — the thresholds the contract test guards.
// ---------------------------------------------------------------------------
//
// "Reads as disabled" is operationalised as: a dim label. The label is the
// fastest read on a button, so the rule keys on it — an enabled control's label
// must be the full-contrast chalk (TEXT_PRIMARY) at full opacity, never the
// hull-steel dim (TEXT_DIM) and never faded. Cross this line and the button
// lies about whether it can be pressed.

/** The gray reserved for a disabled label (hull steel — same as {@link TEXT_DIM}). */
export const DISABLED_LABEL = TEXT_DIM;

/** A disabled label's opacity. */
export const DISABLED_LABEL_ALPHA = 0.3;

/** Below this label opacity a control reads as inactive; enabled labels sit above it. */
export const ENABLED_LABEL_MIN_ALPHA = 0.9;

// ---------------------------------------------------------------------------
// The three looks (frozen tokens).
// ---------------------------------------------------------------------------

const PRIMARY: ButtonStyle = {
  fill: PALETTE.plasma,
  fillAlpha: 0.18,
  stroke: PALETTE.plasma,
  strokeWidth: 2,
  strokeAlpha: 0.85,
  label: TEXT_PRIMARY,
  labelAlpha: 1,
};

const STANDARD: ButtonStyle = {
  // Steel, not plasma — lower emphasis. But the label is the SAME full-contrast
  // chalk and the border is the SAME 2px: standard is active, not second-class.
  fill: PALETTE.hullSteel,
  fillAlpha: 0.14,
  stroke: PALETTE.hullSteel,
  strokeWidth: 2,
  strokeAlpha: 0.7,
  label: TEXT_PRIMARY,
  labelAlpha: 1,
};

const DISABLED: ButtonStyle = {
  fill: PALETTE.hullSteel,
  fillAlpha: 0.05,
  stroke: PALETTE.hullSteel,
  strokeWidth: 1,
  strokeAlpha: 0.25,
  label: DISABLED_LABEL,
  labelAlpha: DISABLED_LABEL_ALPHA,
};

/** The whole enumerable style space — what the contract test walks. */
export const BUTTON_STYLES = {
  primary: PRIMARY,
  standard: STANDARD,
  disabled: DISABLED,
} as const;

/**
 * The one resolver every menu view calls. Pass the variant and whether the
 * control can be acted on *this instant*; get back the tokens to draw.
 *
 * `disabled: true` returns the dim look — and the caller owes the player a
 * reason for it (p4-03), the same way the lobby RUSH button shows "WAITING FOR
 * THE HOST" instead of a dead box.
 */
export function buttonStyle(variant: ButtonVariant, disabled = false): ButtonStyle {
  if (disabled) return DISABLED;
  return variant === 'primary' ? PRIMARY : STANDARD;
}

/**
 * Does a resolved style sit in the disabled token region? The predicate the
 * contract test walks every control's style through: an ENABLED control that
 * answers `true` here is the field-report bug (a gray-active button).
 */
export function usesDisabledTokens(style: ButtonStyle): boolean {
  return style.label === DISABLED_LABEL || style.labelAlpha < ENABLED_LABEL_MIN_ALPHA;
}
