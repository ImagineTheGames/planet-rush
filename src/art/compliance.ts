/**
 * src/art/compliance.ts — the RESERVED rule, mechanised. OWNER: Art & Audio Agent.
 *
 * Style-guide §2 is the rule that carries the most weight in the whole art
 * contract:
 *
 * > **Signal yellow `#F2D24B` means ore or danger, and nothing else. Ever.**
 * > … A player scanning a chaotic screen must be able to trust yellow
 * > completely. Every misuse spends that trust. Treat yellow as a controlled
 * > substance.
 *
 * A rule that valuable cannot be enforced by review, because review is exactly
 * what fails on the tenth sprite at the end of a long session. So it is enforced
 * here, as a walk over the sprite IR (./shapes), and `compliance.test.ts` runs
 * it across the entire catalogue on every commit. Adding a sprite that puts
 * yellow on a thruster flare does not get a comment in a PR — it fails CI.
 *
 * Four rules, all structural:
 *
 *  1. **Allow-list.** Every colour is one of the six, a declared shade of one of
 *     the six (./palette `DERIVED`), or a roster identity colour. No seventh hue.
 *  2. **Yellow is reserved.** Signal yellow and its shades appear only on roles
 *     `ore`, `core`, `danger` — the three the style guide names.
 *  3. **Red is reserved.** Threat red and its shades appear only on `danger`:
 *     "never a neutral or friendly accent" (§2).
 *  4. **Identity is trim.** A roster colour appears only on `identity` shapes,
 *     and `identity` never paints itself in a material colour — a hull that took
 *     player colour, or trim that quietly went steel, both break §3.
 *  5. **The sky is a whisper, and never yellow** (a0-07, style-guide §2.2). The
 *     backdrop wash (role `sky`) is the one surface in the game that covers
 *     every pixel of every frame, so what it may carry is bounded by *number*,
 *     not by prose — see {@link SKY_ALPHA_MAX} / {@link SKY_RESERVED_ALPHA_MAX}
 *     below. And the ground colour is backdrop-only: {@link FLOOR} on anything
 *     but `sky` is an entity that painted itself the floor.
 */

import {
  ALLOWED_COLORS,
  DERIVED,
  DERIVED_RECIPES,
  FLOOR,
  IDENTITY_COLORS,
  PALETTE,
  hex,
  type DerivedKey,
} from './palette';
import type { PaintRole, SpriteDef } from './shapes';

/** One broken rule, named precisely enough to fix without opening a renderer. */
export interface Violation {
  readonly sprite: string;
  /** Index into `SpriteDef.shapes`. */
  readonly shapeIndex: number;
  readonly role: PaintRole;
  readonly color: number;
  readonly rule:
    | 'allow-list'
    | 'reserved-yellow'
    | 'reserved-red'
    | 'identity-trim'
    | 'alpha'
    | 'sky-whisper'
    | 'ground-only';
  readonly detail: string;
}

/** Colours descended from a given palette entry: the entry plus its shades. */
function family(base: keyof typeof PALETTE): ReadonlySet<number> {
  const out = new Set<number>([PALETTE[base]]);
  for (const key of Object.keys(DERIVED_RECIPES) as DerivedKey[]) {
    if (DERIVED_RECIPES[key].base === base) out.add(DERIVED[key]);
  }
  return out;
}

/** Signal yellow and every declared shade of it. */
export const YELLOW_FAMILY: ReadonlySet<number> = family('signalYellow');
/** Threat red and every declared shade of it. */
export const RED_FAMILY: ReadonlySet<number> = family('threatRed');

/** The only roles signal yellow may wear (style-guide §2). Note what is NOT here:
 *  `sky`. The backdrop covers every pixel of every frame, so signal yellow is
 *  barred from it at *any* alpha — the strictest reading of §2 there is. */
const YELLOW_ROLES: readonly PaintRole[] = ['ore', 'core', 'danger'];

/**
 * The ceiling on any {@link FLOOR}-less ink painted on role `sky` (a0-07).
 *
 * The backdrop is the one surface behind every entity in the game at all times,
 * which is exactly why "keep it subtle" cannot be left to taste: a wash that
 * drifts up by 4% of alpha is a wash competing with the fleet on every frame.
 * 12% is the ceiling; the brightest sky actually shipped (Plasma Reef) peaks at
 * 8%, and the rest sit under 6%.
 */
export const SKY_ALPHA_MAX = 0.12;

/**
 * The much lower ceiling for a RESERVED hue on the sky — the whole of the §2.2
 * carve-out, as a number (a0-07).
 *
 * Threat red is barred everywhere but `danger`, for the reason §2 gives: a
 * player scanning a chaotic screen must be able to trust it. The two warm skies
 * the developer picked (Iron Veil, Deep Ember) are *rust and dying coals* — a
 * hue the palette owns and a value nothing else in the game occupies. They are
 * legal only because the composite is provably not a signal: at 6% over Floor,
 * `shade(threatRed)` lands at luma ≈ 5/255, an eighth of the ink outline every
 * sprite in the game is drawn with, and a thirtieth of the damage fill it shares
 * a hue with. Enforced here, so "provably" is a test rather than a claim.
 *
 * Signal yellow gets no such carve-out at any alpha. See `YELLOW_ROLES`.
 */
export const SKY_RESERVED_ALPHA_MAX = 0.06;

/** Audit one sprite. An empty array is a compliant sprite. */
export function auditSprite(def: SpriteDef): Violation[] {
  const found: Violation[] = [];
  def.shapes.forEach((shape, shapeIndex) => {
    for (const ink of [shape.fill, shape.stroke]) {
      if (!ink) continue;
      const { color } = ink;
      const at = { sprite: def.name, shapeIndex, role: shape.role, color };

      if (!ALLOWED_COLORS.has(color)) {
        found.push({
          ...at,
          rule: 'allow-list',
          detail: `${hex(color)} is not one of the six, a declared shade, or a roster colour (style-guide §1).`,
        });
      }
      if (YELLOW_FAMILY.has(color) && !YELLOW_ROLES.includes(shape.role)) {
        found.push({
          ...at,
          rule: 'reserved-yellow',
          detail: `signal yellow on role '${shape.role}' — yellow means ore or danger, and nothing else (style-guide §2).`,
        });
      }
      if (RED_FAMILY.has(color) && shape.role !== 'danger') {
        // The one carve-out (§2.2): a warm SKY, at a whisper the audit measures.
        const skyWhisper = shape.role === 'sky' && ink.alpha <= SKY_RESERVED_ALPHA_MAX;
        if (!skyWhisper) {
          found.push({
            ...at,
            rule: 'reserved-red',
            detail:
              shape.role === 'sky'
                ? `threat red on the sky at alpha ${ink.alpha} — the §2.2 carve-out stops at ${SKY_RESERVED_ALPHA_MAX}, above which a rust band is a red screen.`
                : `threat red on role '${shape.role}' — red is damage, alarm and enemy fire only (style-guide §2).`,
          });
        }
      }
      if (shape.role === 'sky' && color !== FLOOR && ink.alpha > SKY_ALPHA_MAX) {
        found.push({
          ...at,
          rule: 'sky-whisper',
          detail: `sky ink at alpha ${ink.alpha} — the backdrop is behind every entity on every frame, so it stops at ${SKY_ALPHA_MAX} (style-guide §2.2).`,
        });
      }
      if (color === FLOOR && shape.role !== 'sky') {
        found.push({
          ...at,
          rule: 'ground-only',
          detail: `Floor ${hex(FLOOR)} on role '${shape.role}' — the ground is the backdrop's alone; an entity painted in it is a hole in the world (style-guide §1).`,
        });
      }
      if (IDENTITY_COLORS.has(color) && shape.role !== 'identity') {
        found.push({
          ...at,
          rule: 'identity-trim',
          detail: `roster colour on role '${shape.role}' — player colour lives only on trim (style-guide §3.2).`,
        });
      }
      if (!IDENTITY_COLORS.has(color) && shape.role === 'identity') {
        found.push({
          ...at,
          rule: 'identity-trim',
          detail: `role 'identity' painted ${hex(color)}, which is not a roster colour (style-guide §3.1).`,
        });
      }
      if (!(ink.alpha > 0 && ink.alpha <= 1)) {
        found.push({ ...at, rule: 'alpha', detail: `alpha ${ink.alpha} is outside (0, 1].` });
      }
    }
  });
  return found;
}

/** Audit many sprites at once. */
export function auditAll(defs: readonly SpriteDef[]): Violation[] {
  return defs.flatMap(auditSprite);
}

/** A violation list as a message a human can act on. */
export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `  ${v.sprite} shape#${v.shapeIndex} [${v.rule}] ${v.detail}`)
    .join('\n');
}

/** Throw if any sprite breaks the contract. Used by the test, and by any tool. */
export function assertPaletteCompliance(defs: readonly SpriteDef[]): void {
  const violations = auditAll(defs);
  if (violations.length > 0) {
    throw new Error(
      `${violations.length} palette violation(s) — style-guide.md is a contract:\n${formatViolations(violations)}`,
    );
  }
}
